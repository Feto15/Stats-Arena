ALTER TABLE "statsarena"."player_game_stats" ALTER COLUMN "minutes" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "statsarena"."team_game_stats" ALTER COLUMN "minutes" SET DATA TYPE double precision;--> statement-breakpoint
-- Recover seconds from the retained source text for records imported before 0.1.1.
-- Unknown formats keep their existing value; no duration is invented.
UPDATE "statsarena"."player_game_stats"
SET "minutes" = split_part(trim("minutes_raw"), ':', 1)::double precision
  + split_part(trim("minutes_raw"), ':', 2)::double precision / 60
WHERE trim("minutes_raw") ~ '^[0-9]{1,3}:[0-5][0-9]$';--> statement-breakpoint
UPDATE "statsarena"."player_game_stats"
SET "minutes" = trim("minutes_raw")::double precision
WHERE trim("minutes_raw") ~ '^[0-9]+([.][0-9]+)?$';
