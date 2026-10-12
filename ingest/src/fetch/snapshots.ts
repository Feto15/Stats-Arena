import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import { validateSourceUrl } from "../domain/source-url.js";
import type { ParseStatus } from "../domain/types.js";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const HASH_FILE_RE = /^[a-f0-9]{64}\.html\.gz$/;
const MAX_COMPRESSED_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;

export interface SnapshotEntry {
  sha256: string;
  path: string;
  fetchedAt: string;
  httpStatus: number;
  responseBytes: number;
  etag: string | null;
  lastModified: string | null;
  parseStatus?: ParseStatus;
  parserVersion?: string;
  contextKey?: string;
  completedSeenAt?: string;
  contentFetchedAt?: string;
  lastAttemptFailed?: boolean;
}

type SnapshotIndex = Record<string, SnapshotEntry>;

export class SnapshotStore {
  readonly root: string;
  private writeQueue: Promise<void> = Promise.resolve();
  private indexPromise: Promise<SnapshotIndex> | null = null;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private async readIndex(): Promise<SnapshotIndex> {
    this.indexPromise ??= this.loadIndex();
    return this.indexPromise;
  }

  private async loadIndex(): Promise<SnapshotIndex> {
    try {
      const value: unknown = JSON.parse(await readFile(resolve(this.root, "index.json"), "utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) return {};
      const result: SnapshotIndex = {};
      for (const [key, item] of Object.entries(value)) {
        if (!item || typeof item !== "object") continue;
        const entry = item as Partial<SnapshotEntry>;
        if (typeof entry.sha256 !== "string" || typeof entry.path !== "string" || !HASH_FILE_RE.test(basename(entry.path))) continue;
        if (typeof entry.fetchedAt !== "string" || typeof entry.httpStatus !== "number" || typeof entry.responseBytes !== "number") continue;
        result[key] = {
          sha256: entry.sha256,
          path: basename(entry.path),
          fetchedAt: entry.fetchedAt,
          httpStatus: entry.httpStatus,
          responseBytes: entry.responseBytes,
          etag: typeof entry.etag === "string" ? entry.etag : null,
          lastModified: typeof entry.lastModified === "string" ? entry.lastModified : null,
          ...(entry.parseStatus === "parsed" || entry.parseStatus === "partial" || entry.parseStatus === "failed" ? { parseStatus: entry.parseStatus } : {}),
          ...(typeof entry.parserVersion === "string" ? { parserVersion: entry.parserVersion } : {}),
          ...(typeof entry.contextKey === "string" ? { contextKey: entry.contextKey } : {}),
          ...(typeof entry.completedSeenAt === "string" ? { completedSeenAt: entry.completedSeenAt } : {}),
          ...(typeof entry.contentFetchedAt === "string" ? { contentFetchedAt: entry.contentFetchedAt } : {}),
          ...(typeof entry.lastAttemptFailed === "boolean" ? { lastAttemptFailed: entry.lastAttemptFailed } : {})
        };
      }
      return result;
    } catch {
      return {};
    }
  }

  async getEntry(url: string): Promise<SnapshotEntry | null> {
    const validated = validateSourceUrl(url).href;
    const index = await this.readIndex();
    return index[validated] ?? null;
  }

  async read(url: string): Promise<{ html: string; entry: SnapshotEntry }> {
    const validated = validateSourceUrl(url).href;
    const entry = await this.getEntry(validated);
    if (!entry) throw new Error(`Snapshot untuk URL tidak tersedia: ${validated}`);
    const filePath = resolve(this.root, basename(entry.path));
    if (dirname(filePath) !== this.root || !HASH_FILE_RE.test(basename(filePath))) {
      throw new Error("Path snapshot tidak valid.");
    }
    const fileInfo = await stat(filePath);
    if (fileInfo.size > MAX_COMPRESSED_SNAPSHOT_BYTES) {
      throw new Error(`Snapshot gzip melewati batas ukuran ${MAX_COMPRESSED_SNAPSHOT_BYTES} byte.`);
    }
    const compressed = await readFile(filePath);
    const html = await gunzipAsync(compressed, { maxOutputLength: MAX_SNAPSHOT_BYTES });
    const actualHash = createHash("sha256").update(html).digest("hex");
    if (actualHash !== entry.sha256) throw new Error(`Hash snapshot tidak cocok untuk ${validated}.`);
    return { html: html.toString("utf8"), entry };
  }

  async write(
    url: string,
    html: string,
    metadata: { fetchedAt: string; httpStatus: number; responseBytes: number; etag: string | null; lastModified: string | null }
  ): Promise<{ sha256: string; path: string; changed: boolean }> {
    const validated = validateSourceUrl(url).href;
    const htmlBuffer = Buffer.from(html, "utf8");
    const sha256 = createHash("sha256").update(htmlBuffer).digest("hex");
    const filename = `${sha256}.html.gz`;
    await mkdir(this.root, { recursive: true });

    const operation = async (): Promise<{ sha256: string; path: string; changed: boolean }> => {
      const index = await this.readIndex();
      const previous = index[validated];
      const changed = previous?.sha256 !== sha256;
      const filePath = resolve(this.root, filename);
      if (changed) {
        const compressed = await gzipAsync(htmlBuffer, { level: 9 });
        const tempPath = `${filePath}.${process.pid}.tmp`;
        await writeFile(tempPath, compressed, { flag: "wx" }).catch(async (error: unknown) => {
          if (error instanceof Error && "code" in error && error.code === "EEXIST") {
            await writeFile(tempPath, compressed);
            return;
          }
          throw error;
        });
        await rename(tempPath, filePath);
      }
      // A network success still needs validation before becoming a reusable checkpoint.
      index[validated] = { ...metadata, sha256, path: filename,
        contentFetchedAt: metadata.httpStatus === 304 ? previous?.contentFetchedAt ?? previous?.fetchedAt ?? metadata.fetchedAt : metadata.fetchedAt,
        ...(previous?.contextKey ? { contextKey: previous.contextKey } : {}),
        ...(previous?.completedSeenAt ? { completedSeenAt: previous.completedSeenAt } : {}),
        lastAttemptFailed: false };
      await this.saveIndex(index);
      return { sha256, path: filePath, changed };
    };

    const result = this.writeQueue.then(operation);
    this.writeQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  async markParsed(url: string, hash: string, status: ParseStatus, parserVersion: string, contextKey?: string, completed = false): Promise<void> {
    await this.updateEntry(url, (entry) => entry.sha256 !== hash || (
      entry.parseStatus === status && entry.parserVersion === parserVersion &&
      (contextKey === undefined || entry.contextKey === contextKey) && (!completed || entry.completedSeenAt !== undefined)
    ) ? entry : {
      ...entry, parseStatus: status, parserVersion,
      ...(contextKey ? { contextKey } : {}),
      ...(completed ? { completedSeenAt: contextKey !== undefined && entry.contextKey !== contextKey
        ? entry.fetchedAt : entry.completedSeenAt ?? entry.fetchedAt } : {})
    });
  }

  async markFetchFailed(url: string): Promise<void> {
    await this.updateEntry(url, (entry) => ({ ...entry, lastAttemptFailed: true }));
  }

  async invalidate(url: string): Promise<void> {
    const validated = validateSourceUrl(url).href;
    const result = this.writeQueue.then(async () => {
      const index = await this.readIndex();
      delete index[validated];
      await this.saveIndex(index);
    });
    this.writeQueue = result.catch(() => undefined);
    await result;
  }

  private async updateEntry(url: string, update: (entry: SnapshotEntry) => SnapshotEntry): Promise<void> {
    const validated = validateSourceUrl(url).href;
    const result = this.writeQueue.then(async () => {
      const index = await this.readIndex();
      const entry = index[validated];
      if (!entry) return;
      const updated = update(entry);
      if (updated === entry) return;
      index[validated] = updated;
      await this.saveIndex(index);
    });
    this.writeQueue = result.catch(() => undefined);
    await result;
  }

  private async saveIndex(index: SnapshotIndex): Promise<void> {
    const indexPath = resolve(this.root, "index.json");
    const tempIndexPath = `${indexPath}.${process.pid}.tmp`;
    await mkdir(this.root, { recursive: true });
    await writeFile(tempIndexPath, `${JSON.stringify(index, null, 2)}\n`);
    await rename(tempIndexPath, indexPath);
  }
}
