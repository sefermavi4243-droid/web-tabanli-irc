const express   = require('express');
const http      = require('http');
const https     = require('https');
const WebSocket = require('ws');
const cors      = require('cors');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const multer    = require('multer');
const fs        = require('fs');
const path      = require('path');
const db        = require('./database');

const app        = express();
const JWT_SECRET = process.env.JWT_SECRET || 'nexus_dev_secret_2024';
const PORT       = process.env.PORT || 3000;
const UPLOADS    = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(UPLOADS));
app.use(express.static(path.join(__dirname, '../frontend')));

// ── Multer ─────────────────────────────────────────
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS),
    filename:    (_req, file, cb) => {
      const safe = Date.now() + '_' + Math.random().toString(36).slice(2) + path.extname(file.originalname);
      cb(null, safe);
    }
  }),
  limits: { fileSize: 25 * 1024 * 1024 }
});

// ── Auth middleware ─────────────────────────────────
function auth(req, res, next) {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  if (!t) return res.status(401).json({ error: 'Token gerekli' });
  try { req.user = jwt.verify(t, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Geçersiz token' }); }
}

// ══════════════════════════════════════════════════
//  REST API
// ══════════════════════════════════════════════════

// Kayıt
app.post('/api/register', async (req, res) => {
  const { username, password, display_name } = req.body;
  if (!username || !password)        return res.status(400).json({ error: 'Kullanıcı adı ve şifre gerekli' });
  if (username.length < 3)           return res.status(400).json({ error: 'Kullanıcı adı en az 3 karakter' });
  if (password.length < 6)           return res.status(400).json({ error: 'Şifre en az 6 karakter' });
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.status(400).json({ error: 'Sadece harf, rakam ve _ kullanın' });
  if (db.prepare('SELECT id FROM users WHERE username=?').get(username))
    return res.status(409).json({ error: 'Bu kullanıcı adı alınmış' });

  const hash = await bcrypt.hash(password, 10);
  const r    = db.prepare('INSERT INTO users (username,password_hash,display_name) VALUES (?,?,?)').run(username, hash, display_name || username);
  const token = jwt.sign({ id: r.lastInsertRowid, username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, id: r.lastInsertRowid, username, display_name: display_name || username });
});

// Giriş
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!user || !(await bcrypt.compare(password, user.password_hash)))
    return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı' });
  db.prepare('UPDATE users SET last_seen=CURRENT_TIMESTAMP WHERE id=?').run(user.id);
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, id: user.id, username: user.username, display_name: user.display_name || user.username, avatar: user.avatar });
});

// Profil al
app.get('/api/profile/:id', auth, (req, res) => {
  const u = db.prepare('SELECT id,username,display_name,avatar,bio,created_at,last_seen FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Bulunamadı' });
  res.json(u);
});

// Profil güncelle
app.put('/api/profile', auth, (req, res) => {
  const { display_name, bio } = req.body;
  db.prepare('UPDATE users SET display_name=?,bio=? WHERE id=?').run(display_name || '', bio || '', req.user.id);
  res.json({ ok: true });
});

// Avatar yükle
app.post('/api/avatar', auth, upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Dosya yüklenemedi' });
  const url = '/uploads/' + req.file.filename;
  db.prepare('UPDATE users SET avatar=? WHERE id=?').run(url, req.user.id);
  res.json({ avatar: url });
});

// Odaları listele
app.get('/api/rooms', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM rooms ORDER BY category,name').all();
  res.json(rows);
});

// Oda oluştur
app.post('/api/rooms', auth, (req, res) => {
  let { name, description, category } = req.body;
  if (!name) return res.status(400).json({ error: 'İsim gerekli' });
  name = (name.startsWith('#') ? name : '#' + name).toLowerCase().replace(/\s+/g, '-');
  if (db.prepare('SELECT id FROM rooms WHERE name=?').get(name))
    return res.status(409).json({ error: 'Bu kanal zaten var' });
  const r = db.prepare('INSERT INTO rooms (name,description,category,created_by) VALUES (?,?,?,?)').run(name, description || '', category || 'Genel', req.user.id);
  res.json({ id: r.lastInsertRowid, name, description: description || '', category: category || 'Genel' });
});

// Oda mesajlarını getir
app.get('/api/rooms/:id/messages', auth, (req, res) => {
  const msgs = db.prepare(`
    SELECT m.*, u.username, u.display_name, u.avatar
    FROM messages m JOIN users u ON m.user_id=u.id
    WHERE m.room_id=? ORDER BY m.id DESC LIMIT 80
  `).all(req.params.id);
  res.json(msgs.reverse());
});

// Mesaj sil
app.delete('/api/messages/:id', auth, (req, res) => {
  const msg = db.prepare('SELECT * FROM messages WHERE id=?').get(req.params.id);
  if (!msg) return res.status(404).json({ error: 'Mesaj bulunamadı' });
  if (msg.user_id !== req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  db.prepare('UPDATE messages SET is_deleted=1, content=? WHERE id=?').run('[Mesaj silindi]', req.params.id);
  res.json({ ok: true });
});

// Mesaj düzenle
app.put('/api/messages/:id', auth, (req, res) => {
  const msg = db.prepare('SELECT * FROM messages WHERE id=?').get(req.params.id);
  if (!msg || msg.user_id !== req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  db.prepare('UPDATE messages SET content=?,is_edited=1 WHERE id=?').run(req.body.content, req.params.id);
  res.json({ ok: true });
});

// Dosya yükle
app.post('/api/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Dosya yüklenemedi' });
  const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(req.file.originalname);
  res.json({
    url:     '/uploads/' + req.file.filename,
    name:    req.file.originalname,
    size:    req.file.size,
    is_image: isImg
  });
});

// DM geçmişi
app.get('/api/dm/:uid', auth, (req, res) => {
  const other = parseInt(req.params.uid);
  const msgs  = db.prepare(`
    SELECT dm.*, u.username as sender_username, u.display_name as sender_display, u.avatar as sender_avatar
    FROM direct_messages dm JOIN users u ON dm.sender_id=u.id
    WHERE (dm.sender_id=? AND dm.receiver_id=?) OR (dm.sender_id=? AND dm.receiver_id=?)
    ORDER BY dm.id DESC LIMIT 80
  `).all(req.user.id, other, other, req.user.id);
  db.prepare('UPDATE direct_messages SET is_read=1 WHERE receiver_id=? AND sender_id=?').run(req.user.id, other);
  res.json(msgs.reverse());
});

// ══════════════════════════════════════════════════
//  WebSocket
// ══════════════════════════════════════════════════
let server;
const certKey  = path.join(__dirname, 'certs/key.pem');
const certCert = path.join(__dirname, 'certs/cert.pem');
if (process.env.USE_HTTPS === 'true' && fs.existsSync(certKey)) {
  server = https.createServer({ key: fs.readFileSync(certKey), cert: fs.readFileSync(certCert) }, app);
  console.log('🔒 HTTPS aktif');
} else {
  server = http.createServer(app);
}

const wss = new WebSocket.Server({ server });

// clients: Map<userId, { ws, userId, username, display_name, avatar, rooms:Set }>
const clients = new Map();

function sendTo(uid, data) {
  const c = clients.get(uid);
  if (c?.ws.readyState === WebSocket.OPEN) { c.ws.send(JSON.stringify(data)); return true; }
  return false;
}
function broadcastRoom(roomId, data, excludeId = null) {
  const msg = JSON.stringify(data);
  for (const [uid, c] of clients)
    if (uid !== excludeId && c.rooms.has(roomId) && c.ws.readyState === WebSocket.OPEN)
      c.ws.send(msg);
}
function broadcastAll(data, excludeId = null) {
  const msg = JSON.stringify(data);
  for (const [uid, c] of clients)
    if (uid !== excludeId && c.ws.readyState === WebSocket.OPEN)
      c.ws.send(msg);
}
function pushOnlineList() {
  const list = [...clients.values()].map(c => ({ id: c.userId, username: c.username, display_name: c.display_name, avatar: c.avatar }));
  broadcastAll({ type: 'online_users', users: list });
}

wss.on('connection', (ws) => {
  let userId = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // AUTH
    if (msg.type === 'auth') {
      try {
        const p = jwt.verify(msg.token, JWT_SECRET);
        userId = p.id;
        const user = db.prepare('SELECT id,username,display_name,avatar FROM users WHERE id=?').get(userId);
        if (!user) { ws.terminate(); return; }
        if (clients.has(userId)) clients.get(userId).ws.terminate();
        clients.set(userId, { ws, userId, username: user.username, display_name: user.display_name || user.username, avatar: user.avatar, rooms: new Set() });
        db.prepare('UPDATE users SET is_online=1,last_seen=CURRENT_TIMESTAMP WHERE id=?').run(userId);
        ws.send(JSON.stringify({ type: 'auth_ok', userId, username: user.username, display_name: user.display_name || user.username, avatar: user.avatar }));
        pushOnlineList();
      } catch { ws.terminate(); }
      return;
    }

    if (!userId || !clients.has(userId)) return;
    const me = clients.get(userId);

    // ODAYA KATIL
    if (msg.type === 'join_room') {
      me.rooms.add(msg.roomId);
      db.prepare('INSERT OR IGNORE INTO room_members (room_id,user_id) VALUES (?,?)').run(msg.roomId, userId);
      broadcastRoom(msg.roomId, { type: 'user_joined', roomId: msg.roomId, userId, username: me.display_name || me.username }, userId);
    }

    // ODADAN AYRIL
    if (msg.type === 'leave_room') {
      me.rooms.delete(msg.roomId);
    }

    // ODA MESAJI
    if (msg.type === 'room_message') {
      const { roomId, content, file_url, file_name, file_size, is_image } = msg;
      if (!content?.trim() && !file_url) return;
      const text = content?.trim() || '';
      const r = db.prepare('INSERT INTO messages (room_id,user_id,content,file_url,file_name,file_size,is_image) VALUES (?,?,?,?,?,?,?)').run(roomId, userId, text, file_url || null, file_name || null, file_size || null, is_image ? 1 : 0);
      const out = { type: 'room_message', id: r.lastInsertRowid, roomId, userId, username: me.username, display_name: me.display_name || me.username, avatar: me.avatar, content: text, file_url: file_url || null, file_name: file_name || null, file_size: file_size || null, is_image: !!is_image, created_at: new Date().toISOString() };
      // Odadaki herkese gönder (gönderen dahil)
      for (const [, c] of clients)
        if (c.rooms.has(roomId) && c.ws.readyState === WebSocket.OPEN)
          c.ws.send(JSON.stringify(out));
    }

    // MESAJ SİL (WS üzerinden)
    if (msg.type === 'delete_message') {
      const original = db.prepare('SELECT * FROM messages WHERE id=?').get(msg.messageId);
      if (!original || original.user_id !== userId) return;
      db.prepare('UPDATE messages SET is_deleted=1,content=? WHERE id=?').run('[Mesaj silindi]', msg.messageId);
      broadcastRoom(original.room_id, { type: 'message_deleted', messageId: msg.messageId, roomId: original.room_id });
    }

    // MESAJ DÜZENLE (WS üzerinden)
    if (msg.type === 'edit_message') {
      const original = db.prepare('SELECT * FROM messages WHERE id=?').get(msg.messageId);
      if (!original || original.user_id !== userId || !msg.content?.trim()) return;
      db.prepare('UPDATE messages SET content=?,is_edited=1 WHERE id=?').run(msg.content.trim(), msg.messageId);
      broadcastRoom(original.room_id, { type: 'message_edited', messageId: msg.messageId, content: msg.content.trim(), roomId: original.room_id });
    }

    // YAZIYOR
    if (msg.type === 'typing') {
      broadcastRoom(msg.roomId, { type: 'typing', roomId: msg.roomId, userId, username: me.display_name || me.username }, userId);
    }

    // ÖZEL MESAJ
    if (msg.type === 'direct_message') {
      const { receiverId, content, file_url, file_name, is_image } = msg;
      const rid = parseInt(receiverId);
      if (!rid || (!content?.trim() && !file_url)) return;
      const text = content?.trim() || '';
      const r = db.prepare('INSERT INTO direct_messages (sender_id,receiver_id,content,file_url,file_name,is_image) VALUES (?,?,?,?,?,?)').run(userId, rid, text, file_url || null, file_name || null, is_image ? 1 : 0);
      const out = { type: 'direct_message', id: r.lastInsertRowid, senderId: userId, senderUsername: me.username, senderDisplay: me.display_name || me.username, senderAvatar: me.avatar, receiverId: rid, content: text, file_url: file_url || null, file_name: file_name || null, is_image: !!is_image, created_at: new Date().toISOString() };
      sendTo(rid, out);
      ws.send(JSON.stringify(out)); // gönderene yansıt
    }

    // ── KULLANICI ENGELLE ─────────────────────────────────────────
    if (msg.type === 'block_user') {
      const bid = parseInt(msg.targetId);
      if (bid && bid !== userId) {
        db.prepare('INSERT OR IGNORE INTO blocks (blocker_id,blocked_id) VALUES (?,?)').run(userId, bid);
        ws.send(JSON.stringify({ type: 'block_ok', targetId: bid }));
      }
    }
    if (msg.type === 'unblock_user') {
      db.prepare('DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?').run(userId, parseInt(msg.targetId));
      ws.send(JSON.stringify({ type: 'unblock_ok', targetId: msg.targetId }));
    }
    if (msg.type === 'get_blocks') {
      const blist = db.prepare('SELECT b.blocked_id as id, u.username, u.display_name FROM blocks b JOIN users u ON b.blocked_id=u.id WHERE b.blocker_id=?').all(userId);
      ws.send(JSON.stringify({ type: 'block_list', list: blist }));
    }

    // ── MODERATÖR ─────────────────────────────────────────────────
    if (msg.type === 'mod_delete') {
      const orig = db.prepare('SELECT * FROM messages WHERE id=?').get(msg.messageId);
      if (orig) {
        const role = db.prepare('SELECT role FROM room_members WHERE room_id=? AND user_id=?').get(orig.room_id, userId);
        if (orig.user_id === userId || role?.role === 'moderator') {
          db.prepare('UPDATE messages SET is_deleted=1,content=? WHERE id=?').run('[Mesaj silindi]', msg.messageId);
          broadcastRoom(orig.room_id, { type: 'message_deleted', messageId: msg.messageId, roomId: orig.room_id });
        }
      }
    }
    if (msg.type === 'promote_mod') {
      const myRole = db.prepare('SELECT role FROM room_members WHERE room_id=? AND user_id=?').get(msg.roomId, userId);
      if (myRole?.role === 'moderator') {
        db.prepare('INSERT OR REPLACE INTO room_members (room_id,user_id,role) VALUES (?,?,?)').run(msg.roomId, parseInt(msg.targetId), 'moderator');
        sendTo(parseInt(msg.targetId), { type: 'you_are_mod', roomId: msg.roomId });
        broadcastRoom(msg.roomId, { type: 'mod_assigned', roomId: msg.roomId, userId: parseInt(msg.targetId) });
      }
    }

    // ── WebRTC 1-1 ────────────────────────────────────────────────
    if (msg.type === 'webrtc_offer')  sendTo(msg.targetId, { type: 'webrtc_offer',  callerId: userId, callerName: me.display_name || me.username, callerAvatar: me.avatar, sdp: msg.sdp, isGroup: false });
    if (msg.type === 'webrtc_answer') sendTo(msg.targetId, { type: 'webrtc_answer', callerId: userId, sdp: msg.sdp });
    if (msg.type === 'webrtc_ice')    sendTo(msg.targetId, { type: 'webrtc_ice',    fromId: userId, candidate: msg.candidate });
    if (msg.type === 'webrtc_reject') sendTo(msg.targetId, { type: 'webrtc_reject', fromId: userId, fromName: me.display_name || me.username });
    if (msg.type === 'webrtc_hangup') sendTo(msg.targetId, { type: 'webrtc_hangup', fromId: userId });

    // ── GRUP GÖRÜŞME SİGNALING (Mesh P2P) ────────────────────────
    if (msg.type === 'group_offer')  sendTo(msg.targetId, { type: 'webrtc_offer', callerId: userId, callerName: me.display_name || me.username, callerAvatar: me.avatar, sdp: msg.sdp, isGroup: true, roomId: msg.roomId });
    if (msg.type === 'group_answer') sendTo(msg.targetId, { type: 'webrtc_answer', callerId: userId, sdp: msg.sdp, isGroup: true });
    if (msg.type === 'group_ice')    sendTo(msg.targetId, { type: 'webrtc_ice', fromId: userId, candidate: msg.candidate });
    if (msg.type === 'group_join')   broadcastRoom(msg.roomId, { type: 'group_participant_joined', userId, username: me.username, display_name: me.display_name || me.username, avatar: me.avatar, roomId: msg.roomId }, userId);
    if (msg.type === 'group_leave')  broadcastRoom(msg.roomId, { type: 'group_participant_left', userId, roomId: msg.roomId }, userId);
  });

  ws.on('close', () => {
    if (!userId) return;
    clients.delete(userId);
    db.prepare('UPDATE users SET is_online=0,last_seen=CURRENT_TIMESTAMP WHERE id=?').run(userId);
    broadcastAll({ type: 'user_offline', userId });
    pushOnlineList();
  });
});

server.listen(PORT, () => console.log(`\n ၊၊||၊ Echo → http://localhost:${PORT}\n`));
