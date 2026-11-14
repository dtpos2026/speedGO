import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { z } from 'zod';
import { loadAdminFromToken, loadUserFromToken } from './auth.js';
import { setIo } from './bus.js';
import { config } from './config.js';
import { hasPerm } from './rbac.js';
import { updateLocation } from './drivers.js';
import { openRequestsForDriver } from './orders.js';

export function initRealtime(server: HttpServer): Server {
  const io = new Server(server, { cors: { origin: config.corsOrigins }, pingInterval: 10_000, pingTimeout: 8_000 });
  setIo(io);

  // Every socket must present a valid token. Rooms are decided by the server, never by the client.
  io.use((socket, next) => {
    const token = String(socket.handshake.auth?.token ?? '');
    const kind = String(socket.handshake.auth?.kind ?? 'user');
    try {
      if (kind === 'admin') {
        const a = loadAdminFromToken(token);
        if (!hasPerm(a.roleKey, 'live:view')) throw new Error('forbidden');
        socket.data.admin = a;
      } else {
        socket.data.user = loadUserFromToken(token);
      }
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  const loc = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), heading: z.number().nullish() });

  io.on('connection', (socket) => {
    if (socket.data.admin) {
      socket.join('admin');
      return;
    }
    const u = socket.data.user as { id: number; role: 'rider' | 'driver' };
    socket.join(`u:${u.id}`);
    if (u.role === 'driver') {
      socket.join('drivers');
      // Send requests that are already open, so a driver who just opened the app does not miss them.
      for (const r of openRequestsForDriver(u.id)) socket.emit('order:new', r);
      socket.on('driver:location', (raw: unknown) => {
        const p = loc.safeParse(raw);
        if (p.success) updateLocation(u.id, p.data);
      });
    }
  });
  return io;
}
