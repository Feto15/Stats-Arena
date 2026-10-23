import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { DashboardSearchParams } from "@/lib/competition-scope";
import type { PageResult, PlayerListItem } from "@/lib/data/contracts";
import type { PlayerListFilters } from "@/lib/data/queries";
import {
  Pagination, SectionCard, Table, TableBody, TableCell, TableEmptyRow,
  TableHead, TableHeader, TableRow, formatAverage, formatCount, formatPercent, hrefWithQuery,
} from "./data-ui";

type MetricKey = Exclude<keyof PlayerListItem, "id" | "sourcePlayerId" | "name" | "sourceUrl" | "teamNames">;
type Metric = { key: MetricKey; label: string; sort: PlayerListFilters["sort"]; description: string; percentage?: boolean; extended?: boolean };
type MetricGroup = { label: string; metrics: Metric[] };

const groups: MetricGroup[] = [
  { label: "Penampilan", metrics: [
    { key: "gamesPlayed", label: "GP", sort: "games", description: "Jumlah laga selesai yang mencatat pemain, termasuk menit nol" },
    { key: "averageMinutes", label: "MPG", sort: "minutes", description: "Rata-rata menit bermain per laga" },
  ] },
  { label: "Scoring", metrics: [
    { key: "pointsPerGame", label: "PPG", sort: "points", description: "Rata-rata poin per laga" },
    { key: "effectiveFieldGoalPercentage", label: "eFG%", sort: "efg", percentage: true, description: "Hasil hitung: 100 × (FGM + 0.5 × 3PM) / FGA" },
    { key: "trueShootingPercentage", label: "TS%", sort: "ts", percentage: true, description: "Estimasi: 100 × PTS / [2 × (FGA + 0.44 × FTA)]" },
  ] },
  { label: "Rebound & Assist", metrics: [
    { key: "reboundsPerGame", label: "RPG", sort: "rebounds", description: "Rata-rata total rebound per laga" },
    { key: "offensiveReboundsPerGame", label: "OREB", sort: "orb", extended: true, description: "Rata-rata offensive rebound per laga" },
    { key: "defensiveReboundsPerGame", label: "DREB", sort: "drb", extended: true, description: "Rata-rata defensive rebound per laga" },
    { key: "assistsPerGame", label: "APG", sort: "assists", description: "Rata-rata assist per laga" },
  ] },
  { label: "Pertahanan", metrics: [
    { key: "stealsPerGame", label: "SPG", sort: "steals", description: "Rata-rata steal per laga" },
    { key: "blocksPerGame", label: "BPG", sort: "blocks", description: "Rata-rata block per laga" },
  ] },
  { label: "Kontrol Bola", metrics: [
    { key: "turnoversPerGame", label: "TOPG", sort: "turnovers", description: "Rata-rata turnover per laga" },
    { key: "personalFoulsPerGame", label: "PFPG", sort: "fouls", description: "Rata-rata personal foul per laga" },
    { key: "assistTurnoverRatio", label: "AST/TO", sort: "ast_to", extended: true, description: "Total assist / total turnover; turnover nol ditampilkan —" },
  ] },
  { label: "Akurasi", metrics: [
    { key: "fieldGoalPercentage", label: "FG%", sort: "fg", extended: true, percentage: true, description: "Total field goal masuk / total percobaan" },
    { key: "freeThrowPercentage", label: "FT%", sort: "ft", percentage: true, description: "Total free throw masuk / total percobaan" },
    { key: "twoPointPercentage", label: "2P%", sort: "two_pt", percentage: true, description: "Total tembakan 2 poin masuk / total percobaan" },
    { key: "threePointPercentage", label: "3P%", sort: "three_pt", percentage: true, description: "Total tembakan 3 poin masuk / total percobaan" },
  ] },
  { label: "Efisiensi", metrics: [
    { key: "efficiencyPerGame", label: "EFF", sort: "efficiency", description: "Hasil hitung per laga: PTS + REB + AST + STL + BLK − (FGA − FGM) − (FTA − FTM) − TO" },
  ] },
];

const groupBorder = "border-r border-border/60";
const formControl = "h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function SortHeading({ label, sort, description, filters, params, className }: {
  label: string; sort: PlayerListFilters["sort"]; description: string;
  filters: PlayerListFilters; params: DashboardSearchParams; className?: string;
}) {
  const active = filters.sort === sort;
  const direction = active ? (filters.direction === "desc" ? "asc" : "desc") : sort === "name" ? "asc" : "desc";
  const Icon = active ? (filters.direction === "desc" ? ArrowDown : ArrowUp) : ArrowUpDown;
  return <TableHead scope="col" className={className} aria-sort={active ? (filters.direction === "desc" ? "descending" : "ascending") : undefined}>
    <Link href={hrefWithQuery("/players", params, { sort, dir: direction, page: null })} title={description}
      aria-label={`Urutkan ${label} ${direction === "asc" ? "menaik" : "menurun"}`}
      className={`inline-flex items-center justify-end gap-1 rounded-sm py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}>
      {label}<Icon className={`size-3 ${active ? "opacity-100" : "opacity-40"}`} aria-hidden="true" />
    </Link>
  </TableHead>;
}

export function PlayersContent({ result, params, filters, competitionId, teamOptions }: {
  result: PageResult<PlayerListItem>; params: DashboardSearchParams; filters: PlayerListFilters;
  competitionId: string; teamOptions: Array<{ sourceTeamId: string; name: string }>;
}) {
  const visibleGroups = groups.map((group) => ({ ...group, metrics: group.metrics.filter((metric) => !metric.extended || filters.extended) }));
  const columnCount = 3 + visibleGroups.reduce((count, group) => count + group.metrics.length, 0);
  const hasFilters = Boolean(filters.query || filters.teamSourceId || filters.minimumGames || filters.minimumAttempts);
  return <>
    <SectionCard bodyClassName="p-3">
      <form method="get" action="/players" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="competition" value={competitionId} />
        <input type="hidden" name="sort" value={filters.sort} />
        <input type="hidden" name="dir" value={filters.direction} />
        <label className="grid flex-1 gap-1.5 text-xs text-muted-foreground min-w-40">Cari pemain
          <input name="q" defaultValue={filters.query} maxLength={100} placeholder="Nama pemain…" className={formControl} />
        </label>
        <label className="grid gap-1.5 text-xs text-muted-foreground">Tim
          <select name="team" defaultValue={filters.teamSourceId ?? ""} className={`${formControl} w-full sm:max-w-64`}>
            <option value="">Semua tim</option>
            {teamOptions.map((team) => <option key={team.sourceTeamId} value={team.sourceTeamId}>{team.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1.5 text-xs text-muted-foreground">Min. GP
          <input name="minGp" type="number" min={0} max={100000} defaultValue={filters.minimumGames || ""} placeholder="0" className={`${formControl} w-20`} />
        </label>
        <label className="grid gap-1.5 text-xs text-muted-foreground" title="Minimum total percobaan field goal">Min. FGA
          <input name="minFga" type="number" min={0} max={100000} defaultValue={filters.minimumAttempts || ""} placeholder="0" className={`${formControl} w-20`} />
        </label>
        <label className="grid gap-1.5 text-xs text-muted-foreground">Kolom
          <select name="columns" defaultValue={filters.extended ? "extended" : "standard"} className={formControl}>
            <option value="standard">Utama</option><option value="extended">Lengkap</option>
          </select>
        </label>
        <button type="submit" className="h-9 rounded-md bg-primary px-4 text-xs font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Terapkan</button>
        {hasFilters && <Link href={hrefWithQuery("/players", params, { q: null, team: null, minGp: null, minFga: null, page: null })} className="inline-flex h-9 items-center text-xs text-muted-foreground hover:text-foreground">Reset filter</Link>}
      </form>
    </SectionCard>
    <SectionCard title="Statistik pemain" description={`${formatCount(result.total)} pemain · Statistik per laga pada pertandingan selesai`} bodyClassName="p-0 overflow-hidden">
      <Table className="w-max min-w-full text-xs tabular-nums">
        <caption className="sr-only">Statistik pemain kompetisi {competitionId}, kolom dikelompokkan menurut jenis statistik</caption>
        <TableHeader>
          <TableRow className="bg-muted/30 hover:bg-muted/30">
            <TableHead scope="colgroup" colSpan={3} className={`px-4 text-[10px] uppercase tracking-wider text-muted-foreground ${groupBorder}`}>Pemain & Tim</TableHead>
            {visibleGroups.map((group, index) => <TableHead key={group.label} scope="colgroup" colSpan={group.metrics.length} className={`px-3 text-center text-[10px] uppercase tracking-wider text-muted-foreground ${index < visibleGroups.length - 1 ? groupBorder : ""}`}>{group.label}</TableHead>)}
          </TableRow>
          <TableRow className="bg-muted/15 hover:bg-muted/15">
            <TableHead scope="col" className="w-10 min-w-10 px-3 text-right text-muted-foreground">#</TableHead>
            <SortHeading label="Pemain" sort="name" description="Urutkan nama pemain" filters={filters} params={params} className={`sticky left-0 z-10 min-w-48 bg-card pl-4 ${groupBorder}`} />
            <TableHead scope="col" className={`min-w-40 px-3 text-muted-foreground ${groupBorder}`}>Tim</TableHead>
            {visibleGroups.map((group, groupIndex) => group.metrics.map((metric, index) => <SortHeading key={metric.key} label={metric.label} sort={metric.sort} description={metric.description} filters={filters} params={params}
              className={`px-3 text-right ${index === group.metrics.length - 1 && groupIndex < visibleGroups.length - 1 ? groupBorder : ""}`} />))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.items.length === 0 ? <TableEmptyRow colSpan={columnCount} title={hasFilters ? "Tidak ada pemain yang cocok" : "Belum ada pemain"} description={hasFilters ? "Coba ubah pencarian, tim, atau batas minimum statistik." : "Belum ada pemain terdaftar untuk kompetisi ini."} /> : result.items.map((player, rowIndex) => <TableRow key={player.id} className="group">
            <TableCell className="px-3 text-right font-mono text-muted-foreground">{(result.page - 1) * result.pageSize + rowIndex + 1}</TableCell>
            <TableCell className={`sticky left-0 z-10 bg-card py-3 pl-4 group-hover:bg-muted ${groupBorder}`}>
              <Link href={hrefWithQuery(`/players/${player.sourcePlayerId}`, params)} title={`${player.name} · ID ${player.sourcePlayerId}`} className="block max-w-56 truncate font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{player.name}</Link>
            </TableCell>
            <TableCell className={`max-w-56 px-3 text-muted-foreground ${groupBorder}`} title={player.teamNames.join(", ")}><span className="block max-w-56 truncate">{player.teamNames.join(", ") || "—"}</span></TableCell>
            {visibleGroups.map((group, groupIndex) => group.metrics.map((metric, index) => <TableCell key={metric.key} className={`px-3 text-right ${metric.key === "pointsPerGame" || metric.key === "reboundsPerGame" ? "font-semibold" : ""} ${index === group.metrics.length - 1 && groupIndex < visibleGroups.length - 1 ? groupBorder : ""}`}>
              {metric.key === "gamesPlayed" ? formatCount(player[metric.key]) : metric.percentage ? formatPercent(player[metric.key]) : formatAverage(player[metric.key], metric.key === "assistTurnoverRatio" ? 2 : 1)}
            </TableCell>))}
          </TableRow>)}
        </TableBody>
      </Table>
      {result.total > result.pageSize && <Pagination route="/players" params={params} result={result} />}
      <div className="flex flex-wrap gap-x-6 gap-y-1 border-t bg-muted/10 px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
        <span>eFG%, TS%, EFF dan AST/TO adalah hasil hitung; TS% memakai estimasi 0.44.</span>
        <span>Persentase memakai total masuk / percobaan. Data tidak tersedia: —.</span>
      </div>
    </SectionCard>
  </>;
}
