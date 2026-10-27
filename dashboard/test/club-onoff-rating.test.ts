import assert from "node:assert/strict";
import test from "node:test";
import { buildClubReport } from "../lib/reports/club-report";
import { buildClubRotations, type ReadyRotation } from "../lib/reports/club-rotation";
import { calculateOnOffRating } from "../lib/reports/club-onoff-rating";
import snapshot from "../lib/reports/demo-club-rotation.json";
const report = buildClubReport();
const close = (actual: number | null, expected: number) => assert.ok(actual !== null && Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
function games(input: unknown = snapshot) { const result = buildClubRotations(report, input); for (const game of result) assert.equal(game.status, "ready"); return result as ReadyRotation[]; }

test("ON/OFF event estimates reconcile both teams with box scores and all players with whole-game ratings", () => {
  for (const [i, game] of games().entries()) {
    assert.equal(game.ratingContext.status, "ready");
    const full = calculateOnOffRating(game.ratingContext, game.stints.map((_, index) => index), report.games[i]!.team.stats.points!, report.games[i]!.opponent.stats.points!);
    close(full.estimatedPossessions, [78.12, 83.32][i]!);
    close(full.netRating, report.games[i]!.team.advancedStats.netRating!);
    close(full.offensiveRating, report.games[i]!.team.advancedStats.offensiveRating!);
    close(full.defensiveRating, report.games[i]!.team.advancedStats.defensiveRating!);
    for (const p of game.players) {
      close(p.onRating.estimatedPossessions! + p.offRating.estimatedPossessions!, full.estimatedPossessions!);
      for (const [inputs, total] of [["inputsFor", game.ratingContext.totalFor], ["inputsAgainst", game.ratingContext.totalAgainst]] as const) {
        for (const field of ["fieldGoalsAttempted", "freeThrowAttempts", "offensiveRebounds", "turnovers", "teamOffensiveRebounds"] as const) assert.equal(p.onRating[inputs]![field] + p.offRating[inputs]![field], total![field]);
      }
      for (const rating of [p.onRating, p.offRating]) if (rating.netRating !== null) close(rating.netRating, rating.offensiveRating! - rating.defensiveRating!);
      if (p.onRating.netRating !== null && p.offRating.netRating !== null) {
        close(p.netRatingDifference, p.onRating.netRating - p.offRating.netRating);
        close((p.onRating.netRating * p.onRating.estimatedPossessions! + p.offRating.netRating * p.offRating.estimatedPossessions!) / full.estimatedPossessions!, full.netRating!);
      }
    }
  }
});

test("Annur's second-game denominator follows actual interval events, not a minute allocation", () => {
  const g = games()[1]!;
  const p = g.players.find(p => p.name === "H. Annur")!;
  assert.deepEqual([p.onRating.inputsFor!.fieldGoalsAttempted, p.onRating.inputsFor!.freeThrowAttempts, p.onRating.inputsFor!.offensiveRebounds, p.onRating.inputsFor!.turnovers], [26, 4, 2, 5]);
  assert.deepEqual([p.onRating.inputsAgainst!.fieldGoalsAttempted, p.onRating.inputsAgainst!.freeThrowAttempts, p.onRating.inputsAgainst!.offensiveRebounds, p.onRating.inputsAgainst!.turnovers], [25, 9, 4, 3]);
  close(p.onRating.estimatedPossessions, 29.36);
  close(p.offRating.estimatedPossessions, 53.96);
  close(p.onRating.netRating, -15 / 29.36 * 100);
  close(p.offRating.netRating, -41 / 53.96 * 100);
  close(p.netRatingDifference, 24.89229078760532);
  assert.ok(Math.abs(p.onRating.estimatedPossessions! - 83.32 * p.on.seconds / 2400) > 1);
  assert.equal(p.onRating.inputsFor!.teamOffensiveRebounds, 2, "explicit team rebounds remain separate from portal OFF");
});

test("zero exposure and zero estimates stay zero while rates and swing remain unavailable", () => {
  const p = games()[0]!.players.find(p => p.name === "J. Kurnianto")!;
  assert.equal(p.onRating.estimatedPossessions, 0);
  assert.equal(p.onRating.netRating, null);
  assert.equal(p.onRating.offensiveRating, null);
  assert.equal(p.onRating.defensiveRating, null);
  assert.equal(p.netRatingDifference, null);
  close(p.offRating.netRating, 12 / 78.12 * 100);
});

test("missing shot counts or ambiguous rebounds withhold rates but preserve verified rotation and raw plus/minus", () => {
  for (const kind of ["shot", "rebound"] as const) {
    const changed = structuredClone(snapshot);
    if (kind === "shot") {
      const e = changed.games[0]!.events.find(e => e.actionType === "2pt" && e.success === 0)!;
      e.actionType = "assist"; e.scoring = 0;
    } else changed.games[0]!.events.find(e => e.actionType === "rebound" && e.subType === "offensive" && e.pno === 0)!.qualifier = [];
    const result = games(changed);
    assert.equal(result[0]!.ratingContext.status, "partial");
    assert.ok(result[0]!.ratingContext.issues.length > 0);
    assert.ok(result[0]!.players.every(p => p.onRating.netRating === null && p.offRating.netRating === null));
    assert.equal(result[0]!.players.find(p => p.name === "H. Annur")!.on.margin, 29);
    assert.equal(result[1]!.ratingContext.status, "ready");
  }
});

test("duplicate or nonexistent interval selections cannot inflate possession counts", () => {
  const game = games()[0]!;
  assert.equal(calculateOnOffRating(game.ratingContext, [0, 0], 0, 0).netRating, null);
  assert.equal(calculateOnOffRating(game.ratingContext, [999], 0, 0).estimatedPossessions, null);
});
