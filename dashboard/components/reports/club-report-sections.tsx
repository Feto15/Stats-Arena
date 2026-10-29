"use client";
import type { ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { Activity, ClipboardList, Crosshair, Layers3, Users } from "lucide-react";
import { reportSection, reportTabHref, type ReportSection } from "@/lib/reports/navigation";

/** Reuse already-authorized server-rendered panels; switching sections needs no new database read. */
export function ClubReportSections({ children, basePath, initialSection }: { children: ReactNode; basePath: string; initialSection: ReportSection }) {
  const params = useSearchParams();
  const sections = params?.getAll("section");
  const selected = sections ? reportSection(sections.length === 1 ? sections[0] : sections) : initialSection;
  return <div className="club-report-sections" data-section={selected}>
    <nav className="report-tabs club-tabs" aria-label="Bagian laporan klub">{([
      { key: "overview", label: "Ringkasan klub", icon: Activity }, { key: "players", label: "Skuad & pemain", icon: Users },
      { key: "games", label: "Pertandingan", icon: ClipboardList }, { key: "shots", label: "Shot chart", icon: Crosshair },
      { key: "rotation", label: "Rotasi & lineup", icon: Layers3 },
    ] as const).map(tab => {
      const href = reportTabHref(basePath, params?.toString() ?? "", tab.key);
      return <a key={tab.key} href={href} className={selected === tab.key ? "active" : ""} aria-current={selected === tab.key ? "page" : undefined}
        onClick={event => {
          if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          if (selected !== tab.key) window.history.pushState(null, "", href);
        }}><tab.icon size={15} />{tab.label}</a>;
    })}</nav>
    {children}
  </div>;
}
