import assert from "node:assert/strict";
import test from "node:test";
import type { GameDetail, OfficialGameMetricItem } from "../lib/data/contracts";
import { selectTeamMetrics } from "../lib/data/team-metrics.js";

test("team metrics prefer valid game portal values including zero and expose separate LiveStats conflicts/fallbacks", () => {
  const team = { id: "home", sourceTeamId: "1", name: "Home", logoUrl: null };
  const portal = (code: string, value: number | null, availability: "available" | "unavailable" = "available"): OfficialGameMetricItem => ({
    team, scopeType: "game", metricCode: code, value, availability, unit: "points", scopeLabel: "Final", sampleGamesPlayed: null,
    rawValue: value === null ? "—" : String(value), sourceUrl: "https://hosted.dcd.shared.geniussports.com/IBF/en/competition/1/match/2/analysis"
  });
  const game: Pick<GameDetail, "gameOfficialMetrics" | "liveStats" | "homeTeam" | "awayTeam"> = {
    homeTeam: team, awayTeam: { ...team, id: "away", sourceTeamId: "3" },
    gameOfficialMetrics: [portal("PIP", 0), portal("2CP", 4), portal("PFT", null, "unavailable"), { ...portal("FBP", 999), scopeType: "competition" }],
    liveStats: { status: "partial", sourceUrl: "https://fibalivestats.dcd.shared.geniussports.com/data/2/data.json", pageUrl: "https://fibalivestats.dcd.shared.geniussports.com/u/IBF/2/bs.html", sourceFetchedAt: new Date(), lastAttemptAt: new Date(), issues: [],
      payload: { players: [], teams: [{ teamId: "home", localTeamKey: "1", benchPoints: 3, secondChancePoints: 4, pointsInPaint: 16, pointsFromTurnovers: 13, fastBreakPoints: 5, biggestLead: null, biggestScoringRun: null }] } }
  };
  const before = structuredClone(game);
  const rows = selectTeamMetrics(game);
  const metrics = rows[0]!.metrics;
  const pip = metrics.find(m => m.code === "PIP")!;
  assert.equal(pip.value, 0); assert.equal(pip.source, "portal"); assert.equal(pip.conflict, true); assert.equal(pip.liveValue, 16);
  assert.equal(metrics.find(m => m.code === "2CP")!.conflict, false);
  assert.equal(metrics.find(m => m.code === "BP")!.source, "livestats");
  assert.equal(metrics.find(m => m.code === "PFT")!.value, 13);
  assert.equal(metrics.find(m => m.code === "FBP")!.value, 5); // Never use competition totals for a game.
  assert.ok(rows[1]!.metrics.every(m => m.value === null)); // No other team's fallback.
  assert.deepEqual(game, before);
  game.liveStats = null;
  const noLive = selectTeamMetrics(game)[0]!.metrics;
  assert.equal(noLive.find(m => m.code === "PIP")!.value, 0);
  assert.equal(noLive.find(m => m.code === "PFT")!.value, null);
});
