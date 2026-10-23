/** Pure analytics: no filesystem, database connection, or UI dependencies. */
export const ANALYTICS_VERSION = "statsarena-analytics/1.0.0";
export const BASE_STAT_FIELDS = ["minutes", "points", "fieldGoalsMade", "fieldGoalsAttempted", "twoPointsMade", "twoPointAttempts", "threePointsMade", "threePointAttempts", "freeThrowsMade", "freeThrowAttempts", "offensiveRebounds", "defensiveRebounds", "rebounds", "assists", "steals", "blocks", "turnovers", "personalFouls"] as const;
export type StatField = typeof BASE_STAT_FIELDS[number];
export type Stats = Record<StatField, number | null>;
export type MetricField = StatField | "gamesPlayed" | `team_${StatField}` | `opponent_${StatField}`;
export type MetricInputs = Partial<Record<MetricField, number | null>>;
export type UnavailableReason = "missing_input" | "invalid_input" | "nonpositive_denominator";
export type Expression = { kind: "constant"; value: number } | { kind: "field"; name: MetricField } | { kind: "binary"; operator: "+" | "-" | "*" | "/"; left: Expression; right: Expression };
const n = (value: number): Expression => ({ kind: "constant", value });
const f = (name: MetricField): Expression => ({ kind: "field", name });
const binary = (operator: "+" | "-" | "*" | "/", left: Expression, right: Expression): Expression => ({ kind: "binary", operator, left, right });
const add = (a: Expression, b: Expression) => binary("+", a, b);
const sub = (a: Expression, b: Expression) => binary("-", a, b);
const mul = (a: Expression, b: Expression) => binary("*", a, b);
const div = (a: Expression, b: Expression) => binary("/", a, b);
const percent = (a: Expression, b: Expression) => div(mul(n(100), a), b);
const sum = (...values: Expression[]): Expression => values.reduce(add);
const plays = (prefix: "" | "team_" | "opponent_" = "") => sum(f(`${prefix}fieldGoalsAttempted`), mul(n(.44), f(`${prefix}freeThrowAttempts`)), f(`${prefix}turnovers`));
const possessions = (prefix: "" | "opponent_") => sub(plays(prefix), f(`${prefix}offensiveRebounds`));
const sharedPossessions = div(add(possessions(""), possessions("opponent_")), n(2));
const teamCourtMinutes = div(f("team_minutes"), n(5));
const efficiency = sub(sum(f("points"), f("rebounds"), f("assists"), f("steals"), f("blocks")), sum(sub(f("fieldGoalsAttempted"), f("fieldGoalsMade")), sub(f("freeThrowAttempts"), f("freeThrowsMade")), f("turnovers")));
const gameScore = sub(sum(f("points"), mul(n(.4), f("fieldGoalsMade")), mul(n(.7), f("offensiveRebounds")), mul(n(.3), f("defensiveRebounds")), f("steals"), mul(n(.7), f("assists")), mul(n(.7), f("blocks"))), sum(mul(n(.7), f("fieldGoalsAttempted")), mul(n(.4), sub(f("freeThrowAttempts"), f("freeThrowsMade"))), mul(n(.4), f("personalFouls")), f("turnovers")));
const definition = (expression: Expression, unit: "percent" | "ratio" | "points" | "points_per_100_possessions" | "possessions" | "per_40_minutes", estimated = false) => ({ expression, unit, estimated });
export const METRICS = {
  fieldGoalPercentage: definition(percent(f("fieldGoalsMade"), f("fieldGoalsAttempted")), "percent"),
  twoPointPercentage: definition(percent(f("twoPointsMade"), f("twoPointAttempts")), "percent"),
  threePointPercentage: definition(percent(f("threePointsMade"), f("threePointAttempts")), "percent"),
  freeThrowPercentage: definition(percent(f("freeThrowsMade"), f("freeThrowAttempts")), "percent"),
  effectiveFieldGoalPercentage: definition(percent(add(f("fieldGoalsMade"), mul(n(.5), f("threePointsMade"))), f("fieldGoalsAttempted")), "percent"),
  opponentEffectiveFieldGoalPercentage: definition(percent(add(f("opponent_fieldGoalsMade"), mul(n(.5), f("opponent_threePointsMade"))), f("opponent_fieldGoalsAttempted")), "percent"),
  trueShootingPercentage: definition(percent(f("points"), mul(n(2), add(f("fieldGoalsAttempted"), mul(n(.44), f("freeThrowAttempts"))))), "percent", true),
  efficiency: definition(efficiency, "points"),
  efficiencyPerGame: definition(div(efficiency, f("gamesPlayed")), "points"),
  gameScore: definition(gameScore, "points"),
  gameScorePerGame: definition(div(gameScore, f("gamesPlayed")), "points"),
  assistTurnoverRatio: definition(div(f("assists"), f("turnovers")), "ratio"),
  turnoverPercentage: definition(percent(f("turnovers"), plays()), "percent", true),
  threePointAttemptRate: definition(div(f("threePointAttempts"), f("fieldGoalsAttempted")), "ratio"),
  freeThrowAttemptRate: definition(div(f("freeThrowAttempts"), f("fieldGoalsAttempted")), "ratio"),
  pointsPer40: definition(div(mul(n(40), f("points")), f("minutes")), "per_40_minutes"),
  reboundsPer40: definition(div(mul(n(40), f("rebounds")), f("minutes")), "per_40_minutes"),
  assistsPer40: definition(div(mul(n(40), f("assists")), f("minutes")), "per_40_minutes"),
  pointsSharePercentage: definition(percent(f("points"), f("team_points")), "percent"),
  twoPointScoringShare: definition(percent(mul(n(2), f("twoPointsMade")), f("points")), "percent"),
  threePointScoringShare: definition(percent(mul(n(3), f("threePointsMade")), f("points")), "percent"),
  freeThrowScoringShare: definition(percent(f("freeThrowsMade"), f("points")), "percent"),
  usagePercentage: definition(percent(mul(plays(), teamCourtMinutes), mul(f("minutes"), plays("team_"))), "percent", true),
  assistPercentage: definition(percent(f("assists"), sub(mul(div(f("minutes"), teamCourtMinutes), f("team_fieldGoalsMade")), f("fieldGoalsMade"))), "percent", true),
  offensiveReboundPercentage: definition(percent(mul(f("offensiveRebounds"), teamCourtMinutes), mul(f("minutes"), add(f("team_offensiveRebounds"), f("opponent_defensiveRebounds")))), "percent", true),
  defensiveReboundPercentage: definition(percent(mul(f("defensiveRebounds"), teamCourtMinutes), mul(f("minutes"), add(f("team_defensiveRebounds"), f("opponent_offensiveRebounds")))), "percent", true),
  totalReboundPercentage: definition(percent(mul(f("rebounds"), teamCourtMinutes), mul(f("minutes"), add(f("team_rebounds"), f("opponent_rebounds")))), "percent", true),
  teamOffensiveReboundPercentage: definition(percent(f("offensiveRebounds"), add(f("offensiveRebounds"), f("opponent_defensiveRebounds"))), "percent"),
  teamDefensiveReboundPercentage: definition(percent(f("defensiveRebounds"), add(f("defensiveRebounds"), f("opponent_offensiveRebounds"))), "percent"),
  estimatedPossessions: definition(sharedPossessions, "possessions", true),
  offensiveRating: definition(percent(f("points"), sharedPossessions), "points_per_100_possessions", true),
  defensiveRating: definition(percent(f("opponent_points"), sharedPossessions), "points_per_100_possessions", true),
  netRating: definition(percent(sub(f("points"), f("opponent_points")), sharedPossessions), "points_per_100_possessions", true),
} as const;
export type MetricName = keyof typeof METRICS;
export const PLAYER_METRICS: readonly MetricName[] = Object.keys(METRICS).filter(name => !["opponentEffectiveFieldGoalPercentage", "teamOffensiveReboundPercentage", "teamDefensiveReboundPercentage", "estimatedPossessions", "offensiveRating", "defensiveRating", "netRating"].includes(name)) as MetricName[];
export const TEAM_METRICS: readonly MetricName[] = ["fieldGoalPercentage", "twoPointPercentage", "threePointPercentage", "freeThrowPercentage", "effectiveFieldGoalPercentage", "opponentEffectiveFieldGoalPercentage", "trueShootingPercentage", "assistTurnoverRatio", "turnoverPercentage", "threePointAttemptRate", "freeThrowAttemptRate", "twoPointScoringShare", "threePointScoringShare", "freeThrowScoringShare", "teamOffensiveReboundPercentage", "teamDefensiveReboundPercentage", "estimatedPossessions", "offensiveRating", "defensiveRating", "netRating"];

export function renderExpression<T>(expression: Expression, renderer: { constant(value: number): T; field(name: MetricField): T; binary(operator: "+" | "-" | "*" | "/", left: T, right: T): T }): T {
  if (expression.kind === "constant") return renderer.constant(expression.value);
  if (expression.kind === "field") return renderer.field(expression.name);
  return renderer.binary(expression.operator, renderExpression(expression.left, renderer), renderExpression(expression.right, renderer));
}
export function calculateMetric(name: MetricName, inputs: MetricInputs): { value: number | null; reason: UnavailableReason | null } {
  type Value = { value: number | null; reason: UnavailableReason | null };
  return renderExpression<Value>(METRICS[name].expression, {
    constant: value => ({ value, reason: null }),
    field: key => {
      const value = inputs[key];
      if (value == null) return { value: null, reason: "missing_input" };
      if (!Number.isFinite(value) || value < 0) return { value: null, reason: "invalid_input" };
      return { value, reason: null };
    },
    binary: (operator, a, b) => {
      if (a.value === null || b.value === null) return { value: null, reason: a.reason ?? b.reason };
      if (operator === "/" && b.value <= 0) return { value: null, reason: "nonpositive_denominator" };
      const value = operator === "+" ? a.value + b.value : operator === "-" ? a.value - b.value : operator === "*" ? a.value * b.value : a.value / b.value;
      return Number.isFinite(value) ? { value, reason: null } : { value: null, reason: "invalid_input" };
    },
  });
}
export function calculateMetrics(inputs: MetricInputs, names: readonly MetricName[] = PLAYER_METRICS) {
  const advancedStats: Partial<Record<MetricName, number | null>> = {};
  const unavailableReasons: Partial<Record<MetricName, UnavailableReason>> = {};
  for (const name of names) {
    const result = calculateMetric(name, inputs);
    advancedStats[name] = result.value;
    if (result.reason) unavailableReasons[name] = result.reason;
  }
  return { advancedStats, unavailableReasons };
}
export function metricDefinitions() {
  return Object.fromEntries(Object.entries(METRICS).map(([name, metric]) => [name, {
    unit: metric.unit, estimated: metric.estimated, origin: "statsarena_calculated",
    formula: renderExpression<string>(metric.expression, { constant: String, field: String, binary: (op, a, b) => `(${a} ${op} ${b})` }),
  }]));
}
/** One missing input makes that total unavailable; zero is preserved. */
export function sumStats(rows: readonly Partial<Stats>[]): Stats {
  const result = {} as Stats;
  for (const field of BASE_STAT_FIELDS) result[field] = rows.length && rows.every(row => typeof row[field] === "number" && Number.isFinite(row[field]) && row[field]! >= 0)
    ? rows.reduce((total, row) => total + row[field]!, 0) : null;
  return result;
}
export function contextualInputs(stats: Stats, gamesPlayed: number, team?: Stats, opponent?: Stats): MetricInputs {
  const result: MetricInputs = { ...stats, gamesPlayed };
  for (const field of BASE_STAT_FIELDS) {
    result[`team_${field}`] = team?.[field] ?? null;
    result[`opponent_${field}`] = opponent?.[field] ?? null;
  }
  return result;
}
