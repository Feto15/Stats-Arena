import type { AnyNode } from "domhandler";
import type { ParseReport, PlayByPlayEventRecord } from "../domain/types.js";
import { playByPlayEventSchema } from "../domain/types.js";
import { sourceEntityId, validateSourceUrl } from "../domain/source-url.js";
import { cleanText, idFromElementLink, issue, loadHtml, ParserError, report } from "./common.js";

type TeamSide = "home" | "away" | "neutral" | "unknown";

function teamIdsByPbpCode($: ReturnType<typeof loadHtml>): Map<string, { sourceId: string; side: "home" | "away" }> {
  const sides = new Map<"home" | "away", { sourceId: string; logo: string | null }>();
  for (const side of ["home", "away"] as const) {
    const wrapper = $(`.${side}-wrapper`).first();
    const anchor = wrapper.find("a[href]").toArray().find((entry) => sourceEntityId($(entry).attr("href") ?? "", "team"));
    const sourceId = anchor ? sourceEntityId($(anchor).attr("href") ?? "", "team") : null;
    const logo = cleanText(wrapper.find("img.logo").first().attr("src"));
    if (sourceId) sides.set(side, { sourceId, logo: logo ? new URL(logo, "https://hosted.dcd.shared.geniussports.com").href : null });
  }
  const result = new Map<string, { sourceId: string; side: "home" | "away" }>();
  for (const code of ["team1", "team2"]) {
    const logo = cleanText($(`.pbp-${code} img.pbp-logo`).first().attr("src"));
    if (!logo) continue;
    const absolute = new URL(logo, "https://hosted.dcd.shared.geniussports.com").href;
    for (const [side, team] of sides) {
      if (team.logo === absolute) result.set(code, { sourceId: team.sourceId, side });
    }
  }
  // A same-page logo match anchors one pbp team code to a source team URL. Because the page
  // exposes exactly one home and one away source team, the remaining code maps to the other.
  if (sides.size === 2 && result.size === 1) {
    const [knownCode, knownTeam] = [...result.entries()][0] ?? [];
    const otherCode = knownCode === "team1" ? "team2" : knownCode === "team2" ? "team1" : null;
    const otherSide = knownTeam?.side === "home" ? "away" : knownTeam?.side === "away" ? "home" : null;
    const otherTeam = otherSide ? sides.get(otherSide) : undefined;
    if (otherCode && otherSide && otherTeam) result.set(otherCode, { sourceId: otherTeam.sourceId, side: otherSide });
  }
  return result;
}

function teamSource($: ReturnType<typeof loadHtml>, event: AnyNode, sideMap: Map<string, { sourceId: string; side: "home" | "away" }>): { sourceId: string | null; side: TeamSide } {
  const team = $(event).find(".pbp-team").first();
  const classes = (team.attr("class") ?? "").split(/\s+/);
  if (classes.includes("pbp-team0")) return { sourceId: null, side: "neutral" };
  const code = classes.find((entry) => entry === "pbp-team1" || entry === "pbp-team2");
  const mapped = code ? sideMap.get(code.replace("pbp-", "")) : undefined;
  return mapped ? { sourceId: mapped.sourceId, side: mapped.side } : { sourceId: null, side: code ? "unknown" : "unknown" };
}

function scorePair(raw: string | null): [number | null, number | null] {
  const match = raw?.match(/^\s*(\d{1,3})\s*[-–—:]\s*(\d{1,3})\s*$/);
  if (!match?.[1] || !match[2]) return [null, null];
  return [Number(match[1]), Number(match[2])];
}

export function parsePlayByPlayHtml(html: string, sourceUrl: string): ParseReport<PlayByPlayEventRecord> {
  const url = validateSourceUrl(sourceUrl);
  const gameId = sourceEntityId(url.href, "match");
  if (!gameId) throw new ParserError("ID pertandingan tidak ditemukan dari URL", sourceUrl, "/match/{id}/playbyplay");
  const $ = loadHtml(html, sourceUrl);
  if (!$("#playbyplay").length) throw new ParserError("Panel Play by play tidak ditemukan", sourceUrl, "#playbyplay");
  const nodes = $("#playbyplay .pbpa").toArray();
  if (!nodes.length) throw new ParserError("Event Play by play tidak ditemukan", sourceUrl, "#playbyplay .pbpa");
  const teamMap = teamIdsByPbpCode($);
  const issues = [] as ReturnType<typeof issue>[];
  const records: PlayByPlayEventRecord[] = [];
  nodes.forEach((node, sourceSequence) => {
    const event = $(node);
    const classes = (event.attr("class") ?? "").split(/\s+/).filter(Boolean);
    const actionNode = event.find(".pbp-action").first();
    const actionText = cleanText(actionNode.text()) || null;
    const actionClass = classes.find((entry) => entry.startsWith("pbpty"));
    if (!actionClass) {
      issues.push(issue("error", "PBP_EVENT_STRUCTURE_INCOMPLETE", "Event kehilangan kelas jenis aksi; dataset lengkap tidak diganti.", sourceUrl, `events.${sourceSequence}`));
      return;
    }
    if (!actionText) issues.push(issue("info", "PBP_EVENT_TEXT_UNAVAILABLE", "Sumber menampilkan event tanpa teks aksi; kelas dan nilai mentah tetap disimpan.", sourceUrl, `events.${sourceSequence}.actionText`));
    const timeNode = event.find(".pbp-time").first();
    const periodLabelRaw = cleanText(timeNode.find(".pbp-period").first().text()) || null;
    const scoreRaw = cleanText(timeNode.find(".pbpsc").first().text()) || null;
    const timeClone = timeNode.clone();
    timeClone.find(".pbpsc, .pbp-period").remove();
    const timeRaw = cleanText(timeClone.text()) || null;
    const periodClass = classes.find((entry) => /^per_\d+$/.test(entry));
    const periodNumberText = periodClass?.match(/^per_(\d+)$/)?.[1];
    const periodNumber = periodNumberText ? Number(periodNumberText) : null;
    const periodType = classes.includes("per_ot") ? "overtime" : classes.includes("per_reg") ? "regulation" : "unknown";
    if (periodType === "unknown") issues.push(issue("warning", "PBP_PERIOD_TYPE_UNKNOWN", "Jenis periode tidak dikenali; label dan kelas sumber tetap dipertahankan.", sourceUrl, `events.${sourceSequence}.periodType`, null, classes));
    const team = teamSource($, node, teamMap);
    const actor = actionNode.find("strong").first();
    const playerNameRaw = cleanText(actor.text()) || null;
    const playerName = playerNameRaw?.replace(/^\d+\s*,\s*/, "") ?? null;
    const playerSourceId = idFromElementLink($, actionNode.get(0) ?? node, "person");
    const [team1Score, team2Score] = scorePair(scoreRaw);
    const candidate = {
      gameSourceId: gameId,
      sourceSequence,
      sourceUrl: url.href,
      periodNumber,
      periodLabelRaw,
      periodType,
      timeRaw,
      actionType: actionClass.slice("pbpty".length) || "unknown",
      actionText,
      teamSourceId: team.sourceId,
      teamSide: team.side,
      playerSourceId,
      playerName,
      scoreRaw,
      team1Score,
      team2Score,
      rawClasses: classes
    };
    const parsed = playByPlayEventSchema.safeParse(candidate);
    if (!parsed.success) {
      issues.push(issue("error", "PBP_EVENT_INVALID", `Event tidak lolos validasi: ${parsed.error.message}`, sourceUrl, `events.${sourceSequence}`));
      return;
    }
    records.push(parsed.data);
  });
  if (records.length !== nodes.length) issues.push(issue("error", "PBP_EVENTS_OMITTED", "Sebagian event tidak dapat dinormalisasi; dataset sebelumnya dipertahankan.", sourceUrl, "events", nodes.length, records.length));
  return report(url.href, records, issues);
}
