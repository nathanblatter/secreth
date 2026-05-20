import type { TypedSocket } from './socket';
import type { useGameStore } from '../store/useGameStore';

type StoreApi = typeof useGameStore;

export function registerSocketListeners(socket: TypedSocket, store: StoreApi, enqueueAudio: (audio: string) => void): () => void {
  const get = () => store.getState();

  // Full game state
  socket.on('game:state', (state) => {
    get().setGameState(state);

    // Auto-switch screen based on phase
    if (state.phase === 'lobby') {
      get().setScreen('lobby');
      sessionStorage.removeItem('playerSession');
      // Clear game-over state when returning to lobby (play again)
      if (get().gameOverData) {
        get().setGameOverData(null);
        get().setVoteReveal(null);
        get().setInvestigationResult(null);
      }
    } else {
      get().setScreen('game');
      const playerName = get().playerName;
      if (playerName) {
        sessionStorage.setItem('playerSession', JSON.stringify({
          roomCode: state.roomCode,
          playerName,
        }));
      }
    }

    // Clear reconnecting overlay on successful state receipt
    get().setIsReconnecting(false);
  });

  // Private state
  socket.on('game:private-state', (state) => {
    get().setPrivateState(state);
    // Derive our player ID from private state
    get().setMyPlayerId(state.playerId);
  });

  // Player notifications
  socket.on('game:player-joined', (playerName, playerCount) => {
    get().addNotification(`${playerName} joined the room (${playerCount} players)`, 'info');
  });

  socket.on('game:player-left', (playerName) => {
    get().addNotification(`${playerName} left the room`, 'warning');
  });

  socket.on('game:player-reconnected', (playerName) => {
    get().addNotification(`${playerName} reconnected`, 'success');
  });

  // Phase announcements
  socket.on('game:phase-change', (_phase) => {
    // Phase changes are handled via game:state updates
  });

  socket.on('game:policy-enacted', (type, _track) => {
    const label = type === 'liberal' ? 'Liberal' : 'Fascist';
    get().addNotification(`A ${label} policy has been enacted!`, type === 'liberal' ? 'success' : 'error');
  });

  socket.on('game:vote-reveal', (votes, result) => {
    get().setVoteReveal({ votes, result });
    const msg = result === 'passed' ? 'The vote passed!' : 'The vote failed!';
    get().addNotification(msg, result === 'passed' ? 'success' : 'warning');
  });

  socket.on('game:chaos-policy', (type) => {
    const label = type === 'liberal' ? 'Liberal' : 'Fascist';
    get().addNotification(`Chaos! A ${label} policy was enacted from the top of the deck!`, 'warning');
  });

  socket.on('game:execution', (targetId, targetName, wasHitler) => {
    if (wasHitler) {
      get().addNotification(`${targetName} was executed and was Hitler!`, 'success');
    } else {
      get().addNotification(`${targetName} has been executed.`, 'error');
    }
    // Check if we were executed
    if (targetId === get().myPlayerId) {
      get().addNotification('You have been executed!', 'error');
    }
  });

  socket.on('game:investigation-result', (targetId, party) => {
    get().setInvestigationResult({ targetId, party });
  });

  socket.on('game:over', (result, roles) => {
    get().setGameOverData({ result, roles });
    const winner = result.winner === 'liberals' ? 'Liberals' : 'Fascists';
    get().addNotification(`Game Over! The ${winner} win!`, result.winner === 'liberals' ? 'success' : 'error');
  });

  socket.on('game:narration', (audioBase64) => {
    if (get().isBoardMode) {
      enqueueAudio(audioBase64);
    }
  });

  socket.on('game:chat', (message) => {
    get().appendChatMessage(message);
  });

  // Room dismissed by host
  socket.on('room:dismissed', () => {
    sessionStorage.removeItem('playerSession');
    get().reset();
  });

  // Errors
  socket.on('error', (message) => {
    get().addNotification(message, 'error');
  });

  // Return cleanup function
  return () => {
    socket.off('game:state');
    socket.off('game:private-state');
    socket.off('game:player-joined');
    socket.off('game:player-left');
    socket.off('game:player-reconnected');
    socket.off('game:phase-change');
    socket.off('game:policy-enacted');
    socket.off('game:vote-reveal');
    socket.off('game:chaos-policy');
    socket.off('game:execution');
    socket.off('game:investigation-result');
    socket.off('game:over');
    socket.off('game:narration');
    socket.off('game:chat');
    socket.off('room:dismissed');
    socket.off('error');
  };
}
