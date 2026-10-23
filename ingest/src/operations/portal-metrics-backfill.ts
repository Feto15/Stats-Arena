import { and, desc, eq, gt, sql } from "drizzle-orm";
import type { StatsArenaDatabase } from "@statsarena/db";
import { competitions, games, teams, sourceFetches, officialTeamMetrics, gameLiveStats, syncLeases, syncRuns, importRuns } from "@statsarena/db/schema";
import { competitionReference, sourceEntityId, sameSourceNamespace } from "../domain/source-url.js";
import { PARSER_VERSION } from "../domain/types.js";
import type { SnapshotStore } from "../fetch/snapshots.js";
import { parseTeamAnalysisHtml } from "../parsers/official-metrics.js";
import { officialMetricConflicts } from "../livestats/official-metrics.js";
import { parsedDataHash } from "../domain/content-hash.js";

/** Add missing game metrics from proven stored HTML, without refreshing domain datasets. */
export async function backfillPortalMetrics(db: StatsArenaDatabase, store: SnapshotStore, dryRun = true, input?: string) {
  const reference = input ? competitionReference(input) : null;
  return db.transaction(async tx => {
    if (!dryRun) {
      await tx.execute(sql`lock table statsarena.sync_leases, statsarena.sync_runs, statsarena.import_runs,
        statsarena.games, statsarena.source_fetches, statsarena.team_official_metrics, statsarena.game_livestats in share row exclusive mode`);
      const [leases, runs, imports] = await Promise.all([
        tx.select({ id: syncLeases.id }).from(syncLeases).where(gt(syncLeases.expiresAt, new Date())).limit(1),
        tx.select({ id: syncRuns.id }).from(syncRuns).where(eq(syncRuns.status, "running")).limit(1),
        // Old orphan import audits have no lease/heartbeat and are not writers.
        // Recent standalone imports are still blocked conservatively.
        tx.select({ id: importRuns.id }).from(importRuns).where(and(eq(importRuns.status, "running"), gt(importRuns.startedAt, new Date(Date.now() - 86_400_000)))).limit(1)
      ]);
      if (leases.length || runs.length || imports.length) throw new Error("Writer aktif; backfill metrik dibatalkan.");
    }
    const [gameRows, teamRows, fetches, savedMetrics, extras] = await Promise.all([
      tx.select({ game: games, competition: competitions }).from(games).innerJoin(competitions, eq(competitions.id, games.competitionId)),
      tx.select().from(teams),
      tx.select().from(sourceFetches).where(eq(sourceFetches.resource, "analysis")).orderBy(desc(sourceFetches.requestedAt), desc(sourceFetches.createdAt), desc(sourceFetches.id)),
      tx.select().from(officialTeamMetrics).where(eq(officialTeamMetrics.scopeType, "game")),
      tx.select().from(gameLiveStats)
    ]);
    const insertRows: typeof officialTeamMetrics.$inferInsert[] = [];
    const observations: { competition: string; game: string; status: string; added: number; sourceFetchId?: string; sha256?: string; reason?: string }[] = [];
    const affected = new Set<string>();
    for (const { game, competition } of gameRows) {
      const ref = competitionReference(competition.sourceUrl);
      if (reference && ref.key !== reference.key) continue;
      if (ref.source !== competition.source || !sameSourceNamespace(competition.sourceUrl, game.sourceUrl)) throw new Error("Scope sumber StatsArena tidak cocok.");
      if (game.status === "scheduled") continue;
      const observation = { competition: ref.key, game: game.sourceGameId, status: "skipped", added: 0 };
      const latest = fetches.find(f => f.competitionId === game.competitionId && sameSourceNamespace(f.requestUrl, game.sourceUrl) && sourceEntityId(f.requestUrl, "match") === game.sourceGameId);
      const quality = game.detailQuality?.analysis.status;
      if (!latest || latest.fetchStatus !== "succeeded" || latest.parseStatus !== "parsed" || quality === "partial" || quality === "failed") {
        observations.push({ ...observation, reason: "Belum ada observasi analysis lengkap yang dapat dipakai." }); continue;
      }
      try {
        const { html, entry } = await store.read(latest.requestUrl);
        if (entry.sha256 !== latest.sha256 || entry.lastAttemptFailed) throw new Error("Snapshot bukan observasi Neon terkini.");
        const parsed = parseTeamAnalysisHtml(html, latest.requestUrl);
        if (parsed.status !== "parsed") { observations.push({ ...observation, status: "partial", reason: "Snapshot analysis belum lengkap pada parser baru." }); continue; }
        const selected = parsed.records.filter(m => m.scope === "game" && ["PIP", "PFT", "FBP"].includes(m.metricCode));
        const ids = new Map(teamRows.filter(t => t.source === competition.source && (t.id === game.homeTeamId || t.id === game.awayTeamId)).map(t => [t.sourceTeamId, t.id]));
        if (selected.some(m => m.gameSourceId !== game.sourceGameId || m.competitionSourceId !== ref.id || !ids.has(m.teamSourceId))) throw new Error("Identitas metrik tidak cocok dengan laga tersimpan.");
        let added = 0;
        for (const metric of selected) {
          const teamId = ids.get(metric.teamSourceId)!;
          const prior = savedMetrics.find(m => m.gameId === game.id && m.teamId === teamId && m.metricCode === metric.metricCode);
          // Backfill only fills missing records; official corrections use normal sync.
          if (prior) continue;
          insertRows.push({ competitionId: game.competitionId, scopeType: "game", gameId: game.id, teamId, metricCode: metric.metricCode,
            value: metric.value, availability: metric.availability, unit: metric.unit, scopeLabel: metric.scopeLabel,
            sampleGamesPlayed: null, rawValue: metric.rawValue, sourceUrl: metric.sourceUrl, sourceFetchId: latest.id, parserVersion: PARSER_VERSION });
          affected.add(game.id); added++;
        }
        observations.push({ ...observation, status: selected.length ? "parsed" : "unavailable", added, sourceFetchId: latest.id, sha256: entry.sha256 });
      } catch (error) {
        observations.push({ ...observation, reason: error instanceof Error ? error.message : "Snapshot tidak dapat divalidasi." });
      }
    }
    for (let i = 0; !dryRun && i < insertRows.length; i += 250) await tx.insert(officialTeamMetrics).values(insertRows.slice(i, i + 250));
    const issueUpdates: { gameId: string; previousIssues: typeof gameLiveStats.$inferSelect["issues"]; issues: typeof gameLiveStats.$inferSelect["issues"] }[] = [];
    for (const extra of extras) {
      if (!affected.has(extra.gameId) || !extra.payload) continue;
      const current = [...savedMetrics.filter(m => m.gameId === extra.gameId), ...insertRows.filter(m => m.gameId === extra.gameId)]
        .filter(m => m.availability === "available").map(m => ({ teamId: m.teamId, metricCode: m.metricCode, value: m.value ?? null }));
      const issues = [...extra.issues.filter(i => i.code !== "LIVESTATS_OFFICIAL_METRIC_CONFLICT"), ...officialMetricConflicts(current, extra.payload.teams)];
      if (parsedDataHash(issues) === parsedDataHash(extra.issues)) continue;
      issueUpdates.push({ gameId: extra.gameId, previousIssues: extra.issues, issues });
      if (!dryRun) await tx.update(gameLiveStats).set({ issues, status: extra.status === "ready" && issues.length ? "partial" : extra.status,
        updatedAt: new Date() }).where(eq(gameLiveStats.id, extra.id));
    }
    return { dryRun, parserVersion: PARSER_VERSION, scanned: observations.length, gamesAdded: affected.size,
      metricsAdded: insertRows.length, written: dryRun ? 0 : insertRows.length, issueUpdates, observations };
  });
}
