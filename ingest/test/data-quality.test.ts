import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildDetailQuality, enrichQualityIssue, qualityIssueEvidence } from "@statsarena/db/data-quality";
import { parseShotChartHtml } from "../src/parsers/shot-chart.js";
import { fixtureHash, incrementalReason, type SavedGameSyncState } from "../src/domain/incremental.js";
import { PARSER_VERSION, type GameRecord } from "../src/domain/types.js";
import { parsedDataHash } from "../src/domain/content-hash.js";

const url = "https://hosted.dcd.shared.geniussports.com/IBF/en/competition/49403/match/2923393/shotchart";
const html = readFileSync(new URL("./fixtures/quality/2923393-marker.html", import.meta.url), "utf8");
const now = new Date("2026-10-13T10:00:00Z");
const fixture: GameRecord = { sourceId: "2923393", sourceUrl: url, homeTeamSourceId: "1", awayTeamSourceId: "2", homeTeamName: "Home", awayTeamName: "Away", homeScore: 63, awayScore: 6, status: "complete", scheduledAtRaw: null, venue: null };

test("real negative player marker identifies the invalid field without blaming coordinates or period", () => {
  const result = parseShotChartHtml(html, url);
  assert.equal(result.status, "partial");
  assert.equal(result.records.length, 1);
  const marker = result.issues.find((issue) => issue.code === "SHOT_MARKER_INCOMPLETE");
  assert.ok(marker);
  assert.deepEqual((marker.actual as { invalidFields: string[] }).invalidFields, ["playerSourceId"]);
  assert.equal(qualityIssueEvidence(marker), "Bagian tidak valid: ID pemain.");
  const quality = buildDetailQuality({ boxScore: "available", playByPlay: "available", shotChart: "partial" }, result.issues, now);
  assert.equal(quality.boxScore.status, "parsed");
  assert.equal(quality.playByPlay.status, "parsed");
  assert.equal(quality.shotChart.category, "source_identity_invalid");
  assert.equal(quality.shotChart.nextRetryAt, "2026-10-14T10:00:00.000Z");
  const legacy = { ...marker, actual: { title: "shot", classes: ["sc_pn-3", "sc_tn148578", "sc_per_2"], style: "top: 77%; left: 73%;" } };
  assert.deepEqual((enrichQualityIssue(legacy).actual as { invalidFields: string[] }).invalidFields, ["playerSourceId"]);
});

test("coordinate and period errors are explicit and remain partial", () => {
  const result = parseShotChartHtml(html.replace("sc_pn-3", "sc_pn123").replace("sc_per_2", "sc_per_0").replace("left: 73%;", "left: 173%;"), url);
  const marker = result.issues.find((issue) => issue.code === "SHOT_MARKER_INCOMPLETE");
  assert.ok(marker);
  assert.deepEqual((marker.actual as { invalidFields: string[] }).invalidFields, ["periodNumber", "xPercent"]);
});

test("incremental cooldown yields to fixture changes, parser upgrades, active games and manual retry", () => {
  const quality = buildDetailQuality({ shotChart: "partial" }, [{code: "SHOT_FGA_MISMATCH", severity: "error", message: "Mismatch", sourceUrl: url, fieldPath: "FGA", expected: 36, actual: 35}], now);
  const saved: SavedGameSyncState = {fixtureHash: fixtureHash(fixture), detailSyncStatus: "partial", detailParserVersion: PARSER_VERSION, detailSyncedAt: null, needsRetry: true, detailQuality: quality};
  assert.equal(incrementalReason(fixture, saved, new Set(), now), null);
  assert.equal(incrementalReason(fixture, saved, new Set(), new Date("2026-10-14T10:00:00Z")), "retry");
  assert.equal(incrementalReason(fixture, saved, new Set([url]), now), "retry");
  assert.equal(incrementalReason({...fixture, homeScore: 64}, saved, new Set(), now), "changed");
  assert.equal(incrementalReason({...fixture, status: "live"}, saved, new Set(), now), "active");
  assert.equal(incrementalReason(fixture, {...saved, detailParserVersion: "old"}, new Set(), now), "parser_changed");
  assert.equal(incrementalReason(fixture, {...saved, detailSyncStatus: "failed", detailQuality: null}, new Set(), now), "retry");
});

test("network backoff grows to one hour, resets on recovery, and never changes data fingerprints", () => {
  let quality = buildDetailQuality({ boxScore: "fetch_failed" }, [], now);
  assert.equal(quality.boxScore.category, "network");
  assert.equal(quality.boxScore.nextRetryAt, "2026-10-13T10:05:00.000Z");
  for (let i=0; i<8; i++) quality = buildDetailQuality({ boxScore: "fetch_failed" }, [], now, quality);
  assert.equal(quality.boxScore.nextRetryAt, "2026-10-13T11:00:00.000Z");
  const recovered = buildDetailQuality({boxScore: "available"}, [], now, quality);
  assert.equal(recovered.boxScore.nextRetryAt, null);
  assert.equal(recovered.boxScore.consecutiveFailures, 0);
  assert.equal(parsedDataHash({fixture,datasetQuality: quality}), parsedDataHash({fixture,datasetQuality: recovered}));
  assert.notEqual(parsedDataHash({fixture}), parsedDataHash({fixture: {...fixture, homeScore: 64}}));
  assert.equal(buildDetailQuality({shotChart: "scheduled"}, [], now).shotChart.nextRetryAt, null);
  assert.equal(buildDetailQuality({}, [], now).shotChart.status, "unavailable");
});
