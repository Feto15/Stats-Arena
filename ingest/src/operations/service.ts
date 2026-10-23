import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { acquireDirectoryLock } from "./locks.js";
import { abortableWait } from "./runner.js";
import { safeError } from "./errors.js";

const stateSchema = z.object({
  version: z.literal(1),
  heartbeatAt: z.iso.datetime(),
  phase: z.enum(["running", "waiting", "stopped"]),
  strategy: z.enum(["standard", "incremental"]),
  lastFullCompletedAt: z.iso.datetime().nullable(),
  lastCycleStartedAt: z.iso.datetime().nullable(),
  lastCycleFinishedAt: z.iso.datetime().nullable(),
  lastCycleStatus: z.enum(["succeeded", "partial", "failed"]).nullable(),
  nextCycleAt: z.iso.datetime().nullable()
}).strict();

export type RunnerServiceState = z.infer<typeof stateSchema>;
export const SERVICE_STATE_FILE = ".runner-service.json";

export function parseFullSyncInterval(value: string | undefined): number {
  const seconds = value === undefined || value.trim() === "" ? 86400 : Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < 900 || seconds > 604800) {
    throw new Error("Interval pemeriksaan penuh harus bilangan bulat 900–604800 detik.");
  }
  return seconds;
}

export async function readServiceState(directory: string): Promise<RunnerServiceState | null> {
  const path = join(directory, SERVICE_STATE_FILE);
  try {
    if ((await stat(path)).size > 65536) throw new Error("Checkpoint runner terlalu besar.");
    return stateSchema.parse(JSON.parse(await readFile(path, "utf8")) as unknown);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw new Error("Checkpoint runner tidak valid; periksa file sebelum melanjutkan.", { cause: error });
  }
}

export interface RunnerServiceOptions {
  snapshotDirectory: string;
  intervalSeconds: number;
  fullSyncIntervalSeconds: number;
  signal: AbortSignal;
  dryRun?: boolean;
  snapshotOnly?: boolean;
  runCycle: (strategy: "standard" | "incremental", nextRunAt: Date) => Promise<boolean>;
  log: (message: string) => void;
  clock?: () => number;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** Persistent service policy; existing per-competition leases still guard every import. */
export async function runRunnerService(options: RunnerServiceOptions): Promise<void> {
  if (!Number.isSafeInteger(options.intervalSeconds) || options.intervalSeconds < 30 || options.intervalSeconds > 86400) throw new Error("Interval runner tidak valid.");
  parseFullSyncInterval(String(options.fullSyncIntervalSeconds));
  if (options.snapshotOnly && !options.dryRun) throw new Error("Service snapshot-only harus memakai dry-run.");
  const clock = options.clock ?? Date.now;
  const wait = options.wait ?? abortableWait;
  await mkdir(options.snapshotDirectory, { recursive: true });
  const lock = await acquireDirectoryLock(join(options.snapshotDirectory, ".runner-service.lock"), randomUUID());
  let state: RunnerServiceState | null = null;
  let heartbeat: NodeJS.Timeout | null = null;
  let pending: Promise<void> = Promise.resolve();
  let storageError: unknown = null;
  const timestamp = () => new Date(clock()).toISOString();
  async function publish() {
    if (storageError) throw storageError;
    if (!state) return;
    const snapshot = { ...state, heartbeatAt: timestamp() };
    state.heartbeatAt = snapshot.heartbeatAt;
    pending = pending.then(async () => {
      await lock.heartbeat();
      const path = join(options.snapshotDirectory, SERVICE_STATE_FILE);
      const temporary = `${path}.${lock.ownerId}.tmp`;
      await writeFile(temporary, `${JSON.stringify(snapshot)}\n`, { mode: 0o600 });
      await lock.assertOwned();
      await rename(temporary, path);
    }).catch((error: unknown) => { storageError = error; });
    await pending;
    if (storageError) throw storageError;
  }
  try {
    const previous = await readServiceState(options.snapshotDirectory);
    const lastFull = previous?.lastFullCompletedAt ?? null;
    if (lastFull && Date.parse(lastFull) > clock()) throw new Error("Waktu checkpoint runner berada di masa depan.");
    state = { version: 1, heartbeatAt: timestamp(), phase: "waiting", strategy: "standard", lastFullCompletedAt: lastFull,
      lastCycleStartedAt: previous?.lastCycleStartedAt ?? null, lastCycleFinishedAt: previous?.lastCycleFinishedAt ?? null,
      lastCycleStatus: previous?.lastCycleStatus ?? null, nextCycleAt: null };
    await publish();
    heartbeat = setInterval(() => { void publish().catch(() => undefined); }, 30000);
    heartbeat.unref();
    while (!options.signal.aborted) {
      if (storageError) throw storageError;
      const fullDue: boolean = state.lastFullCompletedAt === null || clock() - Date.parse(state.lastFullCompletedAt) >= options.fullSyncIntervalSeconds * 1000;
      const strategy: "standard" | "incremental" = options.snapshotOnly || fullDue ? "standard" : "incremental";
      state = { ...state, phase: "running", strategy, lastCycleStartedAt: timestamp(), nextCycleAt: null };
      await publish();
      options.log(`Runner mulai siklus ${strategy}.`);
      try {
        const succeeded = await options.runCycle(strategy, new Date(clock() + options.intervalSeconds * 1000));
        state.lastCycleStatus = succeeded ? "succeeded" : "partial";
        if (strategy === "standard" && succeeded && !options.signal.aborted && !options.dryRun) state.lastFullCompletedAt = timestamp();
      } catch (error) {
        state.lastCycleStatus = "failed";
        options.log(`Siklus gagal; dicoba kembali setelah interval: ${safeError(error)}`);
      }
      state.lastCycleFinishedAt = timestamp();
      state.phase = options.signal.aborted ? "stopped" : "waiting";
      state.nextCycleAt = options.signal.aborted ? null : new Date(clock() + options.intervalSeconds * 1000).toISOString();
      await publish();
      if (!options.signal.aborted) await wait(options.intervalSeconds * 1000, options.signal);
    }
    state.phase = "stopped"; state.nextCycleAt = null;
    await publish();
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    await pending;
    await lock.release();
  }
}

export function serviceIsHealthy(state: RunnerServiceState | null, now = Date.now()): boolean {
  if (!state || state.phase === "stopped") return false;
  const age = now - Date.parse(state.heartbeatAt);
  return age >= -5000 && age <= 120000;
}
