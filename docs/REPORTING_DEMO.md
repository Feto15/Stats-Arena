# Demo laporan pertandingan

Pembaruan tampilan 26 Oktober 2026: tab Perkembangan pada laporan klub sudah dihapus; tautan lama ke bagian tersebut kembali ke Ringkasan. Uraian dan verifikasi perkembangan di bawah merupakan catatan fitur sebelum penghapusan tab. Rumus serta arsip perhitungan tetap dipertahankan.

Pembaruan identitas 26 Oktober: mesin rotasi saat ini `statsarena-demo-rotation/1.3.0`, menerima bukti alias nama terstruktur dari adapter 1.0.2 untuk laporan 2026. Arsip demo 2025 tetap memakai sumber 1.0.1 dengan pemeriksaan lama yang kompatibel; event/statistik/hasil perhitungan demo di bawah tidak diubah. Lihat [metode alias nama](./LIVESTATS.md).

Sejak 26 Oktober 2026, `/reports` menjadi pemilih seluruh klub **All Indonesian 2026** dari arsip lokal; lihat [laporan seluruh klub dan mode deployment khusus report](./REPORTING_LOCAL.md). Dokumen ini mempertahankan metodologi dan hasil verifikasi demo 2025. Demo pertandingan kini berada di `/reports/demo-match`, sedangkan demo klub dua laga tetap di `/reports/bima-perkasa`. Menu **Club Reports** membuka indeks 2026. Semua halaman memakai layout mandiri agar mudah dibaca sebagai laporan ke tim dan dicetak. Tidak ada registrasi layanan, pengiriman laporan otomatis, atau deployment baru.

## Laporan klub Bima Perkasa setelah dua laga

Route `/reports/bima-perkasa` berpusat pada perkembangan klub, dengan bagian URL `section=overview|players|games|shots|development|rotation`. `player=<sourceId>` hanya memilih pemain Bima Perkasa yang diamati. Pertandingan merupakan bukti pendukung, bukan identitas utama halaman. Demo pertandingan sebelumnya tersedia di `/reports/demo-match`.

Jendela analisis dikunci pada dua laga pertama **Bima Perkasa Jogja** (`126038`, namespace `IBL:42041`):

| Laga | Waktu mentah sumber | Lawan | Skor dari sisi Bima Perkasa | Hasil |
| --- | --- | --- | --- | --- |
| `2697586` | Aug 17, 2025, 4:30 PM | Pacific Caesar Surabaya | 65–53 | W |
| `2697587` | Aug 18, 2025, 4:30 PM | Satria Muda Pertamina Bandung | 44–100 | L |

Tidak ada statistik laga ketiga dan seterusnya, klasemen akhir, atau rata-rata akhir musim yang ikut konteks. Dataset di `dashboard/lib/reports/demo-club.json` hanya menyimpan dua pertandingan ini beserta provenance sumber; validator menolak laga tambahan, urutan/ID di luar jendela, namespace/klub berbeda, serta box score tanpa referensi URL laga yang sesuai. Identitas demo dikunci dengan sengaja; pipeline ingest tetap dinamis.

Arsip diambil Oktober 2026 untuk pertandingan Agustus 2025. Ini simulasi batas hasil setelah dua laga, bukan bukti snapshot yang telah dibekukan pada Agustus 2025; koreksi sumber setelah pertandingan dapat sudah tercakup.

Ringkasan: rekor **1–1**, 109 poin tim dan 153 poin lawan, rata-rata **54,5–76,5**, serta 40 turnover total (**20 per laga**). Empat faktor memakai eFG%, TOV% aktivitas penyelesaian (estimasi), ORB%, dan FTA/FGA. Rating tim memakai estimasi possession gabungan. Semua angka analitik berasal dari modul bersama; persentase dan rating gabungan dihitung dari total input, bukan rata-rata persentase/rating laga. Kedua lawan berbeda, sehingga perubahan antarlaga tidak membuktikan tren atau penyebab taktis.

Pemain memakai akumulasi dari baris box score dalam jendela tersebut. GP menghitung baris termasuk nol menit; tidak menebak DNP. Rata-rata per laga memakai GP tersebut. Pemain tanpa baris pada satu laga hanya memakai konteks tim/lawan dari laga dengan baris. USG% memakai jumlah menit pemain tim, bukan durasi total tim yang tidak tersedia; null pada menit salah satu pemain membuat konteks menit metrik unavailable. Menit detik dipertahankan sebelum perhitungan.

Tab pertandingan menyediakan grafik skor kumulatif akhir kuarter, tabel poin kuarter, referensi box score/PBP, dan kuarter dengan selisih paling merugikan sebagai titik awal tinjauan video. Grafik hanya memakai event Period end eksplisit yang lolos kecocokan skor final; bukan rekonstruksi possession atau grafik waktu kontinu. Benchmark liga belum dimasukkan. Perkembangan pemain dan rekonstruksi rotasi/on-off ditambahkan pada dua tab terpisah; cakupannya dijelaskan di bawah.

### Perkembangan pemain dan rotasi — 23 Oktober 2026

Tab `section=development` membandingkan **laga 2 − laga 1** untuk setiap pemain yang dipilih lewat `player`. Menit, FGA/3PA/FTA, TS%/eFG%, USG%, TO/TOV%, PTS/REB/AST, GmSc, dan porsi poin tim berasal dari box score portal dan modul analitik bersama. Delta persentase dinyatakan dalam poin persentase, bukan persen pertumbuhan. Perhitungan mempertahankan detik; pembulatan hanya saat ditampilkan. Baris pemain yang hilang tidak dianggap nol. Tanpa dua nilai valid, delta unavailable; TS% tanpa percobaan juga unavailable. Tabel skuad memberikan perbandingan 12 pemain dan tautan ke rincian.

Contoh H. Santosa: **33:13 → 18:34** (−14:39), FGA **5 → 6**, poin **17 → 8**, turnover **0 → 0**, TS% **94,9% → 51,5%**. Ini dua pengamatan dengan lawan berbeda, belum tren jangka panjang atau bukti efek latihan. Menit dan USG yang naik/turun tidak otomatis dinilai baik/buruk.

Tab `section=rotation` memilih satu dari dua laga dengan `rotationGame`; `player` menentukan fokus on/off. Data lokal `dashboard/lib/reports/demo-club-rotation.json` berisi subset arsip JSON LiveStats, bukan hasil menebak starter dari box score portal. Pipeline produksi tidak diubah, tidak melakukan fetch baru atau impor Neon, dan tidak menganggap file current sebagai bukti impor sukses.

| Laga | JSON LiveStats | Waktu fetch UTC | SHA-256 payload asli |
| --- | --- | --- | --- |
| 2697586 | https://fibalivestats.dcd.shared.geniussports.com/data/2697586/data.json | 2026-10-16T07:54:50.096Z | `b212aab9c2d88c5805a7f2af3e837e5b3c1a6719d062a13ece33f7a144a5f34e` |
| 2697587 | https://fibalivestats.dcd.shared.geniussports.com/data/2697587/data.json | 2026-10-16T07:54:49.987Z | `f6c7457d9a6a94111d652208a187a480cf68e240d7ff6e24680624bf8bb3055c` |

Hash envelope dicocokkan dengan body cache sebelum subset dibuat. Adapter produksi `parseLiveStatsJson`, versi `statsarena-livestats/1.0.1`, memeriksa kedua tim, skor, nama eksplisit, jersey, dan seluruh 17 statistik dasar pemain terhadap audit portal yang sama; kedua laga berstatus ready tanpa isu. Pemetaan ID lokal ke ID portal menggunakan metode `team_jersey_name_core_stats_v1`, bukan nama saja. Snapshot menyimpan pemetaan, statistik dasar, starter, menit dan plus/minus resmi, hash box score, URL/waktu/hash payload, serta semua event dengan urutan, clock mentah, periode/tipe, actionNumber/previousAction, identitas tim/pemain lokal, kelas aksi/subtipe, qualifier, success/scoring, dan skor berjalan.

Rekonstruksi deterministik `statsarena-demo-rotation/1.0.0` di `club-rotation.ts` khusus cakupan dua laga ini. LiveStats menyimpan event terbaru lebih dahulu; urutan dibalik tanpa mengurutkan ulang event berwaktu sama berdasarkan actionNumber. Clock `MM:SS:CC` dibaca sebagai menit, detik, **perseratus detik**. Pergantian berurutan pada clock/periode sama diterapkan serentak, termasuk bila pergantian lawan tersisip. Urutan sumber tetap menentukan apakah skor pada clock sama terjadi sebelum atau sesudah blok pergantian. Interval nol durasi yang membawa poin tetap dipertahankan.

Guard per laga memeriksa lima starter, pemetaan unik dan seluruh core stats/jersey/nama terhadap portal, seluruh indeks source sequence dan actionNumber unik, empat batas kuarter eksplisit dan kecocokan skor kuarter/final portal, clock monoton, penambahan skor hanya oleh event scoring yang berhasil, masuk/keluar yang konsisten, lima pemain sepanjang laga, dan setiap aksi pemain Bima terjadi saat pemain tersebut berada di lapangan. Jumlah interval harus tepat **2.400 detik**, poin interval harus cocok dengan skor final, dan durasi/plus-minus seluruh 12 pemain harus sesuai ringkasan LiveStats. Toleransi durasi **≤ 1 detik** karena ringkasan tidak menyimpan pecahan detik; plus/minus harus persis sama. Kesalahan menahan seluruh lineup/on-off laga tersebut, sementara laga lain yang valid tetap tersedia. Namespace/klub/jendela laga asing ditolak.

Hasil arsip terverifikasi:

| Laga | Event PBP | Event masuk/keluar Bima | Interval Bima | Kombinasi unik | Durasi | Skor interval |
| --- | --- | --- | --- | --- | --- | --- |
| 2697586 | 503 | 42 | 19 | 16 | 40:00 | 65–53 |
| 2697587 | 539 | 54 | 21 | 18 | 40:00 | 44–100 |

Semua pemain cocok dengan menit LiveStats (selisih maksimum 0,3 detik) dan plus/minus resmi. Lima starter kedua laga: R. Purnomo, J. Panagan, A. Kurniawan, H. Annur, H. Santosa. J. Kurnianto nol menit pada laga pertama tetap memiliki ON 0:00 dengan skor 0–0, OFF 40:00 dengan skor 65–53; tidak diberi efisiensi atau dampak buatan.

**Menit portal dan LiveStats berbeda pada sejumlah pemain** dan tetap dipisahkan: perkembangan memakai portal; rotasi memakai interval yang cocok dengan LiveStats. Tabel audit menampilkan keduanya. Misalnya A. Mustofa laga 1: portal 5:09, LiveStats 5:10, interval 309,7 detik. Tidak ada penggantian statistik portal oleh pelengkap.

Tampilan menyediakan peta interval 12 pemain, tabel kombinasi lima diurutkan durasi, skor tim ON/OFF pemain terpilih, tabel interval berurutan untuk tinjauan video, serta audit durasi/plus-minus dan tautan sumber. Menit berjalan 0–40 bukan timestamp file video. Skor ON/OFF dan selisih lineup tetap menjadi pengamatan mentah dengan durasi berbeda. Pembaruan 24 Oktober menambahkan rating ON/OFF estimasi secara terpisah, sesuai metode di bawah; tidak ada estimasi dampak kausal atau rekomendasi lineup terbaik. Kombinasi kurang dari dua menit diberi penanda sampel singkat; ini penanda tampilan, bukan uji signifikansi. Kesiapan seluruh kompetisi dan penyimpanan interval pada pipeline produksi masih perlu pekerjaan terpisah.

Test `player-development.test.ts` dan `club-rotation.test.ts` memeriksa angka arsip, presisi, null/nol/baris hilang, cakupan URL, skor/menit/on/off seluruh pemain, pergantian clock sama, identitas, starter, event hilang, clock invalid, plus/minus, kuarter, dan provenance. Verifikasi 23 Oktober 2026: 35 test dashboard, lint, typecheck, dan build lulus. Browser memeriksa tab Perkembangan, form Santosa/Kurnianto (TS unavailable tetap —), 12 baris skuad, kedua laga rotasi, 12 baris timeline, 16/18 kombinasi, ON/OFF pemain termasuk nol menit, dan tabel interval/audit yang dibuka dengan Enter. Lebar 1440/390 px tidak membuat halaman meluber; ArrowRight menggulir timeline di dalam panel. Browser tidak mencatat warning/error. Override viewport dikembalikan. Pemeriksaan ini tidak membuktikan impor Neon, kesiapan seluruh kompetisi, deployment, atau ekspor PDF.

GmSc ditampilkan pada laporan klub sejak 24 Oktober 2026: tabel skuad dan profil menggunakan **GmSc/laga** (`gameScorePerGame`), sedangkan tabel perkembangan menampilkan **GmSc laga 1 → laga 2** beserta delta. Semuanya membaca metrik yang sudah dihitung modul analitik bersama; tidak ada rumus atau data sumber baru. Rata-rata memakai baris laga yang tercatat, termasuk baris nol menit; input hilang tetap null, Game Score negatif tetap dipertahankan. Urutan skuad tetap berdasarkan poin/laga. H. Santosa: GmSc 20,1 → 4,8, delta −15,3, rata-rata 12,45 (tampilan satu desimal mengikuti pembulatan formatter). GmSc merupakan ringkasan box score, terpisah dari plus/minus dan Net Rating. Kolom GmSc/laga berada paling kanan setelah TS%, dengan USG% sebelum TS%. Di bawah tabel tersedia penjelasan singkat, rumus GmSc yang sesuai evaluator bersama, definisi singkatan, dan pembagi GP untuk rata-rata; nilai perhitungan tidak berubah.

### ON/OFF Net Rating estimasi — 24 Oktober 2026

Panel on/off kini menampilkan **ON Net Rating**, **OFF Net Rating**, ORtg, DRtg, estimasi possession masing-masing, dan selisih Net Rating ON − OFF. Durasi/skor/+− mentah tetap ditampilkan terpisah. Hasil merupakan pengamatan **per laga** di dalam demo dua laga, belum RAPM atau efek kausal, dan bukan angka rating resmi LiveStats. Tidak ada perubahan data lokal sumber, parser, query, schema, maupun Neon.

Modul `club-onoff-rating.ts`, versi `statsarena-demo-onoff-rating/1.0.0`, membaca event kedua tim dari subset LiveStats yang sama. `statsarena-demo-rotation/1.1.0` tetap menjaga rekonstruksi lima pemain, durasi/plus-minus, dan urutan pergantian. Setiap event FGA, FTA, turnover, dan rebound harus memiliki tepat satu interval berdasarkan batas `sourceSequence`; tidak memakai pembagian proporsional terhadap menit. Event tepat pada clock pergantian mengikuti urutan sumber, bukan aturan `from <= time < to` yang dapat salah mengatribusikan event bertimestamp sama.

Sebelum rating tersedia, jumlah FGA/FGM, 2PA/3PA, FTA/FTM, ORB pemain, dan TO seluruh interval harus sama dengan box score portal **kedua tim**. Rebound harus memiliki subtipe offensive/defensive dan atribusi pemain vs team eksplisit. ORB pembagi mengikuti OFF portal pada dua laga ini, yang mengecualikan team rebound. Event team offensive rebound tidak dibuang: disimpan dan ditampilkan terpisah pada audit input. Ini menjaga definisi dan total estimasi sama dengan rating tim di laporan; jangan mengklaim sebagai hitungan possession resmi LiveStats atau NBA.

Untuk setiap cakupan ON/OFF, hitung **total input mentah lebih dahulu**, kemudian gunakan evaluator `@statsarena/db/analytics` versi `statsarena-analytics/1.0.0`:

- Estimasi sisi tim = FGA + 0,44 × FTA − ORB + TO; demikian pula lawan.
- Pembagi bersama = rata-rata estimasi kedua sisi.
- ORtg = poin tim / pembagi × 100; DRtg = poin lawan / pembagi × 100; Net Rating = ORtg − DRtg.
- Selisih on/off = Net Rating ON − Net Rating OFF, bukan selisih margin mentah dan bukan RAPM.

Rumus tidak diduplikasi di komponen UI. Estimasi nol tetap 0, tetapi ORtg/DRtg/Net Rating serta selisih yang kekurangan penyebut valid menjadi null/—. Estimasi negatif tidak ditampilkan sebagai possession valid. Kesalahan hitungan/atribusi event menahan **rating laga tersebut**; durasi, lineup, dan plus/minus yang sudah tervalidasi tetap tersedia. Snapshot lain yang valid tetap dihitung.

Ini estimasi box score yang diterapkan pada total event cakupan terpilih, **belum rekonstruksi possession utuh**. Pergantian di tengah penguasaan bola atau rangkaian free throw dapat membuat komponen penyebut terbagi di antara kondisi ON/OFF. Sampel pendek dapat menghasilkan rating ekstrem; durasi serta jumlah estimasi possession ditampilkan, tanpa peringkat dampak atau label terbaik. Panel metode menyertakan input FGA/FTA/ORB/TO dan team ORB per sisi, versi, serta keterbatasan ini.

Patokan validasi: estimasi penuh laga 1 **78,12** dan laga 2 **83,32**. Untuk semua pemain, estimasi ON + OFF sama dengan laga penuh; rating ON/OFF berbobot estimasi possession memulihkan rating tim satu laga, bukan rata-rata biasa. H. Annur laga 2: ON 13:30, skor 17–32, **29,36** estimasi possession, Net Rating **−51,09**; OFF 26:30, skor 27–68, **53,96**, Net Rating **−75,98**; selisih **+24,89** poin/100. J. Kurnianto laga 1: ON 0:00, estimasi possession 0, rating —; OFF 40:00, **78,12**, Net Rating **+15,36**.

Test `club-onoff-rating.test.ts` memeriksa kedua tim, seluruh pemain, input event nyata, dekomposisi ON/OFF, konsistensi evaluator bersama, nol/null, penolakan rating saat tembakan hilang atau rebound ambigu, interval ganda/asing, dan preservation skor mentah/laga lain. Test single-canvas memeriksa fallback URL serta laga 2 dengan marker masuk saja yang tetap memakai 61 percobaan sebagai denominator. **41 test dashboard**, lint, typecheck, dan build lulus. Browser memeriksa Annur laga 2 (Net ON −51,09; OFF −75,98; selisih +24,89), audit input via Enter, Kurnianto laga 1 (ON 0 possession dan rating —, OFF +15,36), serta satu kanvas shot chart. Default laga 1: 61 marker, 25/61 FG; laga 2 + masuk saja: 18 marker, denominator tetap 61 dan FG 29,5%. Lebar 1440/390 px tidak meluber; panel tabel tetap memakai scroll internal. Ruang SVG di luar lapangan diperluas agar label Y=100% tidak terpotong; koordinat dan rasio gambar sumber tidak berubah. Browser tanpa warning/error dan viewport dikembalikan. Tidak ada pemeriksaan Neon, deployment, atau ekspor PDF.

### Shot chart klub

Tab `section=shots` menggunakan `dashboard/lib/reports/demo-club-shots.json`, salinan terbatas marker Bima Perkasa dari audit sumber yang sama. Hanya 2PT/3PT; foul, turnover, dan free throw tidak masuk. Laga `2697586`: **25/61**; laga `2697587`: **18/61**. Gabungan **43/122**, FG **35,2%**; 2PT **39/93** dan 3PT **4/29**. FG% berbeda dari eFG% di ringkasan karena eFG% memberi bobot tambahan pada three-point made.

Form GET menyimpan filter `game`, `player`, `period`, `shotType=all|2pt|3pt`, `result=all|made|missed` di URL. Sejak 24 Oktober 2026, tampilan hanya memiliki **satu kanvas lebar untuk satu pertandingan**. Pilihan pertandingan memuat laga 1/2; default, `game=all` lama, parameter laga asing/berulang kembali ke laga pertama. Filter pemain/periode/jenis/hasil invalid tetap kembali ke all. Helper audit `parseClubShotFilters`/`selectClubShots` masih mendukung agregasi dua laga; layar memakai `parseSingleClubShotFilters` agar satu kanvas saja dan denominator sesuai laga terpilih. Filter hasil hanya mengubah marker yang terlihat; pembagi FG% tetap seluruh percobaan pada cakupan laga/pemain/periode/jenis terpilih. Empty filter yang valid menghasilkan 0 percobaan dan FG unavailable, sedangkan dataset gagal tidak ditampilkan seolah-olah 0 percobaan.

Kanvas tiap laga tetap terpisah. `left` → X dan `top` → Y; koordinat mentah, persen, source sequence, ID, kelas/title marker, URL, waktu fetch, hash, dan versi parser dipertahankan. Tidak ada rotasi, normalisasi arah serangan, skala meter, zona lapangan, atau klaim shot quality. Marker di koordinat sama tetap record berbeda. Hover marker menyediakan tooltip; daftar marker dapat dibuka sebagai alternatif tabel untuk keyboard/touch.

Latar garis lapangan ditambahkan dari [gambar asli Genius Sports](https://hosted.dcd.shared.geniussports.com/images/surface_basketball1.jpg), tanpa mengedit gambar atau logonya. [Stylesheet sumber](https://hosted.dcd.shared.geniussports.com/css/hs-style.css?v=4.0), diperiksa 23 Oktober 2026, memakai `padding-bottom: 59.5%` pada wrapper dan `background-size: 100% 100%` pada gambar tersebut. Tampilan kini memakai rasio kanvas **100 : 59,5** yang sama, bukan kanvas persegi. X display tetap persen X; Y display = persen Y × 59,5 / 100. Ini hanya konversi unit SVG untuk rasio tampilan, bukan perubahan koordinat data, rotasi, atau konversi ke meter.

Asset lokal `dashboard/public/reports/genius-basketball-court.jpg` berukuran 891×532 piksel (38.949 byte), SHA-256 `b543c3dcbf0aad298b6be7cb180608f68fc9e9a493d26b6994de9e931a009fef`. Metadata URL, waktu ambil, hash gambar/CSS, serta selector/rasio yang diamati disimpan di `genius-basketball-court.source.json`. Browser membaca asset lokal sehingga tidak mengambil gambar Genius Sports setiap membuka laporan. Verifikasi sumber saat ini tidak membuktikan stylesheet tersebut identik pada Agustus 2025; gambar ini berfungsi sebagai latar koordinat sumber, belum sebagai pemetaan zona atau jarak.

Verifikasi latar lapangan 23 Oktober 2026: lint, typecheck, dan build dashboard lulus. Browser memeriksa gambar pada kedua kanvas, rasio tinggi/lebar 0,595, 122 marker, serta total 43/122 (35,2%). Marker pertama tetap X=93%, Y=59% (SVG display Y=35,105 dalam tinggi 59,5); data mentah tidak berubah. Halaman tidak meluber pada 1440 maupun 390 px, tanpa warning/error browser. Override viewport dikembalikan. Tidak ada perubahan parsing, statistik, atau database pada perubahan visual ini.

Sebelum ditampilkan, setiap dataset dicocokkan dengan FGA/FGM serta 2PA/2PM dan 3PA/3PM pada total tim **dan setiap pemain**, identitas laga/skuad/periode, keunikan source sequence, konsistensi koordinat mentah/persen, dan provenance resource shotchart. Dataset tidak cocok menjadi partial dan markernya ditahan; laga lain yang valid tetap tampil dengan jumlah cakupan eksplisit. Scope namespace/laga asing atau duplikat ditolak. Tidak ada perubahan parser, fetch baru, impor, atau schema database.

Test `dashboard/test/club-shot-chart.test.ts` mencakup angka arsip, koordinat sumber, filter/denominator FG%, nol vs unavailable, penurunan jumlah marker, pemindahan atribusi pemain, field invalid, duplikasi, provenance, dan scope.

Verifikasi 23 Oktober 2026: **26 test dashboard**, lint, typecheck, dan build berhasil. Browser menampilkan 122 marker awal, serta memverifikasi form laga pertama + masuk saja (25 marker, FG tetap 25/61 = 41,0%), J. Kurnianto pada laga pertama (0 percobaan, FG unavailable), 3PT kedua laga (4/29 = 13,8%), dan Reset filter. Pemeriksaan lebar 1440/390 px tidak menemukan halaman meluber; daftar 61 marker dibuka memakai Enter dan tabel ponsel memakai scroll internal. Browser tidak mencatat warning/error. Override viewport dikembalikan. Tidak ada verifikasi Neon, publikasi, atau ekspor PDF pada pekerjaan shot chart.

Test `dashboard/test/club-report.test.ts` memeriksa batas dua laga, orientasi skor klub saat away, konteks pemain, agregasi berbobot, presisi menit, null/nol, penolakan data di luar cakupan, dan pemilihan URL.

Verifikasi 23 Oktober 2026: **20 test dashboard**, lint, typecheck, dan build berhasil. Browser memeriksa ketiga tab, profil J. Panagan (52:10 total menit; 6 PPG, 4 RPG, 3,5 APG), grafik/skor periode kedua pertandingan, navigasi keyboard Enter, salin tautan dan reset label setelah pindah URL. Lebar 1440 px dan ketiga tab pada 390 px tidak membuat halaman meluber; tabel pemain memakai scroll internal. Tidak ada warning/error browser. Pemeriksaan ini memakai salinan arsip; tidak membuktikan impor Neon atau deployment Vercel. Ekspor PDF belum diperiksa ulang pada versi klub.

## Cakupan dan sumber

Satu pertandingan arsip **IBL All Indonesian 2025**, namespace `IBL:42041`: Rajawali Medan vs Satria Muda Pertamina Bandung, game `2697582`, skor **56–84**, 23 baris pemain. Ini bukan hasil kompetisi 2026 atau laporan seluruh tim sepanjang musim. Pilihan tim mencakup dua peserta laga tersebut.

Salinan terbatas `dashboard/lib/reports/demo-game.json` berasal dari audit lokal `IBL:42041-sync-2026-10-16T06-55-27-702Z.json`. Salinan ini menyimpan identitas, statistik, derivasi 2P, observasi akhir periode eksplisit, kualitas dataset, URL, hash, waktu fetch, serta versi parser. Data demo dikunci dengan sengaja agar dapat dibuka tanpa Neon atau folder ingest yang tidak ikut deployment dashboard. Route tidak melakukan fetch Genius Sports, membaca kredensial, atau menulis database. Tidak ada cache LiveStats yang diperlakukan sebagai bukti impor sukses.

Box score dan PBP sampel berstatus parsed; Team Analysis tidak tersedia. Audit kompetisi secara keseluruhan partial. Statistik BP/PIP/PFT/FBP/2CP, starter, plus/minus, shot chart, maupun klaim taktik tidak disajikan dalam demo ini.

## Interaksi

- `team=<sourceTeamId>` memilih sudut pandang tim dari dua peserta.
- `section=team|players` memilih laporan tim atau pemain.
- `player=<sourcePlayerId>` memilih evaluasi pemain hanya dari tim terpilih.
- Filter tersimpan di URL. ID asing, parameter berulang, dan section invalid kembali ke pilihan valid; pemain tidak pernah dicampur antar tim.
- Nama pemain pada tabel membuka evaluasi individu. Tabel diurutkan menurut Game Score; pemain fokus awal adalah pemain yang bermain dengan Game Score tertinggi. Ini bukan penghargaan MVP resmi.
- **Salin tautan** menyalin URL saat ini. Pada development lokal, tautan hanya dapat dibuka pada perangkat yang menjalankan dashboard; berbagi ke perangkat lain memerlukan deployment dashboard.
- **Cetak / PDF** membuka dialog cetak browser. Styles cetak memuat kedua bagian laporan dan seluruh baris pemain; detail individu adalah pilihan di layar, sedangkan tabel PDF mencakup seluruh pemain tim terpilih.

## Perhitungan dan interpretasi

Metrik dihitung melalui `@statsarena/db/analytics`, versi `statsarena-analytics/1.0.0`, tanpa rumus analitik baru di UI. Definisi eFG%, TS% (estimasi), AST/TO, Game Score, dan kontribusi poin ditampilkan pada metodologi halaman. Nilai null ditampilkan `—`, nol tetap nol, persentase tanpa percobaan unavailable. Menit mentah mempertahankan detik. Tidak ada perbandingan dengan rata-rata musim.

Skor periode berasal dari selisih skor berjalan pada event **Period end** yang eksplisit, mempertahankan `sourceSequence`. Coverage harus berurutan dari periode 1, minimal empat periode, tidak mengalami penurunan skor, dan berakhir dengan skor final fixture. Jika gagal, skor periode unavailable. Sampel Q1–Q4: **15–20, 12–25, 15–28, 14–11**. Tidak ada klaim zona waktu pertandingan.

Catatan pelatih menjelaskan perbandingan eFG%, turnover, dan offensive rebound, lalu menyarankan pemeriksaan video. Hubungan sebab-akibat, kualitas shot, dan peran taktik tidak dapat disimpulkan hanya dari box score.

## Verifikasi

Test `dashboard/test/game-report.test.ts` mencakup angka arsip/provenance, presisi menit, analitik bersama, pemilihan tim/pemain, null vs nol, ketidaklengkapan periode, serta penolakan identitas/URL tidak valid.

Verifikasi 23 Oktober 2026: lint dan build dashboard (termasuk TypeScript) berhasil, 14 test dashboard lulus. Route mengembalikan HTTP 200; browser memverifikasi pergantian tim, perpindahan tab, pemilihan W. Teja, serta tombol salin tautan. Pemeriksaan lebar 1440 dan 390 px memastikan halaman tidak meluber; tabel ponsel memiliki scroll internal. Browser tidak mencatat warning/error selama pemeriksaan tersebut. Tombol cetak dicoba, tetapi kontrol browser tertahan saat membuka dialog; Escape memulihkan halaman. Ekspor dan hasil layout PDF belum terverifikasi. Test ini tidak membuktikan pembaruan Neon atau deployment Vercel.

### Perbaikan interval clock sama — 26 Oktober 2026

Versi rotasi `1.3.0` mempertahankan kelompok pergantian berurutan sebagai satu transaksi. Pasangan belum lengkap boleh disambungkan melewati event non-scoring hanya pada clock dan periode identik; setelah lengkap harus kembali lima, aktor sela harus ada pada lineup sebelum/sesudah, dan validasi menit/plus-minus seluruh pemain tetap wajib. Skor yang berubah saat pasangan terbuka, clock bergeser, pasangan hilang, atau aktor tidak didukung tetap partial.

Rating `statsarena-demo-onoff-rating/1.1.0` menyimpan `ambiguousSourceSequences`: aktivitas statistik di dalam pasangan terbuka tetap dihitung untuk pemeriksaan total box score, tetapi tidak diatribusikan ke lima pemain yang belum pasti dan seluruh rating laga ditahan. Durasi serta skor mentah yang lolos validasi tetap tampil. Interval berdurasi nol dengan lima pemain pasti dan aktivitas statistik (termasuk FT gagal) dipertahankan agar tidak kehilangan denominator. Urutan sumber tidak disortir ulang; tidak ada perubahan rumus analytics bersama, schema, sumber, atau impor Neon. Cakupan terbaru ada di [REPORTING_LOCAL.md](./REPORTING_LOCAL.md).
