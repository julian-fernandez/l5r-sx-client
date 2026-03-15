import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

import {
  createRoom,
  joinRoom,
  getRoom,
  findRoomBySocketId,
  findPlayerInRoom,
  getOpponentPlayer,
  markDisconnected,
  reconnectPlayer,
  setDeckStates,
  setPlayerStates,
  setFirstPlayer,
  updatePlayerState,
} from './rooms.js';
import { initGame, serverDrawFate, ensureCatalogLoaded } from './gameInit.js';
import type {
  CreateRoomPayload,
  JoinRoomPayload,
  GameActionPayload,
  ReconnectPayload,
  DrawFateCardPayload,
  SyncStatePayload,
  SerializedAction,
} from './types.js';
import type { PlayerState } from '../../src/types/cards.js';

// ─── Bootstrap ────────────────────────────────────────────────────────────────

ensureCatalogLoaded();

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;
// Allow any localhost port in dev so Vite's port auto-increment doesn't break CORS.
// In production set CLIENT_ORIGIN to your actual domain.
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? /^http:\/\/localhost:\d+$/;

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json());

// Basic health check
app.get('/health', (_req, res) => res.json({ ok: true }));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: CLIENT_ORIGIN, methods: ['GET', 'POST'], credentials: true },
  transports: ['websocket', 'polling'],
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildShareUrl(roomId: string, referer?: string): string {
  // Use the actual origin the client connected from (handles Vite port auto-increment).
  const base = referer
    ? new URL(referer).origin
    : (typeof CLIENT_ORIGIN === 'string' ? CLIENT_ORIGIN : 'http://localhost:5173');
  return `${base}/?room=${roomId}`;
}

function getPlayerIndex(room: ReturnType<typeof getRoom>, socketId: string): 0 | 1 | null {
  const p = room?.players.find(p => p.socketId === socketId);
  return p ? p.index : null;
}

// ─── Socket events ────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[socket] connected: ${socket.id}`);

  // ── Create a private room ───────────────────────────────────────────────────
  socket.on('create-room', ({ deckString }: CreateRoomPayload) => {
    if (!deckString?.trim()) {
      socket.emit('error', { message: 'Deck string is required.' });
      return;
    }
    const room = createRoom(socket.id, deckString.trim());
    socket.join(room.id);
    const player = room.players[0];
    const referer = socket.handshake.headers.origin as string | undefined;
    socket.emit('room-created', {
      roomId: room.id,
      playerId: player.playerId,
      shareUrl: buildShareUrl(room.id, referer),
    });
    console.log(`[room] created ${room.id} by ${socket.id}`);
  });

  // ── Join an existing room ───────────────────────────────────────────────────
  socket.on('join-room', ({ roomId, deckString }: JoinRoomPayload) => {
    if (!deckString?.trim()) {
      socket.emit('error', { message: 'Deck string is required.' });
      return;
    }
    const result = joinRoom(roomId, socket.id, deckString.trim());
    if ('error' in result) {
      socket.emit('error', { message: result.error });
      return;
    }

    const { room, player } = result;
    socket.join(room.id);
    console.log(`[room] ${socket.id} joined ${room.id}`);

    // Initialize game state
    const p0Deck = room.players[0].deckString;
    const p1Deck = room.players[1].deckString;
    const init = initGame([p0Deck, p1Deck]);

    if ('error' in init) {
      socket.emit('error', { message: init.error });
      return;
    }

    setDeckStates(room, init.deckStates);
    setPlayerStates(room, init.playerStates);
    setFirstPlayer(room, init.firstPlayerIndex);

    // Send each player their own state + redacted opponent info
    const p0Socket = room.players[0].socketId;
    const p1Socket = room.players[1].socketId;

    io.to(p0Socket).emit('game-ready', init.payloads[0]);
    io.to(p1Socket).emit('game-ready', init.payloads[1]);

    // Confirm to the joining player their playerId
    socket.emit('room-joined', { roomId: room.id, playerId: player.playerId });

    console.log(`[game] started in ${room.id}, first player: ${init.firstPlayerIndex}`);
  });

  // ── Draw a fate card (server decides which card) ────────────────────────────
  socket.on('draw-fate', ({ roomId, playerId }: DrawFateCardPayload) => {
    const room = getRoom(roomId);
    if (!room || !room.deckStates) return;

    const p = findPlayerInRoom(room, playerId);
    if (!p || p.socketId !== socket.id) return;

    const card = serverDrawFate(room.deckStates[p.index]);
    if (!card) {
      socket.emit('error', { message: 'Fate deck is empty.' });
      return;
    }

    // Send card only to the drawing player
    socket.emit('draw-result', { card });

    // Notify opponent of deck count change only
    const opp = getOpponentPlayer(room, p.index);
    if (opp?.connected) {
      io.to(opp.socketId).emit('opponent-drew', {
        newHandCount: -1, // client will track
        newDeckCount: room.deckStates[p.index].fateDeck.length,
      });
    }
  });

  // ── Relay a general game action to both players ─────────────────────────────
  socket.on('game-action', ({ roomId, playerId, action }: GameActionPayload) => {
    const room = getRoom(roomId);
    if (!room) return;

    const p = findPlayerInRoom(room, playerId);
    if (!p || p.socketId !== socket.id) return;

    // Broadcast to everyone in the room (sender included so both stores stay in sync)
    io.to(room.id).emit('game-action', {
      action,
      fromIndex: p.index,
    });
  });

  // ── Client snapshots its current state for reconnection ────────────────────
  socket.on('sync-state', ({ roomId, playerId, state }: SyncStatePayload) => {
    const room = getRoom(roomId);
    if (!room) return;
    const p = findPlayerInRoom(room, playerId);
    if (!p || p.socketId !== socket.id) return;
    updatePlayerState(room, p.index, state as PlayerState);
  });

  // ── Reconnect to an existing room ───────────────────────────────────────────
  socket.on('reconnect-room', ({ roomId, playerId }: ReconnectPayload) => {
    const room = getRoom(roomId);
    if (!room) {
      socket.emit('error', { message: 'Game no longer exists.' });
      return;
    }

    const p = reconnectPlayer(room, playerId, socket.id);
    if (!p) {
      socket.emit('error', { message: 'Player ID not recognized.' });
      return;
    }

    socket.join(room.id);

    if (room.playerStates) {
      const opp = getOpponentPlayer(room, p.index);
      const oppState = room.playerStates[opp?.index ?? (p.index === 0 ? 1 : 0)];

      socket.emit('reconnect-ok', {
        playerIndex: p.index,
        firstPlayerIndex: room.firstPlayerIndex,
        ownState: room.playerStates[p.index],
        opponentInfo: {
          stronghold: oppState.stronghold,
          sensei: oppState.sensei,
          familyHonor: oppState.familyHonor,
          strongholdGoldProduction: oppState.strongholdGoldProduction,
          provinceStrength: oppState.provinceStrength,
          handCount: oppState.hand.length,
          fateDeckCount: oppState.fateDeck.length,
          dynastyDeckCount: oppState.dynastyDeck.length,
          fateDiscardCount: oppState.fateDiscard.length,
          dynastyDiscardCount: oppState.dynastyDiscard.length,
          provinces: oppState.provinces,
          holdingsInPlay: oppState.holdingsInPlay,
          personalitiesHome: oppState.personalitiesHome,
          specialsInPlay: oppState.specialsInPlay,
          honorablyDead: oppState.honorablyDead,
          dishonorablelyDead: oppState.dishonorablelyDead,
          goldPool: oppState.goldPool,
          strongholdBowed: oppState.strongholdBowed,
        },
      });
    }

    // Tell opponent they reconnected
    const opp = getOpponentPlayer(room, p.index);
    if (opp?.connected) {
      io.to(opp.socketId).emit('opponent-reconnected');
    }

    console.log(`[room] player ${p.index} reconnected to ${room.id}`);
  });

  // ── Disconnect ──────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const room = findRoomBySocketId(socket.id);
    if (!room) return;

    markDisconnected(room, socket.id);
    const p = room.players.find(p => p.socketId === socket.id);
    if (p) {
      const opp = getOpponentPlayer(room, p.index);
      if (opp?.connected) {
        io.to(opp.socketId).emit('opponent-disconnected');
      }
    }
    console.log(`[socket] disconnected: ${socket.id}`);
  });
});

// ─── Start ─────────────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`[server] L5R game server listening on :${PORT}`);
  console.log(`[server] Accepting connections from ${CLIENT_ORIGIN}`);
});
