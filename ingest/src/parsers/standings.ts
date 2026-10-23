import type { AnyNode } from "domhandler";
import type { GroupRecord, GroupStandingsData, ParseReport, StandingRowRecord } from "../domain/types.js";
import { groupSchema, standingRowSchema } from "../domain/types.js";
import { groupSourceId, sourceEntityId, validateSourceUrl, sourceNamespace } from "../domain/source-url.js";
import { cleanText, issue, loadHtml, nullableInteger, normalizedHeader, ParserError, report } from "./common.js";
import { absoluteSourceUrl } from "./common.js";

const HEADER_ALIASES: Record<keyof Omit<StandingRowRecord, "groupSourceId" | "teamSourceId" | "teamName" | "sourceUrl">, string[]> = {
  position: ["POS", "POSITION", "RANK", "#"],
  gamesPlayed: ["GP", "G", "PLAYED", "GAMESPLAYED"],
  wins: ["W", "WIN", "WINS"],
  losses: ["L", "LOSS", "LOSSES"],
  draws: ["D", "DRAW", "DRAWS"],
  pointsFor: ["PF", "FOR", "PTSFOR", "POINTSFOR"],
  pointsAgainst: ["PA", "AGST", "AGAINST", "PTSAGAINST", "POINTSAGAINST"],
  pointDifference: ["DIFF", "GD", "DIFFERENCE", "+/-", "POINTDIFFERENCE"],
  standingPoints: ["TP", "POINTS", "STANDINGPOINTS", "PTS"]
};

function headerIndex(headers: string[], aliases: string[]): number {
  return headers.findIndex((header) => aliases.map(normalizedHeader).includes(normalizedHeader(header)));
}

function groupLabel($: ReturnType<typeof loadHtml>, sourceUrl: string, fallback: string): string {
  const active = $(".nav-tabs .active, .tabs .active, li.active a, a.active, [aria-current='page']").first();
  const activeText = cleanText(active.text());
  if (activeText && !/^standings?$/i.test(activeText)) return activeText;
  const targetIdentity = groupSourceId(new URL(sourceUrl)).id;
  for (const anchor of $("a[href]").toArray()) {
    const absolute = absoluteSourceUrl(sourceUrl, $(anchor).attr("href"));
    if (!absolute) continue;
    const tab = new URL(absolute);
    if (!/\/standings\/?$/i.test(tab.pathname) || groupSourceId(tab).id !== targetIdentity) continue;
    const label = cleanText($(anchor).text());
    if (label) return label;
  }
  const heading = cleanText($(".standings-title, .competition-title, h1").first().text());
  if (heading && !/^standings?$/i.test(heading)) return heading.replace(/^standings?\s*[-:|]?\s*/i, "").trim() || fallback;
  const url = new URL(sourceUrl);
  const queryLabel = url.searchParams.get("groupName") ?? url.searchParams.get("poolName");
  return queryLabel || fallback;
}

function teamHref($: ReturnType<typeof loadHtml>, row: AnyNode): string | null {
  for (const anchor of $(row).find("a[href]").toArray()) {
    const href = $(anchor).attr("href");
    if (href && sourceEntityId(href, "team")) return href;
  }
  return null;
}

function teamIdentity($: ReturnType<typeof loadHtml>, row: AnyNode): { id: string; name: string } | null {
  const links = $(row).find("a[href]").toArray().flatMap((anchor) => {
    const href = $(anchor).attr("href");
    const id = href ? sourceEntityId(href, "team") : null;
    if (!id) return [];
    const name = cleanText($(anchor).text()) || cleanText($(anchor).attr("title")) || cleanText($(anchor).find("img").attr("alt"));
    return [{ id, name }];
  });
  const identified = links.find((link) => link.name.length > 0);
  return identified ? { id: identified.id, name: identified.name } : null;
}

export function parseStandingsGroupLinksHtml(html: string, sourceUrl: string): ParseReport<GroupRecord> {
  const url = validateSourceUrl(sourceUrl);
  const $ = loadHtml(html, sourceUrl);
  const issues = [] as ReturnType<typeof issue>[];
  const groups = new Map<string, GroupRecord>();
  for (const anchor of $("a[href]").toArray()) {
    const href = $(anchor).attr("href");
    const absolute = absoluteSourceUrl(url.href, href);
    if (!absolute) continue;
    const groupUrl = validateSourceUrl(absolute);
    if (!/\/standings\/?$/i.test(groupUrl.pathname) || !groupUrl.searchParams.has("poolNumber")) continue;
    const identity = groupSourceId(groupUrl);
    const label = cleanText($(anchor).text());
    if (!label) {
      issues.push(issue("error", "GROUP_LABEL_MISSING", "Tautan klasemen grup tidak memiliki label.", absolute, "group.label"));
      continue;
    }
    const parsed = groupSchema.safeParse({
      sourceId: identity.id,
      sourceUrl: groupUrl.href,
      label,
      poolNumber: identity.poolNumber
    });
    if (!parsed.success) {
      issues.push(issue("error", "GROUP_LINK_INVALID", parsed.error.message, absolute, "group"));
      continue;
    }
    groups.set(parsed.data.sourceId, parsed.data);
  }
  // IBL's unfiltered page contains the current table; round links may be empty.
  // Keep that exact source scope rather than inventing pool/phase parameters.
  if (sourceNamespace(sourceUrl) === "IBL" && !url.searchParams.has("poolNumber")) {
    const current = parseStandingsHtml(html, sourceUrl);
    if (current.status === "parsed" && current.records[0]) groups.set(current.records[0].group.sourceId, current.records[0].group);
  }
  if (groups.size === 0) throw new ParserError("Tautan grup standings tidak ditemukan", sourceUrl, "a[href*='/standings'][href*='poolNumber=']");
  return report(sourceUrl, [...groups.values()], issues);
}

export function parseStandingsHtml(html: string, sourceUrl: string): ParseReport<GroupStandingsData> {
  const url = validateSourceUrl(sourceUrl);
  const groupIdentity = groupSourceId(url);
  const $ = loadHtml(html, sourceUrl);
  const tables = $("table").toArray();
  if (tables.length === 0) throw new ParserError("Tabel klasemen tidak ditemukan", sourceUrl, "table");

  const candidateTables = tables
    .map((table) => ({ table, rows: $(table).find("tr").toArray() }))
    .filter((entry) => entry.rows.some((row) => teamHref($, row) !== null));
  if (candidateTables.length === 0) {
    const hasStandingHeaders = tables.some((table) => {
      const labels = $(table).find("th").toArray().map((cell) => normalizedHeader($(cell).text()));
      return labels.includes("TEAM") && labels.includes("GP") && labels.includes("W") && labels.includes("L");
    });
    if (hasStandingHeaders) return report<GroupStandingsData>(sourceUrl, [], [issue("error", "STANDINGS_ROWS_EMPTY", "Header klasemen tersedia, tetapi sumber belum memuat baris tim pada tab ini; klasemen tersimpan dipertahankan.", sourceUrl, "table tbody tr")]);
    throw new ParserError("Tidak ada tabel klasemen dengan tautan tim", sourceUrl, "table tr a[href*='/team/']");
  }
  candidateTables.sort((a, b) => b.rows.filter((row) => teamHref($, row)).length - a.rows.filter((row) => teamHref($, row)).length);
  const table = candidateTables[0]?.table;
  if (!table) throw new ParserError("Tabel klasemen tidak dapat dipilih", sourceUrl, "table");

  const headerRow = $(table).find("tr").toArray().find((row) => $(row).find("th").length > 0);
  const headers = headerRow
    ? $(headerRow).find("th, td").toArray().map((cell) => cleanText($(cell).attr("data-label") ?? $(cell).text()))
    : [];
  if (headers.length === 0) throw new ParserError("Header kolom klasemen tidak ditemukan", sourceUrl, "table tr th");

  const groupFallback = groupIdentity.poolNumber ? `Pool ${groupIdentity.poolNumber}` : `Group ${groupIdentity.id}`;
  const groupResult = groupSchema.safeParse({
    sourceId: groupIdentity.id,
    sourceUrl: url.href,
    label: groupLabel($, url.href, groupFallback),
    poolNumber: groupIdentity.poolNumber
  });
  if (!groupResult.success) throw new ParserError(`Record grup tidak valid: ${groupResult.error.message}`, sourceUrl, "standings heading or group tab");

  const indexes = Object.fromEntries(
    Object.entries(HEADER_ALIASES).map(([field, aliases]) => [field, headerIndex(headers, aliases)])
  ) as Record<keyof typeof HEADER_ALIASES, number>;
  const issues = [] as ReturnType<typeof issue>[];
  const records = new Map<string, StandingRowRecord>();
  for (const row of $(table).find("tr").toArray()) {
    const identity = teamIdentity($, row);
    if (!identity) {
      if (teamHref($, row)) {
      issues.push(issue("error", "STANDING_TEAM_ID_OR_NAME_MISSING", "Baris klasemen tidak memiliki ID dan nama tim yang bisa diparse.", sourceUrl, "rows.team"));
      }
      continue;
    }
    const { id: teamId, name: teamName } = identity;
    if (records.has(teamId)) continue;
    const cells = $(row).find("td, th").toArray();
    const cellText = (index: number): string | null => {
      const cell = index >= 0 ? cells[index] : undefined;
      return cell ? cleanText($(cell).text()) : null;
    };
    const getNumber = (field: keyof typeof HEADER_ALIASES): number | null => {
      const index = indexes[field];
      return nullableInteger(cellText(index));
    };
    const candidate = {
      groupSourceId: groupIdentity.id,
      teamSourceId: teamId,
      teamName,
      position: getNumber("position"),
      gamesPlayed: getNumber("gamesPlayed"),
      wins: getNumber("wins"),
      losses: getNumber("losses"),
      draws: getNumber("draws"),
      pointsFor: getNumber("pointsFor"),
      pointsAgainst: getNumber("pointsAgainst"),
      pointDifference: getNumber("pointDifference"),
      standingPoints: getNumber("standingPoints"),
      sourceUrl: url.href
    };
    const parsed = standingRowSchema.safeParse(candidate);
    if (!parsed.success) {
      issues.push(issue("error", "STANDING_ROW_INVALID", parsed.error.message, sourceUrl, `rows.${teamId}`));
      continue;
    }
    if (parsed.data.position === null) {
      issues.push(issue("warning", "STANDING_POSITION_UNAVAILABLE", "Posisi tidak tersedia dari header klasemen yang dikenal.", sourceUrl, `rows.${teamId}.position`));
    }
    records.set(teamId, parsed.data);
  }
  if (records.size === 0) throw new ParserError("Tidak ada baris klasemen valid", sourceUrl, "table tr a[href*='/team/']");
  const pageData: GroupStandingsData = { group: groupResult.data, rows: [...records.values()] };
  return report(sourceUrl, [pageData], issues);
}
