import { describe, it, expect } from 'vitest';
import { getEligibleChancellors } from './eligibility';
import type { GameState, Player } from '../../../shared/src/types/game';

function makePlayer(id: string, status: 'alive' | 'dead' = 'alive'): Player {
  return { id, name: `Player ${id}`, status, isConnected: true };
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    roomCode: 'TEST',
    phase: 'election-nominate',
    players: [],
    hostId: 'p1',
    policyTrack: { liberal: 0, fascist: 0 },
    drawPileCount: 17,
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
    gameLog: [],
    roomSettings: { qrCodeEnabled: true, centralBoardEnabled: false, ttsNarrationEnabled: false, aiPlayerCount: 0 },
    chatLog: [],
    spectatorCount: 0,
    awaitingDiscussion: false,
    readyVotes: [],
    ...overrides,
  };
}

describe('getEligibleChancellors', () => {
  it('filters out dead players', () => {
    const state = makeGameState({
      players: [makePlayer('p1'), makePlayer('p2'), makePlayer('p3', 'dead')],
      currentPresidentId: 'p1',
    });

    const eligible = getEligibleChancellors(state);
    expect(eligible).toContain('p2');
    expect(eligible).not.toContain('p3');
  });

  it('filters out the current president', () => {
    const state = makeGameState({
      players: [makePlayer('p1'), makePlayer('p2'), makePlayer('p3')],
      currentPresidentId: 'p1',
    });

    const eligible = getEligibleChancellors(state);
    expect(eligible).not.toContain('p1');
    expect(eligible).toContain('p2');
    expect(eligible).toContain('p3');
  });

  it('filters out the last elected chancellor (term limit)', () => {
    const state = makeGameState({
      players: [makePlayer('p1'), makePlayer('p2'), makePlayer('p3'), makePlayer('p4')],
      currentPresidentId: 'p1',
      lastElectedGovernment: { presidentId: 'p3', chancellorId: 'p2' },
    });

    const eligible = getEligibleChancellors(state);
    expect(eligible).not.toContain('p2');
  });

  it('filters out the last elected president when more than 5 alive players', () => {
    const players = [
      makePlayer('p1'),
      makePlayer('p2'),
      makePlayer('p3'),
      makePlayer('p4'),
      makePlayer('p5'),
      makePlayer('p6'),
    ];
    const state = makeGameState({
      players,
      currentPresidentId: 'p1',
      lastElectedGovernment: { presidentId: 'p3', chancellorId: 'p4' },
    });

    const eligible = getEligibleChancellors(state);
    expect(eligible).not.toContain('p3'); // last president term-limited
    expect(eligible).not.toContain('p4'); // last chancellor term-limited
    expect(eligible).not.toContain('p1'); // current president
    expect(eligible).toContain('p2');
    expect(eligible).toContain('p5');
    expect(eligible).toContain('p6');
  });

  it('does NOT filter last elected president when 5 or fewer alive players', () => {
    const players = [
      makePlayer('p1'),
      makePlayer('p2'),
      makePlayer('p3'),
      makePlayer('p4'),
      makePlayer('p5'),
    ];
    const state = makeGameState({
      players,
      currentPresidentId: 'p1',
      lastElectedGovernment: { presidentId: 'p3', chancellorId: 'p4' },
    });

    const eligible = getEligibleChancellors(state);
    expect(eligible).toContain('p3'); // last president NOT term-limited with <= 5 alive
    expect(eligible).not.toContain('p4'); // last chancellor still term-limited
  });

  it('does NOT filter last president when some players are dead bringing count to 5', () => {
    const players = [
      makePlayer('p1'),
      makePlayer('p2'),
      makePlayer('p3'),
      makePlayer('p4'),
      makePlayer('p5'),
      makePlayer('p6', 'dead'), // dead, so only 5 alive
    ];
    const state = makeGameState({
      players,
      currentPresidentId: 'p1',
      lastElectedGovernment: { presidentId: 'p3', chancellorId: 'p4' },
    });

    const eligible = getEligibleChancellors(state);
    expect(eligible).toContain('p3'); // last president NOT term-limited
    expect(eligible).not.toContain('p4'); // last chancellor still term-limited
  });

  it('returns empty array when no eligible players exist', () => {
    const state = makeGameState({
      players: [makePlayer('p1'), makePlayer('p2', 'dead')],
      currentPresidentId: 'p1',
    });

    const eligible = getEligibleChancellors(state);
    expect(eligible).toEqual([]);
  });

  it('handles no lastElectedGovernment (first round)', () => {
    const state = makeGameState({
      players: [makePlayer('p1'), makePlayer('p2'), makePlayer('p3')],
      currentPresidentId: 'p1',
      lastElectedGovernment: null,
    });

    const eligible = getEligibleChancellors(state);
    expect(eligible).toEqual(['p2', 'p3']);
  });

  it('handles no currentPresidentId', () => {
    const state = makeGameState({
      players: [makePlayer('p1'), makePlayer('p2'), makePlayer('p3')],
      currentPresidentId: null,
    });

    const eligible = getEligibleChancellors(state);
    expect(eligible).toEqual(['p1', 'p2', 'p3']);
  });
});
