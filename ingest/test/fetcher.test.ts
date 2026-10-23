import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FetchError, HtmlFetcher } from "../src/fetch/fetcher.js";
import { SnapshotStore } from "../src/fetch/snapshots.js";

const competitionUrl = "https://hosted.dcd.shared.geniussports.com/IBF/en/competition/49607";

test("fetcher retries transient HTTP errors, records attempts, hashes content, and stores compressed snapshots", async () => {
  const directory = await mkdtemp(join(tmpdir(), "statsarena-fetch-"));
  try {
    const store = new SnapshotStore(directory);
    let calls = 0;
    const fetcher = new HtmlFetcher({
      snapshotStore: store,
      retries: 2,
      baseDelayMs: 1,
      sleep: async () => undefined,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) return new Response("try again", { status: 503 });
        return new Response("<html><h1>snapshot</h1></html>", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8", etag: "sample-etag" }
        });
      }
    });
    const result = await fetcher.fetchPage(competitionUrl);
    assert.equal(result.metadata.fetchStatus, "succeeded");
    assert.equal(result.metadata.httpStatus, 200);
    assert.equal(result.metadata.attempts.length, 2);
    assert.equal(result.metadata.sha256?.length, 64);
    assert.equal(result.metadata.snapshotChanged, true);
    assert.equal(result.html, "<html><h1>snapshot</h1></html>");

    const offline = await new HtmlFetcher({ snapshotStore: store }).readSnapshot(competitionUrl);
    assert.equal(offline.html, result.html);
    assert.equal(offline.metadata.fromSnapshot, true);
    assert.equal(offline.metadata.sha256, result.metadata.sha256);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("fetcher rejects a redirect to any host outside the source site", async () => {
  const directory = await mkdtemp(join(tmpdir(), "statsarena-redirect-"));
  try {
    const fetcher = new HtmlFetcher({
      snapshotStore: new SnapshotStore(directory),
      retries: 0,
      fetchImpl: async () => new Response(null, {
        status: 302,
        headers: { location: "https://example.com/redirected" }
      })
    });
    await assert.rejects(fetcher.fetchPage(competitionUrl), (error: unknown) => {
      assert.ok(error instanceof FetchError);
      assert.equal(error.metadata.fetchStatus, "failed");
      assert.match(error.message, /URL harus memakai HTTPS pada hosted\.dcd\.shared\.geniussports\.com/);
      return true;
    });
    const crossNamespace = new HtmlFetcher({
      snapshotStore: new SnapshotStore(directory), retries: 0,
      fetchImpl: async () => new Response(null, { status: 302, headers: { location: competitionUrl.replace("/IBF/", "/IBL/") } })
    });
    await assert.rejects(crossNamespace.fetchPage(competitionUrl), /Redirect berbeda namespace sumber/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("fetcher respects its concurrency limit for independent competition pages", async () => {
  const directory = await mkdtemp(join(tmpdir(), "statsarena-concurrency-"));
  try {
    let active = 0;
    let maximum = 0;
    const fetcher = new HtmlFetcher({
      snapshotStore: new SnapshotStore(directory),
      concurrency: 2,
      retries: 0,
      fetchImpl: async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
        active -= 1;
        return new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } });
      }
    });
    const urls = [49607, 49608, 49609, 49610, 49611].map(
      (id) => `https://hosted.dcd.shared.geniussports.com/IBF/en/competition/${id}`
    );
    await Promise.all(urls.map((url) => fetcher.fetchPage(url)));
    assert.equal(maximum, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("snapshot reader rejects compressed files that exceed its size limit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "statsarena-oversized-snapshot-"));
  try {
    const hash = "a".repeat(64);
    const path = `${hash}.html.gz`;
    await writeFile(join(directory, path), Buffer.alloc(8 * 1024 * 1024 + 1));
    await writeFile(join(directory, "index.json"), JSON.stringify({
      [competitionUrl]: {
        sha256: hash,
        path,
        fetchedAt: new Date().toISOString(),
        httpStatus: 200,
        responseBytes: 8 * 1024 * 1024 + 1,
        etag: null,
        lastModified: null
      }
    }));

    await assert.rejects(new SnapshotStore(directory).read(competitionUrl), /Snapshot gzip melewati batas ukuran/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("validated cache keeps source time, expires, and supports forced refresh without fake HTTP attempts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "statsarena-ttl-"));
  try {
    let now = Date.parse("2026-10-07T00:00:00Z");
    let calls = 0;
    const fetcher = new HtmlFetcher({ snapshotStore: new SnapshotStore(directory), now: () => now, retries: 0,
      fetchImpl: async () => { calls++; return new Response(`<h1>version ${calls}</h1>`, { headers: { "content-type": "text/html" } }); }
    });
    const policy = { maxAgeMs: 1000, contextKey: "fixture-v1" };
    const first = await fetcher.fetchPage(competitionUrl, policy);
    await fetcher.recordParseResult(first, "parsed", policy);
    now += 500;
    const cached = await fetcher.fetchPage(competitionUrl, policy);
    assert.equal(calls, 1);
    assert.equal(cached.metadata.retrievalMode, "cache");
    assert.equal(cached.metadata.fetchedAt, first.metadata.fetchedAt);
    assert.equal(cached.metadata.sourceFetchedAt, first.metadata.fetchedAt);
    assert.equal(cached.metadata.cacheAgeMs, 500);
    assert.deepEqual(cached.metadata.attempts, []);
    now += 600;
    const expired = await fetcher.fetchPage(competitionUrl, policy);
    assert.equal(calls, 2);
    assert.equal(expired.metadata.retrievalMode, "network");
    await fetcher.recordParseResult(expired, "parsed", policy);
    await fetcher.fetchPage(competitionUrl, { ...policy, forceRefresh: true });
    assert.equal(calls, 3);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("partial pages and failed refreshes are not successful checkpoints", async () => {
  const directory = await mkdtemp(join(tmpdir(), "statsarena-cache-error-"));
  try {
    let calls = 0;
    let fail = false;
    const store = new SnapshotStore(directory);
    const fetcher = new HtmlFetcher({ snapshotStore: store, retries: 0,
      fetchImpl: async () => { calls++; return new Response("<html>data</html>", { status: fail ? 503 : 200, headers: { "content-type": "text/html" } }); }
    });
    const policy = { maxAgeMs: 60_000 };
    const first = await fetcher.fetchPage(competitionUrl, policy);
    await fetcher.recordParseResult(first, "partial", policy);
    const recovered = await fetcher.fetchPage(competitionUrl, policy);
    assert.equal(calls, 2);
    await fetcher.recordParseResult(recovered, "parsed", policy);
    fail = true;
    await assert.rejects(fetcher.fetchPage(competitionUrl, { ...policy, forceRefresh: true }), FetchError);
    assert.equal((await store.getEntry(competitionUrl))?.lastAttemptFailed, true);
    fail = false;
    const retry = await fetcher.fetchPage(competitionUrl, policy);
    assert.equal(retry.metadata.retrievalMode, "network");
    assert.equal(calls, 4);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("completed game cache invalidates changed fixtures and rechecks newly completed games sooner", async () => {
  const directory = await mkdtemp(join(tmpdir(), "statsarena-recent-"));
  try {
    let now = Date.parse("2026-10-07T00:00:00Z");
    let calls = 0;
    const fetcher = new HtmlFetcher({ snapshotStore: new SnapshotStore(directory), now: () => now, retries: 0,
      fetchImpl: async () => { calls++; return new Response("<html>game</html>", { headers: { "content-type": "text/html" } }); }
    });
    const policy = { maxAgeMs: 86_400_000, recentMaxAgeMs: 1000, contextKey: "complete-25-45", completed: true };
    const first = await fetcher.fetchPage(competitionUrl, policy);
    await fetcher.recordParseResult(first, "parsed", policy);
    now += 1100;
    const recent = await fetcher.fetchPage(competitionUrl, policy);
    assert.equal(calls, 2);
    await fetcher.recordParseResult(recent, "parsed", policy);
    now += 31 * 60_000;
    assert.equal((await fetcher.fetchPage(competitionUrl, policy)).metadata.retrievalMode, "cache");
    assert.equal(calls, 2);
    const correctedPolicy = { ...policy, contextKey: "complete-26-45" };
    const offline = await fetcher.readSnapshot(competitionUrl);
    await fetcher.recordParseResult(offline, "parsed", correctedPolicy);
    const corrected = await fetcher.fetchPage(competitionUrl, correctedPolicy);
    assert.equal(calls, 3);
    await fetcher.recordParseResult(corrected, "parsed", correctedPolicy);
    now += 1100;
    await fetcher.fetchPage(competitionUrl, correctedPolicy);
    assert.equal(calls, 4);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("conditional 304 keeps the original content time and renews validation freshness", async () => {
  const directory = await mkdtemp(join(tmpdir(), "statsarena-304-"));
  try {
    let calls = 0;
    let now = Date.parse("2026-10-07T00:00:00Z");
    const fetcher = new HtmlFetcher({ snapshotStore: new SnapshotStore(directory), now: () => now, retries: 0,
      fetchImpl: async (_, init) => {
        calls++;
        if (calls === 1) return new Response("<html>etag</html>", { headers: { etag: "sample", "content-type": "text/html" } });
        assert.equal(new Headers(init?.headers).get("if-none-match"), "sample");
        return new Response(null, { status: 304 });
      }
    });
    const policy = { maxAgeMs: 1000 };
    const first = await fetcher.fetchPage(competitionUrl, policy);
    await fetcher.recordParseResult(first, "parsed", policy);
    now += 1100;
    const validated = await fetcher.fetchPage(competitionUrl, policy);
    assert.equal(validated.metadata.retrievalMode, "revalidated");
    assert.equal(validated.metadata.sourceFetchedAt, first.metadata.sourceFetchedAt);
    assert.notEqual(validated.metadata.fetchedAt, first.metadata.fetchedAt);
    assert.equal(validated.html, first.html);
    await fetcher.recordParseResult(validated, "parsed", policy);
    now += 100;
    assert.equal((await fetcher.fetchPage(competitionUrl, policy)).metadata.retrievalMode, "cache");
    assert.equal(calls, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("corrupt cached bytes are recovered with an unconditional network fetch", async () => {
  const directory = await mkdtemp(join(tmpdir(), "statsarena-corrupt-cache-"));
  try {
    const store = new SnapshotStore(directory);
    let calls = 0;
    const fetcher = new HtmlFetcher({ snapshotStore: store, retries: 0,
      fetchImpl: async (_, init) => {
        calls++;
        assert.equal(new Headers(init?.headers).get("if-none-match"), null);
        return new Response("<html>repair</html>", { headers: { etag: "repair", "content-type": "text/html" } });
      }
    });
    const policy = { maxAgeMs: 60_000 };
    const first = await fetcher.fetchPage(competitionUrl, policy);
    await fetcher.recordParseResult(first, "parsed", policy);
    const entry = await store.getEntry(competitionUrl);
    assert.ok(entry);
    await writeFile(join(directory, entry.path), "corrupt gzip");
    const repaired = await fetcher.fetchPage(competitionUrl, policy);
    assert.equal(calls, 2);
    assert.equal(repaired.metadata.retrievalMode, "network");
    assert.equal((await store.read(competitionUrl)).html, first.html);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("retry backoff releases concurrency slots, priority wins queued work, and duplicate URLs share a request", async () => {
  const directory = await mkdtemp(join(tmpdir(), "statsarena-priority-"));
  try {
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    let announceFirst: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => { announceFirst = resolve; });
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const fetcher = new HtmlFetcher({ snapshotStore: new SnapshotStore(directory), concurrency: 1, retries: 0,
      fetchImpl: async (input) => {
        const url = String(input);
        order.push(url);
        if (order.length === 1) { announceFirst?.(); await gate; }
        return new Response("<html>priority</html>", { headers: { "content-type": "text/html" } });
      }
    });
    const first = fetcher.fetchPage(competitionUrl, { priority: 10 });
    await firstStarted;
    const backgroundUrl = `${competitionUrl}/teams`;
    const liveUrl = `${competitionUrl}/match/2931666/summary`;
    const background = fetcher.fetchPage(backgroundUrl, { priority: 10 });
    const live = fetcher.fetchPage(liveUrl, { priority: 0 });
    const duplicate = fetcher.fetchPage(liveUrl, { priority: 0 });
    // Let both requests finish cache lookup and join the semaphore queue.
    await new Promise<void>((resolve) => setImmediate(resolve));
    releaseFirst?.();
    await Promise.all([first, background, live, duplicate]);
    assert.deepEqual(order, [competitionUrl, liveUrl, backgroundUrl]);

    let attempts = 0;
    let unblockRetry: (() => void) | undefined;
    let announceBackoff: (() => void) | undefined;
    const backoffStarted = new Promise<void>((resolve) => { announceBackoff = resolve; });
    const retryGate = new Promise<void>((resolve) => { unblockRetry = resolve; });
    const retrying = new HtmlFetcher({ snapshotStore: new SnapshotStore(join(directory, "retry")), concurrency: 1, retries: 1,
      sleep: async () => { announceBackoff?.(); await retryGate; },
      fetchImpl: async (input) => {
        if (String(input) === competitionUrl && ++attempts === 1) return new Response("retry", { status: 503 });
        return new Response("<html>ok</html>", { headers: { "content-type": "text/html" } });
      }
    });
    const slow = retrying.fetchPage(competitionUrl);
    await backoffStarted;
    // This must finish while the retry is blocked in backoff; otherwise a timeout fails the test.
    await retrying.fetchPage(liveUrl, { priority: 0 });
    unblockRetry?.();
    await slow;
    assert.equal(attempts, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("permanent invalid responses are not retried and transport cause codes remain in diagnostics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "statsarena-errors-"));
  try {
    let calls = 0;
    const invalid = new HtmlFetcher({ snapshotStore: new SnapshotStore(directory), retries: 3,
      fetchImpl: async () => { calls++; return new Response("{}", { headers: { "content-type": "application/json" } }); }
    });
    await assert.rejects(invalid.fetchPage(competitionUrl), (error: unknown) => {
      assert.ok(error instanceof FetchError);
      assert.equal(error.metadata.attempts[0]?.errorKind, "invalid_response");
      return true;
    });
    assert.equal(calls, 1);
    const transport = new HtmlFetcher({ snapshotStore: new SnapshotStore(directory), retries: 0,
      fetchImpl: async () => { throw new TypeError("fetch failed", { cause: { code: "ECONNRESET" } }); }
    });
    await assert.rejects(transport.fetchPage(competitionUrl), (error: unknown) => {
      assert.ok(error instanceof FetchError);
      assert.equal(error.metadata.attempts[0]?.errorKind, "network");
      assert.equal(error.metadata.attempts[0]?.errorCode, "ECONNRESET");
      return true;
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("timeout diagnostics distinguish waiting for headers from downloading the body", async () => {
  const directory = await mkdtemp(join(tmpdir(), "statsarena-timeout-"));
  try {
    const requestTimeout = new HtmlFetcher({ snapshotStore: new SnapshotStore(directory), retries: 0, timeoutMs: 10,
      fetchImpl: async (_, init) => new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      })
    });
    await assert.rejects(requestTimeout.fetchPage(competitionUrl), (error: unknown) => {
      assert.ok(error instanceof FetchError);
      assert.equal(error.metadata.attempts[0]?.errorKind, "timeout");
      assert.equal(error.metadata.attempts[0]?.phase, "request");
      return true;
    });
    const bodyTimeout = new HtmlFetcher({ snapshotStore: new SnapshotStore(directory), retries: 0, timeoutMs: 10,
      fetchImpl: async (_, init) => new Response(new ReadableStream<Uint8Array>({
        start(controller) { init?.signal?.addEventListener("abort", () => controller.error(new Error("aborted body")), { once: true }); }
      }), { headers: { "content-type": "text/html" } })
    });
    await assert.rejects(bodyTimeout.fetchPage(competitionUrl), (error: unknown) => {
      assert.ok(error instanceof FetchError);
      assert.equal(error.metadata.attempts[0]?.errorKind, "timeout");
      assert.equal(error.metadata.attempts[0]?.phase, "body");
      return true;
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
