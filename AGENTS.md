# StatsArena Agent Guide

Panduan ini berlaku untuk seluruh repository StatsArena. Baca [PLAN.md](./PLAN.md) dan [IMPLEMENTATION_STEPS.md](./IMPLEMENTATION_STEPS.md) sebelum mengubah arsitektur atau memulai tahap implementasi. Ikuti cakupan permintaan pengguna; selesaikan pekerjaan yang sudah diizinkan tanpa meminta konfirmasi ulang untuk keputusan implementasi rutin.

## Project overview

StatsArena adalah dashboard analitik basket untuk banyak kompetisi. Sumbernya adalah HTML publik Genius Sports, kemudian data hasil parsing dan analitik disimpan di Neon PostgreSQL. Kompetisi `49607` — `(M) DBL DI JOGJAKARTA SERIES` — merupakan sampel pertama, bukan batasan sistem.

Stack parser dan database yang tersedia, serta dashboard tahap berikutnya:

- Node.js, TypeScript, pnpm, dan Cheerio untuk mengambil dan membaca HTML.
- Zod untuk memvalidasi input dan hasil parsing.
- Drizzle ORM untuk schema, migrasi, dan query Neon PostgreSQL.
- Next.js, React, dan komponen UI dari proyek `/Users/rezel/Cursor/IBL Analytic` untuk dashboard pada tahap berikutnya.

Struktur proyek:

- `ingest/`: fetcher, parser per halaman, normalisasi, validasi, JSON audit, dan CLI impor.
- `packages/db/`: schema Drizzle, migrasi, tipe bersama, dan koneksi database.
- `dashboard/`: UI dan query server untuk membaca Neon.
- `docs/`: metodologi, pemetaan sumber, hasil validasi, dan panduan operasi.

Alur data: `HTML → Cheerio → normalisasi/validasi → JSON audit → transaksi/upsert Neon → query server → dashboard`.

Parser dan importer dikerjakan lebih dulu. Saat mengerjakan UI, salin basis tampilan IBL Analytic lalu sesuaikan dengan schema dan fitur StatsArena. Proyek IBL Analytic menjadi referensi yang dibaca; jangan mengubahnya atau membawa data dan koneksi databasenya ke StatsArena.

Aturan data utama:

- Terima URL/ID kompetisi sebagai input dan temukan tautan sumber secara dinamis. Jangan hardcode daftar kompetisi, tim, pemain, atau pertandingan.
- Gunakan ID sumber dengan namespace/scope yang jelas sebagai identitas. Nama bukan kunci unik; simpan hubungan keikutsertaan per kompetisi.
- Pertahankan URL, waktu pengambilan, hash, versi parser, dan isu validasi agar setiap angka bisa ditelusuri.
- Nilai yang tidak tersedia menjadi `null`; nilai nol yang benar tetap nol. Jangan menganggap baris kosong sebagai pertandingan dengan statistik nol.
- Pisahkan angka resmi dari metrik hasil hitung. Dokumentasikan rumus, versi, dan cakupan laga yang dihitung.
- Simpan klasemen resmi per grup. Ikuti tautan tab dan parameter sebenarnya; nama grup, fase, dan `poolNumber` tidak boleh ditebak dari urutan tampilan.
- Jangan menganggap teks tersembunyi `Live now` sebagai status pertandingan. Baca struktur status yang sesuai.
- Shot chart dapat memuat foul dan turnover; hanya marker 2PT/3PT yang menjadi tembakan. BP dan 2CP tidak dapat disimpulkan dari total box score pemain saja.
- Play by play mempertahankan urutan sumber, kelas aksi, label periode, waktu mentah, skor berjalan, dan provenance. Event dengan waktu sama tetap dibedakan oleh `source_sequence`; identitas pemain/tim hanya diisi bila ada bukti sumber eksplisit.
- Koordinat shot chart disimpan mentah serta sebagai persen kanvas (`left` menjadi X, `top` menjadi Y). Orientasi/rotasi lapangan Genius Sports tidak diketahui, jadi dashboard menampilkan kanvas sumber tanpa mengarang rotasi atau skala lapangan.
- BP/2CP adalah angka resmi dengan scope `game` atau `competition`. Team Analysis menyediakan 2CP laga; Team Statistics menyediakan BP/2CP kompetisi beserta GP sampel. Ketiadaan BP per laga disimpan unavailable/null, bukan dihitung dari statistik pemain.
- Tabel rinci Tahap 5 adalah `play_by_play_events`, `shots`, dan `team_official_metrics`; ketiganya membawa referensi fetch/URL dan versi parser. Penggantian dataset rinci pertandingan dilakukan dalam transaksi dan melewati data identik.
- Jangan mengganti PBP ketika jumlah event berkurang tanpa bukti koreksi penghapusan. Chart yang berbeda dari FGA/FGM resmi menjadi partial; gunakan total tim tersimpan bila box score baru gagal. Sel metrik hilang/invalid berbeda dari unavailable eksplisit. Guard importer juga berlaku untuk JSON audit; lihat aturan parser `0.2.1` di `docs/INGEST.md`.
- Pertahankan waktu mentah ketika zona waktu tidak diketahui. Jangan mengarang informasi starter, roster, atau hubungan pemain–tim yang belum didukung sumber.

## Build and test commands

Workspace parser, database, dan fondasi dashboard sudah tersedia. Gunakan Node.js minimal 22.19 (lihat `.nvmrc`) dan pnpm 12.9.1 sesuai `packageManager`. Script root menjalankan pemeriksaan ingest, database, dan dashboard yang tersedia.

Jalankan dari root repository:

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm --dir dashboard run dev
```

Test parser, importer, dan query dashboard PGlite berjalan tanpa jaringan serta tanpa kredensial Neon. Untuk menampilkan data, dashboard membutuhkan pooled `DATABASE_URL`; modul server memuat `.env` dari root StatsArena ketika dashboard dijalankan melalui package `dashboard/`. Tanpa koneksi, halaman menampilkan error umum tanpa detail koneksi.

CLI ingest yang tersedia:

```sh
pnpm --dir ingest run cli --help
pnpm --dir ingest run cli discover --url https://hosted.dcd.shared.geniussports.com/IBF/en/competition/49607
pnpm --dir ingest run cli sync --competition 49607 --dry-run
pnpm --dir ingest run cli sync --competition 49607 --dry-run --refresh
pnpm --dir ingest run cli sync --competition 49607 --dry-run --snapshot-only
pnpm --dir ingest run cli sync --competition 49609 --dry-run --snapshot-only --match-limit 1
pnpm --dir ingest run cli sync --competition 49607
pnpm --dir ingest run cli runner once --dry-run
pnpm --dir ingest run cli runner once --incremental --dry-run
pnpm --dir ingest run cli runner once --incremental
pnpm --dir ingest run cli sync --competition 49607 --incremental
pnpm --dir ingest run cli runner watch --incremental --interval-seconds 900
pnpm --dir ingest run cli runner watch --interval-seconds 900
pnpm --dir ingest run cli retry --competition 49607 --dry-run
```

Periksa `--help` sebelum menjalankan CLI. `--snapshot-only` membutuhkan snapshot kerja lokal yang sudah tersedia; fixture test tetap disertakan dalam repository. `--dry-run` menulis audit lokal dan tidak menulis record aplikasi atau audit ke database. Sinkronisasi default memakai cache HTML tervalidasi dengan TTL; `--refresh` melewati TTL melalui HTTP dan tidak bisa digabung dengan `--snapshot-only`. Runner memakai daftar aktif `ingest/config/competitions.json`, lock proses lokal, dan lease Neon untuk impor. Hentikan `runner watch` dengan Ctrl-C atau SIGTERM. Retry maksimal 25 URL gagal/parsial dari audit. Lihat [docs/FETCH_OPTIMIZATION.md](./docs/FETCH_OPTIMIZATION.md) dan [docs/SYNC_OPERATIONS.md](./docs/SYNC_OPERATIONS.md).

Parser `0.2.2` menerima tautan fixture `/schedule` tanpa query. Batas halaman fixture per siklus minimal 2, default 100, maksimum 1000; runner menyimpan antrean tersisa dalam checkpoint per kompetisi di direktori snapshot agar proses berikutnya dapat melanjutkan. Cakupan terpotong dilaporkan partial, bukan sukses penuh. Jangan menghapus checkpoint pada operasi rutin. Audit kegagalan runner/sync/retry mempertahankan hasil fetch/parse yang sudah tersedia, termasuk ketika importer gagal; refresh PBP mempertahankan metadata semua pass dan batas sampel.

Database yang tersedia:

```sh
pnpm --dir packages/db run db:generate
pnpm --dir packages/db run db:migrate
```

Perintah dashboard:

```sh
pnpm --dir dashboard run dev
pnpm --dir dashboard run lint
pnpm --dir dashboard run typecheck
pnpm --dir dashboard run test
pnpm --dir dashboard run build
```

Development server dashboard hanya bind ke loopback `127.0.0.1`; gunakan `http://localhost:3000` pada mesin lokal.

Gunakan pooled `DATABASE_URL` untuk aplikasi dan impor rutin, serta `DIRECT_DATABASE_URL` untuk migrasi. Sebelum migrasi/impor, pastikan target adalah database/schema StatsArena. Migrasi dijalankan ketika tugas mencakup perubahan database. Jika kredensial belum tersedia, selesaikan kode dan verifikasi lokal lalu laporkan pemeriksaan Neon yang masih tertunda.

CLI dan konfigurasi migrasi memuat `.env` dari root StatsArena meskipun dijalankan dengan `pnpm --dir`. Nilai environment yang sudah disediakan shell/hosting tetap didahulukan. `.env` tidak wajib untuk dry-run, test, atau pembuatan migrasi.

## Code style guidelines

Mode `--incremental` membutuhkan migrasi `0004_incremental_sync` dan membaca state Neon, termasuk saat dry-run. Fixture selalu diperbarui; detail lama valid dilewati berdasarkan `games.fixture_hash/detail_sync_status/detail_parser_version/detail_synced_at`. Hash memakai observasi fixture asli, bukan field hasil gabungan summary. Gagal/parsial dan rollback harus tetap eligible pada siklus berikutnya; jangan memajukan penanda sukses sebelum transaksi commit. Metadata kompetisi tetap memakai TTL. Bootstrap impor lama dilakukan sekali melalui cache valid. Mode ini tidak mendeteksi koreksi detail yang tidak mengubah fixture; gunakan mode standar/`--refresh` secara berkala. Tidak bisa digabung dengan `--refresh` atau `--snapshot-only`.

- Gunakan TypeScript strict, tipe domain yang eksplisit, dan `unknown` dengan validasi untuk data eksternal. Hindari `any` dan assertion yang melewati pemeriksaan data.
- Pisahkan fetcher, parser, validator, perhitungan metrik, dan importer. Parser adalah fungsi deterministik dari HTML ke record dan tidak melakukan fetch atau query database.
- Buat parser per jenis halaman. Gunakan selector Cheerio dan header tabel, bukan regex untuk membaca keseluruhan HTML atau indeks kolom tetap yang mengabaikan nama header.
- Ekstrak ID/parameter memakai API `URL`. Regex terbatas boleh digunakan untuk pola ID atau nilai teks setelah struktur HTML diketahui.
- Simpan field mentah yang dibutuhkan untuk audit sebelum normalisasi. Sentralisasikan parsing angka, menit, status, dan normalisasi nama.
- `minutes` adalah menit desimal termasuk detik; `minutesRaw` mempertahankan teks sumber. Jangan membulatkan durasi sebelum menghitung metrik.
- Box score dengan baris/ID pemain, header inti, atau sel statistik yang hilang harus menjadi `partial`. Importer juga memeriksa kelengkapan dan mempertahankan statistik lama bila pemain yang pernah tersimpan hilang dari snapshot baru.
- Gunakan transaction-capable driver untuk penulisan beberapa tabel satu pertandingan. Terapkan batas unik dan upsert; pengambilan ulang tidak boleh menggandakan entitas logis.
- Jangan menimpa data valid dengan hasil fetch gagal, halaman salah, atau payload parsial yang tidak mencakup field tersebut. Bedakan ketidaktersediaan field dari koreksi resmi sumber.
- Gunakan nama domain seperti `competition`, `group`, `game`, `team`, `player`, `sourceFetch`, dan `validationIssue`. Buat fungsi kecil dengan input/output jelas.
- Pertahankan pola format yang sudah ada. Komentar menjelaskan alasan aturan parsing atau keputusan data yang tidak jelas dari kode.
- Update dokumentasi ketika selector, makna field, rumus, schema, CLI, atau aturan validasi berubah. Checklist hanya ditandai selesai setelah hasilnya diverifikasi.
- Untuk dashboard, gunakan Server Components secara default dan modul database server-only. Client Components menerima data terbatas dengan tipe eksplisit.
- Semua query dashboard harus memiliki scope kompetisi yang benar. Filter utama tersimpan di URL; jangan mencampurkan data antar kompetisi atau mengagregasi klasemen grup bersama laga eliminasi tanpa definisi.

## Testing instructions

Pilih pemeriksaan sesuai bagian yang berubah. Tambahkan test untuk parsing, normalisasi, rumus, dan perilaku impor yang dapat menghasilkan kesalahan data tanpa terlihat di UI. Perubahan dokumen saja cukup diperiksa konsistensi isi dan tautannya.

### Fetcher dan parser

1. Gunakan fixture HTML nyata yang bertanggal dan memiliki URL sumber. Test unit berjalan dari fixture, sehingga perubahan situs live tidak membuat test lokal tidak stabil.
2. Cakup tautan ganda, logo hilang, nilai kosong versus nol, baris Totals, perubahan urutan kolom, status live/complete, halaman tidak valid, dan grup tanpa urutan `poolNumber` yang teratur.
3. Periksa ID/nama, jumlah record, header statistik, tipe nilai, dan provenance. Selector penting yang hilang harus menghasilkan error/isu yang dapat ditelusuri.
4. Validasi `PTS = 2×2PM + 3×3PM + FTM`, `FGA = 2PA + 3PA`, dan skor laga terhadap total tim jika input lengkap. Jangan mengharuskan jumlah rebound pemain sama dengan total tim tanpa memperhitungkan team rebounds.
5. Jalankan dry-run pada kompetisi `49607` dan sampel kompetisi kedua. Laporkan URL kedua dan perbedaan struktur yang ditemukan.

Patokan snapshot 6 Oktober 2026: 27 tim, 322 pemain, 32 pertandingan unik, sembilan grup. Laga `2931666` memiliki skor 25–45 dan FGA 41–40. Pada tahap shot chart, hasil filter adalah 81 tembakan dan 24 made. Gunakan angka tersebut untuk fixture yang sesuai; validasi pengambilan live berdasarkan sumber saat itu, tanpa memaksa data yang berubah agar cocok.

### Database dan importer

1. Jalankan dry-run sebelum impor nyata. Gunakan database/schema pengujian StatsArena yang jelas; jangan menguji dengan menghapus data IBL atau data pengguna.
2. Impor input yang sama dua kali dan buktikan jumlah kompetisi, tim, pemain, laga, dan statistik logis tidak bertambah. Record run/audit baru boleh bertambah sesuai desain.
3. Uji perubahan resmi pada record yang sama, kegagalan parsing setelah impor valid, HTML yang kehilangan tautan/baris/kolom, presisi durasi, migrasi durasi lama, dan rollback saat satu penulisan dalam transaksi gagal. Jumlah statistik dalam hasil impor hanya menghitung penulisan yang berhasil commit.
4. Periksa foreign key, batas unik, isolasi kompetisi, dan join agar tidak menggandakan baris. Bedakan data current dengan histori snapshot saat menghitung total.
5. Jika Neon belum dapat diakses, laporkan keterbatasannya. Test lokal atau dry-run tidak membuktikan migrasi, transaksi, atau idempotensi di Neon berhasil.

### Dashboard

Pada fondasi Tahap 3, jalankan lint, typecheck, dan build, lalu periksa keenam route, filter URL, tabel/empty state, desktop/mobile, navigasi keyboard, serta log browser/server tanpa mengharuskan Neon. Pastikan loading skeleton dan error boundary tersedia; simulasi kegagalan data menjadi verifikasi Tahap 4. Setelah query Tahap 4 dihubungkan, periksa dua kompetisi, klasemen grup, tautan sumber, dan data review menggunakan Neon StatsArena.

## Security considerations

- Jangan commit atau menampilkan `.env`, password, token, atau connection string. `.env.example` hanya berisi placeholder; redact kredensial pada log dan error.
- Jangan membaca/menyalin kredensial IBL Analytic untuk mengisi StatsArena. Pastikan migrasi dan importer terhubung ke target StatsArena yang dimaksud.
- Database hanya diakses server/CLI. Jangan memakai awalan `NEXT_PUBLIC_` untuk kredensial atau mengirimnya ke Client Component/API response.
- Validasi URL input dan tujuan redirect terhadap domain/protokol/pola sumber yang didukung. Jangan membiarkan URL hasil parsing mengarahkan fetch ke host sembarang atau alamat internal.
- Terapkan timeout, batas ukuran respons, jumlah halaman, retry, dan konkurensi. Snapshot terkompresi juga harus dibatasi ukurannya ketika dibaca kembali.
- Perlakukan HTML, nama, URL, dan JSON sumber sebagai input tidak tepercaya. Parse sebagai data; jangan menjalankan script atau merender HTML sumber mentah dalam dashboard.
- Gunakan query parameterized/Drizzle; jangan interpolasi input ke SQL. Validasi ID, filter, pagination, sort, dan batas hasil.
- Pastikan file snapshot/output tetap di direktori yang ditetapkan; hindari path traversal dan nama file yang berasal langsung dari teks sumber.
- Gunakan hak akses database sesuai fungsi: migrasi, importer, dan dashboard. Operasi penghapusan/reset harus terbatas pada data uji yang memang ditetapkan untuk itu.
- Sebelum commit, periksa diff dan file baru agar tidak menyertakan kredensial, cache, dependensi, snapshot besar, atau output build yang tidak dimaksudkan untuk repository.
