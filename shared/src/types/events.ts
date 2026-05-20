import type {
  GameState,
  PlayerPrivateState,
  PolicyType,
  PartyMembership,
  GameResult,
  RoomSettings,
  ChatMessage,
} from './game';

// ─── Client → Server Events ───────────────────────────────────────────────────

export interface ClientToServerEvents {
  // Lobby
  'lobby:create': (playerName: string, callback: (roomCode: string) => void) => void;
  'lobby:join': (
    roomCode: string,
    playerName: string,
    callback: (error: string | null) => void
  ) => void;
  'lobby:start': (callback: (error: string | null) => void) => void;
  'lobby:restart': (callback: (error: string | null) => void) => void;
  'lobby:dismiss': (callback: (error: string | null) => void) => void;
  'lobby:update-settings': (
    settings: Partial<RoomSettings>,
    callback: (error: string | null) => void
  ) => void;

  // Board spectator
  'board:spectate': (
    roomCode: string,
    callback: (error: string | null) => void
  ) => void;

  // Election
  'election:nominate': (
    chancellorId: string,
    callback: (error: string | null) => void
  ) => void;
  'election:vote': (
    vote: boolean,
    callback: (error: string | null) => void
  ) => void;

  // Legislative session
  'legislative:president-discard': (
    policyIndex: number,
    callback: (error: string | null) => void
  ) => void;
  'legislative:chancellor-enact': (
    policyIndex: number,
    callback: (error: string | null) => void
  ) => void;
  'legislative:veto-request': (callback: (error: string | null) => void) => void;
  'legislative:veto-response': (
    approve: boolean,
    callback: (error: string | null) => void
  ) => void;

  // Executive actions
  'executive:investigate': (
    targetId: string,
    callback: (error: string | null) => void
  ) => void;
  'executive:special-election': (
    targetId: string,
    callback: (error: string | null) => void
  ) => void;
  'executive:execute': (
    targetId: string,
    callback: (error: string | null) => void
  ) => void;
  'executive:investigate-acknowledge': (callback: (error: string | null) => void) => void;
  'executive:peek-acknowledge': (callback: (error: string | null) => void) => void;

  // Discussion gate
  'discussion:ready': (callback: (error: string | null) => void) => void;

  // Chat
  'chat:send': (text: string, callback: (error: string | null) => void) => void;
}

// ─── Server → Client Events ───────────────────────────────────────────────────

export interface ServerToClientEvents {
  // Full game state (public info)
  'game:state': (state: GameState) => void;

  // Private info sent only to one player
  'game:private-state': (state: PlayerPrivateState) => void;

  // Notifications
  'game:player-joined': (playerName: string, playerCount: number) => void;
  'game:player-left': (playerName: string) => void;
  'game:player-reconnected': (playerName: string) => void;

  // Phase announcements (for animations/sound)
  'game:phase-change': (phase: GameState['phase']) => void;
  'game:policy-enacted': (type: PolicyType, track: GameState['policyTrack']) => void;
  'game:vote-reveal': (votes: Record<string, boolean>, result: 'passed' | 'failed') => void;
  'game:chaos-policy': (type: PolicyType) => void;
  'game:execution': (targetId: string, targetName: string, wasHitler: boolean) => void;
  'game:investigation-result': (targetId: string, party: PartyMembership) => void;
  'game:over': (result: GameResult, roles: Record<string, { role: string; name: string }>) => void;
  'room:dismissed': () => void;

  // Voice narration (base64-encoded MP3, board device only)
  'game:narration': (audioBase64: string) => void;

  // Chat
  'game:chat': (message: ChatMessage) => void;

  // Errors
  'error': (message: string) => void;
}

// ─── Inter-server data (for Socket.IO data typing) ────────────────────────────

export interface SocketData {
  playerId: string;
  roomCode: string;
  playerName: string;
  isSpectator?: boolean;
  userId?: number;
  username?: string;
  isAdmin?: boolean;
}
