# Parser dan Importer StatsArena

## JSON analisis otomatis — 22 Oktober 2026

Sync/retry/runner menulis file terpisah `ingest/audit/analysis/<key>.json` berisi metrik pemain/tim, input, versi rumus, dan cakupan laga. Dry-run/snapshot menulis preview. Audit sumber dan hash parser tetap terpisah. Data lama dapat diekspor offline dengan `analysis export --competition <ref>`; perintah ini tidak mengambil HTML atau mengakses Neon. Lihat [ANALYTICS.md](./ANALYTICS.md) untuk rumus, null, preservation, summary/delta, serta batas cakupan.

JSON analisis utama diperbarui pada path yang sama dan ditautkan melalui `analysisFile` di katalog; satu file preview disimpan terpisah. Metrik baru tidak disisipkan ke audit portal/JSON mentah LiveStats dan tidak menambah kolom Neon. `analysis export --dry-run` hanya memeriksa rencana, berbeda dari dry-run sync yang menghasilkan preview. Perintah serta pemulihan ekspor gagal ada di [panduan CLI](./INGEST_CLI.md#g-json-analisis-dari-data-lama).

Pengukuran ulang Jakarta South `49626`/`49633`, recovery PBP, dampak sleep Mac, dan rekomendasi optimasi query/retry dicatat dalam [laporan performa 17 Oktober 2026](./INGEST_PERFORMANCE_2026-10-17.md). CLI kini melaporkan `timings` per tahap; tidak ada perubahan schema atau kebijakan validasi pada pekerjaan profiling tersebut.

## Metrik tim portal dan prioritas sumber — 17 Oktober 2026

Parser `0.2.5` membaca 2CP, PIP, PFT, dan FBP pada baris Final Team Analysis berdasarkan header. PIP/PFT/FBP opsional antar layout: header tidak tersedia menghasilkan ketiadaan record, sedangkan sel yang kosong/invalid menghasilkan partial. BP laga tetap unavailable pada layout yang diperiksa. Jika record yang pernah tersimpan hilang pada pengambilan berikutnya, guard importer mempertahankan dataset valid lama. Statistik kompetisi tetap BP/2CP dan tidak dipakai sebagai nilai laga.

Dashboard memakai nilai portal per laga yang valid, kemudian LiveStats sebagai cadangan per tim/per metrik. Adapter LiveStats `1.0.1` membandingkan BP/2CP/PIP/PFT/FBP terhadap portal; selisih dicatat dengan expected/actual, tanpa mengganti salah satu nilai sumber. Nama, status pertandingan, box score, PBP, dan shots tetap memakai aturan sebelumnya.

Pengisian data lama tanpa pengambilan ulang:

```sh
pnpm --dir ingest run cli metrics backfill --dry-run
pnpm --dir ingest run cli metrics backfill
pnpm --dir ingest run cli metrics backfill --competition 49607 --dry-run
```

Operasi ini membaca snapshot HTML lokal yang hash-nya sama dengan observasi analysis terkini di Neon, lalu hanya menambahkan PIP/PFT/FBP yang belum mempunyai record. Record lama tidak diganti dan sumber baru tidak diminta. JSON audit menyimpan hasil per laga, hash dan ID fetch; FK mengikat provenance metric baru. Sumber tidak lengkap/snapshot hilang dilewati agar LiveStats tetap menjadi cadangan. Setelah commit portal, konflik dihitung terhadap payload LiveStats tersimpan; payload/identitasnya tidak diubah. Backfill tidak menyatakan LiveStats baru diunduh atau seluruh laga diperiksa ulang secara live.

Commit memegang table lock serta menolak lease/run aktif dan impor running yang berumur kurang dari 24 jam. Audit impor yatim yang lebih lama tidak dianggap writer bila tidak ada lease/run aktif, dan tidak diubah statusnya. Dry-run tidak mengambil table lock atau menulis Neon. Gunakan volume snapshot yang lengkap; operasi tidak membersihkan snapshot dan tidak memajukan baseline runner.

Adapter terpisah `statsarena-livestats/1.0.1` memperkaya pertandingan portal yang sudah tersimpan. Panduan pemetaan, status, backfill, retry, cache, dan provenance: [LIVESTATS.md](./LIVESTATS.md). Parser HTML portal tetap memakai versinya sendiri; dataset inti tidak diganti oleh adapter ini.

Optimasi Neon 12 Oktober 2026 memakai migrasi `0005_massive_unicorn`: input identik dengan run sukses terakhir menyimpan ringkasan dan referensi baseline, tanpa fetch/isu duplikat. Metadata dan klasemen identik dilewati; observasi dibatasi sekali sehari. Perubahan, partial/retry, dan archive mempertahankan audit lengkap. Aturan serta hasil dua siklus impor nyata ada di [efisiensi Neon](./NEON_EFFICIENCY.md).

## Menyiapkan workspace

Gunakan Node.js 22.19 atau lebih baru dan pnpm 12.9.1 (versi package manager dikunci di root). Cheerio 1.2 memerlukan Node.js 22.19 atau lebih baru. Jalankan dari root proyek:

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm test
```

Salin `.env.example` ke `.env` di root StatsArena hanya jika koneksi Neon StatsArena tersedia. CLI dan konfigurasi Drizzle memuat file root tersebut secara eksplisit, termasuk ketika dijalankan dengan `pnpm --dir`. Nilai yang sudah ada di environment shell/hosting tetap didahulukan. `.env` tidak diperlukan untuk test atau dry-run. `DATABASE_URL` dipakai importer; `DIRECT_DATABASE_URL` dipakai migrasi. Jangan memakai kredensial atau database proyek lain.

## Menjalankan discovery, dry-run, dan snapshot

CLI menerima ID numerik atau URL kompetisi dari `hosted.dcd.shared.geniussports.com`:

```sh
pnpm --dir ingest run cli --help
pnpm --dir ingest run cli discover --url 49607
pnpm --dir ingest run cli sync --competition 49607 --dry-run
pnpm --dir ingest run cli sync --competition https://hosted.dcd.shared.geniussports.com/IBF/en/competition/49607 --dry-run --match-limit 1
pnpm --dir ingest run cli snapshot read --url https://hosted.dcd.shared.geniussports.com/IBF/en/competition/49607
pnpm --dir ingest run cli sync --competition 49607 --dry-run --snapshot-only
```

`discover` membaca kompetisi, tim, pemain, dan semua tab klasemen tanpa membuka halaman pertandingan. `sync --dry-run` membaca summary, box score, play by play, shot chart, analysis, dan Team Statistics yang tersedia untuk laga complete/live/unknown; menulis audit JSON lokal ke `ingest/audit/`; serta menyimpan snapshot gzip yang berubah ke `ingest/snapshots/`. Perintah itu tidak menulis ke database. `--snapshot-only` mematikan jaringan; URL non-terjadwal yang belum memiliki snapshot akan terlihat sebagai isu fetch. Mode offline tidak memperbarui waktu pengambilan sumber. `--match-limit` membatasi jumlah fixture pertama untuk sampel cepat. Pengambilan default memakai cache valid dengan TTL; `--refresh` memeriksa ulang semua halaman yang diperlukan melalui HTTP. Lihat [kebijakan cache dan hasil pengukuran](./FETCH_OPTIMIZATION.md).

Untuk impor sungguhan, migrasikan schema lalu jalankan tanpa `--dry-run`:

```sh
pnpm --dir packages/db run db:generate
pnpm --dir packages/db run db:migrate
pnpm --dir ingest run cli sync --competition 49607
```

Migrasi memakai `DIRECT_DATABASE_URL`; importer memakai `DATABASE_URL`. Migrasi tanpa URL direct berhenti dengan pesan konfigurasi yang jelas. Koneksi, migrasi, dan impor inti `49607` diverifikasi pada 7 Oktober; migrasi Stage 5, dua kompetisi, dan impor ulang diverifikasi pada 8 Oktober 2026. Lihat [laporan Neon](./NEON_VERIFICATION.md).

## Keputusan schema dan impor

Schema Drizzle berada di `packages/db/src/schema.ts`, di schema PostgreSQL `statsarena`. UUID menjadi primary key internal, sedangkan `source` dan ID Genius Sports menjadi dasar identitas unik. Nama hanya diindeks untuk pencarian. Relasi kompetisi–tim dan kompetisi–pemain disimpan terpisah dari identitas global; entri halaman Players hanya membuktikan keikutsertaan pada kompetisi, sedangkan hubungan pemain–tim dibuat dari baris box score yang mencantumkan tim.

Schema berisi 19 tabel aplikasi: `competitions`, `teams`, `players`, `competition_teams`, `competition_players`, `team_rosters`, `competition_groups`, `group_standings`, `games`, `team_game_stats`, `player_game_stats`, `play_by_play_events`, `shots`, `team_official_metrics`, `source_fetches`, `import_runs`, `validation_issues`, `sync_runs`, dan `sync_leases`. ID grup menyimpan identitas URL tab beserta query fase/pool; `poolNumber` selalu diambil dari URL sumber. Waktu pertandingan dan menit mentah dipertahankan, persentase resmi disimpan sebagai teks, dan kolom statistik yang tidak tersedia tetap `null`. Event/shots memakai urutan sumber per laga sebagai identitas idempoten; metrik resmi memiliki batas unik terpisah untuk scope laga dan kompetisi. Tahap 6 menambah provenance `source_fetched_at` dan status/lease runner lewat migrasi `0003_sync_operations`.

Sejak parser `0.1.1`, `minutes` adalah menit desimal: `8:41` menjadi `8 + 41/60`, sedangkan `minutesRaw` tetap `8:41`. Kolom PostgreSQL memakai `double precision`; pembulatan hanya dilakukan saat menampilkan angka. Migrasi `0001_precise_minutes` memperbarui tipe kolom tim/pemain dan memulihkan detik statistik pemain lama dari `minutes_raw` yang formatnya valid. Format mentah yang tidak dikenali tetap mempertahankan angka lama. Jalankan migrasi ini sebelum memakai importer baru pada database yang sudah memiliki migrasi `0000`.

Fetcher memakai timeout 20 detik, konkurensi maksimum 3, retry/backoff terbatas, cache dengan TTL/checkpoint tervalidasi dan conditional HTTP, maksimal 5 redirect yang tetap harus menuju halaman sumber yang didukung, batas respons 8 MiB, hash SHA-256, dan snapshot gzip. Pembacaan snapshot membatasi file gzip sampai 8 MiB serta hasil dekompresi sampai 16 MiB. Metadata setiap URL masuk ke audit, termasuk mode `network`/`cache`/`snapshot`/`revalidated`, waktu isi sumber, serta umur cache; saat impor tersedia, record fetch menyimpan status HTTP, waktu, ukuran, hash, snapshot, serta log percobaan. `source_fetches.attempts` hanya menghitung request HTTP; record cache memiliki nol attempt. Elemen `kind: retrieval` pada `attempt_log` menyimpan mode dan provenance cache tanpa mengubah schema. Setiap halaman klasemen lengkap mengganti snapshot klasemen grup dalam transaksi. Statistik satu pertandingan ditulis dalam satu transaksi. Jika box score terbaru gagal diparse atau tidak lengkap, statistik valid sebelumnya tidak dihapus. Kegagalan constraint di tengah penulisan pertandingan me-rollback seluruh perubahan pertandingan itu.

Validasi lokal menandai ketidaksesuaian `PTS = 2×2PM + 3×3PM + FTM`, `FGA = 2PA + 3PA`, dan skor summary terhadap total poin tim. Nilai yang tidak lengkap tidak dianggap nol dan rumus hanya diuji saat seluruh komponennya tersedia.

Penggantian box score memerlukan dua tim berbeda, baris pemain untuk masing-masing tim, statistik hitung inti yang lengkap, dan jumlah poin pemain yang cocok dengan totals. Tautan ID pemain yang hilang, header inti yang tidak dikenali, sel terpotong, atau durasi tidak valid membuat hasil `partial`. Record parsial tetap tersedia untuk audit; pipeline tidak mengirimnya sebagai pengganti statistik valid. Importer mengulang pemeriksaan kelengkapan dan menolak penggantian ketika pemain yang pernah tersimpan hilang, termasuk pemain tanpa poin. Penghapusan pemain sebagai koreksi resmi perlu diperiksa secara terpisah; sinkronisasi rutin mempertahankan statistik lama dan mencatat isu. Jumlah statistik dalam hasil impor hanya mencakup penulisan yang berhasil commit.

## Verifikasi data nyata

Fixture HTML dan audit bertanggal 6 Oktober 2026 dibuat dari situs sumber. URL kompetisi kedua yang dipakai adalah [49609 — (F) DBL DI JOGJAKARTA SERIES](https://hosted.dcd.shared.geniussports.com/IBF/en/competition/49609).

- Kompetisi `49607`: dry-run seluruh halaman menemukan 27 tim, 322 pemain, 9 grup, 27 baris klasemen, 34 fixture (32 selesai, 2 terjadwal), 32 summary, 32 box score, 761 baris pemain, dan 64 baris total tim. Grup A dan B masing-masing berisi 3 tim; nilai pool sumbernya 9 dan 7. Tidak ada isu validasi formula/skor pada box score lengkap. Dua fixture terjadwal belum memiliki skor; sejak versi `0.1.2`, halaman summary/box score-nya dilewati sampai status fixture berubah. Dry-run terbaru menghasilkan 77 metadata halaman dan hanya dua isu info skor belum tersedia.
- Kompetisi `49609`: dry-run membaca 18 tim, 213 pemain, 6 grup, 18 baris klasemen, dan 24 fixture. Sampel fixture lengkap pertama, pertandingan `2915281`, menghasilkan 1 summary, 1 box score, 24 baris pemain, dan 2 total tim; tidak ada isu validasi formula/skor. Bentuk halaman dan pola tautan tetap cocok dengan parser yang sama; perbedaan yang teramati adalah jumlah entitas dan tab grup, bukan kebutuhan selector khusus.
- Uji importer PGlite menerapkan migrasi dan mengimpor ulang data asli `49607` dua kali tanpa pertumbuhan record logis: 1 kompetisi, 27 tim, 322 pemain kompetisi, 1 grup dengan 3 klasemen, 1 pertandingan, 2 statistik tim, 24 statistik pemain, dan 24 roster yang dibuktikan oleh box score. Uji terpisah memverifikasi pembaruan, mempertahankan statistik saat box score hilang, dan memicu constraint untuk membuktikan rollback transaksi.

Dry-run penuh 49607 menghasilkan `ingest/audit/49607-snapshot-dry-run.json`; dry-run 49609 menghasilkan `ingest/audit/49609-dry-run.json`. Audit dan snapshot kerja tidak disertakan ke kontrol versi; parser fixture terpilih yang dipakai test berada di `ingest/test/fixtures/live-2026-10-06/`.

### Perbaikan setelah review, 7 Oktober 2026

- 19 test lokal lulus, termasuk pembacaan `.env` root dari kedua direktori package, prioritas environment shell, durasi dengan detik, migrasi durasi lama, dan perlindungan statistik pada HTML yang kehilangan tautan/baris/header/sel.
- Uji importer membuktikan 24 statistik pemain tetap utuh setelah setiap variasi HTML tidak lengkap diimpor. Kasus baris pemain tanpa poin yang hilang juga mempertahankan data lama.
- Dry-run snapshot setelah perbaikan tetap menghasilkan 761 baris pemain dan 64 totals pada 49607; sampel 49609 tetap menghasilkan 24 baris pemain dan 2 totals. Tidak ada perubahan jumlah data lengkap akibat pemeriksaan baru.
- Pemeriksaan dijalankan dengan Node.js 26.7.0 yang memenuhi batas minimum proyek. Verifikasi Neon dilakukan setelah kredensial tersedia dan dicatat terpisah pada [laporan Neon](./NEON_VERIFICATION.md).

### Verifikasi Neon awal, 7 Oktober 2026

Kedua URL koneksi berhasil dipakai dan mengarah ke target yang sama. Migrasi `0000` dan `0001` tercatat pada jurnal Neon. SQL awal diperbaiki menjadi `CREATE SCHEMA IF NOT EXISTS` karena migrator Drizzle terlebih dahulu membuat schema jurnal. Test importer kini menjalankan migrator Drizzle yang sebenarnya, termasuk pengulangan migrasi.

Dry-run mengambil ulang HTML publik. Dua belas halaman laga selesai yang gagal diunduh berhasil diulang satu per satu dengan timeout 40 detik dan satu retry. Setelah seluruh 32 laga selesai memiliki summary serta box score lengkap, hasil dry-run dibekukan sebagai input yang sama untuk dua impor memakai importer produksi, Drizzle, dan koneksi pooled `postgres.js`.

Kedua impor menghasilkan 1 kompetisi, 27 tim, 322 pemain, 9 grup, 27 klasemen, 34 laga, 761 statistik pemain, 64 total tim, dan 322 roster. Tidak ada laga gagal ditulis. Skor 25–45 dan FGA 41–40 laga `2931666`, sembilan grup, seluruh 27 foreign key, 14 tabel aplikasi, serta presisi durasi terverifikasi. Audit lokal: `ingest/audit/49607-neon-verification-dry-run.json` dan `ingest/audit/49607-neon-verification.json`.

Dua laga masih berstatus `scheduled` dan disimpan tanpa summary/box score. Empat `FETCH_FAILED` untuk URL laga terjadwal serta dua isu info skor belum tersedia tetap tercatat. Pada verifikasi awal sebelum optimasi, karena isu fetch tersebut status run adalah `partial`; seluruh 32 laga selesai memiliki statistik lengkap dan seluruh 34 fixture berhasil ditulis. Kompetisi kedua `49609` belum diimpor ke Neon.

## Batch dan sinkronisasi statistik, versi 0.1.2

- Identitas tim/pemain, keikutsertaan, grup, fetch, klasemen, roster, statistik, dan isu ditulis sebagai batch maksimal 250 baris. ID internal hasil upsert dipakai ulang melalui map; tidak ada lagi upsert identitas untuk setiap statistik pemain. Entitas box score/fixture/klasemen tetap dikenali jika halaman registri gagal diambil.
- Identitas inti tetap berada dalam transaksi, klasemen dalam transaksi per grup, serta metadata pertandingan/roster/dua tabel statistik/isu dalam transaksi per pertandingan. Lock transaksi per ID sumber juga melindungi laga yang belum ada dari dua importer bersamaan; pemeriksaan kelengkapan dan kehilangan pemain dilakukan sebelum penggantian.
- Untuk box score lengkap, importer membandingkan semua nilai yang disimpannya dengan baris Neon: ID pemain/tim, angka, persentase, menit mentah/desimal, nomor jersey, serta URL pemain. Urutan baris, nama tampilan, metadata fetch, dan perubahan HTML di luar statistik tidak memicu penggantian. Pemeriksaan kelengkapan tetap berjalan sebelum perbandingan. Jika sama, tidak ada delete/insert statistik atau penulisan roster; ID serta timestamp statistik tetap sama.
- Koreksi nilai yang valid mengganti box score dalam transaksi yang sama. Data parsial, fetch gagal, dan parser gagal tetap mempertahankan statistik lama. Sinkronisasi rutin belum menerima penghapusan pemain sebagai koreksi otomatis.
- Audit pengambilan dan penunjuk sumber pada pertandingan tetap diperbarui meskipun statistik tidak berubah. Total klasemen tetap disinkronkan. Optimasi pengambilan HTML ditambahkan pada versi `0.1.3`; penjadwalan otomatis belum dibuat.

### Status data pertandingan

`data.matches[].availability` mencatat status **summary** dan **boxScore** secara terpisah. Nilainya: `scheduled`, `available`, `fetch_failed`, `partial`, `parse_failed`, atau `unavailable`.

| Status laporan pertandingan | Arti |
| --- | --- |
| `scheduled` | Fixture belum dimulai; kedua halaman statistik dilewati, bukan kegagalan fetch. |
| `ready` | Box score lengkap dan dapat ditulis atau dilewati jika sama. |
| `fetch_failed` | Halaman yang diperlukan gagal diambil; detail HTTP/attempt tetap dicatat. |
| `boxscore_partial` | HTML atau himpunan pemain/statistik tidak lengkap; data lama tidak diganti. |
| `parse_failed` | Halaman diterima tetapi gagal diparse, atau URL pertandingan tidak valid. |
| `unavailable` | Laga non-terjadwal belum memiliki box score yang dapat dipakai. |
| `import_failed` | Transaksi pertandingan gagal dan rollback. |

Ringkasan `matchStatuses` memilih status utama per laga; bila lebih dari satu halaman bermasalah, lihat `availability` dan daftar isu untuk rincian. `scheduled` tidak membuat run `partial`. Kegagalan pengambilan/parser, box score parsial, data non-terjadwal yang belum tersedia, kegagalan impor, atau isu error tetap membuat run `partial`. Tidak ada error lama yang dihapus; aturan baru berlaku untuk run baru.

### Mengartikan jumlah dan waktu

`imported.counts.playerGameStats` / `teamGameStats` adalah **jumlah baris yang ditulis dan commit pada run ini**, bukan jumlah statistik yang tersedia di database. Pada impor ulang yang sama keduanya dapat menjadi nol, sementara Neon tetap memiliki 761 statistik pemain dan 64 total tim.

- `unchangedBoxScores`: laga lengkap yang statistiknya sama dan tidak ditulis ulang.
- `preservedBoxScores`: laga non-terjadwal tanpa box score yang layak untuk penggantian; statistik lama dipertahankan jika ada.
- `readyGames`, `scheduledGames`, `fetchFailedGames`, `partialBoxScoreGames`, `parseFailedGames`, dan `unavailableGames`: status utama yang juga tersimpan di `import_runs.record_counts`.
- `timingsMs.fetchAndParse`: waktu pengambilan/pembacaan snapshot serta parsing.
- `timingsMs.databaseImport`: waktu importer sampai finalisasi run.
- `timingsMs.total`: keseluruhan sinkronisasi sampai sebelum penulisan audit akhir, termasuk membuka/menutup koneksi. Waktu persetujuan tool di luar proses CLI tidak dihitung.

Pemeriksaan lokal sekarang mencakup 23 test: batch melebihi 250 pemain, fallback identitas dari box score, perubahan angka/durasi, rollback, perlindungan HTML parsial, perubahan urutan baris, tidak adanya SQL penulisan statistik pada impor ulang, dan transisi scheduled → complete. Dry-run snapshot `49607` memiliki 32 laga lengkap dan 2 terjadwal tanpa kegagalan fetch; sampel `49609` tetap memiliki 24 baris pemain serta 2 totals. Lihat [hasil optimasi di Neon](./NEON_VERIFICATION.md#optimasi-impor-ulang-versi-012).

## Cache HTML dan retry, versi 0.1.3

Pengambilan HTML kini memakai checkpoint per URL setelah parsing berhasil. Laga selesai dapat memakai cache yang masih segar; live/unknown selalu memakai HTTP, dan scheduled tetap dilewati. Perubahan fixture mengubah konteks cache dan memicu pengambilan ulang halaman pertandingan. Cache kedaluwarsa diperiksa ulang berkala; kegagalan fetch terakhir, parse parsial/gagal, dan error validasi tidak menjadi checkpoint sukses.

Retry melepas slot konkurensi saat backoff. Permintaan live dan laga yang belum memiliki konteks valid diprioritaskan; URL sama yang diminta bersamaan berbagi satu request. Respons non-HTML, redirect tidak aman, respons terlalu besar, kegagalan penyimpanan, dan HTTP permanen tidak diulang. Audit membedakan timeout saat menunggu respons dari timeout saat membaca body serta menyimpan kode penyebab transport jika tersedia.

33 test lokal, lint, typecheck, dan build lulus. Dua dry-run online `49607` memakai 66 lalu 76 halaman cache; yang kedua memerlukan satu request HTTP dan sekitar 6 detik. Dataset tetap memiliki 761 baris pemain dan 64 totals. Angka ini memakai snapshot sumber yang sudah tersedia, bukan pengunduhan pertama dari cache kosong. Pada sampel online `49609`, box score tetap terbaca, tetapi halaman Players menerima HTTP 200 tanpa blok pemain dan tetap dicatat sebagai parser gagal setelah diulang. Rincian TTL, resume, pembacaan offline, dan hasil sumber kedua tersedia di [FETCH_OPTIMIZATION.md](./FETCH_OPTIMIZATION.md).

## Data rinci pertandingan, 8 Oktober 2026

Fetcher menemukan tautan detail dari halaman pertandingan dan hanya meminta halaman statistik untuk laga yang tidak berstatus scheduled. Setiap fetch mencatat URL, waktu, HTTP, hash, mode cache/network, parser, dan snapshot. Parser tetap murni HTML-ke-record. Migrasi `0002_match_details` menambahkan `play_by_play_events`, `shots`, dan `team_official_metrics`; importer mengganti event, chart, dan metrik per pertandingan secara transaksional, melewati dataset identik, serta mempertahankan isi valid saat fetch/parser baru gagal atau parsial.

Pemetaan selector sumber:

- Play by play: `#playbyplay .pbpa`. `.pbp-time`, `.pbp-period`, `.pbpsc`, `.pbp-action`, kelas periode `per_N`/`per_ot`/`per_reg`, dan kelas tim menyimpan waktu mentah, tipe periode, skor, aksi, tim serta urutan DOM sumber. ID pemain/tim hanya diisi dari tautan atau bukti eksplisit pada halaman. Event dengan waktu sama tetap memiliki `sourceSequence` berbeda.
- Shot chart: `#shotchart .sc_img`. Hanya `title` yang menyebut 2PT/3PT diterima; token kelas menentukan made/missed dan ID tim/pemain/periode. Posisi CSS `left`/`top` disimpan mentah dan menjadi persen kanvas X/Y. Koordinat ditampilkan pada kanvas sumber tanpa rotasi karena orientasi lapangan sumber tidak ditetapkan secara eksplisit.
- Metrik laga: `.team-analysis table.tableClass` dibaca berdasarkan header; 2CP yang tersedia disimpan sebagai metrik resmi per laga. BP per laga tidak disimpulkan dari box score dan ditandai unavailable ketika sumber tidak menyediakannya.
- Metrik kompetisi: `table.tableClass` pada Team Statistics dibaca berdasarkan header Team/GP/BP/2CP. Nilai BP/2CP, unit, nama sumber, dan GP sampel disimpan pada scope kompetisi. Metrik ini tidak dijoin atau ditampilkan seolah-olah angka satu laga.

FGA/FGM chart dibandingkan dengan box score tim. Mulai parser `0.2.1`, `SHOT_FGA_MISMATCH` dan `SHOT_FGM_MISMATCH` adalah isu error: chart ditandai partial dan isi lama dipertahankan; tidak ada koreksi diam-diam. Pada snapshot yang sesuai, pertandingan `2931666` berisi 81 marker tembakan, 24 made, FGA kedua tim 41/40, serta FGM 9/15. Foul dan turnover bukan tembakan. Waktu event tidak diubah menjadi detik saat tidak tersedia.

### Perlindungan data rinci, versi 0.2.1

- Team Analysis dan Team Statistics memeriksa jumlah sel terhadap header. Sel hilang, kosong, angka negatif/desimal, dan teks invalid menghasilkan partial; nol tetap nol. Penanda `-`, `–`, `—`, atau `n/a` yang berada di sel lengkap adalah unavailable eksplisit. BP per laga tetap unavailable karena tidak ada pada Team Analysis.
- Importer memeriksa kembali kelengkapan metrik saat membaca JSON audit: tim/metrik tersimpan yang hilang, atau unavailable tanpa bukti penanda sumber, tidak mengganti dataset lama. Berlaku pada scope laga dan kompetisi.
- PBP dengan jumlah event lebih sedikit daripada dataset tersimpan menghasilkan `PBP_EVENTS_SHRANK`. Sumber memakai urutan DOM tanpa ID event stabil, sehingga penurunan jumlah tidak membuktikan koreksi penghapusan. Sinkronisasi otomatis menahan seluruh dataset dan mencatat isu untuk review. Koreksi isi dengan jumlah sama dan penambahan event tetap didukung; penghapusan resmi perlu verifikasi terpisah.
- Shot chart dicocokkan lagi oleh importer dengan box score lengkap terbaru, atau total tim tersimpan jika box score baru gagal/parsial. Pengurangan jumlah tembakan diperbolehkan bila total FGA/FGM resmi lengkap ikut mengonfirmasi perubahan. Tanpa total lengkap, penurunan ditahan dengan `SHOT_DATASET_SHRANK`.
- Pipeline mengubah checkpoint chart yang mismatch menjadi partial agar pengambilan berikutnya mencoba halaman itu kembali. Ketika importer mendeteksi kehilangan data, metadata fetch run tersebut juga ditandai partial di database; record dan provenance dataset lama dipertahankan. Untuk PBP atau metrik yang kehilangan seluruh baris, gunakan `--refresh` setelah sumber diperiksa, karena pembandingan dengan dataset lama dilakukan saat impor, sesudah checkpoint HTML.
- Seluruh penggantian detail dan penanda fetch parsial satu laga berada dalam transaksi yang sama, termasuk laga yang box score-nya tidak tersedia. Counter hanya menghitung penulisan yang commit.

Test PGlite membuktikan HTML kehilangan event, marker, sel metrik, dan baris tim tidak mengubah ID/timestamp dataset lama. Test juga mencakup JSON audit lama dengan nilai kosong, unavailable eksplisit, koreksi chart yang cocok dengan total resmi, fallback total tersimpan, rollback, dan idempotensi. Pipeline test membuktikan chart mismatch tidak menjadi cache valid dan pulih setelah halaman lengkap diambil ulang. Schema tidak berubah pada perbaikan ini; tidak diperlukan migrasi Neon.

Dry-run offline versi ini pada satu laga per kompetisi berhasil: `49607` menghasilkan 359 event/67 tembakan, `49609` menghasilkan 466 event/57 tembakan; masing-masing memiliki empat metrik laga, serta 54/36 metrik kompetisi. Kedua sampel tidak memiliki fetch gagal, parse gagal, atau halaman partial. Audit: `ingest/audit/49607-stage5-preservation-dry-run.json` dan `49609-stage5-preservation-dry-run.json`. Ini verifikasi snapshot lokal, bukan impor ulang Neon.

Dashboard memilih status halaman detail berdasarkan waktu request audit terbaru (`requested_at`, lalu `created_at`), sementara `fetched_at` tetap menunjukkan waktu HTML sumber. Dengan demikian hasil cache yang baru ditandai partial tidak tertutup oleh record lama atau urutan UUID acak. Perilaku ini diuji pada query PGlite.

Dry-run live dan impor Neon StatsArena mencakup:

| Kompetisi | Teams / players | Groups / standings | Games (complete / scheduled) | Player / team box rows | PBP events | Shots | Game metrics | Competition metrics |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `49607` | 27 / 322 | 9 / 27 | 34 (34 / 0 pada snapshot impor ini) | 809 / 68 | 15,455 | 3,018 | 136 | 54 |
| `49609` | 18 / 213 | 6 / 18 | 24 (22 / 2) | 514 / 44 | 9,853 | 1,702 | 88 | 36 |

Kedua input yang sama diimpor ulang ke Neon; impor ulang tidak menulis statistik box score, event, shots, atau metrik yang tidak berubah. Query langsung Neon memastikan jumlah logis tetap stabil. Laga terjadwal `49609` tetap tanpa halaman statistik dan tanpa angka nol palsu. Verifikasi memakai URL kompetisi kedua [`49609`](https://hosted.dcd.shared.geniussports.com/IBF/en/competition/49609). Enam isu info tersisa pada dry-run 49609 adalah skor dua laga scheduled dan empat event tanpa teks aksi; dry-run penuh yang dipulihkan tidak memiliki fetch atau parse yang gagal.

Fixture HTML bertanggal berada di `ingest/test/fixtures/live-2026-10-08/`, dilengkapi URL dan hash. Audit terbaru: `ingest/audit/49607-stage5-dry-run.json`, `49607-stage5-import-1.json`, `49607-stage5-import-2-snapshot.json`, `49609-stage5-live-retry-2.json`, `49609-stage5-import-recovered.json`, dan `49609-stage5-import-recovered-2.json`. Audit/snapshot kerja tetap diabaikan Git.

## Batas tahap ini

Tahap 5 data rinci selesai. Pada snapshot impor akhir, seluruh 34 laga `49607` sudah complete, sedangkan dua laga `49609` masih scheduled dan belum menyediakan halaman detail; laga scheduled tidak mempunyai event, chart, atau statistik laga. BP per laga tidak tersedia pada sumber yang diperiksa. Orientasi dan ukuran fisik kanvas Genius Sports tidak diketahui; dashboard mempertahankan koordinat sumber tanpa rotasi. Runner dan status operasional Tahap 6 dijelaskan di [panduan sinkronisasi](./SYNC_OPERATIONS.md); hasil migrasi dan impor Neon ada di [catatan verifikasi](./NEON_VERIFICATION.md).

Parser `0.2.2` melanjutkan aturan preservation `0.2.1` dan memperbaiki discovery `/schedule` tanpa query. Runner menyimpan antrean halaman yang belum diperiksa dalam checkpoint per kompetisi, melaporkan cakupan terpotong sebagai partial, mempertahankan metadata seluruh pass refresh PBP, dan menyimpan konteks fetch/parse ketika impor gagal. Versi baru memerlukan validasi ulang checkpoint HTML yang bertanda versi parser lama.

## Dokumentasi resmi dependensi

- [Node.js release schedule](https://nodejs.org/en/about/previous-releases)
- [Cheerio: versi runtime dan pemuatan HTML](https://cheerio.js.org/docs/intro/)
- [Zod: parse, safeParse, dan tipe hasil](https://zod.dev/basics)
- [Drizzle: driver PostgreSQL](https://orm.drizzle.team/docs/get-started-postgresql) dan [transaksi](https://orm.drizzle.team/docs/transactions)
- [pnpm workspaces](https://pnpm.io/workspaces)

## Status detail parser 0.2.3

Status per dataset, penyebab spesifik marker (`actual.invalidFields`), serta backfill metadata tanpa pengunduhan ulang dijelaskan pada [DATA_QUALITY.md](./DATA_QUALITY.md). Guard penggantian box score/PBP/chart/metrik tetap berlaku. Dataset quality dicatat pada JSON audit dan Neon setelah transaksi berhasil.

## Dukungan namespace IBL — 16 Oktober 2026

Parser `0.2.4` memakai identitas sumber terpisah untuk IBF dan IBL sampai importer, lease, incremental, checkpoint, audit/retry, dan dashboard. Input angka tetap IBF; gunakan `IBL:42041` atau URL lengkap untuk IBL. Perhitungan 2P dari FG−3P hanya mengisi kolom yang tidak disediakan dan menyimpan formula/versi/input pada audit serta `stat_derivations` (migrasi `0007_quiet_polaris`). Sel resmi invalid tetap parsial. Adaptasi navigasi, metrik lintas tabel, klasemen kosong, fixture bertanggal, dan batas verifikasi dijelaskan di [SUMBER_DATA_IBL.md](./SUMBER_DATA_IBL.md).
