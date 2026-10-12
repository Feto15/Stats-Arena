import { loadProjectEnv } from "@statsarena/db/env";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { createDatabase } from "@statsarena/db";
import { syncRuns } from "@statsarena/db/schema";
import { PARSER_VERSION } from "./domain/types.js";
import { competitionUrl, sourceEntityId, validateSourceUrl } from "./domain/source-url.js";
import { HtmlFetcher } from "./fetch/fetcher.js";
import { SnapshotStore } from "./fetch/snapshots.js";
import { PipelineError, discoverCompetition } from "./pipeline.js";
import { parseSyncIntervalSeconds, readCompetitionConfig } from "./operations/config.js";
import { acquireDirectoryLock, competitionLockPath, snapshotLockPath } from "./operations/locks.js";
import { runCompetitionSync, runPeriodicCycles, type OperationalMode } from "./operations/runner.js";
import { targetedRetryUrls } from "./operations/targeted-retry.js";
import { safeError, SyncOperationError } from "./operations/errors.js";

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
    `  retry --competition <URL|ID> [--audit <file>] [--dry-run] [--incremental] [--snapshot-dir <path>]\n` +
    `  snapshot read --url <page URL> [--snapshot-dir <path>] [--output <file>]\n\n` +
    `--dry-run hanya menyimpan audit JSON lokal, tanpa menulis data aplikasi/operasional ke Neon.\n` +
    `--snapshot-only membaca HTML terkompresi lokal dan tidak mengakses jaringan.\n` +
    `--refresh melewati TTL cache untuk seluruh halaman yang diperlukan.\n` +
    `--incremental membaca state Neon dan menyegarkan fixture; hanya memproses laga baru/berubah/live/unknown/belum valid atau gagal.\n` +
    `--incremental --dry-run membaca Neon tanpa menulis database; tidak dapat digabung dengan --refresh atau --snapshot-only.\n` +
    `retry memaksa refresh hanya halaman gagal/parsial dari audit; maksimal 25 URL per perintah.\n` +
    `runner watch menyelesaikan satu siklus penuh, menunggu interval, lalu mengulang sampai SIGINT/SIGTERM.\n` +
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
  return sourceEntityId(competitionUrl(input).href, "competition") ?? "competition";
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
  printSummary({ mode: "discover", auditFile: path, parseCounts: result.parseCounts, issues: result.data.issues.length });
}

function matchLimit(args: ParsedArgs): number | undefined {
  const value = args.values.get("match-limit");
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("--match-limit harus bilangan bulat nol atau lebih.");
  return parsed;
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
    snapshotOnly: args.flags.has("snapshot-only"),
    forceRefresh: args.flags.has("refresh"),
    ...(operation.forceRefreshUrls ? { forceRefreshUrls: operation.forceRefreshUrls } : {}),
    incremental: args.flags.has("incremental"),
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
    imported: result.imported
  });
}

async function readRetryAudit(sourceCompetitionId: string, requestedPath: string | undefined): Promise<unknown> {
  if (requestedPath) return JSON.parse(await readFile(safeWorkspacePath(requestedPath, "ingest/audit"), "utf8")) as unknown;
  const directory = safeWorkspacePath(resolve(rootDir, defaultAuditDir), "ingest/audit");
  const candidates = (await readdir(directory)).filter((name) => name.startsWith(`${sourceCompetitionId}-`) && name.endsWith(".json"));
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
): Promise<string[]> {
  const competitions = await readCompetitionConfig(configPath(args.values.get("config")));
  if (competitions.length === 0) throw new Error("Tidak ada kompetisi aktif pada konfigurasi runner.");
  const operationRunIds: string[] = [];
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
        snapshotOnly: args.flags.has("snapshot-only"),
        forceRefresh: args.flags.has("refresh"),
        incremental: args.flags.has("incremental"),
        dryRun: args.flags.has("dry-run"),
        mode,
        nextRunAt
      });
      if (result.operationRunId) operationRunIds.push(result.operationRunId);
      printSummary({
        mode: args.flags.has("dry-run") ? "dry-run" : mode,
        strategy: args.flags.has("incremental") ? "incremental" : "standard",
        sourceUrl: result.sourceUrl,
        auditFile: path,
        operationRunId: result.operationRunId,
        parseCounts: result.result.parseCounts,
        refreshedShrinkingPlayByPlayUrls: result.refreshedShrinkingPlayByPlayUrls,
        imported: result.imported,
        elapsedMs: result.elapsedMs
      });
    } catch (error) {
      process.stderr.write(`Kompetisi ${id}: ${safeError(error)}\n${operationFailureAuditMessage(error)}`);
      if (mode === "once") process.exitCode = 1;
    }
  }
  return operationRunIds;
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
  if (kind !== "once" && kind !== "watch") throw new Error("Gunakan 'runner once' atau 'runner watch'.");
  const intervalSeconds = parseSyncIntervalSeconds(
    args.values.get("interval-seconds") ?? process.env["STATSARENA_SYNC_INTERVAL_SECONDS"]
  );
  if (kind === "once") {
    await runConfiguredCycle(args, "once", null);
    return;
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
    await runPeriodicCycles(controller.signal, intervalSeconds * 1_000, async () => {
      const nextRunAt = new Date(Date.now() + intervalSeconds * 1_000);
      const operationRunIds = await runConfiguredCycle(args, "periodic", nextRunAt, controller.signal);
      await persistNextRunSchedule(operationRunIds, new Date(Date.now() + intervalSeconds * 1_000));
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.flags.has("refresh") && args.flags.has("snapshot-only")) throw new Error("--refresh tidak dapat digabung dengan --snapshot-only.");
  if (args.flags.has("incremental") && (args.flags.has("refresh") || args.flags.has("snapshot-only"))) throw new Error("--incremental tidak dapat digabung dengan --refresh atau --snapshot-only.");
  if (args.flags.has("incremental") && !["sync", "runner", "retry"].includes(args.command)) throw new Error("--incremental hanya untuk sync, runner, atau retry.");
  if (args.flags.has("help") || args.command === "help" || args.command === "--help") {
    showHelp();
    return;
  }
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
