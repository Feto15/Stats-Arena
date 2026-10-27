# Langkah Implementasi StatsArena

Pembaruan demo 24 Oktober 2026: ON/OFF Net Rating estimasi dari total event interval memakai evaluator analitik bersama; shot chart satu kanvas/laga dengan pilihan pertandingan. Data tetap snapshot lokal dua laga, tanpa RAPM, perubahan schema, atau impor Neon. Metode dan batas: [REPORTING_DEMO.md](./docs/REPORTING_DEMO.md).

Tambahan demo 23 Oktober 2026: perkembangan pemain dan rotasi/lineup/on-off dua laga Bima Perkasa tersedia dari snapshot lokal. Checklist pengembangan lineup produksi tetap terpisah; tidak ada perubahan parser/importer/schema Neon. Cakupan, guard, dan sumber: [REPORTING_DEMO.md](./docs/REPORTING_DEMO.md).

## Tambahan analitik — 22 Oktober 2026

- [x] Modul rumus TypeScript bersama dengan evaluator angka dan SQL, versi serta definisi eksplisit.
- [x] JSON analisis pemain/tim per laga dan kompetisi, agregasi dari total, null, provenance, scope, preservation, serta isolasi namespace.
- [x] Ekspor otomatis sync/retry/runner dan preview untuk dry-run/snapshot; ekspor offline audit full/delta/summary, tautan katalog.
- [x] Verifikasi lokal 123 test (114 ingest, sembilan dashboard), lint, typecheck, build, serta regresi fixture-only terbaru dan katalog. Snapshot-only dua kompetisi menghasilkan preview tanpa impor Neon.
- [x] Ekspor data lokal 49607 (35 laga masuk) dan 49609 (25 laga masuk); ini hasil audit lokal, bukan audit ulang Neon. Panduan dan batas: [ANALYTICS.md](./docs/ANALYTICS.md).
- [ ] Penyajian kolom analitik tambahan pada UI dan pengembangan lineup/on-off merupakan pekerjaan terpisah.
- [ ] Ekspor TS% lawan, TOV% lawan, 3PA/FGA lawan, dan FTA/FGA lawan dari total input pada cakupan laga yang sama. Saat ini baru eFG% lawan yang tersedia; spesifikasi dicatat di [pengembangan statistik](./docs/PENGEMBANGAN_STATISTIK.md#tambahan-metrik-lawan--catatan-pengembangan-22-oktober-2026).

Tambahan 17 Oktober 2026: metrik PIP/PFT/FBP tim diambil dari Team Analysis portal bila tersedia. Prioritas tampilan adalah portal valid lalu LiveStats per metrik; backfill snapshot hanya menambahkan record yang belum ada. Ini tidak mengganti statistik pemain atau dataset rinci. Perintah, pengamanan writer, serta provenance dijelaskan di [docs/INGEST.md](./docs/INGEST.md).

Tambahan 16 Oktober 2026: integrasi JSON LiveStats sebagai pelengkap dan backfill pertandingan tersimpan mengikuti [docs/LIVESTATS.md](./docs/LIVESTATS.md). Ini perluasan setelah Tahap 6; identitas dan statistik dasar portal tetap dipertahankan. Hasil migrasi, uji, dan backfill nyata dicatat pada [verifikasi Neon](./docs/NEON_VERIFICATION.md).

Status: checklist implementasi, diperbarui 8 Oktober 2026. Tahap 1–6 telah diverifikasi sesuai cakupannya untuk `49607` serta `49609`. Perbaikan review `0.2.2`, migrasi `0003_sync_operations`, impor/impor ulang Neon, dan status Overview lulus; jumlah record logis tetap stabil. Runner berkala belum dipasang sebagai layanan permanen. Dokumen ini menjabarkan [PLAN.md](./PLAN.md).

## Hasil akhir yang dituju

Satu pipeline dapat menerima URL kompetisi Genius Sports, menemukan tim, pemain, grup, dan pertandingan, lalu menyimpan data terstruktur ke Neon PostgreSQL. Dashboard dengan tampilan awal IBL Analytic membaca Neon dan selalu dapat memilih kompetisi. Kompetisi `49607` adalah data uji pertama, bukan ID yang ditanam permanen di kode.

Alur utama:

```text
URL kompetisi
  → fetch HTML
  → parser Cheerio per halaman
  → validasi dan JSON audit
  → upsert Neon PostgreSQL
  → query server Next.js
  → dashboard
```

## 0. Siapkan struktur proyek

- [x] Buat workspace Node.js/TypeScript dengan `pnpm` agar importer dan dashboard dapat memakai kontrak database yang sama.
- [x] Tetapkan struktur awal tahap parser/database:

  ```text
  StatsArena/
  ├── ingest/          # fetch, parser, validasi, CLI sinkronisasi
  ├── packages/db/     # schema Drizzle, migrasi, tipe bersama
  ├── dashboard/       # tahap berikutnya: UI salinan IBL Analytic, kemudian disesuaikan
  ├── docs/            # aturan data dan hasil validasi
  └── .env.example     # nama variabel saja, tanpa kredensial
  ```

- [x] Siapkan `DATABASE_URL` untuk koneksi importer dan `DIRECT_DATABASE_URL` untuk migrasi Neon StatsArena. Keduanya terbaca dari `.env` root dan terverifikasi mengarah ke endpoint/database yang sama dengan mode pooled/direct yang sesuai.
- [x] Tetapkan runtime Node.js yang sesuai dengan versi Cheerio yang dipasang, lalu kunci versi dependensi di lockfile.

**Selesai bila:** workspace dapat menjalankan perintah lint/typecheck/parser tanpa memerlukan UI atau Neon yang sudah terisi.

## 1. Definisikan kontrak data sebelum parsing

- [x] Buat tipe untuk `Competition`, `Team`, `Player`, `Group`, `StandingRow`, `Game`, `TeamBoxScore`, `PlayerBoxScore`, dan `ValidationIssue`.
- [ ] `PbpEvent` dan `Shot` ditunda ke tahap play by play/shot chart sesuai cakupan proyek saat ini.
- [x] Pisahkan field `sourceId`, `sourceUrl`, `fetchedAt`, `parserVersion`, `status`, dan `rawValue` yang diperlukan untuk audit.
- [x] Gunakan angka atau `null` untuk statistik. Nilai kosong/tidak tersedia tidak otomatis menjadi nol.
- [x] Definisikan status pertandingan (`scheduled`, `live`, `complete`, `unknown`) dan status parsing (`parsed`, `partial`, `failed`).
- [ ] Definisikan metrik lanjutan resmi dan hasil hitung secara terpisah saat BP, 2CP, dan Index of Success dikerjakan.

**Selesai bila:** satu record contoh dari tiap jenis halaman dapat dinyatakan dengan tipe tersebut tanpa field ambigu.

## 2. Bangun pengambil HTML yang dapat diaudit

- [x] Terima hanya URL kompetisi pada domain dan pola Genius Sports yang didukung; validasi ID numerik sebelum membuat URL turunan.
- [x] Ambil HTML di proses Node.js terpisah dari request dashboard. Catat URL awal/akhir, status HTTP, waktu, ukuran, hash konten, dan error.
- [x] Tambahkan timeout, batas konkurensi, retry dengan jeda untuk kegagalan sementara, dan penghormatan terhadap cache sumber. Jangan memanggil situs saat setiap pengguna membuka dashboard.
- [x] Simpan snapshot HTML terkompresi ketika hash berubah; simpan metadata fetch pada Neon saat importer tersedia.
- [x] Tambahkan mode membaca snapshot lokal supaya parser dan test dapat berjalan tanpa jaringan.

**Selesai bila:** HTML contoh `49607` dan tiga halaman pertandingan contoh dapat diambil ulang atau dibaca dari snapshot dengan hasil yang sama.

## 3. Parser penemuan kompetisi

Kerjakan parser sebagai fungsi murni `HTML → record`, menggunakan Cheerio. Jangan campur query database di modul parser.

- [x] **Kompetisi/Fixtures:** baca nama kompetisi, ID dan URL pertandingan, tanggal, venue, dua ID tim, skor, dan kelas status. Deduplicasikan tautan pertandingan ber-ID sama.
- [x] **Teams:** baca satu record per `.team-link`; pilih ID dari URL, nama dari tautan teks, dan logo bila ada. Jangan menggandakan tim karena logo dan nama sama-sama tautan.
- [x] **Players:** baca seluruh `.playerblock` dan ID `/person/{id}`. Jangan hanya mengambil pemain yang sudah muncul di box score.
- [x] **Standings:** temukan semua tautan grup dari halaman utama, simpan label grup dan URL sebenarnya. Ambil tiap tab grup untuk anggota dan urutan resmi; jangan menebak `poolNumber`.
- [x] Sediakan pesan kesalahan yang menyebut URL dan selector yang gagal ketika struktur halaman berubah.

**Selesai bila:** snapshot contoh menghasilkan 27 tim, 322 pemain, 32 tautan pertandingan unik, dan sembilan grup. Angka ini adalah patokan snapshot 6 Oktober 2026, bukan nilai hardcoded untuk semua kompetisi.

## 4. Parser pertandingan dan validasi lokal

- [x] **Summary:** baca tim, skor, tanggal/waktu mentah, dan ringkasan yang benar-benar tersedia. Jangan mengasumsikan zona waktu dari teks halaman.
- [x] **Box Score:** baca dua tabel, kolom berdasarkan nama header, baris pemain, dan baris `Totals`. Simpan ID pemain dari URL, jersey, menit, statistik hitung, serta persentase resmi.
- [x] Pertahankan detik sebagai menit desimal dan teks durasi mentah. Tandai baris/tautan/kolom inti yang hilang sebagai `partial` sebelum penggantian statistik.
- [x] Periksa `Pts = 2 × 2PM + 3 × 3PM + FTM`, `FGA = 2PA + 3PA`, dan skor pertandingan terhadap total poin tim. Ketidaksesuaian menjadi `ValidationIssue`.
- [x] Buat output JSON audit per laga dan ringkasan jumlah record/isu tanpa menulis ke Neon.
- [x] Uji parser dengan potongan HTML nyata yang disimpan sebagai fixture test; sertakan kasus tanpa logo, nilai kosong, laga live, dan perubahan urutan kolom.

**Selesai bila:** laga `2931666` menghasilkan skor 25–45, FGA 41–40, dan statistik pemain/tim tanpa baris duplikat.

## 5. Rancang dan migrasikan Neon PostgreSQL

- [x] Buat schema Drizzle untuk kompetisi, grup, tim, pemain, keikutsertaan kompetisi, pertandingan, statistik laga, klasemen resmi, fetch, run impor, dan isu validasi.
- [x] Gunakan kunci internal database dan batas unik pada ID sumber yang sesuai. Hubungan kompetisi–tim/pemain disimpan terpisah; nama tidak menjadi kunci unik.
- [x] Tambahkan foreign key, indeks untuk filter kompetisi/tanggal/tim/pemain, serta kolom `created_at`/`updated_at` yang diperlukan.
- [x] Tambahkan migrasi `0001_precise_minutes` untuk tipe menit desimal dan pemulihan detik dari teks mentah pada statistik pemain lama; uji pada PGlite.
- [x] Jalankan migrasi di Neon StatsArena dan periksa schema hasilnya sebelum impor data. Dua migrasi tercatat, 14 tabel aplikasi tersedia, kedua kolom menit bertipe `double precision`, dan seluruh 27 foreign key valid.
- [x] Pastikan kredensial hanya dibaca proses server/CLI. Jangan salin `.env` IBL atau mengirim URL database ke browser.

**Status:** kedua migrasi diterapkan pada PGlite dan Neon. SQL awal memakai `CREATE SCHEMA IF NOT EXISTS` agar tidak berbenturan dengan schema jurnal yang dibuat Drizzle. Test memakai migrator Drizzle yang sebenarnya dan menjalankannya ulang untuk memeriksa jurnal.

## 6. Buat importer idempoten

- [x] Urutkan impor: kompetisi → tim/pemain → keikutsertaan → grup/klasemen → pertandingan → box score.
- [x] Gunakan upsert untuk entitas ber-ID sumber. Penulisan beberapa tabel satu laga dibungkus transaksi; kegagalan di tengah tidak meninggalkan separuh box score.
- [x] Simpan `import_runs`, sumber halaman, hash, versi parser, jumlah record, dan isu validasi.
- [x] Tambahkan CLI untuk `discover --url`, `sync --competition`, `--dry-run`, dan pembacaan snapshot. ID kompetisi diterima sebagai argumen, bukan disisipkan ke kode.
- [x] Ulangi input yang sama dua kali pada PGlite lokal; perbarui data dan pastikan kegagalan constraint me-rollback pertandingan tanpa menghapus statistik valid sebelumnya.
- [x] Buktikan statistik lama tetap utuh saat HTML baru kehilangan tautan, sel, header, atau baris pemain termasuk pemain tanpa poin. Jumlah hasil impor hanya mencakup statistik yang berhasil commit.
- [x] Gabungkan penulisan per batch maksimal 250 baris, gunakan kembali ID internal, dan tetap pertahankan transaksi serta rollback per pertandingan.
- [x] Lewati statistik identik berdasarkan perbandingan nilai tersimpan; buktikan ID/timestamp statistik tidak berubah pada impor ulang Neon.
- [x] Bedakan scheduled, fetch gagal, box score parsial, parser gagal, dan kegagalan transaksi pada audit/ringkasan. Catat waktu parsing/pengambilan terpisah dari waktu impor.
- [x] Uji satu kompetisi kedua dari situs yang sama sebelum menganggap parser benar-benar multi-kompetisi.
- [x] Impor dataset `49607` yang sama dua kali di Neon; bandingkan jumlah record logis, skor/FGA laga `2931666`, klasemen grup, dan presisi durasi. Kedua impor menyimpan 34 laga, 761 statistik pemain, dan 64 total tim tanpa kegagalan penulisan atau duplikasi.

**Status:** importer dan jalur kompetisi kedua lulus uji lokal. Impor serta idempotensi `49607` lulus verifikasi Neon pada 7 Oktober 2026. Pada 8 Oktober 2026, kompetisi `49609` diverifikasi terhadap URL sumber, diimpor ke Neon StatsArena, lalu diimpor ulang tanpa penambahan statistik logis. Kedua dataset tersedia di Neon untuk pengujian dashboard. Dua laga terjadwal per kompetisi ditampilkan tanpa statistik nol. Sejak parser `0.1.2`, halaman statistik laga terjadwal dilewati sehingga run baru tidak lagi dianggap parsial hanya karena laga belum berjalan; histori issue dari run lama tetap diberi konteks. Lihat [hasil verifikasi](./docs/NEON_VERIFICATION.md) dan [panduan dashboard](./docs/DASHBOARD.md).

## 7. Salin UI IBL Analytic, lalu sesuaikan

- [x] Buat package `dashboard/` dalam workspace dan salin basis CSS, tema, shell, navigasi, kartu, tabel, komponen keadaan, serta tipografi. Jangan salin pipeline PDF, file data, `.env`, auth, query IBL, atau konfigurasi deployment.
- [x] Jalankan dashboard lokal dengan Next.js, React, TypeScript, dan Tailwind workspace. Rute query memakai render per-request agar filter URL tersedia pada render awal.
- [x] Definisikan tipe tampilan dari schema `packages/db` dan pisahkan lapisan data dari komponen. Integrasi query ditunda ke Tahap 4.
- [x] Jadikan kompetisi filter utama yang tervalidasi dan tersimpan di URL; pertahankan parameternya pada navigasi Overview, Games, Teams, Players, Standings, dan Review.
- [x] Sediakan halaman dan empty state tanpa data palsu, loading skeleton, error boundary, tabel responsif, serta navigasi desktop/mobile.
- [x] Hubungkan Overview, Games dan detail pertandingan, Teams dan detail tim, Players dan detail pemain, Standings per grup, serta Review ke Neon lewat query server-only yang selalu dibatasi kompetisi.
- [x] Hitung leaderboard dasar dan statistik total/rata-rata dari box score tersedia; definisikan GP, menit nol, cakupan pertandingan, dan persentase made/attempts. BP/2CP tidak ditampilkan karena belum termasuk sumber/schema tahap ini.
- [x] Pertahankan tautan sumber sesuai record keikutsertaan kompetisi, provenance fetch, URL filter kompetisi/grup, severity/jenis issue, dan pagination. Detail menjelaskan status scheduled, fetch gagal, parsing parsial, serta statistik valid terakhir yang masih ditampilkan.
- [x] Sembunyikan PDF, lineup, rotation, BPM, RAPM, play by play, dan shot chart dari navigasi aktif sebelum datanya didukung. Pertahankan Review untuk isu parsing pada Tahap 4.

**Fondasi Tahap 3 selesai bila:** dashboard lokal dan enam route dapat diperiksa, filter kompetisi tetap pada URL antarroute, serta keadaan kosong/loading/error siap dipakai. Kriteria fondasi itu selesai pada Tahap 3; data dua kompetisi dan seluruh query diselesaikan dan diuji pada Tahap 4.

**Tahap 4 terverifikasi bila:** semua halaman inti/detail menampilkan data Neon pada dua kompetisi, ID lintas kompetisi tidak bocor, group filter bekerja, Review menampilkan isu/run yang sesuai, serta error koneksi tidak membeberkan detail rahasia. Hasil dan definisi angka ada di [docs/DASHBOARD.md](./docs/DASHBOARD.md).

## 8. Tambahkan play by play, shot chart, dan metrik resmi

- [x] Parse event play by play menurut urutan sumber, tim/pemain yang didukung tautan sumber, periode, waktu mentah, jenis aksi, dan skor berjalan. Waktu invalid tetap mentah dan field tanpa bukti identitas menjadi null.
- [x] Parse marker shot chart dan **saring hanya aksi 2PT/3PT**. Simpan koordinat mentah/persen, hasil, ID pemain/tim, periode, kelas, serta URL dan fetch sumber. Tampilkan koordinat kanvas sumber tanpa rotasi yang tidak didukung dokumentasi sumber.
- [x] Bandingkan jumlah tembakan masuk/percobaan dengan FGM/FGA box score; ketidaksesuaian menjadi isu validasi dan dataset parsial/gagal tidak mengganti data valid sebelumnya.
- [x] Parse Team Analysis dan Team Statistics untuk metrik resmi 2CP/BP. Metrik laga dan kompetisi disimpan terpisah; BP per laga yang tidak tersedia ditandai unavailable, bukan dihitung dari box score.
- [x] Gunakan metrik resmi Team Statistics sesuai scope kompetisi serta 2CP Team Analysis sesuai scope laga. UI menampilkan label sumber, scope dan jumlah pertandingan sampel yang diberikan sumber; tidak ada agregasi Leader buatan dari metrik dengan cakupan berbeda.

**Selesai bila:** shot chart laga `2931666` menampilkan 81 tembakan valid dan 24 tembakan masuk, cocok dengan FGA 41–40/FGM 9–15; play by play terbaca menurut urutan sumber. Lulus fixture dan verifikasi Neon pada `49607` serta `49609`.

## 9. Sinkronisasi dan pemeriksaan akhir

- [x] Gunakan checkpoint HTML valid per URL dengan TTL, pemulihan halaman gagal, invalidasi saat fixture berubah, prioritas live, serta opsi pemeriksaan ulang `--refresh`. Verifikasi dry-run pada dua kompetisi dan bedakan cache dari network di audit.
- [x] Baca ulang fixture setiap sinkronisasi; ikuti hanya tautan jadwal lintas halaman yang benar-benar ada pada HTML dan deduplikasi ID pertandingan. Halaman kompetisi tanpa fixture tidak menonaktifkan kompetisi. Test siklus deterministik menemukan semifinal lalu final pada sinkronisasi berikutnya.
- [x] Sediakan konfigurasi URL kompetisi aktif, `runner once`, runner berkala dengan interval CLI/environment, prioritas fetch/cache, dan penghentian SIGINT/SIGTERM tanpa memulai kompetisi berikutnya.
- [x] Lewati penulisan dataset pertandingan/statistik yang identik dan pertahankan transisi scheduled → live → complete tanpa menurunkan status. Fixture scheduled tidak memperoleh statistik nol.
- [x] Cegah benturan dengan lock direktori beridentitas owner/heartbeat/PID serta pemulihan owner mati, dan lease Neon pooled per kompetisi dengan expiry, heartbeat, guard transaksi, serta penandaan run stale.
- [x] Catat `sync_runs` dan jumlah/URL kegagalan; tampilkan status run, jadwal berikutnya, waktu pemeriksaan terpisah dari waktu HTML, jumlah laga baru/diperbarui, serta link gagal/review pada Overview berscope kompetisi.
- [x] Tambahkan retry terarah dari audit yang memvalidasi scope kompetisi/URL dan membatasi maksimal 25 halaman per pemanggilan.
- [x] Jika PBP berkurang, paksa fetch ulang URL tanpa cache sebelum impor. Penurunan yang berulang tetap menjadi isu review dan tidak menghapus data tersimpan. Guard FGA/FGM chart serta metrik yang kehilangan sel/baris tetap aktif.
- [x] Log kegagalan fetch/parser/impor per URL dan sediakan retry. Perubahan HTML sumber harus memunculkan error yang terlihat, bukan angka nol palsu.
- [x] Jalankan dry-run snapshot penuh untuk `49607` dan `49609` serta dua siklus watch berurutan. Hasil per siklus: 184/121 halaman, tanpa fetch/parse gagal atau partial; dua fixture scheduled pada `49609` tidak diminta sebagai halaman detail.
- [x] Terapkan migrasi `0002_match_details` dan impor ulang input yang sama pada dua kompetisi di Neon; query akhir membuktikan row count event, shots, metrik, dan statistik logis tetap sama. Update resmi, preservation partial/failure, dan rollback dibuktikan oleh test importer PGlite.
- [x] Jalankan test parser/importer/query, lint, pemeriksaan TypeScript, dan build workspace termasuk dashboard. Test PGlite mencakup operasi lease, retry, perlindungan parser `0.2.1`, fixture bertahap, dan status query dashboard.
- [x] Periksa halaman inti dan detail, filter URL, tabel/empty state, layout desktop/mobile, navigasi keyboard, Back/Forward, serta log browser dashboard lokal; detail laga dari kedua kompetisi, filter chart, tim resmi, dan laga scheduled tanpa statistik nol palsu juga diperiksa.
- [x] Simulasikan database tidak tersedia dengan koneksi lokal uji; error tetap umum dan tidak menampilkan host/credential. Periksa filter sumber, grup, dan Review setelah query Tahap 4 aktif.
- [x] Dokumentasikan runner sekali/berkala, konfigurasi tambah/nonaktif kompetisi, stop, retry, stale lock, PBP review, status dashboard, dry-run dan batas verifikasi pada [docs/SYNC_OPERATIONS.md](./docs/SYNC_OPERATIONS.md), [docs/FETCH_OPTIMIZATION.md](./docs/FETCH_OPTIMIZATION.md), dan [AGENTS.md](./AGENTS.md).
- [x] Terapkan migrasi `0003_sync_operations`, jalankan impor versi terbaru pada kedua kompetisi, lalu impor ulang dan bandingkan jumlah record logis di Neon StatsArena. Preflight pooled/direct dengan akses jaringan yang diizinkan memastikan target sama; empat migrasi, 19 tabel aplikasi, dan 41 foreign key terverifikasi. Jumlah logis stabil, statistik/detail identik tidak ditulis ulang, dan lease aktif tersisa nol.
- [x] Perbaiki review parser `0.2.2`: terima `/schedule` tanpa query, simpan antrean fixture lintas proses dengan scope/batas ukuran, tandai cakupan terpotong sebagai partial, deduplikasi isu fixture yang sama, pertahankan metadata seluruh pass refresh PBP dan batas sampel, serta catat audit kegagalan runner/sync/retry setelah parsing selesai. Lima test regresi tambahan lulus; total 64 test dan seluruh pemeriksaan workspace lulus. Dry-run live membaca 185/122 halaman tanpa kegagalan akhir atau partial.

- [x] Tambahan 10 Oktober 2026: sediakan `--incremental` untuk sync/runner/retry, dengan fixture live, fingerprint fixture asli di Neon, pelewatan detail lama valid, prioritas laga baru/berubah/live, serta eligibility retry setelah partial/rollback. Migrasi `0004_incremental_sync`, baseline dari cache valid, dry-run dua kompetisi, dan 68 test/lint/typecheck/build lulus. Uji normal melewati 35/25 laga lama dan mempertahankan jumlah statistik.

**Tahap 6 selesai dan diverifikasi di Neon.** Runner berkala belum dipasang sebagai layanan latar belakang permanen; jalankan `runner watch --incremental` untuk mengaktifkannya selama proses hidup. Lihat [status Tahap 6](./docs/SYNC_OPERATIONS.md#bukti-verifikasi-lokal-dan-neon).

### Retensi lokal — 12 Oktober 2026

- [x] Runner menggunakan audit `auto`: summary tanpa perubahan, delta dataset berubah, full saat gagal, dan archive eksplisit.
- [x] Pembersihan memakai lock, menjaga dua versi valid serta review/arsip, dan membatalkan penghapusan saat referensi atau HTML aktif tidak valid.
- [x] Pembersihan nyata setelah preview: 57 audit diringkas, 11 blob lama dihapus, penghematan bersih 515.567.222 byte. Preview ulang menghasilkan nol kandidat; 79 referensi dataset dan 23 file yang dilindungi terverifikasi.
- [x] Seluruh 77 test, lint, typecheck, dan build lulus. Tidak membutuhkan migrasi atau penulisan Neon; lihat [panduan retensi](./docs/STORAGE_RETENTION.md).

### Efisiensi Neon — 12 Oktober 2026

- [x] Simpan hash input dan audit summary yang merujuk baseline full langsung, dengan FK restrict; perubahan, partial/retry, dan archive tetap full.
- [x] Hindari penulisan ulang metadata/klasemen identik, pertahankan URL peserta lintas kompetisi, dan batasi observasi peserta menjadi harian.
- [x] Query dashboard mempertahankan isu baseline dan membedakan waktu pemeriksaan dari waktu asli HTML.
- [x] Terapkan migrasi `0005_massive_unicorn` setelah preflight target StatsArena; jalankan dua siklus impor putra/putri dengan input cache yang sama. Siklus kedua menghasilkan nol fetch audit baru dan nol penulisan statistik, metadata, atau klasemen. Jumlah serta fingerprint ID data tetap sama; lease tersisa nol.
- [x] Seluruh 80 test (77 ingest, 3 dashboard), lint, typecheck, dan build lulus. Lihat [efisiensi Neon](./docs/NEON_EFFICIENCY.md).

### Pembersihan audit Neon — 12 Oktober 2026

- [x] Sediakan preview serta maintenance eksplisit `storage compact-neon`, dengan pemeriksaan target/FK/writer, perlindungan sumber/baseline/review/arsip, backup, dan transaksi.
- [x] Hapus 1.741 audit fetch yang tergantikan tanpa referensi; jumlah turun 3.173 → 1.432. Perbandingan seluruh isi 14 tabel domain tetap sama; run dan isu tidak dihapus. Preview ulang menghasilkan nol kandidat.
- [x] Tiga test maintenance, lint terarah, typecheck, dan build ingest lulus. Pembersihan ini manual, tanpa migrasi baru; lihat [aturan serta laporan](./docs/NEON_EFFICIENCY.md#pembersihan-audit-lama--12-oktober-2026).

### Runner VPS/Coolify — 13 Oktober 2026

- [x] Siapkan `runner service`: incremental rutin, standard harian, checkpoint/heartbeat permanen, retry siklus gagal, graceful stop, dan pemulihan lock ketika PID container dipakai ulang.
- [x] Siapkan Dockerfile/Compose hanya untuk runner, dua volume permanen, healthcheck lokal, log rotation, serta workflow CI GitHub. Dashboard tetap di Vercel.
- [x] Sepuluh test service/operasi, lint terarah, typecheck/build ingest, dan parsing YAML lulus.
- [ ] Build/run image Docker dan verifikasi volume, restart, serta impor pada VPS Coolify yang dituju. Docker lokal dan konfigurasi resource belum tersedia. Tidak ada deployment permanen atau perubahan Neon pada penyiapan ini; lihat [panduan](./docs/RUNNER_DEPLOYMENT.md).

### Kelengkapan dataset dan retry — 13 Oktober 2026

- [x] Pisahkan hasil laga dari status summary, box score, PBP, chart, dan metrik resmi; simpan alasan serta waktu retry pada Neon dan JSON audit.
- [x] Jelaskan field marker invalid, selisih angka sumber, dan kegagalan jaringan pada detail/Review. Pertahankan statistik valid serta histori isu.
- [x] Terapkan backoff jaringan 5–60 menit, pemeriksaan struktur satu jam, dan anomali sumber 24 jam dalam seleksi incremental; perubahan fixture/parser dan retry manual tetap didahulukan.
- [x] Terapkan migrasi `0006_magenta_khan` dan backfill 152 laga dari audit tersimpan. Pengulangan tidak mengubah record; fingerprint pertandingan/statistik/detail/histori isu tetap sama.
- [x] Periksa panel dua kompetisi, Review, desktop/ponsel, dan log browser lokal. Aturan serta batas verifikasi: [DATA_QUALITY.md](./docs/DATA_QUALITY.md).
- [x] Seluruh 93 test (90 ingest, tiga dashboard), lint, typecheck, dan build lulus.

### Dukungan IBL — 16 Oktober 2026

- [x] Pertahankan scope IBF/IBL pada URL, source database, query, lease, incremental, checkpoint, audit/retry, dan tautan dashboard. Input angka tetap IBF; IBL eksplisit.
- [x] Tangani kolom 2P yang absen dengan perhitungan FG−3P dan provenance; sel resmi invalid tetap parsial. Tangani menu Summary, BP/2CP lintas tabel, GP unavailable, dan tab klasemen kosong tanpa menebak data.
- [x] Terapkan migrasi `0007_quiet_polaris` pada target Neon terverifikasi; fingerprint seluruh isi 14 tabel domain tetap sama selain kolom baru.
- [x] Dry-run sampel IBL `42041`: 40 fixture ditemukan, satu laga diperiksa (23 pemain, dua total tim, 601 PBP, 141 shots), tanpa fetch/parse gagal. Sepuluh tab round sumber kosong tetap parsial; bukan validasi seluruh musim.
- [ ] Daftarkan dan impor kompetisi IBL ke Neon bila diminta; pekerjaan ini membatasi impor IBL ke PGlite untuk verifikasi.

Verifikasi dukungan IBL: suite workspace 97 test lulus, ditambah regresi audit namespace baru dan penguatan redirect terarah; lint, typecheck, dan build lulus. Dry-run IBF `49607` menemukan 35 fixture, 27 tim, 322 pemain, dan 27 baris klasemen; satu sampel detail lengkap tanpa fetch/parse/partial gagal. Dashboard browser memeriksa dua kompetisi IBF dan empty state IBL tanpa mencampurkan scope.

### Laporan klub lokal 2026 — 26 Oktober 2026

Tambahan autentikasi setelah verifikasi snapshot: Better Auth/Drizzle, tujuh tabel akun/akses Neon, bootstrap admin, login/logout, undangan transaksional, pengaturan/pencabutan akses, dan pemeriksaan klub/role di server selesai. Migrasi `0009_faithful_hellion` diterapkan tanpa mengubah isi 20 tabel domain. 172 test (114 ingest/58 dashboard), lint/typecheck workspace, build dashboard, 23 pemeriksaan HTTP, serta browser login/aktivasi desktop/ponsel lulus. Undangan admin pertama diterima setelah pemilik menentukan password dan memberikan konfirmasi; login admin, akses 10 klub, serta Kelola akses sudah diperiksa di browser. Pengiriman email/reset password email belum dikonfigurasi; tidak ada deployment baru. Panduan: [REPORTING_AUTH.md](./docs/REPORTING_AUTH.md).

- [x] Indeks `/reports` dan route `/reports/[club]` mencakup 10 peserta `IBL:50231`, dari paket lokal tujuh laga selesai/20 fixture. Slug dan daftar klub berasal dari sumber. Demo 2025 tetap terpisah.
- [x] Generalisasi mesin laporan dengan validasi scope; orientasi home/away, GmSc setelah TS%, satu shot chart per laga, null/nol, dan perkembangan tanpa pembanding dipertahankan.
- [x] Exporter offline membaca katalog/analisis/audit/cache, memeriksa hash/identitas, menggunakan adapter LiveStats bersama, dan mempertahankan provenance. Ekspor ulang sumber identik menghasilkan hash paket yang sama. Tidak melakukan fetch, migrasi, atau penulisan Neon.
- [x] Flag `STATSARENA_REPORTS_ONLY=1` mengalihkan root ke report dan menolak URL dashboard/API/demo lama di server. Default tetap dashboard lengkap.
- [x] 48 test dashboard, lint dashboard/exporter, typecheck dashboard/ingest, build dashboard dan 23 pemeriksaan HTTP lulus. Browser 1440/390 px memeriksa katalog, report dua/satu laga, GmSc, kuarter, shot chart, perkembangan, rotasi tervalidasi/partial, perpindahan klub dan keyboard. Tidak ada halaman meluber atau warning/error browser; viewport dipulihkan.

Seluruh 14 shot chart klub–laga cocok dengan box score; tujuh dataset rotasi dan enam dataset rating tervalidasi. Kegagalan validasi lainnya tetap partial; angka tidak dipaksakan agar tampil. Belum ada deployment hosting, pemeriksaan ekspor PDF, atau verifikasi Neon. Panduan: [REPORTING_LOCAL.md](./docs/REPORTING_LOCAL.md).

### Report dari Neon — 26 Oktober 2026

- [x] Query server-only katalog/klub dengan namespace, transaksi read-only konsisten, pemeriksaan grant sebelum query rinci, dan sumber FK/hash yang benar.
- [x] Box score/pemain/kuarter/shot chart dari Neon tanpa fallback lokal; daftar klub undangan mengikuti keanggotaan Neon.
- [x] Bukti rotasi pada JSONB pelengkap LiveStats 1.1.0, preservation revisi sumber, cache-only dry-run lalu pengisian 10 laga; pengulangan nol penulisan dan fingerprint 16 tabel tetap.
- [x] Suite ingest/dashboard, regresi query serta LiveStats, lint/typecheck workspace, build production, empat pemeriksaan akses anonim, dan browser admin selesai; lihat catatan verifikasi serta batas di REPORTING_NEON.md.

Lihat [REPORTING_NEON.md](./docs/REPORTING_NEON.md).
