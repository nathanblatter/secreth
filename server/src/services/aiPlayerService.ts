import Anthropic from '@anthropic-ai/sdk';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from '../../../shared/src/types/events';
import type { PolicyType } from '../../../shared/src/types/game';
import { shuffle } from '../../../shared/src/utils/helpers';
import type { GameRoom, AIActionEvent } from '../game/GameRoom';
import type { AIPersonality } from './masterAiService';
import { callTTSWithVoice } from '../ttsService';

type AppServer = Server<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;

/** Extract a JSON object from Claude's response, tolerating prose before/after or markdown fences. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractJSON(text: string): any {
  const stripped = text.replace(/```(?:json)?\n?/g, '').replace(/\n?```/g, '');
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) throw new Error('No JSON object in response');
  return JSON.parse(stripped.slice(start, end + 1));
}

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
      case 'discussion': {
        this.scheduleDiscussionChat(event.presidentId);
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
    if (state.awaitingDiscussion) return; // wait for discussion to end
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
          content: `You are President this round. Choose a Chancellor to nominate.

Eligible players: ${eligibleNames}

Consider: Who do you trust based on their voting history and past governments? Who has passed fascist policies before? Who would your team benefit from electing?

Respond with JSON only: {"chancellorId": "<id>", "reasoning": "<1-2 sentence strategic reason>"}`,
        }],
      });

      const content = response.content[0];
      if (content.type === 'text') {
        const parsed = extractJSON(content.text);
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
          content: `Vote on this proposed government: President ${presName} + Chancellor ${chanName}.

Think about: Have either of them been in governments that enacted fascist policies? How did they vote in past elections? Is electing them now dangerous given the current fascist policy count (${this.room.getState().policyTrack.fascist}/6)?

Ja = vote to elect them. Nein = reject.

Respond with JSON only: {"vote": true, "reasoning": "<1 sentence>"}`,
        }],
      });

      const content = response.content[0];
      if (content.type === 'text') {
        const parsed = extractJSON(content.text);
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
          content: `You are President. You drew 3 policy cards and must secretly DISCARD one, then pass 2 to the Chancellor.

Your cards: [${choiceStr}]

Choose which index to discard. Remember: the Chancellor will see the 2 remaining cards and choose one to enact. You cannot tell the Chancellor what you discarded.

Respond with JSON only: {"discardIndex": 0, "reasoning": "<1 sentence>"}`,
        }],
      });

      const content = response.content[0];
      if (content.type === 'text') {
        const parsed = extractJSON(content.text);
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
          content: `You are Chancellor. The President passed you 2 cards. You must ENACT one and the other is discarded.

Your cards: [${choiceStr}]

The enacted policy is public. Consider: what benefits your party? What can you justify claiming to others?

Respond with JSON only: {"enactIndex": 0, "reasoning": "<1 sentence>"}`,
        }],
      });

      const content = response.content[0];
      if (content.type === 'text') {
        const parsed = extractJSON(content.text);
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
          content: `The Chancellor has requested a VETO — they want to discard all policies and advance the election tracker instead.

Current election tracker: ${state.electionTracker}/3${state.electionTracker === 2 ? ' ⚠ Approving veto will trigger a CHAOS POLICY from the deck!' : ''}.
Policies so far: ${state.policyTrack.liberal} Liberal / ${state.policyTrack.fascist} Fascist.

Consider:
- If LIBERAL and you trust the Chancellor: approve if you believe their cards were truly bad. But at tracker 2, a chaos policy is dangerous.
- If FASCIST: approve if it helps your team (avoids liberal enactment). Reject if you want to force a fascist policy through.
- A rejected veto forces the Chancellor to enact one of their cards.

Respond with JSON only: {"approve": true, "reasoning": "<1 sentence>"}`,
        }],
      });

      const content = response.content[0];
      if (content.type === 'text') {
        const parsed = extractJSON(content.text);
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
            messages: [{ role: 'user', content: `EXECUTIVE POWER: Investigate a player's party loyalty (you learn if they're Liberal or Fascist).

Options: ${names}

Who is most suspicious based on their voting history and past policy enactments? Who would it be most valuable to confirm?

Respond with JSON only: {"targetId": "<id>", "reasoning": "<1 sentence>"}` }],
          });
          const c = response.content[0];
          if (c.type === 'text') {
            const p = extractJSON(c.text);
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
            messages: [{ role: 'user', content: `EXECUTIVE POWER: Special Election — you choose who becomes the next President, skipping the normal rotation.

Options: ${names}

This is a powerful disruption tool. Consider:
- If you are FASCIST: choose a fellow fascist or someone you can trust to nominate a fascist chancellor. Avoid picking suspicious players who might expose your team.
- If you are LIBERAL: choose the most trusted liberal player who you believe can nominate a good chancellor. Avoid players who have been in governments that enacted fascist policies.
- Think about who is next in the normal rotation — is skipping them good or bad for your side?

Respond with JSON only: {"targetId": "<id>", "reasoning": "<1 sentence strategic reason>"}` }],
          });
          const c = response.content[0];
          if (c.type === 'text') {
            const p = extractJSON(c.text);
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
            messages: [{ role: 'user', content: `EXECUTIVE POWER: Execution — you permanently kill one player. This is a critical decision.

Options: ${names}

Current fascist policies: ${state.policyTrack.fascist}/6. Liberals win immediately if Hitler is executed.

Consider:
- If you are LIBERAL: who is most likely Hitler or a key fascist? Target the most dangerous fascist — someone who has enacted fascist policies, consistently voted to elect suspicious governments, or been investigated as fascist. If you are almost certain someone is Hitler (${state.policyTrack.fascist >= 3 ? 'game is late — Hitler could win as Chancellor!' : 'identify the most suspicious player'}), execute them.
- If you are FASCIST: eliminate a key liberal who is building evidence, investigating your team, or likely to figure out who Hitler is. Do NOT execute fellow fascists. Avoid executing players who would be too obviously liberal (don't make yourself look suspicious).
- Look at voting history: fascists vote Ja together. Look at who enacted fascist policies.

Respond with JSON only: {"targetId": "<id>", "reasoning": "<1 sentence strategic reason>"}` }],
          });
          const c = response.content[0];
          if (c.type === 'text') {
            const p = extractJSON(c.text);
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
      case 'election-result': {
        const passed = trigger.passed;
        const otherNames = state.players.filter(p => p.status === 'alive' && p.id !== aiId).map(p => `@${p.name}`).join(', ');
        prompt = `The election just ${passed ? 'PASSED' : 'FAILED'}. Government: ${trigger.presidentName} (President) + ${trigger.chancellorName} (Chancellor).
React in character. You SHOULD @mention one of the involved players or someone suspicious by name (other alive players: ${otherNames}). E.g. "@${trigger.presidentName} I don't trust this..." or "@${trigger.chancellorName} explain yourself." 1-2 sentences. Plain text only.`;
        break;
      }
      case 'policy-enacted': {
        const track = state.policyTrack;
        const otherNames = state.players.filter(p => p.status === 'alive' && p.id !== aiId).map(p => `@${p.name}`).join(', ');
        prompt = `A ${trigger.policyType.toUpperCase()} policy was just enacted. Policy track: ${track.liberal} liberal / ${track.fascist} fascist.
React in character — express your reaction and @mention one specific player to direct your comment at (available: ${otherNames}). ${trigger.policyType === 'fascist' ? 'Question why this happened.' : 'Celebrate or note the progress.'} 1-2 sentences. Plain text only.`;
        break;
      }
      case 'execution': {
        const otherNames = state.players.filter(p => p.status === 'alive' && p.id !== aiId).map(p => `@${p.name}`).join(', ');
        prompt = `${trigger.targetName} has just been executed by the President. React in character — express shock, satisfaction, or suspicion. Consider @mentioning another player to direct your reaction at (available: ${otherNames}). 1-2 sentences. Plain text only.`;
        break;
      }
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
        max_tokens: 100,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: `${humanName} just said: "${text}"

They mentioned your name. Reply directly to what they said, in character. Be specific — address their actual point, accusation, or question. 1-2 sentences. Plain text only.`,
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

  private scheduleDiscussionChat(presidentId: string): void {
    if (this.isGameOver()) return;
    const state = this.room.getState();
    const aliveAIs = [...this.personalitiesMap.keys()].filter(id => {
      const p = state.players.find(pp => pp.id === id);
      return p?.status === 'alive';
    });
    if (aliveAIs.length === 0) return;

    // All alive AIs participate in discussion, staggered
    const shuffled = shuffle([...aliveAIs]);
    const chatters = shuffled.slice(0, Math.min(shuffled.length, 3)); // up to 3 comment
    const allReady = [...aliveAIs]; // all vote ready

    // Phase 1: AIs comment (starting 3s in, staggered 4s apart)
    chatters.forEach((aiId, i) => {
      setTimeout(() => this.doDiscussionChat(aiId), 3000 + i * 4000);
    });

    // Phase 2: AIs vote ready after their comment (or just wait)
    allReady.forEach((aiId, i) => {
      const chatDelay = chatters.includes(aiId) ? chatters.indexOf(aiId) * 4000 : 0;
      const readyDelay = chatDelay + 6000 + Math.random() * 8000; // 6-14s after their comment
      setTimeout(() => this.doVoteReady(aiId), 3000 + readyDelay);
    });
  }

  private async doDiscussionChat(aiId: string): Promise<void> {
    if (this.isGameOver()) return;
    const state = this.room.getState();
    if (!state.awaitingDiscussion) return;

    const personality = this.personalitiesMap.get(aiId);
    if (!personality) return;
    const player = state.players.find(p => p.id === aiId);
    if (!player || player.status === 'dead') return;

    // Build a list of other players to potentially @mention
    const otherPlayers = state.players.filter(p => p.status === 'alive' && p.id !== aiId);
    const otherNames = otherPlayers.map(p => `@${p.name}`).join(', ');
    const lastLog = state.gameLog[state.gameLog.length - 1];
    const lastEvent = lastLog
      ? `The last game event was: ${lastLog.type} (Round ${lastLog.round})`
      : 'The game is just starting.';

    try {
      const systemPrompt = this.buildSystemPrompt(aiId);
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 100,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: `DISCUSSION PHASE — players are talking before the next election.
${lastEvent}
Other players: ${otherNames}

Make a comment in character. You SHOULD @mention at least one other player by name (e.g. "@Ernst why did you vote that way?"). Be direct and strategic — accuse, defend, ask questions, or build alliances. Use @Name format. 1-2 sentences. Plain text only.`,
        }],
      });
      const content = response.content[0];
      if (content.type === 'text') {
        await this.emitChatWithTTS(aiId, content.text.trim(), personality);
      }
    } catch (err) {
      console.warn('[AI] doDiscussionChat error:', err);
    }
  }

  private async doVoteReady(aiId: string): Promise<void> {
    if (this.isGameOver()) return;
    const state = this.room.getState();
    if (!state.awaitingDiscussion) return; // discussion already ended
    const player = state.players.find(p => p.id === aiId);
    if (!player || player.status === 'dead') return;

    try {
      const { canAdvance } = this.room.castReadyVote(aiId);
      this.broadcast();
      if (canAdvance) {
        this.io.to(this.room.roomCode).emit('game:phase-change', 'election-nominate');
      }
    } catch { /* already voted or discussion ended */ }
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

    const playerName = (id: string | null) => id ? (state.players.find(p => p.id === id)?.name ?? '?') : 'none';

    // ── Role & team ──
    let roleSection = `YOUR ROLE: ${privateState.role.toUpperCase()} (${privateState.partyMembership} party).`;
    if (privateState.partyMembership === 'fascist') {
      const fellowNames = privateState.knownFascists.map(id => playerName(id)).join(', ');
      if (fellowNames) roleSection += `\nFellow fascists (only you know this): ${fellowNames}.`;
      if (privateState.knownHitlerId) roleSection += `\nHitler (only you know this): ${playerName(privateState.knownHitlerId)}.`;
    }

    // ── Strategy guide ──
    const strategy = privateState.partyMembership === 'liberal'
      ? `LIBERAL STRATEGY: Your goal is 5 liberal policies OR executing Hitler.
- Vote Nein on governments involving players who have enacted fascist policies before.
- A fascist president/chancellor always chooses the fascist card when given a choice. If someone claims "I had no liberal cards," consider whether that's plausible.
- Watch for voting patterns: fascists often vote Ja on governments involving other fascists.
- Use investigations to gather evidence. Be open about results to build coalition.
- If election tracker reaches 2, consider whether to pass a bad government vs. risk a chaos policy.`
      : `FASCIST STRATEGY: Your goal is 6 fascist policies OR getting Hitler elected Chancellor after 3+ fascist policies.
- Appear liberal. Claim you "had no choice" when enacting fascist policies ("only fascist cards in hand").
- Coordinate subtly with your team (${privateState.knownFascists.map(id => playerName(id)).join(', ')}) — vote to elect each other but don't make it obvious.
- If Hitler is Chancellor-eligible (after 3 fascist policies), nominate them.
- When safe to do so, nominate fascist players as chancellor.
- Keep the election tracker high by occasionally voting Nein on good governments.`;

    // ── Board state ──
    const alivePlayers = state.players.filter(p => p.status === 'alive').map(p => p.name).join(', ');
    const deadPlayers = state.players.filter(p => p.status === 'dead').map(p => p.name);
    const lastGov = state.lastElectedGovernment
      ? `${playerName(state.lastElectedGovernment.presidentId)} (P) + ${playerName(state.lastElectedGovernment.chancellorId)} (C) — term-limited`
      : 'none';
    const round = state.gameLog.filter(e =>
      e.type === 'election-passed' || e.type === 'election-failed' || e.type === 'chaos-policy'
    ).length + 1;

    // ── Game history (full log with vote breakdowns) ──
    const historyLines: string[] = [];
    for (const entry of state.gameLog) {
      const voteStr = entry.playerVotes
        ? ' [' + Object.entries(entry.playerVotes).map(([n, v]) => `${n}:${v ? 'Ja' : 'Nein'}`).join(' ') + ']'
        : '';
      switch (entry.type) {
        case 'election-passed':
          historyLines.push(`R${entry.round} ELECTED: ${entry.presidentName}+${entry.chancellorName} (${entry.votesYes}–${entry.votesNo})${voteStr}`);
          break;
        case 'election-failed':
          historyLines.push(`R${entry.round} REJECTED: ${entry.presidentName}+${entry.chancellorName} (${entry.votesYes}–${entry.votesNo})${voteStr}`);
          break;
        case 'policy-enacted':
          historyLines.push(`R${entry.round} POLICY: ${entry.policy!.toUpperCase()} enacted by ${entry.presidentName}+${entry.chancellorName}`);
          break;
        case 'chaos-policy':
          historyLines.push(`R${entry.round} CHAOS: ${entry.policy!.toUpperCase()} policy auto-enacted from deck (3 failed elections)`);
          break;
        case 'execution':
          historyLines.push(`R${entry.round} EXECUTED: ${entry.targetName} by President ${entry.presidentName}`);
          break;
        case 'investigation':
          historyLines.push(`R${entry.round} INVESTIGATED: ${entry.presidentName} investigated ${entry.targetName}`);
          break;
        case 'special-election':
          historyLines.push(`R${entry.round} SPECIAL ELECTION: ${entry.targetName} chosen by ${entry.presidentName}`);
          break;
        case 'veto-approved':
          historyLines.push(`R${entry.round} VETO: ${entry.presidentName}+${entry.chancellorName} discarded all policies`);
          break;
      }
    }

    // ── Your private investigation results ──
    const invLines = (privateState.investigationHistory ?? []).map(
      i => `You investigated ${i.targetName} (R${i.round}): they are ${i.party.toUpperCase()}`
    );

    // ── Recent chat (last 12 messages for context) ──
    const recentChat = state.chatLog.slice(-12).map(m => `${m.playerName}: ${m.text}`).join('\n');

    return `You are ${personality.name} in a live game of Secret Hitler.
Personality: ${personality.traits}. Speech style: ${personality.chatStyle}.

${roleSection}

${strategy}

CURRENT BOARD (Round ${round}):
- Policies enacted: ${state.policyTrack.liberal} Liberal / ${state.policyTrack.fascist} Fascist (need 5L or 6F to win)
- Alive: ${alivePlayers}${deadPlayers.length > 0 ? `  |  Dead: ${deadPlayers.join(', ')}` : ''}
- President: ${playerName(state.currentPresidentId)}  |  Chancellor: ${playerName(state.nominatedChancellorId) || 'not yet nominated'}
- Election tracker: ${state.electionTracker}/3${state.electionTracker === 2 ? ' ⚠ ONE MORE FAILURE = CHAOS POLICY' : ''}
- Last elected government (term-limited): ${lastGov}

GAME HISTORY:
${historyLines.length > 0 ? historyLines.join('\n') : 'No rounds completed yet.'}
${invLines.length > 0 ? '\nYOUR INVESTIGATION RESULTS (private):\n' + invLines.join('\n') : ''}
${recentChat ? '\nRECENT CHAT:\n' + recentChat : ''}`;
  }
}
