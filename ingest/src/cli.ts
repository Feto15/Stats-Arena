import { backfillDetailQuality } from "./operations/quality-backfill.js";
import { exportAnalysis } from "./analytics/export.js";
import { loadProjectEnv } from "@statsarena/db/env";
import { mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { createDatabase } from "@statsarena/db";
import { competitions, syncRuns } from "@statsarena/db/schema";
import { acquireSyncLease } from "./operations/lease.js";
import { syncLiveStatsCompetition, LiveStatsSyncError } from "./livestats/sync.js";
import { PARSER_VERSION } from "./domain/types.js";
import { backfillPortalMetrics } from "./operations/portal-metrics-backfill.js";
import { competitionUrl, competitionReference, validateSourceUrl } from "./domain/source-url.js";
import { HtmlFetcher } from "./fetch/fetcher.js";
import { SnapshotStore } from "./fetch/snapshots.js";
import { PipelineError, discoverCompetition } from "./pipeline.js";
import { parseSyncIntervalSeconds, readCompetitionConfig } from "./operations/config.js";
import { acquireDirectoryLock, competitionLockPath, snapshotLockPath } from "./operations/locks.js";
import { runCompetitionSync, runPeriodicCycles, type OperationalMode } from "./operations/runner.js";
import { targetedRetryUrls } from "./operations/targeted-retry.js";
import { compactStorage, type AuditPolicy } from "./operations/audit-storage.js";
import { archivedImportRunIds, compactNeonAudit } from "./operations/neon-retention.js";
import { parseFullSyncInterval, runRunnerService } from "./operations/service.js";
import { safeError, SyncOperationError } from "./operations/errors.js";
import { rebuildCompetitionCatalog, updateAnalysisCatalog, updateCompetitionCatalog, type CatalogOptions } from "./operations/competition-catalog.js";

loadProjectEnv();

const rootDir = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const defaultSnapshotDir = process.env["STATSARENA_SNAPSHOT_DIR"] ?? "ingest/snapshots";
const defaultAuditDir = process.env["STATSARENA_AUDIT_DIR"] ?? "ingest/audit";
const defaultConfigPath = "ingest/config/competitions.json";

interface ParsedArgs {
  command: string;
  positional: string[];
  values: Map<string, string>;
  flags: Set<string>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const command = argv[0] ?? "help";
  const positional: string[] = [];
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value) continue;
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const key = value.slice(2);
    if (["dry-run", "snapshot-only", "refresh", "incremental", "help"].includes(key)) {
      flags.add(key);
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`Argumen --${key} memerlukan nilai.`);
    values.set(key, next);
    index += 1;
  }
  return { command, positional, values, flags };
}

function showHelp(): void {
  process.stdout.write(`StatsArena ingest\n\n` +
    `Perintah:\n` +
    `  discover --url <URL|ID> [--snapshot-only|--refresh] [--snapshot-dir <path>] [--output <file>]\n` +
    `  sync --competition <URL|ID> [--dry-run] [--snapshot-only|--refresh|--incremental] [--match-limit <n>] [--snapshot-dir <path>] [--output <file>]\n` +
    `  runner once [--dry-run] [--incremental|--refresh] [--config <file>] [--interval-seconds <n>]\n` +
    `  runner watch [--dry-run] [--incremental|--refresh] [--config <file>] [--interval-seconds <n>]\n` +
    `  runner service [--dry-run] [--config <file>] [--interval-seconds <n>] [--full-sync-interval-seconds <n>]\n` +
    `  quality backfill [--dry-run]\n` +
    `  catalog rebuild [--snapshot-dir <path>]\n` +
    `  analysis export --competition <URL|ID> [--audit <file>] [--dry-run]\n` +
    `  metrics backfill [--competition <URL|ID>] [--dry-run] [--snapshot-dir <path>]\n` +
    `  livestats sync --competition <URL|ID> [--game <ID>] [--dry-run] [--refresh] [--match-limit <n>]\n` +
    `  livestats backfill [--competition <URL|ID>] [--dry-run] [--refresh] [--match-limit <n>]\n` +
    `  retry --competition <URL|ID> [--audit <file>] [--dry-run] [--incremental] [--snapshot-dir <path>]\n` +
    `  storage compact [--dry-run] [--snapshot-dir <path>]\n` +
    `  storage compact-neon [--dry-run]\n` +
    `  snapshot read --url <page URL> [--snapshot-dir <path>] [--output <file>]\n\n` +
    `--dry-run hanya menyimpan audit JSON lokal, tanpa menulis data aplikasi/operasional ke Neon.\n` +
    `--snapshot-only membaca HTML terkompresi lokal dan tidak mengakses jaringan.\n` +
    `--refresh melewati TTL cache untuk seluruh halaman yang diperlukan.\n` +
    `Referensi kompetisi: ID angka untuk IBF; IBL:<ID> atau URL lengkap untuk IBL.\n` +
    `--incremental membaca state Neon dan menyegarkan fixture; hanya memproses laga baru/berubah/live/unknown/belum valid atau gagal.\n` +
    `--incremental --dry-run membaca Neon tanpa menulis database; tidak dapat digabung dengan --refresh atau --snapshot-only.\n` +
    `--audit-mode auto|full|archive: runner default auto; sync/retry default full.\n` +
    `storage compact meringkas audit lama dan membersihkan snapshot yang tidak dilindungi; tanpa akses Neon.\n` +
    `storage compact-neon memeriksa Neon dan menghapus fetch audit sukses yang tergantikan/tidak dirujuk; backup lokal dibuat sebelum commit.\n` +
    `retry memaksa refresh hanya halaman gagal/parsial dari audit; maksimal 25 URL per perintah.\n` +
    `runner watch menyelesaikan satu siklus penuh, menunggu interval, lalu mengulang sampai SIGINT/SIGTERM.\n` +
    `runner service memakai incremental rutin dan pemeriksaan standard harian dengan checkpoint permanen.\n` +
    `Interval bawaan: STATSARENA_SYNC_INTERVAL_SECONDS atau 900 detik.\n`);
}

function requiredValue(args: ParsedArgs, name: string): string {
  const value = args.values.get(name);
  if (!value) throw new Error(`Wajib memberikan --${name}.`);
  return value;
}

function safeWorkspacePath(input: string, area: "ingest/snapshots" | "ingest/audit" | "ingest/config"): string {
  const absolute = isAbsolute(input) ? resolve(input) : resolve(rootDir, input);
  const areaRoot = resolve(rootDir, area);
  const rel = relative(areaRoot, absolute);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Path harus berada di dalam ${area}.`);
  }
  return absolute;
}

function snapshotPath(input: string | undefined): string {
  return safeWorkspacePath(input ?? defaultSnapshotDir, "ingest/snapshots");
}

function snapshotStore(input: string | undefined): SnapshotStore {
  return new SnapshotStore(snapshotPath(input));
}

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sourceIdFromInput(input: string): string {
  return competitionReference(input).key;
}

function auditPath(input: string | undefined, defaultName: string): string {
  const path = input
    ? safeWorkspacePath(input, "ingest/audit")
    : safeWorkspacePath(resolve(rootDir, defaultAuditDir, defaultName), "ingest/audit");
  if (basename(path) === "" || !path.endsWith(".json")) throw new Error("File audit harus berakhiran .json.");
  return path;
}

function configPath(input: string | undefined): string {
  return safeWorkspacePath(input ?? defaultConfigPath, "ingest/config");
}

function catalogOptions(snapshotDirectory: string): CatalogOptions {
  const input = process.env["STATSARENA_CATALOG_PATH"] ?? "ingest/config/competitions_catalog.json";
  const path = resolve(rootDir, input);
  const area = path.startsWith(`${resolve(rootDir, "ingest/audit")}${sep}`) ? "ingest/audit" : "ingest/config";
  if (basename(path) !== "competitions_catalog.json") throw new Error("Nama file katalog harus competitions_catalog.json.");
  return { path: safeWorkspacePath(path, area), projectRoot: rootDir, snapshotDirectory };
}

function printSummary(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function withSnapshotLocks<T>(sourceCompetitionId: string, directory: string, action: () => Promise<T>): Promise<T> {
  const ownerId = randomUUID();
  const locks = [] as Awaited<ReturnType<typeof acquireDirectoryLock>>[];
  try {
    locks.push(await acquireDirectoryLock(competitionLockPath(resolve(rootDir, "ingest/.locks"), sourceCompetitionId), ownerId));
    locks.push(await acquireDirectoryLock(snapshotLockPath(directory), ownerId));
    return await action();
  } finally {
    for (const lock of locks.reverse()) await lock.release().catch(() => undefined);
  }
}

async function runDiscover(args: ParsedArgs): Promise<void> {
  const input = requiredValue(args, "url");
  const directory = snapshotPath(args.values.get("snapshot-dir"));
  const store = new SnapshotStore(directory);
  const sourceUrl = competitionUrl(input).href;
  const id = sourceIdFromInput(input);
  const result = await withSnapshotLocks(id, directory, () => discoverCompetition(sourceUrl, {
    fetcher: new HtmlFetcher({ snapshotStore: store }),
    snapshotOnly: args.flags.has("snapshot-only"),
    forceRefresh: args.flags.has("refresh")
  }));
  const path = auditPath(args.values.get("output"), `${id}-discover-${timestampSlug()}.json`);
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify({
    mode: "discover",
    sourceUrl: result.data.competition.sourceUrl,
    parserVersion: PARSER_VERSION,
    createdAt: new Date().toISOString(),
    parseCounts: result.parseCounts,
    fetches: result.fetches,
    data: result.data,
    issues: result.data.issues
  }, null, 2)}\n`);
  try { await updateCompetitionCatalog(catalogOptions(directory), path); }
  catch (error) { process.stderr.write(`Katalog kompetisi belum diperbarui: ${safeError(error)}\n`); }
  printSummary({ mode: "discover", auditFile: path, parseCounts: result.parseCounts, issues: result.data.issues.length });
}

function matchLimit(args: ParsedArgs): number | undefined {
  const value = args.values.get("match-limit");
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("--match-limit harus bilangan bulat nol atau lebih.");
  return parsed;
}

function auditPolicy(args: ParsedArgs, fallback: AuditPolicy): AuditPolicy {
  const value = args.values.get("audit-mode") ?? fallback;
  if (value !== "auto" && value !== "full" && value !== "archive") throw new Error("--audit-mode harus auto, full, atau archive.");
  if (value === "archive" && (args.flags.has("incremental") || args.values.has("match-limit"))) throw new Error("Arsip lengkap tidak dapat memakai --incremental atau --match-limit.");
  return value;
}

async function runStorageMaintenance(args: ParsedArgs): Promise<void> {
  if (args.positional[0] === "compact-neon") {
    const directory = safeWorkspacePath(defaultAuditDir, "ingest/audit");
    await mkdir(directory, { recursive: true });
    const actualDirectory = await realpath(directory);
    const auditRoot = resolve(rootDir, "ingest/audit");
    const relativeDirectory = relative(auditRoot, actualDirectory);
    if (relativeDirectory === ".." || relativeDirectory.startsWith(`..${sep}`) || isAbsolute(relativeDirectory)) {
      throw new Error("Direktori audit berada di luar workspace.");
    }
    const protectedRunIds = await archivedImportRunIds(directory);
    const database = createDatabase();
    try {
      const result = await compactNeonAudit(database.db, { dryRun: args.flags.has("dry-run"), protectedRunIds,
        backupPath: resolve(directory, `neon-cleanup-${timestampSlug()}-${randomUUID()}.json.gz`) });
      const report = auditPath(undefined, `neon-cleanup-${timestampSlug()}.json`);
      await writeFile(report, `${JSON.stringify(result, null, 2)}\n`);
      printSummary({ ...result, report });
    } finally { await database.close(); }
    return;
  }
  if (args.positional[0] !== "compact") throw new Error("Gunakan storage compact atau storage compact-neon.");
  const directory = snapshotPath(args.values.get("snapshot-dir"));
  const audits = safeWorkspacePath(resolve(rootDir, defaultAuditDir), "ingest/audit");
  const areas: Array<[string, string]> = [[directory, "ingest/snapshots"], [audits, "ingest/audit"]];
  for (const [path, area] of areas) {
    const actual = await realpath(path); const areaRoot = await realpath(resolve(rootDir, area));
    const rel = relative(areaRoot, actual);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("Direktori penyimpanan berada di luar workspace.");
  }
  printSummary(await compactStorage({ auditDirectory: audits, snapshotDirectory: directory, dryRun: args.flags.has("dry-run") }));
}

async function runSyncOperation(
  input: string,
  args: ParsedArgs,
  operation: { mode: OperationalMode; forceRefreshUrls?: ReadonlySet<string>; nextRunAt?: Date | null }
): Promise<void> {
  const directory = snapshotPath(args.values.get("snapshot-dir"));
  const id = sourceIdFromInput(input);
  const path = auditPath(args.values.get("output"), `${id}-sync-${timestampSlug()}.json`);
  const startedAt = Date.now();
  const limit = matchLimit(args);
  const result = await runCompetitionSync({
    input,
    snapshotDirectory: directory,
    lockRoot: resolve(rootDir, "ingest/.locks"),
    auditPath: () => path,
    catalog: catalogOptions(directory),
    onPhase: (phase, elapsedMs) => process.stderr.write(`[${id}] ${phase}: ${(elapsedMs / 1000).toFixed(2)}s\n`),
    auditPolicy: auditPolicy(args, "full"),
    snapshotOnly: args.flags.has("snapshot-only"),
    forceRefresh: args.flags.has("refresh"),
    ...(operation.forceRefreshUrls ? { forceRefreshUrls: operation.forceRefreshUrls } : {}),
    incremental: args.flags.has("incremental"),
    includeLiveStats: true,
    dryRun: args.flags.has("dry-run"),
    mode: operation.mode,
    ...(operation.nextRunAt !== undefined ? { nextRunAt: operation.nextRunAt } : {}),
    ...(limit !== undefined ? { matchLimit: limit } : {}),
  });
  printSummary({
    mode: args.flags.has("dry-run") ? "dry-run" : args.flags.has("snapshot-only") ? "snapshot" : operation.mode,
    strategy: args.flags.has("incremental") ? "incremental" : "standard",
    auditFile: path,
    sourceUrl: result.sourceUrl,
    operationRunId: result.operationRunId,
    parseCounts: result.result.parseCounts,
    refreshedShrinkingPlayByPlayUrls: result.refreshedShrinkingPlayByPlayUrls,
    elapsedMs: Date.now() - startedAt,
    timings: result.timings,
    audit: result.audit,
    maintenance: result.maintenance,
    imported: result.imported,
    liveStats: result.liveStats,
    analysis: result.analysis
  });
}

async function readRetryAudit(sourceCompetitionId: string, requestedPath: string | undefined): Promise<unknown> {
  if (requestedPath) return JSON.parse(await readFile(safeWorkspacePath(requestedPath, "ingest/audit"), "utf8")) as unknown;
  const directory = safeWorkspacePath(resolve(rootDir, defaultAuditDir), "ingest/audit");
  const candidates = (await readdir(directory)).filter((name) => name.startsWith(`${sourceCompetitionId}-`) && !name.includes("-livestats-") && name.endsWith(".json"));
  const sorted = await Promise.all(candidates.map(async (name) => ({
    path: resolve(directory, name),
    modifiedAt: (await stat(resolve(directory, name))).mtimeMs
  })));
  const latest = sorted.sort((a, b) => b.modifiedAt - a.modifiedAt)[0];
  if (!latest) throw new Error(`Audit untuk kompetisi ${sourceCompetitionId} belum ditemukan.`);
  return JSON.parse(await readFile(latest.path, "utf8")) as unknown;
}

async function runRetry(args: ParsedArgs): Promise<void> {
  const input = requiredValue(args, "competition");
  const id = sourceIdFromInput(input);
  const audit = await readRetryAudit(id, args.values.get("audit"));
  const urls = targetedRetryUrls(audit, id);
  process.stdout.write(`Retry terarah: ${urls.length} halaman untuk kompetisi ${id}.\n`);
  await runSyncOperation(input, args, { mode: "retry", forceRefreshUrls: new Set(urls) });
}

async function runConfiguredCycle(
  args: ParsedArgs,
  mode: OperationalMode,
  nextRunAt: Date | null,
  signal?: AbortSignal
): Promise<{ operationRunIds: string[]; succeeded: boolean }> {
  const competitions = await readCompetitionConfig(configPath(args.values.get("config")));
  if (competitions.length === 0) throw new Error("Tidak ada kompetisi aktif pada konfigurasi runner.");
  const operationRunIds: string[] = [];
  let successfulCompetitions = 0;
  for (const competition of competitions) {
    if (signal?.aborted) break;
    const id = competition.sourceCompetitionId;
    const path = auditPath(undefined, `${id}-sync-${timestampSlug()}.json`);
    try {
      const directory = snapshotPath(args.values.get("snapshot-dir"));
      const result = await runCompetitionSync({
        input: competition.sourceUrl,
        snapshotDirectory: directory,
        lockRoot: resolve(rootDir, "ingest/.locks"),
        auditPath: () => path,
        catalog: catalogOptions(directory),
        onPhase: (phase, elapsedMs) => process.stderr.write(`[${id}] ${phase}: ${(elapsedMs / 1000).toFixed(2)}s\n`),
        auditPolicy: auditPolicy(args, "auto"),
        snapshotOnly: args.flags.has("snapshot-only"),
        forceRefresh: args.flags.has("refresh"),
        incremental: args.flags.has("incremental"),
        includeLiveStats: true,
        dryRun: args.flags.has("dry-run"),
        mode,
        nextRunAt
      });
      if (result.operationRunId) operationRunIds.push(result.operationRunId);
      const succeeded = result.imported ? result.imported.status === "succeeded"
        : result.result.fetches.every(fetch => fetch.fetchStatus === "succeeded" && fetch.parseStatus === "parsed") &&
          [...result.result.data.issues, ...result.result.data.matches.flatMap(match => match.issues)].every(issue => issue.severity !== "error");
      if (succeeded) successfulCompetitions += 1;
      printSummary({
        mode: args.flags.has("dry-run") ? "dry-run" : mode,
        strategy: args.flags.has("incremental") ? "incremental" : "standard",
        sourceUrl: result.sourceUrl,
        auditFile: path,
        operationRunId: result.operationRunId,
        parseCounts: result.result.parseCounts,
        refreshedShrinkingPlayByPlayUrls: result.refreshedShrinkingPlayByPlayUrls,
        audit: result.audit,
        maintenance: result.maintenance,
        imported: result.imported,
        liveStats: result.liveStats,
        analysis: result.analysis,
        elapsedMs: result.elapsedMs,
        timings: result.timings
      });
    } catch (error) {
      process.stderr.write(`Kompetisi ${id}: ${safeError(error)}\n${operationFailureAuditMessage(error)}`);
      if (mode === "once") process.exitCode = 1;
    }
  }
  return { operationRunIds, succeeded: successfulCompetitions === competitions.length };
}

function operationFailureAuditMessage(error: unknown): string {
  if (!(error instanceof SyncOperationError)) return "";
  if (error.auditPath) return `Audit: ${error.auditPath}\n`;
  return `Audit gagal disimpan: ${error.auditWriteError ?? "penyimpanan tidak tersedia"}\n`;
}

async function persistNextRunSchedule(operationRunIds: string[], nextRunAt: Date): Promise<void> {
  if (operationRunIds.length === 0 || !process.env["DATABASE_URL"]) return;
  const connection = createDatabase();
  try {
    await connection.db.update(syncRuns).set({ nextRunAt }).where(inArray(syncRuns.id, operationRunIds));
  } finally { await connection.close(); }
}

async function runRunner(args: ParsedArgs): Promise<void> {
  const kind = args.positional[0];
  if (kind !== "once" && kind !== "watch" && kind !== "service") throw new Error("Gunakan runner once, watch, atau service.");
  const intervalSeconds = parseSyncIntervalSeconds(
    args.values.get("interval-seconds") ?? process.env["STATSARENA_SYNC_INTERVAL_SECONDS"]
  );
  if (kind === "once") {
    await runConfiguredCycle(args, "once", null);
    return;
  }
  if (kind === "service") {
    if (args.flags.has("incremental") || args.flags.has("refresh") || args.values.has("match-limit") || args.values.get("audit-mode") === "archive") {
      throw new Error("Runner service memilih strategi otomatis; jangan memakai incremental, refresh, match-limit, atau archive.");
    }
    if (!args.flags.has("dry-run") && !process.env["DATABASE_URL"]) throw new Error("Runner service memerlukan DATABASE_URL StatsArena.");
    if (args.flags.has("snapshot-only") && !args.flags.has("dry-run")) throw new Error("Service snapshot-only harus memakai dry-run.");
  }
  const controller = new AbortController();
  const stop = (signal: NodeJS.Signals) => {
    process.stdout.write(`Menerima ${signal}; kompetisi yang sedang berjalan akan diselesaikan, lalu proses berhenti.\n`);
    controller.abort();
  };
  const onInterrupt = () => stop("SIGINT");
  const onTerminate = () => stop("SIGTERM");
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onTerminate);
  try {
    if (kind === "service") {
      await runRunnerService({ snapshotDirectory: snapshotPath(args.values.get("snapshot-dir")),
        intervalSeconds, fullSyncIntervalSeconds: parseFullSyncInterval(args.values.get("full-sync-interval-seconds") ?? process.env["STATSARENA_FULL_SYNC_INTERVAL_SECONDS"]),
        signal: controller.signal, dryRun: args.flags.has("dry-run"), snapshotOnly: args.flags.has("snapshot-only"),
        log: message => process.stdout.write(`${message}\n`),
        runCycle: async (strategy, nextRunAt) => {
          const flags = new Set(args.flags);
          if (strategy === "incremental") flags.add("incremental");
          const result = await runConfiguredCycle({ ...args, flags }, "periodic", nextRunAt, controller.signal);
          await persistNextRunSchedule(result.operationRunIds, new Date(Date.now() + intervalSeconds * 1000));
          return result.succeeded;
        }
      });
      return;
    }
    await runPeriodicCycles(controller.signal, intervalSeconds * 1_000, async () => {
      const nextRunAt = new Date(Date.now() + intervalSeconds * 1_000);
      const result = await runConfiguredCycle(args, "periodic", nextRunAt, controller.signal);
      await persistNextRunSchedule(result.operationRunIds, new Date(Date.now() + intervalSeconds * 1_000));
    });
  } finally {
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGTERM", onTerminate);
  }
}

async function runSnapshotRead(args: ParsedArgs): Promise<void> {
  const input = validateSourceUrl(requiredValue(args, "url")).href;
  const fetcher = new HtmlFetcher({ snapshotStore: snapshotStore(args.values.get("snapshot-dir")) });
  const result = await fetcher.readSnapshot(input);
  let output: string | null = null;
  if (args.values.has("output")) {
    const path = safeWorkspacePath(requiredValue(args, "output"), "ingest/audit");
    if (!path.endsWith(".html")) throw new Error("Output snapshot hasil baca harus berakhiran .html.");
    await mkdir(resolve(path, ".."), { recursive: true });
    await writeFile(path, result.html, { flag: "w" });
    output = path;
  }
  printSummary({ metadata: result.metadata, htmlCharacters: result.html.length, output });
}

async function runLiveStats(args: ParsedArgs): Promise<void> {
  const mode = args.positional[0];
  if (mode !== "sync" && mode !== "backfill") throw new Error("Gunakan livestats sync atau livestats backfill.");
  if (args.flags.has("snapshot-only")) throw new Error("LiveStats memakai snapshot terpisah; snapshot-only belum tersedia.");
  const requested = args.values.get("competition");
  const gameId = args.values.get("game");
  if (gameId && (!/^[1-9]\d*$/.test(gameId) || !requested)) throw new Error("--game memerlukan ID laga valid dan --competition.");
  if (mode === "sync" && !requested) throw new Error("livestats sync memerlukan --competition.");
  const connection = createDatabase();
  const summaries: unknown[] = [];
  const startedAt = Date.now();
  try {
    // Existing database competitions only; never activate/import a catalog entry.
    const known = await connection.db.select({ sourceUrl: competitions.sourceUrl, source: competitions.source }).from(competitions);
    const inputs = requested ? [competitionReference(requested).url] : known.map(c => {
      const reference = competitionReference(c.sourceUrl);
      if (reference.source !== c.source) throw new Error("Target bukan namespace StatsArena yang diharapkan.");
      return reference.url;
    });
    for (const input of inputs) {
      const key = competitionReference(input).key;
      const directory = snapshotPath(args.values.get("snapshot-dir"));
      const summary = await withSnapshotLocks(key, directory, async () => {
        const lease = args.flags.has("dry-run") ? null : await acquireSyncLease(connection.db, key);
        let heartbeatError: unknown = null;
        let busy = false;
        const timer = lease ? setInterval(() => {
          if (busy) return; busy = true;
          void lease.heartbeat().catch(error => { heartbeatError = error; }).finally(() => { busy = false; });
        }, 20_000) : null;
        try {
          return await syncLiveStatsCompetition(connection.db, input, resolve(directory, "livestats"), {
            catalog: catalogOptions(directory),
            dryRun: args.flags.has("dry-run"), forceRefresh: args.flags.has("refresh"),
            ...(gameId ? { gameIds: new Set([gameId]) } : {}),
            ...(matchLimit(args) !== undefined ? { matchLimit: matchLimit(args)! } : {}),
            guard: async tx => {
              if (heartbeatError) throw heartbeatError;
              if (!lease) throw new Error("Lease LiveStats tidak tersedia.");
              if (tx) await lease.guardTransaction(tx); else await lease.assertOwned();
            },
            log: message => process.stderr.write(`${message}\n`)
          });
        } finally { if (timer) clearInterval(timer); if (lease) await lease.release(); }
      }).catch(async (error: unknown) => {
        const report = auditPath(undefined, `${key}-livestats-failed-${timestampSlug()}.json`);
        await mkdir(resolve(report, ".."), { recursive: true });
        await writeFile(report, `${JSON.stringify({ mode: "failed", createdAt: new Date().toISOString(), sourceUrl: input,
          liveStats: error instanceof LiveStatsSyncError ? error.result : null, error: safeError(error) }, null, 2)}\n`);
        throw error;
      });
      summaries.push(summary);
      const report = auditPath(undefined, `${key}-livestats-${timestampSlug()}.json`);
      await mkdir(resolve(report, ".."), { recursive: true });
      await writeFile(report, `${JSON.stringify({ mode: args.flags.has("dry-run") ? "dry-run" : "livestats", createdAt: new Date().toISOString(), summary }, null, 2)}\n`);
      printSummary({ ...summary, audit: report });
    }
    printSummary({ mode: `livestats ${mode}`, competitions: summaries.length, elapsedMs: Date.now() - startedAt });
  } finally { await connection.close(); }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.flags.has("refresh") && args.flags.has("snapshot-only")) throw new Error("--refresh tidak dapat digabung dengan --snapshot-only.");
  if (args.flags.has("incremental") && (args.flags.has("refresh") || args.flags.has("snapshot-only"))) throw new Error("--incremental tidak dapat digabung dengan --refresh atau --snapshot-only.");
  if (args.flags.has("incremental") && !["sync", "runner", "retry"].includes(args.command)) throw new Error("--incremental hanya untuk sync, runner, atau retry.");
  if (args.flags.has("help") || args.command === "help" || args.command === "--help") {
    showHelp();
    return;
  }
  if (args.command === "catalog") {
    if (args.positional[0] !== "rebuild") throw new Error("Gunakan catalog rebuild.");
    printSummary(await rebuildCompetitionCatalog(catalogOptions(snapshotPath(args.values.get("snapshot-dir"))), safeWorkspacePath(defaultAuditDir, "ingest/audit")));
    return;
  }
  if (args.command === "quality") {
    if (args.positional[0] !== "backfill") throw new Error("Gunakan quality backfill [--dry-run].");
    const connection = createDatabase();
    try { printSummary(await backfillDetailQuality(connection.db, args.flags.has("dry-run"))); }
    finally { await connection.close(); }
    return;
  }
  if (args.command === "metrics") {
    if (args.positional[0] !== "backfill" || args.flags.has("refresh") || args.flags.has("snapshot-only")) throw new Error("Gunakan metrics backfill [--competition <ref>] [--dry-run]; operasi ini hanya membaca snapshot tersimpan.");
    const directory = snapshotPath(args.values.get("snapshot-dir"));
    const connection = createDatabase();
    try {
      const lock = await acquireDirectoryLock(snapshotLockPath(directory), randomUUID());
      try {
        const result = await backfillPortalMetrics(connection.db, new SnapshotStore(directory), args.flags.has("dry-run"), args.values.get("competition"));
        const path = auditPath(args.values.get("output"), `portal-metrics-backfill-${timestampSlug()}.json`);
        await mkdir(resolve(path, ".."), { recursive: true });
        await writeFile(path, `${JSON.stringify(result, null, 2)}\n`);
        printSummary({ ...result, observations: result.observations.length, issueUpdates: result.issueUpdates.length, audit: path });
      } finally { await lock.release(); }
    } finally { await connection.close(); }
    return;
  }
  if (args.command === "storage") return runStorageMaintenance(args);
  if (args.command === "analysis") {
    if (args.positional[0] !== "export" || args.flags.has("refresh") || args.flags.has("incremental") || args.flags.has("snapshot-only")) throw new Error("Gunakan analysis export --competition <ref> [--audit <file>] [--dry-run]; operasi ini offline.");
    const input = requiredValue(args, "competition");
    const directory = safeWorkspacePath(defaultAuditDir, "ingest/audit");
    const selectedAudit = args.values.get("audit");
    const result = await exportAnalysis({ input, auditDirectory: directory, dryRun: args.flags.has("dry-run"),
      ...(selectedAudit ? { auditPath: auditPath(selectedAudit, "unused.json") } : {}) });
    if (!result.dryRun) await updateAnalysisCatalog(catalogOptions(snapshotPath(args.values.get("snapshot-dir"))), result.path);
    printSummary(result);
    return;
  }
  if (args.command === "livestats") return runLiveStats(args);
  if (args.command === "discover") return runDiscover(args);
  if (args.command === "sync") return runSyncOperation(requiredValue(args, "competition"), args, { mode: "once" });
  if (args.command === "retry") return runRetry(args);
  if (args.command === "runner") return runRunner(args);
  if (args.command === "snapshot") {
    if (args.positional[0] !== "read") throw new Error("Gunakan 'snapshot read --url <page URL>'.");
    return runSnapshotRead(args);
  }
  throw new Error(`Perintah tidak dikenal: ${args.command}`);
}

main().catch(async (error: unknown) => {
  const message = safeError(error);
  if (error instanceof SyncOperationError) {
    process.stderr.write(`${message}\n${operationFailureAuditMessage(error)}`);
  } else if (error instanceof PipelineError) {
    const path = auditPath(undefined, `${sourceIdFromInput(error.sourceUrl)}-failed-${timestampSlug()}.json`);
    await mkdir(resolve(path, ".."), { recursive: true });
    await writeFile(path, `${JSON.stringify({
      mode: "failed",
      sourceUrl: error.sourceUrl,
      parserVersion: PARSER_VERSION,
      createdAt: new Date().toISOString(),
      fetches: error.fetches,
      issues: error.issues,
      error: message
    }, null, 2)}\n`);
    process.stderr.write(`${message}\nAudit: ${path}\n`);
  } else {
    process.stderr.write(`${message}\n`);
  }
  process.exitCode = 1;
});
