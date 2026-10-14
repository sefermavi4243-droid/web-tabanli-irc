/* ═══════════════════════════════════════════════════════
   turn-config.js  —  TURN sunucusu yapılandırması
   Bu dosyayı kendi TURN sunucu bilgilerinizle doldurun
   ve frontend/js/ klasörüne koyun.
   
   Ücretsiz TURN sunucusu için: https://www.metered.ca/stun-turn
   Veya kendi sunucunuza coturn kurun (docker-compose ile aşağıda var)
═══════════════════════════════════════════════════════ */

// Kendi TURN bilgilerinizi buraya yazın:
window.TURN_URL  = '';   // örn: 'turn:your-domain.com:3478'
window.TURN_USER = '';   // TURN kullanıcı adı
window.TURN_PASS = '';   // TURN şifre

// Metered.ca ücretsiz TURN örneği:
// window.TURN_URL  = 'turn:a.relay.metered.ca:80';
// window.TURN_USER = 'abc123...';
// window.TURN_PASS = 'def456...';
