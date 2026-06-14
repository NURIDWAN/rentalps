# PS Rental Control — Backend Server

Backend_Server untuk PS Rental Control App (MVP / Fase 1). Node.js + TypeScript + Express, dengan PostgreSQL (data persisten) dan Redis (timer job/cache). Seluruh transport produksi menggunakan HTTPS/TLS 1.2+ (Req 12.4).

Versi MVP ini menyediakan API operasional in-memory untuk demo dan pengujian internal: auth, unit, sesi sewa, pricing, laporan harian, audit log, dan pengiriman LAN command ke TV_Agent. PostgreSQL dan Redis tetap tersedia sebagai fondasi produksi, tetapi API demo tidak gagal saat kedua service tersebut belum hidup.

## Prasyarat

- Node.js >= 18
- PostgreSQL
- Redis

## Setup

```bash
npm install
cp .env.example .env   # lalu sesuaikan nilainya
```

## Skrip

| Skrip | Fungsi |
|---|---|
| `npm run build` | Kompilasi TypeScript ke `dist/` |
| `npm run typecheck` | Type-check server lokal dan entrypoint Vercel tanpa emit |
| `npm run dev` | Jalankan dengan hot-reload |
| `npm start` | Jalankan hasil build |
| `npm run lint` | Linting ESLint |
| `npm test` | Type-check smoke test |

## Deploy ke Vercel

Backend sudah disiapkan untuk deploy serverless Vercel melalui:

| File | Fungsi |
|---|---|
| `api/index.ts` | Entrypoint serverless Vercel yang mengekspor Express app |
| `vercel.json` | Rewrite semua request ke Express app |
| `tsconfig.vercel.json` | Type-check entrypoint Vercel |
| `.vercelignore` | Mengecualikan file lokal/sensitif dari upload |

Deploy dari folder `backend`:

```bash
npm install
npm run build
vercel
```

Deploy production:

```bash
vercel --prod
```

Set environment variable di dashboard Vercel:

| Key | Contoh | Catatan |
|---|---|---|
| `NODE_ENV` | `production` | Mode production |
| `JWT_SECRET` | `isi_dengan_random_secret_panjang` | Wajib diganti, jangan pakai default dev |
| `JWT_EXPIRES_IN` | `8h` | Durasi token |

Vercel sudah menyediakan HTTPS, jadi `TLS_ENABLED` tidak perlu diaktifkan untuk serverless Vercel. Endpoint setelah deploy tetap sama, contoh:

```text
https://nama-project.vercel.app/api/health
https://nama-project.vercel.app/api/auth/login
https://nama-project.vercel.app/api/units
```

Penting untuk LAN Command: Vercel berjalan di cloud, sehingga tidak bisa langsung mengakses TV Agent di IP lokal seperti `192.168.1.50:8080`. Untuk kontrol TV dari Vercel, gunakan salah satu opsi berikut:

- Jalankan LAN Orchestrator/gateway lokal di jaringan rental.
- Gunakan VPN/private network seperti Tailscale atau ZeroTier.
- Expose TV Agent melalui tunnel aman, bukan port forwarding publik tanpa autentikasi.
- Tetap jalankan backend kontrol di server lokal jika kebutuhan utama adalah akses LAN langsung.

Untuk membuat APK mobile mengarah ke URL Vercel, build dengan property `BASE_URL`:

```bash
cd ../mobile
./gradlew :app:assembleDebug -PBASE_URL=https://nama-project.vercel.app/api/
```

## Akun Demo

| Role | Username | Password |
|---|---|---|
| Admin | `admin` | `admin123` |
| Operator | `operator` | `operator123` |

Login:

```bash
curl -X POST http://localhost:8443/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

Gunakan `accessToken` sebagai Bearer token:

```bash
curl http://localhost:8443/api/units \
  -H "Authorization: Bearer TOKEN"
```

## Endpoint MVP

| Method | Path | Fungsi |
|---|---|---|
| `POST` | `/api/auth/login` | Login admin/operator |
| `GET` | `/api/status` | Ringkasan status backend |
| `GET` | `/api/pricing` | Tarif Guest/Member |
| `PUT` | `/api/pricing` | Ubah tarif, Admin only |
| `GET` | `/api/units` | Daftar unit + sesi aktif |
| `POST` | `/api/units` | Tambah unit, Admin only |
| `PUT` | `/api/units/:id` | Edit unit, Admin only |
| `DELETE` | `/api/units/:id` | Hapus unit, Admin only |
| `GET` | `/api/sessions` | Semua sesi |
| `GET` | `/api/sessions/active` | Sesi aktif |
| `POST` | `/api/units/:id/sessions` | Mulai sesi sewa |
| `POST` | `/api/sessions/:id/extend` | Perpanjang sesi |
| `POST` | `/api/sessions/:id/end` | Akhiri sesi dengan konfirmasi |
| `POST` | `/api/units/:id/commands` | Kirim command ke TV_Agent |
| `GET` | `/api/reports/daily?date=YYYY-MM-DD` | Laporan harian |
| `GET` | `/api/audit-logs` | Audit log, Admin only |

## HTTPS / TLS (Req 12.4)

Produksi WAJIB menggunakan TLS. Untuk Vercel, TLS diterminasi oleh platform Vercel. Untuk server mandiri, aktifkan HTTPS/TLS di aplikasi. Untuk pengembangan lokal, hasilkan sertifikat self-signed:

```bash
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout certs/server.key -out certs/server.crt \
  -days 365 -subj "/CN=localhost"
```

Lalu set di `.env`:

```
TLS_ENABLED=true
TLS_KEY_PATH=certs/server.key
TLS_CERT_PATH=certs/server.crt
TLS_MIN_VERSION=TLSv1.2
```

Versi TLS minimum dipaksa minimal `TLSv1.2`; nilai yang lebih rendah otomatis dinaikkan ke baseline aman.

## Struktur

```
src/
  config/      env, logger, koneksi PostgreSQL & Redis
  middleware/  error handler terpusat
  routes/      health check dan API MVP in-memory
  app.ts       konfigurasi Express
  server.ts    bootstrap HTTP/HTTPS
  index.ts     entry point
```
