import { z } from "zod";

const sourceCompetitionIdSchema = z.string().trim().regex(/^[1-9]\d{0,31}$/);

export type CompetitionFilterState =
  | { status: "unselected" }
  | { status: "selected"; sourceCompetitionId: string }
  | { status: "invalid" };

export function parseCompetitionFilter(
  value: string | string[] | undefined,
): CompetitionFilterState {
  if (value === undefined || value === "") return { status: "unselected" };
  if (Array.isArray(value)) return { status: "invalid" };

  const result = sourceCompetitionIdSchema.safeParse(value);
  return result.success
    ? { status: "selected", sourceCompetitionId: result.data }
    : { status: "invalid" };
}

export type DashboardSearchParams = Record<string, string | string[] | undefined>;
