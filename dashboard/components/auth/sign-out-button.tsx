"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
export function SignOutButton({ returnTo = "/login" }: { returnTo?: string }) {
  const router = useRouter(); const [pending, setPending] = useState(false); const [error, setError] = useState(false);
  return <><button className="report-sign-out" type="button" disabled={pending} onClick={async () => { setPending(true); setError(false); try { const result = await authClient.signOut(); if (result.error) throw new Error(); router.replace(returnTo); router.refresh(); } catch { setError(true); setPending(false); } }}>{pending ? "Keluar…" : "Keluar"}</button>{error && <span role="alert">Belum dapat keluar. Coba lagi.</span>}</>;
}
