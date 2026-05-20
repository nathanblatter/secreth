import {
  GameState,
  GameLogEntry,
  ChatMessage,
  Player,
  PlayerPrivateState,
  PolicyType,
  PolicyTile,
  Government,
  GamePhase,
  ExecutivePower,
  SecretRole,
  PartyMembership,
  GameResult,
  RoomSettings,
  ROLE_DISTRIBUTION,
  POLICY_COUNTS,
  WIN_CONDITIONS,
  ELECTION_TRACKER_LIMIT,
  getPowerForFascistPolicy,
  getFascistBoardKey,
  shuffle,
  generateId,
} from '../../../shared/src';

export type AIActionEvent =
  | { type: 'nominate'; presidentId: string }
  | { type: 'vote'; playerIds: string[] }
  | { type: 'president-discard'; presidentId: string }
  | { type: 'chancellor-enact'; chancellorId: string }
  | { type: 'veto-response'; presidentId: string }
  | { type: 'executive-action'; presidentId: string; power: ExecutivePower }
  | { type: 'policy-enacted'; policyType: PolicyType }
  | { type: 'election-result'; passed: boolean; presidentName: string; chancellorName: string }
  | { type: 'execution'; targetName: string }
  | { type: 'role-reveal' }
  | { type: 'discussion'; presidentId: string };

interface InternalPlayer extends Player {
  secretRole: SecretRole;
  partyMembership: PartyMembership;
  hasVoted: boolean;
  vote: boolean | null;
  investigatedBy: string[];
  isAI: boolean;
}

export class GameRoom {
  private players: Map<string, InternalPlayer> = new Map();
  private drawPile: PolicyTile[] = [];
  private discardPile: PolicyTile[] = [];
  private state: GameState;
  private presidentQueue: string[] = []; // ordered player IDs
  private currentPresidentIndex = 0;
  private specialElectionReturnIndex: number | null = null;

  // Legislative session temp state
  private presidentHand: PolicyTile[] = [];
  private chancellorHand: PolicyTile[] = [];
  private vetoRequested = false;

  // Role assignments
  private hitlerId: string | null = null;
  private fascistIds: Set<string> = new Set();

  // Round tracking for game log
  private roundNumber = 0;

  // Per-player investigation history (playerId → results)
  private investigationHistory: Map<string, { targetName: string; party: PartyMembership; round: number }[]> = new Map();

  // Room settings and spectators
  private roomSettings: RoomSettings = { qrCodeEnabled: true, centralBoardEnabled: false, ttsNarrationEnabled: false, aiPlayerCount: 0 };
  private spectatorIds: Set<string> = new Set();

  // AI player support
  private chatLog: ChatMessage[] = [];
  private aiPlayerIds: Set<string> = new Set();
  private onAIEvent?: (event: AIActionEvent) => void;

  // Discussion gate
  private readyVoteSet: Set<string> = new Set();

  constructor(public readonly roomCode: string, hostId: string, hostName: string) {
    this.validateName(hostName);
    const host: InternalPlayer = {
      id: hostId,
      name: hostName,
      status: 'alive',
      isConnected: true,
      isAI: false,
      secretRole: 'liberal', // placeholder until game starts
      partyMembership: 'liberal',
      hasVoted: false,
      vote: null,
      investigatedBy: [],
    };
    this.players.set(hostId, host);

    this.state = this.buildInitialState(hostId);
  }

  // ─── Lobby ──────────────────────────────────────────────────────────────────

  addPlayer(playerId: string, playerName: string): void {
    if (this.state.phase !== 'lobby') throw new Error('Game already started');
    if (this.players.size >= 10) throw new Error('Room is full');
    this.validateName(playerName);

    // Check uniqueness (case-insensitive)
    for (const p of this.players.values()) {
      if (p.name.toLowerCase() === playerName.toLowerCase()) {
        throw new Error('Name already taken');
      }
    }

    const player: InternalPlayer = {
      id: playerId,
      name: playerName,
      status: 'alive',
      isConnected: true,
      isAI: false,
      secretRole: 'liberal',
      partyMembership: 'liberal',
      hasVoted: false,
      vote: null,
      investigatedBy: [],
    };
    this.players.set(playerId, player);
    this.state = { ...this.state, players: this.getPublicPlayers() };
  }

  addAIPlayer(id: string, name: string): void {
    if (this.state.phase !== 'lobby') throw new Error('Game already started');
    if (this.players.size >= 10) throw new Error('Room is full');
    this.validateName(name);

    for (const p of this.players.values()) {
      if (p.name.toLowerCase() === name.toLowerCase()) {
        throw new Error('Name already taken');
      }
    }

    const player: InternalPlayer = {
      id,
      name,
      status: 'alive',
      isConnected: true,
      isAI: true,
      secretRole: 'liberal',
      partyMembership: 'liberal',
      hasVoted: false,
      vote: null,
      investigatedBy: [],
    };
    this.players.set(id, player);
    this.aiPlayerIds.add(id);
    this.state = { ...this.state, players: this.getPublicPlayers() };
  }

  isAIPlayer(id: string): boolean {
    return this.aiPlayerIds.has(id);
  }

  setAIEventCallback(cb: (event: AIActionEvent) => void): void {
    this.onAIEvent = cb;
  }

  addChatMessage(playerId: string, text: string): ChatMessage {
    const player = this.players.get(playerId);
    const message: ChatMessage = {
      id: generateId(),
      playerId,
      playerName: player?.name ?? 'Unknown',
      text,
      timestamp: Date.now(),
      isAI: this.aiPlayerIds.has(playerId),
    };
    this.chatLog = [...this.chatLog, message];
    this.state = { ...this.state, chatLog: this.chatLog };
    return message;
  }

  getChatLog(): ChatMessage[] {
    return this.chatLog;
  }

  removePlayer(playerId: string): void {
    if (this.state.phase === 'lobby') {
      this.players.delete(playerId);
      this.state = { ...this.state, players: this.getPublicPlayers() };
    } else {
      const p = this.players.get(playerId);
      if (p) {
        p.isConnected = false;
        this.state = { ...this.state, players: this.getPublicPlayers() };
      }
    }
  }

  reconnectPlayer(playerId: string): void {
    const p = this.players.get(playerId);
    if (p) {
      p.isConnected = true;
      this.state = { ...this.state, players: this.getPublicPlayers() };
    }
  }

  /** Swap an old socket ID for a new one (reconnection with new socket). */
  replacePlayerId(oldId: string, newId: string): void {
    const player = this.players.get(oldId);
    if (!player) throw new Error('Player not found for reconnection');

    player.id = newId;
    player.isConnected = true;
    this.players.delete(oldId);
    this.players.set(newId, player);

    // Update president queue
    const qIdx = this.presidentQueue.indexOf(oldId);
    if (qIdx !== -1) this.presidentQueue[qIdx] = newId;

    // Update state references
    if (this.state.hostId === oldId) this.state = { ...this.state, hostId: newId };
    if (this.state.currentPresidentId === oldId) this.state = { ...this.state, currentPresidentId: newId };
    if (this.state.nominatedChancellorId === oldId) this.state = { ...this.state, nominatedChancellorId: newId };
    if (this.state.lastElectedGovernment) {
      const gov = { ...this.state.lastElectedGovernment };
      if (gov.presidentId === oldId) gov.presidentId = newId;
      if (gov.chancellorId === oldId) gov.chancellorId = newId;
      this.state = { ...this.state, lastElectedGovernment: gov };
    }
    if (this.state.lastNominatedGovernment) {
      const gov = { ...this.state.lastNominatedGovernment };
      if (gov.presidentId === oldId) gov.presidentId = newId;
      if (gov.chancellorId === oldId) gov.chancellorId = newId;
      this.state = { ...this.state, lastNominatedGovernment: gov };
    }

    // Update fascist tracking
    if (this.hitlerId === oldId) this.hitlerId = newId;
    if (this.fascistIds.has(oldId)) {
      this.fascistIds.delete(oldId);
      this.fascistIds.add(newId);
    }

    // Update investigation records and history
    for (const p of this.players.values()) {
      p.investigatedBy = p.investigatedBy.map(id => id === oldId ? newId : id);
    }
    if (this.investigationHistory.has(oldId)) {
      const history = this.investigationHistory.get(oldId)!;
      this.investigationHistory.delete(oldId);
      this.investigationHistory.set(newId, history);
    }

    this.state = { ...this.state, players: this.getPublicPlayers() };
  }

  /** Find a player by name for reconnection (disconnected or stale connection). */
  findDisconnectedPlayer(playerName: string): string | null {
    // Prefer disconnected players first
    for (const [id, p] of this.players) {
      if (p.name === playerName && !p.isConnected) return id;
    }
    // Also match connected players (handles race where disconnect hasn't been processed yet)
    if (this.state.phase !== 'lobby') {
      for (const [id, p] of this.players) {
        if (p.name === playerName) return id;
      }
    }
    return null;
  }

  startGame(requestingPlayerId: string): void {
    if (requestingPlayerId !== this.state.hostId) throw new Error('Only the host can start');
    if (this.players.size < 5) throw new Error('Need at least 5 players');
    if (this.state.phase !== 'lobby') throw new Error('Game already started');

    this.assignRoles();
    this.buildPolicyDeck();
    // Presidential order follows join order, starting from a random player
    this.presidentQueue = [...this.players.keys()];
    this.currentPresidentIndex = Math.floor(Math.random() * this.presidentQueue.length);

    this.state = {
      ...this.state,
      phase: 'role-reveal',
      currentPresidentId: this.presidentQueue[0],
      players: this.getPublicPlayers(),
    };
  }

  acknowledgeRoles(): void {
    // Called after a brief delay or explicit host action; move to first election
    this.beginElection();
  }

  /** Reset the room back to lobby with the same connected players. */
  resetToLobby(requestingPlayerId: string): void {
    if (this.state.phase !== 'game-over') throw new Error('Game is not over');
    if (requestingPlayerId !== this.state.hostId) throw new Error('Only the host can restart');

    // Reset all player state
    for (const p of this.players.values()) {
      p.status = 'alive';
      p.secretRole = 'liberal';
      p.partyMembership = 'liberal';
      p.hasVoted = false;
      p.vote = null;
      p.investigatedBy = [];
    }

    // Remove AI players (they have no socket to reconnect)
    for (const id of this.aiPlayerIds) {
      this.players.delete(id);
    }
    this.aiPlayerIds.clear();
    this.readyVoteSet.clear();
    this.chatLog = [];
    this.onAIEvent = undefined;

    // Remove disconnected players
    for (const [id, p] of this.players) {
      if (!p.isConnected) this.players.delete(id);
    }

    // Reset all internal state
    this.drawPile = [];
    this.discardPile = [];
    this.presidentQueue = [];
    this.currentPresidentIndex = 0;
    this.specialElectionReturnIndex = null;
    this.presidentHand = [];
    this.chancellorHand = [];
    this.vetoRequested = false;
    this.hitlerId = null;
    this.fascistIds.clear();
    this.roundNumber = 0;
    this.investigationHistory.clear();

    // Rebuild state as lobby
    this.state = {
      ...this.buildInitialState(this.state.hostId),
      players: this.getPublicPlayers(),
    };
  }

  // ─── Room Settings & Spectators ─────────────────────────────────────────────

  updateSettings(hostId: string, settings: Partial<RoomSettings>): void {
    if (hostId !== this.state.hostId) throw new Error('Only the host can change settings');
    this.roomSettings = { ...this.roomSettings, ...settings };
    this.state = { ...this.state, roomSettings: this.roomSettings };
  }

  addSpectator(socketId: string): void {
    this.spectatorIds.add(socketId);
    this.state = { ...this.state, spectatorCount: this.spectatorIds.size };
  }

  removeSpectator(socketId: string): void {
    this.spectatorIds.delete(socketId);
    this.state = { ...this.state, spectatorCount: this.spectatorIds.size };
  }

  // ─── Election ───────────────────────────────────────────────────────────────

  nominateChancellor(presidentId: string, chancellorId: string): void {
    this.assertPhase('election-nominate');
    this.assertIsPresident(presidentId);

    if (chancellorId === presidentId) throw new Error('Cannot nominate yourself');
    const chancellor = this.players.get(chancellorId);
    if (!chancellor) throw new Error('Invalid chancellor');
    if (chancellor.status === 'dead') throw new Error('Cannot nominate dead player');
    this.assertEligibleChancellor(chancellorId);

    this.state = {
      ...this.state,
      nominatedChancellorId: chancellorId,
      lastNominatedGovernment: {
        presidentId,
        chancellorId,
      },
      phase: 'election-vote',
      votedCount: 0,
    };
    // Reset votes
    for (const p of this.players.values()) {
      p.hasVoted = false;
      p.vote = null;
    }

    // Notify AI service of alive AI players who need to vote
    const aliveAIVoters = this.alivePlayers()
      .filter(p => this.aiPlayerIds.has(p.id))
      .map(p => p.id);
    if (aliveAIVoters.length > 0) {
      this.onAIEvent?.({ type: 'vote', playerIds: aliveAIVoters });
    }
  }

  castVote(playerId: string, vote: boolean): { allVoted: boolean } {
    this.assertPhase('election-vote');
    const player = this.players.get(playerId);
    if (!player || player.status === 'dead') throw new Error('Invalid voter');
    if (player.hasVoted) throw new Error('Already voted');

    player.hasVoted = true;
    player.vote = vote;

    const alivePlayers = this.alivePlayers();
    const voted = alivePlayers.filter(p => p.hasVoted).length;
    this.state = { ...this.state, votedCount: voted };
    const allVoted = voted === alivePlayers.length;
    return { allVoted };
  }

  resolveVote(): {
    votes: Record<string, boolean>;
    result: 'passed' | 'failed';
    chaosPolicy?: PolicyType;
  } {
    const votes: Record<string, boolean> = {};
    let yesCount = 0;

    for (const p of this.alivePlayers()) {
      votes[p.id] = p.vote ?? false;
      if (p.vote) yesCount++;
    }

    const aliveCount = this.alivePlayers().length;
    const passed = yesCount > aliveCount / 2;

    this.state = {
      ...this.state,
      votes,
      voteResult: passed ? 'passed' : 'failed',
      phase: 'election-result',
    };

    const presName = this.getPlayerName(this.state.currentPresidentId);
    const chanName = this.getPlayerName(this.state.nominatedChancellorId);

    // Notify AI service of election result for proactive chat
    this.onAIEvent?.({ type: 'election-result', passed, presidentName: presName, chancellorName: chanName });

    // Build name-keyed vote map for the log
    const playerVotes: Record<string, boolean> = {};
    for (const p of this.alivePlayers()) {
      playerVotes[p.name] = p.vote ?? false;
    }

    if (passed) {
      // Check if Hitler was just elected chancellor after 3 fascist policies
      const { nominatedChancellorId } = this.state;
      if (
        this.state.policyTrack.fascist >= WIN_CONDITIONS.fascist.hitlerElectedAfter &&
        nominatedChancellorId === this.hitlerId
      ) {
        this.pushLog({
          type: 'election-passed',
          round: this.roundNumber,
          presidentName: presName,
          chancellorName: chanName,
          votesYes: yesCount,
          votesNo: aliveCount - yesCount,
          playerVotes,
        });
        this.endGame({ winner: 'fascists', condition: 'fascists-hitler-elected' });
        return { votes, result: 'passed' };
      }

      this.pushLog({
        type: 'election-passed',
        round: this.roundNumber,
        presidentName: presName,
        chancellorName: chanName,
        votesYes: yesCount,
        votesNo: aliveCount - yesCount,
        playerVotes,
      });

      // Elect government
      this.state = {
        ...this.state,
        lastElectedGovernment: this.state.lastNominatedGovernment,
        electionTracker: 0,
      };
      return { votes, result: 'passed' };
    } else {
      this.pushLog({
        type: 'election-failed',
        round: this.roundNumber,
        presidentName: presName,
        chancellorName: chanName,
        votesYes: yesCount,
        votesNo: aliveCount - yesCount,
        playerVotes,
      });

      // Failed vote
      const newTracker = this.state.electionTracker + 1;
      if (newTracker >= ELECTION_TRACKER_LIMIT) {
        // Chaos policy
        const policy = this.drawPolicy();
        this.enactPolicy(policy.type, true);
        this.pushLog({
          type: 'chaos-policy',
          round: this.roundNumber,
          presidentName: presName,
          policy: policy.type,
        });
        this.state = {
          ...this.state,
          electionTracker: 0,
          lastElectedGovernment: null, // term limits forgotten
        };
        return { votes, result: 'failed', chaosPolicy: policy.type };
      }

      this.state = { ...this.state, electionTracker: newTracker };
      return { votes, result: 'failed' };
    }
  }

  advanceAfterVote(): void {
    if (this.state.result) return; // game over
    if (this.state.phase === 'executive-action') return; // chaos policy granted a power — wait for exec action
    if (this.state.voteResult === 'passed') {
      this.beginLegislativeSession();
    } else {
      this.advancePresident();
      this.beginElection();
    }
  }

  // ─── Legislative ────────────────────────────────────────────────────────────

  getPresidentPolicies(): PolicyType[] {
    this.assertPhase('legislative-president');
    return this.presidentHand.map(p => p.type);
  }

  presidentDiscard(presidentId: string, policyIndex: number): PolicyType[] {
    this.assertPhase('legislative-president');
    this.assertIsPresident(presidentId);
    if (policyIndex < 0 || policyIndex >= this.presidentHand.length) throw new Error('Invalid index');

    const discarded = this.presidentHand.splice(policyIndex, 1)[0];
    this.discardPile.push(discarded);
    this.chancellorHand = [...this.presidentHand];
    this.presidentHand = [];

    this.state = { ...this.state, phase: 'legislative-chancellor' };

    // Notify AI chancellor to enact a policy
    if (this.state.nominatedChancellorId && this.aiPlayerIds.has(this.state.nominatedChancellorId)) {
      this.onAIEvent?.({ type: 'chancellor-enact', chancellorId: this.state.nominatedChancellorId });
    }

    return this.chancellorHand.map(p => p.type);
  }

  chancellorEnact(chancellorId: string, policyIndex: number): { enacted: PolicyType; power: ExecutivePower | null } {
    this.assertPhase('legislative-chancellor');
    this.assertIsChancellor(chancellorId);
    if (policyIndex < 0 || policyIndex >= this.chancellorHand.length) throw new Error('Invalid index');

    const discardIndex = policyIndex === 0 ? 1 : 0;
    this.discardPile.push(this.chancellorHand[discardIndex]);
    const enacted = this.chancellorHand[policyIndex];
    this.chancellorHand = [];

    this.pushLog({
      type: 'policy-enacted',
      round: this.roundNumber,
      presidentName: this.getPlayerName(this.state.currentPresidentId),
      chancellorName: this.getPlayerName(this.state.nominatedChancellorId),
      policy: enacted.type,
    });

    const power = this.enactPolicy(enacted.type, false);
    return { enacted: enacted.type, power };
  }

  requestVeto(chancellorId: string): void {
    if (this.state.policyTrack.fascist < 5) throw new Error('Veto not unlocked yet');
    this.assertPhase('legislative-chancellor');
    this.assertIsChancellor(chancellorId);
    this.vetoRequested = true;
    this.state = { ...this.state, vetoRequested: true };

    // Notify AI president to respond
    if (this.state.currentPresidentId && this.aiPlayerIds.has(this.state.currentPresidentId)) {
      this.onAIEvent?.({ type: 'veto-response', presidentId: this.state.currentPresidentId });
    }
  }

  respondToVeto(presidentId: string, approve: boolean): { vetoed: boolean } {
    this.assertIsPresident(presidentId);
    if (!this.vetoRequested) throw new Error('No veto requested');
    this.vetoRequested = false;
    this.state = { ...this.state, vetoRequested: false };

    if (approve) {
      // Veto: discard both, advance tracker
      this.pushLog({
        type: 'veto-approved',
        round: this.roundNumber,
        presidentName: this.getPlayerName(this.state.currentPresidentId),
        chancellorName: this.getPlayerName(this.state.nominatedChancellorId),
      });
      for (const p of this.chancellorHand) this.discardPile.push(p);
      this.chancellorHand = [];
      const newTracker = this.state.electionTracker + 1;
      this.state = { ...this.state, electionTracker: newTracker };
      if (newTracker >= ELECTION_TRACKER_LIMIT) {
        const policy = this.drawPolicy();
        const chaosPower = this.enactPolicy(policy.type, true);
        this.state = { ...this.state, electionTracker: 0 };
        if (chaosPower) {
          // Executive action phase set by enactPolicy — don't advance here
          return { vetoed: true };
        }
      }
      this.advancePresident();
      this.beginElection();
      return { vetoed: true };
    }

    return { vetoed: false }; // chancellor must enact
  }

  // ─── Executive Actions ───────────────────────────────────────────────────────

  investigateLoyalty(presidentId: string, targetId: string): PartyMembership {
    this.assertIsPresident(presidentId);
    const target = this.players.get(targetId);
    if (!target) throw new Error('Invalid target');
    if (target.investigatedBy.includes(presidentId)) throw new Error('Already investigated this player');
    target.investigatedBy.push(presidentId);

    // Log investigation (do NOT reveal the result — that's secret)
    this.pushLog({
      type: 'investigation',
      round: this.roundNumber,
      presidentName: this.getPlayerName(presidentId),
      targetName: target.name,
    });

    // Record in president's private investigation history
    const history = this.investigationHistory.get(presidentId) ?? [];
    history.push({ targetName: target.name, party: target.partyMembership, round: this.roundNumber });
    this.investigationHistory.set(presidentId, history);

    // Stay in executive-action phase so president can see the result
    // advancePresident + beginElection will happen in acknowledgeInvestigation
    return target.partyMembership;
  }

  acknowledgeInvestigation(presidentId: string): void {
    this.assertIsPresident(presidentId);
    this.clearExecutivePower();
    this.advancePresident();
    this.beginElection();
  }

  callSpecialElection(presidentId: string, targetId: string): void {
    this.assertIsPresident(presidentId);
    if (targetId === presidentId) throw new Error('Cannot choose yourself');
    const target = this.players.get(targetId);
    if (!target || target.status === 'dead') throw new Error('Invalid target');

    this.pushLog({
      type: 'special-election',
      round: this.roundNumber,
      presidentName: this.getPlayerName(presidentId),
      targetName: target.name,
    });

    // After special election, presidency returns to left of current president
    this.specialElectionReturnIndex = (this.currentPresidentIndex + 1) % this.presidentQueue.length;
    const targetIndex = this.presidentQueue.indexOf(targetId);
    this.currentPresidentIndex = targetIndex;

    this.clearExecutivePower();
    this.state = {
      ...this.state,
      currentPresidentId: targetId,
      nominatedChancellorId: null,
      votes: null,
      voteResult: null,
      phase: 'election-nominate',
    };
  }

  executePlayer(presidentId: string, targetId: string): { wasHitler: boolean } {
    this.assertIsPresident(presidentId);
    const target = this.players.get(targetId);
    if (!target || target.status === 'dead') throw new Error('Invalid target');

    this.pushLog({
      type: 'execution',
      round: this.roundNumber,
      presidentName: this.getPlayerName(presidentId),
      targetName: target.name,
    });

    target.status = 'dead';
    const wasHitler = targetId === this.hitlerId;

    this.state = { ...this.state, players: this.getPublicPlayers() };

    // Notify AI service for proactive chat
    this.onAIEvent?.({ type: 'execution', targetName: target.name });

    if (wasHitler) {
      this.endGame({ winner: 'liberals', condition: 'liberals-hitler-killed' });
    } else {
      this.clearExecutivePower();
      this.advancePresident();
      this.beginElection();
    }

    return { wasHitler };
  }

  acknowledgePolicyPeek(presidentId: string): void {
    this.assertIsPresident(presidentId);
    this.clearExecutivePower();
    this.advancePresident();
    this.beginElection();
  }

  // ─── Private State Builders ──────────────────────────────────────────────────

  getPrivateState(playerId: string): PlayerPrivateState {
    const player = this.players.get(playerId);
    if (!player) throw new Error('Player not found');

    const playerCount = this.players.size;
    const boardKey = getFascistBoardKey(playerCount);
    const is5or6 = boardKey === '5-6';

    // In 5-6 player games, Hitler knows fascists. In 7+ Hitler doesn't.
    let knownFascists: string[] = [];
    let knownHitlerId: string | null = null;

    if (player.secretRole === 'fascist') {
      // Fascists know each other and Hitler
      knownFascists = [...this.fascistIds].filter(id => id !== playerId);
      knownHitlerId = this.hitlerId;
    } else if (player.secretRole === 'hitler' && is5or6) {
      // In 5-6p, Hitler knows fascists
      knownFascists = [...this.fascistIds];
    }

    const privateState: PlayerPrivateState = {
      playerId,
      role: player.secretRole,
      partyMembership: player.partyMembership,
      knownFascists,
      knownHitlerId,
    };

    // Include phase-specific policy choices
    if (this.state.phase === 'legislative-president' && playerId === this.state.currentPresidentId) {
      privateState.policyChoices = this.presidentHand.map(p => p.type);
    }
    if (this.state.phase === 'legislative-chancellor' && playerId === this.state.nominatedChancellorId) {
      privateState.policyChoices = this.chancellorHand.map(p => p.type);
    }

    // Include policy peek for the president during executive action
    if (this.state.phase === 'executive-action' && this.state.pendingExecutivePower === 'policy-peek' && playerId === this.state.currentPresidentId) {
      privateState.policyPeek = this.getPolicyPeek();
    }

    // Include investigation history (only for the player who performed them)
    const history = this.investigationHistory.get(playerId);
    if (history && history.length > 0) {
      privateState.investigationHistory = history;
    }

    return privateState;
  }

  getPolicyPeek(): PolicyType[] {
    // Top 3 cards
    return this.drawPile.slice(0, 3).map(p => p.type);
  }

  // ─── Public State ───────────────────────────────────────────────────────────

  getState(): GameState {
    return { ...this.state, chatLog: this.chatLog };
  }

  getPlayerIds(): string[] {
    return [...this.players.keys()];
  }

  hasPlayer(playerId: string): boolean {
    return this.players.has(playerId);
  }

  getHostId(): string {
    return this.state.hostId;
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private buildInitialState(hostId: string): GameState {
    return {
      roomCode: this.roomCode,
      phase: 'lobby',
      players: [],
      hostId,
      policyTrack: { liberal: 0, fascist: 0 },
      drawPileCount: 0,
      discardPileCount: 0,
      electionTracker: 0,
      currentPresidentId: null,
      nominatedChancellorId: null,
      lastElectedGovernment: null,
      lastNominatedGovernment: null,
      votes: null,
      votedCount: 0,
      voteResult: null,
      vetoRequested: false,
      pendingExecutivePower: null,
      result: null,
      awaitingDiscussion: false,
      readyVotes: [],
      gameLog: [],
      chatLog: [],
      roomSettings: this.roomSettings,
      spectatorCount: this.spectatorIds.size,
    };
  }

  private assignRoles(): void {
    const count = this.players.size;
    const dist = ROLE_DISTRIBUTION[count];
    if (!dist) throw new Error('Invalid player count');

    const roles: SecretRole[] = [
      'hitler',
      ...Array(dist.fascists).fill('fascist'),
      ...Array(dist.liberals).fill('liberal'),
    ];
    const shuffled = shuffle(roles);
    const playerIds = [...this.players.keys()];

    playerIds.forEach((id, i) => {
      const player = this.players.get(id)!;
      player.secretRole = shuffled[i];
      player.partyMembership = shuffled[i] === 'liberal' ? 'liberal' : 'fascist';

      if (shuffled[i] === 'hitler') this.hitlerId = id;
      if (shuffled[i] === 'fascist') this.fascistIds.add(id);
    });
  }

  private buildPolicyDeck(): void {
    const tiles: PolicyTile[] = [
      ...Array(POLICY_COUNTS.liberal).fill(null).map((_, i) => ({ id: `L${i}`, type: 'liberal' as PolicyType })),
      ...Array(POLICY_COUNTS.fascist).fill(null).map((_, i) => ({ id: `F${i}`, type: 'fascist' as PolicyType })),
    ];
    this.drawPile = shuffle(tiles);
    this.discardPile = [];
    this.syncPileCounts();
  }

  private drawPolicy(): PolicyTile {
    if (this.drawPile.length === 0) this.reshuffleDeck();
    return this.drawPile.shift()!;
  }

  private reshuffleDeck(): void {
    this.drawPile = shuffle([...this.discardPile]);
    this.discardPile = [];
    this.syncPileCounts();
  }

  private syncPileCounts(): void {
    this.state = {
      ...this.state,
      drawPileCount: this.drawPile.length,
      discardPileCount: this.discardPile.length,
    };
  }

  private enactPolicy(type: PolicyType, isChaos: boolean): ExecutivePower | null {
    const track = { ...this.state.policyTrack };
    if (type === 'liberal') {
      track.liberal++;
    } else {
      track.fascist++;
    }

    let power: ExecutivePower | null = null;
    if (type === 'fascist') {
      const raw = getPowerForFascistPolicy(this.players.size, track.fascist);
      power = raw ?? null;
    }

    this.syncPileCounts();
    this.state = {
      ...this.state,
      policyTrack: track,
      pendingExecutivePower: power,
    };

    // Notify AI service of policy enactment for proactive chat
    this.onAIEvent?.({ type: 'policy-enacted', policyType: type });

    // Check win conditions
    if (track.liberal >= WIN_CONDITIONS.liberal.policies) {
      this.endGame({ winner: 'liberals', condition: 'liberals-policies' });
      return null;
    }
    if (track.fascist >= WIN_CONDITIONS.fascist.policies) {
      this.endGame({ winner: 'fascists', condition: 'fascists-policies' });
      return null;
    }

    if (power) {
      this.state = { ...this.state, phase: 'executive-action' };
      // Notify AI president to perform executive action
      if (this.state.currentPresidentId && this.aiPlayerIds.has(this.state.currentPresidentId)) {
        this.onAIEvent?.({ type: 'executive-action', presidentId: this.state.currentPresidentId, power });
      }
    } else if (!isChaos) {
      // Non-chaos no-power: advance immediately.
      // Chaos no-power: caller (advanceAfterVote / respondToVeto) handles the advance.
      this.advancePresident();
      this.beginElection();
    }

    return power;
  }

  private beginLegislativeSession(): void {
    // Draw 3 for president
    const hand: PolicyTile[] = [];
    for (let i = 0; i < 3; i++) {
      if (this.drawPile.length === 0) this.reshuffleDeck();
      hand.push(this.drawPile.shift()!);
    }
    this.presidentHand = hand;
    this.syncPileCounts();
    this.state = { ...this.state, phase: 'legislative-president' };

    // Notify AI president to discard a policy
    if (this.state.currentPresidentId && this.aiPlayerIds.has(this.state.currentPresidentId)) {
      this.onAIEvent?.({ type: 'president-discard', presidentId: this.state.currentPresidentId });
    }
  }

  private beginElection(): void {
    this.roundNumber++;
    this.readyVoteSet.clear();
    this.state = {
      ...this.state,
      phase: 'election-nominate',
      nominatedChancellorId: null,
      votes: null,
      voteResult: null,
      awaitingDiscussion: true,
      readyVotes: [],
    };

    // Fire discussion event — AI players will chat then vote ready.
    // The 'nominate' event fires once discussion ends (in castReadyVote).
    const presidentId = this.state.currentPresidentId;
    if (presidentId) {
      this.onAIEvent?.({ type: 'discussion', presidentId });
    }
  }

  castReadyVote(playerId: string): { canAdvance: boolean; readyCount: number; threshold: number } {
    const player = this.players.get(playerId);
    if (!player || player.status === 'dead') throw new Error('Invalid player');
    if (!this.state.awaitingDiscussion) throw new Error('Not in discussion');

    this.readyVoteSet.add(playerId);
    const aliveCount = this.alivePlayers().length;
    const threshold = Math.floor(aliveCount / 2) + 1;
    const readyCount = this.readyVoteSet.size;
    const canAdvance = readyCount >= threshold;

    this.state = { ...this.state, readyVotes: [...this.readyVoteSet] };

    if (canAdvance) {
      this.state = { ...this.state, awaitingDiscussion: false };
      // AI president can now nominate
      if (this.state.currentPresidentId && this.aiPlayerIds.has(this.state.currentPresidentId)) {
        this.onAIEvent?.({ type: 'nominate', presidentId: this.state.currentPresidentId });
      }
    }

    return { canAdvance, readyCount, threshold };
  }

  private advancePresident(): void {
    if (this.specialElectionReturnIndex !== null) {
      this.currentPresidentIndex = this.specialElectionReturnIndex;
      this.specialElectionReturnIndex = null;
    } else {
      this.currentPresidentIndex = (this.currentPresidentIndex + 1) % this.presidentQueue.length;
    }
    // Skip dead players
    let attempts = 0;
    while (
      this.players.get(this.presidentQueue[this.currentPresidentIndex])?.status === 'dead' &&
      attempts < this.presidentQueue.length
    ) {
      this.currentPresidentIndex = (this.currentPresidentIndex + 1) % this.presidentQueue.length;
      attempts++;
    }
    this.state = {
      ...this.state,
      currentPresidentId: this.presidentQueue[this.currentPresidentIndex],
    };
  }

  private pushLog(entry: GameLogEntry): void {
    this.state = {
      ...this.state,
      gameLog: [...this.state.gameLog, entry],
    };
  }

  private getPlayerName(id: string | null): string {
    if (!id) return 'Unknown';
    return this.players.get(id)?.name ?? 'Unknown';
  }

  private clearExecutivePower(): void {
    this.state = { ...this.state, pendingExecutivePower: null };
  }

  private endGame(result: GameResult): void {
    this.state = { ...this.state, phase: 'game-over', result };
  }

  private getPublicPlayers(): Player[] {
    return [...this.players.values()].map(({ id, name, status, isConnected, isAI }) => ({
      id, name, status, isConnected, isAI,
    }));
  }

  private alivePlayers(): InternalPlayer[] {
    return [...this.players.values()].filter(p => p.status === 'alive');
  }

  private assertPhase(expected: GamePhase): void {
    if (this.state.phase !== expected) {
      throw new Error(`Expected phase ${expected}, got ${this.state.phase}`);
    }
  }

  private assertIsPresident(playerId: string): void {
    if (this.state.currentPresidentId !== playerId) throw new Error('Not the president');
  }

  private assertIsChancellor(playerId: string): void {
    if (this.state.nominatedChancellorId !== playerId) throw new Error('Not the chancellor');
  }

  private validateName(name: string): void {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Name cannot be empty');
    if (trimmed.length > 12) throw new Error('Name must be 12 characters or less');
  }

  private assertEligibleChancellor(chancellorId: string): void {
    const last = this.state.lastElectedGovernment;
    if (!last) return;
    const aliveCount = this.alivePlayers().length;
    if (aliveCount > 5) {
      if (chancellorId === last.presidentId || chancellorId === last.chancellorId) {
        throw new Error('Player is term-limited');
      }
    } else {
      // 5 or fewer alive: only last chancellor is ineligible
      if (chancellorId === last.chancellorId) throw new Error('Player is term-limited');
    }
  }

  // Expose roles for game-over reveal
  getAllRoles(): Record<string, { role: SecretRole; name: string }> {
    const result: Record<string, { role: SecretRole; name: string }> = {};
    for (const [id, p] of this.players) {
      result[id] = { role: p.secretRole, name: p.name };
    }
    return result;
  }
}
