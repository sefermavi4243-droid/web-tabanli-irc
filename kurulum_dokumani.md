# Nexus — Kurulum Dokümanı

---

## Gereksinimler

| Araç | Minimum Sürüm | Not |
|------|--------------|-----|
| Node.js | 18.x | https://nodejs.org |
| npm | 9.x | Node.js ile gelir |
| Docker | 24.x | İsteğe bağlı |
| Docker Compose | 2.x | İsteğe bağlı |

---

## Yöntem 1: Manuel Kurulum (Geliştirme)

### Adım 1 — Projeyi İndirin

```
nexus/
├── backend/
│   ├── server.js
│   ├── database.js
│   └── package.json
├── frontend/
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
└── docker/
```

### Adım 2 — Bağımlılıkları Yükleyin

```bash
cd backend
npm install
```

Yüklenen paketler:
- `express` — HTTP sunucusu
- `ws` — WebSocket sunucusu
- `better-sqlite3` — SQLite
- `bcryptjs` — Şifre hashleme
- `jsonwebtoken` — JWT
- `multer` — Dosya yükleme
- `cors` — CORS başlıkları

### Adım 3 — Sunucuyu Başlatın

```bash
node server.js
```

Çıktı:
```
✅ Veritabanı hazır: .../backend/nexus.db
⚡ Nexus → http://localhost:3000
```

### Adım 4 — Tarayıcıda Açın

```
http://localhost:3000
```

> Geliştirme modunda otomatik yeniden başlatma için:
> ```bash
> npm run dev
> ```

---

## Yöntem 2: Docker ile Kurulum (Önerilen)

### Temel Kurulum (Sadece Uygulama)

```bash
cd docker
docker compose up nexus --build -d
```

Uygulama `http://localhost:3000` adresinde hazır olacaktır.

Logları izleyin:
```bash
docker compose logs -f nexus
```

Durdurmak için:
```bash
docker compose down
```

### Tam Kurulum (HTTPS + Nginx + TURN Sunucusu)

#### Adım 1 — SSL Sertifikası Oluşturun

**Geliştirme için (self-signed):**
```bash
cd docker
bash gen-ssl.sh
```

Bu komut `docker/certs/` klasöründe `key.pem` ve `cert.pem` dosyalarını oluşturur.

**Üretim için (Let's Encrypt):**
```bash
# Alan adınız olması gerekir
certbot certonly --standalone -d yourdomain.com
cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem docker/certs/cert.pem
cp /etc/letsencrypt/live/yourdomain.com/privkey.pem   docker/certs/key.pem
```

#### Adım 2 — TURN Sunucusunu Yapılandırın

`docker/turnserver.conf` dosyasını düzenleyin:

```conf
# Sunucunuzun dış IP adresini yazın
external-ip=SUNUCU_IP_ADRESINIZ

# TURN şifresini değiştirin
user=nexususer:GUCLU_BIR_SIFRE
```

#### Adım 3 — Frontend TURN Yapılandırması

`frontend/js/turn-config.js` dosyasını düzenleyin:

```js
window.TURN_URL  = 'turn:SUNUCU_IP_ADRESINIZ:3478';
window.TURN_USER = 'nexususer';
window.TURN_PASS = 'GUCLU_BIR_SIFRE'; // turnserver.conf ile aynı
```

#### Adım 4 — JWT Secret Belirleyin

`docker/docker-compose.yml` dosyasında:

```yaml
environment:
  - JWT_SECRET=BURAYA_EN_AZ_32_KARAKTERLI_RASTGELE_STRING
```

Güçlü secret üretmek için:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

#### Adım 5 — Tüm Servisleri Başlatın

```bash
cd docker
docker compose up --build -d
```

Çalışan servisler:
- `nexus-app` → Node.js uygulaması (port 3000, iç)
- `nexus-nginx` → Nginx (port 80 ve 443)
- `nexus-turn` → coturn TURN sunucusu (port 3478)

Tarayıcıda açın:
```
https://localhost
```

> Self-signed sertifika kullanıyorsanız tarayıcı güvenlik uyarısı verir.
> "Gelişmiş" → "Devam et" seçeneğiyle geçebilirsiniz.

---

## Ortam Değişkenleri

| Değişken | Varsayılan | Açıklama |
|----------|-----------|----------|
| `PORT` | `3000` | Sunucu portu |
| `JWT_SECRET` | `nexus_dev_secret_2024` | JWT imzalama anahtarı — **üretimde mutlaka değiştirin** |
| `DB_PATH` | `./nexus.db` | SQLite veritabanı dosyası |
| `USE_HTTPS` | `false` | `true` yapılırsa Node.js doğrudan TLS kullanır |
| `NODE_ENV` | `development` | `production` yapılırsa hata detayları gizlenir |

---

## Veritabanı

İlk çalıştırmada veritabanı otomatik oluşturulur. Varsayılan kanallar (`#genel`, `#ders`, `#odev` vb.) otomatik eklenir. Herhangi bir migration aracına gerek yoktur.

Veritabanı dosyası:
- Manuel: `backend/nexus.db`
- Docker: `nexus_data` adlı Docker volume içinde kalıcı olarak saklanır

---

## Sorun Giderme

| Sorun | Olası Neden | Çözüm |
|-------|------------|-------|
| `EADDRINUSE :3000` | Port kullanımda | `PORT=3001 node server.js` |
| `better-sqlite3` derleme hatası | Python/build araçları eksik | `npm install --build-from-source` |
| WebSocket bağlanamıyor | Güvenlik duvarı | 3000 portunu aç |
| Kamera çalışmıyor | HTTPS gerekli | `localhost` hariç HTTPS zorunlu |
| TURN çalışmıyor | Firewall UDP 3478 | UDP 3478 portunu aç |
| Docker `permission denied` | Docker grubu | `sudo docker compose up` |
