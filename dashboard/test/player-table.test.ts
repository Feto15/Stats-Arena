import assert from "node:assert/strict";
import test from "node:test";
import { buildClubReport } from "../lib/reports/club-report";
import { playerTableHref, playerTableSort, sortClubPlayers } from "../lib/reports/player-table";

test("roster sorting preserves raw precision, zero, negative values and unavailable values in both directions", () => {
  const base = buildClubReport().players[0]!;
  const players = [2.41, null, -1, 0, 2.42].map((score, index) => ({ ...base, sourceId: String(index + 1), advancedStats: { ...base.advancedStats, gameScorePerGame: score } }));
  assert.deepEqual(sortClubPlayers(players, { key: "gameScore", order: "desc" }).map(p => p.sourceId), ["5", "1", "4", "3", "2"]);
  assert.deepEqual(sortClubPlayers(players, { key: "gameScore", order: "asc" }).map(p => p.sourceId), ["3", "4", "1", "5", "2"]);
  assert.deepEqual(players.map(p => p.sourceId), ["1", "2", "3", "4", "5"], "sorting must not change shared report/other sections");
  const names = [{ ...base, sourceId: "2", name: "Z. Pemain" }, { ...base, sourceId: "1", name: "A. Pemain" }];
  assert.deepEqual(sortClubPlayers(names, { key: "name", order: "asc" }).map(p => p.sourceId), ["1", "2"]);
});

test("sort URL accepts only supported columns and preserves club scope and selected player", () => {
  assert.deepEqual(playerTableSort({}), { key: "points", order: "desc" });
  assert.deepEqual(playerTableSort({ sort: ["points", "minutes"], order: "asc" }), { key: "points", order: "desc" });
  assert.deepEqual(playerTableSort({ sort: "foreign", order: "asc" }), { key: "points", order: "desc" });
  assert.deepEqual(playerTableSort({ sort: "name", order: ["asc", "desc"] }), { key: "name", order: "asc" });
  assert.equal(playerTableHref("/reports/rajawali-medan", "1762153", { key: "gameScore", order: "asc" }), "/reports/rajawali-medan?section=players&player=1762153&sort=gameScore&order=asc");
});
