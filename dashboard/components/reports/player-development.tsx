import Link from "next/link";
import { ArrowRight, ExternalLink, TrendingUp } from "lucide-react";
import { clubHref, formatMinutes, type ClubPlayer, type ClubReport } from "@/lib/reports/club-report";
import { playerDevelopment, signedChange } from "@/lib/reports/player-development";
import { formatStat as fmt } from "@/lib/reports/game-report";

const number = (value: number | null | undefined) => fmt(value ?? null);
const score = (value: number | null | undefined) => fmt(value ?? null, 1);
const percentage = (value: number | null | undefined) => value == null ? "—" : `${fmt(value, 1)}%`;
export function PlayerDevelopment({ report, player }: { report: ClubReport; player: ClubPlayer }) {
  const { first, second, changes, comparable } = playerDevelopment(report, player);
  const rows = [
    { label: "Menit bermain", first: first?.stats.minutes, second: second?.stats.minutes, change: changes.minutes, format: formatMinutes, unit: "" },
    { label: "Field goal dicoba · FGA", first: first?.stats.fieldGoalsAttempted, second: second?.stats.fieldGoalsAttempted, change: changes.fieldGoalsAttempted, format: number, unit: "" },
    { label: "Tiga angka dicoba · 3PA", first: first?.stats.threePointAttempts, second: second?.stats.threePointAttempts, change: changes.threePointAttempts, format: number, unit: "" },
    { label: "Free throw dicoba · FTA", first: first?.stats.freeThrowAttempts, second: second?.stats.freeThrowAttempts, change: changes.freeThrowAttempts, format: number, unit: "" },
    { label: "Efisiensi tembakan · TS%*", first: first?.advancedStats.trueShootingPercentage, second: second?.advancedStats.trueShootingPercentage, change: changes.trueShootingPercentage, format: percentage, unit: " pp" },
    { label: "Efisiensi field goal · eFG%", first: first?.advancedStats.effectiveFieldGoalPercentage, second: second?.advancedStats.effectiveFieldGoalPercentage, change: changes.effectiveFieldGoalPercentage, format: percentage, unit: " pp" },
    { label: "Porsi penyelesaian · USG%*", first: first?.advancedStats.usagePercentage, second: second?.advancedStats.usagePercentage, change: changes.usagePercentage, format: percentage, unit: " pp" },
    { label: "Turnover · TO", first: first?.stats.turnovers, second: second?.stats.turnovers, change: changes.turnovers, format: number, unit: "" },
    { label: "Frekuensi turnover · TOV%*", first: first?.advancedStats.turnoverPercentage, second: second?.advancedStats.turnoverPercentage, change: changes.turnoverPercentage, format: percentage, unit: " pp" },
    { label: "Poin · PTS", first: first?.stats.points, second: second?.stats.points, change: changes.points, format: number, unit: "" },
    { label: "Rebound · REB", first: first?.stats.rebounds, second: second?.stats.rebounds, change: changes.rebounds, format: number, unit: "" },
    { label: "Assist · AST", first: first?.stats.assists, second: second?.stats.assists, change: changes.assists, format: number, unit: "" },
    { label: "Game Score · GmSc", first: first?.advancedStats.gameScore, second: second?.advancedStats.gameScore, change: changes.gameScore, format: score, unit: "" },
    { label: "Porsi poin klub", first: first?.advancedStats.pointsSharePercentage, second: second?.advancedStats.pointsSharePercentage, change: changes.pointsSharePercentage, format: percentage, unit: " pp" },
  ];
  return <>
    <div className="report-summary-heading"><div><span className="report-eyebrow">04 / PLAYER PROGRESSION</span><h2>Bagaimana peran dan hasil pemain berubah?</h2><p>Perbandingan dua laga terakhir · {report.players.length} pemain tercatat</p></div><span className="club-small-label">{report.games.length} LAGA TERSEDIA</span></div>
    <div className="club-development-context">{report.games.slice(-2).map(game => <article key={game.fixture.sourceId}><span>LAGA 0{game.number}</span><strong>{game.opponent.name}</strong><small>{game.fixture.scheduledAtRaw} · {fmt(game.team.stats.points)}–{fmt(game.opponent.stats.points)}</small></article>)}</div>
    <section className="report-card club-development-focus" id="development-focus">
      <div className="report-card-heading"><div><span className="report-eyebrow">FOKUS PEMAIN</span><h3>#{player.jerseyNumber} {player.name}</h3></div><TrendingUp size={21} /></div>
      <form className="club-report-filter" action={`${report.basePath}#development-focus`} method="get"><input type="hidden" name="section" value="development" /><label htmlFor="development-player">Pilih pemain<select id="development-player" name="player" defaultValue={player.sourceId}>{report.players.map(row => <option key={row.sourceId} value={row.sourceId}>#{row.jerseyNumber} {row.name}</option>)}</select></label><button type="submit">Lihat perkembangan <ArrowRight size={14} /></button></form>
      {!comparable && <p className="club-data-notice">Perbandingan membutuhkan dua baris laga pemain yang valid. Nilai tanpa pembanding tetap —; satu laga tidak dianggap sebagai perubahan dari nol.</p>}
      <div className="club-development-kpis">{[rows[0]!, rows[1]!, rows[4]!, rows[7]!].map(row => <article key={row.label}><span>{row.label}</span><div>{row.format(row.first ?? null)} <ArrowRight size={15} /> <strong>{row.format(row.second ?? null)}</strong></div><small>Δ {signedChange(row.change, value => row.unit ? fmt(value, 1) : row.format(value))}{row.change !== null ? row.unit : ""}</small></article>)}</div>
      <div className="report-table-scroll" role="region" tabIndex={0} aria-label={`Perubahan rinci ${player.name}`}><table className="club-analysis-table"><thead><tr><th scope="col">Indikator</th><th scope="col">{report.games.length >= 2 ? `Laga ${report.games.length - 1}` : "Pembanding belum ada"}</th><th scope="col">Laga {report.games.length}</th><th scope="col">Perubahan</th></tr></thead><tbody>{rows.map(row => <tr key={row.label}><th scope="row">{row.label}</th><td>{row.format(row.first ?? null)}</td><td>{row.format(row.second ?? null)}</td><td>{signedChange(row.change, value => row.unit ? fmt(value, 1) : row.format(value))}{row.change !== null ? row.unit : ""}</td></tr>)}</tbody></table></div>
      <p className="report-fine">Δ = laga terakhir − laga sebelumnya. pp = poin persentase. GmSc adalah Game Score per laga dari box score, terpisah dari plus/minus dan Net Rating. *Estimasi box score dari modul analitik bersama. Lebih banyak menit atau USG% menunjukkan perubahan beban, belum membuktikan perkembangan kualitas. Persentase tanpa penyebut yang valid tetap —.</p>
    </section>
    <section className="report-card club-development-squad"><div className="report-card-heading"><div><span className="report-eyebrow">PANTAU SELURUH SKUAD</span><h3>Dua laga dalam satu pandangan.</h3></div><span className="club-small-label">LAGA SEBELUMNYA → TERAKHIR</span></div>
      <div className="report-table-scroll" role="region" tabIndex={0} aria-label="Perubahan semua pemain, tabel dapat digeser"><table className="club-analysis-table club-progression-table"><thead><tr>{["Pemain", "Menit", "Δ menit", "FGA", "TS%*", "TO", "PTS", "GmSc"].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{report.players.map(row => { const d = playerDevelopment(report, row); return <tr key={row.sourceId} className={row.sourceId === player.sourceId ? "selected-player" : ""}><th scope="row"><Link href={`${clubHref("development", row.sourceId, report.basePath)}#development-focus`}>#{row.jerseyNumber} {row.name}</Link></th><td>{formatMinutes(d.first?.stats.minutes ?? null)} → {formatMinutes(d.second?.stats.minutes ?? null)}</td><td>{signedChange(d.changes.minutes, formatMinutes)}</td><td>{number(d.first?.stats.fieldGoalsAttempted)} → {number(d.second?.stats.fieldGoalsAttempted)}</td><td>{percentage(d.first?.advancedStats.trueShootingPercentage)} → {percentage(d.second?.advancedStats.trueShootingPercentage)}</td><td>{number(d.first?.stats.turnovers)} → {number(d.second?.stats.turnovers)}</td><td>{number(d.first?.stats.points)} → {number(d.second?.stats.points)}</td><td>{score(d.first?.advancedStats.gameScore)} → {score(d.second?.advancedStats.gameScore)}</td></tr>; })}</tbody></table></div>
      <p className="report-fine">Klik pemain untuk rincian volume, efisiensi, beban penyelesaian, dan kontribusi. Nol menit adalah angka pada baris sumber, bukan asumsi alasan tidak bermain.</p>
    </section>
    <aside className="club-data-notice"><strong>Bahan diskusi pelatih, bukan vonis dari dua laga.</strong><p>Baca perubahan bersama menit, volume percobaan, dan kekuatan lawan. Tambahkan catatan video atau target latihan setelah staf memeriksa konteksnya.</p><div className="club-game-sources">{report.games.map(game => <a key={game.fixture.sourceId} href={game.provenance.resources.find(r => r.resource === "boxscore")!.sourceUrl} target="_blank" rel="noreferrer">Box score laga {game.number} <ExternalLink size={12} /></a>)}</div></aside>
  </>;
}
