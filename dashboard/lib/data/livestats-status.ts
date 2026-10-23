import type { LiveStatsStatus } from "@statsarena/db/livestats";

export const liveStatsStatusLabels: Record<LiveStatsStatus, string> = {
  ready: "Lengkap", partial: "Perlu review", mismatch: "Data berbeda dari portal",
  unavailable: "Belum tersedia di sumber", fetch_failed: "Gagal mengambil data", parse_failed: "Gagal membaca data"
};
