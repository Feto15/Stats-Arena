import { createHash } from "node:crypto";
import { SOURCE_HOST, validateSourceUrl } from "../domain/source-url.js";
import { PARSER_VERSION, type ParseStatus } from "../domain/types.js";
import { SnapshotStore, type SnapshotEntry } from "./snapshots.js";

export type FetchResource = "competition" | "teams" | "players" | "standings" | "summary" | "boxscore" | "playbyplay" | "shotchart" | "analysis" | "team_statistics";
export type RetrievalMode = "network" | "cache" | "snapshot" | "revalidated";
export type FetchErrorKind = "timeout" | "network" | "http" | "invalid_response" | "storage";

export type FetchStatus = "succeeded" | "failed";

export interface FetchAttempt {
  attempt: number;
  requestedAt: string;
  finishedAt: string;
  finalUrl: string | null;
  httpStatus: number | null;
  durationMs: number;
  responseBytes: number | null;
  sha256: string | null;
  error: string | null;
  errorKind?: FetchErrorKind;
  errorCode?: string;
  phase?: "request" | "body" | "storage";
}

export interface FetchMetadata {
  requestUrl: string;
  finalUrl: string | null;
  fetchStatus: FetchStatus;
  httpStatus: number | null;
  requestedAt: string;
  fetchedAt: string;
  durationMs: number;
  responseBytes: number | null;
  sha256: string | null;
  snapshotPath: string | null;
  snapshotChanged: boolean;
  attempts: FetchAttempt[];
  error: string | null;
  resource: FetchResource;
  fromSnapshot: boolean;
  parseStatus: ParseStatus;
  retrievalMode?: RetrievalMode;
  sourceFetchedAt?: string;
  cacheAgeMs?: number;
  cacheReason?: string;
}

export interface FetchResult {
  html: string;
  metadata: FetchMetadata;
}

export interface FetcherOptions {
  snapshotStore?: SnapshotStore;
  timeoutMs?: number;
  concurrency?: number;
  retries?: number;
  maxResponseBytes?: number;
  baseDelayMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
}

export interface PageFetchOptions {
  maxAgeMs?: number;
  forceRefresh?: boolean;
  contextKey?: string;
  completed?: boolean;
  recentMaxAgeMs?: number;
  priority?: number;
}

export class FetchError extends Error {
  constructor(message: string, readonly metadata: FetchMetadata) {
    super(message);
    this.name = "FetchError";
  }
}

function positiveInt(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function supportedPage(url: URL): boolean {
  const path = url.pathname.replace(/\/$/, "");
  return /^\/IBF\/en\/competition\/\d+(?:\/(?:teams|players|standings|schedule))?\/?$/.test(path) ||
    /^\/IBF\/en\/competition\/\d+\/statistics\/team\/?$/.test(path) ||
    /^\/IBF\/en\/(?:competition\/\d+\/)?match\/\d+\/(?:summary|boxscore|playbyplay|shotchart|analysis)\/?$/.test(path);
}

function validatePageUrl(input: string): URL {
  const url = validateSourceUrl(input);
  if (url.hostname.toLowerCase() !== SOURCE_HOST || !supportedPage(url)) {
    throw new Error(`Path fetch tidak diizinkan: ${url.href}`);
  }
  return url;
}

function sleepDefault(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function resourceFromUrl(url: URL): FetchResource {
  const path = url.pathname.replace(/\/$/, "");
  if (path.endsWith("/statistics/team")) return "team_statistics";
  if (path.includes("/match/")) {
    if (path.endsWith("/boxscore")) return "boxscore";
    if (path.endsWith("/playbyplay")) return "playbyplay";
    if (path.endsWith("/shotchart")) return "shotchart";
    if (path.endsWith("/analysis")) return "analysis";
    return "summary";
  }
  if (path.endsWith("/teams")) return "teams";
  if (path.endsWith("/players")) return "players";
  if (path.endsWith("/standings")) return "standings";
  return "competition";
}

function decodeHtml(bytes: Buffer, contentType: string | null): string {
  const charset = contentType?.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

async function boundedBody(response: Response, limit: number): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new InvalidResponseError(`Respons melewati batas ukuran ${limit} byte.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), size);
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function finalMetadata(
  requestUrl: string,
  resource: FetchResource,
  requestedAt: string,
  attempts: FetchAttempt[],
  fields: Partial<FetchMetadata>
): FetchMetadata {
  const last = attempts.at(-1);
  return {
    requestUrl,
    finalUrl: last?.finalUrl ?? null,
    fetchStatus: fields.fetchStatus ?? "failed",
    httpStatus: last?.httpStatus ?? null,
    requestedAt,
    fetchedAt: last?.finishedAt ?? new Date().toISOString(),
    durationMs: attempts.reduce((sum, item) => sum + item.durationMs, 0),
    responseBytes: last?.responseBytes ?? null,
    sha256: last?.sha256 ?? null,
    snapshotPath: fields.snapshotPath ?? null,
    snapshotChanged: fields.snapshotChanged ?? false,
    attempts,
    error: fields.error ?? last?.error ?? null,
    resource,
    fromSnapshot: fields.fromSnapshot ?? false,
    parseStatus: fields.parseStatus ?? "failed",
    retrievalMode: fields.retrievalMode ?? "network",
    ...(fields.sourceFetchedAt ? { sourceFetchedAt: fields.sourceFetchedAt } : {}),
    ...(fields.cacheAgeMs !== undefined ? { cacheAgeMs: fields.cacheAgeMs } : {}),
    ...(fields.cacheReason ? { cacheReason: fields.cacheReason } : {})
  };
}

class InvalidResponseError extends Error {}

type CachedPage = { html: string; entry: SnapshotEntry };

export class HtmlFetcher {
  private readonly store: SnapshotStore;
  private readonly timeoutMs: number;
  private readonly concurrency: number;
  private readonly retries: number;
  private readonly maxResponseBytes: number;
  private readonly baseDelayMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly now: () => number;
  private active = 0;
  private readonly waiters: Array<{ priority: number; resolve: () => void }> = [];
  private readonly inFlight = new Map<string, Promise<FetchResult>>();

  constructor(options: FetcherOptions = {}) {
    this.store = options.snapshotStore ?? new SnapshotStore(process.env["STATSARENA_SNAPSHOT_DIR"] ?? "ingest/snapshots");
    this.timeoutMs = options.timeoutMs ?? positiveInt(process.env["STATSARENA_FETCH_TIMEOUT_MS"], 20_000, 120_000);
    this.concurrency = options.concurrency ?? positiveInt(process.env["STATSARENA_FETCH_CONCURRENCY"], 3, 12);
    if (!Number.isSafeInteger(this.concurrency) || this.concurrency < 1 || this.concurrency > 12) throw new Error("Konkurensi fetch harus 1–12.");
    const retries = options.retries ?? Number(process.env["STATSARENA_FETCH_RETRIES"] ?? 3);
    this.retries = Number.isSafeInteger(retries) && retries >= 0 ? Math.min(retries, 6) : 3;
    this.maxResponseBytes = options.maxResponseBytes ?? 8 * 1024 * 1024;
    this.baseDelayMs = options.baseDelayMs ?? 400;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? sleepDefault;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
  }

  async readSnapshot(input: string): Promise<FetchResult> {
    const url = validatePageUrl(input);
    const cached = await this.store.read(url.href);
    return this.cachedResult(url, cached, "snapshot", "offline");
  }

  async recordParseResult(result: FetchResult, status: ParseStatus, options: PageFetchOptions = {}): Promise<void> {
    result.metadata.parseStatus = status;
    if (result.metadata.sha256) {
      const entry = result.metadata.retrievalMode === "snapshot" ? await this.store.getEntry(result.metadata.requestUrl) : null;
      // Offline parsing cannot claim a newer fixture context for bytes fetched under an older one.
      const contextKey = entry?.contextKey && entry.contextKey !== options.contextKey ? entry.contextKey : options.contextKey;
      await this.store.markParsed(result.metadata.requestUrl, result.metadata.sha256, status, PARSER_VERSION, contextKey, options.completed);
    }
  }

  async fetchPage(input: string, options: PageFetchOptions = {}): Promise<FetchResult> {
    const url = validatePageUrl(input);
    const key = JSON.stringify([url.href, options.contextKey, options.maxAgeMs, options.recentMaxAgeMs, options.completed, options.forceRefresh]);
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const operation = this.fetchOrCache(url, options);
    this.inFlight.set(key, operation);
    try {
      return await operation;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private cachedResult(url: URL, cached: CachedPage, mode: "cache" | "snapshot", reason: string): FetchResult {
    return { html: cached.html, metadata: {
      ...finalMetadata(url.href, resourceFromUrl(url), new Date(this.now()).toISOString(), [], {
        fetchStatus: "succeeded", fromSnapshot: true, snapshotPath: cached.entry.path,
        retrievalMode: mode, sourceFetchedAt: cached.entry.contentFetchedAt ?? cached.entry.fetchedAt,
        cacheAgeMs: Math.max(0, this.now() - Date.parse(cached.entry.fetchedAt)), cacheReason: reason
      }),
      fetchedAt: cached.entry.fetchedAt, finalUrl: url.href, httpStatus: cached.entry.httpStatus,
      responseBytes: cached.entry.responseBytes, sha256: cached.entry.sha256
    } };
  }

  private async fetchOrCache(url: URL, options: PageFetchOptions): Promise<FetchResult> {
    const entry = await this.store.getEntry(url.href);
    let cached: CachedPage | null = null;
    const age = entry ? this.now() - Date.parse(entry.fetchedAt) : Infinity;
    const completeAge = entry?.completedSeenAt ? this.now() - Date.parse(entry.completedSeenAt) : 0;
    const ttl = options.completed && completeAge < 30 * 60_000
      ? Math.min(options.maxAgeMs ?? 0, options.recentMaxAgeMs ?? 60_000) : options.maxAgeMs ?? 0;
    const validCheckpoint = entry?.parseStatus === "parsed" && entry.parserVersion === PARSER_VERSION && !entry.lastAttemptFailed;
    const sameContext = options.contextKey === undefined || entry?.contextKey === options.contextKey;
    const fresh = !options.forceRefresh && ttl > 0 && age >= 0 && age < ttl && validCheckpoint && sameContext;
    // Check integrity before reusing bytes or sending conditional validators.
    if (entry && (fresh || entry.etag || entry.lastModified)) {
      try { cached = await this.store.read(url.href); }
      catch {
        await this.store.invalidate(url.href);
      }
    }
    if (fresh && cached) return this.cachedResult(url, cached, "cache", "validated_within_ttl");
    return this.fetchWithRetries(url, cached, options.completed && (!sameContext || !validCheckpoint) ? 1 : options.priority ?? 10);
  }

  private async fetchWithRetries(url: URL, cached: CachedPage | null, priority: number): Promise<FetchResult> {
    const requestedAt = new Date(this.now()).toISOString();
    const attempts: FetchAttempt[] = [];
    const resource = resourceFromUrl(url);

    for (let attemptNumber = 1; attemptNumber <= this.retries + 1; attemptNumber += 1) {
      await this.acquireSlot(priority);
      const attemptStart = Date.now();
      const attemptRequestedAt = new Date(this.now()).toISOString();
      let response: Response | null = null;
      let finalUrl = url.href;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      let controller: AbortController | null = null;
      let phase: "request" | "body" | "storage" = "request";
      let retryDelay: number;
      try {
        controller = new AbortController();
        timeout = setTimeout(() => controller?.abort(new Error(`Timeout setelah ${this.timeoutMs} ms.`)), this.timeoutMs);
        ({ response, finalUrl } = await this.requestRedirectSafe(url, controller.signal, cached?.entry ?? null));
        if (response.status === 304) {
          clearTimeout(timeout);
          timeout = null;
          if (!cached) throw new InvalidResponseError("Situs menjawab 304 tetapi snapshot/cache tervalidasi tidak tersedia.");
          const finishedAt = new Date(this.now()).toISOString();
          phase = "storage";
          const updated = await this.store.write(url.href, cached.html, {
            fetchedAt: finishedAt, httpStatus: 304, responseBytes: Buffer.byteLength(cached.html, "utf8"),
            etag: response.headers.get("etag") ?? cached.entry.etag,
            lastModified: response.headers.get("last-modified") ?? cached.entry.lastModified
          });
          attempts.push({ attempt: attemptNumber, requestedAt: attemptRequestedAt, finishedAt, finalUrl,
            httpStatus: 304, durationMs: Date.now() - attemptStart, responseBytes: 0, sha256: updated.sha256, error: null });
          return { html: cached.html, metadata: finalMetadata(url.href, resource, requestedAt, attempts, {
            fetchStatus: "succeeded", snapshotPath: updated.path, snapshotChanged: false,
            retrievalMode: "revalidated", sourceFetchedAt: cached.entry.contentFetchedAt ?? cached.entry.fetchedAt
          }) };
        }
        if (!response.ok) {
          clearTimeout(timeout);
          timeout = null;
          await response.body?.cancel().catch(() => undefined);
          const message = `HTTP ${response.status} ${response.statusText}`.trim();
          attempts.push({ attempt: attemptNumber, requestedAt: attemptRequestedAt, finishedAt: new Date(this.now()).toISOString(),
            finalUrl, httpStatus: response.status, durationMs: Date.now() - attemptStart,
            responseBytes: null, sha256: null, error: message, errorKind: "http", phase });
          if (!isRetryableStatus(response.status) || attemptNumber > this.retries) break;
          retryDelay = this.backoffMs(attemptNumber, response.headers.get("retry-after"));
        } else {
          const contentType = response.headers.get("content-type");
          if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
            await response.body?.cancel().catch(() => undefined);
            throw new InvalidResponseError(`Content-Type bukan HTML: ${contentType}`);
          }
          phase = "body";
          const bytes = await boundedBody(response, this.maxResponseBytes);
          clearTimeout(timeout);
          timeout = null;
          // Include the full body download in source timestamps, not just response headers.
          const finishedAt = new Date(this.now()).toISOString();
          const html = decodeHtml(bytes, contentType);
          const digest = sha256(Buffer.from(html, "utf8"));
          phase = "storage";
          const stored = await this.store.write(url.href, html, {
            fetchedAt: finishedAt, httpStatus: response.status, responseBytes: bytes.byteLength,
            etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified")
          });
          attempts.push({ attempt: attemptNumber, requestedAt: attemptRequestedAt, finishedAt, finalUrl,
            httpStatus: response.status, durationMs: Date.now() - attemptStart, responseBytes: bytes.byteLength, sha256: digest, error: null });
          return { html, metadata: finalMetadata(url.href, resource, requestedAt, attempts, {
            fetchStatus: "succeeded", sha256: digest, responseBytes: bytes.byteLength,
            snapshotPath: stored.path, snapshotChanged: stored.changed, retrievalMode: "network", sourceFetchedAt: finishedAt
          }) };
        }
      } catch (error) {
        if (timeout) clearTimeout(timeout);
        const kind: FetchErrorKind = controller?.signal.aborted ? "timeout"
          : error instanceof InvalidResponseError ? "invalid_response" : phase === "storage" ? "storage" : "network";
        const message = controller?.signal.aborted ? `Timeout setelah ${this.timeoutMs} ms (${phase}).`
          : error instanceof Error ? error.message : String(error);
        const code = errorCode(error);
        attempts.push({ attempt: attemptNumber, requestedAt: attemptRequestedAt, finishedAt: new Date(this.now()).toISOString(),
          finalUrl, httpStatus: response?.status ?? null, durationMs: Date.now() - attemptStart,
          responseBytes: null, sha256: null, error: message, errorKind: kind, ...(code ? { errorCode: code } : {}), phase });
        if (attemptNumber > this.retries || kind === "invalid_response" || kind === "storage") break;
        retryDelay = this.backoffMs(attemptNumber, response?.headers.get("retry-after") ?? null);
      } finally {
        if (timeout) clearTimeout(timeout);
        this.releaseSlot();
      }
      // Backoff does not occupy a network slot; live/new games can proceed while old URLs wait.
      await this.sleep(retryDelay);
    }

    await this.store.markFetchFailed(url.href);
    throw new FetchError(attempts.at(-1)?.error ?? "Fetch gagal tanpa detail error.", finalMetadata(url.href, resource, requestedAt, attempts, {
      fetchStatus: "failed"
    }));
  }

  private async requestRedirectSafe(initial: URL, signal: AbortSignal, cache: SnapshotEntry | null): Promise<{ response: Response; finalUrl: string }> {
    let url = initial;
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      const headers = new Headers({ accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1", "user-agent": "StatsArena/0.1 (public score data ingestion)" });
      if (redirects === 0 && cache?.etag) headers.set("if-none-match", cache.etag);
      if (redirects === 0 && cache?.lastModified) headers.set("if-modified-since", cache.lastModified);
      const response = await this.fetchImpl(url.href, { method: "GET", headers, redirect: "manual", signal });
      if (![301, 302, 303, 307, 308].includes(response.status)) return { response, finalUrl: url.href };
      await response.body?.cancel().catch(() => undefined);
      const location = response.headers.get("location");
      if (!location) throw new InvalidResponseError(`Redirect HTTP ${response.status} tanpa Location.`);
      if (redirects === 5) throw new InvalidResponseError("Terlalu banyak redirect (batas 5).");
      try { url = validatePageUrl(new URL(location, url).href); }
      catch (error) { throw new InvalidResponseError(error instanceof Error ? error.message : String(error)); }
    }
    throw new InvalidResponseError("Redirect berakhir tanpa respons.");
  }

  private backoffMs(attempt: number, retryAfter: string | null): number {
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
      const dateDelay = Date.parse(retryAfter) - this.now();
      if (Number.isFinite(dateDelay) && dateDelay > 0) return Math.min(dateDelay, 30_000);
    }
    return Math.min(this.baseDelayMs * 2 ** (attempt - 1) + Math.floor(this.random() * this.baseDelayMs), 30_000);
  }

  private async acquireSlot(priority: number): Promise<void> {
    if (this.active < this.concurrency) { this.active += 1; return; }
    await new Promise<void>((resolve) => {
      this.waiters.push({ priority, resolve });
      this.waiters.sort((a, b) => a.priority - b.priority);
    });
  }

  private releaseSlot(): void {
    const next = this.waiters.shift();
    // Reserve the released slot for the queued request before it resumes.
    if (next) next.resolve();
    else this.active = Math.max(0, this.active - 1);
  }
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const value = "cause" in error ? error.cause : error;
  return value && typeof value === "object" && "code" in value && typeof value.code === "string" ? value.code : null;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}
