import { difference, type ClubPlayer, type ClubReport } from "./club-report";

export function playerDevelopment(report: ClubReport, player: ClubPlayer) {
  const first = player.games.find(game => game.gameId === report.scope.gameIds.at(-2));
  const second = player.games.find(game => game.gameId === report.scope.gameIds.at(-1));
  return { player, first, second, comparable: Boolean(first && second), changes: {
    minutes: difference(second?.stats.minutes, first?.stats.minutes),
    fieldGoalsAttempted: difference(second?.stats.fieldGoalsAttempted, first?.stats.fieldGoalsAttempted),
    threePointAttempts: difference(second?.stats.threePointAttempts, first?.stats.threePointAttempts),
    freeThrowAttempts: difference(second?.stats.freeThrowAttempts, first?.stats.freeThrowAttempts),
    points: difference(second?.stats.points, first?.stats.points), rebounds: difference(second?.stats.rebounds, first?.stats.rebounds), assists: difference(second?.stats.assists, first?.stats.assists), turnovers: difference(second?.stats.turnovers, first?.stats.turnovers),
    gameScore: difference(second?.advancedStats.gameScore, first?.advancedStats.gameScore),
    trueShootingPercentage: difference(second?.advancedStats.trueShootingPercentage, first?.advancedStats.trueShootingPercentage),
    effectiveFieldGoalPercentage: difference(second?.advancedStats.effectiveFieldGoalPercentage, first?.advancedStats.effectiveFieldGoalPercentage),
    usagePercentage: difference(second?.advancedStats.usagePercentage, first?.advancedStats.usagePercentage),
    turnoverPercentage: difference(second?.advancedStats.turnoverPercentage, first?.advancedStats.turnoverPercentage),
    pointsSharePercentage: difference(second?.advancedStats.pointsSharePercentage, first?.advancedStats.pointsSharePercentage),
  } };
}
export function signedChange(value: number | null, format: (value: number) => string) {
  if (value === null) return "—";
  return `${value < 0 ? "−" : value > 0 ? "+" : ""}${format(Math.abs(value))}`;
}
