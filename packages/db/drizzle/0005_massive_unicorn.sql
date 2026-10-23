ALTER TABLE "statsarena"."import_runs" ADD COLUMN "input_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "statsarena"."import_runs" ADD COLUMN "audit_kind" varchar(16) DEFAULT 'full' NOT NULL;--> statement-breakpoint
ALTER TABLE "statsarena"."import_runs" ADD COLUMN "baseline_import_run_id" uuid;--> statement-breakpoint
ALTER TABLE "statsarena"."import_runs" ADD COLUMN "latest_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "statsarena"."import_runs" ADD COLUMN "latest_source_fetched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "statsarena"."import_runs" ADD CONSTRAINT "import_runs_baseline_fk" FOREIGN KEY ("baseline_import_run_id") REFERENCES "statsarena"."import_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."import_runs" ADD CONSTRAINT "import_runs_audit_kind_ck" CHECK (("statsarena"."import_runs"."audit_kind" = 'full' and "statsarena"."import_runs"."baseline_import_run_id" is null) or ("statsarena"."import_runs"."audit_kind" = 'summary' and "statsarena"."import_runs"."baseline_import_run_id" is not null));