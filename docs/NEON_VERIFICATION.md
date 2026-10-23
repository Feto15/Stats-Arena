# Verifikasi Neon StatsArena

## Riau dan pengujian penambahan final — 18 Oktober 2026

Riau `49610`/`49611` sebelumnya hanya tersedia sebagai dry-run/cache dan belum ada di Neon. Baseline 10 putri/30 putra diparse ulang dari HTML asli dengan parser `0.2.5`, kemudian diimpor dengan lock/lease/transaksi sebelum benchmark. Cache aktif lima resource kedua final dinonaktifkan; blob audit tetap dipertahankan. Tidak ada data final Neon yang dihapus, migrasi, atau perubahan schema.

Incremental menemukan satu final baru per kompetisi dan melewati seluruh 40 laga lama. Waktu awal putri 97,62 detik dan putra 98,01 detik; pipeline HTML sekitar 90 detik, importer Neon 3–4 detik. Putri sempat mendapat HTTP 500 pada box score/chart, kemudian pulih lewat retry 29,80 detik. Retry putra 54,44 detik masih menerima template PBP kosong; varian URL tanpa tanda tanya juga memberi hash yang sama.

Query akhir: putri 11 complete/11 detail parsed; putra 31 complete/30 detail parsed. Final putra `2942223` masih memiliki kategori PBP `parse_failed` dengan cooldown satu jam, meskipun hasil pertandingan dan dataset lainnya tersedia. Final putri `2942222` memiliki 23 baris pemain/573 PBP/99 shots; final putra 24 baris pemain/126 shots. Kedua final memiliki LiveStats ready. Fingerprint seluruh isi statistik pemain/tim, PBP, shots, dan LiveStats 40 laga lama identik sebelum/sesudah; tidak ada lease tertinggal. Tabel klasemen kosong masih menyebabkan status run partial; dua perbedaan LiveStats pada laga lama tetap tercatat.

Bukti, durasi persiapan yang dipisahkan dari benchmark, batas hasil, dan saran optimasi ada di [laporan Riau](./INGEST_PERFORMANCE_RIAU_2026-10-18.md), dengan hasil terstruktur `ingest/audit/riau-profile-2026-10-18/performance-summary.json`. Pengukuran ini tidak mengubah kebijakan timeout, parser, importer, atau schema produksi.

Pengulangan incremental sesudah pemulihan memerlukan 22,06 detik putri dan 9,81 detik putra. Keduanya memilih nol detail dan menulis nol pertandingan/statistik/PBP/shots/metrik/LiveStats; final putra tetap berada dalam cooldown PBP satu jam. Jumlah dan fingerprint data diperiksa kembali sesudah pengulangan; audit operasional tetap bertambah sesuai desain.

## Jakarta South dan profiling — 17 Oktober 2026

Sinkronisasi ulang IBF `49626` dan `49633` memakai cache yang ada; tanpa penghapusan dan tanpa migrasi. Putri: 15 laga selesai, 14 detail parsed, 352 statistik pemain, 6.952 PBP, 1.190 shots, dan 15 LiveStats ready. Putra: 35 laga selesai, 35 detail parsed setelah recovery PBP `2931413`, 811 statistik pemain, 15.800 PBP, 3.049 shots, dan 35 LiveStats ready.

PBP putra yang timeout pulih dan diimpor; kualitasnya kini parsed dengan 507 event. Putri `2940102` tetap partial pada dataset PBP karena sumber terakhir tidak memuat event; 658 event lama dipertahankan. Tabel standings kedua kompetisi memiliki header tetapi tidak memiliki baris/tautan grup, sehingga run akhir masih partial. Tidak ada lease tertinggal. Semua laga kedua kompetisi kini memakai parser `0.2.5`; pemeriksaan selector terhadap fixture tersimpan akhir tidak memilih ulang detail pada waktu pemeriksaan.

Profiling membuktikan dua interval sleep Mac berjumlah 19 menit 6 detik pada run putri yang semula berlangsung 27 menit 31 detik. Pengulangan putri memerlukan 36,39 detik; impor putra sesudah dry-run 173,40 detik, dengan persiapan cache sebelumnya 527,71 detik. Recovery lanjutan dan biaya SELECT per laga dibahas terpisah. Bukti query/timing ada di `ingest/audit/sync-performance-2026-10-17.json`; lihat [laporan pengukuran dan saran optimasi](./INGEST_PERFORMANCE_2026-10-17.md). Lint berkas terkait, typecheck/build ingest, serta 15 test operasi/katalog/service lulus; ini bukan pemeriksaan ulang seluruh dashboard.

Verifikasi awal dilakukan 7 Oktober 2026 untuk migrasi/impor `49607`; diperbarui 8 Oktober 2026 setelah impor kompetisi kedua, integrasi dashboard Tahap 4, dan data rinci Tahap 5. Semua koneksi memakai `.env` StatsArena.

## Hasil awal Tahap 2, 7 Oktober 2026

Dua migrasi tercatat pada jurnal Neon. Terdapat 14 tabel aplikasi serta tabel jurnal migrasi. Kolom `minutes` pemain dan tim bertipe `double precision`; seluruh 27 foreign key valid. SQL awal memakai `CREATE SCHEMA IF NOT EXISTS` agar sesuai dengan pembuatan schema jurnal oleh Drizzle.

HTML publik diambil ulang dan seluruh halaman untuk 32 laga selesai berhasil diparse setelah retry terarah. Dataset dry-run dibekukan, lalu diimpor dua kali menggunakan importer produksi dan transaksi `postgres.js`. Jumlah berikut dihitung kembali melalui query Neon dengan scope kompetisi `49607`.

| Record logis | Impor pertama | Impor kedua |
| --- | ---: | ---: |
| Kompetisi | 1 | 1 |
| Tim kompetisi | 27 | 27 |
| Pemain kompetisi | 322 | 322 |
| Grup | 9 | 9 |
| Klasemen grup | 27 | 27 |
| Pertandingan | 34 | 34 |
| Statistik pemain | 761 | 761 |
| Total tim | 64 | 64 |
| Roster yang dibuktikan box score | 322 | 322 |

Tidak ada laga gagal ditulis pada kedua impor. Record run, metadata fetch, dan isu bertambah sesuai desain audit; record logis tidak bertambah pada impor ulang.

## Pemeriksaan data

- Laga `2931666`: skor home/away 25–45; FGA 41–40; total poin tim cocok dengan skor.
- Sembilan grup masing-masing memiliki tiga tim. Grup A memakai pool `9`, Grup B memakai pool `7`.
- Tidak ada perbedaan durasi pemain terhadap `minutes_raw` berformat `MM:SS` dengan toleransi numerik `1e-9` menit.
- Semua foreign key tervalidasi; tipe kolom durasi dan jumlah tabel cocok dengan schema aplikasi.
- Test lokal tetap lulus: 19 test, lint, typecheck, dan build. Test migrasi memakai migrator Drizzle yang sebenarnya dan memeriksa jurnal setelah migrasi diulang.

## Isu historis pada impor awal

Dua fixture berstatus `scheduled` (`2934790`, `2934794`) disimpan tanpa summary/box score. Empat kegagalan fetch untuk URL kedua laga tersebut dan dua isu info skor belum tersedia tetap dicatat. Status run awal `partial` mencerminkan isu sumber tersebut; seluruh 32 laga selesai memiliki summary/box score lengkap dan tidak ada kegagalan penulisan database.

Pada saat verifikasi awal 7 Oktober, kompetisi kedua `49609` baru diuji pada parser lokal dan belum diimpor ke Neon. Verifikasi awal ini mencakup data inti; play by play, shot chart, dan BP/2CP tetap berada pada tahap berikutnya.

## Bukti lokal

- [Input dry-run yang dipakai untuk kedua impor](../ingest/audit/49607-neon-verification-dry-run.json).
- [Hasil perbandingan dan pemeriksaan database](../ingest/audit/49607-neon-verification.json).

Audit dan snapshot kerja berada di direktori yang diabaikan Git. Nilai kredensial tidak dicantumkan dalam laporan ini.

## Optimasi impor ulang, versi 0.1.2

Verifikasi versi akhir pada 7 Oktober 2026 memakai snapshot HTML yang sama untuk statistik 32 laga selesai, serta dua fixture terjadwal. Tidak ada pengambilan HTML live pada pengukuran ini. Tidak ada perubahan schema sehingga tidak diperlukan migrasi tambahan.

| Pemeriksaan | Impor ulang pertama | Impor ulang kedua |
| --- | ---: | ---: |
| Waktu importer versi akhir | 14.990 detik | 14.877 detik |
| Status run | `succeeded` | `succeeded` |
| Laga lengkap tidak berubah | 32 | 32 |
| Laga terjadwal | 2 | 2 |
| Baris statistik pemain ditulis | 0 | 0 |
| Baris total tim ditulis | 0 | 0 |
| Statistik pemain tetap tersedia | 761 | 761 |
| Total tim tetap tersedia | 64 | 64 |
| Laga gagal ditulis | 0 | 0 |

Waktu kedua run awal pada jurnal Neon adalah 527.236 dan 604.456 detik (sekitar 8 menit 47 detik dan 10 menit 4 detik). Angka terbaru mengukur importer produksi sampai finalisasi run, termasuk batch identitas/audit/klasemen, pemeriksaan statistik, dan lock transaksi per laga. Ini menunjukkan biaya impor ulang data lengkap yang tidak berubah; waktu impor pertama ke database kosong serta kecepatan pengambilan HTML live belum diukur dengan versi baru. Metadata fetch juga berubah dari 93 pada verifikasi awal menjadi 77 snapshot sukses pada verifikasi baru.

Identitas serta timestamp seluruh 825 baris statistik tim/pemain tidak berubah, dibuktikan dengan digest sebelum/sesudah kedua impor. Jumlah record logis kompetisi tetap 27 tim, 322 pemain, 9 grup, 27 klasemen, dan 34 laga. Metadata sumber dan histori run baru tetap disimpan sesuai desain.

Laga terjadwal `2934790` dan `2934794` tidak diminta summary/box score-nya. Run baru memiliki `readyGames=32`, `scheduledGames=2`, serta nol fetch gagal, box score parsial, parser gagal, dan kegagalan transaksi. Dua isu info skor belum tersedia tetap tercatat dan tidak menjadikan run parsial. Error pada run awal dipertahankan sebagai histori, bukan dihapus atau diturunkan severity-nya.

Seluruh 23 test lokal, lint, typecheck, dan build lulus. Test PGlite membuktikan penulisan statistik per batch, data lebih dari 250 pemain, fallback identitas saat registri kosong, pembaruan nilai, rollback, dan perlindungan statistik parsial. Pada Neon, verifikasi optimasi ini menguji jalur impor ulang tanpa perubahan statistik; pembaruan statistik melalui batch telah diuji lokal.

Bukti tambahan:

- [Dry-run snapshot versi baru](../ingest/audit/49607-batch-dry-run.json).
- [Perbandingan Neon serta durasi kedua run](../ingest/audit/49607-batch-verification.json).
- [Dry-run sampel kompetisi 49609](../ingest/audit/49609-batch-dry-run.json): pada saat pengujian parser lokal, struktur tetap sama, 18 tim, 213 pemain, enam grup, 18 klasemen, dan sampel 24 baris pemain/dua totals. Kompetisi kedua kemudian diimpor ke Neon pada 8 Oktober.

## Update Tahap 4: kompetisi kedua dan dashboard

Pada 8 Oktober 2026, kompetisi `49609` diperiksa pada URL sumber berikut, diimpor ke schema `statsarena` menggunakan CLI StatsArena, lalu diimpor ulang dengan input yang sama:

`https://hosted.dcd.shared.geniussports.com/IBF/en/competition/49609`

| Record logis dalam `49609` | Setelah impor | Setelah impor ulang |
| --- | ---: | ---: |
| Tim kompetisi | 18 | 18 |
| Pemain kompetisi | 213 | 213 |
| Grup | 6 | 6 |
| Klasemen grup | 18 | 18 |
| Pertandingan | 24 | 24 |
| Statistik pemain | 514 | 514 |
| Total tim | 44 | 44 |
| Bukti roster | 212 | 212 |

Run impor ulang melaporkan 0 statistik pemain dan 0 statistik tim ditulis, serta 22 box score tidak berubah. Dua laga terjadwal tetap disimpan tanpa statistik nol. Query Neon sesudah impor ulang menunjukkan jumlah entitas logis tidak bertambah. Tidak ada migrasi schema pada Tahap 4.

Dashboard query server-only kemudian diuji langsung terhadap kedua kompetisi. `49607` menampilkan 34 pertandingan (32 selesai dan 2 terjadwal), 27 tim, 322 pemain, dan 9 grup; `49609` menampilkan 24 pertandingan (22 selesai dan 2 terjadwal), 18 tim, 213 pemain, dan 6 grup. Detail laga `2931666` tetap memiliki skor 25–45 dan FGA 41–40. Isolasi query, klasemen grup, detail tim/pemain, tautan sumber, Review, dan impor ulang juga tercakup dalam test lokal PGlite dan pemeriksaan browser; rinciannya ada di [panduan dashboard](./DASHBOARD.md).

Dashboard Tahap 4 selesai. Rincian data rinci dan UI Tahap 5 dicatat berikut ini; operasi terjadwal tetap Tahap 6.

## Update Tahap 5: event, tembakan, dan metrik resmi

Pada 8 Oktober 2026, migrasi `0002_match_details` diterapkan ke Neon StatsArena setelah dry-run. Schema akhir memiliki 17 tabel aplikasi, 18 tabel PostgreSQL termasuk jurnal migrasi, 39 foreign key valid, dan 3 migrasi tercatat. Semua jumlah berikut dibaca ulang dari Neon setelah impor ulang final; `49607` berubah sejak snapshot parser awal karena dua pertandingan yang sebelumnya scheduled telah menjadi complete.

Kompetisi kedua yang dipakai adalah [49609 — (F) DBL DI JOGJAKARTA SERIES](https://hosted.dcd.shared.geniussports.com/IBF/en/competition/49609).

| Record logis | `49607` | `49609` |
| --- | ---: | ---: |
| Tim kompetisi | 27 | 18 |
| Pemain kompetisi | 322 | 213 |
| Grup / klasemen | 9 / 27 | 6 / 18 |
| Games (complete / scheduled) | 34 (34 / 0) | 24 (22 / 2) |
| Statistik pemain / total tim | 809 / 68 | 514 / 44 |
| Play-by-play events | 15,455 | 9,853 |
| Shots | 3,018 | 1,702 |
| Metrik resmi scope pertandingan | 136 | 88 |
| Metrik resmi scope kompetisi | 54 | 36 |

Pada pertandingan `2931666`, Neon memuat skor 25–45, total FGA 81 dari dua tim (41/40), total FGM 24 (9/15), 81 marker shots, dan 24 made. Total chart dan box score cocok pada snapshot fixture yang digunakan.

Dry-run final `49607` membaca 27 tim, 322 pemain, 9 grup, 34 games, 809 statistik pemain, 68 total tim, 15,455 events, 3,018 shots, 136 metrik pertandingan, dan 54 metrik kompetisi tanpa fetch/parse gagal. Dry-run final `49609` membaca 18 tim, 213 pemain, 6 grup, 24 games (22 complete dan 2 scheduled), 514 statistik pemain, 44 total tim, 9,853 events, 1,702 shots, 88 metrik pertandingan, dan 36 metrik kompetisi tanpa fetch/parse gagal. Percobaan fetch awal `49609` sempat gagal pada 14 URL; retry/pengambilan ulang berhasil dan audit final bersih. Histori percobaan lama tetap tersimpan.

Dataset dry-run yang sama diimpor pada tiap kompetisi lalu diimpor ulang. Audit reimport final mencatat nol penulisan statistik box score, events, shots, dan metrik yang nilainya sama. Query row-count setelah commit membuktikan record logis tidak bertambah. `49607` tidak memiliki laga scheduled pada snapshot impor final; `49609` masih memiliki dua dan tidak memiliki statistik detail palsu untuknya.

Audit final:

- [Dry-run 49607](../ingest/audit/49607-stage5-dry-run.json), [impor 49607](../ingest/audit/49607-stage5-import-1.json), dan [impor ulang 49607](../ingest/audit/49607-stage5-import-2-snapshot.json).
- [Dry-run 49609](../ingest/audit/49609-stage5-live-retry-2.json), [impor 49609](../ingest/audit/49609-stage5-import-recovered.json), dan [impor ulang 49609](../ingest/audit/49609-stage5-import-recovered-2.json).
- Fixture bertanggal dan hash ada di `ingest/test/fixtures/live-2026-10-08/`; audit penuh disimpan lokal dan diabaikan Git.

Parser mencatat empat aksi PBP tanpa teks aksi sebagai isu info, serta dua isu skor belum tersedia untuk fixture scheduled `49609`. Dua pertandingan scheduled tersebut memang belum menyediakan halaman detail. Per pertandingan, sumber menyediakan 2CP bila tersedia tetapi tidak menyediakan BP; BP dan 2CP kompetisi dibaca terpisah dari Team Statistics. Nilai itu tidak dihitung dari box score. Koordinat chart disimpan sebagai persentase kanvas sumber; orientasi lapangan tidak diketahui dan tidak dirotasi.

Verifikasi lokal final: lint, typecheck, 46 test (44 ingest dan 2 dashboard), build. Browser memeriksa kedua kompetisi, filter detail, satu laga scheduled tanpa nilai nol palsu, tampilan desktop 1440×1000 dan mobile 390×844, keyboard, dan log browser tanpa error/warning. Rincian UI ada di [panduan dashboard](./DASHBOARD.md).

## Percobaan awal Tahap 6: verifikasi tertunda

Tahap 6 menambahkan tabel `sync_runs`, `sync_leases`, dan provenance `source_fetched_at` melalui migrasi lokal `0003_sync_operations`. Test migrator Drizzle/PGlite, lease, transaksi guard, idempotensi lokal, runner, retry terarah, serta dua kompetisi lolos. Namun migrasi itu belum diterapkan ke Neon dan dataset Tahap 6 belum diimpor ulang.

Pada percobaan awal 8 Oktober 2026, kedua variabel koneksi ada di environment StatsArena. Pemeriksaan koneksi pooled berhenti pada resolusi DNS endpoint Neon (`ENOTFOUND`) sebelum query read-only metadata/kompetisi dapat dijalankan; koneksi direct untuk migrasi juga tidak digunakan. Percobaan tersebut tidak melakukan migrasi atau penulisan/import Neon. Dry-run snapshot dan PGlite adalah bukti lokal.

## Perbaikan review Tahap 6, parser 0.2.2

Preflight read-only pada akses jaringan yang diizinkan berhasil memeriksa koneksi pooled dan direct. Keduanya menunjuk target StatsArena yang sama; kegagalan `ENOTFOUND` sebelumnya terjadi dalam lingkungan jaringan terbatas. Sebelum migrasi, Neon memiliki 18 tabel termasuk jurnal, 39 foreign key, dan tiga migrasi. Jumlah record basket pada dua kompetisi sesuai hasil Tahap 5.

Migrasi `0003_sync_operations` berhasil diterapkan pada 8 Oktober 2026. Query sesudah migrasi memastikan 20 tabel termasuk jurnal (19 tabel aplikasi), 41 foreign key, dan empat migrasi. Seluruh jumlah record logis basket sama dengan sebelum migrasi. Overview lokal berhasil membaca data kompetisi dan menampilkan keadaan belum ada run operasional setelah schema baru tersedia.

Bukti read-only: [jumlah sebelum migrasi](../ingest/audit/stage6-before-counts.json) dan [jumlah sesudah migrasi](../ingest/audit/stage6-migrated-counts.json).

Dry-run live memakai parser `0.2.2` pada kedua kompetisi, termasuk halaman `/schedule` tanpa query. 49607 membaca 185 halaman dalam sekitar 466,6 detik dengan lima timeout yang pulih; 49609 membaca 122 halaman dalam sekitar 384,3 detik dengan sepuluh timeout yang pulih. Hasil akhir tidak memiliki fetch gagal, parse gagal, atau halaman partial. Isu fixture yang identik dari root dan schedule kemudian dideduplikasi pada kode akhir; data basket tidak berubah.

Setelah itu dua siklus `runner once` mengimpor kedua kompetisi. TTL diperpanjang menjadi tujuh hari hanya pada proses verifikasi agar input HTML tetap sama; setiap siklus memakai 185/122 cache hit tanpa HTTP baru. Hash HTML per URL dari kedua siklus sama, seluruh record basket hasil parse sama, dan query Neon sebelum migrasi, setelah impor, serta setelah impor ulang menunjukkan jumlah berikut tetap stabil:

| Record logis | `49607` | `49609` |
| --- | ---: | ---: |
| Tim / pemain | 27 / 322 | 18 / 213 |
| Grup / klasemen | 9 / 27 | 6 / 18 |
| Pertandingan | 34 | 24 |
| Statistik pemain / tim | 809 / 68 | 514 / 44 |
| Event PBP / tembakan | 15.455 / 3.018 | 9.853 / 1.702 |
| Metrik laga / kompetisi | 136 / 54 | 88 / 36 |

Impor pertama memperbarui versi parser pada dataset rinci: 34 laga complete pada 49607 dan 22 pada 49609. Box score pemain/tim tidak ditulis ulang. Impor kedua mencatat **nol** penulisan statistik pemain/tim, event, shots, metrik laga/kompetisi, serta nol laga baru/diperbarui. Durasi importer ulang adalah 43,263 detik dan 27,621 detik. Histori run/fetch/isu baru memang bertambah; record aplikasi basket tetap stabil. Pemeriksaan identitas input mengecualikan diagnostik tingkat kompetisi yang dideduplikasi pada kode akhir; seluruh record statistik dan hash HTML sumber ikut dibandingkan.

Kedua run operasional terakhir berstatus `succeeded`, failure count nol, page count 185/122, dan tidak meninggalkan lease aktif. Overview browser memuat data scope kompetisi serta menampilkan status berjalan saat impor dan berhasil setelah commit. Log browser yang diperiksa tidak memiliki warning/error. Dua laga 49609 tetap scheduled tanpa statistik detail palsu. Isu info akhir adalah lima event tanpa teks pada 49607, serta empat event tanpa teks dan dua skor scheduled pada 49609; tidak ada review manual baru yang menghalangi impor.

Kode akhir lulus lint, typecheck, build, dan 64 test (62 ingest, dua dashboard). Regresi lokal membuktikan final di halaman lanjutan ditemukan oleh proses berikutnya saat batas dua halaman tercapai, hash data cocok dengan pass refresh, batas sampel tetap dipakai, dan audit tetap membawa URL gagal bila importer terhenti. TTL bawaan serta `.env` tidak diubah. Layanan `runner watch` belum diaktifkan secara permanen.

Pemeriksaan workspace akhir memakai Node.js 26.7.0 dan pnpm 12.9.1 sesuai `packageManager`; Node memenuhi minimum proyek 22.19. Tidak ada perubahan dependency atau lockfile dalam perbaikan ini.

Bukti akhir:

- [Impor 49607](../ingest/audit/49607-sync-2026-10-08T06-06-08-994Z.json) dan [impor ulang 49607](../ingest/audit/49607-sync-2026-10-08T06-10-43-618Z.json).
- [Impor 49609](../ingest/audit/49609-sync-2026-10-08T06-07-46-017Z.json) dan [impor ulang 49609](../ingest/audit/49609-sync-2026-10-08T06-11-54-844Z.json).
- [Query Neon setelah impor](../ingest/audit/stage6-initial-counts.json), [setelah impor ulang](../ingest/audit/stage6-after-counts.json), dan [perbandingan input serta idempotensi](../ingest/audit/stage6-idempotency-verification.json).

## Mode incremental — 10 Oktober 2026

Preflight read-only memastikan pooled/direct mengarah ke target StatsArena yang sama. Migrasi `0004_incremental_sync` berhasil, sehingga jurnal kini memuat lima migrasi. Empat kolom penanda ditambahkan pada `games`; tidak ada tabel, relasi, atau statistik basket yang dihapus. Dry-run incremental pertama membaca state lama yang belum memiliki hash, memakai cache HTML tervalidasi hasil pembaruan live 10 Oktober, dan mengambil ulang hanya root/schedule (dua HTTP per kompetisi). TTL cache diperpanjang sementara hanya pada proses bootstrap, tanpa mengubah `.env` atau kebijakan default. Bootstrap nyata menulis penanda pada 35/25 laga dan **nol** statistik/detail.

Setelah baseline tersedia, dry-run dengan konfigurasi normal melewati seluruh 60 laga. Yang tetap dibaca adalah 15 halaman fixture/metadata putra dan 12 putri, dibanding 185/132 halaman pada sinkronisasi penuh. Tidak ada summary, box score, PBP, shot chart, atau Team Analysis pertandingan yang diminta atau dibaca dari cache. Durasi dry-run sekitar 49,4 + 60,5 detik, termasuk satu timeout putri yang pulih otomatis; metadata klasemen saat itu melewati TTL.

Dua siklus impor incremental normal berstatus `succeeded`, dengan nol penulisan statistik/detail dan nol laga baru/diperbarui karena fixture tidak berubah. Siklus pertama sekitar **16,5 detik** untuk kedua kompetisi dengan cache metadata segar; pengulangan sekitar **65,5 detik** dengan metadata kedaluwarsa dan tiga timeout yang pulih. Ini pengukuran kondisi tersebut, bukan jaminan durasi saat pertandingan baru/berubah muncul.

Query read-only setelah kedua siklus memastikan lease aktif nol, 60 hash fixture dan penanda valid tersimpan, serta jumlah sebelum/sesudah berikut tetap sama:

| Record logis | Putra `49607` | Putri `49609` |
| --- | ---: | ---: |
| Pertandingan | 35 | 25 |
| Statistik pemain / tim | 809 / 68 | 561 / 48 |
| Event PBP / tembakan | 15.455 / 3.018 | 11.308 / 1.965 |

Pemeriksaan workspace lulus 68 test (66 ingest, dua dashboard), lint, typecheck, dan build. Test incremental dengan fixture nyata/PGlite mencakup playoff yang muncul pada tautan jadwal, scheduled menjadi complete, fixture venue berubah sementara summary tetap berbeda, detail lama dengan cache kedaluwarsa dilewati, dry-run tidak memajukan state, scope kompetisi, retry hanya URL target, perlindungan PBP yang berkurang, pemulihan partial, kegagalan koneksi sebelum hasil importer tersedia, dan rollback constraint yang membuat laga tetap eligible retry. Sinkronisasi standar tetap diperlukan untuk koreksi detail tanpa perubahan fixture.

Bukti operasi lokal:

- [Sebelum migrasi](../ingest/audit/incremental-2026-10-10-before.json), [baseline](../ingest/audit/incremental-2026-10-10-baseline.json), dan [query setelah pengulangan](../ingest/audit/incremental-2026-10-10-after.json).
- Bootstrap: [putra](../ingest/audit/49607-sync-2026-10-09T19-35-55-235Z.json), [putri](../ingest/audit/49609-sync-2026-10-09T19-36-53-107Z.json).
- Dry-run normal: [putra](../ingest/audit/49607-sync-2026-10-09T19-38-17-160Z.json), [putri](../ingest/audit/49609-sync-2026-10-09T19-39-06-594Z.json).
- Impor normal: [putra](../ingest/audit/49607-sync-2026-10-09T19-40-23-151Z.json), [putri](../ingest/audit/49609-sync-2026-10-09T19-40-32-220Z.json).
- Pengulangan normal: [putra](../ingest/audit/49607-sync-2026-10-09T19-41-40-566Z.json), [putri](../ingest/audit/49609-sync-2026-10-09T19-42-12-871Z.json).

Waktu pada nama audit adalah UTC; tanggal laporan mengikuti waktu lokal 10 Oktober 2026. Runner berkala belum dipasang sebagai layanan permanen. Perintah dan batas mode dijelaskan di [panduan sinkronisasi](./SYNC_OPERATIONS.md#mode-incremental-hanya-detail-laga-baru-atau-berubah).

## Efisiensi audit dan metadata — 12 Oktober 2026

Migrasi `0005_massive_unicorn` berhasil diterapkan setelah pooled/direct dipastikan menunjuk target StatsArena yang sama. Dua siklus runner membaca input cache identik untuk kedua kompetisi. Baseline menambah 190/137 fetch audit; siklus kedua menyimpan summary dengan nol fetch audit baru, nol isu duplikat, dan nol penulisan statistik/detail, metadata, atau klasemen. Waktu importer turun dari 36,625/27,200 detik menjadi 1,012/0,825 detik; ini pengukuran cache, bukan fetch live.

Jumlah serta fingerprint ID sembilan tabel data tetap sama. Total gabungan tetap 60 laga, 1.418 statistik pemain, 120 statistik tim, 28.235 event, 5.254 shots, dan 330 metrik resmi. Setelah dua siklus terdapat 33 import run, 18 sync run, 3.173 fetch audit, 140 isu, enam migrasi, dan nol lease aktif. Dashboard tetap membaca lima isu info per kompetisi dari baseline dan waktu konten HTML asli. Histori audit Neon tidak dihapus.

Seluruh 80 test, lint, typecheck, dan build lulus. Aturan summary, observasi harian, batas pengukuran, serta lokasi bukti lokal ada di [efisiensi Neon](./NEON_EFFICIENCY.md).

### Pembersihan audit lama

Maintenance eksplisit pada 12 Oktober 2026 menghapus 1.741 fetch audit sukses yang sudah tergantikan dan tidak dirujuk (1.098 putra, 643 putri). Jumlah fetch turun 3.173 → 1.432. Seluruh isi 14 tabel domain dibandingkan sebelum/sesudah dalam transaksi dan tetap sama; import run tetap 33, sync run 18, dan isu review 140. Backup dibuat sebelum commit. Tiga test maintenance, lint terarah, typecheck, dan build ingest lulus. Laporan serta aturan perlindungan ada di [pembersihan Neon](./NEON_EFFICIENCY.md#pembersihan-audit-lama--12-oktober-2026).

## Kelengkapan dataset dan retry — 13 Oktober 2026

Migrasi `0006_magenta_khan` menambah `games.detail_quality`; jurnal Neon kini memiliki tujuh migrasi. Target pooled/direct diverifikasi sama dan tidak ada lease/run aktif sebelum perubahan. Preview backfill menemukan 152 pertandingan tanpa metadata; penulisan mengisi 152, pengulangan menghasilkan nol pembaruan. Operasi ini menggunakan observasi audit tersimpan dan tidak mengambil HTML.

Fingerprint seluruh isi pertandingan selain kolom baru, 3.454 statistik pemain, 300 statistik tim, 69.677 event PBP, 12.593 shots, 842 metrik resmi, dan 213 isu tetap sama sebelum/sesudah. Angka merupakan keadaan Neon saat backfill, bukan hasil impor ulang kompetisi. [Bukti lokal](../ingest/audit/quality-backfill-2026-10-13.json) dan [aturan status/retry](./DATA_QUALITY.md).

Status hasil pertandingan tetap terpisah dari status tiap dataset. Pada `2923393`, box score/PBP lengkap dan chart parsial karena ID pemain invalid. Pada `2931287`, chart parsial karena 35 marker dibanding FGA 36. UI desktop/ponsel serta Review diperiksa menggunakan Neon; statistik valid tidak diganti dengan nol.

Seluruh 93 test, lint, typecheck, dan build lulus. Pengujian lokal mencakup transaksi/rollback, backfill idempoten, writer aktif, jeda incremental dan override manual/fixture/parser; hasil Neon di atas khusus migrasi serta backfill metadata.

## Dukungan IBL dan provenance 2P — 16 Oktober 2026

Preflight pooled/direct menunjuk 22 kompetisi StatsArena yang sama, dengan seluruh identitas URL/source cocok serta nol lease/run aktif. Migrasi `0007_quiet_polaris` diterapkan; jurnal menjadi delapan migrasi. Dua kolom `stat_derivations` JSON ditambahkan tanpa perubahan angka statistik. Seluruh isi 14 tabel domain dibandingkan dengan fingerprint sebelum/sesudah, mengabaikan hanya kolom baru: identik. Bukti lokal: `ingest/audit/ibl-schema-2026-10-16.json`.

Tidak ada impor kompetisi IBL atau perubahan daftar aktif runner pada pekerjaan ini. Idempotensi, collision ID IBF/IBL, lease, incremental, provenance 2P, dan dashboard diuji menggunakan PGlite. Dry-run HTML IBL tidak membuktikan impor IBL di Neon; sepuluh tab round kosong tetap parsial. Rincian sampel: [SUMBER_DATA_IBL.md](./SUMBER_DATA_IBL.md).
# Pelengkap LiveStats dan backfill — 16 Oktober 2026

Target pooled/direct diperiksa read-only dan terbukti memuat dataset StatsArena yang sama. Migrasi aditif `0008_stiff_blockbuster` diterapkan; tabel `game_livestats` menyimpan tambahan secara terpisah. Fingerprint seluruh isi 14 tabel domain portal direkam sebelum pekerjaan dan dibandingkan setelah backfill serta pengulangan: **semuanya tetap sama**, termasuk skor, identitas, statistik, PBP, shots, klasemen, dan metrik resmi portal.

Dry-run awal pada 23 kompetisi tersimpan membaca 384 laga: 382 eligible dan dua scheduled dilewati. Pemetaan ketat menemukan 338 laga cocok penuh serta 44 laga dengan perbedaan. Implementasi kemudian mempertahankan baris/tim yang lolos verifikasi tanpa memaksakan baris yang berbeda.

| Status tambahan di Neon | Laga | Baris pemain–laga | Baris tim–laga |
|---|---:|---:|---:|
| ready | 338 | 7.843 | 676 |
| partial | 42 | 803 | 72 |
| mismatch, payload baru ditahan | 2 | 0 | 0 |
| scheduled, tidak diminta | 2 | 0 | 0 |

Total: **380 laga mendapat tambahan**, **8.646 baris pemain–laga** dan **748 baris tim–laga**, dengan 382 record status LiveStats unik. Angka pemain–laga bukan jumlah pemain unik. Tidak ada kompetisi atau laga baru yang dibuat oleh backfill; daftar berasal dari Neon yang sudah ada, termasuk IBL 42041 yang ditemukan sudah berisi 40 laga pada preflight. Ini bukan pendaftaran ulang katalog atau ingest kompetisi baru.

Pemeriksaan akhir setelah kedua forced refresh membuktikan jumlah/ID/payload/updated_at tambahan tetap sama, 14 fingerprint domain portal tetap sama, **380 snapshot unik yang dirujuk masih tersedia dan hash body cocok**, serta tidak ada lease writer aktif. Snapshot tambahan lokal saat pemeriksaan berukuran sekitar 42 MiB; file ini berada di volume snapshot runner, terpisah dari payload tambahan Neon.

Penguatan checkpoint juga diuji: rollback pada refresh data ready tetap eligible tanpa menunggu cooldown lama. Sesudah commit, checkpoint pending dibersihkan; forced refresh terbaru 2931666 di Neon kembali menghasilkan nol penulisan ulang payload.

Dua payload yang ditahan:

- `49403 / 2923408`: box score portal tersimpan belum cukup lengkap untuk pemetaan yang aman.
- `IBL:42041 / 2704751`: skor portal 55–65 berbeda dari JSON LiveStats 0–0. Tidak diasumsikan bahwa laga belum dimainkan; tambahan ditahan untuk review.

Sebanyak 42 partial adalah perbedaan roster/pemetaan nama/nomor/statistik dasar. Baris yang terverifikasi tetap disimpan; baris meragukan tidak diberi angka nol atau dipasangkan paksa. Ini bukan klaim bahwa semua perbedaan berasal dari kesalahan situs; perlu bukti tambahan untuk menyelesaikannya. Tidak ada fetch_failed, parse_failed, atau unavailable pada backfill nyata ini. Status kualitas portal tidak diubah oleh status tambahan.

Backfill penulisan selesai sekitar **194,9 detik**. Pengulangan seluruh 23 kompetisi selesai sekitar **11,0 detik**, memilih nol laga dan menulis nol payload. Pengambilan ulang paksa dari sumber untuk `2931666` (putra) dan `2915281` (putri) masing-masing menghasilkan satu payload identik dan nol penulisan ulang. Jumlah record, ID, payload, dan updated_at diverifikasi dengan fingerprint. Log/audit lokal terpisah tersedia pada `ingest/audit/*-livestats-*.json`; baseline dan hasil verifikasi bertanggal memakai prefix `livestats-`.

Pemeriksaan lokal: lint, typecheck, build, 104 test workspace, dan satu tambahan regresi retensi snapshot lulus (regresi terbaru dijalankan bersama 15 test terkait). Fixture mencakup DBL putra/putri dan IBL. Test membuktikan dry-run tidak menulis Neon, impor idempoten, rollback, namespace, penolakan pemetaan ambigu, data lama tetap ada saat 403, nol/null, batas respons, retry, cache rusak, serta perlindungan hash snapshot.

Dashboard production lokal dijalankan ulang pada loopback dan diperiksa melalui browser: laga putra 2931666, putri 2915281, serta partial 2923393. Plus/minus, starter, BP/2CP, nol eksplisit, dan alasan review tampil. Lebar halaman ponsel 390 px tetap 390 px; tabel dapat bergulir di dalam kontainernya. Log browser yang diperiksa tidak memuat warning/error. Tidak ada deployment VPS/Vercel dalam pekerjaan ini. Panduan: [LIVESTATS.md](./LIVESTATS.md).

## Review LiveStats — 16 Oktober 2026

Halaman Review kini menggabungkan histori isu portal dengan isu aktif LiveStats dari record tambahan terbaru. Filter sumber, severity, jenis isu, dan pagination diterapkan dalam scope kompetisi. Isu LiveStats yang kembali `ready` hilang dari daftar aktif tanpa menghapus histori portal atau mengubah status hasil pertandingan.

Verifikasi read-only Neon pada tiga sampel menemukan 2 isu LiveStats pada 1 laga `49607`, 16 isu pada 6 laga `49403`, dan 57 isu pada 24 laga `IBL:42041`. Ini jumlah sampel per kompetisi, bukan total seluruh Neon. Laga `2923408` dan `2704751` tetap `complete` dengan tambahan `mismatch`; Review menampilkan perbedaan skor portal 55–65 versus LiveStats 0–0 pada laga kedua.

Lima test dashboard PGlite, lint, typecheck, dan build lulus. Test mencakup isolasi IBF/IBL, filtering, pagination, fallback isu, nol eksplisit, tidak membocorkan path snapshot, serta hilangnya isu aktif setelah status ready. Browser memeriksa filter sumber pada `49403`, pagination dan filter kode pada `IBL:42041`, pembanding nilai, serta tautan detail yang mempertahankan kompetisi. Lebar halaman ponsel 390 px tetap 390 px dan log browser yang diperiksa bersih. Tidak ada migrasi, ingest, atau penulisan Neon pada pekerjaan Review ini.

## Review semua kompetisi — 17 Oktober 2026

Query global read-only menemukan 56 laga unik dengan masalah aktif pada delapan kompetisi: 17 laga dengan masalah portal terkini dan 44 laga dengan tambahan LiveStats non-ready. Lima laga memiliki masalah pada kedua sumber, sehingga 17 + 44 bukan jumlah laga unik. Angka ini adalah keadaan Neon saat verifikasi, bukan hasil sinkronisasi baru. Histori portal yang sudah terselesaikan tidak menjadi sumber daftar aktif; status scheduled dan dataset portal unavailable eksplisit tidak dihitung sebagai masalah.

Enam test dashboard PGlite, lint, typecheck, dan build lulus. Regresi global mencakup beberapa isu/sumber pada satu laga, ID pertandingan/kompetisi numerik sama di IBF/IBL, filtering sebelum pengelompokan/pagination, status tanpa rincian isu, fallback metadata lama, scheduled, histori yang sudah selesai, tidak membocorkan path internal, dan hilangnya laga setelah seluruh masalah pulih. Query tidak mengubah tabel pertandingan.

Browser memverifikasi daftar semua kompetisi, pagination, filter portal (17 laga tanpa isu LiveStats), filter perbedaan skor LiveStats (satu laga), tautan Review kompetisi IBL, tombol kembali ke semua kompetisi, serta pemilihan Jogja yang menghapus scope global. Tata letak diperiksa pada 1440×900 dan 390×844; lebar dokumen ponsel tetap 390 px, tabel bergulir dalam kontainer, dan log browser yang diperiksa bersih. Tidak ada migrasi, ingest, penulisan Neon, atau deployment dalam pekerjaan ini. Dashboard production lokal tetap tersedia di loopback.

### Penjelasan dampak pada Review

Review global dan per kompetisi kini menjelaskan dampak tiap isu berdasarkan aturan penerimaan parser: pemain, tim beserta pemainnya, seluruh tambahan laga, kolom tertentu, kelengkapan roster/starter, atau dataset portal. Histori portal diberi label dampak saat pemeriksaan. Dua test penjelasan dampak menambah total test dashboard menjadi delapan; kedelapannya lulus. Kasus mencakup kegagalan pemetaan, pembaruan gagal, data lama bersyarat, metrik lintas sumber, event tanpa teks, klasemen, GP agregat, serta kode/URL historis yang tidak dikenal. Typecheck, lint, dan build lulus. Ini perubahan penjelasan UI tanpa migrasi atau perubahan data Neon.

Browser memverifikasi dampak pemain/tim/seluruh tambahan pada Review global, tambahan aktif pada Review IBL, serta label histori untuk klasemen portal. Pemeriksaan desktop 1440×900 dan ponsel 390×844 memastikan teks membungkus di kolom yang cukup lebar dan tabel tetap bergulir dalam kontainer; lebar dokumen ponsel 390 px, log browser yang diperiksa bersih.

## Prioritas metrik tim dan backfill portal — 17 Oktober 2026

Pooled/direct diverifikasi menunjuk 23 kompetisi StatsArena yang sama. Tidak ada lease atau sync run aktif. Satu audit impor parser 0.1.1 dari 7 Oktober masih berstatus running tanpa lease/run aktif; audit historis itu tidak diubah. Backfill menolak writer berlease/run aktif tanpa batas umur, serta audit impor running dalam 24 jam terakhir.

Parser portal `0.2.5` menambahkan PIP/PFT/FBP laga berdasarkan header Team Analysis. Adapter LiveStats `1.0.1` membandingkan kelima metrik BP/2CP/PIP/PFT/FBP, dengan expected/actual pada konflik. Tidak diperlukan migrasi: kode metrik di Neon adalah teks, dan dataset kompetisi tetap BP/2CP.

Dry-run `metrics backfill` memeriksa 382 laga non-scheduled dan menemukan 341 laga yang dapat diisi dari snapshot dengan hash yang cocok dengan observasi analysis terbaru di Neon. Commit menambahkan **2.046 record**, masing-masing 682 PIP, PFT, dan FBP. Dua kali eksekusi commit menghasilkan 2.046 lalu **nol** penulisan; tidak ada pembaruan isu LiveStats karena angka pada baris terverifikasi cocok. BP dan 2CP laga tetap masing-masing 682 record; BP/2CP kompetisi tetap masing-masing 338 record.

Sebanyak 41 laga dilewati karena tidak ada observasi analysis lengkap yang dapat dipakai: 40 laga `IBL:42041` dan satu laga `50122 / 2923233`. Backfill tidak mengambil ulang sumber, memperbaiki error halaman lama, atau menganggap nilai yang hilang sebagai nol. Dashboard memakai LiveStats per tim/per metrik bila portal tidak tersedia dan payload terverifikasi ada; bila keduanya kosong tampil `—`.

Fingerprint seluruh isi **13 tabel domain selain tabel metrik** identik sebelum/sesudah, termasuk skor, identitas, box score, PBP, shots dan klasemen. Payload/provenance LiveStats juga identik. Record metrik baru mempunyai FK fetch, URL, hash snapshot yang dibuktikan audit, serta versi parser baru. Bukti lokal:

- `ingest/audit/portal-metrics-preflight-2026-10-17.json`
- `ingest/audit/portal-metrics-backfill-2026-10-17T06-26-00-095Z.json` (dry-run)
- `ingest/audit/portal-metrics-backfill-2026-10-17T06-28-20-206Z.json` (commit)
- `ingest/audit/portal-metrics-backfill-2026-10-17T06-29-47-864Z.json` (pengulangan nol)
- `ingest/audit/portal-metrics-verification-2026-10-17.json`

Pemeriksaan mencakup 103 test ingest dan sembilan test dashboard. Satu assertion versi parser lama pada suite IBL ditemukan saat pengujian penuh, diperbaiki memakai konstanta versi, lalu suite IBL/backfill diulang: empat test lulus. Seluruh test lain pada pengujian penuh lulus. Lint, typecheck, build workspace dan build ingest final lulus. Test membuktikan nol portal diprioritaskan, fallback per tim/per metrik, konflik tidak mengganti kedua sumber, isolasi scope kompetisi/laga, FK snapshot, dry-run tanpa penulisan, penolakan writer aktif, rollback dan idempotensi.

Browser memeriksa `49607 / 2931666`: PIP 16–24, PFT 13–22, FBP 5–11 dan 2CP 4–7 berlabel Portal; BP 3–28 berlabel LiveStats. Pada putri `49609 / 2915281`, BP nol tetap nol dan metrik portal memakai sumber Portal. Pada `IBL:42041 / 2697593`, metrik yang tidak tersedia di portal memakai LiveStats. Desktop 1440×900 dan ponsel 390×844 diperiksa; lebar dokumen tetap 390 px, tabel bergulir dalam kontainer, dan log browser bersih. Tidak ada deployment VPS/Vercel pada pekerjaan ini.
