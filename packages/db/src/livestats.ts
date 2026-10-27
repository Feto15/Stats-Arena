/** Supplementary values never replace portal identities or core box score. */
export const LIVE_STATS_PLAYER_NAME_FIELDS = ["name", "scoreboardName", "firstName", "familyName", "internationalFirstName", "internationalFamilyName"] as const;
export type LiveStatsPlayerNameEvidence = Record<typeof LIVE_STATS_PLAYER_NAME_FIELDS[number], string | null>;
export const normalizeLiveStatsName = (value: string) => value.normalize("NFKC").toUpperCase().replace(/[^\p{L}\p{N}]/gu, "");
export function liveStatsPlayerNameEvidence(raw: Record<string, unknown>): LiveStatsPlayerNameEvidence {
  const field = (key: typeof LIVE_STATS_PLAYER_NAME_FIELDS[number]) => typeof raw[key] === "string" && raw[key].trim() ? raw[key].trim() : null;
  return { name: field("name"), scoreboardName: field("scoreboardName"), firstName: field("firstName"), familyName: field("familyName"), internationalFirstName: field("internationalFirstName"), internationalFamilyName: field("internationalFamilyName") };
}
/** Only derive initial + family from an explicit structured first/family pair; never fuzzy-match names. */
export function liveStatsPlayerNames(evidence: LiveStatsPlayerNameEvidence): string[] {
  const names = [evidence.name, evidence.scoreboardName];
  for (const [first, family] of [[evidence.firstName, evidence.familyName], [evidence.internationalFirstName, evidence.internationalFamilyName]]) {
    const full = [first, family].filter(Boolean).join(" ");
    if (full) names.push(full);
    const initial = first?.match(/^\p{L}/u)?.[0];
    if (initial && family) names.push(`${initial}. ${family}`);
  }
  return [...new Set(names.filter((name): name is string => Boolean(name)))];
}

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
  rotation?: LiveStatsRotationEvidence;
}

/** One immutable source revision; IDs are scoped portal database IDs, never inferred from array order. */
export interface LiveStatsRotationEvidence {
  format: "statsarena-livestats-rotation/1.0.0";
  gameSourceId: string;
  homeScore: number; awayScore: number;
  provenance?: LiveStatsProvenance;
  teams: Array<{ teamId: string; localTeamKey: string; players: Array<{
    playerId: string; localPlayerKey: string; name: string; jerseyNumber: string;
    starter: boolean | null; plusMinus: number | null; minutesRaw: string | null;
    nameEvidence: LiveStatsPlayerNameEvidence; core: Record<string, unknown>;
  }> }>;
  events: Array<Record<string, unknown>>;
}

export type LiveStatsStatus = "ready" | "partial" | "unavailable" | "fetch_failed" | "parse_failed" | "mismatch";
export interface LiveStatsIssue { code: string; field: string; message: string; expected?: unknown; actual?: unknown; evidence?: { sha256: string; fetchedAt: string; snapshotPath: string } }
