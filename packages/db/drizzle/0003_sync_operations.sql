CREATE TYPE "statsarena"."sync_run_mode" AS ENUM('once', 'periodic', 'retry');--> statement-breakpoint
CREATE TABLE "statsarena"."sync_leases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" varchar(50) DEFAULT 'genius_sports' NOT NULL,
	"source_competition_id" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"hostname" text NOT NULL,
	"process_id" integer NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statsarena"."sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid,
	"source" varchar(50) DEFAULT 'genius_sports' NOT NULL,
	"source_competition_id" text NOT NULL,
	"import_run_id" uuid,
	"owner_id" uuid NOT NULL,
	"hostname" text NOT NULL,
	"process_id" integer NOT NULL,
	"mode" "statsarena"."sync_run_mode" NOT NULL,
	"status" "statsarena"."import_run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"page_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"write_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"failure_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"result_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "statsarena"."source_fetches" ADD COLUMN "source_fetched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "statsarena"."sync_runs" ADD CONSTRAINT "sync_runs_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "statsarena"."competitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."sync_runs" ADD CONSTRAINT "sync_runs_import_run_id_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "statsarena"."import_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sync_leases_source_comp_uq" ON "statsarena"."sync_leases" USING btree ("source","source_competition_id");--> statement-breakpoint
CREATE INDEX "sync_leases_expires_idx" ON "statsarena"."sync_leases" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sync_runs_comp_started_idx" ON "statsarena"."sync_runs" USING btree ("competition_id","started_at");--> statement-breakpoint
CREATE INDEX "sync_runs_source_comp_started_idx" ON "statsarena"."sync_runs" USING btree ("source","source_competition_id","started_at");--> statement-breakpoint
CREATE INDEX "sync_runs_status_heartbeat_idx" ON "statsarena"."sync_runs" USING btree ("status","heartbeat_at");