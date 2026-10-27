# Arsip demo lokal laporan All Indonesian 2026

**Status terbaru 26 Oktober:** route report utama kini membaca Neon. Dokumen ini mencatat implementasi dan verifikasi paket lokal sebelumnya; paket tersebut hanya dipertahankan untuk demo/pengujian. Lihat [REPORTING_NEON.md](./REPORTING_NEON.md) untuk sumber aktif.

Pembaruan login 26 Oktober 2026: seluruh report sekarang memerlukan akun Better Auth dan akses klub. Statistik tetap berasal dari paket lokal, sedangkan akun/sesi/undangan/penugasan membaca Neon. Admin mengelola undangan di `/admin/access`; lihat [REPORTING_AUTH.md](./REPORTING_AUTH.md). Catatan verifikasi tanpa Neon di bawah merujuk versi snapshot sebelum autentikasi ditambahkan.

Halaman `/reports` memilih klub, lalu `/reports/<slug-klub>` membuka laporan klub. Seluruh halaman berada di `dashboard/app/reports/`; tidak membuat aplikasi atau folder dashboard kedua. Daftar klub dan slug berasal dari peserta kompetisi `IBL:50231`, bukan daftar nama yang diketik di UI.

Snapshot analisis lokal bertanggal **25 Oktober 2026 pukul 21.08 WIB** memuat **10 klub, 7 laga selesai dengan box score valid, dan 20 fixture**. Empat klub mempunyai dua laga dan enam klub mempunyai satu laga. Ini cakupan arsip, bukan klaim hasil terkini. Bima Perkasa bukan peserta pada sumber 2026 tersebut; contoh Bima 2025 tetap di `/reports/bima-perkasa` pada mode dashboard lengkap. Demo pertandingan lama dipindah ke `/reports/demo-match`.

## Sumber dan pembaruan offline

Statistik halaman membaca paket `dashboard/lib/reports/data/IBL-50231.json` yang ikut aplikasi. Tidak membaca statistik Neon atau direktori ingest saat request, dan tidak mengunduh data Genius Sports saat report dibuka. Autentikasi membaca konfigurasi server dan tabel akun/akses Neon. Modul analitik bersama tetap menghitung metrik dari input valid; tidak menyimpan kolom turunan statistik Neon baru.

Ekspor paket dari arsip yang sudah ada, dijalankan dari root repository:

```sh
pnpm --dir ingest run reports:export --help
pnpm --dir ingest run reports:export --competition IBL:50231
```

Perintah ini hanya membaca katalog lokal, analisis offline, audit sumber setiap box score, dan cache JSON LiveStats yang ditautkan katalog. Tidak melakukan fetch, impor, atau koneksi database. Paket dan manifest `report-routes.json` diganti setelah ekspor berhasil. Untuk memperbarui hasil, arsip/analisis harus diperbarui lewat alur ingest yang terpisah, lalu ekspor ulang dan build/deploy ulang dashboard.

Audit terbaru tidak harus memuat seluruh laga lama: exporter mengikuti provenance `source.auditPath` dan hash box score setiap laga yang disertakan analisis. URL namespace/kompetisi/laga dan hash cache LiveStats diperiksa. Payload LiveStats melewati adapter pemetaan identitas/core stats yang sama dengan ingest. URL, waktu fetch, hash, versi parser/adapter, urutan event, dan alasan validasi tetap disimpan. Fixture belum selesai tidak dimasukkan sebagai statistik nol.

## Isi dan batas validasi

- Ringkasan tim: rekor dari laga tersedia, poin, empat faktor, dan rating estimasi dari total kedua sisi.
- Skuad dan profil: menit, produksi, USG%, TS%, kontribusi, dan **GmSc/laga paling kanan setelah TS%**, dengan rumus di bawah tabel.
- Pertandingan: skor klub saat home/away, skor kuarter dari event akhir periode eksplisit, dan tautan sumber.
- Shot chart: satu kanvas untuk satu laga, filter URL, koordinat sumber dan gambar lapangan lokal yang sama dengan demo 2025. Seluruh **14 dataset klub–laga** cocok dengan total tim dan setiap pemain.
- Rotasi: durasi, kombinasi lima pemain, skor/+− ON/OFF, dan Net Rating estimasi jika seluruh pemeriksaan terkait lulus. Sampel satu/dua laga belum RAPM atau bukti efek kausal.

Pembaruan 26 Oktober: **9 dari 14 dataset rotasi klub–laga** lolos rekonstruksi penuh; **8** juga lolos atribusi input rating. Kedua laga Hangtuah valid. Rotasi Dewa vs Pelita (`2938930`) kini memuat 21 kombinasi, 40:00 dan skor 61–59; durasi serta plus/minus seluruh pemain cocok. Pada Q2 01:43, pasangan pergantian terpisah oleh satu free throw gagal (`sourceSequence=344`). Mesin mempertahankan urutan sumber dan hanya menggabungkan pasangan yang kembali menjadi lima pada clock/periode identik, tanpa perubahan skor. Aktor di sela pasangan harus ada pada kedua lineup. Menit/skor mentah dapat ditampilkan, tetapi event statistik itu tidak diberi lineup rekaan: rating seluruh laga tetap unavailable dengan alasan eksplisit. Pasangan yang belum lengkap ketika clock berubah, skor bertambah, identitas/aktor tidak valid, atau menit/plus-minus tidak cocok tetap menahan rekonstruksi. Interval berdurasi nol dengan aktivitas statistik dan lima pemain yang pasti sekarang dipertahankan, termasuk free throw gagal tanpa poin; perbaikan ini membuat input rating Rajawali vs Bogor cocok dengan box score kedua tim. Laga Dewa kedua dan empat dataset lain masih ditahan karena inkonsistensi aktor/skor sumber yang berbeda. Tidak ada perubahan payload sumber atau penulisan data basket Neon.

Metode rumus, koefisien, interpretasi dan sumber lapangan mengikuti [REPORTING_DEMO.md](./REPORTING_DEMO.md). Mesin yang dahulu dikunci Bima dua laga kini mempunyai jalur bertipe dengan scope kompetisi/klub/laga eksplisit; validator demo lama tetap mempertahankan cakupan 2025. Tidak mencampurkan kedua kompetisi.

Perapihan tampilan 26 Oktober: tab Perkembangan dihapus pada laporan klub 2026 dan demo Bima; URL `section=development` lama kembali ke Ringkasan. Fungsi perhitungan perkembangan tetap tersimpan untuk penggunaan internal. Kalimat jumlah laga dalam arsip dan timestamp di hero dihapus. Timestamp dipindahkan ke bagian **Cakupan jelas. Angka bisa ditelusuri.** di bawah laporan. Seluruh bagian metode/provenance ini hanya dirender di server untuk admin, berdasarkan role sesi; HTML staf tidak memuat bagian tersebut. Footer identitas klub tetap tampil untuk semua pengguna yang berhak.

Verifikasi perapihan: lima test terarah (termasuk HTML admin/staf dan fallback URL tab lama), lint, typecheck, serta build dashboard lulus. Browser akun admin memeriksa report Kesatria satu laga: lima tab, hero tanpa kalimat arsip/timestamp, dan timestamp berada pada footer metode. Lebar 1440/390 px tidak meluber; log browser bersih dan viewport dipulihkan. Tidak ada perubahan data atau database.

Tabel skuad dapat diurutkan lewat judul seluruh kolom, dengan arah aktif ditandai panah dan `aria-sort`. Default PTS/laga terbesar; klik kolom aktif membalik arah, kolom nama dimulai A–Z, kolom angka dimulai terbesar. Perbandingan memakai angka sebelum pembulatan; unavailable selalu di akhir, nol/negatif tetap angka. `sort`/`order` hanya menerima pilihan yang didukung dan disimpan di URL. Klik pemain mempertahankan urutan serta posisi halaman, lalu memperbarui kartu profil kiri; kartu mengikuti scroll pada desktop. Perilaku bersama ini juga berlaku pada demo Bima 2025.

## Mode deployment khusus report

Untuk deployment dashboard yang hanya menawarkan report, atur environment server:

```text
STATSARENA_REPORTS_ONLY=1
```

Proxy membatasi non-admin ke report dan route login/undangan/API autentikasi yang dibutuhkan. Non-admin yang membuka root/dashboard/demo admin diarahkan ke `/reports`; API lain dan slug asing tetap 404. Admin yang sesinya tervalidasi dapat membuka seluruh aplikasi meskipun flag report-only aktif. Setelah login admin default ke `/`, staf ke `/reports`. Ini pembatasan server, bukan hanya menyembunyikan menu. Login dan penugasan akses klub diperiksa terpisah di halaman/data/aksi; report sekarang membutuhkan koneksi akun Neon.

Pada proyek hosting Next.js, gunakan root directory `dashboard`, instal workspace dari lockfile root, dan sertakan file di luar root directory untuk package bersama `packages/db`. Build memakai `pnpm run build`. Set flag di environment proyek report tersebut; biarkan `0`/tidak disetel pada proyek dashboard lengkap. Konfigurasikan kredensial akun StatsArena dan secret sesuai panduan autentikasi, hanya di environment server. Semua route masih berada di repo yang sama; mode ini tidak menghapus source dashboard dari repo.

## Verifikasi 26 Oktober 2026

**48 test dashboard** lulus, mencakup semua klub, orientasi home/away, cakupan namespace, null/nol, satu laga tanpa delta buatan, rekonsiliasi semua shot chart, rotasi partial, dan pembatasan route. Lint dashboard/exporter, typecheck dashboard/ingest, serta build production dashboard lulus. Ekspor ulang input identik menghasilkan hash paket yang sama.

Server production lokal dengan flag report-only melewati **23 pemeriksaan HTTP**: root redirect, indeks dan seluruh 10 klub sukses, route dashboard/API/demo lama/slug asing 404, dan asset tersedia. Browser memeriksa katalog, Dewa dua laga (61–59 dan 66–57), GmSc serta rumus, grafik kuarter, satu kanvas shot chart (20/57 pada laga pertama), perkembangan K. Gemilang, rotasi Dewa partial, serta Kesatria satu laga tanpa delta buatan dan on/off valid. D. Dhoifullah: ON 26:10, +5, Net +10,24; OFF 13:50, +15, Net +59,43. Semua angka ini merupakan pengamatan satu laga.

Lebar 1440/390 px tidak membuat halaman meluber; tabel/peta rotasi menggunakan scroll internal dan dapat digeser dengan keyboard. Pergantian klub/form dan navigasi Enter diperiksa. Browser tidak mencatat warning/error; override viewport dipulihkan. Belum ada deployment hosting baru, verifikasi Neon, atau pemeriksaan hasil cetak/PDF.

Pembaruan interaksi tabel pada 26 Oktober: **50 test dashboard**, lint, typecheck, dan build lulus. Browser memverifikasi klik langsung D. Saputra → K. Kristanto → E. Junior, pengurutan GmSc terbesar/terkecil, dan urutan tetap saat mengganti pemain. Posisi halaman tetap 488,5 px selama klik pemain/sort; setelah scroll turun kartu profil berhenti pada 24 px dari atas layar desktop. Pada lebar 390 px, header TS% dapat diaktifkan dengan Enter, dua pemain tanpa percobaan tetap di akhir, profil kembali mengikuti alur satu kolom, dan halaman tidak meluber. Browser tanpa warning/error dan viewport dipulihkan. Metrik serta data sumber tidak berubah.

Verifikasi perbaikan interval 26 Oktober: **20 test terarah** rotasi, on/off, dan laporan lokal lulus; lint/typecheck dashboard serta build production lulus. Test memakai arsip nyata dan mutasi clock, skor, aktor, pergantian ganda/hilang, serta memeriksa semua menit/plus-minus dan denominator Rajawali. Browser production lokal memeriksa Dewa laga pertama (21 kombinasi, 61–59, 12 durasi/plus-minus cocok; rating tetap — dengan alasan), Dewa laga kedua tetap ditahan karena aktor di luar interval, dan Rajawali dengan rating ON/OFF tersedia. Tidak ada warning/error browser. Hasil ini tidak membuktikan deployment hosting atau impor interval Neon.
