require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');
const Redis = require('ioredis');
const { Pool } = require('pg');
const Y = require('yjs');

const API_PORT = Number(process.env.API_PORT || 4600);
const JWT_SECRET = process.env.JWT_SECRET || 'replace-me';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const POSTGRES_URL = process.env.POSTGRES_URL || 'postgresql://postgres:postgres@localhost:5432/codecollab';
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8600';
const SNAPSHOT_INTERVAL_SECONDS = Number(process.env.SNAPSHOT_INTERVAL_SECONDS || 30);
const FRONTEND_ORIGIN = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3600';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: FRONTEND_ORIGIN, methods: ['GET', 'POST'] } });

app.use(cors({ origin: FRONTEND_ORIGIN }));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const pool = new Pool({ connectionString: POSTGRES_URL });
const redisPub = new Redis(REDIS_URL);
const redisSub = new Redis(REDIS_URL);

const roomSockets = new Map();
const lastSnapshotAt = new Map();
const roomDocs = new Map();

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).send('Unauthorized');
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    return res.status(401).send('Invalid token');
  }
}

async function query(text, params = []) {
  return pool.query(text, params);
}

async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('interviewer', 'candidate')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'javascript',
      owner_user_id INT NOT NULL REFERENCES users(id),
      current_code TEXT NOT NULL DEFAULT '',
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      room_id INT NOT NULL REFERENCES rooms(id),
      user_id INT NOT NULL REFERENCES users(id),
      complexity_score INT NOT NULL DEFAULT 0,
      quality_score INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS code_snapshots (
      id SERIAL PRIMARY KEY,
      room_id INT NOT NULL REFERENCES rooms(id),
      code TEXT NOT NULL,
      language TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user_created ON sessions(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_snapshots_room_created ON code_snapshots(room_id, created_at DESC);
  `);
}

async function callMlAnalyze({ code, language }) {
  const response = await fetch(`${ML_SERVICE_URL}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, language }),
  });
  if (!response.ok) throw new Error('ML service unavailable');
  return response.json();
}

async function loadRoomDoc(roomId) {
  if (roomDocs.has(roomId)) return roomDocs.get(roomId);

  const doc = new Y.Doc();
  const key = `room:yjs:${roomId}`;
  const savedUpdate = await redisPub.get(key);

  if (savedUpdate) {
    const updateBytes = Buffer.from(savedUpdate, 'base64');
    Y.applyUpdate(doc, updateBytes, 'redis');
  } else {
    const room = await query('SELECT current_code FROM rooms WHERE id = $1', [roomId]);
    const initialCode = room.rows[0]?.current_code || '';
    if (initialCode) {
      const yText = doc.getText('monaco');
      yText.insert(0, initialCode);
      await redisPub.set(key, Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'));
    }
  }

  roomDocs.set(roomId, doc);
  return doc;
}

async function persistRoomCode(roomId, language, code) {
  await query('UPDATE rooms SET current_code = $1, language = $2 WHERE id = $3', [code || '', language || 'javascript', roomId]);

  const last = lastSnapshotAt.get(roomId) || 0;
  const now = Date.now();
  if (now - last > SNAPSHOT_INTERVAL_SECONDS * 1000) {
    await query('INSERT INTO code_snapshots(room_id, code, language) VALUES($1, $2, $3)', [roomId, code || '', language || 'javascript']);
    lastSnapshotAt.set(roomId, now);
  }
}

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password || !role) return res.status(400).send('Missing required fields');
  const hash = await bcrypt.hash(password, 10);
  try {
    const result = await query('INSERT INTO users(name, email, password_hash, role) VALUES($1, $2, $3, $4) RETURNING id, name, email, role', [name, email, hash, role]);
    const user = result.rows[0];
    return res.json({ token: signToken(user), user });
  } catch {
    return res.status(409).send('User already exists');
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).send('Missing credentials');
  const result = await query('SELECT id, name, email, role, password_hash FROM users WHERE email = $1', [email]);
  const row = result.rows[0];
  if (!row) return res.status(401).send('Invalid credentials');
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) return res.status(401).send('Invalid credentials');
  const user = { id: row.id, name: row.name, email: row.email, role: row.role };
  return res.json({ token: signToken(user), user });
});

app.get('/api/auth/me', auth, (req, res) => res.json({ user: req.user }));

app.get('/api/rooms', auth, async (_req, res) => {
  const result = await query('SELECT id, title, language, created_at FROM rooms WHERE is_active = true ORDER BY id DESC LIMIT 50');
  res.json({ rooms: result.rows });
});

app.post('/api/rooms', auth, async (req, res) => {
  const { title, language } = req.body || {};
  const result = await query(
    'INSERT INTO rooms(title, language, owner_user_id, current_code) VALUES($1, $2, $3, $4) RETURNING *',
    [title || 'Untitled Room', language || 'javascript', req.user.id, '// Start coding...']
  );
  res.json({ room: result.rows[0] });
});

app.get('/api/rooms/:id', auth, async (req, res) => {
  const roomId = Number(req.params.id);
  const result = await query('SELECT * FROM rooms WHERE id = $1', [roomId]);
  const room = result.rows[0];
  if (!room) return res.status(404).send('Room not found');
  res.json({ room });
});

app.post('/api/rooms/:id/join', auth, async (req, res) => {
  const roomId = Number(req.params.id);
  await query('INSERT INTO sessions(room_id, user_id) VALUES($1, $2)', [roomId, req.user.id]);
  const roomToken = signToken({ roomId, userId: req.user.id, name: req.user.name, role: req.user.role });
  res.json({ token: roomToken });
});

app.get('/api/sessions/history', auth, async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 10)));
  const offset = (page - 1) * limit;
  const result = await query(
    `SELECT s.id, s.complexity_score, s.quality_score, s.created_at, r.title AS room_title
     FROM sessions s
     JOIN rooms r ON r.id = s.room_id
     WHERE s.user_id = $1
     ORDER BY s.created_at DESC
     LIMIT $2 OFFSET $3`,
    [req.user.id, limit, offset]
  );
  res.json({ sessions: result.rows, page, limit });
});

app.get('/api/sessions/:id/snapshots', auth, async (req, res) => {
  const sessionId = Number(req.params.id);
  const session = await query('SELECT room_id FROM sessions WHERE id = $1 AND user_id = $2', [sessionId, req.user.id]);
  if (!session.rows[0]) return res.status(404).send('Session not found');
  const snapshots = await query('SELECT id, code, language, created_at FROM code_snapshots WHERE room_id = $1 ORDER BY created_at ASC', [session.rows[0].room_id]);
  res.json({ snapshots: snapshots.rows });
});

app.post('/api/ai/analyze', auth, async (req, res) => {
  const { roomId, code, language } = req.body || {};
  if (!roomId || typeof code !== 'string') return res.status(400).send('Invalid payload');
  try {
    const analysis = await callMlAnalyze({ code, language: language || 'javascript' });
    await query(
      `UPDATE sessions
       SET complexity_score = $1, quality_score = $2
       WHERE id = (
         SELECT id FROM sessions
         WHERE room_id = $3 AND user_id = $4
         ORDER BY created_at DESC
         LIMIT 1
       )`,
      [analysis.complexity_score, analysis.quality_score, roomId, req.user.id]
    );
    res.json({ analysis });
  } catch {
    res.status(503).send('Analysis unavailable');
  }
});

redisSub.psubscribe('room:*');
redisSub.on('pmessage', (_pattern, channel, message) => {
  const roomId = Number(channel.split(':')[1]);
  io.to(`room:${roomId}`).emit('room:code', JSON.parse(message));
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Unauthorized'));
  try {
    socket.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    return next(new Error('Unauthorized'));
  }
});

io.on('connection', (socket) => {
  socket.on('room:join', async ({ roomId }) => {
    socket.join(`room:${roomId}`);

    const doc = await loadRoomDoc(roomId);
    const encodedDoc = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');
    socket.emit('room:yjs:init', { update: encodedDoc });

    const room = await query('SELECT language FROM rooms WHERE id = $1', [roomId]);
    socket.emit('room:language', { language: room.rows[0]?.language || 'javascript' });

    const users = roomSockets.get(roomId) || new Set();
    users.add(socket.id);
    roomSockets.set(roomId, users);

    const names = [];
    for (const socketId of users) {
      const s = io.sockets.sockets.get(socketId);
      if (s?.user?.name) names.push(s.user.name);
    }

    io.to(`room:${roomId}`).emit('room:participants', names);
  });

  socket.on('room:yjs:update', async ({ roomId, update }) => {
    if (!update) return;
    const doc = await loadRoomDoc(roomId);
    const updateBuffer = Buffer.from(update, 'base64');
    try {
      Y.applyUpdate(doc, updateBuffer, socket.id);
    } catch {
      return;
    }

    const merged = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');
    await redisPub.set(`room:yjs:${roomId}`, merged);

    socket.to(`room:${roomId}`).emit('room:yjs:update', { update });
  });

  socket.on('room:code', async ({ roomId, code, language }) => {
    await persistRoomCode(roomId, language, code);
    await redisPub.publish(`room:${roomId}`, JSON.stringify({ code, language }));
  });

  socket.on('disconnect', () => {
    for (const [roomId, ids] of roomSockets.entries()) {
      if (ids.delete(socket.id)) {
        const names = [];
        for (const socketId of ids) {
          const s = io.sockets.sockets.get(socketId);
          if (s?.user?.name) names.push(s.user.name);
        }
        io.to(`room:${roomId}`).emit('room:participants', names);
      }
      if (ids.size === 0) roomSockets.delete(roomId);
    }
  });
});

async function start() {
  await initDb();
  server.listen(API_PORT, () => console.log(`CodeCollab API+WS listening on port ${API_PORT}`));
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
