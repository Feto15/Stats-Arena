import assert from "node:assert/strict";
import test from "node:test";
import { buildClubReport } from "../lib/reports/club-report";
import { buildClubShotCharts, parseClubShotFilters, parseSingleClubShotFilters, selectClubShots } from "../lib/reports/club-shot-chart";
import snapshot from "../lib/reports/demo-club-shots.json";

test("shot charts reconcile each club/player's 2PT and 3PT with box score and preserve source positions", () => {
  const report = buildClubReport();
  const charts = buildClubShotCharts(report);
  assert.deepEqual(charts.map(chart => [chart.gameId, chart.status, chart.shots.length, chart.shots.filter(shot => shot.result === "made").length]), [["2697586", "ready", 61, 25], ["2697587", "ready", 61, 18]]);
  const first = charts[0]!.shots[0]!;
  assert.deepEqual([first.sourceSequence, first.xRaw, first.yRaw, first.xPercent, first.yPercent], [2, "93%", "59%", 93, 59]);
  assert.equal(first.playerSourceId, "1761998");
  assert.equal(charts[0]!.source!.sha256, "ffbdbfe4e74db0cc31323d782ef37518534f67590f730bb69d81e9887610043e");
  const result = selectClubShots(report, parseClubShotFilters(report, {}));
  assert.equal(result.summary!.attempts, 122);
  assert.equal(result.summary!.made, 43);
  assert.equal(result.summary!.missed, 79);
  assert.ok(Math.abs(result.summary!.percentage! - 100 * 43 / 122) < 1e-10);
});

test("game/type/player filters are scoped and result filtering never turns made-only FG% into 100%", () => {
  const report = buildClubReport();
  const made = selectClubShots(report, parseClubShotFilters(report, { game: "2697586", result: "made" }));
  assert.equal(made.charts.length, 1);
  assert.equal(made.visibleCount, 25);
  assert.equal(made.summary!.attempts, 61);
  assert.ok(Math.abs(made.summary!.percentage! - 100 * 25 / 61) < 1e-10);
  const threes = selectClubShots(report, parseClubShotFilters(report, { shotType: "3pt" }));
  assert.equal(threes.summary!.attempts, 29);
  assert.equal(threes.summary!.made, 4);
  const player = selectClubShots(report, parseClubShotFilters(report, { player: "1762153", period: "1" }));
  assert.ok(player.charts.every(chart => chart.visible.every(shot => shot.playerSourceId === "1762153" && shot.periodNumber === 1)));
  assert.ok(player.visibleCount > 0);
});

test("a valid empty filter has zero attempts and unavailable percentage, while unavailable charts have no summary", () => {
  const report = buildClubReport();
  const empty = selectClubShots(report, parseClubShotFilters(report, { game: "2697586", player: "2483647" }));
  assert.deepEqual(empty.summary, { attempts: 0, made: 0, missed: 0, percentage: null });
  const unavailable = selectClubShots(report, parseClubShotFilters(report, {}), { ...snapshot, charts: [] });
  assert.equal(unavailable.summary, null);
  assert.equal(unavailable.readyCount, 0);
});

test("missing markers and altered player attribution reject the affected chart and retain the other valid game", () => {
  const report = buildClubReport();
  const missing = structuredClone(snapshot);
  missing.charts[0]!.shots.pop();
  const charts = buildClubShotCharts(report, missing);
  assert.equal(charts[0]!.status, "partial");
  assert.equal(charts[0]!.shots.length, 0);
  assert.equal(charts[1]!.status, "ready");
  const moved = structuredClone(snapshot);
  moved.charts[0]!.shots[0]!.playerSourceId = "1762153";
  assert.equal(buildClubShotCharts(report, moved)[0]!.status, "partial");
  const one = selectClubShots(report, parseClubShotFilters(report, {}), missing);
  assert.equal(one.readyCount, 1);
  assert.equal(one.summary!.attempts, 61);
  assert.equal(one.summary!.made, 18);
});

test("invalid coordinates, duplicate sequences, fouls, foreign IDs and provenance mismatches cannot become markers", () => {
  const report = buildClubReport();
  const cases = [
    { xPercent: 101 }, { xRaw: "12%" }, { sourceSequence: snapshot.charts[0]!.shots[1]!.sourceSequence },
    { shotType: "foul" }, { teamSourceId: "126041" }, { playerSourceId: "999" }, { gameSourceId: "2697591" },
    { sourceUrl: "https://example.com/shotchart" },
  ];
  for (const patch of cases) {
    const changed = { ...snapshot, charts: snapshot.charts.map((chart, index) => index === 0 ? { ...chart, shots: chart.shots.map((shot, index) => index === 0 ? { ...shot, ...patch } : shot) } : chart) };
    assert.equal(buildClubShotCharts(report, changed)[0]!.status, "partial");
  }
  const hash = structuredClone(snapshot);
  hash.charts[0]!.sha256 = "0".repeat(64);
  assert.equal(buildClubShotCharts(report, hash)[0]!.status, "partial");
});

test("out-of-window and cross-namespace datasets are rejected; invalid or repeated URL filters fall back safely", () => {
  const report = buildClubReport();
  assert.ok(buildClubShotCharts(report, { ...snapshot, competitionKey: "42041" }).every(chart => chart.status === "partial"));
  assert.ok(buildClubShotCharts(report, { ...snapshot, charts: [...snapshot.charts, snapshot.charts[0]] }).every(chart => chart.status === "partial"));
  const duplicate = { ...snapshot, charts: [snapshot.charts[0], snapshot.charts[0]] };
  assert.ok(buildClubShotCharts(report, duplicate).every(chart => chart.status === "partial"));
  assert.deepEqual(parseClubShotFilters(report, { game: "2697591", player: "1438124", period: "100", result: ["made", "missed"], shotType: "foul" }), { game: "all", player: "all", period: null, result: "all", shotType: "all" });
});


test("single-canvas screen defaults to the first game and never mixes two games", () => {
  const report = buildClubReport();
  for (const game of [undefined, "all", "invalid", ["2697586", "2697587"]]) {
    const result = selectClubShots(report, parseSingleClubShotFilters(report, { game }));
    assert.equal(result.charts.length, 1);
    assert.equal(result.charts[0]!.gameId, "2697586");
    assert.equal(result.summary!.attempts, 61);
    assert.equal(result.summary!.made, 25);
  }
  const result = selectClubShots(report, parseSingleClubShotFilters(report, { game: "2697587", result: "made" }));
  assert.equal(result.charts.length, 1);
  assert.equal(result.charts[0]!.gameId, "2697587");
  assert.equal(result.visibleCount, 18);
  assert.equal(result.summary!.attempts, 61);
});
