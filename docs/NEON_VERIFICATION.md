# Verifikasi Neon StatsArena

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
