import { sql, type SQL } from "drizzle-orm";
import { METRICS, renderExpression, type MetricField, type MetricName } from "./analytics.js";

/** SQL and local JSON evaluate the very same expression tree, including safe division. */
export function metricSql(name: MetricName, fields: Partial<Record<MetricField, SQL>>): SQL<number | null> {
  return renderExpression<SQL<number | null>>(METRICS[name].expression, {
    constant: value => sql<number>`${value}::float8`,
    field: key => {
      const value = fields[key] ?? sql`null::float8`;
      return sql<number | null>`case when (${value}) >= 0 and (${value}) < 'Infinity'::float8 then (${value})::float8 else null end`;
    },
    binary: (operator, a, b) => {
      if (operator === "/") return sql<number | null>`(${a})::float8 / nullif(greatest((${b})::float8, 0), 0)`;
      return sql<number | null>`(${a} ${sql.raw(operator)} ${b})`;
    },
  });
}
