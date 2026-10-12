import Link from "next/link";
import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, NotFoundState } from "@/components/dashboard-ui/states";
import { SectionCard } from "@/components/dashboard-ui/section-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DashboardSearchParams } from "@/lib/competition-scope";
import type { PageResult } from "@/lib/data/contracts";
import { safeSourceHref } from "@/lib/data/server";

export function hrefWithQuery(path: string, params: DashboardSearchParams, updates?: Record<string, string | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) value.forEach((entry) => search.append(key, entry));
    else if (value !== undefined) search.append(key, value);
  }
  for (const [key, value] of Object.entries(updates ?? {})) {
    search.delete(key);
    if (value !== null && value !== "") search.set(key, value);
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

export function formatCount(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : new Intl.NumberFormat("id-ID").format(value);
}

export function formatAverage(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined ? "—" : value.toFixed(digits);
}

export function formatPercent(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? `${numeric.toFixed(1)}%` : "—";
}

export function scoreLabel(home: number | null, away: number | null): string {
  return home === null || away === null ? "—" : `${home} – ${away}`;
}

export function statusLabel(status: string): string {
  return ({ scheduled: "Terjadwal", live: "Live", complete: "Selesai", unknown: "Belum diketahui" } as Record<string, string>)[status] ?? "Belum diketahui";
}

export function StatusBadge({ status }: { status: string }) {
  const tone = status === "complete"
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
    : status === "live"
      ? "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
      : "border-border bg-muted text-muted-foreground";
  return <span className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-medium ${tone}`}>{statusLabel(status)}</span>;
}

export function SourceLink({ href, children = "Sumber" }: { href: string | null | undefined; children?: React.ReactNode }) {
  const safeHref = safeSourceHref(href);
  if (!safeHref) return <span className="text-muted-foreground">—</span>;
  return (
    <a href={safeHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline">
      {children}<ExternalLink className="size-3" aria-hidden="true" />
    </a>
  );
}

export function DataError({ message }: { message: string }) {
  return <SectionCard title="Data belum dapat dimuat"><ErrorState message={message} /></SectionCard>;
}

export function DataEmpty({ title, description, resetHref }: { title: string; description: string; resetHref?: string }) {
  return <SectionCard><EmptyState title={title} description={description} {...(resetHref ? { resetHref } : {})} /></SectionCard>;
}

export function DataNotFound({ title, description, backHref }: { title: string; description: string; backHref: string }) {
  return <SectionCard><NotFoundState title={title} description={description} backHref={backHref} /></SectionCard>;
}

export function Pagination({
  route,
  params,
  result,
}: {
  route: string;
  params: DashboardSearchParams;
  result: Pick<PageResult<unknown>, "total" | "page" | "pageSize">;
}) {
  const pageCount = Math.max(1, Math.ceil(result.total / result.pageSize));
  const previous = hrefWithQuery(route, params, { page: String(Math.max(1, result.page - 1)) });
  const next = hrefWithQuery(route, params, { page: String(result.page + 1) });
  return (
    <nav aria-label="Navigasi halaman tabel" className="flex items-center justify-between gap-3 border-t px-4 py-3">
      <p className="text-xs text-muted-foreground">{formatCount(result.total)} baris · halaman {result.page} dari {pageCount}</p>
      <div className="flex items-center gap-2">
        <Button asChild size="sm" variant="outline" className="h-8" aria-disabled={result.page <= 1}>
          <Link href={previous} tabIndex={result.page <= 1 ? -1 : undefined} aria-label="Halaman sebelumnya"><ArrowLeft className="size-3.5" />Sebelumnya</Link>
        </Button>
        <Button asChild size="sm" variant="outline" className="h-8" aria-disabled={result.page >= pageCount}>
          <Link href={next} tabIndex={result.page >= pageCount ? -1 : undefined} aria-label="Halaman berikutnya">Berikutnya<ArrowRight className="size-3.5" /></Link>
        </Button>
      </div>
    </nav>
  );
}

export function TableEmptyRow({ colSpan, title, description }: { colSpan: number; title: string; description: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="p-0">
        <EmptyState title={title} description={description} />
      </TableCell>
    </TableRow>
  );
}

export {
  Button,
  SectionCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
};
