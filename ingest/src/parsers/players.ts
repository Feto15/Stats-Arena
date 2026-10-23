import type { AnyNode } from "domhandler";
import type { ParseReport, PlayerRecord } from "../domain/types.js";
import { playerSchema } from "../domain/types.js";
import { sourceEntityId as sourceIdFromUrl } from "../domain/source-url.js";
import { absoluteSourceUrl, cleanText, idFromElementLink, issue, loadHtml, ParserError, report } from "./common.js";

export function parsePlayersHtml(html: string, sourceUrl: string): ParseReport<PlayerRecord> {
  const $ = loadHtml(html, sourceUrl);
  const blocks = $(".playerblock").toArray();
  if (blocks.length === 0) throw new ParserError("Blok pemain tidak ditemukan", sourceUrl, ".playerblock");

  const issues = [] as ReturnType<typeof issue>[];
  const records = new Map<string, PlayerRecord>();
  for (const block of blocks) {
    const playerId = idFromElementLink($, block, "person");
    if (!playerId || records.has(playerId)) continue;
    const href = entityHref($, block);
    const recordUrl = absoluteSourceUrl(sourceUrl, href);
    if (!recordUrl) {
      issues.push(issue("error", "PLAYER_URL_MISSING", "Tautan sumber pemain tidak ditemukan.", sourceUrl, `players.${playerId}.sourceUrl`));
      continue;
    }
    const name = cleanText($(block).find(".player-name, [class*='name']").first().text()) ||
      cleanText($(block).find("a[href]").first().text()) ||
      cleanText($(block).text());
    const parsed = playerSchema.safeParse({ sourceId: playerId, sourceUrl: recordUrl, name });
    if (!parsed.success) {
      issues.push(issue("error", "PLAYER_INVALID", parsed.error.message, recordUrl, `players.${playerId}`));
      continue;
    }
    records.set(playerId, parsed.data);
  }
  if (records.size === 0) throw new ParserError("Tidak ada record pemain yang valid", sourceUrl, ".playerblock a[href*='/person/']");
  return report(sourceUrl, [...records.values()], issues);
}

function entityHref($: ReturnType<typeof loadHtml>, block: AnyNode): string | null {
  const own = $(block).attr("href");
  if (own && sourceEntityId(own)) return own;
  for (const anchor of $(block).find("a[href]").toArray()) {
    const href = $(anchor).attr("href");
    if (href && sourceEntityId(href)) return href;
  }
  return null;
}

function sourceEntityId(href: string): string | null {
  return sourceIdFromUrl(href, "person");
}
