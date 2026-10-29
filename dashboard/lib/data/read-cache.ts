type Entry = { value: unknown; expiresAt: number; bytes: number };
type ReadOptions<T> = { key: readonly unknown[]; authorize: () => Promise<unknown>; load: () => Promise<T>; ttlMs?: number };

/** Bounded per-instance data cache. Authorization always runs before a hit or an in-flight read. */
export function createReadCache({ maxEntries = 128, maxBytes = 16 * 1024 * 1024, now = Date.now } = {}) {
  const entries = new Map<string, Entry>(), pending = new Map<string, Promise<unknown>>();
  let bytes = 0, hits = 0, misses = 0, sharedLoads = 0;
  function remove(key: string) { const entry = entries.get(key); if (entry) bytes -= entry.bytes; entries.delete(key); }
  function keyOf(key: readonly unknown[]) {
    return JSON.stringify(key, (_, value: unknown) => value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
  }
  async function read<T>({ key, authorize, load, ttlMs = 15_000 }: ReadOptions<T>): Promise<T> {
    await authorize();
    const id = keyOf(key), time = now();
    for (const [expired, entry] of entries) if (entry.expiresAt <= time) remove(expired);
    const cached = entries.get(id);
    if (cached) { hits++; entries.delete(id); entries.set(id, cached); return structuredClone(cached.value) as T; }
    const running = pending.get(id);
    if (running) { sharedLoads++; return structuredClone(await running) as T; }
    misses++;
    const request = (async () => {
      const value = structuredClone(await load());
      let size: number;
      try { size = Buffer.byteLength(JSON.stringify(value, (_, item: unknown) => typeof item === "bigint" ? String(item) : item)); }
      catch { return value; }
      if (ttlMs > 0 && size <= maxBytes && maxEntries > 0) {
        remove(id);
        while (entries.size >= maxEntries || bytes + size > maxBytes) {
          const oldest = entries.keys().next().value;
          if (oldest === undefined) break;
          remove(oldest);
        }
        entries.set(id, { value, bytes: size, expiresAt: now() + ttlMs }); bytes += size;
      }
      return value;
    })();
    // Keep the single-flight map bounded as well when many distinct filters arrive concurrently.
    const tracked = pending.size < maxEntries;
    if (tracked) pending.set(id, request);
    try { return structuredClone(await request) as T; }
    finally { if (tracked && pending.get(id) === request) pending.delete(id); }
  }
  return { read, stats: () => ({ entries: entries.size, pending: pending.size, bytes, hits, misses, sharedLoads }) };
}

export const dashboardReadCache = createReadCache();
