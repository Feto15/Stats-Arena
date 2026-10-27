import assert from "node:assert/strict";
import test from "node:test";
import { buildClubReport, clubSelection, formatMinutes } from "../lib/reports/club-report";
import { playerDevelopment, signedChange } from "../lib/reports/player-development";
import snapshot from "../lib/reports/demo-club.json";

test("development compares exact two-game scope with precise minutes, volume, rates, and contribution", () => {
  const report = buildClubReport();
  const santosa = report.players.find(p => p.name === "H. Santosa")!;
  const d = playerDevelopment(report, santosa);
  assert.equal(d.comparable, true);
  assert.equal(formatMinutes(d.first!.stats.minutes), "33:13");
  assert.equal(formatMinutes(d.second!.stats.minutes), "18:34");
  assert.equal(signedChange(d.changes.minutes, formatMinutes), "−14:39");
  assert.equal(d.changes.fieldGoalsAttempted, 1);
  assert.equal(d.changes.threePointAttempts, -1);
  assert.equal(d.changes.freeThrowAttempts, -5);
  assert.equal(d.changes.points, -9);
  assert.equal(d.changes.rebounds, -5);
  assert.equal(d.changes.assists, -1);
  assert.equal(d.changes.turnovers, 0);
  assert.ok(Math.abs(d.changes.trueShootingPercentage! - (51.54639175257732 - 94.86607142857142)) < 1e-10);
  assert.ok(Math.abs(d.changes.pointsSharePercentage! - (8 / 44 - 17 / 65) * 100) < 1e-10);
  assert.ok(d.changes.usagePercentage! > 0);
  assert.ok(Math.abs(d.first!.advancedStats.gameScore! - 20.1) < 1e-10);
  assert.ok(Math.abs(d.second!.advancedStats.gameScore! - 4.8) < 1e-10);
  assert.ok(Math.abs(d.changes.gameScore! + 15.3) < 1e-10);
  assert.ok(Math.abs(santosa.advancedStats.gameScorePerGame! - 12.45) < 1e-10);
});

test("a zero-minute row is preserved; unavailable efficiency is never changed into zero", () => {
  const report = buildClubReport();
  const d = playerDevelopment(report, report.players.find(p => p.name === "J. Kurnianto")!);
  assert.equal(d.first!.stats.minutes, 0);
  assert.equal(d.first!.stats.fieldGoalsAttempted, 0);
  assert.equal(d.first!.advancedStats.trueShootingPercentage, null);
  assert.equal(d.changes.trueShootingPercentage, null);
  assert.equal(d.changes.turnovers, 0);
  assert.equal(d.first!.advancedStats.gameScore, 0);
  assert.equal(signedChange(null, String), "—");
  assert.equal(signedChange(0, String), "0");
});

test("missing rows and missing fields cannot create apparent improvement", () => {
  const missing = structuredClone(snapshot);
  missing.games[1]!.players = missing.games[1]!.players.filter(p => p.name !== "H. Santosa");
  const report = buildClubReport(missing);
  const d = playerDevelopment(report, report.players.find(p => p.name === "H. Santosa")!);
  assert.equal(d.comparable, false);
  assert.equal(d.first!.stats.points, 17);
  assert.equal(d.second, undefined);
  assert.ok(Object.values(d.changes).every(value => value === null));
  const incomplete = buildClubReport({ ...snapshot, games: snapshot.games.map((g, i) => i !== 1 ? g : { ...g, players: g.players.map(p => p.name !== "H. Santosa" ? p : { ...p, stats: { ...p.stats, turnovers: null } }) }) });
  const incompleteChanges = playerDevelopment(incomplete, incomplete.players.find(p => p.name === "H. Santosa")!).changes;
  assert.equal(incompleteChanges.turnovers, null);
  assert.equal(incompleteChanges.gameScore, null);
});

test("rotation honors valid selection while removed development and repeated parameters fall back", () => {
  const report = buildClubReport();
  assert.equal(clubSelection(report, { section: "development", player: "1762153" }).section, "overview");
  assert.equal(clubSelection(report, { section: "rotation", player: "1762153" }).player.sourceId, "1762153");
  assert.equal(clubSelection(report, { section: ["rotation", "development"] }).section, "overview");
});
