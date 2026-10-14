#!/bin/bash
# Geliştirme için self-signed SSL sertifikası oluşturur
mkdir -p certs
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout certs/key.pem \
  -out certs/cert.pem \
  -subj "/C=TR/ST=Istanbul/O=Nexus/CN=localhost"
echo "Sertifika olusturuldu: docker/certs/"
echo ""
echo "WebRTC icin HTTPS gereklidir!"
echo "Uretim icin Let's Encrypt kullanin:"
echo "  certbot certonly --standalone -d yourdomain.com"
echo "  cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem docker/certs/cert.pem"
echo "  cp /etc/letsencrypt/live/yourdomain.com/privkey.pem  docker/certs/key.pem"
