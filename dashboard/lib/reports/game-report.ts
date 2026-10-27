import { z } from "zod";
import {
  BASE_STAT_FIELDS,
  ANALYTICS_VERSION,
  calculateMetrics,
  contextualInputs,
  PLAYER_METRICS,
  TEAM_METRICS,
  sumStats,
  type Stats,
} from "@statsarena/db/analytics";
import snapshot from "./demo-game.json";

const count = z.number().finite().nonnegative().nullable();
const id = z.string().regex(/^[1-9]\d*$/);
const statsSchema = z.object(Object.fromEntries(BASE_STAT_FIELDS.map(field => [field, count])) as Record<keyof Stats, typeof count>);
const sourceUrl = z.url().refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" && url.hostname === "hosted.dcd.shared.geniussports.com" &&
    !url.port && !url.username && !url.password && /^\/IBL\/en\/competition\/[1-9]\d*(?:\/|$)/.test(url.pathname);
});
const teamSchema = z.object({ sourceId: id, name: z.string(), stats: statsSchema });
const playerSchema = teamSchema.extend({ teamSourceId: id, jerseyNumber: z.string().nullable(), minutesRaw: z.string().nullable() });
const periodSchema = z.object({ period: z.number().int().positive(), sourceSequence: z.number().int().nonnegative(), homeScore: count, awayScore: count });

export const scopedArchivedGameSchema = z.object({
  competition: z.object({ key: z.string().regex(/^IBL:[1-9]\d*$/), name: z.string().min(1), sourceUrl }),
  fixture: z.object({
    sourceId: id, sourceUrl, homeTeamSourceId: id, awayTeamSourceId: id,
    homeTeamName: z.string(), awayTeamName: z.string(), homeScore: count, awayScore: count,
    scheduledAtRaw: z.string().nullable(), venue: z.string().nullable(), status: z.literal("complete"),
  }),
  teams: z.array(teamSchema).length(2),
  players: z.array(playerSchema),
  periodEnds: z.array(periodSchema),
  provenance: z.object({
    auditFile: z.string(), auditCreatedAt: z.iso.datetime(), parserVersion: z.string(),
    resources: z.array(z.object({ resource: z.string(), sourceUrl, fetchedAt: z.iso.datetime(), sha256: z.string().regex(/^[a-f0-9]{64}$/), parserVersion: z.string().optional(), parseStatus: z.literal("parsed") })),
  }),
}).superRefine((data, ctx) => {
  const competitionId = data.competition.key.split(":")[1]!;
  const prefix = `/IBL/en/competition/${competitionId}`;
  for (const url of [data.competition.sourceUrl, data.fixture.sourceUrl, ...data.provenance.resources.map(r => r.sourceUrl)]) {
    const path = new URL(url).pathname;
    if (path !== prefix && !path.startsWith(`${prefix}/`)) ctx.addIssue({ code: "custom", message: "Cross-competition source URL." });
  }
  if (!new URL(data.fixture.sourceUrl).pathname.startsWith(`${prefix}/match/${data.fixture.sourceId}/`)) ctx.addIssue({ code: "custom", message: "Fixture URL does not match game ID." });
  for (const resource of data.provenance.resources) if (!new URL(resource.sourceUrl).pathname.startsWith(`${prefix}/match/${data.fixture.sourceId}/`)) ctx.addIssue({ code: "custom", message: "Resource URL does not match game ID." });
  const teamIds = new Set(data.teams.map(team => team.sourceId));
  if (teamIds.size !== 2 || !teamIds.has(data.fixture.homeTeamSourceId) || !teamIds.has(data.fixture.awayTeamSourceId)) {
    ctx.addIssue({ code: "custom", message: "Team identities do not match this fixture." });
  }
  const playerIds = new Set<string>();
  for (const player of data.players) {
    if (!teamIds.has(player.teamSourceId) || playerIds.has(player.sourceId)) ctx.addIssue({ code: "custom", message: "Invalid player membership or duplicate identity." });
    playerIds.add(player.sourceId);
  }
  for (const team of data.teams) {
    const officialScore = team.sourceId === data.fixture.homeTeamSourceId ? data.fixture.homeScore : data.fixture.awayScore;
    if (team.stats.points !== officialScore) ctx.addIssue({ code: "custom", message: "Team points do not match the final score." });
  }
});

/** Only explicit period-end observations are used; incomplete or inconsistent coverage stays unavailable. */
export function periodScores(observations: z.infer<typeof periodSchema>[], finalHome: number | null, finalAway: number | null) {
  const ordered = [...observations].sort((a, b) => a.sourceSequence - b.sourceSequence);
  if (ordered.length < 4 || finalHome === null || finalAway === null) return null;
  let previousHome = 0;
  let previousAway = 0;
  const periods = [];
  for (const [index, observation] of ordered.entries()) {
    if (observation.period !== index + 1 || observation.homeScore === null || observation.awayScore === null ||
      observation.homeScore < previousHome || observation.awayScore < previousAway ||
      (index > 0 && observation.sourceSequence <= ordered[index - 1]!.sourceSequence)) return null;
    periods.push({ period: observation.period, home: observation.homeScore - previousHome, away: observation.awayScore - previousAway });
    previousHome = observation.homeScore;
    previousAway = observation.awayScore;
  }
  return previousHome === finalHome && previousAway === finalAway ? periods : null;
}

export const archivedGameSchema = scopedArchivedGameSchema.refine(data => data.competition.key === "IBL:42041" && data.competition.name === "IBL All Indonesian 2025", "Unexpected demo competition.");

export const demoReportSchema = archivedGameSchema.refine(data => data.fixture.sourceId === "2697582", "Unexpected demo game.");

export function buildScopedArchivedGameReport(input: unknown) {
  const data = scopedArchivedGameSchema.parse(input);
  const teams = data.teams.map(team => {
    const opponent = data.teams.find(other => other.sourceId !== team.sourceId)!;
    return { ...team, ...calculateMetrics(contextualInputs(team.stats, 1, team.stats, opponent.stats), TEAM_METRICS) };
  });
  const players = data.players.map(player => {
    const team = teams.find(team => team.sourceId === player.teamSourceId)!;
    const opponent = teams.find(team => team.sourceId !== player.teamSourceId)!;
    const teamContext = { ...team.stats, minutes: sumStats(data.players.filter(row => row.teamSourceId === team.sourceId).map(row => row.stats)).minutes };
    return { ...player, ...calculateMetrics(contextualInputs(player.stats, 1, teamContext, opponent.stats), PLAYER_METRICS) };
  });
  return {
    ...data, teams, players, analyticsVersion: ANALYTICS_VERSION,
    periods: periodScores(data.periodEnds, data.fixture.homeScore, data.fixture.awayScore),
  };
}

export function buildArchivedGameReport(input: unknown) {
  return buildScopedArchivedGameReport(archivedGameSchema.parse(input));
}

export function buildDemoReport(input: unknown = snapshot) {
  return buildArchivedGameReport(demoReportSchema.parse(input));
}

export type GameReport = ReturnType<typeof buildDemoReport>;
export type ReportTeam = GameReport["teams"][number];
export type ReportPlayer = GameReport["players"][number];
export type ReportSection = "team" | "players";

export function reportSelection(report: GameReport, params: Record<string, string | string[] | undefined>) {
  const team = report.teams.find(team => team.sourceId === params["team"]) ?? report.teams[0]!;
  const opponent = report.teams.find(other => other.sourceId !== team.sourceId)!;
  const players = report.players.filter(player => player.teamSourceId === team.sourceId)
    .sort((a, b) => (b.advancedStats.gameScore ?? -Infinity) - (a.advancedStats.gameScore ?? -Infinity) || (b.stats.points ?? 0) - (a.stats.points ?? 0) || a.sourceId.localeCompare(b.sourceId));
  const player = players.find(player => player.sourceId === params["player"]) ?? players.find(player => player.stats.minutes !== null && player.stats.minutes > 0) ?? players[0]!;
  const section: ReportSection = params["section"] === "players" ? "players" : "team";
  return { team, opponent, players, player, section };
}

export function reportHref(team: string, section: ReportSection = "team", player?: string) {
  const query = new URLSearchParams({ team, section });
  if (player) query.set("player", player);
  return `/reports/demo-match?${query.toString()}`;
}

export function formatStat(value: number | null | undefined, digits = 0) {
  return value == null || !Number.isFinite(value) ? "—" : value.toLocaleString("id-ID", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function teamObservations(team: ReportTeam, opponent: ReportTeam) {
  const observations: Array<{ title: string; detail: string; focus: string }> = [];
  const efg = team.advancedStats.effectiveFieldGoalPercentage;
  const opponentEfg = opponent.advancedStats.effectiveFieldGoalPercentage;
  if (efg != null && opponentEfg != null) observations.push({
    title: efg >= opponentEfg ? "Efisiensi tembakan lebih tinggi" : "Efisiensi tembakan tertinggal",
    detail: `eFG% ${formatStat(efg, 1)}% berbanding ${formatStat(opponentEfg, 1)}% milik lawan. eFG% memperhitungkan bobot tambahan tembakan tiga angka.`,
    focus: "Tinjau pilihan dan kualitas tembakan lewat video; box score belum menjelaskan tekanan pertahanan.",
  });
  if (team.stats.turnovers !== null && opponent.stats.turnovers !== null) observations.push({
    title: `${formatStat(team.stats.turnovers)} turnover sepanjang laga`,
    detail: `Lawan mencatat ${formatStat(opponent.stats.turnovers)} turnover. Tim mencatat ${formatStat(team.stats.assists)} assist; rasio AST/TO ${formatStat(team.advancedStats.assistTurnoverRatio, 2)}.`,
    focus: "Tandai kehilangan bola di video untuk membedakan kesalahan passing, handling, dan pelanggaran.",
  });
  if (team.stats.offensiveRebounds !== null && opponent.stats.offensiveRebounds !== null) observations.push({
    title: `${formatStat(team.stats.offensiveRebounds)} offensive rebound`,
    detail: `Lawan mencatat ${formatStat(opponent.stats.offensiveRebounds)} offensive rebound. Total rebound tim ${formatStat(team.stats.rebounds)}, lawan ${formatStat(opponent.stats.rebounds)}.`,
    focus: "Tinjau box-out dan posisi rebound. Offensive rebound tidak otomatis menunjukkan second-chance points.",
  });
  return observations;
}
