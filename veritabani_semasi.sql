-- ═══════════════════════════════════════════════
--  Nexus — Veritabanı Şeması
--  SQLite 3 uyumlu
--  WAL modu ve foreign key kısıtlamaları aktif
-- ═══════════════════════════════════════════════

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── KULLANICILAR ─────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    UNIQUE NOT NULL,          -- giriş kullanıcı adı
  password_hash TEXT    NOT NULL,                 -- bcrypt hash (salt:10)
  display_name  TEXT    DEFAULT NULL,             -- görünen isim
  avatar        TEXT    DEFAULT NULL,             -- dosya yolu: /uploads/...
  bio           TEXT    DEFAULT '',               -- profil biyografisi
  is_online     INTEGER DEFAULT 0,               -- 0=çevrimdışı 1=çevrimiçi
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_seen     DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── KANALLAR ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS rooms (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    UNIQUE NOT NULL,            -- örn: #genel, #ders
  description TEXT    DEFAULT '',
  category    TEXT    DEFAULT 'Genel',            -- Genel|Ders|Projeler|Diğer
  created_by  INTEGER REFERENCES users(id),
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── KANAL ÜYELİKLERİ ─────────────────────────────
CREATE TABLE IF NOT EXISTS room_members (
  room_id   INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
  user_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT    DEFAULT 'member',             -- 'member' | 'moderator'
  joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (room_id, user_id)
);

-- ── KANAL MESAJLARI ──────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id    INTEGER REFERENCES rooms(id)  ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id),
  content    TEXT    NOT NULL,
  file_url   TEXT    DEFAULT NULL,               -- yüklenen dosya yolu
  file_name  TEXT    DEFAULT NULL,               -- orijinal dosya adı
  file_size  INTEGER DEFAULT NULL,               -- bayt cinsinden boyut
  is_image   INTEGER DEFAULT 0,                  -- 1=resim olarak göster
  is_deleted INTEGER DEFAULT 0,                  -- yumuşak silme
  is_edited  INTEGER DEFAULT 0,                  -- düzenlendi göstergesi
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── ÖZEL MESAJLAR ────────────────────────────────
CREATE TABLE IF NOT EXISTS direct_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id   INTEGER REFERENCES users(id),
  receiver_id INTEGER REFERENCES users(id),
  content     TEXT    NOT NULL,
  file_url    TEXT    DEFAULT NULL,
  file_name   TEXT    DEFAULT NULL,
  is_image    INTEGER DEFAULT 0,
  is_read     INTEGER DEFAULT 0,                 -- okunma durumu
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── ENGELLEME ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS blocks (
  blocker_id INTEGER REFERENCES users(id),
  blocked_id INTEGER REFERENCES users(id),
  PRIMARY KEY (blocker_id, blocked_id)
);

-- ── PERFORMANS İNDEKSLERİ ────────────────────────
-- Kanal mesajı sorgularında room_id+tarih üzerinden hızlı erişim
CREATE INDEX IF NOT EXISTS idx_msg_room
  ON messages(room_id, created_at);

-- DM geçmişi sorgularında gönderici+alıcı çifti üzerinden hızlı erişim
CREATE INDEX IF NOT EXISTS idx_dm_pair
  ON direct_messages(sender_id, receiver_id, created_at);

-- ── VARSAYILAN KANALLAR ───────────────────────────
INSERT OR IGNORE INTO rooms (name, description, category) VALUES
  ('#genel',      'Genel sohbet',             'Genel'),
  ('#duyurular',  'Önemli duyurular',          'Genel'),
  ('#ders',       'Ders notları ve konular',   'Ders'),
  ('#odev',       'Ödev yardımı',              'Ders'),
  ('#kaynak',     'Paylaşılan kaynaklar',      'Ders'),
  ('#soru-cevap', 'Soru & Cevap',              'Ders'),
  ('#proje',      'Proje tartışmaları',        'Projeler'),
  ('#takim',      'Takım çalışması',           'Projeler');

-- ═══════════════════════════════════════════════
--  İLİŞKİ DİYAGRAMI
-- ═══════════════════════════════════════════════
--
--  users ──────────────────────────< room_members >── rooms
--    │                                    │
--    ├─────────────────────────────────< messages
--    │
--    ├──( sender_id )──────────────────< direct_messages
--    │──( receiver_id )────────────────<
--    │
--    ├──( blocker_id )─────────────────< blocks
--    └──( blocked_id )─────────────────<
--
-- ═══════════════════════════════════════════════
