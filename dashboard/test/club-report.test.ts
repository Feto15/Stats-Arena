import assert from "node:assert/strict";
import test from "node:test";
import snapshot from "../lib/reports/demo-club.json";
import { buildClubReport, clubHref, clubSelection, difference, formatMinutes, gameStatChange } from "../lib/reports/club-report";

test("club report freezes the two-game window and reads both away results from the club perspective", () => {
  const report = buildClubReport();
  assert.equal(report.club.sourceId, "126038");
  assert.equal(report.competition.key, "IBL:42041");
  assert.deepEqual(report.games.map(game => game.fixture.sourceId), ["2697586", "2697587"]);
  assert.deepEqual(report.games.map(game => [game.team.stats.points, game.opponent.stats.points, game.result, game.margin]), [[65, 53, "W", 12], [44, 100, "L", -56]]);
  assert.equal(report.wins, 1);
  assert.equal(report.losses, 1);
  assert.equal(report.totals.points, 109);
  assert.equal(report.opponentTotals.points, 153);
  assert.equal(report.perGame.points, 54.5);
  assert.equal(report.opponentPerGame.points, 76.5);
  assert.equal(report.perGame.turnovers, 20);
  assert.equal(report.players.length, 12);
  assert.ok(report.players.every(player => player.gameIds.every(id => report.scope.gameIds.includes(id as "2697586" | "2697587"))));
  assert.equal(gameStatChange(report, "points"), -21);
  assert.equal(gameStatChange(report, "turnovers"), 8);
  assert.deepEqual(report.games[0]!.clubPeriods, [{ period: 1, team: 18, opponent: 12 }, { period: 2, team: 12, opponent: 12 }, { period: 3, team: 11, opponent: 15 }, { period: 4, team: 24, opponent: 14 }]);
});

test("club shooting and ratings use summed inputs and possessions rather than unweighted game averages", () => {
  const report = buildClubReport();
  const possessions = 78.12 + 83.32;
  assert.ok(Math.abs(report.advancedStats.estimatedPossessions! - possessions) < 1e-10);
  assert.ok(Math.abs(report.advancedStats.offensiveRating! - 109 / possessions * 100) < 1e-10);
  assert.ok(Math.abs(report.advancedStats.defensiveRating! - 153 / possessions * 100) < 1e-10);
  assert.ok(Math.abs(report.advancedStats.effectiveFieldGoalPercentage! - 45 / 122 * 100) < 1e-10);
  const unweighted = report.games.reduce((total, game) => total + game.team.advancedStats.offensiveRating!, 0) / 2;
  assert.ok(Math.abs(report.advancedStats.offensiveRating! - unweighted) > .1);
  const santosa = report.players.find(player => player.name === "H. Santosa")!;
  assert.equal(santosa.totals.points, 25);
  assert.equal(santosa.perGame.points, 12.5);
  assert.equal(santosa.gamesRecorded, 2);
  assert.equal(formatMinutes(santosa.totals.minutes), "51:47");
  assert.ok(santosa.advancedStats.usagePercentage! > 0);
  assert.ok(Math.abs(santosa.advancedStats.pointsSharePercentage! - 25 / 109 * 100) < 1e-10);
});

test("player context follows only observed rows; zero-minute records are counted explicitly", () => {
  const report = buildClubReport();
  const kurnianto = report.players.find(player => player.name === "J. Kurnianto")!;
  assert.equal(kurnianto.gamesRecorded, 2);
  assert.equal(kurnianto.gamesWithMinutes, 1);
  const changed = structuredClone(snapshot);
  changed.games[1]!.players = changed.games[1]!.players.filter(player => player.name !== "H. Santosa");
  const santosa = buildClubReport(changed).players.find(player => player.name === "H. Santosa")!;
  assert.equal(santosa.gamesRecorded, 1);
  assert.deepEqual(santosa.gameIds, ["2697586"]);
  assert.equal(santosa.perGame.points, 17);
  assert.ok(Math.abs(santosa.advancedStats.pointsSharePercentage! - 17 / 65 * 100) < 1e-10);
});

test("missing inputs stay unavailable, including usage with incomplete team minutes", () => {
  const changed = { ...snapshot, games: snapshot.games.map((game, index) => index === 1 ? {
    ...game, players: game.players.map(player => player.name === "H. Santosa" ? {
      ...player, stats: { ...player.stats, assists: null, minutes: null },
    } : player),
  } : game) };
  const report = buildClubReport(changed);
  const santosa = report.players.find(player => player.name === "H. Santosa")!;
  assert.equal(santosa.perGame.assists, null);
  assert.equal(santosa.totals.minutes, null);
  assert.equal(santosa.advancedStats.usagePercentage, null);
  assert.equal(report.players.find(player => player.name === "A. Kurniawan")!.perGame.assists, 0);
  assert.equal(formatMinutes(null), "—");
  assert.equal(formatMinutes(0), "0:00");
  assert.equal(difference(null, 1), null);
});

test("future games, wrong club, namespace, reordered windows, and mismatched provenance are rejected", () => {
  assert.throws(() => buildClubReport({ ...snapshot, games: [...snapshot.games, snapshot.games[0]] }));
  assert.throws(() => buildClubReport({ ...snapshot, games: [...snapshot.games].reverse() }));
  assert.throws(() => buildClubReport({ ...snapshot, games: snapshot.games.map((game, index) => index === 1 ? { ...game, fixture: { ...game.fixture, sourceId: "2697591" } } : game) }));
  assert.throws(() => buildClubReport({ ...snapshot, club: { ...snapshot.club, sourceId: "126041" } }));
  assert.throws(() => buildClubReport({ ...snapshot, scope: { ...snapshot.scope, competitionKey: "42041" } }));
  assert.throws(() => buildClubReport({ ...snapshot, games: snapshot.games.map(game => ({ ...game, provenance: { ...game.provenance, resources: [] } })) }));
});

test("club URL selection never displays a foreign player and falls back on repeated or invalid parameters", () => {
  const report = buildClubReport();
  assert.equal(clubSelection(report, { section: "players", player: "1438124" }).player.sourceId, report.players[0]!.sourceId);
  assert.equal(clubSelection(report, { section: ["games", "players"], player: ["126038"] }).section, "overview");
  assert.equal(clubSelection(report, { section: "games" }).section, "games");
  assert.equal(clubHref("players", "1762153"), "/reports/bima-perkasa?section=players&player=1762153");
});
