import { clubHref, type ClubPlayer } from "./club-report";

export const playerTableColumns = [
  { key: "name", label: "Pemain", value: (p: ClubPlayer) => p.name },
  { key: "games", label: "GP¹", value: (p: ClubPlayer) => p.gamesRecorded },
  { key: "minutes", label: "MIN/laga", value: (p: ClubPlayer) => p.perGame.minutes },
  { key: "points", label: "PTS/laga", value: (p: ClubPlayer) => p.perGame.points },
  { key: "rebounds", label: "REB/laga", value: (p: ClubPlayer) => p.perGame.rebounds },
  { key: "assists", label: "AST/laga", value: (p: ClubPlayer) => p.perGame.assists },
  { key: "turnovers", label: "TO/laga", value: (p: ClubPlayer) => p.perGame.turnovers },
  { key: "usage", label: "USG%*", value: (p: ClubPlayer) => p.advancedStats.usagePercentage },
  { key: "trueShooting", label: "TS%*", value: (p: ClubPlayer) => p.advancedStats.trueShootingPercentage },
  { key: "gameScore", label: "GmSc/laga", value: (p: ClubPlayer) => p.advancedStats.gameScorePerGame },
] as const;
export type PlayerTableSort = { key: typeof playerTableColumns[number]["key"]; order: "asc" | "desc" };

export function playerTableSort(params: Record<string, string | string[] | undefined>): PlayerTableSort {
  const column = playerTableColumns.find(c => c.key === params["sort"]);
  if (!column) return { key: "points", order: "desc" };
  return { key: column.key, order: params["order"] === "asc" ? "asc" : params["order"] === "desc" ? "desc" : column.key === "name" ? "asc" : "desc" };
}

export function sortClubPlayers(players: readonly ClubPlayer[], sort: PlayerTableSort) {
  const column = playerTableColumns.find(c => c.key === sort.key)!;
  return [...players].sort((a, b) => {
    const av = column.value(a), bv = column.value(b);
    // Unavailable values always follow real values, including zero and negative GmSc.
    if (av == null && bv != null) return 1;
    if (bv == null && av != null) return -1;
    const difference = typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv, "id") : typeof av === "number" && typeof bv === "number" ? av - bv : 0;
    return (sort.order === "asc" ? difference : -difference) || a.sourceId.localeCompare(b.sourceId);
  });
}

export function playerTableHref(basePath: string, player: string | undefined, sort: PlayerTableSort) {
  return `${clubHref("players", player, basePath)}&${new URLSearchParams({ sort: sort.key, order: sort.order })}`;
}
