import { lstat, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { load } from "cheerio";
import { competitionReference } from "../domain/source-url.js";
import { LiveStatsClient } from "./client.js";
import { discoverLiveStatsData, liveStatsPageUrl, LIVESTATS_HOST } from "./source.js";

export interface LiveStatsCatalogFiles {
  sourceUrl: string;
  files: Record<string, string | null>;
  name?: string;
}

/** File references only: current is preferred; an attempt may be a dry-run or rejected supplement. */
export async function findLiveStatsFiles(directory: string, input: string, gameIds: readonly string[]): Promise<LiveStatsCatalogFiles> {
  const reference = competitionReference(input);
  const client = new LiveStatsClient(directory);
  const files: Record<string, string | null> = {};
  for (const gameId of new Set(gameIds)) {
    files[gameId] = null;
    const pageUrl = liveStatsPageUrl(reference.url, gameId);
    for (const slot of ["current", "attempt"] as const) {
      try {
        const page = await client.readSnapshot(pageUrl, slot);
        if (!page) continue;
        const url = discoverLiveStatsData(page.body, pageUrl, reference.url, gameId);
        for (const dataSlot of ["current", "attempt"] as const) {
          try {
            const data = await client.readSnapshot(url, dataSlot);
            if (!data) continue;
            const body: unknown = JSON.parse(data.body);
            if (body === null || typeof body !== "object" || Array.isArray(body)) continue;
            files[gameId] = data.snapshotPath;
            break;
          } catch { /* Invalid snapshots cannot become catalog references. */ }
        }
        if (files[gameId]) break;
      } catch { /* Wrong competition/namespace and corrupt aliases are ignored. */ }
    }
  }
  return { sourceUrl: reference.url, files };
}

/** Rebuild ownership from explicit cached page metadata, never from game IDs alone. */
export async function scanLiveStatsFiles(directory: string): Promise<LiveStatsCatalogFiles[]> {
  let names: string[];
  try { names = await readdir(directory); }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return []; throw error; }
  const groups = new Map<string, Set<string>>();
  const client = new LiveStatsClient(directory);
  // Alias filenames encode only a URL hash, so inspect their bounded envelopes to recover the URL.
  for (const name of names.sort()) {
    if (!/^[a-f0-9]{64}\.(?:current|attempt)\.json\.gz$/.test(name)) continue;
    try {
      const path = join(directory, name);
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 4 * 1024 * 1024) continue;
      const value: unknown = JSON.parse(gunzipSync(await readFile(path), { maxOutputLength: 8 * 1024 * 1024 }).toString("utf8"));
      if (!value || typeof value !== "object" || !("url" in value) || typeof value.url !== "string") continue;
      const url = new URL(value.url);
      const match = /^\/u\/(IBF|IBL)\/([1-9]\d*)\/bs\.html$/.exec(url.pathname);
      if (url.hostname !== LIVESTATS_HOST || !match?.[1] || !match[2]) continue;
      const slot = name.endsWith(".current.json.gz") ? "current" : "attempt";
      const page = await client.readSnapshot(url.href, slot);
      if (!page || page.snapshotPath !== resolve(path)) continue;
      const competitionId = load(page.body)("#compId").attr("value");
      if (!competitionId || !/^[1-9]\d*$/.test(competitionId)) continue;
      const reference = competitionReference(`${match[1]}:${competitionId}`);
      discoverLiveStatsData(page.body, url.href, reference.url, match[2]);
      const ids = groups.get(reference.url) ?? new Set<string>();
      ids.add(match[2]); groups.set(reference.url, ids);
    } catch { /* Not a verified cached LiveStats page. */ }
  }
  const result: LiveStatsCatalogFiles[] = [];
  for (const [url, ids] of groups) result.push(await findLiveStatsFiles(directory, url, [...ids]));
  return result;
}
