import Link from "next/link";
import { ArrowLeft, BarChart3 } from "lucide-react";
import { getViewer } from "@/lib/auth/server";
import { SignOutButton } from "@/components/auth/sign-out-button";
export async function LocalReportHeader() {
  const viewer = await getViewer();
  return <header className="report-header report-auth-header"><Link href="/reports" className="report-brand"><span><BarChart3 size={21} /></span>STATS<span className="report-brand-light">ARENA</span><small>CLUB REPORTS</small></Link><div className="report-auth-controls"><Link href="/reports" className="report-dashboard-link"><ArrowLeft size={14} />Report klub</Link>{viewer && <><span className="report-account-name">{viewer.name}</span>{viewer.isAdmin && <><Link href="/" className="report-manage-access">Dashboard</Link><Link href="/admin/access" className="report-manage-access">Kelola akses</Link></>}<SignOutButton /></>}</div></header>;
}
