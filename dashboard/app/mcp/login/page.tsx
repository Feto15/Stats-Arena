import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { McpAuthForm } from "@/components/auth/mcp-auth-form";
import { getViewer } from "@/lib/auth/server";
import { authSettings } from "@/lib/auth/settings";
import { oauthQuery, verifiedOAuthQuery } from "@/lib/mcp/oauth-flow";
import type { DashboardSearchParams } from "@/lib/competition-scope";
import "../../auth.css";
export const metadata: Metadata = { title: "Hubungkan StatsArena", robots: { index: false, follow: false } };
export default async function McpLogin({ searchParams }: { searchParams: Promise<DashboardSearchParams> }) {
  const query = oauthQuery(await searchParams), settings = authSettings();
  try { await verifiedOAuthQuery(query, settings); }
  catch { return <AuthShell title="Koneksi belum dapat dilanjutkan." description="Mulai lagi dari aplikasi yang ingin kamu hubungkan."><p>Tautan koneksi tidak valid atau sudah kedaluwarsa.</p></AuthShell>; }
  const prompt = new URLSearchParams(query).get("prompt") ?? "";
  if (await getViewer() && !["login", "select_account", "create"].some(value => prompt.split(" ").includes(value))) redirect(`/api/auth/oauth2/authorize?${query}`);
  return <AuthShell title="Hubungkan akun StatsArena." description="Masuk dengan akun undanganmu. Aplikasi hanya dapat membaca laporan sesuai izin klub dan kompetisimu."><McpAuthForm query={query} origin={settings.baseURL} /></AuthShell>;
}
