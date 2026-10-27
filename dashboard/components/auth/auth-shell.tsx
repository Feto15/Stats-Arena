import Link from "next/link";
import { BarChart3, LockKeyhole } from "lucide-react";
export function AuthShell({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <main className="auth-root"><div className="auth-brand"><BarChart3 size={23} /><span>STATS<strong>ARENA</strong></span><small>CLUB REPORTS</small></div><section className="auth-card"><span className="auth-icon"><LockKeyhole size={22} /></span><h1>{title}</h1><p className="auth-description">{description}</p>{children}</section><p className="auth-footer">Akses laporan sesuai klub yang ditugaskan.<br /><Link href="/login">StatsArena · Masuk</Link></p></main>;
}
