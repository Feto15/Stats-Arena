# Perbandingan FIBA LiveStats dan portal Genius Sports

Catatan lanjutan: setelah investigasi di bawah, pengguna mengizinkan implementasi pelengkap LiveStats dan pembaruan laga lama. Adapter kini tersedia; lihat [LIVESTATS.md](./LIVESTATS.md) dan [hasil Neon](./NEON_VERIFICATION.md). Pernyataan “belum diimplementasikan/tidak ada ingest” pada isi investigasi adalah status saat observasi awal.

Pembaruan 17 Oktober 2026: perbandingan PBP pada pertandingan DBL yang sama dan potensi pengembangan rotasi dicatat pada [bagian PBP dan rotasi](#perbandingan-pbp-dan-potensi-rotasi--17-oktober-2026). PBP dashboard saat ini masih berasal dari portal; pemeriksaan tersebut tidak mengganti sumber atau mengimplementasikan rotasi. Metrik tim PIP/PFT/FBP kini juga diambil dari portal bila tersedia, dengan LiveStats sebagai cadangan; rincian operasional terbaru ada di [LIVESTATS.md](./LIVESTATS.md).

Observasi **16 Oktober 2026**, untuk satu pertandingan: **2783625**, Tangerang Hawks Basketball Club vs Satya Wacana Salatiga, **85–59**, 10 Januari 2026, Indomilk Arena. Kompetisinya **IBL Gopay 2026 (`47793`)**, bukan All Indonesian. Hasil ini belum membuktikan kelengkapan seluruh pertandingan atau musim.

Ini investigasi sumber. Tidak ada ingest Neon, penambahan kompetisi aktif, atau perubahan parser dari pemeriksaan ini. LiveStats dan portal merupakan dua tampilan dari penyedia Genius Sports.

## Tujuh halaman LiveStats

Ketujuh URL yang diberikan merespons HTTP 200 saat diperiksa. Box Score dan Statistics juga diperiksa setelah datanya tampil di browser.

| Halaman | Isi |
|---|---|
| [index.html](https://fibalivestats.dcd.shared.geniussports.com/u/IBL/2783625/index.html) | Ringkasan skor/kuarter, starter, pemain di lapangan, pemimpin statistik, perbandingan tim. |
| [bs.html](https://fibalivestats.dcd.shared.geniussports.com/u/IBL/2783625/bs.html) | Box score pemain dan tim, starter/bench, posisi bila diisi, plus/minus, blocks received, fouls on, Index of Success. |
| [lds.html](https://fibalivestats.dcd.shared.geniussports.com/u/IBL/2783625/lds.html) | Pemimpin statistik pertandingan, termasuk poin, rebound, assist, steal, dan block. |
| [pbp.html](https://fibalivestats.dcd.shared.geniussports.com/u/IBL/2783625/pbp.html) | Kronologi aksi, kuarter, waktu, skor berjalan, dan pergantian pemain. |
| [sc.html](https://fibalivestats.dcd.shared.geniussports.com/u/IBL/2783625/sc.html) | Shot chart dengan pilihan tim, pemain, periode, dan hasil tembakan. |
| [st.html](https://fibalivestats.dcd.shared.geniussports.com/u/IBL/2783625/st.html) | Perbandingan statistik tim, perkembangan skor, serta grafik perbandingan dan tembakan. |
| [p.html](https://fibalivestats.dcd.shared.geniussports.com/u/IBL/2783625/p.html) | Preview, perbandingan rata-rata kompetisi, head-to-head, hasil terkini, dan klasemen. Angka preview tidak boleh dianggap otomatis sebagai statistik laga ini. |

## Perbandingan data pada pertandingan yang sama

Pembanding portal: [Summary](https://hosted.dcd.shared.geniussports.com/IBL/en/competition/47793/match/2783625/summary), [Box Score](https://hosted.dcd.shared.geniussports.com/IBL/en/competition/47793/match/2783625/boxscore), [PBP](https://hosted.dcd.shared.geniussports.com/IBL/en/competition/47793/match/2783625/playbyplay), [Shot Chart](https://hosted.dcd.shared.geniussports.com/IBL/en/competition/47793/match/2783625/shotchart), [Team Analysis](https://hosted.dcd.shared.geniussports.com/IBL/en/competition/47793/match/2783625/analysis), dan [statistik tim kompetisi](https://hosted.dcd.shared.geniussports.com/IBL/en/competition/47793/statistics/team).

| Data | Portal HTML sampel | LiveStats sampel |
|---|---|---|
| Skor akhir | 85–59 | 85–59 |
| Baris pemain | 24 | 24 |
| Statistik dasar | PTS, FG, 3P, FT, rebound, AST, STL, BLK, TO, PF | Sama, ditambah kolom 2P eksplisit |
| Plus/minus pemain | Tidak ada kolomnya | Ada nilai pada 24 pemain |
| Starter/bench | Tidak ada penanda pada box score | Ada, lima starter tiap tim |
| Posisi | Tidak ada kolom pada box score | Diisi untuk 12 pemain Satya Wacana; 12 pemain Hawks kosong |
| Blocks received / fouls on | Tidak ada kolom pada box score | Ada |
| Index of Success | Tidak ada kolom pada box score | Ada, halaman memakai field `eff_5` |
| BP dan 2CP per laga | Tidak disediakan layout Team Analysis sampel | Ada |
| BP dan 2CP kompetisi | Ada pada Team Statistics | Preview memiliki data agregat tersendiri; cakupannya perlu dibaca per field |
| PBP | 588 event, termasuk pergantian | 588 event dengan atribut aksi dan referensi pemain lokal |
| Shot chart | 146 tembakan | 146 tembakan, 55 masuk |
| ID pemain | ID person pada tautan portal | Kunci pemain lokal pertandingan; belum terbukti sama dengan ID person portal |

Seluruh 17 statistik hitung dasar yang dibandingkan cocok untuk 24 pemain dan kedua total tim: PTS, FGM/FGA, 2PM/2PA, 3PM/3PA, FTM/FTA, REB/ORB/DRB, AST, STL, BLK, TO, PF. Angka 2P portal dibandingkan setelah dihitung dari FG dikurangi 3P sesuai aturan parser. Kesamaan jumlah event/tembakan bukan bukti bahwa setiap atribut event/koordinat identik.

### Contoh angka tambahan yang benar-benar terisi

Plus/minus: **J. Dos Santos +28**, **J. Cunningham +21**, **G. Risky +23**, dan **K. Kangu −18**. Keempatnya ditandai starter pada data LiveStats.

| Metrik resmi laga | Tangerang Hawks | Satya Wacana |
|---|---:|---:|
| BP — Bench points | 9 | 4 |
| 2CP — Second chance points | 17 | 10 |
| PIP — Points in the paint | 40 | 40 |
| PFT — Points from turnovers | 14 | 12 |
| FBP — Fast break points | 16 | 15 |
| Keunggulan terbesar | 28 | 2 |
| Rentetan poin terbesar | 11 | 7 |

Sumber juga mencatat dua pergantian keunggulan dan satu keadaan seri. JSON memisahkan rebound pemain dan team rebounds: Hawks 46 + 7 = 53; Satya Wacana 29 + 8 = 37. Jangan menyamakan jumlah rebound baris pemain dengan total tim tanpa komponen ini.

## Cara halaman mengambil data

HTML awal LiveStats berisi template dengan banyak sel kosong. Halaman memuat `datapath=/data/2783625/`; script publik [ajload_2.js](https://fibalivestats.dcd.shared.geniussports.com/resources/js/ajload_2.js?v=1.5.0) mengambil `data.json` dari path tersebut.

Dataset yang benar-benar diperiksa: [data pertandingan 2783625](https://fibalivestats.dcd.shared.geniussports.com/data/2783625/data.json), HTTP 200, 453.848 byte. Bagian utamanya meliputi `tm`, `pbp`, `leaddata`, `scorers`, `totallds`, informasi kuarter/waktu, serta officials. Statistik pemain berada di dalam tim; tembakan juga disertakan dalam data tim. Beberapa bagian kosong, misalnya `timeline`; keberadaan nama field bukan bukti bahwa isinya tersedia.

Implikasi untuk adapter mendatang: Cheerio dapat membaca metadata dan menemukan path data dari HTML, lalu fetch JSON publik dan validasi dengan schema. Membaca tabel HTML awal saja tidak cukup. Beberapa tampilan memakai dataset yang sama sehingga tidak perlu memperlakukan ketujuh tab sebagai tujuh dataset independen. Adapter ini **belum diimplementasikan** dan domain LiveStats belum masuk allowlist fetcher produksi.

## Perbedaan dan batas yang harus dipertahankan

- **Durasi:** 13 dari 24 pemain berbeda satu detik antara portal dan LiveStats. Contoh J. Dos Santos: `30:55` vs `30:56`. Penyebabnya belum diverifikasi; pertahankan nilai mentah dan asal sumber.
- **Persentase:** Hawks FG tampil `41.7%` pada portal dan `41%` pada LiveStats meskipun keduanya memiliki 30/72. Untuk tampilan konsisten, persentase dapat dihitung dari made/attempts sebagai angka turunan terpisah.
- **Durasi total:** JSON memuat contoh `199:60`; format ini memerlukan validasi, bukan normalisasi diam-diam memakai aturan menit standar.
- **Identitas:** `tno` dan `pno` adalah referensi lokal laga pada dataset yang diperiksa. Jangan menggunakannya sebagai ID global atau menggabungkan pemain berdasarkan nama saja. Pencocokan 24 baris pada investigasi ini memakai kombinasi tim, nomor, dan nama sebagai pembanding observasi; belum menjadi bukti pemetaan identitas produksi.
- **Pergantian:** ada 150 aksi `substitution` dengan `in/out`. Starter dan pergantian membuka kemungkinan menyusun lineup/rotation, tetapi kelengkapan serta konsistensi lima pemain di lapangan belum diverifikasi. Belum menjadi dasar klaim BPM/RAPM tersedia.
- **Urutan PBP:** simpan urutan sumber, `actionNumber`, waktu mentah, periode, serta referensi pemain/tim; aksi pada waktu sama tidak boleh digabung atau diurutkan ulang tanpa aturan terbukti.
- **Koordinat:** simpan X/Y mentah, hasil, periode, dan referensi aksi tembakan. Orientasi, rotasi, dan skala fisik lapangan belum dibuktikan.
- **Index:** halaman menamai metrik `Index of Success` dan memakai `eff_5`. Rumusnya belum diverifikasi; jangan menggantinya dengan EFF, BPM, atau rumus lain berdasarkan nama.
- **Cakupan:** ketersediaan plus/minus/BP/2CP pada sampel Gopay tidak menjamin pertandingan DBL atau All Indonesian menyediakan field yang sama. Nilai kosong tetap unavailable/null.

## Saran pembagian sumber

Kandidat paling berguna adalah mempertahankan portal untuk penemuan kompetisi/jadwal, identitas global, dan klasemen, lalu menilai LiveStats sebagai pelengkap detail laga seperti plus/minus, starter, serta BP/2CP. Sebelum implementasi, verifikasi tautan LiveStats dari sumber, pemetaan identitas, scope setiap field, kualitas data, dan aturan prioritas saat kedua tampilan berbeda. Investigasi ini belum menetapkan pergantian sumber ingest.

## Pemeriksaan tambahan DBL — namespace IBF

Pada 16 Oktober 2026, pola yang sama juga berhasil diakses untuk DBL. Contoh box score memakai `/u/IBF/<MATCH_ID>/bs.html`, sedangkan HTML memuat `datapath=/data/<MATCH_ID>/`. JSON tidak memakai segmen `IBF` dalam path. Tiga halaman box score beserta tiga JSON yang diperiksa semuanya merespons HTTP 200 dan cocok identitas kompetisi/pertandingannya.

| Sampel | Skor | Pemain / nilai plus-minus | Starter | Event PBP | Tembakan |
|---|---|---|---|---:|---:|
| [2931666 — Jogja putra](https://fibalivestats.dcd.shared.geniussports.com/u/IBF/2931666/bs.html), kompetisi 49607 | Kolese De Britto 25–45 Olifant | 24 / 24 | 5 tiap tim | 548 | 81 |
| [2915281 — Jogja putri](https://fibalivestats.dcd.shared.geniussports.com/u/IBF/2915281/bs.html), kompetisi 49609 | SMAN 8 Yogyakarta 28–3 SMAN 6 Yogyakarta | 24 / 24 | 5 tiap tim | 466 | 57 |
| [2923393 — Jateng South putra](https://fibalivestats.dcd.shared.geniussports.com/u/IBF/2923393/bs.html), kompetisi 49403 | Pelita Nusantara Kasih Surakarta 63–6 SMAN 2 Surakarta | 21 / 21 | 5 tiap tim | 399 | 76 |

Jumlah di tabel adalah observasi JSON LiveStats saat pemeriksaan, bukan hasil impor Neon atau pernyataan bahwa seluruh dataset portal identik. Tujuh tab `index`, `bs`, `lds`, `pbp`, `sc`, `st`, dan `p` untuk 2931666 semuanya terverifikasi HTTP 200; enam tab selain box score untuk dua sampel lain belum diperiksa satu per satu.

Sumber JSON: [2931666](https://fibalivestats.dcd.shared.geniussports.com/data/2931666/data.json), [2915281](https://fibalivestats.dcd.shared.geniussports.com/data/2915281/data.json), dan [2923393](https://fibalivestats.dcd.shared.geniussports.com/data/2923393/data.json). Ketiganya memiliki `tm`, `pbp`, statistik pemain, starter, plus/minus, dan tembakan dengan struktur utama serupa sampel IBL.

Untuk laga 2931666, BP resmi adalah **3–28**, 2CP **4–7**, PIP **16–24**, PFT **13–22**, dan FBP **5–11**. Contoh plus/minus: S. Wijaya **−9**, I. Wiguna **−15**, A. Ataullah **+8**. Angka tersebut tersedia langsung pada JSON, bukan hasil rekonstruksi dari PBP. BP/2CP juga terisi pada dua sampel lain: 2915281 memiliki BP 0–1 dan 2CP 4–1; 2923393 memiliki BP 30–2 dan 2CP 8–2. Nol di sini merupakan nilai eksplisit.

Posisi terisi pada 24/24 pemain di kedua sampel Jogja dan 20/21 pemain pada sampel South. Tembakan yang difilter 2PT/3PT cocok dengan total FGA/FGM masing-masing tim pada ketiga JSON; koordinat numerik dan periode positif tersedia pada marker yang diperiksa. Hal ini tidak menutup semua jenis anomali, tidak menyelesaikan isu portal/Neon lama secara otomatis, dan belum menguji ketepatan orientasi lapangan atau identitas global pemain.

Temuan ini memperluas bukti ketersediaan LiveStats ke sampel DBL putra dan putri, tetapi bukan jaminan semua musim/laga mendukungnya. Tidak ada perubahan parser, konfigurasi runner, status kualitas Neon, atau ingest dari pemeriksaan ini.

## Perbandingan PBP dan potensi rotasi — 17 Oktober 2026

### Lingkup dan bukti pemeriksaan

Pemeriksaan ini membaca ulang fixture lokal pertandingan **2931666**, kompetisi **49607**, SMA Kolese De Britto vs SMA Olifant, skor **25–45**. Portal dan LiveStats diambil pada waktu berbeda: HTML portal dari snapshot 8 Oktober dan JSON LiveStats dari snapshot 16 Oktober. Ini perbandingan isi snapshot, bukan pengambilan live serentak atau jaminan seluruh atribut/event pada semua pertandingan identik.

| Sumber | Fixture lokal | Provenance |
|---|---|---|
| Portal PBP | `ingest/test/fixtures/live-2026-10-08/49607-2931666-playbyplay.html.gz` | [Manifest portal](../ingest/test/fixtures/live-2026-10-08/manifest.json); [halaman sumber](https://hosted.dcd.shared.geniussports.com/IBF/en/competition/49607/match/2931666/playbyplay) |
| LiveStats JSON | `ingest/test/fixtures/livestats-2026-10-16/2931666.json.gz` | [Manifest LiveStats](../ingest/test/fixtures/livestats-2026-10-16/manifest.json); [JSON sumber](https://fibalivestats.dcd.shared.geniussports.com/data/2931666/data.json) |

### Perbedaan yang benar-benar ditemukan

| Informasi | Portal HTML sampel | LiveStats JSON sampel |
|---|---|---|
| Jumlah event | 548 | 548 |
| Periode dan waktu rinci | Ada, misalnya `P4`, `00:26:10` | Ada melalui `period`, `periodType`, `gt`, `clock`; presisi waktu tetap mentah sampai formatnya dibuktikan |
| Jenis aksi | Kelas seperti `pbptysubstitution`, teks aksi | Field `actionType`, misalnya `substitution`, `2pt`, `foul`, `turnover` |
| Rincian tembakan/turnover/foul | Ada dalam teks, misalnya `2pt driving layup`, `Turnover - bad pass` | Field `subType`, misalnya `drivinglayup`, `badpass`, `technical` |
| Pemain | Nama dan nomor dalam teks | Nama, nomor jersey dan referensi lokal `pno`; bukan ID global portal |
| ID pemain eksplisit pada event | Tidak ada tautan person yang dapat dibaca pada seluruh 548 event sampel; hasil parser `playerSourceId=null` | `pno` tersedia sebagai field; event tanpa pelaku pemain tetap harus dibedakan dari identitas pemain yang valid |
| Tim | Dapat dipetakan ke tautan ID tim sumber melalui struktur halaman/logo | Referensi lokal `tno` yang harus dipetakan ke tim pertandingan |
| Pergantian masuk/keluar | Ada, berupa teks `Substitution in/out` | Ada sebagai pasangan `actionType=substitution`, `subType=in/out` |
| Skor berjalan | Ditampilkan pada 53 dari 548 elemen event; event lain tidak mempunyai skor eksplisit di elemen itu | Field `s1`/`s2` terisi pada seluruh 548 event, ditambah `lead` |
| Nomor aksi sumber | Elemen event yang diperiksa tidak memuat nomor aksi; parser menyimpan urutan HTML sebagai `sourceSequence` | `actionNumber` tersedia; urutan array mentah tetap harus disimpan, dan nomor aksi tidak boleh diasumsikan berurutan tanpa celah |
| Referensi aksi sebelumnya | Tidak tersedia pada elemen event yang diperiksa | `previousAction` bila diisi; contoh rebound merujuk nomor aksi tembakan |
| Penanda konteks | Paint/fast break/second chance tidak ditemukan dalam teks event HTML sampel | `qualifier` dapat memuat `pointsinthepaint`, `fastbreak`, `2ndchance`, `fromturnover`, `blocked`, dan penanda lain |
| Hasil tembakan | Dapat dibaca dari teks seperti `made`; ketiadaan kata tertentu perlu aturan parsing yang dibuktikan | Field `success` pada aksi tembakan; flag `scoring` sendiri tidak berarti tembakan masuk |

Jumlah event yang sama belum membuktikan setiap aksi, urutan, identitas dan atribut sama. Nilai skor portal yang kosong tidak boleh langsung menjadi nol. Skor yang dibawa maju dari event sebelumnya merupakan hasil turunan yang memerlukan aturan tersendiri.

### Contoh pergantian yang tersedia di kedua sumber

Pada kuarter 4, waktu mentah **00:26:10**, portal memuat:

- `11, Jason Nathan MARCELLO, Substitution out`
- `4, Sebastian Emmanuel WIJAYA, Substitution in`

JSON LiveStats merepresentasikan aksi yang sama pada field terpisah:

| Pemain | `tno` | `pno` lokal | `actionType` | `subType` | `actionNumber` |
|---|---:|---:|---|---|---:|
| J. Marcello, jersey 11 | 1 | 8 | substitution | out | 767 |
| S. Wijaya, jersey 4 | 1 | 1 | substitution | in | 768 |

Jadi pergantian bukan fitur yang hanya ada di LiveStats. Keuntungan JSON adalah bentuk informasinya sudah terpisah, sehingga parser tidak harus mengekstrak nama, nomor dan kata `in/out` dari satu kalimat. Referensi pemain lokal juga memungkinkan pengaitan antar event setelah pemetaan identitas berhasil. Ini mengurangi kebutuhan membaca teks/struktur tampilan, tetapi tidak menghilangkan kebutuhan validasi.

### Apa yang dimaksud rotasi dan mengapa bisa diolah

**Rotasi** adalah riwayat kapan setiap pemain berada di lapangan atau di bangku cadangan. **Lineup** adalah kombinasi lima pemain satu tim yang berada di lapangan pada suatu rentang waktu. **Stint** adalah rentang waktu ketika kombinasi tersebut tetap sama.

Alur calon perhitungan:

1. Tentukan lima pemain awal berdasarkan bukti sumber yang lengkap.
2. Baca aksi menurut urutan sumber yang terverifikasi, dengan periode dan waktu mentah tetap disimpan.
3. Saat pergantian terjadi, tutup rentang lineup sebelumnya, keluarkan pemain `out`, lalu masukkan pemain `in`.
4. Jika beberapa pergantian terjadi pada waktu yang sama, proses sebagai satu kelompok setelah urutan/batasnya dibuktikan. Jangan menghitung keadaan sementara berisi empat/enam pemain sebagai lineup nyata.
5. Simpan rentang lineup berikutnya. Hitung durasi dan perubahan skor hanya pada rentang yang batas serta identitasnya pasti.

Contoh sederhana: lineup `A, B, C, D, E` berubah menjadi `A, B, C, D, F` ketika `E keluar` dan `F masuk`. Urutan ini dapat digunakan untuk menggambar baris waktu setiap pemain serta menghitung berapa lama kombinasi bermain bersama. JSON menyediakan kode aksi dan referensi pemain secara terpisah sehingga langkah ini lebih langsung daripada membaca teks HTML untuk setiap pergantian.

### Potensi fitur, belum diimplementasikan

| Fitur | Informasi yang dapat ditampilkan | Prasyarat |
|---|---|---|
| Timeline rotasi pemain | Kapan bermain/istirahat pada tiap periode | Starter dan seluruh pergantian pada rentang terkait terverifikasi |
| Durasi stint | Lama setiap rangkaian bermain tanpa pergantian | Waktu, batas periode, serta urutan event konsisten |
| Statistik lineup lima pemain | Menit bersama, poin tim/lawan, selisih skor selama lineup aktif | Kedua lineup dan posisi event skor terhadap pergantian dapat dipastikan |
| Kombinasi dua/tiga pemain | Menit bersama dan statistik deskriptif saat kombinasi aktif | Riwayat lineup tervalidasi |
| Perbandingan on/off | Performa tim saat pemain di lapangan dibanding saat beristirahat | Cakupan rentang cukup lengkap; hasil bersifat deskriptif dan tidak membuktikan sebab-akibat |
| Lawan yang dihadapi | Pemain/kombinasi lawan yang bermain pada waktu bersamaan | Lineup kedua tim terverifikasi |
| Filter event/tembakan menurut lineup | Aksi yang terjadi saat kombinasi tertentu bermain | Pemetaan event/tembakan, waktu dan lineup konsisten; sumber tidak boleh dicampur berdasarkan nama saja |

Menit dan selisih skor dapat menjadi langkah awal setelah validasi. Rating per possession membutuhkan aturan possession dan batas event tambahan. Data ini tidak otomatis menghasilkan BPM, RAPM, atau penilaian kualitas pemain yang andal; model, metodologi dan kecukupan sampelnya perlu pekerjaan tersendiri.

### Validasi yang diperlukan sebelum membuat fitur

- Pemetaan pemain harus menjaga scope namespace/kompetisi/laga dan memakai bukti identitas yang cukup. `pno` yang sama pada pertandingan berbeda tidak otomatis pemain yang sama.
- Penanda starter satu pertandingan belum cukup untuk memastikan lima pemain awal pada setiap kuarter atau overtime. Awal tiap periode harus mempunyai bukti lineup atau ditandai belum diketahui.
- Setiap pergantian harus masuk akal: pemain keluar sedang berada di lapangan, pemain masuk belum aktif, dan setelah satu kelompok pergantian yang lengkap terdapat lima pemain berbeda tiap tim.
- Waktu sama, koreksi event, urutan array yang terbalik, celah `actionNumber`, serta aksi skor tepat pada waktu pergantian harus dipertahankan dan diperiksa. Jangan menetapkan siapa menerima poin plus/minus bila urutannya ambigu.
- Cocokkan durasi pemain dengan box score sesuai presisi sumber. Total player-minutes satu tim harus mendekati lima kali durasi laga termasuk overtime, dengan toleransi yang didefinisikan; jangan mengubah angka resmi agar cocok.
- Cocokkan skor akhir, scoring events dan jumlah waktu yang tercakup. Interval dengan pergantian/identitas yang hilang ditandai tidak pasti dan dikeluarkan dari hasil lineup yang mengklaim lengkap.
- Pisahkan angka resmi sumber, hasil hitung rotasi/lineup, versi metode, dan provenance snapshot. Jangan mengganti dataset PBP portal atau menghapus event lama untuk memaksakan kecocokan.

**Status saat penulisan:** adapter tambahan box score/metrik LiveStats sudah ada. PBP LiveStats belum diimpor sebagai dataset event, belum ada fallback PBP otomatis, dan rotasi/lineup belum dihitung atau ditampilkan. Snapshot JSON mentah memang memuat data PBP, tetapi keberadaan snapshot tidak berarti fitur analitik tersebut sudah tersedia. PBP dashboard tetap memakai portal. Bagian ini adalah catatan observasi dan kemungkinan pengembangan, bukan persetujuan implementasi tahap baru.
