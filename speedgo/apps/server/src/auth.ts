import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';
import { audit, db } from './db.js';
import { forbidden, HttpError, unauthorized } from './errors.js';
import { hasPerm, type Permission } from './rbac.js';

export interface AuthUser {
  id: number;
  role: 'rider' | 'driver';
  phone: string;
  name: string | null;
  status: string;
}
export interface AuthAdmin {
  id: number;
  email: string;
  name: string;
  roleKey: string;
  cityId: number | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      admin?: AuthAdmin;
    }
  }
}

const sha = (s: string) => crypto.createHash('sha256').update(s + config.jwtSecret).digest('hex');

// ---------- OTP ----------
export function requestOtp(phone: string, role: 'rider' | 'driver'): { devCode?: string } {
  const now = Date.now();
  db.prepare('DELETE FROM otp_requests WHERE at < ?').run(now - 3_600_000);
  const recent = (db.prepare('SELECT COUNT(*) c FROM otp_requests WHERE phone=?').get(phone) as { c: number }).c;
  if (recent >= 5) throw new HttpError(429, 'Too many code requests. Please try again in an hour.', 'OTP_RATE_LIMIT');
  db.prepare('INSERT INTO otp_requests(phone,at) VALUES (?,?)').run(phone, now);

  if (config.otpMode === 'dev') {
    // LOCAL TESTING ONLY. Real SMS delivery is a later phase.
    db.prepare(
      'INSERT INTO otps(phone,role,code_hash,expires_at,attempts) VALUES (?,?,?,?,0) ON CONFLICT(phone,role) DO UPDATE SET code_hash=excluded.code_hash, expires_at=excluded.expires_at, attempts=0',
    ).run(phone, role, sha(config.devOtpCode), now + 300_000);
    return { devCode: config.devOtpCode };
  }
  throw new HttpError(501, 'SMS provider is not configured', 'SMS_NOT_CONFIGURED');
}

export function verifyOtp(phone: string, role: 'rider' | 'driver', code: string): void {
  const row = db.prepare('SELECT * FROM otps WHERE phone=? AND role=?').get(phone, role) as
    | { code_hash: string; expires_at: number; attempts: number }
    | undefined;
  if (!row || row.expires_at < Date.now()) throw new HttpError(400, 'Code expired. Please request a new one.', 'OTP_EXPIRED');
  if (row.attempts >= 5) throw new HttpError(429, 'Too many wrong attempts. Request a new code.', 'OTP_LOCKED');
  const ok = crypto.timingSafeEqual(Buffer.from(sha(code)), Buffer.from(row.code_hash));
  if (!ok) {
    db.prepare('UPDATE otps SET attempts=attempts+1 WHERE phone=? AND role=?').run(phone, role);
    throw new HttpError(400, 'That code is not correct.', 'OTP_WRONG');
  }
  db.prepare('DELETE FROM otps WHERE phone=? AND role=?').run(phone, role);
}

// ---------- Tokens ----------
export const signUserToken = (u: { id: number; role: string }) =>
  jwt.sign({ sub: u.id, role: u.role }, config.jwtSecret, { audience: 'speedgo-app', expiresIn: '30d' });
export const signAdminToken = (a: { id: number }) =>
  jwt.sign({ sub: a.id, role: 'admin' }, config.jwtSecret, { audience: 'speedgo-admin', expiresIn: '8h' });

function bearer(req: Request): string | null {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : null;
}

export function loadUserFromToken(token: string): AuthUser {
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { audience: 'speedgo-app' }) as jwt.JwtPayload;
  } catch {
    throw unauthorized();
  }
  const u = db.prepare('SELECT id,role,phone,name,status FROM users WHERE id=?').get(Number(payload.sub)) as AuthUser | undefined;
  if (!u) throw unauthorized();
  if (u.status === 'blocked') throw forbidden('This account is blocked. Please contact SpeedGo support.', 'ACCOUNT_BLOCKED');
  return u;
}

export function loadAdminFromToken(token: string): AuthAdmin {
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { audience: 'speedgo-admin' }) as jwt.JwtPayload;
  } catch {
    throw unauthorized();
  }
  const a = db.prepare('SELECT id,email,name,role_key,city_id,status FROM admins WHERE id=?').get(Number(payload.sub)) as
    | { id: number; email: string; name: string; role_key: string; city_id: number | null; status: string }
    | undefined;
  if (!a || a.status !== 'active') throw unauthorized();
  return { id: a.id, email: a.email, name: a.name, roleKey: a.role_key, cityId: a.city_id };
}

// ---------- Express middleware ----------
export const requireUser =
  (role: 'rider' | 'driver') =>
  (req: Request, _res: Response, next: NextFunction) => {
    try {
      const t = bearer(req);
      if (!t) throw unauthorized();
      const u = loadUserFromToken(t);
      if (u.role !== role) throw forbidden('Wrong app for this account');
      req.user = u;
      next();
    } catch (e) {
      next(e);
    }
  };

/** Server-side permission check. Hidden menus are not a security boundary; this is. */
export const requireAdmin =
  (...perms: Permission[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    try {
      const t = bearer(req);
      if (!t) throw unauthorized();
      const a = loadAdminFromToken(t);
      for (const p of perms) {
        if (!hasPerm(a.roleKey, p)) {
          audit('security', a.id, a.name, 'permission.denied', `${req.method} ${req.originalUrl}`, { need: p, role: a.roleKey });
          throw forbidden();
        }
      }
      req.admin = a;
      next();
    } catch (e) {
      next(e);
    }
  };
