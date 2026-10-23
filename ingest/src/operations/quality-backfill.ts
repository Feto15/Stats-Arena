import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { StatsArenaDatabase } from "@statsarena/db";
import { games, sourceFetches, syncLeases, syncRuns, validationIssues } from "@statsarena/db/schema";
import { buildDetailQuality, DETAIL_DATASETS, type DetailDataset } from "@statsarena/db/data-quality";
import { sourceEntityId, sameSourceNamespace } from "../domain/source-url.js";

/** Populate missing quality metadata from recorded observations; never fetch or alter statistics. */
export async function backfillDetailQuality(db: StatsArenaDatabase, dryRun = true): Promise<{ games: number; updated: number }> {
  return db.transaction(async (tx) => {
    if (!dryRun) {
      // Wait for in-flight writes, then prevent a runner from starting while metadata is reconstructed.
      await tx.execute(sql`lock table statsarena.sync_leases, statsarena.sync_runs, statsarena.games in share row exclusive mode`);
      const [leases, runs] = await Promise.all([
        tx.select({ id: syncLeases.id }).from(syncLeases).where(gt(syncLeases.expiresAt, new Date())).limit(1),
        tx.select({ id: syncRuns.id }).from(syncRuns).where(eq(syncRuns.status, "running")).limit(1)
      ]);
      if (leases.length || runs.length) throw new Error("Writer aktif; backfill status dibatalkan. Coba setelah sinkronisasi selesai.");
    }
    const rows = await tx.select().from(games).where(isNull(games.detailQuality));
    if (!rows.length) return { games: 0, updated: 0 };
    const [fetches, issues] = await Promise.all([
      tx.select().from(sourceFetches).orderBy(desc(sourceFetches.requestedAt), desc(sourceFetches.createdAt), desc(sourceFetches.id)),
      tx.select().from(validationIssues)
    ]);
    const datasetByResource: Partial<Record<string, DetailDataset>> = {
      summary: "summary", boxscore: "boxScore", playbyplay: "playByPlay", shotchart: "shotChart", analysis: "analysis"
    };
    let updated = 0;
    for (const game of rows) {
      const latest = new Map<DetailDataset, typeof sourceFetches.$inferSelect>();
      for (const fetch of fetches) {
        const dataset = datasetByResource[fetch.resource];
        if (!dataset || latest.has(dataset) || fetch.competitionId !== game.competitionId) continue;
        if (sameSourceNamespace(fetch.requestUrl, game.sourceUrl) && sourceEntityId(fetch.requestUrl, "match") === game.sourceGameId) latest.set(dataset, fetch);
      }
      const availability: Partial<Record<DetailDataset, string>> = {};
      const evidence: typeof issues = [];
      let lastChecked = game.updatedAt;
      for (const dataset of DETAIL_DATASETS) {
        const fetch = latest.get(dataset);
        if (game.status === "scheduled") availability[dataset] = "scheduled";
        else if (!fetch) availability[dataset] = "unavailable";
        else {
          availability[dataset] = fetch.fetchStatus === "failed" ? "fetch_failed"
            : fetch.parseStatus === "failed" ? "parse_failed" : fetch.parseStatus === "partial" ? "partial" : "available";
          if (fetch.requestedAt > lastChecked) lastChecked = fetch.requestedAt;
          // Only diagnostics from the current URL observation, not resolved historical errors.
          evidence.push(...issues.filter((entry) => entry.competitionId === game.competitionId &&
            entry.importRunId === fetch.importRunId && entry.sourceUrl === fetch.requestUrl));
        }
      }
      const quality = buildDetailQuality(availability, evidence, lastChecked);
      if (!dryRun) {
        const written = await tx.update(games).set({ detailQuality: quality }).where(and(eq(games.id, game.id), isNull(games.detailQuality))).returning({ id: games.id });
        updated += written.length;
      }
    }
    return { games: rows.length, updated };
  });
}
