import type { Metadata } from "next";
import { desc, sql } from "drizzle-orm";
import { authClubAccess, authInvitations, authUsers } from "@statsarena/db";
import { getAuthDatabase, requireAdmin } from "@/lib/auth/server";
import { readGrantChoices } from "@/lib/auth/grant-catalog";
import routes from "@/lib/reports/data/report-routes.json";
import type { DashboardSearchParams } from "@/lib/competition-scope";
import { LocalReportHeader } from "@/components/reports/local-report-header";
import { AdminInvitationForm } from "@/components/auth/admin-invitation-form";
import { cancelInvitationAction, removeClubAccessAction } from "./actions";
import "../../reports/reports.css";
import "../../reports/bima-perkasa/club.css";
import "../../auth.css";
export const metadata: Metadata = { title:"Kelola akses klub", robots:{index:false,follow:false} };
const date=(value:Date)=>new Intl.DateTimeFormat("id-ID",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Jakarta"}).format(value);
export default async function AccessPage({ searchParams }: { searchParams: Promise<DashboardSearchParams> }){
  const actor=await requireAdmin("/admin/access");
  const requested=(await searchParams)["competition"];
  const db=getAuthDatabase(); const data=await readGrantChoices(db,actor.id,typeof requested === "string" ? requested : routes.competitionKey);
  const [users,grants,invites]=await Promise.all([
    db.select({id:authUsers.id,name:authUsers.name,email:authUsers.email,isAdmin:authUsers.isAdmin}).from(authUsers).orderBy(authUsers.name),
    db.select().from(authClubAccess),
    db.select({id:authInvitations.id,email:authInvitations.email,expiresAt:authInvitations.expiresAt,acceptedAt:authInvitations.acceptedAt,revokedAt:authInvitations.revokedAt,makeAdmin:authInvitations.makeAdmin,unexpired:sql<boolean>`${authInvitations.expiresAt} > now()`}).from(authInvitations).orderBy(desc(authInvitations.createdAt)).limit(50)
  ]);
  const clubName=(competition:string,id:string)=>data.competitionKey===competition?data.clubs.find(c=>c.sourceId===id)?.name??id:`${competition} · ${id}`;
  return <div className="report-root access-root"><LocalReportHeader/><main className="report-main"><div className="report-summary-heading"><div><span className="report-eyebrow">ADMIN / ACCESS MANAGEMENT</span><h1>Orang yang tepat. Akses klub yang tepat.</h1><p>Undang staf dan atur laporan serta data MCP yang dapat mereka baca per klub dan kompetisi.</p></div></div><section className="report-card access-panel"><h2>Undang pelatih atau manajemen</h2><AdminInvitationForm key={data.competitionKey} competition={data.competitionKey} competitions={data.competitions} clubs={data.clubs}/></section><section className="report-card access-panel"><h2>Akun dan akses aktif</h2><p className="report-fine">Mencabut akses langsung berlaku pada permintaan berikutnya; akun dan statistik tetap tersimpan.</p><div className="access-user-list">{users.map(user=><article key={user.id}><div><strong>{user.name}</strong><span>{user.email}</span></div>{user.isAdmin?<span className="club-small-label">ADMIN · SEMUA KLUB</span>:<div className="access-user-grants">{grants.filter(g=>g.userId===user.id).map(g=><form action={removeClubAccessAction} key={g.id}><span>{clubName(g.competitionKey,g.clubSourceId)}</span><input type="hidden" name="id" value={g.id}/><button type="submit">Cabut akses</button></form>)}{!grants.some(g=>g.userId===user.id)&&<span>Belum ada akses klub.</span>}</div>}</article>)}</div></section><section className="report-card access-panel"><h2>Undangan terbaru</h2><div className="report-table-scroll" role="region" tabIndex={0} aria-label="Daftar undangan akses"><table><thead><tr><th>Email</th><th>Berlaku sampai (WIB)</th><th>Status</th><th>Aksi</th></tr></thead><tbody>{invites.map(i=>{const active=!i.acceptedAt&&!i.revokedAt&&i.unexpired;return <tr key={i.id}><td>{i.email}{i.makeAdmin?" · Admin":""}</td><td>{date(i.expiresAt)}</td><td>{i.acceptedAt?"Diterima":i.revokedAt?"Dibatalkan":active?"Menunggu aktivasi":"Kedaluwarsa"}</td><td>{active&&<form action={cancelInvitationAction}><input type="hidden" name="id" value={i.id}/><button type="submit">Batalkan</button></form>}</td></tr>;})}</tbody></table></div>{!invites.length&&<p className="report-fine">Belum ada undangan.</p>}</section></main></div>;
}
