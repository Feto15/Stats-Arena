import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { competitionReference } from "../domain/source-url.js";
import { acquireDirectoryLock, LockBusyError } from "./locks.js";
import { findLiveStatsFiles, scanLiveStatsFiles, type LiveStatsCatalogFiles } from "../livestats/catalog.js";

export interface CatalogOptions {
  path: string;
  projectRoot: string;
  snapshotDirectory: string;
}

const entrySchema = z.object({ id: z.string(), name: z.string(), sourceUrl: z.string() }).passthrough();
const catalogSchema = z.object({ version: z.literal(1), competitions: z.array(entrySchema) }).passthrough();
const auditSchema = z.object({
  sourceUrl: z.string(), createdAt: z.iso.datetime(), mode: z.string(),
  parserVersion: z.string().optional(), auditType: z.string().optional(),
  payloadStatus: z.string().optional(), strategy: z.string().optional(),
  parseCounts: z.record(z.string(), z.number()).optional(),
  imported: z.object({ status: z.string() }).nullable().optional(),
});
const competitionSchema = z.object({
  name: z.string().min(1), season: z.string().nullable().optional(), year: z.number().nullable().optional(),
});
type CatalogEntry = z.infer<typeof entrySchema>;
type Observation = { audit: z.infer<typeof auditSchema>; competition: z.infer<typeof competitionSchema> | null; hasFullData: boolean; path: string };

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
async function readJson(path: string, maxBytes: number): Promise<unknown> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes) throw new Error(`File katalog/audit tidak valid: ${path}`);
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}
async function observe(path: string): Promise<Observation | null> {
  const value = object(await readJson(path, 256 * 1024 * 1024));
  if (!value) return null;
  const data = object(value["data"]);
  const competition = object(data?.["competition"]);
  const parsed = auditSchema.safeParse({ ...value, sourceUrl: value["sourceUrl"] ?? competition?.["sourceUrl"] });
  if (!parsed.success) return null; // Other maintenance/LiveStats reports are not portal competition audits.
  let reference: ReturnType<typeof competitionReference>;
  try { reference = competitionReference(parsed.data.sourceUrl); } catch { return null; }
  const changed = object(value["changedData"]);
  const metadata = competitionSchema.safeParse(competition ?? changed?.[`${reference.key}:competition`]);
  return { audit: parsed.data, competition: metadata.success ? metadata.data : null, hasFullData: data !== null, path };
}
function portablePath(root: string, path: string): string {
  return relative(resolve(root), resolve(path)).split(sep).join("/");
}
function applyObservation(entries: Map<string, CatalogEntry>, observation: Observation, options: CatalogOptions): void {
  const { audit, competition, path } = observation;
  const reference = competitionReference(audit.sourceUrl);
  const previous = entries.get(reference.key);
  if (!previous && !competition) return; // A failed fetch cannot establish a competition's name.
  const auditPath = portablePath(options.projectRoot, path);
  const lastSuccessfulAt = previous?.["latestSuccessfulImportAt"];
  const success = audit.imported?.status === "succeeded" && audit.mode !== "failed";
  const successful = success && (typeof lastSuccessfulAt !== "string" || audit.createdAt >= lastSuccessfulAt)
    ? { latestSuccessfulImportAt: audit.createdAt, latestSuccessfulAuditPath: auditPath } : {};
  const previousAt = previous?.["latestAuditCreatedAt"];
  if (typeof previousAt === "string" && audit.createdAt < previousAt) {
    if (previous) entries.set(reference.key, { ...previous, ...successful });
    return;
  }
  const name = competition?.name ?? previous?.name;
  if (!name) return;
  const gender = /^\(([MF])\)\s*/.exec(name)?.[1];
  const auditDirectory = dirname(path);
  entries.set(reference.key, {
    ...previous,
    id: reference.id, key: reference.key, namespace: reference.namespace, name, sourceUrl: reference.url,
    ...(competition ? { season: competition.season ?? null, year: competition.year ?? null,
      series: name.replace(/^\([MF]\)\s*/, "") } : {}),
    ...(gender ? { gender, genderLabel: gender === "M" ? "Putra" : "Putri" } : {}),
    region: previous?.["region"] ?? null,
    latestAuditFile: basename(path), latestAuditPath: auditPath,
    latestAuditCreatedAt: audit.createdAt, latestAuditMode: audit.mode,
    latestAuditType: audit.auditType ?? "full",
    latestAuditHasFullData: observation.hasFullData && (audit.auditType === undefined || ["full", "archive"].includes(audit.auditType)) && audit.payloadStatus !== "expired",
    latestImportStatus: audit.imported?.status ?? null,
    parserVersion: audit.parserVersion ?? null,
    latestParseCounts: audit.parseCounts ?? {},
    latestParseCountsScope: "latest-cycle",
    ...successful,
    dataLocations: {
      auditDirectory: portablePath(options.projectRoot, auditDirectory),
      datasetIndexFile: portablePath(options.projectRoot, join(auditDirectory, ".audit-storage.json")),
      snapshotDirectory: portablePath(options.projectRoot, options.snapshotDirectory),
      snapshotIndexFile: portablePath(options.projectRoot, join(options.snapshotDirectory, "index.json")),
      liveStatsSnapshotDirectory: portablePath(options.projectRoot, join(options.snapshotDirectory, "livestats")),
    },
  });
}

async function writeCatalog(options: CatalogOptions, observations: Observation[], liveStats: LiveStatsCatalogFiles[] = [], replaceLiveStats = false, analysisPaths: string[] = []): Promise<number> {
  await mkdir(dirname(options.path), { recursive: true });
  // A separate short-lived lock also covers simultaneous syncs using different snapshot directories.
  const deadline = Date.now() + 10_000;
  const lock = await (async () => {
    for (;;) {
      try { return await acquireDirectoryLock(`${options.path}.lock`, randomUUID()); }
      catch (error) { if (!(error instanceof LockBusyError) || Date.now() >= deadline) throw error; await delay(25); }
    }
  })();
  const temporary = `${options.path}.${randomUUID()}.tmp`;
  try {
    let catalog: z.infer<typeof catalogSchema> = { version: 1, competitions: [] };
    try { catalog = catalogSchema.parse(await readJson(options.path, 8 * 1024 * 1024)); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
    const entries = new Map<string, CatalogEntry>();
    for (const entry of catalog.competitions) {
      const key = competitionReference(entry.sourceUrl).key;
      if (entries.has(key)) throw new Error(`Kompetisi katalog duplikat: ${key}`);
      entries.set(key, entry);
    }
    for (const observation of observations.sort((a, b) => a.audit.createdAt.localeCompare(b.audit.createdAt))) {
      applyObservation(entries, observation, options);
      const key = competitionReference(observation.audit.sourceUrl).key;
      analysisPaths.push(join(dirname(observation.path), "analysis", `${key.replace(":", "-")}.json`));
    }
    for (const analysisPath of new Set(analysisPaths)) {
      try {
        const analysis = object(await readJson(analysisPath, 128 * 1024 * 1024));
        const competition = object(analysis?.["competition"]);
        if (analysis?.["format"] !== "statsarena-analysis" || typeof competition?.["sourceUrl"] !== "string" || typeof competition["name"] !== "string") continue;
        const reference = competitionReference(competition["sourceUrl"]);
        if (basename(analysisPath) !== `${reference.key.replace(":", "-")}.json`) continue;
        const entry = entries.get(reference.key) ?? { id: reference.id, sourceUrl: reference.url, name: competition["name"] };
        entry["analysisFile"] = portablePath(options.projectRoot, analysisPath);
        entries.set(reference.key, entry);
      } catch { /* A missing derived file does not invalidate the source catalog. */ }
    }
    if (replaceLiveStats) for (const entry of entries.values()) entry["liveStatsFiles"] = {};
    for (const update of liveStats) {
      const reference = competitionReference(update.sourceUrl);
      const key = reference.key;
      const entry = entries.get(key) ?? (update.name ? { id: reference.id, name: update.name, sourceUrl: reference.url } : null);
      if (!entry) continue;
      entries.set(key, entry);
      const files = { ...object(entry["liveStatsFiles"]) };
      for (const [id, path] of Object.entries(update.files)) {
        if (path) files[id] = portablePath(options.projectRoot, path);
        else delete files[id];
      }
      entry["liveStatsFiles"] = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
    }
    // Keep the human-facing catalog small; detailed counts/provenance remain in the audits.
    const competitions = [...entries.values()].sort((a, b) => competitionReference(a.sourceUrl).key.localeCompare(competitionReference(b.sourceUrl).key))
      .map(entry => {
        const compact = { ...entry };
        for (const key of ["key", "namespace", "season", "year", "latestAuditPath", "latestAuditHasFullData", "parserVersion",
          "latestParseCounts", "latestParseCountsScope", "dataLocations"]) delete compact[key];
        compact["liveStatsFiles"] ??= {};
        return compact;
      });
    const lastObservation = observations[observations.length - 1];
    const priorDirectory = object(catalog["dataLocations"])?.["auditDirectory"];
    const auditDirectory = lastObservation ? dirname(lastObservation.path)
      : typeof priorDirectory === "string" ? resolve(options.projectRoot, priorDirectory) : join(options.projectRoot, "ingest/audit");
    await writeFile(temporary, `${JSON.stringify({ ...catalog, total: competitions.length,
      pathBase: "project-root", updatedAt: new Date().toISOString(),
      dataLocations: {
        auditDirectory: portablePath(options.projectRoot, auditDirectory),
        datasetIndexFile: portablePath(options.projectRoot, join(auditDirectory, ".audit-storage.json")),
        snapshotIndexFile: portablePath(options.projectRoot, join(options.snapshotDirectory, "index.json")),
      }, competitions }, null, 2)}\n`, { flag: "wx" });
    await lock.assertOwned();
    await rename(temporary, options.path);
    return competitions.length;
  } finally {
    await unlink(temporary).catch(() => undefined);
    await lock.release();
  }
}

/** Run after the audit is durable. It is an index, never a source of ingest targets or statistics. */
export async function updateCompetitionCatalog(options: CatalogOptions, auditPath: string): Promise<void> {
  const observation = await observe(auditPath);
  if (observation) await writeCatalog(options, [observation]);
}

export async function updateAnalysisCatalog(options: CatalogOptions, analysisPath: string): Promise<void> {
  await writeCatalog(options, [], [], false, [analysisPath]);
}

export async function updateLiveStatsCatalog(options: CatalogOptions, sourceUrl: string, gameIds: readonly string[], name?: string): Promise<void> {
  if (!gameIds.length) return;
  const update = await findLiveStatsFiles(join(options.snapshotDirectory, "livestats"), sourceUrl, gameIds);
  if (name) update.name = name;
  await writeCatalog(options, [], [update]);
}

/** Rebuild metadata from local audits only; preserve manual annotations and existing competitions. */
export async function rebuildCompetitionCatalog(options: CatalogOptions, auditDirectory: string) {
  const observations: Observation[] = [];
  const skipped: string[] = [];
  for (const name of (await readdir(auditDirectory)).sort()) {
    if (!name.endsWith(".json") || name.startsWith(".") || resolve(auditDirectory, name) === resolve(options.path)) continue;
    const path = join(auditDirectory, name);
    try { const observation = await observe(path); if (observation) observations.push(observation); }
    catch { skipped.push(name); }
  }
  const liveStats = await scanLiveStatsFiles(join(options.snapshotDirectory, "livestats"));
  const total = await writeCatalog(options, observations, liveStats, true);
  return { catalogPath: options.path, total, auditsRead: observations.length,
    liveStatsFiles: liveStats.reduce((sum, update) => sum + Object.values(update.files).filter(Boolean).length, 0), skipped };
}
