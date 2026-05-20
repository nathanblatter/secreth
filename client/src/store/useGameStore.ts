import { create } from 'zustand';
import type { GameState, PlayerPrivateState, GameResult, PartyMembership, ChatMessage } from '../../../shared/src/types/game';
import type { Notification, Screen } from '../types/client';

interface VoteReveal {
  votes: Record<string, boolean>;
  result: 'passed' | 'failed';
}

interface InvestigationResult {
  targetId: string;
  party: PartyMembership;
}

interface GameOverData {
  result: GameResult;
  roles: Record<string, { role: string; name: string }>;
}

export interface AuthUser {
  id: number;
  username: string;
  isAdmin: boolean;
}

interface GameStore {
  // State
  gameState: GameState | null;
  privateState: PlayerPrivateState | null;
  myPlayerId: string | null;
  screen: Screen;
  notifications: Notification[];
  voteReveal: VoteReveal | null;
  investigationResult: InvestigationResult | null;
  gameOverData: GameOverData | null;
  playerName: string;
  pendingJoinCode: string | null;
  isBoardMode: boolean;
  authUser: AuthUser | null;
  authToken: string | null;
  isReconnecting: boolean;
  chatLog: ChatMessage[];
  chatOpen: boolean;
  unreadChatCount: number;

  // Actions
  setGameState: (state: GameState) => void;
  setPrivateState: (state: PlayerPrivateState) => void;
  setMyPlayerId: (id: string) => void;
  setScreen: (screen: Screen) => void;
  setVoteReveal: (reveal: VoteReveal | null) => void;
  setInvestigationResult: (result: InvestigationResult | null) => void;
  setGameOverData: (data: GameOverData | null) => void;
  setPlayerName: (name: string) => void;
  setPendingJoinCode: (code: string | null) => void;
  setIsBoardMode: (isBoardMode: boolean) => void;
  setAuthUser: (user: AuthUser | null) => void;
  setAuthToken: (token: string | null) => void;
  setIsReconnecting: (v: boolean) => void;
  logout: () => void;
  addNotification: (message: string, type: Notification['type']) => void;
  clearNotification: (id: string) => void;
  appendChatMessage: (message: ChatMessage) => void;
  setChatOpen: (open: boolean) => void;
  clearUnreadChat: () => void;
  reset: () => void;

  // Derived getters
  amPresident: () => boolean;
  amChancellor: () => boolean;
  amHost: () => boolean;
  myPlayer: () => GameState['players'][number] | undefined;
  alivePlayers: () => GameState['players'];
}

const initialState = {
  gameState: null as GameState | null,
  privateState: null as PlayerPrivateState | null,
  myPlayerId: null as string | null,
  screen: 'home' as Screen,
  notifications: [] as Notification[],
  voteReveal: null as VoteReveal | null,
  investigationResult: null as InvestigationResult | null,
  gameOverData: null as GameOverData | null,
  playerName: '',
  pendingJoinCode: null as string | null,
  isBoardMode: false,
  authUser: null as AuthUser | null,
  authToken: null as string | null,
  isReconnecting: false,
  chatLog: [] as ChatMessage[],
  chatOpen: false,
  unreadChatCount: 0,
};

let notifCounter = 0;

export const useGameStore = create<GameStore>((set, get) => ({
  ...initialState,

  // Actions
  setGameState: (gameState) => set((state) => ({
    gameState,
    chatLog: gameState.chatLog ?? state.chatLog,
  })),
  setPrivateState: (privateState) => set({ privateState }),
  setMyPlayerId: (myPlayerId) => set({ myPlayerId }),
  setScreen: (screen) => set({ screen }),
  setVoteReveal: (voteReveal) => set({ voteReveal }),
  setInvestigationResult: (investigationResult) => set({ investigationResult }),
  setGameOverData: (gameOverData) => set({ gameOverData }),
  setPlayerName: (playerName) => set({ playerName }),
  setPendingJoinCode: (pendingJoinCode) => set({ pendingJoinCode }),
  setIsBoardMode: (isBoardMode) => set({ isBoardMode }),
  setAuthUser: (authUser) => set({ authUser }),
  setAuthToken: (authToken) => set({ authToken }),
  setIsReconnecting: (isReconnecting) => set({ isReconnecting }),
  logout: () => {
    localStorage.removeItem('authToken');
    set({ authUser: null, authToken: null });
  },

  addNotification: (message, type) => {
    const id = `notif-${++notifCounter}-${Date.now()}`;
    const notification: Notification = { id, message, type, timestamp: Date.now() };
    set((state) => ({
      notifications: [...state.notifications, notification],
    }));
    // Auto-remove after 5 seconds
    setTimeout(() => {
      get().clearNotification(id);
    }, 5000);
  },

  clearNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    })),

  appendChatMessage: (message) =>
    set((state) => ({
      chatLog: [...state.chatLog, message],
      unreadChatCount: state.chatOpen ? state.unreadChatCount : state.unreadChatCount + 1,
    })),

  setChatOpen: (chatOpen) => set({ chatOpen }),

  clearUnreadChat: () => set({ unreadChatCount: 0 }),

  reset: () => set(initialState),

  // Derived getters
  amPresident: () => {
    const { gameState, myPlayerId } = get();
    return gameState?.currentPresidentId === myPlayerId;
  },

  amChancellor: () => {
    const { gameState, myPlayerId } = get();
    return gameState?.nominatedChancellorId === myPlayerId;
  },

  amHost: () => {
    const { gameState, myPlayerId } = get();
    return gameState?.hostId === myPlayerId;
  },

  myPlayer: () => {
    const { gameState, myPlayerId } = get();
    if (!gameState || !myPlayerId) return undefined;
    return gameState.players.find((p) => p.id === myPlayerId);
  },

  alivePlayers: () => {
    const { gameState } = get();
    if (!gameState) return [];
    return gameState.players.filter((p) => p.status === 'alive');
  },
}));

export default useGameStore;
