import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { StatsArenaDatabase } from "@statsarena/db";
import { archivedImportRunIds, compactNeonAudit } from "../src/operations/neon-retention.js";

async function setup() {
  const client = new PGlite(); const local = drizzle(client);
  await migrate(local, { migrationsFolder: fileURLToPath(new URL("../../packages/db/drizzle", import.meta.url)), migrationsSchema: "statsarena" });
  const competition = randomUUID(); const run = randomUUID(); const latest = randomUUID();
  const sourceUrl = "https://hosted.dcd.shared.geniussports.com/IBF/en/competition/70001";
  await client.query("insert into statsarena.competitions (id,source_competition_id,name,source_url) values ($1,'70001','Test',$2)", [competition, sourceUrl]);
  for (const [id, age] of [[run, "10 days"], [latest, "1 minute"]]) {
    await client.query("insert into statsarena.import_runs (id,competition_id,mode,status,parser_version,started_at,finished_at) values ($1,$2,'sync','succeeded','0.2.2',now()-$3::interval,now()-$3::interval)", [id, competition, age]);
  }
  async function fetch(importRunId: string | null = run, overrides = "") {
    const id = randomUUID();
    await client.query(`insert into statsarena.source_fetches (id,import_run_id,competition_id,resource,request_url,fetch_status,parse_status,requested_at,sha256)
      values ($1,$2,$3,'boxscore',$4,'succeeded','parsed',now()-interval '5 days',repeat('a',64))`, [id, importRunId, competition, `${sourceUrl}/match/83001/boxscore`]);
    if (overrides) await client.query(`update statsarena.source_fetches set ${overrides} where id=$1`, [id]);
    return id;
  }
  return { client, db: local as unknown as StatsArenaDatabase, competition, run, latest, sourceUrl, fetch };
}

test("Neon retention preserves all source references, baselines, review, retry and archives; dry-run and cleanup are idempotent", async () => {
  const fixture = await setup(); const { client, db, competition, run, latest, sourceUrl, fetch } = fixture;
  const directory = await mkdtemp(join(tmpdir(), "statsarena-neon-retention-"));
  const backupPath = join(directory, "backup.json.gz");
  try {
    const deletable = await fetch();
    const references = await Promise.all(Array.from({ length: 6 }, () => fetch()));
    const baseline = randomUUID(); const summary = randomUUID(); const archive = randomUUID(); const warning = randomUUID(); const partial = randomUUID();
    for (const id of [baseline, archive, warning, partial]) {
      await client.query("insert into statsarena.import_runs (id,competition_id,mode,status,parser_version,started_at,finished_at) values ($1,$2,'sync','succeeded','0.2.2',now()-interval '8 days',now()-interval '8 days')", [id, competition]);
    }
    await client.query("update statsarena.import_runs set status='partial' where id=$1", [partial]);
    await client.query("insert into statsarena.import_runs (id,competition_id,mode,status,parser_version,started_at,finished_at,audit_kind,baseline_import_run_id) values ($1,$2,'sync','succeeded','0.2.2',now()-interval '7 days',now()-interval '7 days','summary',$3)", [summary, competition, baseline]);
    await client.query("insert into statsarena.validation_issues (import_run_id,competition_id,severity,code,message) values ($1,$2,'warning','REVIEW','Preserve')", [warning, competition]);
    const protectedFetches = [...references, await fetch(baseline), await fetch(archive), await fetch(warning), await fetch(partial),
      await fetch(run, "attempt_log='[{\"error\":\"timeout\"}]'::jsonb"), await fetch(run, "parse_status='partial'"),
      await fetch(run, "fetch_status='failed',parse_status='failed'"), await fetch(null), await fetch(latest)];
    const latestObservations = [await fetch(run, "requested_at=now()"), await fetch(run, "requested_at=now()-interval '1 second'")];
    const game = randomUUID(); const team = randomUUID(); const player = randomUUID(); const group = randomUUID();
    await client.query("insert into statsarena.games (id,competition_id,source_game_id,source_url,last_summary_fetch_id,last_boxscore_fetch_id) values ($1,$2,'83001',$3,$4,$5)", [game, competition, sourceUrl, references[0], references[1]]);
    await client.query("insert into statsarena.teams (id,source_team_id,name,source_url) values ($1,'81001','Team',$2)", [team, sourceUrl]);
    await client.query("insert into statsarena.players (id,source_player_id,name,source_url) values ($1,'82001','Player',$2)", [player, sourceUrl]);
    await client.query("insert into statsarena.competition_groups (id,competition_id,source_group_id,label,source_url) values ($1,$2,'g','Group',$3)", [group, competition, sourceUrl]);
    await client.query("insert into statsarena.group_standings (group_id,team_id,source_fetch_id) values ($1,$2,$3)", [group, team, references[2]]);
    await client.query("insert into statsarena.play_by_play_events (game_id,source_sequence,action_type,source_url,parser_version,source_fetch_id) values ($1,1,'shot',$2,'0.2.2',$3)", [game, sourceUrl, references[3]]);
    await client.query("insert into statsarena.shots (game_id,source_sequence,period_number,team_id,player_id,shot_type,result,x_raw,y_raw,x_percent,y_percent,raw_title,source_url,parser_version,source_fetch_id) values ($1,1,1,$2,$3,'2pt','made','50%','50%',50,50,'2PT made',$4,'0.2.2',$5)", [game, team, player, sourceUrl, references[4]]);
    await client.query("insert into statsarena.team_official_metrics (competition_id,scope_type,team_id,metric_code,availability,unit,source_url,parser_version,source_fetch_id) values ($1,'competition',$2,'BP','unavailable','points',$3,'0.2.2',$4)", [competition, team, sourceUrl, references[5]]);
    const options = { dryRun: true, protectedRunIds: [archive], backupPath };
    const preview = await compactNeonAudit(db, options);
    assert.equal(preview.candidates, 1); assert.equal(preview.deleted, 0);
    await assert.rejects(readFile(backupPath), { code: "ENOENT" });
    const applied = await compactNeonAudit(db, { ...options, dryRun: false });
    assert.equal(applied.deleted, 1); assert.equal(applied.domainUnchanged, true);
    const saved = JSON.parse(gunzipSync(await readFile(backupPath)).toString("utf8")) as { sourceFetches: Array<{ id: string }> };
    assert.deepEqual(saved.sourceFetches.map(row => row.id), [deletable]);
    const remaining = (await client.query<{ id: string }>("select id from statsarena.source_fetches")).rows.map(row => row.id);
    for (const id of [...protectedFetches, ...latestObservations]) assert.ok(remaining.includes(id));
    assert.equal((await compactNeonAudit(db, options)).candidates, 0);
  } finally { await client.close(); await rm(directory, { recursive: true, force: true }); }
});

test("Neon cleanup aborts on active sync, new FK or failed backup without deleting candidates", async () => {
  const { client, db, competition, run, fetch } = await setup();
  const directory = await mkdtemp(join(tmpdir(), "statsarena-neon-retention-")); const backupPath = join(directory, "backup.json.gz");
  const options = { dryRun: false, protectedRunIds: [], backupPath };
  try {
    await fetch(); await fetch(run, "requested_at=now()"); await fetch(run, "requested_at=now()-interval '1 second'");
    await client.query("insert into statsarena.sync_leases (source_competition_id,owner_id,hostname,process_id,expires_at) values ('70001',$1,'test',1,now()+interval '1 hour')", [randomUUID()]);
    await assert.rejects(compactNeonAudit(db, options), /Sinkronisasi aktif/);
    await client.exec("delete from statsarena.sync_leases");
    await client.query("update statsarena.import_runs set status='running',started_at=now() where id=$1", [run]);
    await assert.rejects(compactNeonAudit(db, options), /Sinkronisasi aktif/);
    await client.query("update statsarena.import_runs set status='succeeded',started_at=now()-interval '10 days' where id=$1", [run]);
    await client.exec("create table statsarena.new_provenance (id uuid references statsarena.source_fetches(id))");
    await assert.rejects(compactNeonAudit(db, options), /Referensi fetch berubah/);
    await client.exec("drop table statsarena.new_provenance");
    await writeFile(backupPath, "existing");
    await assert.rejects(compactNeonAudit(db, options), /EEXIST/);
    assert.equal((await compactNeonAudit(db, { ...options, dryRun: true })).candidates, 1);
    await client.query("update statsarena.competitions set source='other' where id=$1", [competition]);
    await assert.rejects(compactNeonAudit(db, options), /Target bukan dataset/);
  } finally { await client.close(); await rm(directory, { recursive: true, force: true }); }
});

test("Archive metadata is required to protect retained Neon import runs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "statsarena-neon-archives-"));
  try {
    const id = randomUUID();
    await writeFile(join(directory, "archive.json"), JSON.stringify({ auditType: "archive", imported: { importRunId: id } }));
    assert.deepEqual(await archivedImportRunIds(directory), [id]);
    await writeFile(join(directory, "archive.json"), JSON.stringify({ retention: "archive" }));
    await assert.rejects(archivedImportRunIds(directory), /Arsip tanpa identitas/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
