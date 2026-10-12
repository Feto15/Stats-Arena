import * as z from "zod";

export const PARSER_VERSION = "statsarena-parser/0.2.2";
export const SOURCE_NAME = "genius_sports" as const;

export const gameStatusSchema = z.enum(["scheduled", "live", "complete", "unknown"]);
export type GameStatus = z.infer<typeof gameStatusSchema>;

export const parseStatusSchema = z.enum(["parsed", "partial", "failed"]);
export type ParseStatus = z.infer<typeof parseStatusSchema>;

export const issueSeveritySchema = z.enum(["info", "warning", "error"]);
export type IssueSeverity = z.infer<typeof issueSeveritySchema>;

export const validationIssueSchema = z.object({
  severity: issueSeveritySchema,
  code: z.string().min(1),
  message: z.string().min(1),
  sourceUrl: z.url().nullable(),
  fieldPath: z.string().nullable(),
  expected: z.unknown().nullable(),
  actual: z.unknown().nullable()
});
export type ValidationIssue = z.infer<typeof validationIssueSchema>;

export const competitionSchema = z.object({
  sourceId: z.string().min(1),
  sourceUrl: z.url(),
  name: z.string().min(1),
  season: z.string().nullable(),
  year: z.number().int().nullable()
});
export type CompetitionRecord = z.infer<typeof competitionSchema>;

export const teamSchema = z.object({
  sourceId: z.string().min(1),
  sourceUrl: z.url(),
  name: z.string().min(1),
  logoUrl: z.url().nullable()
});
export type TeamRecord = z.infer<typeof teamSchema>;

export const playerSchema = z.object({
  sourceId: z.string().min(1),
  sourceUrl: z.url(),
  name: z.string().min(1)
});
export type PlayerRecord = z.infer<typeof playerSchema>;

export const groupSchema = z.object({
  sourceId: z.string().min(1),
  sourceUrl: z.url(),
  label: z.string().min(1),
  poolNumber: z.string().nullable()
});
export type GroupRecord = z.infer<typeof groupSchema>;

const nullableInt = z.number().int().nonnegative().nullable();

export const standingRowSchema = z.object({
  groupSourceId: z.string().min(1),
  teamSourceId: z.string().min(1),
  teamName: z.string().min(1),
  position: nullableInt,
  gamesPlayed: nullableInt,
  wins: nullableInt,
  losses: nullableInt,
  draws: nullableInt,
  pointsFor: nullableInt,
  pointsAgainst: nullableInt,
  pointDifference: z.number().int().nullable(),
  standingPoints: nullableInt,
  sourceUrl: z.url()
});
export type StandingRowRecord = z.infer<typeof standingRowSchema>;

export const gameSchema = z.object({
  sourceId: z.string().min(1),
  sourceUrl: z.url(),
  homeTeamSourceId: z.string().nullable(),
  awayTeamSourceId: z.string().nullable(),
  homeTeamName: z.string().nullable(),
  awayTeamName: z.string().nullable(),
  homeScore: nullableInt,
  awayScore: nullableInt,
  scheduledAtRaw: z.string().nullable(),
  venue: z.string().nullable(),
  status: gameStatusSchema
});
export type GameRecord = z.infer<typeof gameSchema>;

export const summarySchema = gameSchema.extend({
  summaryText: z.string().nullable()
});
export type SummaryRecord = z.infer<typeof summarySchema>;

export const boxScoreStatsSchema = z.object({
  minutesRaw: z.string().nullable(),
  minutes: z.number().finite().nonnegative().nullable(),
  fieldGoalsMade: nullableInt,
  fieldGoalsAttempted: nullableInt,
  twoPointsMade: nullableInt,
  twoPointAttempts: nullableInt,
  threePointsMade: nullableInt,
  threePointAttempts: nullableInt,
  freeThrowsMade: nullableInt,
  freeThrowAttempts: nullableInt,
  offensiveRebounds: nullableInt,
  defensiveRebounds: nullableInt,
  rebounds: nullableInt,
  assists: nullableInt,
  steals: nullableInt,
  blocks: nullableInt,
  turnovers: nullableInt,
  personalFouls: nullableInt,
  points: nullableInt,
  fieldGoalPct: z.string().nullable(),
  twoPointPct: z.string().nullable(),
  threePointPct: z.string().nullable(),
  freeThrowPct: z.string().nullable(),
  rawValues: z.record(z.string(), z.string().nullable())
});
export type BoxScoreStats = z.infer<typeof boxScoreStatsSchema>;

export const playerBoxScoreSchema = boxScoreStatsSchema.extend({
  playerSourceId: z.string().min(1),
  playerName: z.string().min(1),
  teamSourceId: z.string().min(1),
  jerseyNumber: z.string().nullable(),
  sourceUrl: z.url()
});
export type PlayerBoxScoreRecord = z.infer<typeof playerBoxScoreSchema>;

export const teamBoxScoreSchema = boxScoreStatsSchema.extend({
  teamSourceId: z.string().min(1),
  teamName: z.string().min(1),
  sourceUrl: z.url()
});
export type TeamBoxScoreRecord = z.infer<typeof teamBoxScoreSchema>;

export const boxScoreSchema = z.object({
  gameSourceId: z.string().min(1),
  sourceUrl: z.url(),
  teams: z.array(teamBoxScoreSchema),
  players: z.array(playerBoxScoreSchema)
});
export type BoxScoreRecord = z.infer<typeof boxScoreSchema>;

export const playByPlayEventSchema = z.object({
  gameSourceId: z.string().min(1),
  sourceSequence: z.number().int().nonnegative(),
  sourceUrl: z.url(),
  periodNumber: z.number().int().positive().nullable(),
  periodLabelRaw: z.string().nullable(),
  periodType: z.enum(["regulation", "overtime", "unknown"]),
  timeRaw: z.string().nullable(),
  actionType: z.string().min(1),
  actionText: z.string().min(1).nullable(),
  teamSourceId: z.string().min(1).nullable(),
  teamSide: z.enum(["home", "away", "neutral", "unknown"]),
  playerSourceId: z.string().min(1).nullable(),
  playerName: z.string().nullable(),
  scoreRaw: z.string().nullable(),
  team1Score: nullableInt,
  team2Score: nullableInt,
  rawClasses: z.array(z.string())
});
export type PlayByPlayEventRecord = z.infer<typeof playByPlayEventSchema>;

export const shotSchema = z.object({
  gameSourceId: z.string().min(1),
  sourceSequence: z.number().int().nonnegative(),
  sourceUrl: z.url(),
  periodNumber: z.number().int().positive(),
  teamSourceId: z.string().min(1),
  teamName: z.string().nullable(),
  playerSourceId: z.string().min(1),
  playerName: z.string().nullable(),
  shotType: z.enum(["2pt", "3pt"]),
  result: z.enum(["made", "missed"]),
  xRaw: z.string(),
  yRaw: z.string(),
  xPercent: z.number().finite().min(0).max(100),
  yPercent: z.number().finite().min(0).max(100),
  rawTitle: z.string(),
  rawClasses: z.array(z.string())
});
export type ShotRecord = z.infer<typeof shotSchema>;

export const officialTeamMetricSchema = z.discriminatedUnion("scope", [
  z.object({
    scope: z.literal("game"),
    competitionSourceId: z.string().min(1),
    gameSourceId: z.string().min(1),
    teamSourceId: z.string().min(1),
    teamName: z.string().min(1),
    metricCode: z.enum(["BP", "2CP"]),
    value: nullableInt,
    availability: z.enum(["available", "unavailable"]),
    unit: z.literal("points"),
    scopeLabel: z.string().nullable(),
    sampleGamesPlayed: z.number().int().nonnegative().nullable(),
    rawValue: z.string().nullable(),
    sourceUrl: z.url()
  }),
  z.object({
    scope: z.literal("competition"),
    competitionSourceId: z.string().min(1),
    gameSourceId: z.null(),
    teamSourceId: z.string().min(1),
    teamName: z.string().min(1),
    metricCode: z.enum(["BP", "2CP"]),
    value: nullableInt,
    availability: z.enum(["available", "unavailable"]),
    unit: z.literal("points"),
    scopeLabel: z.string().nullable(),
    sampleGamesPlayed: z.number().int().nonnegative().nullable(),
    rawValue: z.string().nullable(),
    sourceUrl: z.url()
  })
]);
export type OfficialTeamMetricRecord = z.infer<typeof officialTeamMetricSchema>;

export const matchDetailTabLinksSchema = z.object({
  gameSourceId: z.string().min(1),
  summary: z.url().nullable(),
  boxScore: z.url().nullable(),
  playByPlay: z.url().nullable(),
  shotChart: z.url().nullable(),
  analysis: z.url().nullable()
});
export type MatchDetailTabLinks = z.infer<typeof matchDetailTabLinksSchema>;

export interface ParseReport<T> {
  status: Exclude<ParseStatus, "failed">;
  sourceUrl: string;
  records: T[];
  issues: ValidationIssue[];
}

export interface CompetitionPageData {
  competition: CompetitionRecord;
  games: GameRecord[];
  groups: GroupRecord[];
}

export interface GroupStandingsData {
  group: GroupRecord;
  rows: StandingRowRecord[];
}

export interface MatchImportData {
  fixture: GameRecord;
  summary: SummaryRecord | null;
  boxScore: BoxScoreRecord | null;
  issues: ValidationIssue[];
  availability?: {
    summary: PageAvailability;
    boxScore: PageAvailability;
    playByPlay?: PageAvailability;
    shotChart?: PageAvailability;
    analysis?: PageAvailability;
  };
  playByPlay?: ParseReport<PlayByPlayEventRecord> | null;
  shotChart?: ParseReport<ShotRecord> | null;
  officialMetrics?: ParseReport<OfficialTeamMetricRecord> | null;
}

export type PageAvailability = "scheduled" | "available" | "fetch_failed" | "partial" | "parse_failed" | "unavailable";

export interface ParsedCompetitionData {
  competition: CompetitionRecord;
  teams: TeamRecord[];
  players: PlayerRecord[];
  groups: GroupStandingsData[];
  teamOfficialMetrics?: ParseReport<OfficialTeamMetricRecord> | null;
  matches: MatchImportData[];
  issues: ValidationIssue[];
}
