import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { BASE_STAT_FIELDS, METRICS, calculateMetric, calculateMetrics, contextualInputs, sumStats, type MetricInputs, type MetricName, type Stats } from "@statsarena/db/analytics";
import { metricSql } from "@statsarena/db/analytics-sql";

const stats: Stats = { minutes: 20, points: 13, fieldGoalsMade: 4, fieldGoalsAttempted: 8, twoPointsMade: 2, twoPointAttempts: 4,
  threePointsMade: 2, threePointAttempts: 4, freeThrowsMade: 3, freeThrowAttempts: 4, offensiveRebounds: 2, defensiveRebounds: 3,
  rebounds: 5, assists: 3, steals: 1, blocks: 1, turnovers: 2, personalFouls: 3 };
const close = (actual: number | null, expected: number) => { assert.notEqual(actual, null); assert.ok(Math.abs(actual! - expected) < 1e-9, `${actual} vs ${expected}`); };

test("analytics uses totals, unrounded minutes, safe division, and explicit missing/invalid reasons", () => {
  close(calculateMetric("trueShootingPercentage", { points: 78, fieldGoalsAttempted: 59, freeThrowAttempts: 15 }).value, 7800 / 131.2);
  close(calculateMetric("effectiveFieldGoalPercentage", stats).value, 62.5);
  close(calculateMetric("efficiencyPerGame", { ...stats, gamesPlayed: 1 }).value, 16);
  close(calculateMetric("gameScore", stats).value, 11.5);
  close(calculateMetric("pointsPer40", { ...stats, minutes: 7 + 34 / 60 }).value, 13 * 40 / (7 + 34 / 60));
  assert.deepEqual(calculateMetric("assistTurnoverRatio", { assists: 0, turnovers: 0 }), { value: null, reason: "nonpositive_denominator" });
  assert.deepEqual(calculateMetric("trueShootingPercentage", { points: 0, fieldGoalsAttempted: 1 }), { value: null, reason: "missing_input" });
  assert.equal(calculateMetric("threePointAttemptRate", { threePointAttempts: 0, fieldGoalsAttempted: 10 }).value, 0);
  assert.equal(calculateMetric("pointsPer40", { points: 10, minutes: Number.NaN }).reason, "invalid_input");
  assert.equal(calculateMetric("pointsPer40", { points: -1, minutes: 10 }).reason, "invalid_input");
  const totals = sumStats([stats, { ...stats, fieldGoalsAttempted: 4, points: 9, freeThrowAttempts: 2 }]);
  close(calculateMetrics({ ...totals, gamesPlayed: 2 }).advancedStats.trueShootingPercentage ?? null, 2200 / (2 * (12 + .44 * 6)));
  assert.equal(sumStats([stats, { ...stats, freeThrowAttempts: null }]).freeThrowAttempts, null);
  assert.equal(calculateMetric("usagePercentage", stats).reason, "missing_input");
});

test("team ratings share averaged estimated possessions; individual context is limited to matched games", () => {
  const team = sumStats([{ ...stats, minutes: 200, points: 70, fieldGoalsAttempted: 60, freeThrowAttempts: 20, offensiveRebounds: 10, turnovers: 12 }]);
  const opponent = sumStats([{ ...team, points: 60, fieldGoalsAttempted: 55, freeThrowAttempts: 10, offensiveRebounds: 5, turnovers: 15 }]);
  const inputs = contextualInputs(team, 1, team, opponent);
  const possessions = ((60 + .44 * 20 - 10 + 12) + (55 + .44 * 10 - 5 + 15)) / 2;
  close(calculateMetric("estimatedPossessions", inputs).value, possessions);
  close(calculateMetric("offensiveRating", inputs).value, 7000 / possessions);
  close(calculateMetric("defensiveRating", inputs).value, 6000 / possessions);
  close(calculateMetric("netRating", inputs).value, 1000 / possessions);
  close(calculateMetric("usagePercentage", contextualInputs(stats, 1, team, opponent)).value, 100 * (8 + .44 * 4 + 2) * 40 / (20 * (60 + .44 * 20 + 12)));
});

test("PostgreSQL and JSON evaluate all shared formulas identically, including incomplete and zero inputs", async () => {
  const client = new PGlite();
  try {
    const team = sumStats([{ ...stats, minutes: 200, points: 70 }]);
    const examples: MetricInputs[] = [contextualInputs(stats, 1, team, team), { ...stats, freeThrowAttempts: null, gamesPlayed: 1 },
      Object.fromEntries(BASE_STAT_FIELDS.map(key => [key, 0])), {}];
    for (const input of examples) {
      const fields = Object.fromEntries(Object.entries(input).map(([key, value]) => [key, sql`${value}::float8`]));
      const names = Object.keys(METRICS) as MetricName[];
      const query = new PgDialect().sqlToQuery(sql`select ${sql.join(names.map(name => sql`${metricSql(name, fields)} as ${sql.identifier(name)}`), sql`, `)}`);
      const result = await client.query<Record<string, number | null>>(query.sql, query.params);
      for (const name of names) {
        const expected = calculateMetric(name, input).value; const actual = result.rows[0]?.[name] ?? null;
        if (expected === null) assert.equal(actual, null, name); else close(actual, expected);
      }
    }
  } finally { await client.close(); }
});
