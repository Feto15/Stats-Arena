import { z } from "zod";
import type { LiveStatsIssue, LiveStatsSupplement, LiveStatsTeam, LiveStatsRotationEvidence } from "@statsarena/db/livestats";
import { liveStatsPlayerNameEvidence, liveStatsPlayerNames, normalizeLiveStatsName as normalize } from "@statsarena/db/livestats";
import { parsedDataHash } from "../domain/content-hash.js";
import { officialMetricConflicts } from "./official-metrics.js";

export const coreFields = {
  points: "sPoints", fieldGoalsMade: "sFieldGoalsMade", fieldGoalsAttempted: "sFieldGoalsAttempted",
  twoPointsMade: "sTwoPointersMade", twoPointAttempts: "sTwoPointersAttempted",
  threePointsMade: "sThreePointersMade", threePointAttempts: "sThreePointersAttempted",
  freeThrowsMade: "sFreeThrowsMade", freeThrowAttempts: "sFreeThrowsAttempted",
  offensiveRebounds: "sReboundsOffensive", defensiveRebounds: "sReboundsDefensive", rebounds: "sReboundsTotal",
  assists: "sAssists", steals: "sSteals", blocks: "sBlocks", turnovers: "sTurnovers", personalFouls: "sFoulsPersonal"
} as const;
type CoreField = keyof typeof coreFields;
export type PortalCore = Record<CoreField, number | null>;
export interface PortalPlayer extends PortalCore { playerId: string; teamId: string; name: string; jerseyNumber: string | null }
export interface PortalTeam extends PortalCore { teamId: string; name: string }
export interface PortalContext {
  gameId: string; sourceGameId: string; competitionUrl: string; homeTeamId: string | null; awayTeamId: string | null;
  homeScore: number | null; awayScore: number | null; status: string;
  players: PortalPlayer[]; teams: PortalTeam[];
  officialMetrics?: { teamId: string; metricCode: string; value: number | null }[];
}

const unknownRecord = z.record(z.string(), z.unknown());
const teamSchema = unknownRecord.and(z.object({ name: z.string().min(1), score: z.number().int().nonnegative(), pl: z.record(z.string(), unknownRecord) }));
const dataSchema = z.object({ tm: z.record(z.string(), teamSchema), pbp: z.unknown().optional() });

export interface LiveStatsReport { status: "ready" | "partial" | "mismatch"; payload: LiveStatsSupplement | null; issues: LiveStatsIssue[] }

/** Deterministic enrichment only. Global identities always come from portal rows. */
export function parseLiveStatsJson(input: unknown, portal: PortalContext): LiveStatsReport {
  const data = dataSchema.parse(input);
  const issues: LiveStatsIssue[] = [];
  const add = (code: string, field: string, message: string, expected?: unknown, actual?: unknown) => issues.push({ code, field, message,
    ...(expected !== undefined ? { expected } : {}), ...(actual !== undefined ? { actual } : {}) });
  const integer = (record: Record<string, unknown>, key: string, field: string, signed = false): number | null => {
    const value = record[key];
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || (!signed && value < 0)) {
      add("LIVESTATS_FIELD_INVALID", field, `Nilai ${key} tidak valid.`); return null;
    }
    return value;
  };
  const coreMatches = (row: PortalCore, raw: Record<string, unknown>, prefix = "") => Object.entries(coreFields)
    .every(([field, key]) => {
      const expected = row[field as CoreField], actual = raw[`${prefix}${key}`];
      if (expected === null) return false;
      if (actual === expected) return true;
      // Some portal layouts omit explicit team rebounds from OFF/DEF while
      // LiveStats totals include them. Only reconcile using supplied components.
      const teamComponent = prefix && field === "offensiveRebounds" ? raw["tot_sReboundsTeamOffensive"]
        : prefix && field === "defensiveRebounds" ? raw["tot_sReboundsTeamDefensive"] : null;
      return typeof actual === "number" && typeof teamComponent === "number" && Number.isSafeInteger(teamComponent) && teamComponent >= 0 && actual - teamComponent === expected;
    });
  const payload: LiveStatsSupplement = { players: [], teams: [] };
  if (Object.keys(data.tm).length !== 2 || portal.teams.length !== 2 || !portal.homeTeamId || !portal.awayTeamId || !portal.players.length) {
    return { status: "mismatch", payload: null, issues: [{ code: "LIVESTATS_PORTAL_INCOMPLETE", field: "teams", message: "Dua tim dan box score portal lengkap dibutuhkan untuk memetakan identitas." }] };
  }
  if (data.tm["1"]?.score !== portal.homeScore || data.tm["2"]?.score !== portal.awayScore) return {
    status: "mismatch", payload: null, issues: [{ code: "LIVESTATS_SCORE_MISMATCH", field: "score", message: "Skor pertandingan berbeda; seluruh tambahan baru ditolak.", expected: [portal.homeScore, portal.awayScore], actual: [data.tm["1"]?.score, data.tm["2"]?.score] }]
  };
  for (const [localTeamKey, rawTeam] of Object.entries(data.tm)) {
    const teamId = localTeamKey === "1" ? portal.homeTeamId : localTeamKey === "2" ? portal.awayTeamId : null;
    const team = portal.teams.find(t => t.teamId === teamId);
    const score = localTeamKey === "1" ? portal.homeScore : portal.awayScore;
    const teamNames = [rawTeam.name, rawTeam["nameInternational"], rawTeam["shortName"], rawTeam["shortNameInternational"]].filter((name): name is string => typeof name === "string" && name.trim().length > 0).map(normalize);
    if (!team || !teamNames.includes(normalize(team.name)) || score === null || score !== rawTeam.score || !coreMatches(team, rawTeam, "tot_")) {
      add("LIVESTATS_TEAM_MISMATCH", `teams.${localTeamKey}`, "Identitas, skor, atau statistik dasar tim tidak cocok dengan portal.",
        team ? { name: team.name, score, ...Object.fromEntries(Object.keys(coreFields).map(field => [field, team[field as CoreField]])) } : null,
        { names: teamNames, score: rawTeam.score, ...Object.fromEntries(Object.entries(coreFields).map(([field, key]) => [field, rawTeam[`tot_${key}`]])) });
      continue;
    }
    const metric = (key: string) => integer(rawTeam, key, `teams.${localTeamKey}.${key}`);
    payload.teams.push({ teamId: team.teamId, localTeamKey, benchPoints: metric("tot_sBenchPoints"), secondChancePoints: metric("tot_sPointsSecondChance"),
      pointsInPaint: metric("tot_sPointsInThePaint"), pointsFromTurnovers: metric("tot_sPointsFromTurnovers"), fastBreakPoints: metric("tot_sPointsFastBreak"),
      biggestLead: metric("tot_sBiggestLead"), biggestScoringRun: metric("tot_sBiggestScoringRun") });
    const portalPlayers = portal.players.filter(p => p.teamId === team.teamId);
    if (Object.keys(rawTeam.pl).length !== portalPlayers.length) add("LIVESTATS_ROSTER_MISMATCH", `teams.${localTeamKey}.players`, "Jumlah pemain berbeda dari box score portal.");
    const matched = new Set<string>();
    let starters = 0;
    for (const [localPlayerKey, raw] of Object.entries(rawTeam.pl)) {
      const field = `teams.${localTeamKey}.players.${localPlayerKey}`;
      const names = liveStatsPlayerNames(liveStatsPlayerNameEvidence(raw)).map(normalize);
      const jersey = raw["shirtNumber"];
      // No fuzzy/name-only joins, order-based joins, or new global player creation.
      const candidates = typeof jersey === "string" && jersey.trim() ? portalPlayers.filter(p => p.jerseyNumber?.trim() === jersey.trim() && names.includes(normalize(p.name))) : [];
      const player = candidates[0];
      if (candidates.length !== 1 || !player || matched.has(player.playerId) || !coreMatches(player, raw)) {
        add("LIVESTATS_PLAYER_MAPPING_MISMATCH", field, "Tim, nomor, nama, dan statistik dasar tidak menghasilkan satu pemain portal yang cocok.",
          candidates.map(p => ({ name: p.name, jerseyNumber: p.jerseyNumber, ...Object.fromEntries(Object.keys(coreFields).map(key => [key, p[key as CoreField]])) })),
          { names, jersey, ...Object.fromEntries(Object.entries(coreFields).map(([key, value]) => [key, raw[value]])) }); continue;
      }
      matched.add(player.playerId);
      const value = (key: string, signed = false) => integer(raw, key, `${field}.${key}`, signed);
      const starter = raw["starter"] === 1 ? true : raw["starter"] === 0 ? false : null;
      if (starter === null) add("LIVESTATS_STARTER_MISSING", `${field}.starter`, "Penanda starter tidak valid/tersedia.");
      if (starter) starters += 1;
      payload.players.push({ playerId: player.playerId, teamId: team.teamId, localTeamKey, localPlayerKey, name: player.name, jerseyNumber: jersey as string,
        plusMinus: value("sPlusMinusPoints", true), starter, position: typeof raw["playingPosition"] === "string" ? raw["playingPosition"].trim() || null : null,
        blocksReceived: value("sBlocksReceived"), foulsDrawn: value("sFoulsOn"), secondChancePoints: value("sPointsSecondChance"),
        fastBreakPoints: value("sPointsFastBreak"), pointsInPaint: value("sPointsInThePaint"), indexOfSuccess: value("eff_5", true),
        mappingMethod: "team_jersey_name_core_stats_v1" });
    }
    if (matched.size !== portalPlayers.length) add("LIVESTATS_ROSTER_MISMATCH", `teams.${localTeamKey}.players`, "Tidak semua baris pemain dapat dipetakan dengan bukti yang cukup.");
    if (starters !== 5) add("LIVESTATS_STARTER_COUNT", `teams.${localTeamKey}.starter`, "Jumlah starter terverifikasi bukan lima.");
  }
  issues.push(...officialMetricConflicts(portal.officialMetrics ?? [], payload.teams));
  if (!payload.players.length && !payload.teams.length) return { status: "mismatch", payload: null, issues };
  const pbp = z.array(unknownRecord).min(10).max(5000).safeParse(data.pbp);
  if (pbp.success && portal.homeScore !== null && portal.awayScore !== null) {
    const eventFields = ["clock", "period", "periodType", "tno", "pno", "player", "shirtNumber", "actionType", "subType", "actionNumber", "previousAction", "qualifier", "scoring", "s1", "s2", "success", "gt"];
    payload.rotation = {
      format: "statsarena-livestats-rotation/1.0.0", gameSourceId: portal.sourceGameId, homeScore: portal.homeScore, awayScore: portal.awayScore,
      events: pbp.data.map((event, sourceSequence) => ({ sourceSequence, ...Object.fromEntries(eventFields.map(key => [key, event[key]])) })),
      teams: payload.teams.map(team => ({ teamId: team.teamId, localTeamKey: team.localTeamKey,
        players: payload.players.filter(p => p.teamId === team.teamId).map(player => {
          const raw = data.tm[team.localTeamKey]!.pl[player.localPlayerKey]!;
          return { playerId: player.playerId, localPlayerKey: player.localPlayerKey, name: player.name, jerseyNumber: player.jerseyNumber,
            starter: player.starter, plusMinus: player.plusMinus, minutesRaw: typeof raw["sMinutes"] === "string" ? raw["sMinutes"] : null,
            nameEvidence: liveStatsPlayerNameEvidence(raw), core: Object.fromEntries(Object.entries(coreFields).map(([field, key]) => [field, raw[key]])) };
        }) })),
    };
  }
  return { status: issues.length ? "partial" : "ready", payload, issues };
}

/** A shorter source revision is not evidence that prior events or identities were officially deleted. */
export function rotationEvidenceIsReduced(previous: LiveStatsRotationEvidence | undefined, incoming: LiveStatsRotationEvidence | undefined) {
  return !!previous && (!incoming || incoming.events.length < previous.events.length || previous.teams.some(team => {
    const next = incoming.teams.find(t => t.teamId === team.teamId);
    return !next || team.players.some(p => !next.players.some(n => n.playerId === p.playerId));
  }));
}

/** Missing optional fields never erase previously verified values. */
export function mergeSupplement(previous: LiveStatsSupplement | null, incoming: LiveStatsSupplement): LiveStatsSupplement {
  function merge<T extends { teamId: string }>(oldRows: T[], newRows: T[], key: (row: T) => string): T[] {
    return newRows.map(row => {
      const old = oldRows.find(entry => key(entry) === key(row));
      // Preserve an entire previous record if an optional field disappears,
      // keeping one unambiguous source revision for every saved value.
      if (old && Object.entries(row).some(([field, value]) => value === null && old[field as keyof T] != null)) return old;
      const withoutProvenance = (value: T) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== "provenance"));
      if (old && parsedDataHash(withoutProvenance(old)) === parsedDataHash(withoutProvenance(row))) return old;
      return row;
    }).concat(oldRows.filter(old => !newRows.some(row => key(row) === key(old))));
  }
  const oldRotation = previous?.rotation;
  const nextRotation = incoming.rotation;
  const content = (row: NonNullable<LiveStatsSupplement["rotation"]>) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "provenance"));
  const rotation = !nextRotation || oldRotation && (rotationEvidenceIsReduced(oldRotation, nextRotation) || parsedDataHash(content(oldRotation)) === parsedDataHash(content(nextRotation))) ? oldRotation : nextRotation;
  return { players: merge(previous?.players ?? [], incoming.players, row => row.playerId),
    teams: merge<LiveStatsTeam>(previous?.teams ?? [], incoming.teams, row => row.teamId),
    ...(rotation ? { rotation } : {}) };
}
