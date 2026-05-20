import { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents, SocketData, GameResult } from '../../../shared/src';
import { RoomManager } from '../game/RoomManager';
import type { GameRoom } from '../game/GameRoom';
import { narrateLogEntry, narrateGameOver } from '../ttsService';
import { recordGameStart, recordGameEnd, countRecentGames } from '../services/gameService';
import { generateAIPersonalities } from '../services/masterAiService';
import { AIPlayerService } from '../services/aiPlayerService';

// roomCode → database game id (for recording game lifecycle)
const gameDbIds = new Map<string, number>();

// "roomCode:playerName" → pending player-left notification timer
const disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

// roomCode → AI player service
const aiServices = new Map<string, AIPlayerService>();

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;
type AppServer = Server<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;

const rooms = new RoomManager();

function log(event: string, socketId: string, data?: Record<string, unknown>) {
  const extra = data ? ' ' + JSON.stringify(data) : '';
  console.log(`[${event}] socket=${socketId}${extra}`);
}

function logError(event: string, socketId: string, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[${event}] ERROR socket=${socketId} ${msg}`);
}

// Broadcast full game state + each player's private state to whole room
function broadcastState(io: AppServer, room: ReturnType<RoomManager['getRoom']>) {
  if (!room) return;
  const state = room.getState();
  log('broadcast', 'server', { room: state.roomCode, phase: state.phase, players: state.players.length });

  // Send public state to everyone in the socket room
  io.to(room.roomCode).emit('game:state', state);

  // Send private state to each player individually (skip AI players — no socket)
  for (const playerId of room.getPlayerIds()) {
    if (room.isAIPlayer(playerId)) continue;
    try {
      const privateState = room.getPrivateState(playerId);
      const hasPolicies = !!privateState.policyChoices;
      log('private-state', playerId, { role: privateState.role, hasPolicies, policyCount: privateState.policyChoices?.length });
      io.to(playerId).emit('game:private-state', privateState);
    } catch {
      // player may not have role yet (lobby phase)
    }
  }
}

async function resolveVoteAndAdvance(io: AppServer, room: GameRoom): Promise<void> {
  const { votes, result, chaosPolicy } = room.resolveVote();
  log('election:resolve', 'server', { result, chaosPolicy });
  io.to(room.roomCode).emit('game:vote-reveal', votes, result);

  if (chaosPolicy) {
    io.to(room.roomCode).emit('game:chaos-policy', chaosPolicy);
  }

  broadcastState(io, room);
  emitNarrationForLatestEntry(io, room);

  const state = room.getState();
  if (state.result) {
    log('game:over', 'server', { result: state.result });
    io.to(room.roomCode).emit('game:over', state.result, room.getAllRoles());
    emitNarrationForGameOver(io, room, state.result);
    recordGameOverInDb(room, state.result);
  }

  setTimeout(() => {
    if (!room.getState().result) {
      room.advanceAfterVote();
      const newState = room.getState();
      log('post-vote-advance', 'server', { phase: newState.phase, president: newState.currentPresidentId });
      io.to(room.roomCode).emit('game:phase-change', newState.phase);
      broadcastState(io, room);
    }
  }, 3000);
}

async function emitNarrationForLatestEntry(io: AppServer, room: GameRoom) {
  const state = room.getState();
  if (!state.roomSettings.centralBoardEnabled || !state.roomSettings.ttsNarrationEnabled) return;
  const lastEntry = state.gameLog[state.gameLog.length - 1];
  if (!lastEntry) return;
  const audio = await narrateLogEntry(lastEntry);
  if (audio) io.to(room.roomCode).emit('game:narration', audio);
}

async function emitNarrationForGameOver(io: AppServer, room: GameRoom, result: GameResult) {
  const state = room.getState();
  if (!state.roomSettings.centralBoardEnabled || !state.roomSettings.ttsNarrationEnabled) return;
  const audio = await narrateGameOver(result);
  if (audio) io.to(room.roomCode).emit('game:narration', audio);
}

function recordGameOverInDb(room: GameRoom, result: GameResult): void {
  const gameId = gameDbIds.get(room.roomCode);
  if (!gameId) return;
  const allRoles = room.getAllRoles();
  const players = room.getState().players.map((p) => ({
    name: p.name,
    role: allRoles[p.id]?.role ?? 'unknown',
    survived: p.status === 'alive',
  }));
  recordGameEnd(gameId, result, players).then(() => {
    gameDbIds.delete(room.roomCode);
  });
}

export function registerSocketHandlers(io: AppServer) {
  io.on('connection', (socket: AppSocket) => {
    log('connected', socket.id);

    // ─── Lobby ─────────────────────────────────────────────────────────────

    socket.on('lobby:create', (playerName, callback) => {
      log('lobby:create', socket.id, { playerName });
      if (!socket.data.userId) {
        callback('ERROR');
        socket.emit('error', 'You must be signed in to create a room');
        return;
      }
      try {
        const room = rooms.createRoom(socket.id, playerName);
        socket.data.playerId = socket.id;
        socket.data.roomCode = room.roomCode;
        socket.data.playerName = playerName;
        socket.join(room.roomCode);
        socket.join(socket.id);
        log('lobby:create', socket.id, { roomCode: room.roomCode, success: true });
        callback(room.roomCode);
        broadcastState(io, room);
      } catch (err: any) {
        logError('lobby:create', socket.id, err);
        callback('ERROR');
        socket.emit('error', err.message);
      }
    });

    socket.on('lobby:join', (roomCode, playerName, callback) => {
      const code = roomCode.toUpperCase();
      log('lobby:join', socket.id, { roomCode: code, playerName });
      try {
        // First try reconnection (player returning with new socket ID)
        const reconnected = rooms.reconnectPlayer(code, playerName, socket.id);
        if (reconnected) {
          log('lobby:join', socket.id, { reconnected: true, roomCode: code });
          socket.data.playerId = socket.id;
          socket.data.roomCode = code;
          socket.data.playerName = playerName;
          socket.join(code);
          socket.join(socket.id);
          // Cancel any pending player-left notification
          const timerKey = `${code}:${playerName}`;
          const pending = disconnectTimers.get(timerKey);
          if (pending) { clearTimeout(pending); disconnectTimers.delete(timerKey); }
          callback(null);
          io.to(code).emit('game:player-reconnected', playerName);
          broadcastState(io, reconnected);
          return;
        }

        // Normal join
        const room = rooms.joinRoom(code, socket.id, playerName);
        socket.data.playerId = socket.id;
        socket.data.roomCode = code;
        socket.data.playerName = playerName;
        socket.join(code);
        socket.join(socket.id);
        log('lobby:join', socket.id, { success: true, playerCount: room.getPlayerIds().length });
        callback(null);
        io.to(code).emit('game:player-joined', playerName, room.getPlayerIds().length);
        broadcastState(io, room);
      } catch (err: any) {
        logError('lobby:join', socket.id, err);
        callback(err.message);
      }
    });

    socket.on('lobby:start', async (callback) => {
      log('lobby:start', socket.id);
      if (!socket.data.userId) {
        callback('You must be signed in to start a game');
        return;
      }

      // Rate limit: non-admin users may start at most 2 games per 24 hours
      if (!socket.data.isAdmin) {
        const recentCount = await countRecentGames(socket.data.userId, 24 * 60 * 60 * 1000);
        if (recentCount >= 2) {
          callback('You have reached the limit of 2 games per 24 hours');
          return;
        }
      }

      try {
        const room = rooms.getRoomForPlayer(socket.id);
        if (!room) throw new Error('Not in a room');

        // Add AI players if configured
        const aiCount = room.getState().roomSettings.aiPlayerCount;
        let personalities: import('../services/masterAiService').AIPersonality[] = [];
        if (aiCount > 0) {
          personalities = await generateAIPersonalities(aiCount);
          const humanNames = new Set(room.getState().players.map(p => p.name.toLowerCase()));
          for (const personality of personalities) {
            // Ensure name doesn't collide with human players
            let name = personality.name;
            if (humanNames.has(name.toLowerCase())) {
              name = name.length <= 10 ? name + ' II' : name.slice(0, 10) + ' II';
              personality.name = name.slice(0, 12);
            }
            room.addAIPlayer(personality.id, personality.name);
          }
        }

        room.startGame(socket.id);

        // Set up AI service
        if (personalities.length > 0) {
          const aiService = new AIPlayerService(room, io, personalities, (r) => resolveVoteAndAdvance(io, r));
          aiServices.set(room.roomCode, aiService);
          room.setAIEventCallback((e) => aiService.handleEvent(e));
          // Fire role-reveal intro chat (after service is set up)
          aiService.handleEvent({ type: 'role-reveal' });
        }

        const state = room.getState();
        log('lobby:start', socket.id, { phase: state.phase, playerCount: state.players.length, president: state.currentPresidentId });

        // Record game start in DB (fire-and-forget)
        recordGameStart(room.roomCode, socket.data.userId, state.players.length).then((gameId) => {
          if (gameId) gameDbIds.set(room.roomCode, gameId);
        });

        io.to(room.roomCode).emit('game:phase-change', 'role-reveal');
        broadcastState(io, room);

        // Auto-advance to election after 8s
        setTimeout(() => {
          if (room.getState().phase === 'role-reveal') {
            room.acknowledgeRoles();
            log('auto-advance', 'server', { from: 'role-reveal', to: 'election-nominate' });
            io.to(room.roomCode).emit('game:phase-change', 'election-nominate');
            broadcastState(io, room);
          }
        }, 8000);

        callback(null);
      } catch (err: any) {
        logError('lobby:start', socket.id, err);
        callback(err.message);
      }
    });

    socket.on('lobby:restart', (callback) => {
      log('lobby:restart', socket.id);
      try {
        const room = rooms.getRoomForPlayer(socket.id);
        if (!room) throw new Error('Not in a room');
        aiServices.delete(room.roomCode);
        room.resetToLobby(socket.id);
        log('lobby:restart', socket.id, { roomCode: room.roomCode, success: true });
        // Clear any pending disconnect timers for this room
        for (const [key, timer] of disconnectTimers) {
          if (key.startsWith(room.roomCode + ':')) {
            clearTimeout(timer);
            disconnectTimers.delete(key);
          }
        }
        io.to(room.roomCode).emit('game:phase-change', 'lobby');
        broadcastState(io, room);
        callback(null);
      } catch (err: any) {
        logError('lobby:restart', socket.id, err);
        callback(err.message);
      }
    });

    socket.on('lobby:dismiss', (callback) => {
      log('lobby:dismiss', socket.id);
      try {
        const room = rooms.getRoomForPlayer(socket.id);
        if (!room) throw new Error('Not in a room');
        if (room.getState().hostId !== socket.data.playerId) throw new Error('Only the host can dismiss the room');
        // Clear any pending disconnect timers for this room
        for (const [key, timer] of disconnectTimers) {
          if (key.startsWith(room.roomCode + ':')) {
            clearTimeout(timer);
            disconnectTimers.delete(key);
          }
        }
        aiServices.delete(room.roomCode);
        io.to(room.roomCode).emit('room:dismissed');
        rooms.dismissRoom(room.roomCode);
        log('lobby:dismiss', socket.id, { roomCode: room.roomCode });
        callback(null);
      } catch (err: any) {
        logError('lobby:dismiss', socket.id, err);
        callback(err.message);
      }
    });

    // ─── Room Settings ────────────────────────────────────────────────────

    socket.on('lobby:update-settings', (settings, callback) => {
      log('lobby:update-settings', socket.id, { settings });
      try {
        const room = rooms.getRoomForPlayer(socket.id);
        if (!room) throw new Error('Not in a room');
        room.updateSettings(socket.id, settings);
        broadcastState(io, room);
        callback(null);
      } catch (err: any) {
        logError('lobby:update-settings', socket.id, err);
        callback(err.message);
      }
    });

    // ─── Board Spectator ────────────────────────────────────────────────

    socket.on('board:spectate', (roomCode, callback) => {
      const code = roomCode.toUpperCase();
      log('board:spectate', socket.id, { roomCode: code });
      try {
        const room = rooms.spectateRoom(code, socket.id);
        socket.data.roomCode = code;
        socket.data.isSpectator = true;
        socket.join(code);
        log('board:spectate', socket.id, { success: true });
        callback(null);
        // Send current state to the spectator
        socket.emit('game:state', room.getState());
      } catch (err: any) {
        logError('board:spectate', socket.id, err);
        callback(err.message);
      }
    });

    // ─── Election ──────────────────────────────────────────────────────────

    socket.on('election:nominate', (chancellorId, callback) => {
      log('election:nominate', socket.id, { chancellorId });
      try {
        const room = rooms.getRoomForPlayer(socket.id);
        if (!room) throw new Error('Not in a room');
        room.nominateChancellor(socket.id, chancellorId);
        log('election:nominate', socket.id, { success: true, phase: room.getState().phase });
        io.to(room.roomCode).emit('game:phase-change', 'election-vote');
        broadcastState(io, room);
        callback(null);
      } catch (err: any) {
        logError('election:nominate', socket.id, err);
        callback(err.message);
      }
    });

    socket.on('election:vote', async (vote, callback) => {
      log('election:vote', socket.id, { vote });
      try {
        const room = rooms.getRoomForPlayer(socket.id);
        if (!room) throw new Error('Not in a room');
        const { allVoted } = room.castVote(socket.id, vote);
        log('election:vote', socket.id, { allVoted });
        broadcastState(io, room);

        if (allVoted) {
          await resolveVoteAndAdvance(io, room);
        }

        callback(null);
      } catch (err: any) {
        logError('election:vote', socket.id, err);
        callback(err.message);
      }
    });

    // ─── Legislative ───────────────────────────────────────────────────────

    socket.on('legislative:president-discard', (policyIndex, callback) => {
      log('legislative:president-discard', socket.id, { policyIndex });
      try {
        const room = rooms.getRoomForPlayer(socket.id);
        if (!room) throw new Error('Not in a room');
        const chancellorPolicies = room.presidentDiscard(socket.id, policyIndex);
        log('legislative:president-discard', socket.id, { chancellorPolicies, success: true });

        // Send chancellor their 2 cards privately (skip if AI — AI service reads state directly)
        const chancellorId = room.getState().nominatedChancellorId!;
        if (!room.isAIPlayer(chancellorId)) {
          io.to(chancellorId).emit('game:private-state', {
            ...room.getPrivateState(chancellorId),
            policyChoices: chancellorPolicies,
          });
        }

        io.to(room.roomCode).emit('game:phase-change', 'legislative-chancellor');
        broadcastState(io, room);
        callback(null);
      } catch (err: any) {
        logError('legislative:president-discard', socket.id, err);
        callback(err.message);
      }
    });

    socket.on('legislative:chancellor-enact', (policyIndex, callback) => {
      log('legislative:chancellor-enact', socket.id, { policyIndex });
      try {
        const room = rooms.getRoomForPlayer(socket.id);
        if (!room) throw new Error('Not in a room');
        const { enacted, power } = room.chancellorEnact(socket.id, policyIndex);
        log('legislative:chancellor-enact', socket.id, { enacted, power, success: true });

        io.to(room.roomCode).emit('game:policy-enacted', enacted, room.getState().policyTrack);

        const state = room.getState();
        if (state.result) {
          log('game:over', 'server', { result: state.result });
          io.to(room.roomCode).emit('game:over', state.result, room.getAllRoles());
        } else if (power) {
          log('executive-power', 'server', { power });
          io.to(room.roomCode).emit('game:phase-change', 'executive-action');
          if (power === 'policy-peek' && !room.isAIPlayer(socket.id)) {
            const peek = room.getPolicyPeek();
            io.to(socket.id).emit('game:private-state', {
              ...room.getPrivateState(socket.id),
              policyPeek: peek,
            });
          }
        }

        broadcastState(io, room);
        emitNarrationForLatestEntry(io, room);
        if (state.result) {
          emitNarrationForGameOver(io, room, state.result);
          recordGameOverInDb(room, state.result);
        }
        callback(null);
      } catch (err: any) {
        logError('legislative:chancellor-enact', socket.id, err);
        callback(err.message);
      }
    });

    socket.on('legislative:veto-request', (callback) => {
      log('legislative:veto-request', socket.id);
      try {
        const room = rooms.getRoomForPlayer(socket.id);
        if (!room) throw new Error('Not in a room');
        room.requestVeto(socket.id);
        log('legislative:veto-request', socket.id, { success: true });
        broadcastState(io, room);
        callback(null);
      } catch (err: any) {
        logError('legislative:veto-request', socket.id, err);
        callback(err.message);
      }
    });

    socket.on('legislative:veto-response', (approve, callback) => {
      log('legislative:veto-response', socket.id, { approve });
      try {
        const room = rooms.getRoomForPlayer(socket.id);
        if (!room) throw new Error('Not in a room');
        const { vetoed } = room.respondToVeto(socket.id, approve);
        log('legislative:veto-response', socket.id, { vetoed });
        if (vetoed) {
          io.to(room.roomCode).emit('game:phase-change', room.getState().phase);
        }
        broadcastState(io, room);
        if (vetoed) {
          emitNarrationForLatestEntry(io, room);
        }
        callback(null);
      } catch (err: any) {
        logError('legislative:veto-response', socket.id, err);
        callback(err.message);
      }
    });

    // ─── Executive Actions ─────────────────────────────────────────────────

    socket.on('executive:investigate', (targetId, callback) => {
      log('executive:investigate', socket.id, { targetId });
      try {
        const room = rooms.getRoomForPlayer(socket.id);
        if (!room) throw new Error('Not in a room');
        const party = room.investigateLoyalty(socket.id, targetId);
        log('executive:investigate', socket.id, { party, success: true });

        // Send result only to the investigating president
        socket.emit('game:investigation-result', targetId, party);

        // Broadcast updated state (still in executive-action phase so president can see result)
        broadcastState(io, room);
        emitNarrationForLatestEntry(io, room);
        callback(null);
      } catch (err: any) {
        logError('executive:investigate', socket.id, err);
        callback(err.message);
      }
    });

    socket.on('executive:investigate-acknowledge', (callback) => {
      log('executive:investigate-acknowledge', socket.id);
      try {
        const room = rooms.getRoomForPlayer(socket.id);
        if (!room) throw new Error('Not in a room');
        room.acknowledgeInvestigation(socket.id);
        const state = room.getState();
        log('executive:investigate-acknowledge', socket.id, { phase: state.phase });
        io.to(room.roomCode).emit('game:phase-change', state.phase);
        broadcastState(io, room);
        callback(null);
      } catch (err: any) {
        logError('executive:investigate-acknowledge', socket.id, err);
        callback(err.message);
      }
    });

    socket.on('executive:special-election', (targetId, callback) => {
      log('executive:special-election', socket.id, { targetId });
      try {
        const room = rooms.getRoomForPlayer(socket.id);
        if (!room) throw new Error('Not in a room');
        room.callSpecialElection(socket.id, targetId);
        log('executive:special-election', socket.id, { success: true });
        io.to(room.roomCode).emit('game:phase-change', 'election-nominate');
        broadcastState(io, room);
        emitNarrationForLatestEntry(io, room);
        callback(null);
      } catch (err: any) {
        logError('executive:special-election', socket.id, err);
        callback(err.message);
      }
    });

    socket.on('executive:execute', (targetId, callback) => {
      log('executive:execute', socket.id, { targetId });
      try {
        const room = rooms.getRoomForPlayer(socket.id);
        if (!room) throw new Error('Not in a room');
        const target = room.getState().players.find(p => p.id === targetId);
        const { wasHitler } = room.executePlayer(socket.id, targetId);
        log('executive:execute', socket.id, { target: target?.name, wasHitler });

        io.to(room.roomCode).emit('game:execution', targetId, target?.name ?? '?', wasHitler);

        const state = room.getState();
        if (state.result) {
          log('game:over', 'server', { result: state.result });
          io.to(room.roomCode).emit('game:over', state.result, room.getAllRoles());
        } else {
          io.to(room.roomCode).emit('game:phase-change', state.phase);
        }
        broadcastState(io, room);
        emitNarrationForLatestEntry(io, room);
        if (state.result) {
          emitNarrationForGameOver(io, room, state.result);
          recordGameOverInDb(room, state.result);
        }
        callback(null);
      } catch (err: any) {
        logError('executive:execute', socket.id, err);
        callback(err.message);
      }
    });

    socket.on('executive:peek-acknowledge', (callback) => {
      log('executive:peek-acknowledge', socket.id);
      try {
        const room = rooms.getRoomForPlayer(socket.id);
        if (!room) throw new Error('Not in a room');
        room.acknowledgePolicyPeek(socket.id);
        const state = room.getState();
        log('executive:peek-acknowledge', socket.id, { phase: state.phase });
        io.to(room.roomCode).emit('game:phase-change', state.phase);
        broadcastState(io, room);
        callback(null);
      } catch (err: any) {
        logError('executive:peek-acknowledge', socket.id, err);
        callback(err.message);
      }
    });

    // ─── Chat ──────────────────────────────────────────────────────────────

    socket.on('chat:send', (text, callback) => {
      try {
        const trimmed = text.trim().slice(0, 200);
        if (!trimmed) return callback('Empty message');
        const room = rooms.getRoomForPlayer(socket.id);
        if (!room || room.getState().phase === 'lobby') return callback('Not in game');
        const message = room.addChatMessage(socket.id, trimmed);
        io.to(room.roomCode).emit('game:chat', message);
        io.to(room.roomCode).emit('game:state', room.getState());
        const aiService = aiServices.get(room.roomCode);
        aiService?.checkForMentionsAndReply(socket.id, socket.data.playerName ?? 'Unknown', trimmed);
        callback(null);
      } catch (err: any) {
        logError('chat:send', socket.id, err);
        callback(err.message);
      }
    });

    // ─── Disconnect ────────────────────────────────────────────────────────

    socket.on('disconnect', (reason) => {
      log('disconnect', socket.id, { reason, playerName: socket.data.playerName, roomCode: socket.data.roomCode, isSpectator: socket.data.isSpectator });

      if (socket.data.isSpectator) {
        const room = rooms.removeSpectator(socket.id);
        if (room) broadcastState(io, room);
        return;
      }

      const room = rooms.leaveRoom(socket.id);
      if (room) {
        broadcastState(io, room);
        const playerName = socket.data.playerName ?? 'A player';
        const timerKey = `${room.roomCode}:${playerName}`;
        disconnectTimers.set(timerKey, setTimeout(() => {
          disconnectTimers.delete(timerKey);
          io.to(room.roomCode).emit('game:player-left', playerName);
        }, 10_000));
      }
    });
  });
}
