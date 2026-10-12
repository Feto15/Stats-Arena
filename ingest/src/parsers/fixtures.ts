import type { AnyNode } from "domhandler";
import type { CompetitionPageData, GameRecord, ParseReport } from "../domain/types.js";
import { competitionSchema, gameSchema } from "../domain/types.js";
import { sourceEntityId, validateSourceUrl } from "../domain/source-url.js";
import {
  absoluteSourceUrl,
  cleanText,
  issue,
  loadHtml,
  nullableInteger,
  ParserError,
  report
} from "./common.js";

const FIXTURE_CONTEXT_SELECTOR = "article, li, tr, .fixture, .fixture-card, .match-card, .match-wrap, .match, .game, .event";

function statusFor($: ReturnType<typeof loadHtml>, context: AnyNode): GameRecord["status"] {
  const nodes = [context, ...$(context).find("[data-status], [class*='status'], [class*='state']").toArray()];
  for (const node of nodes) {
    const classes = ($(node).attr("class") ?? "").toLowerCase().split(/\s+/);
    const dataStatus = ($(node).attr("data-status") ?? "").toLowerCase();
    const statusValues = [...classes, dataStatus].filter(Boolean);
    if (statusValues.some((value) => /^(?:live|in[-_]?progress|playing|active)$/.test(value) || /(?:^|_)status_(?:live|in_progress)$/.test(value))) return "live";
    if (statusValues.some((value) => /^(?:complete|completed|finished|final|played)$/.test(value) || /(?:^|_)status_(?:complete|completed|finished|final)$/.test(value))) return "complete";
    if (statusValues.some((value) => /^(?:scheduled|upcoming|fixture|not[-_]?started)$/.test(value) || /(?:^|_)status_(?:scheduled|upcoming)$/.test(value))) return "scheduled";
  }
  return "unknown";
}

function scorePair(value: string): [number, number] | null {
  const match = cleanText(value).match(/^(\d{1,3})\s*(?:-|–|—|:|vs\.?|\/|\s)\s*(\d{1,3})$/i);
  if (!match?.[1] || !match[2]) return null;
  return [Number(match[1]), Number(match[2])];
}

function findScores(
  $: ReturnType<typeof loadHtml>,
  context: AnyNode
): { home: number | null; away: number | null } {
  const explicit = $(context)
    .find("[class*='score'], [data-score], [class*='points']")
    .toArray();
  for (const node of explicit) {
    const pair = scorePair($(node).text());
    if (pair) return { home: pair[0], away: pair[1] };
  }

  const sideScores = new Map<"home" | "away", number>();
  for (const node of explicit) {
    const classes = ($(node).attr("class") ?? "").toLowerCase();
    const side = /home/.test(classes) ? "home" : /away|visitor|guest/.test(classes) ? "away" : null;
    const value = nullableInteger($(node).attr("data-score") ?? $(node).text());
    if (side && value !== null) sideScores.set(side, value);
  }
  if (sideScores.size === 2) return { home: sideScores.get("home") ?? null, away: sideScores.get("away") ?? null };

  const generic = explicit
    .map((node) => nullableInteger($(node).attr("data-score") ?? $(node).text()))
    .filter((value): value is number => value !== null);
  if (generic.length === 2) return { home: generic[0] ?? null, away: generic[1] ?? null };
  return { home: null, away: null };
}

function findTeamLinks($: ReturnType<typeof loadHtml>, context: AnyNode): Array<{
  id: string;
  name: string | null;
  side: "home" | "away" | null;
}> {
  const seen = new Set<string>();
  const result: Array<{ id: string; name: string | null; side: "home" | "away" | null }> = [];
  for (const anchor of $(context).find("a[href]").toArray()) {
    const href = $(anchor).attr("href");
    const id = href ? sourceEntityId(href, "team") : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const classes = [$(anchor).attr("class") ?? "", $(anchor).parent().attr("class") ?? ""].join(" ").toLowerCase();
    const side = /home/.test(classes) ? "home" : /away|visitor|guest/.test(classes) ? "away" : null;
    const name = cleanText($(anchor).text()) || $(anchor).find("img").attr("alt")?.trim() || null;
    result.push({ id, name: name || null, side });
  }
  return result;
}

function findDate($: ReturnType<typeof loadHtml>, context: AnyNode): string | null {
  const time = $(context).find("time[datetime]").first();
  const datetime = time.attr("datetime");
  if (datetime) return datetime.trim();
  for (const selector of [".match-time span", "time", "[data-date]", "[class*='date']", "[class*='time']"]) {
    const node = $(context).find(selector).first();
    const value = node.attr("data-date") ?? node.text();
    if (cleanText(value)) return cleanText(value);
  }
  return null;
}

function findVenue($: ReturnType<typeof loadHtml>, context: AnyNode): string | null {
  for (const selector of [".venuename", "[data-venue]", "[class*='location']"]) {
    const node = $(context).find(selector).first();
    const text = cleanText(node.attr("data-venue") ?? node.text());
    if (text) return text;
  }
  return null;
}

export function parseFixturesHtml(html: string, sourceUrl: string): ParseReport<CompetitionPageData> {
  const url = validateSourceUrl(sourceUrl);
  const competitionId = sourceEntityId(url.href, "competition");
  if (!competitionId) throw new ParserError("ID kompetisi tidak ditemukan dari URL", sourceUrl, "/competition/{id}");

  const $ = loadHtml(html);
  const selectorOption = $("#competitionChooser option").toArray().find((option) => {
    const value = $(option).attr("value");
    return value !== undefined && sourceEntityId(value, "competition") === competitionId;
  });
  const title = cleanText($(".competition-title, .competition-name, .competition-header h2").first().text()) ||
    cleanText(selectorOption ? $(selectorOption).text() : "") ||
    cleanText($("meta[property='og:title']").attr("content"));
  if (!title) throw new ParserError("Nama kompetisi tidak ditemukan", sourceUrl, ".competition-title, #competitionChooser option[value*='/competition/{id}']");

  const competitionResult = competitionSchema.safeParse({
    sourceId: competitionId,
    sourceUrl: url.href,
    name: title,
    season: null,
    year: null
  });
  if (!competitionResult.success) {
    throw new ParserError(`Record kompetisi tidak valid: ${competitionResult.error.message}`, sourceUrl, "h1");
  }

  const issues: ReturnType<typeof issue>[] = [];
  const games = new Map<string, GameRecord>();
  const matchAnchors = $(".match-wrap a[href], a[href]").toArray().filter((anchor) => {
    const href = $(anchor).attr("href");
    return href !== undefined && sourceEntityId(href, "match") !== null;
  });
  if (matchAnchors.length === 0) {
    issues.push(issue("info", "FIXTURES_EMPTY", "Halaman kompetisi valid, tetapi belum memuat pertandingan yang dapat ditautkan.", sourceUrl, "matches", null, 0));
  }

  for (const anchor of matchAnchors) {
    const href = $(anchor).attr("href");
    const matchId = href ? sourceEntityId(href, "match") : null;
    if (!href || !matchId || games.has(matchId)) continue;
    const context = $(anchor).closest(FIXTURE_CONTEXT_SELECTOR).first();
    const card = context.length ? context.get(0) : $(anchor).parent().get(0);
    if (!card) continue;
    const absolute = absoluteSourceUrl(url.href, href);
    if (!absolute) continue;
    const links = findTeamLinks($, card);
    const markedHome = links.find((entry) => entry.side === "home");
    const markedAway = links.find((entry) => entry.side === "away");
    const home = markedHome ?? links[0] ?? null;
    const away = markedAway ?? links.find((entry) => entry.id !== home?.id) ?? null;
    if (links.length < 2) {
      issues.push(issue("warning", "FIXTURE_TEAM_LINKS_MISSING", "Fixture tidak memiliki dua tautan tim; ID/nama tim dibiarkan null.", absolute, "teams", 2, links.length));
    }
    const scores = findScores($, card);
    const candidate = {
      sourceId: matchId,
      sourceUrl: absolute,
      homeTeamSourceId: home?.id ?? null,
      awayTeamSourceId: away?.id ?? null,
      homeTeamName: home?.name ?? null,
      awayTeamName: away?.name ?? null,
      homeScore: scores.home,
      awayScore: scores.away,
      scheduledAtRaw: findDate($, card),
      venue: findVenue($, card),
      status: statusFor($, card)
    };
    const parsed = gameSchema.safeParse(candidate);
    if (!parsed.success) {
      issues.push(issue("error", "FIXTURE_INVALID", parsed.error.message, absolute, "game"));
      continue;
    }
    if (parsed.data.status === "unknown") {
      issues.push(issue("warning", "FIXTURE_STATUS_UNKNOWN", "Status tidak ditemukan dari kelas atau atribut status.", absolute, "status"));
    }
    if (parsed.data.homeScore === null || parsed.data.awayScore === null) {
      const message = parsed.data.status === "scheduled"
        ? "Pertandingan belum dimulai; skor belum tersedia."
        : "Skor belum tersedia atau selector skor belum cocok.";
      issues.push(issue("info", "FIXTURE_SCORE_UNAVAILABLE", message, absolute, "score"));
    }
    games.set(matchId, parsed.data);
  }

  return report(url.href, [{ competition: competitionResult.data, games: [...games.values()], groups: [] }], issues);
}

/** Return only source-linked schedule pages for this competition, preserving their query parameters verbatim. */
export function parseFixturePageLinksHtml(html: string, sourceUrl: string): string[] {
  const current = validateSourceUrl(sourceUrl);
  const competitionId = sourceEntityId(current.href, "competition");
  if (!competitionId) throw new ParserError("ID kompetisi tidak ditemukan dari URL", sourceUrl, "/competition/{id}");
  const $ = loadHtml(html);
  const links = new Set<string>();
  for (const anchor of $("a[href]").toArray()) {
    const href = $(anchor).attr("href");
    if (!href) continue;
    const absolute = absoluteSourceUrl(current.href, href);
    if (!absolute) continue;
    const target = fixturePageUrl(absolute, competitionId);
    if (!target || target === fixturePageUrl(current.href, competitionId)) continue;
    links.add(target);
  }
  return [...links];
}

/** Checkpoints may only resume source fixture URLs for the same competition. */
export function fixturePageUrl(input: string, competitionId: string): string | null {
  try {
    const url = validateSourceUrl(input);
    if (url.username || url.password || url.port || sourceEntityId(url.href, "competition") !== competitionId) return null;
    if (!new RegExp(`^/IBF/en/competition/${competitionId}(?:/schedule)?/?$`).test(url.pathname)) return null;
    url.hash = "";
    if (!url.search) url.search = "";
    return url.href;
  } catch { return null; }
}
