import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { z } from 'zod';
import { normalizeCnic, normalizePhone, VEHICLE_TYPES } from '@speedgo/shared';
import { requestOtp, requireUser, signUserToken, verifyOtp } from '../auth.js';
import { config } from '../config.js';
import { db } from '../db.js';
import { driverProfile, saveDocument, setOnline, submitForReview, updateLocation, updateProfile, ensureDriverRow } from '../drivers.js';
import { badRequest, notFound } from '../errors.js';
import { reverseGeocode, route, searchPlaces } from '../geo.js';
import {
  acceptOffer, activeOrderForDriver, activeOrderForRider, cancelByDriver, cancelByRider, cityForPoint, createOrder, driverArrived, driverCashConfirm,
  driverComplete, driverEarnings, driverOffer, driverSkip, driverStart, getOrder, openRequestsForDriver, orderDto, ordersForUser, raiseOffer,
  raiseSos, rateDriver, rateRider,
} from '../orders.js';
import { estimateAll } from '../pricing.js';
import { getSettings } from '../settings.js';
import type { EstimateResponse, UserDto } from '@speedgo/shared';

/** Wrap async handlers so thrown errors reach the error middleware. */
export const h =
  (fn: (req: Request, res: Response) => unknown | Promise<unknown>): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };

const latlng = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const place = latlng.extend({ addr: z.string().trim().min(1).max(300) });
const id = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw badRequest('Invalid id');
  return n;
};

function userDto(userId: number): UserDto {
  const u = db.prepare('SELECT id,role,phone,name,wallet,rating_sum,rating_count FROM users WHERE id=?').get(userId) as {
    id: number; role: 'rider' | 'driver'; phone: string; name: string | null; wallet: number; rating_sum: number; rating_count: number;
  };
  return { id: u.id, role: u.role, phone: u.phone, name: u.name, wallet: u.wallet, rating: u.rating_count ? Math.round((u.rating_sum / u.rating_count) * 10) / 10 : null };
}

// =====================================================================================
// Public + auth
// =====================================================================================
export const publicRouter = Router();

publicRouter.get('/public/config', (_req, res) => {
  const city = db.prepare('SELECT id,name,lat,lng,radius_km FROM cities WHERE active=1 LIMIT 1').get();
  res.json({ city, vehicleTypes: VEHICLE_TYPES, otpMode: config.otpMode, devOtpCode: config.otpMode === 'dev' ? config.devOtpCode : undefined });
});

const otpLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Please wait a few minutes.', code: 'RATE_LIMIT' } });

publicRouter.post('/auth/otp/request', otpLimiter, h((req, res) => {
  const b = z.object({ phone: z.string(), role: z.enum(['rider', 'driver']) }).parse(req.body);
  const phone = normalizePhone(b.phone);
  if (!phone) throw badRequest('Enter a valid Pakistani mobile number, e.g. 0300 1234567', 'BAD_PHONE');
  const r = requestOtp(phone, b.role);
  res.json({ ok: true, phone, ...r });
}));

publicRouter.post('/auth/otp/verify', otpLimiter, h((req, res) => {
  const b = z.object({ phone: z.string(), role: z.enum(['rider', 'driver']), code: z.string().length(6), name: z.string().trim().min(2).max(60).optional() }).parse(req.body);
  const phone = normalizePhone(b.phone);
  if (!phone) throw badRequest('Enter a valid Pakistani mobile number', 'BAD_PHONE');
  verifyOtp(phone, b.role, b.code);
  let u = db.prepare('SELECT id,status FROM users WHERE phone=? AND role=?').get(phone, b.role) as { id: number; status: string } | undefined;
  let isNew = false;
  if (!u) {
    const info = db.prepare('INSERT INTO users(phone,role,name,city_id,created_at) VALUES (?,?,?,1,?)').run(phone, b.role, b.name ?? null, Date.now());
    u = { id: Number(info.lastInsertRowid), status: 'active' };
    isNew = true;
  } else if (u.status === 'blocked') {
    throw badRequest('This account is blocked. Please contact SpeedGo support.', 'ACCOUNT_BLOCKED');
  } else if (b.name) {
    db.prepare('UPDATE users SET name=COALESCE(name,?) WHERE id=?').run(b.name, u.id);
  }
  if (b.role === 'driver') ensureDriverRow(u.id);
  res.json({ token: signUserToken({ id: u.id, role: b.role }), user: userDto(u.id), isNew });
}));

publicRouter.get('/geo/search', h(async (req, res) => {
  const q = z.string().trim().min(2).max(120).parse(req.query.q);
  const city = db.prepare('SELECT lat,lng FROM cities WHERE active=1 LIMIT 1').get() as { lat: number; lng: number };
  try {
    res.json({ results: await searchPlaces(q, city) });
  } catch {
    res.json({ results: [], unavailable: true });
  }
}));
publicRouter.get('/geo/reverse', h(async (req, res) => {
  const p = latlng.parse({ lat: Number(req.query.lat), lng: Number(req.query.lng) });
  res.json({ addr: await reverseGeocode(p) });
}));

// =====================================================================================
// Rider
// =====================================================================================
export const riderRouter = Router();
riderRouter.use(requireUser('rider'));

riderRouter.get('/me', h((req, res) => {
  const active = activeOrderForRider(req.user!.id);
  res.json({ user: userDto(req.user!.id), activeOrder: active ? orderDto(active, 'rider') : null });
}));
riderRouter.put('/me', h((req, res) => {
  const b = z.object({ name: z.string().trim().min(2).max(60) }).parse(req.body);
  db.prepare('UPDATE users SET name=? WHERE id=?').run(b.name, req.user!.id);
  res.json({ user: userDto(req.user!.id) });
}));

riderRouter.post('/estimate', h(async (req, res) => {
  const b = z.object({ pickup: latlng, drop: latlng }).parse(req.body);
  const city = cityForPoint(b.pickup);
  if (!city) throw badRequest('SpeedGo is not available at this pickup location yet', 'OUTSIDE_SERVICE_AREA');
  const r = await route(b.pickup, b.drop);
  const out: EstimateResponse = { distanceM: r.distanceM, durationS: r.durationS, route: r.points, routeSource: r.source, estimates: estimateAll(city.id, r.distanceM, r.durationS) };
  res.json(out);
}));

riderRouter.post('/orders', h(async (req, res) => {
  const b = z.object({ vehicleType: z.enum(VEHICLE_TYPES), pickup: place, drop: place, offeredFare: z.number().int().positive() }).parse(req.body);
  res.status(201).json({ order: await createOrder(req.user!.id, b) });
}));
riderRouter.get('/orders', h((req, res) => res.json({ orders: ordersForUser(req.user!.id, 'rider', 50) })));
riderRouter.get('/orders/active', h((req, res) => {
  const a = activeOrderForRider(req.user!.id);
  res.json({ order: a ? orderDto(a, 'rider') : null });
}));
riderRouter.get('/orders/:id', h((req, res) => {
  const o = getOrder(id(req.params.id));
  if (!o || o.rider_id !== req.user!.id) throw notFound('Ride not found');
  res.json({ order: orderDto(o, 'rider') });
}));
riderRouter.post('/orders/:id/offer', h((req, res) => {
  const b = z.object({ fare: z.number().int().positive() }).parse(req.body);
  res.json({ order: raiseOffer(req.user!.id, id(req.params.id), b.fare) });
}));
riderRouter.post('/orders/:id/accept-offer', h((req, res) => {
  const b = z.object({ offerId: z.number().int().positive() }).parse(req.body);
  res.json({ order: acceptOffer(req.user!.id, id(req.params.id), b.offerId) });
}));
riderRouter.post('/orders/:id/cancel', h((req, res) => {
  const b = z.object({ reason: z.string().trim().min(2).max(200).default('Changed my mind') }).parse(req.body ?? {});
  res.json({ order: cancelByRider(req.user!.id, id(req.params.id), b.reason) });
}));
riderRouter.post('/orders/:id/rate', h((req, res) => {
  const b = z.object({ rating: z.number().int().min(1).max(5), tags: z.array(z.string().max(40)).max(6).default([]), comment: z.string().max(300).nullish() }).parse(req.body);
  res.json({ order: rateDriver(req.user!.id, id(req.params.id), b.rating, b.tags, b.comment ?? null) });
}));
riderRouter.post('/orders/:id/sos', h((req, res) => {
  const b = z.object({ location: latlng.nullish() }).parse(req.body ?? {});
  res.json({ ok: true, sos: raiseSos(req.user!.id, 'rider', id(req.params.id), b.location ?? null) });
}));

// =====================================================================================
// Driver
// =====================================================================================
export const driverRouter = Router();
driverRouter.use(requireUser('driver'));

driverRouter.get('/me', h((req, res) => {
  const a = activeOrderForDriver(req.user!.id);
  res.json({ ...driverProfile(req.user!.id), activeOrder: a ? orderDto(a, 'driver') : null, minWallet: getSettings().min_wallet });
}));

driverRouter.put('/profile', h((req, res) => {
  const b = z.object({
    name: z.string().trim().min(2).max(60),
    cnic: z.string(),
    licenceNo: z.string().trim().min(3).max(30),
    vehicleType: z.enum(VEHICLE_TYPES),
    plate: z.string().trim().min(3).max(15),
    model: z.string().trim().min(2).max(40),
    color: z.string().trim().min(2).max(20),
    year: z.number().int().min(1990).max(new Date().getFullYear() + 1),
  }).parse(req.body);
  const cnic = normalizeCnic(b.cnic);
  if (!cnic) throw badRequest('CNIC must be 13 digits, e.g. 35202-1234567-1', 'BAD_CNIC');
  updateProfile(req.user!.id, { ...b, cnic });
  res.json(driverProfile(req.user!.id));
}));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 6 * 1024 * 1024, files: 1 } });
driverRouter.post('/documents', upload.single('file'), h((req, res) => {
  const type = z.string().parse(req.body?.type);
  if (!req.file) throw badRequest('No file received');
  saveDocument(req.user!.id, type, req.file.buffer);
  res.json(driverProfile(req.user!.id));
}));
driverRouter.post('/submit', h((req, res) => {
  submitForReview(req.user!.id);
  res.json(driverProfile(req.user!.id));
}));

driverRouter.post('/online', h((req, res) => {
  const b = z.object({ online: z.boolean(), location: latlng.optional() }).parse(req.body);
  setOnline(req.user!.id, b.online, b.location);
  res.json({ online: b.online, requests: b.online ? openRequestsForDriver(req.user!.id) : [] });
}));
driverRouter.post('/location', h((req, res) => {
  const b = latlng.extend({ heading: z.number().nullish() }).parse(req.body);
  updateLocation(req.user!.id, b);
  res.json({ ok: true });
}));
driverRouter.get('/requests', h((req, res) => res.json({ requests: openRequestsForDriver(req.user!.id) })));

driverRouter.post('/orders/:id/offer', h((req, res) => {
  const b = z.object({ price: z.number().int().positive().optional() }).parse(req.body ?? {});
  res.json({ offer: driverOffer(req.user!.id, id(req.params.id), b.price) });
}));
driverRouter.post('/orders/:id/skip', h((req, res) => {
  driverSkip(req.user!.id, id(req.params.id));
  res.json({ ok: true });
}));
driverRouter.get('/orders', h((req, res) => res.json({ orders: ordersForUser(req.user!.id, 'driver', 50) })));
driverRouter.get('/orders/:id', h((req, res) => {
  const o = getOrder(id(req.params.id));
  if (!o || o.driver_id !== req.user!.id) throw notFound('Ride not found');
  res.json({ order: orderDto(o, 'driver') });
}));
driverRouter.post('/orders/:id/arrived', h((req, res) => res.json({ order: driverArrived(req.user!.id, id(req.params.id)) })));
driverRouter.post('/orders/:id/start', h((req, res) => {
  const b = z.object({ pin: z.string().regex(/^\d{4}$/, 'The PIN has 4 digits') }).parse(req.body);
  res.json({ order: driverStart(req.user!.id, id(req.params.id), b.pin) });
}));
driverRouter.post('/orders/:id/complete', h((req, res) => res.json({ order: driverComplete(req.user!.id, id(req.params.id)) })));
driverRouter.post('/orders/:id/cash-confirm', h((req, res) => res.json({ order: driverCashConfirm(req.user!.id, id(req.params.id)) })));
driverRouter.post('/orders/:id/cancel', h((req, res) => {
  const b = z.object({ reason: z.string().trim().min(2).max(200) }).parse(req.body);
  res.json({ order: cancelByDriver(req.user!.id, id(req.params.id), b.reason) });
}));
driverRouter.post('/orders/:id/rate', h((req, res) => {
  const b = z.object({ rating: z.number().int().min(1).max(5) }).parse(req.body);
  res.json({ order: rateRider(req.user!.id, id(req.params.id), b.rating) });
}));
driverRouter.post('/orders/:id/sos', h((req, res) => {
  const b = z.object({ location: latlng.nullish() }).parse(req.body ?? {});
  res.json({ ok: true, sos: raiseSos(req.user!.id, 'driver', id(req.params.id), b.location ?? null) });
}));
driverRouter.get('/earnings', h((req, res) => res.json(driverEarnings(req.user!.id))));
