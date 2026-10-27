import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ClubMethodology } from "../components/reports/club-methodology";
import { localClubReport } from "../lib/reports/local-competition";

test("methodology, snapshot and provenance render only for admin and are absent from staff HTML", () => {
  const bundle = localClubReport("kesatria-bengawan-solo")!;
  const props = { report: bundle.report, date: "25 Oktober 2026 pukul 21.08", fixturesCount: bundle.fixtures.length };
  assert.equal(renderToStaticMarkup(createElement(ClubMethodology, { ...props, isAdmin: false })), "");
  const admin = renderToStaticMarkup(createElement(ClubMethodology, { ...props, isAdmin: true }));
  assert.match(admin, /Cakupan jelas\. Angka bisa ditelusuri\./);
  assert.match(admin, /Snapshot 25 Oktober 2026 pukul 21\.08 WIB/);
  assert.ok(admin.includes(bundle.report.games[0]!.provenance.resources[0]!.sha256));
});
