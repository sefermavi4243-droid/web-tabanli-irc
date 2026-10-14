# Echo — Web Tabanlı IRC

Tarayıcıda çalışan, IRC tarzı gerçek zamanlı sohbet uygulaması. Kanallarda yazışma, özel mesaj, dosya paylaşımı ve görüntülü görüşme destekler.

![Arayüz](Ekran%20Görüntüleri/Arayüz.png)

## Özellikler

- Kayıt olma ve giriş (JWT ile)
- Kanallar: mesaj gönderme, yanıtlama, düzenleme, silme, yeni kanal açma
- Özel mesajlaşma (DM)
- Emoji ve dosya paylaşımı (resim, belge, arşiv, ses, video — en fazla 25 MB)
- Birebir ve grup görüntülü görüşme (WebRTC)
- Çevrimiçi kullanıcı listesi
- Profil düzenleme ve avatar yükleme
- Kullanıcı engelleme ve moderatör yetkileri

## Kullanılan Teknolojiler

- **Backend:** Node.js, Express, WebSocket (`ws`), SQLite (`better-sqlite3`)
- **Frontend:** HTML, CSS, JavaScript
- **Kurulum:** Docker, Nginx, coturn (TURN sunucusu)

## Hızlı Başlangıç

Node.js 18 veya üstü gerekir.

```bash
cd chatapp_final/backend
npm install
node server.js
```

Ardından tarayıcıda http://localhost:3000 adresini açın. Veritabanı ilk çalıştırmada otomatik oluşturulur.

### Docker ile

```bash
cd chatapp_final/docker
docker compose up nexus --build -d
```

HTTPS, Nginx ve TURN sunucusu dahil tam kurulum için [kurulum_dokumani.md](kurulum_dokumani.md) dosyasına bakın.

> Not: Kamera ve mikrofon, `localhost` dışında yalnızca HTTPS üzerinden çalışır.

## Proje Yapısı

```
chatapp_final/
├── backend/     # Sunucu (server.js) ve veritabanı (database.js)
├── frontend/    # Arayüz (index.html, css, js)
└── docker/      # Docker, Nginx ve TURN yapılandırması
```

## Dokümanlar

- [Kurulum Dokümanı](kurulum_dokumani.md)
- [Kullanım Kılavuzu](kullanim_kilavuzu.md)
- [Veritabanı Şeması](veritabani_semasi.sql)
- [Teknik Rapor](Teknik_rapor.docx)
