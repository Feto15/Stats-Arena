import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { StatsArenaDatabase } from "@statsarena/db";
import type { ReviewIssueListItem, ReviewSummary } from "./contracts";

export type ReviewFilters = { page: number; severity?: "info" | "warning" | "error"; code?: string; source?: "portal" | "livestats" };
const statusSchema = z.enum(["ready", "partial", "mismatch", "unavailable", "fetch_failed", "parse_failed"]);
const rowSchema = z.object({
  id: z.string(), issue_source: z.enum(["portal", "livestats"]), supplement_status: statusSchema.nullable(),
  severity: z.enum(["info", "warning", "error"]), code: z.string(), message: z.string(), field_path: z.string().nullable(),
  source_url: z.string().nullable(), expected: z.unknown(), actual: z.unknown(), created_at: z.coerce.date(),
  game_id: z.string().nullable(), source_game_id: z.string().nullable(), game_status: z.enum(["scheduled", "live", "complete", "unknown"]).nullable(),
  run_id: z.string().nullable(), run_mode: z.enum(["discover", "sync", "snapshot"]).nullable(),
  run_status: z.enum(["running", "succeeded", "partial", "failed"]).nullable(), run_started_at: z.coerce.date().nullable(), run_finished_at: z.coerce.date().nullable()
});

async function executeRows(db: StatsArenaDatabase, query: SQL): Promise<unknown[]> {
  const result: unknown = await db.execute(query);
  if (Array.isArray(result)) return result;
  return z.object({ rows: z.array(z.unknown()) }).parse(result).rows;
}

/** Portal history plus current LiveStats issues; no audit duplication or DB writes. */
export async function getReviewIssues(db: StatsArenaDatabase, competitionId: string, filters: ReviewFilters, pageSize: number, latestRunId: string | null)
  : Promise<Pick<ReviewSummary, "totalIssues" | "sourceCounts" | "liveStatsGames" | "issueTypes" | "issues">> {
  const cte = sql`with review_items as (
    select i.id::text as id, 'portal'::text as issue_source, null::text as supplement_status,
      i.severity::text as severity, i.code, i.message, i.field_path, i.source_url, i.expected, i.actual, i.created_at,
      g.id::text as game_id, g.source_game_id, g.status::text as game_status,
      r.id::text as run_id, r.mode::text as run_mode, r.status::text as run_status, r.started_at as run_started_at, r.finished_at as run_finished_at
    from statsarena.validation_issues i
    left join statsarena.games g on g.id = i.game_id and g.competition_id = i.competition_id
    left join statsarena.import_runs r on r.id = i.import_run_id and r.competition_id = i.competition_id
    where i.competition_id = ${competitionId}::uuid
    union all
    select l.id::text || ':' || entry.ordinality::text, 'livestats'::text, l.status::text,
      case when l.status in ('fetch_failed','parse_failed') then 'error' when l.status = 'unavailable' then 'info' else 'warning' end,
      coalesce(entry.value->>'code', 'LIVESTATS_' || upper(l.status)),
      coalesce(entry.value->>'message', 'Tambahan LiveStats memerlukan pemeriksaan.'),
      coalesce(entry.value->>'field','status'), l.page_url, entry.value->'expected', entry.value->'actual', l.last_attempt_at,
      g.id::text, g.source_game_id, g.status::text,
      null::text, null::text, null::text, null::timestamptz, null::timestamptz
    from statsarena.game_livestats l
    inner join statsarena.games g on g.id = l.game_id
    cross join lateral jsonb_array_elements(case when jsonb_array_length(l.issues) > 0 then l.issues else '[{}]'::jsonb end) with ordinality as entry(value, ordinality)
    where g.competition_id = ${competitionId}::uuid and l.status <> 'ready'
  )`;
  const conditions = [sql`true`];
  if (filters.severity) conditions.push(sql`severity = ${filters.severity}`);
  if (filters.code) conditions.push(sql`code = ${filters.code}`);
  if (filters.source) conditions.push(sql`issue_source = ${filters.source}`);
  const where = sql.join(conditions, sql` and `);
  const size = Math.min(100, Math.max(1, Math.trunc(pageSize)));
  const page = Math.min(10000, Math.max(1, Math.trunc(filters.page)));
  const [statsRows, countRows, pageRows] = await Promise.all([
    executeRows(db, sql`${cte} select count(*)::int as total,
      count(*) filter(where issue_source = 'portal')::int as portal,
      count(*) filter(where issue_source = 'livestats')::int as livestats,
      count(distinct game_id) filter(where issue_source = 'livestats')::int as live_games,
      coalesce((select jsonb_agg(code order by code) from (select distinct code from review_items order by code limit 100) codes), '[]'::jsonb) as codes
      from review_items`),
    executeRows(db, sql`${cte} select count(*)::int as total from review_items where ${where}`),
    executeRows(db, sql`${cte} select * from review_items where ${where} order by created_at desc, issue_source asc, id desc limit ${size} offset ${(page - 1) * size}`)
  ]);
  const stats = z.object({ total: z.number().int(), portal: z.number().int(), livestats: z.number().int(), live_games: z.number().int(), codes: z.array(z.string()) }).parse(statsRows[0]);
  const filtered = z.object({ total: z.number().int() }).parse(countRows[0]);
  const items: ReviewIssueListItem[] = pageRows.map(value => {
    const row = rowSchema.parse(value);
    return { id: `${row.issue_source}:${row.id}`, issueSource: row.issue_source, supplementStatus: row.supplement_status,
      severity: row.severity, code: row.code, message: row.message, fieldPath: row.field_path, sourceUrl: row.source_url,
      expected: row.expected ?? null, actual: row.actual ?? null, createdAt: row.created_at,
      game: row.game_id && row.source_game_id && row.game_status ? { id: row.game_id, sourceGameId: row.source_game_id, status: row.game_status } : null,
      importRun: row.run_id && row.run_mode && row.run_status && row.run_started_at ? { id: row.run_id, mode: row.run_mode, status: row.run_status, startedAt: row.run_started_at, finishedAt: row.run_finished_at } : null,
      isLatestRun: row.issue_source === "portal" && Boolean(row.run_id && row.run_id === latestRunId) };
  });
  return { totalIssues: stats.total, sourceCounts: { portal: stats.portal, livestats: stats.livestats }, liveStatsGames: stats.live_games,
    issueTypes: stats.codes, issues: { items, total: filtered.total, page, pageSize: size } };
}
