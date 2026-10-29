export const REPORT_SECTIONS = ["overview", "players", "games", "shots", "rotation"] as const;
export type ReportSection = typeof REPORT_SECTIONS[number];
export function reportSection(value: string | string[] | null | undefined): ReportSection {
  return REPORT_SECTIONS.find(section => section === value) ?? "overview";
}
export function reportTabHref(basePath: string, query: string, section: ReportSection) {
  const params = new URLSearchParams(query);
  params.set("section", section);
  return `${basePath}?${params.toString()}`;
}
