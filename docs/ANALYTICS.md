# JSON analisis dan rumus bersama

Implementasi: 22 Oktober 2026. Versi rumus: `statsarena-analytics/1.0.0`.

## Alur

```text
HTML gzip → parser portal → audit sumber → impor Neon
                                ↓
                     fungsi TypeScript bersama
                                ↓
                   audit/analysis/<kompetisi>.json

Neon → query server dashboard → definisi rumus yang sama → tampilan
```

Modul murni `packages/db/src/analytics.ts` menyimpan definisi rumus dan evaluasi angka. Modul `analytics-sql.ts` mengubah definisi tersebut menjadi SQL untuk agregasi, sorting, dan pagination dashboard. Modul perhitungan tidak membuka koneksi database atau membaca file. Ekspor ada di `ingest/src/analytics/export.ts`.

Statistik dasar tetap angka sumber. `advancedStats` adalah **hasil hitung StatsArena**, dengan versi, unit, rumus, penanda estimasi, input, dan cakupan yang tercantum dalam JSON. Tidak ada kolom analitik atau migrasi Neon baru. JSON ini tidak menyalin PBP, shots, atau payload LiveStats; tambahan resmi LiveStats tetap mengikuti alurnya sendiri.

## Otomatis setelah ingest

`sync`, `retry`, dan runner membuat/memperbarui satu file `ingest/audit/analysis/<key>.json` setelah audit sumber tersimpan. Incremental menggabungkan detail yang baru diproses dengan input valid sebelumnya. Pengambilan detail lama yang dilewati tidak menghilangkan statistiknya.

- `--dry-run` dan `--snapshot-only` membuat `<key>.preview.json`; file utama tetap dipertahankan. Preview bukan bukti impor Neon.
- Kegagalan proses sebelum audit sukses tidak mengganti file utama. Kegagalan ekspor dicatat sebagai peringatan dan `analysis: null` pada hasil operasi; impor Neon yang sudah commit tetap berstatus sebagaimana hasilnya. Ekspor dapat diulang offline.
- Penulisan atomik dan lock per kompetisi melindungi file. Namespace dibedakan: `49607.json` untuk IBF, `IBL-47793.json` untuk IBL.
- Hanya satu versi current dan satu preview per kompetisi, tidak membuat histori file baru setiap siklus. Audit sumber, hash parser, baseline retensi, serta snapshot gzip tidak diubah oleh eksportir.
- Pada VPS, direktori analysis ikut volume audit permanen. Tidak ada layanan baru yang harus dijalankan.

Katalog `ingest/config/competitions_catalog.json` menambahkan `analysisFile` untuk menemukan file utama. Preview tidak dijadikan file analisis utama dalam katalog. Pembuat konten/AI dapat membaca JSON tersebut atau memakai fungsi TypeScript bersama; pembuatan MD/HTML tetap proses tersendiri.

## Ekspor data lama tanpa HTML atau Neon

```sh
pnpm --dir ingest run cli analysis export --competition 49607 --dry-run
pnpm --dir ingest run cli analysis export --competition 49607
pnpm --dir ingest run cli analysis export --competition IBL:47793
pnpm --dir ingest run cli analysis export --competition 49607 --audit ingest/audit/nama-audit.json
```

Untuk perintah `analysis export`, `--dry-run` hanya memeriksa dan melaporkan rencana, tanpa menulis file analisis atau katalog. Berbeda dari dry-run sync yang tetap menghasilkan preview.

Ekspor offline membaca audit full, delta, dan referensi summary lokal. Hash referensi diperiksa sebelum payload dipakai; path traversal, siklus referensi, file terlalu besar, symlink, serta namespace berbeda ditolak. Audit yang tidak dapat dibaca saat pemindaian dilaporkan sebagai `skippedAudits`; audit yang dipilih eksplisit wajib valid. Jika seluruh payload lama sudah kedaluwarsa dan tidak ada file analisis sebelumnya, data itu tidak dapat direkonstruksi dari summary saja. Perlu audit/snapshot valid; eksportir tidak mengambil sumber secara diam-diam.

File utama berisi observasi sumber lokal yang lolos validasi, **bukan salinan terverifikasi seluruh isi Neon**. `source.importStatus` dan waktu audit dipertahankan. Ekspor offline dapat membaca audit dry-run; jangan menyimpulkan semuanya sudah diimpor dari keberadaan file saja.

## Struktur JSON

| Bagian | Isi |
| --- | --- |
| `analyticsVersion`, `methodology.metricDefinitions` | Versi, rumus aktual, unit, `estimated`, dan `origin: statsarena_calculated` |
| `exportMode` | `analysis` untuk file utama atau `preview` untuk hasil percobaan sync/snapshot; keduanya tetap perlu dibaca bersama provenance impor |
| `competition`, `scope` | Identitas namespace, daftar laga masuk/dikeluarkan/dipertahankan, fixture yang diketahui dan cakupan discovery |
| `games[]` | Fixture, input box score terstruktur, provenance, status input, alasan pengecualian, hasil hitung tim dan pemain per laga |
| `players[]` | ID, tim, game IDs, GP baris box score, totals, perGame, contextTotals, advancedStats, unavailableReasons |
| `teams[]` | ID, game IDs, GP, totals, perGame, opponentTotals, advancedStats, unavailableReasons |

Contoh membaca TS%: `players.find(p => p.sourceId === "1434512").advancedStats.trueShootingPercentage`. Nilai persen memakai skala 0–100; rasio FTA/FGA dan 3PA/FGA memakai pecahan, misalnya `0.25`. Angka tidak dibulatkan sebelum perhitungan.

## Rumus pemain

Semua sigma/total di bawah memakai game IDs yang sama. `TmMIN` adalah jumlah menit pemain satu tim; satu durasi pertandingan estimasi adalah `TmMIN/5`.

| Metrik | Definisi |
| --- | --- |
| FG%, 2P%, 3P%, FT% | `100 × made / attempts` |
| eFG% | `100 × (FGM + 0.5 × 3PM) / FGA` |
| TS% (estimasi) | `100 × PTS / [2 × (FGA + 0.44 × FTA)]` |
| EFF | `PTS + REB + AST + STL + BLK − (FGA−FGM) − (FTA−FTM) − TOV` |
| Game Score | `PTS + 0.4FGM − 0.7FGA − 0.4(FTA−FTM) + 0.7ORB + 0.3DRB + STL + 0.7AST + 0.7BLK − 0.4PF − TOV` |
| EFF/Game Score per laga | Total metrik dibagi GP baris box score dalam cakupan |
| AST/TO | `AST/TOV` |
| TOV% (estimasi) | `100 × TOV/(FGA + 0.44FTA + TOV)`; penyebut aktivitas penyelesaian, bukan possession yang dihitung dari PBP |
| 3P/FT attempt rate | `3PA/FGA`, `FTA/FGA` |
| PTS/REB/AST per 40 | `40 × total statistik / total menit` |
| Porsi poin pemain | `100 × PTS/TmPTS` dalam laga pemain yang sama |
| Porsi poin 2P/3P/FT | `100 × 2×2PM/PTS`, `100 × 3×3PM/PTS`, `100 × FTM/PTS` |
| USG% (estimasi) | `100 × (FGA+.44FTA+TOV) × (TmMIN/5) / [MIN × (TmFGA+.44TmFTA+TmTOV)]` |
| AST% (estimasi) | `100 × AST / [(MIN/(TmMIN/5))×TmFGM − FGM]` |
| ORB% (estimasi) | `100 × ORB × (TmMIN/5) / [MIN × (TmORB+OppDRB)]` |
| DRB% (estimasi) | `100 × DRB × (TmMIN/5) / [MIN × (TmDRB+OppORB)]` |
| TRB% (estimasi) | `100 × REB × (TmMIN/5) / [MIN × (TmREB+OppREB)]` |

Formula estimasi menit membutuhkan menit semua baris pemain tim. Satu menit tidak tersedia membuat konteks menit tim `null`; total tim yang mencantumkan durasi tidak menggantikan jumlah menit pemain. Ketelitian durasi dipertahankan termasuk detik. GP menghitung baris box score yang masuk, tidak menebak DNP hanya dari menit nol. Tidak ada minimum menit otomatis untuk ranking; pengguna analisis perlu memperhatikan GP dan menit yang disediakan.

## Rumus tim

Tersedia persentase shooting, eFG% tim/lawan, TS%, AST/TO, TOV%, attempt rates, serta porsi poin 2P/3P/FT. Definisi yang sama dengan pemain menggunakan total tim resmi.

Versi ini mengekspor eFG% lawan sebagai `opponentEffectiveFieldGoalPercentage`. TS%, TOV%, 3PA/FGA, dan FTA/FGA khusus lawan masih rencana, meskipun `teams[].opponentTotals` sudah menyediakan inputnya. Spesifikasi tambahan tersebut dicatat di [pengembangan statistik](./PENGEMBANGAN_STATISTIK.md#tambahan-metrik-lawan--catatan-pengembangan-22-oktober-2026).

- ORB% tim: `100 × ORB/(ORB + OppDRB)`; DRB% tim: `100 × DRB/(DRB + OppORB)`.
- `PossTim = FGA + 0.44FTA − ORB + TOV`; possession bersama: `(PossTim + PossLawan)/2`.
- ORtg: `100 × PTS/PossBersama`; DRtg: `100 × OppPTS/PossBersama`; NetRtg: `100 × (PTS−OppPTS)/PossBersama`.
- Ketiga rating adalah **estimasi poin per 100 possession**, bukan rating individu selama berada di lapangan. Total possession kompetisi dijumlahkan pada cakupan laga yang sama.
- Rebound memakai total tim sumber, termasuk team rebounds sesuai yang tercakup dalam angka resmi. Tidak memaksa jumlah rebound individu sama dengan total tim.
- PIP/FBP/2CP bisa bertumpang tindih dengan poin 2P/3P/FT. Ekspor ini belum menambahkan profil metrik resmi tersebut. Jangan menjumlahkannya sebagai kategori poin yang saling terpisah.

## Kelengkapan dan agregasi

Laga masuk agregat hanya jika berstatus `complete` dan box score lolos validasi inti, identitas dua tim/pemain, rumus skor, serta kecocokan skor fixture. Masalah shot chart/PBP saja tidak meniadakan box score valid. Box score parsial/gagal mempertahankan input valid sebelumnya bila masih cocok dengan fixture; status menjadi `preserved` dengan provenance lama dan alasan percobaan terbaru. Perubahan skor yang membuat input lama tidak cocok mengeluarkan laga sampai ada box score valid.

`fixtureCoverageComplete` menunjukkan bahwa discovery tidak memiliki halaman tertunda dan setiap fixture yang ditemukan terwakili. Ini **tidak berarti semua box score lengkap**: periksa `includedGameIds`, `excludedGameIds`, `games[].problems`, dan `preservedGameIds`. Audit lama tanpa metadata discovery yang cukup tetap dilabeli belum terbukti lengkap. Discovery terpotong mempertahankan laga lama; daftar fixture lengkap terbaru dapat mengecualikan laga yang tidak lagi tercantum.

Persentase agregat dihitung dari total pembilang/penyebut, bukan rata-rata persentase per laga. Konteks tim/lawan pemain terbatas pada laga pemain yang masuk; statistik tim pada laga lain tidak ditambahkan. Satu input metrik hilang membuat total input itu null dalam cakupan tersebut; tidak menghitung sebagian secara diam-diam.

`unavailableReasons`: `missing_input`, `invalid_input`, atau `nonpositive_denominator`. Nilai nol tetap nol; penyebut nol/negatif menghasilkan null. EFF/Game Score/NetRtg negatif yang sah tetap boleh muncul. `advancedStats` tidak memuat on/off, lineup, clutch, atau plus/minus hasil rekonstruksi.

## Verifikasi

Test lokal mencakup rumus, agregasi berbobot, detik menit, nol/null, konteks tim/lawan, kesetaraan seluruh formula TypeScript dengan PostgreSQL PGlite, ekspor full/summary/delta, hash, isolasi namespace, incremental, preservation, fixture terpotong, preview, dan ekspor berulang. Query dashboard tetap menghitung dan mengurutkan sebelum pagination. Tidak diperlukan migrasi atau impor ulang Neon untuk memakai rumus bersama.

Verifikasi 22 Oktober 2026: suite workspace 123 test lulus (114 ingest, sembilan dashboard), lint, typecheck, dan build lulus. Ekspor offline 49607 memuat 35 laga masuk, 322 pemain, dan 27 tim; 49609 memuat 25 laga masuk, 212 pemain, dan 18 tim. Jumlah pemain merupakan pemain pada box score yang masuk, bukan total roster. Sampel pemain `1434512`: lima laga, 78 PTS, 59 FGA, 15 FTA menghasilkan TS% `59.451219512195124`. Dua laporan verifikasi lama 49607 yang bukan payload audit diabaikan dan dicantumkan pada `skippedAudits`.

Sync snapshot-only satu sampel detail per kompetisi berhasil membuat preview sambil mempertahankan agregat laga lama. Seluruh pemeriksaan tersebut memakai file lokal/PGlite, tanpa mengambil HTML baru atau menulis ke Neon.
