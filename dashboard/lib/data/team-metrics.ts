import type { GameDetail } from "./contracts";

export const TEAM_METRIC_CODES = ["BP", "2CP", "PIP", "PFT", "FBP"] as const;
export function selectTeamMetrics(game: Pick<GameDetail, "gameOfficialMetrics" | "liveStats" | "homeTeam" | "awayTeam">) {
  const fields = { BP: "benchPoints", "2CP": "secondChancePoints", PIP: "pointsInPaint", PFT: "pointsFromTurnovers", FBP: "fastBreakPoints" } as const;
  return [game.homeTeam, game.awayTeam].filter(team => team !== null).map(team => ({ team, metrics: TEAM_METRIC_CODES.map(code => {
    const portal = game.gameOfficialMetrics.find(m => m.team.id === team.id && m.metricCode === code && m.scopeType === "game");
    const extra = game.liveStats?.payload?.teams.find(t => t.teamId === team.id);
    const portalValue = portal?.availability === "available" && portal.value !== null && portal.value >= 0 ? portal.value : null;
    const liveValue = extra?.[fields[code]] ?? null;
    const source = portalValue !== null ? "portal" : liveValue !== null ? "livestats" : null;
    return { code, value: portalValue ?? liveValue, source, sourceUrl: source === "portal" ? portal?.sourceUrl ?? null : source === "livestats" ? game.liveStats?.pageUrl ?? null : null,
      conflict: portalValue !== null && liveValue !== null && portalValue !== liveValue, portalValue, liveValue };
  }) }));
}
