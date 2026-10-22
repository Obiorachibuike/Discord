import type { Server as IOServer } from 'socket.io';

let io: IOServer | null = null;

export function setIO(server: IOServer): void {
  io = server;
}

export function getIO(): IOServer {
  if (!io) throw new Error('Socket.IO server not initialised');
  return io;
}

export function tryGetIO(): IOServer | null {
  return io;
}
