import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { SnapshotStore } from "../src/fetch/snapshots.js";
import { compactStorage, parsedDataHash, writeOperationAudit } from "../src/operations/audit-storage.js";
import { targetedRetryUrls } from "../src/operations/targeted-retry.js";
import { acquireDirectoryLock, snapshotLockPath } from "../src/operations/locks.js";
import { randomUUID } from "node:crypto";

const rootUrl = "https://hosted.dcd.shared.geniussports.com/IBF/en/competition/49607";
const matchUrl = `${rootUrl}/match/2931666/boxscore`;
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "statsarena-audit-storage-"));
  const auditDirectory = join(root, "audit"); const snapshotDirectory = join(root, "snapshots");
  await mkdir(auditDirectory); await mkdir(snapshotDirectory);
  return { root, auditDirectory, snapshotDirectory };
}
async function page(directory: string, version: number) {
  const store = new SnapshotStore(directory);
  const saved = await store.write(matchUrl, `<html>valid source ${version}</html>`, { fetchedAt: new Date(1000 * version).toISOString(), httpStatus: 200, responseBytes: 30, etag: null, lastModified: null });
  await store.markParsed(matchUrl, saved.sha256, "parsed", "0.2.2");
  return { requestUrl: matchUrl, sha256: saved.sha256, snapshotPath: saved.path, fetchStatus: "succeeded", parseStatus: "parsed", fetchedAt: new Date(1000 * version).toISOString() };
}
function audit<T>(version: number, fetch: T, score = version) {
  return { sourceCompetitionId: "49607", createdAt: new Date(1000 * version).toISOString(), mode: "once", parserVersion: "0.2.2",
    imported: { status: "succeeded", counts: {} }, fetches: [fetch], issues: [],
    data: { competition: { sourceId: "49607", name: "Example" }, teams: [{ sourceId: "team", name: "Team" }], players: [], groups: [],
      matches: [{ fixture: { sourceId: "2931666", score }, events: [{ sourceSequence: 0, text: "Shot" }] }] } };
}
async function json(path: string) { return JSON.parse(await readFile(path, "utf8")); }

test("auto audits compare parsed datasets, retain exact hash references, and only include changed matches", async () => {
  const dirs = await setup();
  try {
    const first = audit(1, await page(dirs.snapshotDirectory, 1));
    const initial = await writeOperationAudit(join(dirs.auditDirectory, "first.json"), first, "auto");
    assert.equal(initial.auditType, "full");
    const same = audit(2, await page(dirs.snapshotDirectory, 2), 1); // HTML changed, stats did not.
    assert.equal((await writeOperationAudit(join(dirs.auditDirectory, "same.json"), same, "auto")).auditType, "summary");
    const summary = await json(join(dirs.auditDirectory, "same.json"));
    assert.equal(summary.data, null);
    assert.equal(summary.changedData, undefined);
    assert.equal(summary.datasetReferences["49607:match:2931666"].file, "first.json");
    assert.equal(summary.snapshotReferences[0].sha256, same.fetches[0]?.sha256);
    const changed = audit(3, await page(dirs.snapshotDirectory, 3));
    assert.equal((await writeOperationAudit(join(dirs.auditDirectory, "changed.json"), changed, "auto")).auditType, "delta");
    const delta = await json(join(dirs.auditDirectory, "changed.json"));
    assert.deepEqual(Object.keys(delta.changedData), ["49607:match:2931666"]);
    assert.equal(delta.datasetReferences["49607:teams"].file, "first.json");
    const failed = { ...audit(4, changed.fetches[0], 99), mode: "failed", imported: null, error: "transaction rollback" };
    assert.equal((await writeOperationAudit(join(dirs.auditDirectory, "failed.json"), failed, "auto")).auditType, "full");
    assert.ok((await json(join(dirs.auditDirectory, "failed.json"))).data.matches.length);
    assert.equal((await writeOperationAudit(join(dirs.auditDirectory, "after-failure.json"), changed, "auto")).auditType, "summary");
    const stateBefore = await readFile(join(dirs.auditDirectory, ".audit-storage.json"), "utf8");
    await writeOperationAudit(join(dirs.auditDirectory, "dry-run.json"), { ...audit(5, changed.fetches[0]), mode: "dry-run", imported: null }, "auto");
    assert.equal(await readFile(join(dirs.auditDirectory, ".audit-storage.json"), "utf8"), stateBefore);
    assert.equal(parsedDataHash({ b: 0, a: null }), parsedDataHash({ a: null, b: 0 }));
    assert.equal((await writeOperationAudit(join(dirs.auditDirectory, "livestats-failure.json"), {
      ...same, liveStats: { games: [{ sourceGameId: "2931666", status: "fetch_failed" }] }
    }, "auto")).auditType, "full");
    assert.notEqual(parsedDataHash({ a: null }), parsedDataHash({ a: 0 }));
    assert.notEqual(parsedDataHash([1, 2]), parsedDataHash([2, 1]));
  } finally { await rm(dirs.root, { recursive: true, force: true }); }
});

test("audit baselines isolate IBL and IBF when numeric competition and match IDs coincide", async () => {
  const dirs = await setup();
  try {
    const ibf = { ...audit(1, undefined), fetches: [], sourceUrl: rootUrl };
    const ibl = { ...audit(2, undefined), fetches: [], sourceUrl: rootUrl.replace("/IBF/", "/IBL/") };
    assert.equal((await writeOperationAudit(join(dirs.auditDirectory, "ibf.json"), ibf, "auto")).auditType, "full");
    assert.equal((await writeOperationAudit(join(dirs.auditDirectory, "ibl.json"), ibl, "auto")).auditType, "full");
    const state = await json(join(dirs.auditDirectory, ".audit-storage.json"));
    assert.equal(state.datasets["49607:competition"][0].file, "ibf.json");
    assert.equal(state.datasets["IBL:49607:competition"][0].file, "ibl.json");
    assert.equal((await writeOperationAudit(join(dirs.auditDirectory, "ibl-repeat.json"), ibl, "auto")).auditType, "summary");
  } finally { await rm(dirs.root, { recursive: true, force: true }); }
});

test("compaction retains two valid versions, leaves checkpoints alone, and is idempotent", async () => {
  const dirs = await setup();
  try {
    const hashes: string[] = [];
    for (let version = 1; version <= 4; version++) {
      const fetch = await page(dirs.snapshotDirectory, version); hashes.push(fetch.sha256);
      await writeOperationAudit(join(dirs.auditDirectory, `${version}.json`), audit(version, fetch), "full");
    }
    await writeFile(join(dirs.snapshotDirectory, ".fixture-pages-49607.json"), "checkpoint");
    const before = await readFile(join(dirs.auditDirectory, "1.json"), "utf8");
    const preview = await compactStorage({ ...dirs, dryRun: true });
    assert.equal(preview.auditsCompacted, 2); assert.equal(preview.snapshotsDeleted, 2);
    assert.equal(await readFile(join(dirs.auditDirectory, "1.json"), "utf8"), before);
    const applied = await compactStorage(dirs);
    assert.equal(applied.auditsCompacted, 2); assert.equal(applied.snapshotsDeleted, 2);
    assert.equal((await json(join(dirs.auditDirectory, "1.json"))).payloadStatus, "expired");
    assert.equal((await json(join(dirs.auditDirectory, "3.json"))).data.matches[0].fixture.score, 3);
    assert.ok((await readdir(dirs.snapshotDirectory)).includes(`${hashes[2]}.html.gz`));
    assert.ok((await readdir(dirs.snapshotDirectory)).includes(`${hashes[3]}.html.gz`));
    assert.equal(await readFile(join(dirs.snapshotDirectory, ".fixture-pages-49607.json"), "utf8"), "checkpoint");
    assert.equal((await new SnapshotStore(dirs.snapshotDirectory).read(matchUrl)).html, "<html>valid source 4</html>");
    const twice = await compactStorage(dirs);
    assert.equal(twice.auditsCompacted, 0); assert.equal(twice.snapshotsDeleted, 0);
  } finally { await rm(dirs.root, { recursive: true, force: true }); }
});

test("archives and unresolved failures keep payloads, snapshots, and targeted retry evidence", async () => {
  const dirs = await setup();
  try {
    const archived = await page(dirs.snapshotDirectory, 1);
    await writeOperationAudit(join(dirs.auditDirectory, "archive.json"), audit(1, archived), "archive");
    const bad = await page(dirs.snapshotDirectory, 2);
    const failed = { ...audit(2, { ...bad, parseStatus: "partial" }), imported: { status: "partial" }, issues: [{ severity: "error", sourceUrl: matchUrl, code: "MISSING" }] };
    await writeOperationAudit(join(dirs.auditDirectory, "partial.json"), failed, "auto");
    const otherUrl = `${rootUrl}/players`;
    for (let version = 3; version <= 5; version++) {
      const fetch = { ...await page(dirs.snapshotDirectory, version), requestUrl: otherUrl };
      await writeOperationAudit(join(dirs.auditDirectory, `${version}.json`), audit(version, fetch));
    }
    await compactStorage(dirs);
    assert.equal((await json(join(dirs.auditDirectory, "archive.json"))).auditType, "archive");
    assert.ok((await json(join(dirs.auditDirectory, "partial.json"))).data);
    assert.deepEqual(targetedRetryUrls(await json(join(dirs.auditDirectory, "partial.json")), "49607"), [matchUrl]);
    assert.ok((await readdir(dirs.snapshotDirectory)).includes(`${bad.sha256}.html.gz`));
    assert.ok((await readdir(dirs.snapshotDirectory)).includes(`${archived.sha256}.html.gz`));
  } finally { await rm(dirs.root, { recursive: true, force: true }); }
});

test("cleanup refuses corrupt metadata and corrupt current HTML before any deletion", async () => {
  const dirs = await setup();
  try {
    const fetch = await page(dirs.snapshotDirectory, 1);
    await writeOperationAudit(join(dirs.auditDirectory, "first.json"), audit(1, fetch));
    await page(dirs.snapshotDirectory, 2);
    const names = await readdir(dirs.snapshotDirectory);
    await writeFile(join(dirs.auditDirectory, ".audit-storage.json"), "invalid");
    await assert.rejects(compactStorage(dirs));
    assert.deepEqual(await readdir(dirs.snapshotDirectory), names);
    await rm(join(dirs.auditDirectory, ".audit-storage.json"));
    const index = await json(join(dirs.snapshotDirectory, "index.json"));
    await writeFile(join(dirs.snapshotDirectory, index[matchUrl].path), "corrupt gzip");
    await assert.rejects(compactStorage(dirs));
    assert.deepEqual(await readdir(dirs.snapshotDirectory), names);
    assert.ok((await json(join(dirs.auditDirectory, "first.json"))).data);
  } finally { await rm(dirs.root, { recursive: true, force: true }); }
});

test("storage cleanup honors active runner locks and skips symlink candidates", async () => {
  const dirs = await setup();
  try {
    await page(dirs.snapshotDirectory, 1);
    const lock = await acquireDirectoryLock(snapshotLockPath(dirs.snapshotDirectory), randomUUID());
    await assert.rejects(compactStorage(dirs), /Lock sedang dipakai/);
    await lock.release();
    const external = join(dirs.root, "external.txt"); await writeFile(external, "keep");
    const fake = `${"a".repeat(64)}.html.gz`;
    await symlink(external, join(dirs.snapshotDirectory, fake));
    const result = await compactStorage(dirs);
    assert.ok(result.skippedFiles.includes(fake));
    assert.equal(await readFile(external, "utf8"), "keep");
    await symlink(dirs.snapshotDirectory, join(dirs.root, "alias"));
    await assert.rejects(compactStorage({ ...dirs, snapshotDirectory: join(dirs.root, "alias") }), /symlink/);
  } finally { await rm(dirs.root, { recursive: true, force: true }); }
});

test("delta retention preserves references across cleanup and refuses a missing baseline", async () => {
  const dirs = await setup();
  try {
    for (let version = 1; version <= 4; version++) {
      await writeOperationAudit(join(dirs.auditDirectory, `${version}.json`), audit(version, await page(dirs.snapshotDirectory, version)), "auto");
    }
    await compactStorage(dirs);
    assert.equal((await json(join(dirs.auditDirectory, "2.json"))).payloadStatus, "expired");
    assert.ok((await json(join(dirs.auditDirectory, "1.json"))).data.teams);
    assert.equal((await json(join(dirs.auditDirectory, "3.json"))).changedData["49607:match:2931666"].fixture.score, 3);
    const latest = audit(5, await page(dirs.snapshotDirectory, 5), 4);
    assert.equal((await writeOperationAudit(join(dirs.auditDirectory, "same.json"), latest, "auto")).auditType, "summary");
    const refs = (await json(join(dirs.auditDirectory, "same.json"))).datasetReferences;
    assert.equal(refs["49607:teams"].file, "1.json");
    assert.equal(refs["49607:match:2931666"].file, "4.json");
    const before = await readdir(dirs.snapshotDirectory);
    await rm(join(dirs.auditDirectory, "1.json"));
    await assert.rejects(compactStorage(dirs), /Payload audit/);
    assert.deepEqual(await readdir(dirs.snapshotDirectory), before);
  } finally { await rm(dirs.root, { recursive: true, force: true }); }
});

test("failures without a source URL remain full until a successful import", async () => {
  const dirs = await setup();
  try {
    const fetch = await page(dirs.snapshotDirectory, 1);
    await writeOperationAudit(join(dirs.auditDirectory, "initial.json"), audit(1, fetch), "auto");
    await writeOperationAudit(join(dirs.auditDirectory, "failed.json"), { ...audit(2, fetch, 99), fetches: [], imported: null, error: "Rollback" }, "auto");
    await compactStorage(dirs);
    assert.ok((await json(join(dirs.auditDirectory, "failed.json"))).data);
    await writeOperationAudit(join(dirs.auditDirectory, "recovered.json"), audit(3, fetch, 1), "auto");
    await compactStorage(dirs);
    assert.equal((await json(join(dirs.auditDirectory, "failed.json"))).payloadStatus, "expired");
  } finally { await rm(dirs.root, { recursive: true, force: true }); }
});

test("reused audit output paths preserve the referenced previous payload", async () => {
  const dirs = await setup();
  try {
    const path = join(dirs.auditDirectory, "fixed.json"); const fetch = await page(dirs.snapshotDirectory, 1);
    await writeOperationAudit(path, audit(1, fetch), "auto");
    await writeOperationAudit(path, audit(2, fetch, 1), "auto");
    const current = await json(path);
    assert.equal(current.auditType, "summary");
    const reference = current.datasetReferences["49607:match:2931666"];
    assert.notEqual(reference.file, "fixed.json");
    assert.equal((await json(join(dirs.auditDirectory, reference.file))).data.matches[0].fixture.score, 1);
    await compactStorage(dirs);
    assert.ok((await json(join(dirs.auditDirectory, reference.file))).data);
  } finally { await rm(dirs.root, { recursive: true, force: true }); }
});
