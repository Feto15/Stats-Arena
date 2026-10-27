"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return <form className="auth-form" onSubmit={async event => {
    event.preventDefault(); if (pending) return;
    const form = new FormData(event.currentTarget);
    setPending(true); setError("");
    try {
      const result = await authClient.signIn.email({ email: String(form.get("email")).trim().toLowerCase(), password: String(form.get("password")) });
      if (result.error) { setError(result.error.status === 429 ? "Terlalu banyak percobaan. Tunggu sebentar sebelum mencoba lagi." : "Email atau password tidak cocok, atau layanan belum tersedia."); setPending(false); return; }
      router.replace(next); router.refresh();
    } catch { setError("Belum dapat masuk. Coba lagi sebentar."); setPending(false); }
  }}><label htmlFor="login-email">Email<input id="login-email" name="email" type="email" autoComplete="username" required maxLength={254} /></label><label htmlFor="login-password">Password<input id="login-password" name="password" type="password" autoComplete="current-password" required maxLength={128} /></label>{error && <p role="alert" className="auth-error">{error}</p>}<button type="submit" disabled={pending}>{pending ? "Memeriksa…" : "Masuk ke laporan"}</button><p className="auth-note">Akun dibuat melalui undangan admin. Hubungi admin klub jika belum mendapat akses atau membutuhkan bantuan akun.</p></form>;
}
