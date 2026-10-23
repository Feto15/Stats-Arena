# Efisiensi penulisan Neon

Terpasang dan terverifikasi pada 12 Oktober 2026. Migrasi `0005_massive_unicorn` menambahkan hash input, jenis audit, referensi baseline, serta waktu observasi ke `import_runs`. Pada verifikasi tersebut Neon memiliki enam migrasi dan 19 tabel aplikasi. Sejak 13 Oktober 2026, migrasi `0006_magenta_khan` menambah kolom kualitas dataset tanpa tabel baru; jurnal kini memiliki tujuh migrasi. Lihat [verifikasi Neon](./NEON_VERIFICATION.md#kelengkapan-dataset-dan-retry--13-oktober-2026).

## Siklus tanpa perubahan

Importer membandingkan input dengan run tepat sebelumnya pada kompetisi yang sama. Audit ringkasan hanya dipakai ketika run sebelumnya sukses, versi parser dan hash input sama, seluruh halaman sukses diparse, tidak ada kegagalan percobaan fetch, dan tidak ada isu warning/error. Isu info boleh tetap ada.

Hash mencakup data hasil parse serta URL, hash HTML, resource, dan status halaman. Waktu pengambilan, durasi, dan cara retrieval tidak menjadi penentu perubahan. Urutan event PBP tetap diperhitungkan. Perubahan versi parser, pilihan dataset, HTML, atau data menyebabkan audit lengkap. Importer tidak mencari hash lama melewati run yang berbeda atau gagal.

`datasetQuality` juga dikecualikan dari hash input: waktu pemeriksaan dan jadwal retry merupakan metadata operasional, bukan statistik. Kualitas per dataset tetap dicatat ketika pertandingan diproses dalam transaksi; laga yang dilewati incremental mempertahankan observasi detail terakhir. Anomali yang masih membawa warning/error tetap tidak eligible untuk audit summary Neon. Lihat [aturan kualitas data](./DATA_QUALITY.md).

Run baru tetap dicatat. `baseline_import_run_id` menunjuk langsung ke audit lengkap yang digunakan; tidak membentuk rantai ringkasan. Foreign key dengan `ON DELETE RESTRICT` menjaga baseline. Siklus ringkasan tidak menggandakan `source_fetches` atau `validation_issues`. Dashboard membaca isu baseline dan waktu observasi run terbaru, sehingga pemeriksaan cache baru tidak mengubah waktu asli HTML.

Audit lengkap tetap digunakan ketika input berubah, parsial, gagal, memiliki diagnostik retry, atau menggunakan kebijakan archive. `--audit-mode full` mengatur JSON lokal; optimasi Neon berlaku otomatis secara terpisah. Archive juga memaksa audit Neon lengkap.

## Metadata dan klasemen

- Tim, pemain, kompetisi, dan grup yang identik melewati penulisan ulang metadata.
- URL global tim/pemain dipertahankan jika perbedaannya hanya scope kompetisi. Membership menyimpan URL tepat untuk kompetisi tersebut; dashboard memakai URL membership.
- Klasemen resmi dibandingkan berdasarkan kolom tersimpan per grup. Baris identik mempertahankan ID dan provenance; perubahan diganti dalam transaksi.
- `lastSeenAt` diperbarui paling sering sekali per 24 jam untuk kompetisi dan peserta yang benar-benar diamati. Observasi tidak mengubah `updatedAt` metadata. `observationWrites` dilaporkan terpisah dari `metadataWrites`.

Statistik, event, shots, dan metrik identik tetap dilewati. Guard parsial, rollback, lease, dan perlindungan data valid tetap berlaku.

## Verifikasi Neon

Preflight pooled/direct memastikan target StatsArena yang sama. Setelah migrasi, dua siklus runner dijalankan untuk putra `49607` dan putri `49609`. TTL diperpanjang tujuh hari hanya pada proses verifikasi agar kedua siklus membaca HTML cache yang sama; `.env` dan TTL bawaan tidak diubah. Tidak ada HTTP baru pada pengukuran ini.

| Kompetisi | Fetch audit baru: baseline → ulang | Waktu importer: baseline → ulang |
| --- | --- | --- |
| Putra `49607` | 190 → 0 | 36,625 → 1,012 detik |
| Putri `49609` | 137 → 0 | 27,200 → 0,825 detik |

Impor ulang menulis nol statistik, event, shots, metrik, metadata, klasemen, dan observasi. Total proses ulang sekitar 43,5 detik untuk dua kompetisi karena mode standar tetap membaca/parsing HTML serta menghitung hash. Ini bukan pengukuran fetch live. Mode incremental mengurangi pemrosesan detail; sinkronisasi standar/refresh berkala tetap diperlukan untuk koreksi detail yang tidak mengubah fixture.

Query sebelum/sesudah membuktikan jumlah serta fingerprint ID pada sembilan tabel data tetap sama: 2 kompetisi, 60 laga, 1.418 statistik pemain, 120 statistik tim, 28.235 event PBP, 5.254 shots, dan 330 metrik resmi. Siklus baseline menambah 327 fetch audit dan 10 isu info; siklus kedua tidak menambah keduanya. Dashboard tetap membaca lima isu info per kompetisi dan waktu HTML asli. Lease aktif tersisa nol.

Seluruh 80 test (77 ingest, 3 dashboard), lint, typecheck, dan build lulus. Test mencakup hash berubah, parser berubah, partial/retry, rollback, baseline FK, observasi harian, perubahan klasemen, URL peserta lintas kompetisi, dan query status ringkasan.

Bukti lokal yang diabaikan Git: `ingest/audit/neon-efficiency-before.json`, `ingest/audit/neon-efficiency-after.json`, serta audit runner UTC `2026-10-12T04-46-37-524Z`, `04-47-40-760Z`, `04-50-13-978Z`, dan `04-50-41-028Z`.

Optimasi importer di atas tidak menghapus histori audit Neon. Pembersihan audit lama kemudian dijalankan secara terpisah sesuai bagian berikut. Retensi JSON/.gz lokal dijelaskan dalam [panduan retensi](./STORAGE_RETENTION.md).

## Pembersihan audit lama — 12 Oktober 2026

Perintah manual dari root:

```sh
pnpm --dir ingest run cli storage compact-neon --dry-run
pnpm --dir ingest run cli storage compact-neon
```

Perintah memeriksa target StatsArena dan seluruh foreign key ke `source_fetches`. Preview membaca Neon tanpa mutasi; penghapusan mengunci tabel selama transaksi dan menolak sinkronisasi yang sedang aktif. Tidak ada migrasi baru atau pembersihan otomatis pada runner.

Kandidat adalah fetch sukses/parsed dari run sukses yang sudah memiliki sedikitnya dua observasi sukses/parsed lebih baru pada kompetisi, resource, dan URL yang sama. Fetch harus memiliki hash valid dan tidak membawa error fetch/retry. Semua referensi pertandingan, klasemen, PBP, shots, dan metrik dipertahankan. Run terbaru, baseline yang masih dirujuk summary, run dengan warning/error, dan arsip lokal yang memiliki ID import run juga dilindungi. Fetch gagal/parsial, run parsial/gagal, identitas tanpa scope, dan isu review dipertahankan.

Arsip eksplisit saat ini dikenali dari metadata JSON lokal (`auditType`/`retention = archive`); jangan menghapus atau memindahkan katalog arsip sebelum maintenance. Pembersihan membatalkan proses jika arsip tidak memiliki identitas run. Jangan menjalankan maintenance dari mesin yang tidak memiliki metadata arsip proyek.

Sebelum penghapusan, seluruh baris kandidat disimpan dalam backup `.json.gz` lokal dengan permission `0600`. Setelah penghapusan, jumlah dan fingerprint seluruh isi 14 tabel domain harus sama; bila berbeda, transaksi rollback. Kegagalan backup juga membatalkan transaksi.

Hasil nyata: **1.741 fetch audit dihapus**, terdiri dari 1.098 putra dan 643 putri. `source_fetches` turun dari 3.173 menjadi 1.432 (54,9%). Estimasi ukuran baris yang dibuang sekitar 1,20 MiB, tidak termasuk indeks/TOAST. Ini bukan klaim pengurangan langsung ukuran fisik Neon; PostgreSQL dapat memakai kembali ruang setelah pemeliharaan internal.

Data di seluruh 14 tabel domain tidak berubah. Import run tetap 33, sync run 18, dan isu review 140; seluruh log tersebut masih berumur kurang dari 30 hari. Perintah ini hanya memangkas fetch audit, belum menerapkan penghapusan log berdasarkan umur. Satu import run lama berstatus running tetap dipertahankan. Tidak ada sinkronisasi aktif saat maintenance.

Laporan penerapan: `ingest/audit/neon-cleanup-2026-10-12T07-34-31-998Z.json`. Backup: `ingest/audit/neon-cleanup-2026-10-12T07-34-19-438Z-7e3abcef-027c-4a67-acf6-7c366e7a3bc8.json.gz`. Keduanya lokal dan diabaikan Git. Tiga test maintenance menguji seluruh enam referensi FK, baseline, archive, dua observasi terbaru, partial/failure/retry, dry-run, idempotensi, writer aktif, perubahan FK, serta rollback jika backup gagal.

## Target multi-namespace — 16 Oktober 2026

Preflight maintenance memvalidasi pasangan `source`, ID kompetisi, dan URL untuk IBF maupun IBL melalui helper sumber bersama; namespace lain tetap ditolak. Perubahan ini tidak menjalankan penghapusan audit Neon. Migrasi `0007_quiet_polaris` menambah metadata asal perhitungan pada statistik pemain/tim; tidak mengubah kebijakan summary, baseline, atau retensi.
