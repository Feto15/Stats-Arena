import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { randomUUID } from "node:crypto";
import type { StatsArenaDatabase } from "@statsarena/db";
import { schema, syncLeases, syncRuns } from "@statsarena/db/schema";
import { fileURLToPath } from "node:url";
import { parseCompetitionConfig, parseSyncIntervalSeconds } from "../src/operations/config.js";
import { acquireDirectoryLock, LockBusyError } from "../src/operations/locks.js";
import { acquireSyncLease, SyncLeaseBusyError } from "../src/operations/lease.js";
import { abortableWait, runPeriodicCycles } from "../src/operations/runner.js";
import { MAX_TARGETED_RETRY_URLS, targetedRetryUrls } from "../src/operations/targeted-retry.js";

const base = "https://hosted.dcd.shared.geniussports.com/IBF/en/competition/70001";

test("active competition configuration normalizes IDs, rejects duplicates, and bounds interval", () => {
  assert.deepEqual(parseCompetitionConfig({ version: 1, competitions: [
    { sourceUrl: "70001", active: true },
    { sourceUrl: `${base}/teams`, active: false }
  ] }), [{ sourceUrl: base, sourceCompetitionId: "70001" }]);
  assert.throws(() => parseCompetitionConfig({ version: 1, competitions: [
    { sourceUrl: "70001", active: true }, { sourceUrl: base, active: true }
  ] }), /muncul lebih dari sekali/);
  assert.equal(parseSyncIntervalSeconds(undefined), 900);
  assert.equal(parseSyncIntervalSeconds("120"), 120);
  assert.throws(() => parseSyncIntervalSeconds("1"), /30–86400/);
});

test("targeted retry keeps to same-competition failed/partial source URLs and enforces the URL bound", () => {
  const audit = {
    fetches: [
      { requestUrl: `${base}/match/83001/playbyplay`, fetchStatus: "succeeded", parseStatus: "partial" },
      { requestUrl: `${base}/match/83002/boxscore`, fetchStatus: "failed", parseStatus: "failed" },
      { requestUrl: `${base}/match/83003/boxscore`, fetchStatus: "succeeded", parseStatus: "parsed" },
      { requestUrl: "https://example.com/IBF/en/competition/70001/match/83004/summary", fetchStatus: "failed", parseStatus: "failed" },
      { requestUrl: "https://hosted.dcd.shared.geniussports.com/IBF/en/competition/70002/match/83005/summary", fetchStatus: "failed", parseStatus: "failed" }
    ],
    issues: [{ sourceUrl: `${base}/match/83001/playbyplay`, severity: "error" }]
  };
  assert.deepEqual(targetedRetryUrls(audit, "70001"), [
    `${base}/match/83001/playbyplay`, `${base}/match/83002/boxscore`
  ]);
  const oversized = { fetches: Array.from({ length: MAX_TARGETED_RETRY_URLS + 1 }, (_, index) => ({
    requestUrl: `${base}/match/${83000 + index}/boxscore`, fetchStatus: "failed", parseStatus: "failed"
  })) };
  assert.throws(() => targetedRetryUrls(oversized, "70001"), /dibatasi 25 URL/);
});

test("directory locks exclude parallel owners and recover a dead local process safely", async () => {
  const root = await mkdtemp(join(tmpdir(), "statsarena-lock-"));
  try {
    const lockPath = join(root, "competition.lock");
    const first = await acquireDirectoryLock(lockPath, randomUUID());
    await assert.rejects(acquireDirectoryLock(lockPath, randomUUID()), LockBusyError);
    await first.release();
    const second = await acquireDirectoryLock(lockPath, randomUUID());
    await second.release();

    const stalePath = join(root, "stale.lock");
    await mkdir(stalePath);
    await writeFile(join(stalePath, "owner.json"), JSON.stringify({
      ownerId: "dead-owner", hostname: hostname(),
      processId: 99_999_999, acquiredAt: new Date(Date.now() - 10_000).toISOString(),
      heartbeatAt: new Date(Date.now() - 10_000).toISOString()
    }));
    const recovered = await acquireDirectoryLock(stalePath, randomUUID(), 1_000);
    await recovered.assertOwned();
    await recovered.release();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Neon-style row leases serialize competition runs, expire on crash, and release by owner", async () => {
  const client = new PGlite();
  try {
    await migrate(drizzle(client), {
      migrationsFolder: fileURLToPath(new URL("../../packages/db/drizzle", import.meta.url)),
      migrationsSchema: "statsarena",
      migrationsTable: "__drizzle_migrations"
    });
    const db = drizzle(client, { schema }) as unknown as StatsArenaDatabase;
    const oldOwner = randomUUID();
    const first = await acquireSyncLease(db, "70001", oldOwner, 5_000);
    await assert.rejects(acquireSyncLease(db, "70001", randomUUID(), 5_000), SyncLeaseBusyError);
    await db.insert(syncRuns).values({
      sourceCompetitionId: "70001", ownerId: oldOwner, hostname: "dead-host", processId: 99_999_999,
      mode: "periodic", status: "running", heartbeatAt: new Date(Date.now() - 10_000)
    });
    await db.update(syncLeases).set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(syncLeases.sourceCompetitionId, "70001"));
    const nextOwnerId = randomUUID();
    const next = await acquireSyncLease(db, "70001", nextOwnerId, 5_000);
    await first.release();
    const row = await db.select({ ownerId: syncLeases.ownerId }).from(syncLeases)
      .where(eq(syncLeases.sourceCompetitionId, "70001")).limit(1);
    assert.equal(row[0]?.ownerId, nextOwnerId);
    const orphan = await db.select({ status: syncRuns.status }).from(syncRuns).limit(1);
    assert.equal(orphan[0]?.status, "failed");
    await next.release();
  } finally { await client.close(); }
});

test("periodic cycles wait between sequential runs and stop after signal", async () => {
  const controller = new AbortController();
  let cycles = 0;
  let active = 0;
  let maxActive = 0;
  await runPeriodicCycles(controller.signal, 1, async () => {
    cycles += 1;
    active += 1;
    maxActive = Math.max(maxActive, active);
    await Promise.resolve();
    active -= 1;
    if (cycles === 2) controller.abort();
  }, async () => undefined);
  assert.equal(cycles, 2);
  assert.equal(maxActive, 1);
  await abortableWait(0, controller.signal);
});
