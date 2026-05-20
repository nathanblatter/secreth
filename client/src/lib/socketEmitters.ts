import type { RoomSettings } from '../../../shared/src/types/game';
import socket from './socket';

export function createRoom(playerName: string): Promise<string> {
  return new Promise((resolve) => {
    socket.emit('lobby:create', playerName, (roomCode) => {
      resolve(roomCode);
    });
  });
}

export function joinRoom(roomCode: string, playerName: string): Promise<string | null> {
  return new Promise((resolve) => {
    socket.emit('lobby:join', roomCode, playerName, (error) => {
      resolve(error);
    });
  });
}

export function restartGame(): Promise<string | null> {
  return new Promise((resolve) => {
    socket.emit('lobby:restart', (error) => {
      resolve(error);
    });
  });
}

export function dismissRoom(): Promise<string | null> {
  return new Promise((resolve) => {
    socket.emit('lobby:dismiss', (error) => {
      resolve(error);
    });
  });
}

export function startGame(): Promise<string | null> {
  return new Promise((resolve) => {
    socket.emit('lobby:start', (error) => {
      resolve(error);
    });
  });
}

export function nominateChancellor(chancellorId: string): Promise<string | null> {
  return new Promise((resolve) => {
    socket.emit('election:nominate', chancellorId, (error) => {
      resolve(error);
    });
  });
}

export function castVote(vote: boolean): Promise<string | null> {
  return new Promise((resolve) => {
    socket.emit('election:vote', vote, (error) => {
      resolve(error);
    });
  });
}

export function presidentDiscard(policyIndex: number): Promise<string | null> {
  return new Promise((resolve) => {
    socket.emit('legislative:president-discard', policyIndex, (error) => {
      resolve(error);
    });
  });
}

export function chancellorEnact(policyIndex: number): Promise<string | null> {
  return new Promise((resolve) => {
    socket.emit('legislative:chancellor-enact', policyIndex, (error) => {
      resolve(error);
    });
  });
}

export function requestVeto(): Promise<string | null> {
  return new Promise((resolve) => {
    socket.emit('legislative:veto-request', (error) => {
      resolve(error);
    });
  });
}

export function respondToVeto(approve: boolean): Promise<string | null> {
  return new Promise((resolve) => {
    socket.emit('legislative:veto-response', approve, (error) => {
      resolve(error);
    });
  });
}

export function investigate(targetId: string): Promise<string | null> {
  return new Promise((resolve) => {
    socket.emit('executive:investigate', targetId, (error) => {
      resolve(error);
    });
  });
}

export function specialElection(targetId: string): Promise<string | null> {
  return new Promise((resolve) => {
    socket.emit('executive:special-election', targetId, (error) => {
      resolve(error);
    });
  });
}

export function executePlayer(targetId: string): Promise<string | null> {
  return new Promise((resolve) => {
    socket.emit('executive:execute', targetId, (error) => {
      resolve(error);
    });
  });
}

export function acknowledgeInvestigation(): Promise<string | null> {
  return new Promise((resolve) => {
    socket.emit('executive:investigate-acknowledge', (error) => {
      resolve(error);
    });
  });
}

export function acknowledgePeek(): Promise<string | null> {
  return new Promise((resolve) => {
    socket.emit('executive:peek-acknowledge', (error) => {
      resolve(error);
    });
  });
}

export function updateRoomSettings(settings: Partial<RoomSettings>): Promise<string | null> {
  return new Promise((resolve) => {
    socket.emit('lobby:update-settings', settings, (error) => {
      resolve(error);
    });
  });
}

export function spectateRoom(roomCode: string): Promise<string | null> {
  return new Promise((resolve) => {
    socket.emit('board:spectate', roomCode, (error) => {
      resolve(error);
    });
  });
}

export function castReady(): Promise<string | null> {
  return new Promise((resolve) => {
    socket.emit('discussion:ready', (error) => {
      resolve(error);
    });
  });
}

export function sendChatMessage(text: string): Promise<string | null> {
  return new Promise((resolve) => {
    socket.emit('chat:send', text, (error) => {
      resolve(error);
    });
  });
}
