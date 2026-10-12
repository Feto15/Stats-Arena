import "server-only";

import { resolve } from "node:path";
import { createDatabase, type StatsArenaDatabase } from "@statsarena/db";
import { loadProjectEnv } from "@statsarena/db/env";
import {
  getCompetitionBySourceId,
  getGameDetail,
  getGamesPage,
  getOverview,
  getPlayerSummary,
  getPlayersPage,
  getReviewSummary,
  getStandings,
  getTeamSummary,
  getTeamsPage,
  listCompetitions,
  type GameListFilters,
  type ReviewFilters,
  type StandingsFilters,
} from "./queries";
import type { GameDetailFilters } from "./contracts";

let database: ReturnType<typeof createDatabase> | undefined;

/** Keep the pooled connection server-only and lazily initialize it after loading StatsArena's root .env. */
export function getDashboardDatabase(): StatsArenaDatabase {
  if (!database) {
    loadProjectEnv(resolve(process.cwd(), "../.env"));
    database = createDatabase();
  }
  return database.db;
}

export async function readCompetitionOptions() {
  try {
    return { status: "ready" as const, data: await listCompetitions(getDashboardDatabase()) };
  } catch {
    return { status: "unavailable" as const, data: [], message: "Daftar kompetisi belum dapat dimuat dari Neon StatsArena." };
  }
}

export async function readCompetition(sourceId: string) {
  try {
    return { status: "ready" as const, data: await getCompetitionBySourceId(getDashboardDatabase(), sourceId) };
  } catch {
    return { status: "unavailable" as const, data: null, message: "Data kompetisi belum dapat dimuat dari Neon StatsArena." };
  }
}

export async function readOverview(competitionId: string) {
  try {
    return { status: "ready" as const, data: await getOverview(getDashboardDatabase(), competitionId) };
  } catch {
    return { status: "error" as const, message: "Ringkasan belum dapat dimuat. Periksa koneksi Neon StatsArena." };
  }
}

export async function readGames(competitionId: string, filters: GameListFilters) {
  try {
    return { status: "ready" as const, data: await getGamesPage(getDashboardDatabase(), competitionId, filters) };
  } catch {
    return { status: "error" as const, message: "Daftar pertandingan belum dapat dimuat. Coba muat ulang halaman." };
  }
}

export async function readGame(competitionId: string, sourceGameId: string, filters: GameDetailFilters = {}) {
  try {
    return { status: "ready" as const, data: await getGameDetail(getDashboardDatabase(), competitionId, sourceGameId, filters) };
  } catch {
    return { status: "error" as const, message: "Detail pertandingan belum dapat dimuat. Coba muat ulang halaman." };
  }
}

export async function readTeams(competitionId: string, page: number) {
  try {
    return { status: "ready" as const, data: await getTeamsPage(getDashboardDatabase(), competitionId, page) };
  } catch {
    return { status: "error" as const, message: "Daftar tim belum dapat dimuat. Coba muat ulang halaman." };
  }
}

export async function readTeam(competitionId: string, sourceTeamId: string) {
  try {
    return { status: "ready" as const, data: await getTeamSummary(getDashboardDatabase(), competitionId, sourceTeamId) };
  } catch {
    return { status: "error" as const, message: "Detail tim belum dapat dimuat. Coba muat ulang halaman." };
  }
}

export async function readPlayers(competitionId: string, page: number) {
  try {
    return { status: "ready" as const, data: await getPlayersPage(getDashboardDatabase(), competitionId, page) };
  } catch {
    return { status: "error" as const, message: "Daftar pemain belum dapat dimuat. Coba muat ulang halaman." };
  }
}

export async function readPlayer(competitionId: string, sourcePlayerId: string) {
  try {
    return { status: "ready" as const, data: await getPlayerSummary(getDashboardDatabase(), competitionId, sourcePlayerId) };
  } catch {
    return { status: "error" as const, message: "Detail pemain belum dapat dimuat. Coba muat ulang halaman." };
  }
}

export async function readStandings(competitionId: string, filters: StandingsFilters) {
  try {
    return { status: "ready" as const, data: await getStandings(getDashboardDatabase(), competitionId, filters) };
  } catch {
    return { status: "error" as const, message: "Klasemen belum dapat dimuat. Coba muat ulang halaman." };
  }
}

export async function readReview(competitionId: string, filters: ReviewFilters) {
  try {
    return { status: "ready" as const, data: await getReviewSummary(getDashboardDatabase(), competitionId, filters) };
  } catch {
    return { status: "error" as const, message: "Data Review belum dapat dimuat. Coba muat ulang halaman." };
  }
}

/** Only link to the public Genius Sports pages from the expected basketball competition area. */
export function safeSourceHref(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "hosted.dcd.shared.geniussports.com" ||
      !url.pathname.startsWith("/IBF/en/") ||
      url.username ||
      url.password
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}
