# Cache HTML dan retry StatsArena

Versi parser pada pengukuran cache historis di bawah: `statsarena-parser/0.1.3` (7 Oktober 2026). Versi parser saat ini adalah `statsarena-parser/0.2.2`; runner dan lock operasional dijelaskan di [SYNC_OPERATIONS.md](./SYNC_OPERATIONS.md).

## Alur sinkronisasi

1. Periksa fixture lewat cache singkat atau HTTP bila sudah kedaluwarsa.
2. Lewati halaman statistik untuk fixture `scheduled`.
3. Prioritaskan `live`/`unknown`, serta laga selesai yang belum memiliki checkpoint/konteks yang cocok.
4. Pakai snapshot yang hash-nya valid, hasil parsing-nya lengkap, versi parser cocok, konteks fixture cocok, dan masih dalam TTL. Cache tidak memperbarui timestamp sumber.
5. Ambil halaman yang tidak memenuhi syarat tersebut. Simpan HTTP sukses sebagai snapshot, lalu tandai checkpoint setelah parsing/validasi. Jika proses terhenti, halaman yang sudah valid tersedia pada proses berikutnya.
6. Parse dan validasi kembali setiap HTML yang dipakai, termasuk cache. Error parsing/validasi menonaktifkan checkpoint sukses agar halaman diperiksa ulang.

Cache menggunakan URL penuh sebagai kunci, sehingga kompetisi/grup/parameter pool tidak bercampur. Konteks halaman pertandingan merupakan hash fixture, termasuk ID, status, skor, jadwal mentah, venue, nama, dan URL. Perubahan fixture membuat cache summary/box score diperiksa ulang. Tidak ada tebakan zona waktu untuk menentukan prioritas laga.

## Batas usia default

Kebijakan TTL di bawah berlaku untuk mode standar. Mode `--incremental` mengambil ulang fixture, memilih laga melalui hash fixture/status keberhasilan di Neon, dan melewati detail lama yang valid tanpa membaca cache detail tersebut. Detail baru/berubah/active/retry disegarkan melalui HTTP; bootstrap penanda dan versi parser memakai validasi cache yang sudah ada. TTL metadata kompetisi tetap berlaku. Lihat [mode incremental](./SYNC_OPERATIONS.md#mode-incremental-hanya-detail-laga-baru-atau-berubah).

| Jenis halaman | TTL | Environment opsional |
| --- | --- | --- |
| Kompetisi / Fixtures | 30 detik | `STATSARENA_CACHE_COMPETITION_MS` |
| Teams / Players | 6 jam | `STATSARENA_CACHE_REGISTRY_MS` |
| Standings index / tiap grup | 2 menit | `STATSARENA_CACHE_STANDINGS_MS` |
| Summary / Box Score laga selesai | 24 jam | `STATSARENA_CACHE_COMPLETE_MS` |
| Laga yang baru terlihat selesai atau konteksnya berubah | 60 detik selama 30 menit pertama | `STATSARENA_CACHE_RECENT_COMPLETE_MS` |
| Live / unknown | Selalu HTTP | — |
| Scheduled | Tidak diminta | — |

TTL diukur dari pengambilan/validasi HTTP terakhir, bukan waktu parsing atau pembacaan file. Awal jendela laga selesai dicatat dari waktu sumber saat konteks selesai pertama diamati. Pemeriksaan ulang HTTP pada konteks yang sama tidak terus memperpanjang jendela 30 menit tersebut. Perubahan fixture mengawali konteks baru.

Nilai environment dalam milidetik, antara 0 dan 604800000 (tujuh hari). Nol mematikan pemakaian cache untuk kategori tersebut. TTL laga yang baru selesai memakai nilai terkecil antara TTL lengkap dan TTL terbaru. Batas ini membuat data lama diperiksa ulang dan memberi waktu untuk pembaruan statistik setelah pertandingan berakhir. Koreksi yang tidak mengubah fixture dapat baru terbaca saat TTL statistik habis; gunakan `--refresh` untuk pemeriksaan segera.

## Resume dan pemeriksaan ulang

```sh
# Sinkronisasi normal: gunakan cache valid; ambil halaman gagal/parsial/kedaluwarsa.
pnpm --dir ingest run cli sync --competition 49607 --dry-run

# Jalankan kembali perintah yang sama untuk melanjutkan setelah kegagalan.
pnpm --dir ingest run cli sync --competition 49607 --dry-run

# Periksa semua halaman yang diperlukan lewat HTTP, mengabaikan TTL.
pnpm --dir ingest run cli sync --competition 49607 --dry-run --refresh

# Baca snapshot tanpa jaringan, termasuk untuk revalidasi fixture lama.
pnpm --dir ingest run cli sync --competition 49607 --dry-run --snapshot-only
```

Tidak dibutuhkan file audit lama sebagai input resume. Checkpoint tersimpan di `ingest/snapshots/index.json` sesudah setiap halaman selesai diparse. Resume memakai kembali halaman berhasil **yang masih segar dan konteksnya cocok**; halaman kedaluwarsa/live tetap diperiksa agar perubahan sumber tidak terlewat. Ini bukan jaminan hanya satu URL akan diminta bila seluruh TTL sudah habis.

Pembacaan offline tidak mengubah waktu sumber, tidak menghapus penanda refresh gagal, dan tidak mempromosikan konteks fixture lama yang sudah diketahui menjadi konteks baru. Snapshot lama tanpa informasi checkpoint perlu diparse ulang; `--snapshot-only` dapat memvalidasi snapshot yang sudah tersedia. Versi parser dan konteks disimpan agar perubahan implementasi/fixture tidak diam-diam dianggap sebagai cache yang sama.

`--refresh` tetap menghormati ETag/Last-Modified jika sumber menyediakannya. HTTP 304 merupakan pengecekan jaringan yang mengonfirmasi isi tidak berubah. `--refresh` dan `--snapshot-only` tidak dapat digabung. Scheduled tetap dilewati pada kedua mode.

Runner Tahap 6 mengambil lock direktori snapshot dan lock kompetisi lokal; sinkronisasi terjadwal sebaiknya dijalankan melalui `runner watch`. Perintah CLI manual juga mengambil lock yang sama. Untuk pekerjaan eksplisit dengan direktori snapshot terpisah, gunakan `--snapshot-dir` di dalam `ingest/snapshots/`. Panduan runner, lease Neon, retry terarah, dan penghentian ada di [SYNC_OPERATIONS.md](./SYNC_OPERATIONS.md).

## Retry dan batas jaringan

- Konkurensi default tetap tiga, timeout 20 detik, dan maksimal tiga retry (empat percobaan per URL). Batas respons/redirect/hash/gzip yang sudah ada tetap berlaku.
- Slot jaringan dilepas sebelum backoff; permintaan lain tidak menunggu timer retry URL tersebut.
- Antrean mendahulukan live/unknown serta halaman laga selesai yang belum memiliki checkpoint valid. Urutan record output dan cakupan `--match-limit` tetap mengikuti fixture sumber.
- Request URL yang sama dengan kebijakan cache yang sama dan berlangsung bersamaan digabung menjadi satu pengambilan.
- Retry diterapkan pada HTTP sementara (408/425/429/5xx), timeout, dan kegagalan transport. HTTP permanen, redirect tidak aman, jenis respons salah, respons terlalu besar, dan kegagalan penyimpanan tidak diulang.
- Cache yang gagal verifikasi hash/dekompresi tidak dipakai; validator HTTP-nya dilepas dan halaman diambil ulang tanpa conditional header. Blob snapshot tetap di direktori yang dibatasi.
- Kegagalan refresh ditandai meskipun snapshot lama masih ada. Proses berikutnya mencoba jaringan lagi; tidak otomatis menyamarkan error sebagai keberhasilan cache lama.

## Audit dan provenance

`fetches[].retrievalMode` membedakan:

| Mode | Arti |
| --- | --- |
| `network` | Isi HTML diunduh lewat HTTP. |
| `cache` | Checkpoint valid dipakai dalam batas TTL. |
| `snapshot` | Pembacaan offline yang diminta eksplisit. |
| `revalidated` | Server menjawab HTTP 304 dan isi snapshot dipakai. |

`fetchedAt` adalah waktu HTTP terakhir untuk snapshot tersebut; pada cache/offline nilainya tetap waktu lama. `sourceFetchedAt` mempertahankan waktu isi HTML diambil (tetap lama pada 304). `requestedAt` mencatat kapan halaman diminta oleh run sekarang, sehingga pada cache dapat lebih baru daripada `fetchedAt`. `cacheAgeMs`, `cacheReason`, hash, path snapshot, versi parser run, dan konteks checkpoint membuat angka tersebut dapat ditelusuri.

Cache/offline memiliki `attempts=[]`, bukan request HTTP palsu. `source_fetches.attempts` menjadi nol dan elemen `kind: retrieval` pada `attempt_log` menyimpan mode, waktu isi sumber, umur serta alasan cache. Record HTTP berikutnya mempertahankan urutan/error percobaan. Schema database tidak berubah; histori audit lama tetap kompatibel tanpa descriptor retrieval.

Attempt gagal mencatat `errorKind`, `phase`, dan `errorCode` jika tersedia. `phase=request` berarti menunggu respons; `phase=body` berarti membaca HTML; `phase=storage` berarti menyimpan snapshot. Timestamp fetch sukses sekarang mencakup pembacaan body, bukan hanya kedatangan header. Diagnostik membedakan tahap kegagalan, tetapi tidak memastikan apakah akar masalah berada di server atau jaringan.

Ringkasan menambahkan `networkRequests`, `cacheHits`, `revalidatedPages`, `snapshotReads`, `failedFetchPages`, `failedParsePages`, `partialPages`, dan `timeoutAttempts`. Counter halaman berlaku untuk seluruh resource; counter `...Matches` hanya untuk pertandingan. `networkRequests` menghitung seluruh attempt HTTP, termasuk retry. `fetches` tetap menghitung halaman yang diproses, termasuk cache.

## Verifikasi

Seluruh 33 test, lint, typecheck, dan build lulus. Test mencakup TTL, forced refresh, koreksi fixture, jendela laga baru selesai, 304, hash/gzip rusak, request ganda, prioritas, pelepasan slot saat retry, kegagalan refresh, cache parsial, resume lintas proses, live yang tidak dicache, dan provenance cache pada PostgreSQL PGlite.

Pengukuran online memakai snapshot Genius Sports yang sudah tersedia dan telah divalidasi oleh parser baru. Ini mengukur sinkronisasi berikutnya, bukan pengunduhan pertama dari cache kosong. Kedua run memakai proses CLI terpisah dan tidak menulis ke Neon.

| Kompetisi 49607 | Run pertama | Run ulang |
| --- | ---: | ---: |
| Halaman diproses | 77 | 77 |
| Halaman cache | 66 | 76 |
| Halaman yang perlu HTTP | 11 | 1 |
| Attempt HTTP termasuk retry | 16 | 1 |
| Timeout | 5 | 0 |
| Waktu fetch/cache + parsing | 97,856 detik | 6,084 detik |
| Box score lengkap | 32 | 32 |
| Baris pemain / total tim | 761 / 64 | 761 / 64 |
| Laga terjadwal | 2 | 2 |

Lima timeout pada run pertama berhasil dipulihkan: empat saat menunggu respons dan satu saat membaca body. Run ulang memakai cache untuk statistik dan klasemen, serta memeriksa fixture yang TTL-nya telah habis melalui satu request HTTP. Kedua run tetap berisi 27 tim, 322 pemain, sembilan grup, 27 klasemen, dan 34 fixture. Tidak ada fetch gagal, box score parsial, atau parser gagal; hanya dua info skor laga terjadwal belum tersedia.

Bukti lokal (direktori audit diabaikan Git):

- [Dry-run snapshot awal 49607](../ingest/audit/49607-fetch-bootstrap.json).
- [Run online pertama](../ingest/audit/49607-fetch-live-first.json).
- [Run online ulang](../ingest/audit/49607-fetch-live-repeat.json).
- [Snapshot sampel 49609](../ingest/audit/49609-fetch-bootstrap.json).

Kompetisi kedua: [49609 — (F) DBL DI JOGJAKARTA SERIES](https://hosted.dcd.shared.geniussports.com/IBF/en/competition/49609). Snapshot sampel memiliki 18 tim, 213 pemain, enam grup, 18 klasemen, 24 fixture, serta satu laga dengan 24 baris pemain dan dua totals. Struktur halaman tetap memakai parser yang sama; perbedaannya berupa jumlah entitas/grup. Pada dry-run online pertama, halaman Players mendapat HTTP 200 tetapi hanya berisi template tanpa `.playerblock` (8.588 byte). Parser menolaknya, sehingga registri pemain pada run tersebut tidak tersedia; angka nol pada jumlah hasil parse bukan bukti kompetisi tidak memiliki pemain. Semua enam grup, 18 tim, serta box score sampel tetap terbaca.

Run online pertama sampel `49609` memerlukan 11 attempt HTTP, dua cache hit, satu timeout yang berhasil diulang, dan 55,156 detik. Run pemulihan dilakukan setelah beberapa TTL halaman discovery habis: sembilan request HTTP, tiga cache hit, tanpa timeout, dan 28,886 detik. Players tetap tanpa blok data dan dicatat sebagai satu halaman parser gagal; tidak dipromosikan menjadi checkpoint sukses. Struktur sumber yang berhasil tetap sama dengan fixture, sehingga selector parser tidak diganti untuk menerima halaman tanpa data.

Bukti: [run online sampel 49609](../ingest/audit/49609-fetch-live.json) dan [run pemulihan](../ingest/audit/49609-fetch-live-resume.json). Uji ini sekaligus membuktikan HTTP 200 tidak cukup untuk dianggap sebagai data valid. Seluruh pengukuran pada bagian ini adalah dry-run; tidak menghapus atau menulis record Neon.
