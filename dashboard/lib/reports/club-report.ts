import { z } from "zod";
import { ANALYTICS_VERSION, calculateMetrics, contextualInputs, PLAYER_METRICS, TEAM_METRICS, sumStats, type StatField, type Stats } from "@statsarena/db/analytics";
import { archivedGameSchema, scopedArchivedGameSchema, buildScopedArchivedGameReport } from "./game-report";
import snapshot from "./demo-club.json";
import { reportSection } from "./navigation";

const windowGameIds = ["2697586", "2697587"] as const;
export const clubReportSchema = z.object({
  club: z.object({ sourceId: z.literal("126038"), name: z.literal("Bima Perkasa Jogja") }),
  scope: z.object({ competitionKey: z.literal("IBL:42041"), gameIds: z.tuple([z.literal("2697586"), z.literal("2697587")]), label: z.string() }),
  games: z.array(archivedGameSchema).length(2),
}).superRefine((data, ctx) => {
  for (const [index, game] of data.games.entries()) {
    if (game.fixture.sourceId !== windowGameIds[index] ||
      !game.teams.some(team => team.sourceId === data.club.sourceId)) {
      ctx.addIssue({ code: "custom", message: "Game is outside this club's two-game reporting window." });
    }
    if (game.players.filter(player => player.teamSourceId === data.club.sourceId).length === 0) {
      ctx.addIssue({ code: "custom", message: "Club player statistics are missing." });
    }
    if (!game.provenance.resources.some(resource => resource.resource === "boxscore" && new URL(resource.sourceUrl).pathname.includes(`/match/${game.fixture.sourceId}/`))) {
      ctx.addIssue({ code: "custom", message: "Missing game-scoped box score provenance." });
    }
  }
});

function perGameStats(stats: Stats, count: number): Stats {
  return Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, value === null ? null : value / count])) as Stats;
}

export const scopedClubReportSchema = z.object({
  club: z.object({ sourceId: z.string().regex(/^[1-9]\d*$/), name: z.string().min(1) }),
  competition: scopedArchivedGameSchema.shape.competition,
  scope: z.object({ competitionKey: z.string(), gameIds: z.array(z.string()), label: z.string() }),
  basePath: z.string().regex(/^\/reports\/[a-z0-9]+(?:-[a-z0-9]+)*$/),
  games: z.array(scopedArchivedGameSchema),
}).superRefine((data, ctx) => {
  if (data.scope.competitionKey !== data.competition.key || new Set(data.scope.gameIds).size !== data.games.length || data.scope.gameIds.length !== data.games.length) ctx.addIssue({ code: "custom", message: "Club game scope is incomplete or duplicated." });
  for (const [i, game] of data.games.entries()) if (game.competition.key !== data.competition.key || game.fixture.sourceId !== data.scope.gameIds[i] || !game.teams.some(t => t.sourceId === data.club.sourceId) || !game.players.some(p => p.teamSourceId === data.club.sourceId) || !game.provenance.resources.some(r => r.resource === "boxscore")) ctx.addIssue({ code: "custom", message: "Game or player is outside the club/competition scope." });
});

export function buildClubReport(input: unknown = snapshot) {
  const data = clubReportSchema.parse(input);
  return buildScopedClubReport({ ...data, competition: data.games[0]!.competition, basePath: "/reports/bima-perkasa" });
}

export function buildScopedClubReport(input: unknown) {
  const data = scopedClubReportSchema.parse(input);
  const games = data.games.map((raw, index) => {
    const game = buildScopedArchivedGameReport(raw);
    const team = game.teams.find(team => team.sourceId === data.club.sourceId)!;
    const opponent = game.teams.find(team => team.sourceId !== data.club.sourceId)!;
    const teamPlayers = game.players.filter(player => player.teamSourceId === team.sourceId);
    const context = { ...team.stats, minutes: sumStats(teamPlayers.map(player => player.stats)).minutes };
    const margin = team.stats.points === null || opponent.stats.points === null ? null : team.stats.points - opponent.stats.points;
    return { ...game, number: index + 1, team, opponent, teamPlayers, context, margin,
      result: margin === null ? null : margin > 0 ? "W" as const : margin < 0 ? "L" as const : "D" as const,
      clubPeriods: game.periods?.map(period => ({ period: period.period,
        team: team.sourceId === game.fixture.homeTeamSourceId ? period.home : period.away,
        opponent: team.sourceId === game.fixture.homeTeamSourceId ? period.away : period.home,
      })) ?? null,
    };
  });
  const totals = sumStats(games.map(game => game.team.stats));
  const opponentTotals = sumStats(games.map(game => game.opponent.stats));
  const analytics = calculateMetrics(contextualInputs(totals, games.length, totals, opponentTotals), TEAM_METRICS);
  const identities = new Map(games.flatMap(game => game.teamPlayers.map(player => [player.sourceId, player] as const)));
  const players = Array.from(identities.values()).map(identity => {
    // Each player's context includes only games with an observed box score row.
    const appearances = games.flatMap(game => {
      const row = game.teamPlayers.find(player => player.sourceId === identity.sourceId);
      return row ? [{ game, row }] : [];
    });
    const stats = sumStats(appearances.map(appearance => appearance.row.stats));
    const teamContext = sumStats(appearances.map(appearance => appearance.game.context));
    const opponentContext = sumStats(appearances.map(appearance => appearance.game.opponent.stats));
    return {
      sourceId: identity.sourceId, name: identity.name, jerseyNumber: identity.jerseyNumber,
      gamesRecorded: appearances.length, gamesWithMinutes: appearances.filter(appearance => (appearance.row.stats.minutes ?? 0) > 0).length,
      gameIds: appearances.map(appearance => appearance.game.fixture.sourceId),
      totals: stats, perGame: perGameStats(stats, appearances.length),
      ...calculateMetrics(contextualInputs(stats, appearances.length, teamContext, opponentContext), PLAYER_METRICS),
      games: appearances.map(({ game, row }) => ({ number: game.number, gameId: game.fixture.sourceId, opponent: game.opponent.name, stats: row.stats, minutesRaw: row.minutesRaw, advancedStats: row.advancedStats })),
    };
  }).sort((a, b) => (b.perGame.points ?? -Infinity) - (a.perGame.points ?? -Infinity) || a.sourceId.localeCompare(b.sourceId));
  return {
    club: data.club, scope: data.scope, competition: data.competition, basePath: data.basePath, games, players,
    totals, opponentTotals, perGame: perGameStats(totals, games.length), opponentPerGame: perGameStats(opponentTotals, games.length),
    ...analytics, analyticsVersion: ANALYTICS_VERSION,
    wins: games.filter(game => game.result === "W").length, losses: games.filter(game => game.result === "L").length,
  };
}

export type ClubReport = ReturnType<typeof buildClubReport>;
export type ClubPlayer = ClubReport["players"][number];
export type ClubSection = "overview" | "players" | "games" | "shots" | "development" | "rotation";

export function clubSelection(report: ClubReport, params: Record<string, string | string[] | undefined>) {
  const section = reportSection(params["section"]);
  const player = report.players.find(player => player.sourceId === params["player"]) ?? report.players[0]!;
  return { section, player };
}

export function clubHref(section: ClubSection = "overview", player?: string, basePath = "/reports/bima-perkasa") {
  const query = new URLSearchParams({ section });
  if (player) query.set("player", player);
  return `${basePath}?${query.toString()}`;
}

export function formatMinutes(value: number | null) {
  if (value === null) return "—";
  const seconds = Math.round(value * 60);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function difference(a: number | null | undefined, b: number | null | undefined): number | null {
  return a == null || b == null ? null : a - b;
}

export function gameStatChange(report: ClubReport, field: StatField) {
  return difference(report.games[1]!.team.stats[field], report.games[0]!.team.stats[field]);
}
