import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { load } from "cheerio";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { count, eq } from "drizzle-orm";
import type { StatsArenaDatabase } from "@statsarena/db";
import { games, playByPlayEvents, schema, syncRuns } from "@statsarena/db/schema";
import { fixtureHash, incrementalReason, type SavedGameSyncState } from "../src/domain/incremental.js";
import { PARSER_VERSION, type GameRecord } from "../src/domain/types.js";
import { HtmlFetcher } from "../src/fetch/fetcher.js";
import { SnapshotStore } from "../src/fetch/snapshots.js";
import { readIncrementalGames, runCompetitionSync } from "../src/operations/runner.js";
import { importCompetition } from "../src/import/importer.js";
import { loadHtmlFixture, loadStage5HtmlFixture } from "./fixtures.js";

const root = "https://hosted.dcd.shared.geniussports.com/IBF/en/competition/49607";
const fixture: GameRecord = {
  sourceId: "2931666", sourceUrl: `${root}/match/2931666/summary`, homeTeamSourceId: "146118", awayTeamSourceId: "154596",
  homeTeamName: "Home", awayTeamName: "Away", homeScore: 25, awayScore: 45, status: "complete", scheduledAtRaw: null, venue: null
};
function saved(game = fixture): SavedGameSyncState {
  return { fixtureHash: fixtureHash(game), detailSyncStatus: "parsed", detailParserVersion: PARSER_VERSION,
    detailSyncedAt: new Date("2026-10-06T00:00:00Z"), needsRetry: false };
}

test("incremental selection detects fixture changes, active games, failed details, parser upgrades, and unverified imports", () => {
  const baseline = saved();
  assert.equal(incrementalReason(fixture, baseline, new Set()), null);
  assert.equal(incrementalReason(fixture, undefined, new Set()), "new");
  for (const change of [{ homeScore: 26 }, { awayTeamSourceId: "154597" }, { scheduledAtRaw: "tomorrow" }, { venue: "New Hall" }]) {
    assert.equal(incrementalReason({ ...fixture, ...change }, baseline, new Set()), "changed");
  }
  for (const status of ["live", "unknown"] as const) assert.equal(incrementalReason({ ...fixture, status }, baseline, new Set()), "active");
  assert.equal(incrementalReason(fixture, { ...baseline, detailSyncStatus: "partial" }, new Set()), "retry");
  assert.equal(incrementalReason(fixture, { ...baseline, needsRetry: true }, new Set()), "retry");
  assert.equal(incrementalReason(fixture, baseline, new Set([`${root}/match/2931666/playbyplay?`])), "retry");
  assert.equal(incrementalReason(fixture, baseline, new Set([`${root.replace("49607", "49609")}/match/2931666/playbyplay`])), null);
  assert.equal(incrementalReason(fixture, { ...baseline, detailParserVersion: "old" }, new Set()), "parser_changed");
  assert.equal(incrementalReason(fixture, { ...baseline, fixtureHash: null }, new Set()), "unverified");
  assert.equal(incrementalReason(fixture, { ...baseline, detailSyncedAt: null }, new Set()), "unverified");
  const scheduled = { ...fixture, status: "scheduled" as const, homeScore: null, awayScore: null };
  assert.equal(incrementalReason(scheduled, { ...saved(scheduled), detailSyncedAt: null }, new Set()), null);
  assert.equal(incrementalReason(fixture, saved(scheduled), new Set()), "changed");
});

test("fixture fingerprint ignores display names and equivalent tab URLs but retains the actual fixture observation", () => {
  assert.equal(fixtureHash(fixture), fixtureHash({ ...fixture, homeTeamName: "New Label", sourceUrl: `${root}/match/2931666/summary?` }));
  assert.equal(fixtureHash(fixture), fixtureHash({ ...fixture, sourceUrl: `${root}/match/2931666/boxscore` }));
  assert.notEqual(fixtureHash(fixture), fixtureHash({ ...fixture, homeScore: null }));
});

test("incremental runner discovers playoff fixtures, refreshes changed details, skips expired completed pages, and preserves failed PBP", async () => {
  const directory = await mkdtemp(join(tmpdir(), "statsarena-incremental-"));
  const client = new PGlite();
  let clock = Date.parse("2026-10-06T00:00:00Z");
  const state = { nextCompleted: false, publishFinal: false, venue: "Old Hall", shrink: false };
  const calls: string[] = [];
  function game(id: string, status: "scheduled" | "complete") {
    return `<article class="${status}"><a href="${root}/match/${id}/${status === "scheduled" ? "preview" : "summary"}">Game</a>
      <a href="${root}/team/146118">Home</a><a href="${root}/team/154596">Away</a>
      ${status === "complete" ? '<span class="score">25–45</span>' : ""}
      <span class="venuename">${id === "2931666" ? state.venue : "Other Hall"}</span></article>`;
  }
  const fetcher = new HtmlFetcher({ snapshotStore: new SnapshotStore(directory), retries: 0, now: () => clock,
    fetchImpl: async (input) => {
      const url = new URL(String(input)); calls.push(url.href);
      let html: string;
      if (url.href === root || url.pathname.endsWith("/schedule")) {
        html = `<h1 class="competition-title">Incremental Cup</h1><a href="${root}/schedule">Schedule</a><a href="${root}/statistics/team">Statistics</a>` +
          game("2931666", "complete") + game("9999001", state.nextCompleted ? "complete" : "scheduled") +
          (url.pathname.endsWith("/schedule") && state.publishFinal ? game("9999002", "scheduled") : "");
      } else if (url.pathname.endsWith("/statistics/team")) html = loadStage5HtmlFixture("49607-competition-statistics-team.html.gz");
      else if (url.pathname.endsWith("/teams")) html = loadHtmlFixture("49607-teams.html.gz");
      else if (url.pathname.endsWith("/players")) html = loadHtmlFixture("49607-players.html.gz");
      else if (url.pathname.endsWith("/standings")) html = url.search ? loadHtmlFixture("49607-group-a.html.gz") : `<a href="${root}/standings?poolNumber=9">GROUP A</a>`;
      else {
        const id = url.pathname.match(/\/match\/(\d+)\//)?.[1];
        if (!id) return new Response("missing", { status: 404 });
        if (url.pathname.endsWith("/summary")) html = loadHtmlFixture("49607-2931666-summary.html.gz");
        else if (url.pathname.endsWith("/boxscore")) html = loadHtmlFixture("49607-2931666-boxscore.html.gz");
        else if (url.pathname.endsWith("/playbyplay")) {
          const $ = load(loadStage5HtmlFixture("49607-2931666-playbyplay.html.gz"));
          if (state.shrink && id === "2931666") $("#playbyplay .pbpa").first().remove();
          html = $.html();
        } else if (url.pathname.endsWith("/shotchart")) html = loadStage5HtmlFixture("49607-2931666-shotchart.html.gz");
        else if (url.pathname.endsWith("/analysis")) html = loadStage5HtmlFixture("49607-2931666-analysis.html.gz");
        else return new Response("missing", { status: 404 });
        html = html.replaceAll("2931666", id);
      }
      return new Response(html, { headers: { "content-type": "text/html" } });
    }
  });
  try {
    await migrate(drizzle(client), { migrationsFolder: fileURLToPath(new URL("../../packages/db/drizzle", import.meta.url)),
      migrationsSchema: "statsarena", migrationsTable: "__drizzle_migrations" });
    const db = drizzle(client, { schema }) as unknown as StatsArenaDatabase;
    let cycle = 0;
    const run = (incremental: boolean, dryRun = false, matchLimit?: number, forceRefreshUrls?: ReadonlySet<string>) => runCompetitionSync({
      input: root, db, fetcher, snapshotDirectory: directory, lockRoot: join(directory, "locks"),
      auditPath: () => join(directory, `cycle-${++cycle}.json`), incremental, dryRun,
      ...(matchLimit === undefined ? {} : { matchLimit }),
      ...(forceRefreshUrls === undefined ? {} : { forceRefreshUrls })
    });
    const initial = await run(false);
    assert.equal(initial.imported?.status, "succeeded");
    assert.equal(initial.imported.counts["newGames"], 2);
    assert.equal((await readIncrementalGames(db, "49607")).get("2931666")?.detailSyncStatus, "parsed");
    assert.equal((await readIncrementalGames(db, "49609")).size, 0);
    const oldFetch = initial.result.fetches.find((entry) => entry.resource === "boxscore");
    assert.ok(oldFetch);

    clock += 48 * 60 * 60_000;
    calls.length = 0;
    const skipped = await run(true);
    assert.equal(skipped.result.parseCounts["matchesProcessed"], 0);
    assert.equal(skipped.result.parseCounts["unchangedMatchesSkipped"], 2);
    assert.ok(!calls.some((url) => url.includes("/match/")));
    assert.equal(skipped.imported?.counts["playerGameStats"], 0);

    state.nextCompleted = true; state.publishFinal = true;
    const runCount = await db.select({ value: count() }).from(syncRuns);
    const baseline = await readIncrementalGames(db, "49607");
    calls.length = 0;
    const preview = await run(true, true);
    assert.equal(preview.result.parseCounts["fixturesDiscovered"], 3);
    assert.equal(preview.result.parseCounts["selected_new"], 1);
    assert.equal(preview.result.parseCounts["selected_changed"], 1);
    assert.equal(preview.result.data.matches.length, 2);
    assert.ok(!calls.some((url) => url.includes("/match/2931666/")));
    assert.ok(!calls.some((url) => url.includes("/match/9999002/")));
    assert.deepEqual(await db.select({ value: count() }).from(syncRuns), runCount);
    assert.deepEqual(await readIncrementalGames(db, "49607"), baseline);
    assert.equal(JSON.parse(await readFile(join(directory, `cycle-${cycle}.json`), "utf8")).strategy, "incremental");

    const published = await run(true);
    assert.equal(published.imported?.counts["newGames"], 1);
    assert.equal(published.imported.counts["playerGameStats"], 24);
    assert.equal(published.imported.counts["playByPlayEvents"], 548);
    const again = await run(true);
    assert.equal(again.result.parseCounts["matchesProcessed"], 0);
    assert.deepEqual(await db.select({ value: count() }).from(games), [{ value: 3 }]);

    state.venue = "Changed Hall"; calls.length = 0;
    const changed = await run(true);
    assert.equal(changed.result.parseCounts["selected_changed"], 1);
    assert.ok(calls.some((url) => url.includes("/match/2931666/boxscore")));
    assert.ok(!calls.some((url) => url.includes("/match/9999001/")));
    assert.equal(changed.imported?.counts["playerGameStats"], 0);
    assert.equal((await run(true)).result.parseCounts["matchesProcessed"], 0);

    calls.length = 0;
    const targetedUrl = `${root}/match/2931666/playbyplay?`;
    const targeted = await run(true, false, undefined, new Set([targetedUrl]));
    assert.equal(targeted.result.parseCounts["selected_retry"], 1);
    assert.deepEqual(calls.filter((url) => url.includes("/match/")), [targetedUrl]);

    state.venue = "Changed Again"; state.shrink = true;
    const partial = await run(true);
    assert.equal(partial.imported?.status, "partial");
    assert.ok(partial.imported.issues.some((entry) => entry.code === "PBP_EVENTS_SHRANK"));
    assert.equal((await readIncrementalGames(db, "49607")).get("2931666")?.detailSyncStatus, "partial");
    assert.deepEqual(await db.select({ value: count() }).from(playByPlayEvents), [{ value: 1096 }]);
    state.shrink = false;
    const recovered = await run(true);
    assert.equal(recovered.result.parseCounts["selected_retry"], 1);
    assert.equal(recovered.imported?.status, "succeeded");
    assert.equal((await run(true)).result.parseCounts["matchesProcessed"], 0);

    // A connection failure before import returns still queues valid unchanged
    // fixtures; old metadata alone must not suppress the next attempt.
    const failingDb = new Proxy(db, { get(target, property, receiver) {
      if (property === "transaction") return async () => { throw new Error("Simulated importer connection failure"); };
      return Reflect.get(target, property, receiver) as unknown;
    }});
    await assert.rejects(runCompetitionSync({ input: root, db: failingDb, fetcher, incremental: true,
      snapshotDirectory: directory, lockRoot: join(directory, "locks"),
      auditPath: () => join(directory, "connection-failed.json"), forceRefreshUrls: new Set([targetedUrl])
    }), /Simulated importer connection failure/);
    const pending = await readIncrementalGames(db, "49607");
    assert.equal(pending.get("2931666")?.detailSyncStatus, "parsed");
    assert.equal(pending.get("2931666")?.needsRetry, true);
    assert.equal(pending.get("9999001")?.needsRetry, false);
    assert.equal((await run(true)).result.parseCounts["selected_retry"], 1);

    // A rollback with an unchanged fixture must still make this game retryable.
    const match = recovered.result.data.matches[0];
    assert.ok(match);
    const rollback = await importCompetition(db, { ...recovered.result.data, matches: [{
      ...match, fixture: { ...match.fixture, homeTeamSourceId: match.fixture.awayTeamSourceId },
      summary: null, boxScore: null, playByPlay: null, shotChart: null, officialMetrics: null
    }] }, recovered.result.fetches);
    assert.equal(rollback.failedGames.length, 1);
    assert.equal((await readIncrementalGames(db, "49607")).get("2931666")?.detailSyncStatus, "failed");
    assert.equal((await run(true)).result.parseCounts["selected_retry"], 1);
    assert.deepEqual(await db.select({ value: count() }).from(playByPlayEvents), [{ value: 1096 }]);
    assert.ok((await db.select().from(games).where(eq(games.sourceGameId, "2931666")))[0]?.lastBoxscoreFetchId);
  } finally { await client.close(); await rm(directory, { recursive: true, force: true }); }
});

test("incremental rejects conflicting fetch modes before opening Neon", async () => {
  for (const flags of [{ forceRefresh: true }, { snapshotOnly: true }]) {
    await assert.rejects(runCompetitionSync({ input: root, incremental: true, ...flags,
      snapshotDirectory: "unused", lockRoot: "unused", auditPath: () => "unused" }), /tidak dapat digabung/);
  }
});
