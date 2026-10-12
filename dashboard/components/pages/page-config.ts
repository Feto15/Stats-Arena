export type DashboardPageKey = "overview" | "games" | "teams" | "players" | "standings" | "review";

export interface DashboardPageDefinition {
  title: string;
  description: string;
  sectionDescription: string;
  columns: readonly string[];
}

export const dashboardPageDefinitions: Record<DashboardPageKey, DashboardPageDefinition> = {
  overview: {
    title: "Overview",
    description: "Ringkasan kompetisi, pertandingan, tim, dan pemain.",
    sectionDescription: "Ringkasan akan diisi dari data kompetisi StatsArena.",
    columns: [],
  },
  games: {
    title: "Games",
    description: "Jadwal dan hasil pertandingan untuk kompetisi yang dipilih.",
    sectionDescription: "Jadwal, skor, status, dan tautan sumber pertandingan.",
    columns: ["Waktu sumber", "Pertandingan", "Skor", "Status", "Venue"],
  },
  teams: {
    title: "Teams",
    description: "Tim yang tercatat pada kompetisi yang dipilih.",
    sectionDescription: "Identitas tim bersumber dari ID resmi Genius Sports.",
    columns: ["Tim", "Source ID", "Pertandingan", "W", "L"],
  },
  players: {
    title: "Players",
    description: "Pemain yang terdaftar pada kompetisi yang dipilih.",
    sectionDescription: "Afiliasi tim hanya ditampilkan bila didukung catatan roster.",
    columns: ["Pemain", "Source ID", "GP", "PPG", "Tim"],
  },
  standings: {
    title: "Standings",
    description: "Klasemen resmi dipisahkan menurut grup sumber.",
    sectionDescription: "Urutan dan identitas grup mengikuti tab kompetisi.",
    columns: ["Grup", "Pos", "Tim", "GP", "W", "L", "PF", "PA", "+/-", "Poin"],
  },
  review: {
    title: "Review",
    description: "Isu validasi dan status impor untuk kompetisi yang dipilih.",
    sectionDescription: "Masalah sumber dan parsing yang perlu ditinjau.",
    columns: ["Severity", "Kode", "Keterangan", "Field", "URL sumber"],
  },
};
