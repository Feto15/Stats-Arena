import { DETAIL_DATASETS, QUALITY_LABELS, qualityIssueEvidence } from "@statsarena/db/data-quality";
import Link from "next/link";
import { CalendarDays, Clock3, ExternalLink, Trophy } from "lucide-react";
import { KpiCard } from "@/components/dashboard-ui/kpi-card";
import { SectionCard } from "@/components/dashboard-ui/section-card";
import {
  DataEmpty,
  DataError,
  DataNotFound,
  SourceLink,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  formatAverage,
  formatCount,
  formatPercent,
  hrefWithQuery,
  scoreLabel,
} from "@/components/pages/data-ui";
import type { DashboardSearchParams } from "@/lib/competition-scope";
import type { GameDetail, GameDetailFilters, PlayerSummary, TeamSummary } from "@/lib/data/contracts";
import { boxScoreStateMessage } from "@/lib/data/box-score-state";
import { safeSourceHref } from "@/lib/data/server";
import { liveStatsStatusLabels } from "@/lib/data/livestats-status";
import { selectTeamMetrics, TEAM_METRIC_CODES } from "@/lib/data/team-metrics";

function DetailHeader({
  eyebrow,
  title,
  subtitle,
  backHref,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  backHref: string;
}) {
  return <div className="space-y-1">
    <Link href={backHref} className="text-xs text-muted-foreground hover:text-foreground hover:underline">← Kembali ke {eyebrow}</Link>
    <h1 className="text-lg font-semibold tracking-tight sm:text-xl">{title}</h1>
    <p className="text-sm text-muted-foreground">{subtitle}</p>
  </div>;
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3 border-b py-2 last:border-b-0"><span className="text-xs text-muted-foreground">{label}</span><span className="text-xs font-medium tabular-nums">{value}</span></div>;
}

function TeamStatSection({ game }: { game: GameDetail }) {
  const teams = [game.homeTeamStats, game.awayTeamStats].filter((item) => item !== null);
  if (teams.length === 0) return <DataEmpty title="Statistik tim belum tersedia" description={game.status === "scheduled" ? "Pertandingan belum berjalan; statistik belum tersedia dan tidak diisi dengan angka nol." : "Ringkasan statistik tim belum tersimpan untuk pertandingan ini."} />;
  return <SectionCard title="Statistik tim resmi" description="Angka mengikuti box score sumber. Jika kolom 2P tidak disediakan, 2PM = FGM − 3PM dan 2PA = FGA − 3PA dihitung dari angka sumber; metadata rumus disimpan.">
    <Table><caption className="sr-only">Statistik tim pertandingan</caption><TableHeader><TableRow className="hover:bg-transparent"><TableHead>Tim</TableHead><TableHead>MIN</TableHead><TableHead>FG</TableHead><TableHead>2P</TableHead><TableHead>3P</TableHead><TableHead>FT</TableHead><TableHead>REB</TableHead><TableHead>AST</TableHead><TableHead>STL</TableHead><TableHead>BLK</TableHead><TableHead>TO</TableHead><TableHead>PTS</TableHead></TableRow></TableHeader><TableBody>
      {teams.map((stats) => <TableRow key={stats.team.id}><TableCell className="font-medium">{stats.team.name}</TableCell><TableCell>{formatAverage(stats.minutes)}</TableCell><TableCell>{formatCount(stats.fieldGoalsMade)}/{formatCount(stats.fieldGoalsAttempted)} <span className="text-muted-foreground">{formatPercent(stats.fieldGoalPct)}</span></TableCell><TableCell>{formatCount(stats.twoPointsMade)}/{formatCount(stats.twoPointAttempts)}</TableCell><TableCell>{formatCount(stats.threePointsMade)}/{formatCount(stats.threePointAttempts)} <span className="text-muted-foreground">{formatPercent(stats.threePointPct)}</span></TableCell><TableCell>{formatCount(stats.freeThrowsMade)}/{formatCount(stats.freeThrowAttempts)} <span className="text-muted-foreground">{formatPercent(stats.freeThrowPct)}</span></TableCell><TableCell>{formatCount(stats.rebounds)}</TableCell><TableCell>{formatCount(stats.assists)}</TableCell><TableCell>{formatCount(stats.steals)}</TableCell><TableCell>{formatCount(stats.blocks)}</TableCell><TableCell>{formatCount(stats.turnovers)}</TableCell><TableCell>{formatCount(stats.points)}</TableCell></TableRow>)}
    </TableBody></Table>
  </SectionCard>;
}

function PlayerBoxScore({ game }: { game: GameDetail }) {
  const emptyMessage = game.status === "scheduled"
    ? "Pertandingan belum berjalan; statistik belum tersedia dan tidak diisi dengan angka nol."
    : "Box score pemain belum tersedia.";
  return <SectionCard title="Box score pemain" description="Baris individu saja; nilai yang tidak disediakan tetap ditampilkan sebagai —.">
    <Table><caption className="sr-only">Box score pemain pertandingan</caption><TableHeader><TableRow className="hover:bg-transparent"><TableHead className="pl-4">Pemain</TableHead><TableHead>Tim</TableHead><TableHead>MIN</TableHead><TableHead>FG</TableHead><TableHead>3P</TableHead><TableHead>FT</TableHead><TableHead>REB</TableHead><TableHead>AST</TableHead><TableHead>STL</TableHead><TableHead>BLK</TableHead><TableHead>TO</TableHead><TableHead>PF</TableHead><TableHead>PTS</TableHead></TableRow></TableHeader><TableBody>
      {game.playerStats.length === 0 ? <TableRow><TableCell colSpan={13} className="p-0"><div className="p-8 text-center text-sm text-muted-foreground">{emptyMessage}</div></TableCell></TableRow> : game.playerStats.map((stats) => <TableRow key={stats.player.id}><TableCell className="pl-4"><span className="font-medium">{stats.player.name}</span><span className="ml-2 font-mono text-[10px] text-muted-foreground">{stats.player.sourcePlayerId}</span></TableCell><TableCell>{stats.team.name}</TableCell><TableCell title={stats.minutesRaw ?? undefined}>{formatAverage(stats.minutes)}</TableCell><TableCell>{formatCount(stats.fieldGoalsMade)}/{formatCount(stats.fieldGoalsAttempted)}</TableCell><TableCell>{formatCount(stats.threePointsMade)}/{formatCount(stats.threePointAttempts)}</TableCell><TableCell>{formatCount(stats.freeThrowsMade)}/{formatCount(stats.freeThrowAttempts)}</TableCell><TableCell>{formatCount(stats.rebounds)}</TableCell><TableCell>{formatCount(stats.assists)}</TableCell><TableCell>{formatCount(stats.steals)}</TableCell><TableCell>{formatCount(stats.blocks)}</TableCell><TableCell>{formatCount(stats.turnovers)}</TableCell><TableCell>{formatCount(stats.personalFouls)}</TableCell><TableCell>{formatCount(stats.points)}</TableCell></TableRow>)}
    </TableBody></Table>
  </SectionCard>;
}

function LiveStatsSection({ game }: { game: GameDetail }) {
  const extra = game.liveStats;
  const payload = extra?.payload;
  return <SectionCard title="Statistik tambahan LiveStats" description="Plus/minus, starter, dan metrik resmi pertandingan dari LiveStats. Statistik dasar tetap mengikuti portal.">
    <p className="mb-3 text-xs text-muted-foreground">{extra ? liveStatsStatusLabels[extra.status] : game.status === "scheduled" ? "Pertandingan belum berjalan." : "Belum disinkronkan."}
      {extra?.sourceFetchedAt && ` · Data ${extra.sourceFetchedAt.toLocaleString("id-ID")}`}
      {payload && extra?.status !== "ready" && " · Nilai terverifikasi tetap ditampilkan; sebagian tambahan perlu diperiksa."}</p>
    {payload && <>
      <Table><caption className="sr-only">Statistik tambahan pemain LiveStats</caption><TableHeader><TableRow><TableHead>Pemain</TableHead><TableHead>Starter</TableHead><TableHead>POS</TableHead><TableHead>+/−</TableHead><TableHead>BLKR</TableHead><TableHead>Fouls drawn</TableHead><TableHead>2CP</TableHead><TableHead>FBP</TableHead><TableHead>PIP</TableHead><TableHead>Index</TableHead></TableRow></TableHeader><TableBody>
        {payload.players.map(player => <TableRow key={player.playerId}><TableCell>{player.name}</TableCell><TableCell>{player.starter === null ? "—" : player.starter ? "Ya" : "Bench"}</TableCell><TableCell>{player.position ?? "—"}</TableCell><TableCell>{player.plusMinus === null ? "—" : player.plusMinus > 0 ? `+${player.plusMinus}` : player.plusMinus}</TableCell><TableCell>{formatCount(player.blocksReceived)}</TableCell><TableCell>{formatCount(player.foulsDrawn)}</TableCell><TableCell>{formatCount(player.secondChancePoints)}</TableCell><TableCell>{formatCount(player.fastBreakPoints)}</TableCell><TableCell>{formatCount(player.pointsInPaint)}</TableCell><TableCell>{formatCount(player.indexOfSuccess)}</TableCell></TableRow>)}
      </TableBody></Table>
      <p className="mt-2 text-xs text-muted-foreground">Index mengikuti “Index of Success” sumber; bukan BPM. BLKR: tembakan diblok lawan. BP: poin pemain cadangan. 2CP: poin kesempatan kedua.</p>
    </>}
    {extra && <div className="mt-3 text-xs"><SourceLink href={extra.pageUrl}>Box score LiveStats</SourceLink></div>}
    {Boolean(extra?.issues.length) && <ul className="mt-3 space-y-1 text-xs text-muted-foreground">{extra!.issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.code}: {issue.message}</li>)}</ul>}
  </SectionCard>;
}

function BoxScoreState({ game }: { game: GameDetail }) {
  const hasStoredStats = Boolean(game.homeTeamStats || game.awayTeamStats || game.playerStats.length > 0);
  const message = boxScoreStateMessage({
    gameStatus: game.status,
    hasStoredStats,
    fetchStatus: game.boxscoreFetch?.fetchStatus ?? null,
    parseStatus: game.boxscoreFetch?.parseStatus ?? null,
  });

  return message ? <div role="status" className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">{message}</div> : null;
}

function FetchCard({ title, fetch }: { title: string; fetch: GameDetail["summaryFetch"] }) {
  if (!fetch) return <SectionCard title={title}><p className="text-xs text-muted-foreground">Provenance fetch belum tersimpan.</p></SectionCard>;
  const href = safeSourceHref(fetch.requestUrl);
  return <SectionCard title={title}>
    <div className="grid gap-x-6 sm:grid-cols-2">
      <MetricRow label="Status fetch" value={`${fetch.fetchStatus} · HTTP ${fetch.httpStatus ?? "—"}`} />
      <MetricRow label="Status parsing" value={fetch.parseStatus} />
      <MetricRow label="Diambil" value={fetch.fetchedAt?.toLocaleString("id-ID") ?? "—"} />
      <MetricRow label="Durasi" value={fetch.durationMs === null ? "—" : `${fetch.durationMs} ms`} />
      <MetricRow label="Ukuran" value={fetch.responseBytes === null ? "—" : `${formatCount(fetch.responseBytes)} byte`} />
      <MetricRow label="SHA-256" value={fetch.sha256 ? `${fetch.sha256.slice(0, 16)}…` : "—"} />
    </div>
    {href && <a href={href} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline">Buka URL fetch <ExternalLink className="size-3" aria-hidden="true" /></a>}
  </SectionCard>;
}

function DetailFilters({ game, params, filters }: { game: GameDetail; params: DashboardSearchParams; filters: GameDetailFilters }) {
  const competition = Array.isArray(params["competition"]) ? params["competition"][0] : params["competition"];
  const players = [...new Map(game.playerStats.map((entry) => [entry.player.sourcePlayerId, entry.player])).values()];
  const currentPlayer = players.find((player) => player.sourcePlayerId === filters.playerSourceId);
  return <SectionCard title="Filter detail pertandingan" description="Filter periode, tim, dan pemain berlaku ke event serta tembakan. Hasil berlaku ke shot chart.">
    <form action={`/games/${game.sourceGameId}`} method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
      {competition && <input type="hidden" name="competition" value={competition} />}
      <label className="grid gap-1 text-xs font-medium">Periode
        <input name="period" type="number" min="1" max="10" defaultValue={filters.periodNumber ?? ""} inputMode="numeric" className="h-9 rounded-md border bg-background px-3 text-sm font-normal" placeholder="Semua" />
      </label>
      <label className="grid gap-1 text-xs font-medium">Tim
        <select name="team" defaultValue={filters.teamSourceId ?? ""} className="h-9 rounded-md border bg-background px-3 text-sm font-normal">
          <option value="">Semua tim</option>
          {[game.homeTeam, game.awayTeam].filter((team) => team !== null).map((team) => <option key={team.id} value={team.sourceTeamId}>{team.name}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-xs font-medium">Pemain
        <select name="player" defaultValue={currentPlayer?.sourcePlayerId ?? ""} className="h-9 rounded-md border bg-background px-3 text-sm font-normal">
          <option value="">Semua pemain</option>
          {players.map((player) => <option key={player.id} value={player.sourcePlayerId}>{player.name}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-xs font-medium">Hasil tembakan
        <select name="result" defaultValue={filters.result ?? ""} className="h-9 rounded-md border bg-background px-3 text-sm font-normal">
          <option value="">Masuk dan meleset</option><option value="made">Masuk</option><option value="missed">Meleset</option>
        </select>
      </label>
      <div className="flex gap-2">
        <button type="submit" className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Terapkan</button>
        <Link href={hrefWithQuery(`/games/${game.sourceGameId}`, params, { period: null, team: null, player: null, result: null })} className="inline-flex h-9 items-center rounded-md border px-3 text-sm hover:bg-muted">Reset</Link>
      </div>
    </form>
  </SectionCard>;
}

function PlayByPlaySection({ game }: { game: GameDetail }) {
  const fetch = game.detailFetches.find((entry) => entry.resource === "playbyplay") ?? null;
  const unavailableText = game.status === "scheduled" ? "Pertandingan belum dimulai."
    : !fetch ? "Halaman play-by-play belum tercatat pada sumber untuk pertandingan ini."
      : fetch.fetchStatus === "failed" || fetch.parseStatus === "failed" ? "Play-by-play gagal dimuat atau diparse; data valid tersimpan sebelumnya tetap dipakai."
        : fetch.parseStatus === "partial" ? "Halaman hanya diparse sebagian; hasil yang ditampilkan mengikuti data valid tersimpan sebelumnya."
          : "Tidak ada event untuk filter yang dipilih.";
  return <SectionCard title="Play-by-play" description="Urutan dan jam mentah mengikuti HTML sumber. Pemain ditautkan hanya jika sumber menyediakan ID eksplisit.">
    {!game.playByPlayEvents.length ? <div role="status" className="py-7 text-center text-sm text-muted-foreground">{unavailableText}</div> :
      <Table><caption className="sr-only">Event play-by-play pertandingan</caption><TableHeader><TableRow className="hover:bg-transparent"><TableHead>Periode</TableHead><TableHead>Waktu sumber</TableHead><TableHead>Aksi</TableHead><TableHead>Tim</TableHead><TableHead>Skor sumber</TableHead></TableRow></TableHeader><TableBody>
        {game.playByPlayEvents.map((event) => <TableRow key={event.sourceSequence}><TableCell>{event.periodLabelRaw ?? event.periodNumber ?? "—"}</TableCell><TableCell className="font-mono text-xs">{event.timeRaw ?? "—"}</TableCell><TableCell><span className="font-medium">{event.actionText ?? event.actionType}</span>{event.playerName && <span className="ml-2 text-xs text-muted-foreground">{event.playerName}</span>}</TableCell><TableCell>{event.team?.name ?? (event.teamSide === "neutral" ? "Netral" : "—")}</TableCell><TableCell className="font-mono text-xs">{event.scoreRaw ?? "—"}</TableCell></TableRow>)}
      </TableBody></Table>}
    <div className="mt-3 border-t pt-2 text-xs"><SourceLink href={fetch?.requestUrl}>Play-by-play source · {fetch?.parseStatus ?? "belum tercatat"}</SourceLink></div>
  </SectionCard>;
}

function ShotChartSection({ game }: { game: GameDetail }) {
  const fetch = game.detailFetches.find((entry) => entry.resource === "shotchart") ?? null;
  const made = game.shots.filter((shot) => shot.result === "made").length;
  const chartDescription = game.shots.length
    ? `Koordinat mengikuti kanvas sumber. Menampilkan ${game.shots.length} tembakan · ${made} masuk · ${game.shots.length - made} meleset.`
    : "Koordinat mengikuti kanvas sumber. Tembakan belum tersedia untuk status pertandingan atau filter ini.";
  const unavailableText = game.status === "scheduled" ? "Pertandingan belum dimulai."
    : !fetch ? "Halaman shot chart belum tercatat pada sumber untuk pertandingan ini."
      : fetch.fetchStatus === "failed" || fetch.parseStatus === "failed" ? "Shot chart gagal dimuat atau diparse; data valid tersimpan sebelumnya tetap dipakai."
        : fetch.parseStatus === "partial" ? "Halaman hanya diparse sebagian; hasil yang ditampilkan mengikuti data valid tersimpan sebelumnya."
          : "Tidak ada tembakan untuk filter yang dipilih.";
  return <SectionCard title="Shot chart" description={chartDescription}>
    {!game.shots.length ? <div role="status" className="py-7 text-center text-sm text-muted-foreground">{unavailableText}</div> : <>
      <div className="overflow-hidden rounded-lg border bg-muted/20 p-2 sm:p-4">
        <svg viewBox="0 0 100 100" role="img" aria-label={`Shot chart, ${game.shots.length} tembakan ditampilkan`} className="mx-auto max-h-[min(75vh,42rem)] w-full">
          <rect x="1" y="1" width="98" height="98" rx="3" fill="none" stroke="currentColor" strokeOpacity=".25" />
          <path d="M1 50H99 M50 1V99" stroke="currentColor" strokeOpacity=".12" strokeDasharray="1 2" />
          {game.shots.map((shot) => <circle key={shot.sourceSequence} cx={shot.xPercent} cy={shot.yPercent} r={shot.shotType === "3pt" ? 1.65 : 1.35} fill={shot.result === "made" ? (shot.team.sourceTeamId === game.homeTeam?.sourceTeamId ? "#087e8b" : "#e76f51") : "#ffffff"} stroke={shot.result === "made" ? "#15343b" : (shot.team.sourceTeamId === game.homeTeam?.sourceTeamId ? "#087e8b" : "#e76f51")} strokeWidth=".55"><title>{`${shot.player.name} · ${shot.team.name} · ${shot.shotType} · ${shot.result === "made" ? "masuk" : "meleset"} · x ${shot.xRaw}, y ${shot.yRaw}`}</title></circle>)}
        </svg>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
        <span>● Masuk</span><span>○ Meleset</span>
        {game.homeTeam && <span><span className="mr-1 text-[#087e8b]">●</span>{game.homeTeam.name}</span>}
        {game.awayTeam && <span><span className="mr-1 text-[#e76f51]">●</span>{game.awayTeam.name}</span>}
      </div>
    </>}
    <div className="mt-3 border-t pt-2 text-xs"><SourceLink href={fetch?.requestUrl}>Shot chart source · {fetch?.parseStatus ?? "belum tercatat"}</SourceLink></div>
  </SectionCard>;
}

function DatasetStatus({ game }: { game: GameDetail }) {
  if (!game.datasetQuality) return null;
  const labels = { summary: "Ringkasan", boxScore: "Box score", playByPlay: "Play by play", shotChart: "Shot chart", analysis: "Metrik resmi" };
  const statuses = { parsed: "Lengkap", partial: "Parsial", failed: "Gagal diperiksa", scheduled: "Belum bertanding", unavailable: "Belum tersedia" };
  return <SectionCard title="Kelengkapan data" description="Status detail diperiksa terpisah dari hasil pertandingan. Statistik valid terakhir tetap ditampilkan ketika pemeriksaan baru bermasalah.">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{DETAIL_DATASETS.map((dataset) => {
      const state = game.datasetQuality![dataset];
      return <div key={dataset} className="rounded-md border p-3 text-xs">
        <p className="font-semibold">{labels[dataset]} · {statuses[state.status]}</p>
        {state.category && <p className="mt-1 text-muted-foreground">{QUALITY_LABELS[state.category]}</p>}
        {state.issues.filter((issue) => issue.severity === "error").map((issue, index) => <p key={index} className="mt-2 text-muted-foreground">{issue.message} {qualityIssueEvidence(issue)}</p>)}
        {state.nextRetryAt && <p className="mt-2 text-muted-foreground">Pemeriksaan rutin paling cepat: {new Date(state.nextRetryAt).toLocaleString("id-ID")}</p>}
      </div>;
    })}</div>
  </SectionCard>;
}

function GameReviewIssues({ game, params }: { game: GameDetail; params: DashboardSearchParams }) {
  if (!game.validationIssues.length) return null;
  return <SectionCard title={`Catatan dan isu data · ${game.validationIssues.length}`} description="Isu dari pemeriksaan detail terakhir. Riwayat lengkap tersedia pada Review; nilai sumber tidak dikoreksi diam-diam.">
    <ul className="divide-y">
      {game.validationIssues.map((entry) => <li key={entry.id} className="flex flex-col gap-2 py-3 first:pt-0 sm:flex-row sm:items-start sm:justify-between">
        <div><p className="text-sm font-medium">{entry.code} <span className="ml-2 rounded border px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">{entry.severity}</span></p><p className="mt-1 text-xs text-muted-foreground">{entry.message} {qualityIssueEvidence(entry)}</p>{entry.fieldPath && <p className="mt-1 font-mono text-[10px] text-muted-foreground">{entry.fieldPath}</p>}</div>
        <div className="flex shrink-0 gap-3 text-xs"><SourceLink href={entry.sourceUrl}>Sumber isu</SourceLink><Link className="text-primary underline-offset-4 hover:underline" href={hrefWithQuery("/review", params, { code: entry.code })}>Buka Review</Link></div>
      </li>)}
    </ul>
  </SectionCard>;
}

function GameOfficialMetrics({ game }: { game: GameDetail }) {
  const rows = selectTeamMetrics(game);
  return <SectionCard title="Metrik tim per pertandingan" description="Portal menjadi sumber utama untuk nilai yang tersedia dan valid. LiveStats melengkapi nilai yang belum tersedia. Total kompetisi tidak dipakai sebagai nilai laga.">
    <Table><caption className="sr-only">Metrik resmi tambahan per tim</caption><TableHeader><TableRow className="hover:bg-transparent"><TableHead>Tim</TableHead>{TEAM_METRIC_CODES.map(metric => <TableHead key={metric}>{metric}</TableHead>)}</TableRow></TableHeader><TableBody>
      {rows.map(({team, metrics}) => <TableRow key={team.id}><TableCell>{team.name}</TableCell>{metrics.map(metric => <TableCell key={metric.code}><span className="font-medium">{formatCount(metric.value)}</span>{metric.source && <div className="mt-1 text-[10px] text-muted-foreground"><SourceLink href={metric.sourceUrl}>{metric.source === "portal" ? "Portal" : "LiveStats"}</SourceLink></div>}{metric.conflict && <p className="mt-1 whitespace-normal text-xs text-amber-700 dark:text-amber-300">Berbeda · LiveStats: {metric.liveValue}</p>}</TableCell>)}</TableRow>)}
    </TableBody></Table>
    <p className="mt-3 text-xs text-muted-foreground">PIP: poin di paint · PFT: poin dari turnover · FBP: poin fast break · 2CP: poin kesempatan kedua · BP: poin pemain cadangan. Nilai berbeda tetap dipisahkan menurut sumber.</p>
  </SectionCard>;
}

function DetailFetchCard({ fetch }: { fetch: GameDetail["detailFetches"][number] }) {
  return <SectionCard title={`${fetch.resource} source`}>
    <div className="grid gap-x-5 sm:grid-cols-2"><MetricRow label="Fetch" value={`${fetch.fetchStatus} · HTTP ${fetch.httpStatus ?? "—"}`} /><MetricRow label="Parsing" value={fetch.parseStatus} /><MetricRow label="Diambil" value={fetch.fetchedAt?.toLocaleString("id-ID") ?? "—"} /><MetricRow label="SHA-256" value={fetch.sha256 ? `${fetch.sha256.slice(0, 16)}…` : "—"} /></div>
    <div className="mt-2 text-xs"><SourceLink href={fetch.requestUrl}>Buka URL sumber</SourceLink></div>
  </SectionCard>;
}

export function GameDetailView({ game, params, filters }: { game: GameDetail; params: DashboardSearchParams; filters: GameDetailFilters }) {
  const sourceId = game.sourceGameId;
  return <div className="space-y-4">
    <DetailHeader eyebrow="Games" title={`${game.homeTeam?.name ?? "TBD"} vs ${game.awayTeam?.name ?? "TBD"}`} subtitle={`Game ID ${sourceId}`} backHref={hrefWithQuery("/games", params)} />
    <SectionCard>
      <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-center">
        <div className="text-center md:text-right"><p className="text-sm font-medium">{game.homeTeam?.name ?? "TBD"}</p><p className="mt-1 font-mono text-3xl font-semibold tabular-nums">{game.homeScore ?? "—"}</p></div>
        <div className="text-center"><StatusBadge status={game.status} /><p className="mt-2 font-mono text-xs text-muted-foreground">{scoreLabel(game.homeScore, game.awayScore)}</p></div>
        <div className="text-center md:text-left"><p className="text-sm font-medium">{game.awayTeam?.name ?? "TBD"}</p><p className="mt-1 font-mono text-3xl font-semibold tabular-nums">{game.awayScore ?? "—"}</p></div>
      </div>
      <div className="mt-4 grid gap-2 border-t pt-3 text-xs text-muted-foreground sm:grid-cols-3">
        <p className="inline-flex items-center gap-1"><CalendarDays className="size-3.5" aria-hidden="true" />Waktu sumber: {game.scheduledAtRaw ?? "—"}</p>
        <p className="inline-flex items-center gap-1"><Clock3 className="size-3.5" aria-hidden="true" />Zona waktu tidak ditafsirkan</p>
        <p>Venue: {game.venue ?? "—"}</p>
      </div>
      <div className="mt-3 flex flex-wrap gap-4 border-t pt-3 text-xs"><SourceLink href={game.sourceUrl}>Halaman pertandingan</SourceLink></div>
    </SectionCard>
    <BoxScoreState game={game} />
    <DatasetStatus game={game} />
    <DetailFilters game={game} params={params} filters={filters} />
    <GameReviewIssues game={game} params={params} />
    <TeamStatSection game={game} />
    <PlayerBoxScore game={game} />
    <LiveStatsSection game={game} />
    <PlayByPlaySection game={game} />
    <ShotChartSection game={game} />
    <GameOfficialMetrics game={game} />
    {game.detailFetches.length > 0 && <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{game.detailFetches.map((fetch) => <DetailFetchCard key={fetch.id} fetch={fetch} />)}</div>}
    <div className="grid gap-4 md:grid-cols-2"><FetchCard title="Summary source" fetch={game.summaryFetch} /><FetchCard title="Box score source" fetch={game.boxscoreFetch} /></div>
  </div>;
}

export function TeamDetailView({ team, params }: { team: TeamSummary; params: DashboardSearchParams }) {
  return <div className="space-y-4">
    <DetailHeader eyebrow="Teams" title={team.team.name} subtitle={`Team source ID ${team.team.sourceTeamId}`} backHref={hrefWithQuery("/teams", params)} />
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      <KpiCard label="GP" value={formatCount(team.team.gamesPlayed)} icon={<CalendarDays className="size-4" />} />
      <KpiCard label="W-L" value={`${team.team.wins}-${team.team.losses}`} icon={<Trophy className="size-4" />} />
      <KpiCard label="PTS total" value={formatCount(team.totals?.points)} hint="Box score tim laga selesai" />
      <KpiCard label="REB total" value={formatCount(team.totals?.rebounds)} />
      <KpiCard label="AST total" value={formatCount(team.totals?.assists)} />
    </div>
    <SectionCard title="Statistik agregat tim" description="Total dijumlahkan dari team box score pada laga selesai; persentase dihitung dari made ÷ attempts.">
      {!team.totals ? <p className="text-sm text-muted-foreground">Statistik tim belum tersedia.</p> : <div className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
        <MetricRow label="FG" value={`${formatCount(team.totals.fieldGoalsMade)}/${formatCount(team.totals.fieldGoalsAttempted)} · ${formatPercent(team.totals.fieldGoalPct)}`} />
        <MetricRow label="2P" value={`${formatCount(team.totals.twoPointsMade)}/${formatCount(team.totals.twoPointAttempts)} · ${formatPercent(team.totals.twoPointPct)}`} />
        <MetricRow label="3P" value={`${formatCount(team.totals.threePointsMade)}/${formatCount(team.totals.threePointAttempts)} · ${formatPercent(team.totals.threePointPct)}`} />
        <MetricRow label="FT" value={`${formatCount(team.totals.freeThrowsMade)}/${formatCount(team.totals.freeThrowAttempts)} · ${formatPercent(team.totals.freeThrowPct)}`} />
        <MetricRow label="Rebound" value={`${formatCount(team.totals.offensiveRebounds)} OREB · ${formatCount(team.totals.defensiveRebounds)} DREB · ${formatCount(team.totals.rebounds)} total`} />
        <MetricRow label="AST · STL · BLK · TO · PF" value={`${formatCount(team.totals.assists)} · ${formatCount(team.totals.steals)} · ${formatCount(team.totals.blocks)} · ${formatCount(team.totals.turnovers)} · ${formatCount(team.totals.personalFouls)}`} />
      </div>}
      <div className="mt-3 border-t pt-2 text-xs"><SourceLink href={team.team.sourceUrl}>Sumber tim</SourceLink></div>
    </SectionCard>
    <SectionCard title="Total resmi kompetisi" description="BP dan 2CP adalah agregat Team Statistics pada scope kompetisi, dengan games played dari kolom sumber.">
      {team.officialMetrics.length === 0 ? <p className="text-sm text-muted-foreground">Total resmi BP/2CP belum tersedia.</p> : <div className="grid gap-x-8 sm:grid-cols-2">{team.officialMetrics.map((metric) => <MetricRow key={metric.metricCode} label={`${metric.metricCode} · ${metric.sampleGamesPlayed ?? "—"} GP`} value={metric.availability === "available" ? formatCount(metric.value) : "Tidak tersedia"} />)}</div>}
      {team.officialMetrics[0] && <div className="mt-3 border-t pt-2 text-xs"><SourceLink href={team.officialMetrics[0].sourceUrl}>Team Statistics source</SourceLink></div>}
    </SectionCard>
    <SectionCard title="Roster tersimpan" description="Hubungan pemain–tim hanya berasal dari catatan team_rosters yang diimpor.">
      {team.roster.length === 0 ? <p className="text-sm text-muted-foreground">Belum ada hubungan roster yang tersimpan.</p> : <div className="grid gap-2 sm:grid-cols-2">
        {team.roster.map((player) => <Link key={player.id} href={hrefWithQuery(`/players/${player.sourcePlayerId}`, params)} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 hover:bg-muted"><span className="min-w-0 truncate text-sm font-medium">{player.name}</span><span className="shrink-0 text-[10px] text-muted-foreground">Dilihat {player.observedAt.toLocaleDateString("id-ID")}</span></Link>)}
      </div>}
    </SectionCard>
    <SectionCard title="Pertandingan tim" description="Hasil hanya berasal dari skor tersimpan pada laga selesai.">
      <Table><caption className="sr-only">Riwayat pertandingan tim</caption><TableHeader><TableRow className="hover:bg-transparent"><TableHead>Waktu</TableHead><TableHead>Pertandingan</TableHead><TableHead>Skor tim</TableHead><TableHead>Hasil</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>
        {team.games.length === 0 ? <TableRow><TableCell colSpan={5} className="p-8 text-center text-sm text-muted-foreground">Belum ada pertandingan tersimpan.</TableCell></TableRow> : team.games.map((game) => <TableRow key={game.id}><TableCell className="text-xs text-muted-foreground">{game.scheduledAtRaw ?? "—"}</TableCell><TableCell><Link href={hrefWithQuery(`/games/${game.sourceGameId}`, params)} className="hover:text-primary hover:underline">{game.homeTeam?.name ?? "TBD"} vs {game.awayTeam?.name ?? "TBD"}</Link></TableCell><TableCell className="font-mono">{scoreLabel(game.teamScore, game.opponentScore)}</TableCell><TableCell>{game.result}</TableCell><TableCell><StatusBadge status={game.status} /></TableCell></TableRow>)}
      </TableBody></Table>
    </SectionCard>
  </div>;
}

export function PlayerDetailView({ player, params }: { player: PlayerSummary; params: DashboardSearchParams }) {
  const totals = player.totals;
  return <div className="space-y-4">
    <DetailHeader eyebrow="Players" title={player.player.name} subtitle={`Player source ID ${player.player.sourcePlayerId}`} backHref={hrefWithQuery("/players", params)} />
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
      <KpiCard label="GP" value={formatCount(totals.gamesPlayed)} icon={<CalendarDays className="size-4" />} />
      <KpiCard label="MIN total" value={formatAverage(totals.minutes)} hint={`rata-rata ${formatAverage(totals.averageMinutes)}`} icon={<Clock3 className="size-4" />} />
      <KpiCard label="PTS total" value={formatCount(totals.points)} hint={`rata-rata ${formatAverage(totals.pointsPerGame)}`} />
      <KpiCard label="REB total" value={formatCount(totals.rebounds)} hint={`rata-rata ${formatAverage(totals.reboundsPerGame)}`} />
      <KpiCard label="AST total" value={formatCount(totals.assists)} hint={`rata-rata ${formatAverage(totals.assistsPerGame)}`} />
      <KpiCard label="STL · BLK" value={`${formatAverage(totals.stealsPerGame)} · ${formatAverage(totals.blocksPerGame)}`} hint="per laga" />
    </div>
    <SectionCard title="Persentase agregat" description="Rumus: total tembakan masuk ÷ total percobaan. Pertandingan selesai yang memiliki baris statistik pemain menjadi cakupan agregasi.">
      <div className="grid gap-x-8 sm:grid-cols-3"><MetricRow label="FG%" value={`${formatPercent(totals.fieldGoalPercentage)} · ${formatCount(totals.fieldGoalsMade)}/${formatCount(totals.fieldGoalsAttempted)}`} /><MetricRow label="3P%" value={formatPercent(totals.threePointPercentage)} /><MetricRow label="FT%" value={formatPercent(totals.freeThrowPercentage)} /></div>
    </SectionCard>
    <SectionCard title="Tim yang tercatat" description="Afiliasi berasal dari team_rosters; daftar pemain kompetisi tidak dianggap sebagai roster.">
      {player.teams.length === 0 ? <p className="text-sm text-muted-foreground">Belum ada hubungan roster yang tercatat.</p> : <div className="flex flex-wrap gap-2">{player.teams.map((team) => <Link key={`${team.id}-${team.observedAt.toISOString()}`} href={hrefWithQuery(`/teams/${team.sourceTeamId}`, params)} className="rounded-md border px-3 py-2 text-sm hover:bg-muted"><span className="font-medium">{team.name}</span><span className="ml-2 text-[10px] text-muted-foreground">{team.observedAt.toLocaleDateString("id-ID")}</span></Link>)}</div>}
    </SectionCard>
    <SectionCard title="Game log" description="Waktu mengikuti nilai mentah sumber.">
      <Table><caption className="sr-only">Game log pemain</caption><TableHeader><TableRow className="hover:bg-transparent"><TableHead>Waktu sumber</TableHead><TableHead>Pertandingan</TableHead><TableHead>Tim</TableHead><TableHead>MIN</TableHead><TableHead>FG</TableHead><TableHead>3P</TableHead><TableHead>FT</TableHead><TableHead>REB</TableHead><TableHead>AST</TableHead><TableHead>STL</TableHead><TableHead>BLK</TableHead><TableHead>TO</TableHead><TableHead>PTS</TableHead></TableRow></TableHeader><TableBody>
        {player.games.length === 0 ? <TableRow><TableCell colSpan={13} className="p-8 text-center text-sm text-muted-foreground">Belum ada game log tersimpan.</TableCell></TableRow> : player.games.map((game) => <TableRow key={game.id}><TableCell className="text-xs text-muted-foreground">{game.scheduledAtRaw ?? "—"}</TableCell><TableCell><Link href={hrefWithQuery(`/games/${game.sourceGameId}`, params)} className="hover:text-primary hover:underline">{game.homeTeam?.name ?? "TBD"} vs {game.awayTeam?.name ?? "TBD"}</Link><div className="font-mono text-[10px] text-muted-foreground">{scoreLabel(game.homeScore, game.awayScore)}</div></TableCell><TableCell>{game.team.name}</TableCell><TableCell title={game.stats.minutesRaw ?? undefined}>{formatAverage(game.stats.minutes)}</TableCell><TableCell>{formatCount(game.stats.fieldGoalsMade)}/{formatCount(game.stats.fieldGoalsAttempted)}</TableCell><TableCell>{formatCount(game.stats.threePointsMade)}/{formatCount(game.stats.threePointAttempts)}</TableCell><TableCell>{formatCount(game.stats.freeThrowsMade)}/{formatCount(game.stats.freeThrowAttempts)}</TableCell><TableCell>{formatCount(game.stats.rebounds)}</TableCell><TableCell>{formatCount(game.stats.assists)}</TableCell><TableCell>{formatCount(game.stats.steals)}</TableCell><TableCell>{formatCount(game.stats.blocks)}</TableCell><TableCell>{formatCount(game.stats.turnovers)}</TableCell><TableCell>{formatCount(game.stats.points)}</TableCell></TableRow>)}
      </TableBody></Table>
    </SectionCard>
    <p className="text-xs text-muted-foreground"><SourceLink href={player.player.sourceUrl}>Sumber pemain</SourceLink></p>
  </div>;
}

export function DetailFailure({ message }: { message: string }) {
  return <SectionCard><DataError message={message} /></SectionCard>;
}

export function DetailMissing({ entity, backHref }: { entity: string; backHref: string }) {
  return <SectionCard><DataNotFound title={`${entity} tidak ditemukan`} description={`Data ${entity.toLowerCase()} tidak ditemukan dalam scope kompetisi ini.`} backHref={backHref} /></SectionCard>;
}

export function DetailNoCompetition({ backHref }: { backHref: string }) {
  return <SectionCard><DataEmpty title="Pilih kompetisi terlebih dahulu" description="Detail hanya tersedia setelah kompetisi dipilih dari filter pada bagian atas." resetHref={backHref} /></SectionCard>;
}
