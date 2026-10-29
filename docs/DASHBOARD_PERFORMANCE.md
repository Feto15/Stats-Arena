# Performa dashboard dan laporan klub

Pembaruan 29 Oktober 2026. Cakupan: Overview, Games, Teams, Players, Standings, Review, katalog Club Reports, dan tab laporan klub. Tidak mengubah schema, rumus statistik, pipeline ingest, atau data statistik Neon. Login browser pengujian memakai alur sesi normal; tidak mengubah role/grant.

## Pembacaan server

`dashboard/lib/data/read-cache.ts` menyimpan hasil query dalam memori **setiap instance server**, maksimal 128 entri dan perkiraan ukuran nilai terserialisasi 16 MiB. Ini bukan cache bersama seluruh worker Vercel; instance baru tetap membaca Neon. Permintaan bersamaan untuk kunci yang sama berbagi satu pembacaan, dengan antrean kunci yang juga dibatasi. Nilai terlalu besar tetap dilayani tanpa disimpan.

| Data | Masa berlaku |
| --- | --- |
| Daftar kompetisi dan pilihan tim filter pemain | 60 detik |
| Identitas kompetisi dan direktori identitas klub laporan | 30 detik |
| Overview, Review dan Review lintas kompetisi | 5 detik |
| Daftar/detail Games, Teams, Players, Standings, katalog dan isi laporan klub | 15 detik |

Kunci mencakup resource, namespace/kompetisi, klub/entitas, filter, urutan, dan halaman sesuai pembaca. Setelah kedaluwarsa, query berikutnya membaca Neon. Data yang tampil dapat tertinggal selama masa berlaku tersebut; tidak ada pembacaan sumber Genius/LiveStats pada request dashboard. Hasil gagal tidak disimpan dan tidak diganti dengan cache kedaluwarsa. Tidak ada mekanisme cache baru pada endpoint MCP.

Otorisasi dijalankan **sebelum setiap hit maupun penggabungan pembacaan aktif**. Sesi, role, grant dan keputusan izin tidak disimpan lintas request. Pembaca dashboard memerlukan admin; pembaca laporan klub memeriksa izin kompetisi+klub. Cache berisi hasil domain yang sama untuk seluruh pembaca yang berhak; penyaringan daftar klub dilakukan pada salinan hasil setiap request, agar mutasi tidak memengaruhi pengguna lain. Perubahan/pencabutan izin berlaku pada request server berikutnya. Konten yang sudah dikirim ke browser sebelumnya tetap merupakan salinan yang telah diterima pengguna.

Better Auth dan pembaca dashboard menggunakan pool PostgreSQL yang sama melalui `getDashboardDatabase()`, sehingga tidak membuka dua pool terpisah dalam satu instance.

## Laporan klub

Metadata dan pencarian slug memakai direktori identitas: dua SELECT untuk kompetisi dan anggota klub. Keduanya tidak memerlukan statistik seluruh kompetisi. Pembacaan isi laporan tetap memakai transaksi read-only repeatable-read, termasuk validasi sumber dan statistiknya sendiri.

Query hanya mengirim observasi PBP `period`/`Period end` yang diperlukan untuk skor kuarter, serta bagian JSONB `rotation` LiveStats yang diperlukan untuk rekonstruksi rotasi. Seluruh PBP/payload sumber tetap tersimpan di Neon; aturan validasi provenance, skor, pemetaan dan kelengkapan tetap berlaku.

Kelima panel laporan dirender server sekali pada pembukaan laporan. `ClubReportSections` berpindah panel melalui native History API dan `useSearchParams`, tanpa navigasi server untuk perubahan `section` saja. URL, tautan langsung, Back/Forward, keyboard dan buka tab baru tetap tersedia. Parameter pemain, pertandingan, periode, hasil tembakan dan urutan dipertahankan. Perubahan filter tersebut masih melakukan request server dan memakai cache data di atas.

Semua panel tetap ada agar cetak laporan utuh berfungsi; panel hanya disembunyikan pada media layar. Ini tidak menunda perhitungan rotasi pada pembukaan pertama. Perubahan ingest atau izin tidak otomatis memperbarui tab yang sudah terbuka; muat ulang/navigasi server membaca status terbaru dengan batas cache tersebut.

## Verifikasi dan batas pengukuran

- 93 test dashboard lulus, termasuk PGlite untuk direktori dua query, isi laporan, isolasi namespace, validasi provenance, rotasi, perubahan database, izin MCP/report, dan kegagalan koneksi. Test cache memeriksa otorisasi ulang, pencabutan, kloning hasil, isolasi filter/halaman, single-flight, TTL, LRU, batas ukuran, kegagalan dan URL tab.
- Lint, typecheck dan build production Webpack dashboard lulus. Jalankan script package `build` yang menyertakan `--webpack` sesuai konfigurasi proyek.
- Browser build production lokal memeriksa ketujuh halaman dengan scope `IBL:50231`, kelima panel laporan Bogor, tautan langsung, aktivasi tab lewat keyboard, filter Q2, serta Back/Forward. Laporan pada viewport 390×844 tidak memiliki overflow dokumen (390 px); perubahan tab berfungsi. Screenshot desktop 1280×720 dan log browser/server yang diperiksa bersih. Semua panel tetap ada di DOM dan aturan sembunyi hanya pada media layar; hasil ekspor PDF/cetak fisik belum diverifikasi.
- Benchmark read-only dari Node lokal ke Neon pada satu klub `IBL:50231` dengan empat laga: pola halaman lama 17 SELECT, pola baru 13 SELECT saat cache kosong, pembacaan ulang cache 0 SELECT data. Sampel setelah proyeksi payload: 2.345 ms, 2.221 ms dan 7 ms; perhitungan rotasi 24 ms. Statistik hasil lama/baru identik. Sampel sebelumnya mencapai 8.157/6.939 ms karena latensi koneksi berubah; angka ini bukan jaminan waktu respons.
- Pengukuran tersebut tidak mencakup pemeriksaan sesi/izin, rendering browser, cold start, jaringan pengguna atau region Vercel. Region deployment tidak diubah. Tidak ada trace Chrome DevTools/Core Web Vitals produksi pada pekerjaan ini.

Pembukaan pertama masih menunggu Neon dan rendering laporan. Cache hanya membantu instance yang masih hidup dan permintaan berulang selama TTL. Jika produksi tetap lambat, ukur region fungsi terhadap region Neon serta waktu query/request produksi sebelum menambah cache atau memindahkan komputasi lain.
