CREATE TABLE "statsarena"."game_livestats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"status" varchar(24) NOT NULL,
	"source_url" text NOT NULL,
	"page_url" text NOT NULL,
	"parser_version" text NOT NULL,
	"payload" jsonb,
	"payload_hash" varchar(64),
	"source_hash" varchar(64),
	"source_fetched_at" timestamp with time zone,
	"snapshot_path" text,
	"portal_fingerprint" varchar(64) NOT NULL,
	"last_attempt_at" timestamp with time zone NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_livestats_status_ck" CHECK ("statsarena"."game_livestats"."status" in ('ready','partial','unavailable','fetch_failed','parse_failed','mismatch'))
);
--> statement-breakpoint
ALTER TABLE "statsarena"."game_livestats" ADD CONSTRAINT "game_livestats_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "statsarena"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "game_livestats_game_uq" ON "statsarena"."game_livestats" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "game_livestats_retry_idx" ON "statsarena"."game_livestats" USING btree ("next_attempt_at");