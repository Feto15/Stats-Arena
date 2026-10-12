import type { BoxScoreRecord, ParseReport, ShotRecord, ValidationIssue } from "./types.js";
import { issue } from "../parsers/common.js";

export function validateShotsAgainstBoxScore(
  shots: ParseReport<ShotRecord>,
  boxScore: { teams: Array<Pick<BoxScoreRecord["teams"][number], "teamSourceId" | "teamName" | "fieldGoalsAttempted" | "fieldGoalsMade">> }
): ValidationIssue[] {
  if (shots.status !== "parsed") return [];
  const issues: ValidationIssue[] = [];
  for (const team of boxScore.teams) {
    const teamShots = shots.records.filter((shot) => shot.teamSourceId === team.teamSourceId);
    if (team.fieldGoalsAttempted !== null) {
      const actual = teamShots.length;
      if (actual !== team.fieldGoalsAttempted) issues.push(issue(
        "error", "SHOT_FGA_MISMATCH", `Jumlah marker tembakan tidak cocok dengan FGA resmi untuk ${team.teamName}; chart sebelumnya dipertahankan.`,
        shots.sourceUrl, `teams.${team.teamSourceId}.FGA`, team.fieldGoalsAttempted, actual
      ));
    }
    if (team.fieldGoalsMade !== null) {
      const actual = teamShots.filter((shot) => shot.result === "made").length;
      if (actual !== team.fieldGoalsMade) issues.push(issue(
        "error", "SHOT_FGM_MISMATCH", `Jumlah marker made tidak cocok dengan FGM resmi untuk ${team.teamName}; chart sebelumnya dipertahankan.`,
        shots.sourceUrl, `teams.${team.teamSourceId}.FGM`, team.fieldGoalsMade, actual
      ));
    }
  }
  const knownTeams = new Set(boxScore.teams.map((team) => team.teamSourceId));
  if (shots.records.some((shot) => !knownTeams.has(shot.teamSourceId))) {
    issues.push(issue("error", "SHOT_TEAM_MISMATCH", "Marker tembakan memuat tim di luar box score pertandingan; chart sebelumnya dipertahankan.", shots.sourceUrl, "shots.teamSourceId"));
  }
  return issues;
}
