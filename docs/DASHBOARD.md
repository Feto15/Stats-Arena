# Dashboard StatsArena

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
