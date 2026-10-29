"use client";
import { useState } from "react";
import { permittedOAuthRedirect } from "@/lib/mcp/oauth-flow-client";

export function McpAuthForm({ query, origin, consent = false }: { query: string; origin: string; consent?: boolean }) {
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  async function submit(form: FormData, accept: boolean) {
    if (pending) return;
    setPending(true); setError("");
    try {
      const response = await fetch(consent ? "/api/auth/oauth2/consent" : "/api/auth/sign-in/email", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify(consent ? { accept, oauth_query: query } : { email: String(form.get("email")).trim().toLowerCase(), password: String(form.get("password")), oauth_query: query })
      });
      const data: unknown = await response.json();
      const url = data && typeof data === "object" && "url" in data ? data.url : null;
      if (!response.ok || !permittedOAuthRedirect(url, query, origin)) throw new Error();
      window.location.assign(url);
    } catch { setError("Koneksi belum dapat dilanjutkan. Periksa akun atau ulangi koneksi dari aplikasi."); setPending(false); }
  }
  return <form className="auth-form" onSubmit={event => { event.preventDefault(); void submit(new FormData(event.currentTarget), true); }}>
    {!consent && <><label htmlFor="mcp-email">Email StatsArena<input id="mcp-email" name="email" type="email" autoComplete="username" maxLength={254} required /></label>
      <label htmlFor="mcp-password">Password<input id="mcp-password" name="password" type="password" autoComplete="current-password" maxLength={128} required /></label></>}
    {error && <p role="alert" className="auth-error">{error}</p>}
    <button type="submit" disabled={pending}>{pending ? "Memproses…" : consent ? "Izinkan akses baca" : "Masuk dan lanjutkan"}</button>
    {consent && <button type="button" disabled={pending} onClick={() => { void submit(new FormData(), false); }}>Tolak</button>}
  </form>;
}
