export type BoxScoreStateInput = {
  gameStatus: "scheduled" | "live" | "complete" | "unknown";
  hasStoredStats: boolean;
  fetchStatus: "succeeded" | "failed" | null;
  parseStatus: "parsed" | "partial" | "failed" | null;
};

export function boxScoreStateMessage(input: BoxScoreStateInput): string | null {
  if (input.gameStatus === "scheduled" && !input.hasStoredStats) {
    return "Pertandingan belum berjalan. Statistik belum tersedia dan tidak diisi dengan angka nol.";
  }
  if (input.fetchStatus === "failed") {
    return input.hasStoredStats
      ? "Pengambilan box score terbaru gagal; statistik valid terakhir yang tersimpan tetap ditampilkan."
      : "Pengambilan box score terbaru gagal dan belum ada statistik valid yang tersimpan.";
  }
  if (input.parseStatus === "failed") {
    return input.hasStoredStats
      ? "Parsing box score terbaru gagal; statistik valid terakhir yang tersimpan tetap ditampilkan."
      : "Box score terbaru tidak dapat diparse dan belum ada statistik valid yang tersimpan.";
  }
  if (input.parseStatus === "partial") {
    return "Box score terbaru parsial. Hanya statistik yang tersimpan ditampilkan; nilai yang tidak tersedia tetap ditandai —.";
  }
  if (input.fetchStatus === null && !input.hasStoredStats && input.gameStatus !== "scheduled") {
    return "Box score dan provenance fetch belum tersedia untuk pertandingan ini.";
  }
  return null;
}
