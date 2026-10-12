import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, resolve } from "node:path";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import type { StatsArenaDatabase } from "@statsarena/db";
import { createDatabase } from "@statsarena/db";
import { competitions, games, playByPlayEvents, syncRuns } from "@statsarena/db/schema";
import { competitionUrl, sourceEntityId } from "../domain/source-url.js";
import { HtmlFetcher, type FetchMetadata } from "../fetch/fetcher.js";
import { SnapshotStore } from "../fetch/snapshots.js";
import { importCompetition, type ImportSummary } from "../import/importer.js";
import { fetchCounts, PipelineError, syncCompetition, type PipelineResult } from "../pipeline.js";
import { PARSER_VERSION, SOURCE_NAME, type ValidationIssue } from "../domain/types.js";
import { acquireDirectoryLock, competitionLockPath, snapshotLockPath, type DirectoryLock } from "./locks.js";
import { acquireSyncLease, type SyncLease } from "./lease.js";
import { FixturePageCheckpoint } from "./fixture-checkpoint.js";
import { safeError, SyncOperationError } from "./errors.js";
import type { SavedGameSyncState } from "../domain/incremental.js";

export type OperationalMode = "once" | "periodic" | "retry";

export interface SyncOperationOptions {
  input: string;
  snapshotDirectory: string;
  lockRoot: string;
  auditPath: (sourceCompetitionId: string) => string;
  snapshotOnly?: boolean;
  matchLimit?: number;
  forceRefresh?: boolean;
  incremental?: boolean;
  forceRefreshUrls?: ReadonlySet<string>;
  dryRun?: boolean;
  mode?: OperationalMode;
  nextRunAt?: Date | null;
  fetcher?: HtmlFetcher;
  db?: StatsArenaDatabase;
}

export interface SyncOperationResult {
  sourceUrl: string;
  sourceCompetitionId: string;
  result: PipelineResult;
  imported: ImportSummary | null;
  operationRunId: string | null;
  refreshedShrinkingPlayByPlayUrls: string[];
  elapsedMs: number;
}

const HEARTBEAT_MS = 20_000;

function failedOrPartialUrls(fetches: FetchMetadata[], issues: ValidationIssue[]): string[] {
  const urls = new Set<string>();
  for (const fetch of fetches) {
    if (fetch.fetchStatus === "failed" || fetch.parseStatus !== "parsed") urls.add(fetch.requestUrl);
  }
  for (const entry of issues) if (entry.severity === "error" && entry.sourceUrl) urls.add(entry.sourceUrl);
  return [...urls];
}

export async function findShrinkingPlayByPlayRefreshUrls(db: StatsArenaDatabase, sourceCompetitionId: string, result: PipelineResult): Promise<string[]> {
  const incoming = result.data.matches.filter((match) => match.playByPlay !== null && match.playByPlay !== undefined);
  if (!incoming.length) return [];
  const [competition] = await db.select({ id: competitions.id })
    .from(competitions)
    .where(and(eq(competitions.source, SOURCE_NAME), eq(competitions.sourceCompetitionId, sourceCompetitionId)))
    .limit(1);
  if (!competition) return [];
  const sourceIds = incoming.map((match) => match.fixture.sourceId);
  const existing = await db.select({ sourceGameId: games.sourceGameId, eventCount: count() })
    .from(games)
    .innerJoin(playByPlayEvents, eq(playByPlayEvents.gameId, games.id))
    .where(and(eq(games.competitionId, competition.id), inArray(games.sourceGameId, sourceIds)))
    .groupBy(games.sourceGameId);
  const savedCounts = new Map(existing.map((entry) => [entry.sourceGameId, Number(entry.eventCount)]));
  return incoming.filter((match) => (savedCounts.get(match.fixture.sourceId) ?? 0) > (match.playByPlay?.records.length ?? 0))
    .map((match) => match.playByPlay?.sourceUrl)
    .filter((sourceUrl): sourceUrl is string => sourceUrl !== undefined);
}

async function startOperationRow(
  db: StatsArenaDatabase,
  sourceCompetitionId: string,
  ownerId: string,
  mode: OperationalMode,
  nextRunAt: Date | null
): Promise<string> {
  const [knownCompetition] = await db.select({ id: competitions.id }).from(competitions)
    .where(and(eq(competitions.source, SOURCE_NAME), eq(competitions.sourceCompetitionId, sourceCompetitionId)))
    .limit(1);
  const [run] = await db.insert(syncRuns).values({
    competitionId: knownCompetition?.id ?? null,
    source: SOURCE_NAME,
    sourceCompetitionId,
    ownerId,
    hostname: hostname(),
    processId: process.pid,
    mode,
    status: "running",
    nextRunAt
  }).returning({ id: syncRuns.id });
  if (!run) throw new Error("Gagal membuat catatan status sinkronisasi.");
  return run.id;
}

async function updateOperationRow(
  db: StatsArenaDatabase,
  runId: string,
  ownerId: string,
  values: Partial<typeof syncRuns.$inferInsert>
): Promise<void> {
  await db.update(syncRuns).set(values).where(and(eq(syncRuns.id, runId), eq(syncRuns.ownerId, ownerId)));
}

async function savedGameIds(db: StatsArenaDatabase, sourceCompetitionId: string): Promise<Set<string>> {
  const [competition] = await db.select({ id: competitions.id }).from(competitions)
    .where(and(eq(competitions.source, SOURCE_NAME), eq(competitions.sourceCompetitionId, sourceCompetitionId)))
    .limit(1);
  if (!competition) return new Set();
  const rows = await db.select({ sourceGameId: games.sourceGameId }).from(games)
    .where(eq(games.competitionId, competition.id));
  return new Set(rows.map((row) => row.sourceGameId));
}

export async function readIncrementalGames(db: StatsArenaDatabase, sourceCompetitionId: string): Promise<Map<string, SavedGameSyncState>> {
  const [competition] = await db.select({ id: competitions.id }).from(competitions)
    .where(and(eq(competitions.source, SOURCE_NAME), eq(competitions.sourceCompetitionId, sourceCompetitionId))).limit(1);
  if (!competition) return new Map();
  const [rows, lastRuns] = await Promise.all([
    db.select({ sourceId: games.sourceGameId, fixtureHash: games.fixtureHash, detailSyncStatus: games.detailSyncStatus,
      detailParserVersion: games.detailParserVersion, detailSyncedAt: games.detailSyncedAt }).from(games)
      .where(eq(games.competitionId, competition.id)),
    db.select({ failureUrls: syncRuns.failureUrls }).from(syncRuns)
      .where(and(eq(syncRuns.competitionId, competition.id), eq(syncRuns.source, SOURCE_NAME)))
      .orderBy(desc(syncRuns.startedAt)).limit(1)
  ]);
  const retryIds = new Set((lastRuns[0]?.failureUrls ?? []).flatMap((url) => {
    const id = sourceEntityId(url, "match");
    return sourceEntityId(url, "competition") === sourceCompetitionId && id ? [id] : [];
  }));
  return new Map(rows.map((row) => [row.sourceId, { ...row, needsRetry: retryIds.has(row.sourceId) }]));
}

async function heartbeat(
  db: StatsArenaDatabase,
  lease: SyncLease,
  runId: string,
  locks: DirectoryLock[]
): Promise<void> {
  await lease.heartbeat();
  for (const lock of locks) await lock.heartbeat();
  await updateOperationRow(db, runId, lease.ownerId, { heartbeatAt: new Date() });
}

export async function runCompetitionSync(options: SyncOperationOptions): Promise<SyncOperationResult> {
  if (options.incremental && (options.forceRefresh || options.snapshotOnly)) {
    throw new Error("--incremental tidak dapat digabung dengan --refresh atau --snapshot-only.");
  }
  const startedAt = Date.now();
  const sourceUrl = competitionUrl(options.input).href;
  const sourceCompetitionId = sourceEntityId(sourceUrl, "competition");
  if (!sourceCompetitionId) throw new Error(`ID kompetisi tidak dapat ditentukan dari ${sourceUrl}.`);
  const ownerId = randomUUID();
  const locks: DirectoryLock[] = [];
  const shouldImport = !options.dryRun && !options.snapshotOnly;
  let openedConnection: ReturnType<typeof createDatabase> | null = null;
  let db = options.db ?? null;
  let lease: SyncLease | null = null;
  let operationRunId: string | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let heartbeatBusy = false;
  let heartbeatError: unknown = null;
  let pipeline: PipelineResult | null = null;
  let imported: ImportSummary | null = null;
  let refreshedShrinkingPlayByPlayUrls: string[] = [];
  let finished = false;

  try {
    await mkdir(options.snapshotDirectory, { recursive: true });
    const competitionLock = await acquireDirectoryLock(
      competitionLockPath(options.lockRoot, sourceCompetitionId), ownerId
    );
    locks.push(competitionLock);
    locks.push(await acquireDirectoryLock(snapshotLockPath(options.snapshotDirectory), ownerId));
    const checkpoint = new FixturePageCheckpoint(options.snapshotDirectory, sourceCompetitionId);
    const fixturePageResumeUrls = await checkpoint.read();

    if (shouldImport || options.incremental) {
      if (!db) {
        openedConnection = createDatabase();
        db = openedConnection.db;
      }
      if (!db) throw new Error("Koneksi Neon StatsArena belum tersedia.");
    }
    // Read previous failures before creating this operation's running row.
    // Incremental dry-run reads Neon without writing a lease or operational row.
    if (shouldImport && db) lease = await acquireSyncLease(db, sourceCompetitionId, ownerId);
    const incrementalGames = options.incremental && db ? await readIncrementalGames(db, sourceCompetitionId) : undefined;
    if (shouldImport && db) {
      operationRunId = await startOperationRow(db, sourceCompetitionId, ownerId, options.mode ?? "once", options.nextRunAt ?? null);
      heartbeatTimer = setInterval(() => {
        if (heartbeatBusy || !lease || !db || !operationRunId) return;
        heartbeatBusy = true;
        void heartbeat(db, lease, operationRunId, locks)
          .catch((error: unknown) => { heartbeatError = error; })
          .finally(() => { heartbeatBusy = false; });
      }, HEARTBEAT_MS);
      heartbeatTimer.unref();
    }

    const existingGameIds = db && shouldImport ? await savedGameIds(db, sourceCompetitionId) : undefined;

    const fetcher = options.fetcher ?? new HtmlFetcher({ snapshotStore: new SnapshotStore(options.snapshotDirectory) });
    pipeline = await syncCompetition(sourceUrl, {
      fetcher,
      ...(existingGameIds ? { existingGameIds } : {}),
      ...(incrementalGames ? { incrementalGames } : {}),
      fixturePageResumeUrls,
      snapshotOnly: options.snapshotOnly ?? false,
      forceRefresh: options.forceRefresh ?? false,
      ...(options.forceRefreshUrls ? { forceRefreshUrls: options.forceRefreshUrls } : {}),
      ...(options.matchLimit !== undefined ? { matchLimit: options.matchLimit } : {}),
      includeMatches: true
    });

    if (db && shouldImport) {
      const shrinkingPbp = await findShrinkingPlayByPlayRefreshUrls(db, sourceCompetitionId, pipeline);
      const requestedRefreshes = options.forceRefreshUrls ?? new Set<string>();
      refreshedShrinkingPlayByPlayUrls = shrinkingPbp.filter((url) => !options.forceRefresh && !requestedRefreshes.has(url));
      if (refreshedShrinkingPlayByPlayUrls.length) {
        const forced = new Set([...requestedRefreshes, ...refreshedShrinkingPlayByPlayUrls]);
        const refreshed = await syncCompetition(sourceUrl, {
          fetcher,
          ...(existingGameIds ? { existingGameIds } : {}),
          ...(incrementalGames ? { incrementalGames } : {}),
          fixturePageResumeUrls,
          forceRefreshUrls: forced,
          ...(options.matchLimit !== undefined ? { matchLimit: options.matchLimit } : {}),
          includeMatches: true
        });
        const allFetches = [...pipeline.fetches, ...refreshed.fetches];
        pipeline = {
          ...refreshed,
          // The importer associates each URL with its last retrieval. Keep the
          // second pass metadata for every dataset selected from that pass.
          fetches: allFetches,
          parseCounts: { ...refreshed.parseCounts, ...fetchCounts(allFetches), pbpShrinkRefreshPages: refreshedShrinkingPlayByPlayUrls.length }
        };
      }
    }

    for (const lock of locks) await lock.assertOwned();
    await checkpoint.write(pipeline.pendingFixturePageUrls ?? []);

    const issueList = [...pipeline.data.issues, ...pipeline.data.matches.flatMap((match) => match.issues)];
    const failureUrls = failedOrPartialUrls(pipeline.fetches, issueList);
    if (db && shouldImport) {
      if (!lease || !operationRunId) throw new Error("Lease atau status run hilang sebelum impor.");
      const activeLease = lease;
      if (heartbeatError) throw heartbeatError;
      await activeLease.assertOwned();
      for (const lock of locks) await lock.assertOwned();
      imported = await importCompetition(db, pipeline.data, pipeline.fetches, "sync", async (transaction) => {
        if (transaction) await activeLease.guardTransaction(transaction);
        else await activeLease.assertOwned();
      });
      await activeLease.assertOwned();
      const persistedUrls = [...new Set([...failureUrls, ...failedOrPartialUrls([], imported.issues)])];
      await updateOperationRow(db, operationRunId, ownerId, {
        competitionId: imported.competitionId,
        importRunId: imported.importRunId,
        heartbeatAt: new Date(),
        finishedAt: new Date(),
        status: imported.status,
        pageCount: pipeline.fetches.length,
        failureCount: persistedUrls.length,
        failureUrls: persistedUrls,
        writeCounts: { ...imported.counts },
        resultSummary: `${imported.status}; ${imported.counts["newGames"] ?? 0} pertandingan baru, ${imported.counts["updatedGames"] ?? 0} diperbarui.`
      });
      finished = true;
    }

    await writeAuditSafely(options.auditPath(sourceCompetitionId), {
      mode: options.dryRun ? "dry-run" : options.snapshotOnly ? "snapshot" : options.mode ?? "once",
      strategy: options.incremental ? "incremental" : "standard",
      sourceUrl,
      sourceCompetitionId,
      parserVersion: PARSER_VERSION,
      createdAt: new Date().toISOString(),
      parseCounts: pipeline.parseCounts,
      pendingFixturePageUrls: pipeline.pendingFixturePageUrls ?? [],
      fetches: pipeline.fetches,
      data: pipeline.data,
      issues: [...issueList, ...(imported?.issues ?? [])],
      imported,
      operationRunId,
      refreshedShrinkingPlayByPlayUrls,
      elapsedMs: Date.now() - startedAt
    });

    return { sourceUrl, sourceCompetitionId, result: pipeline, imported, operationRunId, refreshedShrinkingPlayByPlayUrls, elapsedMs: Date.now() - startedAt };
  } catch (error) {
    const fetches = pipeline?.fetches ?? (error instanceof PipelineError ? error.fetches : []);
    const issues = pipeline ? [...pipeline.data.issues, ...pipeline.data.matches.flatMap((match) => match.issues), ...(imported?.issues ?? [])]
      : error instanceof PipelineError ? error.issues : [];
    if (shouldImport && pipeline && !finished) {
      // Even a failure before the importer returns must keep the selected games
      // pending. Their old successful metadata may otherwise make them skippable.
      for (const match of pipeline.data.matches) issues.push({
        severity: "error", code: "SYNC_OPERATION_FAILED", message: safeError(error),
        sourceUrl: match.fixture.sourceUrl, fieldPath: `games.${match.fixture.sourceId}`,
        expected: null, actual: null
      });
    }
    if (db && operationRunId && !finished) {
      const failureUrls = failedOrPartialUrls(fetches, issues);
      try {
        await updateOperationRow(db, operationRunId, ownerId, {
          heartbeatAt: new Date(),
          finishedAt: new Date(),
          status: "failed",
          pageCount: fetches.length,
          failureCount: failureUrls.length,
          failureUrls,
          resultSummary: safeError(error)
        });
      } catch { /* preserve the primary error if the database is already unavailable */ }
    }
    let failureAuditPath: string | null = null;
    let auditWriteError: string | null = null;
    try {
      const path = options.auditPath(sourceCompetitionId);
      await writeAuditSafely(path, {
        strategy: options.incremental ? "incremental" : "standard",
        mode: "failed", operationMode: options.mode ?? "once",
        sourceUrl, sourceCompetitionId, parserVersion: PARSER_VERSION,
        createdAt: new Date().toISOString(), operationRunId,
        fetches, issues, data: pipeline?.data ?? null,
        parseCounts: pipeline?.parseCounts ?? fetchCounts(fetches),
        pendingFixturePageUrls: pipeline?.pendingFixturePageUrls ?? [],
        imported, error: safeError(error), elapsedMs: Date.now() - startedAt
      });
      failureAuditPath = path;
    } catch (auditError) { auditWriteError = safeError(auditError); }
    throw new SyncOperationError(error, sourceUrl, fetches, issues, failureAuditPath, auditWriteError);
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (lease) await lease.release().catch(() => undefined);
    for (const lock of [...locks].reverse()) await lock.release().catch(() => undefined);
    if (openedConnection) await openedConnection.close();
  }
}

async function writeAuditSafely(path: string, audit: unknown): Promise<void> {
  await mkdir(dirname(resolve(path)), { recursive: true });
  await writeFile(path, `${JSON.stringify(audit, null, 2)}\n`, { flag: "w" });
}

export async function runOnceSequentially<T>(
  items: readonly T[],
  runOne: (item: T, index: number) => Promise<void>
): Promise<void> {
  for (const [index, item] of items.entries()) await runOne(item, index);
}

export async function runPeriodicCycles(
  signal: AbortSignal,
  intervalMs: number,
  runCycle: () => Promise<void>,
  wait: (ms: number, signal: AbortSignal) => Promise<void> = abortableWait
): Promise<void> {
  while (!signal.aborted) {
    await runCycle();
    if (signal.aborted) break;
    await wait(intervalMs, signal);
  }
}

export function abortableWait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolvePromise) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolvePromise();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}
