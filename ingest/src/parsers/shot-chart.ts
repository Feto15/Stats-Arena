import { QUALITY_FIELD_LABELS } from "@statsarena/db/data-quality";
import type { ParseReport, ShotRecord } from "../domain/types.js";
import { shotSchema } from "../domain/types.js";
import { sourceEntityId, validateSourceUrl } from "../domain/source-url.js";
import { cleanText, issue, loadHtml, ParserError, report } from "./common.js";

function sourceToken(tokens: string[], prefix: string): string | null {
  return tokens.find((token) => new RegExp(`^${prefix}\\d+$`).test(token))?.slice(prefix.length) ?? null;
}

function styleCoordinate(style: string, property: "top" | "left"): { raw: string | null; value: number | null } {
  const raw = style.split(";").map((entry) => entry.trim()).find((entry) => entry.toLowerCase().startsWith(`${property}:`))?.slice(property.length + 1).trim() ?? null;
  if (!raw || !/^\d+(?:\.\d+)?%$/.test(raw)) return { raw, value: null };
  const value = Number(raw.slice(0, -1));
  return Number.isFinite(value) && value >= 0 && value <= 100 ? { raw, value } : { raw, value: null };
}

export function parseShotChartHtml(html: string, sourceUrl: string): ParseReport<ShotRecord> {
  const url = validateSourceUrl(sourceUrl);
  const gameId = sourceEntityId(url.href, "match");
  if (!gameId) throw new ParserError("ID pertandingan tidak ditemukan dari URL", sourceUrl, "/match/{id}/shotchart");
  const $ = loadHtml(html, sourceUrl);
  if (!$("#shotchart").length) throw new ParserError("Panel Shot chart tidak ditemukan", sourceUrl, "#shotchart");
  const markers = $("#shotchart .sc_img").toArray();
  if (!markers.length) throw new ParserError("Marker Shot chart tidak ditemukan", sourceUrl, "#shotchart .sc_img");
  const records: ShotRecord[] = [];
  const issues = [] as ReturnType<typeof issue>[];
  const teamNames = new Map<string, string>();
  $("#shotchart a[onclick]").each((_, anchor) => {
    const token = /sc_tn(\d+)/.exec($(anchor).attr("onclick") ?? "")?.[1];
    const name = cleanText($(anchor).text());
    if (token && name) teamNames.set(token, name);
  });
  markers.forEach((node, sourceSequence) => {
    const marker = $(node);
    const title = cleanText(marker.attr("title"));
    const type = /(?:^|[\s,])(2pt|3pt)(?=$|[\s,])/i.exec(title)?.[1]?.toLowerCase();
    // Genius places fouls and turnovers in the same visual layer. Only explicit 2PT/3PT actions are shots.
    if (!type) return;
    const classes = (marker.attr("class") ?? "").split(/\s+/).filter(Boolean);
    const result = classes.includes("white_made") || classes.includes("black_made") ? "made"
      : classes.includes("white_missed") || classes.includes("black_missed") ? "missed" : null;
    const teamSourceId = sourceToken(classes, "sc_tn");
    const playerSourceId = sourceToken(classes, "sc_pn");
    const periodText = sourceToken(classes, "sc_per_");
    const periodNumber = periodText ? Number(periodText) : null;
    const x = styleCoordinate(marker.attr("style") ?? "", "left");
    const y = styleCoordinate(marker.attr("style") ?? "", "top");
    const invalidFields = [
      ...(!result ? ["result"] : []), ...(!teamSourceId ? ["teamSourceId"] : []),
      ...(!playerSourceId ? ["playerSourceId"] : []),
      ...(periodNumber === null || periodNumber < 1 ? ["periodNumber"] : []),
      ...(x.value === null ? ["xPercent"] : []), ...(y.value === null ? ["yPercent"] : [])
    ];
    if (invalidFields.length || !teamSourceId || !playerSourceId) {
      issues.push(issue("error", "SHOT_MARKER_INCOMPLETE", `Marker 2PT/3PT memiliki field hilang/tidak valid: ${invalidFields.map((field) => QUALITY_FIELD_LABELS[field] ?? field).join(", ")}; dataset sebelumnya dipertahankan.`, sourceUrl, `markers.${sourceSequence}`, null, { title, classes, style: marker.attr("style") ?? null, invalidFields }));
      return;
    }
    const shotTypeIndex = title.toLowerCase().indexOf(type);
    const rawIdentity = shotTypeIndex >= 0 ? title.slice(0, shotTypeIndex).replace(/[,\s]+$/, "").trim() : "";
    const playerName = rawIdentity.replace(/^\d+\s*,\s*/, "").trim() || null;
    const candidate = {
      gameSourceId: gameId,
      sourceSequence,
      sourceUrl: url.href,
      periodNumber,
      teamSourceId,
      teamName: teamNames.get(teamSourceId) ?? null,
      playerSourceId,
      playerName,
      shotType: type,
      result,
      xRaw: x.raw ?? "",
      yRaw: y.raw ?? "",
      xPercent: x.value,
      yPercent: y.value,
      rawTitle: title,
      rawClasses: classes
    };
    const parsed = shotSchema.safeParse(candidate);
    if (!parsed.success) {
      issues.push(issue("error", "SHOT_MARKER_INVALID", `Marker tidak lolos validasi: ${parsed.error.message}`, sourceUrl, `markers.${sourceSequence}`));
      return;
    }
    records.push(parsed.data);
  });
  if (!records.length) issues.push(issue("error", "SHOT_MARKERS_NO_ATTEMPTS", "Panel tidak memiliki marker 2PT/3PT yang dapat dibaca.", sourceUrl, "#shotchart .sc_img"));
  return report(url.href, records, issues);
}
