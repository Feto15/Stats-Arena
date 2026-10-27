# Login dan akses report klub

StatsArena memakai **Better Auth 1.7.12**, adapter Drizzle PostgreSQL, dan Neon pada schema `statsarena`. Data pertandingan report utama serta akun, hash password, sesi, pembatasan percobaan login, undangan, dan penugasan akses klub dibaca dari Neon. Daftar klub/keanggotaan untuk undangan juga mengikuti Neon; lihat [REPORTING_NEON.md](./REPORTING_NEON.md).

## Hak akses

- Admin mempunyai akses seluruh dashboard, seluruh report, dan halaman `/admin/access` untuk mengundang staf, membatalkan undangan, serta mencabut akses klub. Setelah login tanpa tujuan rinci, admin menuju `/`; staf menuju `/reports`.
- Staf memakai akun per orang. Akses terikat pada pasangan `competitionKey` + `clubSourceId`, sehingga ID klub yang sama pada kompetisi berbeda tidak otomatis mendapat akses.
- Indeks dan pilihan klub hanya memuat klub yang ditugaskan. URL klub asing menghasilkan 404 bagi staf. Staf yang mencoba membuka dashboard, Kelola akses, atau demo admin dialihkan ke `/reports`.
- Pengunjung tanpa sesi diarahkan ke `/login`. Pendaftaran umum Better Auth dimatikan; mengirim `isAdmin` dari browser tidak bisa memberi hak admin. Halaman, Server Actions, dan pembaca data dashboard memeriksa otorisasi di server.

Implementasi memakai sesi Better Auth dan tabel penugasan/undangan aplikasi yang khusus report. Tidak mengaktifkan API Organization/Admin plugin yang tidak diperlukan, dan tidak mengaitkan akun staf dengan entitas pemain/roster olahraga.

## Konfigurasi

Environment server:

```text
DATABASE_URL=<pooled connection Neon StatsArena>
DIRECT_DATABASE_URL=<direct connection untuk migrasi>
BETTER_AUTH_SECRET=<random unik minimal 32 karakter>
BETTER_AUTH_URL=http://localhost:3000
STATSARENA_REPORTS_ONLY=1
```

Produksi memakai origin HTTPS deployment pada `BETTER_AUTH_URL`, tanpa path/query, dan secret unik yang disimpan di environment hosting. Cookie menggunakan HttpOnly, SameSite=Lax, serta Secure pada HTTPS. Origin request divalidasi Better Auth; login dibatasi lima percobaan per 60 detik per key IP/path melalui storage database. Hosting harus mempertahankan header IP dari proxy tepercaya.

`STATSARENA_REPORTS_ONLY=1` membatasi route untuk non-admin: login, aktivasi undangan, report, dan API autentikasi yang diperlukan tetap tersedia. Admin terverifikasi boleh membuka seluruh aplikasi meskipun flag ini aktif. Proxy memeriksa sesi Better Auth di server sebelum memberi pengecualian admin; cookie/role dari input browser tidak dipercaya. Pemeriksaan halaman/data/aksi tetap berlaku. Tidak ada flag untuk melewati otorisasi. Secret yang tidak tersedia tidak diganti nilai dummy; kegagalan layanan tidak membuka report.

Setelah login/aktivasi, `/auth/continue` menentukan tujuan dari role sesi server. Admin default ke dashboard `/`, staf ke `/reports`; tautan rinci report atau undangan yang valid dipertahankan. Tujuan dashboard hanya dipertahankan untuk admin, dan tujuan eksternal/invalid ditolak. Pada header report admin tersedia tautan **Dashboard** dan **Kelola akses**.

## Admin pertama

Setelah migrasi, jalankan dari root repository:

```sh
pnpm --dir dashboard run auth:bootstrap --help
pnpm --dir dashboard run auth:bootstrap --email <email-admin> --dry-run
pnpm --dir dashboard run auth:bootstrap --email <email-admin>
```

CLI hanya membuat undangan admin pertama, bukan menetapkan password. Target schema dan identitas dataset StatsArena diperiksa. Operasi menolak jika admin sudah ada, dan tidak mengganti undangan bootstrap aktif yang tidak mempunyai file privat yang cocok.

Tautan aktivasi disimpan pada `dashboard/.auth-bootstrap.json` dengan izin file 0600, diabaikan Git, dan tidak dicetak ke terminal. Buka URL privat pada file tersebut, lalu pemilik akun menentukan nama dan password (12–128 karakter) pada halaman aktivasi. Tautan berlaku 72 jam dan hanya dapat dipakai sekali. Jangan memasukkan file ini ke deployment, log, atau commit. Secret juga tidak boleh masuk Client Component.

Pada pemasangan 26 Oktober 2026, undangan pertama dibuat untuk email yang ditentukan pengguna. Akun/password baru terbentuk ketika pemilik menyelesaikan aktivasi, bukan ketika undangan dibuat. Tidak ada password bawaan atau akun test yang ditulis ke Neon.

## Mengundang staf

1. Admin masuk dan membuka **Kelola akses**.
2. Masukkan email penerima dan pilih satu atau beberapa klub.
3. Buat dan salin tautan undangan, lalu bagikan hanya kepada orang yang dituju.
4. Penerima menentukan nama/password, atau masuk dahulu jika sudah mempunyai akun dengan email tersebut, kemudian menerima akses.

Pengiriman email otomatis belum dikonfigurasi; aplikasi tidak mengirim pesan ke penerima. Tautan merupakan bukti penguasaan undangan dan harus diperlakukan privat. Email undangan ditetapkan admin dan tidak dapat diganti pada aktivasi. Sesi akun lain tidak bisa menerima undangan tersebut. Undangan bukan tanda verifikasi email melalui inbox; tidak ada klaim `emailVerified=true` yang dibuat oleh aplikasi.

Hash SHA-256 token undangan disimpan di Neon; token mentah hanya pada tautan yang ditampilkan satu kali kepada admin. Undangan kedaluwarsa/dibatalkan/dipakai ditolak. Pembuatan akun dan hash password oleh Better Auth, grant klub, serta penandaan undangan diterima berada dalam satu transaksi dengan row lock. Kegagalan grant mengembalikan semuanya. Pengguna lama tidak bisa memakai undangan untuk menimpa password akun.

Pencabutan akses diperiksa kembali pada permintaan berikutnya, dengan sesi yang sama. Cookie cache sesi tidak diaktifkan dan grant dibaca dari database; tidak mempercayai role/ID klub yang dikirim browser. Keluar membatalkan sesi di server. Respons report/login/undangan/admin memakai cache privat/no-store; undangan memakai no-referrer. Alur reset password melalui email dan SMTP belum diaktifkan.

## Schema dan verifikasi

Migrasi `0009_faithful_hellion` menambah tujuh tabel: `auth_users`, `auth_accounts`, `auth_sessions`, `auth_verifications`, `auth_rate_limits`, `auth_club_access`, `auth_invitations`. Tidak mengubah kolom, hubungan, atau data statistik basket. Migrasi diterapkan di Neon setelah preflight; fingerprint seluruh **20 tabel domain lama** sama sebelum dan sesudahnya.

Test `dashboard/test/report-auth.test.ts` menggunakan Better Auth asli dengan PostgreSQL lokal PGlite, tanpa Neon/kredensial. Cakupan: signup umum dan field admin palsu, origin asing/cookie palsu, aktivasi tunggal, hash password, sesi/login/logout, scope kompetisi/klub, pembatasan aksi admin, nilai undangan expired/revoked, pengguna lama, rollback akun/credential/grant, pencabutan akses pada sesi aktif, rate limit, dan redirect eksternal. Hasil pemeriksaan keseluruhan dan browser dicatat setelah selesai; test lokal tidak dianggap bukti login produksi atau deployment hosting.

Verifikasi akhir 26 Oktober 2026: **172 test lulus** (114 ingest, 58 dashboard), lint/typecheck seluruh workspace, dan build production dashboard lulus. Test jumlah migrasi mengikuti journal aktual; clock test cache fixture dibekukan agar waktu proses tidak memicu expiry yang tidak sedang diuji. Tidak ada perubahan parser/importer produksi.

**23 pemeriksaan HTTP** pada server production lokal memverifikasi pengalihan seluruh 10 klub dan admin ke login tanpa isi report privat, tujuan URL/filter tetap tersimpan, cookie palsu ditolak, signup umum 400, login akun tidak valid 401, origin asing 403, dan mode khusus report tetap memblokir dashboard. Setelah streaming dimulai, Next dapat membawa redirect dalam respons HTTP 200 dengan `NEXT_REDIRECT`; pemeriksaan juga memastikan isi report tidak ikut respons dan cache privat/no-store aktif.

Browser memeriksa login salah, tombol kembali aktif, pengalihan dari report langsung, serta halaman aktivasi admin yang emailnya terkunci. Lebar 1440/390 px tidak meluber, tanpa warning/error browser, dan viewport dipulihkan. Pada pemeriksaan awal, halaman aktivasi disiapkan tanpa menetapkan password. Setelah pemilik menentukan password dan memberikan konfirmasi aktivasi, akun admin berhasil diaktifkan melalui browser pada 26 Oktober 2026. Login otomatis, akses 10 klub, serta halaman Kelola akses dengan 10 pilihan klub dan status admin telah diverifikasi memakai akun nyata. Perilaku staf dan transaksi undangan tetap diuji melalui Better Auth dan SQL PGlite. Tidak ada pengiriman email atau deployment hosting baru.

Pembaruan tujuan berdasarkan role, 26 Oktober 2026: **59 test dashboard**, lint/typecheck dashboard, serta build production lulus. Test memakai role sesi Better Auth nyata pada SQL lokal untuk membedakan pengecualian admin dan pengalihan staf, serta memeriksa tujuan login dan penolakan redirect eksternal. **16 pemeriksaan HTTP** memastikan root/dashboard/admin/demo mengalihkan pengunjung tanpa sesi dan cookie palsu ke report. Dengan akun admin nyata dan flag report-only aktif, browser membuka Overview, Games, Teams, Players, Standings, dan Review; `/login?next=/reports` serta `/auth/continue` berakhir di dashboard `/`. Browser tanpa warning/error, viewport dipulihkan. Tidak ada perubahan schema, grant, atau data pertandingan.

Referensi implementasi: [integrasi Next.js](https://better-auth.com/docs/integrations/next), [adapter Drizzle](https://better-auth.com/docs/adapters/drizzle), [email/password](https://better-auth.com/docs/authentication/email-password).
