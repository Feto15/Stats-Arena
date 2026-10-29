# MCP StatsArena dan izin akses

Implementasi 28 Oktober 2026 menyediakan **MCP baca saja** pada aplikasi Next.js dashboard. ChatGPT/klien MCP membaca Neon melalui `/api/mcp`; request tidak mengambil data sumber, menjalankan ingest, atau membaca audit lokal. Runner tetap di VPS/Coolify; dashboard dan MCP dapat ditempatkan di Vercel.

## Akun dan batas izin

Gunakan akun StatsArena yang sudah ada. Pendaftaran umum ditutup; admin mengundang staf melalui `/admin/access`. Pilih kompetisi, lalu klub dari keanggotaan Neon. Grant terikat pasangan `competitionKey` + `clubSourceId`.

| Akun/kondisi | Akses MCP |
| --- | --- |
| Tanpa token OAuth valid | HTTP 401 dengan metadata autentikasi |
| Staf | Kompetisi dan klub yang ditugaskan admin |
| Admin | Seluruh kompetisi/klub tersimpan serta pemeriksaan kualitas data |
| Token valid, klub/kompetisi di luar izin | Ditolak tanpa statistik |
| Grant klub dicabut | Token yang sama ditolak untuk klub tersebut pada permintaan berikutnya |
| Koneksi diputus atau sesi berakhir | Token lama ditolak; perlu menghubungkan kembali akun |

Persetujuan OAuth mengizinkan aplikasi memakai akses akun saat ini, tanpa menambah grant. Halaman consent menampilkan akun, nama aplikasi, cakupan baca, dan penjelasan izin. Aplikasi yang dihubungkan dengan akun admin mendapat akses baca semua kompetisi; gunakan akun staf jika hanya sebagian klub yang diperlukan.

Identitas berasal dari token terverifikasi, bukan email/ID/role dalam prompt atau argumen tool. Server memeriksa tanda tangan JWT, issuer, audience resource, expiry, dan scope `statsarena:read`, lalu membaca kembali user, sesi, status client, consent, serta grant di Neon. Access token berlaku lima menit; refresh maksimal tujuh hari selama sesi/consent valid. Keluar dari StatsArena membatalkan sesi yang terkait token.

Untuk mencabut koneksi, buka **Koneksi aplikasi** pada header report atau `/mcp/connections`. Aksi hanya mencabut koneksi akun sendiri, menghapus consent, dan mencabut refresh/access token tersimpan. Akun, grant, dan statistik tetap tersedia.

## Tool tersedia

Seluruh tool membutuhkan token dan memakai anotasi `readOnlyHint=true`, `destructiveHint=false`, `idempotentHint=true`, `openWorldHint=false`.

Admin memperoleh sepuluh tool; staf sembilan. `get_data_quality` hanya terdaftar untuk admin dan pembaca datanya juga memeriksa role di server. Kode isu, kategori kegagalan, jadwal retry, dan status dataset tidak disertakan pada detail laga/chart staf. Ketersediaan statistik, cakupan laga yang dihitung, dan nilai `null` tetap disampaikan agar angka dapat dibaca dengan benar. Provenance diperiksa di server dan tetap tersimpan di Neon. Perubahan role langsung diperiksa memakai token yang sama.

| Tool | Hasil dan cakupan |
| --- | --- |
| `get_profile` | Akun sendiri, status admin, dan grant saat ini |
| `list_competitions` | Kompetisi yang diizinkan |
| `list_teams` | Klub yang diizinkan dalam satu kompetisi |
| `list_games` | Jadwal/hasil laga yang melibatkan klub yang diizinkan |
| `get_team_stats` | Total, per laga, total lawan pada laga yang sama, dan metrik bersama |
| `get_player_stats` | Pemain klub sendiri, pencarian nama/ID, dan metrik bersama |
| `get_game_detail` | Box score pemain klub sendiri dan total lawan; diagnostik dataset khusus admin |
| `get_shot_chart` | Marker valid klub/laga, opsional pemain sendiri |
| `get_data_quality` | Khusus admin: status dataset, kategori, jadwal retry, dan kode isu terbatas |
| `get_metric_definitions` | Rumus, satuan, asal perhitungan StatsArena, serta penanda estimasi |

Alur: `get_profile` → `list_competitions` → `list_teams` → tool statistik dengan ID yang ditemukan. Argumen umum:

```json
{"competition":"49607","club":"<source-team-id>"}
```

Angka kompetisi berarti IBF; IBL eksplisit, misalnya `IBL:50231`. `game` dan `player` memakai ID sumber dalam cakupan kompetisi tersebut. Daftar memakai `limit` 1–50 (default 25), `offset` 0–5000. Field tambahan seperti `userId`/`isAdmin` ditolak.

Statistik berasal dari box score portal selesai dengan provenance dan total valid. Respons menyertakan `gameIds`, jumlah laga, dan alasan pengecualian. Persentase agregat dihitung dari total input menggunakan `@statsarena/db/analytics`, sama dengan dashboard/ekspor. Nilai tidak tersedia tetap `null`; tidak ada kolom metrik Neon baru.

### Respons ringkas 1.1.0 — 29 Oktober 2026

Server MCP mengirim identitas domain, nama, statistik resmi/hasil hitung, jadwal/hasil, cakupan laga, pagination, dan ketersediaan data. Semua respons tool statistik, termasuk daftar kompetisi/tim/laga dan setiap marker shot, tidak memuat URL sumber, provenance, hash, waktu fetch, versi parser/analitik, atau nama penyimpanan/provider. Pembatasan ini berlaku untuk admin dan staf serta kedua bentuk hasil MCP: teks JSON dan `structuredContent`. Tidak menaruh metadata tersebut pada `_meta` atau resource tersembunyi lain.

OAuth/discovery tetap memuat alamat layanan yang diperlukan untuk koneksi. Profil akun tetap memuat identitas serta grant. Admin tetap memperoleh diagnostik kualitas, waktu pemeriksaan/retry, dan kode isu terbatas; staf tidak. Jadwal pertandingan, ID/cakupan laga, koordinat kanvas, nilai nol/null, dan definisi rumus/estimasi bukan metadata fetch dan dipertahankan.

Query tetap memeriksa URL, hash, versi parser, identitas, dan konsistensi statistik sebelum menampilkan angka. Data sumber/audit di Neon, ingest, ekspor analisis dan dashboard tidak dihapus atau diubah. Admin dapat menelusuri sumber melalui dashboard. Tidak tersedia argumen untuk meminta URL sumber kembali dari tool MCP.

Instruksi server meminta jawaban statistik langsung dan melarang pembuatan tautan sumber/angka pengganti dari luar. Susunan jawaban akhir tetap ditentukan klien ChatGPT; server menjamin pembatasan payload yang dikirim, bukan semua teks yang mungkin ditambahkan model. Setelah deployment baru, refresh koneksi/tool plugin agar metadata server terbaru terbaca dan gunakan percakapan baru untuk menghindari tautan dari hasil tool lama.

Verifikasi respons `1.1.0`: 88 test dashboard, lint, typecheck, dan build production lulus. Regresi memeriksa semua query admin/staf, marker chart valid/tidak tersedia, null/nol/cakupan, hasil teks dan terstruktur pada HTTP MCP, serta metadata sumber yang tetap utuh di PGlite. Tidak ada migrasi, fetch sumber, atau penulisan Neon dalam perubahan ini; koneksi ChatGPT/deployment publik belum diuji ulang.

Lawan disajikan sebagai konteks total tim pada laga klub tersebut. Pemain/shot lawan memerlukan grant klub lawan sendiri. Chart memerlukan kesesuaian FGA/FGM, pemetaan pemain, satu observasi/versi parser, koordinat valid, dan URL sumber sesuai namespace/kompetisi/laga. Koordinat mengikuti kanvas sumber tanpa rotasi. Chart ditahan mengembalikan `available=false, items=null`; admin dapat melihat diagnostik fetch terbaru secara terpisah dari chart valid tersimpan.

PBP mentah, rotasi, tambahan individu LiveStats, dan widget interaktif belum menjadi tool MCP. Kualitas hanya mengembalikan kode isu, tanpa error HTTP mentah/path lokal/koneksi. Tidak tersedia SQL bebas, ingest, migrasi, pengubahan grant, atau penghapusan data.

## OAuth dan discovery

Stack: Better Auth beserta adapter/provider/MCP/CIMD **1.7.14**, SDK MCP **2.0.0**, authorization code + **PKCE S256**. HTTP stateless mendukung MCP `2026-07-28` dan kompatibilitas legacy stateless melalui SDK. State akun/client/consent/key/token berada di Neon, tanpa ketergantungan memori satu instance Vercel.

| URL | Fungsi |
| --- | --- |
| `/api/mcp` | Resource/transport MCP; POST JSON |
| `/.well-known/oauth-protected-resource/api/mcp` | Metadata resource pada challenge 401 |
| `/.well-known/oauth-authorization-server/api/auth` | Metadata authorization server |
| `/api/auth/jwks` | Kunci publik JWT |
| `/mcp/login` | Login dari kelanjutan OAuth bertanda tangan dan berumur terbatas |
| `/mcp/consent` | Setuju/tolak akses baca |
| `/mcp/connections` | Daftar dan pemutusan koneksi akun sendiri |

Issuer adalah `<BETTER_AUTH_URL>/api/auth`; audience resource `<BETTER_AUTH_URL>/api/mcp`. Alias OAuth well-known tanpa suffix juga tersedia. Scope: `statsarena:read` dan `offline_access`; tanpa scope tulis. OIDC dan scope `openid` tidak diaktifkan.

ChatGPT memakai **Client ID Metadata Document (CIMD)**. URL metadata hanya boleh dari origin HTTPS `chatgpt.com`, melalui transport paket yang memvalidasi DNS/IP publik dan mematok koneksi tanpa mengikuti redirect. Pendaftaran client dinamis terbuka (DCR) dimatikan. Pembuatan client manual melalui provider dibatasi admin; klien lain memerlukan pendaftaran admin. Tidak menggunakan wildcard callback atau izin metadata URL sembarang.

Batas layanan: **60 HTTP request/menit/akun**, dihitung atomik lintas instance di Neon; body 64 KiB dan hasil tool 500.000 byte. Query maksimal 5.000 kompetisi, 1.000 klub/kompetisi, 1.000 laga/klub, 40.000 baris pemain, serta 2.000 marker/chart klub–laga. Scope terlalu besar ditolak, tanpa menyebut hasil terpotong sebagai lengkap. Statistik dibaca dalam transaksi read-only dengan snapshot konsisten. Respons privat/no-store; origin browser asing ditolak.

## Pemasangan Vercel dan ChatGPT

1. Terapkan seluruh migrasi, termasuk `0010_melodic_mulholland_black`, pada StatsArena. URL direct hanya untuk migrasi.
2. Di Vercel, atur pooled `DATABASE_URL`, `BETTER_AUTH_SECRET` unik/stabil minimal 32 karakter, dan `BETTER_AUTH_URL=https://<domain-publik-StatsArena>`. Gunakan origin tetap yang sama untuk discovery, login, dan MCP. Secret/key stabil diperlukan antar instance/deployment. Jangan memakai awalan `NEXT_PUBLIC_`.
3. Deploy package dashboard. `STATSARENA_REPORTS_ONLY=1` tetap mendukung entry MCP/discovery/OAuth UI secara terbatas; masing-masing tetap memeriksa autentikasi. Halaman password deployment Vercel tidak boleh menghalangi discovery/OAuth klien.
4. Pastikan akun sudah menerima undangan dengan kompetisi/klub sesuai. Admin dapat memilih kompetisi melalui `/admin/access?competition=<key>`.
5. Tambahkan server MCP pada ChatGPT dengan URL `https://<domain-publik-StatsArena>/api/mcp` dan OAuth. Mulai koneksi, masuk memakai akun StatsArena, lalu setujui akses baca.
6. Minta daftar kompetisi/klub, lalu statistik. Uji akun staf agar daftar mengikuti grant. Putus koneksi dari StatsArena untuk menghentikan akses.

Tidak membutuhkan API key OpenAI. Token/database tidak dikirim lewat prompt. Akun ChatGPT tidak otomatis menjadi akun StatsArena. Ketersediaan pemasangan MCP mengikuti produk dan kebijakan workspace ChatGPT yang digunakan.

Referensi: [autentikasi ChatGPT](https://developers.openai.com/plugins/build/auth), [MCP ChatGPT](https://developers.openai.com/plugins/build/mcp-server), [MCP di Vercel](https://vercel.com/docs/mcp/deploy-mcp-servers-to-vercel), [Better Auth MCP](https://better-auth.com/docs/plugins/mcp), [CIMD](https://better-auth.com/docs/plugins/cimd), [OAuth provider](https://better-auth.com/docs/plugins/oauth-provider).

## Verifikasi dan batas pemasangan

Test offline memakai Better Auth, SDK MCP client/server, dan migrasi PGlite asli. Cakupan: discovery/CIMD, login/consent/PKCE, audience JWT, replay kode, redirect terikat, token palsu, protokol modern/legacy, field identitas palsu, scope klub/namespace, agregasi berbobot/null, chart, rate limit konkuren, pencabutan grant/koneksi, dan regresi undangan/report.

```sh
pnpm --dir dashboard exec node --import tsx --test test/mcp-auth.test.ts test/mcp-queries.test.ts test/report-auth.test.ts
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Migrasi Neon telah diterapkan: **27 → 35 tabel aplikasi**, 10 → 11 migrasi. Sidik seluruh isi **20 tabel domain tetap sama** sebelum/sesudah. Tidak membuat akun test atau mengubah grant pengguna Neon.

Verifikasi akhir: **202 test lulus** (116 ingest, 86 dashboard), lint/typecheck workspace dan build production lulus. Setelah perbaikan alias discovery, seluruh 86 test dashboard diulang dan lulus; build production final juga lulus. **15 pemeriksaan HTTP** pada build lokal memeriksa metadata resource/issuer, penolakan token palsu/absen, origin asing, query token, tipe body, GET, kelanjutan OAuth tanpa tanda tangan, koneksi privat, serta path metadata di luar layanan.

Browser dengan sesi admin yang sudah ada memeriksa Koneksi aplikasi kosong, pilihan kompetisi IBL/DBL dari Neon, serta daftar klub yang berubah sesuai kompetisi. Navigasi dan select dirapikan pada viewport browser sempit. Tidak membuat undangan, memberi grant, atau menyetujui koneksi aplikasi nyata dalam pemeriksaan ini.

Pembatasan kualitas khusus admin diperiksa dengan daftar tool dan pemanggilan langsung staf, perubahan role memakai bearer yang sama, serta query detail/chart. Seluruh 86 test dashboard, lint, typecheck, dan build lulus setelah perubahan. Tidak memerlukan migrasi atau perubahan data Neon.

Uji CIMD memakai transport metadata tiruan, tanpa mengklaim koneksi ChatGPT nyata. Deployment Vercel dan OAuth melalui ChatGPT pada domain publik belum diverifikasi.
