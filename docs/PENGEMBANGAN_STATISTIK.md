# Pengembangan Statistik Tim dan Pemain

Tanggal pencatatan: 18 Oktober 2026.

Pembaruan 22 Oktober 2026: modul rumus bersama dan JSON analisis otomatis sudah diimplementasikan. Shooting, EFF/Game Score, rasio, normalisasi per 40, estimasi persentase pemain, dan rating tim tersedia di JSON; query metrik pemain dashboard yang sudah ada memakai definisi yang sama. Tambahan kolom UI, profil PIP/FBP/2CP pada JSON analisis, serta lineup/on-off masih pengembangan berikutnya. Lihat [rumus, cara ekspor, dan batas data](./ANALYTICS.md).

Bagian usulan di bawah merupakan catatan rancangan awal. Status implementasi terkini mengikuti pembaruan di atas; ketersediaan rumus JSON tidak berarti semua metrik sudah ditampilkan di dashboard.

## 1. Statistik yang sudah tersedia juga merupakan pengembangan StatsArena

**eFG%, TS%, EFF, dan AST/TO pemain sudah tersedia sebagai hasil perhitungan StatsArena dari data box score resmi.** Untuk tambahan, rekomendasinya dicatat pada bagian tim dan individu di bawah.

Makna **sudah tersedia** adalah rumusnya sudah diimplementasikan pada query server dashboard. Ini tetap merupakan fitur analitik yang dikembangkan StatsArena. Angka dasar seperti PTS, FGM, FGA, FTM, FTA, REB, AST, STL, BLK, dan TOV berasal dari sumber; nilai metrik berikut dihasilkan melalui perhitungan aplikasi.

| Metrik yang sudah tersedia | Rumus implementasi | Jenis nilai |
| --- | --- | --- |
| eFG% pemain | `100 × (ΣFGM + 0.5 × Σ3PM) / ΣFGA` | Hasil hitung StatsArena |
| TS% pemain | `100 × ΣPTS / [2 × (ΣFGA + 0.44 × ΣFTA)]` | Hasil hitung StatsArena, dengan faktor estimasi FT |
| EFF per laga | Rata-rata `PTS + REB + AST + STL + BLK − (FGA − FGM) − (FTA − FTM) − TOV` | Hasil hitung StatsArena |
| AST/TO | `ΣAST / ΣTOV` | Hasil hitung StatsArena |

Rumus tersebut memakai cakupan laga selesai sesuai query. Persentase dan rasio dihitung dari total input pada cakupan yang sama. Penyebut nol atau input yang tidak lengkap menghasilkan `null`/“—” sesuai aturan query. Presisi dipertahankan sampai penyajian.

Jadi, **data dasar resmi** dan **metrik hasil perhitungan** memiliki asal yang berbeda dan perlu diberi label. Nilai eFG%, TS%, EFF, atau AST/TO yang dihitung StatsArena tidak boleh disebut angka resmi yang diimpor dari Genius Sports hanya karena inputnya resmi. Jika suatu halaman sumber menyediakan metrik bernama sama, simpan dan tampilkan asal serta definisinya secara terpisah. EFF hasil hitung juga tidak otomatis sama dengan `indexOfSuccess` resmi dari LiveStats.

Rincian implementasi saat ini: [query statistik pemain](../dashboard/lib/data/queries.ts), [metodologi dashboard](./DASHBOARD.md#players-statistik-dan-kelompok-kolom), dan [modul bersama/JSON](./ANALYTICS.md), versi rumus `statsarena-analytics/1.0.0`.

## 2. Usulan statistik level tim

Rumus box score pada tabel berikut kini tersedia pada JSON analisis sesuai [ANALYTICS.md](./ANALYTICS.md). Penyajian UI tambahan dan profil metrik resmi PIP/FBP/2CP dalam JSON tetap usulan; keberadaan input di Neon tidak membuktikan seluruh fitur tampilan sudah tersedia.

| Statistik | Kegunaan | Input dan catatan |
| --- | --- | --- |
| **ORtg, DRtg, NetRtg** | Membandingkan efisiensi serangan, pertahanan, dan selisih keduanya | Poin kedua tim dan possession dalam cakupan yang sama. Labeli **estimasi** bila possession ditaksir dari box score. NetRtg = ORtg − DRtg. |
| **eFG% dan eFG% lawan** | Membandingkan efisiensi hasil tembakan tim dengan lawannya | FGM, 3PM, dan FGA kedua tim; tersedia di JSON analisis tim. |
| **TOV%** | Mengukur frekuensi kehilangan bola relatif terhadap aktivitas serangan | TOV dan penyebut sesuai metode yang dipilih. Dokumentasikan apakah penyebut berupa estimasi possession atau aktivitas penyelesaian serangan. |
| **ORB% / DRB%** | Mengukur kemampuan menguasai rebound yang tersedia | Rebound ofensif/defensif tim dan lawan; ikuti total tim resmi serta perlakuan team rebounds yang terdokumentasi. |
| **FT Attempt Rate — FTA/FGA** | Melihat frekuensi memperoleh lemparan bebas relatif terhadap percobaan tembakan | FTA dan FGA. Tetapkan tampilan sebagai rasio atau persen; jangan mencampurkan definisi FTA/FGA dengan FTM/FGA. |
| **3P Attempt Rate — 3PA/FGA** | Melihat kecenderungan memakai tembakan tiga angka | 3PA dan FGA; berbeda dari akurasi 3P%. |
| **Profil sumber poin** | Menampilkan porsi poin dari 2P, 3P, FT, paint, fast break, dan second chance | Poin 2P/3P/FT dapat dihitung dari made. PIP/FBP/2CP menggunakan angka resmi dengan scope pertandingan yang benar. |

eFG%, turnover, rebound, dan free throw merupakan kelompok analisis **Four Factors**, yang membantu menjelaskan hasil pertandingan. Varian rumus dan penyebut tetap harus ditetapkan secara eksplisit; lihat [Four Factors — Basketball Reference](https://www.basketball-reference.com/about/factors.html).

Poin dari 2P, 3P, dan FT membentuk pembagian total poin. PIP, FBP, dan 2CP dapat saling bertumpang tindih dan juga termasuk dalam pembagian tersebut. Jangan menjumlahkan seluruh kategori menjadi satu total atau satu pie chart yang menganggap semuanya saling terpisah.

Untuk metrik tim resmi, pertahankan prioritas yang sudah berlaku: angka portal laga yang valid, kemudian LiveStats terverifikasi sebagai cadangan per tim/per metrik. Persentase kontribusi yang dihitung dari angka tersebut tetap merupakan hasil hitung StatsArena.

### Tambahan metrik lawan — catatan pengembangan 22 Oktober 2026

**Metrik lawan** memakai statistik tim lawan hanya pada pertandingan melawan tim yang sedang dianalisis. Contohnya, untuk Tim A, TS% lawan dihitung dari gabungan statistik seluruh lawan saat menghadapi Tim A. Ini membantu membaca profil pertahanan Tim A dengan mempertimbangkan jumlah serta kualitas lawan yang dihadapi.

| Metrik | Makna | Rumus dari total lawan pada cakupan laga Tim A |
| --- | --- | --- |
| **TS% lawan — estimasi** | Efisiensi lawan mencetak poin melalui field goal dan free throw saat menghadapi Tim A | `100 × OppPTS / [2 × (OppFGA + 0.44 × OppFTA)]` |
| **TOV% lawan — estimasi** | Frekuensi kehilangan bola lawan relatif terhadap aktivitas penyelesaian serangannya saat menghadapi Tim A | `100 × OppTOV / (OppFGA + 0.44 × OppFTA + OppTOV)` |
| **3P attempt rate lawan** | Porsi percobaan field goal lawan yang berupa tembakan tiga angka | `Opp3PA / OppFGA` |
| **FT attempt rate lawan** | Banyaknya percobaan free throw lawan dibanding percobaan field goal | `OppFTA / OppFGA` |

Contoh pembacaan: TS% lawan yang rendah berarti lawan mencetak poin dengan efisiensi tembakan rendah pada laga-laga tersebut. TOV% lawan yang tinggi menunjukkan lawan lebih sering kehilangan bola relatif terhadap aktivitas penyelesaian serangannya. Angka tersebut perlu dibaca bersama konteks lawan dan cakupan laga; tidak otomatis membuktikan seluruh selisih disebabkan pertahanan Tim A.

**Status saat dicatat:** input dasar sudah tersedia pada `teams[].opponentTotals` di JSON analisis. eFG% lawan sudah diekspor sebagai `advancedStats.opponentEffectiveFieldGoalPercentage`. Empat metrik tambahan dalam tabel di atas **belum dihitung/diekspor sebagai field khusus** dan belum ditambahkan ke UI. Bagian ini mencatat rencana, tanpa mengubah implementasi.

Pengembangan dapat memakai input yang sudah ada tanpa mengambil HTML ulang, selama input wajib lengkap. Hitung dari total pembilang/penyebut pada game IDs yang sama, bukan rata-rata persentase per laga atau statistik lawan dari seluruh kompetisinya. Input hilang atau penyebut nol menghasilkan `null`. TS%/TOV% memakai unit persen 0–100; attempt rate memakai rasio pecahan, misalnya `0.25`.

## 3. Usulan statistik level individu

| Statistik | Kegunaan | Input dan catatan |
| --- | --- | --- |
| **USG% — estimasi** | Memperkirakan porsi penyelesaian serangan pemain melalui tembakan, FT, atau turnover | Statistik pemain, total tim, dan menit bermain. USG% tidak mencakup seluruh bentuk kontribusi serangan, misalnya assist. |
| **TOV%** | Membandingkan kehilangan bola dengan aktivitas penyelesaian serangannya | TOV, FGA, dan FTA menurut rumus yang dipilih; labeli penyebutnya dengan jelas. |
| **AST% — estimasi** | Memperkirakan kontribusi assist terhadap tembakan masuk rekan saat pemain bermain | Assist, FGM pemain/tim, dan menit. Ini berbeda dari pembagian AST pemain dengan total AST tim. |
| **ORB%, DRB%, TRB% — estimasi** | Menilai kemampuan rebound dengan mempertimbangkan menit dan peluang rebound | Rebound pemain, rebound tim/lawan, serta menit. Penghitungan berbasis box score merupakan estimasi peluang selama pemain bermain. |
| **PTS/REB/AST per 40 menit** | Membandingkan produksi pemain dengan menit bermain berbeda | Total statistik dibagi total menit valid, dikali 40. Ini normalisasi produksi, bukan prediksi performa jika pemain benar-benar bermain 40 menit. |
| **3PA/FGA dan FTA/FGA** | Melihat profil tembakan dan kecenderungan memperoleh FT | Total attempts pemain pada cakupan yang sama; bedakan rasio percobaan dari akurasi tembakan. |

Definisi persentase pemain perlu mengikuti satu metodologi yang konsisten. Rujukan: [Glosarium Basketball Reference](https://www.basketball-reference.com/about/glossary.html). Rumus, versi, input wajib, perlakuan menit, dan cakupan laga harus ditetapkan sebelum implementasi.

Tampilkan total GP, total menit, dan minimum menit yang dipakai untuk peringkat, khususnya statistik per 40 menit. Pemain dengan menit sangat sedikit tidak boleh dianggap memiliki bukti performa setara pemain dengan sampel besar. Perhitungan rasio tetap menggunakan presisi penuh, bukan menit atau persentase yang sudah dibulatkan di tampilan.

### Tambahan resmi dari LiveStats yang sudah didukung adapter

Adapter sudah memiliki field berikut. Ketersediaan aktual tetap bergantung pada validasi sumber dan pemetaan pemain; keberadaan field adapter tidak membuktikan bahwa semua pemain atau halaman dashboard sudah menampilkannya.

- **+/−**.
- **Starter** dan posisi bila tersedia.
- **Fouls drawn** dan **blocks received**.
- **Points in the paint**, **fast-break points**, dan **second-chance points** pemain.
- **Index of Success** resmi, dengan definisi/sumbernya sendiri.

Ini merupakan angka atau penanda resmi yang dibaca dari LiveStats. Nilai yang tidak tersedia tetap `null`; jangan menghitung PIP/FBP/2CP pemain dari box score biasa atau mengarang starter. Lihat [panduan LiveStats](./LIVESTATS.md).

## 4. Pengembangan setelah PBP dan lineup tervalidasi

| Pengembangan | Tujuan | Prasyarat |
| --- | --- | --- |
| **On-court ORtg/DRtg/NetRtg pemain** | Mengukur efisiensi tim selama pemain berada di lapangan | Lineup, interval bermain, skor, dan possession yang dapat ditelusuri. |
| **On/off** | Membandingkan performa tim ketika pemain bermain dan beristirahat | Cakupan on/off yang konsisten dan waktu bermain yang tervalidasi. |
| **Statistik kombinasi lima pemain** | Mengukur menit, skor, dan efisiensi tiap lineup | Lima pemain awal, pergantian, periode, dan waktu event yang lengkap. |
| **Clutch stats** | Mengukur performa pada situasi akhir pertandingan ketat | Definisi clutch yang ditetapkan lebih dahulu serta skor/waktu PBP valid; statistik pemain juga memerlukan identitas aksi yang valid. |

Bagian ini masih berupa rencana. Ketersediaan JSON LiveStats/PBP atau tanda starter belum membuktikan bahwa lineup sudah dapat direkonstruksi tanpa celah. Sumber dan kegagalan yang memengaruhi cakupan harus ditampilkan. Lihat [perbandingan LiveStats dan portal](./PERBANDINGAN_LIVESTATS_GENIUS.md).

## 5. Tempat perhitungan yang disarankan

```text
HTML GZ / JSON LiveStats
  → parser, normalisasi, dan validasi
  → data sumber terstruktur dan provenance
  → Neon
  → fungsi analitik atau query server
  → dashboard / dokumen MD / HTML konten
```

- **Parser** menyimpan data sumber, normalisasi, dan derivasi terbatas yang memang sudah menjadi kontrak parser. Penambahan statistik analitik tidak mengharuskan semua rumus dimasukkan ke tahap GZ → JSON.
- **Backend/query server** menghitung metrik dari input Neon. Dashboard dan pembuat konten sebaiknya memakai fungsi/metodologi bersama agar rumus, pembulatan, dan perlakuan data kosong konsisten.
- **Frontend** menampilkan hasil, filter, tabel, grafik, sumber, dan penjelasan rumus.
- **Proses backend dan tabel hasil khusus** dapat dipakai kemudian untuk perhitungan berat, seperti lineup dan on/off. Simpan versi rumus serta hubungan ke input agar hasil dapat diperbarui ketika sumber berubah.

Data lama dapat ikut dihitung jika seluruh input yang dibutuhkan tersedia dan valid. Metrik baru tidak otomatis membutuhkan ingest HTML ulang. Jika field pendukung belum tersimpan, perluasan parser/backfill harus direncanakan sesuai sumber yang benar.

Aturan umum perhitungan:

1. Jaga scope namespace, kompetisi, tim/pemain, fase, cutoff, dan game IDs.
2. Gunakan cakupan pertandingan yang sama untuk seluruh input satu metrik. Laporkan jumlah laga yang masuk dan yang dikeluarkan karena input tidak lengkap.
3. Hitung persentase/rating agregat dari total pembilang dan penyebut pada cakupan tersebut; jangan langsung merata-ratakan persentase/rating per laga.
4. Pertahankan `null` untuk input yang tidak tersedia dan penyebut nol. Jangan menggantinya dengan statistik nol.
5. Catat nama metrik, rumus, versi, input, metode estimasi bila ada, dan sumber. Pisahkan nilai resmi dari nilai hasil hitung meskipun namanya serupa.
6. Terapkan scope, filter, perhitungan agregat, dan sorting sebelum pagination daftar peringkat.

## 6. Prioritas pengembangan

1. **Rating tim + Four Factors**: ORtg/DRtg/NetRtg estimasi, eFG% tim/lawan, TOV%, ORB%/DRB%, dan definisi FT rate yang eksplisit.
2. **Persentase dan normalisasi pemain**: USG%, persentase rebound, TOV%, AST%, per 40 menit, dan profil attempts.
3. **Penyajian tambahan resmi LiveStats**: tampilkan field yang valid dengan sumber dan cakupan yang jelas.
4. **PBP/lineup**: setelah prasyarat kualitas terpenuhi, kembangkan on-court rating, on/off, lineup, dan clutch.

Dokumen ini mencatat rekomendasi. Tabel usulan dan urutan prioritas di atas tidak menandakan bahwa fitur tersebut sudah dibuat atau diverifikasi.
