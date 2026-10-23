import { issueDataset } from "@statsarena/db/data-quality";

export interface ReviewImpactInput {
  source: "portal" | "livestats";
  code: string;
  status?: string | null;
  sourceUrl?: string | null;
}

export interface ReviewImpact {
  scope: string;
  description: string;
}

/** Explain acceptance rules, not whether this game has a previous valid payload. */
export function describeReviewImpact(issue: ReviewImpactInput): ReviewImpact {
  if (issue.source === "livestats") {
    switch (issue.code) {
      case "LIVESTATS_PLAYER_MAPPING_MISMATCH":
        return { scope: "Pemain tertentu", description: "Tambahan baru pemain yang belum cocok, seperti +/− dan starter, tidak dipakai. Pemain lain yang lolos pemeriksaan tetap dapat mendapat tambahan." };
      case "LIVESTATS_TEAM_MISMATCH":
        return { scope: "Satu tim dan pemainnya", description: "Tambahan baru untuk tim yang belum cocok beserta pemainnya ditahan. Tim lawan hanya mendapat tambahan bila lolos pemeriksaan." };
      case "LIVESTATS_ROSTER_MISMATCH":
        return { scope: "Sebagian roster", description: "Cakupan tambahan pemain belum lengkap. Baris pemain yang sudah cocok dapat dipakai; pemain yang belum cocok tidak dipasangkan paksa." };
      case "LIVESTATS_STARTER_COUNT":
        return { scope: "Kelengkapan starter", description: "Lima starter belum berhasil diverifikasi. Ini bisa akibat pemain belum cocok; bukan berarti seluruh statistik pemain tidak tersedia." };
      case "LIVESTATS_STARTER_MISSING":
        return { scope: "Status starter pemain", description: "Pemain ini belum dapat dinyatakan starter atau bench. Tambahan lain yang valid tetap dapat tersedia." };
      case "LIVESTATS_FIELD_INVALID":
        return { scope: "Kolom tambahan tertentu", description: "Nilai yang tidak valid dilewati. Nilai valid sebelumnya dipertahankan bila tersedia; nilai yang hilang tidak dianggap nol." };
      case "LIVESTATS_OPTIONAL_FIELDS_RETAINED":
        return { scope: "Pembaruan baris tambahan", description: "Kolom opsional hilang pada pembaruan. Baris valid sebelumnya tetap dipakai; sebagian nilai dapat berasal dari pemeriksaan yang lebih lama." };
      case "LIVESTATS_OFFICIAL_METRIC_CONFLICT":
        return { scope: "Metrik tim tertentu", description: "Angka metrik portal dan LiveStats berbeda. Keduanya tetap dipisahkan menurut sumber; tidak saling mengganti atau dijumlahkan." };
      case "LIVESTATS_SCORE_MISMATCH":
      case "LIVESTATS_PORTAL_INCOMPLETE":
        return { scope: "Seluruh tambahan laga", description: "Seluruh tambahan LiveStats baru ditahan. Statistik portal tidak diganti; tambahan valid sebelumnya tetap disimpan bila ada." };
      case "LIVESTATS_TRANSACTION_FAILED":
        return { scope: "Penyimpanan tambahan laga", description: "Hasil pemeriksaan belum tersimpan karena transaksi gagal. Data yang sudah tersimpan tetap ada; percobaan berikutnya masih diperlukan." };
    }
    if (["fetch_failed", "parse_failed", "unavailable", "mismatch"].includes(issue.status ?? "") ||
      ["LIVESTATS_FETCH_FAILED", "LIVESTATS_PARSE_FAILED", "LIVESTATS_UNAVAILABLE", "LIVESTATS_MISMATCH"].includes(issue.code)) {
      return { scope: "Pembaruan tambahan laga", description: "Belum ada tambahan baru yang dapat dipakai pada percobaan ini. Statistik portal tidak diganti; tambahan valid sebelumnya tetap disimpan bila ada." };
    }
    return { scope: "Tambahan LiveStats", description: "Kelengkapan tambahan perlu diperiksa. Lihat alasan dan detail pertandingan untuk mengetahui baris yang tersedia; status ini tidak menentukan hasil pertandingan." };
  }

  if (issue.code === "PBP_EVENT_TEXT_UNAVAILABLE") {
    return { scope: "Keterangan peristiwa", description: "Sebagian event tidak memiliki teks aksi. Urutan dan informasi sumber lainnya tetap disimpan; event tidak otomatis dihapus." };
  }
  if (issue.code === "TEAM_STATISTICS_GP_UNAVAILABLE") {
    return { scope: "Cakupan statistik tim", description: "Jumlah laga sampel (GP) tidak tersedia. Jangan menganggap angka agregat memakai cakupan laga yang sama tanpa bukti sumber." };
  }
  if (issue.code === "MATCH_DETAIL_TAB_UNAVAILABLE") {
    return { scope: "Ketersediaan halaman rinci", description: "Sumber belum menyediakan salah satu halaman detail. Bagian tersebut belum tersedia, bukan bernilai nol; bagian lainnya dinilai terpisah." };
  }
  let path = "";
  try { path = issue.sourceUrl ? new URL(issue.sourceUrl).pathname : ""; } catch { /* Fall back to the issue code for historical URLs. */ }
  if (issue.code.startsWith("STANDINGS_") || /\/standings\/?$/.test(path)) {
    return { scope: "Klasemen kompetisi", description: "Klasemen pada tab terkait belum lengkap atau belum dapat diperbarui. Klasemen valid sebelumnya dipertahankan bila ada; statistik pertandingan dinilai terpisah." };
  }
  if (issue.code.startsWith("TEAM_STATISTICS_") || /\/statistics\/team\/?$/.test(path)) {
    return { scope: "Statistik agregat tim", description: "Pembaruan statistik tim pada tingkat kompetisi perlu diperiksa. Jangan menyamakan cakupan agregat ini dengan satu pertandingan." };
  }
  const dataset = issueDataset({ code: issue.code, sourceUrl: issue.sourceUrl ?? null });
  if (dataset === "shotChart") return { scope: "Peta tembakan", description: "Peta tembakan terbaru belum lengkap atau terverifikasi. Jangan menganggap jumlah titik sudah mewakili seluruh tembakan; chart valid sebelumnya dipertahankan bila ada." };
  if (dataset === "boxScore") return { scope: "Box score", description: "Pembaruan statistik pemain atau total tim belum lengkap atau cocok. Data valid sebelumnya dipertahankan bila ada; nilai yang hilang tidak dianggap nol." };
  if (dataset === "playByPlay") return { scope: "Kronologi pertandingan", description: "Pembaruan play by play belum lengkap atau terverifikasi. Event valid sebelumnya dipertahankan bila ada; kronologi terbaru belum dapat dianggap lengkap." };
  if (dataset === "analysis") return { scope: "Metrik analisis tim", description: "Metrik analisis terbaru belum lengkap atau tersedia. Jangan menganggap BP/2CP atau metrik yang hilang sebagai nol; statistik dasar memiliki pemeriksaan sendiri." };
  if (dataset === "summary") return { scope: "Ringkasan pertandingan", description: "Pembaruan ringkasan atau metadata pertandingan perlu diperiksa. Statistik rinci memiliki pemeriksaan sendiri; data valid tidak otomatis dihapus." };
  return { scope: "Data pada halaman terkait", description: "Pembaruan data pada halaman sumber perlu diperiksa. Isu ini tidak otomatis berarti seluruh data pertandingan hilang; lihat alasan dan status sumber terkait." };
}
