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
