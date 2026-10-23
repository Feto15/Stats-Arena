import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { load } from "cheerio";
import { HtmlFetcher } from "../src/fetch/fetcher.js";
import { SnapshotStore } from "../src/fetch/snapshots.js";
import { syncCompetition } from "../src/pipeline.js";
import { loadHtmlFixture, loadStage5HtmlFixture } from "./fixtures.js";

const root = "https://hosted.dcd.shared.geniussports.com/IBF/en/competition/49607";

function fixtureHtml(status: "scheduled" | "complete"): string {
  return `<h1 class="competition-title">Pipeline Cup</h1><a href="${root}/statistics/team">Statistics</a><article class="${status}">
    <a href="${root}/match/2931666/${status === "scheduled" ? "preview" : "summary"}">Game</a>
    <a href="${root}/team/146118">Home</a><a href="${root}/team/154596">Away</a>
    ${status === "complete" ? '<span class="score">25–45</span>' : ""}</article>`;
}

test("pipeline skips scheduled pages, fetches when complete, and distinguishes transport from partial HTML", async () => {
  const directory = await mkdtemp(join(tmpdir(), "statsarena-pipeline-"));
  const requests: string[] = [];
  let state: "scheduled" | "complete" = "scheduled";
  let boxMode: "valid" | "http-error" | "partial" | "invalid" = "valid";
  let missingShot = false;
  try {
    const fetcher = new HtmlFetcher({
      snapshotStore: new SnapshotStore(directory), retries: 0,
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        requests.push(url.href);
        let html: string;
        if (url.href === root) html = fixtureHtml(state);
        else if (url.pathname.endsWith("/statistics/team")) html = loadStage5HtmlFixture("49607-competition-statistics-team.html.gz");
        else if (url.pathname.endsWith("/teams")) html = loadHtmlFixture("49607-teams.html.gz");
        else if (url.pathname.endsWith("/players")) html = loadHtmlFixture("49607-players.html.gz");
        else if (url.pathname.endsWith("/standings")) html = url.search
          ? loadHtmlFixture("49607-group-a.html.gz")
          : `<a href="${root}/standings?poolNumber=9">GROUP A</a>`;
        else if (url.pathname.endsWith("/summary")) html = loadHtmlFixture("49607-2931666-summary.html.gz");
        else if (url.pathname.endsWith("/playbyplay")) html = loadStage5HtmlFixture("49607-2931666-playbyplay.html.gz");
        else if (url.pathname.endsWith("/shotchart")) {
          html = loadStage5HtmlFixture("49607-2931666-shotchart.html.gz");
          if (missingShot) {
            const $ = load(html);
            $("#shotchart .sc_img[title*='2pt']").first().remove();
            html = $.html();
          }
        }
        else if (url.pathname.endsWith("/analysis")) html = loadStage5HtmlFixture("49607-2931666-analysis.html.gz");
        else if (url.pathname.endsWith("/boxscore")) {
          if (boxMode === "http-error") return new Response("unavailable", { status: 503 });
          html = loadHtmlFixture("49607-2931666-boxscore.html.gz");
          if (boxMode === "partial") {
            const $ = load(html);
            $("th").filter((_, cell) => $(cell).text().trim() === "FGA").text("Unknown");
            html = $.html();
          }
          if (boxMode === "invalid") html = "<html>wrong page</html>";
        } else return new Response("unexpected source path", { status: 404 });
        return new Response(html, { headers: { "content-type": "text/html" } });
      }
    });
    const scheduled = await syncCompetition(root, { fetcher });
    assert.ok(!requests.some((url) => url.includes("/match/")));
    assert.deepEqual(scheduled.data.matches[0]?.availability, { summary: "scheduled", boxScore: "scheduled", playByPlay: "scheduled", shotChart: "scheduled", analysis: "scheduled" });
    assert.equal(scheduled.parseCounts["scheduledMatches"], 1);
    assert.ok(!scheduled.data.matches[0]?.issues.some((entry) => entry.severity === "error"));

    state = "complete";
    const complete = await syncCompetition(root, { fetcher, forceRefresh: true });
    assert.equal(complete.data.matches[0]?.boxScore?.players.length, 24);
    assert.equal(complete.data.matches[0]?.playByPlay?.records.length, 548);
    assert.equal(complete.data.matches[0]?.shotChart?.records.length, 81);
    assert.equal(complete.data.matches[0]?.officialMetrics?.records.length, 10);
    assert.equal(complete.data.teamOfficialMetrics?.records.length, 54);
    assert.equal(complete.parseCounts["scheduledMatches"], 0);
    const pbpUrl = complete.fetches.find((entry) => entry.resource === "playbyplay")?.requestUrl;
    assert.ok(pbpUrl);
    requests.length = 0;
    const targetedRefresh = await syncCompetition(root, { fetcher, forceRefreshUrls: new Set([pbpUrl]) });
    assert.deepEqual(requests, [pbpUrl]);
    assert.equal(targetedRefresh.data.matches[0]?.playByPlay?.records.length, 548);
    missingShot = true;
    const partialChart = await syncCompetition(root, { fetcher, forceRefresh: true });
    assert.equal(partialChart.data.matches[0]?.shotChart?.status, "partial");
    assert.equal(partialChart.data.matches[0]?.availability?.shotChart, "partial");
    assert.ok(partialChart.data.matches[0]?.issues.some((entry) => entry.code === "SHOT_FGA_MISMATCH" && entry.severity === "error"));
    assert.equal(partialChart.fetches.find((entry) => entry.resource === "shotchart")?.parseStatus, "partial");
    missingShot = false;
    requests.length = 0;
    const recovered = await syncCompetition(root, { fetcher });
    assert.deepEqual(requests, [`${root}/match/2931666/shotchart?`]);
    assert.equal(recovered.data.matches[0]?.shotChart?.status, "parsed");
    assert.equal(recovered.data.matches[0]?.shotChart?.records.length, 81);
    boxMode = "http-error";
    const failed = await syncCompetition(root, { fetcher, forceRefresh: true });
    assert.equal(failed.data.matches[0]?.availability?.boxScore, "fetch_failed");
    assert.equal(failed.parseCounts["fetchFailedMatches"], 1);
    assert.ok(failed.data.matches[0]?.issues.some((entry) => entry.code === "FETCH_FAILED"));
    boxMode = "partial";
    const partial = await syncCompetition(root, { fetcher, forceRefresh: true });
    assert.equal(partial.data.matches[0]?.availability?.boxScore, "partial");
    assert.equal(partial.data.matches[0]?.boxScore, null);
    assert.equal(partial.parseCounts["partialBoxScoreMatches"], 1);
    assert.equal(partial.parseCounts["fetchFailedMatches"], 0);
    boxMode = "invalid";
    const invalid = await syncCompetition(root, { fetcher, forceRefresh: true });
    assert.equal(invalid.data.matches[0]?.availability?.boxScore, "parse_failed");
    assert.equal(invalid.parseCounts["parseFailedMatches"], 1);
    assert.equal(invalid.parseCounts["failedParsePages"], 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("runner pipeline fetches newly published completed games before saved completed games", async () => {
  const directory = await mkdtemp(join(tmpdir(), "statsarena-new-game-priority-"));
  const competition = "https://hosted.dcd.shared.geniussports.com/IBF/en/competition/70092";
  const oldGameId = "71011";
  const newGameId = "71012";
  const requests: string[] = [];
  const game = (sourceId: string) => `<article class="complete"><a href="${competition}/match/${sourceId}/summary">Game ${sourceId}</a>
    <a href="${competition}/team/70111">Home Team</a><a href="${competition}/team/70112">Away Team</a><span class="score">1–2</span></article>`;
  const fetcher = new HtmlFetcher({
    snapshotStore: new SnapshotStore(directory), concurrency: 1, retries: 0,
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      requests.push(url.href);
      if (url.href === competition) return new Response(`<h1 class="competition-title">Priority Cup</h1>${game(oldGameId)}${game(newGameId)}`, { headers: { "content-type": "text/html" } });
      if (url.pathname.endsWith("/summary") || url.pathname.endsWith("/boxscore")) return new Response("<html>invalid detail</html>", { headers: { "content-type": "text/html" } });
      if (url.pathname.endsWith("/teams")) return new Response("<h1>Teams</h1>", { headers: { "content-type": "text/html" } });
      if (url.pathname.endsWith("/players")) return new Response("<h1>Players</h1>", { headers: { "content-type": "text/html" } });
      if (url.pathname.endsWith("/standings")) return new Response("<h1>Standings</h1>", { headers: { "content-type": "text/html" } });
      return new Response("unexpected source path", { status: 404 });
    }
  });
  try {
    const result = await syncCompetition(competition, { fetcher, existingGameIds: new Set([oldGameId]) });
    const matchRequestOrder = requests.filter((url) => /\/match\//.test(url));
    assert.equal(new URL(matchRequestOrder[0] ?? "https://invalid").pathname, `/IBF/en/competition/70092/match/${newGameId}/summary`);
    assert.equal(result.data.matches[0]?.fixture.sourceId, oldGameId);
    assert.equal(result.data.matches[1]?.fixture.sourceId, newGameId);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a new process resumes validated pages, fetches failed URLs only, and detects fixture corrections", async () => {
  const directory = await mkdtemp(join(tmpdir(), "statsarena-resume-"));
  let failBox = true;
  let homeScore = 25;
  let rootState: "complete" | "live" = "complete";
  const requests: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    requests.push(url.href);
    let html: string;
    if (url.href === root) html = fixtureHtml("complete").replace("25–45", `${homeScore}–45`).replace('class="complete"', `class="${rootState}"`);
    else if (url.pathname.endsWith("/statistics/team")) html = loadStage5HtmlFixture("49607-competition-statistics-team.html.gz");
    else if (url.pathname.endsWith("/teams")) html = loadHtmlFixture("49607-teams.html.gz");
    else if (url.pathname.endsWith("/players")) html = loadHtmlFixture("49607-players.html.gz");
    else if (url.pathname.endsWith("/standings")) html = url.search
      ? loadHtmlFixture("49607-group-a.html.gz") : `<a href="${root}/standings?poolNumber=9">GROUP A</a>`;
    else if (url.pathname.endsWith("/summary")) html = loadHtmlFixture("49607-2931666-summary.html.gz");
    else if (url.pathname.endsWith("/playbyplay")) html = loadStage5HtmlFixture("49607-2931666-playbyplay.html.gz");
    else if (url.pathname.endsWith("/shotchart")) html = loadStage5HtmlFixture("49607-2931666-shotchart.html.gz");
    else if (url.pathname.endsWith("/analysis")) html = loadStage5HtmlFixture("49607-2931666-analysis.html.gz");
    else if (url.pathname.endsWith("/boxscore")) {
      if (failBox) return new Response("retry later", { status: 503 });
      html = loadHtmlFixture("49607-2931666-boxscore.html.gz");
    } else return new Response("unexpected source path", { status: 404 });
    return new Response(html, { headers: { "content-type": "text/html" } });
  };
  const newProcess = () => new HtmlFetcher({ snapshotStore: new SnapshotStore(directory), fetchImpl, retries: 0 });
  try {
    const first = await syncCompetition(root, { fetcher: newProcess() });
    assert.equal(first.parseCounts["fetchFailedMatches"], 1);
    failBox = false;
    requests.length = 0;
    const resumed = await syncCompetition(root, { fetcher: newProcess() });
    assert.deepEqual(requests, [`${root}/match/2931666/boxscore?`]);
    assert.equal(resumed.parseCounts["cacheHits"], 10);
    assert.equal(resumed.parseCounts["networkRequests"], 1);
    assert.equal(resumed.parseCounts["playerBoxScoreRows"], 24);
    const sourceTimes = new Map(resumed.fetches.map((entry) => [entry.requestUrl, entry.fetchedAt]));
    requests.length = 0;
    const cached = await syncCompetition(root, { fetcher: newProcess() });
    assert.equal(requests.length, 0);
    assert.equal(cached.parseCounts["networkRequests"], 0);
    assert.equal(cached.parseCounts["cacheHits"], 11);
    assert.ok(cached.fetches.every((entry) => entry.fetchedAt === sourceTimes.get(entry.requestUrl)));
    homeScore = 26;
    const changedFetcher = newProcess();
    const freshRoot = await changedFetcher.fetchPage(root);
    await changedFetcher.recordParseResult(freshRoot, "parsed");
    requests.length = 0;
    const changed = await syncCompetition(root, { fetcher: changedFetcher });
    assert.deepEqual(new Set(requests), new Set([
      `${root}/match/2931666/summary`, `${root}/match/2931666/boxscore?`,
      `${root}/match/2931666/playbyplay?`, `${root}/match/2931666/shotchart?`, `${root}/match/2931666/analysis?`,
    ]));
    assert.equal(changed.data.matches[0]?.fixture.homeScore, 26);
    rootState = "live";
    const liveFetcher = newProcess();
    const liveRoot = await liveFetcher.fetchPage(root);
    await liveFetcher.recordParseResult(liveRoot, "parsed");
    requests.length = 0;
    await syncCompetition(root, { fetcher: liveFetcher });
    assert.equal(requests.filter((url) => url.includes("/match/")).length, 5);
    requests.length = 0;
    await syncCompetition(root, { fetcher: newProcess() });
    assert.equal(requests.filter((url) => url.includes("/match/")).length, 5);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("each sync rediscovers source-linked semifinal and final schedule pages without fixed match IDs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "statsarena-playoff-discovery-"));
  const competition = "https://hosted.dcd.shared.geniussports.com/IBF/en/competition/70091";
  let stage = 0;
  const calls: string[] = [];
  const game = (sourceId: string) => `<article class="scheduled"><a href="${competition}/match/${sourceId}/preview">Match</a>
    <a href="${competition}/team/70101">Home Team</a><a href="${competition}/team/70102">Away Team</a></article>`;
  const rootHtml = () => `<h1 class="competition-title">Dynamic Bracket Cup</h1>
    <a href="${competition}/schedule?">Fixtures</a>${game("71001")}
    ${stage >= 1 ? `<a href="${competition}/schedule?phase=semifinals">Semifinals</a>` : ""}
    ${stage >= 2 ? `<a href="${competition}/schedule?phase=final">Final</a>` : ""}`;
  try {
    for (stage = 0; stage <= 2; stage += 1) {
      const fetcher = new HtmlFetcher({
        snapshotStore: new SnapshotStore(directory), retries: 0,
        fetchImpl: async (input) => {
          const url = new URL(String(input));
          calls.push(url.href);
          if (url.href === competition) return new Response(rootHtml(), { headers: { "content-type": "text/html" } });
          if (url.pathname.endsWith("/schedule")) {
            const phase = url.searchParams.get("phase");
            const html = phase === "semifinals"
              ? `<h1 class="competition-title">Dynamic Bracket Cup</h1>${game("71002")}`
              : phase === "final"
                ? `<h1 class="competition-title">Dynamic Bracket Cup</h1>${game("71003")}`
                : `<h1 class="competition-title">Dynamic Bracket Cup</h1>${game("71001")}`;
            return new Response(html, { headers: { "content-type": "text/html" } });
          }
          if (url.pathname.endsWith("/teams")) return new Response(`<div class="team-link"><a href="${competition}/team/70101"><span class="team-name">Home Team</span></a></div><div class="team-link"><a href="${competition}/team/70102"><span class="team-name">Away Team</span></a></div>`, { headers: { "content-type": "text/html" } });
          if (url.pathname.endsWith("/players")) return new Response(`<div class="playerblock"><a href="${competition}/person/70201"><span class="player-name">Player</span></a></div>`, { headers: { "content-type": "text/html" } });
          if (url.pathname.endsWith("/standings")) return new Response("<h1>Standings</h1>", { headers: { "content-type": "text/html" } });
          return new Response("unavailable", { status: 404 });
        }
      });
      const result = await syncCompetition(competition, { fetcher, forceRefresh: true });
      const ids = result.data.matches.map((match) => match.fixture.sourceId).sort();
      assert.deepEqual(ids, stage === 0 ? ["71001"] : stage === 1 ? ["71001", "71002"] : ["71001", "71002", "71003"]);
      assert.equal(result.parseCounts["scheduledMatches"], ids.length);
      assert.equal(result.parseCounts["fixturePagesRead"], stage + 2);
    }
    assert.ok(calls.includes(`${competition}/schedule?phase=semifinals`));
    assert.ok(calls.includes(`${competition}/schedule?phase=final`));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
