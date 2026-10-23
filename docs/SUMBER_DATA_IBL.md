# Temuan Sumber Data: Indonesian Basketball League (IBL) di Genius Sports

Perkembangan berikutnya pada 16 Oktober 2026: adapter pelengkap LiveStats kini tersedia untuk pertandingan IBF/IBL tersimpan. Allowlist fetcher HTML portal tetap terpisah; adapter LiveStats memiliki validasi URL, status, snapshot, dan guard penulisannya sendiri. Lihat [LIVESTATS.md](./LIVESTATS.md). Keterangan investigasi awal di bawah tidak berarti adapter tersebut masih belum tersedia.

Dokumen ini mencatat kandidat sumber IBL/NBL dan hasil verifikasi implementasi StatsArena per **16 Oktober 2026**. Dukungan parser yang diuji memakai portal HTML `hosted.dcd.shared.geniussports.com`, bukan widget LiveStats. Sampel live parser adalah kompetisi `42041`; seluruh katalog musim di bawah belum diverifikasi satu per satu. Investigasi terpisah terhadap tujuh tab LiveStats laga `2783625` menemukan plus/minus, starter, BP/2CP laga, serta JSON publik yang mengisi template HTML; lihat [perbandingan LiveStats dan portal](./PERBANDINGAN_LIVESTATS_GENIUS.md). Investigasi tersebut tidak menjalankan ingest atau menambah dukungan parser.

---

## 1. Ringkasan Temuan Kunci

* **Namespace Perbasi vs IBL:**
  * **`/IBF/`** (*Indonesia Basketball Federation* / PP Perbasi): Digunakan untuk kompetisi tingkat sekolah, kelompok umur, dan daerah (seperti **DBL** dan Kejurda).
  * **`/IBL/`** (*Indonesian Basketball League*): Digunakan khusus untuk liga profesional basket pria tertinggi di Indonesia (**IBL** dan era sebelumnya **NBL**).
* **Pembedaan Domain LiveStats (Anti-Bot vs Open Endpoint):**
  * `www.fibalivestats.com/u/IBL/<MATCH_ID>`: Pada pengamatan sebelumnya dilaporkan menolak akses otomatis dengan HTTP 403; ini bukan jaminan perilaku permanen dan penyebab blokir belum diverifikasi ulang di pekerjaan ini.
  * `fibalivestats.dcd.shared.geniussports.com/u/IBL/<MATCH_ID>/...`: Tujuh tab laga `2783625` terverifikasi HTTP 200 pada 16 Oktober 2026, beserta JSON yang memuat data laganya. Akses dan kelengkapan data dapat berubah; contoh laga `2938925` di bawah merespons 403. Domain ini belum diizinkan oleh fetcher produksi StatsArena.
  * `hosted.dcd.shared.geniussports.com/IBL/en/...`: Portal HTML sumber yang didukung. Sampel IBL membutuhkan adaptasi kolom, navigasi, dan tabel metrik; kompatibilitas tidak diasumsikan untuk semua musim.
* **Perbedaan ID Pertandingan (*Match ID*) vs ID Kompetisi (*Competition ID*):**
  * Angka di akhir link FIBA LiveStats (misal `2783625` atau `2938925`) adalah **ID Pertandingan**, bukan ID Kompetisi/Seri.
  * ID Kompetisi/Seri adalah payung dari seluruh jadwal pertandingan dalam satu turnamen/musim (misal `47793` untuk *IBL Gopay 2026*, `50231` untuk *IBL All Indonesian 2026*, atau `37811` untuk *IBL Tokopedia 2024*).

---

## 2. Struktur URL & Pola Endpoint IBL

### A. Portal Web Genius Sports (Format Standar Ingest)
| Jenis Halaman | Format URL Genius Sports |
|---|---|
| **Beranda IBL** | `https://hosted.dcd.shared.geniussports.com/IBL/en/` |
| **Halaman Kompetisi** | `https://hosted.dcd.shared.geniussports.com/IBL/en/competition/<COMPETITION_ID>/` |
| **Jadwal (*Schedule*)** | `https://hosted.dcd.shared.geniussports.com/IBL/en/competition/<COMPETITION_ID>/schedule` |
| **Klasemen (*Standings*)** | `https://hosted.dcd.shared.geniussports.com/IBL/en/competition/<COMPETITION_ID>/standings` |
| **Statistik Tim** | `https://hosted.dcd.shared.geniussports.com/IBL/en/competition/<COMPETITION_ID>/statistics/team` |
| **Daftar Tim (*Teams*)** | `https://hosted.dcd.shared.geniussports.com/IBL/en/competition/<COMPETITION_ID>/teams` |
| **Roster Tim** | `https://hosted.dcd.shared.geniussports.com/IBL/en/team/<TEAM_ID>/roster` |
| **Preview Laga** | `https://hosted.dcd.shared.geniussports.com/IBL/en/match/<MATCH_ID>/preview` |
| **Box Score / Match** | `https://hosted.dcd.shared.geniussports.com/IBL/en/match/<MATCH_ID>/boxscore` |
| **Play by Play** | `https://hosted.dcd.shared.geniussports.com/IBL/en/match/<MATCH_ID>/playbyplay` |
| **Shot Chart** | `https://hosted.dcd.shared.geniussports.com/IBL/en/match/<MATCH_ID>/shotchart` |

### B. FIBA LiveStats Widget (`fibalivestats.dcd.shared.geniussports.com`)
Berikut kandidat pola tab widget LiveStats. Ini referensi investigasi, bukan daftar endpoint yang sudah didukung parser StatsArena:
* **Summary (Skor & Kuarter):** `https://fibalivestats.dcd.shared.geniussports.com/u/IBL/<MATCH_ID>/index.html`
* **Box Score (Statistik Pemain):** `https://fibalivestats.dcd.shared.geniussports.com/u/IBL/<MATCH_ID>/bs.html`
* **Play by Play (Kronologi):** `https://fibalivestats.dcd.shared.geniussports.com/u/IBL/<MATCH_ID>/pbp.html`
* **Shot Chart (Peta Tembakan):** `https://fibalivestats.dcd.shared.geniussports.com/u/IBL/<MATCH_ID>/sc.html`
* **Leaders (Pemimpin Statistik):** `https://fibalivestats.dcd.shared.geniussports.com/u/IBL/<MATCH_ID>/lds.html`
* **Statistics (Perbandingan Tim & Grafik):** `https://fibalivestats.dcd.shared.geniussports.com/u/IBL/<MATCH_ID>/st.html`
* **Preview (Perbandingan sebelum laga; dapat tetap tersedia setelah selesai):** `https://fibalivestats.dcd.shared.geniussports.com/u/IBL/<MATCH_ID>/p.html`

---

## 3. Temuan Khusus Musim 2026 (Live, Selesai, dan Mendatang)

Dua contoh kompetisi 2026 yang dicatat pada investigasi awal ditampilkan di bawah. Daftar ini tidak menyatakan bahwa hanya ada dua kompetisi; status/jadwalnya perlu diperiksa lagi sebelum digunakan.

### 1. IBL Gopay 2026 (Competition ID: `47793`)
Kompetisi ini **sudah bergulir** dan memiliki catatan pertandingan lengkap (Final, Box Score, Shot Chart, Play by Play).

* **Contoh Pertandingan Selesai 1 — Tangerang Hawks vs Satya Wacana Salatiga (85 – 59):**
  * Match ID: `2783625` (Tanggal: 10 Januari 2026)
  * Summary: [fibalivestats index.html](https://fibalivestats.dcd.shared.geniussports.com/u/IBL/2783625/index.html)
  * Box Score: [fibalivestats bs.html](https://fibalivestats.dcd.shared.geniussports.com/u/IBL/2783625/bs.html)
  * Shot Chart: [fibalivestats sc.html](https://fibalivestats.dcd.shared.geniussports.com/u/IBL/2783625/sc.html)
  * Play by Play: [fibalivestats pbp.html](https://fibalivestats.dcd.shared.geniussports.com/u/IBL/2783625/pbp.html)
  * Format Web Ingest: [hosted match boxscore](https://hosted.dcd.shared.geniussports.com/IBL/en/competition/47793/match/2783625/boxscore)
* **Contoh Pertandingan Selesai 2 — Kesatria Bengawan Solo vs RANS Simba Bogor (63 – 101):**
  * Match ID: `2783644` (Tanggal: 10 Januari 2026)
  * Box Score: [fibalivestats bs.html](https://fibalivestats.dcd.shared.geniussports.com/u/IBL/2783644/bs.html)
  * Shot Chart: [fibalivestats sc.html](https://fibalivestats.dcd.shared.geniussports.com/u/IBL/2783644/sc.html)
* **Contoh Pertandingan Selesai 3 — Hangtuah Jakarta vs Bogor Hornbills (83 – 84):**
  * Match ID: `2783645` (Tanggal: 10 Januari 2026)
  * Box Score: [fibalivestats bs.html](https://fibalivestats.dcd.shared.geniussports.com/u/IBL/2783645/bs.html)
* **Jadwal Penuh Seri:** [IBL Gopay 2026 Schedule](https://hosted.dcd.shared.geniussports.com/IBL/en/competition/47793/schedule)

### 2. IBL All Indonesian 2026 (Competition ID: `50231`)

**Koreksi akses, 16 Oktober 2026:** pemeriksaan HTTP langsung pada `2938925/p.html` dan `2938925/index.html` menghasilkan **403 AccessDenied**. Keduanya bukan tautan akses yang sudah terverifikasi; penyebab penolakan belum dipastikan. Sebagai pembanding pola domain, `2783625/bs.html` pada **IBL Gopay 2026** merespons **200** dengan judul FIBA LiveStats. Laga pembanding itu bukan All Indonesian 2026. Pemeriksaan ini tidak menjalankan ingest.

Investigasi awal mencatat jadwal akhir Oktober 2026 dan kandidat URL Preview (`p.html`) berikut; keberadaan jadwal/ID tidak membuktikan bahwa halaman LiveStats sudah dapat diakses:

* **Match 2938925 (Hangtuah Jakarta vs Satya Wacana Salatiga - 24 Okt 2026):**\
  [fibalivestats p.html](https://fibalivestats.dcd.shared.geniussports.com/u/IBL/2938925/p.html)
* **Match 2938927 (24 Okt 2026):**\
  [fibalivestats p.html](https://fibalivestats.dcd.shared.geniussports.com/u/IBL/2938927/p.html)
* **Jadwal Penuh Seri:** [IBL All Indonesian 2026 Schedule](https://hosted.dcd.shared.geniussports.com/IBL/en/competition/50231/schedule)

---

## 4. Kandidat Katalog ID Kompetisi IBL & NBL (Genius Sports)

Katalog berasal dari investigasi awal. ID berpasangan pada era NBL belum dibuktikan sebagai alias yang ekuivalen; simpan sebagai kandidat terpisah sampai diverifikasi. Jangan mendaftarkan seluruh daftar otomatis.

### Era Modern IBL (2020 – 2026)
| Musim / Nama Kompetisi | ID Kompetisi | URL Sumber |
|---|:---:|---|
| **IBL All Indonesian 2026** | `50231` | `https://hosted.dcd.shared.geniussports.com/IBL/en/competition/50231/` |
| **IBL Gopay 2026** | `47793` | `https://hosted.dcd.shared.geniussports.com/IBL/en/competition/47793/` |
| **IBL Gopay All Star 2026** | `48642` | `https://hosted.dcd.shared.geniussports.com/IBL/en/competition/48642/` |
| **IBL All Indonesian 2025** | `42041` | `https://hosted.dcd.shared.geniussports.com/IBL/en/competition/42041/` |
| **IBL Gopay 2025** | `40351` | `https://hosted.dcd.shared.geniussports.com/IBL/en/competition/40351/` |
| **IBL All Star 2025** | `41449` | `https://hosted.dcd.shared.geniussports.com/IBL/en/competition/41449/` |
| **IBL Tokopedia 2024** | `37811` | `https://hosted.dcd.shared.geniussports.com/IBL/en/competition/37811/` |
| **IBL All Indonesian 2024** | `39576` | `https://hosted.dcd.shared.geniussports.com/IBL/en/competition/39576/` |
| **IBL Tokopedia 2023** | `35277` | `https://hosted.dcd.shared.geniussports.com/IBL/en/competition/35277/` |
| **IBL Tokopedia 2022** | `30871` | `https://hosted.dcd.shared.geniussports.com/IBL/en/competition/30871/` |
| **IBL Indonesia Cup 2022** | `35034` | `https://hosted.dcd.shared.geniussports.com/IBL/en/competition/35034/` |
| **IBL Pertamax 2021** | `29040` | `https://hosted.dcd.shared.geniussports.com/IBL/en/competition/29040/` |
| **IBL Pertamax 2020** | `25806` | `https://hosted.dcd.shared.geniussports.com/IBL/en/competition/25806/` |
| **IBL Tournament 2019/2020** | `25807` | `https://hosted.dcd.shared.geniussports.com/IBL/en/competition/25807/` |

### Era IBL Reborn & Turnamen (2015 – 2019)
| Musim / Nama Kompetisi | ID Kompetisi | URL Sumber |
|---|:---:|---|
| **IBL Pertamax Playoffs 2018-2019** | `23679` | `https://hosted.dcd.shared.geniussports.com/IBL/en/competition/23679/` |
| **IBL Pertamax Season 2018-2019** | `23176` | `https://hosted.dcd.shared.geniussports.com/IBL/en/competition/23176/` |
| **Championship IBL Go-Jek Tournament (2018)** | `23000` | `https://hosted.dcd.shared.geniussports.com/IBL/en/competition/23000/` |
| **IBL Go-Jek Tournament (2018)** | `22954` | `https://hosted.dcd.shared.geniussports.com/IBL/en/competition/22954/` |
| **IBL Playoffs 2017-2018** | `20335` | `https://hosted.dcd.shared.geniussports.com/IBL/en/competition/20335/` |
| **IBL Season 2017-2018** | `19978` | `https://hosted.dcd.shared.geniussports.com/IBL/en/competition/19978/` |
| **IBL Playoff 2017** | `17150` | `https://hosted.dcd.shared.geniussports.com/IBL/en/competition/17150/` |
| **IBL Regular Season 2017** | `16854` | `https://hosted.dcd.shared.geniussports.com/IBL/en/competition/16854/` |
| **2016 IBL Playoffs** | `8528` | `https://hosted.dcd.shared.geniussports.com/IBL/en/competition/8528/` |
| **IBL Regular Season 2015 - 2016** | `7913` | `https://hosted.dcd.shared.geniussports.com/IBL/en/competition/7913/` |
| **Championship Preseason 2015** | `5434` | `https://hosted.dcd.shared.geniussports.com/IBL/en/competition/5434/` |
| **IBL Preseason 2015** | `5387` | `https://hosted.dcd.shared.geniussports.com/IBL/en/competition/5387/` |

### Era NBL Indonesia (2010 – 2015)
| Musim / Nama Kompetisi | ID Kompetisi | URL Sumber |
|---|:---:|---|
| **NBL Indonesia 2014-2015** | `1127` / `3083` | `https://hosted.dcd.shared.geniussports.com/IBL/en/competition/1127/` |
| **NBL Indonesia 2013-2014** | `1125` / `3081` | `https://hosted.dcd.shared.geniussports.com/IBL/en/competition/1125/` |
| **NBL Indonesia 2012-2013** | `1122` / `3078` | `https://hosted.dcd.shared.geniussports.com/IBL/en/competition/1122/` |
| **NBL Indonesia 2011-2012** | `1119` / `3075` | `https://hosted.dcd.shared.geniussports.com/IBL/en/competition/1119/` |
| **NBL Season 2010 - 2011** | `1117` / `3074` | `https://hosted.dcd.shared.geniussports.com/IBL/en/competition/1117/` |

---

## 5. Implementasi yang sudah diperbaiki

Parser `statsarena-parser/0.2.4` menerima `/IBF/en` dan `/IBL/en` dengan HTTPS, host sumber yang sama, tanpa kredensial/port. Redirect dan tautan yang melintasi namespace ditolak/dikeluarkan sebelum ekstraksi identitas.

### Referensi dan identitas

- Input angka seperti `42041` tetap berarti **IBF**, demi kompatibilitas perintah lama.
- Gunakan `IBL:42041` atau URL lengkap untuk IBL. Dashboard memakai `?competition=IBL:42041` (URL dapat mengenkode titik dua).
- Database mempertahankan ID sumber mentah. Kolom `source` membedakan `genius_sports` (IBF lama) dan `genius_sports:IBL`; batas unik yang sudah ada mengisolasi kompetisi, tim, pemain, dan laga.
- Lease, incremental, lock kompetisi, checkpoint fixture, pencarian audit retry, dan kunci dataset audit memakai referensi kompetisi berscope. Cache HTML tetap memakai URL lengkap. Data IBF lama tidak diganti identitasnya.
- Importer memeriksa namespace URL payload JSON dan fetch sebelum menulis. Tautan sumber dashboard serta preflight maintenance Neon mengenali kedua namespace.

### Perbedaan HTML yang ditangani

1. **Kolom 2P tidak ada:** hanya bila kedua kolom 2P memang tidak disediakan dan input FG/3P valid, hitung `2PM = FGM - 3PM` serta `2PA = FGA - 3PA`. Nilai tidak boleh negatif atau made melebihi attempts. Sel 2P resmi yang ada tetapi kosong/invalid tetap parsial; tidak diisi dengan rumus.
2. **Provenance hasil hitung:** simpan formula, versi `1`, dan input pada `statDerivations` JSON audit serta `stat_derivations` statistik pemain/tim di Neon. `rawValues` tetap mempertahankan sel asli. Persentase 2P yang tidak disediakan tetap null. Migrasi `0007_quiet_polaris` menambah dua kolom JSON ini; tidak mengubah angka statistik lama.
3. **Menu Summary tidak ada:** URL halaman Summary saat ini menjadi bukti tab tersebut; Box Score tetap harus ditautkan sumber. PBP dan chart mengikuti tautan sebenarnya, tanpa menebak endpoint.
4. **Team Analysis hanya rating/possessions:** layout IBL yang dikenali (`Period`, `Off Rat`, `Poss`, dua tabel dengan baris Final) menghasilkan informasi bahwa BP/2CP laga tidak disediakan. Tidak menghasilkan angka atau mengganti dataset metrik valid lama. Layout rusak/tidak dikenal tetap dilaporkan.
5. **BP/2CP kompetisi di tabel terpisah:** gabungkan dengan ID tim, bukan urutan baris. Tim duplikat/hilang atau sel invalid tetap parsial. GP yang tidak disediakan disimpan null; tidak ditebak dari statistik lain.
6. **Klasemen:** tabel pada URL index IBL disimpan pada scope URL tersebut. Tautan round/pool tetap diikuti persis dari sumber. Tab dengan header valid tetapi tanpa baris tim dilaporkan `STANDINGS_ROWS_EMPTY`/parsial dan tidak mengganti klasemen tersimpan. Tidak menebak parameter grup atau menganggap seluruh tab sudah lengkap.

### Menjalankan verifikasi

```sh
pnpm --dir ingest run cli sync --competition IBL:42041 --dry-run --match-limit 1
# Setara dengan URL lengkap:
pnpm --dir ingest run cli sync --competition https://hosted.dcd.shared.geniussports.com/IBL/en/competition/42041 --dry-run --match-limit 1
```

Daftarkan kompetisi aktif melalui `ingest/config/competitions.json` dengan URL lengkap setelah hasil diperiksa. Perbaikan ini tidak otomatis mendaftarkan katalog IBL atau mengimpor seluruh musim ke Neon. Jalankan semua migrasi pada target StatsArena sebelum importer/dashboard versi baru digunakan.

## 6. Verifikasi sampel 16 Oktober 2026

Fixture HTML bertanggal, URL, dan SHA-256 tersedia di `ingest/test/fixtures/live-2026-10-16-ibl/manifest.json`. Halaman awal memuat 40 fixture, Teams 13 tim, dan Players 169 pemain. Sampel laga `2697582` memiliki skor 56–84, 23 baris pemain, dua total tim, 601 event PBP, dan 141 marker tembakan. Box score sampel lolos validasi setelah perhitungan 2P yang terdokumentasi.

Dry-run dengan batas satu pertandingan menemukan 11 scope tautan/index klasemen dan tujuh baris klasemen pada index; sepuluh tab round dari sumber kosong dan tetap parsial. Ada 26 metrik resmi kompetisi; metrik BP/2CP laga tidak disediakan navigasi sampel. Tidak ada fetch atau parse gagal pada dry-run perbaikan, tetapi hasil ini **bukan verifikasi seluruh kompetisi** dan bukan bukti impor IBL di Neon.

Hasil observasi di atas merupakan verifikasi historis. Dua audit dry-run `42041` dan direktori snapshot kerja `ibl-validation-2026-10-16` telah dihapus pada 16 Oktober 2026 atas permintaan pengguna; kompetisi ini tidak pernah diimpor ke Neon atau didaftarkan pada runner. Fixture regresi parser tetap terpisah dari data aplikasi. Pengujian PGlite mencakup impor IBF/IBL dengan ID identik, pengulangan idempoten, provenance 2P, penolakan payload campuran, lease, incremental, serta dashboard berscope. Migrasi `0007_quiet_polaris` berhasil diterapkan di Neon; fingerprint seluruh isi 14 tabel domain tetap sama selain kolom metadata baru. Suite workspace lulus 97 test, lalu satu regresi audit namespace tambahan serta penguatan redirect diuji terarah. Lint, typecheck, dan build lulus; build diulang setelah cache build dibersihkan karena disk lokal sempat penuh. Dashboard lokal memeriksa dua kompetisi IBF dan menerima filter IBL sebagai kompetisi belum diimpor, dengan log browser bersih. Hasil rinci ada di [NEON_VERIFICATION.md](./NEON_VERIFICATION.md).
