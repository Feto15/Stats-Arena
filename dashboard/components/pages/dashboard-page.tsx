import Link from "next/link";
import { CalendarDays, CircleAlert, Shield, Trophy, Users } from "lucide-react";
import { KpiCard } from "@/components/dashboard-ui/kpi-card";
import { SectionCard } from "@/components/dashboard-ui/section-card";
import { dashboardPageDefinitions, type DashboardPageKey } from "@/components/pages/page-config";
import {
  DataEmpty,
  DataError,
  DataNotFound,
  Pagination,
  SourceLink,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeader,
  TableRow,
  formatAverage,
  formatCount,
  hrefWithQuery,
  scoreLabel,
} from "@/components/pages/data-ui";
import {
  parseCompetitionFilter,
  type DashboardSearchParams,
} from "@/lib/competition-scope";
import {
  parseGameListFilters,
  parsePage,
  parseReviewFilters,
  parseStandingsFilters,
} from "@/lib/data/queries";
import {
  readCompetition,
  readGames,
  readOverview,
  readPlayers,
  readReview,
  readStandings,
  readTeams,
} from "@/lib/data/server";
import type {
  CompetitionOption,
  GameListItem,
  ImportRunListItem,
  OperationalStatus,
  OverviewSummary,
  PageResult,
  PlayerListItem,
  ReviewSummary,
  StandingListItem,
  TeamListItem,
} from "@/lib/data/contracts";

function CompetitionNotice({
  state,
  competition,
  unavailable,
}: {
  state: ReturnType<typeof parseCompetitionFilter>;
  competition: CompetitionOption | null;
  unavailable: boolean;
}) {
  if (state.status === "invalid") {
    return (
      <div role="alert" className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3">
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium">Scope kompetisi tidak valid</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Pilih satu kompetisi dari daftar di bagian atas.</p>
        </div>
      </div>
    );
  }
  if (state.status === "unselected") {
    return (
      <div className="rounded-lg border bg-card px-4 py-3">
        <p className="text-sm font-medium">Pilih kompetisi</p>
        <p className="mt-0.5 text-xs text-muted-foreground">Data setiap halaman dibatasi pada satu kompetisi yang dipilih.</p>
      </div>
    );
  }
  if (unavailable) {
    return (
      <div role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
        <p className="text-sm font-medium">Kompetisi belum dapat dimuat</p>
        <p className="mt-0.5 text-xs text-muted-foreground">Koneksi database belum tersedia; status ID kompetisi belum dapat diperiksa.</p>
      </div>
    );
  }
  if (!competition) {
    return (
      <div role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
        <p className="text-sm font-medium">Kompetisi tidak ditemukan</p>
        <p className="mt-0.5 text-xs text-muted-foreground">Belum ada kompetisi dengan source ID {state.sourceCompetitionId} di database StatsArena.</p>
      </div>
    );
  }
  const metadata = [competition.season, competition.year === null ? null : String(competition.year)]
    .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
    .join(" · ");
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-4 py-3">
      <span className="text-sm font-medium">{competition.name}</span>
      {metadata && <span className="text-xs text-muted-foreground">{metadata}</span>}
      <span className="rounded-md border px-2 py-0.5 font-mono text-[11px] text-muted-foreground">{competition.sourceCompetitionId}</span>
    </div>
  );
}

function TableShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return <SectionCard title={title} description={description} bodyClassName="p-0">{children}</SectionCard>;
}

function GameRows({
  games,
  params,
}: {
  games: GameListItem[];
  params: DashboardSearchParams;
}) {
  if (games.length === 0) {
    return <TableEmptyRow colSpan={5} title="Belum ada pertandingan" description="Belum ada pertandingan yang sesuai dengan kompetisi dan filter ini." />;
  }
  return <>
    {games.map((game) => (
      <TableRow key={game.id}>
        <TableCell className="pl-4 text-xs text-muted-foreground">{game.scheduledAtRaw ?? "—"}</TableCell>
        <TableCell>
          <Link href={hrefWithQuery(`/games/${game.sourceGameId}`, params)} className="font-medium hover:text-primary hover:underline">
            {game.homeTeam?.name ?? "TBD"} <span className="text-muted-foreground">vs</span> {game.awayTeam?.name ?? "TBD"}
          </Link>
          <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{game.sourceGameId}</div>
        </TableCell>
        <TableCell className="font-mono tabular-nums">{scoreLabel(game.homeScore, game.awayScore)}</TableCell>
        <TableCell><StatusBadge status={game.status} /></TableCell>
        <TableCell className="max-w-48 truncate text-xs text-muted-foreground">{game.venue ?? "—"}</TableCell>
      </TableRow>
    ))}
  </>;
}

function GamesContent({
  result,
  competitionId,
  params,
}: {
  result: PageResult<GameListItem>;
  competitionId: string;
  params: DashboardSearchParams;
}) {
  const status = typeof params["status"] === "string" ? params["status"] : "";
  return (
    <>
      <form method="get" action="/games" className="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-3">
        <input type="hidden" name="competition" value={competitionId} />
        <label className="grid gap-1 text-xs text-muted-foreground">
          Status pertandingan
          <select name="status" defaultValue={status} className="h-8 min-w-40 rounded-md border border-input bg-background px-2 text-xs text-foreground">
            <option value="">Semua status</option>
            <option value="scheduled">Terjadwal</option>
            <option value="live">Live</option>
            <option value="complete">Selesai</option>
            <option value="unknown">Belum diketahui</option>
          </select>
        </label>
        <button type="submit" className="h-8 rounded-md border px-3 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Terapkan</button>
      </form>
      <TableShell title="Pertandingan" description="Waktu dipertahankan sesuai teks sumber; urutan mengikuti pembaruan terakhir.">
        <Table>
          <caption className="sr-only">Daftar pertandingan kompetisi {competitionId}</caption>
          <TableHeader><TableRow className="hover:bg-transparent"><TableHead className="pl-4">Waktu sumber</TableHead><TableHead>Pertandingan</TableHead><TableHead>Skor</TableHead><TableHead>Status</TableHead><TableHead>Venue</TableHead></TableRow></TableHeader>
          <TableBody><GameRows games={result.items} params={params} /></TableBody>
        </Table>
        {result.total > result.pageSize && <Pagination route="/games" params={params} result={result} />}
      </TableShell>
    </>
  );
}

function TeamsContent({ result, params }: { result: PageResult<TeamListItem>; params: DashboardSearchParams }) {
  return (
    <TableShell title="Tim kompetisi" description="Games, menang, dan kalah dihitung dari skor laga selesai dalam kompetisi ini.">
      <Table>
        <caption className="sr-only">Daftar tim StatsArena</caption>
        <TableHeader><TableRow className="hover:bg-transparent"><TableHead className="pl-4">Tim</TableHead><TableHead>Source ID</TableHead><TableHead>GP</TableHead><TableHead>W</TableHead><TableHead>L</TableHead><TableHead>Sumber</TableHead></TableRow></TableHeader>
        <TableBody>
          {result.items.length === 0
            ? <TableEmptyRow colSpan={6} title="Belum ada tim" description="Kompetisi ini belum memiliki keikutsertaan tim di database." />
            : result.items.map((team) => <TableRow key={team.id}>
              <TableCell className="pl-4"><Link href={hrefWithQuery(`/teams/${team.sourceTeamId}`, params)} className="font-medium hover:text-primary hover:underline">{team.name}</Link></TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">{team.sourceTeamId}</TableCell>
              <TableCell>{formatCount(team.gamesPlayed)}</TableCell><TableCell>{formatCount(team.wins)}</TableCell><TableCell>{formatCount(team.losses)}</TableCell>
              <TableCell><SourceLink href={team.sourceUrl} /></TableCell>
            </TableRow>)}
        </TableBody>
      </Table>
      {result.total > result.pageSize && <Pagination route="/teams" params={params} result={result} />}
    </TableShell>
  );
}

function PlayersContent({ result, params }: { result: PageResult<PlayerListItem>; params: DashboardSearchParams }) {
  return (
    <TableShell title="Pemain kompetisi" description="Rata-rata memakai baris statistik dari laga selesai; tim hanya berasal dari catatan roster.">
      <Table>
        <caption className="sr-only">Daftar pemain StatsArena</caption>
        <TableHeader><TableRow className="hover:bg-transparent"><TableHead className="pl-4">Pemain</TableHead><TableHead>Source ID</TableHead><TableHead>GP</TableHead><TableHead>MIN</TableHead><TableHead>PTS</TableHead><TableHead>REB</TableHead><TableHead>AST</TableHead><TableHead>STL</TableHead><TableHead>BLK</TableHead><TableHead>Tim roster</TableHead></TableRow></TableHeader>
        <TableBody>
          {result.items.length === 0
            ? <TableEmptyRow colSpan={10} title="Belum ada pemain" description="Kompetisi ini belum memiliki keikutsertaan pemain di database." />
            : result.items.map((player) => <TableRow key={player.id}>
              <TableCell className="pl-4"><Link href={hrefWithQuery(`/players/${player.sourcePlayerId}`, params)} className="font-medium hover:text-primary hover:underline">{player.name}</Link></TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">{player.sourcePlayerId}</TableCell>
              <TableCell>{formatCount(player.gamesPlayed)}</TableCell><TableCell>{formatAverage(player.averageMinutes)}</TableCell>
              <TableCell>{formatAverage(player.pointsPerGame)}</TableCell><TableCell>{formatAverage(player.reboundsPerGame)}</TableCell><TableCell>{formatAverage(player.assistsPerGame)}</TableCell><TableCell>{formatAverage(player.stealsPerGame)}</TableCell><TableCell>{formatAverage(player.blocksPerGame)}</TableCell>
              <TableCell className="max-w-48 truncate text-xs">{player.teamNames.length > 0 ? player.teamNames.join(", ") : <span className="text-muted-foreground">—</span>}</TableCell>
            </TableRow>)}
        </TableBody>
      </Table>
      {result.total > result.pageSize && <Pagination route="/players" params={params} result={result} />}
    </TableShell>
  );
}

function StandingsContent({
  groups,
  rows,
  selectedGroupId,
  params,
}: {
  groups: Array<{ id: string; sourceGroupId: string; label: string; poolNumber: string | null; sourceUrl: string }>;
  rows: StandingListItem[];
  selectedGroupId: string | null;
  params: DashboardSearchParams;
}) {
  const selectedRequested = typeof params["group"] === "string" ? params["group"] : null;
  return (
    <>
      {groups.length > 0 && <nav aria-label="Filter grup klasemen" className="flex flex-wrap gap-2">
        <Link href={hrefWithQuery("/standings", params, { group: null })} aria-current={!selectedGroupId ? "page" : undefined} className={`rounded-md border px-3 py-1.5 text-xs ${!selectedGroupId ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}>Semua grup</Link>
        {groups.map((group) => <Link key={group.id} href={hrefWithQuery("/standings", params, { group: group.id })} aria-current={selectedGroupId === group.id ? "page" : undefined} className={`rounded-md border px-3 py-1.5 text-xs ${selectedGroupId === group.id ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}>{group.label}</Link>)}
      </nav>}
      {selectedRequested && !selectedGroupId && <p role="status" className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">Grup {selectedRequested} tidak ditemukan untuk kompetisi ini.</p>}
      {groups.length === 0
        ? <DataEmpty title="Klasemen belum tersedia" description="Belum ada grup dan klasemen resmi yang tersimpan untuk kompetisi ini." />
        : <TableShell title="Klasemen resmi" description="Urutan tim berasal dari posisi klasemen sumber dan setiap grup tetap terpisah.">
          <Table>
            <caption className="sr-only">Klasemen resmi StatsArena</caption>
            <TableHeader><TableRow className="hover:bg-transparent"><TableHead className="pl-4">Grup</TableHead><TableHead>Pos</TableHead><TableHead>Tim</TableHead><TableHead>GP</TableHead><TableHead>W</TableHead><TableHead>L</TableHead><TableHead>D</TableHead><TableHead>PF</TableHead><TableHead>PA</TableHead><TableHead>+/-</TableHead><TableHead>Poin</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.length === 0
                ? <TableEmptyRow colSpan={11} title="Belum ada baris klasemen" description="Grup kompetisi sudah tercatat, tetapi belum ada klasemen resmi untuk pilihan ini." />
                : rows.map((standing) => <TableRow key={`${standing.group.id}-${standing.team.id}`}>
                  <TableCell className="pl-4">{standing.group.label}</TableCell><TableCell>{formatCount(standing.position)}</TableCell>
                  <TableCell><Link href={hrefWithQuery(`/teams/${standing.team.sourceTeamId}`, params)} className="font-medium hover:text-primary hover:underline">{standing.team.name}</Link></TableCell>
                  <TableCell>{formatCount(standing.gamesPlayed)}</TableCell><TableCell>{formatCount(standing.wins)}</TableCell><TableCell>{formatCount(standing.losses)}</TableCell><TableCell>{formatCount(standing.draws)}</TableCell><TableCell>{formatCount(standing.pointsFor)}</TableCell><TableCell>{formatCount(standing.pointsAgainst)}</TableCell><TableCell>{formatCount(standing.pointDifference)}</TableCell><TableCell>{formatCount(standing.standingPoints)}</TableCell>
                </TableRow>)}
            </TableBody>
          </Table>
        </TableShell>}
    </>
  );
}

function ReviewContent({ summary, params }: { summary: ReviewSummary; params: DashboardSearchParams }) {
  const severity = typeof params["severity"] === "string" ? params["severity"] : "";
  const issueCode = typeof params["code"] === "string" ? params["code"] : "";
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard label="Isu total" value={formatCount(summary.totalIssues)} hint="Seluruh isu tersimpan dalam kompetisi ini" icon={<CircleAlert className="size-4" />} accent="info" />
        <KpiCard label="Run terakhir" value={summary.latestRun?.status ?? "—"} hint={summary.latestRun ? summary.latestRun.startedAt.toLocaleString("id-ID") : "Belum ada run"} icon={<CalendarDays className="size-4" />} />
        <KpiCard label="Parser" value={summary.latestRun?.parserVersion ?? "—"} hint={summary.latestRun?.mode ?? "Belum tersedia"} icon={<Shield className="size-4" />} />
      </div>
      <form method="get" action="/review" className="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-3">
        {typeof params["competition"] === "string" && <input type="hidden" name="competition" value={params["competition"]} />}
        <label className="grid gap-1 text-xs text-muted-foreground">Severity
          <select name="severity" defaultValue={severity} className="h-8 min-w-36 rounded-md border border-input bg-background px-2 text-xs text-foreground"><option value="">Semua</option><option value="error">Error</option><option value="warning">Warning</option><option value="info">Info</option></select>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">Jenis isu
          <select name="code" defaultValue={issueCode} className="h-8 min-w-48 rounded-md border border-input bg-background px-2 text-xs text-foreground"><option value="">Semua jenis</option>{summary.issueTypes.map((code) => <option key={code} value={code}>{code}</option>)}</select>
        </label>
        <button type="submit" className="h-8 rounded-md border px-3 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Terapkan</button>
      </form>
      <TableShell title="Isu validasi" description="Run terbaru diberi penanda sendiri agar bisa dibedakan dari histori sebelumnya.">
        <Table>
          <caption className="sr-only">Isu validasi StatsArena</caption>
          <TableHeader><TableRow className="hover:bg-transparent"><TableHead className="pl-4">Severity</TableHead><TableHead>Kode</TableHead><TableHead>Keterangan</TableHead><TableHead>Field</TableHead><TableHead>Pertandingan</TableHead><TableHead>Run</TableHead><TableHead>Waktu</TableHead><TableHead>Sumber</TableHead></TableRow></TableHeader>
          <TableBody>
            {summary.issues.items.length === 0
              ? <TableEmptyRow colSpan={8} title="Tidak ada isu" description="Tidak ada isu yang cocok dengan filter ini." />
              : summary.issues.items.map((issue) => <TableRow key={issue.id}>
                <TableCell className="pl-4"><span className={`rounded-md border px-2 py-0.5 text-[11px] ${issue.severity === "error" ? "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300" : issue.severity === "warning" ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300" : "border-border bg-muted text-muted-foreground"}`}>{issue.severity}</span></TableCell>
                <TableCell className="font-mono text-xs">{issue.code}</TableCell><TableCell className="max-w-[32rem] whitespace-normal text-xs">{issue.message}</TableCell><TableCell className="font-mono text-xs text-muted-foreground">{issue.fieldPath ?? "—"}</TableCell>
                <TableCell>{issue.game ? <Link href={hrefWithQuery(`/games/${issue.game.sourceGameId}`, params)} className="font-mono text-xs hover:text-primary hover:underline">{issue.game.sourceGameId}</Link> : <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell>{issue.isLatestRun ? <span className="text-xs font-medium text-primary">Run terbaru</span> : issue.importRun ? <span className="text-xs text-muted-foreground">Histori · {issue.importRun.status}</span> : <span className="text-xs text-muted-foreground">Tanpa run</span>}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{issue.createdAt.toLocaleString("id-ID")}</TableCell><TableCell><SourceLink href={issue.sourceUrl} /></TableCell>
              </TableRow>)}
          </TableBody>
        </Table>
        {summary.issues.total > summary.issues.pageSize && <Pagination route="/review" params={params} result={summary.issues} />}
      </TableShell>
      <SectionCard title="Riwayat impor" description="Ringkasan run tersimpan; halaman ini tidak memulai impor.">
        {summary.runs.length === 0 ? <p className="text-sm text-muted-foreground">Belum ada run impor.</p> : <div className="space-y-2">
          {summary.runs.map((run) => <RunSummary key={run.id} run={run} latest={run.id === summary.latestRun?.id} />)}
        </div>}
      </SectionCard>
    </>
  );
}

function RunSummary({ run, latest }: { run: ImportRunListItem; latest: boolean }) {
  const recordCounts = Object.entries(run.recordCounts).filter(([, value]) => typeof value === "number");
  return <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
    <div className="min-w-0"><p className="text-xs font-medium">{run.mode} · {run.status}{latest && <span className="ml-2 text-primary">Terbaru</span>}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{run.startedAt.toLocaleString("id-ID")} · parser {run.parserVersion}</p></div>
    <p className="text-[11px] text-muted-foreground">{recordCounts.map(([key, value]) => `${key} ${formatCount(value as number)}`).join(" · ") || "Jumlah record tidak tersedia"}</p>
  </div>;
}

function OverviewContent({ summary, params }: { summary: OverviewSummary; params: DashboardSearchParams }) {
  const cards = [
    { label: "Games", value: summary.games, icon: <CalendarDays className="size-4" />, hint: `${summary.completedGames} selesai · ${summary.liveGames} live · ${summary.scheduledGames} terjadwal` },
    { label: "Teams", value: summary.teams, icon: <Shield className="size-4" />, hint: "Keikutsertaan dalam kompetisi" },
    { label: "Players", value: summary.players, icon: <Users className="size-4" />, hint: "Keikutsertaan dalam kompetisi" },
    { label: "Groups", value: summary.groups, icon: <Trophy className="size-4" />, hint: "Grup sumber yang tersimpan" },
  ];
  return <>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map((card) => <KpiCard key={card.label} label={card.label} value={formatCount(card.value)} hint={card.hint} icon={card.icon} accent="info" />)}
    </div>
    <OperationalCard operations={summary.operations} />
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <TableShell title="Pertandingan terbaru" description="Skor dan waktu sumber, sesuai data yang tersimpan.">
        <div className="flex items-center justify-end border-b px-4 py-2"><Link href={hrefWithQuery("/games", params)} className="text-xs text-muted-foreground hover:text-foreground">Semua pertandingan</Link></div>
        <Table><caption className="sr-only">Pertandingan terbaru</caption><TableHeader><TableRow className="hover:bg-transparent"><TableHead className="pl-4">Pertandingan</TableHead><TableHead>Skor</TableHead><TableHead>Status</TableHead><TableHead>Waktu</TableHead></TableRow></TableHeader><TableBody>
          {summary.latestGames.length === 0 ? <TableEmptyRow colSpan={4} title="Belum ada pertandingan" description="Belum ada jadwal yang tersimpan." /> : summary.latestGames.map((game) => <TableRow key={game.id}><TableCell className="pl-4"><Link href={hrefWithQuery(`/games/${game.sourceGameId}`, params)} className="font-medium hover:text-primary hover:underline">{game.homeTeam?.name ?? "TBD"} vs {game.awayTeam?.name ?? "TBD"}</Link></TableCell><TableCell className="font-mono">{scoreLabel(game.homeScore, game.awayScore)}</TableCell><TableCell><StatusBadge status={game.status} /></TableCell><TableCell className="text-xs text-muted-foreground">{game.scheduledAtRaw ?? "—"}</TableCell></TableRow>)}
        </TableBody></Table>
      </TableShell>
      <TableShell title="Klasemen grup" description="Posisi pertama pada setiap grup sumber.">
        <Table><caption className="sr-only">Ringkasan klasemen per grup</caption><TableHeader><TableRow className="hover:bg-transparent"><TableHead className="pl-4">Grup</TableHead><TableHead>Pos</TableHead><TableHead>Tim</TableHead><TableHead>W-L</TableHead></TableRow></TableHeader><TableBody>
          {summary.standings.length === 0 ? <TableEmptyRow colSpan={4} title="Klasemen belum tersedia" description="Belum ada tabel klasemen resmi." /> : summary.standings.map((row) => <TableRow key={row.group.id}><TableCell className="pl-4">{row.group.label}</TableCell><TableCell>{formatCount(row.position)}</TableCell><TableCell>{row.team.name}</TableCell><TableCell>{formatCount(row.wins)}-{formatCount(row.losses)}</TableCell></TableRow>)}
        </TableBody></Table>
        <div className="border-t px-4 py-2"><Link href={hrefWithQuery("/standings", params)} className="text-xs text-muted-foreground hover:text-foreground">Semua klasemen</Link></div>
      </TableShell>
    </div>
    <TableShell title="Pemain" description="Peringkat PTS per laga pada pertandingan selesai; roster hanya dari hubungan tersimpan.">
      <Table><caption className="sr-only">Leaderboard pemain</caption><TableHeader><TableRow className="hover:bg-transparent"><TableHead className="pl-4">Pemain</TableHead><TableHead>Tim roster</TableHead><TableHead>GP</TableHead><TableHead>PTS</TableHead><TableHead>REB</TableHead><TableHead>AST</TableHead></TableRow></TableHeader><TableBody>
        {summary.leaderboard.length === 0 ? <TableEmptyRow colSpan={6} title="Leaderboard belum tersedia" description="Belum ada statistik pemain dari pertandingan selesai." /> : summary.leaderboard.map((player) => <TableRow key={player.id}><TableCell className="pl-4"><Link href={hrefWithQuery(`/players/${player.sourcePlayerId}`, params)} className="font-medium hover:text-primary hover:underline">{player.name}</Link></TableCell><TableCell className="text-xs text-muted-foreground">{player.teamNames.join(", ") || "—"}</TableCell><TableCell>{formatCount(player.gamesPlayed)}</TableCell><TableCell>{formatAverage(player.pointsPerGame)}</TableCell><TableCell>{formatAverage(player.reboundsPerGame)}</TableCell><TableCell>{formatAverage(player.assistsPerGame)}</TableCell></TableRow>)}
      </TableBody></Table>
      <div className="border-t px-4 py-2"><Link href={hrefWithQuery("/players", params)} className="text-xs text-muted-foreground hover:text-foreground">Semua pemain</Link></div>
    </TableShell>
  </>;
}

function OperationalCard({ operations }: { operations: OperationalStatus }) {
  const statusText = operations.isRunning ? "Sedang berjalan"
    : operations.isStale ? "Run terhenti; aman untuk dilanjutkan"
      : operations.latestStatus === "succeeded" ? "Berhasil"
        : operations.latestStatus === "partial" ? "Selesai dengan halaman/isu yang perlu diperiksa"
          : operations.latestStatus === "failed" ? "Gagal"
            : "Belum ada run operasional";
  const writes = operations.writeCounts;
  return <SectionCard title="Operasional sinkronisasi" description="Waktu pemeriksaan dipisahkan dari waktu konten sumber.">
    <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
      <p><span className="text-muted-foreground">Status</span><br /><span className="font-medium">{statusText}</span></p>
      <p><span className="text-muted-foreground">Pemeriksaan terakhir</span><br /><span className="font-medium">{operations.lastCheckedAt?.toLocaleString("id-ID") ?? "Belum tersedia"}</span></p>
      <p><span className="text-muted-foreground">HTML sumber terakhir diambil</span><br /><span className="font-medium">{operations.lastSourceFetchedAt?.toLocaleString("id-ID") ?? "Belum tersedia"}</span></p>
      <p><span className="text-muted-foreground">Jadwal berikutnya</span><br /><span className="font-medium">{operations.nextRunAt?.toLocaleString("id-ID") ?? "Belum dijadwalkan"}</span></p>
      <p><span className="text-muted-foreground">Laga baru / diperbarui</span><br /><span className="font-medium">{formatCount(writes["newGames"])} / {formatCount(writes["updatedGames"])}</span></p>
      <p><span className="text-muted-foreground">Halaman diperiksa</span><br /><span className="font-medium">{formatCount(operations.pageCount)}</span></p>
      <p><span className="text-muted-foreground">Halaman gagal/parsial · isu run terakhir</span><br /><span className="font-medium">{formatCount(operations.failureCount)} · {formatCount(operations.reviewIssueCount)}</span></p>
      <p><span className="text-muted-foreground">Hasil terakhir</span><br /><span className="font-medium">{operations.resultSummary ?? "Belum tersedia"}</span></p>
    </div>
    {operations.failureUrls.length > 0 && <div className="mt-3 border-t pt-3">
      <p className="mb-2 text-xs font-medium">Halaman untuk retry atau review</p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {operations.failureUrls.map((url) => <li key={url}><SourceLink href={url} /></li>)}
      </ul>
    </div>}
  </SectionCard>;
}

export async function DashboardPage({
  page,
  searchParams,
}: {
  page: DashboardPageKey;
  searchParams: Promise<DashboardSearchParams>;
}) {
  const params = await searchParams;
  const selected = parseCompetitionFilter(params["competition"]);
  const definition = dashboardPageDefinitions[page];
  const pageNumber = parsePage(params["page"]);

  if (selected.status !== "selected") {
    return <PageFrame definition={definition} competitionId={null} state={selected} competition={null}><DataEmpty title={selected.status === "invalid" ? "Perbaiki pilihan kompetisi" : "Kompetisi belum dipilih"} description={selected.status === "invalid" ? "Pilih satu kompetisi dari daftar di bagian atas." : "Pilih kompetisi di bagian atas untuk membuka data yang tersimpan di Neon."} /></PageFrame>;
  }

  const competitionResult = await readCompetition(selected.sourceCompetitionId);
  if (competitionResult.status === "unavailable") {
    return <PageFrame definition={definition} competitionId={selected.sourceCompetitionId} state={selected} competition={null} competitionUnavailable><DataError message={competitionResult.message} /></PageFrame>;
  }
  const competition = competitionResult.data;
  if (!competition) {
    return <PageFrame definition={definition} competitionId={selected.sourceCompetitionId} state={selected} competition={null}><DataNotFound title="Kompetisi tidak ditemukan" description={`Source ID ${selected.sourceCompetitionId} belum tercatat di Neon StatsArena.`} backHref="/" /></PageFrame>;
  }

  if (page === "overview") {
    const result = await readOverview(competition.id);
    return <PageFrame definition={definition} competitionId={selected.sourceCompetitionId} state={selected} competition={competition}>{result.status === "error" ? <DataError message={result.message} /> : <OverviewContent summary={result.data} params={params} />}</PageFrame>;
  }
  if (page === "games") {
    const result = await readGames(competition.id, parseGameListFilters(params));
    return <PageFrame definition={definition} competitionId={selected.sourceCompetitionId} state={selected} competition={competition}>{result.status === "error" ? <DataError message={result.message} /> : <GamesContent result={result.data} competitionId={selected.sourceCompetitionId} params={params} />}</PageFrame>;
  }
  if (page === "teams") {
    const result = await readTeams(competition.id, pageNumber);
    return <PageFrame definition={definition} competitionId={selected.sourceCompetitionId} state={selected} competition={competition}>{result.status === "error" ? <DataError message={result.message} /> : <TeamsContent result={result.data} params={params} />}</PageFrame>;
  }
  if (page === "players") {
    const result = await readPlayers(competition.id, pageNumber);
    return <PageFrame definition={definition} competitionId={selected.sourceCompetitionId} state={selected} competition={competition}>{result.status === "error" ? <DataError message={result.message} /> : <PlayersContent result={result.data} params={params} />}</PageFrame>;
  }
  if (page === "standings") {
    const result = await readStandings(competition.id, parseStandingsFilters(params));
    return <PageFrame definition={definition} competitionId={selected.sourceCompetitionId} state={selected} competition={competition}>{result.status === "error" ? <DataError message={result.message} /> : <StandingsContent {...result.data} params={params} />}</PageFrame>;
  }
  const result = await readReview(competition.id, parseReviewFilters(params));
  return <PageFrame definition={definition} competitionId={selected.sourceCompetitionId} state={selected} competition={competition}>{result.status === "error" ? <DataError message={result.message} /> : <ReviewContent summary={result.data} params={params} />}</PageFrame>;
}

function PageFrame({
  definition,
  competitionId,
  state,
  competition,
  competitionUnavailable = false,
  children,
}: {
  definition: { title: string; description: string };
  competitionId: string | null;
  state: ReturnType<typeof parseCompetitionFilter>;
  competition: CompetitionOption | null;
  competitionUnavailable?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="w-full space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-lg font-semibold tracking-tight sm:text-xl">{definition.title}</h1><p className="mt-0.5 text-sm text-muted-foreground">{definition.description}</p></div>
        {competitionId && <div className="rounded-md border bg-muted/30 px-2.5 py-1.5 font-mono text-xs text-muted-foreground">Competition ID · {competitionId}</div>}
      </div>
      <CompetitionNotice state={state} competition={competition} unavailable={competitionUnavailable} />
      {children}
    </div>
  );
}
