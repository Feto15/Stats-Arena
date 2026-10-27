import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LocalClubReportView } from "@/components/reports/local-club-report-view";
import { readReportCatalog, readClubReport } from "@/lib/reports/neon-server";
import type { DashboardSearchParams } from "@/lib/competition-scope";
import { requireViewer, requireClub } from "@/lib/auth/server";
import { canReadClub } from "@/lib/auth/policy";
import "../reports.css";
import "../bima-perkasa/club.css";

export async function generateMetadata({ params }: { params: Promise<{ club: string }> }): Promise<Metadata> {
  const { club } = await params;
  await requireViewer(`/reports/${club}`);
  const entry = (await readReportCatalog()).clubs.find(c => c.slug === club);
  return { title: entry ? `${entry.name} · Club Report 2026` : "Report tidak ditemukan", description: "Laporan klub All Indonesian 2026.", robots: { index: false, follow: false } };
}
export default async function ClubPage({ params, searchParams }: { params: Promise<{ club: string }>; searchParams: Promise<DashboardSearchParams> }) {
  const { club } = await params;
  await requireViewer(`/reports/${club}`);
  const data = await readReportCatalog();
  const entry = data.clubs.find(c => c.slug === club);
  if (!entry) notFound();
  const filters = await searchParams;
  const query = new URLSearchParams();
  for (const [key,value] of Object.entries(filters)) if (typeof value === "string") query.set(key,value);
  const viewer = await requireClub(data.competition.key, entry.sourceId, `/reports/${club}${query.size ? `?${query}` : ""}`);
  const bundle = await readClubReport(entry.sourceId);
  if (!bundle) notFound();
  bundle.clubs = bundle.clubs.filter(c => canReadClub(viewer, data.competition.key, c.sourceId));
  return <LocalClubReportView bundle={bundle} params={filters} isAdmin={viewer.isAdmin} />;
}
