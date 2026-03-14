/**
 * Lazy Socket.io singleton.
 *
 * The socket is only created the first time `getSocket()` is called.
 * Solo/goldfish games never call this, so no connection is ever opened.
 */
import { io, type Socket } from 'socket.io-client';

let _socket: Socket | null = null;

export function getSocket(): Socket {
  if (!_socket) {
    // In dev the Vite proxy forwards /socket.io → localhost:3001.
    // In production the same origin serves both client and server.
    _socket = io('/', {
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
