import { and, asc, count, desc, eq, inArray, isNotNull, like, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { StatsArenaDatabase } from "@statsarena/db";
import {
  competitionGroups,
  competitionPlayers,
  competitionTeams,
  competitions,
  games,
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
} from "@statsarena/db/schema";
import type {
  CompetitionOption,
  GameDetail,
  GameDetailFilters,
  GameListItem,
  GamePlayerStatsItem,
  GameTeamStatsItem,
  ImportRunListItem,
  OperationalStatus,
  OverviewSummary,
  PageResult,
  PlayerListItem,
  PlayerSummary,
  ReviewIssueListItem,
  ReviewSummary,
  SourceFetchSummary,
  StandingListItem,
  TeamListItem,
  TeamStatColumns,
  TeamSummary,
} from "./contracts";

const PAGE_SIZE = 25;
const MAX_PAGE = 10_000;
const pageSchema = z.coerce.number().int().min(1).max(MAX_PAGE).catch(1);
const sourceCompetitionIdSchema = z.string().trim().regex(/^[1-9]\d{0,31}$/);
const sourceEntityIdSchema = z.string().trim().regex(/^[1-9]\d{0,31}$/);
const groupIdSchema = z.string().uuid();
const gameStatusSchema = z.enum(["scheduled", "live", "complete", "unknown"]);
const severitySchema = z.enum(["info", "warning", "error"]);
const issueCodeSchema = z.string().trim().min(1).max(100).regex(/^[A-Z0-9_.-]+$/);
const periodSchema = z.coerce.number().int().min(1).max(10);

export type GameListFilters = {
  page: number;
  status?: "scheduled" | "live" | "complete" | "unknown";
  teamSourceId?: string;
};

export type StandingsFilters = { groupId?: string };
export type ReviewFilters = { page: number; severity?: "info" | "warning" | "error"; code?: string };

export function parseGameDetailFilters(params: Record<string, string | string[] | undefined>): GameDetailFilters {
  const rawPeriod = Array.isArray(params["period"]) ? undefined : params["period"];
  const rawTeam = Array.isArray(params["team"]) ? undefined : params["team"];
  const rawPlayer = Array.isArray(params["player"]) ? undefined : params["player"];
  const rawResult = Array.isArray(params["result"]) ? undefined : params["result"];
  const period = rawPeriod === undefined ? undefined : periodSchema.safeParse(rawPeriod);
  const team = rawTeam === undefined ? undefined : sourceEntityIdSchema.safeParse(rawTeam);
  const player = rawPlayer === undefined ? undefined : sourceEntityIdSchema.safeParse(rawPlayer);
  const result = rawResult === undefined ? undefined : z.enum(["made", "missed"]).safeParse(rawResult);
  return {
    ...(period?.success ? { periodNumber: period.data } : {}),
    ...(team?.success ? { teamSourceId: team.data } : {}),
    ...(player?.success ? { playerSourceId: player.data } : {}),
    ...(result?.success ? { result: result.data } : {}),
  };
}

export function parsePage(value: string | string[] | undefined): number {
  return pageSchema.parse(value);
}

export function parseGameListFilters(params: Record<string, string | string[] | undefined>): GameListFilters {
  const rawPage = Array.isArray(params["page"]) ? undefined : params["page"];
  const rawStatus = Array.isArray(params["status"]) ? undefined : params["status"];
  const rawTeam = Array.isArray(params["team"]) ? undefined : params["team"];
  const parsedStatus = gameStatusSchema.safeParse(rawStatus);
  const parsedTeam = rawTeam === undefined ? undefined : sourceEntityIdSchema.safeParse(rawTeam);
  return {
    page: parsePage(rawPage),
    ...(parsedStatus.success ? { status: parsedStatus.data } : {}),
    ...(parsedTeam?.success ? { teamSourceId: parsedTeam.data } : {}),
  };
}

export function parseStandingsFilters(params: Record<string, string | string[] | undefined>): StandingsFilters {
  const rawGroup = Array.isArray(params["group"]) ? undefined : params["group"];
  const parsed = rawGroup === undefined ? undefined : groupIdSchema.safeParse(rawGroup);
  return parsed?.success ? { groupId: parsed.data } : {};
}

export function parseReviewFilters(params: Record<string, string | string[] | undefined>): ReviewFilters {
  const rawPage = Array.isArray(params["page"]) ? undefined : params["page"];
  const rawSeverity = Array.isArray(params["severity"]) ? undefined : params["severity"];
  const rawCode = Array.isArray(params["code"]) ? undefined : params["code"];
  const parsedSeverity = severitySchema.safeParse(rawSeverity);
  const parsedCode = rawCode === undefined ? undefined : issueCodeSchema.safeParse(rawCode);
  return {
    page: parsePage(rawPage),
    ...(parsedSeverity.success ? { severity: parsedSeverity.data } : {}),
    ...(parsedCode?.success ? { code: parsedCode.data } : {}),
  };
}

export async function listCompetitions(db: StatsArenaDatabase): Promise<CompetitionOption[]> {
  return db.select({
    id: competitions.id,
    sourceCompetitionId: competitions.sourceCompetitionId,
    name: competitions.name,
    season: competitions.season,
    year: competitions.year,
  }).from(competitions)
    .where(eq(competitions.source, "genius_sports"))
    .orderBy(asc(competitions.name), asc(competitions.sourceCompetitionId));
}

export async function getCompetitionBySourceId(
  db: StatsArenaDatabase,
  sourceCompetitionId: string,
): Promise<CompetitionOption | null> {
  const parsedId = sourceCompetitionIdSchema.safeParse(sourceCompetitionId);
  if (!parsedId.success) return null;
  const [competition] = await db.select({
    id: competitions.id,
    sourceCompetitionId: competitions.sourceCompetitionId,
    name: competitions.name,
    season: competitions.season,
    year: competitions.year,
  }).from(competitions)
    .where(and(
      eq(competitions.source, "genius_sports"),
      eq(competitions.sourceCompetitionId, parsedId.data),
    ))
    .limit(1);
  return competition ?? null;
}

function gameSelection() {
  const homeTeam = alias(teams, "home_team");
  const awayTeam = alias(teams, "away_team");
  const selection = {
    game: {
      id: games.id,
      sourceGameId: games.sourceGameId,
      homeScore: games.homeScore,
      awayScore: games.awayScore,
      status: games.status,
      scheduledAtRaw: games.scheduledAtRaw,
      venue: games.venue,
      sourceUrl: games.sourceUrl,
    },
    homeTeam: { id: homeTeam.id, sourceTeamId: homeTeam.sourceTeamId, name: homeTeam.name, logoUrl: homeTeam.logoUrl },
    awayTeam: { id: awayTeam.id, sourceTeamId: awayTeam.sourceTeamId, name: awayTeam.name, logoUrl: awayTeam.logoUrl },
  };
  return { homeTeam, awayTeam, selection };
}

type SelectedGameRow = {
  game: Omit<GameListItem, "homeTeam" | "awayTeam">;
  homeTeam: GameListItem["homeTeam"];
  awayTeam: GameListItem["awayTeam"];
};

function mapGame(row: SelectedGameRow): GameListItem {
  return { ...row.game, homeTeam: row.homeTeam, awayTeam: row.awayTeam };
}

async function findCompetitionTeamId(db: StatsArenaDatabase, competitionId: string, sourceTeamId: string) {
  const parsed = sourceEntityIdSchema.safeParse(sourceTeamId);
  if (!parsed.success) return null;
  const [entry] = await db.select({ id: teams.id }).from(competitionTeams)
    .innerJoin(teams, eq(teams.id, competitionTeams.teamId))
    .where(and(
      eq(competitionTeams.competitionId, competitionId),
      eq(teams.sourceTeamId, parsed.data),
      eq(teams.source, "genius_sports"),
    ))
    .limit(1);
  return entry?.id ?? null;
}

async function findCompetitionPlayerId(db: StatsArenaDatabase, competitionId: string, sourcePlayerId: string) {
  const parsed = sourceEntityIdSchema.safeParse(sourcePlayerId);
  if (!parsed.success) return null;
  const [entry] = await db.select({ id: players.id }).from(competitionPlayers)
    .innerJoin(players, eq(players.id, competitionPlayers.playerId))
    .where(and(
      eq(competitionPlayers.competitionId, competitionId),
      eq(players.sourcePlayerId, parsed.data),
      eq(players.source, "genius_sports"),
    ))
    .limit(1);
  return entry?.id ?? null;
}

export async function getGamesPage(
  db: StatsArenaDatabase,
  competitionId: string,
  filters: GameListFilters,
  pageSize = PAGE_SIZE,
): Promise<PageResult<GameListItem>> {
  const { homeTeam, awayTeam, selection } = gameSelection();
  const conditions: SQL[] = [eq(games.competitionId, competitionId)];
  if (filters.status) conditions.push(eq(games.status, filters.status));
  if (filters.teamSourceId) {
    const teamId = await findCompetitionTeamId(db, competitionId, filters.teamSourceId);
    if (!teamId) return { items: [], total: 0, page: filters.page, pageSize };
    conditions.push(or(eq(games.homeTeamId, teamId), eq(games.awayTeamId, teamId))!);
  }
  const where = and(...conditions);
  const [totalRow] = await db.select({ value: count() }).from(games).where(where);
  const rows = await db.select(selection).from(games)
    .leftJoin(homeTeam, eq(homeTeam.id, games.homeTeamId))
    .leftJoin(awayTeam, eq(awayTeam.id, games.awayTeamId))
    .where(where)
    .orderBy(desc(games.updatedAt), asc(games.sourceGameId))
    .limit(pageSize)
    .offset((filters.page - 1) * pageSize);
  return { items: rows.map(mapGame), total: totalRow?.value ?? 0, page: filters.page, pageSize };
}

function playerStatsSelection() {
  return {
    jerseyNumber: playerGameStats.jerseyNumber,
    minutesRaw: playerGameStats.minutesRaw,
    minutes: playerGameStats.minutes,
    fieldGoalsMade: playerGameStats.fieldGoalsMade,
    fieldGoalsAttempted: playerGameStats.fieldGoalsAttempted,
    twoPointsMade: playerGameStats.twoPointsMade,
    twoPointAttempts: playerGameStats.twoPointAttempts,
    threePointsMade: playerGameStats.threePointsMade,
    threePointAttempts: playerGameStats.threePointAttempts,
    freeThrowsMade: playerGameStats.freeThrowsMade,
    freeThrowAttempts: playerGameStats.freeThrowAttempts,
    offensiveRebounds: playerGameStats.offensiveRebounds,
    defensiveRebounds: playerGameStats.defensiveRebounds,
    rebounds: playerGameStats.rebounds,
    assists: playerGameStats.assists,
    steals: playerGameStats.steals,
    blocks: playerGameStats.blocks,
    turnovers: playerGameStats.turnovers,
    personalFouls: playerGameStats.personalFouls,
    points: playerGameStats.points,
    fieldGoalPct: playerGameStats.fieldGoalPct,
    twoPointPct: playerGameStats.twoPointPct,
    threePointPct: playerGameStats.threePointPct,
    freeThrowPct: playerGameStats.freeThrowPct,
  };
}

function teamStatsSelection() {
  return {
    minutes: teamGameStats.minutes,
    fieldGoalsMade: teamGameStats.fieldGoalsMade,
    fieldGoalsAttempted: teamGameStats.fieldGoalsAttempted,
    twoPointsMade: teamGameStats.twoPointsMade,
    twoPointAttempts: teamGameStats.twoPointAttempts,
    threePointsMade: teamGameStats.threePointsMade,
    threePointAttempts: teamGameStats.threePointAttempts,
    freeThrowsMade: teamGameStats.freeThrowsMade,
    freeThrowAttempts: teamGameStats.freeThrowAttempts,
    offensiveRebounds: teamGameStats.offensiveRebounds,
    defensiveRebounds: teamGameStats.defensiveRebounds,
    rebounds: teamGameStats.rebounds,
    assists: teamGameStats.assists,
    steals: teamGameStats.steals,
    blocks: teamGameStats.blocks,
    turnovers: teamGameStats.turnovers,
    personalFouls: teamGameStats.personalFouls,
    points: teamGameStats.points,
    fieldGoalPct: teamGameStats.fieldGoalPct,
    twoPointPct: teamGameStats.twoPointPct,
    threePointPct: teamGameStats.threePointPct,
    freeThrowPct: teamGameStats.freeThrowPct,
  };
}

export async function getGameDetail(
  db: StatsArenaDatabase,
  competitionId: string,
  sourceGameId: string,
  filters: GameDetailFilters = {},
): Promise<GameDetail | null> {
  const parsedId = sourceEntityIdSchema.safeParse(sourceGameId);
  if (!parsedId.success) return null;
  const { homeTeam, awayTeam, selection } = gameSelection();
  const [row] = await db.select({ ...selection, summaryFetchId: games.lastSummaryFetchId, boxscoreFetchId: games.lastBoxscoreFetchId })
    .from(games)
    .leftJoin(homeTeam, eq(homeTeam.id, games.homeTeamId))
    .leftJoin(awayTeam, eq(awayTeam.id, games.awayTeamId))
    .where(and(eq(games.competitionId, competitionId), eq(games.sourceGameId, parsedId.data)))
    .limit(1);
  if (!row) return null;

  const [teamFilterId, playerFilterId] = await Promise.all([
    filters.teamSourceId ? findCompetitionTeamId(db, competitionId, filters.teamSourceId) : undefined,
    filters.playerSourceId ? findCompetitionPlayerId(db, competitionId, filters.playerSourceId) : undefined,
  ]);
  const invalidTeam = filters.teamSourceId !== undefined && !teamFilterId;
  const invalidPlayer = filters.playerSourceId !== undefined && !playerFilterId;
  const eventConditions: SQL[] = [eq(playByPlayEvents.gameId, row.game.id)];
  const shotConditions: SQL[] = [eq(shots.gameId, row.game.id)];
  if (filters.periodNumber !== undefined) {
    eventConditions.push(eq(playByPlayEvents.periodNumber, filters.periodNumber));
    shotConditions.push(eq(shots.periodNumber, filters.periodNumber));
  }
  if (teamFilterId) {
    eventConditions.push(eq(playByPlayEvents.teamId, teamFilterId));
    shotConditions.push(eq(shots.teamId, teamFilterId));
  }
  if (playerFilterId) {
    eventConditions.push(eq(playByPlayEvents.playerId, playerFilterId));
    shotConditions.push(eq(shots.playerId, playerFilterId));
  }
  if (filters.result) shotConditions.push(eq(shots.result, filters.result));

  const fetchConditions: SQL[] = [];
  if (row.summaryFetchId) fetchConditions.push(eq(sourceFetches.id, row.summaryFetchId));
  if (row.boxscoreFetchId) fetchConditions.push(eq(sourceFetches.id, row.boxscoreFetchId));
  fetchConditions.push(and(
    inArray(sourceFetches.resource, ["playbyplay", "shotchart", "analysis"]),
    like(sourceFetches.requestUrl, `%/match/${parsedId.data}/%`),
  )!);

  const [teamStats, playerRows, eventRows, shotRows, officialRows, issueRows, fetchRows] = await Promise.all([
    db.select({ stats: teamStatsSelection(), team: { id: teams.id, sourceTeamId: teams.sourceTeamId, name: teams.name } })
      .from(teamGameStats)
      .innerJoin(teams, eq(teams.id, teamGameStats.teamId))
      .where(eq(teamGameStats.gameId, row.game.id)),
    db.select({ stats: playerStatsSelection(), player: { id: players.id, sourcePlayerId: players.sourcePlayerId, name: players.name }, team: { id: teams.id, sourceTeamId: teams.sourceTeamId, name: teams.name } })
      .from(playerGameStats)
      .innerJoin(players, eq(players.id, playerGameStats.playerId))
      .innerJoin(teams, eq(teams.id, playerGameStats.teamId))
      .where(eq(playerGameStats.gameId, row.game.id))
      .orderBy(asc(playerGameStats.teamId), asc(players.name), asc(players.sourcePlayerId)),
    invalidTeam || invalidPlayer ? Promise.resolve([]) : db.select({
      event: {
        sourceSequence: playByPlayEvents.sourceSequence,
        periodNumber: playByPlayEvents.periodNumber,
        periodLabelRaw: playByPlayEvents.periodLabelRaw,
        periodType: playByPlayEvents.periodType,
        timeRaw: playByPlayEvents.timeRaw,
        actionType: playByPlayEvents.actionType,
        actionText: playByPlayEvents.actionText,
        teamSide: playByPlayEvents.teamSide,
        playerName: playByPlayEvents.playerName,
        scoreRaw: playByPlayEvents.scoreRaw,
        team1Score: playByPlayEvents.team1Score,
        team2Score: playByPlayEvents.team2Score,
        rawClasses: playByPlayEvents.rawClasses,
        sourceUrl: playByPlayEvents.sourceUrl,
      },
      team: { id: teams.id, sourceTeamId: teams.sourceTeamId, name: teams.name },
      player: { id: players.id, sourcePlayerId: players.sourcePlayerId, name: players.name },
    }).from(playByPlayEvents)
      .leftJoin(teams, eq(teams.id, playByPlayEvents.teamId))
      .leftJoin(players, eq(players.id, playByPlayEvents.playerId))
      .where(and(...eventConditions))
      .orderBy(asc(playByPlayEvents.sourceSequence))
      .limit(2_000),
    invalidTeam || invalidPlayer ? Promise.resolve([]) : db.select({
      shot: {
        sourceSequence: shots.sourceSequence,
        periodNumber: shots.periodNumber,
        playerName: shots.playerName,
        shotType: shots.shotType,
        result: shots.result,
        xRaw: shots.xRaw,
        yRaw: shots.yRaw,
        xPercent: shots.xPercent,
        yPercent: shots.yPercent,
        rawTitle: shots.rawTitle,
        rawClasses: shots.rawClasses,
        sourceUrl: shots.sourceUrl,
      },
      team: { id: teams.id, sourceTeamId: teams.sourceTeamId, name: teams.name },
      player: { id: players.id, sourcePlayerId: players.sourcePlayerId, name: players.name },
    }).from(shots)
      .innerJoin(teams, eq(teams.id, shots.teamId))
      .innerJoin(players, eq(players.id, shots.playerId))
      .where(and(...shotConditions))
      .orderBy(asc(shots.sourceSequence))
      .limit(2_000),
    db.select({
      metric: {
        scopeType: officialTeamMetrics.scopeType,
        metricCode: officialTeamMetrics.metricCode,
        value: officialTeamMetrics.value,
        availability: officialTeamMetrics.availability,
        unit: officialTeamMetrics.unit,
        scopeLabel: officialTeamMetrics.scopeLabel,
        sampleGamesPlayed: officialTeamMetrics.sampleGamesPlayed,
        rawValue: officialTeamMetrics.rawValue,
        sourceUrl: officialTeamMetrics.sourceUrl,
      },
      team: { id: teams.id, sourceTeamId: teams.sourceTeamId, name: teams.name },
    }).from(officialTeamMetrics)
      .innerJoin(teams, eq(teams.id, officialTeamMetrics.teamId))
      .where(and(
        eq(officialTeamMetrics.competitionId, competitionId),
        eq(officialTeamMetrics.scopeType, "game"),
        eq(officialTeamMetrics.gameId, row.game.id),
      ))
      .orderBy(asc(officialTeamMetrics.teamId), asc(officialTeamMetrics.metricCode)),
    db.select({
      id: validationIssues.id,
      severity: validationIssues.severity,
      code: validationIssues.code,
      message: validationIssues.message,
      fieldPath: validationIssues.fieldPath,
      sourceUrl: validationIssues.sourceUrl,
      createdAt: validationIssues.createdAt,
    }).from(validationIssues)
      .where(and(
        eq(validationIssues.competitionId, competitionId),
        eq(validationIssues.gameId, row.game.id),
      ))
      .orderBy(desc(validationIssues.createdAt), desc(validationIssues.id))
      .limit(50),
    db.select({
        id: sourceFetches.id,
        resource: sourceFetches.resource,
        fetchStatus: sourceFetches.fetchStatus,
        parseStatus: sourceFetches.parseStatus,
        httpStatus: sourceFetches.httpStatus,
        fetchedAt: sourceFetches.fetchedAt,
        durationMs: sourceFetches.durationMs,
        responseBytes: sourceFetches.responseBytes,
        sha256: sourceFetches.sha256,
        requestUrl: sourceFetches.requestUrl,
      }).from(sourceFetches)
        .where(and(
          eq(sourceFetches.competitionId, competitionId),
          or(...fetchConditions)!,
        ))
        .orderBy(desc(sourceFetches.requestedAt), desc(sourceFetches.createdAt), desc(sourceFetches.id))
  ]);
  const findFetch = (id: string | null): SourceFetchSummary | null => {
    if (!id) return null;
    const fetch = fetchRows.find((entry) => entry.id === id);
    if (!fetch) return null;
    return {
      id: fetch.id,
      resource: fetch.resource,
      fetchStatus: fetch.fetchStatus,
      parseStatus: fetch.parseStatus,
      httpStatus: fetch.httpStatus,
      fetchedAt: fetch.fetchedAt,
      durationMs: fetch.durationMs,
      responseBytes: fetch.responseBytes,
      sha256: fetch.sha256,
      requestUrl: fetch.requestUrl,
    };
  };
  const mappedTeamStats = teamStats.map((entry) => ({ ...entry.stats, team: entry.team })) as GameTeamStatsItem[];
  const selectTeamStats = (team: GameListItem["homeTeam"]): GameTeamStatsItem | null => {
    if (!team) return null;
    return mappedTeamStats.find((entry) => entry.team.id === team.id) ?? null;
  };
  const mappedPlayers = playerRows.map((entry) => ({ ...entry.stats, player: entry.player, team: entry.team })) as GamePlayerStatsItem[];
  const mappedEvents = eventRows.map((entry) => ({ ...entry.event, team: entry.team, player: entry.player }));
  const mappedShots = shotRows.map((entry) => ({ ...entry.shot, team: entry.team!, player: entry.player! }));
  const mappedOfficialMetrics = officialRows.map((entry) => ({ ...entry.metric, team: entry.team })) as GameDetail["gameOfficialMetrics"];
  const latestIssues = new Map<string, (typeof issueRows)[number]>();
  for (const entry of issueRows) {
    const key = `${entry.code}\u0000${entry.fieldPath ?? ""}\u0000${entry.sourceUrl}`;
    if (!latestIssues.has(key)) latestIssues.set(key, entry);
  }
  const latestDetailFetches = new Map<string, SourceFetchSummary>();
  for (const entry of fetchRows) {
    if (!["playbyplay", "shotchart", "analysis"].includes(entry.resource)) continue;
    const candidate: SourceFetchSummary = {
      id: entry.id,
      resource: entry.resource,
      fetchStatus: entry.fetchStatus,
      parseStatus: entry.parseStatus,
      httpStatus: entry.httpStatus,
      fetchedAt: entry.fetchedAt,
      durationMs: entry.durationMs,
      responseBytes: entry.responseBytes,
      sha256: entry.sha256,
      requestUrl: entry.requestUrl,
    };
    const key = `${entry.resource}\u0000${entry.requestUrl}`;
    // Cached HTML keeps its original fetchedAt. The latest attempt determines preservation status.
    if (!latestDetailFetches.has(key)) {
      latestDetailFetches.set(key, candidate);
    }
  }
  const detailFetches = [...latestDetailFetches.values()];
  return {
    ...mapGame(row),
    homeTeamStats: selectTeamStats(row.homeTeam),
    awayTeamStats: selectTeamStats(row.awayTeam),
    playerStats: mappedPlayers,
    playByPlayEvents: mappedEvents,
    shots: mappedShots,
    gameOfficialMetrics: mappedOfficialMetrics,
    validationIssues: [...latestIssues.values()],
    detailFetches,
    summaryFetch: findFetch(row.summaryFetchId),
    boxscoreFetch: findFetch(row.boxscoreFetchId),
  };
}

type PlayerAggregate = {
  playerId: string;
  gamesPlayed: number;
  averageMinutes: number | null;
  minutes: number | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  steals: number | null;
  blocks: number | null;
  fieldGoalsMade: number | null;
  fieldGoalsAttempted: number | null;
  pointsPerGame: number | null;
  reboundsPerGame: number | null;
  assistsPerGame: number | null;
  stealsPerGame: number | null;
  blocksPerGame: number | null;
  fieldGoalPercentage: number | null;
  threePointPercentage: number | null;
  freeThrowPercentage: number | null;
};

async function aggregatePlayerStats(
  db: StatsArenaDatabase,
  competitionId: string,
  playerIds: string[],
): Promise<Map<string, PlayerAggregate>> {
  if (playerIds.length === 0) return new Map();
  const rows = await db.select({
    playerId: playerGameStats.playerId,
    gamesPlayed: sql<number>`count(*)::int`,
    averageMinutes: sql<number | null>`avg(${playerGameStats.minutes})::float8`,
    minutes: sql<number | null>`sum(${playerGameStats.minutes})::float8`,
    points: sql<number | null>`sum(${playerGameStats.points})::int`,
    rebounds: sql<number | null>`sum(${playerGameStats.rebounds})::int`,
    assists: sql<number | null>`sum(${playerGameStats.assists})::int`,
    steals: sql<number | null>`sum(${playerGameStats.steals})::int`,
    blocks: sql<number | null>`sum(${playerGameStats.blocks})::int`,
    fieldGoalsMade: sql<number | null>`sum(${playerGameStats.fieldGoalsMade})::int`,
    fieldGoalsAttempted: sql<number | null>`sum(${playerGameStats.fieldGoalsAttempted})::int`,
    pointsPerGame: sql<number | null>`avg(${playerGameStats.points})::float8`,
    reboundsPerGame: sql<number | null>`avg(${playerGameStats.rebounds})::float8`,
    assistsPerGame: sql<number | null>`avg(${playerGameStats.assists})::float8`,
    stealsPerGame: sql<number | null>`avg(${playerGameStats.steals})::float8`,
    blocksPerGame: sql<number | null>`avg(${playerGameStats.blocks})::float8`,
    fieldGoalPercentage: sql<number | null>`sum(${playerGameStats.fieldGoalsMade})::float8 * 100 / nullif(sum(${playerGameStats.fieldGoalsAttempted}), 0)`,
    threePointPercentage: sql<number | null>`sum(${playerGameStats.threePointsMade})::float8 * 100 / nullif(sum(${playerGameStats.threePointAttempts}), 0)`,
    freeThrowPercentage: sql<number | null>`sum(${playerGameStats.freeThrowsMade})::float8 * 100 / nullif(sum(${playerGameStats.freeThrowAttempts}), 0)`,
  }).from(playerGameStats)
    .innerJoin(games, eq(games.id, playerGameStats.gameId))
    .where(and(
      eq(games.competitionId, competitionId),
      eq(games.status, "complete"),
      inArray(playerGameStats.playerId, playerIds),
    ))
    .groupBy(playerGameStats.playerId);
  return new Map(rows.map((row) => [row.playerId, row]));
}

async function rosterNamesByPlayer(db: StatsArenaDatabase, competitionId: string, playerIds: string[]) {
  if (playerIds.length === 0) return new Map<string, string[]>();
  const rows = await db.select({ playerId: teamRosters.playerId, teamName: teams.name })
    .from(teamRosters)
    .innerJoin(teams, eq(teams.id, teamRosters.teamId))
    .where(and(eq(teamRosters.competitionId, competitionId), inArray(teamRosters.playerId, playerIds)))
    .orderBy(asc(teams.name), asc(teamRosters.observedAt));
  const names = new Map<string, string[]>();
  for (const row of rows) {
    const current = names.get(row.playerId) ?? [];
    if (!current.includes(row.teamName)) current.push(row.teamName);
    names.set(row.playerId, current);
  }
  return names;
}

export async function getPlayersPage(
  db: StatsArenaDatabase,
  competitionId: string,
  page: number,
  pageSize = PAGE_SIZE,
): Promise<PageResult<PlayerListItem>> {
  const [totalRow] = await db.select({ value: count() }).from(competitionPlayers)
    .where(eq(competitionPlayers.competitionId, competitionId));
  const rows = await db.select({
    id: players.id,
    sourcePlayerId: players.sourcePlayerId,
    name: players.name,
    sourceUrl: competitionPlayers.sourceUrl,
  }).from(competitionPlayers)
    .innerJoin(players, eq(players.id, competitionPlayers.playerId))
    .where(eq(competitionPlayers.competitionId, competitionId))
    .orderBy(asc(players.name), asc(players.sourcePlayerId))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const playerIds = rows.map((row) => row.id);
  const [aggregates, rosterNames] = await Promise.all([
    aggregatePlayerStats(db, competitionId, playerIds),
    rosterNamesByPlayer(db, competitionId, playerIds),
  ]);
  const items = rows.map((row) => ({
    ...row,
    gamesPlayed: aggregates.get(row.id)?.gamesPlayed ?? 0,
    averageMinutes: aggregates.get(row.id)?.averageMinutes ?? null,
    pointsPerGame: aggregates.get(row.id)?.pointsPerGame ?? null,
    reboundsPerGame: aggregates.get(row.id)?.reboundsPerGame ?? null,
    assistsPerGame: aggregates.get(row.id)?.assistsPerGame ?? null,
    stealsPerGame: aggregates.get(row.id)?.stealsPerGame ?? null,
    blocksPerGame: aggregates.get(row.id)?.blocksPerGame ?? null,
    fieldGoalPercentage: aggregates.get(row.id)?.fieldGoalPercentage ?? null,
    threePointPercentage: aggregates.get(row.id)?.threePointPercentage ?? null,
    freeThrowPercentage: aggregates.get(row.id)?.freeThrowPercentage ?? null,
    teamNames: rosterNames.get(row.id) ?? [],
  }));
  return { items, total: totalRow?.value ?? 0, page, pageSize };
}

export async function getPlayerLeaderboard(
  db: StatsArenaDatabase,
  competitionId: string,
  limit = 5,
): Promise<OverviewSummary["leaderboard"]> {
  const rows = await db.select({
    id: players.id,
    sourcePlayerId: players.sourcePlayerId,
    name: players.name,
    gamesPlayed: sql<number>`count(*)::int`,
    pointsPerGame: sql<number | null>`avg(${playerGameStats.points})::float8`,
    reboundsPerGame: sql<number | null>`avg(${playerGameStats.rebounds})::float8`,
    assistsPerGame: sql<number | null>`avg(${playerGameStats.assists})::float8`,
  }).from(competitionPlayers)
    .innerJoin(players, eq(players.id, competitionPlayers.playerId))
    .innerJoin(playerGameStats, eq(playerGameStats.playerId, players.id))
    .innerJoin(games, and(eq(games.id, playerGameStats.gameId), eq(games.competitionId, competitionId), eq(games.status, "complete")))
    .where(eq(competitionPlayers.competitionId, competitionId))
    .groupBy(players.id, players.sourcePlayerId, players.name)
    .having(sql`count(${playerGameStats.points}) > 0`)
    .orderBy(desc(sql`avg(${playerGameStats.points})`), asc(players.name), asc(players.sourcePlayerId))
    .limit(limit);
  const rosterNames = await rosterNamesByPlayer(db, competitionId, rows.map((row) => row.id));
  return rows.map((row) => ({
    ...row,
    teamNames: rosterNames.get(row.id) ?? [],
  }));
}

export async function getPlayerSummary(
  db: StatsArenaDatabase,
  competitionId: string,
  sourcePlayerId: string,
): Promise<PlayerSummary | null> {
  const parsedId = sourceEntityIdSchema.safeParse(sourcePlayerId);
  if (!parsedId.success) return null;
  const [player] = await db.select({
    id: players.id,
    sourcePlayerId: players.sourcePlayerId,
    name: players.name,
    sourceUrl: competitionPlayers.sourceUrl,
  }).from(competitionPlayers)
    .innerJoin(players, eq(players.id, competitionPlayers.playerId))
    .where(and(
      eq(competitionPlayers.competitionId, competitionId),
      eq(players.source, "genius_sports"),
      eq(players.sourcePlayerId, parsedId.data),
    ))
    .limit(1);
  if (!player) return null;
  const [aggregate] = await aggregatePlayerStats(db, competitionId, [player.id]).then((values) => [values.get(player.id)]);
  const teamRows = await db.select({
    id: teams.id,
    sourceTeamId: teams.sourceTeamId,
    name: teams.name,
    sourceUrl: teamRosters.sourceUrl,
    observedAt: teamRosters.observedAt,
  }).from(teamRosters)
    .innerJoin(teams, eq(teams.id, teamRosters.teamId))
    .where(and(eq(teamRosters.competitionId, competitionId), eq(teamRosters.playerId, player.id)))
    .orderBy(desc(teamRosters.observedAt), asc(teams.name));
  const playerHome = alias(teams, "player_home_team");
  const playerAway = alias(teams, "player_away_team");
  const detailedStats = await db.select({
      stats: playerStatsSelection(),
      game: {
        id: games.id,
        sourceGameId: games.sourceGameId,
        homeScore: games.homeScore,
        awayScore: games.awayScore,
        status: games.status,
        scheduledAtRaw: games.scheduledAtRaw,
        venue: games.venue,
        sourceUrl: games.sourceUrl,
      },
      homeTeam: { id: playerHome.id, sourceTeamId: playerHome.sourceTeamId, name: playerHome.name, logoUrl: playerHome.logoUrl },
      awayTeam: { id: playerAway.id, sourceTeamId: playerAway.sourceTeamId, name: playerAway.name, logoUrl: playerAway.logoUrl },
      player: { id: players.id, sourcePlayerId: players.sourcePlayerId, name: players.name },
      team: { id: teams.id, sourceTeamId: teams.sourceTeamId, name: teams.name },
    }).from(playerGameStats)
      .innerJoin(games, eq(games.id, playerGameStats.gameId))
      .innerJoin(players, eq(players.id, playerGameStats.playerId))
      .innerJoin(teams, eq(teams.id, playerGameStats.teamId))
      .leftJoin(playerHome, eq(playerHome.id, games.homeTeamId))
      .leftJoin(playerAway, eq(playerAway.id, games.awayTeamId))
      .where(and(eq(games.competitionId, competitionId), eq(playerGameStats.playerId, player.id)))
      .orderBy(desc(games.updatedAt))
  const item: PlayerListItem = {
    ...player,
    gamesPlayed: aggregate?.gamesPlayed ?? 0,
    averageMinutes: aggregate?.averageMinutes ?? null,
    pointsPerGame: aggregate?.pointsPerGame ?? null,
    reboundsPerGame: aggregate?.reboundsPerGame ?? null,
    assistsPerGame: aggregate?.assistsPerGame ?? null,
    stealsPerGame: aggregate?.stealsPerGame ?? null,
    blocksPerGame: aggregate?.blocksPerGame ?? null,
    fieldGoalPercentage: aggregate?.fieldGoalPercentage ?? null,
    threePointPercentage: aggregate?.threePointPercentage ?? null,
    freeThrowPercentage: aggregate?.freeThrowPercentage ?? null,
    teamNames: teamRows.map((row) => row.name).filter((name, index, values) => values.indexOf(name) === index),
  };
  const summaryTotals = {
    gamesPlayed: item.gamesPlayed,
    minutes: aggregate?.minutes ?? null,
    points: aggregate?.points ?? null,
    rebounds: aggregate?.rebounds ?? null,
    assists: aggregate?.assists ?? null,
    steals: aggregate?.steals ?? null,
    blocks: aggregate?.blocks ?? null,
    fieldGoalsMade: aggregate?.fieldGoalsMade ?? null,
    fieldGoalsAttempted: aggregate?.fieldGoalsAttempted ?? null,
    averageMinutes: item.averageMinutes,
    pointsPerGame: item.pointsPerGame,
    reboundsPerGame: item.reboundsPerGame,
    assistsPerGame: item.assistsPerGame,
    stealsPerGame: item.stealsPerGame,
    blocksPerGame: item.blocksPerGame,
    fieldGoalPercentage: item.fieldGoalPercentage,
    threePointPercentage: item.threePointPercentage,
    freeThrowPercentage: item.freeThrowPercentage,
  };
  const mappedGames = detailedStats.map((row) => ({
    ...row.game,
    homeTeam: row.homeTeam,
    awayTeam: row.awayTeam,
    team: row.team,
    stats: row.stats,
  }));
  return { player: item, totals: summaryTotals, teams: teamRows, games: mappedGames };
}

export async function getTeamsPage(
  db: StatsArenaDatabase,
  competitionId: string,
  page: number,
  pageSize = PAGE_SIZE,
): Promise<PageResult<TeamListItem>> {
  const [totalRow] = await db.select({ value: count() }).from(competitionTeams)
    .where(eq(competitionTeams.competitionId, competitionId));
  const rows = await db.select({
    id: teams.id,
    sourceTeamId: teams.sourceTeamId,
    name: teams.name,
    logoUrl: teams.logoUrl,
    sourceUrl: competitionTeams.sourceUrl,
  }).from(competitionTeams)
    .innerJoin(teams, eq(teams.id, competitionTeams.teamId))
    .where(eq(competitionTeams.competitionId, competitionId))
    .orderBy(asc(teams.name), asc(teams.sourceTeamId))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const teamIds = rows.map((row) => row.id);
  const records = teamIds.length > 0
    ? await db.select({
      teamId: games.homeTeamId,
      awayTeamId: games.awayTeamId,
      homeScore: games.homeScore,
      awayScore: games.awayScore,
      status: games.status,
    }).from(games)
      .where(and(
        eq(games.competitionId, competitionId),
        or(inArray(games.homeTeamId, teamIds), inArray(games.awayTeamId, teamIds)),
        eq(games.status, "complete"),
        isNotNull(games.homeScore),
        isNotNull(games.awayScore),
      ))
    : [];
  const totals = new Map<string, { gamesPlayed: number; wins: number; losses: number }>();
  for (const row of records) {
    if (!row.teamId || !row.awayTeamId || row.homeScore === null || row.awayScore === null) continue;
    const home = totals.get(row.teamId) ?? { gamesPlayed: 0, wins: 0, losses: 0 };
    const away = totals.get(row.awayTeamId) ?? { gamesPlayed: 0, wins: 0, losses: 0 };
    home.gamesPlayed += 1;
    away.gamesPlayed += 1;
    if (row.homeScore > row.awayScore) home.wins += 1;
    else if (row.homeScore < row.awayScore) home.losses += 1;
    if (row.awayScore > row.homeScore) away.wins += 1;
    else if (row.awayScore < row.homeScore) away.losses += 1;
    totals.set(row.teamId, home);
    totals.set(row.awayTeamId, away);
  }
  const items = rows.map((row) => ({
    ...row,
    ...(totals.get(row.id) ?? { gamesPlayed: 0, wins: 0, losses: 0 }),
  }));
  return { items, total: totalRow?.value ?? 0, page, pageSize };
}

async function aggregateTeamTotals(
  db: StatsArenaDatabase,
  competitionId: string,
  teamId: string,
): Promise<TeamStatColumns | null> {
  const [row] = await db.select({
    minutes: sql<number | null>`sum(${teamGameStats.minutes})::float8`,
    fieldGoalsMade: sql<number | null>`sum(${teamGameStats.fieldGoalsMade})::int`,
    fieldGoalsAttempted: sql<number | null>`sum(${teamGameStats.fieldGoalsAttempted})::int`,
    twoPointsMade: sql<number | null>`sum(${teamGameStats.twoPointsMade})::int`,
    twoPointAttempts: sql<number | null>`sum(${teamGameStats.twoPointAttempts})::int`,
    threePointsMade: sql<number | null>`sum(${teamGameStats.threePointsMade})::int`,
    threePointAttempts: sql<number | null>`sum(${teamGameStats.threePointAttempts})::int`,
    freeThrowsMade: sql<number | null>`sum(${teamGameStats.freeThrowsMade})::int`,
    freeThrowAttempts: sql<number | null>`sum(${teamGameStats.freeThrowAttempts})::int`,
    offensiveRebounds: sql<number | null>`sum(${teamGameStats.offensiveRebounds})::int`,
    defensiveRebounds: sql<number | null>`sum(${teamGameStats.defensiveRebounds})::int`,
    rebounds: sql<number | null>`sum(${teamGameStats.rebounds})::int`,
    assists: sql<number | null>`sum(${teamGameStats.assists})::int`,
    steals: sql<number | null>`sum(${teamGameStats.steals})::int`,
    blocks: sql<number | null>`sum(${teamGameStats.blocks})::int`,
    turnovers: sql<number | null>`sum(${teamGameStats.turnovers})::int`,
    personalFouls: sql<number | null>`sum(${teamGameStats.personalFouls})::int`,
    points: sql<number | null>`sum(${teamGameStats.points})::int`,
  }).from(teamGameStats)
    .innerJoin(games, eq(games.id, teamGameStats.gameId))
    .where(and(eq(games.competitionId, competitionId), eq(games.status, "complete"), eq(teamGameStats.teamId, teamId)));
  if (!row || Object.values(row).every((value) => value === null)) return null;
  return {
    ...row,
    fieldGoalPct: ratioPct(row.fieldGoalsMade, row.fieldGoalsAttempted),
    twoPointPct: ratioPct(row.twoPointsMade, row.twoPointAttempts),
    threePointPct: ratioPct(row.threePointsMade, row.threePointAttempts),
    freeThrowPct: ratioPct(row.freeThrowsMade, row.freeThrowAttempts),
  };
}

function ratioPct(made: number | null, attempted: number | null): string | null {
  return made === null || attempted === null || attempted === 0
    ? null
    : ((made / attempted) * 100).toFixed(1);
}

export async function getTeamSummary(
  db: StatsArenaDatabase,
  competitionId: string,
  sourceTeamId: string,
): Promise<TeamSummary | null> {
  const parsedId = sourceEntityIdSchema.safeParse(sourceTeamId);
  if (!parsedId.success) return null;
  const [team] = await db.select({
    id: teams.id,
    sourceTeamId: teams.sourceTeamId,
    name: teams.name,
    logoUrl: teams.logoUrl,
    sourceUrl: competitionTeams.sourceUrl,
  }).from(competitionTeams)
    .innerJoin(teams, eq(teams.id, competitionTeams.teamId))
    .where(and(eq(competitionTeams.competitionId, competitionId), eq(teams.sourceTeamId, parsedId.data)))
    .limit(1);
  if (!team) return null;
  const [totals, gamesPage, roster, officialRows] = await Promise.all([
    aggregateTeamTotals(db, competitionId, team.id),
    getTeamGames(db, competitionId, team.id),
    db.select({
      id: players.id,
      sourcePlayerId: players.sourcePlayerId,
      name: players.name,
      sourceUrl: teamRosters.sourceUrl,
      observedAt: teamRosters.observedAt,
    }).from(teamRosters)
      .innerJoin(players, eq(players.id, teamRosters.playerId))
      .where(and(eq(teamRosters.competitionId, competitionId), eq(teamRosters.teamId, team.id)))
      .orderBy(asc(players.name), asc(players.sourcePlayerId)),
    db.select({
      metricCode: officialTeamMetrics.metricCode,
      value: officialTeamMetrics.value,
      availability: officialTeamMetrics.availability,
      unit: officialTeamMetrics.unit,
      scopeLabel: officialTeamMetrics.scopeLabel,
      sampleGamesPlayed: officialTeamMetrics.sampleGamesPlayed,
      rawValue: officialTeamMetrics.rawValue,
      sourceUrl: officialTeamMetrics.sourceUrl,
    }).from(officialTeamMetrics)
      .where(and(
        eq(officialTeamMetrics.competitionId, competitionId),
        eq(officialTeamMetrics.scopeType, "competition"),
        eq(officialTeamMetrics.teamId, team.id),
      ))
      .orderBy(asc(officialTeamMetrics.metricCode)),
  ]);
  const record = gamesPage.items.reduce((summary, game) => {
    if (game.status !== "complete") return summary;
    if (game.result === "W") summary.wins += 1;
    if (game.result === "L") summary.losses += 1;
    if (game.teamScore !== null && game.opponentScore !== null) summary.gamesPlayed += 1;
    return summary;
  }, { gamesPlayed: 0, wins: 0, losses: 0 });
  return {
    team: { ...team, ...record },
    totals,
    games: gamesPage.items,
    roster,
    officialMetrics: officialRows,
  };
}

async function getTeamGames(db: StatsArenaDatabase, competitionId: string, teamId: string) {
  const { homeTeam, awayTeam, selection } = gameSelection();
  const rows = await db.select({ ...selection, homeTeamId: games.homeTeamId, awayTeamId: games.awayTeamId })
    .from(games)
    .leftJoin(homeTeam, eq(homeTeam.id, games.homeTeamId))
    .leftJoin(awayTeam, eq(awayTeam.id, games.awayTeamId))
    .where(and(eq(games.competitionId, competitionId), or(eq(games.homeTeamId, teamId), eq(games.awayTeamId, teamId))))
    .orderBy(desc(games.updatedAt), asc(games.sourceGameId))
    .limit(250);
  return {
    items: rows.map((row) => {
      const game = mapGame(row);
      const home = row.homeTeamId === teamId;
      const teamScore = home ? game.homeScore : game.awayScore;
      const opponentScore = home ? game.awayScore : game.homeScore;
      const result = game.status !== "complete" || teamScore === null || opponentScore === null
        ? "—"
        : teamScore > opponentScore ? "W" : teamScore < opponentScore ? "L" : "—";
      return { ...game, teamScore, opponentScore, result } as const;
    }),
  };
}

export async function getStandings(
  db: StatsArenaDatabase,
  competitionId: string,
  filters: StandingsFilters = {},
): Promise<{ groups: Array<Pick<typeof competitionGroups.$inferSelect, "id" | "sourceGroupId" | "label" | "poolNumber" | "sourceUrl">>; selectedGroupId: string | null; rows: StandingListItem[] }> {
  const groups = await db.select({
    id: competitionGroups.id,
    sourceGroupId: competitionGroups.sourceGroupId,
    label: competitionGroups.label,
    poolNumber: competitionGroups.poolNumber,
    sourceUrl: competitionGroups.sourceUrl,
  }).from(competitionGroups)
    .where(eq(competitionGroups.competitionId, competitionId))
    .orderBy(asc(competitionGroups.label), asc(competitionGroups.sourceGroupId));
  const selected = filters.groupId
    ? groups.find((group) => group.id === filters.groupId)
    : undefined;
  const groupIds = selected ? [selected.id] : filters.groupId ? [] : groups.map((group) => group.id);
  if (groupIds.length === 0) return { groups, selectedGroupId: selected?.id ?? null, rows: [] };
  const rows = await db.select({
    position: groupStandings.position,
    gamesPlayed: groupStandings.gamesPlayed,
    wins: groupStandings.wins,
    losses: groupStandings.losses,
    draws: groupStandings.draws,
    pointsFor: groupStandings.pointsFor,
    pointsAgainst: groupStandings.pointsAgainst,
    pointDifference: groupStandings.pointDifference,
    standingPoints: groupStandings.standingPoints,
    group: {
      id: competitionGroups.id,
      sourceGroupId: competitionGroups.sourceGroupId,
      label: competitionGroups.label,
      poolNumber: competitionGroups.poolNumber,
      sourceUrl: competitionGroups.sourceUrl,
    },
    team: { id: teams.id, sourceTeamId: teams.sourceTeamId, name: teams.name, logoUrl: teams.logoUrl },
  }).from(groupStandings)
    .innerJoin(competitionGroups, eq(competitionGroups.id, groupStandings.groupId))
    .innerJoin(teams, eq(teams.id, groupStandings.teamId))
    .where(and(eq(competitionGroups.competitionId, competitionId), inArray(groupStandings.groupId, groupIds)))
    .orderBy(asc(competitionGroups.label), asc(groupStandings.position), asc(teams.name));
  return { groups, selectedGroupId: selected?.id ?? null, rows };
}

export async function getOverview(db: StatsArenaDatabase, competitionId: string): Promise<OverviewSummary> {
  const [gameCount, teamCount, playerCount, groupCount, statuses, lastRun, latestGames, standings, leaderboard, operations] = await Promise.all([
    db.select({ value: count() }).from(games).where(eq(games.competitionId, competitionId)),
    db.select({ value: count() }).from(competitionTeams).where(eq(competitionTeams.competitionId, competitionId)),
    db.select({ value: count() }).from(competitionPlayers).where(eq(competitionPlayers.competitionId, competitionId)),
    db.select({ value: count() }).from(competitionGroups).where(eq(competitionGroups.competitionId, competitionId)),
    db.select({
      status: games.status,
      value: count(),
    }).from(games).where(eq(games.competitionId, competitionId)).groupBy(games.status),
    db.select({ finishedAt: importRuns.finishedAt }).from(importRuns)
      .where(and(eq(importRuns.competitionId, competitionId), isNotNull(importRuns.finishedAt)))
      .orderBy(desc(importRuns.finishedAt)).limit(1),
    getGamesPage(db, competitionId, { page: 1 }, 5),
    getStandings(db, competitionId),
    getPlayerLeaderboard(db, competitionId),
    getOperationalStatus(db, competitionId),
  ]);
  const statusCount = new Map(statuses.map((row) => [row.status, row.value]));
  const seenGroups = new Set<string>();
  const firstStandingByGroup = standings.rows.filter((standing) => {
    if (seenGroups.has(standing.group.id)) return false;
    seenGroups.add(standing.group.id);
    return true;
  });
  return {
    games: gameCount[0]?.value ?? 0,
    teams: teamCount[0]?.value ?? 0,
    players: playerCount[0]?.value ?? 0,
    groups: groupCount[0]?.value ?? 0,
    scheduledGames: statusCount.get("scheduled") ?? 0,
    liveGames: statusCount.get("live") ?? 0,
    completedGames: statusCount.get("complete") ?? 0,
    lastSyncAt: lastRun[0]?.finishedAt ?? null,
    operations,
    latestGames: latestGames.items,
    standings: firstStandingByGroup,
    leaderboard,
  };
}

export async function getOperationalStatus(db: StatsArenaDatabase, competitionId: string): Promise<OperationalStatus> {
  const [competition] = await db.select({ sourceCompetitionId: competitions.sourceCompetitionId })
    .from(competitions).where(eq(competitions.id, competitionId)).limit(1);
  const [runs, leases, sourceFetchRows] = await Promise.all([
    db.select({
      id: syncRuns.id,
      status: syncRuns.status,
      mode: syncRuns.mode,
      startedAt: syncRuns.startedAt,
      heartbeatAt: syncRuns.heartbeatAt,
      finishedAt: syncRuns.finishedAt,
      nextRunAt: syncRuns.nextRunAt,
      pageCount: syncRuns.pageCount,
      failureCount: syncRuns.failureCount,
      failureUrls: syncRuns.failureUrls,
      writeCounts: syncRuns.writeCounts,
      resultSummary: syncRuns.resultSummary,
      importRunId: syncRuns.importRunId,
    }).from(syncRuns).where(eq(syncRuns.competitionId, competitionId))
      .orderBy(desc(syncRuns.startedAt)).limit(20),
    competition ? db.select({ expiresAt: syncLeases.expiresAt }).from(syncLeases)
      .where(and(eq(syncLeases.source, "genius_sports"), eq(syncLeases.sourceCompetitionId, competition.sourceCompetitionId))).limit(1)
      : Promise.resolve([]),
    db.select({ requestedAt: sourceFetches.requestedAt, sourceFetchedAt: sourceFetches.sourceFetchedAt })
      .from(sourceFetches).where(and(eq(sourceFetches.competitionId, competitionId), isNotNull(sourceFetches.sourceFetchedAt)))
      .orderBy(desc(sourceFetches.requestedAt)).limit(1),
  ]);
  const latest = runs[0] ?? null;
  const latestFinished = runs.find((run) => run.status !== "running") ?? null;
  const statusRun = latest?.status === "running" ? latest : latestFinished ?? latest;
  const leaseExpiry = leases[0]?.expiresAt.getTime() ?? 0;
  const now = Date.now();
  const activeLease = leaseExpiry > now;
  const freshHeartbeat = latest !== null && now - latest.heartbeatAt.getTime() < 120_000;
  const isRunning = latest?.status === "running" && activeLease && freshHeartbeat;
  const isStale = latest?.status === "running" && !isRunning;
  const reviewIssueRows = latestFinished?.importRunId
    ? await db.select({ value: count() }).from(validationIssues).where(and(
      eq(validationIssues.competitionId, competitionId),
      eq(validationIssues.importRunId, latestFinished.importRunId)
    ))
    : [];
  return {
    isRunning,
    isStale,
    latestStatus: latest?.status ?? null,
    latestMode: latest?.mode ?? null,
    lastCheckedAt: latest?.startedAt ?? null,
    lastFinishedAt: latestFinished?.finishedAt ?? null,
    lastSourceFetchedAt: sourceFetchRows[0]?.sourceFetchedAt ?? null,
    nextRunAt: latest?.nextRunAt ?? latestFinished?.nextRunAt ?? null,
    pageCount: statusRun?.pageCount ?? 0,
    failureCount: statusRun?.failureCount ?? 0,
    failureUrls: (statusRun?.failureUrls ?? []).slice(0, 10),
    reviewIssueCount: reviewIssueRows[0]?.value ?? 0,
    writeCounts: latestFinished?.writeCounts ?? {},
    resultSummary: latestFinished?.resultSummary ?? latest?.resultSummary ?? null,
  };
}

export async function getReviewSummary(
  db: StatsArenaDatabase,
  competitionId: string,
  filters: ReviewFilters,
  pageSize = PAGE_SIZE,
): Promise<ReviewSummary> {
  const [runRows, totalRows, issueTypeRows] = await Promise.all([
    db.select({
      id: importRuns.id,
      mode: importRuns.mode,
      status: importRuns.status,
      parserVersion: importRuns.parserVersion,
      startedAt: importRuns.startedAt,
      finishedAt: importRuns.finishedAt,
      recordCounts: importRuns.recordCounts,
      errorSummary: importRuns.errorSummary,
    }).from(importRuns)
      .where(eq(importRuns.competitionId, competitionId))
      .orderBy(desc(importRuns.startedAt)).limit(20),
    db.select({ value: count() }).from(validationIssues).where(eq(validationIssues.competitionId, competitionId)),
    db.selectDistinct({ code: validationIssues.code }).from(validationIssues)
      .where(eq(validationIssues.competitionId, competitionId))
      .orderBy(asc(validationIssues.code)).limit(100),
  ]);
  const latestRunId = runRows[0]?.id ?? null;
  const conditions: SQL[] = [eq(validationIssues.competitionId, competitionId)];
  if (filters.severity) conditions.push(eq(validationIssues.severity, filters.severity));
  if (filters.code) conditions.push(eq(validationIssues.code, filters.code));
  const where = and(...conditions);
  const [filteredCount] = await db.select({ value: count() }).from(validationIssues).where(where);
  const rows = await db.select({
    id: validationIssues.id,
    severity: validationIssues.severity,
    code: validationIssues.code,
    message: validationIssues.message,
    fieldPath: validationIssues.fieldPath,
    sourceUrl: validationIssues.sourceUrl,
    createdAt: validationIssues.createdAt,
    game: { id: games.id, sourceGameId: games.sourceGameId },
    importRun: {
      id: importRuns.id,
      mode: importRuns.mode,
      status: importRuns.status,
      startedAt: importRuns.startedAt,
      finishedAt: importRuns.finishedAt,
    },
  }).from(validationIssues)
    .leftJoin(games, and(eq(games.id, validationIssues.gameId), eq(games.competitionId, competitionId)))
    .leftJoin(importRuns, eq(importRuns.id, validationIssues.importRunId))
    .where(where)
    .orderBy(desc(validationIssues.createdAt), desc(validationIssues.id))
    .limit(pageSize)
    .offset((filters.page - 1) * pageSize);
  const issues: PageResult<ReviewIssueListItem> = {
    items: rows.map((row) => ({ ...row, isLatestRun: Boolean(row.importRun?.id && row.importRun.id === latestRunId) })),
    total: filteredCount?.value ?? 0,
    page: filters.page,
    pageSize,
  };
  const mappedRuns: ImportRunListItem[] = runRows;
  return {
    totalIssues: totalRows[0]?.value ?? 0,
    issueTypes: issueTypeRows.map((row) => row.code),
    latestRun: mappedRuns[0] ?? null,
    runs: mappedRuns,
    issues,
  };
}
