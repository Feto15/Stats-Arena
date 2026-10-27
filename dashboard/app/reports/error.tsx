"use client";

export default function ReportError({ reset }: { reset: () => void }) {
  return <main className="mx-auto max-w-xl space-y-4 p-8"><h1 className="text-xl font-semibold">Laporan belum dapat dimuat</h1><p>Data laporan belum dapat dibaca. Coba muat ulang halaman.</p><button type="button" onClick={reset} className="rounded-md border px-4 py-2">Coba lagi</button></main>;
}
