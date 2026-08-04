import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import multer from 'multer';
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
    const created = await r.json().catch(() => null) as { id?: string } | null;
    res.json({ ok: true, id: created?.id ?? null });
  } catch (err) {
    console.error('bug-report forward failed:', err);
    res.status(502).json({ error: 'Could not reach the bug tracker.' });
  }
});

// Bug report screenshots → flightdeck attachments
const MAX_SCREENSHOTS = 4;
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024; // 8MB
const SCREENSHOT_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const screenshotUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: MAX_SCREENSHOTS, fileSize: MAX_SCREENSHOT_BYTES },
});

app.post('/api/bug-report/:id/screenshots', (req, res) => {
  const key = process.env.FLIGHTDECK_INGEST_KEY;
  if (!key) return res.status(503).json({ error: 'Bug reporting is not configured.' });
  const itemId = req.params.id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(itemId)) {
    return res.status(400).json({ error: 'Invalid report id.' });
  }
  screenshotUpload.array('files', MAX_SCREENSHOTS)(req, res, async (err: unknown) => {
    if (err) {
      const code = (err as { code?: string }).code;
      if (code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Each screenshot must be 8MB or less.' });
      if (code === 'LIMIT_FILE_COUNT' || code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ error: `At most ${MAX_SCREENSHOTS} screenshots per report.` });
      }
      return res.status(400).json({ error: 'Could not read the upload.' });
    }
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) return res.status(400).json({ error: 'No screenshots provided.' });
    if (files.some((f) => !SCREENSHOT_MIME.has(f.mimetype))) {
      return res.status(400).json({ error: 'Screenshots must be PNG, JPEG, WebP or GIF images.' });
    }
    const base = (process.env.FLIGHTDECK_URL || 'http://flightdeck:8080').replace(/\/$/, '');
    try {
      const form = new FormData();
      for (const f of files) {
        form.append('files', new Blob([new Uint8Array(f.buffer)], { type: f.mimetype }), f.originalname || 'screenshot.png');
      }
      const r = await fetch(`${base}/api/ingest/attachments/${itemId}`, {
        method: 'POST',
        headers: { 'X-API-Key': key },
        body: form,
      });
      const body = await r.json().catch(() => null);
      if (!r.ok) {
        console.error('screenshot forward rejected:', r.status, body);
        return res.status(r.status === 404 || r.status === 410 ? r.status : 502)
          .json({ error: 'The tracker rejected the screenshots.' });
      }
      res.status(201).json({ ok: true, attachments: body });
    } catch (fwdErr) {
      console.error('screenshot forward failed:', fwdErr);
      res.status(502).json({ error: 'Could not reach the bug tracker.' });
    }
  });
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
