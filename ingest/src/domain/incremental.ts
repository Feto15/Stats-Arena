import { qualityRetryDue, type DetailQuality } from "@statsarena/db/data-quality";
import { createHash } from "node:crypto";
import { PARSER_VERSION, type GameRecord, type ParseStatus } from "./types.js";
import { sourceEntityId, sameCompetition } from "./source-url.js";

export interface SavedGameSyncState {
  fixtureHash: string | null;
  detailSyncStatus: ParseStatus;
  detailParserVersion: string | null;
  detailSyncedAt: Date | null;
  needsRetry: boolean;
  detailQuality?: DetailQuality | null;
}

export type IncrementalReason = "new" | "changed" | "active" | "unverified" | "retry" | "parser_changed";

/** Compare fixture observations, not the richer fields merged from summary. */
export function fixtureHash(fixture: GameRecord): string {
  const url = new URL(fixture.sourceUrl);
  const matchUrl = `${url.origin}${url.pathname.replace(/\/(?:preview|summary|boxscore)\/?$/, "")}${url.search}`;
  return createHash("sha256").update(JSON.stringify([
    fixture.sourceId, matchUrl, fixture.homeTeamSourceId, fixture.awayTeamSourceId,
    fixture.homeScore, fixture.awayScore, fixture.status, fixture.scheduledAtRaw, fixture.venue
  ])).digest("hex");
}

export function incrementalReason(
  fixture: GameRecord, saved: SavedGameSyncState | undefined, forceRefreshUrls: ReadonlySet<string>, now = new Date()
): IncrementalReason | null {
  if (!saved) return "new";
  if (fixture.status === "live" || fixture.status === "unknown") return "active";
  if ([...forceRefreshUrls].some((url) => sourceEntityId(url, "match") === fixture.sourceId &&
    sameCompetition(url, fixture.sourceUrl))) return "retry";
  // Old imports have no fixture observation yet. Reuse valid cache for this bootstrap.
  if (saved.fixtureHash === null) return "unverified";
  if (saved.fixtureHash !== fixtureHash(fixture)) return "changed";
  if (saved.detailParserVersion !== PARSER_VERSION) return "parser_changed";
  if (saved.needsRetry || saved.detailSyncStatus !== "parsed") {
    if (saved.detailQuality && Object.values(saved.detailQuality).some((state) => state.category !== null)) {
      return qualityRetryDue(saved.detailQuality, now) ? "retry" : null;
    }
    return "retry";
  }
  if (fixture.status === "complete" && saved.detailSyncedAt === null) return "unverified";
  return null;
}
