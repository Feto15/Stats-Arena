import type { AnyNode } from "domhandler";
import type { ParseReport, TeamRecord } from "../domain/types.js";
import { teamSchema } from "../domain/types.js";
import { sourceEntityId } from "../domain/source-url.js";
import { absoluteSourceUrl, cleanText, idFromElementLink, issue, loadHtml, ParserError, report } from "./common.js";

export function parseTeamsHtml(html: string, sourceUrl: string): ParseReport<TeamRecord> {
  const $ = loadHtml(html);
  const blocks = $(".team-link").toArray();
  if (blocks.length === 0) throw new ParserError("Blok tim tidak ditemukan", sourceUrl, ".team-link");

  const issues = [] as ReturnType<typeof issue>[];
  const records = new Map<string, TeamRecord>();
  for (const block of blocks) {
    const teamId = idFromElementLink($, block, "team");
    if (!teamId || records.has(teamId)) continue;
    const sourceHref = findEntityHref($, block, "team");
    const recordUrl = absoluteSourceUrl(sourceUrl, sourceHref);
    if (!recordUrl) {
      issues.push(issue("error", "TEAM_URL_MISSING", "Tautan sumber tim tidak ditemukan.", sourceUrl, `teams.${teamId}.sourceUrl`));
      continue;
    }
    const nameText = cleanText($(block).find(".team-name, [class*='name']").first().text()) ||
      cleanText($(block).text()) ||
      cleanText($(block).find("img[alt]").first().attr("alt"));
    const image = $(block).find("img[src], img[data-src]").first();
    const logoHref = image.attr("src") ?? image.attr("data-src") ?? null;
    const logoUrl = absoluteSourceUrl(sourceUrl, logoHref);
    const parsed = teamSchema.safeParse({ sourceId: teamId, sourceUrl: recordUrl, name: nameText, logoUrl });
    if (!parsed.success) {
      issues.push(issue("error", "TEAM_INVALID", parsed.error.message, recordUrl, `teams.${teamId}`));
      continue;
    }
    records.set(teamId, parsed.data);
  }
  if (records.size === 0) throw new ParserError("Tidak ada record tim yang valid", sourceUrl, ".team-link a[href*='/team/']");
  return report(sourceUrl, [...records.values()], issues);
}

function findEntityHref($: ReturnType<typeof loadHtml>, block: AnyNode, kind: "team"): string | null {
  const own = $(block).attr("href");
  if (own && idFromHref(own, kind)) return own;
  for (const anchor of $(block).find("a[href]").toArray()) {
    const href = $(anchor).attr("href");
    if (href && idFromHref(href, kind)) return href;
  }
  return null;
}

function idFromHref(href: string, kind: "team"): string | null {
  return sourceEntityId(href, kind);
}
