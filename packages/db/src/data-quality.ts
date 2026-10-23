/** Current observation of a dataset, independent of the match result and retained statistics. */
export const DETAIL_DATASETS = ["summary", "boxScore", "playByPlay", "shotChart", "analysis"] as const;
export type DetailDataset = typeof DETAIL_DATASETS[number];
export type QualityCategory = "network" | "source_inconsistent" | "source_identity_invalid" | "parse_failed";
export interface QualityIssue {
  code: string;
  severity: string;
  message: string;
  sourceUrl: string | null;
  fieldPath: string | null;
  expected: unknown;
  actual: unknown;
}
export interface DatasetQuality {
  status: "parsed" | "partial" | "failed" | "scheduled" | "unavailable";
  category: QualityCategory | null;
  checkedAt: string;
  nextRetryAt: string | null;
  consecutiveFailures: number;
  issues: QualityIssue[];
}
export type DetailQuality = Record<DetailDataset, DatasetQuality>;

export function issueDataset(entry: Pick<QualityIssue, "code" | "sourceUrl">): DetailDataset | null {
  // Score comparisons affect acceptance of box score, even when attributed to summary.
  if (entry.code === "SUMMARY_BOXSCORE_SCORE_MISMATCH" || entry.code === "POINTS_FORMULA_MISMATCH" || entry.code === "FIELD_GOALS_ATTEMPTS_MISMATCH") return "boxScore";
  let path = "";
  try { path = entry.sourceUrl ? new URL(entry.sourceUrl).pathname : ""; } catch { /* Historical diagnostics may contain an invalid URL. */ }
  if (/\/boxscore\/?$/.test(path) || entry.code.startsWith("BOXSCORE_")) return "boxScore";
  if (/\/shotchart\/?$/.test(path) || entry.code.startsWith("SHOT_")) return "shotChart";
  if (/\/playbyplay\/?$/.test(path) || entry.code.startsWith("PBP_")) return "playByPlay";
  if (/\/analysis\/?$/.test(path) || entry.code.startsWith("TEAM_ANALYSIS_")) return "analysis";
  if (/\/summary\/?$/.test(path) || entry.code.startsWith("SUMMARY_")) return "summary";
  return null;
}

export function qualityCategory(entry: QualityIssue): QualityCategory {
  if (entry.code === "FETCH_FAILED") return "network";
  if (/IDENTITY|_ID_|PLAYER_DUPLICATE/.test(entry.code)) return "source_identity_invalid";
  if (entry.code === "SHOT_MARKER_INCOMPLETE" && typeof entry.actual === "object" && entry.actual !== null && "invalidFields" in entry.actual) {
    const fields = entry.actual.invalidFields;
    if (Array.isArray(fields) && fields.some((field) => field === "playerSourceId" || field === "teamSourceId")) return "source_identity_invalid";
  }
  if (entry.code === "PARSE_FAILED" || /HEADERS|TEAM_COUNT|TABLE_INCOMPLETE/.test(entry.code)) return "parse_failed";
  return "source_inconsistent";
}

export function buildDetailQuality(
  availability: Partial<Record<DetailDataset, string>>,
  issues: QualityIssue[],
  now = new Date(),
  previous?: DetailQuality | null,
): DetailQuality {
  return Object.fromEntries(DETAIL_DATASETS.map((dataset) => {
    const related = issues.map((entry) => enrichQualityIssue({ code: entry.code, severity: entry.severity, message: entry.message, sourceUrl: entry.sourceUrl, fieldPath: entry.fieldPath, expected: entry.expected, actual: entry.actual })).filter((entry) => issueDataset(entry) === dataset);
    const errors = related.filter((entry) => entry.severity === "error");
    const page = availability[dataset] ?? "unavailable";
    const status: DatasetQuality["status"] = page === "scheduled" ? "scheduled"
      : page === "fetch_failed" || page === "parse_failed" ? "failed"
      : errors.length || page === "partial" ? "partial"
      : page === "available" || page === "parsed" ? "parsed" : "unavailable";
    const category: QualityCategory | null = status === "failed" || status === "partial"
      ? page === "fetch_failed" ? "network" : page === "parse_failed" ? "parse_failed"
        : errors.some((entry) => qualityCategory(entry) === "network") ? "network"
        : errors.some((entry) => qualityCategory(entry) === "source_identity_invalid") ? "source_identity_invalid"
        : errors.some((entry) => qualityCategory(entry) === "parse_failed") ? "parse_failed" : "source_inconsistent"
      : null;
    const consecutiveFailures = category === null ? 0 : (previous?.[dataset].consecutiveFailures ?? 0) + 1;
    // Transport errors use bounded backoff. Source anomalies need a slower observation cadence.
    const delay = category === "network" ? Math.min(3600, 300 * 2 ** Math.min(consecutiveFailures - 1, 4))
      : category === "parse_failed" ? 3600 : 86400;
    return [dataset, { status, category, checkedAt: now.toISOString(),
      nextRetryAt: category === null ? null : new Date(now.getTime() + delay * 1000).toISOString(),
      consecutiveFailures, issues: related } satisfies DatasetQuality];
  })) as DetailQuality;
}

export function qualityRetryDue(quality: DetailQuality, now = new Date()): boolean {
  return DETAIL_DATASETS.some((dataset) => {
    const state = quality[dataset];
    return (state.status === "partial" || state.status === "failed") &&
      (state.nextRetryAt === null || !Number.isFinite(Date.parse(state.nextRetryAt)) || Date.parse(state.nextRetryAt) <= now.getTime());
  });
}

export const QUALITY_LABELS: Record<QualityCategory, string> = {
  network: "Gagal mengambil halaman",
  source_inconsistent: "Data sumber tidak konsisten",
  source_identity_invalid: "Identitas sumber tidak valid",
  parse_failed: "Struktur halaman perlu diperiksa",
};

/** Clarify legacy marker diagnostics without changing their original evidence. */
export function enrichQualityIssue(entry: QualityIssue): QualityIssue {
  if (entry.code !== "SHOT_MARKER_INCOMPLETE" || typeof entry.actual !== "object" || entry.actual === null || !("classes" in entry.actual)) return entry;
  const raw = entry.actual;
  if ("invalidFields" in raw) return entry;
  if (!Array.isArray(raw.classes) || !raw.classes.every((value) => typeof value === "string")) return entry;
  const classes: string[] = raw.classes;
  const invalidFields: string[] = [];
  if (!classes.some((value) => /^sc_pn\d+$/.test(value))) invalidFields.push("playerSourceId");
  if (!classes.some((value) => /^sc_tn\d+$/.test(value))) invalidFields.push("teamSourceId");
  if (!classes.some((value) => /^sc_per_[1-9]\d*$/.test(value))) invalidFields.push("periodNumber");
  if (!invalidFields.length) return entry;
  return { ...entry, actual: { ...raw, invalidFields },
    message: `Marker tembakan memiliki identitas/periode tidak valid: ${invalidFields.map((field) => QUALITY_FIELD_LABELS[field] ?? field).join(", ")}.` };
}

export const QUALITY_FIELD_LABELS: Record<string, string> = {
  playerSourceId: "ID pemain", teamSourceId: "ID tim", periodNumber: "periode",
  xPercent: "koordinat X", yPercent: "koordinat Y", result: "hasil tembakan"
};

export function qualityIssueEvidence(entry: Pick<QualityIssue, "expected" | "actual"> & { code?: string }): string | null {
  if (typeof entry.expected === "number" && typeof entry.actual === "number" && entry.code === "SHOT_FGA_MISMATCH") return `Chart: ${entry.actual} tembakan; FGA resmi: ${entry.expected}.`;
  if (typeof entry.expected === "number" && typeof entry.actual === "number" && entry.code === "BOXSCORE_PLAYER_POINTS_INCOMPLETE") return `Jumlah poin pemain: ${entry.actual}; total tim: ${entry.expected}.`;
  if (typeof entry.expected === "number" && typeof entry.actual === "number") return `Nilai pembanding: ${entry.expected}; nilai ditemukan: ${entry.actual}.`;
  if (typeof entry.actual === "object" && entry.actual !== null && "invalidFields" in entry.actual && Array.isArray(entry.actual.invalidFields)) {
    const fields = entry.actual.invalidFields.filter((field): field is string => typeof field === "string");
    return fields.length ? `Bagian tidak valid: ${fields.map((field) => QUALITY_FIELD_LABELS[field] ?? field).join(", ")}.` : null;
  }
  return null;
}
