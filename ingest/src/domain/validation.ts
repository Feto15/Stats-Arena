import type { BoxScoreRecord, SummaryRecord, ValidationIssue } from "./types.js";
import { issue } from "../parsers/common.js";

// Core box score counts must be present before replacing a complete snapshot.
// Rebounds can include team rebounds, so they are not checked against player sums.
const REQUIRED_STATS = [
  "points", "fieldGoalsMade", "fieldGoalsAttempted", "twoPointsMade", "twoPointAttempts",
  "threePointsMade", "threePointAttempts", "freeThrowsMade", "freeThrowAttempts",
  "offensiveRebounds", "defensiveRebounds", "rebounds", "assists", "steals", "blocks",
  "turnovers", "personalFouls"
] as const;

export function boxScoreCompletenessIssues(boxScore: BoxScoreRecord): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const sourceUrl = boxScore.sourceUrl;
  const teamIds = new Set(boxScore.teams.map((team) => team.teamSourceId));
  if (teamIds.size !== 2 || boxScore.teams.length !== 2) {
    issues.push(issue("error", "BOXSCORE_TEAMS_INCOMPLETE", "Box score harus memuat dua tim berbeda.", sourceUrl, "teams"));
  }
  const playerIds = new Set<string>();
  for (const player of boxScore.players) {
    if (player.minutes === null && player.minutesRaw !== null && !/^(?:-|–|—|n\/a)$/i.test(player.minutesRaw)) {
      issues.push(issue("error", "BOXSCORE_MINUTES_INVALID", "Durasi pemain tidak dapat dinormalisasi.", sourceUrl, `players.${player.playerSourceId}.minutes`, null, player.minutesRaw));
    }
    if (playerIds.has(player.playerSourceId) || !teamIds.has(player.teamSourceId)) {
      issues.push(issue("error", "BOXSCORE_PLAYER_IDENTITY_INVALID", "Identitas pemain duplikat atau tim pemain tidak ada pada totals.", sourceUrl, `players.${player.playerSourceId}`));
    }
    playerIds.add(player.playerSourceId);
  }
  for (const row of [...boxScore.teams, ...boxScore.players]) {
    const missing = REQUIRED_STATS.filter((field) => row[field] === null);
    if (missing.length > 0) {
      issues.push(issue("error", "BOXSCORE_CORE_STATS_MISSING", "Statistik inti tidak lengkap; statistik sebelumnya dipertahankan.", sourceUrl, "stats", null, missing));
    }
  }
  for (const team of boxScore.teams) {
    const players = boxScore.players.filter((player) => player.teamSourceId === team.teamSourceId);
    if (players.length === 0) {
      issues.push(issue("error", "BOXSCORE_PLAYERS_EMPTY", "Tim tidak memiliki baris pemain; totals saja tidak boleh mengganti statistik lama.", sourceUrl, `teams.${team.teamSourceId}.players`));
      continue;
    }
    if (team.points !== null && players.every((player) => player.points !== null)) {
      const playerPoints = players.reduce((sum, player) => sum + (player.points ?? 0), 0);
      if (playerPoints !== team.points) {
        issues.push(issue("error", "BOXSCORE_PLAYER_POINTS_INCOMPLETE", "Jumlah poin pemain berbeda dari totals; baris pemain mungkin tidak lengkap.", sourceUrl, `teams.${team.teamSourceId}.players.points`, team.points, playerPoints));
      }
    }
  }
  return issues;
}

export function validateBoxScore(boxScore: BoxScoreRecord, summary: SummaryRecord | null): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const team of boxScore.teams) {
    validateLine(team, team.teamName, team.sourceUrl, "team", issues);
  }
  for (const player of boxScore.players) {
    validateLine(player, player.playerName, player.sourceUrl, "player", issues);
  }

  if (!summary) return issues;
  for (const team of boxScore.teams) {
    const isHome = team.teamSourceId === summary.homeTeamSourceId;
    const isAway = team.teamSourceId === summary.awayTeamSourceId;
    if (!isHome && !isAway) {
      issues.push(issue(
        "warning",
        "SUMMARY_BOXSCORE_TEAM_MISMATCH",
        `Tim ${team.teamName} pada box score tidak cocok dengan ID tim pada summary.`,
        summary.sourceUrl,
        `teams.${team.teamSourceId}`,
        [summary.homeTeamSourceId, summary.awayTeamSourceId],
        team.teamSourceId
      ));
      continue;
    }
    const summaryScore = isHome ? summary.homeScore : summary.awayScore;
    if (team.points !== null && summaryScore !== null && team.points !== summaryScore) {
      issues.push(issue(
        "error",
        "SUMMARY_BOXSCORE_SCORE_MISMATCH",
        `Total poin ${team.teamName} pada box score tidak sama dengan skor summary.`,
        summary.sourceUrl,
        `teams.${team.teamSourceId}.points`,
        summaryScore,
        team.points
      ));
    }
  }
  return issues;
}

function validateLine(
  stats: {
    points: number | null;
    twoPointsMade: number | null;
    threePointsMade: number | null;
    freeThrowsMade: number | null;
    fieldGoalsAttempted: number | null;
    twoPointAttempts: number | null;
    threePointAttempts: number | null;
  },
  label: string,
  sourceUrl: string,
  kind: "team" | "player",
  issues: ValidationIssue[]
): void {
  if (
    stats.points !== null &&
    stats.twoPointsMade !== null &&
    stats.threePointsMade !== null &&
    stats.freeThrowsMade !== null
  ) {
    const expectedPoints = 2 * stats.twoPointsMade + 3 * stats.threePointsMade + stats.freeThrowsMade;
    if (stats.points !== expectedPoints) {
      issues.push(issue(
        "error",
        "POINTS_FORMULA_MISMATCH",
        `${kind === "team" ? "Total" : "Statistik pemain"} ${label}: PTS tidak sama dengan 2×2PM + 3×3PM + FTM.`,
        sourceUrl,
        `${kind}.${label}.points`,
        expectedPoints,
        stats.points
      ));
    }
  }

  if (stats.fieldGoalsAttempted !== null && stats.twoPointAttempts !== null && stats.threePointAttempts !== null) {
    const expectedAttempts = stats.twoPointAttempts + stats.threePointAttempts;
    if (stats.fieldGoalsAttempted !== expectedAttempts) {
      issues.push(issue(
        "error",
        "FIELD_GOALS_ATTEMPTS_MISMATCH",
        `${kind === "team" ? "Total" : "Statistik pemain"} ${label}: FGA tidak sama dengan 2PA + 3PA.`,
        sourceUrl,
        `${kind}.${label}.fieldGoalsAttempted`,
        expectedAttempts,
        stats.fieldGoalsAttempted
      ));
    }
  }
}
