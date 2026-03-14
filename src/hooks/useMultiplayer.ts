/**
 * useMultiplayer — manages the multiplayer socket lifecycle and exposes
 * actions for creating/joining rooms and sending game events.
 *
 * The hook does NOT import from gameStore to avoid circular dependency.
 * Callers pass callbacks that bridge incoming events to the store.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { connectSocket, disconnectSocket, getSocket } from '../lib/socket';
import type {
  SerializedAction,
  GameReadyPayload,
  DrawResultPayload,
  OpponentDrewPayload,
  RelayedActionPayload,
  ReconnectOkPayload,
  RoomCreatedPayload,
} from '../../server/src/types';
import type { CardInstance } from '../types/cards';

export type MultiplayerStatus =
  | 'idle'
  | 'connecting'
  | 'waiting'        // room created, waiting for opponent
  | 'ready'          // game-ready received
  | 'reconnecting'
  | 'disconnected'
  | 'error';

export interface UseMultiplayerOptions {
  onGameReady: (payload: GameReadyPayload) => void;
  onDrawResult: (card: CardInstance) => void;
  onOpponentDrew: (payload: OpponentDrewPayload) => void;
  onGameAction: (payload: RelayedActionPayload) => void;
  onOpponentDisconnected: () => void;
  onOpponentReconnected: () => void;
  onReconnectOk: (payload: ReconnectOkPayload) => void;
}

export interface MultiplayerControls {
  status: MultiplayerStatus;
  roomId: string | null;
  playerId: string | null;
  shareUrl: string | null;
  myIndex: 0 | 1 | null;
  error: string | null;
  createRoom: (deckString: string) => void;
  joinRoom: (roomId: string, deckString: string) => void;
  sendAction: (action: SerializedAction) => void;
  drawFate: () => void;
  syncState: (state: unknown) => void;
  leave: () => void;
}

const SESSION_KEY_ROOM   = 'l5r_room_id';
const SESSION_KEY_PLAYER = 'l5r_player_id';
const SESSION_KEY_INDEX  = 'l5r_player_index';

export function useMultiplayer(options: UseMultiplayerOptions): MultiplayerControls {
  const [status,   setStatus]   = useState<MultiplayerStatus>('idle');
  const [roomId,   setRoomId]   = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [myIndex,  setMyIndex]  = useState<0 | 1 | null>(null);
  const [error,    setError]    = useState<string | null>(null);

  // Keep callbacks in a ref so the effect doesn't need to re-subscribe when they change
  const optionsRef = useRef(options);
  useEffect(() => { optionsRef.current = options; }, [options]);

  useEffect(() => {
    const socket = connectSocket();

    const onConnect = () => {
      console.log('[socket] connected');
      // Attempt reconnection if we have saved session data
      const savedRoom   = sessionStorage.getItem(SESSION_KEY_ROOM);
      const savedPlayer = sessionStorage.getItem(SESSION_KEY_PLAYER);
      const savedIndex  = sessionStorage.getItem(SESSION_KEY_INDEX);
      if (savedRoom && savedPlayer) {
        setStatus('reconnecting');
        setRoomId(savedRoom);
        setPlayerId(savedPlayer);
        setMyIndex(savedIndex ? (parseInt(savedIndex) as 0 | 1) : null);
        socket.emit('reconnect-room', { roomId: savedRoom, playerId: savedPlayer });
      }
    };

    const onDisconnect = () => {
      console.log('[socket] disconnected');
      setStatus('disconnected');
    };

    const onRoomCreated = (payload: RoomCreatedPayload) => {
      setRoomId(payload.roomId);
      setPlayerId(payload.playerId);
      setShareUrl(payload.shareUrl);
      setMyIndex(0);
      setStatus('waiting');
      sessionStorage.setItem(SESSION_KEY_ROOM,   payload.roomId);
      sessionStorage.setItem(SESSION_KEY_PLAYER, payload.playerId);
      sessionStorage.setItem(SESSION_KEY_INDEX,  '0');
    };

    const onRoomJoined = (payload: { roomId: string; playerId: string }) => {
      setRoomId(payload.roomId);
      setPlayerId(payload.playerId);
      setMyIndex(1);
      sessionStorage.setItem(SESSION_KEY_ROOM,   payload.roomId);
      sessionStorage.setItem(SESSION_KEY_PLAYER, payload.playerId);
      sessionStorage.setItem(SESSION_KEY_INDEX,  '1');
    };

    const onGameReady = (payload: GameReadyPayload) => {
      setMyIndex(payload.playerIndex);
      setStatus('ready');
      optionsRef.current.onGameReady(payload);
    };

    const onDrawResult = (payload: DrawResultPayload) => {
      optionsRef.current.onDrawResult(payload.card);
    };

    const onOpponentDrew = (payload: OpponentDrewPayload) => {
      optionsRef.current.onOpponentDrew(payload);
    };

    const onGameAction = (payload: RelayedActionPayload) => {
      optionsRef.current.onGameAction(payload);
    };

    const onOpponentDisconnected = () => {
      optionsRef.current.onOpponentDisconnected();
    };

    const onOpponentReconnected = () => {
      optionsRef.current.onOpponentReconnected();
    };

    const onReconnectOk = (payload: ReconnectOkPayload) => {
      setStatus('ready');
      optionsRef.current.onReconnectOk(payload);
    };

    const onError = (payload: { message: string }) => {
      setError(payload.message);
      setStatus('error');
    };

    socket.on('connect',               onConnect);
    socket.on('disconnect',            onDisconnect);
    socket.on('room-created',          onRoomCreated);
    socket.on('room-joined',           onRoomJoined);
    socket.on('game-ready',            onGameReady);
    socket.on('draw-result',           onDrawResult);
    socket.on('opponent-drew',         onOpponentDrew);
    socket.on('game-action',           onGameAction);
    socket.on('opponent-disconnected', onOpponentDisconnected);
    socket.on('opponent-reconnected',  onOpponentReconnected);
    socket.on('reconnect-ok',          onReconnectOk);
    socket.on('error',                 onError);

    return () => {
      socket.off('connect',               onConnect);
      socket.off('disconnect',            onDisconnect);
      socket.off('room-created',          onRoomCreated);
      socket.off('room-joined',           onRoomJoined);
      socket.off('game-ready',            onGameReady);
      socket.off('draw-result',           onDrawResult);
      socket.off('opponent-drew',         onOpponentDrew);
      socket.off('game-action',           onGameAction);
      socket.off('opponent-disconnected', onOpponentDisconnected);
      socket.off('opponent-reconnected',  onOpponentReconnected);
      socket.off('reconnect-ok',          onReconnectOk);
      socket.off('error',                 onError);
    };
  }, []);

  const createRoom = useCallback((deckString: string) => {
    setStatus('connecting');
    setError(null);
    const socket = getSocket();
    socket.emit('create-room', { deckString });
  }, []);

  const joinRoom = useCallback((roomCode: string, deckString: string) => {
    setStatus('connecting');
    setError(null);
    const socket = getSocket();
    socket.emit('join-room', { roomId: roomCode.toUpperCase(), deckString });
  }, []);

  const sendAction = useCallback((action: SerializedAction) => {
    const socket = getSocket();
    const savedRoom   = sessionStorage.getItem(SESSION_KEY_ROOM);
    const savedPlayer = sessionStorage.getItem(SESSION_KEY_PLAYER);
    if (!savedRoom || !savedPlayer) return;
    socket.emit('game-action', { roomId: savedRoom, playerId: savedPlayer, action });
  }, []);

  const drawFate = useCallback(() => {
    const socket = getSocket();
    const savedRoom   = sessionStorage.getItem(SESSION_KEY_ROOM);
    const savedPlayer = sessionStorage.getItem(SESSION_KEY_PLAYER);
    if (!savedRoom || !savedPlayer) return;
    socket.emit('draw-fate', { roomId: savedRoom, playerId: savedPlayer });
  }, []);

  const syncState = useCallback((state: unknown) => {
    const socket = getSocket();
    const savedRoom   = sessionStorage.getItem(SESSION_KEY_ROOM);
    const savedPlayer = sessionStorage.getItem(SESSION_KEY_PLAYER);
    if (!savedRoom || !savedPlayer) return;
    socket.emit('sync-state', { roomId: savedRoom, playerId: savedPlayer, state });
  }, []);

  const leave = useCallback(() => {
    sessionStorage.removeItem(SESSION_KEY_ROOM);
    sessionStorage.removeItem(SESSION_KEY_PLAYER);
    sessionStorage.removeItem(SESSION_KEY_INDEX);
    disconnectSocket();
    setStatus('idle');
    setRoomId(null);
    setPlayerId(null);
    setShareUrl(null);
    setMyIndex(null);
    setError(null);
  }, []);

  return {
    status, roomId, playerId, shareUrl, myIndex, error,
    createRoom, joinRoom, sendAction, drawFate, syncState, leave,
  };
}
