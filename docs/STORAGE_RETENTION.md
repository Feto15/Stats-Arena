# Retensi audit dan snapshot

## File analisis turunan — 22 Oktober 2026

`ingest/audit/analysis/` menyimpan satu `<key>.json` utama dan, bila pernah dibuat, satu `<key>.preview.json` per kompetisi. Ekspor mengganti file pada path yang sama secara atomik; tidak membuat histori file analisis setiap siklus. Direktori ini tidak diproses sebagai audit full/delta/summary oleh `storage compact`. Katalog menautkan file utama melalui `analysisFile`.

JSON analisis membawa input box score ternormalisasi, rumus, dan provenance untuk perhitungan ulang. PBP/shots/payload LiveStats tetap mengikuti penyimpanan sumber masing-masing. File turunan bukan pengganti arsip sumber lengkap atau baseline importer; pembuatan analisis tidak memajukan baseline retensi atau memangkas audit/gzip. Rekonstruksi dari audit lama membutuhkan payload/referensi yang masih tersedia. Lihat [ANALYTICS.md](./ANALYTICS.md).

Snapshot JSON LiveStats memakai subdirektori `ingest/snapshots/livestats`, dengan retensi tersendiri setelah commit: dua versi valid, percobaan terbaru, dan semua versi yang masih dirujuk baris tambahan Neon. Dry-run tidak memangkas. Direktori tersebut ikut volume snapshot runner, tetapi tidak memakai index/baseline HTML portal. Lihat [LIVESTATS.md](./LIVESTATS.md).

Pembersihan audit Neon tersedia secara terpisah melalui `storage compact-neon`; hasil dan perlindungan referensinya dijelaskan di [efisiensi Neon](./NEON_EFFICIENCY.md#pembersihan-audit-lama--12-oktober-2026). Aturan JSON/.gz di bawah berlaku untuk penyimpanan lokal.

Runner menggunakan `--audit-mode auto` secara default. Perubahan ini berlaku pada file lokal di `ingest/audit/` dan `ingest/snapshots/`; tidak menghapus statistik, hash, provenance, maupun histori run di Neon. Schema dan migrasi tidak berubah.

## Isi audit setiap siklus

Katalog lokasi kompetisi diperbarui otomatis setelah penulisan audit dan maintenance rutin. Katalog menunjuk indeks baseline `.audit-storage.json` serta indeks snapshot, sehingga pembaca tidak menganggap audit terbaru yang ringkas sebagai payload lengkap. File `competitions_catalog.json` di volume audit adalah metadata indeks, bukan payload yang dipangkas. Lihat [panduan katalog](./COMPETITION_CATALOG.md).

| `auditType` | Isi | Kapan digunakan |
| --- | --- | --- |
| `full` | Metadata, fetch, isu, dan seluruh hasil parse siklus itu | Baseline pertama, seluruh dataset berubah, kegagalan, atau mode `full` |
| `delta` | Metadata lengkap, dataset yang berubah dalam `changedData`, referensi dataset lain | Sebagian data berubah |
| `summary` | Hitungan, waktu, fetch/isu, serta referensi hash dan file; `data: null` | Data hasil parse sama dengan baseline impor valid |
| `archive` | Audit lengkap yang dilindungi dari pembersihan rutin | Arsip final yang diminta eksplisit |

Hash data dihitung dari JSON deterministik per kompetisi dan per pertandingan. Perubahan HTML yang hanya mengubah navigasi tidak memaksa penulisan ulang semua event PBP. Urutan array tetap diperhitungkan, termasuk urutan event. Nilai `null` berbeda dari nol. Untuk mode incremental, pertandingan yang tidak diproses tidak dianggap hilang; baseline pertandingan tersebut tetap tersedia.

Metadata operasional `datasetQuality` dikecualikan dari fingerprint hasil parse: perubahan waktu pemeriksaan, hitungan kegagalan, atau jadwal retry tidak dianggap perubahan statistik. Metadata kualitas tetap tersimpan di Neon dan payload audit full/dry-run; isu/fetch yang diperlukan untuk retry tetap dipertahankan pada audit ringkas. Lihat [kualitas data](./DATA_QUALITY.md).

Semua mode mempertahankan metadata fetch/URL, hash HTML, versi parser, hitungan, hasil impor, dan isu. `datasetReferences` menunjuk payload yang masih tersedia untuk baseline saat audit baru ditulis. `snapshotReferences` mencatat HTML yang dipakai pada siklus itu. Hash historis tetap tercatat walaupun file HTML kemudian melewati kebijakan retensi.

`delta` dan `summary` **bukan JSON input langsung untuk importer**. Pipeline tetap menyerahkan data lengkap siklusnya ke importer sebelum menulis audit ringkas. Audit lama yang diringkas oleh pembersihan memiliki `payloadStatus: expired`; referensinya merupakan histori, bukan jaminan bahwa seluruh payload lama masih bisa diputar ulang. Retry tetap membaca `fetches` dan `issues`, yang tidak dibuang.

Baseline dalam `.audit-storage.json` hanya maju sesudah impor sukses, tidak ketika dry-run, hasil parsial, atau transaksi gagal. Mode `sync` dan `retry` tetap menggunakan `full` secara default; tambahkan `--audit-mode auto` jika ingin kebijakan ringkas yang sama dengan runner. Penimpaan path `--output` yang sedang direferensikan menyimpan salinan payload lama terlebih dahulu.

## File yang dipertahankan

- Dua hash data valid terakhir yang berbeda untuk setiap dataset, beserta file audit yang memuatnya. Audit lengkap yang memuat beberapa dataset dapat mempertahankan versi tambahan.
- Semua HTML yang masih tercantum di `snapshots/index.json`, termasuk halaman terbaru yang belum valid.
- Dua hash HTML terakhir yang berbeda per URL dari siklus impor sukses.
- Payload dan HTML audit yang dibutuhkan untuk kegagalan/review error yang belum diselesaikan oleh impor sukses pada URL terkait. Kegagalan operasi tanpa URL dipertahankan sampai ada impor sukses berikutnya pada kompetisi tersebut.
- Audit berjenis `archive` beserta HTML yang direferensikan. Audit JSON di luar format operasi yang dikenal dipertahankan secara konservatif.

Pembersihan mengubah payload audit lama menjadi ringkasan, lalu menghapus hanya file `<sha256>.html.gz` yang tidak dilindungi. Checkpoint fixture, index aktif, konfigurasi, fixture test, dan dokumen analisis tidak menjadi kandidat penghapusan. Dua versi merupakan batas dasar, bukan jaminan tepat dua file per URL: arsip dan kegagalan bisa memerlukan lebih banyak.

Lock snapshot dan lock audit mencegah pembersihan bersamaan dengan runner. Rencana dibuat dan index/hash HTML aktif diverifikasi sebelum perubahan file. JSON rusak, referensi baseline hilang, gzip rusak, atau lock aktif membatalkan pembersihan. Symlink tidak menjadi kandidat penghapusan. Katalog baru disimpan sebelum payload diringkas; proses yang terputus dapat meninggalkan file tambahan, tanpa sengaja menghapus payload baseline.

## Menjalankan pembersihan

Runner `auto` mencoba pembersihan paling sering sekali per 24 jam setelah impor sukses. Jika pembersihan gagal, impor yang telah commit tetap sukses dan alasan penundaan dilaporkan. Dry-run tidak memajukan baseline atau menjalankan pembersihan otomatis.

Periksa dan jalankan manual dari root StatsArena; kedua perintah tidak mengakses Neon:

```sh
pnpm --dir ingest run cli storage compact --dry-run
pnpm --dir ingest run cli storage compact
```

Ringkasan melaporkan jumlah audit yang diringkas, snapshot yang dihapus, perkiraan byte yang dibebaskan, hash yang dilindungi, dan file yang dilewati. `--snapshot-dir` dapat memilih subdirektori di dalam `ingest/snapshots/`; audit mengikuti `STATSARENA_AUDIT_DIR` di dalam `ingest/audit/`.

Arsip final satu kompetisi dibuat dengan sinkronisasi standar lengkap:

```sh
pnpm --dir ingest run cli sync --competition 49607 --audit-mode archive
```

`archive` tidak dapat digabung dengan `--incremental` atau `--match-limit`, karena keduanya dapat membatasi cakupan pertandingan. Hasil gagal/parsial tetap menjadi audit `full`, bukan arsip final. Arsip harus diminta eksplisit; runner tidak otomatis menganggap kompetisi selesai.

## Pengujian

Test offline mencakup hash HTML berubah tanpa perubahan statistik, delta per pertandingan, rollback/dry-run, dua versi valid, arsip, retry dari audit yang dipertahankan, baseline hilang, gzip/katalog rusak, lock, symlink, path output yang dipakai ulang, serta idempotensi pembersihan. Test integrasi runner PGlite memastikan siklus incremental tanpa perubahan menulis summary dan tetap mempertahankan data database.

## Pembersihan lokal 12 Oktober 2026

Preview diperiksa sebelum pembersihan nyata dijalankan. Hasilnya:

| Penyimpanan | Sebelum | Sesudah |
| --- | ---: | ---: |
| Audit lokal | 593.676.966 byte (566,2 MiB) | 78.294.906 byte (74,7 MiB) |
| Snapshot lokal | 20.996.378 byte | 20.811.216 byte |

Sebanyak 57 payload audit lama diringkas dan 11 blob `.html.gz` dihapus. Penghematan bersih total 515.567.222 byte, termasuk penambahan katalog retensi. Audit tersisa mencakup delapan file payload yang menjadi baseline untuk 70 dataset; 79 referensi hash diperiksa langsung terhadap isi payload. Jumlah audit bertambah satu karena katalog baru; histori ringkas tetap disimpan.

Index aktif, checkpoint fixture, konfigurasi kompetisi, dan fixture test diperiksa dengan hash sebelum/sesudah: seluruh 23 file tersebut identik. Preview kedua melaporkan nol audit yang perlu diringkas dan nol snapshot yang perlu dihapus. Seluruh HTML aktif lolos verifikasi gzip/hash. Tidak ada operasi database pada pembersihan ini. Seluruh 77 test (74 ingest dan tiga dashboard), lint, typecheck, dan build lulus.

## Kunci namespace IBL

Audit IBL menggunakan referensi `IBL:<ID>` dan kunci dataset berscope; IBF lama tetap memakai ID angka. Pembentukan scope membaca URL sumber sebelum ID angka agar baseline IBL tidak memakai histori IBF bernomor sama. URL lengkap tetap menjadi identitas snapshot. Aturan retensi dan pemicu maintenance tidak berubah pada penambahan dukungan IBL.
