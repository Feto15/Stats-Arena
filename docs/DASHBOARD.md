# Dashboard StatsArena

Optimasi 29 Oktober 2026: cache query server dengan TTL 5–60 detik dan pemeriksaan akses pada setiap request, pool auth/data bersama, direktori laporan ringan, serta perpindahan tab laporan tanpa request server. Data Neon dan rumus tidak berubah. Metode, batas kesegaran dan pengukuran: [DASHBOARD_PERFORMANCE.md](./DASHBOARD_PERFORMANCE.md).

## Rumus analitik bersama — 22 Oktober 2026

Persentase shooting, eFG%, TS%, AST/TO, dan EFF per laga pada daftar pemain memakai `@statsarena/db/analytics-sql`, dari definisi `statsarena-analytics/1.0.0` yang juga digunakan ekspor JSON. Query tetap menghitung dan mengurutkan sebelum pagination serta menjaga scope kompetisi/filter. Tidak ada tambahan kolom UI dalam pekerjaan ini. Metrik baru tersedia pada JSON analisis; panduan serta rumus ada di [ANALYTICS.md](./ANALYTICS.md). Neon tetap menyimpan input resmi dan provenance, tanpa migrasi untuk metrik turunan ini.

## Prioritas metrik tim — 17 Oktober 2026

Detail laga kini menampilkan satu tabel **Metrik tim per pertandingan** untuk BP/2CP/PIP/PFT/FBP. Nilai portal yang available/valid dipilih lebih dahulu; nilai LiveStats terverifikasi menjadi cadangan per tim dan per metrik. Nol eksplisit portal tetap dipilih. Setiap angka membawa label/tautan sumber; selisih menampilkan nilai LiveStats terpisah di sel yang sama dan tercatat pada Review. Agregat kompetisi tidak dipakai untuk mengisi metrik laga dan kedua sumber tidak dijumlahkan. Jika keduanya kosong, tampil `—`.

Tabel tambahan pemain LiveStats tetap memuat plus/minus, starter, PIP dan metrik individu lain. Tabel tim LiveStats terpisah dihapus untuk menghindari dua angka utama pada metrik sama. Nilai LiveStats lama yang masih valid dapat tetap ditampilkan ketika observasi baru gagal, sesuai provenance/status tambahan.

## Laga bermasalah lintas kompetisi — 17 Oktober 2026

Setiap isu pada Review global dan per kompetisi memiliki kotak **Dampak** yang menjelaskan cakupannya: pemain tertentu, satu tim beserta pemainnya, seluruh tambahan laga, kolom tambahan, atau dataset portal seperti peta tembakan/box score/PBP. Penjelasan mengikuti aturan penerimaan parser, bukan asumsi bahwa data lama pasti tersedia. Baris histori portal diberi label **Dampak saat pemeriksaan** agar tidak dibaca sebagai kondisi aktif sekarang. Jumlah starter yang belum terverifikasi tidak diartikan sebagai hilangnya seluruh statistik. Dampak tidak mengubah statistik, status, atau keputusan pemetaan.

Buka `/review?scope=all` atau tombol **Lihat laga bermasalah semua kompetisi** pada Review per kompetisi. Review tanpa pilihan kompetisi juga membuka daftar global. Setiap baris adalah satu laga unik, dengan nama kedua tim, skor/status hasil, nama/ID kompetisi, alasan dari masing-masing sumber, waktu pemeriksaan, serta tautan pertandingan dan Review kompetisi. Tautan selalu membawa referensi kompetisi termasuk namespace IBL; memilih kompetisi pada header keluar dari scope global.

Daftar global membaca masalah **aktif**, bukan histori `validation_issues`: dataset portal `partial/failed` dari `games.detail_quality`, fallback status detail bila metadata belum tersedia, dan tambahan LiveStats non-ready. Dataset unavailable eksplisit portal tidak dianggap kegagalan; pertandingan scheduled dilewati. Setelah observasi pulih, laga hilang bila tidak memiliki masalah lain. Filter sumber/severity/kode diterapkan sebelum pengelompokan dan pagination; kartu menghitung laga unik sesuai filter. Satu laga dapat tercatat pada kedua sumber sehingga jumlah kartu sumber tidak boleh dijumlahkan sebagai total laga.

Scope global hanya untuk pemeriksaan kualitas, tidak menggabungkan statistik atau klasemen kompetisi. Query read-only tidak memulai ingest, menghapus audit, atau memperbarui status hasil pertandingan. Daftar per kompetisi tetap mempertahankan histori portal.

## Review portal dan LiveStats — 16 Oktober 2026

`/review` menggabungkan histori isu portal (`validation_issues`) dan isu LiveStats aktif dari `game_livestats.issues`, dibatasi kompetisi terpilih. Filter `source=portal|livestats`, severity, dan kode isu diterapkan sebelum pengurutan/pagination. Histori portal tetap diberi penanda run, sedangkan LiveStats diberi penanda pengamatan terbaru. Status pertandingan (misalnya selesai) dan status tambahan LiveStats (partial/mismatch/fetch_failed) ditampilkan terpisah.

Kartu menghitung baris isu per sumber serta jumlah laga LiveStats yang perlu diperiksa. Jumlah baris isu tidak sama dengan jumlah laga. Baris LiveStats yang kembali ready otomatis hilang dari daftar aktif tanpa menghapus audit sumber. Perbandingan expected/actual dapat dibuka di baris isu; referensi file snapshot internal tidak dikirim oleh query Review. Tidak ada penyalinan isu ke tabel portal, migrasi, atau pembaruan status pertandingan dalam perubahan ini.

Detail laga kini membaca `game_livestats` secara server-side dalam scope kompetisi/game. Bagian tambahan menampilkan plus/minus, starter/bench, posisi, statistik pemain/tim, status, waktu sumber, tautan, dan alasan review. Nilai portal dan LiveStats dipisahkan; lihat [LIVESTATS.md](./LIVESTATS.md). Migrasi `0008_stiff_blockbuster` diperlukan sebelum query versi ini digunakan.

Status: Tahap 5 selesai dan diverifikasi lokal serta pada Neon StatsArena pada 8 Oktober 2026.

## Menjalankan

Gunakan Node.js minimal 22.19 dan pnpm 12.9.1 dari root workspace:

```sh
pnpm install
pnpm --dir dashboard run dev
```

Buka [http://localhost:3000](http://localhost:3000). Development server mengikat ke loopback (`127.0.0.1`) agar dashboard lokal tidak terbuka ke jaringan. Untuk memuat data Neon, sediakan `DATABASE_URL` pooled StatsArena di environment atau `.env` root StatsArena. Dashboard memuat `.env` root saat dijalankan dari package `dashboard/`; nilai yang telah disediakan oleh shell tetap didahulukan. `DIRECT_DATABASE_URL` hanya digunakan untuk migrasi, bukan dashboard. Jangan gunakan URL database milik IBL Analytic.

Pemeriksaan package dashboard:

```sh
pnpm --dir dashboard run lint
pnpm --dir dashboard run typecheck
pnpm --dir dashboard run test
pnpm --dir dashboard run build
```

`pnpm lint`, `pnpm typecheck`, `pnpm test`, dan `pnpm build` dari root mencakup workspace dashboard. Test query memakai PGlite dan tidak memerlukan Neon. Tanpa koneksi database, halaman menampilkan keadaan error yang aman; tidak ada detail koneksi di HTML.

## Lapisan data dan scope

- `dashboard/lib/data/server.ts` ditandai `server-only`, memuat environment root, membuat koneksi pooled secara lazy, dan mengubah error database menjadi pesan umum.
- `dashboard/lib/data/queries.ts` memakai Drizzle untuk semua query. `?competition=<source-id>` adalah scope utama. Source ID kompetisi diselesaikan ke UUID internal sebelum query detail atau agregasi dijalankan.
- `dashboard/lib/data/contracts.ts` berisi DTO tampilan. Client Components hanya menerima pilihan kompetisi dan state UI; koneksi dan hasil query tetap berada di server.
- Filter halaman disimpan di URL. Tab klasemen memakai ID internal record grup pada `?group=<id>`; link tetap membawa source ID kompetisi. `sourceGroupId`, URL tab sumber, label grup, dan `poolNumber` tetap berasal dari data yang diimpor.
- Mengganti atau mengosongkan pilihan kompetisi mereset filter `group`, `team`, dan `page` agar identitas serta nomor halaman dari kompetisi sebelumnya tidak terbawa. Filter lain tetap dipertahankan.
- URL eksternal hanya dirender jika HTTPS dan host/path cocok dengan Genius Sports IBF yang didukung. Daftar/detail tim dan pemain mengambil URL dari keikutsertaan kompetisi atau bukti roster, bukan URL identitas global yang mungkin terakhir diperbarui kompetisi lain.
- Detail pertandingan membatasi fetch provenance pada kompetisi yang sama. Mengakses ID pertandingan, tim, atau pemain dari kompetisi lain menghasilkan not found.

## Halaman

| Halaman | Data yang ditampilkan |
| --- | --- |
| `/` | Jumlah pertandingan/tim/pemain/grup, status fixture, laga terbaru, peringkat pertama klasemen tiap grup, leaderboard box score, dan waktu run sinkronisasi terakhir. |
| `/games` | Waktu mentah sumber, tim, skor, status, venue, filter status, dan pagination. Detail laga menyertakan statistik tim/pemain, play by play, shot chart dengan made/missed, URL sumber, serta status fetch/parse/hash dan isu validasi terbaru. Filter periode/tim berlaku pada event; periode/tim/pemain/hasil berlaku pada shot chart. |
| `/teams` | Keikutsertaan tim dalam kompetisi, W-L dari laga selesai yang memiliki skor, total box score tim, roster tersimpan, game log, serta BP/2CP resmi kompetisi dengan GP sampel dan tautan Team Statistics. |
| `/players` | Keikutsertaan pemain, statistik dasar, dan hubungan tim hanya dari `team_rosters`. Detail memuat total, rata-rata, persentase agregat, dan game log. |
| `/standings` | Klasemen resmi terpisah per record grup dan pemilih grup tersimpan di URL. Tidak ada penggabungan dengan hasil eliminasi. |
| `/review` | Isu validasi, pertandingan terkait bila tersedia, tautan sumber, waktu, severity, jenis isu, status run, dan riwayat impor. Filter severity/jenis isu serta pagination tidak memulai impor. |

Detail pertandingan mempertahankan urutan sumber PBP dan skor berjalan. Shot chart hanya merangkum marker eksplisit 2PT/3PT. Filter chart tersimpan di URL (`period`, `team`, `player`, `result`), dan jumlah made/missed dihitung dari marker yang lolos filter. Akses metrik BP/2CP kompetisi berada pada detail tim agar tidak terbaca sebagai angka pertandingan. Issue panel menampilkan isu unik terkini pada laga; halaman Review tetap menyimpan histori.

Loading skeleton, empty state, not found, dan error boundary tersedia. Fixture terjadwal tanpa statistik ditandai belum berjalan; nilai nol tidak dibuat sebagai pengganti data yang tidak tersedia. Jika fetch/parsing box score terbaru gagal setelah statistik valid tersimpan, detail menjelaskan bahwa statistik valid terakhir tetap ditampilkan. Snapshot parsial diberi label tersendiri.

## Definisi statistik

- Jumlah tim dan pemain dihitung dari `competition_teams` dan `competition_players`, termasuk yang belum memiliki statistik pertandingan.
- GP pemain menghitung baris `player_game_stats` dalam pertandingan berstatus selesai. Menit nol yang sah tetap dihitung sebagai penampilan. Rata-rata poin, rebound, assist, steal, block, dan menit memakai baris selesai yang menyimpan nilai terkait; `null` tidak dihitung.
- Persentase pemain dan tim adalah jumlah tembakan masuk dibagi jumlah percobaan untuk cakupan baris yang tersedia. Persentase pertandingan tidak dirata-ratakan. Penyebut nol atau nilai yang tidak tersedia menghasilkan `null`/“—”.
- Rekor tim menghitung laga selesai dengan kedua skor diketahui. Total tim menjumlahkan kolom `team_game_stats` pada laga selesai; ini adalah statistik box score resmi yang tersimpan, terpisah dari hasil hitung.
- Klasemen mengikuti `group_standings` resmi. Poin klasemen tidak disamakan dengan poin basket.
- Tanggal laga mempertahankan teks mentah sumber karena zona waktu tidak diketahui. Waktu run adalah waktu tersimpan dari `import_runs`.

## Players: statistik dan kelompok kolom

Pembaruan 12 Oktober 2026 mengikuti tabel `/players` IBL Analytic: header dua baris dan garis vertikal pada batas kelompok pemain/tim, penampilan, scoring, rebound/assist, pertahanan, kontrol bola, akurasi, dan efisiensi. Nama pemain tetap terlihat saat tabel digeser horizontal. Nomor baris mengikuti urutan tabel aktif, bukan peringkat resmi Genius Sports.

Kolom utama: GP, MPG, PPG, eFG%, TS%, RPG, APG, SPG, BPG, TOPG, PFPG, FT%, 2P%, 3P%, EFF. Pilihan **Lengkap** menambahkan OREB/DREB per laga, AST/TO, dan FG%. Semua kolom statistik dan nama dapat diurutkan; default PPG menurun. Sorting dan filter diterapkan di PostgreSQL **sebelum pagination**, dengan nilai tidak tersedia di akhir pada kedua arah sorting. Pemain terdaftar tanpa statistik tetap terlihat (GP 0; statistik —).

Pencarian nama, filter tim dari bukti roster, minimum GP, minimum total FGA, dan pilihan kolom tersimpan di URL: `q`, `team`, `minGp`, `minFga`, `columns=extended`, `sort`, `dir`. Pergantian filter/sort mengembalikan halaman tabel ke awal; pagination mempertahankan parameter dan kompetisi. Filter tim tidak mengubah cakupan agregasi pertandingan pemain: seluruh laga selesai pada kompetisi terpilih tetap dihitung. Daftar tim diambil dari kompetisi terpilih; roster kompetisi lain tidak memenuhi filter.

Metrik hasil hitung kini memakai versi `statsarena-analytics/1.0.0` (menggantikan label `players-boxscore-v1`):

| Metrik | Rumus pada laga selesai |
| --- | --- |
| FG%, 2P%, 3P%, FT% | `100 × Σmade / Σattempts` masing-masing jenis tembakan |
| eFG% | `100 × (ΣFGM + 0.5 × Σ3PM) / ΣFGA` |
| TS% (estimasi) | `100 × ΣPTS / [2 × (ΣFGA + 0.44 × ΣFTA)]` |
| EFF per laga | Rata-rata `PTS + REB + AST + STL + BLK − (FGA − FGM) − (FTA − FTM) − TO` |
| AST/TO | `ΣAST / ΣTO` |

Persentase dan rasio memakai total, bukan rata-rata persentase tiap pertandingan. Jika penyebut nol atau salah satu input rumus tidak tersedia pada salah satu laga dalam cakupan, hasilnya `null`/“—”; EFF juga memerlukan semua input pada seluruh laga. Nol yang diketahui tetap nol. Rata-rata statistik dasar tetap memakai nilai tersedia sesuai definisi di atas. TS% menggunakan faktor estimasi 0.44, bukan penghitungan possession dari PBP. EFF adalah hasil hitung StatsArena, bukan angka efisiensi resmi yang diimpor. Rumus ditampilkan pada tooltip header dan label hasil hitung di bawah tabel.

Perubahan ini hanya membaca data Neon yang sudah tersimpan; tidak memerlukan migrasi atau impor HTML ulang. Pengujian query PGlite mencakup rasio tertimbang, estimasi TS%, EFF, input hilang, penyebut nol, urutan sebelum pagination, pencarian literal karakter `%`/`_`, filter minimum, dan isolasi kompetisi/roster.

Usulan statistik tim/pemain berikutnya, pemisahan angka resmi dari hasil hitung StatsArena, serta prasyarat PBP/lineup dicatat dalam [Pengembangan Statistik](./PENGEMBANGAN_STATISTIK.md). eFG%, TS%, EFF, dan AST/TO yang sudah tersedia di dashboard merupakan fitur hasil perhitungan StatsArena dari input box score resmi; status tersedia tidak menjadikannya angka resmi yang diimpor dari sumber.

## Verifikasi Neon

Tidak ada migrasi schema pada Tahap 4. Kompetisi `49609` diverifikasi pada URL sumber kedua berikut, kemudian diimpor melalui CLI StatsArena dan diimpor ulang:

`https://hosted.dcd.shared.geniussports.com/IBF/en/competition/49609`

| Source ID | Games (selesai / terjadwal) | Teams | Players | Groups | Standings | Player stats | Team stats | Roster evidence |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `49607` | 34 (32 / 2) | 27 | 322 | 9 | 27 | 761 | 64 | 322 |
| `49609` | 24 (22 / 2) | 18 | 213 | 6 | 18 | 514 | 44 | 212 |

Setelah impor ulang `49609`, importer melaporkan 0 statistik pemain dan 0 statistik tim ditulis ulang serta 22 box score tidak berubah. Query hitung setelah impor ulang menunjukkan jumlah entitas/statistik logis tetap sama. Laga `2931666` pada `49607` tampil dengan skor 25–45 dan FGA 41–40. Semua enam halaman inti dan detail pertandingan/tim/pemain berhasil dibaca dari kedua scope oleh lapisan query.

Tahap 5 menambahkan tiga tabel melalui migrasi `0002_match_details`. Neon memuat 18 tabel termasuk jurnal migrasi, 39 foreign key valid, dan 3 migrasi. Jumlah akhir setelah dua laga `49607` berubah menjadi complete adalah:

| Source ID | PBP events | Shots | Game official metrics | Competition official metrics |
| --- | ---: | ---: | ---: | ---: |
| `49607` | 15,455 | 3,018 | 136 | 54 |
| `49609` | 9,853 | 1,702 | 88 | 36 |

Impor ulang data yang sama menulis nol event, shots, metrik, dan statistik box score; row count logis di Neon tidak bertambah. Untuk laga `2931666`, query Neon mengonfirmasi skor 25–45, FGA total kedua tim 81 (41 dan 40), FGM total 24 (9 dan 15), 81 shots, serta 24 made.

## Pemeriksaan lokal dan browser

Pemeriksaan root berhasil: lint, typecheck, 46 test (44 ingest dan 2 dashboard), dan build. Test ingest mencakup struktur/event, klasifikasi shot, rumus validasi, scope metrik, impor berulang, pembaruan, preservation, rollback; test dashboard mencakup isolasi dua kompetisi, filter chart/PBP, provenance, serta deduplikasi tampilan isu terbaru dengan histori Review tetap utuh.

Browser lokal memeriksa halaman inti, detail, filter kompetisi dan grup, filter Review, status Games, source links, duplicate/unknown competition, serta Back/Forward. Layout diperiksa pada 1440×900 dan 390×844; lebar dokumen tetap di dalam viewport, tabel memakai scroll horizontal pada mobile, dan menu keyboard/mobile bekerja. Error database disimulasikan dengan koneksi lokal yang sengaja tidak tersedia: halaman menampilkan error umum tanpa host, kredensial, atau error PostgreSQL mentah. Dashboard tidak mengakses Genius Sports dari browser.

Pemeriksaan Tahap 5 di browser mencakup detail `2931666` (49607), `2915281` (49609), detail tim dengan metrik resmi, dan laga scheduled `2934779` (49609). Filter made pada URL menghasilkan satu marker dan jumlah sesuai; filter kompetisi bertahan saat kembali ke daftar. Pada 390×844 tidak ada horizontal overflow, chart mengikuti filter, made/missed dibedakan dengan simbol/teks selain warna, dan laga scheduled menyatakan data belum tersedia tanpa menampilkan “0 tembakan”. Desktop diperiksa pada 1440×1000. Navigasi keyboard bekerja dan log browser tidak memiliki warning/error.

Perbaikan perpindahan kompetisi diperiksa pada 8 Oktober 2026: memilih Grup A putra lalu mengganti ke putri menampilkan 18 baris klasemen; arah sebaliknya menampilkan 27 baris. Halaman kedua daftar tim putra kembali ke halaman pertama kompetisi putri. Filter `group`, `team`, dan `page` dihapus saat berganti kompetisi, sementara `status=complete` tetap bertahan. Pada verifikasi awal Tahap 4, dua laga scheduled per kompetisi diberi keadaan data belum tersedia; pada snapshot Tahap 5, 49607 sudah complete seluruhnya dan dua laga scheduled masih tersisa di 49609. Keadaan loading/error/Review juga diperiksa pada verifikasi Tahap 4; browser tidak mengambil Genius Sports.

## Batas Tahap 5

Data yang tampil mencerminkan snapshot impor Neon dan tidak otomatis diperbarui saat halaman dashboard dibuka. Tanggal/waktu sumber dipertahankan mentah tanpa zona waktu. Dua laga terjadwal per kompetisi belum memiliki halaman detail; BP per pertandingan juga tidak tersedia dan diberi status unavailable. Orientasi fisik lapangan dari koordinat Genius Sports tidak dapat dipastikan sehingga tampilan mempertahankan posisi kanvas sumber tanpa rotasi. Penjadwalan otomatis, Lineups, Rotation, BPM, RAPM, dan analitik lanjutan tetap di luar Tahap 5.

## Tahap 6: status operasional

Overview membaca `sync_runs`, lease aktif, dan `source_fetched_at` dalam scope kompetisi yang dipilih. Tampilkan hasil run, waktu pemeriksaan, waktu HTML sumber, jadwal berikutnya bila tersedia, hitungan penulisan, serta tautan halaman gagal/parsial. Dashboard tetap hanya membaca Neon; membuka halaman tidak memulai impor atau runner. `runner watch` berjalan sebagai proses CLI terpisah selama proses itu aktif.

Migrasi `0003_sync_operations` diperlukan sebelum query Overview Tahap 6 dipakai. Migrasi itu sudah diterapkan pada Neon StatsArena saat perbaikan review 8 Oktober 2026; Overview kembali membaca data dan menampilkan keadaan belum ada run operasional. Hasil impor dan pemeriksaan status setelah runner ada di [verifikasi Neon](./NEON_VERIFICATION.md) dan [panduan operasi](./SYNC_OPERATIONS.md). Pada dataset saat ini, 49607 memiliki 34 laga complete dan 49609 memiliki 22 complete serta dua scheduled.

## Kelengkapan per dataset

Detail laga menampilkan status ringkasan, box score, PBP, chart, dan metrik resmi secara terpisah. Alasan serta nilai expected/actual tampil pada panel dan Review. Isu detail yang sudah terselesaikan tetap ada pada histori Review, tetapi tidak disebut isu current. Lihat [DATA_QUALITY.md](./DATA_QUALITY.md).

## Filter sumber IBL — 16 Oktober 2026

Filter `?competition=IBL:42041` memilih namespace IBL; filter angka tetap IBF. Pilihan kompetisi dan query menggunakan source beserta ID, sedangkan ID tim/pemain tetap mengikuti kompetisi yang dipilih. Tautan publik IBF/IBL divalidasi dengan helper sumber bersama. Detail laga membaca metadata `stat_derivations`; penjelasan tabel menyebut perhitungan 2P dari FG−3P ketika kolom sumber tidak disediakan. Sampel IBL belum diimpor ke Neon dalam pekerjaan ini, sehingga pilihan hanya muncul setelah kompetisinya diimpor.

## MCP baca saja — 28 Oktober 2026

Perbaikan build Vercel, 29 Oktober 2026: pemuat `packages/db/src/environment.ts` memakai path filesystem runtime agar `.env` tidak diperlakukan Webpack sebagai aset wajib. Build production dari salinan workspace tanpa file `.env` berhasil dan tidak menghasilkan aset `.env`; test pemuat environment, 86 test dashboard, lint serta typecheck workspace lulus. Nilai Vercel diisi melalui Environment Variables. Cache/salinan aset `.env` hasil build lokal lama dibersihkan; file `.env` asli dan data Neon tidak diubah. Ini verifikasi build lokal dalam kondisi tanpa `.env`, bukan bukti deployment Vercel berhasil.

Dashboard menyediakan `/api/mcp`, discovery OAuth, halaman login/persetujuan, dan `/mcp/connections`. Gunakan akun serta grant kompetisi/klub StatsArena; admin mengaturnya melalui `/admin/access` dengan pilihan kompetisi dari Neon. Header report menyediakan **Koneksi aplikasi** untuk pencabutan koneksi akun sendiri.

Endpoint MCP membaca Neon server-side dalam transaksi read-only dan memakai rumus analitik bersama. Token, sesi, consent, serta grant diverifikasi pada setiap pemanggilan. Mode khusus report mengizinkan entry MCP secara terbatas; API lain tetap mengikuti aturan semula. Migrasi `0010_melodic_mulholland_black` menambah delapan tabel OAuth tanpa mengubah isi 20 tabel domain. Tidak ada widget statistik interaktif MCP pada tahap ini. Konfigurasi Vercel, tool, batas akses dan verifikasi: [MCP.md](./MCP.md).

Pemeriksaan kualitas data MCP hanya untuk admin. Staf mendapat sembilan tool statistik; respons detail/chart tidak menyertakan kode isu, status dataset, kategori kegagalan, atau jadwal retry. Penanda ketersediaan dan cakupan perhitungan tetap ada.

MCP `1.1.0`, 29 Oktober 2026: payload tool admin/staf tidak lagi menyertakan URL sumber, hash, waktu fetch, provenance atau versi internal. Nama, angka, cakupan laga, ketersediaan dan izin tetap diperiksa. Ini hanya mengubah respons MCP; tampilan sumber dan provenance dashboard/Neon tetap tersedia untuk admin. Lihat [kontrak respons MCP](./MCP.md#respons-ringkas-110--29-oktober-2026).
