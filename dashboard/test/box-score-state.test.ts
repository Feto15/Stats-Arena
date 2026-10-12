import assert from "node:assert/strict";
import test from "node:test";
import { boxScoreStateMessage } from "../lib/data/box-score-state.js";

test("box score state distinguishes scheduled, failed, partial, preserved, and complete data", () => {
  assert.match(boxScoreStateMessage({ gameStatus: "scheduled", hasStoredStats: false, fetchStatus: null, parseStatus: null }) ?? "", /belum berjalan/);
  assert.match(boxScoreStateMessage({ gameStatus: "complete", hasStoredStats: true, fetchStatus: "failed", parseStatus: "failed" }) ?? "", /valid terakhir.*tetap ditampilkan/);
  assert.match(boxScoreStateMessage({ gameStatus: "complete", hasStoredStats: false, fetchStatus: "failed", parseStatus: "failed" }) ?? "", /belum ada statistik valid/);
  assert.match(boxScoreStateMessage({ gameStatus: "complete", hasStoredStats: true, fetchStatus: "succeeded", parseStatus: "partial" }) ?? "", /parsial/);
  assert.equal(boxScoreStateMessage({ gameStatus: "complete", hasStoredStats: true, fetchStatus: "succeeded", parseStatus: "parsed" }), null);
});
