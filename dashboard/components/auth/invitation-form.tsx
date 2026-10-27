"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { activateInvitation } from "@/app/invite/actions";
import { authClient } from "@/lib/auth/client";
export function InvitationForm({ token, email, signedIn }: { token: string; email: string; signedIn: boolean }) {
  const router = useRouter(); const [pending, setPending] = useState(false); const [error, setError] = useState("");
  return <form className="auth-form" onSubmit={async event => {
    event.preventDefault(); if (pending) return;
    const data = new FormData(event.currentTarget); const password = String(data.get("password") ?? "");
    if (!signedIn && password !== data.get("confirmPassword")) { setError("Konfirmasi password belum sama."); return; }
    setPending(true); setError("");
    try {
      const result = await activateInvitation(token, String(data.get("name") ?? ""), password);
      if (!result.ok) { setError(result.message); setPending(false); return; }
      if (!result.signedIn) {
        const login = await authClient.signIn.email({ email: result.email, password });
        if (login.error) { setError("Akun sudah diaktifkan. Buka halaman masuk dengan email dan password yang baru dibuat."); setPending(false); return; }
      }
      router.replace("/auth/continue"); router.refresh();
    } catch { setError("Aktivasi belum dapat dilakukan. Coba lagi nanti."); setPending(false); }
  }}><label htmlFor="invite-email">Email undangan<input id="invite-email" type="email" value={email} readOnly autoComplete="username" /></label>{!signedIn && <><label htmlFor="invite-name">Nama<input id="invite-name" name="name" autoComplete="name" minLength={2} maxLength={100} required /></label><label htmlFor="invite-password">Buat password<input id="invite-password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label><label htmlFor="invite-confirm">Ulangi password<input id="invite-confirm" name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label><p className="auth-note">Gunakan minimal 12 karakter. Password disimpan sebagai hash, bukan teks asli.</p></>}{error && <p role="alert" className="auth-error">{error}</p>}<button type="submit" disabled={pending}>{pending ? "Mengaktifkan…" : signedIn ? "Terima akses klub" : "Aktifkan akun"}</button>{!signedIn && <p className="auth-note">Sudah mempunyai akun? <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>Masuk dahulu</Link>, lalu terima undangan ini.</p>}</form>;
}
