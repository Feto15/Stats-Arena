import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { load } from "cheerio";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import type { StatsArenaDatabase } from "@statsarena/db";
import { schema, sourceFetches, syncRuns } from "@statsarena/db/schema";
import { HtmlFetcher } from "../src/fetch/fetcher.js";
import { SnapshotStore } from "../src/fetch/snapshots.js";
import { importCompetition } from "../src/import/importer.js";
import { syncCompetition } from "../src/pipeline.js";
import { parseFixturePageLinksHtml } from "../src/parsers/fixtures.js";
import { FixturePageCheckpoint } from "../src/operations/fixture-checkpoint.js";
import { SyncOperationError } from "../src/operations/errors.js";
import { runCompetitionSync } from "../src/operations/runner.js";
import { targetedRetryUrls } from "../src/operations/targeted-retry.js";
import { loadHtmlFixture, loadStage5HtmlFixture } from "./fixtures.js";

const root = "https://hosted.dcd.shared.geniussports.com/IBF/en/competition/49607";

test("fixture navigation follows plain schedule URLs and normalizes fragments without crossing competition scope", () => {
  assert.deepEqual(parseFixturePageLinksHtml(`
    <a href="${root}/schedule">Schedule</a><a href="${root}/schedule?">Duplicate</a>
    <a href="${root}/schedule#final">Same page anchor</a><a href="${root}?phase=final">Final</a>
    <a href="https://hosted.dcd.shared.geniussports.com/IBF/en/competition/49609/schedule">Other competition</a>
    <a href="https://example.com/IBF/en/competition/49607/schedule">Other host</a>
    <a href="${root}/teams">Teams</a><a href="${root}?">Root</a>`, root),
  [`${root}/schedule`, `${root}?phase=final`]);
});

test("runner resumes capped fixture queues across processes and discovers a final behind a plain schedule link", async () => {
  const directory = await mkdtemp(join(tmpdir(), "statsarena-fixture-resume-"));
  const previousLimit = process.env["STATSARENA_FIXTURE_PAGE_LIMIT"];
  process.env["STATSARENA_FIXTURE_PAGE_LIMIT"] = "2";
  const competition = "https://hosted.dcd.shared.geniussports.com/IBF/en/competition/70091";
  const calls: string[] = [];
  const game = (id: string) => `<article class="scheduled"><a href="${competition}/match/${id}/preview">Game</a>
    <a href="${competition}/team/70101">Home Team</a><a href="${competition}/team/70102">Away Team</a></article>`;
  const page = (games: string, links = "") => `<h1 class="competition-title">Resume Cup</h1>${games}${links}`;
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url.href);
    const html = url.href === competition ? page(game("71001"), `<a href="${competition}/schedule">Schedule</a>`)
      : url.href === `${competition}/schedule` ? page(game("71001") + game("71002"), `<a href="${competition}/schedule?phase=final">Final</a>`)
        : url.searchParams.get("phase") === "final" ? page(game("71003"))
          : url.pathname.endsWith("/teams") ? `<div class="team-link"><a href="${competition}/team/70101"><span class="team-name">Home Team</span></a></div>`
            : url.pathname.endsWith("/players") ? `<div class="playerblock"><a href="${competition}/person/70201"><span class="player-name">Player</span></a></div>`
              : "<h1>Standings</h1>";
    return new Response(html, { headers: { "content-type": "text/html" } });
  };
  try {
    const run = (cycle: number) => runCompetitionSync({
      input: competition, snapshotDirectory: directory, lockRoot: join(directory, "locks"),
      auditPath: () => join(directory, `cycle-${cycle}.json`), dryRun: true, forceRefresh: true,
      fetcher: new HtmlFetcher({ snapshotStore: new SnapshotStore(directory), retries: 0, fetchImpl })
    });
    const first = await run(1);
    assert.deepEqual(first.result.data.matches.map((match) => match.fixture.sourceId), ["71001", "71002"]);
    assert.equal(first.result.data.issues.filter((entry) => entry.code === "FIXTURE_SCORE_UNAVAILABLE").length, 2);
    assert.deepEqual(first.result.pendingFixturePageUrls, [`${competition}/schedule?phase=final`]);
    assert.ok(first.result.data.issues.some((entry) => entry.code === "FIXTURE_PAGE_LIMIT_REACHED" && entry.severity === "error"));
    const second = await run(2);
    assert.deepEqual(second.result.data.matches.map((match) => match.fixture.sourceId), ["71001", "71003"]);
    assert.ok(calls.includes(`${competition}/schedule?phase=final`));
    const checkpoint = new FixturePageCheckpoint(directory, "70091");
    assert.deepEqual(await checkpoint.read(), [`${competition}/schedule`]);
    await run(3);
    assert.deepEqual(await checkpoint.read(), [`${competition}/schedule?phase=final`]);
  } finally {
    if (previousLimit === undefined) delete process.env["STATSARENA_FIXTURE_PAGE_LIMIT"];
    else process.env["STATSARENA_FIXTURE_PAGE_LIMIT"] = previousLimit;
    await rm(directory, { recursive: true, force: true });
  }
});

test("fixture checkpoints reject foreign URLs, invalid IDs, corrupt files, and oversized state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "statsarena-fixture-checkpoint-"));
  try {
    assert.throws(() => new FixturePageCheckpoint(directory, "../escape"), /ID kompetisi/);
    const checkpoint = new FixturePageCheckpoint(directory, "49607");
    assert.deepEqual(await checkpoint.read(), []);
    await checkpoint.write([`${root}/schedule`, `${root}/schedule`]);
    assert.deepEqual(await checkpoint.read(), [`${root}/schedule`]);
    await assert.rejects(checkpoint.write(["https://hosted.dcd.shared.geniussports.com/IBF/en/competition/49609/schedule"]), /berbeda kompetisi/);
    await writeFile(join(directory, ".fixture-pages-49607.json"), "{}");
    await assert.rejects(checkpoint.read());
    await writeFile(join(directory, ".fixture-pages-49607.json"), " ".repeat(4 * 1024 * 1024 + 1));
    await assert.rejects(checkpoint.read(), /batas ukuran/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

function detailFetcher(store: SnapshotStore, state: { shrinking: boolean; failBox: boolean; playersRequests: number; latestPlayersHtml: string }) {
  return new HtmlFetcher({ snapshotStore: store, retries: 0, fetchImpl: async (input) => {
    const url = new URL(String(input));
    let html: string;
    if (url.href === root) html = `<h1 class="competition-title">Review Source</h1><a href="${root}/statistics/team">Statistics</a>
      <article class="complete"><a href="${root}/match/2931666/summary">Game</a>
      <a href="${root}/team/146118">Home</a><a href="${root}/team/154596">Away</a><span class="score">25–45</span></article>
      <article class="scheduled"><a href="${root}/match/9999999/preview">Future Game</a>
      <a href="${root}/team/146118">Home</a><a href="${root}/team/154596">Away</a></article>`;
    else if (url.pathname.endsWith("/statistics/team")) html = loadStage5HtmlFixture("49607-competition-statistics-team.html.gz");
    else if (url.pathname.endsWith("/teams")) html = loadHtmlFixture("49607-teams.html.gz");
    else if (url.pathname.endsWith("/players")) {
      const $ = load(loadHtmlFixture("49607-players.html.gz"));
      if (state.shrinking) $(".playerblock .playername").first().text(`Review Player ${++state.playersRequests}`);
      html = $.html();
      state.latestPlayersHtml = html;
    }
    else if (url.pathname.endsWith("/standings")) html = url.search
      ? loadHtmlFixture("49607-group-a.html.gz") : `<a href="${root}/standings?poolNumber=9">GROUP A</a>`;
    else if (url.pathname.endsWith("/summary")) html = loadHtmlFixture("49607-2931666-summary.html.gz");
    else if (url.pathname.endsWith("/boxscore")) {
      if (state.failBox) return new Response("unavailable", { status: 503 });
      html = loadHtmlFixture("49607-2931666-boxscore.html.gz");
    }
    else if (url.pathname.endsWith("/playbyplay")) {
      const $ = load(loadStage5HtmlFixture("49607-2931666-playbyplay.html.gz"));
      if (state.shrinking) $("#playbyplay .pbpa").first().remove();
      html = $.html();
    }
    else if (url.pathname.endsWith("/shotchart")) html = loadStage5HtmlFixture("49607-2931666-shotchart.html.gz");
    else if (url.pathname.endsWith("/analysis")) html = loadStage5HtmlFixture("49607-2931666-analysis.html.gz");
    else return new Response("unknown", { status: 404 });
    return new Response(html, { headers: { "content-type": "text/html" } });
  }});
}

test("PBP refresh retains matching source metadata for all refreshed data and respects the match limit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "statsarena-pbp-provenance-"));
  const client = new PGlite();
  const previousTtl = process.env["STATSARENA_CACHE_REGISTRY_MS"];
  const state = { shrinking: false, failBox: false, playersRequests: 0, latestPlayersHtml: "" };
  try {
    await migrate(drizzle(client), { migrationsFolder: fileURLToPath(new URL("../../packages/db/drizzle", import.meta.url)), migrationsSchema: "statsarena", migrationsTable: "__drizzle_migrations" });
    const db = drizzle(client, { schema }) as unknown as StatsArenaDatabase;
    const store = new SnapshotStore(directory);
    const fetcher = detailFetcher(store, state);
    const seed = await syncCompetition(root, { fetcher });
    await importCompetition(db, seed.data, seed.fetches);
    const pbpUrl = seed.fetches.find((entry) => entry.resource === "playbyplay")?.requestUrl;
    assert.ok(pbpUrl);
    await store.invalidate(pbpUrl);
    state.shrinking = true;
    process.env["STATSARENA_CACHE_REGISTRY_MS"] = "0";
    const result = await runCompetitionSync({ input: root, snapshotDirectory: directory, lockRoot: join(directory, "locks"),
      auditPath: () => join(directory, "success.json"), db, fetcher, matchLimit: 1 });
    assert.equal(result.refreshedShrinkingPlayByPlayUrls.length, 1);
    assert.equal(result.result.data.matches.length, 1);
    assert.equal(state.playersRequests, 2);
    assert.equal(result.result.data.players[0]?.name, "Review Player 2");
    const playerFetches = result.result.fetches.filter((entry) => entry.resource === "players");
    assert.equal(playerFetches.length, 2);
    const latestHash = createHash("sha256").update(state.latestPlayersHtml).digest("hex");
    assert.equal(playerFetches.at(-1)?.sha256, latestHash);
    assert.equal(result.result.parseCounts["fetches"], result.result.fetches.length);
    assert.equal(result.result.parseCounts["networkRequests"], result.result.fetches.reduce((sum, entry) => sum + entry.attempts.filter((attempt) => attempt.attempt > 0).length, 0));
    const stored = await db.select({ sha256: sourceFetches.sha256 }).from(sourceFetches)
      .where(eq(sourceFetches.importRunId, result.imported!.importRunId));
    assert.ok(stored.some((entry) => entry.sha256 === latestHash));
    assert.ok(result.imported?.issues.some((entry) => entry.code === "PBP_EVENTS_SHRANK"));
    assert.equal((await client.query<{ count: number }>("select count(*)::int as count from statsarena.play_by_play_events")).rows[0]?.count, 548);

    state.failBox = true;
    await store.invalidate(seed.fetches.find((entry) => entry.resource === "boxscore")!.requestUrl);
    const failingDb = new Proxy(db, { get(target, property, receiver) {
      if (property === "transaction") return async () => { throw new Error("Simulated importer connection failure postgres://user:secret@example.test/db"); };
      return Reflect.get(target, property, receiver) as unknown;
    }});
    const failurePath = join(directory, "failed.json");
    await assert.rejects(runCompetitionSync({ input: root, snapshotDirectory: directory, lockRoot: join(directory, "locks"),
      auditPath: () => failurePath, db: failingDb, fetcher, mode: "retry" }), (error: unknown) => {
      assert.ok(error instanceof SyncOperationError);
      assert.equal(error.auditPath, failurePath);
      assert.ok(error.fetches.length > 0);
      assert.ok(error.issues.some((entry) => entry.code === "FETCH_FAILED"));
      assert.ok(!error.message.includes("secret"));
      return true;
    });
    const rawAudit = await readFile(failurePath, "utf8");
    assert.ok(!rawAudit.includes("secret"));
    const audit = JSON.parse(rawAudit) as { mode: string; fetches: unknown[]; data: unknown };
    assert.equal(audit.mode, "failed");
    assert.ok(audit.fetches.length > 0);
    assert.ok(audit.data);
    assert.ok(targetedRetryUrls(audit, "49607").some((url) => url.includes("/boxscore")));
    const runs = await db.select({ status: syncRuns.status, resultSummary: syncRuns.resultSummary }).from(syncRuns);
    assert.ok(runs.some((run) => run.status === "failed" && !run.resultSummary?.includes("secret")));
  } finally {
    if (previousTtl === undefined) delete process.env["STATSARENA_CACHE_REGISTRY_MS"];
    else process.env["STATSARENA_CACHE_REGISTRY_MS"] = previousTtl;
    await client.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("runner keeps a root fetch failure audit and releases locks before another run", async () => {
  const directory = await mkdtemp(join(tmpdir(), "statsarena-failed-operation-"));
  try {
    const fetcher = new HtmlFetcher({ snapshotStore: new SnapshotStore(directory), retries: 0,
      fetchImpl: async () => new Response("unavailable", { status: 503 }) });
    for (const mode of ["once", "periodic", "retry"] as const) {
      const path = join(directory, `${mode}.json`);
      await assert.rejects(runCompetitionSync({ input: root, snapshotDirectory: directory,
        lockRoot: join(directory, "locks"), auditPath: () => path, fetcher, dryRun: true, mode }), SyncOperationError);
      const audit: unknown = JSON.parse(await readFile(path, "utf8"));
      assert.deepEqual(targetedRetryUrls(audit, "49607"), [root]);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
