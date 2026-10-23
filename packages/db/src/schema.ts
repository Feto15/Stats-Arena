import type { DetailQuality } from "./data-quality.js";
import type { LiveStatsSupplement, LiveStatsStatus, LiveStatsIssue } from "./livestats.js";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from "drizzle-orm/pg-core";

export const statsarena = pgSchema("statsarena");

export const gameStatus = statsarena.enum("game_status", ["scheduled", "live", "complete", "unknown"]);
export const fetchStatus = statsarena.enum("fetch_status", ["succeeded", "failed"]);
export const parseStatus = statsarena.enum("parse_status", ["parsed", "partial", "failed"]);
export const importRunStatus = statsarena.enum("import_run_status", ["running", "succeeded", "partial", "failed"]);
export const importRunMode = statsarena.enum("import_run_mode", ["discover", "sync", "snapshot"]);
export const syncRunMode = statsarena.enum("sync_run_mode", ["once", "periodic", "retry"]);
export const eventPeriodType = statsarena.enum("event_period_type", ["regulation", "overtime", "unknown"]);
export const eventTeamSide = statsarena.enum("event_team_side", ["home", "away", "neutral", "unknown"]);
export const shotType = statsarena.enum("shot_type", ["2pt", "3pt"]);
export const shotResult = statsarena.enum("shot_result", ["made", "missed"]);
export const teamMetricScope = statsarena.enum("team_metric_scope", ["game", "competition"]);
export const metricAvailability = statsarena.enum("metric_availability", ["available", "unavailable"]);
export const fetchResource = statsarena.enum("fetch_resource", [
  "competition",
  "teams",
  "players",
  "standings",
  "summary",
  "boxscore",
  "playbyplay",
  "shotchart",
  "analysis",
  "team_statistics"
]);

const now = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const competitions = statsarena.table(
  "competitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: varchar("source", { length: 50 }).notNull().default("genius_sports"),
    sourceCompetitionId: text("source_competition_id").notNull(),
    sourceUrl: text("source_url").notNull(),
    name: text("name").notNull(),
    season: text("season"),
    year: integer("year"),
    isActive: boolean("is_active").notNull().default(true),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: now(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("competitions_source_id_uq").on(table.source, table.sourceCompetitionId),
    index("competitions_name_idx").on(table.name)
  ]
);

export const teams = statsarena.table(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: varchar("source", { length: 50 }).notNull().default("genius_sports"),
    sourceTeamId: text("source_team_id").notNull(),
    sourceUrl: text("source_url").notNull(),
    name: text("name").notNull(),
    logoUrl: text("logo_url"),
    createdAt: now(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("teams_source_id_uq").on(table.source, table.sourceTeamId),
    index("teams_name_idx").on(table.name)
  ]
);

export const players = statsarena.table(
  "players",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: varchar("source", { length: 50 }).notNull().default("genius_sports"),
    sourcePlayerId: text("source_player_id").notNull(),
    sourceUrl: text("source_url").notNull(),
    name: text("name").notNull(),
    createdAt: now(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("players_source_id_uq").on(table.source, table.sourcePlayerId),
    index("players_name_idx").on(table.name)
  ]
);

export const competitionTeams = statsarena.table(
  "competition_teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    competitionId: uuid("competition_id").notNull().references(() => competitions.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "restrict" }),
    sourceUrl: text("source_url").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: now()
  },
  (table) => [
    uniqueIndex("competition_teams_comp_team_uq").on(table.competitionId, table.teamId),
    index("competition_teams_team_idx").on(table.teamId)
  ]
);

export const competitionPlayers = statsarena.table(
  "competition_players",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    competitionId: uuid("competition_id").notNull().references(() => competitions.id, { onDelete: "cascade" }),
    playerId: uuid("player_id").notNull().references(() => players.id, { onDelete: "restrict" }),
    sourceUrl: text("source_url").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: now()
  },
  (table) => [
    uniqueIndex("competition_players_comp_player_uq").on(table.competitionId, table.playerId),
    index("competition_players_player_idx").on(table.playerId)
  ]
);

export const teamRosters = statsarena.table(
  "team_rosters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    competitionId: uuid("competition_id").notNull().references(() => competitions.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "restrict" }),
    playerId: uuid("player_id").notNull().references(() => players.id, { onDelete: "restrict" }),
    sourceUrl: text("source_url").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: now()
  },
  (table) => [
    uniqueIndex("team_rosters_comp_team_player_uq").on(table.competitionId, table.teamId, table.playerId),
    index("team_rosters_player_idx").on(table.playerId)
  ]
);

export const competitionGroups = statsarena.table(
  "competition_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    competitionId: uuid("competition_id").notNull().references(() => competitions.id, { onDelete: "cascade" }),
    sourceGroupId: text("source_group_id").notNull(),
    sourceUrl: text("source_url").notNull(),
    label: text("label").notNull(),
    poolNumber: text("pool_number"),
    createdAt: now(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("competition_groups_source_id_uq").on(table.competitionId, table.sourceGroupId),
    index("competition_groups_comp_idx").on(table.competitionId)
  ]
);

export const importRuns = statsarena.table(
  "import_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    competitionId: uuid("competition_id").references(() => competitions.id, { onDelete: "set null" }),
    mode: importRunMode("mode").notNull(),
    status: importRunStatus("status").notNull().default("running"),
    parserVersion: text("parser_version").notNull(),
    inputHash: varchar("input_hash", { length: 64 }),
    auditKind: varchar("audit_kind", { length: 16 }).$type<"full" | "summary">().notNull().default("full"),
    baselineImportRunId: uuid("baseline_import_run_id"),
    latestRequestedAt: timestamp("latest_requested_at", { withTimezone: true }),
    latestSourceFetchedAt: timestamp("latest_source_fetched_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    recordCounts: jsonb("record_counts").$type<Record<string, number>>().notNull().default({}),
    errorSummary: text("error_summary"),
    createdAt: now()
  },
  (table) => [
    index("import_runs_comp_started_idx").on(table.competitionId, table.startedAt),
    index("import_runs_status_idx").on(table.status),
    foreignKey({ name: "import_runs_baseline_fk", columns: [table.baselineImportRunId], foreignColumns: [table.id] }).onDelete("restrict"),
    check("import_runs_audit_kind_ck", sql`(${table.auditKind} = 'full' and ${table.baselineImportRunId} is null) or (${table.auditKind} = 'summary' and ${table.baselineImportRunId} is not null)`)
  ]
);

export const sourceFetches = statsarena.table(
  "source_fetches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    importRunId: uuid("import_run_id").references(() => importRuns.id, { onDelete: "set null" }),
    competitionId: uuid("competition_id").references(() => competitions.id, { onDelete: "set null" }),
    resource: fetchResource("resource").notNull(),
    requestUrl: text("request_url").notNull(),
    finalUrl: text("final_url"),
    fetchStatus: fetchStatus("fetch_status").notNull(),
    parseStatus: parseStatus("parse_status").notNull().default("failed"),
    httpStatus: integer("http_status"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    sourceFetchedAt: timestamp("source_fetched_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    responseBytes: integer("response_bytes"),
    sha256: varchar("sha256", { length: 64 }),
    snapshotPath: text("snapshot_path"),
    attempts: integer("attempts").notNull().default(1),
    attemptLog: jsonb("attempt_log").$type<Array<Record<string, unknown>>>().notNull().default([]),
    errorText: text("error_text"),
    createdAt: now()
  },
  (table) => [
    index("source_fetches_run_idx").on(table.importRunId),
    index("source_fetches_comp_fetched_idx").on(table.competitionId, table.fetchedAt),
    index("source_fetches_hash_idx").on(table.sha256)
  ]
);

/** Operational run records are created before any source page is fetched. */
export const syncRuns = statsarena.table(
  "sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    competitionId: uuid("competition_id").references(() => competitions.id, { onDelete: "set null" }),
    source: varchar("source", { length: 50 }).notNull().default("genius_sports"),
    sourceCompetitionId: text("source_competition_id").notNull(),
    importRunId: uuid("import_run_id").references(() => importRuns.id, { onDelete: "set null" }),
    ownerId: uuid("owner_id").notNull(),
    hostname: text("hostname").notNull(),
    processId: integer("process_id").notNull(),
    mode: syncRunMode("mode").notNull(),
    status: importRunStatus("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    pageCount: integer("page_count").notNull().default(0),
    failureCount: integer("failure_count").notNull().default(0),
    writeCounts: jsonb("write_counts").$type<Record<string, number>>().notNull().default({}),
    failureUrls: jsonb("failure_urls").$type<string[]>().notNull().default([]),
    resultSummary: text("result_summary"),
    createdAt: now()
  },
  (table) => [
    index("sync_runs_comp_started_idx").on(table.competitionId, table.startedAt),
    index("sync_runs_source_comp_started_idx").on(table.source, table.sourceCompetitionId, table.startedAt),
    index("sync_runs_status_heartbeat_idx").on(table.status, table.heartbeatAt)
  ]
);

/** A row lease works with pooled Neon connections; unlike session advisory locks it survives pool reassignment. */
export const syncLeases = statsarena.table(
  "sync_leases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: varchar("source", { length: 50 }).notNull().default("genius_sports"),
    sourceCompetitionId: text("source_competition_id").notNull(),
    ownerId: uuid("owner_id").notNull(),
    hostname: text("hostname").notNull(),
    processId: integer("process_id").notNull(),
    acquiredAt: timestamp("acquired_at", { withTimezone: true }).notNull().defaultNow(),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull()
  },
  (table) => [
    uniqueIndex("sync_leases_source_comp_uq").on(table.source, table.sourceCompetitionId),
    index("sync_leases_expires_idx").on(table.expiresAt)
  ]
);

export const games = statsarena.table(
  "games",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    competitionId: uuid("competition_id").notNull().references(() => competitions.id, { onDelete: "cascade" }),
    source: varchar("source", { length: 50 }).notNull().default("genius_sports"),
    sourceGameId: text("source_game_id").notNull(),
    sourceUrl: text("source_url").notNull(),
    homeTeamId: uuid("home_team_id").references(() => teams.id, { onDelete: "restrict" }),
    awayTeamId: uuid("away_team_id").references(() => teams.id, { onDelete: "restrict" }),
    homeScore: integer("home_score"),
    awayScore: integer("away_score"),
    status: gameStatus("status").notNull().default("unknown"),
    scheduledAtRaw: text("scheduled_at_raw"),
    venue: text("venue"),
    fixtureHash: varchar("fixture_hash", { length: 64 }),
    detailQuality: jsonb("detail_quality").$type<DetailQuality>(),
    detailSyncStatus: parseStatus("detail_sync_status").notNull().default("partial"),
    detailParserVersion: text("detail_parser_version"),
    detailSyncedAt: timestamp("detail_synced_at", { withTimezone: true }),
    lastSummaryFetchId: uuid("last_summary_fetch_id").references(() => sourceFetches.id, { onDelete: "set null" }),
    lastBoxscoreFetchId: uuid("last_boxscore_fetch_id").references(() => sourceFetches.id, { onDelete: "set null" }),
    createdAt: now(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("games_source_id_uq").on(table.source, table.sourceGameId),
    index("games_comp_status_idx").on(table.competitionId, table.status),
    index("games_comp_updated_idx").on(table.competitionId, table.updatedAt),
    index("games_home_team_idx").on(table.homeTeamId),
    index("games_away_team_idx").on(table.awayTeamId),
    check("games_distinct_teams_ck", sql`${table.homeTeamId} is null or ${table.awayTeamId} is null or ${table.homeTeamId} <> ${table.awayTeamId}`)
  ]
);

export const gameLiveStats = statsarena.table("game_livestats", {
  id: uuid("id").primaryKey().defaultRandom(),
  gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  status: varchar("status", { length: 24 }).$type<LiveStatsStatus>().notNull(),
  sourceUrl: text("source_url").notNull(),
  pageUrl: text("page_url").notNull(),
  parserVersion: text("parser_version").notNull(),
  payload: jsonb("payload").$type<LiveStatsSupplement>(),
  payloadHash: varchar("payload_hash", { length: 64 }),
  sourceHash: varchar("source_hash", { length: 64 }),
  sourceFetchedAt: timestamp("source_fetched_at", { withTimezone: true }),
  snapshotPath: text("snapshot_path"),
  portalFingerprint: varchar("portal_fingerprint", { length: 64 }).notNull(),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }).notNull(),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(),
  issues: jsonb("issues").$type<LiveStatsIssue[]>().notNull().default([]),
  createdAt: now(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("game_livestats_game_uq").on(table.gameId),
  index("game_livestats_retry_idx").on(table.nextAttemptAt),
  check("game_livestats_status_ck", sql`${table.status} in ('ready','partial','unavailable','fetch_failed','parse_failed','mismatch')`)
]);

export const groupStandings = statsarena.table(
  "group_standings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id").notNull().references(() => competitionGroups.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "restrict" }),
    position: integer("position"),
    gamesPlayed: integer("games_played"),
    wins: integer("wins"),
    losses: integer("losses"),
    draws: integer("draws"),
    pointsFor: integer("points_for"),
    pointsAgainst: integer("points_against"),
    pointDifference: integer("point_difference"),
    standingPoints: integer("standing_points"),
    sourceFetchId: uuid("source_fetch_id").references(() => sourceFetches.id, { onDelete: "set null" }),
    asOf: timestamp("as_of", { withTimezone: true }).notNull().defaultNow(),
    createdAt: now(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("group_standings_group_team_uq").on(table.groupId, table.teamId),
    index("group_standings_group_position_idx").on(table.groupId, table.position)
  ]
);

export type StatDerivations = Record<string, { formula: string; version: string; inputs: Record<string, number> }>;

const statColumns = () => ({
  statDerivations: jsonb("stat_derivations").$type<StatDerivations>().notNull().default({}),
  fieldGoalsMade: integer("field_goals_made"),
  fieldGoalsAttempted: integer("field_goals_attempted"),
  twoPointsMade: integer("two_points_made"),
  twoPointAttempts: integer("two_point_attempts"),
  threePointsMade: integer("three_points_made"),
  threePointAttempts: integer("three_point_attempts"),
  freeThrowsMade: integer("free_throws_made"),
  freeThrowAttempts: integer("free_throw_attempts"),
  offensiveRebounds: integer("offensive_rebounds"),
  defensiveRebounds: integer("defensive_rebounds"),
  rebounds: integer("rebounds"),
  assists: integer("assists"),
  steals: integer("steals"),
  blocks: integer("blocks"),
  turnovers: integer("turnovers"),
  personalFouls: integer("personal_fouls"),
  points: integer("points"),
  fieldGoalPct: text("field_goal_pct"),
  twoPointPct: text("two_point_pct"),
  threePointPct: text("three_point_pct"),
  freeThrowPct: text("free_throw_pct")
});

export const teamGameStats = statsarena.table(
  "team_game_stats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "restrict" }),
    minutes: doublePrecision("minutes"),
    ...statColumns(),
    officialMetrics: jsonb("official_metrics").$type<Record<string, number | string | null>>().notNull().default({}),
    createdAt: now(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("team_game_stats_game_team_uq").on(table.gameId, table.teamId),
    index("team_game_stats_team_idx").on(table.teamId),
    check("team_game_stats_nonnegative_ck", sql`${table.points} is null or ${table.points} >= 0`),
    check("team_game_stats_fga_ck", sql`${table.fieldGoalsAttempted} is null or ${table.fieldGoalsAttempted} >= 0`)
  ]
);

export const playerGameStats = statsarena.table(
  "player_game_stats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
    playerId: uuid("player_id").notNull().references(() => players.id, { onDelete: "restrict" }),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "restrict" }),
    jerseyNumber: text("jersey_number"),
    minutesRaw: text("minutes_raw"),
    minutes: doublePrecision("minutes"),
    ...statColumns(),
    sourceUrl: text("source_url").notNull(),
    createdAt: now(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("player_game_stats_game_player_uq").on(table.gameId, table.playerId),
    index("player_game_stats_player_idx").on(table.playerId),
    index("player_game_stats_team_idx").on(table.teamId),
    check("player_game_stats_nonnegative_ck", sql`${table.points} is null or ${table.points} >= 0`),
    check("player_game_stats_fga_ck", sql`${table.fieldGoalsAttempted} is null or ${table.fieldGoalsAttempted} >= 0`)
  ]
);

export const playByPlayEvents = statsarena.table(
  "play_by_play_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
    sourceSequence: integer("source_sequence").notNull(),
    periodNumber: integer("period_number"),
    periodLabelRaw: text("period_label_raw"),
    periodType: eventPeriodType("period_type").notNull().default("unknown"),
    timeRaw: text("time_raw"),
    actionType: text("action_type").notNull(),
    actionText: text("action_text"),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "restrict" }),
    teamSide: eventTeamSide("team_side").notNull().default("unknown"),
    playerId: uuid("player_id").references(() => players.id, { onDelete: "restrict" }),
    playerName: text("player_name"),
    scoreRaw: text("score_raw"),
    team1Score: integer("team1_score"),
    team2Score: integer("team2_score"),
    rawClasses: jsonb("raw_classes").$type<string[]>().notNull().default([]),
    sourceUrl: text("source_url").notNull(),
    sourceFetchId: uuid("source_fetch_id").references(() => sourceFetches.id, { onDelete: "set null" }),
    parserVersion: text("parser_version").notNull(),
    createdAt: now(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("play_by_play_game_sequence_uq").on(table.gameId, table.sourceSequence),
    index("play_by_play_game_period_sequence_idx").on(table.gameId, table.periodNumber, table.sourceSequence),
    index("play_by_play_game_team_idx").on(table.gameId, table.teamId)
  ]
);

export const shots = statsarena.table(
  "shots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
    sourceSequence: integer("source_sequence").notNull(),
    periodNumber: integer("period_number").notNull(),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "restrict" }),
    playerId: uuid("player_id").notNull().references(() => players.id, { onDelete: "restrict" }),
    playerName: text("player_name"),
    shotType: shotType("shot_type").notNull(),
    result: shotResult("result").notNull(),
    xRaw: text("x_raw").notNull(),
    yRaw: text("y_raw").notNull(),
    xPercent: doublePrecision("x_percent").notNull(),
    yPercent: doublePrecision("y_percent").notNull(),
    rawTitle: text("raw_title").notNull(),
    rawClasses: jsonb("raw_classes").$type<string[]>().notNull().default([]),
    sourceUrl: text("source_url").notNull(),
    sourceFetchId: uuid("source_fetch_id").references(() => sourceFetches.id, { onDelete: "set null" }),
    parserVersion: text("parser_version").notNull(),
    createdAt: now(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("shots_game_sequence_uq").on(table.gameId, table.sourceSequence),
    index("shots_game_period_team_idx").on(table.gameId, table.periodNumber, table.teamId),
    index("shots_game_player_idx").on(table.gameId, table.playerId),
    check("shots_coordinates_percent_ck", sql`${table.xPercent} >= 0 and ${table.xPercent} <= 100 and ${table.yPercent} >= 0 and ${table.yPercent} <= 100`)
  ]
);

export const officialTeamMetrics = statsarena.table(
  "team_official_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    competitionId: uuid("competition_id").notNull().references(() => competitions.id, { onDelete: "cascade" }),
    scopeType: teamMetricScope("scope_type").notNull(),
    gameId: uuid("game_id").references(() => games.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "restrict" }),
    metricCode: varchar("metric_code", { length: 32 }).notNull(),
    value: integer("value"),
    availability: metricAvailability("availability").notNull(),
    unit: text("unit").notNull(),
    scopeLabel: text("scope_label"),
    sampleGamesPlayed: integer("sample_games_played"),
    rawValue: text("raw_value"),
    sourceUrl: text("source_url").notNull(),
    sourceFetchId: uuid("source_fetch_id").references(() => sourceFetches.id, { onDelete: "set null" }),
    parserVersion: text("parser_version").notNull(),
    createdAt: now(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("team_official_metrics_game_uq").on(table.gameId, table.teamId, table.metricCode).where(sql`${table.scopeType} = 'game'`),
    uniqueIndex("team_official_metrics_competition_uq").on(table.competitionId, table.teamId, table.metricCode).where(sql`${table.scopeType} = 'competition'`),
    index("team_official_metrics_comp_scope_idx").on(table.competitionId, table.scopeType, table.teamId),
    index("team_official_metrics_game_idx").on(table.gameId),
    check("team_official_metrics_scope_ck", sql`(${table.scopeType} = 'game' and ${table.gameId} is not null) or (${table.scopeType} = 'competition' and ${table.gameId} is null)`),
    check("team_official_metrics_value_ck", sql`(${table.availability} = 'available' and ${table.value} is not null) or (${table.availability} = 'unavailable' and ${table.value} is null)`),
    check("team_official_metrics_nonnegative_ck", sql`${table.value} is null or ${table.value} >= 0`),
    check("team_official_metrics_sample_games_ck", sql`${table.sampleGamesPlayed} is null or ${table.sampleGamesPlayed} >= 0`)
  ]
);

export const validationIssues = statsarena.table(
  "validation_issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    importRunId: uuid("import_run_id").references(() => importRuns.id, { onDelete: "set null" }),
    competitionId: uuid("competition_id").references(() => competitions.id, { onDelete: "set null" }),
    gameId: uuid("game_id").references(() => games.id, { onDelete: "set null" }),
    severity: varchar("severity", { length: 16 }).notNull(),
    code: text("code").notNull(),
    message: text("message").notNull(),
    fieldPath: text("field_path"),
    expected: jsonb("expected"),
    actual: jsonb("actual"),
    sourceUrl: text("source_url"),
    createdAt: now()
  },
  (table) => [
    index("validation_issues_run_idx").on(table.importRunId),
    index("validation_issues_comp_created_idx").on(table.competitionId, table.createdAt),
    index("validation_issues_game_idx").on(table.gameId)
  ]
);

export const schema = {
  competitions,
  teams,
  players,
  competitionTeams,
  competitionPlayers,
  teamRosters,
  competitionGroups,
  importRuns,
  sourceFetches,
  syncRuns,
  syncLeases,
  games,
  gameLiveStats,
  groupStandings,
  teamGameStats,
  playerGameStats,
  playByPlayEvents,
  shots,
  officialTeamMetrics,
  validationIssues
};

export type CompetitionRow = typeof competitions.$inferSelect;
export type TeamRow = typeof teams.$inferSelect;
export type PlayerRow = typeof players.$inferSelect;
