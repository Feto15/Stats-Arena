import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { formatMinutes, type ClubPlayer, type ClubReport } from "@/lib/reports/club-report";
import { formatStat as fmt } from "@/lib/reports/game-report";
import { playerTableColumns, playerTableHref, playerTableSort, sortClubPlayers } from "@/lib/reports/player-table";

export function PeriodChart({ game }: { game: ClubReport["games"][number] }) {
  if (!game.clubPeriods) return <p className="report-fine">Skor periode belum tersedia.</p>;
  const values = game.clubPeriods.reduce<Array<{ period: number; team: number; opponent: number }>>((rows, period) => {
    const previous = rows[rows.length - 1]!;
    return [...rows, { period: period.period, team: previous.team + period.team, opponent: previous.opponent + period.opponent }];
  }, [{ period: 0, team: 0, opponent: 0 }]);
  const clubScore = values[values.length - 1]!.team;
  const opponentScore = values[values.length - 1]!.opponent;
  const maxScore = Math.max(20, Math.ceil(Math.max(clubScore, opponentScore) / 20) * 20);
  const x = (period: number) => 32 + period * 94;
  const y = (score: number) => 158 - score / maxScore * 136;
  return <div className="club-chart"><svg viewBox="0 0 440 190" role="img" aria-label={`Skor kumulatif per periode: ${game.team.name} ${clubScore}, ${game.opponent.name} ${opponentScore}. Nilai rinci tersedia pada tabel di bawah.`}>
    {[0, .5, 1].map(ratio => <g key={ratio}><line x1="32" x2="408" y1={y(maxScore * ratio)} y2={y(maxScore * ratio)} stroke="#e4e9df" strokeDasharray="3 4" /><text x="22" y={y(maxScore * ratio) + 3} textAnchor="end" fill="#71806e" fontSize="9">{maxScore * ratio}</text></g>)}
    {values.map(value => <text key={value.period} x={x(value.period)} y="181" textAnchor="middle" fill="#71806e" fontSize="9">{value.period ? `Q${value.period}` : "Mulai"}</text>)}
    <polyline points={values.map(value => `${x(value.period)},${y(value.opponent)}`).join(" ")} fill="none" stroke="#a5b09c" strokeWidth="2" strokeDasharray="5 4" />
    <polyline points={values.map(value => `${x(value.period)},${y(value.team)}`).join(" ")} fill="none" stroke="#357754" strokeWidth="3" />
    {values.slice(1).map(value => <g key={value.period}><circle cx={x(value.period)} cy={y(value.team)} r="4" fill="#357754" /><title>{`Q${value.period}: ${game.team.name} ${value.team}, lawan ${value.opponent}`}</title></g>)}
  </svg><div className="club-chart-key"><span><i />{game.team.name}</span><span><i />{game.opponent.name}</span></div></div>;
}

export function PlayerTable({ report, selected, params = {} }: { report: ClubReport; selected?: string; params?: Record<string, string | string[] | undefined> }) {
  const sort = playerTableSort(params);
  const players = sortClubPlayers(report.players, sort);
  return <div className="report-table-scroll" tabIndex={0} role="region" aria-label="Statistik pemain klub, dapat digeser horizontal"><table className="club-roster-table"><caption className="sr-only">Statistik pemain pada cakupan laga laporan. Klik judul kolom untuk mengurutkan; nilai tidak tersedia selalu di akhir.</caption><thead><tr>{playerTableColumns.map(column => {
    const active = sort.key === column.key;
    const nextOrder = active ? sort.order === "desc" ? "asc" : "desc" : column.key === "name" ? "asc" : "desc";
    const Icon = active ? sort.order === "desc" ? ArrowDown : ArrowUp : ArrowUpDown;
    return <th scope="col" key={column.key} aria-sort={active ? sort.order === "desc" ? "descending" : "ascending" : undefined}><Link scroll={false} className="club-roster-sort" href={playerTableHref(report.basePath, selected, { key: column.key, order: nextOrder })} title={`Urutkan ${column.label}: ${nextOrder === "asc" ? "kecil ke besar / A–Z" : "besar ke kecil / Z–A"}`}>{column.label}<Icon size={11} aria-hidden="true" /></Link></th>;
  })}</tr></thead><tbody>{players.map(player => <tr key={player.sourceId} className={selected === player.sourceId ? "selected-player" : ""}><th scope="row"><Link scroll={false} href={playerTableHref(report.basePath, player.sourceId, sort)} aria-current={selected === player.sourceId ? "true" : undefined}><span>#{player.jerseyNumber ?? "—"}</span>{player.name}</Link></th><td>{player.gamesRecorded}</td><td>{formatMinutes(player.perGame.minutes)}</td><td><strong>{fmt(player.perGame.points, 1)}</strong></td><td>{fmt(player.perGame.rebounds, 1)}</td><td>{fmt(player.perGame.assists, 1)}</td><td>{fmt(player.perGame.turnovers, 1)}</td><td>{fmt(player.advancedStats.usagePercentage, 1)}</td><td>{fmt(player.advancedStats.trueShootingPercentage, 1)}</td><td><strong>{fmt(player.advancedStats.gameScorePerGame, 1)}</strong></td></tr>)}</tbody></table></div>;
}

export function PlayerDetail({ player }: { player: ClubPlayer }) {
  return <section className="report-card club-player-profile"><div className="report-eyebrow">PROFIL PEMAIN</div><div className="report-spotlight-heading"><span className="report-jersey">{player.jerseyNumber ?? "—"}</span><div><h3>{player.name}</h3><p>{player.gamesRecorded} baris box score · {formatMinutes(player.totals.minutes)} total menit</p></div></div>
    <div className="report-player-numbers">{[["PTS/laga", player.perGame.points], ["REB/laga", player.perGame.rebounds], ["AST/laga", player.perGame.assists]].map(([label, value]) => <div key={String(label)}><strong>{fmt(typeof value === "number" ? value : null, 1)}</strong><span>{label}</span></div>)}</div>
    <dl className="report-player-facts"><div><dt>Game Score · GmSc/laga</dt><dd>{fmt(player.advancedStats.gameScorePerGame, 1)}</dd></div><div><dt>Efisiensi tembakan · TS%*</dt><dd>{fmt(player.advancedStats.trueShootingPercentage, 1)}%</dd></div><div><dt>Porsi penyelesaian · USG%*</dt><dd>{fmt(player.advancedStats.usagePercentage, 1)}%</dd></div><div><dt>Rasio AST/TO</dt><dd>{fmt(player.advancedStats.assistTurnoverRatio, 2)}</dd></div><div><dt>Poin per 40 menit</dt><dd>{fmt(player.advancedStats.pointsPer40, 1)}</dd></div><div><dt>Porsi poin klub</dt><dd>{fmt(player.advancedStats.pointsSharePercentage, 1)}%</dd></div></dl>
    <div className="club-player-game-list">{player.games.map(game => <article key={game.gameId}><span>LAGA 0{game.number}<small>{game.opponent}</small></span><strong>{fmt(game.stats.points)}<small>PTS</small></strong><span>{game.minutesRaw ?? "—"}<small>MENIT</small></span></article>)}</div><p className="report-fine">*Estimasi dari box score. USG% menghitung penyelesaian melalui FGA, FTA, dan turnover; bukan seluruh sentuhan bola. Produksi per 40 perlu dibaca bersama total menit.</p>
  </section>;
}

export function GmscExplanation() { return <div className="club-gmsc-note"><h4>Game Score · GmSc</h4><p>Ringkasan performa pemain dari box score satu laga. Nilai lebih tinggi menunjukkan hasil lebih baik menurut rumus ini; nilainya bisa negatif. <strong>GmSc/laga = total GmSc ÷ GP tercatat.</strong></p><p className="club-gmsc-formula">GmSc = PTS + 0,4 × FGM − 0,7 × FGA − 0,4 × (FTA − FTM) + 0,7 × ORB + 0,3 × DRB + STL + 0,7 × AST + 0,7 × BLK − 0,4 × PF − TO.</p><p>FGM/FGA: field goal masuk/dicoba · FTM/FTA: free throw masuk/dicoba · ORB/DRB: rebound ofensif/defensif · STL: steal · AST: assist · BLK: blok · PF: foul pribadi · TO: turnover · PTS: poin.</p></div>; }
