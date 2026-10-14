const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'nexus.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name  TEXT DEFAULT NULL,
    avatar        TEXT DEFAULT NULL,
    bio           TEXT DEFAULT '',
    is_online     INTEGER DEFAULT 0,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen     DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT UNIQUE NOT NULL,
    description TEXT DEFAULT '',
    category    TEXT DEFAULT 'Genel',
    created_by  INTEGER REFERENCES users(id),
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS room_members (
    room_id   INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
    user_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
    role      TEXT DEFAULT 'member',
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (room_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id    INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
    user_id    INTEGER REFERENCES users(id),
    content    TEXT NOT NULL,
    file_url   TEXT DEFAULT NULL,
    file_name  TEXT DEFAULT NULL,
    file_size  INTEGER DEFAULT NULL,
    is_image   INTEGER DEFAULT 0,
    is_deleted INTEGER DEFAULT 0,
    is_edited  INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS direct_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id   INTEGER REFERENCES users(id),
    receiver_id INTEGER REFERENCES users(id),
    content     TEXT NOT NULL,
    file_url    TEXT DEFAULT NULL,
    file_name   TEXT DEFAULT NULL,
    is_image    INTEGER DEFAULT 0,
    is_read     INTEGER DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS blocks (
    blocker_id INTEGER REFERENCES users(id),
    blocked_id INTEGER REFERENCES users(id),
    PRIMARY KEY (blocker_id, blocked_id)
  );

  CREATE INDEX IF NOT EXISTS idx_msg_room ON messages(room_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_dm_pair  ON direct_messages(sender_id, receiver_id, created_at);
`);

// Varsayılan odalar
const rooms = [
  ['#genel',     'Genel sohbet',           'Genel'],
  ['#duyurular', 'Önemli duyurular',        'Genel'],
  ['#ders',      'Ders notları ve konular', 'Ders'],
  ['#odev',      'Ödev yardımı',            'Ders'],
  ['#kaynak',    'Paylaşılan kaynaklar',    'Ders'],
  ['#soru-cevap','Soru & Cevap',            'Ders'],
  ['#proje',     'Proje tartışmaları',      'Projeler'],
  ['#takim',     'Takım çalışması',         'Projeler'],
];
for (const [name, desc, cat] of rooms) {
  db.prepare('INSERT OR IGNORE INTO rooms (name,description,category) VALUES (?,?,?)').run(name, desc, cat);
}

console.log('✅ Veritabanı hazır:', DB_PATH);
module.exports = db;
