import { randomBytes } from 'crypto';
import type { Room, ConnectedPlayer, ServerDeckState } from './types.js';
import type { PlayerState } from '../../src/types/cards.js';

const rooms = new Map<string, Room>();

// Clean up empty rooms older than 4 hours
setInterval(() => {
  const cutoff = Date.now() - 4 * 60 * 60 * 1000;
  for (const [id, room] of rooms) {
    if (room.createdAt < cutoff) rooms.delete(id);
  }
}, 30 * 60 * 1000);

export function generateRoomId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
  return Array.from({ length: 6 }, () => chars[randomBytes(1)[0] % chars.length]).join('');
}

export function generatePlayerId(): string {
  return randomBytes(12).toString('hex');
}

export function createRoom(socketId: string, deckString: string): Room {
  const id = generateRoomId();
  const player: ConnectedPlayer = {
    socketId,
    playerId: generatePlayerId(),
    index: 0,
    deckString,
    connected: true,
  };
  const room: Room = {
    id,
    players: [player],
    deckStates: null,
    playerStates: null,
    firstPlayerIndex: null,
    createdAt: Date.now(),
  };
  rooms.set(id, room);
  return room;
}

export function joinRoom(
  roomId: string,
  socketId: string,
  deckString: string,
): { room: Room; player: ConnectedPlayer } | { error: string } {
  const room = rooms.get(roomId.toUpperCase());
  if (!room) return { error: 'Room not found. Check the code and try again.' };
  if (room.players.length >= 2) return { error: 'Room is full.' };

  const player: ConnectedPlayer = {
    socketId,
    playerId: generatePlayerId(),
    index: 1,
    deckString,
    connected: true,
  };
  room.players.push(player);
  return { room, player };
}

export function getRoom(roomId: string): Room | undefined {
  return rooms.get(roomId.toUpperCase());
}

export function findRoomBySocketId(socketId: string): Room | undefined {
  for (const room of rooms.values()) {
    if (room.players.some(p => p.socketId === socketId)) return room;
  }
  return undefined;
}

export function findPlayerInRoom(
  room: Room,
  playerId: string,
): ConnectedPlayer | undefined {
  return room.players.find(p => p.playerId === playerId);
}

export function getOpponentPlayer(
  room: Room,
  myIndex: 0 | 1,
): ConnectedPlayer | undefined {
  return room.players.find(p => p.index !== myIndex);
}

export function markDisconnected(room: Room, socketId: string): void {
  const p = room.players.find(p => p.socketId === socketId);
  if (p) p.connected = false;
}

export function reconnectPlayer(
  room: Room,
  playerId: string,
  newSocketId: string,
): ConnectedPlayer | undefined {
  const p = room.players.find(p => p.playerId === playerId);
  if (!p) return undefined;
  p.socketId = newSocketId;
  p.connected = true;
  return p;
}

export function setDeckStates(
  room: Room,
  deckStates: [ServerDeckState, ServerDeckState],
): void {
  room.deckStates = deckStates;
}

export function setPlayerStates(
  room: Room,
  states: [PlayerState, PlayerState],
): void {
  room.playerStates = states;
}

export function setFirstPlayer(room: Room, index: 0 | 1): void {
  room.firstPlayerIndex = index;
}

export function updatePlayerState(
  room: Room,
  playerIndex: 0 | 1,
  state: PlayerState,
): void {
  if (!room.playerStates) return;
  room.playerStates[playerIndex] = state;
}
