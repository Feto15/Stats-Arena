import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import { load } from "cheerio";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@statsarena/db/schema";
import type { StatsArenaDatabase } from "@statsarena/db";
import { competitionReference, SOURCE_NAMES } from "@statsarena/db/source";
import { competitionUrl } from "../src/domain/source-url.js";
import { validateBoxScore } from "../src/domain/validation.js";
import { incrementalReason, fixtureHash } from "../src/domain/incremental.js";
import { parseBoxScoreHtml } from "../src/parsers/boxscore.js";
import { parseFixturesHtml, parseFixturePageLinksHtml } from "../src/parsers/fixtures.js";
import { parseSummaryHtml } from "../src/parsers/summary.js";
import { parseTeamsHtml } from "../src/parsers/teams.js";
import { parsePlayersHtml } from "../src/parsers/players.js";
import { parseStandingsGroupLinksHtml } from "../src/parsers/standings.js";
import { parsePlayByPlayHtml } from "../src/parsers/play-by-play.js";
import { parseShotChartHtml } from "../src/parsers/shot-chart.js";
import { parseTeamAnalysisHtml, parseTeamStatisticsHtml } from "../src/parsers/official-metrics.js";
import { targetedRetryUrls } from "../src/operations/targeted-retry.js";
import { parseCompetitionConfig } from "../src/operations/config.js";
import { FixturePageCheckpoint } from "../src/operations/fixture-checkpoint.js";
import { acquireSyncLease } from "../src/operations/lease.js";
import { readIncrementalGames } from "../src/operations/runner.js";
import { importCompetition } from "../src/import/importer.js";
import { compactNeonAudit } from "../src/operations/neon-retention.js";
import { PARSER_VERSION, type ParsedCompetitionData } from "../src/domain/types.js";

const base = "https://hosted.dcd.shared.geniussports.com/IBL/en/competition/42041";
function html(file: string): string {
  return gunzipSync(readFileSync(new URL(`fixtures/live-2026-10-16-ibl/${file}.html.gz`, import.meta.url))).toString("utf8");
}
function sampleData(): ParsedCompetitionData {
  const root = parseFixturesHtml(html("fixtures"), base).records[0]!;
  const fixture = root.games.find((game) => game.sourceId === "2697582")!;
  const summary = parseSummaryHtml(html("match-2697582-summary"), `${base}/match/2697582/summary`).records[0]!;
  const boxScore = parseBoxScoreHtml(html("match-2697582-boxscore"), `${base}/match/2697582/boxscore`).records[0]!;
  return { competition: root.competition, teams: parseTeamsHtml(html("teams"), `${base}/teams`).records,
    players: parsePlayersHtml(html("players"), `${base}/players`).records, groups: [], issues: [],
    matches: [{ fixture, summary, boxScore, issues: validateBoxScore(boxScore, summary) }] };
}

test("IBL real HTML derives absent 2P columns with provenance and retains explicit invalid cells", () => {
  const data = sampleData();
  const match = data.matches[0]!;
  assert.equal(data.teams.length, 13); assert.equal(data.players.length, 169);
  assert.equal(parseFixturesHtml(html("fixtures"), base).records[0]!.games.length, 40);
  assert.equal(parseStandingsGroupLinksHtml(html("standings"), `${base}/standings`).records.length, 11);
  assert.equal(match.issues.length, 0);
  assert.equal(match.boxScore!.players.length, 23);
  assert.deepEqual(match.boxScore!.teams.map((team) => [team.points, team.twoPointsMade, team.twoPointAttempts]), [[56, 17, 44], [84, 23, 46]]);
  const player = match.boxScore!.players[0]!;
  assert.equal(player.twoPointsMade, 3); assert.equal(player.twoPointAttempts, 7);
  assert.equal(player.rawValues["2PM"], undefined);
  assert.equal(player.statDerivations!["twoPointsMade"]!.formula, "FGM - 3PM");
  const $ = load(html("match-2697582-boxscore"));
  $("table").each((_, table) => {
    $(table).find("thead tr").append("<th>2PM</th><th>2PA</th>");
    $(table).find("tbody tr").append("<td></td><td></td>");
  });
  const blankOfficial = parseBoxScoreHtml($.html(), `${base}/match/2697582/boxscore`);
  assert.equal(blankOfficial.status, "partial");
  assert.equal(blankOfficial.records[0]!.players[0]!.twoPointsMade, null);
  assert.equal(blankOfficial.records[0]!.players[0]!.statDerivations, undefined);
  const brokenLayout = load(html("match-2697582-analysis"));
  brokenLayout("a[href*='/team/']").remove();
  assert.equal(parseTeamAnalysisHtml(brokenLayout.html(), `${base}/match/2697582/analysis`).status, "partial");
  for (const [name, parser, tab] of [
    ["match-2697582-playbyplay", parsePlayByPlayHtml, "playbyplay"],
    ["match-2697582-shotchart", parseShotChartHtml, "shotchart"],
    ["match-2697582-analysis", parseTeamAnalysisHtml, "analysis"],
    ["statistics-team", parseTeamStatisticsHtml, "statistics/team"],
  ] as const) {
    const report = parser(html(name), tab === "statistics/team" ? `${base}/${tab}` : `${base}/match/2697582/${tab}`);
    if (name === "match-2697582-analysis") {
      assert.equal(report.status, "parsed"); assert.equal(report.records.length, 0);
      assert.equal(report.issues[0]!.code, "TEAM_ANALYSIS_METRICS_UNAVAILABLE");
    } else assert.ok(report.records.length > 0, name);
  }
});

test("IBL references isolate fixture links, retries, checkpoints and config from matching IBF IDs", async () => {
  const ibf = base.replace("/IBL/", "/IBF/");
  assert.equal(competitionUrl("42041").href, ibf);
  assert.equal(competitionUrl("IBL:42041").href, base);
  assert.equal(competitionReference(base).source, SOURCE_NAMES.IBL);
  assert.deepEqual(parseFixturePageLinksHtml(`<a href="${ibf}/schedule">Foreign</a><a href="${base}/schedule">Own</a>`, base), [`${base}/schedule`]);
  const audit = { fetches: [ibf, base].map((url) => ({ requestUrl: `${url}/match/1/boxscore`, fetchStatus: "failed" })) };
  assert.deepEqual(targetedRetryUrls(audit, "IBL:42041"), [`${base}/match/1/boxscore`]);
  assert.deepEqual(parseCompetitionConfig({ version: 1, competitions: [{ sourceUrl: ibf }, { sourceUrl: base }] }).map((entry) => entry.sourceCompetitionId), ["42041", "IBL:42041"]);
  const fixture = sampleData().matches[0]!.fixture;
  assert.equal(incrementalReason(fixture, { fixtureHash: fixtureHash(fixture), detailParserVersion: PARSER_VERSION, detailSyncStatus: "parsed", detailSyncedAt: new Date(), needsRetry: false }, new Set([fixture.sourceUrl.replace("/IBL/", "/IBF/")])), null);
  const directory = await mkdtemp(join(tmpdir(), "statsarena-ibl-checkpoint-"));
  try {
    const own = new FixturePageCheckpoint(directory, "IBL:42041");
    await own.write([`${base}/schedule`]);
    await assert.rejects(own.write([`${ibf}/schedule`]), /berbeda kompetisi/);
    assert.deepEqual(await own.read(), [`${base}/schedule`]);
    assert.deepEqual(await new FixturePageCheckpoint(directory, "42041").read(), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("IBL and IBF with identical IDs import independently, persist derivations and keep lease scopes isolated", async () => {
  const client = new PGlite();
  const directory = await mkdtemp(join(tmpdir(), "statsarena-ibl-maintenance-"));
  try {
    await migrate(drizzle(client), { migrationsFolder: fileURLToPath(new URL("../../packages/db/drizzle", import.meta.url)), migrationsSchema: "statsarena", migrationsTable: "__drizzle_migrations" });
    const db = drizzle(client, { schema }) as unknown as StatsArenaDatabase;
    const ibl = sampleData();
    const ibf = JSON.parse(JSON.stringify(ibl).replaceAll("/IBL/", "/IBF/")) as ParsedCompetitionData;
    ibf.competition.name = "Independent IBF sample";
    const first = await importCompetition(db, ibf, []);
    const second = await importCompetition(db, ibl, []);
    assert.equal(first.status, "succeeded"); assert.equal(second.status, "succeeded");
    assert.notEqual(first.competitionId, second.competitionId);
    const counts = async () => (await client.query<{ competitions: number; teams: number; players: number; games: number; stats: number }>(`select (select count(*)::int from statsarena.competitions) competitions, (select count(*)::int from statsarena.teams) teams, (select count(*)::int from statsarena.players) players, (select count(*)::int from statsarena.games) games, (select count(*)::int from statsarena.player_game_stats) stats`)).rows[0];
    const before = await counts();
    assert.deepEqual(before, { competitions: 2, teams: 26, players: 338, games: 2, stats: 46 });
    await importCompetition(db, ibl, []); assert.deepEqual(await counts(), before);
    const rows = await db.select().from(schema.playerGameStats);
    assert.equal(rows[0]!.statDerivations["twoPointsMade"]!.formula, "FGM - 3PM");
    assert.equal((await readIncrementalGames(db, "IBL:42041")).size, 1);
    const ibfLease = await acquireSyncLease(db, "42041");
    const iblLease = await acquireSyncLease(db, "IBL:42041");
    await assert.rejects(acquireSyncLease(db, "IBL:42041"), /sedang disinkronkan/);
    await ibfLease.release(); await iblLease.assertOwned(); await iblLease.release();
    await compactNeonAudit(db, { dryRun: true, protectedRunIds: [], backupPath: join(directory, "backup.json.gz") });
    const mixed = structuredClone(ibl); mixed.teams[0]!.sourceUrl = mixed.teams[0]!.sourceUrl.replace("/IBL/", "/IBF/");
    await assert.rejects(importCompetition(db, mixed, []), /namespace sumber lain/);
    assert.deepEqual(await counts(), before);
  } finally { await client.close(); await rm(directory, { recursive: true, force: true }); }
});
