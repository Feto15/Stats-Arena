# Kelengkapan detail dan retry

Pelengkap LiveStats memiliki status sendiri di `game_livestats`: ready, partial, mismatch, unavailable, fetch_failed, dan parse_failed. Kegagalan tambahan tidak mengubah kualitas box score/PBP/shots portal. Baris terverifikasi dapat disimpan meski baris lain tidak cocok; provenance tiap baris dan alasan tetap tersedia. Lihat [LIVESTATS.md](./LIVESTATS.md).

Status hasil pertandingan (`scheduled`, `live`, `complete`) terpisah dari kelengkapan dataset. `games.detail_quality` menyimpan observasi terakhir untuk `summary`, `boxScore`, `playByPlay`, `shotChart`, dan `analysis`. `detail_sync_status` tetap menjadi status gabungan untuk kompatibilitas; label `parsed` pada laga terjadwal tidak berarti statistik pertandingan sudah ada.

## Status dan alasan

Setiap dataset memiliki `status`, `category`, `checkedAt`, `nextRetryAt`, `consecutiveFailures`, serta `issues` yang berisi kode, URL, field, pesan, expected dan actual. Status adalah `parsed`, `partial`, `failed`, `scheduled`, atau `unavailable`. Ini status input terbaru, bukan penghapusan data valid yang tersimpan dari pemeriksaan sebelumnya.

| Kategori | Contoh | Pemeriksaan incremental berikutnya |
| --- | --- | --- |
| `network` | timeout, gagal HTTP | paling cepat 5, 10, 20, 40, lalu 60 menit; mengikuti interval runner |
| `source_inconsistent` | FGA chart berbeda, jumlah poin pemain berbeda | 24 jam |
| `source_identity_invalid` | marker dengan `sc_pn-3` | 24 jam |
| `parse_failed` | selector/header penting hilang | 1 jam |
| tanpa kategori | valid, terjadwal, atau halaman opsional tidak tersedia | perubahan fixture atau pemeriksaan standar |

Jeda ini berlaku untuk seleksi laga pada mode incremental. Jika salah satu dataset sudah jatuh tempo, detail pertandingan tersebut diproses bersama. Fixture yang berubah, laga live/unknown, versi parser baru, retry manual, serta sync standar/refresh melewati jeda ini. Runner service tetap melakukan sync standar harian. Kegagalan transaksi membatalkan metadata status pada transaksi itu dan menjaga laga eligible untuk retry.

JSON audit full/dry-run menyimpan `data.matches[].datasetQuality`. Parser `0.2.3` menambahkan `actual.invalidFields` pada `SHOT_MARKER_INCOMPLETE`: ID pemain/tim, periode, hasil, koordinat X/Y disebut spesifik. Marker dengan ID `-3` tidak diubah menjadi ID pemain berdasarkan nama. Histori audit lama tidak ditulis ulang; ketika membangun status dari histori, klasifikasi ID/periode hanya diperkaya bila ada bukti kelas mentah.

Observasi kualitas bukan data statistik: `datasetQuality` dikecualikan dari fingerprint hasil parse agar waktu pemeriksaan/jeda tidak memaksa audit full dan penulisan ulang dataset identik. Observasi disimpan bersama transaksi pertandingan; summary audit tanpa perubahan tetap memakai baseline valid. `checkedAt` pada status adalah pemeriksaan detail terakhir yang disimpan, sementara waktu pemeriksaan siklus terbaru ada pada run operasional.

## Dashboard

Detail laga menampilkan panel Kelengkapan data untuk masing-masing dataset, alasan, angka pembanding, serta waktu pemeriksaan rutin paling cepat. Statistik valid terakhir tetap dapat tampil saat observasi baru partial/gagal. Panel isu detail memakai isu observasi saat ini; Review tetap menyimpan histori termasuk isu yang sudah terselesaikan. Review juga menampilkan expected/actual dan bagian marker yang invalid.

## Memperbarui status data lama

Migrasi `0006_magenta_khan` hanya menambah kolom JSON nullable. Setelah memastikan target StatsArena dan menerapkan migrasi:

```sh
pnpm --dir ingest run cli quality backfill --dry-run
pnpm --dir ingest run cli quality backfill
```

Backfill hanya mengisi kolom status yang masih null menggunakan fetch terakhir per dataset dan isu dari run/URL observasi tersebut. Tidak mengambil HTML, mengubah skor, statistik, event, marker, atau histori isu. Writer aktif ditolak; pengisian metadata dibungkus transaksi dan idempoten. Tanpa bukti fetch, dataset ditandai unavailable; laga scheduled diberi status scheduled. Status lama yang diperkaya tidak menyatakan bahwa parser baru telah memverifikasi HTML.

Parser upgrade membuat detail versi lama eligible untuk sekali pemeriksaan ulang. Ini diperlukan agar perubahan parser dapat diperiksa; jangan mengubah `detail_parser_version` secara manual agar laga dianggap sudah diverifikasi.

## Verifikasi — 13 Oktober 2026

Migrasi `0006_magenta_khan` diterapkan pada Neon setelah target pooled/direct dan ketiadaan writer aktif diperiksa. Backfill mengisi 152 pertandingan; pengulangan memperbarui nol record. Jumlah dan fingerprint seluruh isi pertandingan (selain kolom baru), statistik pemain/tim, PBP, shots, metrik resmi, serta histori isu tetap sama. Bukti lokal: [quality-backfill-2026-10-13.json](../ingest/audit/quality-backfill-2026-10-13.json).

Pemeriksaan sumber langsung memastikan `2931287` memiliki 35 marker dibanding FGA resmi 36. Marker bermasalah pada `2923393` dan `2923408` memiliki ID pemain `sc_pn-3`; koordinat dan periode marker yang diperiksa tersedia. Status tetap parsial pada dataset yang bermasalah, tanpa mengarang marker atau identitas. Pemeriksaan ini tidak menyatakan seluruh pertandingan atau histori isu sudah bersih.

Dashboard produksi lokal menampilkan panel pada kompetisi `49403` dan `49678`, penjelasan ID invalid pada Review, serta perbandingan 35/36 pada detail laga. Pada viewport 390×844 tidak ada overflow halaman; konsol browser yang diperiksa tidak memiliki warning/error. Dashboard lokal tetap bind ke `127.0.0.1`. Deployment Vercel/Coolify belum dilakukan pada pekerjaan ini.

Seluruh 93 test (90 ingest, tiga dashboard), lint, typecheck, dan build lulus. Regresi mencakup marker nyata ber-ID negatif, periode/koordinat invalid, backoff dan pemulihan, override fixture/parser/manual, fingerprint tanpa metadata waktu, status dalam transaksi, perlindungan statistik, rollback, backfill idempoten, penolakan writer aktif, serta pemisahan isu saat ini dari histori pada detail dashboard.
