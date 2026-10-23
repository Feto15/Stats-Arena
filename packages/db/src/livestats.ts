/** Supplementary values never replace portal identities or core box score. */
export interface LiveStatsProvenance { sha256: string; fetchedAt: string; snapshotPath: string }
export interface LiveStatsPlayer {
  provenance?: LiveStatsProvenance;
  playerId: string;
  teamId: string;
  localPlayerKey: string;
  localTeamKey: string;
  name: string;
  jerseyNumber: string;
  plusMinus: number | null;
  starter: boolean | null;
  position: string | null;
  blocksReceived: number | null;
  foulsDrawn: number | null;
  secondChancePoints: number | null;
  fastBreakPoints: number | null;
  pointsInPaint: number | null;
  indexOfSuccess: number | null;
  mappingMethod: "team_jersey_name_core_stats_v1";
}

export interface LiveStatsTeam {
  provenance?: LiveStatsProvenance;
  teamId: string;
  localTeamKey: string;
  benchPoints: number | null;
  secondChancePoints: number | null;
  pointsInPaint: number | null;
  pointsFromTurnovers: number | null;
  fastBreakPoints: number | null;
  biggestLead: number | null;
  biggestScoringRun: number | null;
}

export interface LiveStatsSupplement {
  players: LiveStatsPlayer[];
  teams: LiveStatsTeam[];
}

export type LiveStatsStatus = "ready" | "partial" | "unavailable" | "fetch_failed" | "parse_failed" | "mismatch";
export interface LiveStatsIssue { code: string; field: string; message: string; expected?: unknown; actual?: unknown; evidence?: { sha256: string; fetchedAt: string; snapshotPath: string } }
