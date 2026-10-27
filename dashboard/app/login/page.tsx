import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { getViewer } from "@/lib/auth/server";
import { loginContinuation, loginDestination } from "@/lib/auth/policy";
import type { DashboardSearchParams } from "@/lib/competition-scope";
import "../auth.css";
export const metadata: Metadata = { title: "Masuk · Club Reports", robots: { index: false, follow: false } };
export default async function LoginPage({ searchParams }: { searchParams: Promise<DashboardSearchParams> }) {
  const requested = (await searchParams)["next"];
  const viewer = await getViewer();
  if (viewer) redirect(loginDestination(viewer.isAdmin, requested));
  const next = loginContinuation(requested);
  return <AuthShell title="Selamat datang kembali." description="Masuk untuk membaca laporan tim dan perkembangan pemain klubmu."><LoginForm next={next} /></AuthShell>;
}
