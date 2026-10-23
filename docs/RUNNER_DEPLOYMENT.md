# Runner: GitHub → Coolify → VPS

Arsitektur yang dipilih pada 13 Oktober 2026:

| Komponen | Tempat berjalan | Data yang digunakan |
| --- | --- | --- |
| Runner | VPS melalui Coolify | Mengambil HTML publik dan menulis Neon |
| Snapshot/audit/checkpoint | Volume permanen VPS | `.gz`, JSON, referensi hash, dan antrean fixture |
| Dashboard | Vercel | Membaca Neon dari server dashboard |
| Database | Neon PostgreSQL | Statistik, pertandingan, provenance, dan audit ringkas |

`compose.runner.yaml` hanya menjalankan runner. Tidak membangun/menjalankan dashboard atau membuka port/domain HTTP. Runner tidak dijalankan melalui request atau cron Vercel.

Sejak penambahan analitik 22 Oktober 2026, runner juga memperbarui JSON `analysis/<key>.json` di dalam volume audit permanen. Preview memakai file terpisah dan katalog runtime menautkan file utama melalui `analysisFile`. Tidak memerlukan volume, service, atau migrasi Neon tambahan untuk analitik ini. Ekspor dapat dipulihkan dari audit lokal dengan `analysis export --competition <ref>`; lihat [ANALYTICS.md](./ANALYTICS.md).

## Perilaku service

```sh
pnpm --dir ingest run cli runner service
```

- Siklus pertama melakukan pemeriksaan standar penuh; siklus berikutnya memakai incremental setiap 900 detik setelah siklus sebelumnya selesai.
- Pada incremental, dataset gagal/parsial mengikuti jeda jaringan 5–60 menit, masalah struktur satu jam, atau anomali sumber/identitas 24 jam. Fixture berubah, live/unknown, parser upgrade, dan retry manual tetap dapat memicu pemeriksaan lebih cepat; jeda berlaku pada seleksi laga. Lihat [kualitas data](./DATA_QUALITY.md).
- Setiap 86.400 detik setelah pemeriksaan penuh berhasil, runner kembali melakukan pemeriksaan standar seluruh detail. Ini mengikuti TTL cache, bukan memaksa `--refresh` seluruh halaman. Bila TTL detail diperpanjang melebihi sehari, pemeriksaan harian dapat menggunakan HTML lama.
- Checkpoint `.runner-service.json` menyimpan waktu pemeriksaan penuh terakhir, strategi, status siklus, heartbeat, dan jadwal berikutnya. Restart memakai checkpoint yang sama. Run parsial/gagal, penghentian di tengah siklus, atau dry-run tidak memajukan penanda pemeriksaan penuh.
- Gangguan per kompetisi dicatat dan kompetisi berikutnya tetap diproses. Error tingkat siklus dicoba kembali sesudah interval. Error storage/konfigurasi checkpoint menyebabkan proses keluar; Docker dapat memulai ulang proses yang berhenti.
- Local lock service mencegah dua owner pada volume yang sama. Lock snapshot/kompetisi dan lease Neon tetap berlaku. Lock yang kedaluwarsa mengenali PID yang dipakai ulang setelah restart container; jangan menghapus lock aktif secara manual.
- SIGTERM/SIGINT menyelesaikan kompetisi yang sedang berjalan dan tidak memulai kompetisi berikutnya. Compose memberi waktu 30 menit sebelum penghentian paksa; bila terpaksa berhenti, lease kedaluwarsa dan transaksi yang belum commit tidak dianggap berhasil.
- Healthcheck memeriksa heartbeat lokal setiap 30 detik. Status healthy menunjukkan proses hidup, bukan bukti sumber/Neon berhasil disinkronkan. Periksa `lastCycleStatus`, log, dan Overview. Docker tidak otomatis me-restart container hanya karena unhealthy; restart policy berlaku ketika proses/container berhenti.

Atur interval melalui `STATSARENA_SYNC_INTERVAL_SECONDS` (30–86.400) dan `STATSARENA_FULL_SYNC_INTERVAL_SECONDS` (900–604.800). Nilai default 15 menit dan satu hari.

## Menyiapkan resource Coolify

1. Push kode ke repository GitHub StatsArena. Kredensial, cache, audit, `.locks`, dan build output diabaikan Git/build context. Package Docker hanya menyalin kode ingest/database dan konfigurasi kompetisi.
2. Buat resource baru dari repo GitHub dengan build pack **Docker Compose**. Base Directory `/`, Compose Location `/compose.runner.yaml`, branch `main`. Gunakan satu resource runner dengan satu instance.
3. Isi `DATABASE_URL` pooled StatsArena sebagai runtime environment di Coolify. Jangan mengirim nilainya melalui chat atau menjadikannya build argument. `DIRECT_DATABASE_URL` tidak diberikan kepada container runner.
4. Pastikan target Neon sudah memiliki seluruh migrasi sampai `0007_quiet_polaris` untuk kualitas dataset dan provenance perhitungan 2P. Migrasi dilakukan secara terpisah dengan koneksi direct dari checkout admin yang terverifikasi, bukan otomatis saat container restart. Jika ada data lama dengan metadata null, lakukan preview lalu `quality backfill` ketika writer berhenti; prosedur ada di [kualitas data](./DATA_QUALITY.md). Target Neon proyek ini sudah dimigrasikan dan di-backfill pada 13 Oktober 2026; deployment VPS tetap perlu diverifikasi terpisah.
5. Biarkan domain/HTTP routing kosong dan preview deployment runner nonaktif. Preview tidak boleh menjalankan importer kedua ke database production.
6. Compose mendefinisikan dua named volumes: `/app/ingest/snapshots` dan `/app/ingest/audit`. Pertahankan resource/nama volume ketika redeploy. Jangan memakai `down -v` atau menghapus volume. Image menyiapkan direktori untuk UID/GID 1000; jika memakai volume lama/import manual, pastikan owner dan izin tulis sesuai.
7. Deploy, periksa log siklus pertama, healthcheck, dan status sinkronisasi tiap kompetisi di Overview. Saat redeploy, pastikan checkpoint/audit/cache tetap ada. Ini verifikasi VPS yang masih perlu dilakukan.

Volumes berasal dari disk VPS; pindah server membutuhkan pemindahan volume dan backup. Menjalankan runner pada VPS baru dengan volume kosong akan membentuk cache baru. Pembersihan audit Neon harus tetap memakai metadata arsip lengkap; jangan menjalankannya dari volume baru yang belum mendapat arsip lama.

Konfigurasi kompetisi berada di `ingest/config/competitions.json`. Tambahkan/nonaktifkan kompetisi melalui Git lalu redeploy; jangan mengubah file image container yang bersifat read-only. Runner membaca konfigurasi setiap siklus. Pembersihan JSON/.gz otomatis memakai aturan retensi yang sudah ada; pembersihan Neon tetap eksplisit/manual.

## GitHub CI dan Vercel

Katalog otomatis memakai `STATSARENA_CATALOG_PATH=ingest/audit/competitions_catalog.json` pada Compose agar tersimpan pada volume audit yang dapat ditulis. Default lokal tetap `ingest/config/competitions_catalog.json`. Katalog runtime di VPS berbeda dari salinan config dalam image; keduanya bukan daftar kompetisi aktif. Detail lokasi JSON/HTML dan rebuild ada di [panduan katalog](./COMPETITION_CATALOG.md).

`.github/workflows/ci.yaml` menjalankan lint, typecheck, test, build workspace, build image runner, dan pemeriksaan entrypoint image pada pull request serta push `main`. CI tidak membutuhkan kredensial Neon dan tidak mengimpor data live.

Untuk alur sederhana, aktifkan auto deploy GitHub pada resource Coolify dan gunakan branch protection `main` yang mewajibkan job `checks` lulus sebelum merge. Auto deploy Coolify dapat berjalan langsung saat push; workflow ini tidak mengirim webhook deployment dan tidak menjamin Coolify menunggu job pada push `main` yang sama. Jika ingin gate deployment persis setelah CI pada commit yang sama, nonaktifkan auto deploy dan tambahkan job deployment terautentikasi/versi image setelah resource tersedia.

Hubungkan Vercel secara terpisah ke package `dashboard/`, menggunakan konfigurasi environment dashboard sendiri. CI di atas memeriksa dashboard, tetapi tidak men-deploynya atau menjalankan dashboard pada VPS. Jangan menyalin URL/token Coolify ke environment browser atau environment Vercel yang tidak membutuhkannya.

## Pemeriksaan lokal dan batas verifikasi

Sepuluh test terarah service/operasi lulus: penjadwalan harian, restart/checkpoint, retry gagal/partial, dry-run, penghentian, liveness, validasi state/interval, lock bersamaan, lease, dan pemulihan PID container. Lint terarah, typecheck dan build ingest lulus. Compose/workflow berhasil diparse sebagai YAML.

Docker belum tersedia di lingkungan lokal, sehingga build/run image dan deployment Coolify belum diverifikasi. CI menyediakan pemeriksaan image saat repo di-push. Belum ada perubahan database atau layanan permanen yang diaktifkan oleh penyiapan file ini.

Pemeriksaan CLI `service --dry-run --snapshot-only` pada 13 Oktober menemui lock snapshot yang sedang dimiliki proses ingest lain. Percobaan tidak mengambil alih proses itu, mencatat kegagalan lock, dan berhenti dengan exit 0 setelah SIGTERM. Ini membuktikan perlindungan lock serta shutdown CLI, bukan sukses parsing/impor pada siklus tersebut.

Rujukan resmi: [Coolify Docker Compose](https://coolify.io/docs/applications/builds/docker-compose), [persistent storage](https://coolify.io/docs/applications/configuration/persistent-storage), [GitHub Actions dan gate deployment](https://coolify.io/docs/applications/sources/github/actions), [Docker Compose services](https://docs.docker.com/reference/compose-file/services/).
