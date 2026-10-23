import type { DetailQuality } from "@statsarena/db/data-quality";
import type {
  competitionGroups,
  competitions,
  games,
  gameLiveStats,
  groupStandings,
  importRuns,
  syncRuns,
  officialTeamMetrics,
  playByPlayEvents,
  playerGameStats,
  players,
  shots,
  sourceFetches,
  teamGameStats,
  teams,
  validationIssues,
} from "@statsarena/db/schema";

type RowOf<Table> = Table extends { $inferSelect: infer Row } ? Row : never;

type CompetitionRow = RowOf<typeof competitions>;
type GameRow = RowOf<typeof games>;
type TeamRow = RowOf<typeof teams>;
type PlayerRow = RowOf<typeof players>;
type GroupRow = RowOf<typeof competitionGroups>;
type StandingRow = RowOf<typeof groupStandings>;
type ValidationIssueRow = RowOf<typeof validationIssues>;
type ImportRunRow = RowOf<typeof importRuns>;
type SyncRunRow = RowOf<typeof syncRuns>;
type PlayerStatsRow = RowOf<typeof playerGameStats>;
type TeamStatsRow = RowOf<typeof teamGameStats>;
type SourceFetchRow = RowOf<typeof sourceFetches>;

export type CompetitionOption = Pick<
  CompetitionRow,
  "id" | "sourceCompetitionId" | "name" | "season" | "year"
>;

export type PageResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type GameListItem = Pick<
  GameRow,
  | "id"
  | "sourceGameId"
  | "homeScore"
  | "awayScore"
  | "status"
  | "scheduledAtRaw"
  | "venue"
  | "sourceUrl"
> & {
  homeTeam: Pick<TeamRow, "id" | "sourceTeamId" | "name" | "logoUrl"> | null;
  awayTeam: Pick<TeamRow, "id" | "sourceTeamId" | "name" | "logoUrl"> | null;
};

export type TeamListItem = Pick<TeamRow, "id" | "sourceTeamId" | "name" | "logoUrl" | "sourceUrl"> & {
  gamesPlayed: number;
  wins: number;
  losses: number;
};

export type PlayerListItem = Pick<PlayerRow, "id" | "sourcePlayerId" | "name" | "sourceUrl"> & {
  gamesPlayed: number;
  averageMinutes: number | null;
  pointsPerGame: number | null;
  reboundsPerGame: number | null;
  assistsPerGame: number | null;
  stealsPerGame: number | null;
  blocksPerGame: number | null;
  fieldGoalPercentage: number | null;
  threePointPercentage: number | null;
  freeThrowPercentage: number | null;
  turnoversPerGame: number | null;
  personalFoulsPerGame: number | null;
  offensiveReboundsPerGame: number | null;
  defensiveReboundsPerGame: number | null;
  twoPointPercentage: number | null;
  effectiveFieldGoalPercentage: number | null;
  trueShootingPercentage: number | null;
  efficiencyPerGame: number | null;
  assistTurnoverRatio: number | null;
  teamNames: string[];
};

export type StandingListItem = Pick<
  StandingRow,
  | "position"
  | "gamesPlayed"
  | "wins"
  | "losses"
  | "draws"
  | "pointsFor"
  | "pointsAgainst"
  | "pointDifference"
  | "standingPoints"
> & {
  group: Pick<GroupRow, "id" | "sourceGroupId" | "label" | "poolNumber" | "sourceUrl">;
  team: Pick<TeamRow, "id" | "sourceTeamId" | "name" | "logoUrl">;
};

export type ReviewIssueListItem = Pick<
  ValidationIssueRow,
  "id" | "severity" | "code" | "message" | "fieldPath" | "sourceUrl" | "createdAt" | "expected" | "actual"
> & {
  issueSource: "portal" | "livestats";
  supplementStatus: RowOf<typeof gameLiveStats>["status"] | null;
  game: Pick<GameRow, "id" | "sourceGameId" | "status"> | null;
  importRun: Pick<ImportRunRow, "id" | "mode" | "status" | "startedAt" | "finishedAt"> | null;
  isLatestRun: boolean;
};

export type ImportRunListItem = Pick<
  ImportRunRow,
  "id" | "mode" | "status" | "parserVersion" | "startedAt" | "finishedAt" | "recordCounts" | "errorSummary"
>;

export interface OverviewSummary {
  games: number;
  teams: number;
  players: number;
  groups: number;
  scheduledGames: number;
  liveGames: number;
  completedGames: number;
  lastSyncAt: Date | null;
  operations: OperationalStatus;
  latestGames: GameListItem[];
  standings: StandingListItem[];
  leaderboard: Pick<PlayerListItem, "id" | "sourcePlayerId" | "name" | "teamNames" | "gamesPlayed" | "pointsPerGame" | "reboundsPerGame" | "assistsPerGame">[];
}

export interface OperationalStatus {
  isRunning: boolean;
  isStale: boolean;
  latestStatus: SyncRunRow["status"] | null;
  latestMode: SyncRunRow["mode"] | null;
  lastCheckedAt: Date | null;
  lastFinishedAt: Date | null;
  lastSourceFetchedAt: Date | null;
  nextRunAt: Date | null;
  pageCount: number;
  failureCount: number;
  failureUrls: string[];
  reviewIssueCount: number;
  writeCounts: Record<string, number>;
  resultSummary: string | null;
}

export type StatColumns = Pick<
  PlayerStatsRow,
  | "jerseyNumber"
  | "minutesRaw"
  | "minutes"
  | "fieldGoalsMade"
  | "fieldGoalsAttempted"
  | "twoPointsMade"
  | "twoPointAttempts"
  | "threePointsMade"
  | "threePointAttempts"
  | "freeThrowsMade"
  | "freeThrowAttempts"
  | "offensiveRebounds"
  | "defensiveRebounds"
  | "rebounds"
  | "assists"
  | "steals"
  | "blocks"
  | "turnovers"
  | "personalFouls"
  | "points"
  | "fieldGoalPct"
  | "twoPointPct"
  | "threePointPct"
  | "freeThrowPct"
>;

export type TeamStatColumns = Pick<
  TeamStatsRow,
  | "minutes"
  | "fieldGoalsMade"
  | "fieldGoalsAttempted"
  | "twoPointsMade"
  | "twoPointAttempts"
  | "threePointsMade"
  | "threePointAttempts"
  | "freeThrowsMade"
  | "freeThrowAttempts"
  | "offensiveRebounds"
  | "defensiveRebounds"
  | "rebounds"
  | "assists"
  | "steals"
  | "blocks"
  | "turnovers"
  | "personalFouls"
  | "points"
  | "fieldGoalPct"
  | "twoPointPct"
  | "threePointPct"
  | "freeThrowPct"
>;

export type GameTeamStatsItem = TeamStatColumns & {
  statDerivations: TeamStatsRow["statDerivations"];
  team: Pick<TeamRow, "id" | "sourceTeamId" | "name">;
};

export type GamePlayerStatsItem = StatColumns & {
  statDerivations: PlayerStatsRow["statDerivations"];
  player: Pick<PlayerRow, "id" | "sourcePlayerId" | "name">;
  team: Pick<TeamRow, "id" | "sourceTeamId" | "name">;
};

export type SourceFetchSummary = Pick<
  SourceFetchRow,
  "id" | "resource" | "fetchStatus" | "parseStatus" | "httpStatus" | "fetchedAt" | "durationMs" | "responseBytes" | "sha256" | "requestUrl"
>;

type PlayByPlayRow = RowOf<typeof playByPlayEvents>;
type ShotRow = RowOf<typeof shots>;
type OfficialMetricRow = RowOf<typeof officialTeamMetrics>;

export type PlayByPlayItem = Pick<PlayByPlayRow,
  "sourceSequence" | "periodNumber" | "periodLabelRaw" | "periodType" | "timeRaw" | "actionType" | "actionText" |
  "teamSide" | "playerName" | "scoreRaw" | "team1Score" | "team2Score" | "rawClasses" | "sourceUrl"
> & {
  team: Pick<TeamRow, "id" | "sourceTeamId" | "name"> | null;
  player: Pick<PlayerRow, "id" | "sourcePlayerId" | "name"> | null;
};

export type ShotChartItem = Pick<ShotRow,
  "sourceSequence" | "periodNumber" | "playerName" | "shotType" | "result" | "xRaw" | "yRaw" | "xPercent" | "yPercent" | "rawTitle" | "rawClasses" | "sourceUrl"
> & {
  team: Pick<TeamRow, "id" | "sourceTeamId" | "name">;
  player: Pick<PlayerRow, "id" | "sourcePlayerId" | "name">;
};

export type OfficialGameMetricItem = Pick<OfficialMetricRow,
  "scopeType" | "metricCode" | "value" | "availability" | "unit" | "scopeLabel" | "sampleGamesPlayed" | "rawValue" | "sourceUrl"
> & { team: Pick<TeamRow, "id" | "sourceTeamId" | "name"> };

export type GameValidationIssueItem = Pick<ValidationIssueRow,
  "id" | "severity" | "code" | "message" | "fieldPath" | "sourceUrl" | "createdAt" | "expected" | "actual"
>;

export type OfficialCompetitionMetricItem = Pick<OfficialMetricRow,
  "metricCode" | "value" | "availability" | "unit" | "scopeLabel" | "sampleGamesPlayed" | "rawValue" | "sourceUrl"
>;

export type GameDetailFilters = {
  periodNumber?: number;
  teamSourceId?: string;
  playerSourceId?: string;
  result?: "made" | "missed";
};

export type GameDetail = GameListItem & {
  liveStats: Pick<RowOf<typeof gameLiveStats>, "status" | "payload" | "sourceUrl" | "pageUrl" | "sourceFetchedAt" | "lastAttemptAt" | "issues"> | null;
  datasetQuality: DetailQuality | null;
  homeTeamStats: GameTeamStatsItem | null;
  awayTeamStats: GameTeamStatsItem | null;
  playerStats: GamePlayerStatsItem[];
  playByPlayEvents: PlayByPlayItem[];
  shots: ShotChartItem[];
  gameOfficialMetrics: OfficialGameMetricItem[];
  validationIssues: GameValidationIssueItem[];
  detailFetches: SourceFetchSummary[];
  summaryFetch: SourceFetchSummary | null;
  boxscoreFetch: SourceFetchSummary | null;
};

export interface TeamSummary {
  team: TeamListItem;
  totals: TeamStatColumns | null;
  games: Array<GameListItem & { teamScore: number | null; opponentScore: number | null; result: "W" | "L" | "—" }>;
  roster: Array<Pick<PlayerRow, "id" | "sourcePlayerId" | "name" | "sourceUrl"> & { observedAt: Date }>;
  officialMetrics: OfficialCompetitionMetricItem[];
}

export interface PlayerSummary {
  player: PlayerListItem;
  totals: {
    gamesPlayed: number;
    minutes: number | null;
    points: number | null;
    rebounds: number | null;
    assists: number | null;
    steals: number | null;
    blocks: number | null;
    fieldGoalsMade: number | null;
    fieldGoalsAttempted: number | null;
    averageMinutes: number | null;
    pointsPerGame: number | null;
    reboundsPerGame: number | null;
    assistsPerGame: number | null;
    stealsPerGame: number | null;
    blocksPerGame: number | null;
    fieldGoalPercentage: number | null;
    threePointPercentage: number | null;
    freeThrowPercentage: number | null;
  };
  teams: Array<Pick<TeamRow, "id" | "sourceTeamId" | "name"> & { sourceUrl: string; observedAt: Date }>;
  games: Array<GameListItem & { team: Pick<TeamRow, "id" | "sourceTeamId" | "name">; stats: StatColumns }>;
}

export interface ReviewSummary {
  totalIssues: number;
  sourceCounts: { portal: number; livestats: number };
  liveStatsGames: number;
  issueTypes: string[];
  latestRun: ImportRunListItem | null;
  runs: ImportRunListItem[];
  issues: PageResult<ReviewIssueListItem>;
}

export interface ActiveReviewIssue {
  source: "portal" | "livestats";
  status: string;
  code: string;
  message: string;
  sourceUrl: string | null;
}

export interface GlobalReviewSummary {
  totalGames: number;
  competitions: number;
  portalGames: number;
  liveStatsGames: number;
  issueTypes: string[];
  games: PageResult<{
    id: string;
    sourceGameId: string;
    status: GameRow["status"];
    homeName: string | null;
    awayName: string | null;
    homeScore: number | null;
    awayScore: number | null;
    competitionName: string;
    competitionRef: string;
    checkedAt: Date;
    issues: ActiveReviewIssue[];
  }>;
}

export type DashboardDataState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "empty"; message: string }
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string };
