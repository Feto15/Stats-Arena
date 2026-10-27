import assert from "node:assert/strict";
import test from "node:test";
import { buildClubReport } from "../lib/reports/club-report";
import { buildClubRotations, rotationSelection, type ReadyRotation } from "../lib/reports/club-rotation";
import snapshot from "../lib/reports/demo-club-rotation.json";

const report = buildClubReport();
function ready() { const games = buildClubRotations(report); for (const game of games) assert.equal(game.status, "ready"); return games as ReadyRotation[]; }
function partial(change: (input: typeof snapshot) => void) {
  const data = structuredClone(snapshot); change(data);
  const games = buildClubRotations(report, data);
  assert.equal(games[0]!.status, "partial");
  assert.equal(games[1]!.status, "ready", "valid second game must survive first-game validation failure");
}

test("actual source reconstructs both complete games, every player, and official plus/minus", () => {
  const games = ready();
  assert.deepEqual(games.map(g => [g.gameId, g.durationSeconds, g.eventCount, g.substitutions, g.lineups.length]), [["2697586", 2400, 503, 42, 16], ["2697587", 2400, 539, 54, 18]]);
  assert.deepEqual(games[0]!.stints[0]!.playerIds, ["1438065", "1438106", "1622704", "1761998", "1762153"]);
  for (const [index, game] of games.entries()) {
    assert.equal(game.players.filter(p => p.starter).length, 5);
    assert.equal(game.players.length, 12);
    assert.equal(game.stints.reduce((n, s) => n + s.to - s.from, 0), 2400);
    assert.equal(game.lineups.reduce((n, row) => n + row.pointsFor, 0), report.games[index]!.team.stats.points);
    assert.equal(game.lineups.reduce((n, row) => n + row.pointsAgainst, 0), report.games[index]!.opponent.stats.points);
    assert.ok(Math.abs(game.players.reduce((n, p) => n + p.on.seconds, 0) - 12000) < 1e-8);
    for (const player of game.players) {
      assert.equal(player.on.margin, player.officialPlusMinus);
      assert.ok(Math.abs(player.minuteDifferenceSeconds) <= 1);
      assert.ok(Math.abs(player.on.seconds + player.off.seconds - 2400) < 1e-8);
      assert.equal(player.on.pointsFor + player.off.pointsFor, report.games[index]!.team.stats.points);
      assert.equal(player.on.pointsAgainst + player.off.pointsAgainst, report.games[index]!.opponent.stats.points);
    }
    assert.ok(game.stints.every(s => s.playerIds.length === 5));
    assert.ok(game.lineups.every((row, i) => i === 0 || row.seconds <= game.lineups[i - 1]!.seconds));
  }
  const annur = games[0]!.players.find(p => p.name === "H. Annur")!;
  assert.equal(annur.on.seconds, 1379);
  assert.equal(annur.officialPlusMinus, 29);
  const kurnianto = games[0]!.players.find(p => p.name === "J. Kurnianto")!;
  assert.deepEqual(kurnianto.on, { seconds: 0, pointsFor: 0, pointsAgainst: 0, margin: 0 });
  assert.equal(kurnianto.off.margin, 12);
});

test("hundredths, tied substitutions, and portal minute differences remain explicit", () => {
  const game = ready()[0]!;
  const mustofa = game.players.find(p => p.name === "A. Mustofa")!;
  assert.ok(Math.abs(mustofa.on.seconds - 309.7) < 1e-8);
  assert.equal(mustofa.officialMinutesRaw, "5:10");
  assert.equal(mustofa.portalMinutesRaw, "5:09");
  assert.ok(game.stints.some(row => row.from % 1 !== 0 || row.to % 1 !== 0));
  // The actual source includes same-clock in/out events whose actionNumbers are
  // not chronological. Passing this fixture protects atomic source-order handling.
  assert.ok(game.stints.every(row => row.startSequence >= row.endSequence));
  assert.equal(snapshot.games[0]!.events[0]!.actionType, "game");
  assert.equal(snapshot.games[0]!.events.at(-1)!.subType, "start");
});

test("missing starters, source events, or valid five-player transitions withhold the game", () => {
  partial(d => { d.games[0]!.players[0]!.starter = false; });
  partial(d => { d.games[0]!.events.splice(20, 1); });
  partial(d => { const event = d.games[0]!.events.find(e => e.tno === 2 && e.actionType === "substitution" && e.subType === "out")!; event.subType = "in"; });
  partial(d => { d.games[0]!.events.find(e => e.tno === 2 && e.actionType === "substitution")!.pno = 99; });
  partial(d => { d.games[0]!.events.find(e => e.tno === 2 && e.actionType === "substitution")!.shirtNumber = "999"; });
});

test("identity, minute, plus/minus, quarter, score, and provenance mismatches fail closed", () => {
  partial(d => { d.games[0]!.players[0]!.core.points += 1; });
  partial(d => { d.games[0]!.players[0]!.sourceId = "99999"; });
  partial(d => { d.games[0]!.players[0]!.minutesRaw = "19:28"; });
  partial(d => { d.games[0]!.players[0]!.plusMinus += 1; });
  partial(d => { d.games[0]!.events.find(e => e.actionType === "period" && e.subType === "end")!.subType = "other"; });
  partial(d => { d.games[0]!.events[12]!.s1 = "0"; });
  partial(d => { d.games[0]!.source.boxscoreSha256 = "0".repeat(64); });
  partial(d => { d.games[0]!.source.jsonUrl = "https://example.com/data.json"; });
  partial(d => { d.games[0]!.events[12]!.clock = "11:00:00"; });
});

test("out-of-scope namespaces and reordered or extra games are rejected; URL fallbacks stay scoped", () => {
  assert.throws(() => buildClubRotations(report, { ...snapshot, competitionKey: "IBF:42041" }));
  assert.throws(() => buildClubRotations(report, { ...snapshot, games: [...snapshot.games].reverse() }));
  assert.throws(() => buildClubRotations(report, { ...snapshot, games: [...snapshot.games, snapshot.games[0]] }));
  const games = ready();
  assert.equal(rotationSelection(games, { rotationGame: "2697587" }).gameId, "2697587");
  assert.equal(rotationSelection(games, { rotationGame: "2697591" }).gameId, "2697586");
  assert.equal(rotationSelection(games, { rotationGame: ["2697587", "2697586"] }).gameId, "2697586");
});
