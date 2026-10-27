import { and, asc, eq, inArray, sql, isNotNull, gte } from "drizzle-orm";
import { z } from "zod";
import type { StatsArenaDatabase } from "@statsarena/db";
import { BASE_STAT_FIELDS, type Stats } from "@statsarena/db/analytics";
import { competitionReference } from "@statsarena/db/source";
import { competitions, competitionTeams, games, gameLiveStats, importRuns, players, playerGameStats, playByPlayEvents, shots, sourceFetches, teams, teamGameStats } from "@statsarena/db/schema";
import { reportCompetitionSchema, buildCompetitionClubReport } from "./competition-report";
import { scopedArchivedGameSchema } from "./game-report";

type Reader = Pick<StatsArenaDatabase, "select">;
type FetchRow = typeof sourceFetches.$inferSelect;
const stats = (row: Stats): Stats => Object.fromEntries(BASE_STAT_FIELDS.map(field => [field, row[field]])) as Stats;
const observedAt = (row: FetchRow) => {
  const time = row.sourceFetchedAt ?? row.fetchedAt;
  if (!time) throw new Error("Waktu sumber tersimpan belum tersedia.");
  return time.toISOString();
};
function gameSourceUrlMatches(value: string, competitionUrl: string, gameId: string) {
  try {
    const url = new URL(value), competition = new URL(competitionUrl);
    return url.origin === competition.origin && !url.username && !url.password && url.pathname.startsWith(`${competition.pathname}/match/${gameId}/`);
  } catch { return false; }
}

const rotationEvidenceSchema = z.object({
  format: z.literal("statsarena-livestats-rotation/1.0.0"), gameSourceId: z.string().regex(/^[1-9]\d*$/),
  homeScore: z.number().int().nonnegative(), awayScore: z.number().int().nonnegative(),
  provenance: z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), fetchedAt: z.iso.datetime(), snapshotPath: z.string() }),
  teams: z.array(z.object({ teamId: z.uuid(), localTeamKey: z.enum(["1", "2"]), players: z.array(z.object({
    playerId: z.uuid(), localPlayerKey: z.string().regex(/^[1-9]\d*$/), name: z.string(), jerseyNumber: z.string(),
    starter: z.boolean().nullable(), plusMinus: z.number().int().nullable(), minutesRaw: z.string().nullable(),
    nameEvidence: z.record(z.string(), z.string().nullable()), core: z.record(z.string(), z.unknown()),
  })).max(20) })).length(2), events: z.array(z.record(z.string(), z.unknown())).min(10).max(5000),
});

function clubSlugs(rows: Array<{ sourceId: string; name: string; sourceUrl: string }>) {
  const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name) || a.sourceId.localeCompare(b.sourceId));
  const used = new Set<string>();
  return sorted.map(row => {
    const base = row.name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `club-${row.sourceId}`;
    const slug = used.has(base) || ["bima-perkasa", "demo-match"].includes(base) ? `${base}-${row.sourceId}` : base;
    used.add(slug);
    return { ...row, slug };
  });
}

function validBoxStats(row: Stats) {
  return BASE_STAT_FIELDS.filter(f => f !== "minutes").every(f => row[f] !== null && Number.isSafeInteger(row[f]) && row[f]! >= 0) &&
    row.points === 2 * row.twoPointsMade! + 3 * row.threePointsMade! + row.freeThrowsMade! &&
    row.fieldGoalsAttempted === row.twoPointAttempts! + row.threePointAttempts! &&
    row.fieldGoalsMade === row.twoPointsMade! + row.threePointsMade! &&
    row.fieldGoalsMade! <= row.fieldGoalsAttempted! && row.freeThrowsMade! <= row.freeThrowAttempts!;
}

/** Only stored domain rows and their exact source FK are read. No source fetch, audit file, or local fallback. */
async function readCatalog(db: Reader, input: string) {
  const ref = competitionReference(input);
  if (ref.namespace !== "IBL") throw new Error("Report kompetisi ini memerlukan namespace IBL.");
  const [competition] = await db.select().from(competitions).where(and(eq(competitions.source, ref.source), eq(competitions.sourceCompetitionId, ref.id))).limit(1);
  if (!competition || competitionReference(competition.sourceUrl).key !== ref.key) throw new Error("Kompetisi report belum tersedia di Neon.");
  const completePlayer = and(...BASE_STAT_FIELDS.filter(f => f !== "minutes").map(f => and(isNotNull(playerGameStats[f]), gte(playerGameStats[f], 0))),
    sql`${playerGameStats.points} = 2 * ${playerGameStats.twoPointsMade} + 3 * ${playerGameStats.threePointsMade} + ${playerGameStats.freeThrowsMade}`,
    sql`${playerGameStats.fieldGoalsAttempted} = ${playerGameStats.twoPointAttempts} + ${playerGameStats.threePointAttempts}`,
    sql`${playerGameStats.fieldGoalsMade} = ${playerGameStats.twoPointsMade} + ${playerGameStats.threePointsMade}`);
  const [clubRows, gameRows, teamRows, boxRows, playerHealth] = await Promise.all([
    db.select({ id: teams.id, sourceId: teams.sourceTeamId, name: teams.name, sourceUrl: competitionTeams.sourceUrl }).from(competitionTeams)
      .innerJoin(teams, eq(teams.id, competitionTeams.teamId)).where(and(eq(competitionTeams.competitionId, competition.id), eq(teams.source, ref.source))),
    db.select().from(games).where(and(eq(games.competitionId, competition.id), eq(games.source, ref.source))).orderBy(asc(games.sourceGameId)),
    db.select({ row: teamGameStats }).from(teamGameStats).innerJoin(games, eq(games.id, teamGameStats.gameId))
      .where(and(eq(games.competitionId, competition.id), eq(games.source, ref.source))),
    db.select({ row: sourceFetches, parserVersion: importRuns.parserVersion }).from(games)
      .innerJoin(sourceFetches, eq(sourceFetches.id, games.lastBoxscoreFetchId)).leftJoin(importRuns, eq(importRuns.id, sourceFetches.importRunId))
      .where(and(eq(games.competitionId, competition.id), eq(games.source, ref.source))),
    db.select({ gameId: playerGameStats.gameId, teamId: playerGameStats.teamId, count: sql<number>`count(*)::int`,
      valid: sql<boolean>`bool_and(${completePlayer})`, points: sql<number>`sum(${playerGameStats.points})::int` }).from(playerGameStats)
      .innerJoin(games, eq(games.id, playerGameStats.gameId)).innerJoin(players, eq(players.id, playerGameStats.playerId))
      .where(and(eq(games.competitionId, competition.id), eq(games.source, ref.source), eq(players.source, ref.source)))
      .groupBy(playerGameStats.gameId, playerGameStats.teamId),
  ]);
  const clubs = clubSlugs(clubRows);
  const byTeam = new Map(clubRows.map(c => [c.id, c]));
  const fixtures = gameRows.flatMap(g => {
    const home = byTeam.get(g.homeTeamId ?? ""), away = byTeam.get(g.awayTeamId ?? "");
    return home && away ? [{ sourceId: g.sourceGameId, sourceUrl: g.sourceUrl, homeTeamSourceId: home.sourceId, awayTeamSourceId: away.sourceId,
      homeTeamName: home.name, awayTeamName: away.name, homeScore: g.homeScore, awayScore: g.awayScore,
      scheduledAtRaw: g.scheduledAtRaw, venue: g.venue, status: g.status }] : [];
  });
  const valid = gameRows.filter(g => {
    const rows = teamRows.filter(t => t.row.gameId === g.id).map(t => t.row);
    const box = boxRows.find(f => f.row.id === g.lastBoxscoreFetchId)?.row;
    return g.status === "complete" && box?.competitionId === competition.id && box.resource === "boxscore" && box.fetchStatus === "succeeded" && box.parseStatus === "parsed" && !!box.sha256 && !!(box.sourceFetchedAt ?? box.fetchedAt) &&
      fixtures.some(f => f.sourceId === g.sourceGameId) && rows.length === 2 && rows.every(r => validBoxStats(r) && playerHealth.some(p => p.gameId === g.id && p.teamId === r.teamId && p.count >= 5 && p.valid && p.points === r.points)) &&
      rows.find(r => r.teamId === g.homeTeamId)?.points === g.homeScore && rows.find(r => r.teamId === g.awayTeamId)?.points === g.awayScore;
  });
  const cards = clubs.map(club => {
    const teamId = clubRows.find(c => c.sourceId === club.sourceId)!.id;
    const included = valid.filter(g => g.homeTeamId === teamId || g.awayTeamId === teamId);
    return { ...club, href: `/reports/${club.slug}`, games: included.length,
      knownFixtures: fixtures.filter(f => f.homeTeamSourceId === club.sourceId || f.awayTeamSourceId === club.sourceId).length,
      wins: included.filter(g => g.homeTeamId === teamId ? g.homeScore! > g.awayScore! : g.awayScore! > g.homeScore!).length,
      losses: included.filter(g => g.homeTeamId === teamId ? g.homeScore! < g.awayScore! : g.awayScore! < g.homeScore!).length };
  });
  const dates = [competition.updatedAt, ...gameRows.map(g => g.updatedAt), ...boxRows.map(f => f.row.sourceFetchedAt ?? f.row.fetchedAt ?? f.row.requestedAt)];
  return { competition: { key: ref.key, name: competition.name, sourceUrl: competition.sourceUrl }, competitionId: competition.id,
    clubs, fixtures, cards, sourceUpdatedAt: new Date(Math.max(...dates.map(d => d.getTime()))).toISOString(),
    valid, gameRows, teamRows, boxRows, byTeam };
}

export async function getNeonReportCatalog(db: StatsArenaDatabase, input: string) {
  return db.transaction(async tx => {
    const data = await readCatalog(tx, input);
    return { competition: data.competition, clubs: data.clubs, cards: data.cards, fixtures: data.fixtures,
      games: data.valid.map(g => ({ gameId: g.sourceGameId, homeTeamSourceId: data.byTeam.get(g.homeTeamId!)!.sourceId, awayTeamSourceId: data.byTeam.get(g.awayTeamId!)!.sourceId })),
      sourceUpdatedAt: data.sourceUpdatedAt };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

/** Read one authorized club in a coherent database snapshot; detailed rows for other clubs are never selected. */
export async function getNeonClubReport(db: StatsArenaDatabase, input: string, clubSourceId: string) {
  if (!/^[1-9]\d*$/.test(clubSourceId)) throw new Error("Identitas klub tidak valid.");
  return db.transaction(async tx => {
    const catalog = await readCatalog(tx, input);
    const club = catalog.clubs.find(c => c.sourceId === clubSourceId);
    if (!club) return null;
    const teamId = [...catalog.byTeam].find(([, c]) => c.sourceId === clubSourceId)![0];
    const selected = catalog.valid.filter(g => g.homeTeamId === teamId || g.awayTeamId === teamId);
    const ids = selected.map(g => g.id);
    const [playerRows, pbpRows, shotRows, liveRows] = ids.length ? await Promise.all([
      tx.select({ row: playerGameStats, player: players }).from(playerGameStats).innerJoin(players, eq(players.id, playerGameStats.playerId))
        .innerJoin(games, eq(games.id, playerGameStats.gameId)).where(and(eq(games.competitionId, catalog.competitionId), inArray(games.id, ids), eq(players.source, competitionReference(input).source))),
      tx.select().from(playByPlayEvents).innerJoin(games, eq(games.id, playByPlayEvents.gameId))
        .where(and(eq(games.competitionId, catalog.competitionId), inArray(games.id, ids))).orderBy(asc(playByPlayEvents.sourceSequence)),
      tx.select({ row: shots, teamSourceId: teams.sourceTeamId, playerSourceId: players.sourcePlayerId }).from(shots)
        .innerJoin(games, eq(games.id, shots.gameId)).innerJoin(teams, eq(teams.id, shots.teamId)).innerJoin(players, eq(players.id, shots.playerId))
        .where(and(eq(games.competitionId, catalog.competitionId), inArray(games.id, ids), eq(shots.teamId, teamId), eq(teams.source, competitionReference(input).source), eq(players.source, competitionReference(input).source))).orderBy(asc(shots.sourceSequence)),
      tx.select().from(gameLiveStats).innerJoin(games, eq(games.id, gameLiveStats.gameId)).where(and(eq(games.competitionId, catalog.competitionId), inArray(games.id, ids))),
    ]) : [[], [], [], []];
    const fetchIds = [...new Set([...pbpRows.map(r => r.play_by_play_events.sourceFetchId), ...shotRows.map(r => r.row.sourceFetchId)].filter((v): v is string => !!v))];
    const fetchRows = fetchIds.length ? await tx.select().from(sourceFetches).where(and(eq(sourceFetches.competitionId, catalog.competitionId), inArray(sourceFetches.id, fetchIds))) : [];
    const source = (row: FetchRow, parserVersion: string) => ({ resource: row.resource, sourceUrl: row.requestUrl, fetchedAt: observedAt(row), sha256: row.sha256, parseStatus: row.parseStatus, parserVersion });
    const unavailableGames: Array<{ gameId: string; reason: string }> = catalog.gameRows.filter(g => g.status === "complete" && (g.homeTeamId === teamId || g.awayTeamId === teamId) && !ids.includes(g.id))
      .map(g => ({ gameId: g.sourceGameId, reason: "Box score selesai beserta sumber yang cocok belum tersedia di Neon." }));
    const packed = selected.flatMap(g => {
      const fixture = catalog.fixtures.find(f => f.sourceId === g.sourceGameId)!;
      const box = catalog.boxRows.find(f => f.row.id === g.lastBoxscoreFetchId)!;
      const parserVersion = box.parserVersion ?? g.detailParserVersion;
      if (!parserVersion) { unavailableGames.push({ gameId: g.sourceGameId, reason: "Versi parser sumber box score belum tersedia." }); return []; }
      const gamePlayers = playerRows.filter(r => r.row.gameId === g.id);
      const events = pbpRows.filter(r => r.play_by_play_events.gameId === g.id).map(r => r.play_by_play_events);
      const gameShots = shotRows.filter(r => r.row.gameId === g.id);
      const resources = [source(box.row, parserVersion)];
      for (const [records, kind] of [[events, "playbyplay"], [gameShots.map(r => r.row), "shotchart"]] as const) {
        for (const id of new Set(records.map(r => r.sourceFetchId))) {
          const ref = fetchRows.find(f => f.id === id && f.resource === kind && f.fetchStatus === "succeeded" && f.parseStatus === "parsed" && !!f.sha256 && !!(f.sourceFetchedAt ?? f.fetchedAt) && gameSourceUrlMatches(f.requestUrl, catalog.competition.sourceUrl, g.sourceGameId));
          const version = records.find(r => r.sourceFetchId === id)?.parserVersion;
          if (ref && version) resources.push(source(ref, version));
        }
      }
      const portal = scopedArchivedGameSchema.safeParse({ competition: catalog.competition, fixture,
        teams: catalog.teamRows.filter(t => t.row.gameId === g.id).map(t => ({ sourceId: catalog.byTeam.get(t.row.teamId)?.sourceId, name: catalog.byTeam.get(t.row.teamId)?.name, stats: stats(t.row) })),
        players: gamePlayers.map(p => ({ sourceId: p.player.sourcePlayerId, name: p.player.name, teamSourceId: catalog.byTeam.get(p.row.teamId)?.sourceId, jerseyNumber: p.row.jerseyNumber, minutesRaw: p.row.minutesRaw, stats: stats(p.row) })),
        periodEnds: events.filter(e => e.actionType === "period" && e.actionText === "Period end" && e.periodNumber !== null && fetchRows.some(f => f.id === e.sourceFetchId && f.resource === "playbyplay" && f.parseStatus === "parsed" && !!f.sha256) && resources.some(r => r.resource === "playbyplay" && r.sourceUrl === e.sourceUrl && r.parserVersion === e.parserVersion))
          .map(e => ({ period: e.periodNumber, sourceSequence: e.sourceSequence, homeScore: e.team1Score, awayScore: e.team2Score })),
        provenance: { auditFile: `Neon source_fetches/${box.row.id}`, auditCreatedAt: box.row.requestedAt.toISOString(), parserVersion, resources },
      });
      if (!portal.success || !gamePlayers.some(p => p.row.teamId === g.homeTeamId) || !gamePlayers.some(p => p.row.teamId === g.awayTeamId) || gamePlayers.some(p => !validBoxStats(p.row))) {
        unavailableGames.push({ gameId: g.sourceGameId, reason: "Identitas, statistik pemain, atau provenance box score belum konsisten." }); return [];
      }
      const shotReference = resources.filter(r => r.resource === "shotchart");
      const chart = shotReference.length === 1 && gameShots.every(s => s.row.sourceFetchId === fetchRows.find(f => f.sha256 === shotReference[0]!.sha256 && f.requestUrl === shotReference[0]!.sourceUrl)?.id && s.row.parserVersion === shotReference[0]!.parserVersion) ? {
        gameSourceId: g.sourceGameId, ...shotReference[0], status: "parsed", shots: gameShots.map(({ row, teamSourceId, playerSourceId }) => ({ ...row, gameSourceId: g.sourceGameId, teamSourceId, playerSourceId })),
      } : null;
      const live = liveRows.find(r => r.game_livestats.gameId === g.id)?.game_livestats;
      const parsedEvidence = rotationEvidenceSchema.safeParse(live?.payload?.rotation);
      const evidence = parsedEvidence.success ? parsedEvidence.data : null;
      const provenance = evidence?.provenance;
      const rotation = live && evidence && provenance && evidence.gameSourceId === g.sourceGameId ? {
        gameId: evidence.gameSourceId, periodCount: 4, periodSeconds: 600, homeScore: evidence.homeScore, awayScore: evidence.awayScore,
        events: evidence.events,
        teams: evidence.teams.map(t => ({ teamSourceId: catalog.byTeam.get(t.teamId)?.sourceId, clubLocalTeamKey: Number(t.localTeamKey), players: t.players.map(p => ({
          sourceId: gamePlayers.find(row => row.player.id === p.playerId && row.row.teamId === t.teamId)?.player.sourcePlayerId,
          localKey: Number(p.localPlayerKey), name: p.name, nameEvidence: p.nameEvidence, jerseyNumber: p.jerseyNumber, starter: p.starter,
          minutesRaw: p.minutesRaw, plusMinus: p.plusMinus, mappingMethod: "team_jersey_name_core_stats_v1", core: p.core,
        })) })),
        source: { jsonUrl: live.sourceUrl, pageUrl: live.pageUrl, sha256: provenance.sha256, fetchedAt: provenance.fetchedAt,
          adapterVersion: "statsarena-livestats/1.1.0", portalAuditFile: `Neon source_fetches/${box.row.id}`, boxscoreSha256: box.row.sha256 },
      } : null;
      return [{ portal: portal.data, shots: chart, rotation, rotationIssues: rotation ? [] : ["Data pergantian rinci belum tersimpan di Neon."] }];
    });
    const data = reportCompetitionSchema.parse({ format: "statsarena-neon-reports/1.0.0", dataSource: "neon", readAt: new Date().toISOString(), unavailableGames,
      competition: catalog.competition, clubs: catalog.clubs, fixtures: catalog.fixtures, games: packed,
      exportedFrom: { analysisFile: "Neon", latestAuditFile: "Neon source_fetches", generatedAt: catalog.sourceUpdatedAt, fixtureDiscoveryComplete: false } });
    const bundle = buildCompetitionClubReport(club.slug, data)!;
    bundle.clubs = catalog.cards;
    return bundle;
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
