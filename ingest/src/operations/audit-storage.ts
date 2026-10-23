import { competitionReference } from "@statsarena/db/source";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { z } from "zod";
import { validateSourceUrl } from "../domain/source-url.js";
import { SnapshotStore } from "../fetch/snapshots.js";
import { acquireDirectoryLock, snapshotLockPath } from "./locks.js";
import { parsedDataHash } from "../domain/content-hash.js";
export { parsedDataHash } from "../domain/content-hash.js";

export type AuditPolicy = "auto" | "full" | "archive";
type JsonObject = Record<string, unknown>;
const HASH = /^[a-f0-9]{64}$/;
const BLOB = /^[a-f0-9]{64}\.html\.gz$/;
const MAX_JSON_BYTES = 128 * 1024 * 1024;
const stateFile = ".audit-storage.json";
const refSchema = z.object({ hash: z.string().regex(HASH), file: z.string().regex(/^[^/\\]+\.json$/) });
const stateSchema = z.object({
  version: z.literal(1),
  datasets: z.record(z.string(), z.array(refSchema).max(2)),
  lastMaintenanceAt: z.string().nullable(),
});
type StorageState = z.infer<typeof stateSchema>;

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
async function readJson(path: string): Promise<unknown> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_JSON_BYTES) throw new Error("File penyimpanan harus berupa JSON biasa dalam batas ukuran.");
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}
async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  try { if ((await lstat(path)).isSymbolicLink()) throw new Error("File penyimpanan tidak boleh symlink."); }
  catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, `${JSON.stringify(value)}\n`, { flag: "wx" }); await rename(temporary, path); }
  finally { await unlink(temporary).catch(() => undefined); }
}
async function loadState(directory: string): Promise<StorageState> {
  try { return stateSchema.parse(await readJson(join(directory, stateFile))); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { version: 1, datasets: {}, lastMaintenanceAt: null };
    throw error; // Corrupt state must stop cleanup rather than lose protected versions.
  }
}
function competitionId(audit: JsonObject): string | null {
  const data = object(audit["data"]) ?? object(audit["changedData"]);
  const competition = object(data?.["competition"]);
  const input = audit["sourceUrl"] ?? competition?.["sourceUrl"] ?? audit["sourceCompetitionId"] ?? competition?.["sourceId"];
  if (typeof input !== "string") return null;
  try { return competitionReference(input).key; } catch { return null; }
}
function datasets(audit: JsonObject): Map<string, unknown> {
  const result = new Map<string, unknown>();
  const id = competitionId(audit);
  const data = object(audit["data"]);
  if (!id) return result;
  const changed = object(audit["changedData"]);
  if (changed) for (const [key, value] of Object.entries(changed)) {
    if (key.startsWith(`${id}:`)) result.set(key, value);
  }
  if (!data) return result;
  for (const key of ["competition", "teams", "players", "groups", "teamOfficialMetrics"]) {
    if (data[key] !== undefined) result.set(`${id}:${key}`, data[key]);
  }
  for (const value of array(data["matches"])) {
    const match = object(value); const fixture = object(match?.["fixture"]);
    if (typeof fixture?.["sourceId"] === "string") result.set(`${id}:match:${fixture["sourceId"]}`, value);
  }
  return result;
}
function hasFailure(audit: JsonObject): boolean {
  const imported = object(audit["imported"]);
  return audit["mode"] === "failed" || Boolean(audit["error"]) ||
    array(object(audit["liveStats"])?.["games"]).some(value => object(value)?.["status"] !== "ready") ||
    (typeof imported?.["status"] === "string" && imported["status"] !== "succeeded") ||
    array(audit["fetches"]).some((value) => {
      const fetch = object(value);
      return fetch?.["fetchStatus"] === "failed" || fetch?.["parseStatus"] === "failed" || fetch?.["parseStatus"] === "partial";
    }) || array(audit["issues"]).some((value) => object(value)?.["severity"] === "error");
}
function committed(audit: JsonObject): boolean {
  return object(audit["imported"])?.["status"] === "succeeded" && !hasFailure(audit);
}
function advanceHashes(state: StorageState, file: string, entries: Map<string, string>): void {
  for (const [key, hash] of entries) {
    const previous = state.datasets[key] ?? [];
    if (previous[0]?.hash === hash) { previous[0].file = file; continue; }
    state.datasets[key] = [{ hash, file }, ...previous.filter((entry) => entry.hash !== hash)].slice(0, 2);
  }
}
function hashes(audit: JsonObject): string[] {
  return [...new Set(array(audit["fetches"]).flatMap((value) => {
    const hash = object(value)?.["sha256"];
    return typeof hash === "string" && HASH.test(hash) ? [hash] : [];
  }))];
}
function references(audit: JsonObject): JsonObject[] {
  return array(audit["fetches"]).flatMap((value) => {
    const fetch = object(value); if (!fetch) return [];
    return [{ requestUrl: fetch["requestUrl"], sha256: fetch["sha256"], parseStatus: fetch["parseStatus"], fetchStatus: fetch["fetchStatus"], sourceFetchedAt: fetch["sourceFetchedAt"] ?? fetch["fetchedAt"] }];
  });
}
function summary(audit: JsonObject, reason: string, datasetHashes: Map<string, string>): JsonObject {
  const metadata = { ...audit };
  delete metadata["data"]; delete metadata["changedData"];
  return { ...metadata, auditVersion: 1, auditType: "summary", payloadStatus: "expired", retentionReason: reason,
    datasetHashes: Object.fromEntries(datasetHashes),
    snapshotReferences: references(audit),
    // Histori hash/fetch/isu tetap tersedia; summary bukan payload importer.
    data: null };
}

export interface AuditWriteResult { auditType: "full" | "delta" | "summary" | "archive"; changedDatasets: number }
/** Caller holds the snapshot lock. State advances only after the audit is durable and import committed. */
export async function writeOperationAudit(path: string, audit: JsonObject, policy: AuditPolicy = "full"): Promise<AuditWriteResult> {
  const directory = dirname(resolve(path));
  const lock = await acquireDirectoryLock(join(directory, ".audit-storage.lock"), randomUUID());
  try {
    const state = await loadState(directory); const entries = datasets(audit);
    let movedReferences = false;
    if (Object.values(state.datasets).some((refs) => refs.some((ref) => ref.file === basename(path)))) {
      const previous = object(await readJson(resolve(path)));
      if (!previous) throw new Error("Audit lama tidak valid; penimpaan dibatalkan.");
      const retainedName = `${basename(path, ".json")}-retained-${randomUUID()}.json`;
      await atomicJson(join(directory, retainedName), previous);
      for (const refs of Object.values(state.datasets)) for (const ref of refs) {
        if (ref.file === basename(path)) ref.file = retainedName;
      }
      movedReferences = true;
      // A fixed output path may be overwritten next; first make its backup references durable.
      await atomicJson(join(directory, stateFile), state);
    }
    const changes = [...entries].filter(([key, value]) => state.datasets[key]?.[0]?.hash !== parsedDataHash(value));
    let auditType: AuditWriteResult["auditType"] = policy === "archive" && !hasFailure(audit) ? "archive" : "full";
    let output: JsonObject = { ...audit, auditVersion: 1, auditType, payloadStatus: "retained" };
    if (policy === "auto" && !hasFailure(audit)) {
      auditType = changes.length === 0 ? "summary" : changes.length === entries.size ? "full" : "delta";
      if (auditType !== "full") {
        const metadata = { ...audit };
        delete metadata["data"];
        output = { ...metadata, auditVersion: 1, auditType, payloadStatus: auditType === "summary" ? "none" : "retained",
          data: null, snapshotReferences: references(audit),
          datasetReferences: Object.fromEntries([...entries].map(([key, value]) => [key, {
            hash: parsedDataHash(value), file: changes.some(([changed]) => changed === key) ? basename(path) : state.datasets[key]?.[0]?.file,
          }])),
          ...(auditType === "delta" ? { changedData: Object.fromEntries(changes) } : {}) };
      }
    }
    output["auditType"] = auditType;
    await atomicJson(resolve(path), output);
    if (committed(audit)) {
      advanceHashes(state, basename(path), new Map((auditType === "summary" ? [] : auditType === "delta" ? changes : [...entries]).map(([key, value]) => [key, parsedDataHash(value)])));
    }
    if (committed(audit) || movedReferences) await atomicJson(join(directory, stateFile), state);
    return { auditType, changedDatasets: changes.length };
  } finally { await lock.release(); }
}

export interface MaintenanceResult {
  dryRun: boolean; auditsCompacted: number; snapshotsDeleted: number;
  auditBytesSaved: number; snapshotBytesSaved: number; protectedSnapshots: number;
  skippedFiles: string[];
}
interface AuditFile { name: string; path: string; bytes: number; audit: JsonObject; time: number; hasPayload: boolean; datasetHashes: Map<string, string> }

/** A plan is fully constructed before mutation. Only immediate regular files are candidates. */
export async function compactStorage(options: {
  auditDirectory: string; snapshotDirectory: string; dryRun?: boolean; pinnedAuditFiles?: readonly string[];
  snapshotLockHeld?: boolean; onlyIfDue?: boolean;
}): Promise<MaintenanceResult> {
  const auditDirectory = resolve(options.auditDirectory); const snapshotDirectory = resolve(options.snapshotDirectory);
  const locks = [] as Awaited<ReturnType<typeof acquireDirectoryLock>>[];
  const result: MaintenanceResult = { dryRun: options.dryRun ?? false, auditsCompacted: 0, snapshotsDeleted: 0, auditBytesSaved: 0, snapshotBytesSaved: 0, protectedSnapshots: 0, skippedFiles: [] };
  try {
    for (const root of [auditDirectory, snapshotDirectory]) {
      const info = await lstat(root);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Direktori penyimpanan tidak boleh symlink.");
    }
    if (!options.snapshotLockHeld) locks.push(await acquireDirectoryLock(snapshotLockPath(snapshotDirectory), randomUUID()));
    locks.push(await acquireDirectoryLock(join(auditDirectory, ".audit-storage.lock"), randomUUID()));
    const state = await loadState(auditDirectory);
    if (options.onlyIfDue && state.lastMaintenanceAt && Date.now() - Date.parse(state.lastMaintenanceAt) < 86400000) return result;
    const files: AuditFile[] = [];
    for (const name of await readdir(auditDirectory)) {
      if (!name.endsWith(".json") || name.startsWith(".")) continue;
      const path = join(auditDirectory, name); const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink()) { result.skippedFiles.push(name); continue; }
      // Fail closed on unreadable/oversized JSON: it might contain a pin.
      const audit = object(await readJson(path));
      if (!audit) { result.skippedFiles.push(name); continue; }
      const parsedTime = typeof audit["createdAt"] === "string" ? Date.parse(audit["createdAt"]) : NaN;
      const id = competitionId(audit);
      const datasetHashes = new Map([...datasets(audit)].map(([key, value]) => [key, parsedDataHash(value)]));
      const hasPayload = Boolean(object(audit["data"]) || object(audit["changedData"]));
      const metadata = { ...audit };
      delete metadata["data"]; delete metadata["changedData"];
      if (id) metadata["sourceCompetitionId"] = id;
      files.push({ name, path, bytes: info.size, audit: metadata, hasPayload, datasetHashes,
        time: Number.isFinite(parsedTime) ? parsedTime : info.mtimeMs });
    }
    files.sort((a, b) => a.time - b.time || a.name.localeCompare(b.name));
    for (const [key, refs] of Object.entries(state.datasets)) for (const ref of refs) {
      if (files.find((file) => file.name === ref.file)?.datasetHashes.get(key) !== ref.hash) {
        throw new Error("Payload audit yang direferensikan hilang atau berbeda; pembersihan dibatalkan.");
      }
    }
    // Bootstrap old full audits once; do not advance from dry-runs, partial runs or summaries.
    state.datasets = {};
    for (const file of files) if (committed(file.audit)) advanceHashes(state, file.name, file.datasetHashes);
    const protectedAudits = new Set(options.pinnedAuditFiles ?? []);
    for (const refs of Object.values(state.datasets)) for (const ref of refs) protectedAudits.add(ref.file);
    const pending = new Map<string, string>();
    const pendingGeneral = new Map<string, string>();
    for (const file of files) {
      if (file.audit["auditType"] === "archive" || file.audit["retention"] === "archive") protectedAudits.add(file.name);
      const id = competitionId(file.audit);
      if (id && committed(file.audit)) pendingGeneral.delete(id);
      if (id && hasFailure(file.audit) && (file.audit["error"] || array(file.audit["fetches"]).length === 0)) pendingGeneral.set(id, file.name);
      for (const value of array(file.audit["fetches"])) {
        const fetch = object(value); const url = fetch?.["requestUrl"];
        if (typeof url !== "string") continue;
        let normalized: string; try { normalized = validateSourceUrl(url).href; } catch { continue; }
        if (fetch?.["fetchStatus"] === "failed" || fetch?.["parseStatus"] === "failed" || fetch?.["parseStatus"] === "partial") pending.set(normalized, file.name);
        else if (committed(file.audit)) pending.delete(normalized);
      }
      for (const value of array(file.audit["issues"])) {
        const entry = object(value); const url = entry?.["sourceUrl"];
        if (entry?.["severity"] === "error" && typeof url === "string") {
          try { pending.set(validateSourceUrl(url).href, file.name); } catch { protectedAudits.add(file.name); }
        } else if (entry?.["severity"] === "error") protectedAudits.add(file.name);
      }
    }
    for (const name of pending.values()) protectedAudits.add(name);
    for (const name of pendingGeneral.values()) protectedAudits.add(name);
    const protectedHashes = new Set<string>();
    const snapshotIndex = object(await readJson(join(snapshotDirectory, "index.json")));
    if (!snapshotIndex) throw new Error("Indeks snapshot tidak valid; pembersihan dibatalkan.");
    const snapshotStore = new SnapshotStore(snapshotDirectory);
    for (const [url, value] of Object.entries(snapshotIndex)) {
      const entry = object(value);
      validateSourceUrl(url);
      if (typeof entry?.["sha256"] !== "string" || !HASH.test(entry["sha256"]) || entry["path"] !== `${entry["sha256"]}.html.gz`) throw new Error("Referensi snapshot tidak valid; pembersihan dibatalkan.");
      const path = join(snapshotDirectory, entry["path"] as string);
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("Snapshot aktif bukan file biasa; pembersihan dibatalkan.");
      await snapshotStore.read(url);
      protectedHashes.add(entry["sha256"]);
    }
    // Retain two distinct successfully committed HTML versions per URL, even
    // when a new hash only changed navigation and the parsed data stayed equal.
    const versions = new Map<string, string[]>();
    for (const file of files) {
      if (committed(file.audit)) for (const value of array(file.audit["fetches"])) {
        const fetch = object(value); const url = fetch?.["requestUrl"]; const hash = fetch?.["sha256"];
        if (typeof url !== "string" || typeof hash !== "string" || !HASH.test(hash) || fetch?.["parseStatus"] !== "parsed") continue;
        const previous = versions.get(url) ?? [];
        if (previous[0] !== hash) versions.set(url, [hash, ...previous.filter((entry) => entry !== hash)].slice(0, 2));
      }
      if (protectedAudits.has(file.name) || !competitionId(file.audit)) for (const hash of hashes(file.audit)) protectedHashes.add(hash);
    }
    for (const refs of versions.values()) for (const hash of refs) protectedHashes.add(hash);
    const rewrites: Array<{ file: AuditFile; output: JsonObject }> = [];
    for (const file of files) {
      if (protectedAudits.has(file.name) || !competitionId(file.audit) || file.audit["payloadStatus"] === "expired" || !file.hasPayload) continue;
      const output = summary(file.audit, "superseded-valid-data", file.datasetHashes);
      rewrites.push({ file, output });
      result.auditsCompacted++;
      result.auditBytesSaved += Math.max(0, file.bytes - Buffer.byteLength(`${JSON.stringify(output)}\n`));
    }
    const deletions: Array<{ path: string; bytes: number }> = [];
    for (const name of await readdir(snapshotDirectory)) {
      if (!BLOB.test(name) || protectedHashes.has(name.slice(0, 64))) continue;
      const path = join(snapshotDirectory, name); const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink()) { result.skippedFiles.push(name); continue; }
      deletions.push({ path, bytes: info.size });
      result.snapshotsDeleted++; result.snapshotBytesSaved += info.size;
    }
    result.protectedSnapshots = protectedHashes.size;
    if (!options.dryRun) {
      for (const lock of locks) await lock.assertOwned();
      // Persist the catalogue before removing payloads; interruption only leaves extra files.
      state.lastMaintenanceAt = new Date().toISOString();
      await atomicJson(join(auditDirectory, stateFile), state);
      for (const { file, output } of rewrites) await atomicJson(file.path, output);
      for (const { path } of deletions) await unlink(path);
    }
    return result;
  } finally { for (const lock of locks.reverse()) await lock.release(); }
}
