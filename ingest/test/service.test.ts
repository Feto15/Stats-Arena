import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { acquireDirectoryLock, LockBusyError } from "../src/operations/locks.js";
import { runRunnerService, readServiceState, SERVICE_STATE_FILE, parseFullSyncInterval, serviceIsHealthy } from "../src/operations/service.js";

test("service checkpoints successful full cycles, uses incremental, and resumes its schedule after restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "statsarena-service-"));
  try {
    let now = Date.parse("2026-10-13T00:00:00Z");
    const controller = new AbortController(); const strategies: string[] = [];
    await runRunnerService({ snapshotDirectory: directory, intervalSeconds: 900, fullSyncIntervalSeconds: 86400,
      signal: controller.signal, clock: () => now, log: () => undefined,
      runCycle: async strategy => { strategies.push(strategy); return true; },
      wait: async ms => {
        if (strategies.length === 3) controller.abort();
        now += strategies.length === 2 ? 86400000 : ms;
      }
    });
    assert.deepEqual(strategies, ["standard", "incremental", "standard"]);
    const state = await readServiceState(directory);
    assert.equal(state?.lastCycleStatus, "succeeded"); assert.equal(state?.phase, "stopped");
    assert.equal(state?.lastFullCompletedAt, "2026-10-14T00:15:00.000Z");
    assert.equal(serviceIsHealthy(state, now), false);
    const restarted = new AbortController();
    await runRunnerService({ snapshotDirectory: directory, intervalSeconds: 900, fullSyncIntervalSeconds: 86400,
      signal: restarted.signal, clock: () => now, log: () => undefined,
      runCycle: async strategy => { assert.equal(strategy, "incremental"); restarted.abort(); return true; }
    });
    assert.equal((await readServiceState(directory))?.lastFullCompletedAt, state?.lastFullCompletedAt);
    await assert.rejects(readFile(join(directory, ".runner-service.lock/owner.json")), { code: "ENOENT" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("failed or partial full cycles retry without advancing checkpoint, errors redact credentials, and dry-run never advances", async () => {
  const directory = await mkdtemp(join(tmpdir(), "statsarena-service-"));
  try {
    const controller = new AbortController(); const messages: string[] = []; let count = 0;
    await runRunnerService({ snapshotDirectory: directory, intervalSeconds: 30, fullSyncIntervalSeconds: 900,
      signal: controller.signal, log: message => messages.push(message),
      runCycle: async strategy => {
        assert.equal(strategy, "standard"); count += 1;
        if (count === 1) throw new Error("Failed postgresql://USER:SECRET@example.test/db");
        return count === 3;
      },
      wait: async () => {
        const state = await readServiceState(directory);
        if (count < 3) assert.equal(state?.lastFullCompletedAt, null);
        else controller.abort();
      }
    });
    assert.equal(count, 3); assert.ok((await readServiceState(directory))?.lastFullCompletedAt);
    assert.ok(messages.some(message => message.includes("[DATABASE_URL redacted]")));
    assert.ok(messages.every(message => !message.includes("SECRET")));
    const previous = (await readServiceState(directory))?.lastFullCompletedAt;
    const dry = new AbortController();
    await runRunnerService({ snapshotDirectory: directory, intervalSeconds: 30, fullSyncIntervalSeconds: 900,
      signal: dry.signal, dryRun: true, snapshotOnly: true, log: () => undefined,
      runCycle: async strategy => { assert.equal(strategy, "standard"); return true; }, wait: async () => dry.abort() });
    assert.equal((await readServiceState(directory))?.lastFullCompletedAt, previous);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("service excludes concurrent owners, publishes liveness, and finishes the current cycle on shutdown", async () => {
  const directory = await mkdtemp(join(tmpdir(), "statsarena-service-"));
  const controller = new AbortController();
  let finish: () => void = () => undefined; let started: () => void = () => undefined;
  const running = new Promise<void>(resolve => { started = resolve; });
  const blocked = new Promise<void>(resolve => { finish = resolve; });
  const options = { snapshotDirectory: directory, intervalSeconds: 30, fullSyncIntervalSeconds: 900,
    signal: controller.signal, log: () => undefined, runCycle: async () => { started(); await blocked; return true; } };
  const service = runRunnerService(options);
  try {
    await running;
    const state = await readServiceState(directory);
    assert.equal(state?.phase, "running"); assert.equal(serviceIsHealthy(state), true);
    assert.equal(serviceIsHealthy(state, Date.now() + 180000), false);
    await assert.rejects(runRunnerService(options), LockBusyError);
    controller.abort(); finish(); await service;
    assert.equal((await readServiceState(directory))?.lastFullCompletedAt, null);
    assert.equal((await readServiceState(directory))?.phase, "stopped");
  } finally { controller.abort(); finish(); await service; await rm(directory, { recursive: true, force: true }); }
});

test("service bounds intervals and rejects damaged/future checkpoints", async () => {
  const directory = await mkdtemp(join(tmpdir(), "statsarena-service-"));
  try {
    assert.equal(parseFullSyncInterval(undefined), 86400);
    assert.throws(() => parseFullSyncInterval("0")); assert.throws(() => parseFullSyncInterval("604801"));
    const options = { snapshotDirectory: directory, intervalSeconds: 30, fullSyncIntervalSeconds: 900,
      signal: new AbortController().signal, log: () => undefined, runCycle: async () => true };
    await writeFile(join(directory, SERVICE_STATE_FILE), "broken");
    await assert.rejects(runRunnerService(options), /Checkpoint runner tidak valid/);
    await writeFile(join(directory, SERVICE_STATE_FILE), JSON.stringify({ version: 1, heartbeatAt: "2099-01-01T00:00:00.000Z",
      phase: "waiting", strategy: "standard", lastFullCompletedAt: "2099-01-01T00:00:00.000Z", lastCycleStartedAt: null,
      lastCycleFinishedAt: null, lastCycleStatus: null, nextCycleAt: null }));
    await assert.rejects(runRunnerService(options), /masa depan/);
    await assert.rejects(runRunnerService({ ...options, snapshotOnly: true }), /dry-run/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("expired container locks recover when the restarted process reuses hostname and PID", async () => {
  const directory = await mkdtemp(join(tmpdir(), "statsarena-service-lock-"));
  try {
    await writeFile(join(directory, "owner.json"), JSON.stringify({ ownerId: randomUUID(), hostname: hostname(), processId: process.pid,
      acquiredAt: "1970-01-01T00:00:00Z", heartbeatAt: "1970-01-01T00:00:00Z", processIdentity: "previous-container-process" }));
    const lock = await acquireDirectoryLock(directory, randomUUID(), 1000);
    await lock.assertOwned();
    await assert.rejects(acquireDirectoryLock(directory, randomUUID(), 1000), LockBusyError);
    await lock.release();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
