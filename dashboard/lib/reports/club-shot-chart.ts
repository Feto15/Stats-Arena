import { z } from "zod";
import { calculateMetric } from "@statsarena/db/analytics";
import type { ClubReport } from "./club-report";
import snapshot from "./demo-club-shots.json";

const id = z.string().regex(/^[1-9]\d*$/);
const urlSchema = z.url().refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" && url.hostname === "hosted.dcd.shared.geniussports.com" && !url.port && !url.username && !url.password &&
    /^\/IBL\/en\/competition\/[1-9]\d*\/match\/[1-9]\d*\/shotchart$/.test(url.pathname);
});
const coordinate = z.number().finite().min(0).max(100);
const percentRaw = z.string().regex(/^\d+(?:\.\d+)?%$/);
const shotSchema = z.object({
  gameSourceId: id, sourceSequence: z.number().int().nonnegative(), sourceUrl: urlSchema,
  teamSourceId: id, playerSourceId: id, playerName: z.string().nullable(),
  periodNumber: z.number().int().positive(), shotType: z.enum(["2pt", "3pt"]), result: z.enum(["made", "missed"]),
  xRaw: percentRaw, yRaw: percentRaw, xPercent: coordinate, yPercent: coordinate,
  rawTitle: z.string(), rawClasses: z.array(z.string()),
}).refine(shot => Number(shot.xRaw.slice(0, -1)) === shot.xPercent && Number(shot.yRaw.slice(0, -1)) === shot.yPercent, "Raw and normalized source coordinates differ.");
const chartSchema = z.object({
  gameSourceId: id, sourceUrl: urlSchema, sha256: z.string().regex(/^[a-f0-9]{64}$/), fetchedAt: z.iso.datetime(),
  parserVersion: z.string(), status: z.literal("parsed"), shots: z.array(shotSchema),
});
const snapshotSchema = z.object({ competitionKey: z.string(), clubSourceId: id, charts: z.array(z.unknown()).max(1000) });
export type ClubShot = z.infer<typeof shotSchema>;

/** A mismatched chart never replaces the trusted box score or appears as a complete shot map. */
export function buildClubShotCharts(report: ClubReport, input: unknown = snapshot) {
  const root = snapshotSchema.safeParse(input);
  const chartCandidates = root.success ? root.data.charts.map(chart => chartSchema.safeParse(chart)) : [];
  const validCharts = chartCandidates.flatMap(result => result.success ? [result.data] : []);
  const identities = root.success ? root.data.charts.map(chart => z.object({ gameSourceId: id }).safeParse(chart)) : [];
  const gameIds = identities.flatMap(identity => identity.success ? [identity.data.gameSourceId] : []);
  const identitiesValid = root.success && root.data.competitionKey === report.scope.competitionKey && root.data.clubSourceId === report.club.sourceId && identities.every(identity => identity.success) &&
    new Set(gameIds).size === gameIds.length && gameIds.every(id => report.games.some(game => game.fixture.sourceId === id));
  return report.games.map(game => {
    const chart = validCharts.find(chart => chart.gameSourceId === game.fixture.sourceId);
    const reference = game.provenance.resources.find(resource => resource.resource === "shotchart");
    const problems: string[] = [];
    if (!identitiesValid || !chart) problems.push("Identitas, scope, atau struktur arsip shot chart belum valid.");
    if (chart && (!reference || reference.sha256 !== chart.sha256 || reference.sourceUrl !== chart.sourceUrl || reference.fetchedAt !== chart.fetchedAt || (reference.parserVersion ?? game.provenance.parserVersion) !== chart.parserVersion)) problems.push("Provenance shot chart belum cocok dengan arsip pertandingan.");
    if (chart) {
      const sequences = new Set<number>();
      for (const shot of chart.shots) {
        if (shot.teamSourceId !== report.club.sourceId || shot.gameSourceId !== game.fixture.sourceId || shot.sourceUrl !== chart.sourceUrl || sequences.has(shot.sourceSequence) ||
          !game.teamPlayers.some(player => player.sourceId === shot.playerSourceId) ||
          !game.periodEnds.some(period => period.period === shot.periodNumber)) {
          problems.push("Ada marker dengan identitas, periode, atau urutan sumber yang tidak sesuai.");
          break;
        }
        sequences.add(shot.sourceSequence);
      }
      const checkTotals = (shots: ClubShot[], stats: typeof game.team.stats, label: string) => {
        for (const type of ["all", "2pt", "3pt"] as const) {
          const selected = shots.filter(shot => type === "all" || shot.shotType === type);
          const attempted = type === "all" ? stats.fieldGoalsAttempted : type === "2pt" ? stats.twoPointAttempts : stats.threePointAttempts;
          const made = type === "all" ? stats.fieldGoalsMade : type === "2pt" ? stats.twoPointsMade : stats.threePointsMade;
          if (attempted === null || made === null || selected.length !== attempted || selected.filter(shot => shot.result === "made").length !== made) problems.push(`Jumlah ${type} ${label} belum cocok dengan box score.`);
        }
      };
      checkTotals(chart.shots, game.team.stats, "tim");
      for (const player of game.teamPlayers) checkTotals(chart.shots.filter(shot => shot.playerSourceId === player.sourceId), player.stats, player.name);
    }
    return { gameId: game.fixture.sourceId, number: game.number, opponent: game.opponent.name,
      status: problems.length ? "partial" as const : "ready" as const, problems,
      source: reference ?? null, shots: problems.length ? [] : [...chart!.shots].sort((a, b) => a.sourceSequence - b.sourceSequence),
    };
  });
}

export interface ClubShotFilters {
  game: string;
  player: string;
  period: number | null;
  result: "all" | "made" | "missed";
  shotType: "all" | "2pt" | "3pt";
}

export function parseClubShotFilters(report: ClubReport, params: Record<string, string | string[] | undefined>): ClubShotFilters {
  const game = report.games.find(game => game.fixture.sourceId === params["game"]);
  const player = report.players.find(player => player.sourceId === params["player"]);
  const period = typeof params["period"] === "string" && /^[1-9]\d*$/.test(params["period"]) ? Number(params["period"]) : null;
  return {
    game: game?.fixture.sourceId ?? "all", player: player?.sourceId ?? "all",
    period: period !== null && report.games.some(game => game.periodEnds.some(row => row.period === period)) ? period : null,
    result: params["result"] === "made" ? "made" : params["result"] === "missed" ? "missed" : "all",
    shotType: params["shotType"] === "2pt" ? "2pt" : params["shotType"] === "3pt" ? "3pt" : "all",
  };
}

/** The reporting screen shows one source canvas at a time; legacy all falls back to game 1. */
export function parseSingleClubShotFilters(report: ClubReport, params: Record<string, string | string[] | undefined>): ClubShotFilters {
  const filters = parseClubShotFilters(report, params);
  return { ...filters, game: filters.game === "all" ? report.games[0]?.fixture.sourceId ?? "all" : filters.game };
}

export function summarizeClubShots(shots: readonly ClubShot[]) {
  const made = shots.filter(shot => shot.result === "made").length;
  return { attempts: shots.length, made, missed: shots.length - made,
    percentage: calculateMetric("fieldGoalPercentage", { fieldGoalsMade: made, fieldGoalsAttempted: shots.length }).value };
}

export function selectClubShots(report: ClubReport, filters: ClubShotFilters, input: unknown = snapshot) {
  const charts = buildClubShotCharts(report, input).filter(chart => filters.game === "all" || chart.gameId === filters.game).map(chart => {
    const base = chart.shots.filter(shot => (filters.player === "all" || shot.playerSourceId === filters.player) &&
      (filters.period === null || shot.periodNumber === filters.period) && (filters.shotType === "all" || shot.shotType === filters.shotType));
    // Result controls marker visibility, while FG% retains the full attempts denominator for the selection.
    return { ...chart, base, visible: base.filter(shot => filters.result === "all" || shot.result === filters.result), summary: chart.status === "ready" ? summarizeClubShots(base) : null };
  });
  const ready = charts.filter(chart => chart.status === "ready");
  return { charts, readyCount: ready.length, summary: ready.length ? summarizeClubShots(ready.flatMap(chart => chart.base)) : null,
    visibleCount: ready.reduce((count, chart) => count + chart.visible.length, 0) };
}
