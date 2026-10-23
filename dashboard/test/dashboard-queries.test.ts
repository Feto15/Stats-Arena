import { buildDetailQuality } from "@statsarena/db/data-quality";
import { parseCompetitionFilter } from "../lib/competition-scope";
import { getGlobalReview } from "../lib/data/global-review.js";
import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import type { StatsArenaDatabase } from "@statsarena/db";
import {
  competitionGroups,
  competitionPlayers,
  competitionTeams,
  competitions,
  games,
  gameLiveStats,
  groupStandings,
  importRuns,
  officialTeamMetrics,
  playByPlayEvents,
  playerGameStats,
  players,
  shots,
  sourceFetches,
  syncLeases,
  syncRuns,
  teamGameStats,
  teamRosters,
  teams,
  validationIssues,
  schema,
} from "@statsarena/db/schema";
import {
  getCompetitionBySourceId,
  getGameDetail,
  getGamesPage,
  getOverview,
  getOperationalStatus,
  getPlayerSummary,
  getPlayersPage,
  getReviewSummary,
  getStandings,
  getTeamSummary,
  getTeamsPage,
  listCompetitions,
  parseGameListFilters,
  parseGameDetailFilters,
  parsePage,
  parsePlayerListFilters,
  parseReviewFilters,
  parseStandingsFilters,
} from "../lib/data/queries.js";

test("dashboard competition references isolate identical IBF/IBL IDs and expose IBL options", async () => {
  const client = new PGlite();
  try {
    await migrate(drizzle(client), { migrationsFolder: fileURLToPath(new URL("../../packages/db/drizzle", import.meta.url)), migrationsSchema: "statsarena", migrationsTable: "__drizzle_migrations" });
    const db = drizzle(client, { schema }) as unknown as StatsArenaDatabase;
    const entries = await db.insert(competitions).values([
      { source: "genius_sports", sourceCompetitionId: "42041", sourceUrl: "https://hosted.dcd.shared.geniussports.com/IBF/en/competition/42041", name: "IBF" },
      { source: "genius_sports:IBL", sourceCompetitionId: "42041", sourceUrl: "https://hosted.dcd.shared.geniussports.com/IBL/en/competition/42041", name: "IBL" }
    ]).returning();
    assert.deepEqual((await listCompetitions(db)).map((entry) => entry.sourceCompetitionId), ["42041", "IBL:42041"]);
    assert.equal((await getCompetitionBySourceId(db, "42041"))!.id, entries[0]!.id);
    assert.equal((await getCompetitionBySourceId(db, "IBL:42041"))!.id, entries[1]!.id);
    assert.equal(parseCompetitionFilter("IBL:42041").status, "selected");
    assert.equal(parseCompetitionFilter("FAKE:42041").status, "invalid");
    const [team] = await db.insert(teams).values({ source: "genius_sports:IBL", sourceTeamId: "123", name: "IBL team", sourceUrl: "https://hosted.dcd.shared.geniussports.com/IBL/en/team/123" }).returning();
    const [player] = await db.insert(players).values({ source: "genius_sports:IBL", sourcePlayerId: "456", name: "IBL player", sourceUrl: "https://hosted.dcd.shared.geniussports.com/IBL/en/person/456" }).returning();
    await db.insert(competitionTeams).values({ competitionId: entries[1]!.id, teamId: team!.id, sourceUrl: team!.sourceUrl });
    await db.insert(competitionPlayers).values({ competitionId: entries[1]!.id, playerId: player!.id, sourceUrl: player!.sourceUrl });
    const [game] = await db.insert(games).values({ competitionId: entries[1]!.id, source: "genius_sports:IBL", sourceGameId: "789", sourceUrl: "https://hosted.dcd.shared.geniussports.com/IBL/en/competition/42041/match/789/summary", homeTeamId: team!.id, status: "complete" }).returning();
    await db.insert(playerGameStats).values({ gameId: game!.id, teamId: team!.id, playerId: player!.id, points: 2, twoPointsMade: 1, sourceUrl: player!.sourceUrl, statDerivations: { twoPointsMade: { formula: "FGM - 3PM", version: "1", inputs: { FGM: 1, "3PM": 0 } } } });
    const detail = await getGameDetail(db, entries[1]!.id, "789", { teamSourceId: "123", playerSourceId: "456" });
    assert.equal(detail!.playerStats[0]!.statDerivations["twoPointsMade"]!.formula, "FGM - 3PM");
    assert.equal(detail!.liveStats, null);
    await db.insert(gameLiveStats).values({ gameId: game!.id, status: "ready", parserVersion: "test", portalFingerprint: "a".repeat(64),
      sourceUrl: "https://fibalivestats.dcd.shared.geniussports.com/data/789/data.json", pageUrl: "https://fibalivestats.dcd.shared.geniussports.com/u/IBL/789/bs.html",
      lastAttemptAt: new Date(), nextAttemptAt: new Date(), payload: { players: [], teams: [] } });
    assert.equal((await getGameDetail(db, entries[1]!.id, "789"))!.liveStats!.status, "ready");
    assert.ok(await getPlayerSummary(db, entries[1]!.id, "456"));
    assert.equal(await getPlayerSummary(db, entries[0]!.id, "456"), null);
    assert.equal(await getGameDetail(db, entries[0]!.id, "789"), null);
  } finally { await client.close(); }
});

test("Review combines portal history and current LiveStats with scoped filtering, pagination and resolution", async () => {
  const client = new PGlite();
  try {
    await migrate(drizzle(client), { migrationsFolder: fileURLToPath(new URL("../../packages/db/drizzle", import.meta.url)), migrationsSchema: "statsarena", migrationsTable: "__drizzle_migrations" });
    const db = drizzle(client, { schema }) as unknown as StatsArenaDatabase;
    const comps = await db.insert(competitions).values([
      { source: "genius_sports", sourceCompetitionId: "71001", sourceUrl: "https://hosted.dcd.shared.geniussports.com/IBF/en/competition/71001", name: "IBF" },
      { source: "genius_sports:IBL", sourceCompetitionId: "71001", sourceUrl: "https://hosted.dcd.shared.geniussports.com/IBL/en/competition/71001", name: "IBL" }
    ]).returning();
    const [complete, other, empty] = await db.insert(games).values([
      { competitionId: comps[0]!.id, sourceGameId: "72001", sourceUrl: `${comps[0]!.sourceUrl}/match/72001/summary`, status: "complete", homeScore: 25, awayScore: 45 },
      { competitionId: comps[1]!.id, source: "genius_sports:IBL", sourceGameId: "72001", sourceUrl: `${comps[1]!.sourceUrl}/match/72001/summary`, status: "complete" },
      { competitionId: comps[0]!.id, sourceGameId: "72002", sourceUrl: `${comps[0]!.sourceUrl}/match/72002/summary`, status: "complete" }
    ]).returning();
    const [run] = await db.insert(importRuns).values({ competitionId: comps[0]!.id, mode: "sync", status: "succeeded", parserVersion: "test", finishedAt: new Date() }).returning();
    await db.insert(validationIssues).values({ competitionId: comps[0]!.id, gameId: complete!.id, importRunId: run!.id, severity: "warning", code: "SHARED_CODE", message: "Portal history", sourceUrl: complete!.sourceUrl, createdAt: new Date("2026-10-01T00:00:00Z") });
    const values = { parserVersion: "test", portalFingerprint: "a".repeat(64), nextAttemptAt: new Date(), sourceUrl: "https://fibalivestats.dcd.shared.geniussports.com/data/72001/data.json", pageUrl: "https://fibalivestats.dcd.shared.geniussports.com/u/IBF/72001/bs.html" };
    await db.insert(gameLiveStats).values([
      { ...values, gameId: complete!.id, status: "partial", lastAttemptAt: new Date("2026-10-16T01:00:00Z"), issues: [
        { code: "SHARED_CODE", field: "score", message: "Live comparison", expected: 0, actual: 1, evidence: { sha256: "b".repeat(64), fetchedAt: "2026-10-16T01:00:00Z", snapshotPath: "/private/internal-evidence.json.gz" } },
        { code: "LIVESTATS_STARTER_COUNT", field: "starter", message: "Starter differs" }
      ] },
      { ...values, gameId: other!.id, status: "fetch_failed", lastAttemptAt: new Date("2026-10-16T02:00:00Z"), issues: [{ code: "FOREIGN_ERROR", field: "source", message: "Must stay in IBL" }] },
      { ...values, gameId: empty!.id, status: "mismatch", lastAttemptAt: new Date("2026-10-16T03:00:00Z"), issues: [] }
    ]);
    const beforeGames = await db.select().from(games);
    const all = await getReviewSummary(db, comps[0]!.id, { page: 1 }, 2);
    assert.equal(all.totalIssues, 4); assert.deepEqual(all.sourceCounts, { portal: 1, livestats: 3 }); assert.equal(all.liveStatsGames, 2);
    assert.equal(all.issues.total, 4); assert.equal(all.issues.items.length, 2);
    assert.equal(all.issues.items[0]!.code, "LIVESTATS_MISMATCH");
    assert.ok(!all.issueTypes.includes("FOREIGN_ERROR"));
    const second = await getReviewSummary(db, comps[0]!.id, { page: 2 }, 2);
    assert.equal(new Set([...all.issues.items, ...second.issues.items].map(i => i.id)).size, 4);
    const portal = await getReviewSummary(db, comps[0]!.id, { page: 1, source: "portal", code: "SHARED_CODE" });
    assert.equal(portal.issues.total, 1); assert.equal(portal.issues.items[0]!.isLatestRun, true);
    const live = await getReviewSummary(db, comps[0]!.id, { page: 1, source: "livestats", code: "SHARED_CODE", severity: "warning" });
    assert.equal(live.issues.total, 1); const entry = live.issues.items[0]!;
    assert.equal(entry.supplementStatus, "partial"); assert.equal(entry.game!.status, "complete"); assert.equal(entry.game!.sourceGameId, "72001");
    assert.equal(entry.importRun, null); assert.equal(entry.expected, 0); assert.equal(entry.actual, 1); assert.ok(entry.createdAt instanceof Date);
    assert.ok(!JSON.stringify(live).includes("internal-evidence"));
    assert.equal((await getReviewSummary(db, comps[0]!.id, { page: 1, severity: "error" })).issues.total, 0);
    const foreign = await getReviewSummary(db, comps[1]!.id, { page: 1, source: "livestats", severity: "error" });
    assert.equal(foreign.issues.total, 1); assert.equal(foreign.issues.items[0]!.supplementStatus, "fetch_failed");
    assert.deepEqual(parseReviewFilters({ page: "3", source: "livestats", code: "SHARED_CODE" }), { page: 3, source: "livestats", code: "SHARED_CODE" });
    assert.deepEqual(parseReviewFilters({ source: ["portal", "livestats"] }), { page: 1 });
    assert.deepEqual(parseReviewFilters({ source: "arbitrary" }), { page: 1 });
    await db.update(gameLiveStats).set({ status: "ready", issues: [] }).where(eq(gameLiveStats.gameId, complete!.id));
    const resolved = await getReviewSummary(db, comps[0]!.id, { page: 1 });
    assert.equal(resolved.sourceCounts.livestats, 1); assert.equal(resolved.sourceCounts.portal, 1); assert.equal(resolved.liveStatsGames, 1);
    assert.ok(!resolved.issues.items.some(i => i.issueSource === "livestats" && i.game?.id === complete!.id));
    assert.deepEqual(await db.select().from(games), beforeGames);
  } finally { await client.close(); }
});

test("global Review groups current problems by game across competitions and removes resolved observations", async () => {
  const client = new PGlite();
  try {
    await migrate(drizzle(client), { migrationsFolder: fileURLToPath(new URL("../../packages/db/drizzle", import.meta.url)), migrationsSchema: "statsarena", migrationsTable: "__drizzle_migrations" });
    const db = drizzle(client, { schema }) as unknown as StatsArenaDatabase;
    const comps = await db.insert(competitions).values([
      { sourceCompetitionId: "73001", sourceUrl: "https://hosted.dcd.shared.geniussports.com/IBF/en/competition/73001", name: "IBF" },
      { source: "genius_sports:IBL", sourceCompetitionId: "73001", sourceUrl: "https://hosted.dcd.shared.geniussports.com/IBL/en/competition/73001", name: "IBL" }
    ]).returning();
    const issue = { code: "SHOT_FGA_MISMATCH", severity: "error", message: "35 markers versus 36", sourceUrl: `${comps[0]!.sourceUrl}/match/74001/shotchart`, fieldPath: "shots", expected: 36, actual: 35 };
    const clean = buildDetailQuality({ summary: "parsed", boxScore: "parsed", shotChart: "parsed", playByPlay: "parsed", analysis: "unavailable" }, []);
    const partial = buildDetailQuality({ summary: "parsed", boxScore: "parsed", shotChart: "partial", playByPlay: "parsed" }, [issue]);
    const [team] = await db.insert(teams).values({ sourceTeamId: "75001", name: "Known home team", sourceUrl: "https://hosted.dcd.shared.geniussports.com/IBF/en/team/75001" }).returning();
    const gs = await db.insert(games).values([
      { competitionId: comps[0]!.id, sourceGameId: "74001", sourceUrl: `${comps[0]!.sourceUrl}/match/74001/summary`, status: "complete", homeTeamId: team!.id, homeScore: 25, awayScore: 45, detailSyncStatus: "partial", detailQuality: partial },
      { competitionId: comps[1]!.id, source: "genius_sports:IBL", sourceGameId: "74001", sourceUrl: `${comps[1]!.sourceUrl}/match/74001/summary`, status: "complete", detailSyncStatus: "parsed", detailQuality: clean },
      { competitionId: comps[0]!.id, sourceGameId: "74002", sourceUrl: `${comps[0]!.sourceUrl}/match/74002/summary`, status: "scheduled" },
      { competitionId: comps[0]!.id, sourceGameId: "74003", sourceUrl: `${comps[0]!.sourceUrl}/match/74003/summary`, status: "complete", detailSyncStatus: "parsed", detailQuality: clean },
      { competitionId: comps[0]!.id, sourceGameId: "74004", sourceUrl: `${comps[0]!.sourceUrl}/match/74004/summary`, status: "complete", detailSyncStatus: "failed" }
    ]).returning();
    await db.insert(validationIssues).values({ competitionId: comps[0]!.id, gameId: gs[3]!.id, severity: "error", code: "OLD_RESOLVED", message: "Must not be an active problem" });
    const live = { parserVersion: "test", portalFingerprint: "a".repeat(64), lastAttemptAt: new Date(), nextAttemptAt: new Date(), sourceUrl: "https://fibalivestats.dcd.shared.geniussports.com/data/74001/data.json", pageUrl: "https://fibalivestats.dcd.shared.geniussports.com/u/IBF/74001/bs.html" };
    await db.insert(gameLiveStats).values([
      { ...live, gameId: gs[0]!.id, status: "partial", issues: [{ code: "LIVESTATS_PLAYER_MAPPING_MISMATCH", field: "players", message: "Name differs", evidence: { sha256: "b".repeat(64), fetchedAt: new Date().toISOString(), snapshotPath: "/private/hidden-path" } }, { code: "LIVESTATS_STARTER_COUNT", field: "starter", message: "Only four verified" }] },
      { ...live, gameId: gs[1]!.id, status: "mismatch", issues: [] },
      { ...live, gameId: gs[2]!.id, status: "unavailable", issues: [] },
      { ...live, gameId: gs[3]!.id, status: "ready", issues: [] }
    ]);
    const before = await db.select().from(games);
    const all = await getGlobalReview(db, { page: 1 });
    assert.equal(all.totalGames, 3); assert.equal(all.competitions, 2); assert.equal(all.portalGames, 2); assert.equal(all.liveStatsGames, 2);
    assert.equal(all.games.items.find(g => g.id === gs[0]!.id)!.issues.length, 3);
    assert.equal(all.games.items.find(g => g.id === gs[0]!.id)!.homeName, "Known home team");
    assert.equal(all.games.items.find(g => g.id === gs[0]!.id)!.status, "complete");
    assert.equal(all.games.items.find(g => g.id === gs[0]!.id)!.competitionRef, "73001");
    assert.equal(all.games.items.find(g => g.id === gs[1]!.id)!.competitionRef, "IBL:73001");
    assert.ok(!all.issueTypes.includes("OLD_RESOLVED")); assert.ok(!JSON.stringify(all).includes("hidden-path"));
    assert.ok(all.games.items.every(g => g.checkedAt instanceof Date));
    const first = await getGlobalReview(db, { page: 1, source: "livestats" }, 1);
    const second = await getGlobalReview(db, { page: 2, source: "livestats" }, 1);
    assert.equal(first.totalGames, 2); assert.equal(first.portalGames, 0); assert.notEqual(first.games.items[0]!.id, second.games.items[0]!.id);
    assert.ok(first.games.items[0]!.issues.every(i => i.source === "livestats"));
    assert.equal((await getGlobalReview(db, { page: 1, code: "SHOT_FGA_MISMATCH", severity: "error", source: "portal" })).totalGames, 1);
    assert.equal((await getGlobalReview(db, { page: 1, source: "livestats", code: "SHOT_FGA_MISMATCH" })).totalGames, 0);
    assert.deepEqual(await db.select().from(games), before);
    await db.update(gameLiveStats).set({ status: "ready", issues: [] }).where(eq(gameLiveStats.gameId, gs[0]!.id));
    assert.equal((await getGlobalReview(db, { page: 1 })).totalGames, 3); // Portal problem is still active.
    await db.update(games).set({ detailSyncStatus: "parsed", detailQuality: clean }).where(eq(games.id, gs[0]!.id));
    const resolved = await getGlobalReview(db, { page: 1 });
    assert.equal(resolved.totalGames, 2); assert.ok(!resolved.games.items.some(g => g.id === gs[0]!.id));
  } finally { await client.close(); }
});

test("dashboard queries keep scope, aggregates, roster evidence, and review history isolated", async () => {
  const client = new PGlite();
  try {
    await migrate(drizzle(client), {
      migrationsFolder: fileURLToPath(new URL("../../packages/db/drizzle", import.meta.url)),
      migrationsSchema: "statsarena",
      migrationsTable: "__drizzle_migrations",
    });
    const db = drizzle(client, { schema }) as unknown as StatsArenaDatabase;
    const [firstCompetition, secondCompetition] = await db.insert(competitions).values([
      { sourceCompetitionId: "91001", sourceUrl: "https://hosted.dcd.shared.geniussports.com/IBF/en/competition/91001", name: "Sample North", season: "2026" },
      { sourceCompetitionId: "91002", sourceUrl: "https://hosted.dcd.shared.geniussports.com/IBF/en/competition/91002", name: "Sample South", season: "2026" },
    ]).returning();
    assert.ok(firstCompetition && secondCompetition);

    const savedTeams = await db.insert(teams).values([
      { sourceTeamId: "91101", sourceUrl: "https://hosted.dcd.shared.geniussports.com/IBF/en/competition/91002/team/91101", name: "North One" },
      { sourceTeamId: "91102", sourceUrl: "https://hosted.dcd.shared.geniussports.com/IBF/en/team/91102", name: "North Two" },
      { sourceTeamId: "91201", sourceUrl: "https://hosted.dcd.shared.geniussports.com/IBF/en/team/91201", name: "South One" },
      { sourceTeamId: "91202", sourceUrl: "https://hosted.dcd.shared.geniussports.com/IBF/en/team/91202", name: "South Two" },
    ]).returning();
    const northOne = savedTeams.find((team) => team.sourceTeamId === "91101");
    const northTwo = savedTeams.find((team) => team.sourceTeamId === "91102");
    const southOne = savedTeams.find((team) => team.sourceTeamId === "91201");
    const southTwo = savedTeams.find((team) => team.sourceTeamId === "91202");
    assert.ok(northOne && northTwo && southOne && southTwo);

    const savedPlayers = await db.insert(players).values([
      { sourcePlayerId: "91301", sourceUrl: "https://hosted.dcd.shared.geniussports.com/IBF/en/competition/91002/player/91301", name: "North Scorer" },
      { sourcePlayerId: "91302", sourceUrl: "https://hosted.dcd.shared.geniussports.com/IBF/en/player/91302", name: "Unrostered North Player" },
      { sourcePlayerId: "91401", sourceUrl: "https://hosted.dcd.shared.geniussports.com/IBF/en/player/91401", name: "South Scorer" },
    ]).returning();
    const northScorer = savedPlayers.find((player) => player.sourcePlayerId === "91301");
    const unrostered = savedPlayers.find((player) => player.sourcePlayerId === "91302");
    assert.ok(northScorer && unrostered);

    await db.insert(competitionTeams).values([
      { competitionId: firstCompetition.id, teamId: northOne.id, sourceUrl: `${firstCompetition.sourceUrl}/team/91101` },
      { competitionId: firstCompetition.id, teamId: northTwo.id, sourceUrl: `${firstCompetition.sourceUrl}/team/91102` },
      { competitionId: secondCompetition.id, teamId: northOne.id, sourceUrl: `${secondCompetition.sourceUrl}/team/91101` },
      { competitionId: secondCompetition.id, teamId: southOne.id, sourceUrl: secondCompetition.sourceUrl },
      { competitionId: secondCompetition.id, teamId: southTwo.id, sourceUrl: secondCompetition.sourceUrl },
    ]);
    await db.insert(competitionPlayers).values([
      { competitionId: firstCompetition.id, playerId: northScorer.id, sourceUrl: `${firstCompetition.sourceUrl}/player/91301` },
      { competitionId: firstCompetition.id, playerId: unrostered.id, sourceUrl: firstCompetition.sourceUrl },
      { competitionId: secondCompetition.id, playerId: northScorer.id, sourceUrl: `${secondCompetition.sourceUrl}/player/91301` },
      { competitionId: secondCompetition.id, playerId: savedPlayers.find((player) => player.sourcePlayerId === "91401")!.id, sourceUrl: secondCompetition.sourceUrl },
    ]);
    await db.insert(teamRosters).values({
      competitionId: firstCompetition.id,
      teamId: northOne.id,
      playerId: northScorer.id,
      sourceUrl: `${firstCompetition.sourceUrl}/match/91601/boxscore`,
      observedAt: new Date("2026-10-01T00:00:00Z"),
    });

    const [northGroup, southGroup] = await db.insert(competitionGroups).values([
      { competitionId: firstCompetition.id, sourceGroupId: "91501", sourceUrl: `${firstCompetition.sourceUrl}/standings?group=91501`, label: "POOL A", poolNumber: "9" },
      { competitionId: secondCompetition.id, sourceGroupId: "91502", sourceUrl: `${secondCompetition.sourceUrl}/standings?group=91502`, label: "POOL X", poolNumber: "1" },
    ]).returning();
    assert.ok(northGroup && southGroup);
    await db.insert(groupStandings).values([
      { groupId: northGroup.id, teamId: northOne.id, position: 1, gamesPlayed: 2, wins: 2, losses: 0, pointsFor: 70, pointsAgainst: 50, pointDifference: 20, standingPoints: 4 },
      { groupId: southGroup.id, teamId: southOne.id, position: 1, gamesPlayed: 1, wins: 1, losses: 0, pointsFor: 60, pointsAgainst: 40, pointDifference: 20, standingPoints: 2 },
    ]);

    const savedGames = await db.insert(games).values([
      { competitionId: firstCompetition.id, sourceGameId: "91601", sourceUrl: `${firstCompetition.sourceUrl}/match/91601/summary`, homeTeamId: northOne.id, awayTeamId: northTwo.id, homeScore: 30, awayScore: 25, status: "complete", scheduledAtRaw: "2026-10-01 09:00" },
      { competitionId: firstCompetition.id, sourceGameId: "91602", sourceUrl: `${firstCompetition.sourceUrl}/match/91602/summary`, homeTeamId: northOne.id, awayTeamId: northTwo.id, homeScore: 40, awayScore: 30, status: "complete", scheduledAtRaw: "2026-10-02 09:00" },
      { competitionId: firstCompetition.id, sourceGameId: "91603", sourceUrl: `${firstCompetition.sourceUrl}/match/91603/summary`, homeTeamId: northTwo.id, awayTeamId: northOne.id, status: "scheduled", scheduledAtRaw: "2026-10-03 09:00" },
      { competitionId: firstCompetition.id, sourceGameId: "91604", sourceUrl: `${firstCompetition.sourceUrl}/match/91604/summary`, homeTeamId: northOne.id, awayTeamId: northTwo.id, homeScore: 50, awayScore: 45, status: "live", scheduledAtRaw: "2026-10-04 09:00" },
      { competitionId: secondCompetition.id, sourceGameId: "91701", sourceUrl: `${secondCompetition.sourceUrl}/match/91701/summary`, homeTeamId: southOne.id, awayTeamId: southTwo.id, homeScore: 60, awayScore: 40, status: "complete" },
    ]).returning();
    const northGameOne = savedGames.find((game) => game.sourceGameId === "91601");
    const northGameTwo = savedGames.find((game) => game.sourceGameId === "91602");
    const northLive = savedGames.find((game) => game.sourceGameId === "91604");
    assert.ok(northGameOne && northGameTwo && northLive);

    const [northBoxscoreFetch, foreignBoxscoreFetch] = await db.insert(sourceFetches).values([
      { competitionId: firstCompetition.id, resource: "boxscore", requestUrl: `${firstCompetition.sourceUrl}/match/91601/boxscore`, fetchStatus: "succeeded", parseStatus: "parsed", httpStatus: 200, requestedAt: new Date("2026-10-01T00:02:00Z"), fetchedAt: new Date("2026-10-01T00:02:01Z") },
      { competitionId: secondCompetition.id, resource: "boxscore", requestUrl: `${secondCompetition.sourceUrl}/match/91701/boxscore`, fetchStatus: "failed", parseStatus: "failed", httpStatus: null, requestedAt: new Date("2026-10-01T00:02:00Z") },
    ]).returning();
    assert.ok(northBoxscoreFetch && foreignBoxscoreFetch);
    await db.update(games).set({ lastBoxscoreFetchId: northBoxscoreFetch.id }).where(eq(games.id, northGameOne.id));

    await db.insert(teamGameStats).values([
      { gameId: northGameOne.id, teamId: northOne.id, points: 30, fieldGoalsMade: 12, fieldGoalsAttempted: 25, twoPointsMade: 9, twoPointAttempts: 15, threePointsMade: 2, threePointAttempts: 8, freeThrowsMade: 4, freeThrowAttempts: 5, rebounds: 20, assists: 8 },
      { gameId: northGameOne.id, teamId: northTwo.id, points: 25 },
      { gameId: northGameTwo.id, teamId: northOne.id, points: 40, fieldGoalsMade: 15, fieldGoalsAttempted: 30, twoPointsMade: 11, twoPointAttempts: 20, threePointsMade: 3, threePointAttempts: 10, freeThrowsMade: 7, freeThrowAttempts: 9, rebounds: 28, assists: 12 },
    ]);
    await db.insert(playerGameStats).values([
      { gameId: northGameOne.id, playerId: northScorer.id, teamId: northOne.id, minutesRaw: "20:00", minutes: 20, points: 10, rebounds: 3, assists: 2, steals: 1, blocks: 0, fieldGoalsMade: 4, fieldGoalsAttempted: 8, twoPointsMade: 3, twoPointAttempts: 5, threePointsMade: 1, threePointAttempts: 3, freeThrowsMade: 1, freeThrowAttempts: 2, sourceUrl: `${firstCompetition.sourceUrl}/match/91601/boxscore` },
      { gameId: northGameOne.id, playerId: unrostered.id, teamId: northOne.id, minutesRaw: "00:00", minutes: 0, points: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0, fieldGoalsMade: 0, fieldGoalsAttempted: 0, twoPointsMade: 0, twoPointAttempts: 0, threePointsMade: 0, threePointAttempts: 0, freeThrowsMade: 0, freeThrowAttempts: 0, sourceUrl: `${firstCompetition.sourceUrl}/match/91601/boxscore` },
      { gameId: northGameTwo.id, playerId: northScorer.id, teamId: northOne.id, minutesRaw: "30:00", minutes: 30, points: 20, rebounds: 9, assists: 5, steals: 1, blocks: 2, fieldGoalsMade: 6, fieldGoalsAttempted: 10, twoPointsMade: 4, twoPointAttempts: 6, threePointsMade: 2, threePointAttempts: 4, freeThrowsMade: 6, freeThrowAttempts: 8, sourceUrl: `${firstCompetition.sourceUrl}/match/91602/boxscore` },
      { gameId: northLive.id, playerId: northScorer.id, teamId: northOne.id, minutesRaw: "10:00", minutes: 10, points: 50, sourceUrl: `${firstCompetition.sourceUrl}/match/91604/boxscore` },
    ]);
    await db.insert(playByPlayEvents).values([
      { gameId: northGameOne.id, sourceSequence: 0, periodNumber: 1, periodLabelRaw: "P1", periodType: "regulation", timeRaw: "09:59", actionType: "shot", actionText: "Made shot", teamId: northOne.id, teamSide: "home", playerId: northScorer.id, playerName: northScorer.name, scoreRaw: "2-0", team1Score: 2, team2Score: 0, sourceUrl: `${firstCompetition.sourceUrl}/match/91601/playbyplay`, parserVersion: "test" },
      { gameId: northGameOne.id, sourceSequence: 1, periodNumber: 2, periodLabelRaw: "P2", periodType: "regulation", timeRaw: "08:00", actionType: "turnover", actionText: "Turnover", teamId: northTwo.id, teamSide: "away", playerId: unrostered.id, playerName: unrostered.name, scoreRaw: "2-2", team1Score: 2, team2Score: 2, sourceUrl: `${firstCompetition.sourceUrl}/match/91601/playbyplay`, parserVersion: "test" },
      { gameId: northGameOne.id, sourceSequence: 2, periodNumber: 2, periodLabelRaw: "P2", periodType: "regulation", timeRaw: "07:59", actionType: "timeout", actionText: "Timeout", teamSide: "neutral", sourceUrl: `${firstCompetition.sourceUrl}/match/91601/playbyplay`, parserVersion: "test" },
    ]);
    await db.insert(shots).values([
      { gameId: northGameOne.id, sourceSequence: 0, periodNumber: 1, teamId: northOne.id, playerId: northScorer.id, playerName: northScorer.name, shotType: "2pt", result: "made", xRaw: "10%", yRaw: "20%", xPercent: 10, yPercent: 20, rawTitle: "test shot", sourceUrl: `${firstCompetition.sourceUrl}/match/91601/shotchart`, parserVersion: "test" },
      { gameId: northGameOne.id, sourceSequence: 1, periodNumber: 1, teamId: northOne.id, playerId: northScorer.id, playerName: northScorer.name, shotType: "3pt", result: "missed", xRaw: "30%", yRaw: "40%", xPercent: 30, yPercent: 40, rawTitle: "test miss", sourceUrl: `${firstCompetition.sourceUrl}/match/91601/shotchart`, parserVersion: "test" },
      { gameId: northGameOne.id, sourceSequence: 2, periodNumber: 2, teamId: northTwo.id, playerId: unrostered.id, playerName: unrostered.name, shotType: "2pt", result: "made", xRaw: "70%", yRaw: "60%", xPercent: 70, yPercent: 60, rawTitle: "away shot", sourceUrl: `${firstCompetition.sourceUrl}/match/91601/shotchart`, parserVersion: "test" },
    ]);
    await db.insert(officialTeamMetrics).values([
      { competitionId: firstCompetition.id, scopeType: "game", gameId: northGameOne.id, teamId: northOne.id, metricCode: "2CP", value: 4, availability: "available", unit: "points", scopeLabel: "Final", sourceUrl: `${firstCompetition.sourceUrl}/match/91601/analysis`, parserVersion: "test" },
      { competitionId: firstCompetition.id, scopeType: "game", gameId: northGameOne.id, teamId: northOne.id, metricCode: "BP", value: null, availability: "unavailable", unit: "points", scopeLabel: "Final", sourceUrl: `${firstCompetition.sourceUrl}/match/91601/analysis`, parserVersion: "test" },
      { competitionId: firstCompetition.id, scopeType: "game", gameId: northGameOne.id, teamId: northTwo.id, metricCode: "2CP", value: 7, availability: "available", unit: "points", scopeLabel: "Final", sourceUrl: `${firstCompetition.sourceUrl}/match/91601/analysis`, parserVersion: "test" },
      { competitionId: firstCompetition.id, scopeType: "competition", gameId: null, teamId: northOne.id, metricCode: "BP", value: 21, availability: "available", unit: "points", scopeLabel: "Competition total", sampleGamesPlayed: 2, sourceUrl: `${firstCompetition.sourceUrl}/statistics/team`, parserVersion: "test" },
      { competitionId: firstCompetition.id, scopeType: "competition", gameId: null, teamId: northOne.id, metricCode: "2CP", value: 32, availability: "available", unit: "points", scopeLabel: "Competition total", sampleGamesPlayed: 2, sourceUrl: `${firstCompetition.sourceUrl}/statistics/team`, parserVersion: "test" },
    ]);
    const detailFetchRows = await db.insert(sourceFetches).values([
      { competitionId: firstCompetition.id, resource: "playbyplay", requestUrl: `${firstCompetition.sourceUrl}/match/91601/playbyplay`, fetchStatus: "failed", parseStatus: "failed", httpStatus: null, requestedAt: new Date("2026-10-01T00:02:58Z"), fetchedAt: new Date("2026-10-01T00:02:59Z") },
      { competitionId: firstCompetition.id, resource: "playbyplay", requestUrl: `${firstCompetition.sourceUrl}/match/91601/playbyplay`, fetchStatus: "succeeded", parseStatus: "parsed", httpStatus: 200, requestedAt: new Date("2026-10-01T00:03:00Z"), fetchedAt: new Date("2026-10-01T00:03:01Z") },
      { competitionId: firstCompetition.id, resource: "shotchart", requestUrl: `${firstCompetition.sourceUrl}/match/91601/shotchart`, fetchStatus: "succeeded", parseStatus: "parsed", httpStatus: 200, requestedAt: new Date("2026-10-01T00:03:00Z"), fetchedAt: new Date("2026-10-01T00:03:01Z") },
      { competitionId: secondCompetition.id, resource: "playbyplay", requestUrl: `${secondCompetition.sourceUrl}/match/91701/playbyplay`, fetchStatus: "succeeded", parseStatus: "parsed", httpStatus: 200, requestedAt: new Date("2026-10-01T00:03:00Z"), fetchedAt: new Date("2026-10-01T00:03:01Z") },
    ]).returning();
    assert.equal(detailFetchRows.length, 4);
    const gameDetail = await getGameDetail(db, firstCompetition.id, "91601");
    assert.ok(gameDetail);
    assert.equal(gameDetail.boxscoreFetch?.parseStatus, "parsed");
    assert.equal(gameDetail.playerStats.length, 2);
    assert.equal(gameDetail.playByPlayEvents.length, 3);
    assert.equal(gameDetail.shots.length, 3);
    assert.equal(gameDetail.gameOfficialMetrics.length, 3);
    assert.equal(gameDetail.detailFetches.length, 2);
    assert.equal(gameDetail.detailFetches.find((entry) => entry.resource === "playbyplay")?.fetchStatus, "succeeded");
    const [cachedPartial] = await db.insert(sourceFetches).values({
      id: "00000000-0000-4000-8000-000000000001",
      competitionId: firstCompetition.id, resource: "shotchart",
      requestUrl: `${firstCompetition.sourceUrl}/match/91601/shotchart`,
      fetchStatus: "succeeded", parseStatus: "partial", httpStatus: 200,
      requestedAt: new Date("2026-10-01T00:05:00Z"), fetchedAt: new Date("2026-10-01T00:03:01Z")
    }).returning();
    assert.ok(cachedPartial);
    const cachedDetail = await getGameDetail(db, firstCompetition.id, "91601");
    assert.equal(cachedDetail?.shots.length, 3);
    assert.equal(cachedDetail?.detailFetches.find((entry) => entry.resource === "shotchart")?.id, cachedPartial.id);
    assert.equal(cachedDetail?.detailFetches.find((entry) => entry.resource === "shotchart")?.parseStatus, "partial");
    assert.deepEqual(gameDetail.gameOfficialMetrics.find((entry) => entry.metricCode === "BP")?.availability, "unavailable");
    const selectedGameDetail = await getGameDetail(db, firstCompetition.id, "91601", { periodNumber: 1, teamSourceId: "91101", playerSourceId: "91301", result: "made" });
    assert.equal(selectedGameDetail?.playByPlayEvents.length, 1);
    assert.equal(selectedGameDetail?.shots.length, 1);
    assert.equal(selectedGameDetail?.shots[0]?.result, "made");
    assert.deepEqual(parseGameDetailFilters({ period: "2", team: "91102", player: "91302", result: "missed" }), { periodNumber: 2, teamSourceId: "91102", playerSourceId: "91302", result: "missed" });
    assert.deepEqual(parseGameDetailFilters({ period: "11", team: "not-id", result: "all" }), {});
    assert.equal(await getGameDetail(db, secondCompetition.id, "91601"), null);
    await db.update(games).set({ lastBoxscoreFetchId: foreignBoxscoreFetch.id }).where(eq(games.id, northGameOne.id));
    assert.equal((await getGameDetail(db, firstCompetition.id, "91601"))?.boxscoreFetch, null);
    await db.update(games).set({ lastBoxscoreFetchId: northBoxscoreFetch.id }).where(eq(games.id, northGameOne.id));

    const [oldRun, latestRun] = await db.insert(importRuns).values([
      { competitionId: firstCompetition.id, mode: "sync", status: "succeeded", parserVersion: "test-1", startedAt: new Date("2026-10-01T00:00:00Z"), finishedAt: new Date("2026-10-01T00:01:00Z") },
      { competitionId: firstCompetition.id, mode: "sync", status: "partial", parserVersion: "test-2", startedAt: new Date("2026-10-02T00:00:00Z"), finishedAt: new Date("2026-10-02T00:01:00Z") },
    ]).returning();
    assert.ok(oldRun && latestRun);
    await db.insert(validationIssues).values([
      { competitionId: firstCompetition.id, importRunId: oldRun.id, severity: "error", code: "OLD_CHECK", message: "Older issue", sourceUrl: firstCompetition.sourceUrl, createdAt: new Date("2026-10-01T00:00:00Z") },
      { competitionId: firstCompetition.id, importRunId: latestRun.id, gameId: northGameOne.id, severity: "warning", code: "LATEST_CHECK", message: "Latest issue", sourceUrl: `${firstCompetition.sourceUrl}/match/91601/boxscore`, createdAt: new Date("2026-10-02T00:00:00Z") },
      { competitionId: firstCompetition.id, importRunId: oldRun.id, gameId: northGameOne.id, severity: "warning", code: "LATEST_CHECK", message: "Older duplicate", sourceUrl: `${firstCompetition.sourceUrl}/match/91601/boxscore`, createdAt: new Date("2026-10-01T00:00:00Z") },
      { competitionId: secondCompetition.id, severity: "error", code: "OTHER_COMP", message: "Other competition issue", sourceUrl: secondCompetition.sourceUrl },
    ]);
    const refreshedGameDetail = await getGameDetail(db, firstCompetition.id, "91601");
    assert.equal(refreshedGameDetail?.validationIssues.length, 1);
    assert.equal(refreshedGameDetail?.validationIssues[0]?.message, "Latest issue");

    const listedCompetitions = await listCompetitions(db);
    assert.deepEqual(listedCompetitions.map((item) => item.sourceCompetitionId), ["91001", "91002"]);
    assert.equal((await getCompetitionBySourceId(db, "91001"))?.id, firstCompetition.id);
    assert.equal(await getCompetitionBySourceId(db, "bad-id"), null);

    const completeGames = await getGamesPage(db, firstCompetition.id, { page: 1, status: "complete" }, 1);
    assert.equal(completeGames.total, 2);
    assert.equal(completeGames.items.length, 1);
    assert.equal(completeGames.items[0]?.status, "complete");
    assert.equal((await getGamesPage(db, firstCompetition.id, { page: 1, teamSourceId: "91201" })).total, 0);
    assert.equal(parsePage("-5"), 1);
    assert.deepEqual(parseGameListFilters({ page: ["1", "2"], status: "bogus", team: "../../" }), { page: 1 });

    const playerSummary = await getPlayerSummary(db, firstCompetition.id, "91301");
    assert.ok(playerSummary);
    assert.equal(playerSummary.player.sourceUrl, `${firstCompetition.sourceUrl}/player/91301`);
    assert.equal(playerSummary.teams[0]?.sourceUrl, `${firstCompetition.sourceUrl}/match/91601/boxscore`);
    assert.equal(playerSummary.totals.gamesPlayed, 2);
    assert.equal(playerSummary.totals.points, 30);
    assert.equal(playerSummary.totals.pointsPerGame, 15);
    assert.equal(playerSummary.totals.minutes, 50);
    assert.equal(playerSummary.totals.averageMinutes, 25);
    assert.equal(playerSummary.totals.fieldGoalsMade, 10);
    assert.equal(playerSummary.totals.fieldGoalsAttempted, 18);
    assert.ok(Math.abs((playerSummary.totals.fieldGoalPercentage ?? 0) - (10 / 18) * 100) < 0.001);
    assert.ok(Math.abs((playerSummary.totals.threePointPercentage ?? 0) - (3 / 7) * 100) < 0.001);
    assert.ok(Math.abs((playerSummary.totals.freeThrowPercentage ?? 0) - 70) < 0.001);
    assert.equal(playerSummary.player.teamNames.join(","), "North One");
    const playerRows = await getPlayersPage(db, firstCompetition.id, 1, 20);
    assert.equal(playerRows.total, 2);
    assert.deepEqual(playerRows.items.find((item) => item.sourcePlayerId === "91302")?.teamNames, []);
    assert.equal(playerRows.items.find((item) => item.sourcePlayerId === "91302")?.gamesPlayed, 1);
    assert.equal(playerRows.items.find((item) => item.sourcePlayerId === "91301")?.sourceUrl, `${firstCompetition.sourceUrl}/player/91301`);
    const secondPlayerRows = await getPlayersPage(db, secondCompetition.id, 1, 20);
    assert.equal(secondPlayerRows.items.find((item) => item.sourcePlayerId === "91301")?.sourceUrl, `${secondCompetition.sourceUrl}/player/91301`);

    const standings = await getStandings(db, firstCompetition.id);
    assert.equal(standings.groups.length, 1);
    assert.equal(standings.groups[0]?.label, "POOL A");
    assert.equal(standings.rows.length, 1);
    assert.equal(standings.rows[0]?.team.sourceTeamId, "91101");
    assert.deepEqual(parseStandingsFilters({ group: northGroup.id }), { groupId: northGroup.id });
    assert.deepEqual(parseStandingsFilters({ group: "standings?phase=PLAYOFFS&poolNumber=9" }), {});
    const selectedStandings = await getStandings(db, firstCompetition.id, { groupId: northGroup.id });
    assert.equal(selectedStandings.selectedGroupId, northGroup.id);
    assert.equal(selectedStandings.rows.length, 1);
    assert.equal((await getStandings(db, firstCompetition.id, { groupId: southGroup.id })).rows.length, 0);

    const teamSummary = await getTeamSummary(db, firstCompetition.id, "91101");
    assert.ok(teamSummary);
    assert.equal(teamSummary.team.sourceUrl, `${firstCompetition.sourceUrl}/team/91101`);
    assert.equal(teamSummary.team.gamesPlayed, 2);
    assert.equal(teamSummary.team.wins, 2);
    assert.equal(teamSummary.team.losses, 0);
    assert.deepEqual(teamSummary.roster.map((player) => player.sourcePlayerId), ["91301"]);
    assert.equal(teamSummary.totals?.points, 70);
    assert.equal(teamSummary.totals?.fieldGoalPct, "49.1");
    assert.deepEqual(teamSummary.officialMetrics.map((metric) => [metric.metricCode, metric.value, metric.sampleGamesPlayed]), [["2CP", 32, 2], ["BP", 21, 2]]);
    assert.deepEqual((await getTeamSummary(db, secondCompetition.id, "91101"))?.officialMetrics, []);
    const firstTeamRows = await getTeamsPage(db, firstCompetition.id, 1, 20);
    const secondTeamRows = await getTeamsPage(db, secondCompetition.id, 1, 20);
    assert.equal(firstTeamRows.items.find((item) => item.sourceTeamId === "91101")?.sourceUrl, `${firstCompetition.sourceUrl}/team/91101`);
    assert.equal(secondTeamRows.items.find((item) => item.sourceTeamId === "91101")?.sourceUrl, `${secondCompetition.sourceUrl}/team/91101`);

    const review = await getReviewSummary(db, firstCompetition.id, parseReviewFilters({ page: "1" }));
    assert.equal(review.totalIssues, 3);
    assert.equal(review.latestRun?.id, latestRun.id);
    assert.equal(review.issues.items.length, 3);
    assert.deepEqual(review.issueTypes, ["LATEST_CHECK", "OLD_CHECK"]);
    assert.equal(review.issues.items.find((issue) => issue.code === "LATEST_CHECK")?.isLatestRun, true);
    assert.equal(review.issues.items.find((issue) => issue.code === "LATEST_CHECK")?.game?.sourceGameId, "91601");
    assert.equal(review.issues.items.find((issue) => issue.code === "OLD_CHECK")?.isLatestRun, false);
    assert.equal((await getReviewSummary(db, firstCompetition.id, { page: 1, severity: "warning" })).issues.total, 2);
    assert.equal((await getReviewSummary(db, firstCompetition.id, { page: 1, code: "OLD_CHECK" })).issues.total, 1);
    assert.deepEqual(parseReviewFilters({ page: "2", severity: "error", code: "LATEST_CHECK" }), { page: 2, severity: "error", code: "LATEST_CHECK" });
    assert.deepEqual(parseReviewFilters({ page: "1", code: "../../other" }), { page: 1 });

    const operationNow = Date.now();
    const sourceTime = new Date(operationNow - 7 * 60_000);
    await db.insert(sourceFetches).values({
      competitionId: firstCompetition.id,
      resource: "competition",
      requestUrl: firstCompetition.sourceUrl,
      finalUrl: firstCompetition.sourceUrl,
      fetchStatus: "succeeded",
      parseStatus: "parsed",
      httpStatus: 200,
      requestedAt: new Date(operationNow - 2 * 60_000),
      fetchedAt: sourceTime,
      sourceFetchedAt: sourceTime,
      durationMs: 100,
      attempts: 1,
      attemptLog: []
    });
    await db.insert(syncRuns).values([
      {
        competitionId: firstCompetition.id, sourceCompetitionId: "91001", ownerId: "00000000-0000-4000-8000-000000009101",
        hostname: "runner-a", processId: 101, mode: "once", status: "succeeded",
        startedAt: new Date(operationNow - 8 * 60_000), heartbeatAt: new Date(operationNow - 6 * 60_000), finishedAt: new Date(operationNow - 6 * 60_000),
        nextRunAt: new Date(operationNow + 5 * 60_000), pageCount: 8, failureCount: 1,
        failureUrls: [`${firstCompetition.sourceUrl}/match/91601/boxscore`], writeCounts: { newGames: 2, updatedGames: 1 },
        resultSummary: "succeeded; 2 pertandingan baru, 1 diperbarui.", importRunId: latestRun.id
      },
      {
        competitionId: firstCompetition.id, sourceCompetitionId: "91001", ownerId: "00000000-0000-4000-8000-000000009102",
        hostname: "runner-b", processId: 102, mode: "periodic", status: "running",
        startedAt: new Date(operationNow - 60_000), heartbeatAt: new Date(operationNow), nextRunAt: new Date(operationNow + 4 * 60_000),
        pageCount: 9, failureCount: 1, failureUrls: [`${firstCompetition.sourceUrl}/match/91602/playbyplay`], writeCounts: {}
      },
      {
        competitionId: secondCompetition.id, sourceCompetitionId: "91002", ownerId: "00000000-0000-4000-8000-000000009103",
        hostname: "runner-c", processId: 103, mode: "once", status: "failed",
        startedAt: new Date(operationNow - 30_000), heartbeatAt: new Date(operationNow), finishedAt: new Date(operationNow),
        pageCount: 3, failureCount: 4, failureUrls: [secondCompetition.sourceUrl], writeCounts: { newGames: 99 }
      }
    ]);
    await db.insert(syncLeases).values({
      sourceCompetitionId: "91001", ownerId: "00000000-0000-4000-8000-000000009102", hostname: "runner-b", processId: 102,
      expiresAt: new Date(operationNow + 120_000)
    });
    const liveOperations = await getOperationalStatus(db, firstCompetition.id);
    assert.equal(liveOperations.isRunning, true);
    assert.equal(liveOperations.latestStatus, "running");
    assert.equal(liveOperations.pageCount, 9);
    assert.equal(liveOperations.lastSourceFetchedAt?.toISOString(), sourceTime.toISOString());
    assert.equal(liveOperations.writeCounts["newGames"], 2);
    assert.equal(liveOperations.reviewIssueCount, 1);
    assert.ok(liveOperations.failureUrls[0]?.includes("91602"));
    const otherOperations = await getOperationalStatus(db, secondCompetition.id);
    assert.equal(otherOperations.isRunning, false);
    assert.equal(otherOperations.failureCount, 4);
    assert.deepEqual(otherOperations.writeCounts, { newGames: 99 });

    const partialQuality = buildDetailQuality({ boxScore: "available", playByPlay: "available", shotChart: "partial" }, [{
      code: "SHOT_FGA_MISMATCH", severity: "error", message: "Chart mismatch", sourceUrl: `${firstCompetition.sourceUrl}/match/${northGameOne.sourceGameId}/shotchart`,
      fieldPath: "FGA", expected: 36, actual: 35
    }]);
    await db.update(games).set({detailQuality: partialQuality}).where(eq(games.id, northGameOne.id));
    const qualityDetail = await getGameDetail(db, firstCompetition.id, northGameOne.sourceGameId);
    assert.equal(qualityDetail?.datasetQuality?.boxScore.status, "parsed");
    assert.equal(qualityDetail?.datasetQuality?.shotChart.category, "source_inconsistent");
    // Resolved historical issues remain on Review, but no longer appear as current detail issues.
    assert.equal(qualityDetail?.validationIssues.length, 0);
    assert.ok((await getReviewSummary(db, firstCompetition.id, {page: 1})).issues.total > 0);
    assert.equal(await getGameDetail(db, secondCompetition.id, northGameOne.sourceGameId), null);

    const overview = await getOverview(db, firstCompetition.id);
    assert.deepEqual(
      { games: overview.games, teams: overview.teams, players: overview.players, groups: overview.groups, complete: overview.completedGames, live: overview.liveGames, scheduled: overview.scheduledGames },
      { games: 4, teams: 2, players: 2, groups: 1, complete: 2, live: 1, scheduled: 1 },
    );
    assert.equal(overview.leaderboard[0]?.sourcePlayerId, "91301");
    assert.equal(overview.leaderboard[0]?.pointsPerGame, 15);
    assert.equal(overview.operations.isRunning, true);
    const observationTime = new Date(operationNow + 1_000);
    const [summaryRun] = await db.insert(importRuns).values({ competitionId: firstCompetition.id, mode: "sync", status: "succeeded",
      parserVersion: "statsarena-parser/0.2.2", auditKind: "summary", baselineImportRunId: latestRun.id,
      latestRequestedAt: observationTime, latestSourceFetchedAt: sourceTime,
      startedAt: observationTime, finishedAt: observationTime }).returning();
    assert.ok(summaryRun);
    await db.insert(syncRuns).values({ competitionId: firstCompetition.id, sourceCompetitionId: "91001",
      importRunId: summaryRun.id, ownerId: "00000000-0000-4000-8000-000000009104", hostname: "runner-summary", processId: 104,
      mode: "once", status: "succeeded", startedAt: observationTime, heartbeatAt: observationTime, finishedAt: observationTime });
    const summaryStatus = await getOperationalStatus(db, firstCompetition.id);
    assert.equal(summaryStatus.isRunning, false);
    assert.equal(summaryStatus.reviewIssueCount, 1);
    assert.equal(summaryStatus.lastSourceFetchedAt?.toISOString(), sourceTime.toISOString());
  } finally {
    await client.close();
  }
});

test("player metrics use aggregate attempts, preserve missing values, and sort/filter before pagination", async () => {
  const client = new PGlite();
  try {
    await migrate(drizzle(client), {
      migrationsFolder: fileURLToPath(new URL("../../packages/db/drizzle", import.meta.url)),
      migrationsSchema: "statsarena", migrationsTable: "__drizzle_migrations",
    });
    const db = drizzle(client, { schema }) as unknown as StatsArenaDatabase;
    const [competition, otherCompetition] = await db.insert(competitions).values([
      { sourceCompetitionId: "92001", name: "Metrics", sourceUrl: "https://hosted.dcd.shared.geniussports.com/IBF/en/competition/92001" },
      { sourceCompetitionId: "92002", name: "Other", sourceUrl: "https://hosted.dcd.shared.geniussports.com/IBF/en/competition/92002" },
    ]).returning();
    assert.ok(competition && otherCompetition);
    const [team, foreignTeam] = await db.insert(teams).values([
      { sourceTeamId: "92101", name: "Metrics team", sourceUrl: competition.sourceUrl }, { sourceTeamId: "92102", name: "Foreign", sourceUrl: otherCompetition.sourceUrl },
    ]).returning();
    assert.ok(team && foreignTeam);
    await db.insert(competitionTeams).values([{ competitionId: competition.id, teamId: team.id, sourceUrl: competition.sourceUrl }, { competitionId: otherCompetition.id, teamId: foreignTeam.id, sourceUrl: otherCompetition.sourceUrl }]);
    const [scorer, zero, noStats] = await db.insert(players).values([
      { sourcePlayerId: "92201", name: "Zed %_ Scorer", sourceUrl: competition.sourceUrl },
      { sourcePlayerId: "92202", name: "Alpha Zero", sourceUrl: competition.sourceUrl }, { sourcePlayerId: "92203", name: "Beta No Stats", sourceUrl: competition.sourceUrl },
    ]).returning();
    assert.ok(scorer && zero && noStats);
    await db.insert(competitionPlayers).values([scorer, zero, noStats].map((player) => ({ competitionId: competition.id, playerId: player.id, sourceUrl: competition.sourceUrl })));
    await db.insert(teamRosters).values([
      { competitionId: competition.id, playerId: scorer.id, teamId: team.id, sourceUrl: competition.sourceUrl },
      { competitionId: otherCompetition.id, playerId: zero.id, teamId: foreignTeam.id, sourceUrl: otherCompetition.sourceUrl },
    ]);
    const [first, second, foreign, live] = await db.insert(games).values([
      { competitionId: competition.id, sourceGameId: "92301", sourceUrl: competition.sourceUrl, status: "complete" },
      { competitionId: competition.id, sourceGameId: "92302", sourceUrl: competition.sourceUrl, status: "complete" },
      { competitionId: otherCompetition.id, sourceGameId: "92303", sourceUrl: otherCompetition.sourceUrl, status: "complete" },
      { competitionId: competition.id, sourceGameId: "92304", sourceUrl: competition.sourceUrl, status: "live" },
    ]).returning();
    assert.ok(first && second && foreign && live);
    const common = { sourceUrl: competition.sourceUrl, playerId: scorer.id, teamId: team.id, minutes: 20, rebounds: 5, assists: 3, steals: 1, blocks: 1, turnovers: 2, personalFouls: 3, offensiveRebounds: 2, defensiveRebounds: 3 };
    await db.insert(playerGameStats).values([
      { ...common, gameId: first.id, points: 13, fieldGoalsMade: 4, fieldGoalsAttempted: 8, twoPointsMade: 2, twoPointAttempts: 4, threePointsMade: 2, threePointAttempts: 4, freeThrowsMade: 3, freeThrowAttempts: 4 },
      { ...common, gameId: second.id, points: 9, fieldGoalsMade: 3, fieldGoalsAttempted: 4, twoPointsMade: 2, twoPointAttempts: 2, threePointsMade: 1, threePointAttempts: 2, freeThrowsMade: 2, freeThrowAttempts: 2 },
      { ...common, gameId: foreign.id, points: 999 }, { ...common, gameId: live.id, points: 999 },
      { ...common, gameId: first.id, playerId: zero.id, points: 0, turnovers: 0, assists: 0, fieldGoalsMade: 0, fieldGoalsAttempted: 0, twoPointsMade: 0, twoPointAttempts: 0, threePointsMade: 0, threePointAttempts: 0, freeThrowsMade: 0, freeThrowAttempts: 0 },
    ]);
    const result = await getPlayersPage(db, competition.id, 1, 1);
    assert.equal(result.total, 3);
    const player = result.items[0];
    assert.equal(player?.sourcePlayerId, scorer.sourcePlayerId);
    assert.equal(player?.gamesPlayed, 2);
    assert.equal(player?.pointsPerGame, 11);
    assert.equal(player?.turnoversPerGame, 2);
    assert.equal(player?.personalFoulsPerGame, 3);
    assert.equal(player?.offensiveReboundsPerGame, 2);
    assert.equal(player?.defensiveReboundsPerGame, 3);
    assert.ok(Math.abs((player?.twoPointPercentage ?? 0) - 400 / 6) < 0.00001);
    assert.ok(Math.abs((player?.effectiveFieldGoalPercentage ?? 0) - 850 / 12) < 0.00001);
    assert.ok(Math.abs((player?.trueShootingPercentage ?? 0) - 2200 / (2 * (12 + 0.44 * 6))) < 0.00001);
    assert.equal(player?.assistTurnoverRatio, 1.5);
    assert.equal(player?.efficiencyPerGame, 16);
    assert.equal((await getPlayersPage(db, competition.id, 2, 1)).items[0]?.sourcePlayerId, zero.sourcePlayerId);
    assert.equal((await getPlayersPage(db, competition.id, 3, 1)).items[0]?.sourcePlayerId, noStats.sourcePlayerId);
    const ascending = await getPlayersPage(db, competition.id, 1, 20, parsePlayerListFilters({ sort: "points", dir: "asc" }));
    assert.deepEqual(ascending.items.map((row) => row.sourcePlayerId), [zero.sourcePlayerId, scorer.sourcePlayerId, noStats.sourcePlayerId]);
    assert.equal(ascending.items[0]?.effectiveFieldGoalPercentage, null);
    assert.equal(ascending.items[0]?.trueShootingPercentage, null);
    assert.equal(ascending.items[0]?.assistTurnoverRatio, null);
    assert.equal(ascending.items[2]?.gamesPlayed, 0);
    assert.equal(ascending.items[2]?.efficiencyPerGame, null);
    const filtered = await getPlayersPage(db, competition.id, 1, 20, parsePlayerListFilters({ q: "%_", minGp: "2", minFga: "10", team: team.sourceTeamId }));
    assert.equal(filtered.total, 1);
    assert.equal(filtered.items[0]?.id, scorer.id);
    assert.equal((await getPlayersPage(db, competition.id, 1, 20, parsePlayerListFilters({ team: foreignTeam.sourceTeamId }))).total, 0);
    await db.update(playerGameStats).set({ freeThrowAttempts: null, turnovers: null }).where(eq(playerGameStats.gameId, second.id));
    const incomplete = (await getPlayersPage(db, competition.id, 1, 20)).items.find((row) => row.id === scorer.id);
    assert.equal(incomplete?.trueShootingPercentage, null);
    assert.equal(incomplete?.freeThrowPercentage, null);
    assert.equal(incomplete?.assistTurnoverRatio, null);
    assert.equal(incomplete?.efficiencyPerGame, null);
    assert.ok(incomplete?.effectiveFieldGoalPercentage !== null);
    const invalid = parsePlayerListFilters({ sort: "points;drop table", dir: "wrong", minGp: "-1", minFga: "Infinity", q: ["one", "two"], team: "../../", columns: "extended" });
    assert.deepEqual(invalid, { query: "", minimumGames: 0, minimumAttempts: 0, sort: "points", direction: "desc", extended: true });
  } finally {
    await client.close();
  }
});
