import { z } from "zod";
import { LIVE_STATS_PLAYER_NAME_FIELDS, liveStatsPlayerNames, normalizeLiveStatsName as normalize } from "@statsarena/db/livestats";
import type { ClubReport } from "./club-report";
import { buildOnOffRatingContext, calculateOnOffRating, isRotationActivity, type OnOffRating, type OnOffRatingContext } from "./club-onoff-rating";
import snapshot from "./demo-club-rotation.json";

export const ROTATION_VERSION = "statsarena-demo-rotation/1.3.0";
const integer = z.number().int().nonnegative();
const id = z.string().regex(/^[1-9]\d*$/);
const clock = z.string().regex(/^\d{2}:[0-5]\d:[0-9]{2}$/);
const coreFields = ["points", "fieldGoalsMade", "fieldGoalsAttempted", "twoPointsMade", "twoPointAttempts", "threePointsMade", "threePointAttempts", "freeThrowsMade", "freeThrowAttempts", "offensiveRebounds", "defensiveRebounds", "rebounds", "assists", "steals", "blocks", "turnovers", "personalFouls"] as const;
const playerSchema = z.object({
  sourceId: id, localKey: integer.positive(), name: z.string().min(1), jerseyNumber: z.string().min(1), starter: z.boolean(),
  minutesRaw: z.string().regex(/^\d{1,2}:[0-5]\d$/), plusMinus: z.number().int(),
  mappingMethod: z.literal("team_jersey_name_core_stats_v1"), core: z.record(z.string(), integer),
  nameEvidence: z.record(z.enum(LIVE_STATS_PLAYER_NAME_FIELDS), z.string().min(1).nullable()).optional(),
});
const eventSchema = z.object({
  sourceSequence: integer, clock, period: integer.min(1).max(4), periodType: z.literal("REGULAR"),
  tno: z.union([z.literal(0), z.literal(1), z.literal(2)]), pno: integer, player: z.string(), shirtNumber: z.string(),
  actionType: z.string().min(1), subType: z.string(), actionNumber: integer,
  previousAction: z.union([z.literal(""), integer]), qualifier: z.array(z.string()),
  scoring: z.union([z.literal(0), z.literal(1)]), success: z.union([z.literal(0), z.literal(1)]),
  s1: z.string().regex(/^\d+$/), s2: z.string().regex(/^\d+$/), gt: z.string(),
});
const gameSchema = z.object({
  gameId: id, clubLocalTeamKey: z.union([z.literal(1), z.literal(2)]), periodCount: z.literal(4), periodSeconds: z.literal(600),
  homeScore: integer, awayScore: integer, players: z.array(playerSchema).min(5).max(20), events: z.array(eventSchema).min(10).max(5000),
  source: z.object({ jsonUrl: z.string(), pageUrl: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/), fetchedAt: z.iso.datetime(),
    adapterVersion: z.enum(["statsarena-livestats/1.0.1", "statsarena-livestats/1.0.2", "statsarena-livestats/1.1.0"]), portalAuditFile: z.string().min(1), boxscoreSha256: z.string().regex(/^[a-f0-9]{64}$/) }),
});
export type RotationSourceGame = z.infer<typeof gameSchema>;
export interface RotationStint { from: number; to: number; playerIds: string[]; pointsFor: number; pointsAgainst: number; startSequence: number; endSequence: number }
export interface RotationTotals { seconds: number; pointsFor: number; pointsAgainst: number; margin: number }
export interface RotationLineup extends RotationTotals { key: string; playerIds: string[]; intervals: number }
export interface RotationPlayer { sourceId: string; name: string; jerseyNumber: string; starter: boolean; officialMinutesRaw: string; portalMinutesRaw: string | null; officialPlusMinus: number; minuteDifferenceSeconds: number; on: RotationTotals; off: RotationTotals; onRating: OnOffRating; offRating: OnOffRating; netRatingDifference: number | null }
export interface ReadyRotation { status: "ready"; gameId: string; durationSeconds: number; stints: RotationStint[]; lineups: RotationLineup[]; players: RotationPlayer[]; substitutions: number; source: RotationSourceGame["source"]; eventCount: number; ratingContext: OnOffRatingContext }
export interface PartialRotation { status: "partial"; gameId: string; issues: string[] }
export type ClubRotationGame = ReadyRotation | PartialRotation;

function seconds(raw: string) {
  const [minutes, secs, hundredths = "0"] = raw.split(":");
  return Number(minutes) * 60 + Number(secs) + Number(hundredths) / 100;
}
function totals(rows: RotationStint[]): RotationTotals {
  const sum = rows.reduce((a, row) => ({ seconds: a.seconds + row.to - row.from, pointsFor: a.pointsFor + row.pointsFor, pointsAgainst: a.pointsAgainst + row.pointsAgainst }), { seconds: 0, pointsFor: 0, pointsAgainst: 0 });
  return { ...sum, margin: sum.pointsFor - sum.pointsAgainst };
}

function reconstruct(input: unknown, portal: ClubReport["games"][number]): ReadyRotation {
  const data = gameSchema.parse(input);
  const require = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
  const gameId = portal.fixture.sourceId;
  const clubKey = data.clubLocalTeamKey;
  const opponentKey = clubKey === 1 ? 2 : 1;
  require(data.gameId === gameId && (clubKey === 1 ? portal.fixture.homeTeamSourceId : portal.fixture.awayTeamSourceId) === portal.team.sourceId, "Scope atau posisi tim tidak cocok.");
  require(data.source.jsonUrl === `https://fibalivestats.dcd.shared.geniussports.com/data/${gameId}/data.json` && data.source.pageUrl === `https://fibalivestats.dcd.shared.geniussports.com/u/IBL/${gameId}/bs.html`, "Referensi sumber LiveStats tidak cocok.");
  require(data.source.boxscoreSha256 === portal.provenance.resources.find(r => r.resource === "boxscore")?.sha256, "Referensi box score tidak cocok.");
  require(data.homeScore === portal.fixture.homeScore && data.awayScore === portal.fixture.awayScore, "Skor final berbeda dari portal.");
  require(data.players.length === portal.teamPlayers.length && new Set(data.players.map(p => p.sourceId)).size === data.players.length && new Set(data.players.map(p => p.localKey)).size === data.players.length, "Pemetaan skuad tidak lengkap atau ganda.");
  const byLocal = new Map(data.players.map(p => [p.localKey, p]));
  const namesByLocal = new Map<number, Set<string>>();
  for (const player of data.players) {
    const row = portal.teamPlayers.find(p => p.sourceId === player.sourceId);
    require(row && row.jerseyNumber === player.jerseyNumber && normalize(row.name) === normalize(player.name) && coreFields.every(field => player.core[field] === row.stats[field]), "Identitas atau statistik dasar pemain berbeda dari portal.");
    require(data.source.adapterVersion === "statsarena-livestats/1.0.1" || player.nameEvidence, "Bukti nama pemain LiveStats tidak tersedia.");
    const names = new Set((player.nameEvidence ? liveStatsPlayerNames(player.nameEvidence) : [player.name]).map(normalize));
    require(names.has(normalize(player.name)), "Nama portal tidak didukung field nama LiveStats.");
    namesByLocal.set(player.localKey, names);
  }
  let on = new Set(data.players.filter(p => p.starter).map(p => p.sourceId));
  require(on.size === 5, "Lima starter terverifikasi diperlukan.");
  require(new Set(data.events.map(e => e.actionNumber)).size === data.events.length && data.events.every((e, index) => e.sourceSequence === index), "Urutan sumber hilang atau event ganda.");
  // LiveStats stores newest first. Reverse the source order, never sort tied events by actionNumber.
  const events = [...data.events].reverse();
  let currentScore = [0, 0];
  let lastScore = [0, 0];
  let lastTime = 0;
  let previousTime = 0;
  let previousPeriod = 1;
  let startSequence = events[0]!.sourceSequence;
  const stints: RotationStint[] = [];
  let intervalHasActivity = false;
  const ambiguousSourceSequences: number[] = [];
  let pending: { period: number; clock: string; firstSequence: number; candidate: Set<string>; actors: Set<string> } | null = null;
  const push = (time: number, endSequence: number) => {
    const row = { from: lastTime, to: time, playerIds: [...on].sort(), pointsFor: currentScore[clubKey - 1]! - lastScore[clubKey - 1]!, pointsAgainst: currentScore[opponentKey - 1]! - lastScore[opponentKey - 1]!, startSequence, endSequence };
    // A known five can attempt a missed free throw between balanced substitutions at the same clock.
    if (row.to > row.from || row.pointsFor || row.pointsAgainst || intervalHasActivity) stints.push(row);
    intervalHasActivity = false;
    lastTime = time; lastScore = [...currentScore]; startSequence = endSequence;
  };
  const checkEvent = (event: RotationSourceGame["events"][number]) => {
    require(!pending || event.period === pending.period && event.clock === pending.clock, "Pergantian belum lengkap ketika jam atau periode berubah.");
    const left = seconds(event.clock);
    const time = (event.period - 1) * 600 + 600 - left;
    require(left <= 600 && time >= previousTime && event.period >= previousPeriod, "Jam atau urutan periode tidak valid.");
    previousTime = time; previousPeriod = event.period;
    const next = [Number(event.s1), Number(event.s2)];
    const delta = next.map((value, i) => value - currentScore[i]!);
    const added = delta[0]! + delta[1]!;
    const shotValue = event.actionType === "2pt" ? 2 : event.actionType === "3pt" ? 3 : event.actionType === "freethrow" ? 1 : 0;
    require(delta.every(value => value >= 0) && (added === 0 ? event.scoring === 0 || event.success === 0 && shotValue > 0 : event.scoring === 1 && event.success === 1 && shotValue === added && delta[event.tno - 1] === added), "Perubahan skor tidak didukung event scoring.");
    if (event.tno === clubKey && event.pno > 0) {
      const player = byLocal.get(event.pno);
      require(player && event.shirtNumber === player.jerseyNumber && namesByLocal.get(event.pno)?.has(normalize(event.player)), "Identitas pemain pada event tidak cocok.");
      if (event.actionType !== "substitution") require(player && on.has(player.sourceId), "Aksi pemain terjadi di luar interval bermain.");
    }
    require(!pending || added === 0, "Skor berubah sebelum pasangan pergantian lengkap.");
    currentScore = next;
    return time;
  };
  for (let index = 0; index < events.length; index++) {
    const event = events[index]!;
    if (event.actionType !== "substitution") {
      checkEvent(event);
      if (pending) {
        if (event.tno === clubKey && event.pno > 0) pending.actors.add(byLocal.get(event.pno)!.sourceId);
        if (isRotationActivity(event)) ambiguousSourceSequences.push(event.sourceSequence);
      } else if (isRotationActivity(event)) intervalHasActivity = true;
      continue;
    }
    const before = [...currentScore];
    const time = checkEvent(event);
    const group = [event];
    while (index + 1 < events.length && events[index + 1]!.actionType === "substitution" && events[index + 1]!.period === event.period && events[index + 1]!.clock === event.clock) group.push(events[++index]!);
    for (const item of group.slice(1)) checkEvent(item);
    require(currentScore.every((value, i) => value === before[i]), "Skor berubah di dalam kelompok pergantian.");
    const club = group.filter(item => item.tno === clubKey);
    if (!club.length) continue;
    require(club.every(item => item.subType === "in" || item.subType === "out"), "Jenis pergantian tidak dikenali.");
    const outs = club.filter(item => item.subType === "out").map(item => byLocal.get(item.pno)?.sourceId);
    const ins = club.filter(item => item.subType === "in").map(item => byLocal.get(item.pno)?.sourceId);
    const candidate: Set<string> = pending?.candidate ?? on;
    require([...outs, ...ins].every(Boolean) && new Set(outs).size === outs.length && new Set(ins).size === ins.length && outs.every(p => p && candidate.has(p)) && ins.every(p => p && (!candidate.has(p) || outs.includes(p))), "Urutan masuk/keluar pemain tidak konsisten.");
    // Keep source order. An incomplete pair may span a non-scoring event at this exact clock.
    // Durations and score can be recovered, but activity inside the open pair has no proven five.
    const next: Set<string> = new Set([...candidate].filter(p => !outs.includes(p)).concat(ins.filter((p): p is string => p !== undefined)));
    if (next.size !== 5) {
      if (pending) pending.candidate = next;
      else pending = { period: event.period, clock: event.clock, firstSequence: event.sourceSequence, candidate: next, actors: new Set() };
      continue;
    }
    require(!pending || [...pending.actors].every(playerId => next.has(playerId)), "Aksi pemain di sela pergantian tidak didukung kedua lineup.");
    push(time, pending?.firstSequence ?? event.sourceSequence);
    on = next;
    pending = null;
  }
  require(!pending, "Pasangan pergantian tidak lengkap sampai akhir laga.");
  for (let period = 1; period <= 4; period++) {
    const starts = events.filter(e => e.actionType === "period" && e.subType === "start" && e.period === period);
    const ends = events.filter(e => e.actionType === "period" && e.subType === "end" && e.period === period);
    require(starts.length === 1 && starts[0]!.clock === "10:00:00" && ends.length === 1 && ends[0]!.clock === "00:00:00", "Batas kuarter tidak lengkap.");
    const official = portal.periods?.find(p => p.period === period);
    const homeTotal = portal.periods?.filter(p => p.period <= period).reduce((n, p) => n + p.home, 0);
    const awayTotal = portal.periods?.filter(p => p.period <= period).reduce((n, p) => n + p.away, 0);
    require(official && Number(ends[0]!.s1) === homeTotal && Number(ends[0]!.s2) === awayTotal, "Skor akhir kuarter berbeda dari portal.");
  }
  require(events[0]?.actionType === "game" && events[0].subType === "start" && events[0].period === 1 && events[0].clock === "10:00:00" && events[0].s1 === "0" && events[0].s2 === "0" && events.at(-1)?.actionType === "game" && events.at(-1)?.subType === "end" && previousTime === 2400 && currentScore[0] === data.homeScore && currentScore[1] === data.awayScore, "Cakupan laga atau skor akhir tidak lengkap.");
  push(2400, events.at(-1)!.sourceSequence);
  const all = totals(stints);
  require(Math.abs(all.seconds - 2400) < .001 && all.pointsFor === (clubKey === 1 ? data.homeScore : data.awayScore) && all.pointsAgainst === (clubKey === 1 ? data.awayScore : data.homeScore), "Interval tidak mencakup durasi dan skor penuh.");
  const ratingContext = buildOnOffRatingContext(stints, data.events, portal, clubKey, ambiguousSourceSequences);
  const players = data.players.map(player => {
    const playing = totals(stints.filter(row => row.playerIds.includes(player.sourceId)));
    const off = totals(stints.filter(row => !row.playerIds.includes(player.sourceId)));
    const minuteDifferenceSeconds = playing.seconds - seconds(player.minutesRaw);
    require(Math.abs(minuteDifferenceSeconds) <= 1 && playing.margin === player.plusMinus, "Durasi atau plus/minus rekonstruksi berbeda dari LiveStats.");
    const onRating = calculateOnOffRating(ratingContext, stints.flatMap((row, i) => row.playerIds.includes(player.sourceId) ? [i] : []), playing.pointsFor, playing.pointsAgainst);
    const offRating = calculateOnOffRating(ratingContext, stints.flatMap((row, i) => !row.playerIds.includes(player.sourceId) ? [i] : []), off.pointsFor, off.pointsAgainst);
    const netRatingDifference = onRating.netRating === null || offRating.netRating === null ? null : onRating.netRating - offRating.netRating;
    return { sourceId: player.sourceId, name: player.name, jerseyNumber: player.jerseyNumber, starter: player.starter, officialMinutesRaw: player.minutesRaw, portalMinutesRaw: portal.teamPlayers.find(p => p.sourceId === player.sourceId)!.minutesRaw, officialPlusMinus: player.plusMinus, minuteDifferenceSeconds, on: playing, off, onRating, offRating, netRatingDifference };
  });
  const combinations = new Map<string, RotationLineup>();
  for (const stint of stints) {
    const key = stint.playerIds.join("/");
    const row = combinations.get(key) ?? { key, playerIds: stint.playerIds, seconds: 0, pointsFor: 0, pointsAgainst: 0, margin: 0, intervals: 0 };
    const value = totals([stint]);
    combinations.set(key, { ...row, seconds: row.seconds + value.seconds, pointsFor: row.pointsFor + value.pointsFor, pointsAgainst: row.pointsAgainst + value.pointsAgainst, margin: row.margin + value.margin, intervals: row.intervals + 1 });
  }
  return { status: "ready", gameId, durationSeconds: 2400, stints, players, lineups: [...combinations.values()].sort((a, b) => b.seconds - a.seconds || a.key.localeCompare(b.key)), substitutions: events.filter(e => e.tno === clubKey && e.actionType === "substitution").length, eventCount: events.length, source: data.source, ratingContext };
}

export function buildClubRotations(report: ClubReport, input: unknown = snapshot): ClubRotationGame[] {
  const data = z.object({ competitionKey: z.string(), clubSourceId: id, games: z.array(z.object({ gameId: id }).passthrough()).length(report.games.length) }).parse(input);
  if (data.competitionKey !== report.scope.competitionKey || data.clubSourceId !== report.club.sourceId || data.games.some((game, i) => game.gameId !== report.scope.gameIds[i])) throw new Error("Rotation scope is outside the club reporting window.");
  return data.games.map((raw, index) => {
    try { return reconstruct(raw, report.games[index]!); }
    catch (error) { return { status: "partial", gameId: raw.gameId, issues: [error instanceof z.ZodError ? "Struktur data rotasi tidak lengkap atau invalid." : error instanceof Error ? error.message : "Rotasi tidak dapat divalidasi."] }; }
  });
}

export function rotationSelection(games: ClubRotationGame[], params: Record<string, string | string[] | undefined>) {
  return games.find(game => game.gameId === params["rotationGame"]) ?? games[0]!;
}
