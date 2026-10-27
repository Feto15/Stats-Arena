"use client";

import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Check, Link2, Printer } from "lucide-react";

export function ReportActions() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pageKey = `${pathname}?${searchParams.toString()}`;
  const [copyResult, setCopyResult] = useState<{ key: string; status: "copied" | "error" } | null>(null);
  const copyState = copyResult?.key === pageKey ? copyResult.status : "idle";
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyResult({ key: pageKey, status: "copied" });
    } catch {
      setCopyResult({ key: pageKey, status: "error" });
    }
  }
  return (
    <div className="report-actions">
      <button type="button" onClick={copyLink}>{copyState === "copied" ? <Check size={15} /> : <Link2 size={15} />}{copyState === "copied" ? "Tautan disalin" : "Salin tautan"}</button>
      <button type="button" onClick={() => window.print()}><Printer size={15} />Cetak / PDF</button>
      <span className="sr-only" role="status">{copyState === "copied" ? "Tautan laporan disalin. Tautan lokal hanya dapat dibuka pada perangkat ini." : copyState === "error" ? "Tautan belum dapat disalin. Salin alamat dari browser." : ""}</span>
      {copyState === "error" && <span role="alert">Salin alamat dari browser.</span>}
    </div>
  );
}
