# LiveStats sebagai pelengkap portal

Implementasi 16 Oktober 2026, diperbarui 26 Oktober 2026 dengan adapter `statsarena-livestats/1.0.2`. Portal tetap menentukan kompetisi, jadwal, klasemen, ID global, dan statistik dasar. LiveStats melengkapi pertandingan tersimpan; tidak membuat kompetisi, tim, pemain, atau laga baru.

## Alur dan pemetaan

CLI sync/retry/runner memperbarui LiveStats setelah commit portal. Seleksi tambahannya independen dari incremental portal sehingga laga lama yang belum memiliki tambahan tetap diperiksa. Halaman kandidat `/u/IBF|IBL/<match>/bs.html` hanya diterima setelah namespace, `matchId`, `compId`, dan `datapath` cocok. JSON diambil dari path terverifikasi tanpa menjalankan script sumber.

Tim harus cocok berdasarkan sisi home/away, nama penuh/pendek eksplisit sumber, skor, dan 17 statistik dasar. OFF/DEF dapat dicocokkan dengan mengurangi komponen team rebound yang dinyatakan LiveStats secara eksplisit; angka portal tidak diubah. Pemain harus menghasilkan satu kecocokan melalui tim, nomor jersey, nama penuh/scoreboard, dan 17 statistik dasar. Tidak memakai nama saja, fuzzy matching, urutan baris, atau ID lokal sebagai ID global.

Pada versi 1.0.2, nama juga dapat dicocokkan dengan **inisial pertama + familyName lengkap** yang diturunkan dari pasangan `firstName/familyName` atau `internationalFirstName/internationalFamilyName` eksplisit pada baris yang sama. Contohnya `Elang Satria` + `Rajendra Dewanto` mendukung nama portal `E. Rajendra Dewanto`, meskipun scoreboard menulis `E. R Dewanto`. Ini bukan pencocokan awalan/kemiripan; satu kandidat unik dengan tim, jersey, dan seluruh 17 core stats tetap wajib. Nama/ID portal tidak diganti. Helper bersama `@statsarena/db/livestats` dipakai adapter dan validator rotasi.

Ekspor laporan lokal menyimpan enam field bukti nama asli pada `nameEvidence`, bersama hash/URL/waktu JSON yang tidak berubah. Validator rotasi `statsarena-demo-rotation/1.2.0` memeriksa bahwa nama portal didukung bukti ini sebelum menerima alias aktor PBP pada local ID dan jersey yang cocok. Data versi 1.0.2 tanpa bukti nama ditahan; demo 1.0.1 tetap kompatibel. Tidak mengubah sumber PBP, clock, urutan, statistik inti, atau guard lima pemain/durasi/plus-minus.

Fixture nyata 25 Oktober untuk laga `2938930` dan `2945705` berada pada `ingest/test/fixtures/livestats-2026-10-25-aliases/`. Fixture berisi objek `tm` sumber dan konteks portal; PBP/field JSON lain dihilangkan untuk membatasi ukuran. Manifest membedakan hash body sumber asli dan hash subset fixture, serta mencatat URL/waktu pengambilan.

Verifikasi 26 Oktober: 27 test terarah (sembilan adapter/operasi LiveStats, 18 rotasi/on-off/laporan lokal), lint/typecheck workspace, dan build dashboard lulus. Test mencakup tiga nama 2026 yang sebelumnya gagal, penolakan kandidat ganda/jersey/core stats/aktor asing/bukti nama yang salah, serta kompatibilitas dua laga demo lama. Ekspor diulang dari arsip lokal tanpa fetch atau penulisan Neon. Browser mengonfirmasi kedua laga Hangtuah terverifikasi, 24 kombinasi pada laga pertama, dan Sitorus ON 10:49/OFF 29:11 dengan plus/minus +7 yang cocok; Dewa tidak lagi mengalami pesan pemetaan, tetapi tetap partial pada validasi lima pemain. Lebar 1440/390 px tidak meluber, log browser bersih, dan viewport dipulihkan. Pemeriksaan ini tidak membuktikan pembaruan payload Neon atau deployment runner baru.

Skor pertandingan yang berbeda atau portal tanpa box score yang cukup menolak seluruh payload. Ketidakcocokan satu baris/tim tidak menghalangi baris lain yang lolos seluruh pemeriksaan; baris meragukan dilewati dan status menjadi partial. Payload valid sebelumnya tidak dihapus. Roster yang kehilangan baris mempertahankan baris lama. Bila field opsional hilang, seluruh baris valid sebelumnya dipertahankan agar provenance setiap angka tetap jelas. Setiap baris tambahan membawa hash/waktu/snapshot sumbernya sendiri.

Tambahan pemain: plus/minus, starter, posisi, blocks received, fouls drawn, 2CP, FBP, PIP, dan Index of Success (`eff_5`). Tambahan tim: BP, 2CP, PIP, PFT, FBP, keunggulan terbesar, dan rentetan poin terbesar. Nilai kosong tetap null; nol eksplisit tetap nol. Rumus Index belum diverifikasi; jangan menamainya BPM/EFF. PBP, shot chart, lineup/rotation, serta statistik inti portal tidak diganti adapter ini.

### PBP dan rotasi: ketersediaan sumber versus implementasi

PBP portal juga mempunyai rincian aksi dan teks pergantian `in/out`. Pada fixture laga 2931666, kedua sumber berisi 548 event. LiveStats memisahkan `actionType`, `subType`, `tno`/`pno` lokal, `actionNumber`, `previousAction`, skor berjalan dan `qualifier` menjadi field JSON. Pada sampel tersebut, skor portal muncul pada 53 event sedangkan JSON memuat skor pada seluruh event. Ini observasi snapshot bertanggal berbeda, bukan jaminan identitas seluruh atribut atau seluruh kompetisi.

Field terpisah memudahkan calon pengolahan riwayat pemain masuk/keluar, durasi bermain, dan kombinasi lima pemain. Pemetaan identitas, lima pemain awal tiap periode, kelompok pergantian pada waktu sama, koreksi event, durasi dan skor tetap harus divalidasi. Interval yang tidak pasti tidak boleh dipaksakan sebagai lineup lengkap.

**Belum diimplementasikan:** impor event PBP LiveStats, fallback PBP, timeline rotasi, stint, statistik lineup, on/off dan matchup. PBP dashboard tetap dari portal; JSON mentah yang sudah disimpan belum merupakan dataset rotasi. Perbandingan lengkap, contoh event serta daftar potensi dan prasyarat pengembangan ada pada [PBP dan potensi rotasi](./PERBANDINGAN_LIVESTATS_GENIUS.md#perbandingan-pbp-dan-potensi-rotasi--17-oktober-2026).

BP/2CP/PIP/PFT/FBP portal dan LiveStats disimpan terpisah. Perbedaan metrik resmi per laga dicatat sebagai `LIVESTATS_OFFICIAL_METRIC_CONFLICT` dengan expected/actual; agregat kompetisi tidak dibandingkan dengan metrik laga. Dashboard memilih nilai portal laga yang valid lebih dulu dan memakai LiveStats sebagai cadangan per tim/per metrik. PIP/PFT/FBP juga tersedia pada Team Analysis portal DBL yang diperiksa; parser portal sebelum 0.2.5 belum mengambil ketiga kolom tersebut. Nilai individu seperti PIP pemain tetap bersumber LiveStats.

## Penyimpanan dan status

Migrasi `0008_stiff_blockbuster` menambah `statsarena.game_livestats`, satu record per game: payload tambahan, hash konten/payload, fingerprint portal, versi adapter, URL, waktu sumber/percobaan, jadwal berikutnya, isu dan referensi snapshot. Statusnya terpisah dari `games.detail_sync_status/detail_quality`.

| Status | Arti | Jeda laga selesai |
|---|---|---|
| `ready` | Semua pemeriksaan lolos | 24 jam |
| `partial` | Sebagian baris/field tidak lolos atau metrik resmi berbeda; baris terverifikasi tersedia | 1 jam |
| `mismatch` | Tidak ada tambahan baru yang aman dipetakan atau skor berbeda | 24 jam |
| `unavailable` | HTTP 403/404; belum terbukti permanen | 24 jam |
| `fetch_failed` | Gangguan jaringan/HTTP lain | 5 menit |
| `parse_failed` | Struktur/metadata tidak dapat divalidasi | 1 jam |

Scheduled tidak diminta. Live diperiksa paling cepat satu menit. Perubahan fingerprint portal, versi adapter, dan `--refresh` mengalahkan jeda. Kegagalan terbaru tidak menghapus payload valid. Status operasi portal dan checkpoint standard harian tetap mengikuti hasil portal; ringkasan operasi juga mencatat hasil LiveStats secara terpisah. Masalah tambahan tidak memaksa seluruh pengambilan portal diulang sebelum waktunya. Audit runner dengan kegagalan tambahan tetap full. Kegagalan transaksi/lease tetap menggagalkan operasi, bukan dianggap sukses.

## Perintah

```sh
pnpm --dir ingest run cli --help
pnpm --dir packages/db run db:migrate

# Membaca laga lama di Neon tanpa penulisan database:
pnpm --dir ingest run cli livestats sync --competition 49607 --dry-run
pnpm --dir ingest run cli livestats backfill --dry-run

# Mengisi tambahan seluruh kompetisi yang sudah ada di Neon:
pnpm --dir ingest run cli livestats backfill

# Hanya satu kompetisi atau laga:
pnpm --dir ingest run cli livestats sync --competition 49607
pnpm --dir ingest run cli livestats sync --competition 49607 --game 2931666 --refresh
```

`backfill` membaca daftar Neon, bukan katalog/config. Tanpa refresh, data yang belum jatuh tempo dilewati. `--match-limit` membatasi per kompetisi. Penulisan memakai lock dan lease kompetisi yang sama dengan portal. Setiap batch kecil memakai transaksi dan guard lease; hasil identik tidak mengganti payload/updated_at, tetapi observasi terakhir dapat diperbarui.

Checkpoint `*.pending.json` di direktori LiveStats ditulis sebelum batch dimulai dan dibersihkan hanya setelah commit. Rollback atau proses terhenti tetap eligible untuk percobaan berikutnya pada volume yang sama meskipun sebelumnya data ready mempunyai cooldown panjang. Jangan hapus checkpoint dalam operasi rutin. Kegagalan transaksi mempertahankan hasil parse pada audit kegagalan.

Dry-run LiveStats membutuhkan DATABASE_URL untuk membaca identitas/statistik, tetapi tidak membuat lease, status run, atau data aplikasi Neon. Snapshot dan laporan lokal boleh ditulis; file tidak dipangkas. Snapshot-only belum tersedia untuk adapter tambahan. Dry-run/snapshot-only portal tetap mengikuti perilaku lama dan tidak otomatis melakukan backfill LiveStats. Retry URL portal tetap terpisah dari retry LiveStats.

## Fetch, snapshot, dan audit

Fetch dibatasi dua laga bersamaan, timeout 20 detik per request, maksimum 4 MiB, dan tiga percobaan untuk gangguan sementara. Host/path/protokol/kredensial URL divalidasi dan redirect ditolak. Parsing memakai Zod/Cheerio. HTTP 403/404 tidak langsung dicoba berulang dalam request yang sama.

Snapshot tambahan berada di `ingest/snapshots/livestats/`, ikut volume permanen runner. Cache HTML tervalidasi 24 jam; JSON lima menit untuk laga selesai dan 15 detik untuk live. Perubahan fingerprint portal memaksa pengambilan JSON tanpa cache. Waktu sumber dipertahankan saat cache digunakan.

Envelope gzip berisi URL, body mentah, SHA-256 body, dan waktu ambil. Nama versi memakai hash URL/konten dan tidak ditimpa oleh revisi berbeda. Reader membatasi gzip 4 MiB serta dekompresi 8 MiB dan memeriksa hash. Cache rusak diambil ulang. Setelah commit, retensi mempertahankan dua revisi valid, percobaan terbaru, serta seluruh revisi yang masih dirujuk payload Neon. Tidak memangkas ketika dry-run. Retensi ini tidak mengubah baseline/checkpoint/katalog HTML portal.

Katalog kompetisi kini mencatat `liveStatsFiles` berupa `ID laga → file JSON .gz` secara otomatis pada sync/retry/runner dan `livestats sync/backfill`. Alias current diutamakan; attempt bisa merupakan hasil dry-run atau data yang belum lolos validasi, sehingga keberadaan file tidak membuktikan impor Neon. `catalog rebuild` memulihkan daftar dari cache lokal tanpa jaringan/Neon, dengan memeriksa identitas halaman, URL, dan hash. Lihat [panduan katalog](./COMPETITION_CATALOG.md).

Laporan manual `*-livestats-*.json` memuat status dan alasan per laga; bukan payload importer atau input retry portal. Runner menyertakan ringkasan tambahan pada auditnya. Pemeliharaan Neon juga melindungi isi tabel baru ini.

## Dashboard dan verifikasi

Untuk melihat laga bermasalah tanpa berganti kompetisi, buka `/review?scope=all&source=livestats`. Daftar mengelompokkan isu menjadi satu baris per laga beserta nama tim dan kompetisi; menghapus filter sumber juga menampilkan masalah portal terkini. Ini daftar aktif, berbeda dari histori portal pada Review per kompetisi. Lihat [DASHBOARD.md](./DASHBOARD.md).

Kotak **Dampak** menjelaskan akibat tiap isu dalam bahasa sederhana. Pemetaan pemain gagal menahan tambahan baru pemain terkait; pemetaan tim gagal menahan tambahan tim beserta pemainnya; skor berbeda atau portal belum cukup lengkap menahan seluruh tambahan baru laga. Baris yang lolos pemeriksaan tetap dapat dipakai. Penjelasan menyebut data valid sebelumnya dipertahankan **bila ada**, tanpa mengklaim setiap laga pernah mempunyai payload lengkap. Penanda roster/starter juga dijelaskan sebagai keterbatasan cakupan verifikasi, bukan otomatis kesalahan seluruh statistik.

Isu aktif kini juga tersedia di `/review?competition=<ref>&source=livestats`, dengan filter sumber/severity/kode dan pagination bersama histori portal. Status tambahan ditampilkan terpisah dari status pertandingan. Isu LiveStats yang kembali ready hilang dari daftar aktif; histori audit lokal tetap tersedia. Angka kartu membedakan jumlah isu dan jumlah laga. Query hanya membaca Neon dan tidak menggandakan record isu.

Detail laga menampilkan **Statistik tambahan LiveStats** secara server-side dalam scope kompetisi/game, termasuk plus/minus, starter/bench, posisi, metrik pemain/tim, status, waktu sumber, tautan, dan alasan review. Baris lama yang dipertahankan tetap membawa provenance asalnya.

Fixture nyata DBL putra/putri dan IBL beserta URL/hash/tanggal ada pada `ingest/test/fixtures/livestats-2026-10-16/manifest.json`. Test mencakup pemetaan, nol/null, namespace/path, batas respons, retry, migrasi, dry-run, idempotensi, rollback, dan perlindungan data. Hasil Neon dicatat di [NEON_VERIFICATION.md](./NEON_VERIFICATION.md); investigasi sumber awal di [PERBANDINGAN_LIVESTATS_GENIUS.md](./PERBANDINGAN_LIVESTATS_GENIUS.md).

### Adapter 1.1.0 dan report Neon — 26 Oktober 2026

Payload pelengkap sekarang dapat membawa `rotation` berformat `statsarena-livestats-rotation/1.0.0`, berisi revisi event dan mapping dengan provenance immutable. Tidak mengganti PBP/shots/box score portal. Rekonstruksi tetap divalidasi terpisah saat report dibaca. Event atau mapping berkurang/hilang mempertahankan bukti sebelumnya dan mencatat partial; input identik tidak mengganti provenance. `livestats sync/backfill --snapshot-only` mendukung pembacaan cache tervalidasi tanpa HTTP dan tidak dapat digabung refresh. Cakupan, pengisian awal, dan verifikasi: [REPORTING_NEON.md](./REPORTING_NEON.md).
