import assert from "node:assert/strict";
import test from "node:test";
import { createReadCache } from "../lib/data/read-cache";
import { REPORT_SECTIONS, reportSection, reportTabHref } from "../lib/reports/navigation";

test("cached data always rechecks authorization and isolates mutations, competition, club, filter and pagination", async () => {
  const cache = createReadCache(); let authorized = true, checks = 0, loads = 0;
  const authorize = async () => { checks++; if (!authorized) throw new Error("revoked"); };
  const load = async () => { loads++; return { clubs: [{ id: "11" }], zero: 0, missing: null, at: new Date("2026-10-29T00:00:00Z") }; };
  const read = (key: readonly unknown[]) => cache.read({ key, authorize, load });
  const key = ["club", "IBL:901", "11", { page: 1, status: "complete" }];
  const first = await read(key);first.clubs.length = 0;first.at.setUTCFullYear(2000);
  const second = await read(["club", "IBL:901", "11", { status: "complete", page: 1 }]);
  assert.equal(second.clubs.length, 1);assert.equal(second.at.getUTCFullYear(), 2026);assert.equal(second.zero, 0);assert.equal(second.missing, null);
  assert.equal(loads, 1);assert.equal(checks, 2);
  authorized = false;await assert.rejects(() => read(key), /revoked/);assert.equal(loads, 1);
  authorized = true;
  for (const changed of [["club", "901", "11", { page: 1, status: "complete" }], ["club", "IBL:901", "22", { page: 1, status: "complete" }], ["club", "IBL:901", "11", { page: 2, status: "complete" }], ["club", "IBL:901", "11", { page: 1, status: "live" }]]) await read(changed);
  assert.equal(loads, 5);
});

test("concurrent readers share one load, denied readers cannot join, and failures are retried without stale fallback", async () => {
  const cache = createReadCache();let release!: (value: { points: number }) => void, loads = 0, checks = 0;
  const authorize = async () => { checks++; };
  const load = () => { loads++;return new Promise<{ points: number }>(resolve => { release = resolve; }); };
  const first = cache.read({ key: ["same"], authorize, load });
  const second = cache.read({ key: ["same"], authorize, load });
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(() => cache.read({ key: ["same"], authorize: async () => { throw new Error("denied"); }, load }), /denied/);
  assert.equal(loads, 1);assert.equal(checks, 2);release({ points: 25 });
  const [a, b] = await Promise.all([first, second]);a.points = 99;assert.equal(b.points, 25);assert.equal(cache.stats().pending, 0);
  let failed = 0;
  const fail = () => cache.read({ key: ["failure"], authorize, load: async () => { failed++;throw new Error("database unavailable"); } });
  await assert.rejects(fail, /database unavailable/);await assert.rejects(fail, /database unavailable/);assert.equal(failed, 2);
});

test("TTL forces refresh and LRU/byte bounds prevent unbounded report caches", async () => {
  let clock = 0, loads = 0;const cache = createReadCache({ maxEntries: 2, maxBytes: 100, now: () => clock });
  const read = (id: string, value = "small") => cache.read({ key: [id], authorize: async () => undefined, ttlMs: 10, load: async () => { loads++;return value; } });
  await read("a");await read("b");await read("a");await read("c");assert.equal(cache.stats().entries, 2);
  await read("b");assert.equal(loads, 4);clock = 11;await read("b");assert.equal(loads, 5);
  await read("large", "x".repeat(101));await read("large", "x".repeat(101));assert.equal(loads, 7);assert.ok(cache.stats().bytes <= 100);
  clock = 22;
  await assert.rejects(() => cache.read({ key: ["b"], authorize: async () => undefined, load: async () => { throw new Error("refresh failed"); } }), /refresh failed/);
  assert.equal(cache.stats().entries, 0);
  await read("b");assert.equal(loads, 8);
});

test("tab URLs preserve loaded filters and repeated/invalid sections have the same safe fallback as server rendering", () => {
  const query = "player=1101&game=1001&period=2&result=made&sort=points&section=shots";
  for (const section of REPORT_SECTIONS) {
    const url = new URL(reportTabHref("/reports/club-a", query, section), "https://statsarena.example");
    assert.equal(url.pathname, "/reports/club-a");assert.equal(url.searchParams.get("section"), section);
    for (const key of ["player", "game", "period", "result", "sort"]) assert.equal(url.searchParams.get(key), new URLSearchParams(query).get(key));
    assert.equal(reportSection(section), section);
  }
  for (const invalid of [null, undefined, "unknown", "development", ["players", "shots"]]) assert.equal(reportSection(invalid), "overview");
  assert.equal(new URL(reportTabHref("/reports/club-a", "section=players&section=shots", "games"), "https://statsarena.example").searchParams.getAll("section").length, 1);
});
