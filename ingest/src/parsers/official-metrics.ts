import type { AnyNode } from "domhandler";
import type { OfficialTeamMetricRecord, ParseReport } from "../domain/types.js";
import { sourceEntityId, validateSourceUrl } from "../domain/source-url.js";
import { cleanText, idFromElementLink, integerValue, issue, loadHtml, normalizedHeader, ParserError, report } from "./common.js";

function metricValue(rawValue: string | null, issues: ReturnType<typeof issue>[], sourceUrl: string, fieldPath: string): { value: number | null; availability: "available" | "unavailable" } {
  const value = integerValue(rawValue);
  // A missing/invalid cell is not evidence that the source withdrew a previously valid value.
  const explicitlyUnavailable = rawValue !== null && /^(?:-|–|—|n\/a)$/i.test(rawValue);
  if (!explicitlyUnavailable && (value === null || value < 0 || !/^\d[\d,]*$/.test(rawValue ?? ""))) {
    issues.push(issue("error", "OFFICIAL_METRIC_VALUE_INVALID", "Sel metrik resmi kosong atau tidak valid; dataset sebelumnya dipertahankan.", sourceUrl, fieldPath, "integer >= 0 atau penanda unavailable eksplisit", rawValue));
  }
  return { value, availability: value === null ? "unavailable" : "available" };
}

function tableHeaders($: ReturnType<typeof loadHtml>, table: AnyNode): Map<string, number> {
  return new Map($(table).find("thead th").toArray().map((node, index) => [normalizedHeader($(node).text()), index]));
}

function cellAt($: ReturnType<typeof loadHtml>, row: AnyNode, index: number): string | null {
  return cleanText($(row).find("th, td").eq(index).text()) || null;
}

export function parseTeamAnalysisHtml(html: string, sourceUrl: string): ParseReport<OfficialTeamMetricRecord> {
  const url = validateSourceUrl(sourceUrl);
  const gameId = sourceEntityId(url.href, "match");
  const competitionId = sourceEntityId(url.href, "competition");
  if (!gameId || !competitionId) throw new ParserError("ID pertandingan/kompetisi tidak ditemukan dari URL", sourceUrl, "/competition/{id}/match/{id}/analysis");
  const $ = loadHtml(html);
  const tables = $(".team-analysis table.tableClass").toArray();
  if (!tables.length) throw new ParserError("Tabel Team Analysis tidak ditemukan", sourceUrl, ".team-analysis table.tableClass");
  const issues = [] as ReturnType<typeof issue>[];
  const records: OfficialTeamMetricRecord[] = [];
  const seenTeams = new Set<string>();
  for (const [tableIndex, table] of tables.entries()) {
    const heading = $(table).parent().prevAll("a[href*='/team/']").first();
    const teamSourceId = heading.length ? idFromElementLink($, heading.get(0) ?? table, "team") : null;
    const teamName = heading.length ? cleanText(heading.text()) : "";
    const headers = tableHeaders($, table);
    const metricIndex = headers.get("2CP");
    const rows = $(table).find("tbody tr").toArray();
    const finalRow = rows.find((row) => normalizedHeader(cellAt($, row, 0) ?? "") === "FINAL");
    if (!teamSourceId || !teamName || metricIndex === undefined || !finalRow || seenTeams.has(teamSourceId)) {
      issues.push(issue("error", "TEAM_ANALYSIS_TABLE_INCOMPLETE", "Tabel Team Analysis kehilangan tautan tim atau baris Final/2CP.", sourceUrl, `tables.${tableIndex}`, null, { teamSourceId, headers: [...headers.keys()] }));
      continue;
    }
    seenTeams.add(teamSourceId);
    if ($(finalRow).find("th, td").length !== headers.size) {
      issues.push(issue("error", "TEAM_ANALYSIS_ROW_INCOMPLETE", "Jumlah sel Final tidak sesuai header; kolom metrik tidak dapat dipasangkan dengan aman.", sourceUrl, `tables.${tableIndex}.Final`, headers.size, $(finalRow).find("th, td").length));
      continue;
    }
    const rawValue = cellAt($, finalRow, metricIndex);
    const metric = metricValue(rawValue, issues, sourceUrl, `tables.${tableIndex}.Final.2CP`);
    records.push({
      scope: "game", competitionSourceId: competitionId, gameSourceId: gameId, teamSourceId, teamName,
      metricCode: "2CP", ...metric, unit: "points", scopeLabel: "Final", sampleGamesPlayed: null, rawValue,
      sourceUrl: url.href
    });
    // Team Analysis supplies 2CP but does not expose Bench Points on this game-scoped page.
    records.push({
      scope: "game", competitionSourceId: competitionId, gameSourceId: gameId, teamSourceId, teamName,
      metricCode: "BP", value: null, availability: "unavailable", unit: "points",
      scopeLabel: "Final", sampleGamesPlayed: null, rawValue: null, sourceUrl: url.href
    });
  }
  if (seenTeams.size !== 2) issues.push(issue("error", "TEAM_ANALYSIS_TEAM_COUNT", "Team Analysis tidak menghasilkan dua tim unik.", sourceUrl, ".team-analysis table.tableClass", 2, seenTeams.size));
  return report(url.href, records, issues);
}

export function parseTeamStatisticsHtml(html: string, sourceUrl: string): ParseReport<OfficialTeamMetricRecord> {
  const url = validateSourceUrl(sourceUrl);
  const competitionId = sourceEntityId(url.href, "competition");
  if (!competitionId) throw new ParserError("ID kompetisi tidak ditemukan dari URL", sourceUrl, "/competition/{id}/statistics/team");
  const $ = loadHtml(html);
  const table = $("table.tableClass").toArray().find((candidate) => {
    const headers = tableHeaders($, candidate);
    return headers.has("TEAM") && headers.has("BP") && headers.has("2CP");
  });
  if (!table) throw new ParserError("Tabel statistik tim dengan kolom BP dan 2CP tidak ditemukan", sourceUrl, "table.tableClass thead th");
  const headers = tableHeaders($, table);
  const teamIndex = headers.get("TEAM");
  const bpIndex = headers.get("BP");
  const twoCpIndex = headers.get("2CP");
  const gpIndex = headers.get("GP");
  if (teamIndex === undefined || bpIndex === undefined || twoCpIndex === undefined || gpIndex === undefined) {
    throw new ParserError("Kolom Team, GP, BP, atau 2CP tidak lengkap", sourceUrl, "table.tableClass thead th");
  }
  const rows = $(table).find("tbody tr").toArray();
  if (!rows.length) throw new ParserError("Baris statistik tim tidak ditemukan", sourceUrl, "table.tableClass tbody tr");
  const issues = [] as ReturnType<typeof issue>[];
  const records: OfficialTeamMetricRecord[] = [];
  const seenTeams = new Set<string>();
  for (const [rowIndex, row] of rows.entries()) {
    const teamCell = $(row).find("th, td").eq(teamIndex);
    const teamSourceId = idFromElementLink($, teamCell.get(0) ?? row, "team");
    const teamName = cleanText(teamCell.text());
    if (!teamSourceId || !teamName || seenTeams.has(teamSourceId)) {
      issues.push(issue("error", "TEAM_STATISTICS_TEAM_ID_MISSING", "Baris agregat tim tidak memiliki ID sumber unik.", sourceUrl, `rows.${rowIndex}.team`));
      continue;
    }
    seenTeams.add(teamSourceId);
    if ($(row).find("th, td").length !== headers.size) {
      issues.push(issue("error", "TEAM_STATISTICS_ROW_INCOMPLETE", "Jumlah sel statistik tim tidak sesuai header; dataset sebelumnya dipertahankan.", sourceUrl, `rows.${rowIndex}`, headers.size, $(row).find("th, td").length));
      continue;
    }
    const sampleGamesPlayed = integerValue(cellAt($, row, gpIndex));
    if (sampleGamesPlayed === null) issues.push(issue("error", "TEAM_STATISTICS_GP_INVALID", "Games Played agregat tidak tersedia atau tidak valid.", sourceUrl, `rows.${rowIndex}.GP`));
    for (const [metricCode, columnIndex] of [["BP", bpIndex], ["2CP", twoCpIndex]] as const) {
      const rawValue = cellAt($, row, columnIndex);
      const parsed = metricValue(rawValue, issues, sourceUrl, `rows.${rowIndex}.${metricCode}`);
      records.push({
        scope: "competition", competitionSourceId: competitionId, gameSourceId: null, teamSourceId, teamName,
        metricCode, ...parsed, unit: "points", scopeLabel: "Competition total", sampleGamesPlayed, rawValue,
        sourceUrl: url.href
      });
    }
  }
  if (seenTeams.size !== rows.length) issues.push(issue("error", "TEAM_STATISTICS_ROWS_INCOMPLETE", "Tidak semua baris agregat tim dapat dipasangkan ke identitas sumber.", sourceUrl, "table.tableClass tbody tr", rows.length, seenTeams.size));
  return report(url.href, records, issues);
}
