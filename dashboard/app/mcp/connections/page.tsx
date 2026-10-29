import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { authMcpClients, authMcpConsents } from "@statsarena/db";
import { AuthShell } from "@/components/auth/auth-shell";
import { getAuthDatabase, requireViewer } from "@/lib/auth/server";
import { disconnectMcpAction } from "./actions";
import "../../auth.css";
export const metadata: Metadata = { title: "Koneksi aplikasi StatsArena", robots: { index: false, follow: false } };
export default async function McpConnections() {
  const viewer = await requireViewer();
  const rows = await getAuthDatabase().select({ clientId: authMcpConsents.clientId, name: authMcpClients.name }).from(authMcpConsents)
    .innerJoin(authMcpClients, eq(authMcpClients.clientId, authMcpConsents.clientId)).where(eq(authMcpConsents.userId, viewer.id));
  const clients = [...new Map(rows.map(r => [r.clientId, r])).values()];
  return <AuthShell title="Koneksi aplikasi." description="Aplikasi yang kamu izinkan membaca data StatsArena.">
    {clients.length ? clients.map(client => <form key={client.clientId} action={disconnectMcpAction} className="auth-form"><strong>{client.name ?? "Aplikasi terhubung"}</strong><input type="hidden" name="clientId" value={client.clientId} /><button type="submit">Putus koneksi</button></form>) : <p>Belum ada koneksi aplikasi.</p>}
    <Link href="/reports">Kembali ke laporan</Link>
  </AuthShell>;
}
