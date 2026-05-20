import Anthropic from '@anthropic-ai/sdk';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from '../../../shared/src/types/events';
import type { PolicyType } from '../../../shared/src/types/game';
import { shuffle } from '../../../shared/src/utils/helpers';
import type { GameRoom, AIActionEvent } from '../game/GameRoom';
import type { AIPersonality } from './masterAiService';
import { callTTSWithVoice } from '../ttsService';

type AppServer = Server<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;

export class AIPlayerService {
  private client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  private personalitiesMap: Map<string, AIPersonality>;

  constructor(
    private room: GameRoom,
    private io: AppServer,
    personalities: AIPersonality[],
    private resolveVote: (room: GameRoom) => Promise<void>
  ) {
    this.personalitiesMap = new Map(personalities.map(p => [p.id, p]));
  }

  handleEvent(event: AIActionEvent): void {
    switch (event.type) {
      case 'nominate': {
        const delay = 3000 + Math.random() * 3000;
        setTimeout(() => this.doNominate(event.presidentId), delay);
        break;
      }
      case 'vote': {
        event.playerIds.forEach((id, i) => {
          const delay = 2000 + Math.random() * 3000 + i * 2000;
          setTimeout(() => this.doVote(id), delay);
        });
        break;
      }
      case 'president-discard': {
        const delay = 4000 + Math.random() * 4000;
        setTimeout(() => this.doPresidentDiscard(event.presidentId), delay);
        break;
      }
      case 'chancellor-enact': {
        const delay = 3000 + Math.random() * 3000;
        setTimeout(() => this.doChancellorEnact(event.chancellorId), delay);
        break;
      }
      case 'veto-response': {
        const delay = 3000 + Math.random() * 4000;
        setTimeout(() => this.doVetoResponse(event.presidentId), delay);
        break;
      }
      case 'executive-action': {
        const delay = 5000 + Math.random() * 5000;
        setTimeout(() => this.doExecutiveAction(event.presidentId, event.power), delay);
        break;
      }
      case 'role-reveal': {
        // Schedule intro chat — staggered after the 8s auto-advance timer
        const aiPlayers = [...this.personalitiesMap.keys()];
        aiPlayers.forEach((id, i) => {
          setTimeout(() => this.doIntroChat(id), 10000 + i * 5000);
        });
        break;
      }
      case 'policy-enacted':
      case 'election-result':
      case 'execution': {
        this.scheduleProactiveChat(event);
        break;
      }
    }
  }

  checkForMentionsAndReply(humanId: string, humanName: string, text: string): void {
    for (const [aiId, personality] of this.personalitiesMap) {
      if (text.toLowerCase().includes(personality.name.toLowerCase())) {
        const delay = 2000 + Math.random() * 2000;
        setTimeout(() => this.doMentionReply(aiId, humanName, text), delay);
      }
    }
  }

  // ─── Decision Handlers ───────────────────────────────────────────────────────

  private async doNominate(presidentId: string): Promise<void> {
    if (this.isGameOver()) return;
    const state = this.room.getState();
    if (state.phase !== 'election-nominate') return;
    if (state.currentPresidentId !== presidentId) return;

    const eligiblePlayers = state.players.filter(p => {
      if (p.status === 'dead') return false;
      if (p.id === presidentId) return false;
      const last = state.lastElectedGovernment;
      if (!last) return true;
      const aliveCount = state.players.filter(p2 => p2.status === 'alive').length;
      if (aliveCount > 5) {
        return p.id !== last.presidentId && p.id !== last.chancellorId;
      }
      return p.id !== last.chancellorId;
    });

    if (eligiblePlayers.length === 0) return;

    try {
      const privateState = this.room.getPrivateState(presidentId);
      const systemPrompt = this.buildSystemPrompt(presidentId);
      const eligibleNames = eligiblePlayers.map(p => `${p.name} (id: ${p.id})`).join(', ');

      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 256,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: `You are the President and must nominate a Chancellor. Eligible players: ${eligibleNames}.
Respond with JSON: {"chancellorId": "<id>", "reasoning": "<brief reasoning>"}`,
        }],
      });

      const content = response.content[0];
      if (content.type === 'text') {
        const parsed = JSON.parse(content.text.replace(/```json\n?|\n?```/g, ''));
        const targetId = parsed.chancellorId;
        if (eligiblePlayers.find(p => p.id === targetId)) {
          this.room.nominateChancellor(presidentId, targetId);
          this.io.to(this.room.roomCode).emit('game:phase-change', 'election-vote');
          this.broadcast();
          return;
        }
      }
    } catch (err) {
      console.warn('[AI] doNominate Claude error:', err);
    }

    // Fallback: pick random eligible player
    const target = eligiblePlayers[Math.floor(Math.random() * eligiblePlayers.length)];
    try {
      this.room.nominateChancellor(presidentId, target.id);
      this.io.to(this.room.roomCode).emit('game:phase-change', 'election-vote');
      this.broadcast();
    } catch (err) {
      console.warn('[AI] doNominate fallback error:', err);
    }
  }

  private async doVote(playerId: string): Promise<void> {
    if (this.isGameOver()) return;
    const state = this.room.getState();
    if (state.phase !== 'election-vote') return;

    let vote = true; // liberal default
    try {
      const privateState = this.room.getPrivateState(playerId);
      const systemPrompt = this.buildSystemPrompt(playerId);
      const presName = state.players.find(p => p.id === state.currentPresidentId)?.name ?? '?';
      const chanName = state.players.find(p => p.id === state.nominatedChancellorId)?.name ?? '?';

      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 128,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: `Vote on the proposed government: President ${presName} + Chancellor ${chanName}.
Respond with JSON: {"vote": true or false, "reasoning": "<brief>"}`,
        }],
      });

      const content = response.content[0];
      if (content.type === 'text') {
        const parsed = JSON.parse(content.text.replace(/```json\n?|\n?```/g, ''));
        vote = !!parsed.vote;
      }
    } catch {
      // Fallback: liberal = ja, fascist = strategic
      const privateState = this.room.getPrivateState(playerId);
      vote = privateState.partyMembership === 'liberal';
    }

    try {
      const { allVoted } = this.room.castVote(playerId, vote);
      this.broadcast();
      if (allVoted) {
        await this.resolveVote(this.room);
      }
    } catch (err) {
      console.warn('[AI] doVote cast error:', err);
    }
  }

  private async doPresidentDiscard(presidentId: string): Promise<void> {
    if (this.isGameOver()) return;
    const state = this.room.getState();
    if (state.phase !== 'legislative-president') return;

    const privateState = this.room.getPrivateState(presidentId);
    const choices = privateState.policyChoices ?? [];
    if (choices.length === 0) return;

    let discardIndex = 0;
    try {
      const systemPrompt = this.buildSystemPrompt(presidentId);
      const choiceStr = choices.map((c, i) => `${i}: ${c}`).join(', ');

      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 128,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: `You are the President. Choose one policy to DISCARD. Your 3 cards: [${choiceStr}].
Respond with JSON: {"discardIndex": 0, 1, or 2, "reasoning": "<brief>"}`,
        }],
      });

      const content = response.content[0];
      if (content.type === 'text') {
        const parsed = JSON.parse(content.text.replace(/```json\n?|\n?```/g, ''));
        const idx = Number(parsed.discardIndex);
        if (idx >= 0 && idx < choices.length) discardIndex = idx;
      }
    } catch {
      // Fallback: liberal prefers to discard fascist; fascist prefers to discard liberal
      const priv = this.room.getPrivateState(presidentId);
      if (priv.partyMembership === 'liberal') {
        discardIndex = choices.findIndex(c => c === 'fascist');
        if (discardIndex === -1) discardIndex = 0;
      } else {
        discardIndex = choices.findIndex(c => c === 'liberal');
        if (discardIndex === -1) discardIndex = 0;
      }
    }

    try {
      const chancellorPolicies = this.room.presidentDiscard(presidentId, discardIndex);
      const chancellorId = this.room.getState().nominatedChancellorId!;
      // Send chancellor their cards if they're human
      if (!this.room.isAIPlayer(chancellorId)) {
        this.io.to(chancellorId).emit('game:private-state', {
          ...this.room.getPrivateState(chancellorId),
          policyChoices: chancellorPolicies,
        });
      }
      this.io.to(this.room.roomCode).emit('game:phase-change', 'legislative-chancellor');
      this.broadcast();
    } catch (err) {
      console.warn('[AI] doPresidentDiscard error:', err);
    }
  }

  private async doChancellorEnact(chancellorId: string): Promise<void> {
    if (this.isGameOver()) return;
    const state = this.room.getState();
    if (state.phase !== 'legislative-chancellor') return;

    const privateState = this.room.getPrivateState(chancellorId);
    const choices = privateState.policyChoices ?? [];
    if (choices.length === 0) return;

    // Check veto conditions
    if (state.policyTrack.fascist >= 5 && Math.random() > 0.3) {
      const allLiberal = choices.every(c => c === 'liberal');
      const allFascist = choices.every(c => c === 'fascist');
      const priv = this.room.getPrivateState(chancellorId);
      const shouldVeto = (allLiberal && priv.partyMembership === 'fascist') ||
        (allFascist && priv.partyMembership === 'liberal' && state.policyTrack.fascist >= 5);

      if (shouldVeto) {
        try {
          this.room.requestVeto(chancellorId);
          this.broadcast();
          return;
        } catch { /* veto not available, continue */ }
      }
    }

    let enactIndex = 0;
    try {
      const systemPrompt = this.buildSystemPrompt(chancellorId);
      const choiceStr = choices.map((c, i) => `${i}: ${c}`).join(', ');

      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 128,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: `You are the Chancellor. Choose one policy to ENACT. Your 2 cards: [${choiceStr}].
Respond with JSON: {"enactIndex": 0 or 1, "reasoning": "<brief>"}`,
        }],
      });

      const content = response.content[0];
      if (content.type === 'text') {
        const parsed = JSON.parse(content.text.replace(/```json\n?|\n?```/g, ''));
        const idx = Number(parsed.enactIndex);
        if (idx >= 0 && idx < choices.length) enactIndex = idx;
      }
    } catch {
      const priv = this.room.getPrivateState(chancellorId);
      if (priv.partyMembership === 'liberal') {
        enactIndex = choices.findIndex(c => c === 'liberal');
        if (enactIndex === -1) enactIndex = 0;
      } else {
        enactIndex = choices.findIndex(c => c === 'fascist');
        if (enactIndex === -1) enactIndex = 0;
      }
    }

    try {
      const { enacted, power } = this.room.chancellorEnact(chancellorId, enactIndex);
      this.io.to(this.room.roomCode).emit('game:policy-enacted', enacted, this.room.getState().policyTrack);

      const afterState = this.room.getState();
      if (afterState.result) {
        this.io.to(this.room.roomCode).emit('game:over', afterState.result, this.room.getAllRoles());
      } else if (power === 'policy-peek' && afterState.currentPresidentId && this.room.isAIPlayer(afterState.currentPresidentId)) {
        // AI president handles policy-peek automatically
      }

      this.broadcast();
    } catch (err) {
      console.warn('[AI] doChancellorEnact error:', err);
    }
  }

  private async doVetoResponse(presidentId: string): Promise<void> {
    if (this.isGameOver()) return;
    const state = this.room.getState();
    if (!state.vetoRequested) return;

    let approve = false;
    try {
      const systemPrompt = this.buildSystemPrompt(presidentId);
      const priv = this.room.getPrivateState(presidentId);

      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 128,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: `The Chancellor has requested a veto. Do you approve? Consider your role and strategy.
Respond with JSON: {"approve": true or false, "reasoning": "<brief>"}`,
        }],
      });

      const content = response.content[0];
      if (content.type === 'text') {
        const parsed = JSON.parse(content.text.replace(/```json\n?|\n?```/g, ''));
        approve = !!parsed.approve;
      }
    } catch {
      // Fallback: approve veto if liberal
      approve = this.room.getPrivateState(presidentId).partyMembership === 'liberal';
    }

    try {
      const { vetoed } = this.room.respondToVeto(presidentId, approve);
      if (vetoed) {
        const newState = this.room.getState();
        this.io.to(this.room.roomCode).emit('game:phase-change', newState.phase);
      }
      this.broadcast();

      // If veto rejected and chancellor is AI, re-trigger
      if (!vetoed) {
        const afterState = this.room.getState();
        const chanId = afterState.nominatedChancellorId;
        if (chanId && this.room.isAIPlayer(chanId)) {
          setTimeout(() => this.doChancellorEnact(chanId), 3000 + Math.random() * 3000);
        }
      }
    } catch (err) {
      console.warn('[AI] doVetoResponse error:', err);
    }
  }

  private async doExecutiveAction(presidentId: string, power: string): Promise<void> {
    if (this.isGameOver()) return;
    const state = this.room.getState();
    if (state.phase !== 'executive-action') return;

    const alivePlayers = state.players.filter(p => p.status === 'alive' && p.id !== presidentId);

    switch (power) {
      case 'policy-peek': {
        // AI just peeks and acknowledges after a delay
        const peekState = this.room.getPrivateState(presidentId);
        await this.doProactiveChat(presidentId, {
          type: 'policy-enacted',
          policyType: 'fascist',
        });
        await new Promise(r => setTimeout(r, 3000 + Math.random() * 2000));
        if (this.isGameOver()) return;
        try {
          this.room.acknowledgePolicyPeek(presidentId);
          const newState = this.room.getState();
          this.io.to(this.room.roomCode).emit('game:phase-change', newState.phase);
          this.broadcast();
        } catch (err) {
          console.warn('[AI] policy-peek acknowledge error:', err);
        }
        break;
      }

      case 'investigate-loyalty': {
        const eligible = alivePlayers.filter(p => {
          const priv = this.room.getPrivateState(presidentId);
          // Can't investigate players already investigated
          return true; // GameRoom tracks this
        });
        if (eligible.length === 0) return;

        let targetId = eligible[Math.floor(Math.random() * eligible.length)].id;
        try {
          const systemPrompt = this.buildSystemPrompt(presidentId);
          const names = eligible.map(p => `${p.name} (id: ${p.id})`).join(', ');
          const response = await this.client.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 128,
            system: systemPrompt,
            messages: [{ role: 'user', content: `Investigate one player's loyalty. Options: ${names}. Respond with JSON: {"targetId": "<id>", "reasoning": "<brief>"}` }],
          });
          const c = response.content[0];
          if (c.type === 'text') {
            const p = JSON.parse(c.text.replace(/```json\n?|\n?```/g, ''));
            if (eligible.find(e => e.id === p.targetId)) targetId = p.targetId;
          }
        } catch { /* use random */ }

        try {
          this.room.investigateLoyalty(presidentId, targetId);
          this.broadcast();
          await new Promise(r => setTimeout(r, 3000 + Math.random() * 2000));
          if (this.isGameOver()) return;
          this.room.acknowledgeInvestigation(presidentId);
          const newState = this.room.getState();
          this.io.to(this.room.roomCode).emit('game:phase-change', newState.phase);
          this.broadcast();
        } catch (err) {
          console.warn('[AI] investigate-loyalty error:', err);
        }
        break;
      }

      case 'special-election': {
        if (alivePlayers.length === 0) return;
        let targetId = alivePlayers[Math.floor(Math.random() * alivePlayers.length)].id;
        try {
          const systemPrompt = this.buildSystemPrompt(presidentId);
          const names = alivePlayers.map(p => `${p.name} (id: ${p.id})`).join(', ');
          const response = await this.client.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 128,
            system: systemPrompt,
            messages: [{ role: 'user', content: `Choose next President for a special election. Options: ${names}. Respond with JSON: {"targetId": "<id>", "reasoning": "<brief>"}` }],
          });
          const c = response.content[0];
          if (c.type === 'text') {
            const p = JSON.parse(c.text.replace(/```json\n?|\n?```/g, ''));
            if (alivePlayers.find(e => e.id === p.targetId)) targetId = p.targetId;
          }
        } catch { /* use random */ }

        try {
          this.room.callSpecialElection(presidentId, targetId);
          const target = state.players.find(p => p.id === targetId);
          this.io.to(this.room.roomCode).emit('game:phase-change', 'election-nominate');
          this.broadcast();
        } catch (err) {
          console.warn('[AI] special-election error:', err);
        }
        break;
      }

      case 'execution': {
        const targets = alivePlayers.filter(p => p.id !== presidentId);
        if (targets.length === 0) return;
        let targetId = targets[Math.floor(Math.random() * targets.length)].id;
        try {
          const systemPrompt = this.buildSystemPrompt(presidentId);
          const names = targets.map(p => `${p.name} (id: ${p.id})`).join(', ');
          const response = await this.client.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 128,
            system: systemPrompt,
            messages: [{ role: 'user', content: `Execute one player. Options: ${names}. Respond with JSON: {"targetId": "<id>", "reasoning": "<brief>"}` }],
          });
          const c = response.content[0];
          if (c.type === 'text') {
            const p = JSON.parse(c.text.replace(/```json\n?|\n?```/g, ''));
            if (targets.find(e => e.id === p.targetId)) targetId = p.targetId;
          }
        } catch { /* use random */ }

        try {
          const target = state.players.find(p => p.id === targetId);
          const { wasHitler } = this.room.executePlayer(presidentId, targetId);
          this.io.to(this.room.roomCode).emit('game:execution', targetId, target?.name ?? '?', wasHitler);
          const afterState = this.room.getState();
          if (afterState.result) {
            this.io.to(this.room.roomCode).emit('game:over', afterState.result, this.room.getAllRoles());
          } else {
            this.io.to(this.room.roomCode).emit('game:phase-change', afterState.phase);
          }
          this.broadcast();
        } catch (err) {
          console.warn('[AI] execution error:', err);
        }
        break;
      }
    }
  }

  // ─── Chat Handlers ───────────────────────────────────────────────────────────

  private async doIntroChat(aiId: string): Promise<void> {
    if (this.isGameOver()) return;
    const state = this.room.getState();
    if (state.phase === 'lobby') return;

    const personality = this.personalitiesMap.get(aiId);
    if (!personality) return;

    try {
      const systemPrompt = this.buildSystemPrompt(aiId);
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 80,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: 'The roles have just been revealed. Write a brief in-character introduction (1-2 sentences). Do not reveal your role. Plain text only.',
        }],
      });
      const content = response.content[0];
      if (content.type === 'text') {
        await this.emitChatWithTTS(aiId, content.text.trim(), personality);
      }
    } catch (err) {
      console.warn('[AI] doIntroChat error:', err);
    }
  }

  private async doProactiveChat(aiId: string, trigger: AIActionEvent): Promise<void> {
    if (this.isGameOver()) return;
    const state = this.room.getState();
    if (state.phase === 'lobby') return;

    const personality = this.personalitiesMap.get(aiId);
    if (!personality) return;

    // Check player is still alive
    const player = state.players.find(p => p.id === aiId);
    if (!player || player.status === 'dead') return;

    let prompt = '';
    switch (trigger.type) {
      case 'election-result':
        prompt = `The election ${trigger.passed ? 'passed' : 'failed'}. President: ${trigger.presidentName}, Chancellor: ${trigger.chancellorName}. Comment briefly in character (1-2 sentences). Plain text only.`;
        break;
      case 'policy-enacted':
        prompt = `A ${trigger.policyType} policy was just enacted. React briefly in character (1-2 sentences). Plain text only.`;
        break;
      case 'execution':
        prompt = `${trigger.targetName} has just been executed. React briefly in character (1-2 sentences). Plain text only.`;
        break;
      default:
        return;
    }

    try {
      const systemPrompt = this.buildSystemPrompt(aiId);
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 80,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }],
      });
      const content = response.content[0];
      if (content.type === 'text') {
        await this.emitChatWithTTS(aiId, content.text.trim(), personality);
      }
    } catch (err) {
      console.warn('[AI] doProactiveChat error:', err);
    }
  }

  private async doMentionReply(aiId: string, humanName: string, text: string): Promise<void> {
    if (this.isGameOver()) return;
    const state = this.room.getState();
    if (state.phase === 'lobby') return;

    const personality = this.personalitiesMap.get(aiId);
    if (!personality) return;

    const player = state.players.find(p => p.id === aiId);
    if (!player || player.status === 'dead') return;

    try {
      const systemPrompt = this.buildSystemPrompt(aiId);
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 80,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: `${humanName} said: "${text}". They mentioned your name. Reply briefly in character (1-2 sentences). Plain text only.`,
        }],
      });
      const content = response.content[0];
      if (content.type === 'text') {
        await this.emitChatWithTTS(aiId, content.text.trim(), personality);
      }
    } catch (err) {
      console.warn('[AI] doMentionReply error:', err);
    }
  }

  // ─── Proactive Chat Scheduling ───────────────────────────────────────────────

  private scheduleProactiveChat(trigger: AIActionEvent): void {
    if (this.isGameOver()) return;
    const state = this.room.getState();

    const aliveAIs = [...this.personalitiesMap.keys()].filter(id => {
      const p = state.players.find(pp => pp.id === id);
      return p?.status === 'alive';
    });

    if (aliveAIs.length === 0) return;

    const count = Math.min(aliveAIs.length, Math.random() < 0.5 ? 1 : 2);
    const chosen = shuffle([...aliveAIs]).slice(0, count);

    chosen.forEach((aiId, i) => {
      const delay = 4000 + i * (3000 + Math.random() * 2000);
      setTimeout(() => this.doProactiveChat(aiId, trigger), delay);
    });
  }

  // ─── Broadcast ───────────────────────────────────────────────────────────────

  private broadcast(): void {
    const state = this.room.getState();
    this.io.to(this.room.roomCode).emit('game:state', state);

    for (const playerId of this.room.getPlayerIds()) {
      if (this.room.isAIPlayer(playerId)) continue;
      try {
        const privateState = this.room.getPrivateState(playerId);
        this.io.to(playerId).emit('game:private-state', privateState);
      } catch { /* player may not have role yet */ }
    }
  }

  // ─── TTS + Chat Emission ─────────────────────────────────────────────────────

  private async emitChatWithTTS(aiId: string, text: string, personality: AIPersonality): Promise<void> {
    if (!text) return;
    const message = this.room.addChatMessage(aiId, text);
    this.io.to(this.room.roomCode).emit('game:chat', message);
    this.io.to(this.room.roomCode).emit('game:state', this.room.getState());

    const state = this.room.getState();
    if (state.roomSettings.centralBoardEnabled && state.roomSettings.ttsNarrationEnabled) {
      try {
        const audio = await callTTSWithVoice(text, personality.voice);
        if (audio) this.io.to(this.room.roomCode).emit('game:narration', audio);
      } catch { /* TTS failure is non-fatal */ }
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private isGameOver(): boolean {
    const state = this.room.getState();
    return state.result !== null || state.phase === 'lobby';
  }

  private buildSystemPrompt(aiId: string): string {
    const personality = this.personalitiesMap.get(aiId)!;
    const state = this.room.getState();
    const privateState = this.room.getPrivateState(aiId);

    const presidentName = state.players.find(p => p.id === state.currentPresidentId)?.name ?? 'unknown';
    const chancellorName = state.nominatedChancellorId
      ? (state.players.find(p => p.id === state.nominatedChancellorId)?.name ?? 'none')
      : 'none';
    const alivePlayers = state.players.filter(p => p.status === 'alive').map(p => p.name).join(', ');
    const lastGov = state.lastElectedGovernment
      ? `${state.players.find(p => p.id === state.lastElectedGovernment!.presidentId)?.name ?? '?'} and ${state.players.find(p => p.id === state.lastElectedGovernment!.chancellorId)?.name ?? '?'}`
      : 'none';

    let roleInfo = `Your secret role: ${privateState.role} (${privateState.partyMembership} party).`;
    if (privateState.knownFascists.length > 0) {
      const fascistNames = privateState.knownFascists
        .map(id => state.players.find(p => p.id === id)?.name)
        .filter(Boolean)
        .join(', ');
      roleInfo += ` Fellow fascists: ${fascistNames}.`;
    }
    if (privateState.knownHitlerId) {
      const hitlerName = state.players.find(p => p.id === privateState.knownHitlerId)?.name;
      roleInfo += ` Hitler is ${hitlerName}.`;
    }

    const round = state.gameLog.filter(e => e.type === 'election-passed' || e.type === 'election-failed' || e.type === 'chaos-policy').length + 1;

    return `You are ${personality.name}, a player in a live game of Secret Hitler.
${roleInfo}
Personality: ${personality.traits}. Speech style: ${personality.chatStyle}.
Current game state:
- Round ${round}
- Liberal policies: ${state.policyTrack.liberal}/5, Fascist policies: ${state.policyTrack.fascist}/6
- Alive players: ${alivePlayers}
- Current President: ${presidentName}, Chancellor: ${chancellorName}
- Election tracker: ${state.electionTracker}/3
- Last elected government: ${lastGov}`;
  }
}
