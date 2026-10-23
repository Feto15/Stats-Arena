import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { gzip, gunzip } from "node:zlib";
import { z } from "zod";
import { validateLiveStatsUrl } from "./source.js";

const zip = promisify(gzip), unzip = promisify(gunzip);
const LIMIT = 4 * 1024 * 1024;
const envelope = z.object({ url: z.string(), body: z.string(), hash: z.string().regex(/^[a-f0-9]{64}$/), fetchedAt: z.iso.datetime() });
export type LiveStatsResponse = z.infer<typeof envelope> & { snapshotPath: string; cached: boolean };
export class LiveStatsFetchError extends Error {
  constructor(message: string, readonly status: number | null) { super(message); this.name = "LiveStatsFetchError"; }
}

/** Fixed public allowlist, bounded IO, no redirects, and two known-good revisions. */
export class LiveStatsClient {
  constructor(readonly directory: string, private readonly fetchImpl: typeof fetch = fetch,
    private readonly wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))) {}

  private path(url: string, slot: string): string {
    validateLiveStatsUrl(url);
    if (!["current", "previous", "attempt"].includes(slot) && !/^[a-f0-9]{64}$/.test(slot)) throw new Error("Slot snapshot tidak valid.");
    return resolve(this.directory, `${createHash("sha256").update(url).digest("hex")}.${slot}.json.gz`);
  }

  private async read(url: string, slot = "current"): Promise<z.infer<typeof envelope> | null> {
    try {
      const file = this.path(url, slot);
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > LIMIT) throw new Error("Snapshot LiveStats tidak valid atau terlalu besar.");
      const raw = await unzip(await readFile(file), { maxOutputLength: 8 * 1024 * 1024 });
      const value = envelope.parse(JSON.parse(raw.toString("utf8")) as unknown);
      if (value.url !== url || (/^[a-f0-9]{64}$/.test(slot) && value.hash !== slot) || createHash("sha256").update(value.body).digest("hex") !== value.hash) throw new Error("Hash snapshot LiveStats tidak cocok.");
      return value;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  }

  private async write(url: string, slot: string, value: z.infer<typeof envelope>): Promise<string> {
    await mkdir(this.directory, { recursive: true });
    const file = this.path(url, slot), temp = `${file}.${randomUUID()}.tmp`;
    await writeFile(temp, await zip(Buffer.from(JSON.stringify(value)), { level: 9 }), { flag: "wx" });
    await rename(temp, file);
    return file;
  }

  async get(input: string, maxAgeMs = 0): Promise<LiveStatsResponse> {
    const url = validateLiveStatsUrl(input).href;
    const cached = await this.read(url).catch(() => null);
    if (cached && Date.now() - Date.parse(cached.fetchedAt) < maxAgeMs) return { ...cached, snapshotPath: this.path(url, cached.hash), cached: true };
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await this.fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(20_000), headers: { Accept: url.endsWith(".json") ? "application/json" : "text/html" } });
        if (!response.ok) {
          await response.body?.cancel();
          throw new LiveStatsFetchError(`LiveStats merespons HTTP ${response.status}.`, response.status);
        }
        if (!response.body) throw new LiveStatsFetchError("Respons LiveStats kosong.", null);
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = []; let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read(); if (done) break;
            size += value.byteLength;
            if (size > LIMIT) { await reader.cancel(); throw new LiveStatsFetchError("Respons LiveStats melewati batas 4 MiB.", 413); }
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
        const body = Buffer.concat(chunks).toString("utf8");
        const value = { url, body, hash: createHash("sha256").update(body).digest("hex"), fetchedAt: new Date().toISOString() };
        const snapshotPath = this.path(url, value.hash);
        if (!await this.read(url, value.hash).catch(() => null)) await this.write(url, value.hash, value);
        await this.write(url, "attempt", value);
        return { ...value, snapshotPath, cached: false };
      } catch (error) {
        last = error;
        if (error instanceof LiveStatsFetchError && error.status !== null && error.status < 500 && error.status !== 429) throw error;
        if (attempt < 2) await this.wait(750 * 2 ** attempt + Math.floor(Math.random() * 250));
      }
    }
    if (last instanceof LiveStatsFetchError) throw last;
    throw new LiveStatsFetchError("Pengambilan LiveStats gagal setelah retry/timeout.", null);
  }

  /** Read a stable cache alias without HTTP or accepting it as an imported dataset. */
  async readSnapshot(input: string, slot: "current" | "attempt" = "current"): Promise<LiveStatsResponse | null> {
    const url = validateLiveStatsUrl(input).href;
    const value = await this.read(url, slot);
    return value ? { ...value, snapshotPath: this.path(url, slot), cached: true } : null;
  }

  async accept(response: LiveStatsResponse): Promise<string> {
    const current = await this.read(response.url).catch(() => null);
    if (current?.hash !== response.hash) {
      if (current) await this.write(response.url, "previous", current);
    }
    if (current?.hash !== response.hash || Date.now() - Date.parse(current.fetchedAt) >= 86_400_000) {
      await this.write(response.url, "current", response);
    }
    return this.path(response.url, response.hash);
  }

  /** Only after DB commit: two valid revisions, latest attempt, and DB provenance. */
  async compact(url: string, protectedHashes: readonly string[] = []): Promise<void> {
    const keep = new Set<string>(protectedHashes);
    for (const slot of ["current", "previous", "attempt"]) { const value = await this.read(url, slot); if (value) keep.add(value.hash); }
    const prefix = `${createHash("sha256").update(validateLiveStatsUrl(url).href).digest("hex")}.`;
    for (const file of await readdir(this.directory)) {
      if (!file.startsWith(prefix)) continue;
      const hash = file.slice(prefix.length).match(/^([a-f0-9]{64})\.json\.gz$/)?.[1];
      if (hash && !keep.has(hash)) await unlink(resolve(this.directory, file));
    }
  }
}
