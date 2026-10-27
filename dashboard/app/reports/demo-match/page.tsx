import { requireAdmin } from "@/lib/auth/server";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, CalendarDays, CheckCircle2, ChevronRight, ExternalLink, MapPin, Shield, Target, Trophy, Users } from "lucide-react";
import { ReportActions } from "@/components/reports/report-actions";
import { buildDemoReport, formatStat as fmt, reportHref, reportSelection, teamObservations, type ReportPlayer, type ReportTeam } from "@/lib/reports/game-report";
import type { DashboardSearchParams } from "@/lib/competition-scope";
import "../reports.css";

export const metadata: Metadata = { title: "Game Report Demo", description: "Demo laporan pertandingan Rajawali Medan vs Satria Muda, IBL All Indonesian 2025." };

function initials(name: string) {
  return name.split(" ").slice(0, 2).map(word => word[0]).join("");
}

function TeamBadge({ team, small = false }: { team: ReportTeam; small?: boolean }) {
  return <span className={`report-team-badge ${small ? "small" : ""}`} aria-hidden="true">{initials(team.name)}</span>;
}

function Comparison({ label, left, right, percent = false, lowerBetter = false }: { label: string; left: number | null | undefined; right: number | null | undefined; percent?: boolean; lowerBetter?: boolean }) {
  const total = left != null && right != null ? left + right : null;
  const width = left == null || right == null || !total ? 50 : Math.min(100, Math.max(0, left / total * 100));
  const advantage = left != null && right != null && (lowerBetter ? left < right : left > right);
  return <div className="report-comparison">
    <div><strong className={advantage ? "report-positive" : ""}>{fmt(left, percent ? 1 : 0)}{percent && left != null ? "%" : ""}</strong><span>{label}</span><strong>{fmt(right, percent ? 1 : 0)}{percent && right != null ? "%" : ""}</strong></div>
    <div className="report-comparison-track" aria-hidden="true"><span style={{ width: `${width}%` }} /></div>
  </div>;
}

function PlayerSpotlight({ player, team }: { player: ReportPlayer; team: ReportTeam }) {
  return <article className="report-spotlight">
    <div className="report-eyebrow"><span className="report-dot" />FOKUS PEMAIN</div>
    <div className="report-spotlight-heading"><span className="report-jersey">{player.jerseyNumber ?? "—"}</span><div><h3>{player.name}</h3><p>{team.name} · {player.minutesRaw ?? "—"} menit</p></div></div>
    <div className="report-player-numbers">{[["PTS", player.stats.points], ["REB", player.stats.rebounds], ["AST", player.stats.assists], ["STL", player.stats.steals]].map(([label, value]) => <div key={String(label)}><strong>{fmt(typeof value === "number" ? value : null)}</strong><span>{label}</span></div>)}</div>
    <div className="report-spotlight-footer"><span>Game Score <strong>{fmt(player.advancedStats.gameScore, 1)}</strong></span><span>TS%* <strong>{fmt(player.advancedStats.trueShootingPercentage, 1)}{player.advancedStats.trueShootingPercentage != null ? "%" : ""}</strong></span></div>
    <p className="report-fine">Fokus awal: Game Score tertinggi pada pemain yang bermain. Bukan penghargaan MVP resmi.</p>
  </article>;
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<DashboardSearchParams> }) {
  await requireAdmin();
  const params = await searchParams;
  const report = buildDemoReport();
  const { team, opponent, players, player, section } = reportSelection(report, params);
  const home = report.teams.find(team => team.sourceId === report.fixture.homeTeamSourceId)!;
  const away = report.teams.find(team => team.sourceId === report.fixture.awayTeamSourceId)!;
  const score = team.stats.points;
  const against = opponent.stats.points;
  const margin = score != null && against != null ? score - against : null;
  const observations = teamObservations(team, opponent);
  const leader = players.find(player => (player.stats.minutes ?? 0) > 0) ?? players[0]!;
  const boxSource = report.provenance.resources.find(resource => resource.resource === "boxscore")!;
  const pbpSource = report.provenance.resources.find(resource => resource.resource === "playbyplay")!;

  return <div className="report-root">
    <a href="#report-main" className="report-skip">Lewati ke laporan</a>
    <header className="report-header"><Link href="/" className="report-brand"><span><BarChart3 size={21} /></span>STATS<span className="report-brand-light">ARENA</span><small>TEAM REPORTS</small></Link><div><span className="report-demo-label">DEMO · ARSIP 2025</span><Link href="/games?competition=IBL%3A42041" className="report-dashboard-link">Dashboard <ArrowUpRight size={15} /></Link></div></header>
    <main id="report-main" className="report-main">
      <div className="report-breadcrumb"><Link href="/">StatsArena</Link><ChevronRight size={13} /><span>Reporting</span><ChevronRight size={13} /><span>Contoh laporan</span></div>
      <div className="report-title-row"><div><div className="report-eyebrow">POST-GAME INTELLIGENCE <span>/</span> 001</div><h1>Satu laga.<br className="report-mobile-break" /> Banyak pelajaran.</h1><p>Laporan pertandingan untuk evaluasi pelatih dan staf tim.</p></div><ReportActions /></div>
      <section className="report-scoreboard" aria-label="Hasil pertandingan">
        <div className="report-scoreboard-meta"><span><span className="report-dot" />{report.competition.name}</span><span><CheckCircle2 size={13} />FINAL</span></div>
        <div className="report-matchup">
          <div className="report-matchup-team"><TeamBadge team={home} /><div><span>TIM 1</span><h2>{home.name}</h2></div></div>
          <div className="report-score"><strong>{fmt(report.fixture.homeScore)}</strong><span>:</span><strong>{fmt(report.fixture.awayScore)}</strong></div>
          <div className="report-matchup-team report-away"><TeamBadge team={away} /><div><span>TIM 2</span><h2>{away.name}</h2></div></div>
        </div>
        <div className="report-match-meta"><span><CalendarDays size={14} />{report.fixture.scheduledAtRaw ?? "Waktu tidak tersedia"} <small>· waktu sumber</small></span><span><MapPin size={14} />{report.fixture.venue ?? "Venue tidak tersedia"}</span><span>GAME #{report.fixture.sourceId}</span></div>
      </section>

      <div className="report-controls"><div><span className="report-control-label">SUDUT PANDANG TIM</span><nav aria-label="Pilih tim laporan" className="report-team-switch">{report.teams.map(option => <Link key={option.sourceId} href={reportHref(option.sourceId, section)} aria-current={option.sourceId === team.sourceId ? "page" : undefined} className={option.sourceId === team.sourceId ? "selected" : ""}><Shield size={14} />{option.name}</Link>)}</nav></div><Link href="/reports/bima-perkasa" className="report-player-cta">Demo laporan klub Bima Perkasa <ArrowRight size={15} /></Link></div>
      <nav className="report-tabs" aria-label="Bagian laporan"><Link href={reportHref(team.sourceId)} className={section === "team" ? "active" : ""} aria-current={section === "team" ? "page" : undefined}><BarChart3 size={16} />Laporan tim</Link><Link href={reportHref(team.sourceId, "players")} className={section === "players" ? "active" : ""} aria-current={section === "players" ? "page" : undefined}><Users size={16} />Performa pemain<span>{players.length}</span></Link></nav>

      <section className={`report-team-content ${section === "players" ? "report-print-only" : ""}`} aria-label="Laporan tim">
        <div className="report-summary-heading"><div><span className="report-eyebrow">01 / TEAM REPORT</span><h2>{team.name}</h2></div><span className={`report-result ${margin != null && margin > 0 ? "win" : ""}`}>{margin == null ? "Hasil belum tersedia" : margin > 0 ? `MENANG +${margin}` : margin < 0 ? `KALAH ${margin}` : "IMBANG"}</span></div>
        <div className="report-kpis">
          <article><span>HASIL AKHIR</span><strong>{fmt(score)}<small>— {fmt(against)}</small></strong><p>vs {opponent.name}</p></article>
          <article><span>EFISIENSI TEMBAKAN</span><strong>{fmt(team.advancedStats.effectiveFieldGoalPercentage, 1)}<small>% eFG</small></strong><p>Lawan {fmt(opponent.advancedStats.effectiveFieldGoalPercentage, 1)}%</p></article>
          <article><span>ALIRAN BOLA</span><strong>{fmt(team.stats.assists)}<small>AST</small></strong><p>{fmt(team.stats.turnovers)} turnover · AST/TO {fmt(team.advancedStats.assistTurnoverRatio, 2)}</p></article>
          <article><span>REBOUND</span><strong>{fmt(team.stats.rebounds)}<small>REB</small></strong><p>{fmt(team.stats.offensiveRebounds)} ofensif · {fmt(team.stats.defensiveRebounds)} defensif</p></article>
        </div>
        <div className="report-main-grid"><section className="report-card"><div className="report-card-heading"><div><span className="report-eyebrow">HEAD TO HEAD</span><h3>Di mana selisihnya?</h3></div><Target size={20} /></div><div className="report-comparison-legend"><span><i />{team.name}</span><span><i />Lawan</span></div>
          <Comparison label="FG%" left={team.advancedStats.fieldGoalPercentage} right={opponent.advancedStats.fieldGoalPercentage} percent />
          <Comparison label="3PT%" left={team.advancedStats.threePointPercentage} right={opponent.advancedStats.threePointPercentage} percent />
          <Comparison label="FT%" left={team.advancedStats.freeThrowPercentage} right={opponent.advancedStats.freeThrowPercentage} percent />
          <Comparison label="Offensive rebound" left={team.stats.offensiveRebounds} right={opponent.stats.offensiveRebounds} />
          <Comparison label="Turnover · lebih rendah lebih baik" left={team.stats.turnovers} right={opponent.stats.turnovers} lowerBetter />
          <Comparison label="Steal" left={team.stats.steals} right={opponent.stats.steals} />
          <p className="report-fine">Persentase dari total made/attempts. Garis menunjukkan perbandingan nilai kedua tim.</p>
        </section><div className="report-right-column"><PlayerSpotlight player={leader} team={team} /><Link className="report-player-cta" href={reportHref(team.sourceId, "players", leader.sourceId)}><span>Lihat evaluasi seluruh pemain</span><ArrowRight size={18} /></Link><section className="report-card report-periods"><div className="report-card-heading"><div><span className="report-eyebrow">QUARTER BY QUARTER</span><h3>Skor per periode</h3></div></div>{report.periods ? <><div className="report-period-table"><table><caption className="sr-only">Skor setiap periode, dihitung dari skor akhir periode play by play.</caption><thead><tr><th scope="col">Tim</th>{report.periods.map(period => <th scope="col" key={period.period}>{period.period <= 4 ? `Q${period.period}` : `OT${period.period - 4}`}</th>)}</tr></thead><tbody>{[team, opponent].map(option => <tr key={option.sourceId}><th scope="row">{initials(option.name)}</th>{report.periods!.map(period => <td key={period.period}>{option.sourceId === home.sourceId ? period.home : period.away}</td>)}</tr>)}</tbody></table></div><p className="report-fine">Selisih skor akhir periode dari <a href={pbpSource.sourceUrl} target="_blank" rel="noreferrer">play by play</a>; cocok dengan hasil akhir.</p></> : <p>Data periode belum lengkap.</p>}</section></div></div>
        <section className="report-notes"><div className="report-section-title"><div><span className="report-eyebrow">COACHING NOTES</span><h2>Angka menjadi bahan evaluasi.</h2></div><span>Observasi statistik · perlu tinjauan video</span></div><div className="report-notes-grid">{observations.map((observation, index) => <article key={observation.title}><span className="report-note-number">0{index + 1}</span><h3>{observation.title}</h3><p>{observation.detail}</p><div><ArrowDownRight size={16} /><p>{observation.focus}</p></div></article>)}</div></section>
      </section>

      <section className={`report-players-content ${section === "team" ? "report-print-only" : ""}`} aria-label="Performa pemain">
        <div className="report-summary-heading"><div><span className="report-eyebrow">02 / PLAYER REPORT</span><h2>Kontribusi di balik skor.</h2><p>{team.name} · urutan Game Score tertinggi</p></div><Trophy size={23} /></div>
        <div className="report-player-layout"><section className="report-card report-player-detail"><div className="report-eyebrow">EVALUASI INDIVIDU</div><div className="report-spotlight-heading"><span className="report-jersey">{player.jerseyNumber ?? "—"}</span><div><h3>{player.name}</h3><p>{player.minutesRaw ?? "—"} menit · satu pertandingan</p></div></div><div className="report-player-numbers">{[["PTS", player.stats.points], ["REB", player.stats.rebounds], ["AST", player.stats.assists], ["TOV", player.stats.turnovers]].map(([label, value]) => <div key={String(label)}><strong>{fmt(typeof value === "number" ? value : null)}</strong><span>{label}</span></div>)}</div>
          <dl className="report-player-facts"><div><dt>Field goal</dt><dd>{fmt(player.stats.fieldGoalsMade)}/{fmt(player.stats.fieldGoalsAttempted)} <span>({fmt(player.advancedStats.fieldGoalPercentage, 1)}%)</span></dd></div><div><dt>Three point</dt><dd>{fmt(player.stats.threePointsMade)}/{fmt(player.stats.threePointAttempts)}</dd></div><div><dt>Free throw</dt><dd>{fmt(player.stats.freeThrowsMade)}/{fmt(player.stats.freeThrowAttempts)}</dd></div><div><dt>eFG%</dt><dd>{fmt(player.advancedStats.effectiveFieldGoalPercentage, 1)}{player.advancedStats.effectiveFieldGoalPercentage != null ? "%" : ""}</dd></div><div><dt>True Shooting%*</dt><dd>{fmt(player.advancedStats.trueShootingPercentage, 1)}{player.advancedStats.trueShootingPercentage != null ? "%" : ""}</dd></div><div><dt>Game Score</dt><dd>{fmt(player.advancedStats.gameScore, 1)}</dd></div><div><dt>Kontribusi poin tim</dt><dd>{fmt(player.advancedStats.pointsSharePercentage, 1)}{player.advancedStats.pointsSharePercentage != null ? "%" : ""}</dd></div></dl>
          <div className="report-player-note"><strong>Bahan diskusi pemain</strong><p>{player.stats.turnovers != null && player.stats.turnovers > 0 ? `${player.name} mencatat ${fmt(player.stats.turnovers)} turnover. Tinjau keputusan saat menguasai bola melalui video.` : "Tinjau pilihan tembakan dan keputusan passing melalui video."} Angka satu laga belum cukup untuk menilai konsistensi atau peran taktik.</p></div>
        </section><section className="report-card report-boxscore"><div className="report-card-heading"><div><span className="report-eyebrow">SELURUH PEMAIN</span><h3>Pilih nama untuk evaluasi</h3></div><span className="report-table-count">{players.length} pemain</span></div><div className="report-table-scroll" tabIndex={0} role="region" aria-label="Tabel performa pemain, geser horizontal untuk statistik lainnya"><table><caption className="sr-only">Performa pemain {team.name}, diurutkan menurut Game Score, bukan penghargaan resmi.</caption><thead><tr>{["Pemain", "MIN", "PTS", "REB", "AST", "STL", "BLK", "TO", "FG", "TS%*", "GmSc"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{players.map(option => <tr key={option.sourceId} className={option.sourceId === player.sourceId ? "selected-player" : ""}><th scope="row"><Link href={reportHref(team.sourceId, "players", option.sourceId)} aria-current={option.sourceId === player.sourceId ? "true" : undefined}><span>#{option.jerseyNumber ?? "—"}</span>{option.name}</Link></th><td>{option.minutesRaw ?? "—"}</td>{[option.stats.points, option.stats.rebounds, option.stats.assists, option.stats.steals, option.stats.blocks, option.stats.turnovers].map((value, index) => <td key={index}>{fmt(value)}</td>)}<td>{fmt(option.stats.fieldGoalsMade)}/{fmt(option.stats.fieldGoalsAttempted)}</td><td>{fmt(option.advancedStats.trueShootingPercentage, 1)}</td><td><strong>{fmt(option.advancedStats.gameScore, 1)}</strong></td></tr>)}</tbody></table></div><p className="report-fine">MIN mengikuti waktu mentah sumber. — berarti tidak tersedia, termasuk persentase tanpa percobaan. Tidak ada klaim starter atau plus/minus.</p></section></div>
      </section>

      <section className="report-methodology"><div><CheckCircle2 size={18} /><div><h2>Data yang bisa ditelusuri.</h2><p>Demo arsip satu laga tahun 2025. Bukan hasil pertandingan terbaru atau laporan seluruh kompetisi.</p></div></div><details><summary>Sumber, perhitungan, dan batas laporan</summary><div className="report-methodology-body"><p>Statistik dasar: <a href={boxSource.sourceUrl} target="_blank" rel="noreferrer">box score Genius Sports <ExternalLink size={12} /></a>. Data diambil {new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(boxSource.fetchedAt))} WIB. Waktu pertandingan ditampilkan apa adanya karena zona waktu sumber tidak dinyatakan.</p><p>eFG% = 100 × (FGM + 0,5 × 3PM) / FGA. *TS% = 100 × PTS / (2 × (FGA + 0,44 × FTA)), merupakan estimasi. AST/TO = AST / TOV. Game Score = PTS + 0,4 FGM − 0,7 FGA − 0,4 (FTA − FTM) + 0,7 OREB + 0,3 DREB + STL + 0,7 AST + 0,7 BLK − 0,4 PF − TOV. Kontribusi poin = 100 × poin pemain / poin tim. Pembagi nol atau input hilang menjadi —. Semua rumus memakai modul bersama {report.analyticsVersion}.</p><p>Kolom 2P pada sumber IBL ini diturunkan dari FG − 3P pada input valid. BP, PIP, PFT, FBP, 2CP, starter, dan plus/minus tidak disajikan karena demo ini hanya memakai box score portal dan skor akhir periode PBP. Catatan evaluasi merupakan observasi angka dan saran tinjauan video, bukan kesimpulan taktik atau penilaian medis.</p><p>Box score dan PBP sampel berstatus parsed; tab Team Analysis tidak tersedia. Status impor audit keseluruhan parsial mencakup resource lain pada kompetisi. Demo membaca salinan arsip terbatas dan tidak membuktikan pembaruan atau impor Neon terbaru.</p><dl><div><dt>Parser</dt><dd>{report.provenance.parserVersion}</dd></div><div><dt>Audit</dt><dd>{report.provenance.auditFile}</dd></div><div><dt>SHA-256 box score</dt><dd>{boxSource.sha256}</dd></div><div><dt>SHA-256 PBP</dt><dd>{pbpSource.sha256}</dd></div></dl></div></details></section>
      <footer className="report-footer"><span>STATSARENA <span>/</span> Built for better basketball decisions.</span><span>DEMO REPORT · IBL ALL INDONESIAN 2025</span></footer>
    </main>
  </div>;
}
