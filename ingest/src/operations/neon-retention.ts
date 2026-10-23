import { competitionReference } from "@statsarena/db/source";
import { sql, type SQL } from "drizzle-orm";
import type { StatsArenaDatabase } from "@statsarena/db";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";

const domainTables = ["competitions", "teams", "players", "competition_teams", "competition_players", "team_rosters",
  "competition_groups", "games", "game_livestats", "group_standings", "player_game_stats", "team_game_stats", "play_by_play_events", "shots", "team_official_metrics"];
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
type MaintenanceTransaction = Parameters<Parameters<StatsArenaDatabase["transaction"]>[0]>[0];

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Archives currently live in local audit metadata, not in a Neon archive column. */
export async function archivedImportRunIds(auditDirectory: string): Promise<string[]> {
  const ids = new Set<string>();
  for (const name of await readdir(auditDirectory)) {
    if (!name.endsWith(".json") || name.startsWith(".")) continue;
    const path = join(auditDirectory, name);
    if ((await stat(path)).size > 100 * 1024 * 1024) throw new Error("Audit terlalu besar untuk memeriksa perlindungan arsip.");
    const audit = object(JSON.parse(await readFile(path, "utf8")) as unknown);
    if (audit?.["auditType"] !== "archive" && audit?.["retention"] !== "archive") continue;
    const imported = object(audit["imported"]);
    const id = imported?.["importRunId"];
    if (typeof id !== "string" || !uuidPattern.test(id)) throw new Error("Arsip tanpa identitas import run; pembersihan Neon dibatalkan.");
    ids.add(id);
  }
  return [...ids];
}

export function neonFetchCandidates(protectedRunIds: string[] = []): SQL {
  if (protectedRunIds.some(id => !uuidPattern.test(id))) throw new Error("Identitas run yang dilindungi tidak valid.");
  const archiveCondition = protectedRunIds.length
    ? sql`f.import_run_id not in (${sql.join(protectedRunIds.map(id => sql`${id}::uuid`), sql`, `)})` : sql`true`;
  return sql`with ranked as (
    select sf.*, row_number() over (partition by competition_id, resource, request_url
      order by requested_at desc, created_at desc, id desc) as observation_rank
    from statsarena.source_fetches sf where fetch_status = 'succeeded' and parse_status = 'parsed'
  ), latest_runs as (
    select distinct on (competition_id) id from statsarena.import_runs
    order by competition_id, started_at desc, id desc
  )
  select f.id from ranked f
  join statsarena.import_runs r on r.id = f.import_run_id and r.competition_id = f.competition_id
  where f.competition_id is not null and f.observation_rank > 2
    and r.status = 'succeeded' and r.finished_at is not null
    and f.sha256 ~ '^[a-f0-9]{64}$' and f.error_text is null
    and not exists (select 1 from jsonb_array_elements(f.attempt_log) a where a->>'error' is not null)
    and ${archiveCondition}
    and not exists (select 1 from latest_runs lr where lr.id = f.import_run_id)
    and not exists (select 1 from statsarena.import_runs b where b.baseline_import_run_id = f.import_run_id)
    and not exists (select 1 from statsarena.validation_issues i where i.import_run_id = f.import_run_id and i.severity <> 'info')
    and not exists (select 1 from statsarena.games g where g.last_summary_fetch_id = f.id or g.last_boxscore_fetch_id = f.id)
    and not exists (select 1 from statsarena.group_standings s where s.source_fetch_id = f.id)
    and not exists (select 1 from statsarena.play_by_play_events e where e.source_fetch_id = f.id)
    and not exists (select 1 from statsarena.shots s where s.source_fetch_id = f.id)
    and not exists (select 1 from statsarena.team_official_metrics m where m.source_fetch_id = f.id)`;
}

async function rows(tx: MaintenanceTransaction, query: SQL): Promise<Record<string, unknown>[]> {
  const result: unknown = await tx.execute(query);
  const values = Array.isArray(result) ? result : object(result)?.["rows"];
  if (!Array.isArray(values) || values.some(value => !object(value))) throw new Error("Hasil pemeriksaan database tidak valid.");
  return values as Record<string, unknown>[];
}

async function domainState(tx: MaintenanceTransaction): Promise<Record<string, unknown>[]> {
  // Names are fixed repository constants; no external table identifiers enter SQL.
  return rows(tx, sql.join(domainTables.map(table => sql.raw(`select '${table}' as table_name, count(*)::int as rows,
    md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' order by id), '')) as fingerprint from statsarena.${table} t`)), sql` union all `));
}

export interface NeonCleanupOptions {
  dryRun: boolean;
  protectedRunIds: string[];
  backupPath: string;
}

/** Explicit maintenance only. Audit logs/issues remain intact; never prune on sync. */
export async function compactNeonAudit(db: StatsArenaDatabase, options: NeonCleanupOptions) {
  return db.transaction(async tx => {
    await tx.execute(sql`set local lock_timeout = '5s'`);
    await tx.execute(sql`set local statement_timeout = '90s'`);
    if (options.dryRun) await tx.execute(sql`set transaction isolation level repeatable read, read only`);
    else {
      // Block writers, including new lease owners, while planning and applying the deletion.
      const tables = ["sync_leases", "import_runs", "sync_runs", "source_fetches", "validation_issues", ...domainTables];
      await tx.execute(sql.raw(`lock table ${tables.map(table => `statsarena.${table}`).join(", ")} in share row exclusive mode`));
    }
    const target = await rows(tx, sql`select source, source_competition_id, source_url from statsarena.competitions`);
    if (!target.length || target.some((entry) => {
      try {
        const reference = competitionReference(String(entry["source_url"]));
        return reference.source !== entry["source"] || reference.id !== entry["source_competition_id"];
      } catch { return true; }
    })) throw new Error("Target bukan dataset StatsArena Genius Sports yang diharapkan.");
    const active = await rows(tx, sql`select 1 from statsarena.sync_leases where expires_at > now()
      union all select 1 from statsarena.import_runs where status = 'running' and started_at > now() - interval '1 hour'
      union all select 1 from statsarena.sync_runs where status = 'running' and heartbeat_at > now() - interval '5 minutes'`);
    if (active.length) throw new Error("Sinkronisasi aktif; pembersihan Neon ditunda.");
    const foreignKeys = await rows(tx, sql`select c.conrelid::regclass::text as table_name, a.attname as column_name
      from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
      where c.contype = 'f' and c.confrelid = 'statsarena.source_fetches'::regclass`);
    const expected = new Set(["games:last_summary_fetch_id", "games:last_boxscore_fetch_id", "group_standings:source_fetch_id",
      "play_by_play_events:source_fetch_id", "shots:source_fetch_id", "team_official_metrics:source_fetch_id"]);
    const actual = foreignKeys.map(row => `${String(row["table_name"]).replace(/^statsarena\./, "")}:${row["column_name"]}`);
    if (actual.length !== expected.size || actual.some(key => !expected.has(key))) throw new Error("Referensi fetch berubah; aturan pembersihan perlu diperbarui.");

    const before = await domainState(tx);
    const candidates = await rows(tx, neonFetchCandidates(options.protectedRunIds));
    const ids = candidates.map(row => String(row["id"]));
    const [auditCounts] = await rows(tx, sql`select (select count(*)::int from statsarena.source_fetches) as fetches,
      (select count(*)::int from statsarena.import_runs) as import_runs, (select count(*)::int from statsarena.sync_runs) as sync_runs,
      (select count(*)::int from statsarena.validation_issues) as issues`);
    const byCompetition = ids.length ? await rows(tx, sql`select c.source_competition_id, count(*)::int as candidates,
      sum(pg_column_size(f))::bigint::text as estimated_row_bytes
      from statsarena.source_fetches f join statsarena.competitions c on c.id = f.competition_id
      where f.id in (${sql.join(ids.map(id => sql`${id}::uuid`), sql`, `)}) group by c.source_competition_id order by c.source_competition_id`) : [];
    let deleted = 0;
    if (!options.dryRun && ids.length) {
      const backup = await rows(tx, sql`select * from statsarena.source_fetches where id in (${sql.join(ids.map(id => sql`${id}::uuid`), sql`, `)}) order by id`);
      await mkdir(dirname(options.backupPath), { recursive: true });
      await writeFile(options.backupPath, gzipSync(JSON.stringify({ kind: "neon-audit-cleanup-backup", createdAt: new Date().toISOString(),
        before, auditCounts, sourceFetches: backup })), { flag: "wx", mode: 0o600 });
      const removed = await rows(tx, sql`delete from statsarena.source_fetches where id in
        (${sql.join(ids.map(id => sql`${id}::uuid`), sql`, `)}) returning id`);
      deleted = removed.length;
      if (deleted !== ids.length) throw new Error("Jumlah penghapusan berbeda dari kandidat; transaksi dibatalkan.");
      const after = await domainState(tx);
      if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Data domain berubah; transaksi pembersihan dibatalkan.");
    }
    return { dryRun: options.dryRun, candidates: ids.length, deleted, byCompetition, auditCountsBefore: auditCounts,
      sourceFetchesAfter: Number(auditCounts?.["fetches"]) - deleted, domainUnchanged: true,
      protectedArchiveRuns: options.protectedRunIds.length, backupPath: deleted ? options.backupPath : null };
  });
}
