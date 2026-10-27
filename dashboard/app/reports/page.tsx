import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, CheckCircle2, Shield } from "lucide-react";
import { LocalReportHeader } from "@/components/reports/local-report-header";
import { readReportCatalog } from "@/lib/reports/neon-server";
import type { DashboardSearchParams } from "@/lib/competition-scope";
import { requireViewer } from "@/lib/auth/server";
import { canReadClub } from "@/lib/auth/policy";
import "./reports.css";
import "./bima-perkasa/club.css";

export const metadata: Metadata = { title: "Club Reports · All Indonesian 2026", description: "Laporan seluruh klub IBL All Indonesian 2026 dari Neon StatsArena." };
export default async function ReportsPage({ searchParams }: { searchParams: Promise<DashboardSearchParams> }) {
  const viewer = await requireViewer();
  const data = await readReportCatalog();
  const clubs = data.cards.filter(club => canReadClub(viewer, data.competition.key, club.sourceId));
  const games = data.games.filter(game => clubs.some(club => game.homeTeamSourceId === club.sourceId || game.awayTeamSourceId === club.sourceId));
  const fixtures = data.fixtures.filter(f => clubs.some(club => f.homeTeamSourceId === club.sourceId || f.awayTeamSourceId === club.sourceId));
  const params = await searchParams;
  const selected = clubs.find(c => c.slug === params["club"]);
  if (selected) redirect(selected.href);
  const date = new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(data.sourceUpdatedAt));
  return <div className="report-root club-report-root"><LocalReportHeader /><main className="report-main reports-catalog"><div className="report-breadcrumb"><span>StatsArena</span><span>/</span><span>Club Reports</span></div><div className="reports-catalog-hero"><span className="report-eyebrow">IBL ALL INDONESIAN 2026</span><h1>Satu klub. Satu laporan lengkap.</h1><p>Pilih klub yang ditugaskan untuk membaca performa tim, evaluasi pemain, shot chart, dan rotasi sesuai data yang tervalidasi.</p><div className="reports-catalog-counts"><span><strong>{clubs.length}</strong> klub</span><span><strong>{games.length}</strong> laga selesai</span><span><strong>{fixtures.length}</strong> jadwal tercatat</span></div></div><div className="club-data-notice reports-catalog-note"><CheckCircle2 size={18} /><div><strong>Data Neon diperbarui {date} WIB</strong><p>Report memakai pertandingan selesai dengan box score valid. Jadwal berikutnya belum masuk perhitungan. Cakupan shot chart dan rotasi diperiksa terpisah per laga.</p></div></div>{!clubs.length && <aside className="club-data-notice"><strong>Belum ada akses klub untuk akun ini.</strong><p>Minta admin membuat undangan akses untuk email akunmu, lalu buka tautan undangannya.</p></aside>}<section className="reports-club-grid" aria-label="Pilih klub All Indonesian 2026">{clubs.map(club => <Link key={club.sourceId} href={club.href} className="reports-club-card"><div className="reports-club-card-top"><span className="reports-club-icon"><Shield size={23} /></span><ArrowUpRight size={18} /></div><h2>{club.name}</h2><p>{club.games ? `${club.games} laga selesai tersedia` : "Belum ada box score laga selesai"}</p><div><span>MENANG <strong>{club.wins}</strong></span><span>KALAH <strong>{club.losses}</strong></span><span className="reports-club-open">Buka report →</span></div></Link>)}</section><p className="report-fine">Klub yang tampil mengikuti penugasan akses akunmu dan daftar peserta pada sumber kompetisi. Tidak mencampurkan data All Indonesian 2025 atau kompetisi lain. Halaman membaca data yang tersimpan di Neon; membuka report tidak memulai pengambilan data dari Genius Sports.</p><footer className="report-footer"><span>STATSARENA / CLUB REPORTS</span><span>{data.competition.name}</span></footer></main></div>;
}
