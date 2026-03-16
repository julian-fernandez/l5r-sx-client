/**
 * Lazy Socket.io singleton.
 *
 * The socket is only created the first time `getSocket()` is called.
 * Solo/goldfish games never call this, so no connection is ever opened.
 */
import { io, type Socket } from 'socket.io-client';

let _socket: Socket | null = null;

// In dev, Vite proxy forwards /socket.io → localhost:3001 (see vite.config.ts).
// In production, set VITE_SERVER_URL to the deployed server (e.g. Render URL).
const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? '/';

export function getSocket(): Socket {
  if (!_socket) {
    _socket = io(SERVER_URL, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      autoConnect: false,
    });
  }
  return _socket;
}

export function connectSocket(): Socket {
  const s = getSocket();
  if (!s.connected) s.connect();
  return s;
}

export function disconnectSocket(): void {
  _socket?.disconnect();
  _socket = null;
}
