// ─── Roles & Teams ────────────────────────────────────────────────────────────

export type SecretRole = 'liberal' | 'fascist' | 'hitler';
export type PartyMembership = 'liberal' | 'fascist';

export interface RoleInfo {
  secretRole: SecretRole;
  partyMembership: PartyMembership;
}

// ─── Players ──────────────────────────────────────────────────────────────────

export type PlayerStatus = 'alive' | 'dead';

export interface Player {
  id: string;
  name: string;
  status: PlayerStatus;
  isConnected: boolean;
  isAI?: boolean;
}

// What a given player is allowed to see about others
export interface PlayerView extends Player {
  // Only populated for the viewing player themselves, or if game over
  role?: SecretRole;
  partyMembership?: PartyMembership;
}

// ─── Policies ─────────────────────────────────────────────────────────────────

export type PolicyType = 'liberal' | 'fascist';

export interface PolicyTile {
  id: string;
  type: PolicyType;
}

// ─── Game Phases ──────────────────────────────────────────────────────────────

export type GamePhase =
  | 'lobby'
  | 'role-reveal'
  | 'election-nominate'
  | 'election-vote'
  | 'election-result'
  | 'legislative-president'
  | 'legislative-chancellor'
  | 'executive-action'
  | 'game-over';

export type ExecutivePower =
  | 'policy-peek'
  | 'investigate-loyalty'
  | 'special-election'
  | 'execution';

// ─── Government ───────────────────────────────────────────────────────────────

export interface Government {
  presidentId: string;
  chancellorId: string;
}

// ─── Win Condition ────────────────────────────────────────────────────────────

export type WinCondition =
  | 'liberals-policies'
  | 'liberals-hitler-killed'
  | 'fascists-policies'
  | 'fascists-hitler-elected';

export interface GameResult {
  winner: 'liberals' | 'fascists';
  condition: WinCondition;
}

// ─── Chat ────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  text: string;
  timestamp: number;
  isAI: boolean;
}

// ─── Game Log ────────────────────────────────────────────────────────────────

export type GameLogEntryType =
  | 'election-passed'
  | 'election-failed'
  | 'policy-enacted'
  | 'chaos-policy'
  | 'execution'
  | 'investigation'
  | 'special-election'
  | 'veto-approved';

export interface GameLogEntry {
  type: GameLogEntryType;
  round: number;
  presidentName: string;
  chancellorName?: string;
  /** Only the final enacted policy — no secret info */
  policy?: PolicyType;
  /** Name of the targeted player (execution, investigation, special election) */
  targetName?: string;
  /** Vote tally */
  votesYes?: number;
  votesNo?: number;
  /** Per-player votes: playerName → true (ja) / false (nein) */
  playerVotes?: Record<string, boolean>;
}

// ─── Room Settings ───────────────────────────────────────────────────────────

export interface RoomSettings {
  qrCodeEnabled: boolean;
  centralBoardEnabled: boolean;
  ttsNarrationEnabled: boolean;
  aiPlayerCount: number;
}

// ─── Core Game State ──────────────────────────────────────────────────────────

export interface PolicyTrack {
  liberal: number;   // 0–5
  fascist: number;   // 0–6
}

export interface GameState {
  roomCode: string;
  phase: GamePhase;
  players: Player[];
  hostId: string;

  // Policy state
  policyTrack: PolicyTrack;
  drawPileCount: number;
  discardPileCount: number;

  // Election state
  electionTracker: number;          // 0–3; hits 3 = chaos policy
  currentPresidentId: string | null;
  nominatedChancellorId: string | null;
  lastElectedGovernment: Government | null;
  lastNominatedGovernment: Government | null;

  // Votes (keys = playerId, hidden until reveal)
  votes: Record<string, boolean> | null;
  votedCount: number;              // how many have voted (no reveal of who/what)
  voteResult: 'passed' | 'failed' | null;

  // Legislative
  vetoRequested: boolean;
  pendingExecutivePower: ExecutivePower | null;

  // Game over
  result: GameResult | null;

  // Action log (public, no secret info)
  gameLog: GameLogEntry[];

  // Chat log
  chatLog: ChatMessage[];

  // Room settings
  roomSettings: RoomSettings;
  spectatorCount: number;
}

// ─── Player-Specific State (sent only to that player) ─────────────────────────

export interface PlayerPrivateState {
  playerId: string;
  role: SecretRole;
  partyMembership: PartyMembership;
  // Fascists see fellow fascists; Hitler sees fascists in 5-6p games
  knownFascists: string[];   // player IDs
  knownHitlerId: string | null;
  // During legislative phase
  policyChoices?: PolicyType[];  // 3 for president, 2 for chancellor
  // After investigate power used
  investigationResult?: { targetId: string; party: PartyMembership };
  // History of all investigations this player has performed (for private game log)
  investigationHistory?: { targetName: string; party: PartyMembership; round: number }[];
  // After policy peek
  policyPeek?: PolicyType[];
}
