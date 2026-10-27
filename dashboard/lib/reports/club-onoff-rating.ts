import { ANALYTICS_VERSION, calculateMetric, type MetricInputs } from "@statsarena/db/analytics";
import type { ClubReport } from "./club-report";
import type { RotationSourceGame, RotationStint } from "./club-rotation";

export const ONOFF_RATING_VERSION = "statsarena-demo-onoff-rating/1.1.0";
const fields = ["fieldGoalsAttempted", "fieldGoalsMade", "twoPointAttempts", "threePointAttempts", "freeThrowAttempts", "freeThrowsMade", "offensiveRebounds", "turnovers", "teamOffensiveRebounds"] as const;
export type RotationActivity = Record<typeof fields[number], number>;
export interface OnOffRating {
  inputsFor: RotationActivity | null; inputsAgainst: RotationActivity | null;
  estimatedPossessions: number | null; offensiveRating: number | null; defensiveRating: number | null; netRating: number | null;
}
export interface OnOffRatingContext {
  status: "ready" | "partial"; issues: string[]; version: string; analyticsVersion: string;
  ambiguousSourceSequences: number[];
  activity: Array<{ for: RotationActivity; against: RotationActivity }>;
  totalFor: RotationActivity | null; totalAgainst: RotationActivity | null;
}
const empty = (): RotationActivity => ({ fieldGoalsAttempted: 0, fieldGoalsMade: 0, twoPointAttempts: 0, threePointAttempts: 0, freeThrowAttempts: 0, freeThrowsMade: 0, offensiveRebounds: 0, turnovers: 0, teamOffensiveRebounds: 0 });
function sum(rows: RotationActivity[]) {
  return rows.reduce((total, row) => Object.fromEntries(fields.map(field => [field, total[field] + row[field]])) as RotationActivity, empty());
}
export function isRotationActivity(event: RotationSourceGame["events"][number]) {
  return ["2pt", "3pt", "freethrow", "turnover", "rebound"].includes(event.actionType);
}

/** Count source events in their substitution-order interval, never allocate by minutes. */
export function buildOnOffRatingContext(stints: RotationStint[], events: RotationSourceGame["events"], game: ClubReport["games"][number], clubLocalTeamKey: 1 | 2 = 2, ambiguousSourceSequences: readonly number[] = []): OnOffRatingContext {
  const issues: string[] = [];
  const activity = stints.map(() => ({ for: empty(), against: empty() }));
  const unassigned = { for: empty(), against: empty() };
  for (const event of events.filter(isRotationActivity)) {
    const ambiguous = ambiguousSourceSequences.includes(event.sourceSequence);
    if (ambiguous) issues.push("Event statistik di sela pasangan pergantian pada jam yang sama belum memiliki lineup yang pasti.");
    const indices = stints.flatMap((stint, i) => event.sourceSequence <= stint.startSequence && event.sourceSequence > stint.endSequence ? [i] : []);
    if ((!ambiguous && indices.length !== 1) || ![1, 2].includes(event.tno)) { issues.push("Event statistik tidak memiliki satu interval dan tim yang valid."); continue; }
    const interval = ambiguous ? unassigned : activity[indices[0]!]!;
    const row = event.tno === clubLocalTeamKey ? interval.for : interval.against;
    if (event.actionType === "2pt" || event.actionType === "3pt") {
      if (event.scoring !== 1) issues.push("Penanda percobaan field goal tidak valid.");
      row.fieldGoalsAttempted += 1; row.fieldGoalsMade += event.success;
      row[event.actionType === "2pt" ? "twoPointAttempts" : "threePointAttempts"] += 1;
    } else if (event.actionType === "freethrow") {
      if (event.scoring !== 1) issues.push("Penanda percobaan free throw tidak valid.");
      row.freeThrowAttempts += 1; row.freeThrowsMade += event.success;
    } else if (event.actionType === "turnover") row.turnovers += 1;
    else if (event.actionType === "rebound") {
      if (!["offensive", "defensive"].includes(event.subType) || (event.pno === 0) !== event.qualifier.includes("team")) issues.push("Atribusi atau jenis rebound tidak valid.");
      // Portal OFF in these archived games excludes explicitly marked team rebounds.
      // Preserve them separately rather than silently changing the rating denominator.
      if (event.subType === "offensive") row[event.pno === 0 ? "teamOffensiveRebounds" : "offensiveRebounds"] += 1;
    }
  }
  const totalFor = sum([...activity.map(row => row.for), unassigned.for]);
  const totalAgainst = sum([...activity.map(row => row.against), unassigned.against]);
  for (const [label, total, stats] of [["tim", totalFor, game.team.stats], ["lawan", totalAgainst, game.opponent.stats]] as const) {
    for (const field of fields) if (field !== "teamOffensiveRebounds" && total[field] !== stats[field]) issues.push(`${field} ${label} pada event belum cocok dengan box score.`);
  }
  return { status: issues.length ? "partial" : "ready", issues: [...new Set(issues)], version: ONOFF_RATING_VERSION, analyticsVersion: ANALYTICS_VERSION, ambiguousSourceSequences: [...new Set(ambiguousSourceSequences)], activity, totalFor: issues.length ? null : totalFor, totalAgainst: issues.length ? null : totalAgainst };
}

/** Aggregate raw event counts first, then reuse the shared box-score estimate. */
export function calculateOnOffRating(context: OnOffRatingContext, indices: number[], pointsFor: number, pointsAgainst: number): OnOffRating {
  const unavailable: OnOffRating = { inputsFor: null, inputsAgainst: null, estimatedPossessions: null, offensiveRating: null, defensiveRating: null, netRating: null };
  if (context.status !== "ready") return unavailable;
  const rows = indices.map(i => context.activity[i]);
  if (new Set(indices).size !== indices.length || rows.some(row => !row)) return unavailable;
  const inputsFor = sum(rows.map(row => row!.for));
  const inputsAgainst = sum(rows.map(row => row!.against));
  const inputs: MetricInputs = { points: pointsFor, fieldGoalsAttempted: inputsFor.fieldGoalsAttempted, freeThrowAttempts: inputsFor.freeThrowAttempts, offensiveRebounds: inputsFor.offensiveRebounds, turnovers: inputsFor.turnovers,
    opponent_points: pointsAgainst, opponent_fieldGoalsAttempted: inputsAgainst.fieldGoalsAttempted, opponent_freeThrowAttempts: inputsAgainst.freeThrowAttempts, opponent_offensiveRebounds: inputsAgainst.offensiveRebounds, opponent_turnovers: inputsAgainst.turnovers };
  const estimate = calculateMetric("estimatedPossessions", inputs).value;
  const estimatedPossessions = estimate !== null && estimate >= 0 ? estimate : null;
  const available = estimatedPossessions !== null && estimatedPossessions > 0;
  return { inputsFor, inputsAgainst, estimatedPossessions, offensiveRating: available ? calculateMetric("offensiveRating", inputs).value : null, defensiveRating: available ? calculateMetric("defensiveRating", inputs).value : null, netRating: available ? calculateMetric("netRating", inputs).value : null };
}
