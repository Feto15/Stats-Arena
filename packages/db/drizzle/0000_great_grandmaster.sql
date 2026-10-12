CREATE SCHEMA IF NOT EXISTS "statsarena";
--> statement-breakpoint
CREATE TYPE "statsarena"."fetch_resource" AS ENUM('competition', 'teams', 'players', 'standings', 'summary', 'boxscore');--> statement-breakpoint
CREATE TYPE "statsarena"."fetch_status" AS ENUM('succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "statsarena"."game_status" AS ENUM('scheduled', 'live', 'complete', 'unknown');--> statement-breakpoint
CREATE TYPE "statsarena"."import_run_mode" AS ENUM('discover', 'sync', 'snapshot');--> statement-breakpoint
CREATE TYPE "statsarena"."import_run_status" AS ENUM('running', 'succeeded', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "statsarena"."parse_status" AS ENUM('parsed', 'partial', 'failed');--> statement-breakpoint
CREATE TABLE "statsarena"."competition_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"source_group_id" text NOT NULL,
	"source_url" text NOT NULL,
	"label" text NOT NULL,
	"pool_number" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statsarena"."competition_players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"source_url" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statsarena"."competition_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"source_url" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statsarena"."competitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" varchar(50) DEFAULT 'genius_sports' NOT NULL,
	"source_competition_id" text NOT NULL,
	"source_url" text NOT NULL,
	"name" text NOT NULL,
	"season" text,
	"year" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statsarena"."games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"source" varchar(50) DEFAULT 'genius_sports' NOT NULL,
	"source_game_id" text NOT NULL,
	"source_url" text NOT NULL,
	"home_team_id" uuid,
	"away_team_id" uuid,
	"home_score" integer,
	"away_score" integer,
	"status" "statsarena"."game_status" DEFAULT 'unknown' NOT NULL,
	"scheduled_at_raw" text,
	"venue" text,
	"last_summary_fetch_id" uuid,
	"last_boxscore_fetch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "games_distinct_teams_ck" CHECK ("statsarena"."games"."home_team_id" is null or "statsarena"."games"."away_team_id" is null or "statsarena"."games"."home_team_id" <> "statsarena"."games"."away_team_id")
);
--> statement-breakpoint
CREATE TABLE "statsarena"."group_standings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"position" integer,
	"games_played" integer,
	"wins" integer,
	"losses" integer,
	"draws" integer,
	"points_for" integer,
	"points_against" integer,
	"point_difference" integer,
	"standing_points" integer,
	"source_fetch_id" uuid,
	"as_of" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statsarena"."import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid,
	"mode" "statsarena"."import_run_mode" NOT NULL,
	"status" "statsarena"."import_run_status" DEFAULT 'running' NOT NULL,
	"parser_version" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"record_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statsarena"."player_game_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"jersey_number" text,
	"minutes_raw" text,
	"minutes" integer,
	"field_goals_made" integer,
	"field_goals_attempted" integer,
	"two_points_made" integer,
	"two_point_attempts" integer,
	"three_points_made" integer,
	"three_point_attempts" integer,
	"free_throws_made" integer,
	"free_throw_attempts" integer,
	"offensive_rebounds" integer,
	"defensive_rebounds" integer,
	"rebounds" integer,
	"assists" integer,
	"steals" integer,
	"blocks" integer,
	"turnovers" integer,
	"personal_fouls" integer,
	"points" integer,
	"field_goal_pct" text,
	"two_point_pct" text,
	"three_point_pct" text,
	"free_throw_pct" text,
	"source_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_game_stats_nonnegative_ck" CHECK ("statsarena"."player_game_stats"."points" is null or "statsarena"."player_game_stats"."points" >= 0),
	CONSTRAINT "player_game_stats_fga_ck" CHECK ("statsarena"."player_game_stats"."field_goals_attempted" is null or "statsarena"."player_game_stats"."field_goals_attempted" >= 0)
);
--> statement-breakpoint
CREATE TABLE "statsarena"."players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" varchar(50) DEFAULT 'genius_sports' NOT NULL,
	"source_player_id" text NOT NULL,
	"source_url" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statsarena"."source_fetches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_run_id" uuid,
	"competition_id" uuid,
	"resource" "statsarena"."fetch_resource" NOT NULL,
	"request_url" text NOT NULL,
	"final_url" text,
	"fetch_status" "statsarena"."fetch_status" NOT NULL,
	"parse_status" "statsarena"."parse_status" DEFAULT 'failed' NOT NULL,
	"http_status" integer,
	"requested_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone,
	"duration_ms" integer,
	"response_bytes" integer,
	"sha256" varchar(64),
	"snapshot_path" text,
	"attempts" integer DEFAULT 1 NOT NULL,
	"attempt_log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statsarena"."team_game_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"minutes" integer,
	"field_goals_made" integer,
	"field_goals_attempted" integer,
	"two_points_made" integer,
	"two_point_attempts" integer,
	"three_points_made" integer,
	"three_point_attempts" integer,
	"free_throws_made" integer,
	"free_throw_attempts" integer,
	"offensive_rebounds" integer,
	"defensive_rebounds" integer,
	"rebounds" integer,
	"assists" integer,
	"steals" integer,
	"blocks" integer,
	"turnovers" integer,
	"personal_fouls" integer,
	"points" integer,
	"field_goal_pct" text,
	"two_point_pct" text,
	"three_point_pct" text,
	"free_throw_pct" text,
	"official_metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_game_stats_nonnegative_ck" CHECK ("statsarena"."team_game_stats"."points" is null or "statsarena"."team_game_stats"."points" >= 0),
	CONSTRAINT "team_game_stats_fga_ck" CHECK ("statsarena"."team_game_stats"."field_goals_attempted" is null or "statsarena"."team_game_stats"."field_goals_attempted" >= 0)
);
--> statement-breakpoint
CREATE TABLE "statsarena"."team_rosters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"source_url" text NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statsarena"."teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" varchar(50) DEFAULT 'genius_sports' NOT NULL,
	"source_team_id" text NOT NULL,
	"source_url" text NOT NULL,
	"name" text NOT NULL,
	"logo_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statsarena"."validation_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_run_id" uuid,
	"competition_id" uuid,
	"game_id" uuid,
	"severity" varchar(16) NOT NULL,
	"code" text NOT NULL,
	"message" text NOT NULL,
	"field_path" text,
	"expected" jsonb,
	"actual" jsonb,
	"source_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "statsarena"."competition_groups" ADD CONSTRAINT "competition_groups_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "statsarena"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."competition_players" ADD CONSTRAINT "competition_players_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "statsarena"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."competition_players" ADD CONSTRAINT "competition_players_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "statsarena"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."competition_teams" ADD CONSTRAINT "competition_teams_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "statsarena"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."competition_teams" ADD CONSTRAINT "competition_teams_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "statsarena"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."games" ADD CONSTRAINT "games_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "statsarena"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."games" ADD CONSTRAINT "games_home_team_id_teams_id_fk" FOREIGN KEY ("home_team_id") REFERENCES "statsarena"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."games" ADD CONSTRAINT "games_away_team_id_teams_id_fk" FOREIGN KEY ("away_team_id") REFERENCES "statsarena"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."games" ADD CONSTRAINT "games_last_summary_fetch_id_source_fetches_id_fk" FOREIGN KEY ("last_summary_fetch_id") REFERENCES "statsarena"."source_fetches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."games" ADD CONSTRAINT "games_last_boxscore_fetch_id_source_fetches_id_fk" FOREIGN KEY ("last_boxscore_fetch_id") REFERENCES "statsarena"."source_fetches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."group_standings" ADD CONSTRAINT "group_standings_group_id_competition_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "statsarena"."competition_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."group_standings" ADD CONSTRAINT "group_standings_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "statsarena"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."group_standings" ADD CONSTRAINT "group_standings_source_fetch_id_source_fetches_id_fk" FOREIGN KEY ("source_fetch_id") REFERENCES "statsarena"."source_fetches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."import_runs" ADD CONSTRAINT "import_runs_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "statsarena"."competitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."player_game_stats" ADD CONSTRAINT "player_game_stats_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "statsarena"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."player_game_stats" ADD CONSTRAINT "player_game_stats_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "statsarena"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."player_game_stats" ADD CONSTRAINT "player_game_stats_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "statsarena"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."source_fetches" ADD CONSTRAINT "source_fetches_import_run_id_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "statsarena"."import_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."source_fetches" ADD CONSTRAINT "source_fetches_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "statsarena"."competitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."team_game_stats" ADD CONSTRAINT "team_game_stats_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "statsarena"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."team_game_stats" ADD CONSTRAINT "team_game_stats_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "statsarena"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."team_rosters" ADD CONSTRAINT "team_rosters_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "statsarena"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."team_rosters" ADD CONSTRAINT "team_rosters_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "statsarena"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."team_rosters" ADD CONSTRAINT "team_rosters_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "statsarena"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."validation_issues" ADD CONSTRAINT "validation_issues_import_run_id_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "statsarena"."import_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."validation_issues" ADD CONSTRAINT "validation_issues_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "statsarena"."competitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."validation_issues" ADD CONSTRAINT "validation_issues_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "statsarena"."games"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "competition_groups_source_id_uq" ON "statsarena"."competition_groups" USING btree ("competition_id","source_group_id");--> statement-breakpoint
CREATE INDEX "competition_groups_comp_idx" ON "statsarena"."competition_groups" USING btree ("competition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "competition_players_comp_player_uq" ON "statsarena"."competition_players" USING btree ("competition_id","player_id");--> statement-breakpoint
CREATE INDEX "competition_players_player_idx" ON "statsarena"."competition_players" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "competition_teams_comp_team_uq" ON "statsarena"."competition_teams" USING btree ("competition_id","team_id");--> statement-breakpoint
CREATE INDEX "competition_teams_team_idx" ON "statsarena"."competition_teams" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "competitions_source_id_uq" ON "statsarena"."competitions" USING btree ("source","source_competition_id");--> statement-breakpoint
CREATE INDEX "competitions_name_idx" ON "statsarena"."competitions" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "games_source_id_uq" ON "statsarena"."games" USING btree ("source","source_game_id");--> statement-breakpoint
CREATE INDEX "games_comp_status_idx" ON "statsarena"."games" USING btree ("competition_id","status");--> statement-breakpoint
CREATE INDEX "games_comp_updated_idx" ON "statsarena"."games" USING btree ("competition_id","updated_at");--> statement-breakpoint
CREATE INDEX "games_home_team_idx" ON "statsarena"."games" USING btree ("home_team_id");--> statement-breakpoint
CREATE INDEX "games_away_team_idx" ON "statsarena"."games" USING btree ("away_team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "group_standings_group_team_uq" ON "statsarena"."group_standings" USING btree ("group_id","team_id");--> statement-breakpoint
CREATE INDEX "group_standings_group_position_idx" ON "statsarena"."group_standings" USING btree ("group_id","position");--> statement-breakpoint
CREATE INDEX "import_runs_comp_started_idx" ON "statsarena"."import_runs" USING btree ("competition_id","started_at");--> statement-breakpoint
CREATE INDEX "import_runs_status_idx" ON "statsarena"."import_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "player_game_stats_game_player_uq" ON "statsarena"."player_game_stats" USING btree ("game_id","player_id");--> statement-breakpoint
CREATE INDEX "player_game_stats_player_idx" ON "statsarena"."player_game_stats" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "player_game_stats_team_idx" ON "statsarena"."player_game_stats" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "players_source_id_uq" ON "statsarena"."players" USING btree ("source","source_player_id");--> statement-breakpoint
CREATE INDEX "players_name_idx" ON "statsarena"."players" USING btree ("name");--> statement-breakpoint
CREATE INDEX "source_fetches_run_idx" ON "statsarena"."source_fetches" USING btree ("import_run_id");--> statement-breakpoint
CREATE INDEX "source_fetches_comp_fetched_idx" ON "statsarena"."source_fetches" USING btree ("competition_id","fetched_at");--> statement-breakpoint
CREATE INDEX "source_fetches_hash_idx" ON "statsarena"."source_fetches" USING btree ("sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "team_game_stats_game_team_uq" ON "statsarena"."team_game_stats" USING btree ("game_id","team_id");--> statement-breakpoint
CREATE INDEX "team_game_stats_team_idx" ON "statsarena"."team_game_stats" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_rosters_comp_team_player_uq" ON "statsarena"."team_rosters" USING btree ("competition_id","team_id","player_id");--> statement-breakpoint
CREATE INDEX "team_rosters_player_idx" ON "statsarena"."team_rosters" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_source_id_uq" ON "statsarena"."teams" USING btree ("source","source_team_id");--> statement-breakpoint
CREATE INDEX "teams_name_idx" ON "statsarena"."teams" USING btree ("name");--> statement-breakpoint
CREATE INDEX "validation_issues_run_idx" ON "statsarena"."validation_issues" USING btree ("import_run_id");--> statement-breakpoint
CREATE INDEX "validation_issues_comp_created_idx" ON "statsarena"."validation_issues" USING btree ("competition_id","created_at");--> statement-breakpoint
CREATE INDEX "validation_issues_game_idx" ON "statsarena"."validation_issues" USING btree ("game_id");
