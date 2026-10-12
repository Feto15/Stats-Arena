import type { AnyNode } from "domhandler";
import type { ParseReport, SummaryRecord } from "../domain/types.js";
import { summarySchema } from "../domain/types.js";
import { sourceEntityId, validateSourceUrl } from "../domain/source-url.js";
import { cleanText, issue, loadHtml, nullableInteger, ParserError, report } from "./common.js";

function classStatus($: ReturnType<typeof loadHtml>): SummaryRecord["status"] {
  for (const node of $("[data-status], [class*='status'], [class*='state']").toArray()) {
    const value = `${$(node).attr("data-status") ?? ""} ${$(node).attr("class") ?? ""}`.toLowerCase();
    const classes = ($(node).attr("class") ?? "").toLowerCase().split(/\s+/);
    if (classes.includes("notlive")) {
      const visible = cleanText($(node).text()).toLowerCase();
      if (/\b(complete|completed|finished|final)\b/.test(visible)) return "complete";
      if (/\b(scheduled|upcoming)\b/.test(visible)) return "scheduled";
    }
    if (/(?:^|[\s_-])(?:live|in-progress|playing)(?:$|[\s_-])/.test(value)) return "live";
    if (/(?:^|[\s_-])(?:complete|completed|finished|final|played)(?:$|[\s_-])/.test(value)) return "complete";
    if (/(?:^|[\s_-])(?:scheduled|upcoming|fixture|not-started)(?:$|[\s_-])/.test(value)) return "scheduled";
  }
  return "unknown";
}

function pageTeamLinks($: ReturnType<typeof loadHtml>): Array<{ id: string; name: string; side: "home" | "away" | null }> {
  const rows: Array<{ id: string; name: string; side: "home" | "away" | null }> = [];
  const seen = new Set<string>();
  for (const anchor of $("a[href]").toArray()) {
    const href = $(anchor).attr("href");
    const id = href ? sourceEntityId(href, "team") : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const classes = `${$(anchor).attr("class") ?? ""} ${$(anchor).parent().attr("class") ?? ""} ${$(anchor).closest(".home-wrapper, .away-wrapper").attr("class") ?? ""}`.toLowerCase();
    const name = cleanText($(anchor).text()) || cleanText($(anchor).find("img").attr("alt"));
    if (name) rows.push({ id, name, side: /home/.test(classes) ? "home" : /away|visitor/.test(classes) ? "away" : null });
  }
  return rows;
}

function scoreFor($: ReturnType<typeof loadHtml>, nodes: AnyNode[]): number | null {
  for (const node of nodes) {
    const value = cleanText($(node).attr("data-score") ?? $(node).text());
    const number = nullableInteger(value);
    if (number !== null) return number;
  }
  return null;
}

function rawScheduledTime($: ReturnType<typeof loadHtml>): string | null {
  const datetime = $("time[datetime]").first().attr("datetime");
  if (datetime) return datetime.trim();
  for (const selector of [".match-time span", "time", "[class*='date']", "[class*='time']"]) {
    const value = cleanText($(selector).first().text());
    if (value) return value;
  }
  return null;
}

function venue($: ReturnType<typeof loadHtml>): string | null {
  for (const selector of ["[class*='venue']", "[class*='location']", "[data-venue]"]) {
    const node = $(selector).first();
    const value = cleanText(node.attr("data-venue") ?? node.text());
    if (value) return value;
  }
  return null;
}

export function parseSummaryHtml(html: string, sourceUrl: string): ParseReport<SummaryRecord> {
  const url = validateSourceUrl(sourceUrl);
  const gameId = sourceEntityId(url.href, "match");
  if (!gameId) throw new ParserError("ID pertandingan tidak ditemukan dari URL", sourceUrl, "/match/{id}/summary");
  const $ = loadHtml(html);
  const teams = pageTeamLinks($);
  if (teams.length < 2) {
    throw new ParserError("Dua tautan tim tidak ditemukan pada summary", sourceUrl, "a[href*='/team/']");
  }
  const home = teams.find((team) => team.side === "home") ?? teams[0];
  const away = teams.find((team) => team.side === "away") ?? teams.find((team) => team.id !== home?.id);
  if (!home || !away) throw new ParserError("Tim home/away tidak dapat dipasangkan", sourceUrl, "a[href*='/team/']");

  const scoreNodes = $("[class*='score'], [data-score], [class*='points']").toArray();
  const homeNode = scoreNodes.filter((node) => /home/.test(($(node).attr("class") ?? "").toLowerCase()));
  const awayNode = scoreNodes.filter((node) => /away|visitor|guest/.test(($(node).attr("class") ?? "").toLowerCase()));
  let homeScore = scoreFor($, homeNode);
  let awayScore = scoreFor($, awayNode);
  if (homeScore === null || awayScore === null) {
    const pair = scoreNodes.map((node) => cleanText($(node).text())).find((value) => /^\d{1,3}\s*(?:-|–|—|:)\s*\d{1,3}$/.test(value));
    const parsedPair = pair?.match(/^(\d{1,3})\s*(?:-|–|—|:)\s*(\d{1,3})$/);
    if (parsedPair?.[1] && parsedPair[2]) {
      homeScore = Number(parsedPair[1]);
      awayScore = Number(parsedPair[2]);
    }
  }
  if ((homeScore === null || awayScore === null) && scoreNodes.length >= 2) {
    const firstScoreNode = scoreNodes[0];
    const secondScoreNode = scoreNodes[1];
    if (firstScoreNode) homeScore ??= scoreFor($, [firstScoreNode]);
    if (secondScoreNode) awayScore ??= scoreFor($, [secondScoreNode]);
  }

  const candidate = {
    sourceId: gameId,
    sourceUrl: url.href,
    homeTeamSourceId: home.id,
    awayTeamSourceId: away.id,
    homeTeamName: home.name,
    awayTeamName: away.name,
    homeScore,
    awayScore,
    scheduledAtRaw: rawScheduledTime($),
    venue: venue($),
    status: classStatus($),
    summaryText: cleanText($(".summary-text, [data-summary]").first().text()) || null
  };
  const parsed = summarySchema.safeParse(candidate);
  if (!parsed.success) throw new ParserError(`Summary tidak valid: ${parsed.error.message}`, sourceUrl, "summary header");

  const issues = [] as ReturnType<typeof issue>[];
  if (parsed.data.status === "unknown") {
    issues.push(issue("warning", "SUMMARY_STATUS_UNKNOWN", "Status pertandingan tidak ditemukan dari kelas/atribut status.", sourceUrl, "status"));
  }
  if (parsed.data.homeScore === null || parsed.data.awayScore === null) {
    issues.push(issue("warning", "SUMMARY_SCORE_UNAVAILABLE", "Skor summary tidak tersedia pada markup yang dikenal.", sourceUrl, "score"));
  }
  return report(sourceUrl, [parsed.data], issues);
}
