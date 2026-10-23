# Sinkronisasi dan operasional

## Ekspor analitik otomatis — 22 Oktober 2026

Setelah audit tersimpan, sync/retry/runner memperbarui `ingest/audit/analysis/<key>.json` dan katalog menautkannya melalui `analysisFile`. Incremental mempertahankan input valid laga yang dilewati. Dry-run/snapshot menulis `<key>.preview.json` tanpa mengganti file utama. JSON sumber serta baseline audit tetap terpisah; tidak ada migrasi analitik baru. Kegagalan ekspor dilaporkan sebagai peringatan/`analysis: null`, tanpa membatalkan impor yang sudah commit. Pulihkan offline dengan `analysis export --competition <ref>`. Versi rumus, cakupan, dan batas data ada di [ANALYTICS.md](./ANALYTICS.md).

CLI sync/retry/runner memperbarui tambahan LiveStats setelah commit portal dengan lease yang sama. Seleksi tambahan independen dari incremental portal. Gunakan `livestats backfill --dry-run` lalu `livestats backfill` untuk data lama, atau `livestats sync --competition <ref> --game <id> --refresh` untuk satu laga. Status LiveStats terpisah dari kualitas portal. Panduan lengkap: [LIVESTATS.md](./LIVESTATS.md).

Status: parser saat ini `0.2.4`, dengan kualitas dataset dan jeda retry incremental terverifikasi pada 13 Oktober 2026. Hasil historis Tahap 6 memakai parser `0.2.2`; mode incremental awal diverifikasi pada 10 Oktober 2026. Preflight read-only berhasil setelah proses memperoleh akses jaringan; `ENOTFOUND` pada percobaan sebelumnya berasal dari lingkungan jaringan terbatas. Hasil migrasi dan impor dicatat di [verifikasi Neon](./NEON_VERIFICATION.md).

## Menjalankan runner

Deployment permanen memakai **GitHub → Coolify → VPS** hanya untuk runner; dashboard tetap di Vercel. Mode baru `runner service` memilih incremental rutin dan pemeriksaan standar harian, dengan heartbeat/checkpoint permanen. Konfigurasi Docker, volume dan batas verifikasi ada di [panduan deployment runner](./RUNNER_DEPLOYMENT.md).

Runner sekarang menggunakan audit ringkas otomatis: siklus tanpa perubahan menyimpan ringkasan dan referensi hash, perubahan menyimpan dataset yang berubah, dan kegagalan menyimpan payload lengkap. Pembersihan lokal paling sering sekali sehari sesudah impor sukses mempertahankan dua versi valid, review yang belum selesai, dan arsip eksplisit. Lihat [kebijakan retensi](./STORAGE_RETENTION.md) untuk format audit serta perintah preview/pembersihan.

Sejak migrasi `0005_massive_unicorn`, Neon juga menyimpan ringkasan untuk input identik dengan run sukses tepat sebelumnya. Referensi baseline mempertahankan provenance dan isu review tanpa menggandakan fetch audit. Metadata/klasemen identik tidak ditulis ulang; observasi peserta diperbarui paling sering sekali sehari. Audit berubah/gagal dan archive tetap lengkap. Lihat [efisiensi Neon dan verifikasinya](./NEON_EFFICIENCY.md).

Runner memakai daftar kompetisi aktif di [`ingest/config/competitions.json`](../ingest/config/competitions.json). Jalankan dari root workspace:

```sh
# Satu siklus untuk semua kompetisi aktif; audit dibuat setelah proses selesai.
pnpm --dir ingest run cli runner once --dry-run

# Mode lokal tanpa jaringan untuk memeriksa snapshot yang sudah tersimpan.
pnpm --dir ingest run cli runner once --dry-run --snapshot-only

# Runner berulang dengan interval default 900 detik.
pnpm --dir ingest run cli runner watch

# Interval minimum yang valid adalah 30 detik; maksimum 86400 detik.
pnpm --dir ingest run cli runner watch --interval-seconds 300
```

`runner watch` menjalankan kompetisi secara berurutan, lalu menunggu interval setelah siklus selesai. Interval dapat diatur dengan `--interval-seconds` atau `STATSARENA_SYNC_INTERVAL_SECONDS`; opsi CLI didahulukan. Hentikan dengan `Ctrl-C` (`SIGINT`) atau `SIGTERM`: kompetisi yang sedang berjalan diselesaikan, kompetisi berikutnya tidak dimulai, lalu lock dilepas. Jalankan dengan environment StatsArena yang berisi `DATABASE_URL` untuk menyimpan run dan mengimpor data. `--dry-run` hanya membuat audit lokal; `--snapshot-only` hanya membaca snapshot dan tidak boleh dipakai sebagai sumber operasional permanen.

## Mode incremental: hanya detail laga baru atau berubah

Gunakan `--incremental` untuk sinkronisasi rutin yang melewati pengambilan dan parsing detail laga selesai yang sudah valid, termasuk ketika cache detail melewati TTL:

```sh
# Pemeriksaan read-only ke Neon, dengan pengambilan fixture terbaru.
pnpm --dir ingest run cli runner once --incremental --dry-run

# Impor seluruh kompetisi aktif atau satu kompetisi.
pnpm --dir ingest run cli runner once --incremental
pnpm --dir ingest run cli sync --competition 49607 --incremental

# Berkala; tidak memasang layanan permanen.
pnpm --dir ingest run cli runner watch --incremental --interval-seconds 900

# Paksa pemeriksaan laga yang memiliki URL gagal/parsial dalam audit.
pnpm --dir ingest run cli retry --competition 49607 --incremental
```

Mode ini memakai penanda dari migrasi `0004_incremental_sync` dan kualitas dataset dari `0006_magenta_khan`; terapkan seluruh migrasi serta sediakan `DATABASE_URL`, termasuk saat dry-run. Dry-run membaca state database tetapi tidak menulis lease, run, atau penanda sukses. `--incremental` tidak dapat digabung dengan `--refresh` atau `--snapshot-only`. Perintah tanpa `--incremental` mempertahankan perilaku TTL sebelumnya.

Setiap siklus mengambil ulang root dan halaman fixture yang ditemukan, termasuk antrean kelanjutan. Detail dipilih ketika laga baru, status/skor/tim/jadwal/venue berubah, berstatus live/unknown, parsing sebelumnya belum valid, versi parser berubah, atau ada kegagalan impor sebelumnya. Laga scheduled hanya di-upsert dari fixture dan tidak meminta halaman statistik. Teams, Players, Standings, serta Team Statistics kompetisi tetap memakai TTL karena datanya berada pada scope kompetisi.

Database menyimpan `games.fixture_hash` berdasarkan observasi fixture asli, bukan field yang digabung dari summary. Nama tampilan dan tab URL ekuivalen tidak menyebabkan refresh palsu. `detail_sync_status`, `detail_parser_version`, `detail_synced_at`, dan `detail_quality` dicatat setelah validasi/guard detail dalam transaksi pertandingan. Data gagal/parsial tetap ditandai untuk dicoba ulang sesuai waktu retry per dataset. Rollback tidak memajukan hash/penanda sukses; penanda kegagalan terpisah ditulis dengan guard lease dan kualitas lama dibatalkan agar cooldown tidak menghalangi pemulihan. Statistik valid tetap dipertahankan. Penanda tidak bergantung pada file state lokal, sehingga mesin lain memakai state Neon yang sama.

Impor lama yang belum memiliki hash fixture diproses sekali untuk membentuk baseline (`selected_unverified`), menggunakan cache tervalidasi bila masih berlaku. Sesudah baseline tersedia, detail lama dilewati. Audit mencantumkan `strategy: incremental`, `fixturesDiscovered`, `matchesProcessed`, `unchangedMatchesSkipped`, serta alasan `selected_new/changed/active/retry/parser_changed/unverified`. Jumlah laga/statistik dalam hasil impor menghitung subset pada siklus itu, bukan total tersimpan di Neon. `--match-limit` membatasi subset dan mendahulukan active, new, changed, lalu retry.

Koreksi statistik pada laga selesai yang **tidak mengubah fixture** tidak dapat dideteksi oleh mode ini. Jalankan sinkronisasi standar secara berkala atau `sync --competition <id> --refresh` untuk memeriksa koreksi tersebut. Durasi tetap bergantung pada respons HTTP fixture dan metadata.

## Menambah atau menonaktifkan kompetisi

Tambahkan URL kompetisi sumber yang valid ke `competitions` dan set `active` ke `true`:

```json
{
  "version": 1,
  "competitions": [
    {
      "sourceUrl": "https://hosted.dcd.shared.geniussports.com/IBF/en/competition/49607",
      "active": true
    }
  ]
}
```

ID dibaca dari URL, URL divalidasi terhadap host/pola Genius Sports yang didukung, dan ID berulang ditolak. Set `active` ke `false` untuk menghentikan sinkronisasi kompetisi itu; data yang telah diimpor tidak dihapus. Runner membaca ulang konfigurasi pada setiap siklus. File konfigurasi bawaan memuat dua kompetisi sampel yang dipakai pada verifikasi proyek; parser tidak mengunci daftar tersebut.

## Penemuan fixture dan pembaruan bertahap

Setiap sinkronisasi membaca ulang halaman fixture kompetisi, lalu menambahkan tautan fixture baru berdasarkan ID sumber. Parser mengikuti tautan jadwal dengan host, ID kompetisi, dan path yang benar-benar tercantum di HTML, termasuk `/schedule` tanpa parameter; parameter query dipertahankan, fragment dideduplikasi, dan pertandingan yang sama dideduplikasi. Pipeline tidak membuat nama fase atau URL semifinal/final sendiri. Jumlah halaman fixture per siklus, termasuk root, dibatasi `STATSARENA_FIXTURE_PAGE_LIMIT` (default 100, minimum 2, maksimum 1000). Halaman kompetisi yang valid tetapi belum berisi fixture menghasilkan isu informasi dan tidak menonaktifkan kompetisi.

Ketika batas halaman tercapai, cakupan dilaporkan belum lengkap dengan isu error `FIXTURE_PAGE_LIMIT_REACHED`. Runner menyimpan URL tersisa secara atomik dalam `.fixture-pages-<competition-id>.json` di direktori snapshot. Siklus berikutnya membaca root, kemudian mendahulukan antrean tersimpan sebelum tautan baru dari root. Halaman gagal/parsial dimasukkan kembali di belakang antrean agar halaman lain tetap mendapat giliran. State hanya menerima URL fixture dalam kompetisi yang sama, maksimal 10.000 URL dan 4 MiB, serta ditulis di bawah lock snapshot. Proses baru dengan direktori snapshot yang sama dapat melanjutkan antrean; pindah mesin/direktori memulai discovery dari root lagi. Data pertandingan lama tetap disimpan ketika satu siklus hanya memeriksa sebagian halaman. `syncCompetition` langsung di kode menerima `fixturePageResumeUrls` dan mengembalikan `pendingFixturePageUrls`; pemanggil selain runner perlu menyimpan kelanjutan itu sendiri.

Snapshot sumber memuat tautan `/schedule` tanpa parameter yang sebelumnya terlewat. Test deterministik memeriksa tautan polos, semifinal/final yang muncul bertahap, serta final yang berada di belakang batas dua halaman dan baru ditemukan oleh proses pada siklus berikutnya. Jika Genius Sports kelak memakai markup selain tautan jadwal berpola tersebut, selector perlu diperbarui setelah HTML sumber diperiksa.

Fetcher memakai cache TTL, retry/backoff, timeout, batas respons, serta konkurensi yang sudah ada ([detail cache dan fetch](./FETCH_OPTIMIZATION.md)). Fixture disegarkan setiap siklus; laga live/unknown, pertandingan selesai yang baru ditemukan berdasarkan ID tersimpan, dan konteks yang baru selesai diprioritaskan sebelum laga selesai lama. Pertandingan scheduled tetap disimpan tanpa halaman statistik atau nilai nol palsu. Upsert importer melewati dataset identik dan melaporkan jumlah laga baru/diperbarui.

## Benturan, resume, dan pemulihan

- Lock direktori berbasis `mkdir` mencegah dua proses lokal memproses kompetisi yang sama dan dua proses menulis direktori snapshot yang sama. File pemilik mencatat UUID, host, PID, waktu mulai, dan heartbeat. Lock lokal yang pemilik prosesnya mati dapat dibersihkan dengan aman setelah TTL; pemilik lain tidak dapat melepas lock baru.
- Sebelum impor, runner mengambil lease baris Neon unik per sumber/kompetisi. Heartbeat memperpanjang expiry; setiap transaksi impor memeriksa kepemilikan lease di dalam transaksi. Lease kedaluwarsa dapat diambil alih dan run lama ditandai gagal. Ini menggunakan koneksi pooled; migrasi tetap memakai `DIRECT_DATABASE_URL`.
- `sync_runs` menyimpan kompetisi/run impor, owner, host/PID, mode, status, waktu mulai/heartbeat/selesai/jadwal, jumlah halaman, jumlah penulisan, URL gagal, dan ringkasan hasil. Audit JSON lokal tetap berisi fetch, parse, provenance, dan isu per URL.
- Runner, `sync`, dan `retry` memakai satu penulis audit kegagalan. Bila lease atau importer gagal setelah parsing, audit tetap menyimpan fetch, isu, data parse, hitungan, dan hasil impor yang sudah tersedia. Error dibawa sebagai `SyncOperationError` dengan path audit; kegagalan menulis audit dilaporkan tanpa menutupi error awal. Connection string disamarkan pada pesan/audit/status run.
- Setelah kegagalan, jalankan retry terarah dari audit terbaru, atau pilih audit tertentu. Maksimum 25 URL gagal/parsial per perintah; URL harus berasal dari kompetisi yang sama dan halaman sumber yang didukung.

```sh
pnpm --dir ingest run cli retry --competition 49607 --dry-run
pnpm --dir ingest run cli retry --competition 49607 --audit ingest/audit/49607-run.json
```

Hilangkan `--dry-run` untuk mencoba kembali dan mengimpor halaman yang lolos validasi. Retry melewati cache hanya pada URL target. Kegagalan lain tetap terlihat dan tidak mengganti record valid.

Jika audit memuat `PBP_EVENTS_SHRANK`, runner mengambil ulang halaman play by play melalui HTTP dengan mengabaikan cache sebelum impor. Jika jumlah event tetap lebih sedikit, importer mempertahankan event lama, mencatat isu review, dan menandai fetch parsial; pengulangan jumlah yang lebih rendah tidak otomatis mengizinkan penghapusan. Periksa halaman dan audit sumber sebelum koreksi manual. Chart tetap dicocokkan dengan FGA/FGM resmi; metrik yang kehilangan sel atau baris juga mempertahankan data valid sebelumnya.

Pemeriksaan ulang PBP mempertahankan batas sampel pertandingan dan konteks kelanjutan fixture. Semua metadata fetch dari kedua pass disimpan, sehingga data pilihan pass terakhir terhubung ke hash/waktu sumber pass yang sama. Counter HTTP/cache/audit menghitung seluruh retrieval, bukan hanya pass terakhir.

## Status pada dashboard

Overview menampilkan status sinkronisasi untuk kompetisi yang sedang dipilih: run berjalan atau stale, hasil terakhir, waktu pemeriksaan, waktu HTML sumber terakhir, waktu run berikutnya bila ada, jumlah pertandingan baru/diperbarui, dan halaman gagal/review dengan tautan sumber. Waktu pemeriksaan berasal dari run; waktu sumber berasal dari `source_fetched_at`, sehingga cache atau data lama yang dipertahankan tidak tampak seperti fetch baru. Query dibatasi kompetisi di server; tidak ada endpoint dashboard publik yang memulai impor.

## Bukti verifikasi lokal dan Neon

- Test fixture menguji fixture semifinal/final yang muncul bertahap, prioritas laga baru atas laga complete tersimpan, kompetisi aktif tanpa pertandingan mendatang, deduplikasi, transisi status, lock bersamaan, pemulihan lease/run stale, retry terarah dengan batas, perlindungan data, pemulihan PBP, dan scope query dashboard. Lima test regresi tambahan memeriksa tautan jadwal polos, kelanjutan antrean lintas proses, keamanan checkpoint, kecocokan hash/provenance refresh, dan audit kegagalan impor. Detail ada di `ingest/test/operations-regression.test.ts`, `ingest/test/operations.test.ts`, `ingest/test/pipeline.test.ts`, `ingest/test/importer.test.ts`, dan `dashboard/test/dashboard-queries.test.ts`. Seluruh 64 test (62 ingest, dua dashboard), lint, typecheck, dan build lulus pada kode akhir.
- Snapshot penuh 8 Oktober menghasilkan 49607: 27 tim, 322 pemain, 9 grup, 34 pertandingan, 809 baris pemain, 68 baris total tim, 15.455 event PBP, 3.018 tembakan, 136 metrik laga, 54 metrik kompetisi. 49609: 18 tim, 213 pemain, 6 grup, 24 pertandingan (22 selesai, 2 terjadwal), 514 baris pemain, 44 baris total tim, 9.853 event, 1.702 tembakan, 88 metrik laga, 36 metrik kompetisi.
- Pada verifikasi awal, dua siklus `runner watch --dry-run --snapshot-only --interval-seconds 30` selesai berurutan pada kedua kompetisi; setiap siklus membaca 184 dan 121 snapshot. Perbaikan `0.2.2` menambahkan halaman `/schedule` sehingga satu siklus penuh sekarang membaca 185 dan 122 halaman, dengan dua halaman fixture per kompetisi dan tanpa antrean tersisa pada sampel saat ini.
- Dry-run live parser `0.2.2` berhasil pada kedua kompetisi: 49607 memakai 190 attempt HTTP termasuk lima timeout yang pulih, sekitar 466,6 detik; 49609 memakai 132 attempt termasuk sepuluh timeout yang pulih, sekitar 384,3 detik. Tidak ada fetch/parse gagal atau halaman partial pada hasil akhir. Audit: `ingest/audit/49607-stage6-fixed-dry-run.json` dan `49609-stage6-fixed-dry-run.json`. Isu identik dari fixture root/jadwal dideduplikasi; hasil impor akhir memiliki lima isu info PBP pada 49607, serta empat isu info PBP dan dua skor scheduled pada 49609.
- Preflight read-only berhasil dengan akses jaringan yang diizinkan dan memastikan target pooled/direct sama. Migrasi `0003_sync_operations` berhasil diterapkan: 19 tabel aplikasi, 20 termasuk jurnal, 41 foreign key, empat migrasi. Impor parser terbaru dan impor ulang kedua kompetisi berhasil. Impor ulang melewati statistik box score, PBP, shots, dan metrik yang sama; tidak ada kegagalan atau halaman partial. Lihat [catatan verifikasi Neon](./NEON_VERIFICATION.md).

Untuk memastikan kedua impor memakai HTML tervalidasi yang sama, TTL cache diperpanjang sementara menjadi tujuh hari hanya pada proses verifikasi. Kedua siklus menggunakan 185/122 cache hit, tanpa HTTP baru. Pengaturan `.env`, TTL bawaan, dan interval runner tidak diubah; sumber operasional tetap diperiksa ulang sesuai TTL normal. Pengambilan HTML live dibuktikan oleh dry-run terpisah sebelum impor, sedangkan transaksi/idempotensi Neon dibuktikan oleh run impor dan query read-only sesudahnya. Gunakan `runner watch` bila ingin menjalankan siklus berkala; proses tersebut belum dipasang sebagai layanan latar belakang permanen.

Pemeriksaan proyek: `pnpm lint`, `pnpm typecheck`, `pnpm test`, dan `pnpm build`. Cara menjalankan perintah ini dijelaskan di [`AGENTS.md`](../AGENTS.md).

## Retry menurut penyebab

Incremental mengikuti jadwal dataset quality: transport memakai backoff 5–60 menit, parser/struktur satu jam, anomali/identitas sumber 24 jam. Fixture berubah, versi parser baru, live/unknown, retry manual, dan pemeriksaan standar tetap dapat memicu pemeriksaan lebih cepat. Lihat [DATA_QUALITY.md](./DATA_QUALITY.md) untuk batas seleksi per laga dan perintah backfill status lama.

## Scope IBF/IBL — 16 Oktober 2026

Parser `0.2.4` menggunakan referensi `IBL:<ID>` untuk operasi IBL; ID angka lama tetap IBF. Konfigurasi runner harus menyimpan URL kompetisi lengkap. Source Neon terpisah (`genius_sports` dan `genius_sports:IBL`), dengan ID mentah; lock, lease, checkpoint, nama audit, hash dataset dan retry memakai scope yang sesuai. URL/fetch tidak boleh berpindah namespace. Upgrade parser memicu sekali validasi ulang detail versi lama; tidak mengganti identitas data IBF. Terapkan seluruh migrasi sampai `0007_quiet_polaris` sebelum memakai versi ini. Lihat [panduan IBL](./SUMBER_DATA_IBL.md).
