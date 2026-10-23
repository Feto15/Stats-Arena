import assert from "node:assert/strict";
import test from "node:test";
import { load } from "cheerio";
import { validateShotsAgainstBoxScore } from "../src/domain/shot-validation.js";
import { parseMatchDetailTabLinksHtml, parseCompetitionStatisticsLinkHtml } from "../src/parsers/links.js";
import { parsePlayByPlayHtml } from "../src/parsers/play-by-play.js";
import { parseShotChartHtml } from "../src/parsers/shot-chart.js";
import { parseTeamAnalysisHtml, parseTeamStatisticsHtml } from "../src/parsers/official-metrics.js";
import { parseBoxScoreHtml } from "../src/parsers/boxscore.js";
import { loadHtmlFixture, loadStage5HtmlFixture } from "./fixtures.js";

const base07 = "https://hosted.dcd.shared.geniussports.com/IBF/en/competition/49607";
const base09 = "https://hosted.dcd.shared.geniussports.com/IBF/en/competition/49609";

test("Play by play preserves source sequence, equal clocks, raw score zero, and null player IDs", () => {
  const url = `${base07}/match/2931666/playbyplay?`;
  const parsed = parsePlayByPlayHtml(loadStage5HtmlFixture("49607-2931666-playbyplay.html.gz"), url);
  assert.equal(parsed.status, "parsed");
  assert.equal(parsed.records.length, 548);
  assert.deepEqual(parsed.records.slice(0, 3).map((event) => event.sourceSequence), [0, 1, 2]);
  assert.equal(parsed.records[0]?.actionText, "Game start");
  assert.equal(parsed.records[0]?.timeRaw, null);
  assert.equal(parsed.records[0]?.scoreRaw, "0-0");
  assert.equal(parsed.records[0]?.team1Score, 0);
  assert.equal(parsed.records[0]?.team2Score, 0);
  assert.equal(parsed.records[3]?.timeRaw, "09:59:00");
  assert.equal(parsed.records[4]?.timeRaw, "09:59:00");
  assert.equal(parsed.records[3]?.sourceSequence, 3);
  assert.equal(parsed.records[4]?.sourceSequence, 4);
  assert.equal(parsed.records[3]?.periodNumber, 1);
  assert.equal(parsed.records[3]?.periodType, "regulation");
  assert.equal(parsed.records.find((event) => event.playerName)?.playerSourceId, null);
  assert.ok(parsed.records.some((event) => event.actionType === "turnover"));
  assert.ok(parsed.records.some((event) => event.actionType === "substitution"));
  assert.deepEqual(new Set(parsed.records.map((event) => event.teamSourceId).filter((value): value is string => value !== null)), new Set(["146118", "154596"]));
  assert.ok(parsed.records.some((event) => event.teamSide === "home"));
  assert.ok(parsed.records.some((event) => event.teamSide === "away"));
});

test("Play by play keeps invalid clocks raw and recognizes overtime from the source class", () => {
  const url = `${base07}/match/2931666/playbyplay`;
  const $ = load(loadStage5HtmlFixture("49607-2931666-playbyplay.html.gz"));
  const event = $("#playbyplay .pbpa").eq(3);
  event.find(".pbp-time").text("not-a-clock");
  const parsedInvalidTime = parsePlayByPlayHtml($.html(), url);
  assert.equal(parsedInvalidTime.records[3]?.timeRaw, "not-a-clock");

  const first = $("#playbyplay .pbpa").first();
  const classes = (first.attr("class") ?? "").split(/\s+/).filter((value) => value !== "per_1" && value !== "per_reg");
  first.attr("class", [...classes, "per_5", "per_ot"].join(" "));
  const parsedOvertime = parsePlayByPlayHtml($.html(), url);
  assert.equal(parsedOvertime.records[0]?.periodNumber, 5);
  assert.equal(parsedOvertime.records[0]?.periodType, "overtime");
});

test("Play by play parser is reusable on the second competition without fixed entity IDs", () => {
  const parsed = parsePlayByPlayHtml(
    loadStage5HtmlFixture("49609-2915281-playbyplay.html.gz"),
    `${base09}/match/2915281/playbyplay`
  );
  assert.equal(parsed.records.length, 466);
  assert.equal(parsed.records[0]?.gameSourceId, "2915281");
  assert.equal(parsed.records[3]?.periodNumber, 1);
});

test("Shot chart keeps only 2PT/3PT markers, normalizes coordinates, and matches 2931666 totals", () => {
  const url = `${base07}/match/2931666/shotchart?`;
  const parsed = parseShotChartHtml(loadStage5HtmlFixture("49607-2931666-shotchart.html.gz"), url);
  assert.equal(parsed.status, "parsed");
  assert.equal(parsed.records.length, 81);
  assert.equal(parsed.records.filter((shot) => shot.result === "made").length, 24);
  assert.equal(parsed.records.filter((shot) => shot.shotType === "2pt").length, 63);
  assert.equal(parsed.records.filter((shot) => shot.shotType === "3pt").length, 18);
  assert.ok(parsed.records.every((shot) => shot.xPercent >= 0 && shot.xPercent <= 100 && shot.yPercent >= 0 && shot.yPercent <= 100));
  assert.ok(parsed.records.every((shot) => shot.teamSourceId && shot.playerSourceId));
  assert.ok(parsed.records.some((shot, index) => index > 0 && shot.sourceSequence > (parsed.records[index - 1]?.sourceSequence ?? -1) + 1));
  const boxScore = parseBoxScoreHtml(loadHtmlFixture("49607-2931666-boxscore.html.gz"), `${base07}/match/2931666/boxscore`).records[0];
  assert.ok(boxScore);
  assert.deepEqual(validateShotsAgainstBoxScore(parsed, boxScore), []);
  const modifiedBoxScore = structuredClone(boxScore);
  const home = modifiedBoxScore.teams[0];
  assert.ok(home);
  home.fieldGoalsAttempted = (home.fieldGoalsAttempted ?? 0) + 1;
  assert.ok(validateShotsAgainstBoxScore(parsed, modifiedBoxScore).some((entry) => entry.code === "SHOT_FGA_MISMATCH"));
});

test("second competition shot titles also parse names when no jersey prefix is present", () => {
  const parsed = parseShotChartHtml(
    loadStage5HtmlFixture("49609-2915281-shotchart.html.gz"),
    `${base09}/match/2915281/shotchart`
  );
  assert.equal(parsed.records.length, 57);
  assert.equal(parsed.status, "parsed");
  assert.equal(parsed.records.find((shot) => shot.playerSourceId === "2810438")?.playerName, "Cheryl Nur SYAFIRA");
  assert.ok(parsed.records.every((shot) => shot.playerName !== null));
});

test("Shot chart filters foul and turnover markers and makes malformed shot markers partial", () => {
  const url = `${base07}/match/2931666/shotchart`;
  const html = loadStage5HtmlFixture("49607-2931666-shotchart.html.gz");
  const parsed = parseShotChartHtml(html, url);
  assert.ok(!parsed.records.some((shot) => /foul|turnover/i.test(shot.rawTitle)));
  const $ = load(html);
  $("#shotchart .sc_img[title*='2pt']").first().attr("style", "top: 130%; left: 12%;");
  const partial = parseShotChartHtml($.html(), url);
  assert.equal(partial.status, "partial");
  assert.ok(partial.issues.some((entry) => entry.code === "SHOT_MARKER_INCOMPLETE"));
});

test("Team Analysis stores game-scope PIP/PFT/FBP/2CP and explicit unavailable BP for both competitions", () => {
  const source07 = loadStage5HtmlFixture("49607-2931666-analysis.html.gz");
  const parsed07 = parseTeamAnalysisHtml(source07, `${base07}/match/2931666/analysis`);
  assert.equal(parsed07.status, "parsed");
  assert.equal(parsed07.records.length, 10);
  assert.ok(parsed07.records.every((metric) => metric.scope === "game" && metric.gameSourceId === "2931666"));
  assert.deepEqual(parsed07.records.filter((metric) => metric.metricCode === "2CP").map((metric) => metric.value), [4, 7]);
  assert.deepEqual(parsed07.records.filter((metric) => metric.metricCode === "PIP").map((metric) => metric.value), [16, 24]);
  assert.deepEqual(parsed07.records.filter((metric) => metric.metricCode === "PFT").map((metric) => metric.value), [13, 22]);
  assert.deepEqual(parsed07.records.filter((metric) => metric.metricCode === "FBP").map((metric) => metric.value), [5, 11]);
  assert.ok(parsed07.records.filter((metric) => metric.metricCode === "BP").every((metric) => metric.value === null && metric.availability === "unavailable"));

  const parsed09 = parseTeamAnalysisHtml(
    loadStage5HtmlFixture("49609-2915281-analysis.html.gz"),
    `${base09}/match/2915281/analysis`
  );
  assert.equal(parsed09.records.filter((metric) => metric.metricCode === "2CP").length, 2);
  assert.deepEqual(parsed09.records.filter((metric) => metric.metricCode === "PIP").map((metric) => metric.value), [18, 2]);
});

test("Team Statistics values remain competition aggregates and retain games-played scope", () => {
  const parsed07 = parseTeamStatisticsHtml(
    loadStage5HtmlFixture("49607-competition-statistics-team.html.gz"),
    `${base07}/statistics/team?`
  );
  assert.equal(parsed07.status, "parsed");
  assert.equal(parsed07.records.length, 54);
  assert.ok(parsed07.records.every((metric) => metric.scope === "competition" && metric.gameSourceId === null));
  assert.ok(parsed07.records.every((metric) => metric.sampleGamesPlayed !== null));
  assert.deepEqual(new Set(parsed07.records.map((metric) => metric.metricCode)), new Set(["BP", "2CP"]));

  const parsed09 = parseTeamStatisticsHtml(
    loadStage5HtmlFixture("49609-competition-statistics-team.html.gz"),
    `${base09}/statistics/team?`
  );
  assert.equal(parsed09.records.length, 36);
});

test("official metric parsers reject missing/shifted cells and invalid values, while preserving zero and explicit unavailable", () => {
  const cases = [
    { file: "49607-2931666-analysis.html.gz", url: `${base07}/match/2931666/analysis`, parser: parseTeamAnalysisHtml, metric: "2CP", final: true },
    { file: "49607-2931666-analysis.html.gz", url: `${base07}/match/2931666/analysis`, parser: parseTeamAnalysisHtml, metric: "PIP", final: true },
    { file: "49607-2931666-analysis.html.gz", url: `${base07}/match/2931666/analysis`, parser: parseTeamAnalysisHtml, metric: "PFT", final: true },
    { file: "49607-2931666-analysis.html.gz", url: `${base07}/match/2931666/analysis`, parser: parseTeamAnalysisHtml, metric: "FBP", final: true },
    { file: "49607-competition-statistics-team.html.gz", url: `${base07}/statistics/team`, parser: parseTeamStatisticsHtml, metric: "BP", final: false }
  ];
  for (const sample of cases) {
    const html = loadStage5HtmlFixture(sample.file);
    for (const change of ["remove", "truncate", "", "invalid", "-1", "1.5", "0", "—"] as const) {
      const $ = load(html);
      const table = $("table.tableClass").first();
      const column = table.find("thead th").toArray().findIndex((cell) => $(cell).text().trim() === sample.metric);
      assert.ok(column >= 0);
      const rows = table.find("tbody tr");
      const row = sample.final ? rows.filter((_, node) => $(node).find("th,td").first().text().trim() === "Final").first() : rows.first();
      const cells = row.find("th,td");
      if (change === "remove") cells.eq(column).remove();
      else if (change === "truncate") cells.slice(column).remove();
      else cells.eq(column).text(change);
      const parsed = sample.parser($.html(), sample.url);
      if (change === "0" || change === "—") {
        assert.equal(parsed.status, "parsed", `${sample.metric}: ${change}`);
        const metric = parsed.records.find((record) => record.metricCode === sample.metric);
        assert.ok(metric);
        assert.equal(metric.value, change === "0" ? 0 : null);
        assert.equal(metric.availability, change === "0" ? "available" : "unavailable");
      } else {
        assert.equal(parsed.status, "partial", `${sample.metric}: ${change}`);
        assert.ok(parsed.issues.some((entry) => entry.severity === "error"));
      }
    }
  }
});

test("match detail and team statistics page URLs are discovered from source links", () => {
  const summary = loadHtmlFixture("49607-2931666-summary.html.gz");
  const tabs = parseMatchDetailTabLinksHtml(summary, `${base07}/match/2931666/summary`).records[0];
  assert.ok(tabs);
  assert.equal(tabs.gameSourceId, "2931666");
  assert.match(tabs.playByPlay ?? "", /\/match\/2931666\/playbyplay/);
  assert.match(tabs.shotChart ?? "", /\/match\/2931666\/shotchart/);
  assert.match(tabs.analysis ?? "", /\/match\/2931666\/analysis/);
  const source = parseCompetitionStatisticsLinkHtml(loadHtmlFixture("49607-fixtures.html.gz"), base07).records[0];
  assert.equal(source?.sourceUrl, `${base07}/statistics/team?`);
});
