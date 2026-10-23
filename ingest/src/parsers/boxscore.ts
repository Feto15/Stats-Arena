import type { AnyNode } from "domhandler";
import type { BoxScoreRecord, BoxScoreStats, ParseReport, PlayerBoxScoreRecord, TeamBoxScoreRecord } from "../domain/types.js";
import { boxScoreSchema, boxScoreStatsSchema, playerBoxScoreSchema, teamBoxScoreSchema } from "../domain/types.js";
import { sourceEntityId, validateSourceUrl } from "../domain/source-url.js";
import { boxScoreCompletenessIssues } from "../domain/validation.js";
import { cleanText, issue, loadHtml, normalizedHeader, ParserError, report } from "./common.js";

type StatField = keyof Omit<BoxScoreStats, "minutesRaw" | "rawValues" | "statDerivations">;
type ColumnKind = StatField | "player" | "jersey" | "pairedFieldGoals" | "pairedTwoPoints" | "pairedThreePoints" | "pairedFreeThrows" | null;

const NULL_STATS: Omit<BoxScoreStats, "minutesRaw" | "rawValues" | "statDerivations"> = {
  minutes: null,
  fieldGoalsMade: null,
  fieldGoalsAttempted: null,
  twoPointsMade: null,
  twoPointAttempts: null,
  threePointsMade: null,
  threePointAttempts: null,
  freeThrowsMade: null,
  freeThrowAttempts: null,
  offensiveRebounds: null,
  defensiveRebounds: null,
  rebounds: null,
  assists: null,
  steals: null,
  blocks: null,
  turnovers: null,
  personalFouls: null,
  points: null,
  fieldGoalPct: null,
  twoPointPct: null,
  threePointPct: null,
  freeThrowPct: null
};

const HEADER_MAP: Record<string, ColumnKind> = {
  PLAYER: "player",
  NAME: "player",
  PLAYERS: "player",
  JERSEY: "jersey",
  JERSEYNO: "jersey",
  NUMBER: "jersey",
  NO: "jersey",
  MIN: "minutes",
  MINS: "minutes",
  MINUTES: "minutes",
  M: "minutes",
  FG: "pairedFieldGoals",
  FGM: "fieldGoalsMade",
  FGMADE: "fieldGoalsMade",
  FGA: "fieldGoalsAttempted",
  FGATT: "fieldGoalsAttempted",
  FGATTEMPTED: "fieldGoalsAttempted",
  "FG%": "fieldGoalPct",
  FGPCT: "fieldGoalPct",
  TWOPOINTS: "pairedTwoPoints",
  TWOPOINT: "pairedTwoPoints",
  "2P": "pairedTwoPoints",
  "2PM": "twoPointsMade",
  "2PA": "twoPointAttempts",
  "2P%": "twoPointPct",
  "2PPCT": "twoPointPct",
  THREEPOINTS: "pairedThreePoints",
  THREEPOINT: "pairedThreePoints",
  "3P": "pairedThreePoints",
  "3PM": "threePointsMade",
  "3PA": "threePointAttempts",
  "3P%": "threePointPct",
  "3PPCT": "threePointPct",
  FT: "pairedFreeThrows",
  FTM: "freeThrowsMade",
  FTA: "freeThrowAttempts",
  "FT%": "freeThrowPct",
  FTPCT: "freeThrowPct",
  OR: "offensiveRebounds",
  OREB: "offensiveRebounds",
  ORB: "offensiveRebounds",
  OFF: "offensiveRebounds",
  DR: "defensiveRebounds",
  DREB: "defensiveRebounds",
  DRB: "defensiveRebounds",
  DEF: "defensiveRebounds",
  REB: "rebounds",
  TR: "rebounds",
  TREB: "rebounds",
  AST: "assists",
  A: "assists",
  STL: "steals",
  ST: "steals",
  BLK: "blocks",
  B: "blocks",
  TO: "turnovers",
  TOV: "turnovers",
  PF: "personalFouls",
  FOULS: "personalFouls",
  PTS: "points",
  POINTS: "points",
  P: "points"
};

function columnKind(header: string): ColumnKind {
  const normalized = normalizedHeader(header);
  return HEADER_MAP[normalized] ?? null;
}

function headerCells($: ReturnType<typeof loadHtml>, table: AnyNode): AnyNode[] {
  const rows = $(table).find("tr").toArray();
  const row = rows.find((candidate) => $(candidate).find("th").length > 0 && $(candidate).find("a[href*='/person/']").length === 0);
  return row ? $(row).find("th, td").toArray() : [];
}

function headerNames($: ReturnType<typeof loadHtml>, table: AnyNode, headers: AnyNode[]): string[] {
  const names = headers.map((cell) => cleanText($(cell).attr("data-stat") ?? $(cell).attr("data-label") ?? $(cell).text()));
  if (names.some((name) => columnKind(name) !== null)) return names;
  const rows = $(table).find("tr").toArray();
  const first = rows[0];
  if (!first) return names;
  return $(first).find("td, th").toArray().map((cell) => cleanText($(cell).attr("data-stat") ?? $(cell).attr("data-label") ?? $(cell).text()));
}

function parseInteger(value: string): number | null {
  const raw = cleanText(value);
  if (!raw || /^(?:-|–|—|n\/a)$/i.test(raw)) return null;
  const number = Number(raw.replace(/,/g, "").replace(/%$/, ""));
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function parseMinutes(value: string): { raw: string | null; minutes: number | null } {
  const raw = cleanText(value);
  if (!raw || /^(?:-|–|—|n\/a)$/i.test(raw)) return { raw: raw || null, minutes: null };
  const clock = raw.match(/^(\d{1,3}):(\d{2})$/);
  if (clock?.[1] && clock[2] && Number(clock[2]) < 60) {
    return { raw, minutes: Number(clock[1]) + Number(clock[2]) / 60 };
  }
  const decimal = /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : null;
  return { raw, minutes: decimal !== null && Number.isFinite(decimal) ? decimal : null };
}

function parsePair(value: string): [number | null, number | null] {
  const match = cleanText(value).match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!match?.[1] || !match[2]) return [null, null];
  return [Number(match[1]), Number(match[2])];
}

function rowValues($: ReturnType<typeof loadHtml>, row: AnyNode, names: string[]): Map<string, string> {
  const values = new Map<string, string>();
  const cells = $(row).find("td, th").toArray();
  names.forEach((name, index) => {
    const cell = cells[index];
    if (!cell) return;
    values.set(name, cleanText($(cell).attr("data-value") ?? $(cell).text()));
  });
  return values;
}

function statsFromRow($: ReturnType<typeof loadHtml>, row: AnyNode, names: string[], kinds: ColumnKind[]): BoxScoreStats {
  const values = rowValues($, row, names);
  const stats: Record<string, unknown> = { ...NULL_STATS, minutesRaw: null, rawValues: Object.fromEntries(values) };
  for (const [index, kind] of kinds.entries()) {
    if (!kind || kind === "player" || kind === "jersey") continue;
    const name = names[index] ?? "";
    const value = values.get(name) ?? "";
    if (kind === "minutes") {
      const parsed = parseMinutes(value);
      stats["minutesRaw"] = parsed.raw;
      stats["minutes"] = parsed.minutes;
      continue;
    }
    if (kind === "pairedFieldGoals" || kind === "pairedTwoPoints" || kind === "pairedThreePoints" || kind === "pairedFreeThrows") {
      const [made, attempted] = parsePair(value);
      if (kind === "pairedFieldGoals") {
        stats["fieldGoalsMade"] = made;
        stats["fieldGoalsAttempted"] = attempted;
      } else if (kind === "pairedTwoPoints") {
        stats["twoPointsMade"] = made;
        stats["twoPointAttempts"] = attempted;
      } else if (kind === "pairedThreePoints") {
        stats["threePointsMade"] = made;
        stats["threePointAttempts"] = attempted;
      } else {
        stats["freeThrowsMade"] = made;
        stats["freeThrowAttempts"] = attempted;
      }
      continue;
    }
    if (kind.endsWith("Pct")) {
      stats[kind] = value || null;
      continue;
    }
    const number = parseInteger(value);
    if (number !== null || value === "0") stats[kind] = number;
  }
  const parsed = boxScoreStatsSchema.parse(stats);
  // Derive only when 2P columns are absent, never to fill an invalid/blank official cell.
  if (!kinds.some((kind) => kind === "pairedTwoPoints" || kind === "twoPointsMade" || kind === "twoPointAttempts")) {
    const { fieldGoalsMade: fgm, fieldGoalsAttempted: fga, threePointsMade: pm, threePointAttempts: pa } = parsed;
    if (fgm !== null && fga !== null && pm !== null && pa !== null &&
        fgm <= fga && pm <= pa && pm <= fgm && pa <= fga && fgm - pm <= fga - pa) {
      parsed.twoPointsMade = fgm - pm; parsed.twoPointAttempts = fga - pa;
      parsed.statDerivations = {
        twoPointsMade: { formula: "FGM - 3PM", version: "1", inputs: { FGM: fgm, "3PM": pm } },
        twoPointAttempts: { formula: "FGA - 3PA", version: "1", inputs: { FGA: fga, "3PA": pa } }
      };
    }
  }
  return parsed;
}

function totalsRow($: ReturnType<typeof loadHtml>, row: AnyNode): boolean {
  const labelCell = $(row).find("td, th").toArray().some((cell) =>
    /^(?:team\s+)?totals?$/i.test(cleanText($(cell).text()))
  );
  return labelCell || /data-row-type=["']?total/i.test($.html(row));
}

function teamIdForTable($: ReturnType<typeof loadHtml>, table: AnyNode): { id: string; name: string } | null {
  const tableWrap = $(table).closest(".table-wrap");
  const heading = tableWrap.prevAll("a[href]").first();
  const headingHref = heading.attr("href");
  const headingId = headingHref ? sourceEntityId(headingHref, "team") : null;
  const headingName = cleanText(heading.text()) || cleanText(heading.find("h1, h2, h3, h4").text());
  if (headingId && headingName) return { id: headingId, name: headingName };

  let current: AnyNode | undefined = table;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    const candidates = new Map<string, string>();
    for (const anchor of $(current).find("a[href]").toArray()) {
      const href = $(anchor).attr("href");
      const id = href ? sourceEntityId(href, "team") : null;
      if (!id) continue;
      const name = cleanText($(anchor).text()) || cleanText($(anchor).find("img").attr("alt"));
      if (name) candidates.set(id, name);
    }
    if (candidates.size === 1) {
      const [id, name] = [...candidates.entries()][0] ?? [];
      if (id && name) return { id, name };
    }
    current = $(current).parent().get(0);
  }
  return null;
}

function playerIdForRow($: ReturnType<typeof loadHtml>, row: AnyNode): string | null {
  for (const anchor of $(row).find("a[href]").toArray()) {
    const href = $(anchor).attr("href");
    const id = href ? sourceEntityId(href, "person") : null;
    if (id) return id;
  }
  return null;
}

function playerHref($: ReturnType<typeof loadHtml>, row: AnyNode): string | null {
  return $(row).find("a[href]").toArray().map((anchor) => $(anchor).attr("href") ?? "").find((href) => sourceEntityId(href, "person") !== null) ?? null;
}

function tableRows($: ReturnType<typeof loadHtml>, table: AnyNode): AnyNode[] {
  return $(table).find("tr").toArray().filter((row) => $(row).find("th").length === 0);
}

function rowName($: ReturnType<typeof loadHtml>, row: AnyNode): string {
  return cleanText($(row).find("a[href]").filter((_, anchor) => {
    const href = $(anchor).attr("href");
    return href !== undefined && sourceEntityId(href, "person") !== null;
  }).first().text()) || cleanText($(row).find("[class*='player-name']").first().text());
}

export function parseBoxScoreHtml(html: string, sourceUrl: string): ParseReport<BoxScoreRecord> {
  const url = validateSourceUrl(sourceUrl);
  const gameId = sourceEntityId(url.href, "match");
  if (!gameId) throw new ParserError("ID pertandingan tidak ditemukan dari URL", sourceUrl, "/match/{id}/boxscore");
  const $ = loadHtml(html, sourceUrl);
  const tables = $("table").toArray();
  if (tables.length === 0) throw new ParserError("Tabel box score tidak ditemukan", sourceUrl, "table");

  const issues = [] as ReturnType<typeof issue>[];
  const teamStats: TeamBoxScoreRecord[] = [];
  const players = new Map<string, PlayerBoxScoreRecord>();
  const eligible = tables.map((table) => {
    const headers = headerCells($, table);
    const names = headerNames($, table, headers);
    const kinds = names.map(columnKind);
    const rows = tableRows($, table);
    const hasStats = kinds.some((kind) => kind !== null && kind !== "player" && kind !== "jersey");
    return { table, names, kinds, rows, hasStats };
  }).filter((entry) => entry.hasStats);
  if (eligible.length === 0) throw new ParserError("Header statistik box score tidak dikenali", sourceUrl, "table th");

  for (const tableData of eligible) {
    const team = teamIdForTable($, tableData.table);
    if (!team) {
      issues.push(issue("error", "BOXSCORE_TEAM_ID_MISSING", "ID tim tidak dapat ditautkan ke tabel statistik.", sourceUrl, "teams"));
      continue;
    }
    let foundTotals = false;
    if (!tableData.kinds.includes("player") || !tableData.kinds.includes("minutes")) {
      issues.push(issue("error", "BOXSCORE_HEADERS_INCOMPLETE", "Header Player atau Mins tidak ditemukan.", sourceUrl, `teams.${team.id}.headers`));
    }
    for (const row of tableData.rows) {
      if (totalsRow($, row)) {
        const stats = statsFromRow($, row, tableData.names, tableData.kinds);
        const parsed = teamBoxScoreSchema.safeParse({ ...stats, teamSourceId: team.id, teamName: team.name, sourceUrl: url.href });
        if (!parsed.success) {
          issues.push(issue("error", "BOXSCORE_TOTALS_INVALID", parsed.error.message, sourceUrl, `teams.${team.id}.totals`));
          continue;
        }
        const existing = teamStats.findIndex((entry) => entry.teamSourceId === team.id);
        if (existing >= 0) teamStats.splice(existing, 1, parsed.data);
        else teamStats.push(parsed.data);
        foundTotals = true;
        continue;
      }
      const playerId = playerIdForRow($, row);
      if (!playerId) {
        if ($(row).find("td").length > 0 && cleanText($(row).text())) {
          issues.push(issue("error", "BOXSCORE_PLAYER_ID_MISSING", "Baris pemain tidak memiliki tautan ID sumber; box score tidak boleh mengganti statistik lama.", sourceUrl, `teams.${team.id}.players`));
        }
        continue;
      }
      if ($(row).find("td, th").length < tableData.names.length) {
        issues.push(issue("error", "BOXSCORE_ROW_TRUNCATED", "Jumlah sel statistik pemain lebih sedikit daripada header.", sourceUrl, `players.${playerId}`));
      }
      const name = rowName($, row);
      if (!name) {
        issues.push(issue("error", "BOXSCORE_PLAYER_NAME_MISSING", "ID pemain ditemukan tetapi nama tidak tersedia.", sourceUrl, `players.${playerId}.name`));
        continue;
      }
      const cells = $(row).find("td, th").toArray();
      const jerseyIndex = tableData.kinds.indexOf("jersey");
      const jerseyNumber = jerseyIndex >= 0 ? cleanText($(cells[jerseyIndex] ?? row).text()) || null : null;
      const stats = statsFromRow($, row, tableData.names, tableData.kinds);
      const href = playerHref($, row);
      const playerUrl = href ? new URL(href, url.href).href : url.href;
      const parsed = playerBoxScoreSchema.safeParse({
        ...stats,
        playerSourceId: playerId,
        playerName: name,
        teamSourceId: team.id,
        jerseyNumber,
        sourceUrl: playerUrl
      });
      if (!parsed.success) {
        issues.push(issue("error", "BOXSCORE_PLAYER_INVALID", parsed.error.message, sourceUrl, `players.${playerId}`));
        continue;
      }
      if (players.has(playerId)) {
        issues.push(issue("error", "BOXSCORE_PLAYER_DUPLICATE", "Baris pemain duplikat; box score perlu diperiksa sebelum mengganti statistik lama.", sourceUrl, `players.${playerId}`));
        continue;
      }
      players.set(playerId, parsed.data);
    }
    if (!foundTotals) {
      issues.push(issue("error", "BOXSCORE_TOTALS_MISSING", "Baris Totals tidak ditemukan untuk tim.", sourceUrl, `teams.${team.id}.totals`));
    }
  }
  if (teamStats.length === 0) {
    const details = issues.map((entry) => `${entry.code}: ${entry.message}`).join("; ");
    throw new ParserError(`Tidak ada baris Totals box score valid${details ? ` (${details})` : ""}`, sourceUrl, "table tr (Totals)");
  }
  const candidate = { gameSourceId: gameId, sourceUrl: url.href, teams: teamStats, players: [...players.values()] };
  const parsed = boxScoreSchema.safeParse(candidate);
  if (!parsed.success) throw new ParserError(`Box score tidak valid: ${parsed.error.message}`, sourceUrl, "table");
  if (teamStats.length !== 2) {
    issues.push(issue("error", "BOXSCORE_TEAM_COUNT", "Box score harus memiliki total dua tim.", sourceUrl, "teams", 2, teamStats.length));
  }
  issues.push(...boxScoreCompletenessIssues(parsed.data));
  return report(sourceUrl, [parsed.data], issues);
}
