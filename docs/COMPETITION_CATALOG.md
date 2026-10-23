# Katalog lokasi data kompetisi

`ingest/config/competitions_catalog.json` membantu pengguna/AI menemukan JSON portal, LiveStats, dan analisis StatsArena. Formatnya mempertahankan identitas kompetisi seperti versi manual, lalu menambahkan lokasi file serta status audit. Hitungan statistik, versi parser, dan provenance rinci tetap berada dalam file data masing-masing.

Pembaruan otomatis berlaku untuk `discover`, `sync`, `retry`, runner, `livestats sync/backfill`, serta `analysis export` tanpa dry-run. Parser tetap fungsi murni; katalog ditulis lapisan operasi. Tidak ada perubahan schema atau query tambahan Neon untuk katalog.

Katalog berbeda dari `ingest/config/competitions.json`, yaitu daftar kompetisi aktif runner. Menemukan kompetisi dalam katalog tidak mengaktifkan ingest kompetisi tersebut.

## Membaca katalog

Semua path relatif terhadap **root StatsArena**, bukan terhadap direktori katalog.

| Field | Makna |
| --- | --- |
| `id`, `name`, `sourceUrl` | Identitas sumber; URL membedakan namespace IBF dan IBL walaupun ID numeriknya sama |
| `gender`, `genderLabel`, `series` | Diturunkan hanya dari penanda nama sumber eksplisit seperti `(M)`/`(F)`; wilayah tidak ditebak |
| `region` dan field catatan lain | Anotasi manual yang dipertahankan; region kompetisi baru null jika belum diberi label |
| `latestAuditFile` | Nama audit portal terbaru dalam `dataLocations.auditDirectory`, termasuk dry-run/snapshot/gagal; bukan jaminan impor sukses |
| `latestAuditMode`, `latestImportStatus`, `latestAuditCreatedAt` | Membedakan percobaan lokal, kegagalan, impor parsial, dan impor sukses |
| `latestSuccessfulAuditPath`, `latestSuccessfulImportAt` | Observasi impor dengan `imported.status = succeeded` terakhir; tidak dimajukan oleh dry-run atau kegagalan |
| `latestAuditType` | Full/summary/delta pada waktu pengindeksan. Baca file aslinya untuk mengetahui payload setelah retensi; full bisa hanya mencakup sampel/incremental |
| `liveStatsFiles` | Pemetaan `ID laga → path JSON cache .gz` yang tersedia, relatif terhadap root StatsArena |
| `analysisFile` | JSON turunan berisi statistik dasar dan metrik analitik pemain/tim. Diperbarui melalui sync/retry/runner atau `analysis export`; bukan audit sumber atau bukti impor Neon. Lihat [ANALYTICS.md](./ANALYTICS.md). |
| `dataLocations.datasetIndexFile` | Sekali di tingkat root katalog: indeks dataset portal `.audit-storage.json` setelah impor sukses |
| `dataLocations.snapshotIndexFile` | Sekali di tingkat root katalog: pemetaan URL portal ke snapshot HTML `.gz` |

Urutan pembaruan memakai waktu audit; proses lama tidak boleh memundurkan pointer terbaru. Nama dan catatan lama tetap tersedia ketika percobaan terbaru gagal sebelum metadata kompetisi terbaca. Katalog bukan tempat menyalin seluruh statistik atau PBP.

### Menemukan PBP hasil parsing

1. Cari kompetisi berdasarkan `id` dan `sourceUrl` dalam katalog.
2. Buka `latestAuditFile` dalam direktori audit dan periksa jenis serta cakupannya. Pada full yang masih menyimpan payload, PBP ada di `data.matches[].playByPlay.records`.
3. Jika audit terbaru summary/delta atau incremental melewati laga tersebut, buka `dataLocations.datasetIndexFile`. Untuk laga `2931666` di IBF `49607`, cari `datasets["49607:match:2931666"][0].file`. Nama file relatif terhadap `dataLocations.auditDirectory`.
4. Pada file full, cari laga di `data.matches[]`. Pada delta, cari `changedData["49607:match:2931666"].playByPlay.records`.
5. Indeks baseline hanya maju setelah impor sukses. Untuk hasil dry-run/gagal yang belum diimpor, periksa audit percobaan tersebut langsung. Audit historis yang sudah diringkas oleh retensi bisa memiliki `payloadStatus: expired`; jangan menganggap semua audit lama bisa diputar ulang.

Untuk HTML mentah, cari URL `/match/2931666/playbyplay` dalam indeks snapshot, atau gunakan `snapshot read --url <URL>`; snapshot `.html.gz` masih berisi HTML, bukan JSON hasil parse.

### Menemukan JSON analisis

1. Pilih entri kompetisi berdasarkan `id` dan namespace dalam `sourceUrl`.
2. Buka `analysisFile`, relatif terhadap root proyek. Contoh: `ingest/audit/analysis/49607.json` atau `ingest/audit/analysis/IBL-47793.json`.
3. Baca `players[]`/`teams[]` untuk agregat dan `games[]` untuk hasil per laga. Periksa `analyticsVersion`, definisi rumus, `scope`, provenance, serta `unavailableReasons` sebelum membuat analisis/konten.

`analysisFile` menunjuk file utama berisi input dasar dan metrik turunan; preview terpisah tidak menggantikan tautan ini. `discover` dan `catalog rebuild` dapat menautkan file analisis yang sudah ada, tetapi tidak menghitung metrik. Jika file belum tersedia, jalankan `analysis export --competition <ref>`; rebuild katalog saja tidak membuat JSON analisis. Adanya file analisis bukan bukti seluruh datanya sudah diimpor ke Neon. Lihat [alur dan batas analitik](./ANALYTICS.md).

### Menemukan JSON LiveStats

Cari `liveStatsFiles["2931666"]` pada kompetisi yang sesuai. Path tersebut langsung menunjuk file cache yang ada. Tidak ada salinan baru data pertandingan untuk katalog.

Setelah gzip dibuka, envelope berisi `url`, `hash`, `fetchedAt`, dan `body`. Parse JSON dalam string `body` untuk membaca `tm` (tim/pemain), `pbp`, `leaddata`, dan field sumber lainnya.

Referensi mengutamakan alias `current`; jika tidak tersedia/valid, gunakan `attempt` yang bisa berasal dari dry-run atau hasil yang ditolak saat validasi. **Adanya file bukan bukti bahwa seluruh data valid atau sudah masuk Neon.** Status review tetap berasal dari pipeline/Neon. JSON ini mentah; PBP LiveStats belum menjadi sumber event dashboard.

Kepemilikan file diverifikasi melalui URL namespace, `#compId`, `#matchId`, dan datapath halaman LiveStats yang tersimpan. Hash body dan batas gzip/dekompresi diperiksa. Nama tim/pemain serta ID laga saja tidak dipakai untuk menebak kompetisi. Alias stabil mengikuti cache terbaru tanpa menyalin statistik ke katalog.

## Memperbarui katalog dari audit yang sudah ada

```sh
pnpm --dir ingest run cli catalog rebuild
```

Perintah ini membaca audit dan cache LiveStats lokal, memperbarui katalog, dan mempertahankan anotasi serta entri kompetisi lama. Daftar file LiveStats dibangun ulang agar file hilang tidak tetap dirujuk. Tidak mengambil situs dan tidak mengakses Neon. `skipped` menyebut audit yang tidak terbaca/invalid; cache LiveStats rusak atau tidak dapat dibuktikan identitasnya tidak dicantumkan. Laporan maintenance/LiveStats tersendiri tidak mengganti pointer audit portal. Katalog invalid ditolak, bukan ditimpa diam-diam. Lock terpisah dan penulisan atomik melindungi penulisan bersamaan. Kegagalan katalog tidak mengubah hasil impor yang sudah commit.

## Coolify / VPS

Default lokal memakai file config yang diminta pengguna. Container runner bersifat read-only; Compose menetapkan `STATSARENA_CATALOG_PATH=ingest/audit/competitions_catalog.json` agar katalog runtime tersimpan pada volume permanen audit. File config dalam image tetap menjadi salinan referensi, bukan katalog runtime yang terus diperbarui. Pada volume baru, katalog runtime terbentuk dari kompetisi yang sudah diproses; gunakan rebuild jika audit lama sudah dipindahkan ke volume tersebut. Retensi tidak menghapus atau merangkum katalog sebagai payload statistik.

Variabel tersebut hanya menerima nama `competitions_catalog.json` di bawah `ingest/config/` atau `ingest/audit/`. Direktori audit/snapshot tetap mengikuti konfigurasi ingest. `livestats sync/backfill` memperbarui daftar file laga yang diproses, termasuk saat dry-run atau transaksi gagal, tanpa mengganti pointer audit portal atau mengklaim impor sukses. Sinkronisasi portal berikutnya mempertahankan daftar file LiveStats.
