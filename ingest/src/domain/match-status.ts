import type { MatchImportData } from "./types.js";

export type MatchDataStatus = "scheduled" | "ready" | "fetch_failed" | "boxscore_partial" | "parse_failed" | "unavailable";

export function matchDataStatus(match: MatchImportData): MatchDataStatus {
  const pages = match.availability;
  if (pages?.summary === "fetch_failed" || pages?.boxScore === "fetch_failed" || match.issues.some((entry) => entry.code === "FETCH_FAILED")) return "fetch_failed";
  if (pages?.boxScore === "partial" || match.issues.some((entry) => entry.severity === "error" && entry.code.startsWith("BOXSCORE_"))) return "boxscore_partial";
  if (pages?.summary === "parse_failed" || pages?.boxScore === "parse_failed" || match.issues.some((entry) => entry.code === "PARSE_FAILED" || entry.code === "MATCH_URL_INVALID")) return "parse_failed";
  if (match.fixture.status === "scheduled" && !match.boxScore && !match.summary) return "scheduled";
  return match.boxScore ? "ready" : "unavailable";
}
