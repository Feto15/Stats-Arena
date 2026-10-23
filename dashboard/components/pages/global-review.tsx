import Link from "next/link";
import { CircleAlert } from "lucide-react";
import { KpiCard } from "@/components/dashboard-ui/kpi-card";
import { SectionCard } from "@/components/dashboard-ui/section-card";
import type { DashboardSearchParams } from "@/lib/competition-scope";
import type { GlobalReviewSummary } from "@/lib/data/contracts";
import { liveStatsStatusLabels } from "@/lib/data/livestats-status";
import { ReviewImpact } from "./review-impact";
import { DataEmpty, Pagination, SourceLink, StatusBadge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, formatCount, scoreLabel } from "./data-ui";

function dataStatus(source: string, status: string): string {
  if (source === "livestats" && status in liveStatsStatusLabels) return liveStatsStatusLabels[status as keyof typeof liveStatsStatusLabels];
  return status === "failed" ? "Gagal mengambil/membaca data" : "Data belum lengkap";
}

export function GlobalReviewContent({ summary, params }: { summary: GlobalReviewSummary; params: DashboardSearchParams }) {
  const source = params["source"] === "portal" || params["source"] === "livestats" ? params["source"] : "";
  const severity = typeof params["severity"] === "string" ? params["severity"] : "";
  const code = typeof params["code"] === "string" ? params["code"] : "";
  // Pagination keeps only the explicit global filters, never a stale competition.
  const globalParams = { scope: "all", source, severity, code };
  return <>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard label="Laga perlu diperiksa" value={formatCount(summary.totalGames)} hint="Laga unik sesuai filter" icon={<CircleAlert className="size-4" />} />
      <KpiCard label="Kompetisi terdampak" value={formatCount(summary.competitions)} hint="Seluruh kompetisi tersimpan" icon={<CircleAlert className="size-4" />} />
      <KpiCard label="Laga dengan isu portal" value={formatCount(summary.portalGames)} hint="Dataset terbaru gagal atau parsial" icon={<CircleAlert className="size-4" />} />
      <KpiCard label="Laga dengan isu LiveStats" value={formatCount(summary.liveStatsGames)} hint="Satu laga dapat bermasalah di kedua sumber" icon={<CircleAlert className="size-4" />} />
    </div>
    <form method="get" action="/review" className="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-3">
      <input type="hidden" name="scope" value="all" />
      <label className="grid gap-1 text-xs text-muted-foreground">Sumber isu
        <select name="source" defaultValue={source} className="h-8 min-w-36 rounded-md border border-input bg-background px-2 text-xs text-foreground"><option value="">Semua sumber</option><option value="portal">Portal Genius</option><option value="livestats">LiveStats</option></select>
      </label>
      <label className="grid gap-1 text-xs text-muted-foreground">Severity
        <select name="severity" defaultValue={severity} className="h-8 min-w-36 rounded-md border border-input bg-background px-2 text-xs text-foreground"><option value="">Semua</option><option value="error">Error</option><option value="warning">Warning</option><option value="info">Info</option></select>
      </label>
      <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">Jenis isu
        <select name="code" defaultValue={code} className="h-8 max-w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"><option value="">Semua jenis</option>{summary.issueTypes.map(type => <option key={type} value={type}>{type}</option>)}</select>
      </label>
      <button type="submit" className="h-8 rounded-md border px-3 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Terapkan</button>
    </form>
    <SectionCard title="Laga dengan masalah data aktif" description="Satu baris per laga. Histori yang sudah selesai dan jadwal yang belum dimainkan tidak masuk daftar. Status hasil pertandingan tetap terpisah." bodyClassName="p-0">
      {summary.games.total === 0 ? <DataEmpty title="Tidak ada laga bermasalah" description="Tidak ada masalah aktif yang cocok dengan filter ini." /> : <Table>
        <caption className="sr-only">Laga bermasalah semua kompetisi</caption>
        <TableHeader><TableRow><TableHead className="pl-4">Pertandingan</TableHead><TableHead>Kompetisi</TableHead><TableHead>Masalah data</TableHead><TableHead>Pemeriksaan terakhir</TableHead><TableHead>Detail</TableHead></TableRow></TableHeader>
        <TableBody>{summary.games.items.map(game => {
          const query = new URLSearchParams({ competition: game.competitionRef });
          const gameHref = `/games/${game.sourceGameId}?${query}`;
          const reviewHref = `/review?${query}${source ? `&source=${source}` : ""}`;
          return <TableRow key={game.id}>
            <TableCell className="min-w-56 max-w-72 whitespace-normal pl-4"><Link href={gameHref} className="font-medium hover:text-primary hover:underline">{game.homeName ?? "Tim belum diketahui"} vs {game.awayName ?? "Tim belum diketahui"}</Link><p className="mt-1 font-mono text-xs text-muted-foreground">{game.sourceGameId} · {scoreLabel(game.homeScore, game.awayScore)}</p><div className="mt-1"><StatusBadge status={game.status} /></div></TableCell>
            <TableCell className="min-w-40 max-w-64 whitespace-normal text-xs"><Link href={reviewHref} className="hover:text-primary hover:underline">{game.competitionName}</Link><p className="mt-1 font-mono text-muted-foreground">{game.competitionRef}</p></TableCell>
            <TableCell className="min-w-64 max-w-md whitespace-normal text-xs"><ul className="space-y-3">{game.issues.map((issue, index) => <li key={`${issue.source}:${issue.code}:${index}`}>
              <p className="font-medium">{issue.source === "portal" ? "Portal Genius" : "LiveStats"} · {dataStatus(issue.source, issue.status)}</p>
              <p className="mt-0.5 break-all font-mono text-[10px] text-muted-foreground">{issue.code}</p><p className="mt-1">{issue.message}</p>
              <ReviewImpact issue={issue} /><div className="mt-1"><SourceLink href={issue.sourceUrl} /></div>
            </li>)}</ul></TableCell>
            <TableCell className="text-xs text-muted-foreground">{game.checkedAt.toLocaleString("id-ID")}</TableCell>
            <TableCell><div className="flex flex-col gap-2 text-xs"><Link href={gameHref} className="text-primary hover:underline">Buka pertandingan</Link><Link href={reviewHref} className="text-primary hover:underline">Review kompetisi</Link></div></TableCell>
          </TableRow>;
        })}</TableBody>
      </Table>}
      {summary.games.total > summary.games.pageSize && <Pagination route="/review" params={globalParams} result={summary.games} />}
    </SectionCard>
  </>;
}
