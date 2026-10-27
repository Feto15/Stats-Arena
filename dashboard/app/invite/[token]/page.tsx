import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { InvitationForm } from "@/components/auth/invitation-form";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { getAuthDatabase, getViewer } from "@/lib/auth/server";
import { invitationPreview, InvitationError } from "@/lib/auth/invitations";
import { readReportCatalog } from "@/lib/reports/neon-server";
import "../../auth.css";
export const metadata: Metadata = { title: "Aktivasi akun · Club Reports", robots: { index: false, follow: false }, referrer: "no-referrer" };
async function readInvitation(token: string) {
  try {
    const invite = await invitationPreview(getAuthDatabase(), token);
    const viewer = await getViewer();
    return { ok: true as const, invite, viewer };
  } catch (error) {
    return { ok: false as const, message: error instanceof InvitationError ? error.message : "Layanan aktivasi belum tersedia. Coba kembali nanti." };
  }
}
export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await readInvitation(token);
  if (!result.ok) return <AuthShell title="Undangan belum bisa dibuka." description={result.message}><p className="auth-note">Hubungi admin untuk mendapatkan tautan undangan yang masih berlaku.</p></AuthShell>;
  const { invite, viewer } = result;
  const competition = await readReportCatalog();
  const names = invite.grants.map(g => competition.clubs.find(c => competition.competition.key === g.competitionKey && c.sourceId === g.clubSourceId)?.name ?? "Klub yang ditugaskan");
  const mismatch = viewer && viewer.email.toLowerCase() !== invite.email;
  return <AuthShell title={invite.makeAdmin ? "Aktifkan akun admin." : "Undangan untuk klubmu."} description={invite.makeAdmin ? "Atur akun admin utama StatsArena untuk mengelola laporan dan akses klub." : "Buat akun atau terima undangan dengan akun yang sudah ada."}><div className="auth-invite-summary"><strong>{invite.makeAdmin ? "ADMIN STATSARENA · SEMUA KLUB" : "AKSES REPORT KLUB"}</strong>{names.map((name,i) => <span key={i}>{name}</span>)}<small>Berlaku sampai {new Intl.DateTimeFormat("id-ID", { dateStyle:"long", timeStyle:"short", timeZone:"Asia/Jakarta" }).format(invite.expiresAt)} WIB</small></div>{mismatch ? <div className="auth-form"><p className="auth-error">Undangan ini untuk {invite.email}. Kamu sedang masuk sebagai {viewer.email}. Keluar dahulu untuk memakai akun yang sesuai.</p><SignOutButton returnTo={`/invite/${token}`} /></div> : <InvitationForm token={token} email={invite.email} signedIn={Boolean(viewer)} />}</AuthShell>;
}
