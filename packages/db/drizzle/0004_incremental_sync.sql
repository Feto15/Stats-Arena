ALTER TABLE "statsarena"."games" ADD COLUMN "fixture_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "statsarena"."games" ADD COLUMN "detail_sync_status" "statsarena"."parse_status" DEFAULT 'partial' NOT NULL;--> statement-breakpoint
ALTER TABLE "statsarena"."games" ADD COLUMN "detail_parser_version" text;--> statement-breakpoint
ALTER TABLE "statsarena"."games" ADD COLUMN "detail_synced_at" timestamp with time zone;