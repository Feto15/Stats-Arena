import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import type { StatsArenaDatabase } from "@statsarena/db";
import { schema, competitions, competitionTeams, teams, games, sourceFetches, importRuns, teamGameStats, playerGameStats, players, playByPlayEvents, shots, gameLiveStats } from "@statsarena/db/schema";
import { getNeonClubReport, getNeonReportCatalog, getNeonReportDirectory } from "../lib/reports/neon-queries";
import { createReadCache } from "../lib/data/read-cache";
import { buildClubRotations } from "../lib/reports/club-rotation";
import { buildClubShotCharts } from "../lib/reports/club-shot-chart";
import snapshot from "../lib/reports/data/IBL-50231.json";

test("Neon reports read stored scoped data, preserve source evidence, and never substitute local demo rows", async t => {
  const client = new PGlite();
  try {
    await migrate(drizzle(client), { migrationsFolder: fileURLToPath(new URL("../../packages/db/drizzle", import.meta.url)), migrationsSchema: "statsarena", migrationsTable: "__drizzle_migrations" });
    const queries: string[] = [];
    const db = drizzle(client, { schema, logger: { logQuery(query) { queries.push(query); } } }) as unknown as StatsArenaDatabase;
    const [competition] = await db.insert(competitions).values({ source: "genius_sports:IBL", sourceCompetitionId: "50231", sourceUrl: snapshot.competition.sourceUrl, name: snapshot.competition.name }).returning();
    await db.insert(competitions).values({ sourceCompetitionId: "50231", sourceUrl: snapshot.competition.sourceUrl.replace("/IBL/", "/IBF/"), name: "Foreign namespace" });
    const teamIds = new Map<string, string>();
    for (const club of snapshot.clubs) {
      const [row] = await db.insert(teams).values({ source: "genius_sports:IBL", sourceTeamId: club.sourceId, sourceUrl: club.sourceUrl, name: club.name }).returning();
      teamIds.set(club.sourceId, row!.id);
      await db.insert(competitionTeams).values({ competitionId: competition!.id, teamId: row!.id, sourceUrl: club.sourceUrl });
    }
    const gameIds = new Map<string, string>();
    for (const f of snapshot.fixtures) {
      const [row] = await db.insert(games).values({ competitionId: competition!.id, source: "genius_sports:IBL", sourceGameId: f.sourceId, sourceUrl: f.sourceUrl,
        homeTeamId: teamIds.get(f.homeTeamSourceId)!, awayTeamId: teamIds.get(f.awayTeamSourceId)!, status: z.enum(["complete", "scheduled", "live", "unknown"]).parse(f.status), homeScore: f.homeScore, awayScore: f.awayScore, scheduledAtRaw: f.scheduledAtRaw, venue: f.venue }).returning();
      gameIds.set(f.sourceId, row!.id);
    }
    const playerIds = new Map<string, string>();
    for (const archived of snapshot.games) {
      const { portal, rotation } = archived;
      const gameId = gameIds.get(portal.fixture.sourceId)!;
      const [run] = await db.insert(importRuns).values({ competitionId: competition!.id, mode: "sync", status: "succeeded", parserVersion: portal.provenance.parserVersion }).returning();
      const fetches = new Map<string, string>();
      for (const source of portal.provenance.resources) {
        if (!["boxscore", "playbyplay", "shotchart"].includes(source.resource)) continue;
        const resource = source.resource === "boxscore" ? "boxscore" : source.resource === "playbyplay" ? "playbyplay" : "shotchart";
        const [saved] = await db.insert(sourceFetches).values({ competitionId: competition!.id, importRunId: run!.id, resource, requestUrl: source.sourceUrl,
          fetchStatus: "succeeded", parseStatus: "parsed", requestedAt: new Date(source.fetchedAt), fetchedAt: new Date(source.fetchedAt), sha256: source.sha256 }).returning();
        fetches.set(resource, saved!.id);
      }
      await db.update(games).set({ lastBoxscoreFetchId: fetches.get("boxscore"), detailParserVersion: portal.provenance.parserVersion }).where(eq(games.id, gameId));
      await db.insert(teamGameStats).values(portal.teams.map(row => ({ ...row.stats, gameId, teamId: teamIds.get(row.sourceId)! })));
      for (const p of portal.players) {
        let id = playerIds.get(p.sourceId);
        if (!id) {
          const [row] = await db.insert(players).values({ source: "genius_sports:IBL", sourcePlayerId: p.sourceId, name: p.name, sourceUrl: `${snapshot.competition.sourceUrl}/person/${p.sourceId}` }).returning();
          id = row!.id; playerIds.set(p.sourceId, id);
        }
        await db.insert(playerGameStats).values({ ...p.stats, gameId, playerId: id, teamId: teamIds.get(p.teamSourceId)!, jerseyNumber: p.jerseyNumber, minutesRaw: p.minutesRaw,
          sourceUrl: portal.provenance.resources.find(r => r.resource === "boxscore")!.sourceUrl });
      }
      await db.insert(playByPlayEvents).values(portal.periodEnds.map(q => ({ gameId, sourceSequence: q.sourceSequence, periodNumber: q.period, actionType: "period", actionText: "Period end",
        team1Score: q.homeScore, team2Score: q.awayScore, sourceUrl: portal.provenance.resources.find(r => r.resource === "playbyplay")!.sourceUrl, sourceFetchId: fetches.get("playbyplay"), parserVersion: portal.provenance.parserVersion })));
      await db.insert(shots).values(archived.shots.shots.map(row => ({ ...row, shotType: z.enum(["2pt", "3pt"]).parse(row.shotType), result: z.enum(["made", "missed"]).parse(row.result), gameId, teamId: teamIds.get(row.teamSourceId)!, playerId: playerIds.get(row.playerSourceId)!, sourceFetchId: fetches.get("shotchart"), parserVersion: portal.provenance.parserVersion })));
      await db.insert(gameLiveStats).values({ gameId, status: "ready", parserVersion: "statsarena-livestats/1.1.0", sourceUrl: rotation.source.jsonUrl, pageUrl: rotation.source.pageUrl,
        sourceHash: rotation.source.sha256, sourceFetchedAt: new Date(rotation.source.fetchedAt), portalFingerprint: "a".repeat(64), lastAttemptAt: new Date(), nextAttemptAt: new Date(),
        payload: { teams: [], players: [], rotation: {
          format: "statsarena-livestats-rotation/1.0.0", gameSourceId: rotation.gameId, homeScore: rotation.homeScore, awayScore: rotation.awayScore, events: rotation.events,
          provenance: { sha256: rotation.source.sha256, fetchedAt: rotation.source.fetchedAt, snapshotPath: "immutable-source.json.gz" },
          teams: rotation.teams.map(team => ({ teamId: teamIds.get(team.teamSourceId)!, localTeamKey: String(team.clubLocalTeamKey),
            players: team.players.map(p => ({ ...p, playerId: playerIds.get(p.sourceId)!, localPlayerKey: String(p.localKey) })) })),
        } } });
    }
    await t.test("directory routing avoids statistical queries and repeated cached reports perform no database reads", async () => {
      queries.length=0;
      const directory=await getNeonReportDirectory(db,"IBL:50231");
      const lightweight=queries.filter(query=>/^select /i.test(query)).length;
      assert.equal(lightweight,2);assert.equal(directory.clubs.length,10);
      assert.ok(!queries.some(query=>/player_game_stats|source_fetches|team_game_stats|play_by_play_events|shots|game_livestats/.test(query)));
      const cache=createReadCache();let checks=0;
      const load=()=>cache.read({key:["club","IBL:50231",directory.clubs[0]!.sourceId],authorize:async()=>{checks++;},load:()=>getNeonClubReport(db,"IBL:50231",directory.clubs[0]!.sourceId)});
      queries.length=0;const first=await load();assert.ok(first);assert.ok(queries.length>0);
      const expected=first.report.totals.points;first.clubs.length=0;queries.length=0;
      const second=await load();assert.ok(second);assert.equal(queries.length,0);assert.equal(checks,2);
      assert.equal(second.clubs.length,10);assert.equal(second.report.totals.points,expected);
      const catalog=await getNeonReportCatalog(db,"IBL:50231");
      assert.deepEqual(new Set(directory.clubs.map(c=>c.slug)),new Set(catalog.clubs.map(c=>c.slug)));
    });
    await t.test("catalog, box score, quarters, player metrics, shots and rotation use the same scoped Neon rows", async () => {
      const catalog = await getNeonReportCatalog(db, "IBL:50231");
      assert.equal(catalog.clubs.length, 10); assert.equal(catalog.games.length, 7); assert.equal(catalog.fixtures.length, 20);
      const bundle = (await getNeonClubReport(db, "IBL:50231", "126042"))!;
      assert.equal(bundle.dataSource, "neon"); assert.equal(bundle.report.games.length, 2); assert.equal(bundle.report.perGame.points, 63.5);
      assert.ok(bundle.report.games.every(g => g.periods?.length === 4));
      assert.ok(bundle.report.players.some(p => p.advancedStats.gameScore !== null));
      assert.ok(bundle.report.games.every(g => g.provenance.resources.every(r => !!r.sha256 && r.sourceUrl.includes("/IBL/en/competition/50231/"))));
      assert.ok(buildClubShotCharts(bundle.report, bundle.shotsInput).every(s => s.status === "ready"));
      const rotations = buildClubRotations(bundle.report, bundle.rotationInput);
      assert.equal(rotations[0]!.status, "ready"); assert.equal(rotations[1]!.status, "partial");
      if (rotations[0]!.status === "ready") assert.deepEqual(rotations[0]!.ratingContext.ambiguousSourceSequences, [344]);
      assert.equal(await getNeonClubReport(db, "IBL:50231", "999999"), null);
      await assert.rejects(() => getNeonClubReport(db, "IBL:50231", "1 OR 1=1"));
      const foreign = await getNeonReportCatalog(db, "IBL:50231"); assert.equal(foreign.competition.name, snapshot.competition.name);
    });
    await t.test("missing source datasets do not fall back to bundled shots or rotation", async () => {
      const gameId = gameIds.get("2938930")!;
      await db.delete(shots).where(eq(shots.gameId, gameId));
      await db.update(gameLiveStats).set({ payload: { players: [], teams: [] } }).where(eq(gameLiveStats.gameId, gameId));
      const b = (await getNeonClubReport(db, "IBL:50231", "126042"))!;
      assert.equal(b.report.games.length, 2);
      assert.equal(buildClubShotCharts(b.report, b.shotsInput)[0]!.status, "partial");
      assert.equal(buildClubShotCharts(b.report, b.shotsInput)[1]!.status, "ready");
      assert.equal(buildClubRotations(b.report, b.rotationInput)[0]!.status, "partial");
    });
    await t.test("foreign source references and missing period provenance withhold only the affected derived dataset", async () => {
      const gameId = gameIds.get("2945706")!;
      const [shot] = await db.select().from(shots).where(eq(shots.gameId,gameId)).limit(1);
      const fetchId = shot!.sourceFetchId!;
      const [before] = await db.select().from(sourceFetches).where(eq(sourceFetches.id,fetchId));
      await db.update(sourceFetches).set({requestUrl:before!.requestUrl.replace("/50231/","/42041/")}).where(eq(sourceFetches.id,fetchId));
      let b=(await getNeonClubReport(db,"IBL:50231","126042"))!;
      assert.equal(b.report.games.length,2);assert.equal(buildClubShotCharts(b.report,b.shotsInput)[1]!.status,"partial");
      await db.update(sourceFetches).set({requestUrl:before!.requestUrl}).where(eq(sourceFetches.id,fetchId));
      await db.update(playByPlayEvents).set({sourceFetchId:null}).where(and(eq(playByPlayEvents.gameId,gameId),eq(playByPlayEvents.periodNumber,1)));
      b=(await getNeonClubReport(db,"IBL:50231","126042"))!;
      assert.equal(b.report.games[1]!.periods,null);assert.equal(b.report.games.length,2);
    });
    await t.test("new Neon competition membership becomes an empty club report without editing a static list",async()=>{
      const sourceId="999991",sourceUrl=`${snapshot.competition.sourceUrl}/team/${sourceId}/statistics`;
      const [row]=await db.insert(teams).values({source:"genius_sports:IBL",sourceTeamId:sourceId,name:"New Neon Club",sourceUrl}).returning();
      await db.insert(competitionTeams).values({competitionId:competition!.id,teamId:row!.id,sourceUrl});
      const c=await getNeonReportCatalog(db,"IBL:50231");assert.ok(c.clubs.some(c=>c.slug==="new-neon-club"));
      const b=(await getNeonClubReport(db,"IBL:50231",sourceId))!;
      assert.equal(b.report.games.length,0);assert.equal(b.report.perGame.points,null);
    });
    await t.test("subsequent database changes are observed, while broken box scores are excluded with an explicit reason", async () => {
      const renamed = playerIds.get("1438077")!;
      await db.update(players).set({ name: "Changed in database" }).where(eq(players.id, renamed));
      let b = (await getNeonClubReport(db, "IBL:50231", "126042"))!;
      assert.ok(b.report.players.some(p => p.name === "Changed in database"));
      const gameId = gameIds.get("2938930")!;
      await db.update(teamGameStats).set({ points: sql`${teamGameStats.points} + 1` }).where(eq(teamGameStats.gameId, gameId));
      b = (await getNeonClubReport(db, "IBL:50231", "126042"))!;
      assert.equal(b.report.games.length, 1); assert.equal(b.report.perGame.points, 66);
      assert.equal(b.unavailableGames.length, 1); assert.equal(b.unavailableGames[0]!.gameId, "2938930");
      assert.equal((await getNeonReportCatalog(db, "IBL:50231")).cards.find(c => c.sourceId === "126042")!.games, 1);
    });
    await t.test("database failures reject the read instead of returning a local snapshot", async () => {
      await client.close();
      await assert.rejects(() => getNeonReportCatalog(db, "IBL:50231"));
    });
  } finally { if (!client.closed) await client.close(); }
});
