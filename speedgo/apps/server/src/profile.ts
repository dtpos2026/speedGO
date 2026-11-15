import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { db } from './db.js';
import { badRequest } from './errors.js';
import type { UserDto } from '@speedgo/shared';

/** Sniff the real file type from its first bytes (do not trust the client's mime header). */
export function sniffImage(buf: Buffer): string | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}
const EXT: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

export function userDto(userId: number): UserDto {
  const u = db.prepare('SELECT id,role,phone,name,avatar,wallet,rating_sum,rating_count,created_at FROM users WHERE id=?').get(userId) as {
    id: number; role: 'rider' | 'driver'; phone: string; name: string | null; avatar: string | null; wallet: number; rating_sum: number; rating_count: number; created_at: number;
  };
  const col = u.role === 'rider' ? 'rider_id' : 'driver_id';
  const trips = (db.prepare(`SELECT COUNT(*) c FROM orders WHERE ${col}=? AND status='completed'`).get(userId) as { c: number }).c;
  return {
    id: u.id, role: u.role, phone: u.phone, name: u.name, wallet: u.wallet,
    rating: u.rating_count ? Math.round((u.rating_sum / u.rating_count) * 10) / 10 : null,
    avatarUrl: u.avatar ? `/api/media/avatar/${u.avatar}` : null,
    trips, memberSince: u.created_at,
  };
}

/** Profile photos are small, public-by-unguessable-name images. Old photos are deleted. */
export function saveAvatar(userId: number, buf: Buffer) {
  const mime = sniffImage(buf);
  if (!mime) throw badRequest('Please upload a JPG, PNG or WebP photo', 'BAD_FILE');
  const file = crypto.randomBytes(16).toString('hex') + EXT[mime];
  fs.writeFileSync(path.join(config.avatarsDir, file), buf, { mode: 0o644 });
  const old = db.prepare('SELECT avatar FROM users WHERE id=?').get(userId) as { avatar: string | null } | undefined;
  db.prepare('UPDATE users SET avatar=? WHERE id=?').run(file, userId);
  if (old?.avatar) fs.rmSync(path.join(config.avatarsDir, old.avatar), { force: true });
}

export function removeAvatar(userId: number) {
  const old = db.prepare('SELECT avatar FROM users WHERE id=?').get(userId) as { avatar: string | null } | undefined;
  db.prepare('UPDATE users SET avatar=NULL WHERE id=?').run(userId);
  if (old?.avatar) fs.rmSync(path.join(config.avatarsDir, old.avatar), { force: true });
}

export const AVATAR_FILE = /^[a-f0-9]{32}\.(jpg|png|webp)$/;
