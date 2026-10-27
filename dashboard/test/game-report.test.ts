import assert from "node:assert/strict";
import test from "node:test";
import snapshot from "../lib/reports/demo-game.json";
import { buildDemoReport, formatStat, periodScores, reportHref, reportSelection } from "../lib/reports/game-report";

test("archived report preserves the fixture, team totals, precision, and shared analytics", () => {
  const report = buildDemoReport();
  assert.equal(report.competition.key, "IBL:42041");
  assert.equal(report.fixture.sourceId, "2697582");
  assert.equal(report.players.length, 23);
  assert.deepEqual(report.teams.map(team => team.stats.points), [56, 84]);
  assert.deepEqual(report.periods, [{ period: 1, home: 15, away: 20 }, { period: 2, home: 12, away: 25 }, { period: 3, home: 15, away: 28 }, { period: 4, home: 14, away: 11 }]);
  assert.equal(report.players[0]!.stats.minutes, 29 + 40 / 60);
  assert.ok(Math.abs(report.teams[0]!.advancedStats.effectiveFieldGoalPercentage! - 100 * 23 / 63) < 1e-10);
  assert.equal(report.provenance.resources.find(resource => resource.resource === "boxscore")!.sha256, "4f8690ec77b71b6ada27a13d12b74e0581fb1f9a79e7de1caed93e6711f5bd03");
});

test("team selection cannot mix player membership; invalid and repeated filters fall back safely", () => {
  const report = buildDemoReport();
  for (const team of report.teams) {
    const selection = reportSelection(report, { team: team.sourceId, section: "players", player: report.players.find(player => player.teamSourceId !== team.sourceId)!.sourceId });
    assert.equal(selection.section, "players");
    assert.equal(selection.team.sourceId, team.sourceId);
    assert.notEqual(selection.opponent.sourceId, team.sourceId);
    assert.equal(selection.player.teamSourceId, team.sourceId);
    assert.ok(selection.players.every(player => player.teamSourceId === team.sourceId));
  }
  assert.equal(reportSelection(report, { team: ["170782", "126041"], section: "invalid" }).team.sourceId, report.teams[0]!.sourceId);
  assert.equal(reportSelection(report, { section: "invalid" }).section, "team");
  assert.equal(reportHref("126041", "players", "123"), "/reports/demo-match?team=126041&section=players&player=123");
});

test("missing statistics stay null, actual zeros remain zero, and zero-attempt percentages are unavailable", () => {
  const changed = { ...snapshot, players: snapshot.players.map((player, index) => index === 0
    ? { ...player, stats: { ...player.stats, assists: null, fieldGoalsMade: 0, fieldGoalsAttempted: 0 } }
    : player) };
  const player = buildDemoReport(changed).players[0]!;
  assert.equal(player.stats.assists, null);
  assert.equal(player.stats.fieldGoalsMade, 0);
  assert.equal(player.advancedStats.fieldGoalPercentage, null);
  assert.equal(player.advancedStats.gameScore, null);
  assert.equal(formatStat(null), "—");
  assert.equal(formatStat(0), "0");
});

test("period coverage becomes unavailable on missing, duplicated, regressing, or mismatched source observations", () => {
  const periods = snapshot.periodEnds;
  assert.equal(periodScores(periods.slice(1), 56, 84), null);
  assert.equal(periodScores([...periods, periods[3]!], 56, 84), null);
  assert.equal(periodScores(periods, 57, 84), null);
  assert.equal(periodScores(periods, null, 84), null);
  assert.equal(periodScores(periods.map((row, index) => index === 2 ? { ...row, homeScore: 1 } : row), 56, 84), null);
  assert.equal(periodScores(periods.map((row, index) => index === 1 ? { ...row, awayScore: null } : row), 56, 84), null);
});

test("report rejects namespace changes, unsafe provenance URLs, conflicting scores, and foreign player identities", () => {
  assert.throws(() => buildDemoReport({ ...snapshot, competition: { ...snapshot.competition, key: "42041" } }));
  assert.throws(() => buildDemoReport({ ...snapshot, fixture: { ...snapshot.fixture, sourceUrl: "https://example.com/IBL/en/competition/42041" } }));
  assert.throws(() => buildDemoReport({ ...snapshot, fixture: { ...snapshot.fixture, homeScore: 99 } }));
  assert.throws(() => buildDemoReport({ ...snapshot, players: snapshot.players.map((player, index) => index === 0 ? { ...player, teamSourceId: "999" } : player) }));
  assert.throws(() => buildDemoReport({ ...snapshot, players: [...snapshot.players, snapshot.players[0]] }));
});
