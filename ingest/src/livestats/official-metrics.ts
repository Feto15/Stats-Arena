import type { LiveStatsIssue, LiveStatsTeam } from "@statsarena/db/livestats";

export function officialMetricConflicts(
  official: { teamId: string; metricCode: string; value: number | null }[], teams: LiveStatsTeam[]
): LiveStatsIssue[] {
  const fields = [["BP", "benchPoints"], ["2CP", "secondChancePoints"], ["PIP", "pointsInPaint"], ["PFT", "pointsFromTurnovers"], ["FBP", "fastBreakPoints"]] as const;
  return official.flatMap(metric => {
    const field = fields.find(([code]) => code === metric.metricCode)?.[1];
    const team = teams.find(t => t.teamId === metric.teamId);
    const live = field && team ? team[field] : null;
    if (!team || metric.value === null || typeof live !== "number" || live === metric.value) return [];
    return [{ code: "LIVESTATS_OFFICIAL_METRIC_CONFLICT", field: `teams.${team.localTeamKey}.${metric.metricCode}`,
      message: `Portal ${metric.metricCode}=${metric.value}, LiveStats=${live}; kedua nilai tetap dipisahkan berdasarkan sumber.`, expected: metric.value, actual: live }];
  });
}
