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
- BP/2CP adalah angka resmi dengan scope `game` atau `competition`. Team Analysis menyediakan 2CP/PIP/PFT/FBP laga bila header tersedia; Team Statistics menyediakan BP/2CP kompetisi beserta GP sampel. Ketiadaan BP per laga disimpan unavailable/null, bukan dihitung dari statistik pemain.
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
pnpm --dir ingest run cli runner service
pnpm --dir ingest run cli retry --competition 49607 --dry-run
pnpm --dir ingest run cli quality backfill --dry-run
pnpm --dir ingest run cli quality backfill
pnpm --dir ingest run cli metrics backfill --dry-run
pnpm --dir ingest run cli metrics backfill
pnpm --dir ingest run cli catalog rebuild
pnpm --dir ingest run cli analysis export --competition 49607 --dry-run
pnpm --dir ingest run cli analysis export --competition 49607
pnpm --dir ingest run cli storage compact --dry-run
pnpm --dir ingest run cli storage compact
pnpm --dir ingest run cli storage compact-neon --dry-run
pnpm --dir ingest run cli storage compact-neon
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

Pemuat environment bersama harus memakai path filesystem saat runtime. Jangan memakai `new URL("../../../.env", import.meta.url)`: Webpack akan memperlakukannya sebagai aset, sehingga build hosting tanpa `.env` gagal dan file lokal dapat ikut tersalin ke output. Vercel memakai Environment Variables; file `.env` tetap opsional dan diabaikan Git. Pertahankan pengujian path root/eksplisit, file tidak tersedia, dan prioritas nilai hosting.

## Code style guidelines

Deployment runner menggunakan `compose.runner.yaml` di Coolify/VPS; dashboard tetap di Vercel. `runner service` memakai incremental rutin dan standard harian, memajukan `.runner-service.json` hanya setelah seluruh kompetisi aktif sukses; partial/failure/dry-run/stop tidak memajukan penanda full. Volume snapshot/audit harus permanen; lock dan lease tetap berlaku. Healthcheck menunjukkan liveness, bukan keberhasilan impor. CI memeriksa kode/image; jangan menyatakan deployment VPS atau build Docker berhasil tanpa verifikasi nyata. Lihat [docs/RUNNER_DEPLOYMENT.md](./docs/RUNNER_DEPLOYMENT.md).

Maintenance Neon `storage compact-neon` hanya menghapus fetch sukses/parsed yang tergantikan dan tidak dirujuk. Pertahankan seluruh FK sumber, baseline summary, run terbaru, dua observasi terbaru per URL/resource/kompetisi, retry/error/partial, isu review, dan arsip yang dibuktikan metadata JSON lokal. Tolak writer aktif atau FK yang belum dikenali; backup harus tersimpan sebelum penghapusan, lalu bandingkan seluruh isi tabel domain dalam transaksi. Jangan menjalankannya tanpa metadata arsip proyek yang lengkap. Ini operasi eksplisit terpisah dari retensi lokal dan runner; run/isu belum dipangkas menurut umur. Lihat [docs/NEON_EFFICIENCY.md](./docs/NEON_EFFICIENCY.md).

Efisiensi Neon membutuhkan migrasi `0005_massive_unicorn`. Importer hanya memakai audit summary jika input/hash/parser identik dengan run sukses tepat sebelumnya pada kompetisi yang sama, halaman bersih tanpa diagnostik retry, dan tidak ada warning/error. Referensi baseline harus langsung menuju audit full dan dilindungi FK; jangan menghapus baseline/provenance. Archive memaksa audit full. Query operasional memakai baseline untuk isu serta observasi run terbaru untuk waktu sumber. Metadata/klasemen identik tidak ditulis ulang; `lastSeenAt` peserta yang diamati diperbarui paling sering sekali per 24 jam. URL global peserta stabil terhadap perbedaan scope kompetisi; membership tetap menyimpan URL sumber tepat. Lihat [docs/NEON_EFFICIENCY.md](./docs/NEON_EFFICIENCY.md).

Runner memakai `--audit-mode auto`; `sync`/`retry` memakai `full` secara default. Hash hasil parse per dataset hanya menjadi baseline setelah impor sukses. Siklus identik menyimpan summary, perubahan sebagian menyimpan delta, kegagalan mempertahankan full; summary/delta bukan payload langsung importer. Pembersihan lokal mempertahankan dua versi valid, audit/HTML untuk review belum selesai, dan arsip eksplisit; jangan menghapus hash/provenance/statistik Neon. Katalog `.audit-storage.json`, index aktif, checkpoint fixture, dan lock harus dipertahankan. Pembersihan otomatis maksimal sekali per 24 jam setelah impor sukses; dry-run tidak memajukan baseline atau menghapus file. Lihat [docs/STORAGE_RETENTION.md](./docs/STORAGE_RETENTION.md).

Mode `--incremental` memakai migrasi `0004_incremental_sync` dan `0006_magenta_khan`; terapkan seluruh migrasi. Mode ini membaca state Neon, termasuk saat dry-run. Fixture selalu diperbarui; detail lama valid dilewati berdasarkan `games.fixture_hash/detail_sync_status/detail_parser_version/detail_synced_at/detail_quality`. Hash memakai observasi fixture asli, bukan field hasil gabungan summary. Gagal/parsial tetap eligible sesuai jadwal retry; rollback harus eligible tanpa cooldown lama. Jangan memajukan penanda sukses sebelum transaksi commit. Metadata kompetisi tetap memakai TTL. Bootstrap impor lama dilakukan sekali melalui cache valid. Mode ini tidak mendeteksi koreksi detail yang tidak mengubah fixture; gunakan mode standar/`--refresh` secara berkala. Tidak bisa digabung dengan `--refresh` atau `--snapshot-only`.

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

Katalog `ingest/config/competitions_catalog.json` memakai format ringkas: identitas kompetisi, audit portal terbaru, dan `liveStatsFiles` (ID laga ke file JSON gzip). Diperbarui otomatis oleh discover/sync/retry/runner serta `livestats sync/backfill`. Pertahankan anotasi manual; cocokkan namespace/compId/matchId/datapath sebelum menautkan cache. File LiveStats current/attempt bukan bukti impor sukses. `catalog rebuild` membaca audit/cache lokal tanpa jaringan/Neon dan membuang referensi file LiveStats yang hilang. Compose menyimpan katalog runtime di volume audit melalui `STATSARENA_CATALOG_PATH`, karena image read-only. Lihat [docs/COMPETITION_CATALOG.md](./docs/COMPETITION_CATALOG.md).

Katalog juga menautkan JSON analisis melalui `analysisFile`; preview tidak menggantikan tautan utama. `analysis export` tanpa dry-run memperbarui tautan tersebut. `discover`/`catalog rebuild` hanya menautkan file analisis yang sudah ada, tanpa menghitung metrik baru. TS%/TOV%/attempt rate lawan masih rencana pada [docs/PENGEMBANGAN_STATISTIK.md](./docs/PENGEMBANGAN_STATISTIK.md); eFG% lawan sudah tersedia.

## Testing instructions

Rumus analitik bersama berada di `@statsarena/db/analytics`; query PostgreSQL memakai `@statsarena/db/analytics-sql` dari definisi yang sama. Versi analitik independen dari versi parser. Sync/retry/runner menulis `ingest/audit/analysis/<key>.json`; dry-run/snapshot menulis preview. Ekspor offline `analysis export` membaca audit lokal full/delta/summary, tanpa jaringan/Neon; dry-run perintah ini hanya melaporkan rencana. Pertahankan input valid, scope game IDs, null, presisi menit, dan agregasi dari total; jangan menambah rumus terpisah di UI/konten. Tidak ada kolom turunan Neon baru. Lihat [docs/ANALYTICS.md](./docs/ANALYTICS.md).

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

Kualitas data MCP khusus admin: sembunyikan `get_data_quality` dari daftar tool staf dan tetap periksa role di pembaca kualitas server. Respons detail laga/chart staf tidak memuat `datasets`, `observedQuality`, kode isu, atau metadata retry. Pertahankan informasi ketersediaan/null/cakupan hitung statistik. Perubahan role wajib berlaku memakai token yang sama.

MCP `1.1.0` membatasi respons tool untuk admin/staf ke data domain. Jangan mengirim URL sumber, provenance, hash, waktu fetch, versi parser/analitik, atau nama penyimpanan/provider melalui teks, `structuredContent`, maupun `_meta`. Provenance tetap wajib divalidasi di server dan disimpan utuh di Neon/audit/dashboard; ini pembatasan pengiriman, bukan penghapusan sumber. Pertahankan ID/cakupan laga, jadwal, null/nol, rumus/estimasi, dan diagnostik admin. URL OAuth/discovery diperlukan untuk koneksi dan tidak termasuk tautan sumber statistik. Uji payload seluruh query/hasil MCP serta pelestarian provenance tersimpan. Lihat [docs/MCP.md](./docs/MCP.md).

MCP baca saja tersedia pada `dashboard/app/api/mcp`, memakai Better Auth/OAuth PKCE + CIMD dan migrasi `0010_melodic_mulholland_black`. Pertahankan pemeriksaan JWT issuer/audience/signature/expiry/scope serta pembacaan ulang user/sesi/client/consent/grant Neon setiap request/tool. Identitas/role/grant tidak boleh berasal dari argumen tool. Scope `statsarena:read` tidak memberi hak klub baru; gunakan policy kompetisi+klub bersama. Pencabutan grant/koneksi wajib berlaku pada token yang sama. Jangan menambah tool SQL bebas, ingest/migrasi/penghapusan, atau mengembalikan raw error/path audit/token. Query statistik read-only, pagination/output/body/rate limit tetap dibatasi. CIMD hanya origin HTTPS ChatGPT melalui transport DNS/IP-pinned; DCR terbuka tetap mati. Uji OAuth dan isolasi dengan `dashboard/test/mcp-auth.test.ts` serta `mcp-queries.test.ts`, termasuk regresi report. Lihat [docs/MCP.md](./docs/MCP.md).

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

## Status detail dan retry (parser 0.2.3)

Gunakan `games.detail_quality` untuk membedakan status setiap dataset dari hasil pertandingan. `partial` wajib membawa alasan; marker invalid menyimpan `actual.invalidFields`. Incremental menghormati jeda jaringan 5–60 menit, struktur parser satu jam, anomali sumber 24 jam; fixture berubah/parser upgrade/live/retry manual tetap eligible. Jeda berlaku untuk seleksi laga, bukan jadwal HTTP independen setiap resource. Kegagalan transaksi tidak boleh mempertahankan cooldown lama yang menghambat pemulihan. `datasetQuality` tidak termasuk fingerprint statistik. Backfill lewat `quality backfill --dry-run` lalu tanpa dry-run hanya mengisi metadata null dari observasi audit tersimpan; tolak writer aktif. Lihat `docs/DATA_QUALITY.md`.

## Namespace IBF/IBL (parser 0.2.4)

### Prioritas metrik tim (parser 0.2.5, LiveStats 1.0.1)

Team Analysis juga membaca PIP/PFT/FBP laga berdasarkan header bila tersedia. Kolom yang tidak ada tidak diisi nol; sel kosong/invalid atau dataset yang kehilangan metrik tersimpan mempertahankan data valid sebelumnya. BP/2CP kompetisi tetap terpisah. Dashboard memilih nilai portal laga yang available/valid terlebih dahulu, lalu baris LiveStats terverifikasi sebagai cadangan per tim/per metrik. Tampilkan sumber per angka dan kedua nilai saat berbeda; jangan menjumlahkan kedua sumber. PIP/FBP/2CP pemain tetap dari LiveStats. Konflik BP/2CP/PIP/PFT/FBP laga dicatat pada isu LiveStats.

`metrics backfill` hanya menambahkan PIP/PFT/FBP yang belum tersimpan, menggunakan snapshot yang hash-nya cocok dengan observasi analysis terbaru di Neon. Tidak ada fetch baru atau perubahan box score/PBP/shots. Jalankan dry-run dahulu; commit memakai table lock, menolak lease/run aktif dan audit impor running dalam 24 jam terakhir. Audit impor yatim lama tetap disimpan tanpa diubah; lease/run aktif selalu memblokir tanpa batas umur. Pertahankan FK fetch, hash, provenance serta payload LiveStats; perbedaan terhadap payload tersimpan dicatat sebagai isu. Tidak diperlukan migrasi baru karena kolom kode metrik berupa teks.

Pelengkap JSON LiveStats menggunakan adapter terpisah `statsarena-livestats/1.0.1`, bukan mengganti parser portal. Migrasi `0008_stiff_blockbuster` menambah `game_livestats`; status/provenance tambahan independen dari kualitas portal. ID lokal tidak menjadi ID global: cocokkan tim, nomor, nama eksplisit, dan statistik dasar; baris meragukan dilewati dan dicatat. Jangan mengganti box score/PBP/shots portal. Setiap baris tambahan membawa provenance; field/baris yang hilang mempertahankan baris valid sebelumnya. CLI sync/retry/runner memperbarui tambahan setelah commit portal, termasuk ketika detail portal dilewati incremental. Data lama diisi melalui `livestats backfill --dry-run`, lalu `livestats backfill`, hanya untuk kompetisi tersimpan. Retry satu laga memakai `livestats sync --competition <ref> --game <id> --refresh`. Snapshot hash immutable pada subdirektori `livestats` ikut volume permanen, dengan perlindungan seluruh referensi payload Neon. Lihat [docs/LIVESTATS.md](./docs/LIVESTATS.md).

Gunakan helper bersama `@statsarena/db/source`. Angka tanpa prefix tetap IBF; IBL memakai URL lengkap atau `IBL:<ID>`. Database memakai ID mentah dengan `source=genius_sports` (IBF lama) atau `genius_sports:IBL`. Query, lease, retry, checkpoint, audit/hash, dan tautan sumber wajib menjaga scope namespace; jangan mengubah identitas IBF lama. Payload JSON lintas namespace ditolak sebelum menulis. Kolom 2P yang tidak disediakan dapat diturunkan dari FG−3P hanya bila input valid, dengan rumus/versi/input tersimpan pada `statDerivations`/`stat_derivations` (migrasi `0007_quiet_polaris`). Sel resmi kosong/invalid tidak ditambal. GP/metrik yang tidak disediakan tetap null; tabel BP/2CP terpisah digabung dengan ID tim. Lihat [SUMBER_DATA_IBL.md](./docs/SUMBER_DATA_IBL.md) untuk pola HTML terverifikasi dan batas sampel.
