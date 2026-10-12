import { createHash } from "node:crypto";
import type { GameRecord } from "../domain/types.js";
import type { PageFetchOptions } from "./fetcher.js";

function ttl(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > 7 * 24 * 60 * 60_000) throw new Error(`${name} harus 0–604800000 ms.`);
  return value;
}

export function pagePolicy(resource: "competition" | "registry" | "standings", forceRefresh = false): PageFetchOptions {
  const maxAgeMs = resource === "competition" ? ttl("STATSARENA_CACHE_COMPETITION_MS", 30_000)
    : resource === "registry" ? ttl("STATSARENA_CACHE_REGISTRY_MS", 6 * 60 * 60_000)
    : ttl("STATSARENA_CACHE_STANDINGS_MS", 2 * 60_000);
  return { maxAgeMs, forceRefresh, priority: 5 };
}

export function matchPolicy(fixture: GameRecord, forceRefresh = false): PageFetchOptions {
  return {
    maxAgeMs: fixture.status === "complete" ? ttl("STATSARENA_CACHE_COMPLETE_MS", 24 * 60 * 60_000) : 0,
    recentMaxAgeMs: ttl("STATSARENA_CACHE_RECENT_COMPLETE_MS", 60_000),
    completed: fixture.status === "complete", forceRefresh,
    contextKey: createHash("sha256").update(JSON.stringify(fixture)).digest("hex"),
    priority: fixture.status === "live" ? 0 : fixture.status === "unknown" ? 1 : 10
  };
}
