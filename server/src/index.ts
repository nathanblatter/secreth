import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from '../../shared/src';
import { registerSocketHandlers } from './socket/handlers';
import { initDb } from './db';
import authRouter from './auth/authRouter';
import adminRouter from './routes/adminRouter';
import kpiRouter from './routes/kpiRouter';
import { verifyToken } from './auth/jwt';

const app = express();
const httpServer = createServer(app);

const IS_PROD = process.env.NODE_ENV === 'production';
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;

app.use(cors({ origin: IS_PROD ? false : CLIENT_ORIGIN }));
app.use(express.json());

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/kpi', kpiRouter);

// In production, serve the built client files
if (IS_PROD) {
  const clientDist = path.resolve(__dirname, '../../../../client/dist');
  app.use(express.static(clientDist));
}

// Health check
app.get('/health', (_req, res) => res.json({ ok: true }));

const io = new Server<ClientToServerEvents, ServerToClientEvents, {}, SocketData>(httpServer, {
  cors: IS_PROD ? undefined : {
    origin: CLIENT_ORIGIN,
    methods: ['GET', 'POST'],
  },
});

// Attach authenticated user info to socket if a valid token is provided.
// All sockets are allowed to connect — auth is optional.
io.use((socket, next) => {
  const token = socket.handshake.auth?.token as string | undefined;
  if (token) {
    try {
      const payload = verifyToken(token);
      socket.data.userId = payload.userId;
      socket.data.username = payload.username;
      socket.data.isAdmin = payload.isAdmin;
    } catch {
      // Invalid / expired token — connect as unauthenticated
    }
  }
  next();
});

registerSocketHandlers(io);

// Bug report → flightdeck
app.post('/api/bug-report', async (req, res) => {
  const key = process.env.FLIGHTDECK_INGEST_KEY;
  if (!key) return res.status(503).json({ error: 'Bug reporting is not configured.' });
  const { message, severity, url, meta } = req.body || {};
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'A description is required.' });
  }
  const base = (process.env.FLIGHTDECK_URL || 'http://flightdeck:8080').replace(/\/$/, '');
  try {
    const r = await fetch(base + '/api/ingest/bug', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
      body: JSON.stringify({
        site: 'secreth',
        url: url || '',
        message: message.trim().slice(0, 5000),
        severity: ['low', 'med', 'high', 'urgent'].includes(severity) ? severity : 'med',
        meta: meta || {},
      }),
    });
    if (!r.ok) throw new Error('ingest ' + r.status);
    res.json({ ok: true });
  } catch (err) {
    console.error('bug-report forward failed:', err);
    res.status(502).json({ error: 'Could not reach the bug tracker.' });
  }
});

// In production, serve index.html for all non-API/non-socket routes (SPA fallback)
if (IS_PROD) {
  const clientDist = path.resolve(__dirname, '../../../../client/dist');
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

(async () => {
  await initDb();
  httpServer.listen(PORT, () => {
    console.log(`🎮 Secret Hitler server running on port ${PORT}`);
    if (IS_PROD) {
      console.log(`   Serving client at http://localhost:${PORT}`);
    } else {
      console.log(`   Client origin: ${CLIENT_ORIGIN}`);
    }
  });
})();
