import { z } from "zod";
import { buildScopedClubReport } from "./club-report";
import { scopedArchivedGameSchema } from "./game-report";

const id = z.string().regex(/^[1-9]\d*$/);
const fixtureSchema = scopedArchivedGameSchema.shape.fixture.extend({ status: z.enum(["scheduled", "live", "complete", "unknown"]) });
export const reportCompetitionSchema = z.object({
  format: z.enum(["statsarena-local-reports/1.0.0", "statsarena-neon-reports/1.0.0"]),
  dataSource: z.enum(["local", "neon"]).default("local"),
  readAt: z.iso.datetime().optional(),
  unavailableGames: z.array(z.object({ gameId: id, reason: z.string() })).default([]), competition: scopedArchivedGameSchema.shape.competition,
  exportedFrom: z.object({ analysisFile: z.string(), generatedAt: z.iso.datetime(), latestAuditFile: z.string(), fixtureDiscoveryComplete: z.boolean() }),
  clubs: z.array(z.object({ sourceId: id, name: z.string().min(1), sourceUrl: z.url(), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) })),
  fixtures: z.array(fixtureSchema), games: z.array(z.object({ portal: scopedArchivedGameSchema, shots: z.unknown(), rotation: z.unknown(), rotationIssues: z.array(z.string()) })),
}).superRefine((data, ctx) => {
  const ids = data.clubs.map(c => c.sourceId);
  if (new Set(ids).size !== ids.length || new Set(data.clubs.map(c => c.slug)).size !== ids.length || new Set(data.fixtures.map(f => f.sourceId)).size !== data.fixtures.length || new Set(data.games.map(g => g.portal.fixture.sourceId)).size !== data.games.length) ctx.addIssue({ code: "custom", message: "Duplicate club, slug, or game identity." });
  const prefix = `/IBL/en/competition/${data.competition.key.split(":")[1]}`;
  for (const club of data.clubs) {
    const url = new URL(club.sourceUrl);
    if (url.origin !== "https://hosted.dcd.shared.geniussports.com" || !url.pathname.startsWith(`${prefix}/team/${club.sourceId}/`)) ctx.addIssue({ code: "custom", message: "Club source scope mismatch." });
  }
  for (const f of data.fixtures) if (!ids.includes(f.homeTeamSourceId) || !ids.includes(f.awayTeamSourceId) || !new URL(f.sourceUrl).pathname.startsWith(`${prefix}/match/${f.sourceId}/`)) ctx.addIssue({ code: "custom", message: "Fixture source scope mismatch." });
  for (const { portal } of data.games) {
    const fixture = data.fixtures.find(f => f.sourceId === portal.fixture.sourceId);
    if (portal.competition.key !== data.competition.key || !fixture || fixture.status !== "complete" || fixture.homeTeamSourceId !== portal.fixture.homeTeamSourceId || fixture.awayTeamSourceId !== portal.fixture.awayTeamSourceId || fixture.homeScore !== portal.fixture.homeScore || fixture.awayScore !== portal.fixture.awayScore) ctx.addIssue({ code: "custom", message: "Game competition or completed fixture mismatch." });
  }
});
export type ReportCompetition = z.infer<typeof reportCompetitionSchema>;
export function buildClubCards(data: ReportCompetition) {
  return data.clubs.map(club => {
    const games = data.games.filter(g => g.portal.teams.some(t => t.sourceId === club.sourceId));
    const fixtures = data.fixtures.filter(f => f.homeTeamSourceId === club.sourceId || f.awayTeamSourceId === club.sourceId);
    const scores = games.map(g => ({ for: g.portal.teams.find(t => t.sourceId === club.sourceId)!.stats.points, against: g.portal.teams.find(t => t.sourceId !== club.sourceId)!.stats.points }));
    return { ...club, href: `/reports/${club.slug}`, games: games.length, knownFixtures: fixtures.length, wins: scores.filter(s => s.for !== null && s.against !== null && s.for > s.against).length, losses: scores.filter(s => s.for !== null && s.against !== null && s.for < s.against).length };
  });
}

export function buildCompetitionClubReport(slug: string, data: ReportCompetition) {
  const club = data.clubs.find(c => c.slug === slug);
  if (!club) return null;
  const games = data.games.filter(g => g.portal.teams.some(t => t.sourceId === club.sourceId));
  const fixtures = data.fixtures.filter(f => f.homeTeamSourceId === club.sourceId || f.awayTeamSourceId === club.sourceId);
  const report = buildScopedClubReport({ club, competition: data.competition, basePath: `/reports/${club.slug}`, scope: { competitionKey: data.competition.key, gameIds: games.map(g => g.portal.fixture.sourceId), label: `${games.length} pertandingan selesai dari ${data.dataSource === "neon" ? "Neon" : "arsip lokal"}` }, games: games.map(g => g.portal) });
  const shotsInput = { competitionKey: data.competition.key, clubSourceId: club.sourceId, charts: games.flatMap(g => {
    const chart = z.object({ shots: z.array(z.object({ teamSourceId: id }).passthrough()) }).passthrough().safeParse(g.shots);
    return chart.success ? [{ ...chart.data, shots: chart.data.shots.filter(s => s.teamSourceId === club.sourceId) }] : [];
  }) };
  const rotationInput = { competitionKey: data.competition.key, clubSourceId: club.sourceId, games: games.map(g => {
    const raw = z.object({ teams: z.array(z.object({ teamSourceId: id, clubLocalTeamKey: z.union([z.literal(1), z.literal(2)]), players: z.array(z.unknown()) })) }).passthrough().safeParse(g.rotation);
    const team = raw.success ? raw.data.teams.find(t => t.teamSourceId === club.sourceId) : null;
    return raw.success && team ? { ...raw.data, ...team } : { gameId: g.portal.fixture.sourceId };
  }) };
  return { club, report, fixtures, shotsInput, rotationInput, exportedFrom: data.exportedFrom, clubs: buildClubCards(data), dataSource: data.dataSource, readAt: data.readAt, unavailableGames: data.unavailableGames };
}
export type CompetitionClubReport = NonNullable<ReturnType<typeof buildCompetitionClubReport>>;
