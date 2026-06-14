# Deploy VPS + Docker

Panduan ini menyiapkan backend di VPS dengan Docker Compose. Stack berisi backend Node.js, PostgreSQL, Redis, dan opsional Caddy untuk HTTPS otomatis.

Catatan penting: API MVP saat ini masih memakai data in-memory untuk fitur demo. PostgreSQL dan Redis sudah disiapkan serta dicek health-nya, tetapi data unit/sesi demo belum dipersistenkan ke PostgreSQL sampai integrasi database ditambahkan.

## Kebutuhan

- VPS Ubuntu 22.04/24.04.
- Domain/subdomain untuk HTTPS, contoh `api.domainanda.com`.
- DNS A record domain mengarah ke IP publik VPS.
- Port `80` dan `443` terbuka jika memakai Caddy.
- Repository GitHub: `git@github.com:NURIDWAN/rentalps.git`.

## 1. Install Docker di VPS

```bash
sudo apt update
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
printf "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable\n" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
```

Logout/login lagi dari SSH, atau jalankan:

```bash
newgrp docker
```

Verifikasi:

```bash
docker --version
docker compose version
```

## 2. Ambil Source Code

Via SSH GitHub:

```bash
git clone git@github.com:NURIDWAN/rentalps.git
cd rentalps
```

Jika SSH key belum disiapkan di VPS, pakai HTTPS:

```bash
git clone https://github.com/NURIDWAN/rentalps.git
cd rentalps
```

## 3. Buat Environment Production

```bash
cp .env.production.example .env.production
openssl rand -hex 32
```

Edit `.env.production`:

```bash
nano .env.production
```

Minimal ganti nilai ini:

```env
API_DOMAIN=api.domainanda.com
PGPASSWORD=password_postgres_yang_kuat
REDIS_PASSWORD=password_redis_yang_kuat
JWT_SECRET=hasil_openssl_rand_hex_32
```

Jangan commit `.env.production`.

## 4. Jalankan Tanpa HTTPS Publik

Mode ini hanya membuka backend di `127.0.0.1:8080` pada VPS. Cocok untuk cek awal lewat SSH.

```bash
docker compose --env-file .env.production config
docker compose --env-file .env.production up -d --build
docker compose --env-file .env.production ps
curl http://127.0.0.1:8080/api/health
curl http://127.0.0.1:8080/api/health/ready
```

## 5. Jalankan Dengan HTTPS Caddy

Pastikan `API_DOMAIN` sudah mengarah ke IP VPS dan port `80/443` terbuka.

```bash
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.caddy.yml up -d --build
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.caddy.yml ps
```

Test endpoint publik:

```bash
curl https://api.domainanda.com/api/health
curl https://api.domainanda.com/api/health/ready
```

Test login:

```bash
curl -X POST https://api.domainanda.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

## 6. Firewall VPS

Jika memakai UFW:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

Tidak perlu membuka port `8080` karena compose default hanya bind ke `127.0.0.1`.

## 7. Logs Dan Operasi Harian

Lihat logs backend:

```bash
docker compose --env-file .env.production logs -f backend
```

Lihat logs Caddy:

```bash
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.caddy.yml logs -f caddy
```

Restart service:

```bash
docker compose --env-file .env.production restart backend
```

Stop stack:

```bash
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.caddy.yml down
```

Stop stack tanpa menghapus data:

```bash
docker compose --env-file .env.production down
```

Hapus data volume hanya jika benar-benar ingin reset database/cache:

```bash
docker compose --env-file .env.production down -v
```

## 8. Update Deploy

```bash
git pull
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.caddy.yml up -d --build
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.caddy.yml ps
```

## 9. Backup PostgreSQL

Backup:

```bash
docker compose --env-file .env.production exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > rentalps-backup.sql
```

Restore:

```bash
docker compose --env-file .env.production exec -T postgres sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"' < rentalps-backup.sql
```

## 10. URL Mobile App

Set base URL mobile ke endpoint HTTPS:

```bash
cd ../mobile
./gradlew :app:assembleDebug -PBASE_URL=https://api.domainanda.com/api/
```

## 11. Catatan TV Agent LAN

Jika VPS berada di cloud publik, backend tetap tidak bisa langsung mengakses TV Agent di IP lokal rental seperti `192.168.x.x`. Untuk kontrol TV Agent, gunakan salah satu opsi:

- Jalankan stack ini di mini PC/server lokal di tempat rental.
- Pasang VPN private seperti Tailscale/ZeroTier antara VPS dan jaringan rental.
- Buat gateway lokal yang polling ke backend cloud dan mengeksekusi command di LAN.
