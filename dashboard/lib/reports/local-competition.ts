import snapshot from "./data/IBL-50231.json";
import { reportCompetitionSchema, buildClubCards, buildCompetitionClubReport, type ReportCompetition } from "./competition-report";
export type LocalReportCompetition = ReportCompetition;
let cached: ReportCompetition | undefined;
export function loadLocalCompetition(input?: unknown) {
  return input !== undefined ? reportCompetitionSchema.parse(input) : cached ??= reportCompetitionSchema.parse(snapshot);
}
export function localClubCards(data = loadLocalCompetition()) { return buildClubCards(data); }
export function localClubReport(slug: string, data = loadLocalCompetition()) { return buildCompetitionClubReport(slug, data); }
export type LocalClubReport = NonNullable<ReturnType<typeof localClubReport>>;
