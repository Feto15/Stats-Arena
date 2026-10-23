import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { rebuildCompetitionCatalog, updateAnalysisCatalog, updateCompetitionCatalog, updateLiveStatsCatalog, type CatalogOptions } from "../src/operations/competition-catalog.js";
import { writeOperationAudit } from "../src/operations/audit-storage.js";
import { runCompetitionSync } from "../src/operations/runner.js";
import { HtmlFetcher } from "../src/fetch/fetcher.js";
import { SnapshotStore } from "../src/fetch/snapshots.js";
import { loadHtmlFixture } from "./fixtures.js";
import { LiveStatsClient } from "../src/livestats/client.js";
import { liveStatsPageUrl } from "../src/livestats/source.js";
import { findLiveStatsFiles } from "../src/livestats/catalog.js";
import { gunzipSync } from "node:zlib";

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "statsarena-catalog-"));
  const directory = join(root, "ingest/audit");
  await mkdir(directory, { recursive: true });
  const options: CatalogOptions = { path: join(root, "ingest/config/competitions_catalog.json"),
    projectRoot: root, snapshotDirectory: join(root, "ingest/snapshots") };
  return { root, directory, options };
}
function audit(id: string, name: string, second = 1, namespace = "IBF") {
  return { mode: "once", sourceUrl: `https://hosted.dcd.shared.geniussports.com/${namespace}/en/competition/${id}`,
    createdAt: new Date(second * 1000).toISOString(), parserVersion: "test", parseCounts: { matches: 1 },
    imported: { status: "succeeded" }, fetches: [], issues: [],
    data: { competition: { name, sourceId: id, season: null, year: null }, teams: [], players: [], groups: [],
      matches: [{ fixture: { sourceId: "100" }, playByPlay: { records: [{ actionText: "Substitution out" }] } }] } };
}
async function readCatalog(options: CatalogOptions) { return JSON.parse(await readFile(options.path, "utf8")); }

test("catalog indexes full/summary/delta audits, preserves annotations and separates attempts from committed imports", async () => {
  const { root, directory, options } = await setup();
  try {
    await mkdir(join(root, "ingest/config"), { recursive: true });
    const first = audit("49607", "(M) DBL DI JOGJAKARTA SERIES");
    await writeFile(options.path, JSON.stringify({ version: 1, total: 99, custom: "keep", competitions: [{
      id: "49607", name: "Old", sourceUrl: first.sourceUrl, region: "Wilayah manual", notes: "Catatan pengguna" }] }));
    const path = join(directory, "first.json");
    await writeOperationAudit(path, first, "auto");
    await updateCompetitionCatalog(options, path);
    let catalog = await readCatalog(options);
    let entry = catalog.competitions[0];
    assert.equal(catalog.total, 1);
    assert.equal(catalog.custom, "keep");
    assert.equal(entry.name, first.data.competition.name);
    assert.equal(entry.region, "Wilayah manual");
    assert.equal(entry.notes, "Catatan pengguna");
    assert.equal(entry.genderLabel, "Putra");
    assert.equal(entry.latestAuditType, "full");
    assert.equal(entry.latestParseCounts, undefined);
    assert.equal(entry.latestSuccessfulAuditPath, "ingest/audit/first.json");
    assert.equal(catalog.dataLocations.snapshotIndexFile, "ingest/snapshots/index.json");
    assert.equal(catalog.dataLocations.datasetIndexFile, "ingest/audit/.audit-storage.json");

    const same = join(directory, "same.json");
    await writeOperationAudit(same, audit("49607", first.data.competition.name, 2), "auto");
    await updateCompetitionCatalog(options, same);
    entry = (await readCatalog(options)).competitions[0];
    assert.equal(entry.latestAuditType, "summary");
    const state = JSON.parse(await readFile(join(directory, ".audit-storage.json"), "utf8"));
    assert.equal(state.datasets["49607:match:100"][0].file, "first.json");

    const changed = audit("49607", first.data.competition.name, 3);
    changed.data.matches[0]!.playByPlay.records[0]!.actionText = "Substitution in";
    const delta = join(directory, "delta.json");
    await writeOperationAudit(delta, changed, "auto");
    await updateCompetitionCatalog(options, delta);
    entry = (await readCatalog(options)).competitions[0];
    assert.equal(entry.latestAuditType, "delta");

    const failed = join(directory, "failed.json");
    await writeOperationAudit(failed, { ...audit("49607", "Same", 4), mode: "failed", imported: null, data: null });
    await updateCompetitionCatalog(options, failed);
    entry = (await readCatalog(options)).competitions[0];
    assert.equal(entry.latestAuditFile, "failed.json");
    assert.equal(entry.latestSuccessfulAuditPath, "ingest/audit/delta.json");
    assert.equal(entry.name, first.data.competition.name);

    const dry = join(directory, "dry.json");
    await writeOperationAudit(dry, { ...audit("49607", first.data.competition.name, 5), mode: "dry-run", imported: null });
    await updateCompetitionCatalog(options, dry);
    await updateCompetitionCatalog(options, path); // An older process must not move the pointer back.
    catalog = await readCatalog(options);
    assert.equal(catalog.competitions[0].latestAuditMode, "dry-run");
    assert.equal(catalog.competitions[0].latestSuccessfulAuditPath, "ingest/audit/delta.json");
    await mkdir(join(directory, "analysis"));
    const analysisPath = join(directory, "analysis/49607.json");
    await writeFile(analysisPath, JSON.stringify({ format: "statsarena-analysis", competition: { sourceUrl: first.sourceUrl, name: first.data.competition.name } }));
    await updateAnalysisCatalog(options, analysisPath);
    catalog = await readCatalog(options);
    assert.equal(catalog.competitions[0].analysisFile, "ingest/audit/analysis/49607.json");
    assert.equal(catalog.competitions[0].notes, "Catatan pengguna");
    assert.equal(catalog.competitions[0].latestAuditFile, "dry.json");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("concurrent writers preserve both namespaces; rebuild recovers local history without inventing region or year", async () => {
  const { root, directory, options } = await setup();
  try {
    const first = join(directory, "ibf.json"); const second = join(directory, "ibl.json");
    await writeFile(first, JSON.stringify(audit("123", "(F) Example")));
    await writeFile(second, JSON.stringify(audit("123", "IBL Example", 2, "IBL")));
    await Promise.all([updateCompetitionCatalog(options, first), updateCompetitionCatalog(options, second)]);
    let catalog = await readCatalog(options);
    assert.deepEqual(catalog.competitions.map((entry: { sourceUrl: string }) => entry.sourceUrl), [audit("123", "").sourceUrl, audit("123", "", 2, "IBL").sourceUrl]);
    assert.equal(catalog.competitions[0].genderLabel, "Putri");
    assert.equal(catalog.competitions[1].region, null);
    assert.equal(catalog.competitions[1].year, undefined);
    assert.equal(catalog.competitions[1].gender, undefined);
    await writeFile(join(directory, "corrupt.json"), "invalid json");
    await writeFile(join(directory, "maintenance.json"), JSON.stringify({ total: 42 }));
    await rm(options.path);
    const result = await rebuildCompetitionCatalog(options, directory);
    catalog = await readCatalog(options);
    assert.equal(result.total, 2);
    assert.equal(result.auditsRead, 2);
    assert.deepEqual(result.skipped, ["corrupt.json"]);
    assert.equal(catalog.competitions[0].latestAuditFile, "ibf.json");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("invalid catalogs and symlinks are rejected without overwriting user data", async () => {
  const { root, directory, options } = await setup();
  try {
    const path = join(directory, "first.json");
    await writeFile(path, JSON.stringify(audit("123", "Example")));
    await mkdir(join(root, "ingest/config"), { recursive: true });
    await writeFile(options.path, "broken catalog");
    await assert.rejects(updateCompetitionCatalog(options, path));
    assert.equal(await readFile(options.path, "utf8"), "broken catalog");
    const target = join(root, "target.json");
    await writeFile(target, "protected");
    await rm(options.path);
    await symlink(target, options.path);
    await assert.rejects(updateCompetitionCatalog(options, path));
    assert.equal(await readFile(target, "utf8"), "protected");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("sync automatically indexes both a parsed dry-run and a later fetch failure", async () => {
  const { root, directory, options } = await setup();
  const sourceUrl = "https://hosted.dcd.shared.geniussports.com/IBF/en/competition/49607";
  try {
    let fail = false;
    const fetcher = new HtmlFetcher({ snapshotStore: new SnapshotStore(options.snapshotDirectory), retries: 0,
      fetchImpl: async input => {
        if (fail) throw new Error("Test network failure");
        const url = new URL(String(input));
        let html = `<h1 class="competition-title">Catalog Cup</h1><article class="scheduled">
          <a href="${sourceUrl}/match/2931666/preview">Game</a>
          <a href="${sourceUrl}/team/146118">Home</a><a href="${sourceUrl}/team/154596">Away</a></article>`;
        if (url.pathname.endsWith("/teams")) html = loadHtmlFixture("49607-teams.html.gz");
        if (url.pathname.endsWith("/players")) html = loadHtmlFixture("49607-players.html.gz");
        if (url.pathname.endsWith("/standings")) html = url.search
          ? loadHtmlFixture("49607-group-a.html.gz") : `<a href="${sourceUrl}/standings?poolNumber=9">GROUP A</a>`;
        return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
      } });
    const run = (file: string) => runCompetitionSync({ input: sourceUrl, snapshotDirectory: options.snapshotDirectory,
      lockRoot: join(root, "locks"), auditPath: () => join(directory, file), dryRun: true,
      forceRefresh: true, fetcher, catalog: options });
    const result = await run("parsed.json");
    assert.ok((result.timings["pipelineMs"] ?? -1) >= 0);
    assert.ok((result.timings["auditMs"] ?? -1) >= 0);
    assert.ok((result.timings["totalMs"] ?? -1) >= (result.timings["pipelineMs"] ?? 0));
    const storedAudit = JSON.parse(await readFile(join(directory, "parsed.json"), "utf8"));
    assert.equal(storedAudit.timings.pipelineMs, result.timings["pipelineMs"]);
    assert.ok(result.analysis?.path.endsWith("49607.preview.json"));
    assert.ok(result.analysis);
    const analysis = JSON.parse(await readFile(result.analysis.path, "utf8"));
    assert.equal(analysis.games.length, 1);
    assert.equal(analysis.players.length, 0); // Scheduled games do not become zero-stat analytics.
    await assert.rejects(readFile(join(directory, "analysis/49607.json")));
    let entry = (await readCatalog(options)).competitions[0];
    assert.equal(entry.name, "Catalog Cup");
    assert.equal(entry.latestAuditMode, "dry-run");
    assert.equal(entry.latestSuccessfulImportAt, undefined);
    fail = true;
    await assert.rejects(run("failed.json"));
    entry = (await readCatalog(options)).competitions[0];
    assert.equal(entry.latestAuditMode, "failed");
    assert.equal(entry.latestAuditFile, "failed.json");
    assert.equal(entry.name, "Catalog Cup");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("LiveStats catalog links actual JSON aliases by game, rejects wrong scopes and removes stale files on rebuild", async () => {
  const { root, directory, options } = await setup();
  try {
    const cache = join(options.snapshotDirectory, "livestats");
    const samples = [["49607", "2931666", "IBF"], ["49609", "2915281", "IBF"], ["47793", "2783625", "IBL"]] as const;
    for (const [id, gameId, namespace] of samples) {
      const source = audit(id, `Example ${id}`, 1, namespace);
      const path = join(directory, `${id}.json`);
      await writeFile(path, JSON.stringify(source));
      await updateCompetitionCatalog(options, path);
      const fixture = async (file: string) => gunzipSync(await readFile(new URL(`fixtures/livestats-2026-10-16/${file}`, import.meta.url))).toString("utf8");
      const client = new LiveStatsClient(cache, async input => new Response(String(input).endsWith(".json")
        ? await fixture(`${gameId}.json.gz`)
        : (await fixture("2931666-bs.html.gz")).replaceAll("2931666", gameId).replaceAll("49607", id).replaceAll("/u/IBF/", `/u/${namespace}/`)), async () => undefined);
      const page = await client.get(liveStatsPageUrl(source.sourceUrl, gameId));
      const json = await client.get(`https://fibalivestats.dcd.shared.geniussports.com/data/${gameId}/data.json`);
      if (namespace === "IBF") { await client.accept(page); await client.accept(json); }
      await updateLiveStatsCatalog(options, source.sourceUrl, [gameId]);
      const entry = (await readCatalog(options)).competitions.find((entry: { sourceUrl: string }) => entry.sourceUrl === source.sourceUrl);
      assert.equal(entry.latestAuditFile, `${id}.json`);
      assert.match(entry.liveStatsFiles[gameId], namespace === "IBF" ? /\.current\.json\.gz$/ : /\.attempt\.json\.gz$/);
      assert.ok(await readFile(join(root, entry.liveStatsFiles[gameId])));
      assert.equal(entry.dataLocations, undefined);
    }
    const wrongCompetition = await findLiveStatsFiles(cache, audit("999", "").sourceUrl, ["2931666"]);
    assert.equal(wrongCompetition.files["2931666"], null);
    const wrongNamespace = await findLiveStatsFiles(cache, audit("49607", "", 1, "IBL").sourceUrl, ["2931666"]);
    assert.equal(wrongNamespace.files["2931666"], null);
    const rebuilt = await rebuildCompetitionCatalog(options, directory);
    assert.equal(rebuilt.liveStatsFiles, 3);
    let catalog = await readCatalog(options);
    for (const entry of catalog.competitions) assert.equal(Object.keys(entry.liveStatsFiles).length, 1);
    await rm(cache, { recursive: true });
    await rebuildCompetitionCatalog(options, directory);
    catalog = await readCatalog(options);
    for (const entry of catalog.competitions) assert.deepEqual(entry.liveStatsFiles, {});
  } finally { await rm(root, { recursive: true, force: true }); }
});
