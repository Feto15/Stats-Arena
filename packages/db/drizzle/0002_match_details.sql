CREATE TYPE "statsarena"."event_period_type" AS ENUM('regulation', 'overtime', 'unknown');--> statement-breakpoint
CREATE TYPE "statsarena"."event_team_side" AS ENUM('home', 'away', 'neutral', 'unknown');--> statement-breakpoint
CREATE TYPE "statsarena"."metric_availability" AS ENUM('available', 'unavailable');--> statement-breakpoint
CREATE TYPE "statsarena"."shot_result" AS ENUM('made', 'missed');--> statement-breakpoint
CREATE TYPE "statsarena"."shot_type" AS ENUM('2pt', '3pt');--> statement-breakpoint
CREATE TYPE "statsarena"."team_metric_scope" AS ENUM('game', 'competition');--> statement-breakpoint
ALTER TYPE "statsarena"."fetch_resource" ADD VALUE 'playbyplay';--> statement-breakpoint
ALTER TYPE "statsarena"."fetch_resource" ADD VALUE 'shotchart';--> statement-breakpoint
ALTER TYPE "statsarena"."fetch_resource" ADD VALUE 'analysis';--> statement-breakpoint
ALTER TYPE "statsarena"."fetch_resource" ADD VALUE 'team_statistics';--> statement-breakpoint
CREATE TABLE "statsarena"."team_official_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"scope_type" "statsarena"."team_metric_scope" NOT NULL,
	"game_id" uuid,
	"team_id" uuid NOT NULL,
	"metric_code" varchar(32) NOT NULL,
	"value" integer,
	"availability" "statsarena"."metric_availability" NOT NULL,
	"unit" text NOT NULL,
	"scope_label" text,
	"sample_games_played" integer,
	"raw_value" text,
	"source_url" text NOT NULL,
	"source_fetch_id" uuid,
	"parser_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_official_metrics_scope_ck" CHECK (("statsarena"."team_official_metrics"."scope_type" = 'game' and "statsarena"."team_official_metrics"."game_id" is not null) or ("statsarena"."team_official_metrics"."scope_type" = 'competition' and "statsarena"."team_official_metrics"."game_id" is null)),
	CONSTRAINT "team_official_metrics_value_ck" CHECK (("statsarena"."team_official_metrics"."availability" = 'available' and "statsarena"."team_official_metrics"."value" is not null) or ("statsarena"."team_official_metrics"."availability" = 'unavailable' and "statsarena"."team_official_metrics"."value" is null)),
	CONSTRAINT "team_official_metrics_nonnegative_ck" CHECK ("statsarena"."team_official_metrics"."value" is null or "statsarena"."team_official_metrics"."value" >= 0),
	CONSTRAINT "team_official_metrics_sample_games_ck" CHECK ("statsarena"."team_official_metrics"."sample_games_played" is null or "statsarena"."team_official_metrics"."sample_games_played" >= 0)
);
--> statement-breakpoint
CREATE TABLE "statsarena"."play_by_play_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"source_sequence" integer NOT NULL,
	"period_number" integer,
	"period_label_raw" text,
	"period_type" "statsarena"."event_period_type" DEFAULT 'unknown' NOT NULL,
	"time_raw" text,
	"action_type" text NOT NULL,
	"action_text" text,
	"team_id" uuid,
	"team_side" "statsarena"."event_team_side" DEFAULT 'unknown' NOT NULL,
	"player_id" uuid,
	"player_name" text,
	"score_raw" text,
	"team1_score" integer,
	"team2_score" integer,
	"raw_classes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_url" text NOT NULL,
	"source_fetch_id" uuid,
	"parser_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statsarena"."shots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"source_sequence" integer NOT NULL,
	"period_number" integer NOT NULL,
	"team_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"player_name" text,
	"shot_type" "statsarena"."shot_type" NOT NULL,
	"result" "statsarena"."shot_result" NOT NULL,
	"x_raw" text NOT NULL,
	"y_raw" text NOT NULL,
	"x_percent" double precision NOT NULL,
	"y_percent" double precision NOT NULL,
	"raw_title" text NOT NULL,
	"raw_classes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_url" text NOT NULL,
	"source_fetch_id" uuid,
	"parser_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shots_coordinates_percent_ck" CHECK ("statsarena"."shots"."x_percent" >= 0 and "statsarena"."shots"."x_percent" <= 100 and "statsarena"."shots"."y_percent" >= 0 and "statsarena"."shots"."y_percent" <= 100)
);
--> statement-breakpoint
ALTER TABLE "statsarena"."team_official_metrics" ADD CONSTRAINT "team_official_metrics_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "statsarena"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."team_official_metrics" ADD CONSTRAINT "team_official_metrics_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "statsarena"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."team_official_metrics" ADD CONSTRAINT "team_official_metrics_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "statsarena"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."team_official_metrics" ADD CONSTRAINT "team_official_metrics_source_fetch_id_source_fetches_id_fk" FOREIGN KEY ("source_fetch_id") REFERENCES "statsarena"."source_fetches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."play_by_play_events" ADD CONSTRAINT "play_by_play_events_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "statsarena"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."play_by_play_events" ADD CONSTRAINT "play_by_play_events_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "statsarena"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."play_by_play_events" ADD CONSTRAINT "play_by_play_events_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "statsarena"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."play_by_play_events" ADD CONSTRAINT "play_by_play_events_source_fetch_id_source_fetches_id_fk" FOREIGN KEY ("source_fetch_id") REFERENCES "statsarena"."source_fetches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."shots" ADD CONSTRAINT "shots_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "statsarena"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."shots" ADD CONSTRAINT "shots_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "statsarena"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."shots" ADD CONSTRAINT "shots_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "statsarena"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."shots" ADD CONSTRAINT "shots_source_fetch_id_source_fetches_id_fk" FOREIGN KEY ("source_fetch_id") REFERENCES "statsarena"."source_fetches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_official_metrics_game_uq" ON "statsarena"."team_official_metrics" USING btree ("game_id","team_id","metric_code") WHERE "statsarena"."team_official_metrics"."scope_type" = 'game';--> statement-breakpoint
CREATE UNIQUE INDEX "team_official_metrics_competition_uq" ON "statsarena"."team_official_metrics" USING btree ("competition_id","team_id","metric_code") WHERE "statsarena"."team_official_metrics"."scope_type" = 'competition';--> statement-breakpoint
CREATE INDEX "team_official_metrics_comp_scope_idx" ON "statsarena"."team_official_metrics" USING btree ("competition_id","scope_type","team_id");--> statement-breakpoint
CREATE INDEX "team_official_metrics_game_idx" ON "statsarena"."team_official_metrics" USING btree ("game_id");--> statement-breakpoint
CREATE UNIQUE INDEX "play_by_play_game_sequence_uq" ON "statsarena"."play_by_play_events" USING btree ("game_id","source_sequence");--> statement-breakpoint
CREATE INDEX "play_by_play_game_period_sequence_idx" ON "statsarena"."play_by_play_events" USING btree ("game_id","period_number","source_sequence");--> statement-breakpoint
CREATE INDEX "play_by_play_game_team_idx" ON "statsarena"."play_by_play_events" USING btree ("game_id","team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shots_game_sequence_uq" ON "statsarena"."shots" USING btree ("game_id","source_sequence");--> statement-breakpoint
CREATE INDEX "shots_game_period_team_idx" ON "statsarena"."shots" USING btree ("game_id","period_number","team_id");--> statement-breakpoint
CREATE INDEX "shots_game_player_idx" ON "statsarena"."shots" USING btree ("game_id","player_id");