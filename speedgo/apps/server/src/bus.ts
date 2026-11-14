import type { Server } from 'socket.io';

// Thin indirection so business logic can emit realtime events without importing the socket server (avoids cycles).
let io: Server | null = null;
export const setIo = (s: Server) => {
  io = s;
};
export const toUser = (userId: number, event: string, payload: unknown) => io?.to(`u:${userId}`).emit(event, payload);
export const toDrivers = (event: string, payload: unknown) => io?.to('drivers').emit(event, payload);
export const toAdmins = (event: string, payload: unknown) => io?.to('admin').emit(event, payload);
