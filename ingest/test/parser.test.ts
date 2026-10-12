import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "cheerio";
import { loadHtmlFixture } from "./fixtures.js";
import { parseBoxScoreHtml } from "../src/parsers/boxscore.js";
import { parseFixturesHtml } from "../src/parsers/fixtures.js";
import { parsePlayersHtml } from "../src/parsers/players.js";
import { parseStandingsGroupLinksHtml, parseStandingsHtml } from "../src/parsers/standings.js";
import { parseSummaryHtml } from "../src/parsers/summary.js";
import { parseTeamsHtml } from "../src/parsers/teams.js";
import { validateBoxScore } from "../src/domain/validation.js";
import { competitionUrl, groupSourceId, sourceEntityId } from "../src/domain/source-url.js";

const baseUrl = "https://hosted.dcd.shared.geniussports.com/IBF/en/competition/49607";

test("fixture parser discovers sample competition, deduplicates match URLs, and reads active status classes", () => {
  const parsed = parseFixturesHtml(loadHtmlFixture("49607-fixtures.html.gz"), baseUrl);
  const page = parsed.records[0];
  assert.ok(page);
  assert.equal(page.competition.name, "(M) DBL DI JOGJAKARTA SERIES");
  assert.equal(page.competition.sourceId, "49607");
  assert.equal(page.games.length, 32);
  assert.equal(new Set(page.games.map((game) => game.sourceId)).size, 32);

  const sample = page.games.find((game) => game.sourceId === "2931666");
  assert.ok(sample);
  assert.equal(sample.homeScore, 25);
  assert.equal(sample.awayScore, 45);
  assert.equal(sample.status, "complete");
  assert.equal(sample.homeTeamSourceId, "146118");
  assert.equal(sample.awayTeamSourceId, "154596");
});

test("Teams and Players parsers preserve source identity and do not infer player-team membership", () => {
  const teams = parseTeamsHtml(loadHtmlFixture("49607-teams.html.gz"), `${baseUrl}/teams`);
  const players = parsePlayersHtml(loadHtmlFixture("49607-players.html.gz"), `${baseUrl}/players`);
  assert.equal(teams.records.length, 27);
  assert.equal(new Set(teams.records.map((team) => team.sourceId)).size, 27);
  assert.equal(players.records.length, 322);
  assert.equal(new Set(players.records.map((player) => player.sourceId)).size, 322);
  assert.ok(teams.records.some((team) => team.logoUrl === null));
  assert.equal("teamSourceId" in (players.records[0] ?? {}), false);
});

test("Standings discovery follows all group tabs and preserves their real pool numbers", () => {
  const parsed = parseStandingsGroupLinksHtml(
    loadHtmlFixture("49607-standings-index.html.gz"),
    `${baseUrl}/standings`
  );
  assert.equal(parsed.records.length, 9);
  const groupA = parsed.records.find((group) => group.label.toUpperCase() === "GROUP A");
  const groupB = parsed.records.find((group) => group.label.toUpperCase() === "GROUP B");
  assert.ok(groupA);
  assert.ok(groupB);
  assert.equal(groupA.poolNumber, "9");
  assert.equal(groupB.poolNumber, "7");
  assert.match(groupA.sourceId, /phaseName=PLAYOFFS/);
  assert.match(groupA.sourceId, /poolNumber=9/);

  const standingsA = parseStandingsHtml(loadHtmlFixture("49607-group-a.html.gz"), groupA.sourceUrl).records[0];
  const standingsB = parseStandingsHtml(loadHtmlFixture("49607-group-b.html.gz"), groupB.sourceUrl).records[0];
  assert.ok(standingsA);
  assert.ok(standingsB);
  assert.equal(standingsA.rows.length, 3);
  assert.equal(standingsB.rows.length, 3);
  assert.equal(standingsA.group.label, "GROUP A");
  assert.equal(standingsB.group.label, "GROUP B");
  assert.equal(standingsA.group.poolNumber, "9");
  assert.equal(standingsB.group.poolNumber, "7");
  assert.equal(standingsA.rows[0]?.teamName, "SMA BOPKRI 1 YOGYAKARTA");
  assert.equal(standingsA.rows[0]?.pointsFor, 175);
});

test("Summary and Box Score parsers read scores, time, totals, and headers by their labels", () => {
  const summary = parseSummaryHtml(
    loadHtmlFixture("49607-2931666-summary.html.gz"),
    `${baseUrl}/match/2931666/summary`
  ).records[0];
  const boxScore = parseBoxScoreHtml(
    loadHtmlFixture("49607-2931666-boxscore.html.gz"),
    `${baseUrl}/match/2931666/boxscore`
  ).records[0];
  assert.ok(summary);
  assert.ok(boxScore);
  assert.equal(summary.sourceId, "2931666");
  assert.equal(summary.homeScore, 25);
  assert.equal(summary.awayScore, 45);
  assert.equal(summary.status, "complete");
  assert.equal(summary.scheduledAtRaw, "Oct 5, 2026, 7:30 PM");
  assert.ok(!/UTC|Jakarta/.test(summary.scheduledAtRaw ?? ""));
  assert.equal(boxScore.teams.length, 2);
  assert.equal(boxScore.players.length, 24);

  const home = boxScore.teams.find((team) => team.teamSourceId === summary.homeTeamSourceId);
  const away = boxScore.teams.find((team) => team.teamSourceId === summary.awayTeamSourceId);
  assert.ok(home);
  assert.ok(away);
  assert.equal(home.points, 25);
  assert.equal(away.points, 45);
  assert.equal(home.fieldGoalsAttempted, 41);
  assert.equal(away.fieldGoalsAttempted, 40);
  assert.equal(validateBoxScore(boxScore, summary).filter((entry) => entry.severity === "error").length, 0);
});

test("Box Score uses column headers after their order changes and keeps unavailable stats null", () => {
  const html = `<section class="team-box"><a href="/IBF/en/competition/88/team/101">North</a>
    <table><thead><tr><th>3PM</th><th>Player</th><th>Pts</th><th>2PM</th><th>FGA</th><th>2PA</th><th>3PA</th><th>FTA</th><th>FTM</th><th>Mins</th></tr></thead>
    <tbody><tr><td>1</td><td><a href="/IBF/en/competition/88/person/501">Zero Player</a></td><td>5</td><td>1</td><td>4</td><td>2</td><td>2</td><td>0</td><td>0</td><td>10:12</td></tr></tbody>
    <tfoot><tr><td>1</td><td>Totals</td><td>5</td><td>1</td><td>4</td><td>2</td><td>2</td><td>0</td><td>0</td><td></td></tr></tfoot></table></section>`;
  const parsed = parseBoxScoreHtml(html, "https://hosted.dcd.shared.geniussports.com/IBF/en/match/999/boxscore");
  const player = parsed.records[0]?.players[0];
  assert.ok(player);
  assert.equal(player.points, 5);
  assert.equal(player.freeThrowsMade, 0);
  assert.equal(player.rebounds, null);
  assert.equal(player.minutesRaw, "10:12");
  assert.equal(player.minutes, 10.2);
});

test("Box Score rejects missing player links, missing headers, and truncated rows", () => {
  const html = loadHtmlFixture("49607-2931666-boxscore.html.gz");
  const url = `${baseUrl}/match/2931666/boxscore`;
  for (const mode of ["all-links", "one-link", "header", "cell"] as const) {
    const $ = load(html);
    const anchors = $("a[href*='/person/']");
    if (mode === "all-links") anchors.each((_, anchor) => { $(anchor).replaceWith($(anchor).text()); });
    if (mode === "one-link") anchors.first().replaceWith(anchors.first().text());
    if (mode === "header") $("th").filter((_, cell) => $(cell).text().trim() === "FGA").text("Unknown");
    if (mode === "cell") anchors.first().closest("tr").find("td").last().remove();
    const parsed = parseBoxScoreHtml($.html(), url);
    assert.equal(parsed.status, "partial", mode);
    assert.ok(parsed.issues.some((entry) => entry.severity === "error"), mode);
  }
});

test("Box Score detects a missing scoring player even when the remaining rows are valid", () => {
  const $ = load(loadHtmlFixture("49607-2931666-boxscore.html.gz"));
  $("a[href*='/person/']").filter((_, anchor) => $(anchor).closest("tr").find("td").eq(3).text().trim() !== "0").first().closest("tr").remove();
  const parsed = parseBoxScoreHtml($.html(), `${baseUrl}/match/2931666/boxscore`);
  assert.equal(parsed.status, "partial");
  assert.ok(parsed.issues.some((entry) => entry.code === "BOXSCORE_PLAYER_POINTS_INCOMPLETE"));
});

test("Box Score keeps seconds, zero, decimal minutes, and invalid durations distinct", () => {
  for (const [raw, expected] of [["8:41", 8 + 41 / 60], ["0:00", 0], ["10.25", 10.25], ["8:99", null], ["-", null]] as const) {
    const $ = load(loadHtmlFixture("49607-2931666-boxscore.html.gz"));
    const row = $("a[href*='/person/']").first().closest("tr");
    row.find("td").eq(2).text(raw);
    const parsed = parseBoxScoreHtml($.html(), `${baseUrl}/match/2931666/boxscore`);
    const player = parsed.records[0]?.players[0];
    assert.ok(player);
    assert.equal(player.minutesRaw, raw);
    assert.equal(player.minutes, expected);
    assert.equal(parsed.status, raw === "8:99" ? "partial" : "parsed");
  }
});

test("second competition uses the same fixture parser without fixed entity IDs", () => {
  const secondUrl = "https://hosted.dcd.shared.geniussports.com/IBF/en/competition/49609";
  const parsed = parseFixturesHtml(loadHtmlFixture("49609-fixtures.html.gz"), secondUrl);
  const page = parsed.records[0];
  assert.ok(page);
  assert.equal(page.competition.sourceId, "49609");
  assert.equal(page.competition.name, "(F) DBL DI JOGJAKARTA SERIES");
  assert.equal(page.games.length, 24);
  assert.ok(page.games.some((game) => game.status === "scheduled"));
});

test("source IDs come from nested Genius URLs and group identity includes the full tab query", () => {
  assert.equal(competitionUrl("49607").href, baseUrl);
  assert.equal(sourceEntityId(`${baseUrl}/match/2931666/summary`, "match"), "2931666");
  assert.equal(sourceEntityId(`${baseUrl}/team/146118?`, "team"), "146118");
  assert.equal(sourceEntityId(`${baseUrl}/person/1977891?`, "person"), "1977891");
  const identity = groupSourceId(new URL(`${baseUrl}/standings?phaseName=PLAYOFFS&poolNumber=9&`));
  assert.equal(identity.poolNumber, "9");
  assert.match(identity.id, /phaseName=PLAYOFFS/);
  assert.match(identity.id, /poolNumber=9/);
});

test("a valid active competition with no currently published fixture links parses as an empty schedule", () => {
  const empty = parseFixturesHtml(
    '<h1 class="competition-title">Bracket Pending</h1><div class="fixtures">No fixtures published yet</div>',
    "https://hosted.dcd.shared.geniussports.com/IBF/en/competition/70092"
  );
  assert.deepEqual(empty.records[0]?.games, []);
  assert.ok(empty.issues.some((entry) => entry.code === "FIXTURES_EMPTY"));
});
