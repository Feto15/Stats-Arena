import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import type { StatsArenaDatabase } from "@statsarena/db";
import * as tables from "@statsarena/db/schema";
import { coreFields, parseLiveStatsJson, mergeSupplement, type PortalContext, type PortalCore } from "../src/livestats/parser.js";
import { LiveStatsClient, LiveStatsFetchError } from "../src/livestats/client.js";
import { discoverLiveStatsData, liveStatsPageUrl, validateLiveStatsUrl } from "../src/livestats/source.js";
import { syncLiveStatsCompetition, LiveStatsSyncError } from "../src/livestats/sync.js";
import { acquireSyncLease } from "../src/operations/lease.js";
import { parseBoxScoreHtml } from "../src/parsers/boxscore.js";
import { loadHtmlFixture } from "./fixtures.js";

function fixture(file: string): string { return gunzipSync(readFileSync(new URL(`fixtures/livestats-2026-10-16/${file}`, import.meta.url))).toString("utf8"); }
const base = "https://hosted.dcd.shared.geniussports.com/IBF/en/competition/49607";
function portal(id = "2931666", competition = base): PortalContext {
  const html = id === "2783625" || id === "2915281" ? fixture(`${id}-portal-boxscore.html.gz`) : loadHtmlFixture(`49607-${id}-boxscore.html.gz`);
  const box = parseBoxScoreHtml(html, `${competition}/match/${id}/boxscore`).records[0]!;
  function core(row: PortalCore) { return Object.fromEntries(Object.keys(coreFields).map(key => [key, row[key as keyof PortalCore]])) as PortalCore; }
  return { gameId: id, sourceGameId: id, competitionUrl: competition, status: "complete", homeTeamId: box.teams[0]!.teamSourceId, awayTeamId: box.teams[1]!.teamSourceId,
    homeScore: box.teams[0]!.points, awayScore: box.teams[1]!.points,
    teams: box.teams.map(t => ({ ...core(t), teamId: t.teamSourceId, name: t.teamName })),
    players: box.players.map(p => ({ ...core(p), playerId: p.playerSourceId, teamId: p.teamSourceId, name: p.playerName, jerseyNumber: p.jerseyNumber })) };
}

test("real DBL male/female and IBL JSON enrich portal identities, preserving explicit zero", () => {
  for (const [id, competition] of [["2931666", base], ["2915281", base.replace("49607", "49609")], ["2783625", base.replace("/IBF/", "/IBL/").replace("49607", "47793")]]) {
    const report = parseLiveStatsJson(JSON.parse(fixture(`${id}.json.gz`)) as unknown, portal(id, competition));
    assert.equal(report.status, "ready", JSON.stringify(report.issues));
    assert.equal(report.payload!.players.length, 24);
    assert.equal(report.payload!.players.filter(p => p.starter).length, 10);
    assert.equal(report.payload!.players.filter(p => p.plusMinus !== null).length, 24);
    assert.deepEqual(report.payload!.teams.map(t => t.benchPoints), id === "2931666" ? [3, 28] : id === "2915281" ? [0, 1] : [9, 4]);
  }
});

test("mapping rejects changed totals, missing/ambiguous players and conflicting core stats", () => {
  const context = portal();
  const original: unknown = JSON.parse(fixture("2931666.json.gz"));
  for (const changed of [
    { ...context, homeScore: 999 },
    { ...context, players: context.players.slice(1) },
    { ...context, players: [...context.players, { ...context.players[0]!, playerId: "other" }] },
    { ...context, players: context.players.map((p, i) => i === 0 ? { ...p, points: 999 } : p) }
  ]) {
    const report = parseLiveStatsJson(original, changed);
    if (changed.homeScore === 999) { assert.equal(report.status, "mismatch"); assert.equal(report.payload, null); }
    else { assert.equal(report.status, "partial"); assert.ok(report.payload); assert.ok(report.payload.players.length < 24); }
    assert.ok(report.issues.length);
  }
  assert.throws(() => parseLiveStatsJson({ tm: { "1": { name: "Wrong", score: "25", pl: {} } } }, context));
});

test("real 2026 structured names resolve shortened family names while jersey, uniqueness and core stats remain mandatory", () => {
  const core = z.record(z.enum(["points", "fieldGoalsMade", "fieldGoalsAttempted", "twoPointsMade", "twoPointAttempts", "threePointsMade", "threePointAttempts", "freeThrowsMade", "freeThrowAttempts", "offensiveRebounds", "defensiveRebounds", "rebounds", "assists", "steals", "blocks", "turnovers", "personalFouls"]), z.number().nullable());
  const contextSchema = z.object({ gameId:z.string(),sourceGameId:z.string(),competitionUrl:z.url(),homeTeamId:z.string(),awayTeamId:z.string(),homeScore:z.number(),awayScore:z.number(),status:z.string(),
    teams:z.array(core.and(z.object({teamId:z.string(),name:z.string()}))),players:z.array(core.and(z.object({playerId:z.string(),teamId:z.string(),name:z.string(),jerseyNumber:z.string().nullable()}))) });
  const rawSchema=z.object({tm:z.record(z.string(),z.object({pl:z.record(z.string(),z.record(z.string(),z.unknown()))}).passthrough())}).passthrough();
  for (const [id, players] of [["2938930", ["2483655","2842017"]], ["2945705", ["2384249"]]] as const) {
    const parsed:unknown=JSON.parse(gunzipSync(readFileSync(new URL(`fixtures/livestats-2026-10-25-aliases/${id}.json.gz`,import.meta.url))).toString("utf8"));
    const fixture=z.object({source:z.object({jsonUrl:z.url(),sha256:z.string().regex(/^[a-f0-9]{64}$/)}),portal:contextSchema,liveStats:rawSchema}).parse(parsed);
    assert.equal(fixture.source.jsonUrl,`https://fibalivestats.dcd.shared.geniussports.com/data/${id}/data.json`);
    const result=parseLiveStatsJson(fixture.liveStats,fixture.portal);
    assert.equal(result.status,"ready",JSON.stringify(result.issues));assert.equal(result.payload!.players.length,24);
    for(const target of players){
      const matched=result.payload!.players.find(p=>p.playerId===target)!;assert.ok(matched);
      const row=fixture.portal.players.find(p=>p.playerId===target)!;
      assert.equal(matched.name,row.name,"canonical source name must not be replaced with an invented alias");
      for(const altered of [
        {...fixture.portal,players:fixture.portal.players.map(p=>p===row?{...p,jerseyNumber:"999"}:p)},
        {...fixture.portal,players:fixture.portal.players.map(p=>p===row?{...p,points:(p.points??0)+1}:p)},
        {...fixture.portal,players:[...fixture.portal.players,{...row,playerId:"ambiguous"}]}
      ]){const rejected=parseLiveStatsJson(fixture.liveStats,altered);assert.equal(rejected.status,"partial");assert.ok(!rejected.payload!.players.some(p=>p.playerId===target));}
      const missing=structuredClone(fixture.liveStats);const raw=missing.tm[matched.localTeamKey]!.pl[matched.localPlayerKey]!;
      raw["internationalFamilyName"]="Other Family";
      assert.ok(!parseLiveStatsJson(missing,fixture.portal).payload!.players.some(p=>p.playerId===target),"missing full family evidence cannot be repaired by fuzzy matching");
    }
  }
});

test("PIP/PFT/FBP conflicts are recorded independently without replacing either source", () => {
  const context = portal();
  const source: unknown = JSON.parse(fixture("2931666.json.gz"));
  const matched = parseLiveStatsJson(source, context);
  const team = matched.payload!.teams[0]!;
  const altered = { ...context, officialMetrics: [
    { teamId: team.teamId, metricCode: "PIP", value: 0 },
    { teamId: team.teamId, metricCode: "PFT", value: 999 },
    { teamId: team.teamId, metricCode: "FBP", value: team.fastBreakPoints },
    { teamId: team.teamId, metricCode: "BP", value: null }
  ] };
  const report = parseLiveStatsJson(source, altered);
  assert.equal(report.status, "partial");
  const conflicts = report.issues.filter(i => i.code === "LIVESTATS_OFFICIAL_METRIC_CONFLICT");
  assert.equal(conflicts.length, 2);
  assert.equal(conflicts.find(i => i.field.endsWith(".PIP"))!.expected, 0);
  assert.equal(report.payload!.teams[0]!.pointsInPaint, team.pointsInPaint);
  assert.equal(altered.officialMetrics[0]!.value, 0);
});

test("missing optional values remain null, invalid fields need review and never erase verified values", () => {
  const raw: unknown = JSON.parse(fixture("2931666.json.gz"));
  // Test mutations operate on validated fixture objects, not production assertions.
  const data = raw as { tm: Record<string, { pl: Record<string, Record<string, unknown>> }> };
  const player = Object.values(data.tm["1"]!.pl)[0]!;
  const before = parseLiveStatsJson(raw, portal()).payload!;
  player["sPlusMinusPoints"] = null; player["playingPosition"] = ""; player["sBlocksReceived"] = -1;
  const report = parseLiveStatsJson(raw, portal());
  assert.equal(report.status, "partial"); assert.equal(report.payload!.players[0]!.plusMinus, null);
  const merged = mergeSupplement(before, report.payload!);
  assert.equal(merged.players[0]!.plusMinus, before.players[0]!.plusMinus);
  assert.equal(merged.players[0]!.position, before.players[0]!.position);
});

test("LiveStats discovery rejects namespace, competition, match and path substitutions", () => {
  const html = fixture("2931666-bs.html.gz"), page = liveStatsPageUrl(base, "2931666");
  assert.equal(discoverLiveStatsData(html, page, base, "2931666"), "https://fibalivestats.dcd.shared.geniussports.com/data/2931666/data.json");
  for (const url of [page.replace("https:", "http:"), page.replace(".com/", ".com.evil.test/"), page.replace("/bs.html", "/p.html"), `${page}?url=http://localhost`, page.replace("https://", "https://user:pass@")]) assert.throws(() => validateLiveStatsUrl(url));
  assert.throws(() => discoverLiveStatsData(html, page.replace("/IBF/", "/IBL/"), base, "2931666"));
  assert.throws(() => discoverLiveStatsData(html.replace('value = "49607"', 'value = "49609"'), page, base, "2931666"));
  assert.throws(() => discoverLiveStatsData(html.replace('/data/2931666/', '//localhost/'), page, base, "2931666"));
});

test("LiveStats fetch bounds responses, retries transient failures and stops on unavailable pages", async () => {
  const directory = await mkdtemp(join(tmpdir(), "livestats-fetch-"));
  try {
    const url = liveStatsPageUrl(base, "2931666"); let calls = 0;
    const transient = new LiveStatsClient(directory, async () => { calls++; return calls === 1 ? new Response("busy", { status: 503 }) : new Response(fixture("2931666-bs.html.gz")); }, async () => undefined);
    const response = await transient.get(url); await transient.accept(response);
    assert.equal(calls, 2); assert.equal((await transient.get(url, 86_400_000)).cached, true); assert.equal(calls, 2);
    const unavailable = new LiveStatsClient(directory, async () => { calls++; return new Response("denied", { status: 403 }); }, async () => undefined);
    await assert.rejects(unavailable.get(url), (error: unknown) => error instanceof LiveStatsFetchError && error.status === 403);
    assert.equal(calls, 3);
    const oversized = new LiveStatsClient(directory, async () => new Response("x".repeat(4 * 1024 * 1024 + 1)), async () => undefined);
    await assert.rejects(oversized.get(url), /4 MiB/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("immutable provenance survives cache rotation; compaction protects referenced revisions and corrupt cache recovers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "livestats-retention-"));
  try {
    const url = "https://fibalivestats.dcd.shared.geniussports.com/data/2931666/data.json";
    let body = '{"revision":1}';
    const client = new LiveStatsClient(directory, async () => new Response(body), async () => undefined);
    const first = await client.get(url); await client.accept(first);
    await rm(first.snapshotPath);
    const cachedAlias = await client.readSnapshot(url); assert.ok(cachedAlias);
    await client.accept(cachedAlias); assert.ok((await stat(first.snapshotPath)).size,"cache-only import creates immutable evidence before storing its path");
    body = '{"revision":2}'; const second = await client.get(url); await client.accept(second);
    body = '{"revision":3}'; const third = await client.get(url); await client.accept(third);
    await client.compact(url, [first.hash]);
    assert.equal(JSON.parse(gunzipSync(await readFile(first.snapshotPath)).toString()).body, '{"revision":1}');
    assert.ok((await stat(second.snapshotPath)).size); assert.ok((await stat(third.snapshotPath)).size);
    await client.compact(url);
    await assert.rejects(stat(first.snapshotPath), { code: "ENOENT" });
    const currentPath = third.snapshotPath.replace(`${third.hash}.json.gz`, "current.json.gz");
    await writeFile(currentPath, "corrupt");
    const recovered = await client.get(url, 86_400_000); assert.equal(recovered.cached, false);
    await client.accept(recovered); assert.equal((await client.get(url, 86_400_000)).cached, true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("LiveStats migration/import is idempotent, scoped, preserves good data, supports dry-run and rolls back", async () => {
  const client = new PGlite(); const root = await mkdtemp(join(tmpdir(), "livestats-import-"));
  const directory = join(root, "livestats");
  const catalog = { path: join(root, "competitions_catalog.json"), projectRoot: root, snapshotDirectory: root };
  try {
    await migrate(drizzle(client), { migrationsFolder: fileURLToPath(new URL("../../packages/db/drizzle", import.meta.url)), migrationsSchema: "statsarena", migrationsTable: "__drizzle_migrations" });
    const db = drizzle(client, { schema: tables.schema }) as unknown as StatsArenaDatabase;
    const context = portal();
    const [competition] = await db.insert(tables.competitions).values({ sourceCompetitionId: "49607", sourceUrl: base, name: "Jogja" }).returning();
    const teamMap = new Map<string, string>();
    for (const t of context.teams) { const [saved] = await db.insert(tables.teams).values({ sourceTeamId: t.teamId, name: t.name, sourceUrl: `${base}/team/${t.teamId}` }).returning(); teamMap.set(t.teamId, saved!.id); }
    const [game] = await db.insert(tables.games).values({ competitionId: competition!.id, sourceGameId: "2931666", sourceUrl: `${base}/match/2931666/summary`, homeTeamId: teamMap.get(context.homeTeamId!)!, awayTeamId: teamMap.get(context.awayTeamId!)!, homeScore: 25, awayScore: 45, status: "complete" }).returning();
    for (const t of context.teams) {
      const stats = Object.fromEntries(Object.keys(coreFields).map(key => [key, t[key as keyof PortalCore]])) as PortalCore;
      await db.insert(tables.teamGameStats).values({ ...stats, gameId: game!.id, teamId: teamMap.get(t.teamId)! });
    }
    for (const { playerId, teamId, name, ...stats } of context.players) {
      const [player] = await db.insert(tables.players).values({ sourcePlayerId: playerId, name, sourceUrl: `${base}/person/${playerId}` }).returning();
      await db.insert(tables.playerGameStats).values({ ...stats, playerId: player!.id, teamId: teamMap.get(teamId)!, gameId: game!.id, sourceUrl: `${base}/person/${playerId}` });
    }
    const before = await db.select().from(tables.playerGameStats);
    let denied = false;
    const source = new LiveStatsClient(directory, async input => denied ? new Response("denied", { status: 403 }) : new Response(String(input).endsWith(".json") ? fixture("2931666.json.gz") : fixture("2931666-bs.html.gz")), async () => undefined);
    const dry = await syncLiveStatsCompetition(db, "49607", directory, { dryRun: true, client: source, catalog });
    assert.equal(dry.statuses.ready, 1); assert.equal((await db.select().from(tables.gameLiveStats)).length, 0);
    const indexed = JSON.parse(await readFile(catalog.path, "utf8")).competitions[0];
    assert.equal(indexed.name, "Jogja");
    assert.match(indexed.liveStatsFiles["2931666"], /\.current\.json\.gz$/);
    assert.equal(indexed.latestSuccessfulImportAt, undefined);
    const lease = await acquireSyncLease(db, "49607");
    const guard = async (tx?: Parameters<typeof lease.guardTransaction>[0]) => tx ? lease.guardTransaction(tx) : lease.assertOwned();
    try {
      await assert.rejects(syncLiveStatsCompetition(db, "49607", directory, { client: source, guard: async () => { throw new Error("rollback"); } }), LiveStatsSyncError);
      assert.equal((await db.select().from(tables.gameLiveStats)).length, 0);
      const first = await syncLiveStatsCompetition(db, "49607", directory, { client: source, guard }); assert.equal(first.written, 1);
      const saved = (await db.select().from(tables.gameLiveStats))[0]!;
      const repeat = await syncLiveStatsCompetition(db, "49607", directory, { client: source, guard, forceRefresh: true });
      assert.equal(repeat.unchanged, 1); assert.equal(repeat.written, 0);
      assert.equal((await db.select().from(tables.gameLiveStats))[0]!.updatedAt.getTime(), saved.updatedAt.getTime());
      assert.equal((await syncLiveStatsCompetition(db, "49607", directory, { client: source, guard })).selected, 0);
      await assert.rejects(syncLiveStatsCompetition(db, "49607", directory, { client: source, forceRefresh: true, guard: async () => { throw new Error("rollback of ready refresh"); } }), LiveStatsSyncError);
      assert.equal((await syncLiveStatsCompetition(db, "49607", directory, { client: source, guard })).selected, 1);
      const noHttp = new LiveStatsClient(directory, async () => { throw new Error("HTTP must not run in snapshot-only mode"); });
      const offline = await syncLiveStatsCompetition(db, "49607", directory, { client: noHttp, guard, snapshotOnly: true, now: new Date(Date.now() + 2 * 86_400_000) });
      assert.equal(offline.statuses.ready, 1); assert.equal(offline.unchanged, 1);
      const missing = await syncLiveStatsCompetition(db, "49607", join(root, "missing"), { client: new LiveStatsClient(join(root,"missing"), async () => { throw new Error("HTTP forbidden"); }), guard, snapshotOnly: true, now: new Date(Date.now() + 4 * 86_400_000) });
      assert.equal(missing.statuses.fetch_failed, 1);
      assert.deepEqual((await db.select().from(tables.gameLiveStats))[0]!.payload, saved.payload);
      denied = true;
      await syncLiveStatsCompetition(db, "49607", directory, { client: source, guard, forceRefresh: true });
      const preserved = (await db.select().from(tables.gameLiveStats))[0]!;
      assert.equal(preserved.status, "unavailable"); assert.deepEqual(preserved.payload, saved.payload); assert.equal(preserved.sourceHash, saved.sourceHash);
      assert.deepEqual(await db.select().from(tables.playerGameStats), before);
      assert.equal((await db.select().from(tables.gameLiveStats).where(eq(tables.gameLiveStats.gameId, game!.id))).length, 1);
      await assert.rejects(syncLiveStatsCompetition(db, "IBL:49607", directory, { dryRun: true, client: source }), /sudah tersimpan/);
    } finally { await lease.release(); }
  } finally { await client.close(); await rm(root, { recursive: true, force: true }); }
});

test("rotation evidence retains exact source order and structured identity, survives shorter or missing revisions",()=>{
  const raw=JSON.parse(fixture("2931666.json.gz"));
  const first=parseLiveStatsJson(raw,portal()).payload!;
  assert.ok(first.rotation);assert.equal(first.rotation.events.length,raw.pbp.length);
  assert.equal(first.rotation.events[0]!["clock"],raw.pbp[0].clock);
  assert.equal(first.rotation.teams.flatMap(t=>t.players).length,24);
  assert.ok(first.rotation.teams.flatMap(t=>t.players).every(p=>p.minutesRaw!==null&&p.nameEvidence&&Object.keys(p.core).length===17));
  const shorter=structuredClone(raw);shorter.pbp=shorter.pbp.slice(1);
  assert.deepEqual(mergeSupplement(first,parseLiveStatsJson(shorter,portal()).payload!).rotation,first.rotation);
  const fewer=structuredClone(first);fewer.rotation!.teams[0]!.players.pop();
  assert.deepEqual(mergeSupplement(first,fewer).rotation,first.rotation);
  const missing=structuredClone(raw);delete missing.pbp;
  assert.deepEqual(mergeSupplement(first,parseLiveStatsJson(missing,portal()).payload!).rotation,first.rotation);
});
