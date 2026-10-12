import { and, eq, sql } from "drizzle-orm";
import type { StatsArenaDatabase } from "@statsarena/db";
import {
  competitionGroups,
  competitionPlayers,
  competitionTeams,
  competitions,
  games,
  groupStandings,
  importRuns,
  playerGameStats,
  officialTeamMetrics,
  playByPlayEvents,
  players,
  shots,
  sourceFetches,
  teamGameStats,
  teamRosters,
  teams,
  validationIssues
} from "@statsarena/db/schema";
import type { FetchMetadata } from "../fetch/fetcher.js";
import type {
  BoxScoreStats,
  CompetitionRecord,
  GroupRecord,
  OfficialTeamMetricRecord,
  ParsedCompetitionData,
  PlayByPlayEventRecord,
  PlayerRecord,
  ShotRecord,
  TeamRecord,
  ValidationIssue
} from "../domain/types.js";
import { PARSER_VERSION, SOURCE_NAME } from "../domain/types.js";
import { matchDataStatus } from "../domain/match-status.js";
import { boxScoreCompletenessIssues } from "../domain/validation.js";
import { validateShotsAgainstBoxScore } from "../domain/shot-validation.js";
import { issue } from "../parsers/common.js";
import { fixtureHash } from "../domain/incremental.js";

export interface ImportSummary {
  importRunId: string;
  competitionId: string;
  counts: Record<string, number>;
  failedGames: string[];
  issues: ValidationIssue[];
  status: "succeeded" | "partial";
  matchStatuses: Record<string, number>;
  durationMs: number;
}

export type ImportTransaction = Parameters<Parameters<StatsArenaDatabase["transaction"]>[0]>[0];
export type ImportWriteGuard = (transaction?: ImportTransaction) => Promise<void>;

function statsValues(stats: BoxScoreStats): {
  minutes: number | null;
  fieldGoalsMade: number | null;
  fieldGoalsAttempted: number | null;
  twoPointsMade: number | null;
  twoPointAttempts: number | null;
  threePointsMade: number | null;
  threePointAttempts: number | null;
  freeThrowsMade: number | null;
  freeThrowAttempts: number | null;
  offensiveRebounds: number | null;
  defensiveRebounds: number | null;
  rebounds: number | null;
  assists: number | null;
  steals: number | null;
  blocks: number | null;
  turnovers: number | null;
  personalFouls: number | null;
  points: number | null;
  fieldGoalPct: string | null;
  twoPointPct: string | null;
  threePointPct: string | null;
  freeThrowPct: string | null;
} {
  return {
    minutes: stats.minutes,
    fieldGoalsMade: stats.fieldGoalsMade,
    fieldGoalsAttempted: stats.fieldGoalsAttempted,
    twoPointsMade: stats.twoPointsMade,
    twoPointAttempts: stats.twoPointAttempts,
    threePointsMade: stats.threePointsMade,
    threePointAttempts: stats.threePointAttempts,
    freeThrowsMade: stats.freeThrowsMade,
    freeThrowAttempts: stats.freeThrowAttempts,
    offensiveRebounds: stats.offensiveRebounds,
    defensiveRebounds: stats.defensiveRebounds,
    rebounds: stats.rebounds,
    assists: stats.assists,
    steals: stats.steals,
    blocks: stats.blocks,
    turnovers: stats.turnovers,
    personalFouls: stats.personalFouls,
    points: stats.points,
    fieldGoalPct: stats.fieldGoalPct,
    twoPointPct: stats.twoPointPct,
    threePointPct: stats.threePointPct,
    freeThrowPct: stats.freeThrowPct
  };
}

export async function importCompetition(
  db: StatsArenaDatabase,
  data: ParsedCompetitionData,
  fetches: FetchMetadata[],
  mode: "discover" | "sync" | "snapshot" = "sync",
  writeGuard?: ImportWriteGuard
): Promise<ImportSummary> {
  const startedAt = Date.now();
  const [run] = await db.transaction(async (tx) => {
    await writeGuard?.(tx);
    return tx.insert(importRuns).values({ mode, parserVersion: PARSER_VERSION, status: "running" }).returning();
  });
  if (!run) throw new Error("Gagal membuat import run.");
  const runIssues: ValidationIssue[] = [...data.issues];
  const issues: ValidationIssue[] = [...data.issues, ...data.matches.flatMap((match) => match.issues)];
  const failedGames: string[] = [];
  let competitionId = "";
  let writtenPlayerStats = 0;
  let writtenTeamStats = 0;
  let newGames = 0;
  let updatedGames = 0;
  let unchangedGames = 0;
  let unchangedBoxScores = 0;
  let preservedBoxScores = 0;
  let writtenPlayByPlayEvents = 0;
  let writtenShots = 0;
  let writtenGameOfficialMetrics = 0;
  let writtenCompetitionOfficialMetrics = 0;
  let unchangedPlayByPlayGames = 0;
  let unchangedShotCharts = 0;
  let preservedDetailDatasets = 0;
  const matchStatuses: Record<string, number> = {};

  try {
    const core = await db.transaction(async (tx) => {
      await writeGuard?.(tx);
      const comp = await upsertCompetition(tx, data.competition);
      await tx.update(importRuns).set({ competitionId: comp.id }).where(eq(importRuns.id, run.id));
      const teamIdBySource = new Map<string, string>();
      const playerIdBySource = new Map<string, string>();

      const identities = collectIdentities(data);
      for (const batch of chunks(identities.teams)) {
        const saved = await tx.insert(teams).values(batch.map((team) => ({
          source: SOURCE_NAME, sourceTeamId: team.sourceId, sourceUrl: team.sourceUrl,
          name: team.name, logoUrl: team.logoUrl
        }))).onConflictDoUpdate({
          target: [teams.source, teams.sourceTeamId],
          set: { sourceUrl: sql`excluded.source_url`, name: sql`excluded.name`,
            logoUrl: sql`coalesce(excluded.logo_url, ${teams.logoUrl})`, updatedAt: new Date() }
        }).returning({ id: teams.id, sourceId: teams.sourceTeamId });
        for (const team of saved) teamIdBySource.set(team.sourceId, team.id);
      }
      for (const batch of chunks(identities.players)) {
        const saved = await tx.insert(players).values(batch.map((player) => ({
          source: SOURCE_NAME, sourcePlayerId: player.sourceId, sourceUrl: player.sourceUrl, name: player.name
        }))).onConflictDoUpdate({
          target: [players.source, players.sourcePlayerId],
          set: { sourceUrl: sql`excluded.source_url`, name: sql`excluded.name`, updatedAt: new Date() }
        }).returning({ id: players.id, sourceId: players.sourcePlayerId });
        for (const player of saved) playerIdBySource.set(player.sourceId, player.id);
      }
      for (const batch of chunks(identities.teams)) {
        await tx.insert(competitionTeams).values(batch.map((team) => ({
          competitionId: comp.id, teamId: requiredId(teamIdBySource, team.sourceId),
          sourceUrl: team.sourceUrl, lastSeenAt: new Date()
        }))).onConflictDoUpdate({
          target: [competitionTeams.competitionId, competitionTeams.teamId],
          set: { sourceUrl: sql`excluded.source_url`, lastSeenAt: new Date() }
        });
      }
      for (const batch of chunks(identities.players)) {
        await tx.insert(competitionPlayers).values(batch.map((player) => ({
          competitionId: comp.id, playerId: requiredId(playerIdBySource, player.sourceId),
          sourceUrl: player.sourceUrl, lastSeenAt: new Date()
        }))).onConflictDoUpdate({
          target: [competitionPlayers.competitionId, competitionPlayers.playerId],
          set: { sourceUrl: sql`excluded.source_url`, lastSeenAt: new Date() }
        });
      }
      const groupIdBySource = new Map<string, string>();
      for (const batch of chunks(dedupeGroups(data.groups.map((entry) => entry.group)))) {
        const saved = await tx.insert(competitionGroups).values(batch.map((group) => ({
          competitionId: comp.id, sourceGroupId: group.sourceId, sourceUrl: group.sourceUrl,
          label: group.label, poolNumber: group.poolNumber
        }))).onConflictDoUpdate({
          target: [competitionGroups.competitionId, competitionGroups.sourceGroupId],
          set: { sourceUrl: sql`excluded.source_url`, label: sql`excluded.label`,
            poolNumber: sql`coalesce(excluded.pool_number, ${competitionGroups.poolNumber})`, updatedAt: new Date() }
        }).returning({ id: competitionGroups.id, sourceId: competitionGroups.sourceGroupId });
        for (const group of saved) groupIdBySource.set(group.sourceId, group.id);
      }
      return { competitionId: comp.id, teamIdBySource, playerIdBySource, groupIdBySource };
    });
    competitionId = core.competitionId;
    const teamSourceIdById = new Map([...core.teamIdBySource].map(([sourceId, id]) => [id, sourceId]));

    const fetchIdByUrl = new Map<string, string>();
    for (const batch of chunks(fetches)) {
      await writeGuard?.();
      const saved = await db.insert(sourceFetches).values(batch.map((metadata) => ({
        importRunId: run.id,
        competitionId,
        resource: metadata.resource,
        requestUrl: metadata.requestUrl,
        finalUrl: metadata.finalUrl,
        fetchStatus: metadata.fetchStatus,
        parseStatus: metadata.parseStatus,
        httpStatus: metadata.httpStatus,
        requestedAt: new Date(metadata.requestedAt),
        fetchedAt: new Date(metadata.fetchedAt),
        sourceFetchedAt: metadata.sourceFetchedAt ? new Date(metadata.sourceFetchedAt) : null,
        durationMs: metadata.durationMs,
        responseBytes: metadata.responseBytes,
        sha256: metadata.sha256,
        snapshotPath: metadata.snapshotPath,
        attempts: metadata.attempts.filter((attempt) => attempt.attempt > 0).length,
        attemptLog: [
          { kind: "retrieval", mode: metadata.retrievalMode ?? (metadata.fromSnapshot ? "snapshot" : "network"),
            sourceFetchedAt: metadata.sourceFetchedAt ?? metadata.fetchedAt,
            cacheAgeMs: metadata.cacheAgeMs ?? null, cacheReason: metadata.cacheReason ?? null },
          ...metadata.attempts.map((attempt) => ({ ...attempt }))
        ],
        errorText: metadata.error
      }))).returning({ id: sourceFetches.id, requestUrl: sourceFetches.requestUrl });
      for (const entry of saved) fetchIdByUrl.set(entry.requestUrl, entry.id);
    }

    for (const groupData of data.groups) {
      const groupId = core.groupIdBySource.get(groupData.group.sourceId);
      if (!groupId) throw new Error(`Grup ${groupData.group.sourceId} belum disimpan.`);
      await db.transaction(async (tx) => {
        await writeGuard?.(tx);
        await tx.delete(groupStandings).where(eq(groupStandings.groupId, groupId));
        for (const batch of chunks(groupData.rows)) {
          await tx.insert(groupStandings).values(batch.map((standing) => ({
            groupId,
            teamId: requiredId(core.teamIdBySource, standing.teamSourceId),
            position: standing.position,
            gamesPlayed: standing.gamesPlayed,
            wins: standing.wins,
            losses: standing.losses,
            draws: standing.draws,
            pointsFor: standing.pointsFor,
            pointsAgainst: standing.pointsAgainst,
            pointDifference: standing.pointDifference,
            standingPoints: standing.standingPoints,
            sourceFetchId: fetchIdByUrl.get(groupData.group.sourceUrl) ?? null
          })));
        }
      });
    }

    if (data.teamOfficialMetrics?.status === "parsed" && data.teamOfficialMetrics.records.length > 0) {
      const metricReport = data.teamOfficialMetrics;
      try {
        const saved = await db.transaction(async (tx) => {
          await writeGuard?.(tx);
          const incoming = data.teamOfficialMetrics?.records ?? [];
          if (incoming.some((metric) => metric.scope !== "competition")) {
            throw new Error("Dataset Team Statistics memuat metric di luar scope kompetisi.");
          }
          const rows = incoming.map((metric) => ({
            competitionId,
            scopeType: "competition" as const,
            gameId: null,
            teamId: requiredId(core.teamIdBySource, metric.teamSourceId),
            metricCode: metric.metricCode,
            value: metric.value,
            availability: metric.availability,
            unit: metric.unit,
            scopeLabel: metric.scopeLabel,
            sampleGamesPlayed: metric.sampleGamesPlayed,
            rawValue: metric.rawValue,
            sourceUrl: metric.sourceUrl,
            sourceFetchId: fetchIdByUrl.get(metric.sourceUrl) ?? null,
            parserVersion: PARSER_VERSION
          }));
          const existing = await tx.select().from(officialTeamMetrics).where(and(
            eq(officialTeamMetrics.competitionId, competitionId),
            eq(officialTeamMetrics.scopeType, "competition")
          ));
          const completenessIssues = metricDatasetIssues(rows, existing, metricReport.sourceUrl);
          if (completenessIssues.length) {
            const fetchId = fetchIdByUrl.get(metricReport.sourceUrl);
            if (fetchId) await tx.update(sourceFetches).set({ parseStatus: "partial" }).where(eq(sourceFetches.id, fetchId));
            return { count: 0, issues: completenessIssues };
          }
          if (sameRowsByKeys(rows, existing, ["teamId", "metricCode"], ["id", "createdAt", "updatedAt"])) return { count: 0, issues: [] };
          await tx.delete(officialTeamMetrics).where(and(
            eq(officialTeamMetrics.competitionId, competitionId),
            eq(officialTeamMetrics.scopeType, "competition")
          ));
          for (const batch of chunks(rows)) await tx.insert(officialTeamMetrics).values(batch);
          return { count: rows.length, issues: [] };
        });
        writtenCompetitionOfficialMetrics += saved.count;
        if (saved.issues.length) {
          issues.push(...saved.issues);
          runIssues.push(...saved.issues);
          preservedDetailDatasets += 1;
        }
      } catch (error) {
        const entry = issue("error", "IMPORT_COMPETITION_METRICS_FAILED", error instanceof Error ? error.message : String(error), data.teamOfficialMetrics.sourceUrl, "teamOfficialMetrics");
        issues.push(entry);
        runIssues.push(entry);
      }
    } else if (data.teamOfficialMetrics) {
      preservedDetailDatasets += 1;
    }

    for (const match of data.matches) {
      try {
        const written = await db.transaction(async (tx) => {
          await writeGuard?.(tx);
          const integrityIssues = match.boxScore ? boxScoreCompletenessIssues(match.boxScore) : [];
          const detailIssues: ValidationIssue[] = [];
          let playByPlayUnchanged = 0;
          let shotsUnchanged = 0;
          let preservedDetails = 0;
          // An advisory lock also covers games that have not been inserted yet.
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${SOURCE_NAME}:${match.fixture.sourceId}`}, 0))`);
          const [existingGame] = await tx.select().from(games)
            .where(and(eq(games.source, SOURCE_NAME), eq(games.sourceGameId, match.fixture.sourceId), eq(games.competitionId, competitionId)))
            .for("update");
          const existingPlayers = match.boxScore && existingGame
            ? await tx.select().from(playerGameStats).where(eq(playerGameStats.gameId, existingGame.id)) : [];
          const existingTeamStats = (match.boxScore || match.shotChart) && existingGame
            ? await tx.select().from(teamGameStats).where(eq(teamGameStats.gameId, existingGame.id)) : [];
          if (match.boxScore) {
            const incomingPlayers = new Set(match.boxScore.players.map((player) => requiredId(core.playerIdBySource, player.playerSourceId)));
            if (existingPlayers.some((player) => !incomingPlayers.has(player.playerId))) {
              integrityIssues.push(issue("error", "BOXSCORE_PLAYER_SET_INCOMPLETE", "Pemain yang pernah tersimpan hilang dari box score baru; statistik lama dipertahankan.", match.boxScore.sourceUrl, "players"));
            }
          }
          const boxScore = integrityIssues.length === 0 && !match.issues.some((entry) => entry.severity === "error" && entry.code.startsWith("BOXSCORE_"))
            ? match.boxScore : null;
          const homeSourceId = match.summary?.homeTeamSourceId ?? match.fixture.homeTeamSourceId;
          const awaySourceId = match.summary?.awayTeamSourceId ?? match.fixture.awayTeamSourceId;
          const homeName = match.summary?.homeTeamName ?? match.fixture.homeTeamName;
          const awayName = match.summary?.awayTeamName ?? match.fixture.awayTeamName;
          const homeTeamId = homeSourceId && homeName ? requiredId(core.teamIdBySource, homeSourceId) : null;
          const awayTeamId = awaySourceId && awayName ? requiredId(core.teamIdBySource, awaySourceId) : null;

          const incomingStatus = match.summary?.status && match.summary.status !== "unknown"
            ? match.summary.status
            : match.fixture.status;
          const statusRank = { unknown: 0, scheduled: 1, live: 2, complete: 3 } as const;
          const nextStatus = existingGame && statusRank[incomingStatus] < statusRank[existingGame.status]
            ? existingGame.status
            : incomingStatus === "unknown" && existingGame ? existingGame.status : incomingStatus;
          const homeScore = match.summary?.homeScore ?? match.fixture.homeScore;
          const awayScore = match.summary?.awayScore ?? match.fixture.awayScore;
          const scheduledAtRaw = match.summary?.scheduledAtRaw ?? match.fixture.scheduledAtRaw;
          const venue = match.summary?.venue ?? match.fixture.venue;
          const coreGameChanged = !existingGame ||
            (homeTeamId !== null && homeTeamId !== existingGame.homeTeamId) ||
            (awayTeamId !== null && awayTeamId !== existingGame.awayTeamId) ||
            (homeScore !== null && homeScore !== existingGame.homeScore) ||
            (awayScore !== null && awayScore !== existingGame.awayScore) ||
            (nextStatus !== existingGame.status) ||
            (scheduledAtRaw !== null && scheduledAtRaw !== existingGame.scheduledAtRaw) ||
            (venue !== null && venue !== existingGame.venue) ||
            match.fixture.sourceUrl !== existingGame.sourceUrl;
          const summaryFetchId = fetchIdByUrl.get(match.summary?.sourceUrl ?? "") ?? null;
          const boxscoreFetchId = fetchIdByUrl.get(boxScore?.sourceUrl ?? "") ?? null;
          const [savedGame] = await tx.insert(games).values({
            competitionId,
            source: SOURCE_NAME,
            sourceGameId: match.fixture.sourceId,
            sourceUrl: match.fixture.sourceUrl,
            homeTeamId,
            awayTeamId,
            homeScore,
            awayScore,
            status: nextStatus,
            scheduledAtRaw,
            venue,
            lastSummaryFetchId: summaryFetchId,
            lastBoxscoreFetchId: boxscoreFetchId
          }).onConflictDoUpdate({
            target: [games.source, games.sourceGameId],
            set: {
              competitionId,
              sourceUrl: match.fixture.sourceUrl,
              homeTeamId: homeTeamId ?? sql`${games.homeTeamId}`,
              awayTeamId: awayTeamId ?? sql`${games.awayTeamId}`,
              homeScore: homeScore ?? sql`${games.homeScore}`,
              awayScore: awayScore ?? sql`${games.awayScore}`,
              status: nextStatus,
              scheduledAtRaw: scheduledAtRaw ?? sql`${games.scheduledAtRaw}`,
              venue: venue ?? sql`${games.venue}`,
              lastSummaryFetchId: summaryFetchId ?? sql`${games.lastSummaryFetchId}`,
              lastBoxscoreFetchId: boxscoreFetchId ?? sql`${games.lastBoxscoreFetchId}`,
              updatedAt: new Date()
            }
          }).returning();
          if (!savedGame) throw new Error(`Gagal menyimpan pertandingan ${match.fixture.sourceId}.`);

          let unchanged = false;
          if (boxScore) {
            const teamRows = boxScore.teams.map((teamStat) => ({
              gameId: savedGame.id, teamId: requiredId(core.teamIdBySource, teamStat.teamSourceId), ...statsValues(teamStat)
            }));
            const playerRows = boxScore.players.map((playerStat) => ({
              gameId: savedGame.id,
              playerId: requiredId(core.playerIdBySource, playerStat.playerSourceId),
              teamId: requiredId(core.teamIdBySource, playerStat.teamSourceId),
              jerseyNumber: playerStat.jerseyNumber, minutesRaw: playerStat.minutesRaw,
              sourceUrl: playerStat.sourceUrl, ...statsValues(playerStat)
            }));
            // Compare persisted values, not HTML hashes: navigation/whitespace changes must not rewrite stats.
            unchanged = sameRows(playerRows, existingPlayers, "playerId") && sameRows(teamRows, existingTeamStats, "teamId");
            if (!unchanged) {
              await tx.delete(playerGameStats).where(eq(playerGameStats.gameId, savedGame.id));
              await tx.delete(teamGameStats).where(eq(teamGameStats.gameId, savedGame.id));
              const rosters = [...new Map(playerRows.map((row) => [`${row.teamId}:${row.playerId}`, {
                competitionId, teamId: row.teamId, playerId: row.playerId,
                sourceUrl: row.sourceUrl, observedAt: new Date()
              }])).values()];
              for (const batch of chunks(rosters)) {
                await tx.insert(teamRosters).values(batch).onConflictDoUpdate({
                  target: [teamRosters.competitionId, teamRosters.teamId, teamRosters.playerId],
                  set: { sourceUrl: sql`excluded.source_url`, observedAt: new Date() }
                });
              }
              for (const batch of chunks(teamRows)) await tx.insert(teamGameStats).values(batch);
              for (const batch of chunks(playerRows)) await tx.insert(playerGameStats).values(batch);
            }
          }

          let playByPlayRowsWritten = 0;
          let shotRowsWritten = 0;
          let gameMetricRowsWritten = 0;
          if (match.playByPlay) {
            const events = match.playByPlay.records.map((event) => playByPlayRow(
              event, savedGame.id, core.teamIdBySource, core.playerIdBySource, fetchIdByUrl.get(event.sourceUrl) ?? null
            ));
            const existingEvents = await tx.select().from(playByPlayEvents).where(eq(playByPlayEvents.gameId, savedGame.id));
            // DOM positions are not stable event IDs; fewer events cannot prove an official deletion.
            if (events.length < existingEvents.length) {
              detailIssues.push(issue("error", "PBP_EVENTS_SHRANK", "Jumlah event PBP berkurang tanpa bukti koreksi penghapusan; dataset lama dipertahankan untuk review.", match.playByPlay.sourceUrl, "events", existingEvents.length, events.length));
              preservedDetails += 1;
            } else if (match.playByPlay.status === "parsed" && events.length > 0 && sameRowsByKeys(events, existingEvents, ["sourceSequence"], ["id", "createdAt", "updatedAt"])) {
              playByPlayUnchanged = 1;
            } else if (match.playByPlay.status === "parsed" && events.length > 0) {
              await tx.delete(playByPlayEvents).where(eq(playByPlayEvents.gameId, savedGame.id));
              for (const batch of chunks(events)) await tx.insert(playByPlayEvents).values(batch);
              playByPlayRowsWritten = events.length;
            } else {
              preservedDetails += 1;
            }
          }

          if (match.shotChart?.status === "parsed" && match.shotChart.records.length > 0) {
            const shotRows = match.shotChart.records.map((shot) => shotRow(
              shot, savedGame.id, core.teamIdBySource, core.playerIdBySource, fetchIdByUrl.get(shot.sourceUrl) ?? null
            ));
            const existingShots = await tx.select().from(shots).where(eq(shots.gameId, savedGame.id));
            // Use the current complete box score, or the saved totals when the latest page failed.
            const scoringTeams = boxScore?.teams ?? existingTeamStats.map((team) => ({
              teamSourceId: requiredId(teamSourceIdById, team.teamId),
              teamName: requiredId(teamSourceIdById, team.teamId),
              fieldGoalsAttempted: team.fieldGoalsAttempted, fieldGoalsMade: team.fieldGoalsMade
            }));
            const shotIssues = scoringTeams.length ? validateShotsAgainstBoxScore(match.shotChart, { teams: scoringTeams }) : [];
            const completeTotals = scoringTeams.length === 2 && scoringTeams.every((team) => team.fieldGoalsAttempted !== null && team.fieldGoalsMade !== null);
            if (shotRows.length < existingShots.length && !completeTotals) {
              shotIssues.push(issue("error", "SHOT_DATASET_SHRANK", "Jumlah tembakan berkurang tanpa total resmi lengkap untuk memverifikasi koreksi; chart lama dipertahankan.", match.shotChart.sourceUrl, "shots", existingShots.length, shotRows.length));
            }
            if (shotIssues.length) {
              detailIssues.push(...shotIssues);
              preservedDetails += 1;
            } else if (sameRowsByKeys(shotRows, existingShots, ["sourceSequence"], ["id", "createdAt", "updatedAt"])) {
              shotsUnchanged = 1;
            } else {
              await tx.delete(shots).where(eq(shots.gameId, savedGame.id));
              for (const batch of chunks(shotRows)) await tx.insert(shots).values(batch);
              shotRowsWritten = shotRows.length;
            }
          } else if (match.shotChart) {
            preservedDetails += 1;
          }

          if (match.officialMetrics?.status === "parsed" && match.officialMetrics.records.length > 0) {
            const metrics = match.officialMetrics.records.map((metric) => {
              if (metric.scope !== "game" || metric.gameSourceId !== match.fixture.sourceId) {
                throw new Error(`Official metric tidak sesuai scope atau ID pertandingan ${match.fixture.sourceId}.`);
              }
              return officialMetricRow(metric, competitionId, savedGame.id, core.teamIdBySource, fetchIdByUrl.get(metric.sourceUrl) ?? null);
            });
            const existingMetrics = await tx.select().from(officialTeamMetrics).where(and(
              eq(officialTeamMetrics.competitionId, competitionId),
              eq(officialTeamMetrics.scopeType, "game"),
              eq(officialTeamMetrics.gameId, savedGame.id)
            ));
            const metricIssues = metricDatasetIssues(metrics, existingMetrics, match.officialMetrics.sourceUrl);
            if (metricIssues.length) {
              detailIssues.push(...metricIssues);
              preservedDetails += 1;
            } else if (!sameRowsByKeys(metrics, existingMetrics, ["teamId", "metricCode"], ["id", "createdAt", "updatedAt"])) {
              await tx.delete(officialTeamMetrics).where(and(
                eq(officialTeamMetrics.competitionId, competitionId),
                eq(officialTeamMetrics.scopeType, "game"),
                eq(officialTeamMetrics.gameId, savedGame.id)
              ));
              for (const batch of chunks(metrics)) await tx.insert(officialTeamMetrics).values(batch);
              gameMetricRowsWritten = metrics.length;
            }
          } else if (match.officialMetrics) {
            preservedDetails += 1;
          }

          for (const sourceUrl of new Set(detailIssues.map((entry) => entry.sourceUrl).filter((url): url is string => url !== null))) {
            const fetchId = fetchIdByUrl.get(sourceUrl);
            if (fetchId) await tx.update(sourceFetches).set({ parseStatus: "partial" }).where(eq(sourceFetches.id, fetchId));
          }
          const matchIssues = [...match.issues, ...integrityIssues, ...detailIssues];
          const detailValid = matchIssues.every((entry) => entry.severity !== "error") &&
            (savedGame.status === "scheduled" || (boxScore !== null && matchDataStatus(match) === "ready"));
          // Persist only after all detail guards pass, inside the game transaction.
          // A failed/partial refresh must remain eligible for the next incremental cycle.
          await tx.update(games).set({
            fixtureHash: fixtureHash(match.fixture),
            detailSyncStatus: detailValid ? "parsed" : "partial",
            detailParserVersion: PARSER_VERSION,
            detailSyncedAt: detailValid && boxScore !== null ? new Date() : savedGame.detailSyncedAt
          }).where(eq(games.id, savedGame.id));
          for (const batch of chunks(matchIssues)) {
            await tx.insert(validationIssues).values(batch.map((entry) => issueValues(entry, run.id, competitionId, savedGame.id)));
          }
          return { playerStats: !unchanged ? boxScore?.players.length ?? 0 : 0,
            teamStats: !unchanged ? boxScore?.teams.length ?? 0 : 0, unchanged,
            isNewGame: !existingGame,
            gameChanged: coreGameChanged || (boxScore !== null && !unchanged) || playByPlayRowsWritten > 0 || shotRowsWritten > 0 || gameMetricRowsWritten > 0,
            playByPlayEvents: playByPlayRowsWritten, shots: shotRowsWritten, gameOfficialMetrics: gameMetricRowsWritten,
            playByPlayUnchanged, shotsUnchanged, preservedDetails,
            additionalIssues: [...integrityIssues, ...detailIssues],
            preserved: boxScore === null,
            dataStatus: integrityIssues.length > 0 ? "boxscore_partial" : matchDataStatus(match) };
        });
        issues.push(...written.additionalIssues);
        writtenPlayerStats += written.playerStats;
        writtenTeamStats += written.teamStats;
        writtenPlayByPlayEvents += written.playByPlayEvents;
        writtenShots += written.shots;
        writtenGameOfficialMetrics += written.gameOfficialMetrics;
        unchangedPlayByPlayGames += written.playByPlayUnchanged;
        unchangedShotCharts += written.shotsUnchanged;
        preservedDetailDatasets += written.preservedDetails;
        if (written.unchanged) unchangedBoxScores += 1;
        if (written.isNewGame) newGames += 1;
        else if (written.gameChanged) updatedGames += 1;
        else unchangedGames += 1;
        if (written.preserved && written.dataStatus !== "scheduled") preservedBoxScores += 1;
        matchStatuses[written.dataStatus] = (matchStatuses[written.dataStatus] ?? 0) + 1;
      } catch (error) {
        failedGames.push(match.fixture.sourceId);
        // The game transaction rolled back. Keep retry eligibility separately,
        // including failures where the incoming fixture itself was unchanged.
        await db.transaction(async (tx) => {
          await writeGuard?.(tx);
          await tx.update(games).set({ detailSyncStatus: "failed" }).where(and(
            eq(games.competitionId, competitionId), eq(games.source, SOURCE_NAME), eq(games.sourceGameId, match.fixture.sourceId)
          ));
        }).catch(() => undefined);
        matchStatuses["import_failed"] = (matchStatuses["import_failed"] ?? 0) + 1;
        const failure: ValidationIssue = {
          severity: "error",
          code: "IMPORT_GAME_FAILED",
          message: error instanceof Error ? error.message : String(error),
          sourceUrl: match.fixture.sourceUrl,
          fieldPath: `games.${match.fixture.sourceId}`,
          expected: null,
          actual: null
        };
        issues.push(failure);
        runIssues.push(failure);
      }
    }

    for (const batch of chunks(runIssues)) {
      await writeGuard?.();
      await db.insert(validationIssues).values(batch.map((entry) => issueValues(entry, run.id, competitionId, null)));
    }
    const counts = {
      competitions: 1,
      teams: core.teamIdBySource.size,
      players: core.playerIdBySource.size,
      groups: core.groupIdBySource.size,
      standings: data.groups.reduce((sum, group) => sum + group.rows.length, 0),
      games: data.matches.length - failedGames.length,
      newGames,
      updatedGames,
      unchangedGames,
      playerGameStats: writtenPlayerStats,
      teamGameStats: writtenTeamStats,
      playByPlayEvents: writtenPlayByPlayEvents,
      shots: writtenShots,
      gameOfficialMetrics: writtenGameOfficialMetrics,
      competitionOfficialMetrics: writtenCompetitionOfficialMetrics,
      unchangedBoxScores,
      unchangedPlayByPlayGames,
      unchangedShotCharts,
      preservedBoxScores,
      preservedDetailDatasets,
      readyGames: matchStatuses["ready"] ?? 0,
      scheduledGames: matchStatuses["scheduled"] ?? 0,
      fetchFailedGames: matchStatuses["fetch_failed"] ?? 0,
      partialBoxScoreGames: matchStatuses["boxscore_partial"] ?? 0,
      parseFailedGames: matchStatuses["parse_failed"] ?? 0,
      unavailableGames: matchStatuses["unavailable"] ?? 0
    };
    const hasIncompleteGames = counts.fetchFailedGames + counts.partialBoxScoreGames + counts.parseFailedGames + counts.unavailableGames > 0;
    const status = failedGames.length > 0 || hasIncompleteGames || issues.some((entry) => entry.severity === "error") ? "partial" : "succeeded";
    await writeGuard?.();
    await db.update(importRuns).set({
      status,
      recordCounts: counts,
      finishedAt: new Date(),
      errorSummary: issues.length > 0 ? `${issues.length} isu; ${failedGames.length} pertandingan gagal ditulis.` : null
    }).where(eq(importRuns.id, run.id));
    return { importRunId: run.id, competitionId, counts, failedGames, issues, status, matchStatuses, durationMs: Date.now() - startedAt };
  } catch (error) {
    try {
      await writeGuard?.();
      await db.update(importRuns).set({
        status: "failed",
        finishedAt: new Date(),
        errorSummary: error instanceof Error ? error.message : String(error)
      }).where(eq(importRuns.id, run.id));
    } catch { /* a lost lease must never write through another owner's operation */ }
    throw error;
  }
}

async function upsertCompetition(tx: Parameters<Parameters<StatsArenaDatabase["transaction"]>[0]>[0], record: CompetitionRecord) {
  const [saved] = await tx.insert(competitions).values({
    source: SOURCE_NAME,
    sourceCompetitionId: record.sourceId,
    sourceUrl: record.sourceUrl,
    name: record.name,
    season: record.season,
    year: record.year,
    lastSeenAt: new Date()
  }).onConflictDoUpdate({
    target: [competitions.source, competitions.sourceCompetitionId],
    set: {
      sourceUrl: record.sourceUrl,
      name: record.name,
      season: record.season ?? sql`${competitions.season}`,
      year: record.year ?? sql`${competitions.year}`,
      lastSeenAt: new Date(),
      updatedAt: new Date()
    }
  }).returning();
  if (!saved) throw new Error(`Gagal menyimpan kompetisi ${record.sourceId}.`);
  return saved;
}

function dedupeGroups(groups: GroupRecord[]): GroupRecord[] {
  return [...new Map(groups.map((group) => [group.sourceId, group])).values()];
}

function issueValues(entry: ValidationIssue, runId: string, competitionId: string, gameId: string | null) {
  return {
    importRunId: runId,
    competitionId,
    gameId,
    severity: entry.severity,
    code: entry.code,
    message: entry.message,
    fieldPath: entry.fieldPath,
    expected: entry.expected,
    actual: entry.actual,
    sourceUrl: entry.sourceUrl
  };
}


// Bound parameter counts and payload size; each batch still runs inside its caller's transaction.
function chunks<T>(rows: T[], size = 250): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < rows.length; index += size) batches.push(rows.slice(index, index + size));
  return batches;
}

function requiredId(ids: Map<string, string>, sourceId: string): string {
  const id = ids.get(sourceId);
  if (!id) throw new Error(`Identitas sumber ${sourceId} belum disimpan.`);
  return id;
}

function collectIdentities(data: ParsedCompetitionData): { teams: TeamRecord[]; players: PlayerRecord[] } {
  const teamRecords = new Map<string, TeamRecord>();
  const playerRecords = new Map<string, PlayerRecord>();
  const addTeam = (sourceId: string | null, name: string | null, sourceUrl: string) => {
    if (sourceId && name) teamRecords.set(sourceId, { sourceId, name, sourceUrl, logoUrl: null });
  };
  for (const group of data.groups) {
    for (const row of group.rows) addTeam(row.teamSourceId, row.teamName, row.sourceUrl);
  }
  for (const match of data.matches) {
    for (const record of [match.fixture, match.summary]) {
      if (!record) continue;
      addTeam(record.homeTeamSourceId, record.homeTeamName, record.sourceUrl);
      addTeam(record.awayTeamSourceId, record.awayTeamName, record.sourceUrl);
    }
    if (match.boxScore) {
      for (const team of match.boxScore.teams) addTeam(team.teamSourceId, team.teamName, team.sourceUrl);
      for (const player of match.boxScore.players) playerRecords.set(player.playerSourceId, {
        sourceId: player.playerSourceId, sourceUrl: player.sourceUrl, name: player.playerName
      });
    }
    for (const metric of match.officialMetrics?.records ?? []) {
      addTeam(metric.teamSourceId, metric.teamName, metric.sourceUrl);
    }
    for (const event of match.playByPlay?.records ?? []) {
      if (event.playerSourceId && event.playerName) playerRecords.set(event.playerSourceId, {
        sourceId: event.playerSourceId, sourceUrl: event.sourceUrl, name: event.playerName
      });
    }
    for (const shot of match.shotChart?.records ?? []) {
      addTeam(shot.teamSourceId, shot.teamName, shot.sourceUrl);
      if (shot.playerName) playerRecords.set(shot.playerSourceId, {
        sourceId: shot.playerSourceId, sourceUrl: shot.sourceUrl, name: shot.playerName
      });
    }
  }
  for (const metric of data.teamOfficialMetrics?.records ?? []) {
    addTeam(metric.teamSourceId, metric.teamName, metric.sourceUrl);
  }
  // Registry pages provide canonical profile URLs and optional logos.
  for (const team of data.teams) teamRecords.set(team.sourceId, team);
  for (const player of data.players) playerRecords.set(player.sourceId, player);
  return { teams: [...teamRecords.values()], players: [...playerRecords.values()] };
}

function playByPlayRow(
  event: PlayByPlayEventRecord,
  gameId: string,
  teamIds: Map<string, string>,
  playerIds: Map<string, string>,
  sourceFetchId: string | null
) {
  return {
    gameId,
    sourceSequence: event.sourceSequence,
    periodNumber: event.periodNumber,
    periodLabelRaw: event.periodLabelRaw,
    periodType: event.periodType,
    timeRaw: event.timeRaw,
    actionType: event.actionType,
    actionText: event.actionText,
    teamId: event.teamSourceId ? requiredId(teamIds, event.teamSourceId) : null,
    teamSide: event.teamSide,
    playerId: event.playerSourceId ? requiredId(playerIds, event.playerSourceId) : null,
    playerName: event.playerName,
    scoreRaw: event.scoreRaw,
    team1Score: event.team1Score,
    team2Score: event.team2Score,
    rawClasses: event.rawClasses,
    sourceUrl: event.sourceUrl,
    sourceFetchId,
    parserVersion: PARSER_VERSION
  };
}

function shotRow(
  shot: ShotRecord,
  gameId: string,
  teamIds: Map<string, string>,
  playerIds: Map<string, string>,
  sourceFetchId: string | null
) {
  return {
    gameId,
    sourceSequence: shot.sourceSequence,
    periodNumber: shot.periodNumber,
    teamId: requiredId(teamIds, shot.teamSourceId),
    playerId: requiredId(playerIds, shot.playerSourceId),
    playerName: shot.playerName,
    shotType: shot.shotType,
    result: shot.result,
    xRaw: shot.xRaw,
    yRaw: shot.yRaw,
    xPercent: shot.xPercent,
    yPercent: shot.yPercent,
    rawTitle: shot.rawTitle,
    rawClasses: shot.rawClasses,
    sourceUrl: shot.sourceUrl,
    sourceFetchId,
    parserVersion: PARSER_VERSION
  };
}

function officialMetricRow(
  metric: OfficialTeamMetricRecord,
  competitionId: string,
  gameId: string,
  teamIds: Map<string, string>,
  sourceFetchId: string | null
) {
  return {
    competitionId,
    scopeType: "game" as const,
    gameId,
    teamId: requiredId(teamIds, metric.teamSourceId),
    metricCode: metric.metricCode,
    value: metric.value,
    availability: metric.availability,
    unit: metric.unit,
    scopeLabel: metric.scopeLabel,
    sampleGamesPlayed: metric.sampleGamesPlayed,
    rawValue: metric.rawValue,
    sourceUrl: metric.sourceUrl,
    sourceFetchId,
    parserVersion: PARSER_VERSION
  };
}

function metricDatasetIssues(
  incoming: Array<{ teamId: string; scopeType: "game" | "competition"; metricCode: string; availability: "available" | "unavailable"; rawValue: string | null }>,
  existing: Array<{ teamId: string; metricCode: string }>,
  sourceUrl: string
): ValidationIssue[] {
  const keys = new Set(incoming.map((metric) => `${metric.teamId}:${metric.metricCode}`));
  const issues: ValidationIssue[] = [];
  if (existing.some((metric) => !keys.has(`${metric.teamId}:${metric.metricCode}`))) {
    issues.push(issue("error", "OFFICIAL_METRIC_SET_INCOMPLETE", "Tim/metrik yang pernah tersimpan hilang dari dataset baru; metrik lama dipertahankan.", sourceUrl, "metrics"));
  }
  // BP on Team Analysis is explicitly unsupported. Other unavailable values need a source marker.
  if (incoming.some((metric) => metric.availability === "unavailable" && !(metric.scopeType === "game" && metric.metricCode === "BP" && metric.rawValue === null) && !/^(?:-|–|—|n\/a)$/i.test(metric.rawValue ?? ""))) {
    issues.push(issue("error", "OFFICIAL_METRIC_VALUE_INVALID", "Metrik tidak tersedia tanpa penanda sumber eksplisit; dataset lama dipertahankan.", sourceUrl, "metrics.rawValue"));
  }
  return issues;
}

function sameRowsByKeys<T extends Record<string, unknown>>(
  incoming: T[],
  existing: Array<Record<string, unknown>>,
  keys: Array<keyof T>,
  ignoredFields: string[]
): boolean {
  if (incoming.length !== existing.length) return false;
  const keyOf = (row: Record<string, unknown>) => keys.map((key) => String(row[String(key)] ?? "")).join("\u0000");
  const oldByKey = new Map(existing.map((row) => [keyOf(row), row]));
  const ignored = new Set(["id", "createdAt", "updatedAt", "sourceFetchId", ...ignoredFields]);
  return incoming.every((row) => {
    const prior = oldByKey.get(keyOf(row));
    if (!prior) return false;
    return Object.entries(row).filter(([key]) => !ignored.has(key)).every(([key, value]) => {
      return JSON.stringify(value) === JSON.stringify(prior[key]);
    });
  });
}

function sameRows<T extends { teamId: string }>(incoming: T[], existing: T[], key: keyof T): boolean {
  if (incoming.length !== existing.length) return false;
  const savedByKey = new Map(existing.map((row) => [row[key], row]));
  return incoming.every((row) => {
    const saved = savedByKey.get(row[key]);
    if (!saved) return false;
    // Only compare fields that this importer owns; IDs, timestamps and additional official metrics remain untouched.
    return (Object.keys(row) as Array<keyof T>).every((field) => row[field] === saved[field]);
  });
}
