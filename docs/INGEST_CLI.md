# Panduan Perintah CLI Ingest StatsArena

Perintah pelengkap LiveStats (memerlukan migrasi `0008_stiff_blockbuster`): `livestats backfill --dry-run`, `livestats backfill`, dan `livestats sync --competition <ref> [--game <id>] [--dry-run] [--refresh] [--match-limit <n>]`. Backfill hanya membaca daftar kompetisi yang sudah tersimpan di Neon. Panduan dan status terpisah: [LIVESTATS.md](./LIVESTATS.md).

Dokumen ini merangkum seluruh perintah CLI `ingest`, cara kerja, flag/opsi, serta mekanisme pengamanan (*lock* dan *lease*) di StatsArena.

---

## 1. Daftar Perintah Utama

CLI dijalankan melalui root workspace menggunakan prefix `pnpm --dir ingest run cli <perintah>`.

| Perintah | Deskripsi & Kegunaan | Target Sumber |
| :--- | :--- | :--- |
| **`runner once`** | Menjalankan **1 siklus sinkronisasi** untuk semua kompetisi aktif yang ada di config. | Seluruh kompetisi aktif di `competitions.json` |
| **`runner watch`** | Menjalankan sinkronisasi **berulang secara berkala** (daemon/loop) dengan interval waktu tertentu. | Seluruh kompetisi aktif di `competitions.json` |
| **`runner service`** | Incremental rutin dan pemeriksaan standar harian, dengan checkpoint permanen untuk VPS/Coolify. | Seluruh kompetisi aktif di `competitions.json` |
| **`sync`** | Menjalankan sinkronisasi penuh untuk **1 kompetisi spesifik**. | ID atau URL kompetisi |
| **`discover`** | Memetakan jadwal, tim, pemain, dan klasemen suatu kompetisi tanpa mengambil detail laga. | ID atau URL kompetisi |
| **`retry`** | Menjalankan ulang (*retry*) hanya halaman-halaman yang **gagal/parsial** dari audit sebelumnya. | ID kompetisi & file audit |
| **`quality backfill`** | Mengisi metadata kualitas dataset yang masih null dari observasi audit tersimpan; tidak mengambil HTML atau mengubah statistik. | Neon StatsArena |
| **`metrics backfill`** | Menambahkan PIP/PFT/FBP laga yang belum ada dari snapshot analysis dengan hash/provenance Neon yang cocok. Gunakan `--dry-run` dahulu; opsional `--competition <ref>`. Tidak mengambil ulang sumber. | Snapshot lokal dan kompetisi tersimpan di Neon |
| **`storage compact`** | Pembersihan storage: memadatkan riwayat audit dan menghapus snapshot HTML yang sudah kedaluwarsa. | Direktori lokal `ingest/` |
| **`storage compact-neon`** | Maintenance eksplisit fetch audit Neon yang sudah tergantikan dan tidak dirujuk, dengan backup serta perlindungan provenance. | Neon dan metadata arsip lokal lengkap |
| **`snapshot read`** | Membaca dan mengekstrak isi HTML mentah dari snapshot gzip lokal berdasarkan URL. | URL halaman Genius Sports |
| **`catalog rebuild`** | Memperbarui katalog lokasi JSON portal dan LiveStats per laga dari audit/cache lokal; tanpa jaringan/Neon. Otomatis juga melalui discover/sync/retry/runner dan livestats sync/backfill. | `ingest/config/competitions_catalog.json`; lihat [panduan katalog](./COMPETITION_CATALOG.md) |
| **`analysis export`** | Membuat JSON analisis pemain/tim dari audit lokal full/delta/summary; `--competition <ref>`, opsional `--audit <file>` dan `--dry-run`. Tidak mengakses HTML atau Neon. | `ingest/audit/analysis/<key>.json`; lihat [rumus dan alur](./ANALYTICS.md) |

---

## 2. Flag & Parameter Opsi

Sync/retry/runner mencetak durasi setiap tahap setelah tahap tersebut selesai. Hasil CLI menyertakan `timings`: setup (lock/koneksi/state), pipeline (fetch + parsing), impor portal, LiveStats, penulisan audit, ekspor analitik (`analysisMs`), maintenance bila dijalankan, dan katalog. Audit menyimpan waktu tahap yang selesai sebelum audit itu ditulis; durasi penulisan audit/analitik/katalog dan total akhir tersedia pada hasil CLI. Durasi HTTP per request tetap berada di `fetches[].attempts`; jumlah durasinya bisa melebihi waktu proses karena request berjalan paralel.

| Flag / Opsi | Fungsi |
| :--- | :--- |
| `--dry-run` | Tidak menulis ke Neon atau menghapus file retensi. Sync/retry/runner tetap menulis audit dan preview analitik lokal; incremental, backfill, dan maintenance Neon tetap membaca database. Khusus `analysis export`, hanya memeriksa rencana tanpa menulis JSON analisis/katalog dan tanpa membaca Neon. |
| `--incremental` | Memperbarui fixture, memilih detail laga baru/berubah/live/unknown, versi parser lama, atau gagal/parsial yang sudah jatuh tempo. Detail valid yang tidak berubah dilewati. Membutuhkan Neon, termasuk saat dry-run. |
| `--refresh` | Mengabaikan cache/TTL lokal dan memaksa fetch ulang semua halaman langsung lewat jaringan HTTP. |
| `--snapshot-only` | Berjalan sepenuhnya **offline** menggunakan snapshot gzip lokal yang sudah tersimpan sebelumnya. |
| `--match-limit <n>` | Membatasi jumlah laga yang diproses dalam siklus tersebut (misal `--match-limit 1` untuk uji coba cepat). |
| `--interval-seconds <n>` | Mengatur jeda waktu antar siklus pada `runner watch` (default: `900` detik / 15 menit). |
| `--full-sync-interval-seconds <n>` | Jeda pemeriksaan standar pada `runner service` (default: `86400` detik / satu hari). |
| `--config <path>` | Menentukan file konfigurasi kompetisi (default: `ingest/config/competitions.json`). |
| `--audit-mode <auto\|full\|archive>` | Mode penulisan file audit JSON (`auto` untuk runner, `full` untuk sync/retry). |
| `--output <file>` | Menentukan lokasi file output audit JSON atau file HTML. |

> [!NOTE]
> - `--refresh` tidak dapat digabung dengan `--snapshot-only` atau `--incremental`.
> - `--incremental` tidak dapat digabung dengan `--snapshot-only`.

---

## 3. Contoh Penggunaan Sehari-hari

### A. Sinkronisasi Semua Kompetisi (Runner)

```sh
# 1 kali siklus inkremental dalam mode uji coba (aman, tanpa ubah database)
pnpm --dir ingest run cli runner once --incremental --dry-run

# 1 kali siklus inkremental langsung ke database Neon
pnpm --dir ingest run cli runner once --incremental

# Menjalankan runner otomatis berulang setiap 10 menit (600 detik)
pnpm --dir ingest run cli runner watch --incremental --interval-seconds 600

# 1 kali siklus offline hanya dari snapshot yang sudah ada
pnpm --dir ingest run cli runner once --dry-run --snapshot-only
```

### B. Sinkronisasi 1 Kompetisi Spesifik (`sync`)

```sh
# Sinkronisasi kompetisi 49607 secara inkremental
pnpm --dir ingest run cli sync --competition 49607 --incremental

# Uji coba sinkronisasi hanya untuk 1 laga
pnpm --dir ingest run cli sync --competition 49607 --dry-run --match-limit 1

# Paksa ambil ulang seluruh data kompetisi dari live web (lewati cache)
pnpm --dir ingest run cli sync --competition 49607 --refresh
```

### C. Discovery Struktur Kompetisi

```sh
# Menemukan tim, klasemen, dan jadwal kompetisi baru
pnpm --dir ingest run cli discover --url https://hosted.dcd.shared.geniussports.com/IBF/en/competition/49607
```

### D. Penanganan Error & Retry

Status hasil pertandingan (`scheduled`/`live`/`complete`) berbeda dari kelengkapan box score, PBP, shot chart, dan metrik. Audit JSON full/dry-run memuat `data.matches[].datasetQuality`; Neon menyimpan `games.detail_quality`. Lihat [kualitas data](./DATA_QUALITY.md).

Incremental rutin menghormati backoff jaringan 5–60 menit, masalah struktur satu jam, dan anomali sumber/identitas 24 jam. Jeda berlaku pada seleksi pertandingan; bila satu dataset sudah jatuh tempo, detail laga diproses bersama. Retry manual, fixture berubah, live/unknown, versi parser baru, dan pemeriksaan standar dapat melewati jeda. Anomali sumber tetap parsial sampai sumber valid tersedia.

```sh
# Coba ambil ulang halaman gagal/parsial dari audit terbaru
pnpm --dir ingest run cli retry --competition 49607 --dry-run

# Coba ambil ulang halaman gagal dan langsung simpan ke database
pnpm --dir ingest run cli retry --competition 49607 --incremental
```

Retry memaksa refresh maksimal 25 URL gagal/parsial dari audit. Fixture dan metadata lain tetap dapat diproses sesuai mode/cache; ini bukan jaminan bahwa total request hanya sejumlah URL target.

### D.1. Metadata kualitas data lama

Setelah migrasi sampai `0006_magenta_khan` tersedia pada target StatsArena:

```sh
pnpm --dir ingest run cli quality backfill --dry-run
pnpm --dir ingest run cli quality backfill
```

Perintah menolak writer aktif, hanya mengisi metadata null, dan idempoten. Neon proyek ini sudah menjalani backfill 152 pertandingan pada 13 Oktober 2026; tidak perlu mengulang untuk record yang sudah terisi.

### E. Pemeliharaan Penyimpanan (*Maintenance*)

```sh
# Periksa snapshot & audit apa saja yang bisa dibersihkan (simulasi)
pnpm --dir ingest run cli storage compact --dry-run

# Bersihkan snapshot kedaluwarsa dan padatkan audit lama
pnpm --dir ingest run cli storage compact
```

### F. Debug HTML Snapshot

```sh
# Ekstrak halaman HTML tertentu dari cache snapshot lokal ke file
pnpm --dir ingest run cli snapshot read \
  --url "https://hosted.dcd.shared.geniussports.com/IBF/en/competition/49607/match/2931666/boxscore" \
  --output ingest/audit/debug-boxscore.html
```

### G. JSON analisis dari data lama

```sh
# Periksa input lokal dan cakupan sebelum membuat file analisis
pnpm --dir ingest run cli analysis export --competition 49607 --dry-run

# Buat/perbarui JSON analisis serta tautannya di katalog, tanpa HTML/Neon
pnpm --dir ingest run cli analysis export --competition 49607

# Pilih audit tertentu; referensi full/delta/summary tetap diverifikasi
pnpm --dir ingest run cli analysis export --competition 49607 --audit ingest/audit/nama-audit.json
```

Sync/retry/runner juga mengekspor otomatis ke `ingest/audit/analysis/<key>.json`; dry-run/snapshot menghasilkan `<key>.preview.json`. File utama yang sama diperbarui, sementara audit sumber tetap terpisah. Metrik, input, cakupan, dan alasan nilai null tercatat di dalam file. Hasil CLI memiliki objek `analysis` dengan path, status perubahan, `preview`, serta jumlah entitas yang masuk. Kegagalan ekspor menghasilkan peringatan dan `analysis: null`, tanpa membatalkan impor Neon yang sudah commit; pulihkan dengan perintah offline di atas. Panduan lengkap: [ANALYTICS.md](./ANALYTICS.md).

---

## 4. Mekanisme Keamanan: Lock & Lease

Untuk mencegah **benturan proses (*race condition*)** dan kerusakan data akibat proses sinkronisasi ganda:

```
[Proses Ingest]
       │
       ▼
1. Local Directory Lock (locks.ts)
   Mencegah 2 proses di komputer lokal memproses kompetisi/snapshot yang sama secara bersamaan.
   Menggunakan folder atomik `mkdir` dan `owner.json` berisi Process ID (PID).
       │
       ▼
2. Database Sync Lease (lease.ts)
   Mencegah 2 server/worker berbeda menulis kompetisi yang sama ke Neon PostgreSQL.
   Mencatat baris lease di tabel `sync_leases` dengan heartbeat periodik dan batas waktu kedaluwarsa (TTL).
       │
       ▼
3. Transaksi Atomik (importer.ts)
   Data ditulis dalam transaksi database (`db.transaction`). Jika terjadi error di tengah proses,
   seluruh perubahan pada pertandingan tersebut di-rollback sehingga data tetap bersih dan konsisten.
```

## 5. Kompetisi IBL

Sejak parser `0.2.4`, gunakan `IBL:42041` atau URL lengkap `/IBL/en/competition/42041`; angka `42041` saja tetap menunjuk IBF. Simpan URL lengkap di konfigurasi runner. Namespace juga dipertahankan pada retry dan audit.

```sh
pnpm --dir ingest run cli sync --competition IBL:42041 --dry-run --match-limit 1
pnpm --dir ingest run cli retry --competition IBL:42041 --incremental --dry-run
```

Terapkan migrasi sampai `0007_quiet_polaris`; lihat [hasil sampel dan batas dukungan IBL](./SUMBER_DATA_IBL.md). Dry-run sampel tidak membuktikan seluruh musim telah lengkap.
