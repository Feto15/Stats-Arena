# Rencana Proyek StatsArena

Status: diperbarui 8 Oktober 2026. Tahap 1–6 selesai dan diverifikasi sesuai cakupannya. Perbaikan review parser `0.2.2` mencakup jadwal tanpa query, antrean fixture lintas siklus, provenance seluruh pass refresh, dan audit kegagalan impor. Migrasi `0003_sync_operations`, impor dua kompetisi, serta impor ulang di Neon berhasil; jumlah record logis tetap sama dan statistik/detail identik dilewati. Runner berkala tersedia sebagai CLI dan belum dipasang sebagai layanan permanen.

## Tujuan

Membangun dashboard analitik basket dengan tampilan awal dari proyek **IBL Analytic**, tetapi sumber datanya adalah halaman HTML publik Genius Sports. Proyek harus mendukung banyak kompetisi. Kompetisi `49607` — **(M) DBL DI JOGJAKARTA SERIES** — hanya contoh pertama, bukan batasan sistem.

Data hasil parsing dan data analitik disimpan di **Neon PostgreSQL**. Dashboard membaca Neon melalui server; browser tidak mengambil atau mem-parse Genius Sports secara langsung.

## Prinsip yang sudah diputuskan

1. Bangun dan verifikasi parser serta impor Neon lebih dulu. Saat mulai mengerjakan UI, salin UI IBL Analytic sebagai titik awal: shell, navigasi, tema, komponen, dan pola halaman. Setelah aplikasi dasar berjalan, sesuaikan label, filter, query, dan halaman yang relevan; buang fitur yang tidak didukung data sumber. Jangan menyalin `.env`, kredensial, data PDF, atau koneksi database IBL.
2. Parser menggunakan **HTML yang dikirim server**. Halaman contoh sudah memuat data di HTML; JavaScript interaktif situs sumber tidak diperlukan untuk ekstraksi awal.
3. Setiap kompetisi didaftarkan lewat URL atau ID kompetisi. Parser menemukan tautan pertandingan, tim, pemain, dan grup dari halaman kompetisi, bukan mengasumsikan satu daftar ID tetap.
4. Simpan ID sumber dan URL asli. Nama dipakai untuk tampilan, bukan sebagai kunci identitas. Hubungan tim/pemain dengan kompetisi disimpan terpisah agar satu entitas dapat muncul di kompetisi lain.
5. Bedakan angka **resmi dari situs** dan angka **hasil perhitungan StatsArena**. Metrik yang belum dapat dihitung secara andal tidak diberi label seolah-olah sama dengan angka resmi.

## Sumber dan pemakaian data

Pola URL dasar: `https://hosted.dcd.shared.geniussports.com/IBF/en/competition/{competitionId}`.

| Halaman | Data yang diambil | Peran |
| --- | --- | --- |
| Kompetisi / Fixtures | nama kompetisi, jadwal, venue, status, skor, ID pertandingan dan ID kedua tim | daftar pertandingan |
| `/teams` | seluruh ID dan nama tim; logo jika tersedia | registri tim kompetisi |
| `/players` | seluruh ID dan nama pemain | registri pemain kompetisi, termasuk yang belum muncul di box score |
| `/standings` dan tautan tiap grup | nama grup, anggota, posisi, GP, W, L, D, poin klasemen, poin masuk/kemasukan, selisih | klasemen resmi; parser mengikuti URL grup yang tersedia |
| `/match/{matchId}/summary` | metadata laga, skor, perbandingan tim, ringkasan | pelengkap dan validasi |
| `/match/{matchId}/boxscore` | statistik pemain dan total tim | sumber utama statistik pertandingan |
| `/match/{matchId}/playbyplay` | urutan event, periode, waktu, tim, pemain, skor berjalan | kronologi pertandingan dan analisis lanjutan |
| `/match/{matchId}/shotchart` | posisi, periode, pemain, tim, jenis dan hasil tembakan | shot chart setelah penyaringan dan validasi |
| `/match/{matchId}/analysis` | statistik analisis tim per laga, termasuk 2CP jika tersedia | angka resmi tambahan |
| `/leaders` | peringkat resmi sebagai pembanding | validasi leaderboard yang dihitung dari box score |
| `/statistics/team` | total/rata-rata tim; BP dan 2CP resmi | validasi agregasi dan sumber angka yang tidak ada di box score |
| `/team/{teamId}` dan `/person/{personId}` | profil, roster, atau statistik yang tersedia | sumber pelengkap jika halaman detail dibutuhkan |

Tidak semua kompetisi pasti memiliki setiap jenis halaman atau metrik. Ketidakhadiran data disimpan sebagai `null`/status *unavailable*, bukan nol.

## Pilihan teknologi parser dan importer

- **Node.js + TypeScript + Cheerio** untuk membaca HTML dengan selector CSS. HTML diambil oleh modul `fetch` terpisah agar status HTTP, URL akhir, waktu ambil, retry, dan hash dapat dicatat sebelum parsing. Tidak perlu menjalankan JavaScript halaman sumber untuk contoh yang sudah diperiksa.
- **Zod** atau validator bertipe setara untuk memeriksa hasil setiap parser sebelum masuk database. Parser mengeluarkan record terstruktur; ia tidak menulis SQL langsung.
- **Drizzle ORM + Neon PostgreSQL** untuk schema, query, dan upsert berdasarkan ID sumber. Importer berjalan sebagai proses server/CLI terpisah dari request dashboard; penulisan beberapa tabel per laga dilakukan dalam transaksi dengan driver Neon yang mendukung transaksi interaktif atau driver PostgreSQL Node yang sesuai.
- **Next.js** hasil salinan UI IBL Analytic hanya membaca record yang sudah tersimpan di Neon melalui modul server. Schema/tipenya dapat dipakai bersama oleh importer dan dashboard.

Urutan kode: `fetch HTML → Cheerio parser → validasi/normalisasi → JSON audit → transaksi/upsert Neon → query dashboard`. Pisahkan parser per jenis halaman, misalnya `competition`, `teams`, `players`, `standings`, `boxscore`, `playbyplay`, dan `shotchart`; jangan membuat satu parser besar untuk semua halaman.

## Alur pengambilan data

1. **Daftarkan kompetisi:** simpan ID sumber, URL, nama, tahun/musim bila tersedia, dan status aktif.
2. **Temukan entitas:** ambil halaman kompetisi, Teams, Players, dan Standings. Ekstrak ID dari tautan sumber. Untuk grup, ikuti tautan tab yang ada; jangan menebak `poolNumber` dari nama grup.
3. **Ambil pertandingan:** untuk tiap ID laga, ambil summary, box score, play by play, shot chart, dan analysis yang tersedia. Pertandingan yang masih berlangsung diberi status sementara.
4. **Parse ke struktur bertipe:** pisahkan kode pengambil HTML, parser per jenis halaman, normalisasi identitas, validator, dan importer Neon. Satu parser tidak boleh bergantung pada teks navigasi atau dropdown kompetisi yang berulang di setiap halaman.
5. **Validasi silang:** cocokkan skor dengan total poin, FGA dengan jumlah tembakan pada shot chart, ID pemain/tim dengan registri, serta agregasi tim dengan halaman statistik resmi. Simpan selisih sebagai isu review, jangan diam-diam menimpa angka.
6. **Impor idempoten:** upsert memakai ID sumber dan lingkup kompetisi. Pengambilan ulang halaman yang sama tidak boleh membuat duplikasi. Catat waktu ambil, URL, hash konten, versi parser, dan status parsing.
7. **Sinkronisasi berikutnya:** jalankan impor awal penuh, lalu perbarui laga yang berubah atau belum selesai. Interval, batas permintaan, retry/backoff, dan aturan penyimpanan snapshot dibuat dapat dikonfigurasi; tidak perlu scraping pada setiap kunjungan dashboard.

### Aturan parsing penting dari contoh `49607`

- Daftar kompetisi memuat tautan ganda ke pertandingan dan beberapa status tersembunyi. Deduplicasi berdasarkan ID pertandingan; baca kelas status yang aktif, bukan teks `Live now` saja.
- Halaman Teams memiliki satu blok `.team-link` per tim, tetapi logo dan nama dapat menjadi dua tautan ke ID yang sama. Logo bersifat opsional.
- Halaman Standings umum menggabungkan banyak grup. Untuk keanggotaan dan urutan resmi, ambil setiap tautan grup. `GROUP A` memakai `poolNumber=9`, sedangkan `GROUP B` memakai `poolNumber=7`; nomor tidak mengikuti urutan huruf.
- Shot chart contoh memuat penanda foul dan turnover selain tembakan. Hanya event 2PT/3PT yang menjadi shot. Pada laga `2931666`, hasil penyaringan memberi 81 tembakan dan 24 tembakan masuk, sama dengan total box score.
- Pertahankan string waktu sumber. Zona waktu pada halaman contoh tidak dinyatakan eksplisit; jangan mengubahnya menjadi UTC/Jakarta tanpa dasar.
- Statistik seperti BP (*Bench Points*) dan 2CP (*Second Chance Points*) tersedia sebagai angka resmi di Team Statistics, tetapi tidak sebagai kolom langsung di box score pemain. Jangan mengarang starter atau 2CP dari agregat box score.

## Model data Neon PostgreSQL

Rancang schema baru untuk StatsArena; jangan langsung menggunakan schema IBL yang mengasumsikan musim sebagai kunci utama dan laporan PDF sebagai sumber.

| Kelompok tabel | Isi utama |
| --- | --- |
| `competitions`, `competition_groups` | identitas kompetisi, metadata, dan grup resmi |
| `teams`, `competition_teams` | identitas tim sumber dan keikutsertaan per kompetisi |
| `players`, `competition_players`, `team_rosters` | identitas pemain, keikutsertaan, dan hubungan tim bila diketahui |
| `games`, `game_periods` | jadwal, status, skor, kandang/tandang, periode |
| `team_game_stats`, `player_game_stats` | box score resmi per pertandingan |
| `play_by_play_events`, `shots` | event dan titik tembakan; simpan teks serta urutan sumber |
| `group_standings` | snapshot klasemen resmi per grup, tim, dan waktu pengambilan |
| `team_official_metrics` | BP, 2CP, dan metrik lain yang bersumber dari halaman resmi |
| `source_fetches`, `validation_issues`, `import_runs` | URL, waktu, hash, versi parser, hasil validasi, dan histori impor |

Gunakan kunci internal database dan batas unik untuk ID sumber, misalnya `(source, source_competition_id)` dan `(source, source_match_id)`. Semua tabel pertandingan wajib terkait kompetisi. Indeks utama mencakup kompetisi, tanggal/status laga, tim, pemain, dan grup. Simpan snapshot HTML terkompresi hanya ketika konten berubah, dengan kebijakan retensi, agar halaman sumber tetap bisa diaudit tanpa membuat Neon membesar karena unduhan berulang.

Gunakan koneksi pooled Neon untuk aplikasi dan impor rutin; koneksi direct hanya untuk migrasi schema. Semua kredensial berada di environment server, tidak di bundle browser atau Git.

## Strategi UI dari IBL Analytic

1. **Salin tampilan lebih dulu:** `dashboard` IBL Analytic menjadi basis visual dan komponen. Pertahankan struktur halaman sementara untuk memudahkan perbandingan tampilan.
2. **Ganti lapisan data:** query PDF/IBL dan asumsi satu liga diganti query StatsArena yang selalu menerima `competitionId`. Filter utama menjadi kompetisi; musim/tahun adalah metadata atau filter tambahan.
3. **Sesuaikan halaman:** Overview, Games, Teams, Players, dan detail pertandingan/tim/pemain memakai data Neon baru. Tambahkan tab klasemen per grup.
4. **Rapikan fitur:** sembunyikan atau hapus Lineups, Rotation, BPM, RAPM, dan fitur PDF yang belum punya sumber valid. Review tetap ada untuk menunjukkan masalah parsing. Shot chart hadir setelah validasi koordinat dan jumlah tembakan lolos.
5. **Pertahankan pola UX:** loading, empty, error, tautan ke sumber, filter di URL, tabel yang dapat disortir, tampilan mobile, dan penanda data yang belum lengkap.

Prioritas MVP: pemilih kompetisi → overview/jadwal → detail laga dan box score → klasemen grup → daftar/detail tim dan pemain → leaderboard hasil hitung → play by play → shot chart. BP/2CP resmi ditambahkan pada konteks yang sesuai tanpa menganggapnya metrik box score biasa.

## Tahapan kerja dan hasil yang dapat diperiksa

- [x] **Tahap 1 — Parser inti:** proyek TypeScript, fetcher, parser Fixtures, Teams, Players, Standings per grup, Summary, dan Box Score selesai. JSON terstruktur dan validasi lokal diuji dari kompetisi `49607` serta kompetisi kedua `49609`.
- [x] **Tahap 2 — Import Neon:** dua migrasi diterapkan pada Neon; 14 tabel aplikasi, foreign key, dan presisi durasi diperiksa. Dataset `49607` diimpor dua kali tanpa pertumbuhan record logis atau kegagalan penulisan. Lihat [hasil verifikasi Neon](./docs/NEON_VERIFICATION.md).
- [x] **Tahap 3 — Salin UI:** package Next.js lokal, tema/shell/navigasi responsif, enam route StatsArena, kontrak tampilan bertipe, filter kompetisi di URL, dan keadaan data belum tersedia selesai. Fondasi diverifikasi desktop/mobile; tidak membawa data, query, kredensial, atau konfigurasi deploy IBL. Lihat [panduan dashboard](./docs/DASHBOARD.md).
- [x] **Tahap 4 — Dashboard inti:** query server-only Drizzle membaca Neon StatsArena dengan scope kompetisi; Overview, Games dan detail, Teams dan detail, Players dan detail, Standings per grup, Review, filter URL, empty/error states, serta tautan sumber sudah diverifikasi pada dua kompetisi. Tidak ada query/kredensial IBL. Lihat [panduan dashboard](./docs/DASHBOARD.md).
- [x] **Tahap 5 — Data rinci:** parser bertipe untuk play by play, shot chart, Team Analysis, dan Team Statistics; migrasi serta impor transaksional/idempoten; detail pertandingan dengan filter URL, provenance, isu review, dan data untuk kedua kompetisi sudah diverifikasi. Laga `2931666` menampilkan 81 tembakan/24 masuk, cocok dengan FGA 41–40 dan FGM 9–15.
- [x] **Tahap 6 — Operasional:** runner sekali/berkala, konfigurasi aktif, discovery fixture bertahap dengan antrean lanjutan, retry, lock/lease, audit kegagalan, dan status dashboard selesai. Seluruh 64 test, lint, typecheck, build, dry-run live kedua kompetisi, migrasi `0003_sync_operations`, serta impor/impor ulang Neon lulus. Query langsung memastikan jumlah logis stabil, nol penulisan ulang statistik/detail identik, dan lease dilepas; lihat [panduan operasi](./docs/SYNC_OPERATIONS.md) dan [catatan verifikasi](./docs/NEON_VERIFICATION.md).

Perbaikan review Tahap 5 pada parser `0.2.1` memperketat perlindungan event PBP yang berkurang, chart yang tidak cocok dengan total resmi, serta sel/baris metrik yang hilang. Regresi impor dan cache diverifikasi lokal; schema Neon tidak berubah. Aturan dan batas koreksi penghapusan PBP dijelaskan di [panduan ingest](./docs/INGEST.md#perlindungan-data-rinci-versi-021).

## Kriteria selesai untuk versi pertama

Tambahan operasional 10 Oktober 2026: mode `--incremental` memeriksa ulang fixture dan hanya mengambil detail laga baru/berubah, live/unknown, atau yang belum valid/gagal. Penanda fixture asli dan validitas detail disimpan di Neon lewat migrasi `0004_incremental_sync`; baseline lama dibentuk sekali dari cache tervalidasi. Seluruh 68 test, lint, typecheck, build, migrasi Neon, bootstrap, dan dry-run normal dua kompetisi lulus. Detail tidak diproses ulang pada 35/25 laga yang tidak berubah. Koreksi detail yang tidak mengubah fixture tetap memerlukan sinkronisasi standar/refresh berkala. Lihat [mode incremental](./docs/SYNC_OPERATIONS.md#mode-incremental-hanya-detail-laga-baru-atau-berubah).

- Kompetisi `49607` dapat diimpor dan ditampilkan tanpa memasukkan ID tim/pemain/laga satu per satu.
- Satu kompetisi lain dapat didaftarkan melalui URL/ID dan berjalan pada pipeline serta UI yang sama.
- Jumlah tim, pemain, pertandingan, dan grup di Neon cocok dengan halaman sumber pada waktu sinkronisasi.
- Box score contoh `2931666` menunjukkan skor 25–45; 41 dan 40 FGA; shot chart valid berjumlah 81 titik dengan 24 *made*.
- Klasemen Grup A dan B menampilkan tiga tim masing-masing sesuai halaman resmi, dengan urutan yang sama.
- Pengambilan ulang tidak menghasilkan duplikasi; kegagalan parser dan selisih validasi terlihat di halaman Review/log impor.
- Dashboard mengambil data dari Neon, tanpa akses langsung dari browser ke Genius Sports atau kredensial database.
