import { sql } from "drizzle-orm";
import { z } from "zod";
import type { StatsArenaDatabase } from "@statsarena/db";
import { competitionReference } from "@statsarena/db/source";
import type { GlobalReviewSummary } from "./contracts";
import type { ReviewFilters } from "./review";

const issueSchema = z.object({
  source: z.enum(["portal", "livestats"]), status: z.string(), code: z.string(),
  message: z.string(), sourceUrl: z.string().nullable()
});
const gameSchema = z.object({
  id: z.string(), source_game_id: z.string(), status: z.enum(["complete", "live", "unknown", "scheduled"]),
  home_name: z.string().nullable(), away_name: z.string().nullable(), home_score: z.number().nullable(), away_score: z.number().nullable(),
  competition_name: z.string(), competition_url: z.string(), checked_at: z.coerce.date(), issues: z.array(issueSchema)
});

/** Explicit global scope: only current problem observations, never portal history. */
export async function getGlobalReview(db: StatsArenaDatabase, filters: ReviewFilters, pageSize = 25): Promise<GlobalReviewSummary> {
  const cte = sql`with active_issues as (
    select g.id as game_id, 'portal'::text as source, d.value->>'status' as problem_status,
      coalesce(i.value->>'severity', case when d.value->>'status' = 'failed' then 'error' else 'warning' end) as severity,
      coalesce(i.value->>'code', 'PORTAL_' || upper(d.key) || '_' || upper(d.value->>'status')) as code,
      coalesce(i.value->>'message', 'Dataset ' || d.key || ' belum lengkap; buka detail pertandingan.') as message,
      coalesce(i.value->>'sourceUrl', g.source_url) as source_url,
      coalesce((d.value->>'checkedAt')::timestamptz, g.detail_synced_at, g.updated_at) as checked_at
    from statsarena.games g
    cross join lateral jsonb_each(coalesce(g.detail_quality, '{}'::jsonb)) d
    cross join lateral jsonb_array_elements(case when jsonb_array_length(coalesce(d.value->'issues', '[]'::jsonb)) > 0 then d.value->'issues' else '[{}]'::jsonb end) i(value)
    where g.status <> 'scheduled' and d.value->>'status' in ('partial','failed')
    union all
    select g.id, 'portal', g.detail_sync_status::text,
      case when g.detail_sync_status = 'failed' then 'error' else 'warning' end,
      'PORTAL_DETAIL_' || upper(g.detail_sync_status::text), 'Detail portal belum lengkap; metadata kualitas belum tersedia.',
      g.source_url, coalesce(g.detail_synced_at, g.updated_at)
    from statsarena.games g where g.status <> 'scheduled' and g.detail_quality is null and g.detail_sync_status <> 'parsed'
    union all
    select l.game_id, 'livestats', l.status,
      case when l.status in ('fetch_failed','parse_failed') then 'error' when l.status = 'unavailable' then 'info' else 'warning' end,
      coalesce(i.value->>'code', 'LIVESTATS_' || upper(l.status)),
      coalesce(i.value->>'message', 'Tambahan LiveStats memerlukan pemeriksaan.'), l.page_url, l.last_attempt_at
    from statsarena.game_livestats l join statsarena.games g on g.id = l.game_id
    cross join lateral jsonb_array_elements(case when jsonb_array_length(l.issues) > 0 then l.issues else '[{}]'::jsonb end) i(value)
    where l.status <> 'ready' and g.status <> 'scheduled'
  )`;
  const conditions = [sql`true`];
  if (filters.source) conditions.push(sql`source = ${filters.source}`);
  if (filters.code) conditions.push(sql`code = ${filters.code}`);
  if (filters.severity) conditions.push(sql`severity = ${filters.severity}`);
  const where = sql.join(conditions, sql` and `);
  const page = Math.max(1, Math.min(10000, Math.trunc(filters.page)));
  const size = Math.max(1, Math.min(100, Math.trunc(pageSize)));
  const grouped = sql`${cte}, matching as (select * from active_issues where ${where}), problem_games as (
    select game_id, max(checked_at) as checked_at,
      jsonb_agg(distinct jsonb_build_object('source',source,'status',problem_status,'code',code,'message',message,'sourceUrl',source_url)) as issues
    from matching group by game_id
  )`;
  const rows = async (query: Parameters<StatsArenaDatabase["execute"]>[0]) => {
    const result: unknown = await db.execute(query);
    return Array.isArray(result) ? result : z.object({ rows: z.array(z.unknown()) }).parse(result).rows;
  };
  const [counts, types, items] = await Promise.all([
    rows(sql`${grouped} select count(*)::int as games, count(distinct g.competition_id)::int as competitions,
      (select count(distinct game_id)::int from matching where source = 'portal') as portal,
      (select count(distinct game_id)::int from matching where source = 'livestats') as livestats
      from problem_games p join statsarena.games g on g.id = p.game_id`),
    rows(sql`${cte} select distinct code from active_issues order by code limit 100`),
    rows(sql`${grouped} select g.id::text, g.source_game_id, g.status::text, g.home_score, g.away_score,
      h.name as home_name, a.name as away_name, c.name as competition_name, c.source_url as competition_url, p.checked_at, p.issues
      from problem_games p join statsarena.games g on g.id = p.game_id join statsarena.competitions c on c.id = g.competition_id
      left join statsarena.teams h on h.id = g.home_team_id left join statsarena.teams a on a.id = g.away_team_id
      order by p.checked_at desc, g.id asc limit ${size} offset ${(page - 1) * size}`)
  ]);
  const count = z.object({ games: z.number(), competitions: z.number(), portal: z.number(), livestats: z.number() }).parse(counts[0]);
  return {
    totalGames: count.games, competitions: count.competitions, portalGames: count.portal, liveStatsGames: count.livestats,
    issueTypes: types.map(value => z.object({ code: z.string() }).parse(value).code),
    games: { total: count.games, page, pageSize: size, items: items.map(value => {
      const row = gameSchema.parse(value);
      return { id: row.id, sourceGameId: row.source_game_id, status: row.status, homeName: row.home_name, awayName: row.away_name,
        homeScore: row.home_score, awayScore: row.away_score, competitionName: row.competition_name,
        competitionRef: competitionReference(row.competition_url).key, checkedAt: row.checked_at, issues: row.issues };
    }) }
  };
}
