import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BASE_STAT_FIELDS } from "@statsarena/db/analytics";
import { exportAnalysis } from "../src/analytics/export.js";
import { parsedDataHash, writeOperationAudit } from "../src/operations/audit-storage.js";
import type { BoxScoreStats } from "../src/domain/types.js";

function sample(id = "91001", gameId = "92001", second = 1, attempts = 2, namespace = "IBF") {
  const sourceUrl = `https://hosted.dcd.shared.geniussports.com/${namespace}/en/competition/${id}`;
  const fixture = { sourceId: gameId, sourceUrl: `${sourceUrl}/match/${gameId}/summary`, homeTeamSourceId: "1", awayTeamSourceId: "2", homeTeamName: "Home", awayTeamName: "Away", homeScore: 10, awayScore: 10, status: "complete", scheduledAtRaw: "unknown timezone", venue: null };
  const stats: BoxScoreStats = { ...Object.fromEntries(BASE_STAT_FIELDS.map(key => [key, 0])), minutes: 40, minutesRaw: "40:00", points: 2, fieldGoalsMade: 1, fieldGoalsAttempted: attempts,
    twoPointsMade: 1, twoPointAttempts: attempts, threePointsMade: 0, threePointAttempts: 0, freeThrowsMade: 0, freeThrowAttempts: 0, offensiveRebounds: 0,
    defensiveRebounds: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0, personalFouls: 0,
    fieldGoalPct: null, twoPointPct: null, threePointPct: null, freeThrowPct: null, rawValues: {} };
  const players = ["1", "2"].flatMap(team => Array.from({ length: 5 }, (_,i) => ({ ...stats, playerSourceId: `${team}${i}`, playerName: `Player ${team}${i}`, teamSourceId: team, jerseyNumber: String(i), sourceUrl: `${sourceUrl}/person/${team}${i}` })));
  const boxScore = { gameSourceId: gameId, sourceUrl: `${sourceUrl}/match/${gameId}/boxscore`, players,
    teams: ["1", "2"].map(teamSourceId => ({ ...stats, minutes: null, minutesRaw: null, points: 10, fieldGoalsMade: 5, fieldGoalsAttempted: attempts * 5, twoPointsMade: 5, twoPointAttempts: attempts * 5, teamSourceId, teamName: `Team ${teamSourceId}`, sourceUrl: `${sourceUrl}/match/${gameId}/boxscore` })) };
  return { sourceUrl, sourceCompetitionId: id, createdAt: new Date(second * 1000).toISOString(), parserVersion: "test", mode: "once", imported: { status: "succeeded" }, issues: [], fetches: [],
    parseCounts: { fixturesDiscovered: 1, pendingFixturePages: 0 }, fixtureObservations: [fixture],
    data: { competition: { sourceId: id, sourceUrl, name: "Sample", season: null, year: null }, teams: [], players: [], groups: [], matches: [{ fixture, boxScore, availability: { boxScore: "available" }, issues: [] }] } };
}
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "statsarena-analysis-"));
  return { directory, dispose: () => rm(directory, { recursive: true, force: true }) };
}
async function report(path: string) { return JSON.parse(await readFile(path, "utf8")); }

test("export merges incremental games, uses weighted totals, preserves valid input on failure, and excludes corrected incompatible scores", async () => {
  const { directory, dispose } = await setup();
  try {
    const first = sample();
    const exportOne = await exportAnalysis({ input: "91001", auditDirectory: directory, auditPath: join(directory, "first.json"), audit: first });
    assert.equal(exportOne.includedGames, 1);
    let data = await report(exportOne.path);
    assert.equal(data.players[0].advancedStats.trueShootingPercentage, 50);
    assert.equal(data.players[0].advancedStats.assistTurnoverRatio, null);
    assert.equal(data.players[0].unavailableReasons.assistTurnoverRatio, "nonpositive_denominator");
    assert.equal(data.methodology.metricDefinitions.trueShootingPercentage.estimated, true);
    const second = sample("91001", "92002", 2, 8);
    second.fixtureObservations.unshift(first.data.matches[0]!.fixture); second.parseCounts.fixturesDiscovered = 2;
    await exportAnalysis({ input: "91001", auditDirectory: directory, auditPath: join(directory, "second.json"), audit: second });
    data = await report(exportOne.path);
    assert.equal(data.games.length, 2); assert.equal(data.players[0].gamesPlayed, 2);
    assert.equal(data.players[0].advancedStats.trueShootingPercentage, 20);
    assert.deepEqual(data.players[0].gameIds, ["92001", "92002"]);
    assert.equal(data.scope.fixtureCoverageComplete, true);
    assert.equal((await exportAnalysis({ input: "91001", auditDirectory: directory, auditPath: join(directory, "second.json"), audit: second })).changed, false);
    const failed = { ...sample("91001", "92002", 3), data: { ...second.data, matches: [{ fixture: second.data.matches[0]!.fixture, boxScore: null, availability: { boxScore: "fetch_failed" } }] }, fixtureObservations: second.fixtureObservations };
    await exportAnalysis({ input: "91001", auditDirectory: directory, auditPath: join(directory, "failed.json"), audit: failed });
    data = await report(exportOne.path);
    assert.equal(data.games[1].boxScoreStatus, "preserved");
    assert.equal(data.games[1].source.auditCreatedAt, second.createdAt);
    assert.equal(data.players[0].advancedStats.trueShootingPercentage, 20);
    const changed = { ...failed, createdAt: new Date(4000).toISOString(), data: { ...failed.data, matches: [{ ...failed.data.matches[0], fixture: { ...failed.data.matches[0]!.fixture, homeScore: 99 } }] }, fixtureObservations: [first.fixtureObservations[0]!, { ...second.fixtureObservations[1]!, homeScore: 99 }] };
    await exportAnalysis({ input: "91001", auditDirectory: directory, auditPath: join(directory, "changed.json"), audit: { ...changed, data: { ...changed.data, matches: [] } } });
    data = await report(exportOne.path); assert.equal(data.games[1].boxScoreStatus, "unavailable"); assert.equal(data.players[0].gamesPlayed, 1);
    await exportAnalysis({ input: "91001", auditDirectory: directory, auditPath: join(directory, "second.json"), audit: second });
    data = await report(exportOne.path); assert.equal(data.players[0].gamesPlayed, 1); // Older detail cannot undo a newer fixture-only correction.
    const cutOff = sample("91001", "92002", 5, 8);
    cutOff.parseCounts.pendingFixturePages = 1;
    const partial = await exportAnalysis({ input: "91001", auditDirectory: directory, auditPath: join(directory, "cut-off.json"), audit: cutOff });
    assert.equal(partial.fixtureCoverageComplete, false);
    assert.equal(partial.includedGames, 2); // A cut-off fixture crawl must not discard an older valid game.
  } finally { await dispose(); }
});

test("offline resolver follows real summary/delta references with raw payload hashes; missing inputs stay null", async () => {
  const { directory, dispose } = await setup();
  try {
    const first = sample(); const firstPath = join(directory, "full.json");
    first.data.matches[0]!.boxScore.players[0]!.minutes = null;
    first.data.matches[0]!.boxScore.players[0]!.minutesRaw = null;
    await writeOperationAudit(firstPath, first, "auto");
    const next = { ...first, createdAt: new Date(2000).toISOString() };
    const summaryPath = join(directory, "summary.json");
    assert.equal((await writeOperationAudit(summaryPath, next, "auto")).auditType, "summary");
    const sourceBefore = await readFile(firstPath, "utf8");
    const out = await exportAnalysis({ input: "91001", auditDirectory: directory, auditPath: summaryPath });
    const data = await report(out.path);
    assert.equal(data.games.length, 1);
    assert.equal(data.players[0].advancedStats.trueShootingPercentage, 50);
    assert.equal(data.players[0].advancedStats.usagePercentage, null);
    assert.equal(data.players[1].advancedStats.usagePercentage, null);
    assert.equal(await readFile(firstPath, "utf8"), sourceBefore);
    const delta = sample("91001", "92002", 3);
    const deltaPath = join(directory, "delta.json");
    assert.equal((await writeOperationAudit(deltaPath, delta, "auto")).auditType, "delta");
    const extended = await exportAnalysis({ input: "91001", auditDirectory: directory, auditPath: deltaPath });
    assert.equal(extended.games, 2);
  } finally { await dispose(); }
});

test("namespace isolation, reference tampering, traversal, dry-run, and preview never overwrite the current export", async () => {
  const { directory, dispose } = await setup();
  try {
    const first = sample();
    const opts = { input: "91001", auditDirectory: directory, auditPath: join(directory, "first.json"), audit: first };
    const dry = await exportAnalysis({ ...opts, dryRun: true });
    await assert.rejects(readFile(dry.path));
    const current = await exportAnalysis(opts); const before = await readFile(current.path, "utf8");
    const preview = await exportAnalysis({ ...opts, preview: true, audit: sample("91001", "92002", 2) });
    assert.notEqual(preview.path, current.path); assert.equal(await readFile(current.path, "utf8"), before);
    await assert.rejects(exportAnalysis({ ...opts, audit: sample("91001", "92001", 2, 2, "IBL") }), /namespace/);
    const ibl = await exportAnalysis({ ...opts, input: "IBL:91001", audit: sample("91001", "92001", 2, 2, "IBL") });
    assert.notEqual(ibl.path, current.path);
    const traversing = { ...first, data: null, datasetReferences: { "91001:competition": { file: "../elsewhere.json", hash: "a".repeat(64) } } };
    await assert.rejects(exportAnalysis({ ...opts, audit: traversing }), /traversal/);
    await writeFile(join(directory,"source.json"), JSON.stringify(first));
    const corrupt = { ...first, data: null, datasetReferences: { "91001:competition": { file: "source.json", hash: parsedDataHash({ wrong: true }) } } };
    await assert.rejects(exportAnalysis({ ...opts, audit: corrupt }), /Hash/);
    await assert.rejects(exportAnalysis({ ...opts, audit: { ...first, datasetReferences: { "91001:competition": { file: "first.json", hash: parsedDataHash({ wrong: true }) } } } }), /Hash/);
    assert.equal(await readFile(current.path, "utf8"), before);
  } finally { await dispose(); }
});
