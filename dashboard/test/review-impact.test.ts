import assert from "node:assert/strict";
import test from "node:test";
import { describeReviewImpact } from "../lib/data/review-impact.js";

test("LiveStats impact distinguishes player, team, game and field acceptance rules", () => {
  const describe = (code: string) => describeReviewImpact({ source: "livestats", code });
  assert.equal(describe("LIVESTATS_PLAYER_MAPPING_MISMATCH").scope, "Pemain tertentu");
  assert.equal(describe("LIVESTATS_TEAM_MISMATCH").scope, "Satu tim dan pemainnya");
  assert.equal(describe("LIVESTATS_ROSTER_MISMATCH").scope, "Sebagian roster");
  assert.equal(describe("LIVESTATS_STARTER_COUNT").scope, "Kelengkapan starter");
  assert.match(describe("LIVESTATS_STARTER_COUNT").description, /bukan berarti seluruh statistik/);
  assert.equal(describe("LIVESTATS_STARTER_MISSING").scope, "Status starter pemain");
  for (const code of ["LIVESTATS_SCORE_MISMATCH", "LIVESTATS_PORTAL_INCOMPLETE"]) {
    assert.equal(describe(code).scope, "Seluruh tambahan laga");
    assert.match(describe(code).description, /bila ada/);
    assert.match(describe(code).description, /portal tidak diganti/);
  }
  assert.equal(describe("LIVESTATS_FIELD_INVALID").scope, "Kolom tambahan tertentu");
  assert.match(describe("LIVESTATS_OPTIONAL_FIELDS_RETAINED").description, /lebih lama/);
  assert.match(describe("LIVESTATS_OFFICIAL_METRIC_CONFLICT").description, /dipisahkan/);
  assert.match(describe("LIVESTATS_TRANSACTION_FAILED").description, /belum tersimpan/);
  for (const status of ["fetch_failed", "parse_failed", "unavailable", "mismatch"]) {
    assert.equal(describeReviewImpact({ source: "livestats", code: "UNKNOWN", status }).scope, "Pembaruan tambahan laga");
  }
  assert.equal(describe("UNKNOWN").scope, "Tambahan LiveStats");
});

test("portal impact follows dataset context without confusing missing action text with lost events", () => {
  const describe = (code: string, sourceUrl?: string) => describeReviewImpact({ source: "portal", code, sourceUrl: sourceUrl ?? null });
  assert.equal(describe("SHOT_FGA_MISMATCH").scope, "Peta tembakan");
  assert.equal(describe("BOXSCORE_PLAYER_POINTS_INCOMPLETE").scope, "Box score");
  assert.equal(describe("SUMMARY_BOXSCORE_SCORE_MISMATCH").scope, "Box score");
  assert.equal(describe("FETCH_FAILED", "https://hosted.dcd.shared.geniussports.com/IBF/en/competition/1/match/2/playbyplay").scope, "Kronologi pertandingan");
  assert.equal(describe("PARSE_FAILED", "https://hosted.dcd.shared.geniussports.com/IBF/en/competition/1/match/2/analysis").scope, "Metrik analisis tim");
  assert.equal(describe("SUMMARY_INVALID").scope, "Ringkasan pertandingan");
  assert.equal(describe("PBP_EVENT_TEXT_UNAVAILABLE").scope, "Keterangan peristiwa");
  assert.match(describe("PBP_EVENT_TEXT_UNAVAILABLE").description, /tidak otomatis dihapus/);
  assert.equal(describe("STANDINGS_ROWS_EMPTY").scope, "Klasemen kompetisi");
  assert.equal(describe("FETCH_FAILED", "https://hosted.dcd.shared.geniussports.com/IBF/en/competition/1/standings").scope, "Klasemen kompetisi");
  assert.equal(describe("TEAM_STATISTICS_GP_UNAVAILABLE").scope, "Cakupan statistik tim");
  assert.equal(describe("TEAM_STATISTICS_INVALID").scope, "Statistik agregat tim");
  assert.equal(describe("MATCH_DETAIL_TAB_UNAVAILABLE").scope, "Ketersediaan halaman rinci");
  assert.equal(describe("NEW_CODE", "invalid-url").scope, "Data pada halaman terkait");
});
