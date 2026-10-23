import { backfillDetailQuality } from "../src/operations/quality-backfill.js";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { load } from "cheerio";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import type { StatsArenaDatabase } from "@statsarena/db";
import { importCompetition } from "../src/import/importer.js";
import { findShrinkingPlayByPlayRefreshUrls } from "../src/operations/runner.js";
import type { FetchMetadata, FetchResource } from "../src/fetch/fetcher.js";
import type { BoxScoreRecord, BoxScoreStats, ParsedCompetitionData } from "../src/domain/types.js";
import type { PlayByPlayEventRecord } from "../src/domain/types.js";
import { validateBoxScore } from "../src/domain/validation.js";
import { parseBoxScoreHtml } from "../src/parsers/boxscore.js";
import { parseFixturesHtml } from "../src/parsers/fixtures.js";
import { parsePlayersHtml } from "../src/parsers/players.js";
import { parseStandingsGroupLinksHtml, parseStandingsHtml } from "../src/parsers/standings.js";
import { parseSummaryHtml } from "../src/parsers/summary.js";
import { parseTeamsHtml } from "../src/parsers/teams.js";
import { parsePlayByPlayHtml } from "../src/parsers/play-by-play.js";
import { parseShotChartHtml } from "../src/parsers/shot-chart.js";
import { parseTeamAnalysisHtml, parseTeamStatisticsHtml } from "../src/parsers/official-metrics.js";
import { loadHtmlFixture, loadStage5HtmlFixture } from "./fixtures.js";

const competitionUrl = "https://hosted.dcd.shared.geniussports.com/IBF/en/competition/70001";
const homeTeamId = "81001";
const awayTeamId = "81002";
const homePlayerId = "82001";
const awayPlayerId = "82002";
const gameId = "83001";
const realCompetitionUrl = "https://hosted.dcd.shared.geniussports.com/IBF/en/competition/49607";

function realCompetitionData(): ParsedCompetitionData {
  const rootReport = parseFixturesHtml(loadHtmlFixture("49607-fixtures.html.gz"), realCompetitionUrl);
  const root = rootReport.records[0];
  assert.ok(root);
  const fixture = root.games.find((game) => game.sourceId === "2931666");
  assert.ok(fixture);
  const summary = parseSummaryHtml(
    loadHtmlFixture("49607-2931666-summary.html.gz"),
    `${realCompetitionUrl}/match/2931666/summary`
  ).records[0];
  const boxScore = parseBoxScoreHtml(
    loadHtmlFixture("49607-2931666-boxscore.html.gz"),
    `${realCompetitionUrl}/match/2931666/boxscore`
  ).records[0];
  assert.ok(summary);
  assert.ok(boxScore);
  const groupIndex = parseStandingsGroupLinksHtml(
    loadHtmlFixture("49607-standings-index.html.gz"),
    `${realCompetitionUrl}/standings`
  );
  const groupLink = groupIndex.records.find((group) => group.label === "GROUP A");
  assert.ok(groupLink);
  const group = parseStandingsHtml(loadHtmlFixture("49607-group-a.html.gz"), groupLink.sourceUrl).records[0];
  assert.ok(group);

  return {
    competition: root.competition,
    teams: parseTeamsHtml(loadHtmlFixture("49607-teams.html.gz"), `${realCompetitionUrl}/teams`).records,
    players: parsePlayersHtml(loadHtmlFixture("49607-players.html.gz"), `${realCompetitionUrl}/players`).records,
    groups: [group],
    matches: [{ fixture, summary, boxScore, issues: validateBoxScore(boxScore, summary) }],
    issues: rootReport.issues
  };
}

function realStage5Data(): ParsedCompetitionData {
  const data = realCompetitionData();
  const match = data.matches[0];
  assert.ok(match);
  const gameBaseUrl = `${realCompetitionUrl}/match/2931666`;
  match.playByPlay = parsePlayByPlayHtml(
    loadStage5HtmlFixture("49607-2931666-playbyplay.html.gz"), `${gameBaseUrl}/playbyplay`
  );
  match.shotChart = parseShotChartHtml(
    loadStage5HtmlFixture("49607-2931666-shotchart.html.gz"), `${gameBaseUrl}/shotchart`
  );
  match.officialMetrics = parseTeamAnalysisHtml(
    loadStage5HtmlFixture("49607-2931666-analysis.html.gz"), `${gameBaseUrl}/analysis`
  );
  data.teamOfficialMetrics = parseTeamStatisticsHtml(
    loadStage5HtmlFixture("49607-competition-statistics-team.html.gz"), `${realCompetitionUrl}/statistics/team`
  );
  return data;
}

function realSecondCompetitionStage5Data(): ParsedCompetitionData {
  const baseUrl = "https://hosted.dcd.shared.geniussports.com/IBF/en/competition/49609";
  const competitionPage = parseFixturesHtml(loadHtmlFixture("49609-fixtures.html.gz"), baseUrl).records[0];
  assert.ok(competitionPage);
  const fixture = competitionPage.games.find((game) => game.sourceId === "2915281");
  assert.ok(fixture);
  const matchBaseUrl = `${baseUrl}/match/2915281`;
  const playByPlay = parsePlayByPlayHtml(loadStage5HtmlFixture("49609-2915281-playbyplay.html.gz"), `${matchBaseUrl}/playbyplay`);
  const shotChart = parseShotChartHtml(loadStage5HtmlFixture("49609-2915281-shotchart.html.gz"), `${matchBaseUrl}/shotchart`);
  const officialMetrics = parseTeamAnalysisHtml(loadStage5HtmlFixture("49609-2915281-analysis.html.gz"), `${matchBaseUrl}/analysis`);
  return {
    competition: competitionPage.competition,
    teams: [],
    players: [],
    groups: [],
    teamOfficialMetrics: parseTeamStatisticsHtml(
      loadStage5HtmlFixture("49609-competition-statistics-team.html.gz"), `${baseUrl}/statistics/team`
    ),
    matches: [{
      fixture,
      summary: null,
      boxScore: null,
      playByPlay,
      shotChart,
      officialMetrics,
      issues: [...playByPlay.issues, ...shotChart.issues, ...officialMetrics.issues]
    }],
    issues: []
  };
}

async function applyMigration(client: PGlite, tag: string): Promise<void> {
  const migration = await readFile(new URL(`../../packages/db/drizzle/${tag}.sql`, import.meta.url), "utf8");
  for (const statement of migration.split(/--> statement-breakpoint/g)) {
    if (statement.trim()) await client.exec(statement);
  }
}

async function applyMigrations(client: PGlite): Promise<void> {
  await migrate(drizzle(client), {
    migrationsFolder: fileURLToPath(new URL("../../packages/db/drizzle", import.meta.url)),
    migrationsSchema: "statsarena",
    migrationsTable: "__drizzle_migrations"
  });
}

function stats(points: number): BoxScoreStats {
  return {
    minutesRaw: "40:00",
    minutes: 40,
    fieldGoalsMade: 0,
    fieldGoalsAttempted: 0,
    twoPointsMade: 0,
    twoPointAttempts: 0,
    threePointsMade: 0,
    threePointAttempts: 0,
    freeThrowsMade: 0,
    freeThrowAttempts: 0,
    offensiveRebounds: 0,
    defensiveRebounds: 0,
    rebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    personalFouls: 0,
    points,
    fieldGoalPct: "0.0",
    twoPointPct: "0.0",
    threePointPct: "0.0",
    freeThrowPct: "0.0",
    rawValues: { Pts: String(points) }
  };
}

function boxScore(homePoints: number, awayPoints: number): BoxScoreRecord {
  const sourceUrl = `${competitionUrl}/match/${gameId}/boxscore`;
  return {
    gameSourceId: gameId,
    sourceUrl,
    teams: [
      { ...stats(homePoints), teamSourceId: homeTeamId, teamName: "Home Club", sourceUrl },
      { ...stats(awayPoints), teamSourceId: awayTeamId, teamName: "Away Club", sourceUrl }
    ],
    players: [
      {
        ...stats(homePoints),
        playerSourceId: homePlayerId,
        playerName: "Home Player",
        teamSourceId: homeTeamId,
        jerseyNumber: "4",
        sourceUrl: `${competitionUrl}/person/${homePlayerId}`
      },
      {
        ...stats(awayPoints),
        playerSourceId: awayPlayerId,
        playerName: "Away Player",
        teamSourceId: awayTeamId,
        jerseyNumber: "5",
        sourceUrl: `${competitionUrl}/person/${awayPlayerId}`
      }
    ]
  };
}

function sampleData(options: { name?: string; homeScore?: number; homePoints?: number; awayPoints?: number; includeBoxScore?: boolean } = {}): ParsedCompetitionData {
  const homeScore = options.homeScore ?? 25;
  const awayScore = options.awayPoints ?? 45;
  const summaryUrl = `${competitionUrl}/match/${gameId}/summary`;
  const fixture = {
    sourceId: gameId,
    sourceUrl: competitionUrl,
    homeTeamSourceId: homeTeamId,
    awayTeamSourceId: awayTeamId,
    homeTeamName: "Home Club",
    awayTeamName: "Away Club",
    homeScore,
    awayScore,
    scheduledAtRaw: "Oct 6, 2026, 10:00 AM",
    venue: "Arena",
    status: "complete" as const
  };
  return {
    competition: {
      sourceId: "70001",
      sourceUrl: competitionUrl,
      name: options.name ?? "Import Test Cup",
      season: null,
      year: 2026
    },
    teams: [
      { sourceId: homeTeamId, sourceUrl: `${competitionUrl}/team/${homeTeamId}`, name: "Home Club", logoUrl: null },
      { sourceId: awayTeamId, sourceUrl: `${competitionUrl}/team/${awayTeamId}`, name: "Away Club", logoUrl: null }
    ],
    players: [
      { sourceId: homePlayerId, sourceUrl: `${competitionUrl}/person/${homePlayerId}`, name: "Home Player" },
      { sourceId: awayPlayerId, sourceUrl: `${competitionUrl}/person/${awayPlayerId}`, name: "Away Player" }
    ],
    groups: [],
    matches: [{
      fixture,
      summary: {
        ...fixture,
        sourceUrl: summaryUrl,
        summaryText: null
      },
      boxScore: options.includeBoxScore === false ? null : boxScore(options.homePoints ?? homeScore, awayScore),
      issues: []
    }],
    issues: []
  };
}

async function count(client: PGlite, table: string): Promise<number> {
  const result = await client.query<{ count: number }>(`select count(*)::int as count from statsarena.${table}`);
  return result.rows[0]?.count ?? 0;
}

function successfulFetch(requestUrl: string, resource: FetchResource, hash = "a".repeat(64)): FetchMetadata {
  return { requestUrl, finalUrl: requestUrl, resource, sha256: hash, fetchStatus: "succeeded", parseStatus: "parsed",
    httpStatus: 200, requestedAt: "2026-10-12T00:00:00Z", fetchedAt: "2026-10-10T00:00:00Z",
    sourceFetchedAt: "2026-10-10T00:00:00Z", durationMs: 0, responseBytes: 100, snapshotPath: `${hash}.html.gz`,
    snapshotChanged: false, attempts: [], error: null, fromSnapshot: true, retrievalMode: "cache" };
}

test("unchanged Neon imports reuse one full baseline, preserve timestamps/provenance, and skip identical registries/standings", async () => {
  const client = new PGlite();
  try {
    await applyMigrations(client);
    const db = drizzle(client, { schema: (await import("@statsarena/db/schema")).schema }) as unknown as StatsArenaDatabase;
    const data = realStage5Data();
    const fetches = [successfulFetch(`${realCompetitionUrl}/match/2931666/boxscore`, "boxscore"),
      successfulFetch(`${realCompetitionUrl}/match/2931666/playbyplay`, "playbyplay"),
      successfulFetch(data.groups[0]!.group.sourceUrl, "standings")];
    const first = await importCompetition(db, data, fetches);
    assert.equal(first.status, "succeeded");
    const tables = ["competitions", "teams", "players", "competition_teams", "competition_players", "competition_groups",
      "group_standings", "games", "player_game_stats", "team_game_stats", "play_by_play_events", "shots", "team_official_metrics", "source_fetches", "validation_issues"];
    const before = await Promise.all(tables.map(async table => (await client.query(`select * from statsarena.${table} order by id`)).rows));
    const cached = fetches.map(entry => ({ ...entry, requestedAt: "2026-10-12T01:00:00Z", durationMs: 5 }));
    const second = await importCompetition(db, data, cached);
    assert.equal(second.counts["auditSummaryRuns"], 1);
    assert.equal(second.counts["sourceFetchesWritten"], 0);
    assert.equal(second.counts["reusedSourceFetches"], 3);
    assert.equal(second.counts["metadataWrites"], 0);
    assert.equal(second.counts["standingsWritten"], 0);
    assert.deepEqual(await Promise.all(tables.map(async table => (await client.query(`select * from statsarena.${table} order by id`)).rows)), before);
    const summary = (await client.query<{ audit_kind: string; baseline_import_run_id: string; latest_source_fetched_at: Date; latest_requested_at: Date }>(
      "select audit_kind,baseline_import_run_id,latest_source_fetched_at,latest_requested_at from statsarena.import_runs where id=$1", [second.importRunId])).rows[0];
    assert.equal(summary?.audit_kind, "summary");
    assert.equal(summary?.baseline_import_run_id, first.importRunId);
    assert.equal(summary?.latest_requested_at.toISOString(), "2026-10-12T01:00:00.000Z");
    assert.equal(summary?.latest_source_fetched_at.toISOString(), "2026-10-10T00:00:00.000Z");
    const third = await importCompetition(db, data, cached);
    assert.equal(third.counts["auditSummaryRuns"], 1);
    assert.equal((await client.query<{ baseline_import_run_id: string }>("select baseline_import_run_id from statsarena.import_runs where id=$1", [third.importRunId])).rows[0]?.baseline_import_run_id, first.importRunId);
    await assert.rejects(client.query("delete from statsarena.import_runs where id=$1", [first.importRunId]), /foreign key/);
    await client.exec("update statsarena.competitions set last_seen_at='2020-01-01'; update statsarena.competition_teams set last_seen_at='2020-01-01'; update statsarena.competition_players set last_seen_at='2020-01-01'");
    const daily = await importCompetition(db, data, cached);
    assert.equal(daily.counts["auditSummaryRuns"], 1);
    assert.ok((daily.counts["observationWrites"] ?? 0) > 0);
    assert.equal((await importCompetition(db, data, cached)).counts["observationWrites"], 0);

    const renamed = structuredClone(data);
    const roster = new Set(renamed.matches[0]?.boxScore?.players.map(player => player.playerSourceId));
    const player = renamed.players.find(player => !roster.has(player.sourceId)); assert.ok(player);
    player.name += " Corrected";
    const changed = await importCompetition(db, renamed, cached);
    assert.equal(changed.counts["auditSummaryRuns"], 0);
    assert.equal(changed.counts["metadataWrites"], 1);
    assert.equal(changed.counts["standingsWritten"], 0);
    assert.deepEqual((await client.query("select * from statsarena.group_standings order by id")).rows, before[tables.indexOf("group_standings")]);
    const ranking = structuredClone(renamed); const standing = ranking.groups[0]?.rows[0]; assert.ok(standing);
    standing.standingPoints = (standing.standingPoints ?? 0) + 1;
    const corrected = await importCompetition(db, ranking, cached);
    assert.equal(corrected.counts["standingsWritten"], 3);
    assert.equal(corrected.counts["metadataWrites"], 0);
    const htmlChanged = cached.map(entry => ({ ...entry, sha256: "b".repeat(64) }));
    assert.equal((await importCompetition(db, ranking, htmlChanged)).counts["auditSummaryRuns"], 0);
    assert.equal((await importCompetition(db, ranking, htmlChanged, "sync", undefined, { forceFullAudit: true })).counts["auditSummaryRuns"], 0);
  } finally { await client.close(); }
});

test("audit summary never suppresses partial input, retry diagnostics, parser upgrades, rollback, or restoring an earlier value", async () => {
  const client = new PGlite();
  try {
    await applyMigrations(client);
    const db = drizzle(client, { schema: (await import("@statsarena/db/schema")).schema }) as unknown as StatsArenaDatabase;
    const data = sampleData(); const fetches = [successfulFetch(`${competitionUrl}/match/${gameId}/boxscore`, "boxscore")];
    await importCompetition(db, data, fetches);
    const changed = sampleData({ name: "Changed Cup" });
    await importCompetition(db, changed, fetches);
    assert.equal((await importCompetition(db, data, fetches)).counts["auditSummaryRuns"], 0);
    const invalid = [{ ...fetches[0]!, parseStatus: "partial" as const }];
    const partial = await importCompetition(db, data, invalid);
    assert.equal(partial.counts["auditSummaryRuns"], 0);
    const retry = [{ ...fetches[0]!, attempts: [{ attempt: 1, requestedAt: fetches[0]!.requestedAt, finishedAt: fetches[0]!.requestedAt,
      finalUrl: null, httpStatus: 503, durationMs: 20, responseBytes: null, sha256: null, error: "Temporary error" }] }];
    const retried = await importCompetition(db, data, retry);
    assert.equal(retried.counts["auditSummaryRuns"], 0);
    await client.query("update statsarena.import_runs set parser_version='old-parser' where id=$1", [retried.importRunId]);
    assert.equal((await importCompetition(db, data, fetches)).counts["auditSummaryRuns"], 0);
    let guards = 0;
    await assert.rejects(importCompetition(db, data, fetches, "sync", async () => {
      if (++guards === 2) throw new Error("Summary transaction failed");
    }), /Summary transaction failed/);
    const restored = await importCompetition(db, data, fetches);
    assert.equal(restored.counts["auditSummaryRuns"], 0);
    assert.equal(restored.status, "succeeded");
    assert.equal((await importCompetition(db, data, fetches)).counts["auditSummaryRuns"], 1);
  } finally { await client.close(); }
});

test("shared teams and players retain stable global URLs and exact competition membership URLs", async () => {
  const client = new PGlite();
  try {
    await applyMigrations(client);
    const db = drizzle(client, { schema: (await import("@statsarena/db/schema")).schema }) as unknown as StatsArenaDatabase;
    const first = sampleData(); first.matches = [];
    await importCompetition(db, first, []);
    const before = (await client.query("select id,source_url,updated_at from statsarena.teams order by id")).rows;
    const playerBefore = (await client.query("select id,source_url,updated_at from statsarena.players order by id")).rows;
    const second = structuredClone(first);
    second.competition.sourceId = "70002";
    second.competition.sourceUrl = competitionUrl.replace("70001", "70002");
    for (const team of second.teams) team.sourceUrl = team.sourceUrl.replace("70001", "70002");
    for (const player of second.players) player.sourceUrl = player.sourceUrl.replace("70001", "70002");
    const imported = await importCompetition(db, second, []);
    assert.equal(imported.counts["metadataWrites"], 0);
    assert.deepEqual((await client.query("select id,source_url,updated_at from statsarena.teams order by id")).rows, before);
    assert.deepEqual((await client.query("select id,source_url,updated_at from statsarena.players order by id")).rows, playerBefore);
    const memberships = await client.query<{ source_url: string }>("select source_url from statsarena.competition_teams where competition_id=$1", [imported.competitionId]);
    assert.ok(memberships.rows.every(row => row.source_url.includes("/competition/70002/")));
  } finally { await client.close(); }
});

test("importer writes real 49607 identities, standings, and box score idempotently", async () => {
  const client = new PGlite();
  try {
    await applyMigrations(client);
    await applyMigrations(client);
    assert.equal(await count(client, "__drizzle_migrations"), 9);
    const pgliteDb = drizzle(client, { schema: (await import("@statsarena/db/schema")).schema });
    const db = pgliteDb as unknown as StatsArenaDatabase;
    const data = realCompetitionData();
    const sampleGameId = data.matches[0]?.fixture.sourceId;
    assert.equal(sampleGameId, "2931666");

    await importCompetition(db, data, [], "sync");
    await importCompetition(db, data, [], "sync");
    assert.equal(await count(client, "competitions"), 1);
    assert.equal(await count(client, "teams"), 27);
    assert.equal(await count(client, "players"), 322);
    assert.equal(await count(client, "competition_teams"), 27);
    assert.equal(await count(client, "competition_players"), 322);
    assert.equal(await count(client, "competition_groups"), 1);
    assert.equal(await count(client, "group_standings"), 3);
    assert.equal(await count(client, "games"), 1);
    assert.equal(await count(client, "team_game_stats"), 2);
    assert.equal(await count(client, "player_game_stats"), 24);
    assert.equal(await count(client, "team_rosters"), 24);

    const playerMembership = await client.query<{ total: number; rostered: number }>(
      `select (select count(*)::int from statsarena.competition_players) as total, (select count(*)::int from statsarena.team_rosters) as rostered`
    );
    assert.deepEqual(playerMembership.rows[0], { total: 322, rostered: 24 });
  } finally {
    await client.close();
  }
});

test("Stage 5 detail imports are idempotent, replace corrected data, preserve partial pages, and roll back together", async () => {
  const client = new PGlite();
  try {
    await applyMigrations(client);
    const db = drizzle(client, { schema: (await import("@statsarena/db/schema")).schema }) as unknown as StatsArenaDatabase;
    const data = realStage5Data();
    const first = await importCompetition(db, data, [], "sync");
    assert.deepEqual(first.failedGames, [], JSON.stringify(first.issues));
    assert.equal(first.counts["playByPlayEvents"], 548);
    assert.equal(first.counts["shots"], 81);
    assert.equal(first.counts["gameOfficialMetrics"], 10);
    assert.equal(first.counts["competitionOfficialMetrics"], 54);
    assert.equal(await count(client, "play_by_play_events"), 548);
    assert.equal(await count(client, "shots"), 81);
    assert.equal(await count(client, "team_official_metrics"), 64);

    const repeated = await importCompetition(db, data, [], "sync");
    assert.equal(repeated.counts["playByPlayEvents"], 0);
    assert.equal(repeated.counts["shots"], 0);
    assert.equal(repeated.counts["gameOfficialMetrics"], 0);
    assert.equal(repeated.counts["competitionOfficialMetrics"], 0);
    assert.equal(repeated.counts["unchangedPlayByPlayGames"], 1);
    assert.equal(repeated.counts["unchangedShotCharts"], 1);
    assert.equal(await count(client, "play_by_play_events"), 548);
    assert.equal(await count(client, "shots"), 81);
    assert.equal(await count(client, "team_official_metrics"), 64);

    const corrected = structuredClone(data);
    const correctedEvent = corrected.matches[0]?.playByPlay?.records[3];
    assert.ok(correctedEvent);
    correctedEvent.actionText = "Official source correction";
    const correctionImport = await importCompetition(db, corrected, [], "sync");
    assert.equal(correctionImport.counts["playByPlayEvents"], 548);
    const currentEvent = await client.query<{ action_text: string }>(
      "select action_text from statsarena.play_by_play_events where game_id = (select id from statsarena.games where source_game_id = '2931666') and source_sequence = 3"
    );
    assert.equal(currentEvent.rows[0]?.action_text, "Official source correction");

    const partial = structuredClone(corrected);
    const partialReport = partial.matches[0]?.playByPlay;
    assert.ok(partialReport);
    partialReport.status = "partial";
    partialReport.records = [];
    await importCompetition(db, partial, [], "sync");
    assert.equal(await count(client, "play_by_play_events"), 548);
    const afterPartial = await client.query<{ action_text: string }>(
      "select action_text from statsarena.play_by_play_events where game_id = (select id from statsarena.games where source_game_id = '2931666') and source_sequence = 3"
    );
    assert.equal(afterPartial.rows[0]?.action_text, "Official source correction");

    const invalid = structuredClone(corrected);
    const invalidEvent = invalid.matches[0]?.playByPlay?.records[3];
    const invalidShot = invalid.matches[0]?.shotChart?.records[0];
    assert.ok(invalidEvent && invalidShot);
    invalidEvent.actionText = "Must roll back";
    invalidShot.xPercent = 101;
    const rollback = await importCompetition(db, invalid, [], "sync");
    assert.deepEqual(rollback.failedGames, ["2931666"]);
    assert.equal(await count(client, "play_by_play_events"), 548);
    assert.equal(await count(client, "shots"), 81);
    const afterRollback = await client.query<{ action_text: string }>(
      "select action_text from statsarena.play_by_play_events where game_id = (select id from statsarena.games where source_game_id = '2931666') and source_sequence = 3"
    );
    assert.equal(afterRollback.rows[0]?.action_text, "Official source correction");
  } finally {
    await client.close();
  }
});

test("Stage 5 HTML data loss preserves stored datasets and reports partial fetches, including legacy audit input", async () => {
  const client = new PGlite();
  try {
    await applyMigrations(client);
    const db = drizzle(client, { schema: (await import("@statsarena/db/schema")).schema }) as unknown as StatsArenaDatabase;
    const data = realStage5Data();
    await importCompetition(db, data, [], "sync");
    const storedDetails = () => client.query("select 'pbp' as kind, id, updated_at from statsarena.play_by_play_events union all select 'shot', id, updated_at from statsarena.shots union all select 'metric', id, updated_at from statsarena.team_official_metrics order by kind,id");
    const before = (await storedDetails()).rows;
    const missing = structuredClone(data);
    const match = missing.matches[0];
    assert.ok(match);
    const base = `${realCompetitionUrl}/match/2931666`;
    const pbp = load(loadStage5HtmlFixture("49607-2931666-playbyplay.html.gz"));
    pbp("#playbyplay .pbpa").eq(10).remove();
    match.playByPlay = parsePlayByPlayHtml(pbp.html(), `${base}/playbyplay`);
    assert.equal(match.playByPlay.status, "parsed");
    const chart = load(loadStage5HtmlFixture("49607-2931666-shotchart.html.gz"));
    chart("#shotchart .sc_img[title*='2pt']").first().remove();
    match.shotChart = parseShotChartHtml(chart.html(), `${base}/shotchart`);
    assert.equal(match.shotChart.status, "parsed");
    const analysis = load(loadStage5HtmlFixture("49607-2931666-analysis.html.gz"));
    const table = analysis("table.tableClass").first();
    const column = table.find("thead th").toArray().findIndex((node) => analysis(node).text().trim() === "2CP");
    table.find("tbody tr").last().find("th,td").slice(column).remove();
    match.officialMetrics = parseTeamAnalysisHtml(analysis.html(), `${base}/analysis`);
    match.issues.push(...match.officialMetrics.issues);
    const aggregate = load(loadStage5HtmlFixture("49607-competition-statistics-team.html.gz"));
    aggregate("table.tableClass").first().find("tbody tr").first().remove();
    missing.teamOfficialMetrics = parseTeamStatisticsHtml(aggregate.html(), `${realCompetitionUrl}/statistics/team`);
    assert.equal(missing.teamOfficialMetrics.status, "parsed");
    const fetch = (requestUrl: string, resource: FetchResource): FetchMetadata => ({
      requestUrl, finalUrl: requestUrl, resource, fetchStatus: "succeeded", parseStatus: resource === "analysis" ? "partial" : "parsed",
      httpStatus: 200, requestedAt: "2026-10-08T04:00:00Z", fetchedAt: "2026-10-08T04:00:00Z",
      durationMs: 0, responseBytes: null, sha256: null, snapshotPath: null, snapshotChanged: true,
      attempts: [], error: null, fromSnapshot: true
    });
    const result = await importCompetition(db, missing, [
      fetch(`${base}/playbyplay`, "playbyplay"), fetch(`${base}/shotchart`, "shotchart"),
      fetch(`${base}/analysis`, "analysis"), fetch(`${realCompetitionUrl}/statistics/team`, "team_statistics")
    ], "sync");
    assert.deepEqual(result.failedGames, []);
    assert.equal(result.status, "partial");
    assert.equal(result.counts["preservedDetailDatasets"], 4);
    for (const key of ["playByPlayEvents", "shots", "gameOfficialMetrics", "competitionOfficialMetrics"]) assert.equal(result.counts[key], 0);
    for (const code of ["PBP_EVENTS_SHRANK", "SHOT_FGA_MISMATCH", "TEAM_ANALYSIS_ROW_INCOMPLETE", "OFFICIAL_METRIC_SET_INCOMPLETE"]) assert.ok(result.issues.some((entry) => entry.code === code), code);
    assert.deepEqual((await storedDetails()).rows, before);
    const statuses = await client.query<{ parse_status: string }>("select parse_status from statsarena.source_fetches where import_run_id=$1", [result.importRunId]);
    assert.equal(statuses.rows.length, 4);
    assert.ok(statuses.rows.every((row) => row.parse_status === "partial"));

    const legacy = structuredClone(data);
    for (const records of [legacy.matches[0]?.officialMetrics?.records, legacy.teamOfficialMetrics?.records]) {
      const metric = records?.find((entry) => entry.metricCode === (records === legacy.teamOfficialMetrics?.records ? "BP" : "2CP"));
      assert.ok(metric);
      metric.value = null; metric.availability = "unavailable"; metric.rawValue = null;
    }
    const legacyResult = await importCompetition(db, legacy, [], "sync");
    assert.equal(legacyResult.counts["preservedDetailDatasets"], 2);
    assert.ok(legacyResult.issues.some((entry) => entry.code === "OFFICIAL_METRIC_VALUE_INVALID"));
    assert.deepEqual((await storedDetails()).rows, before);

    const explicit = structuredClone(data);
    const metric = explicit.matches[0]?.officialMetrics?.records.find((entry) => entry.metricCode === "2CP");
    assert.ok(metric);
    metric.value = null; metric.availability = "unavailable"; metric.rawValue = "—";
    const withdrawn = await importCompetition(db, explicit, [], "sync");
    assert.equal(withdrawn.counts["gameOfficialMetrics"], 10);
    assert.equal(withdrawn.counts["preservedDetailDatasets"], 0);
  } finally { await client.close(); }
});

test("shot count corrections require matching official totals and failed box score fetches use saved totals", async () => {
  const client = new PGlite();
  try {
    await applyMigrations(client);
    const db = drizzle(client, { schema: (await import("@statsarena/db/schema")).schema }) as unknown as StatsArenaDatabase;
    const data = realStage5Data();
    await importCompetition(db, data, [], "sync");
    const corrected = structuredClone(data);
    const match = corrected.matches[0];
    assert.ok(match?.shotChart && match.boxScore);
    const shot = match.shotChart.records.find((entry) => entry.shotType === "2pt" && entry.result === "missed");
    assert.ok(shot);
    match.shotChart.records = match.shotChart.records.filter((entry) => entry.sourceSequence !== shot.sourceSequence);
    const team = match.boxScore.teams.find((entry) => entry.teamSourceId === shot.teamSourceId);
    const player = match.boxScore.players.find((entry) => entry.playerSourceId === shot.playerSourceId);
    assert.ok(team && player);
    for (const stats of [team, player]) {
      assert.ok(stats.fieldGoalsAttempted !== null && stats.twoPointAttempts !== null);
      stats.fieldGoalsAttempted -= 1; stats.twoPointAttempts -= 1;
    }
    const result = await importCompetition(db, corrected, [], "sync");
    assert.deepEqual(result.failedGames, []);
    assert.equal(result.counts["shots"], 80);
    assert.equal(result.counts["preservedDetailDatasets"], 0);
    assert.equal(await count(client, "shots"), 80);
    const repeated = await importCompetition(db, corrected, [], "sync");
    assert.equal(repeated.counts["shots"], 0);
    assert.equal(repeated.counts["unchangedShotCharts"], 1);
    const failedBox = structuredClone(corrected);
    const failedMatch = failedBox.matches[0];
    assert.ok(failedMatch?.shotChart);
    failedMatch.boxScore = null;
    failedMatch.shotChart.records.pop();
    const preserved = await importCompetition(db, failedBox, [], "sync");
    assert.equal(preserved.counts["shots"], 0);
    assert.ok(preserved.issues.some((entry) => entry.code === "SHOT_FGA_MISMATCH"));
    assert.equal(await count(client, "shots"), 80);
  } finally { await client.close(); }
});

test("Stage 5 details import for 49609 without borrowing 49607 identities or aggregate scope", async () => {
  const client = new PGlite();
  try {
    await applyMigrations(client);
    const db = drizzle(client, { schema: (await import("@statsarena/db/schema")).schema }) as unknown as StatsArenaDatabase;
    const data = realSecondCompetitionStage5Data();
    const first = await importCompetition(db, data, [], "sync");
    assert.deepEqual(first.failedGames, [], JSON.stringify(first.issues));
    assert.equal(first.counts["playByPlayEvents"], 466);
    assert.equal(first.counts["shots"], 57);
    assert.equal(first.counts["gameOfficialMetrics"], 10);
    assert.equal(first.counts["competitionOfficialMetrics"], 36);
    assert.equal(await count(client, "play_by_play_events"), 466);
    assert.equal(await count(client, "shots"), 57);
    assert.equal(await count(client, "team_official_metrics"), 46);
    assert.equal(await count(client, "competitions"), 1);
    const replay = await importCompetition(db, data, [], "sync");
    assert.equal(replay.counts["playByPlayEvents"], 0);
    assert.equal(replay.counts["shots"], 0);
    assert.equal(replay.counts["gameOfficialMetrics"], 0);
    assert.equal(replay.counts["competitionOfficialMetrics"], 0);
    assert.equal(replay.counts["unchangedPlayByPlayGames"], 1);
    assert.equal(replay.counts["unchangedShotCharts"], 1);
    assert.equal(await count(client, "play_by_play_events"), 466);
    assert.equal(await count(client, "shots"), 57);
    assert.equal(await count(client, "team_official_metrics"), 46);
    const shorter = structuredClone(data);
    const chart = shorter.matches[0]?.shotChart;
    assert.ok(chart);
    chart.records.pop();
    const preserved = await importCompetition(db, shorter, [], "sync");
    assert.equal(preserved.counts["shots"], 0);
    assert.ok(preserved.issues.some((entry) => entry.code === "SHOT_DATASET_SHRANK"));
    assert.equal(await count(client, "shots"), 57);
  } finally {
    await client.close();
  }
});

test("importer upserts, preserves valid stats, and rolls back a failed game transaction", async () => {
  const client = new PGlite();
  try {
    await applyMigrations(client);
    const pgliteDb = drizzle(client, { schema: (await import("@statsarena/db/schema")).schema });
    // PGlite and Neon both execute PostgreSQL; this test-only adapter exercises the production importer against an in-memory PostgreSQL engine.
    const db = pgliteDb as unknown as StatsArenaDatabase;

    await importCompetition(db, sampleData(), [], "sync");
    await importCompetition(db, sampleData(), [], "sync");
    assert.equal(await count(client, "competitions"), 1);
    assert.equal(await count(client, "teams"), 2);
    assert.equal(await count(client, "players"), 2);
    assert.equal(await count(client, "games"), 1);
    assert.equal(await count(client, "team_game_stats"), 2);
    assert.equal(await count(client, "player_game_stats"), 2);
    assert.equal(await count(client, "team_rosters"), 2);

    await importCompetition(db, sampleData({ name: "Import Test Cup Updated", homeScore: 26, homePoints: 26 }), [], "sync");
    const updatedGame = await client.query<{ home_score: number; name: string }>(
      `select g.home_score, c.name from statsarena.games g join statsarena.competitions c on c.id = g.competition_id where g.source_game_id = $1`,
      [gameId]
    );
    assert.deepEqual(updatedGame.rows[0], { home_score: 26, name: "Import Test Cup Updated" });

    await importCompetition(db, sampleData({ homeScore: 27, includeBoxScore: false }), [], "sync");
    const preservedStats = await client.query<{ points: number }>(
      `select points from statsarena.team_game_stats t join statsarena.games g on g.id = t.game_id where g.source_game_id = $1 and t.team_id = (select id from statsarena.teams where source_team_id = $2)`,
      [gameId, homeTeamId]
    );
    assert.equal(preservedStats.rows[0]?.points, 26);

    const badWrite = await importCompetition(db, sampleData({ homeScore: 28, homePoints: 28, awayPoints: -1 }), [], "sync");
    assert.deepEqual(badWrite.failedGames, [gameId]);
    assert.equal(badWrite.counts["playerGameStats"], 0);
    assert.equal(badWrite.counts["teamGameStats"], 0);
    const afterRollback = await client.query<{ home_score: number; points: number }>(
      `select g.home_score, t.points from statsarena.games g join statsarena.team_game_stats t on t.game_id = g.id join statsarena.teams tm on tm.id = t.team_id where g.source_game_id = $1 and tm.source_team_id = $2`,
      [gameId, homeTeamId]
    );
    assert.deepEqual(afterRollback.rows[0], { home_score: 27, points: 26 });
    assert.equal(await count(client, "team_game_stats"), 2);
  } finally {
    await client.close();
  }
});

test("importer preserves every saved player stat when a new HTML snapshot loses rows or columns", async () => {
  const client = new PGlite();
  try {
    await applyMigrations(client);
    const db = drizzle(client) as unknown as StatsArenaDatabase;
    const original = realCompetitionData();
    const initial = await importCompetition(db, original, []);
    assert.deepEqual(initial.failedGames, []);
    const savedStats = async () => (await client.query(
      "select id, player_id, points, field_goals_attempted, minutes, minutes_raw from statsarena.player_game_stats order by player_id"
    )).rows;
    const baseline = await savedStats();
    assert.equal(baseline.length, 24);
    for (const mode of ["all-links", "one-link", "header", "cell", "zero-point-row"] as const) {
      const $ = load(loadHtmlFixture("49607-2931666-boxscore.html.gz"));
      const anchors = $("a[href*='/person/']");
      if (mode === "all-links") anchors.each((_, anchor) => { $(anchor).replaceWith($(anchor).text()); });
      if (mode === "one-link") anchors.first().replaceWith(anchors.first().text());
      if (mode === "header") $("th").filter((_, cell) => $(cell).text().trim() === "FGA").text("Unknown");
      if (mode === "cell") anchors.first().closest("tr").find("td").last().remove();
      if (mode === "zero-point-row") anchors.filter((_, anchor) => $(anchor).closest("tr").find("td").eq(3).text().trim() === "0").first().closest("tr").remove();
      const parsed = parseBoxScoreHtml($.html(), `${realCompetitionUrl}/match/2931666/boxscore`);
      const incoming = structuredClone(original);
      const match = incoming.matches[0];
      assert.ok(match);
      // Pass partial records directly to prove importer safety independently of the pipeline filter.
      match.boxScore = parsed.records[0] ?? null;
      match.issues = parsed.issues;
      const result = await importCompetition(db, incoming, []);
      assert.deepEqual(result.failedGames, [], mode);
      assert.equal(result.counts["playerGameStats"], 0, mode);
      assert.equal(result.counts["teamGameStats"], 0, mode);
      assert.ok(result.issues.some((entry) => entry.severity === "error"), mode);
      const run = await client.query<{ status: string }>("select status from statsarena.import_runs where id = $1", [result.importRunId]);
      assert.equal(run.rows[0]?.status, "partial", mode);
      assert.deepEqual(await savedStats(), baseline, mode);
    }
    const precise = original.matches[0]?.boxScore?.players[0];
    assert.ok(precise);
    const duration = await client.query<{ minutes: number; minutes_raw: string }>(
      "select s.minutes, s.minutes_raw from statsarena.player_game_stats s join statsarena.players p on p.id = s.player_id where p.source_player_id = $1", [precise.playerSourceId]
    );
    assert.equal(duration.rows[0]?.minutes_raw, "6:13");
    assert.ok(Math.abs((duration.rows[0]?.minutes ?? 0) - (6 + 13 / 60)) < 1e-12);
  } finally {
    await client.close();
  }
});

test("duration migration recovers seconds from existing raw text and keeps unknown formats", async () => {
  const client = new PGlite();
  try {
    await applyMigration(client, "0000_great_grandmaster");
    // Current importer needs incremental metadata; retain the legacy integer
    // duration columns until the precision migration below is applied.
    await applyMigration(client, "0004_incremental_sync");
    await applyMigration(client, "0005_massive_unicorn");
    await applyMigration(client, "0006_magenta_khan");
    await applyMigration(client, "0007_quiet_polaris");
    const db = drizzle(client) as unknown as StatsArenaDatabase;
    const legacy = sampleData();
    const legacyPlayers = legacy.matches[0]?.boxScore?.players;
    assert.ok(legacyPlayers?.[0]);
    assert.ok(legacyPlayers[1]);
    legacyPlayers[0].minutes = 8;
    legacyPlayers[0].minutesRaw = "8:41";
    legacyPlayers[1].minutes = 40;
    legacyPlayers[1].minutesRaw = "unknown";
    const result = await importCompetition(db, legacy, []);
    assert.deepEqual(result.failedGames, []);
    await applyMigration(client, "0001_precise_minutes");
    const durations = await client.query<{ source_player_id: string; minutes: number }>(
      "select p.source_player_id, s.minutes from statsarena.player_game_stats s join statsarena.players p on p.id = s.player_id order by p.source_player_id"
    );
    assert.equal(durations.rows[0]?.source_player_id, homePlayerId);
    assert.ok(Math.abs((durations.rows[0]?.minutes ?? 0) - (8 + 41 / 60)) < 1e-12);
    assert.equal(durations.rows[1]?.minutes, 40);
    const columns = await client.query<{ data_type: string }>(
      "select data_type from information_schema.columns where table_schema = 'statsarena' and table_name in ('player_game_stats', 'team_game_stats') and column_name = 'minutes'"
    );
    assert.deepEqual(columns.rows.map((row) => row.data_type), ["double precision", "double precision"]);
  } finally {
    await client.close();
  }
});

test("unchanged stats keep their IDs and timestamps, while real changes still replace atomically", async () => {
  const client = new PGlite();
  const queries: string[] = [];
  try {
    await applyMigrations(client);
    const db = drizzle(client, { logger: { logQuery: (query) => { queries.push(query); } } }) as unknown as StatsArenaDatabase;
    const data = sampleData();
    const first = await importCompetition(db, data, []);
    assert.equal(first.counts["playerGameStats"], 2);
    const saved = async () => (await client.query("select id, updated_at, player_id, points, minutes from statsarena.player_game_stats order by player_id")).rows;
    const baseline = await saved();
    queries.length = 0;
    const reordered = structuredClone(data);
    reordered.matches[0]?.boxScore?.players.reverse();
    reordered.matches[0]?.boxScore?.teams.reverse();
    const raw = reordered.matches[0]?.boxScore?.players[0];
    assert.ok(raw);
    raw.rawValues["irrelevant navigation change"] = "ignored";
    const second = await importCompetition(db, reordered, []);
    assert.equal(second.counts["playerGameStats"], 0);
    assert.equal(second.counts["teamGameStats"], 0);
    assert.equal(second.counts["unchangedBoxScores"], 1);
    assert.equal(second.status, "succeeded");
    assert.deepEqual(await saved(), baseline);
    assert.ok(!queries.some((query) => /^(?:delete from|insert into) "statsarena"\."(?:player_game_stats|team_game_stats|team_rosters)"/.test(query)));

    const changed = structuredClone(data);
    const player = changed.matches[0]?.boxScore?.players[0];
    assert.ok(player);
    player.minutesRaw = "39:59";
    player.minutes = 39 + 59 / 60;
    const corrected = await importCompetition(db, changed, []);
    assert.equal(corrected.counts["playerGameStats"], 2);
    assert.equal(corrected.counts["unchangedBoxScores"], 0);
    assert.notDeepEqual(await saved(), baseline);
    const repeat = await importCompetition(db, changed, []);
    assert.equal(repeat.counts["unchangedBoxScores"], 1);
  } finally {
    await client.close();
  }
});

test("bulk imports use bounded batches and retain non-registry identities and per-row values", async () => {
  const client = new PGlite();
  const queries: string[] = [];
  try {
    await applyMigrations(client);
    const db = drizzle(client, { logger: { logQuery: (query) => { queries.push(query); } } }) as unknown as StatsArenaDatabase;
    const data = realCompetitionData();
    data.players = []; // Valid match players must be collected even if the registry fetch was unavailable.
    data.players.push(...Array.from({ length: 501 }, (_, index) => ({
      sourceId: String(90000 + index), sourceUrl: `${realCompetitionUrl}/person/${90000 + index}`, name: `Registry Player ${index}`
    })));
    const result = await importCompetition(db, data, []);
    assert.deepEqual(result.failedGames, []);
    assert.equal(result.counts["players"], 525);
    assert.equal(await count(client, "competition_players"), 525);
    assert.equal(await count(client, "player_game_stats"), 24);
    const inserts = queries.filter((query) => query.startsWith('insert into "statsarena"."players"'));
    assert.equal(inserts.length, 3);
    assert.equal(queries.filter((query) => query.startsWith('insert into "statsarena"."player_game_stats"')).length, 1);
    const names = await client.query<{ name: string }>("select name from statsarena.players where source_player_id in ('90000', '90500') order by source_player_id");
    assert.deepEqual(names.rows.map((row) => row.name), ["Registry Player 0", "Registry Player 500"]);
  } finally {
    await client.close();
  }
});

test("scheduled, failed fetch and partial box score are reported independently and preserve valid stats", async () => {
  const client = new PGlite();
  try {
    await applyMigrations(client);
    const db = drizzle(client) as unknown as StatsArenaDatabase;
    const scheduled = sampleData({ includeBoxScore: false });
    const match = scheduled.matches[0];
    assert.ok(match);
    match.fixture.status = "scheduled";
    match.fixture.homeScore = null;
    match.fixture.awayScore = null;
    match.summary = null;
    match.availability = { summary: "scheduled", boxScore: "scheduled" };
    const planned = await importCompetition(db, scheduled, []);
    assert.equal(planned.status, "succeeded");
    assert.equal(planned.counts["scheduledGames"], 1);
    assert.equal(await count(client, "player_game_stats"), 0);
    const played = await importCompetition(db, sampleData(), []);
    assert.equal(played.matchStatuses["ready"], 1);
    const baseline = (await client.query("select id, points from statsarena.player_game_stats order by id")).rows;
    for (const state of ["fetch_failed", "partial", "parse_failed"] as const) {
      const incoming = sampleData({ includeBoxScore: false });
      const current = incoming.matches[0];
      assert.ok(current);
      current.availability = { summary: "available", boxScore: state };
      const result = await importCompetition(db, incoming, []);
      assert.equal(result.status, "partial");
      assert.equal(result.matchStatuses[state === "partial" ? "boxscore_partial" : state], 1);
      assert.equal(result.counts["preservedBoxScores"], 1);
      assert.deepEqual((await client.query("select id, points from statsarena.player_game_stats order by id")).rows, baseline);
    }
    const run = await client.query<{ record_counts: Record<string, number> }>("select record_counts from statsarena.import_runs where id = $1", [planned.importRunId]);
    assert.equal(run.rows[0]?.record_counts["scheduledGames"], 1);
  } finally {
    await client.close();
  }
});

test("cached fetch audit stores original source time and zero network attempts", async () => {
  const client = new PGlite();
  try {
    await applyMigrations(client);
    const db = drizzle(client) as unknown as StatsArenaDatabase;
    const sourceTime = "2026-10-07T00:00:00Z";
    const data = sampleData();
    const run = await importCompetition(db, data, [{
      requestUrl: `${competitionUrl}/match/${gameId}/boxscore`, finalUrl: `${competitionUrl}/match/${gameId}/boxscore`,
      fetchStatus: "succeeded", httpStatus: 200, requestedAt: "2026-10-07T01:00:00Z", fetchedAt: sourceTime,
      durationMs: 0, responseBytes: 1000, sha256: "a".repeat(64), snapshotPath: "snapshot.html.gz",
      snapshotChanged: false, attempts: [], error: null, resource: "boxscore", fromSnapshot: true, parseStatus: "parsed",
      retrievalMode: "cache", sourceFetchedAt: sourceTime, cacheAgeMs: 3_600_000, cacheReason: "validated_within_ttl"
    }]);
    assert.deepEqual(run.failedGames, []);
    const audit = await client.query<{ attempts: number; fetched_at: Date; attempt_log: Array<Record<string, unknown>> }>(
      "select attempts, fetched_at, attempt_log from statsarena.source_fetches where import_run_id=$1", [run.importRunId]
    );
    const row = audit.rows[0];
    assert.ok(row);
    assert.equal(row.attempts, 0);
    assert.equal(new Date(row.fetched_at).toISOString(), new Date(sourceTime).toISOString());
    assert.equal(row.attempt_log[0]?.["mode"], "cache");
    assert.equal(row.attempt_log[0]?.["sourceFetchedAt"], sourceTime);
    assert.equal(row.attempt_log[0]?.["cacheAgeMs"], 3_600_000);
  } finally { await client.close(); }
});

test("scheduled competitions stay active through an empty schedule and game statuses advance without regression", async () => {
  const client = new PGlite();
  try {
    await applyMigrations(client);
    const db = drizzle(client, { schema: (await import("@statsarena/db/schema")).schema }) as unknown as StatsArenaDatabase;
    const empty = sampleData();
    empty.matches = [];
    const discovered = await importCompetition(db, empty, []);
    assert.equal(discovered.counts["games"], 0);
    const active = await client.query<{ is_active: boolean }>("select is_active from statsarena.competitions where source_competition_id=$1", ["70001"]);
    assert.equal(active.rows[0]?.is_active, true);

    const scheduled = sampleData({ includeBoxScore: false });
    const scheduledMatch = scheduled.matches[0];
    assert.ok(scheduledMatch);
    scheduledMatch.fixture.status = "scheduled";
    scheduledMatch.fixture.homeScore = null;
    scheduledMatch.fixture.awayScore = null;
    scheduledMatch.summary = null;
    const first = await importCompetition(db, scheduled, []);
    assert.equal(first.counts["newGames"], 1);
    assert.equal(first.counts["updatedGames"], 0);

    const live = sampleData({ includeBoxScore: false });
    const liveMatch = live.matches[0];
    assert.ok(liveMatch?.summary);
    liveMatch.fixture.status = "live";
    liveMatch.summary.status = "live";
    const started = await importCompetition(db, live, []);
    assert.equal(started.counts["updatedGames"], 1);
    assert.equal((await client.query<{ status: string }>("select status from statsarena.games where source_game_id=$1", [gameId])).rows[0]?.status, "live");

    const complete = await importCompetition(db, sampleData(), []);
    assert.equal(complete.counts["updatedGames"], 1);
    assert.equal((await client.query<{ status: string }>("select status from statsarena.games where source_game_id=$1", [gameId])).rows[0]?.status, "complete");

    const staleSchedule = sampleData({ includeBoxScore: false });
    const staleMatch = staleSchedule.matches[0];
    assert.ok(staleMatch);
    staleMatch.fixture.status = "scheduled";
    staleMatch.fixture.homeScore = null;
    staleMatch.fixture.awayScore = null;
    staleMatch.summary = null;
    const noRegression = await importCompetition(db, staleSchedule, []);
    assert.equal(noRegression.counts["unchangedGames"], 1);
    assert.equal((await client.query<{ status: string }>("select status from statsarena.games where source_game_id=$1", [gameId])).rows[0]?.status, "complete");
  } finally { await client.close(); }
});

test("a suspected PBP reduction selects only its source page for an uncached verification fetch", async () => {
  const client = new PGlite();
  try {
    await applyMigrations(client);
    const db = drizzle(client, { schema: (await import("@statsarena/db/schema")).schema }) as unknown as StatsArenaDatabase;
    const data = sampleData();
    const match = data.matches[0];
    assert.ok(match);
    const sourceUrl = `${competitionUrl}/match/${gameId}/playbyplay`;
    const event = (sourceSequence: number): PlayByPlayEventRecord => ({
      gameSourceId: gameId, sourceSequence, sourceUrl, periodNumber: 1, periodLabelRaw: "Q1",
      periodType: "regulation", timeRaw: "08:00", actionType: "field_goal_made", actionText: "Made shot",
      teamSourceId: homeTeamId, teamSide: "home", playerSourceId: homePlayerId, playerName: "Home Player",
      scoreRaw: "2-0", team1Score: 2, team2Score: 0, rawClasses: []
    });
    match.playByPlay = { status: "parsed", sourceUrl, records: [event(0), event(1)], issues: [] };
    await importCompetition(db, data, []);

    const shorter = structuredClone(data);
    const changedMatch = shorter.matches[0];
    assert.ok(changedMatch?.playByPlay);
    changedMatch.playByPlay.records = changedMatch.playByPlay.records.slice(0, 1);
    const refreshPages = await findShrinkingPlayByPlayRefreshUrls(db, "70001", {
      data: shorter, fetches: [], parseCounts: {}
    });
    assert.deepEqual(refreshPages, [sourceUrl]);

    const confirmed = await importCompetition(db, shorter, []);
    assert.ok(confirmed.issues.some((entry) => entry.code === "PBP_EVENTS_SHRANK"));
    assert.equal(await count(client, "play_by_play_events"), 2);
  } finally { await client.close(); }
});

test("dataset quality persists separately, preserves shots on mismatch, and clears retry metadata on rollback", async () => {
  const client = new PGlite();
  try {
    await applyMigrations(client);
    const tables = await import("@statsarena/db/schema");
    const db = drizzle(client, { schema: tables.schema }) as unknown as StatsArenaDatabase;
    const data = realStage5Data();
    const detailFetches = (["summary", "boxscore", "playbyplay", "shotchart", "analysis"] as const).map((resource) => successfulFetch(`${realCompetitionUrl}/match/2931666/${resource}`, resource));
    const first = await importCompetition(db, data, detailFetches, "sync");
    assert.deepEqual(first.failedGames, []);
    const before = await client.query("select id from statsarena.shots order by id");
    const changed = structuredClone(data);
    assert.ok(changed.matches[0]?.shotChart);
    changed.matches[0].shotChart.records.pop();
    const result = await importCompetition(db, changed, detailFetches, "sync");
    assert.deepEqual(result.failedGames, []);
    const [saved] = await db.select().from(tables.games);
    assert.ok(saved?.detailQuality);
    assert.equal(saved.detailSyncStatus, "partial");
    assert.equal(saved.detailQuality.boxScore.status, "parsed");
    assert.equal(saved.detailQuality.playByPlay.status, "parsed");
    assert.equal(saved.detailQuality.shotChart.status, "partial");
    assert.equal(saved.detailQuality.shotChart.category, "source_inconsistent");
    assert.ok(saved.detailQuality.shotChart.issues.some((issue) => issue.code === "SHOT_FGA_MISMATCH"));
    assert.deepEqual((await client.query("select id from statsarena.shots order by id")).rows, before.rows);
    assert.deepEqual(changed.matches[0].datasetQuality, saved.detailQuality);
    await db.update(tables.games).set({ detailQuality: null });
    assert.deepEqual(await backfillDetailQuality(db, true), { games: 1, updated: 0 });
    assert.equal((await db.select().from(tables.games))[0]?.detailQuality, null);
    assert.deepEqual(await backfillDetailQuality(db, false), { games: 1, updated: 1 });
    const rebuilt = (await db.select().from(tables.games))[0]?.detailQuality;
    assert.equal(rebuilt?.boxScore.status, "parsed");
    assert.equal(rebuilt?.shotChart.category, "source_inconsistent");
    assert.ok(rebuilt?.shotChart.issues.some((entry) => entry.code === "SHOT_FGA_MISMATCH"));
    assert.deepEqual(await backfillDetailQuality(db, false), { games: 0, updated: 0 });
    await db.insert(tables.syncLeases).values({ sourceCompetitionId: "49607", ownerId: "00000000-0000-4000-8000-000000000001", hostname: "test", processId: 1, expiresAt: new Date(Date.now() + 60000) });
    await assert.rejects(backfillDetailQuality(db, false), /Writer aktif/);
    await db.delete(tables.syncLeases);
    // A transaction failure must remain eligible, regardless of the preceding anomaly cooldown.
    const bad = structuredClone(data);
    assert.ok(bad.matches[0]?.boxScore?.players[0]);
    await client.exec("alter table statsarena.player_game_stats add constraint quality_test_minutes_check check (minutes < 100)");
    bad.matches[0].boxScore.players[0].minutes = 1000;
    const rolledBack = await importCompetition(db, bad, [], "sync");
    assert.equal(rolledBack.failedGames.length, 1);
    const [failed] = await db.select().from(tables.games);
    assert.equal(failed?.detailSyncStatus, "failed");
    assert.equal(failed?.detailQuality, null);
    assert.deepEqual((await client.query("select id from statsarena.shots order by id")).rows, before.rows);
  } finally { await client.close(); }
});
