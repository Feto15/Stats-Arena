# Laporan klub dari Neon

Mulai 26 Oktober 2026, `/reports` dan `/reports/[club]` membaca statistik langsung dari Neon StatsArena. Kompetisi report tetap `IBL:50231`; daftar klub berasal dari `competition_teams`, bukan paket demo. Nama/slug, jadwal, box score, pemain, skor kuarter, shot chart, dan bukti rekonstruksi rotasi semuanya dibaca melalui server. Demo 2025 di route terpisah dan fixture pengujian tetap memakai arsip lokal.

## Alur baca dan akses

`neon-server.ts` adalah modul server-only. React `cache` hanya berbagi pembacaan selama satu render/request; tidak menyimpan snapshot lintas permintaan. Request berikutnya membaca keadaan Neon terbaru. `neon-queries.ts` menjalankan transaksi read-only dengan isolation repeatable read agar box score, event, tembakan, dan bukti rotasi satu laporan konsisten. Tidak ada HTTP ke Genius Sports, pembacaan audit/snapshot ingest, atau fallback ke JSON demo saat request.

Akun diperiksa sebelum membaca laporan. Route klub menyelesaikan keanggotaan kompetisi dari Neon dan memeriksa grant `(competitionKey, clubSourceId)` sebelum query rinci. Admin boleh melihat seluruh klub; staf hanya klub yang ditugaskan. Daftar klub pada form undangan/admin juga membaca Neon. Proxy hanya mengizinkan pola satu segmen slug; route server mengembalikan 404 untuk klub asing atau tanpa hak akses. Respons tetap private/no-store.

## Sumber statistik dan validasi

- Jadwal dan identitas berasal dari `competitions`, `competition_teams`, `teams`, dan `games` dengan source namespace `genius_sports:IBL` serta competition ID yang tepat.
- Laga masuk agregasi setelah berstatus complete, total dua tim cocok dengan skor final dan rumus box score, baris pemain kedua tim lengkap/valid dengan jumlah poin sesuai tim, serta FK `games.last_boxscore_fetch_id` menunjuk sumber parsed/succeeded yang memiliki hash dan waktu sumber. Jadwal tanpa hasil tidak diisi nol. Laga selesai yang tidak lolos ditandai di laporan.
- Pemain dan menit resmi portal berasal dari `player_game_stats` serta `players`. Null/nol dan presisi menit tetap dipertahankan. Metrik menggunakan evaluator `@statsarena/db/analytics`, tanpa kolom analitik Neon baru.
- Skor kuarter hanya dari event `period` / `Period end` di `play_by_play_events` yang memiliki sumber cocok. Empat batas, urutan, dan skor akhir harus konsisten; jika tidak, grafik tetap unavailable.
- Shot chart berasal dari `shots`, FK `source_fetch_id`, hash/waktu pada `source_fetches`, dan versi parser per dataset. Semua marker tim maupun pemain harus cocok dengan FGA/FGM resmi. Dataset yang hilang, parsial, atau tidak konsisten ditahan; box score valid tidak diganti. X=left dan Y=top serta kanvas asli Genius tetap dipakai.
- Provenance per angka/dataset memakai FK observasi yang benar, bukan memilih unduhan terakhir yang mungkin gagal. Footer admin menunjukkan waktu pembaruan data Neon; kredensial dan path snapshot tidak dikirim ke browser.

## Bukti rotasi yang tersimpan

Adapter LiveStats `statsarena-livestats/1.1.0` menambahkan `payload.rotation` di kolom JSONB `game_livestats.payload` yang sudah tersedia. Tidak diperlukan migrasi schema baru. Format `statsarena-livestats-rotation/1.0.0` berisi game ID sumber, skor, event dalam urutan sumber, mapping tim/pemain ke ID database portal, local keys, enam field bukti nama, core stats, menit raw, starter, plus/minus, dan provenance hash/waktu/path immutable. Payload bukan klaim bahwa rekonstruksi telah lolos.

Dashboard memvalidasi struktur bukti, menerjemahkan UUID internal ke source ID dalam kompetisi/laga yang sama, lalu memakai mesin rotasi `1.3.0` dan on/off `1.1.0`. Semua guard identitas, lima starter, urutan, kuarter, skor, durasi, dan plus/minus tetap berlaku. Perubahan satu data sumber tidak otomatis meloloskan lineup. Dewa–Pelita tetap memiliki satu FT dengan lineup ambigu: skor/durasi mentah tampil, rating ditahan.

Bukti rotasi adalah satu revisi sumber yang utuh. Sinkronisasi identik mempertahankan provenance sebelumnya; event atau mapping yang berkurang/hilang mempertahankan bukti lama dan memberi status partial. Kompaksi cache melindungi hash bukti yang masih dirujuk. Rotasi dan bukti baru ikut sinkronisasi rutin; request report tidak menjalankan impor.

## Pengisian awal tanpa HTTP

Periksa bantuan dan lakukan dry-run sebelum penulisan:

```sh
pnpm --dir ingest run cli --help
pnpm --dir ingest run cli livestats backfill --competition IBL:50231 --snapshot-only --dry-run
pnpm --dir ingest run cli livestats backfill --competition IBL:50231 --snapshot-only
```

Mode LiveStats `--snapshot-only` membaca cache current yang hash dan URL-nya tervalidasi tanpa memedulikan TTL; cache hilang/rusak tidak memicu HTTP dan tidak menghapus payload valid. Tidak dapat digabung dengan `--refresh`. Pengisian tetap mencocokkan snapshot dengan box score Neon sekarang, memakai lock/lease kompetisi dan transaksi, serta menyimpan audit. Dry-run tidak menulis record Neon. Ini berbeda dari request laporan, yang hanya membaca Neon.

## Verifikasi 26 Oktober 2026

Neon memiliki 10 klub, 20 jadwal, dan **10 laga selesai**, dibanding tujuh laga pada paket demo lama. Dry-run awal memeriksa 10 arsip dan seluruhnya ready; pengisian awal memperbarui 10 pelengkap LiveStats. Pengulangan memilih nol laga dan menulis nol record. Fingerprint seluruh isi **16 tabel** sumber/identitas/box score/PBP/shots/audit sama sebelum dan sesudah; hanya pelengkap LiveStats serta operasi lease/audit lokal yang diperbarui.

Pembacaan nyata seluruh klub menghasilkan **20 shot chart cocok**, **12 dataset rotasi valid**, dan **11 dataset rating valid** dari 20 klub–laga. Tidak ada laga box score yang dikeluarkan pada data saat verifikasi. Status partial lainnya tetap ditampilkan dengan alasan. Ini keadaan database saat diperiksa, bukan jaminan dataset sumber yang belum konsisten akan valid.

Test PGlite memakai statistik dan bukti nyata untuk memeriksa isolasi IBF/IBL, keanggotaan, source FK/hash, kuarter, GmSc, shot chart, alias dan rotasi, perubahan database, penghilangan dataset tanpa fallback, input ID invalid, box score rusak, serta koneksi gagal. Test ingest memeriksa urutan event, bukti nama/core/minutes, provenance/idempotensi, pengurangan event/pemetaan, cache-only tanpa HTTP, preservation dan rollback. Suite 116 test ingest dan 68 test dashboard lulus, diikuti dua regresi query tambahan (tujuh test query Neon termasuk induk) dan pengujian ulang 10 test LiveStats untuk salinan cache immutable. Lint/typecheck workspace, lint akhir dashboard/LiveStats, dan build production dashboard lulus. Browser admin memeriksa katalog 10 klub/10 laga/20 jadwal, ringkasan dan GmSc Dewa, satu kanvas shot chart (20/57), Dewa–Pelita 21 kombinasi dengan rating ditahan, dua rotasi Rajawali dan rating laga 2938931, serta 10 pilihan klub di Kelola akses. Empat permintaan anonim memastikan report/admin tidak membocorkan isi privat. Error pemuatan konfigurasi pada percobaan build awal diperbaiki dengan jalur environment server yang sama seperti dashboard sebelumnya; build dan halaman diulang setelah koreksi. Tidak ada perubahan credential/grant, deployment hosting, atau pemeriksaan hasil PDF.
