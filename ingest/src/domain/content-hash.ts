import { createHash } from "node:crypto";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).filter((key) => key !== "datasetQuality").sort().map((key) => [key, canonical(record[key])]));
}

/** Operational datasetQuality observations do not change the data fingerprint.
 * Object order is irrelevant; event/array order, null, and zero remain distinct. */
export function parsedDataHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
