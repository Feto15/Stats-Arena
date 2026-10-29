import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq, and } from "drizzle-orm";
import { schema, competitions, competitionTeams, teams, games, players, playerGameStats, teamGameStats, importRuns, sourceFetches, shots, authRateLimits, authUsers } from "@statsarena/db";
import { BASE_STAT_FIELDS, type Stats } from "@statsarena/db/analytics";
import { buildDetailQuality } from "@statsarena/db/data-quality";
import type { ReportViewer } from "../lib/auth/policy";
import { clubStatistics, visibleCompetitions, visibleTeams, playerStatistics, gameStatistics, gameShotChart, listClubGames } from "../lib/mcp/queries";
import { consumeMcpRateLimit } from "../lib/mcp/access";
import { permittedOAuthRedirect } from "../lib/mcp/oauth-flow-client";
import { reportAccess } from "../lib/reports/reports-access";
import { readGrantChoices } from "../lib/auth/grant-catalog";

const stats = (made = 1, attempts = 2): Stats => ({ ...Object.fromEntries(BASE_STAT_FIELDS.map(k => [k,0])), minutes: 40, points: made*2, fieldGoalsMade: made, fieldGoalsAttempted: attempts, twoPointsMade: made, twoPointAttempts: attempts,
  threePointsMade: 0, threePointAttempts: 0, freeThrowsMade: 0, freeThrowAttempts: 0, rebounds: 1, offensiveRebounds: 0, defensiveRebounds: 1, assists: 1, steals: 0, blocks: 0, turnovers: 0, personalFouls: 0 });
const viewer: ReportViewer = { id: "coach", name: "Coach", email: "coach@example.test", isAdmin: false, grants: [{ competitionKey: "901", clubSourceId: "11" }] };
const paged = { limit: 25, offset: 0 }, scope = { competition: "901", club: "11" };

test("MCP queries isolate clubs and namespaces, preserve weighted analytics and expose only scoped, validated detail", async t => {
  const client = new PGlite(), db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../packages/db/drizzle", import.meta.url)), migrationsSchema: "statsarena", migrationsTable: "__drizzle_migrations" });
  const teamIds = new Map<string,string>(), playerIds = new Map<string,string>(), gameIds = new Map<string,string>();
  const root = "https://hosted.dcd.shared.geniussports.com/IBF/en/competition/901";
  try {
    const [competition] = await db.insert(competitions).values({ sourceCompetitionId: "901", sourceUrl: root, name: "Scope test" }).returning();
    await db.insert(competitions).values({ source: "genius_sports:IBL", sourceCompetitionId: "901", sourceUrl: root.replace("/IBF/", "/IBL/"), name: "Other namespace" });
    for (const sourceId of ["11","22","33","44"]) {
      const [row] = await db.insert(teams).values({ sourceTeamId: sourceId, name: `Club ${sourceId}`, sourceUrl: `${root}/team/${sourceId}` }).returning();
      teamIds.set(sourceId,row!.id);
      await db.insert(competitionTeams).values({ competitionId: competition!.id, teamId: row!.id, sourceUrl: row!.sourceUrl });
      for (let i=1;i<=5;i++) {
        const id = `${sourceId}0${i}`;
        const [player] = await db.insert(players).values({ sourcePlayerId: id, sourceUrl: `${root}/person/${id}`, name: `Player ${id}` }).returning();
        playerIds.set(id,player!.id);
      }
    }
    for (const [id,home,away] of [["1001","11","22"],["1002","22","11"],["1003","11","33"],["1004","33","44"]]) {
      const scheduled = id === "1003", score = (team: string) => id === "1002" && team === "11" ? 20 : 10;
      const [game] = await db.insert(games).values({ competitionId: competition!.id, sourceGameId: id!, sourceUrl: `${root}/match/${id}/summary`, homeTeamId: teamIds.get(home!)!, awayTeamId: teamIds.get(away!)!,
        status: scheduled ? "scheduled" : "complete", homeScore: scheduled ? null : score(home!), awayScore: scheduled ? null : score(away!), detailParserVersion: "test/parser" }).returning();
      gameIds.set(id!,game!.id);
      if (scheduled) continue;
      const [run] = await db.insert(importRuns).values({ competitionId: competition!.id, mode: "sync", status: "succeeded", parserVersion: "test/parser" }).returning();
      const [fetch] = await db.insert(sourceFetches).values({ competitionId: competition!.id, importRunId: run!.id, resource: "boxscore", requestUrl: `${root}/match/${id}/boxscore`, fetchStatus: "succeeded", parseStatus: "parsed", requestedAt: new Date(), fetchedAt: new Date(), sha256: "a".repeat(64) }).returning();
      await db.update(games).set({ lastBoxscoreFetchId: fetch!.id }).where(eq(games.id,game!.id));
      for (const team of [home!,away!]) {
        const line = stats(id === "1002" && team === "11" ? 2 : 1, id === "1002" && team === "11" ? 6 : 2);
        const totals = Object.fromEntries(BASE_STAT_FIELDS.map(key => [key, line[key]! * 5])) as Stats;
        await db.insert(teamGameStats).values({ ...totals, gameId: game!.id, teamId: teamIds.get(team)! });
        for (let i=1;i<=5;i++) await db.insert(playerGameStats).values({ ...line, gameId: game!.id, teamId: teamIds.get(team)!, playerId: playerIds.get(`${team}0${i}`)!, jerseyNumber: String(i), minutesRaw: "40:00", sourceUrl: fetch!.requestUrl });
      }
    }
    await t.test("lists expose only permitted competition and club; another namespace and another club are denied", async () => {
      assert.deepEqual((await visibleCompetitions(db,viewer,paged)).items.map(r => r.id),["901"]);
      assert.deepEqual((await visibleTeams(db,viewer,"901",paged)).items.map(r => r.id),["11"]);
      await assert.rejects(() => visibleTeams(db,viewer,"IBL:901",paged),/admin/);
      await assert.rejects(() => clubStatistics(db,viewer,{ ...scope,club:"33" }),/admin/);
      await assert.rejects(() => clubStatistics(db,viewer,{ ...scope,competition:"IBL:901" }),/admin/);
      assert.equal((await visibleCompetitions(db,{...viewer,isAdmin:true},paged)).items.length,2);
      await db.insert(authUsers).values([{id:"admin",name:"Admin",email:"admin@example.test",isAdmin:true},{id:"coach",name:"Coach",email:"coach@example.test"}]);
      await assert.rejects(()=>readGrantChoices(db,"coach","901"),/admin/);
      const catalog=await readGrantChoices(db,"admin","901");assert.equal(catalog.competitions.length,2);assert.equal(catalog.clubs.length,4);
      assert.equal((await readGrantChoices(db,"admin","IBL:901")).clubs.length,0);
    });
    await t.test("team and player aggregates use exact matched-game totals, scheduled games stay excluded and opponent players stay private", async () => {
      const report = await clubStatistics(db,viewer,scope);
      assert.equal(report.totals.points,30); assert.equal(report.totals.fieldGoalsAttempted,40); assert.equal(report.advancedStats.trueShootingPercentage,37.5);
      assert.deepEqual(report.scope.gameIds,["1001","1002"]); assert.equal(report.scope.excludedGames[0]!.reason,"scheduled");
      const result = await playerStatistics(db,viewer,{...scope,...paged,player:"1101"}); assert.equal(result.items[0]!.totals.points,6); assert.equal(result.items[0]!.advancedStats.trueShootingPercentage,37.5);
      assert.equal(result.items[0]!.gamesPlayed,2); assert.equal(result.provenance.length,2);
      await assert.rejects(() => playerStatistics(db,viewer,{...scope,...paged,player:"2201"}),/belum tersedia/);
      assert.equal((await listClubGames(db,viewer,{...scope,...paged})).items.length,3);
      await assert.rejects(() => gameStatistics(db,viewer,{...scope,game:"1004"}),/belum tersedia/);
      const game = await gameStatistics(db,viewer,{...scope,game:"1001"}); assert.equal(game.players?.length,5); assert.ok(game.players?.every(p => p.id.startsWith("11")));
      const scheduled = await gameStatistics(db,viewer,{...scope,game:"1003"}); assert.equal(scheduled.boxScoreAvailable,false); assert.equal(scheduled.players,null); assert.equal(scheduled.team,null);
    });
    await t.test("shot markers are scoped and checked against FGA/FGM; quality returns codes without raw private diagnostics", async () => {
      const game = gameIds.get("1001")!;
      const [fetch] = await db.insert(sourceFetches).values({competitionId:competition!.id,resource:"shotchart",requestUrl:`${root}/match/1001/shotchart`,fetchStatus:"succeeded",parseStatus:"parsed",requestedAt:new Date(),fetchedAt:new Date(),sha256:"b".repeat(64)}).returning();
      for(let n=0;n<10;n++)await db.insert(shots).values({gameId:game,teamId:teamIds.get("11")!,playerId:playerIds.get(`110${n%5+1}`)!,sourceSequence:n,periodNumber:1,shotType:"2pt",result:n<5?"made":"missed",xRaw:"20%",yRaw:"30%",xPercent:20,yPercent:30,rawTitle:"source",sourceUrl:fetch!.requestUrl,sourceFetchId:fetch!.id,parserVersion:"test/parser"});
      await db.update(games).set({detailQuality:buildDetailQuality({shotChart:"fetch_failed"},[{code:"FETCH_FAILED",severity:"error",message:"private-transport-diagnostic",sourceUrl:fetch!.requestUrl,fieldPath:null,expected:null,actual:null}])}).where(eq(games.id,game));
      const chart=await gameShotChart(db,viewer,{...scope,...paged,game:"1001"}); assert.equal(chart.available,true); assert.equal(chart.items?.length,10);
      const filtered=await gameShotChart(db,viewer,{...scope,...paged,game:"1001",player:"1101"});assert.equal(filtered.items?.length,2);
      await assert.rejects(()=>gameShotChart(db,viewer,{...scope,...paged,game:"1001",player:"2201"}),/belum tersedia/);
      await db.update(shots).set({parserVersion:"other/parser"}).where(and(eq(shots.gameId,game),eq(shots.sourceSequence,0)));
      assert.equal((await gameShotChart(db,viewer,{...scope,...paged,game:"1001"})).available,false);
      await db.update(shots).set({parserVersion:"test/parser"}).where(and(eq(shots.gameId,game),eq(shots.sourceSequence,0)));
      await assert.rejects(()=>listClubGames(db,viewer,{...scope,...paged},true),/hanya tersedia untuk admin/);
      const adminViewer={...viewer,isAdmin:true};
      const quality=await listClubGames(db,adminViewer,{...scope,...paged},true);assert.ok(!JSON.stringify(quality).includes("private-transport-diagnostic"));assert.ok(JSON.stringify(quality).includes("FETCH_FAILED"));
      assert.equal("observedQuality" in chart,false);
      assert.equal("datasets" in await gameStatistics(db,viewer,{...scope,game:"1001"}),false);
      assert.equal("datasets" in await gameStatistics(db,adminViewer,{...scope,game:"1001"}),true);
      const adminChart=await gameShotChart(db,adminViewer,{...scope,...paged,game:"1001"});assert.ok("observedQuality" in adminChart);assert.equal(adminChart.observedQuality?.issues[0]?.code,"FETCH_FAILED");
      assert.ok(!JSON.stringify(await listClubGames(db,viewer,{...scope,...paged})).includes("FETCH_FAILED"));
      await db.delete(shots).where(and(eq(shots.gameId,game),eq(shots.sourceSequence,0)));
      const broken=await gameShotChart(db,viewer,{...scope,...paged,game:"1001"});assert.equal(broken.available,false);assert.equal(broken.items,null);
    });
    await t.test("missing minutes invalidate only minute-dependent metrics; corrected scores exclude incompatible stored box scores", async () => {
      await db.update(playerGameStats).set({minutes:null,minutesRaw:null}).where(and(eq(playerGameStats.gameId,gameIds.get("1002")!),eq(playerGameStats.playerId,playerIds.get("1102")!)));
      const players=await playerStatistics(db,viewer,{...scope,...paged,player:"1101"});assert.equal(players.items[0]!.advancedStats.trueShootingPercentage,37.5);assert.equal(players.items[0]!.advancedStats.usagePercentage,null);
      await db.update(games).set({homeScore:99}).where(eq(games.id,gameIds.get("1001")!));
      const report=await clubStatistics(db,viewer,scope);assert.deepEqual(report.scope.gameIds,["1002"]);assert.equal(report.scope.excludedGames.find(g=>g.game==="1001")?.reason,"valid_boxscore_unavailable");
    });
    await t.test("the shared database rate limit counts concurrent calls and resets its fixed window", async () => {
      await Promise.all(Array.from({length:60},()=>consumeMcpRateLimit(db,"rate-test")));
      await assert.rejects(()=>consumeMcpRateLimit(db,"rate-test"),/Batas/);
      await db.update(authRateLimits).set({lastRequest:Date.now()-61_000}).where(eq(authRateLimits.key,"mcp:rate-test"));
      await consumeMcpRateLimit(db,"rate-test");
      assert.equal((await db.select().from(authRateLimits).where(eq(authRateLimits.key,"mcp:rate-test")))[0]?.count,1);
    });
  } finally {await client.close();}
});

test("MCP routes survive reports-only mode without opening unrelated APIs, and OAuth redirects stay bound to the registered callback",()=>{
  for(const path of ["/api/mcp","/mcp/login","/mcp/consent","/mcp/connections","/.well-known/oauth-protected-resource/api/mcp","/.well-known/oauth-authorization-server/api/auth"])assert.equal(reportAccess(path,true),"allow");
  for(const path of ["/api/mcp/delete","/api/private","/mcp/admin","/.well-known/private","/.well-known/openid-configuration","/.well-known/openid-configuration/api/auth"])assert.equal(reportAccess(path,true),"deny");
  const query=new URLSearchParams({redirect_uri:"https://chatgpt.com/connector/oauth/test?x=1"}).toString();
  assert.equal(permittedOAuthRedirect("https://chatgpt.com/connector/oauth/test?x=1&code=test",query,"https://statsarena.example"),true);
  for(const value of ["https://foreign.invalid/","//foreign.invalid","https://chatgpt.com/other?x=1","https://statsarena.example/admin/access"])assert.equal(permittedOAuthRedirect(value,query,"https://statsarena.example"),false);
});
