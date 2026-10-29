import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { and, eq, isNull, or } from "drizzle-orm";
import { authMcpClients } from "@statsarena/db";
import { AuthShell } from "@/components/auth/auth-shell";
import { McpAuthForm } from "@/components/auth/mcp-auth-form";
import { getAuthDatabase, getViewer } from "@/lib/auth/server";
import { authSettings } from "@/lib/auth/settings";
import { oauthQuery, verifiedOAuthQuery } from "@/lib/mcp/oauth-flow";
import type { DashboardSearchParams } from "@/lib/competition-scope";
import "../../auth.css";
export const metadata: Metadata = { title: "Persetujuan akses StatsArena", robots: { index: false, follow: false } };
export default async function McpConsent({ searchParams }: { searchParams: Promise<DashboardSearchParams> }) {
  const query = oauthQuery(await searchParams), settings = authSettings();
  let params: URLSearchParams;
  try { params = await verifiedOAuthQuery(query, settings); }
  catch { return <AuthShell title="Permintaan berakhir." description="Mulai lagi dari aplikasi yang ingin kamu hubungkan."><p>Tautan persetujuan tidak valid atau kedaluwarsa.</p></AuthShell>; }
  const viewer = await getViewer();
  if (!viewer) redirect(`/mcp/login?${query}`);
  const [client] = await getAuthDatabase().select({ name: authMcpClients.name }).from(authMcpClients)
    .where(and(eq(authMcpClients.clientId, params.get("client_id")!), or(isNull(authMcpClients.disabled), eq(authMcpClients.disabled, false)))).limit(1);
  if (!client) return <AuthShell title="Aplikasi tidak tersedia." description="Hubungan ke aplikasi ini belum dapat dilanjutkan."><p>Ulangi koneksi dari aplikasi.</p></AuthShell>;
  return <AuthShell title="Izinkan akses baca?" description={`${client.name ?? "Aplikasi terhubung"} meminta membaca data StatsArena menggunakan akun ${viewer.email}.`}>
    <ul className="auth-permissions"><li>Statistik pemain, tim, dan pertandingan sesuai izinmu.</li>
      {viewer.isAdmin && <li>Pemeriksaan kualitas data dan kode isu khusus admin.</li>}
      <li>{viewer.isAdmin ? "Akun admin dapat membaca semua kompetisi dan klub." : `${viewer.grants.length} akses klub/kompetisi telah diberikan oleh admin.`}</li>
      <li>Koneksi ini tidak dapat mengimpor, mengubah, atau menghapus statistik.</li>
      {params.get("scope")?.split(" ").includes("offline_access") && <li>Aplikasi dapat mempertahankan koneksi hingga tujuh hari selama sesi dan izin masih berlaku.</li>}</ul>
    <p className="auth-note">Kamu dapat memutus koneksi dari halaman Koneksi aplikasi StatsArena.</p>
    <McpAuthForm query={query} origin={settings.baseURL} consent />
  </AuthShell>;
}
