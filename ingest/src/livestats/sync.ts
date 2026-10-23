import { and, asc, eq, inArray } from "drizzle-orm";
import type { StatsArenaDatabase } from "@statsarena/db";
import { competitions, games, gameLiveStats, playerGameStats, players, teamGameStats, teams, officialTeamMetrics } from "@statsarena/db/schema";
import { competitionReference } from "@statsarena/db/source";
import type { LiveStatsIssue, LiveStatsStatus, LiveStatsSupplement } from "@statsarena/db/livestats";
import type { ImportWriteGuard } from "../import/importer.js";
import { parsedDataHash } from "../domain/content-hash.js";
import { coreFields, parseLiveStatsJson, mergeSupplement, type PortalContext, type PortalCore } from "./parser.js";
import { LiveStatsClient, LiveStatsFetchError, type LiveStatsResponse } from "./client.js";
import { discoverLiveStatsData, liveStatsPageUrl, LIVESTATS_VERSION, LIVESTATS_HOST } from "./source.js";
import { readPendingLiveStats, writePendingLiveStats } from "./pending.js";
import { updateLiveStatsCatalog, type CatalogOptions } from "../operations/competition-catalog.js";

type Saved = typeof gameLiveStats.$inferSelect;
export interface LiveStatsSyncOptions {
  dryRun?: boolean; forceRefresh?: boolean; matchLimit?: number; gameIds?: ReadonlySet<string>;
  guard?: ImportWriteGuard; client?: LiveStatsClient; now?: Date;
  log?: (message: string) => void;
  catalog?: CatalogOptions;
}
export interface LiveStatsSyncResult {
  competition: string; total: number; selected: number; skipped: number; written: number; unchanged: number;
  statuses: Partial<Record<LiveStatsStatus, number>>;
  games: { sourceGameId: string; status: LiveStatsStatus; changed: boolean; players: number; issues: LiveStatsIssue[] }[];
}

export class LiveStatsSyncError extends Error {
  constructor(error: unknown, readonly result: LiveStatsSyncResult) {
    super("Transaksi LiveStats gagal; batch belum commit dan tetap eligible untuk retry.", { cause: error });
    this.name = "LiveStatsSyncError";
  }
}

function core(row: PortalCore): PortalCore {
  return Object.fromEntries(Object.keys(coreFields).map(key => [key, row[key as keyof PortalCore]])) as PortalCore;
}

export function liveStatsDue(context: PortalContext, saved: Saved | null, now: Date, force = false): boolean {
  return force || !saved || saved.parserVersion !== LIVESTATS_VERSION || saved.portalFingerprint !== parsedDataHash(context) || saved.nextAttemptAt <= now;
}

async function readContexts(db: StatsArenaDatabase, competitionId: string, sourceUrl: string) {
  const [gameRows, playerRows, teamRows, officialRows] = await Promise.all([
    db.select({ game: games, saved: gameLiveStats }).from(games).leftJoin(gameLiveStats, eq(gameLiveStats.gameId, games.id))
      .where(eq(games.competitionId, competitionId)).orderBy(asc(games.sourceGameId)),
    db.select({ stats: playerGameStats, name: players.name }).from(playerGameStats)
      .innerJoin(games, eq(games.id, playerGameStats.gameId)).innerJoin(players, eq(players.id, playerGameStats.playerId))
      .where(eq(games.competitionId, competitionId)).orderBy(asc(playerGameStats.playerId)),
    db.select({ stats: teamGameStats, name: teams.name }).from(teamGameStats)
      .innerJoin(games, eq(games.id, teamGameStats.gameId)).innerJoin(teams, eq(teams.id, teamGameStats.teamId))
      .where(eq(games.competitionId, competitionId)).orderBy(asc(teamGameStats.teamId)),
    db.select({ gameId: officialTeamMetrics.gameId, teamId: officialTeamMetrics.teamId, metricCode: officialTeamMetrics.metricCode, value: officialTeamMetrics.value })
      .from(officialTeamMetrics).where(and(eq(officialTeamMetrics.competitionId, competitionId), eq(officialTeamMetrics.scopeType, "game"), eq(officialTeamMetrics.availability, "available")))
      .orderBy(asc(officialTeamMetrics.teamId), asc(officialTeamMetrics.metricCode))
  ]);
  return gameRows.map(({ game, saved }) => ({ saved, context: {
    gameId: game.id, sourceGameId: game.sourceGameId, competitionUrl: sourceUrl, homeTeamId: game.homeTeamId, awayTeamId: game.awayTeamId,
    homeScore: game.homeScore, awayScore: game.awayScore, status: game.status,
    officialMetrics: officialRows.filter(r => r.gameId === game.id).map(({ teamId, metricCode, value }) => ({ teamId, metricCode, value })),
    players: playerRows.filter(r => r.stats.gameId === game.id).map(({ stats, name }) => ({ ...core(stats), playerId: stats.playerId, teamId: stats.teamId, name, jerseyNumber: stats.jerseyNumber })),
    teams: teamRows.filter(r => r.stats.gameId === game.id).map(({ stats, name }) => ({ ...core(stats), teamId: stats.teamId, name }))
  } satisfies PortalContext }));
}

/** Caller holds the same competition lease used by portal imports. */
export async function syncLiveStatsCompetition(db: StatsArenaDatabase, input: string, directory: string, options: LiveStatsSyncOptions = {}): Promise<LiveStatsSyncResult> {
  const reference = competitionReference(input);
  const [competition] = await db.select().from(competitions).where(and(eq(competitions.source, reference.source), eq(competitions.sourceCompetitionId, reference.id))).limit(1);
  if (!competition) throw new Error("LiveStats hanya memperbarui kompetisi yang sudah tersimpan di StatsArena.");
  if (competitionReference(competition.sourceUrl).key !== reference.key) throw new Error("Namespace kompetisi Neon tidak cocok.");
  const rows = await readContexts(db, competition.id, reference.url);
  const now = options.now ?? new Date();
  const pending = await readPendingLiveStats(directory, reference.key);
  const eligible = rows.filter(({ context, saved }) => ["complete", "live"].includes(context.status) &&
    (!options.gameIds || options.gameIds.has(context.sourceGameId)) && (pending.has(context.sourceGameId) || liveStatsDue(context, saved, now, options.forceRefresh)));
  const selected = options.matchLimit === undefined ? eligible : eligible.slice(0, options.matchLimit);
  const result: LiveStatsSyncResult = { competition: reference.key, total: rows.length, selected: selected.length, skipped: rows.length - selected.length, written: 0, unchanged: 0, statuses: {}, games: [] };
  const client = options.client ?? new LiveStatsClient(directory);
  // Two games at a time; each request is bounded and retried independently.
  try {
    for (let offset = 0; offset < selected.length; offset += 2) {
      if (!options.dryRun) {
        for (const row of selected.slice(offset, offset + 2)) pending.add(row.context.sourceGameId);
        await writePendingLiveStats(directory, reference.key, pending);
      }
      const outcomes = await Promise.all(selected.slice(offset, offset + 2).map(async ({ context, saved }) => {
        const fingerprint = parsedDataHash(context);
        const pageUrl = liveStatsPageUrl(reference.url, context.sourceGameId);
        let sourceUrl = `https://${LIVESTATS_HOST}/data/${context.sourceGameId}/data.json`;
        let status: LiveStatsStatus, payload: LiveStatsSupplement | null = null;
        let issues: LiveStatsIssue[];
        let response: LiveStatsResponse | null = null;
        let snapshotPath: string | null = null;
        try {
          const page = await client.get(pageUrl, options.forceRefresh ? 0 : 86_400_000);
          sourceUrl = discoverLiveStatsData(page.body, pageUrl, reference.url, context.sourceGameId);
          await client.accept(page);
          response = await client.get(sourceUrl, options.forceRefresh || (saved && saved.portalFingerprint !== fingerprint) ? 0 : context.status === "live" ? 15_000 : 300_000);
          const parsed = parseLiveStatsJson(JSON.parse(response.body) as unknown, context);
          status = parsed.status; payload = parsed.payload; issues = parsed.issues;
          if (payload) {
            snapshotPath = await client.accept(response);
            const provenance = { sha256: response.hash, fetchedAt: response.fetchedAt, snapshotPath };
            payload = { players: payload.players.map(row => ({ ...row, provenance })), teams: payload.teams.map(row => ({ ...row, provenance })) };
            const missingOptional = [...payload.players, ...payload.teams].some(row => {
              const old = "playerId" in row ? saved?.payload?.players.find(p => p.playerId === row.playerId) : saved?.payload?.teams.find(t => t.teamId === row.teamId);
              return old && Object.entries(row).some(([key, value]) => value === null && (old as unknown as Record<string, unknown>)[key] != null);
            });
            if (missingOptional) { status = "partial"; issues.push({ code: "LIVESTATS_OPTIONAL_FIELDS_RETAINED", field: "payload", message: "Field opsional hilang; baris valid sebelumnya beserta provenance dipertahankan." }); }
            payload = mergeSupplement(saved?.payload ?? null, payload);
          } else if (issues[0]) issues[0].evidence = { sha256: response.hash, fetchedAt: response.fetchedAt, snapshotPath: response.snapshotPath };
        } catch (error) {
          status = error instanceof LiveStatsFetchError ? ([403, 404].includes(error.status ?? 0) ? "unavailable" : "fetch_failed") : "parse_failed";
          issues = [{ code: `LIVESTATS_${status.toUpperCase()}`, field: "source", message: error instanceof LiveStatsFetchError ? error.message : "Struktur/identitas LiveStats tidak dapat divalidasi; data tersimpan dipertahankan.",
            ...(response ? { evidence: { sha256: response.hash, fetchedAt: response.fetchedAt, snapshotPath: response.snapshotPath } } : {}) }];
        }
        const payloadHash = payload ? parsedDataHash(payload) : saved?.payloadHash ?? null;
        const changed = !saved || saved.status !== status || saved.payloadHash !== payloadHash || saved.portalFingerprint !== fingerprint || saved.parserVersion !== LIVESTATS_VERSION || parsedDataHash(saved.issues) !== parsedDataHash(issues);
        const minutes = context.status === "live" ? 1 : status === "fetch_failed" ? 5 : status === "parse_failed" || status === "partial" ? 60 : 1440;
        return { context, saved, pageUrl, sourceUrl, status, payload, issues, response, snapshotPath, fingerprint, payloadHash, changed, minutes };
      }));
      // Network work happens outside the write transaction; verify lease at commit.
      if (!options.dryRun) {
        try { await db.transaction(async tx => {
          if (!options.guard) throw new Error("Penulisan LiveStats memerlukan guard lease kompetisi.");
          await options.guard(tx);
          const known = await tx.select({ id: games.id }).from(games).where(and(eq(games.competitionId, competition.id), inArray(games.id, outcomes.map(o => o.context.gameId))));
          if (known.length !== outcomes.length) throw new Error("Scope pertandingan berubah sebelum commit LiveStats.");
          const values = outcomes.map(o => ({
            gameId: o.context.gameId, status: o.status, sourceUrl: o.sourceUrl, pageUrl: o.pageUrl, parserVersion: LIVESTATS_VERSION,
            payload: o.payload ?? o.saved?.payload ?? null, payloadHash: o.payloadHash,
            sourceHash: o.payload ? o.response?.hash ?? null : o.saved?.sourceHash ?? null,
            sourceFetchedAt: o.payload && o.response ? new Date(o.response.fetchedAt) : o.saved?.sourceFetchedAt ?? null,
            snapshotPath: o.payload ? o.snapshotPath : o.saved?.snapshotPath ?? null,
            portalFingerprint: o.fingerprint, lastAttemptAt: now, nextAttemptAt: new Date(now.getTime() + o.minutes * 60_000), issues: o.issues, updatedAt: now
          }));
          // Update the current observation only; hashes avoid replacing unchanged payloads.
          for (const value of values) {
            const outcome = outcomes.find(o => o.context.gameId === value.gameId)!;
            if (!outcome.changed && outcome.saved) {
              await tx.update(gameLiveStats).set({ lastAttemptAt: value.lastAttemptAt, nextAttemptAt: value.nextAttemptAt,
                sourceHash: value.sourceHash, sourceFetchedAt: value.sourceFetchedAt, snapshotPath: value.snapshotPath }).where(eq(gameLiveStats.gameId, value.gameId));
            } else await tx.insert(gameLiveStats).values(value).onConflictDoUpdate({ target: gameLiveStats.gameId, set: value });
          }
        }); } catch (error) {
          throw new LiveStatsSyncError(error, { ...result, games: [...result.games, ...outcomes.map(o => ({ sourceGameId: o.context.sourceGameId,
            status: o.status, changed: o.changed, players: o.payload?.players.length ?? 0,
            issues: [...o.issues, { code: "LIVESTATS_TRANSACTION_FAILED", field: "transaction", message: "Hasil parse belum commit; checkpoint mempertahankan eligibility." }] }))] });
        }
        for (const outcome of outcomes) pending.delete(outcome.context.sourceGameId);
        await writePendingLiveStats(directory, reference.key, pending);
      }
      for (const outcome of outcomes) {
        if (!options.dryRun) {
          // Cache cleanup cannot invalidate a committed observation or its hash.
          try {
            await client.compact(outcome.pageUrl);
            const kept = outcome.payload ?? outcome.saved?.payload;
            await client.compact(outcome.sourceUrl, [outcome.payload ? outcome.response?.hash : outcome.saved?.sourceHash,
              ...(kept?.players ?? []).map(row => row.provenance?.sha256), ...(kept?.teams ?? []).map(row => row.provenance?.sha256)].filter((hash): hash is string => Boolean(hash)));
          } catch { options.log?.(`${reference.key}/${outcome.context.sourceGameId}: pembersihan cache LiveStats ditunda.`); }
        }
        if (outcome.changed) { if (!options.dryRun) result.written++; } else result.unchanged++;
        result.statuses[outcome.status] = (result.statuses[outcome.status] ?? 0) + 1;
        result.games.push({ sourceGameId: outcome.context.sourceGameId, status: outcome.status, changed: outcome.changed,
          players: outcome.payload?.players.length ?? outcome.saved?.payload?.players.length ?? 0, issues: outcome.issues });
        options.log?.(`${reference.key}/${outcome.context.sourceGameId}: ${outcome.status}`);
      }
    }
    return result;
  } finally {
    if (options.catalog) {
      try { await updateLiveStatsCatalog(options.catalog, reference.url, selected.map(row => row.context.sourceGameId), competition.name); }
      catch { (options.log ?? (message => process.stderr.write(`${message}\n`)))("Katalog LiveStats belum diperbarui; jalankan catalog rebuild."); }
    }
  }
}
