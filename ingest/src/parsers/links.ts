import type { MatchDetailTabLinks, ParseReport } from "../domain/types.js";
import { matchDetailTabLinksSchema } from "../domain/types.js";
import { sourceEntityId, validateSourceUrl } from "../domain/source-url.js";
import { cleanText, issue, loadHtml, ParserError, report } from "./common.js";

const matchTabs = ["summary", "boxscore", "playbyplay", "shotchart", "analysis"] as const;

function safeTabUrl(href: string | null | undefined, sourceUrl: string, gameId: string, tab: typeof matchTabs[number]): string | null {
  if (!href) return null;
  try {
    const value = validateSourceUrl(new URL(href, sourceUrl).href);
    const actualGameId = sourceEntityId(value.href, "match");
    const expectedPath = new URL(sourceUrl).pathname.match(/^(.*\/match\/\d+)/)?.[1];
    const actualPath = value.pathname.match(/^(.*\/match\/\d+)(?:\/[^/]+)?\/?$/)?.[1];
    if (actualGameId !== gameId || !expectedPath || actualPath !== expectedPath || !value.pathname.endsWith(`/${tab}`)) return null;
    return value.href;
  } catch {
    return null;
  }
}

export function parseMatchDetailTabLinksHtml(html: string, sourceUrl: string): ParseReport<MatchDetailTabLinks> {
  const url = validateSourceUrl(sourceUrl);
  const gameId = sourceEntityId(url.href, "match");
  if (!gameId) throw new ParserError("ID pertandingan tidak ditemukan dari URL tab", sourceUrl, "/match/{id}/{tab}");
  const $ = loadHtml(html);
  const links = new Map<string, string>();
  for (const anchor of $("a.menuoption[href]").toArray()) {
    const href = $(anchor).attr("href");
    if (!href) continue;
    for (const tab of matchTabs) {
      const safe = safeTabUrl(href, url.href, gameId, tab);
      if (safe) links.set(tab, safe);
    }
  }
  if (!links.has("summary") || !links.has("boxscore")) {
    throw new ParserError("Tab inti pertandingan tidak ditemukan pada navigasi sumber", sourceUrl, "a.menuoption[href*='/match/{id}/']");
  }
  const candidate = {
    gameSourceId: gameId,
    summary: links.get("summary") ?? null,
    boxScore: links.get("boxscore") ?? null,
    playByPlay: links.get("playbyplay") ?? null,
    shotChart: links.get("shotchart") ?? null,
    analysis: links.get("analysis") ?? null
  };
  const parsed = matchDetailTabLinksSchema.safeParse(candidate);
  if (!parsed.success) throw new ParserError(`Tautan tab pertandingan tidak valid: ${parsed.error.message}`, sourceUrl, "a.menuoption[href]");
  const issues = [] as ReturnType<typeof issue>[];
  for (const [key, label] of [["playbyplay", "Play by play"], ["shotchart", "Shot chart"], ["analysis", "Team Analysis"]] as const) {
    if (!links.has(key)) issues.push(issue("warning", "MATCH_DETAIL_TAB_UNAVAILABLE", `Tautan ${label} tidak tersedia pada navigasi pertandingan sumber.`, sourceUrl, `tabs.${key}`));
  }
  return report(sourceUrl, [parsed.data], issues);
}

export interface CompetitionStatisticsLink {
  sourceUrl: string;
}

export function parseCompetitionStatisticsLinkHtml(html: string, sourceUrl: string): ParseReport<CompetitionStatisticsLink> {
  const url = validateSourceUrl(sourceUrl);
  const competitionId = sourceEntityId(url.href, "competition");
  if (!competitionId) throw new ParserError("ID kompetisi tidak ditemukan dari URL fixtures", sourceUrl, "/competition/{id}");
  const $ = loadHtml(html);
  let found: string | null = null;
  for (const anchor of $("a[href]").toArray()) {
    const href = $(anchor).attr("href");
    if (!href || !/\bstatistics\b/i.test(cleanText($(anchor).text()))) continue;
    try {
      const candidate = validateSourceUrl(new URL(href, url).href);
      const candidateCompetitionId = sourceEntityId(candidate.href, "competition");
      if (candidateCompetitionId !== competitionId || !candidate.pathname.endsWith("/statistics/team")) continue;
      found = candidate.href;
      break;
    } catch {
      continue;
    }
  }
  if (!found) throw new ParserError("Tautan Team Statistics tidak ditemukan pada navigasi kompetisi", sourceUrl, "a[href*='/statistics/team']");
  return report(sourceUrl, [{ sourceUrl: found }], []);
}
