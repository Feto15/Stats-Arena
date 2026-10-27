import { competitionReference, sourceNamespace } from "@statsarena/db/source";
import { load } from "cheerio";

export const LIVESTATS_HOST = "fibalivestats.dcd.shared.geniussports.com";
export const LIVESTATS_VERSION = "statsarena-livestats/1.1.0";

export function validateLiveStatsUrl(input: string): URL {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.hostname !== LIVESTATS_HOST || url.port || url.username || url.password || url.search || url.hash ||
    !/^\/(?:u\/(?:IBF|IBL)\/[1-9]\d*\/bs\.html|data\/[1-9]\d*\/data\.json)$/.test(url.pathname)) {
    throw new Error("URL LiveStats tidak diizinkan.");
  }
  return url;
}

export function liveStatsPageUrl(competitionUrl: string, matchId: string): string {
  if (!/^[1-9]\d*$/.test(matchId)) throw new Error("ID laga LiveStats tidak valid.");
  return `https://${LIVESTATS_HOST}/u/${sourceNamespace(competitionUrl)}/${matchId}/bs.html`;
}

/** A guessed page URL becomes usable only after its match/competition metadata agree. */
export function discoverLiveStatsData(html: string, pageUrl: string, competitionUrl: string, matchId: string): string {
  const page = validateLiveStatsUrl(pageUrl);
  if (page.href !== liveStatsPageUrl(competitionUrl, matchId)) throw new Error("Namespace/ID halaman LiveStats berbeda.");
  const $ = load(html);
  const reference = competitionReference(competitionUrl);
  if ($("#matchId").attr("value") !== matchId || $("#compId").attr("value") !== reference.id) {
    throw new Error("Identitas pertandingan/kompetisi LiveStats berbeda dari portal.");
  }
  const path = $("#datapath").attr("value");
  if (path !== `/data/${matchId}/`) throw new Error("Path JSON LiveStats berbeda dari pertandingan.");
  return validateLiveStatsUrl(new URL(`${path}data.json`, page).href).href;
}
