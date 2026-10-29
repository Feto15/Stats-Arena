import { and, asc, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import type { StatsArenaDatabase } from "@statsarena/db";
import { competitionTeams, competitions, games, importRuns, playerGameStats, players, shots, sourceFetches, teamGameStats, teams } from "@statsarena/db";
import { BASE_STAT_FIELDS, calculateMetrics, contextualInputs, PLAYER_METRICS, sumStats, TEAM_METRICS, type Stats } from "@statsarena/db/analytics";
import { DETAIL_DATASETS } from "@statsarena/db/data-quality";
import { competitionReference, SOURCE_NAMES } from "@statsarena/db/source";
import type { ReportViewer } from "../auth/policy";
import { McpAccessError, requireMcpAdmin, requireMcpClub } from "./access";

type Reader = Pick<StatsArenaDatabase, "select">;
// Public response objects expose domain fields only; provenance remains required for internal validation.
export const sourceId = z.string().regex(/^[1-9]\d{0,31}$/);
export const competitionKey = z.string().regex(/^(?:IBL:)?[1-9]\d{0,31}$/);
export const pageFields = { limit: z.number().int().min(1).max(50).default(25), offset: z.number().int().min(0).max(5000).default(0) };
export const clubFields = { competition: competitionKey, club: sourceId };
export type ClubInput = { competition: string; club: string };
export type PageInput = { limit: number; offset: number };
function page<T>(rows: T[], input: PageInput) { return { items: rows.slice(input.offset, input.offset + input.limit), total: rows.length, hasMore: input.offset + input.limit < rows.length, offset: input.offset, limit: input.limit }; }
function perGame(stats: Stats, gp: number): Stats { return Object.fromEntries(BASE_STAT_FIELDS.map(key => [key, gp && stats[key] !== null ? stats[key] / gp : null])) as Stats; }
function validStats(row: Stats) {
  return BASE_STAT_FIELDS.filter(f => f !== "minutes").every(f => row[f] !== null && Number.isSafeInteger(row[f]) && row[f]! >= 0) &&
    row.points === 2 * row.twoPointsMade! + 3 * row.threePointsMade! + row.freeThrowsMade! && row.fieldGoalsAttempted === row.twoPointAttempts! + row.threePointAttempts! &&
    row.fieldGoalsMade === row.twoPointsMade! + row.threePointsMade! && row.fieldGoalsMade! <= row.fieldGoalsAttempted! && row.freeThrowsMade! <= row.freeThrowAttempts!;
}
const notFound = () => new McpAccessError(404, "NOT_AVAILABLE", "Data belum tersedia pada klub dan kompetisi yang diizinkan.");
function scopedSource(value: string, key: string, game: string, resource: "boxscore" | "shotchart") {
  try {
    const ref = competitionReference(key), url = new URL(value), origin = new URL(ref.url).origin;
    return url.origin === origin && !url.username && !url.password && new RegExp(`^/${ref.namespace}/en/(?:competition/${ref.id}/)?match/${game}/${resource}/?$`).test(url.pathname);
  } catch { return false; }
}
async function findCompetition(db: Reader, key: string) {
  const ref = competitionReference(key);
  const [row] = await db.select().from(competitions).where(and(eq(competitions.source, ref.source), eq(competitions.sourceCompetitionId, ref.id))).limit(1);
  if (!row || competitionReference(row.sourceUrl).key !== key) throw notFound();
  return row;
}
export async function visibleCompetitions(db: Reader, viewer: ReportViewer, input: PageInput) {
  const allowed = viewer.grants.map(g => competitionReference(g.competitionKey));
  if (!viewer.isAdmin && !allowed.length) return page([], input);
  const rows = await db.select({ source: competitions.source, id: competitions.sourceCompetitionId, name: competitions.name, season: competitions.season, year: competitions.year }).from(competitions)
    .where(viewer.isAdmin ? inArray(competitions.source, Object.values(SOURCE_NAMES)) : or(...allowed.map(r => and(eq(competitions.source, r.source), eq(competitions.sourceCompetitionId, r.id)))))
    .orderBy(asc(competitions.name)).limit(5001);
  if (rows.length > 5000) throw new McpAccessError(403, "SCOPE_TOO_LARGE", "Daftar kompetisi melampaui batas layanan.");
  return page(rows.map(row => ({ id: row.source === SOURCE_NAMES.IBL ? `IBL:${row.id}` : row.id, name: row.name, season: row.season, year: row.year })), input);
}
export async function visibleTeams(db: Reader, viewer: ReportViewer, key: string, input: PageInput) {
  const grantIds = viewer.grants.filter(g => g.competitionKey === key).map(g => g.clubSourceId);
  if (!viewer.isAdmin && !grantIds.length) throw new McpAccessError(403, "FORBIDDEN", "Akses kompetisi belum diberikan oleh admin.");
  const competition = await findCompetition(db, key);
  const rows = await db.select({ id: teams.sourceTeamId, name: teams.name }).from(competitionTeams).innerJoin(teams, eq(teams.id, competitionTeams.teamId))
    .where(and(eq(competitionTeams.competitionId, competition.id), eq(teams.source, competitionReference(key).source), ...(viewer.isAdmin ? [] : [inArray(teams.sourceTeamId, grantIds)]))).orderBy(asc(teams.name)).limit(1001);
  if (rows.length > 1000) throw new McpAccessError(403, "SCOPE_TOO_LARGE", "Daftar klub melampaui batas layanan.");
  return { competition: key, ...page(rows, input) };
}
const qualitySchema = z.object({ status: z.enum(["parsed", "partial", "failed", "scheduled", "unavailable"]), category: z.enum(["network", "source_inconsistent", "source_identity_invalid", "parse_failed"]).nullable(),
  checkedAt: z.iso.datetime(), nextRetryAt: z.iso.datetime().nullable(), consecutiveFailures: z.number().int().nonnegative(),
  issues: z.array(z.object({ code: z.string().regex(/^[A-Z0-9_]{1,100}$/), severity: z.string().max(16) })).max(1000) });
function quality(value: typeof games.$inferSelect.detailQuality) {
  return Object.fromEntries(DETAIL_DATASETS.map(key => {
    const parsed = qualitySchema.safeParse(value?.[key]);
    return [key, parsed.success ? { ...parsed.data, issues: parsed.data.issues.slice(0, 20), issueCount: parsed.data.issues.length } : null];
  }));
}
async function clubContext(db: Reader, viewer: ReportViewer, input: ClubInput, gameId?: string) {
  requireMcpClub(viewer, input.competition, input.club);
  const competition = await findCompetition(db, input.competition), ref = competitionReference(input.competition);
  const [club] = await db.select({ id: teams.id, sourceId: teams.sourceTeamId, name: teams.name }).from(teams).innerJoin(competitionTeams, eq(competitionTeams.teamId, teams.id))
    .where(and(eq(competitionTeams.competitionId, competition.id), eq(teams.source, ref.source), eq(teams.sourceTeamId, input.club))).limit(1);
  if (!club) throw notFound();
  const fixtures = await db.select({ game: games, fetch: sourceFetches, parserVersion: importRuns.parserVersion }).from(games)
    .leftJoin(sourceFetches, eq(sourceFetches.id, games.lastBoxscoreFetchId)).leftJoin(importRuns, eq(importRuns.id, sourceFetches.importRunId))
    .where(and(eq(games.competitionId, competition.id), eq(games.source, ref.source), or(eq(games.homeTeamId, club.id), eq(games.awayTeamId, club.id)), ...(gameId ? [eq(games.sourceGameId, gameId)] : [])))
    .orderBy(asc(games.sourceGameId)).limit(1001);
  if (fixtures.length > 1000) throw new McpAccessError(403, "SCOPE_TOO_LARGE", "Cakupan pertandingan melampaui batas layanan.");
  if (gameId && !fixtures.length) throw notFound();
  return { competition, club, fixtures, ref };
}
export async function listClubGames(db: Reader, viewer: ReportViewer, input: ClubInput & PageInput, includeQuality = false) {
  if (includeQuality) requireMcpAdmin(viewer);
  const ctx = await clubContext(db, viewer, input);
  const teamIds = [...new Set(ctx.fixtures.flatMap(({ game }) => [game.homeTeamId, game.awayTeamId]).filter((id): id is string => id !== null))];
  const names = teamIds.length ? await db.select({ id: teams.id, name: teams.name, sourceId: teams.sourceTeamId }).from(teams).where(and(inArray(teams.id, teamIds), eq(teams.source, ctx.ref.source))) : [];
  return { competition: input.competition, club: { id: input.club, name: ctx.club.name }, ...page(ctx.fixtures.map(({ game }) => ({
    id: game.sourceGameId, status: game.status, scheduledAtRaw: game.scheduledAtRaw, venue: game.venue,
    home: { id: names.find(t => t.id === game.homeTeamId)?.sourceId ?? null, name: names.find(t => t.id === game.homeTeamId)?.name ?? null, score: game.homeScore },
    away: { id: names.find(t => t.id === game.awayTeamId)?.sourceId ?? null, name: names.find(t => t.id === game.awayTeamId)?.name ?? null, score: game.awayScore },
    ...(includeQuality ? { detailStatus: game.detailSyncStatus, datasets: quality(game.detailQuality) } : {})
  })), input) };
}
async function clubBoxScores(db: Reader, viewer: ReportViewer, input: ClubInput, gameId?: string) {
  const ctx = await clubContext(db, viewer, input, gameId), ids = ctx.fixtures.map(({ game }) => game.id);
  const [totals, rows] = ids.length ? await Promise.all([
    db.select().from(teamGameStats).where(inArray(teamGameStats.gameId, ids)).limit(2001),
    db.select({ stats: playerGameStats, player: players }).from(playerGameStats).innerJoin(players, eq(players.id, playerGameStats.playerId))
      .where(and(inArray(playerGameStats.gameId, ids), eq(players.source, ctx.ref.source))).limit(40001)
  ]) : [[], []];
  if (totals.length > 2000 || rows.length > 40000) throw new McpAccessError(403, "SCOPE_TOO_LARGE", "Cakupan statistik melampaui batas layanan.");
  const excluded: Array<{ game: string; reason: string }> = [];
  const included = ctx.fixtures.flatMap(({ game, fetch, parserVersion }) => {
    const team = totals.find(t => t.gameId === game.id && t.teamId === ctx.club.id), otherId = game.homeTeamId === ctx.club.id ? game.awayTeamId : game.homeTeamId;
    const opponent = totals.find(t => t.gameId === game.id && t.teamId === otherId);
    const gameRows = rows.filter(r => r.stats.gameId === game.id), own = gameRows.filter(r => r.stats.teamId === ctx.club.id), other = gameRows.filter(r => r.stats.teamId === otherId);
    const version = parserVersion ?? game.detailParserVersion;
    const valid = game.status === "complete" && fetch?.competitionId === ctx.competition.id && fetch.resource === "boxscore" && fetch.fetchStatus === "succeeded" && fetch.parseStatus === "parsed" && fetch.sha256 && (fetch.sourceFetchedAt ?? fetch.fetchedAt) && version && scopedSource(fetch.requestUrl, input.competition, game.sourceGameId, "boxscore") &&
      team && opponent && validStats(team) && validStats(opponent) && team.points === (game.homeTeamId === ctx.club.id ? game.homeScore : game.awayScore) && opponent.points === (game.homeTeamId === ctx.club.id ? game.awayScore : game.homeScore) &&
      own.length >= 5 && other.length >= 5 && gameRows.every(r => validStats(r.stats) && (r.stats.teamId === ctx.club.id || r.stats.teamId === otherId)) && own.reduce((s,r) => s + r.stats.points!, 0) === team.points && other.reduce((s,r) => s + r.stats.points!, 0) === opponent.points;
    if (!valid || !team || !opponent || !fetch || !version) { excluded.push({ game: game.sourceGameId, reason: game.status === "scheduled" ? "scheduled" : game.status !== "complete" ? "game_not_complete" : "valid_boxscore_unavailable" }); return []; }
    return [{ game, own, team: { ...sumStats([team]), minutes: sumStats(own.map(r => r.stats)).minutes }, opponent: { ...sumStats([opponent]), minutes: sumStats(other.map(r => r.stats)).minutes } }];
  });
  return { ...ctx, included, excluded };
}
export async function clubStatistics(db: Reader, viewer: ReportViewer, input: ClubInput) {
  const ctx = await clubBoxScores(db, viewer, input), totals = sumStats(ctx.included.map(g => g.team)), opponentTotals = sumStats(ctx.included.map(g => g.opponent)), gp = ctx.included.length;
  return { competition: input.competition, club: { id: input.club, name: ctx.club.name },
    scope: { gameIds: ctx.included.map(g => g.game.sourceGameId), excludedGames: ctx.excluded, gamesPlayed: gp, definition: "complete_games_with_valid_boxscores" },
    totals, perGame: perGame(totals, gp), opponentTotals, ...calculateMetrics(contextualInputs(totals, gp, totals, opponentTotals), TEAM_METRICS) };
}
export async function playerStatistics(db: Reader, viewer: ReportViewer, input: ClubInput & PageInput & { player?: string | undefined; query?: string | undefined }) {
  const ctx = await clubBoxScores(db, viewer, input);
  const playerIds = [...new Set(ctx.included.flatMap(g => g.own.map(r => r.player.sourcePlayerId)))];
  const result = playerIds.flatMap(id => {
    const samples = ctx.included.flatMap(g => g.own.filter(row => row.player.sourcePlayerId === id).map(row => ({ g, row }))), name = samples.at(-1)!.row.player.name;
    if ((input.player && input.player !== id) || (input.query && !name.toLowerCase().includes(input.query.toLowerCase()))) return [];
    const totals = sumStats(samples.map(s => s.row.stats)), team = sumStats(samples.map(s => s.g.team)), opponent = sumStats(samples.map(s => s.g.opponent)), gp = samples.length;
    return [{ id, name, club: input.club, gamesPlayed: gp, gameIds: samples.map(s => s.g.game.sourceGameId), totals, perGame: perGame(totals, gp),
      ...calculateMetrics(contextualInputs(totals, gp, team, opponent), PLAYER_METRICS) }];
  }).sort((a,b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  if (input.player && !result.length) throw notFound();
  return { competition: input.competition, club: input.club, excludedGames: ctx.excluded, ...page(result, input) };
}
export async function gameStatistics(db: Reader, viewer: ReportViewer, input: ClubInput & { game: string }) {
  const ctx = await clubBoxScores(db, viewer, input, input.game), entry = ctx.included[0], fixture = ctx.fixtures[0]!.game;
  return { competition: input.competition, club: input.club, game: input.game, status: fixture.status, homeScore: fixture.homeScore, awayScore: fixture.awayScore,
    scheduledAtRaw: fixture.scheduledAtRaw, ...(viewer.isAdmin ? { datasets: quality(fixture.detailQuality) } : {}), boxScoreAvailable: Boolean(entry),
    reason: ctx.excluded[0]?.reason ?? null, team: entry?.team ?? null, opponent: entry?.opponent ?? null,
    players: entry?.own.map(row => ({ id: row.player.sourcePlayerId, name: row.player.name, jerseyNumber: row.stats.jerseyNumber, minutesRaw: row.stats.minutesRaw, stats: sumStats([row.stats]),
      ...calculateMetrics(contextualInputs(sumStats([row.stats]), 1, entry.team, entry.opponent), PLAYER_METRICS) })) ?? null };
}
export async function gameShotChart(db: Reader, viewer: ReportViewer, input: ClubInput & { game: string; player?: string | undefined; limit: number; offset: number }) {
  const ctx = await clubBoxScores(db, viewer, input, input.game), entry = ctx.included[0];
  const unavailable = (reason: string) => ({ competition: input.competition, club: input.club, game: input.game, available: false, reason, items: null });
  if (!entry) return unavailable("valid_boxscore_unavailable");
  if (input.player && !entry.own.some(row => row.player.sourcePlayerId === input.player)) throw notFound();
  const rows = await db.select({ shot: shots, player: players.sourcePlayerId, fetch: sourceFetches }).from(shots)
    .innerJoin(players, eq(players.id, shots.playerId)).leftJoin(sourceFetches, eq(sourceFetches.id, shots.sourceFetchId))
    .where(and(eq(shots.gameId, entry.game.id), eq(shots.teamId, ctx.club.id), eq(players.source, ctx.ref.source))).orderBy(asc(shots.sourceSequence)).limit(2001);
  const valid = rows.length <= 2000 && new Set(rows.map(r => r.shot.sourceFetchId)).size <= 1 && new Set(rows.map(r => r.shot.parserVersion)).size <= 1 && rows.length === entry.team.fieldGoalsAttempted && rows.filter(r => r.shot.result === "made").length === entry.team.fieldGoalsMade && rows.every(({ shot, fetch, player }) =>
    fetch?.competitionId === ctx.competition.id && fetch.resource === "shotchart" && fetch.fetchStatus === "succeeded" && fetch.parseStatus === "parsed" && fetch.sha256 && (fetch.sourceFetchedAt ?? fetch.fetchedAt) && shot.sourceUrl === fetch.requestUrl && scopedSource(fetch.requestUrl, input.competition, input.game, "shotchart") && shot.xPercent >= 0 && shot.xPercent <= 100 && shot.yPercent >= 0 && shot.yPercent <= 100 &&
    entry.own.some(p => p.player.sourcePlayerId === player && p.player.id === shot.playerId) && shot.periodNumber > 0);
  if (!valid) return unavailable("valid_shotchart_unavailable");
  const filtered = rows.filter(r => !input.player || r.player === input.player);
  return { competition: input.competition, club: input.club, game: input.game, available: true, coordinateSystem: "source_canvas_percent_without_rotation", ...(viewer.isAdmin ? { observedQuality: quality(entry.game.detailQuality)["shotChart"] } : {}),
    ...page(filtered.map(({ shot, player }) => ({ player, sequence: shot.sourceSequence, period: shot.periodNumber, type: shot.shotType, result: shot.result, x: shot.xPercent, y: shot.yPercent })), input) };
}
