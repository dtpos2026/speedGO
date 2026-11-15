import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { DOC_TYPES, VEHICLE_TYPES } from '@speedgo/shared';
import { requireAdmin, signAdminToken } from '../auth.js';
import { config } from '../config.js';
import { audit, db } from '../db.js';
import { decideDriver, driverProfile, reviewDocument } from '../drivers.js';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../errors.js';
import { addLedger, getOrder, orderDto, type OrderRow } from '../orders.js';
import { hashPassword, verifyPassword } from '../password.js';
import { hasPerm, PERMISSIONS, roleByKey, ROLES } from '../rbac.js';
import { getSettings, updateSettings } from '../settings.js';
import { toAdmins, toDrivers, toUser } from '../bus.js';
import { h } from './app-routes.js';

export const adminRouter = Router();

const id = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw badRequest('Invalid id');
  return n;
};
const page = (q: Record<string, unknown>) => {
  const limit = Math.min(100, Math.max(1, Number(q.limit ?? 25)));
  const offset = Math.max(0, Number(q.offset ?? 0));
  return { limit, offset };
};
const like = (q: unknown) => `%${String(q ?? '').trim().replace(/[%_]/g, '')}%`;

// ---------- Login (public) ----------
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many sign-in attempts. Try again later.', code: 'RATE_LIMIT' } });

adminRouter.post('/login', loginLimiter, h((req, res) => {
  const b = z.object({ email: z.string().email(), password: z.string().min(1).max(200) }).parse(req.body);
  const a = db.prepare('SELECT * FROM admins WHERE email=?').get(b.email.toLowerCase()) as
    | { id: number; email: string; name: string; password_hash: string; role_key: string; status: string }
    | undefined;
  // Same message whether the email or the password is wrong.
  if (!a || a.status !== 'active' || !verifyPassword(b.password, a.password_hash)) {
    audit('security', a?.id ?? null, b.email, 'login.failed');
    throw unauthorized('Email or password is not correct', 'BAD_CREDENTIALS');
  }
  audit('admin', a.id, a.name, 'login');
  res.json({ token: signAdminToken(a), admin: adminDto(a.id) });
}));

function adminDto(adminId: number) {
  const a = db.prepare('SELECT id,email,name,role_key,city_id FROM admins WHERE id=?').get(adminId) as { id: number; email: string; name: string; role_key: string; city_id: number | null };
  const role = roleByKey(a.role_key)!;
  return { id: a.id, email: a.email, name: a.name, roleKey: a.role_key, roleLabel: role.label, cityId: a.city_id, permissions: role.perms };
}

adminRouter.get('/me', requireAdmin(), h((req, res) => res.json({ admin: adminDto(req.admin!.id) })));

// ---------- Overview & live ----------
adminRouter.get('/stats', requireAdmin('live:view'), h((_req, res) => {
  const startOfDay = (() => {
    const t = new Date(Date.now() + 5 * 3600_000);
    t.setUTCHours(0, 0, 0, 0);
    return t.getTime() - 5 * 3600_000;
  })();
  const one = <T,>(sql: string, ...args: unknown[]) => db.prepare(sql).get(...args) as T;
  const today = one<{ completed: number; gross: number; revenue: number; cancelled: number }>(
    `SELECT COALESCE(SUM(status='completed'),0) completed, COALESCE(SUM(CASE WHEN status='completed' THEN final_fare END),0) gross,
            COALESCE(SUM(CASE WHEN status='completed' THEN commission END),0) revenue, COALESCE(SUM(status='cancelled'),0) cancelled
     FROM orders WHERE created_at>=?`, startOfDay);
  res.json({
    activeRides: one<{ c: number }>("SELECT COUNT(*) c FROM orders WHERE status IN ('accepted','arrived','in_progress')").c,
    searching: one<{ c: number }>("SELECT COUNT(*) c FROM orders WHERE status='requested'").c,
    onlineDrivers: one<{ c: number }>('SELECT COUNT(*) c FROM drivers WHERE online=1').c,
    busyDrivers: one<{ c: number }>("SELECT COUNT(DISTINCT driver_id) c FROM orders WHERE status IN ('accepted','arrived','in_progress')").c,
    pendingApprovals: one<{ c: number }>("SELECT COUNT(*) c FROM drivers WHERE approval_status='pending'").c,
    totalRiders: one<{ c: number }>("SELECT COUNT(*) c FROM users WHERE role='rider'").c,
    totalDrivers: one<{ c: number }>("SELECT COUNT(*) c FROM users WHERE role='driver'").c,
    openSos: one<{ c: number }>("SELECT COUNT(*) c FROM sos_events WHERE status='open'").c,
    today,
  });
}));

adminRouter.get('/live', requireAdmin('live:view'), h((_req, res) => {
  const drivers = db.prepare(
    `SELECT u.id, u.name, u.avatar, d.vehicle_type vehicleType, d.plate, d.lat, d.lng, d.heading,
            EXISTS(SELECT 1 FROM orders o WHERE o.driver_id=u.id AND o.status IN ('accepted','arrived','in_progress')) busy
     FROM drivers d JOIN users u ON u.id=d.user_id WHERE d.online=1 AND d.lat IS NOT NULL`).all();
  const orders = db.prepare(
    `SELECT id,booking_no bookingNo,service,status,vehicle_type vehicleType,pickup_lat,pickup_lng,pickup_addr,drop_lat,drop_lng,drop_addr,driver_id driverId,offered_fare offeredFare,agreed_fare agreedFare,sos
     FROM orders WHERE status IN ('requested','accepted','arrived','in_progress') ORDER BY id DESC LIMIT 200`).all();
  res.json({ drivers, orders });
}));

// ---------- Drivers & verification ----------
adminRouter.get('/drivers', requireAdmin('drivers:view'), h((req, res) => {
  const { limit, offset } = page(req.query);
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const where = ['u.role=\'driver\''];
  const args: unknown[] = [];
  if (['incomplete', 'pending', 'approved', 'rejected'].includes(status)) { where.push('d.approval_status=?'); args.push(status); }
  if (req.query.q) { where.push('(u.name LIKE ? OR u.phone LIKE ? OR d.plate LIKE ?)'); args.push(like(req.query.q), like(req.query.q), like(req.query.q)); }
  if (req.admin!.cityId) { where.push('u.city_id=?'); args.push(req.admin!.cityId); }
  const rows = db.prepare(
    `SELECT u.id,u.name,u.avatar,u.phone,u.status,u.wallet,u.created_at createdAt,u.rating_sum,u.rating_count,d.vehicle_type vehicleType,d.plate,d.model,d.approval_status approvalStatus,d.online,
            (SELECT COUNT(*) FROM driver_documents x WHERE x.driver_id=u.id) docCount,
            (SELECT COUNT(*) FROM orders o WHERE o.driver_id=u.id AND o.status='completed') trips
     FROM users u JOIN drivers d ON d.user_id=u.id WHERE ${where.join(' AND ')} ORDER BY (d.approval_status='pending') DESC, u.id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset) as Record<string, unknown>[];
  const total = (db.prepare(`SELECT COUNT(*) c FROM users u JOIN drivers d ON d.user_id=u.id WHERE ${where.join(' AND ')}`).get(...args) as { c: number }).c;
  res.json({ drivers: rows, total });
}));

adminRouter.get('/drivers/:id', requireAdmin('drivers:view'), h((req, res) => {
  const driverId = id(req.params.id);
  if (!db.prepare("SELECT 1 FROM users WHERE id=? AND role='driver'").get(driverId)) throw notFound('Driver not found');
  const p = driverProfile(driverId);
  const docs = db.prepare('SELECT id,type,status,reason,uploaded_at uploadedAt FROM driver_documents WHERE driver_id=?').all(driverId);
  const stats = db.prepare("SELECT COUNT(*) trips, COALESCE(SUM(final_fare),0) gross, COALESCE(SUM(commission),0) commission FROM orders WHERE driver_id=? AND status='completed'").get(driverId);
  const dup = p.profile.cnic ? db.prepare('SELECT COUNT(*) c FROM drivers WHERE cnic=? AND user_id<>?').get(p.profile.cnic, driverId) as { c: number } : { c: 0 };
  res.json({ ...p, documents: docs, stats, duplicateCnic: dup.c > 0, requiredDocs: DOC_TYPES });
}));

// Documents are private: only staff with drivers:view can open them, and every open is logged.
adminRouter.get('/documents/:id/file', requireAdmin('drivers:view'), h((req, res) => {
  const doc = db.prepare('SELECT file_key,mime,driver_id,type FROM driver_documents WHERE id=?').get(id(req.params.id)) as { file_key: string; mime: string; driver_id: number; type: string } | undefined;
  if (!doc) throw notFound('Document not found');
  const file = path.join(config.uploadsDir, path.basename(doc.file_key));
  if (!fs.existsSync(file)) throw notFound('File is missing');
  audit('admin', req.admin!.id, req.admin!.name, 'document.viewed', `driver:${doc.driver_id}`, { type: doc.type });
  res.setHeader('Content-Type', doc.mime);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  fs.createReadStream(file).pipe(res);
}));

adminRouter.post('/documents/:id/review', requireAdmin('drivers:verify'), h((req, res) => {
  const b = z.object({ status: z.enum(['approved', 'rejected']), reason: z.string().max(300).optional() }).parse(req.body);
  reviewDocument(req.admin!.id, req.admin!.name, id(req.params.id), b.status, b.reason);
  res.json({ ok: true });
}));

adminRouter.post('/drivers/:id/decision', requireAdmin('drivers:verify'), h((req, res) => {
  const b = z.object({ decision: z.enum(['approve', 'reject', 'reupload']), note: z.string().max(300).optional() }).parse(req.body);
  decideDriver(req.admin!.id, req.admin!.name, id(req.params.id), b.decision, b.note);
  res.json({ ok: true, ...driverProfile(id(req.params.id)) });
}));

adminRouter.post('/drivers/:id/suspend', requireAdmin('drivers:manage'), h((req, res) => {
  const b = z.object({ suspended: z.boolean(), reason: z.string().max(200).optional() }).parse(req.body);
  const driverId = id(req.params.id);
  db.prepare("UPDATE users SET status=? WHERE id=? AND role='driver'").run(b.suspended ? 'blocked' : 'active', driverId);
  if (b.suspended) db.prepare('UPDATE drivers SET online=0 WHERE user_id=?').run(driverId);
  audit('admin', req.admin!.id, req.admin!.name, b.suspended ? 'driver.suspended' : 'driver.reinstated', `driver:${driverId}`, { reason: b.reason });
  toUser(driverId, 'driver:status', { suspended: b.suspended });
  res.json({ ok: true });
}));

adminRouter.post('/drivers/:id/wallet', requireAdmin('finance:manage'), h((req, res) => {
  const b = z.object({ amount: z.number().int().refine((n) => n !== 0 && Math.abs(n) <= 100_000, 'Amount must be between -100,000 and 100,000'), note: z.string().trim().min(3).max(120) }).parse(req.body);
  const driverId = id(req.params.id);
  if (!db.prepare("SELECT 1 FROM users WHERE id=? AND role='driver'").get(driverId)) throw notFound('Driver not found');
  const bal = addLedger(driverId, b.amount > 0 ? 'topup' : 'adjustment', b.amount, null, `${b.note} (by ${req.admin!.name})`);
  audit('admin', req.admin!.id, req.admin!.name, 'wallet.adjusted', `driver:${driverId}`, { amount: b.amount, note: b.note, balance: bal });
  res.json({ ok: true, wallet: bal });
}));

// ---------- Customers ----------
adminRouter.get('/customers', requireAdmin('customers:view'), h((req, res) => {
  const { limit, offset } = page(req.query);
  const where = ["u.role='rider'"];
  const args: unknown[] = [];
  if (req.query.q) { where.push('(u.name LIKE ? OR u.phone LIKE ?)'); args.push(like(req.query.q), like(req.query.q)); }
  const rows = db.prepare(
    `SELECT u.id,u.name,u.avatar,u.phone,u.status,u.created_at createdAt,u.rating_sum,u.rating_count,
            (SELECT COUNT(*) FROM orders o WHERE o.rider_id=u.id AND o.status='completed') trips,
            (SELECT COUNT(*) FROM orders o WHERE o.rider_id=u.id AND o.status='cancelled') cancelled
     FROM users u WHERE ${where.join(' AND ')} ORDER BY u.id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
  res.json({ customers: rows, total: (db.prepare(`SELECT COUNT(*) c FROM users u WHERE ${where.join(' AND ')}`).get(...args) as { c: number }).c });
}));
adminRouter.post('/customers/:id/status', requireAdmin('customers:manage'), h((req, res) => {
  const b = z.object({ blocked: z.boolean(), reason: z.string().max(200).optional() }).parse(req.body);
  const uid = id(req.params.id);
  db.prepare("UPDATE users SET status=? WHERE id=? AND role='rider'").run(b.blocked ? 'blocked' : 'active', uid);
  audit('admin', req.admin!.id, req.admin!.name, b.blocked ? 'customer.blocked' : 'customer.unblocked', `rider:${uid}`, { reason: b.reason });
  res.json({ ok: true });
}));

// ---------- Rides ----------
adminRouter.get('/orders', requireAdmin('rides:view'), h((req, res) => {
  const { limit, offset } = page(req.query);
  const where: string[] = [];
  const args: unknown[] = [];
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const service = typeof req.query.service === 'string' ? req.query.service : '';
  if (['ride', 'pickup', 'delivery'].includes(service)) { where.push('o.service=?'); args.push(service); }
  if (status === 'active') where.push("o.status IN ('requested','accepted','arrived','in_progress')");
  else if (status) { where.push('o.status=?'); args.push(status); }
  if (req.query.q) { where.push('(r.name LIKE ? OR r.phone LIKE ? OR dr.name LIKE ? OR o.pickup_addr LIKE ? OR o.drop_addr LIKE ? OR CAST(o.id AS TEXT)=? OR o.booking_no LIKE ?)'); const q = like(req.query.q); args.push(q, q, q, q, q, String(req.query.q).trim(), q); }
  if (req.admin!.cityId) { where.push('o.city_id=?'); args.push(req.admin!.cityId); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = db.prepare(
    `SELECT o.id,o.booking_no bookingNo,o.service,o.meta,o.status,o.vehicle_type vehicleType,o.pickup_addr pickup,o.drop_addr \`drop\`,o.distance_m distanceM,o.offered_fare offeredFare,o.agreed_fare agreedFare,o.final_fare finalFare,o.commission,
            o.payment_status paymentStatus,o.created_at createdAt,o.sos,r.name riderName,r.avatar riderAvatar,r.phone riderPhone,dr.name driverName,dr.avatar driverAvatar
     FROM orders o JOIN users r ON r.id=o.rider_id LEFT JOIN users dr ON dr.id=o.driver_id ${w} ORDER BY o.id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
  const total = (db.prepare(`SELECT COUNT(*) c FROM orders o JOIN users r ON r.id=o.rider_id LEFT JOIN users dr ON dr.id=o.driver_id ${w}`).get(...args) as { c: number }).c;
  res.json({ orders: rows, total });
}));
adminRouter.get('/orders/:id', requireAdmin('rides:view'), h((req, res) => {
  const o = getOrder(id(req.params.id));
  if (!o) throw notFound('Ride not found');
  const events = db.prepare('SELECT type,actor,data,at FROM order_events WHERE order_id=? ORDER BY id').all(o.id);
  res.json({ order: orderDto(o, 'admin'), events });
}));
adminRouter.post('/orders/:id/cancel', requireAdmin('rides:manage'), h((req, res) => {
  const b = z.object({ reason: z.string().trim().min(3).max(200) }).parse(req.body);
  const o = getOrder(id(req.params.id)) as OrderRow | undefined;
  if (!o) throw notFound('Ride not found');
  if (!['requested', 'accepted', 'arrived', 'in_progress'].includes(o.status)) throw conflict('This ride is already finished', 'BAD_STATE');
  db.prepare("UPDATE orders SET status='cancelled', cancelled_by='admin', cancel_reason=?, expires_at=NULL WHERE id=?").run(b.reason, o.id);
  db.prepare("UPDATE offers SET status='expired' WHERE order_id=? AND status='pending'").run(o.id);
  db.prepare('INSERT INTO order_events(order_id,type,actor,data,at) VALUES (?,?,?,?,?)').run(o.id, 'cancelled', `admin:${req.admin!.id}`, JSON.stringify(b), Date.now());
  audit('admin', req.admin!.id, req.admin!.name, 'order.cancelled', `order:${o.id}`, b);
  const n = getOrder(o.id)!;
  toUser(n.rider_id, 'order:update', orderDto(n, 'rider'));
  if (n.driver_id) toUser(n.driver_id, 'order:update', orderDto(n, 'driver'));
  toDrivers('order:gone', { id: o.id });
  toAdmins('live:order', { id: n.id, status: n.status });
  res.json({ ok: true });
}));

// ---------- Support & safety ----------
adminRouter.get('/sos', requireAdmin('support:manage'), h((_req, res) => {
  const rows = db.prepare(
    `SELECT s.id,s.order_id orderId,s.role,s.lat,s.lng,s.status,s.at,u.name,u.phone FROM sos_events s JOIN users u ON u.id=s.user_id ORDER BY (s.status='open') DESC, s.id DESC LIMIT 100`).all();
  res.json({ sos: rows });
}));
adminRouter.post('/sos/:id/resolve', requireAdmin('support:manage'), h((req, res) => {
  const b = z.object({ note: z.string().max(300).optional() }).parse(req.body ?? {});
  db.prepare("UPDATE sos_events SET status='resolved', handled_by=?, handled_at=? WHERE id=?").run(req.admin!.id, Date.now(), id(req.params.id));
  audit('admin', req.admin!.id, req.admin!.name, 'sos.resolved', `sos:${req.params.id}`, b);
  res.json({ ok: true });
}));

// ---------- Pricing & settings ----------
adminRouter.get('/pricing', requireAdmin('pricing:view'), h((_req, res) => {
  const rules = db.prepare('SELECT vehicle_type vehicleType,base,per_km perKm,per_min perMin,min_fare minFare,wait_per_min waitPerMin,cancel_fee cancelFee,active FROM fare_rules WHERE city_id=1').all();
  res.json({ rules, settings: getSettings() });
}));
const ruleSchema = z.object({
  vehicleType: z.enum(VEHICLE_TYPES),
  base: z.number().int().min(0).max(5000), perKm: z.number().int().min(0).max(500), perMin: z.number().int().min(0).max(100),
  minFare: z.number().int().min(0).max(10000), waitPerMin: z.number().int().min(0).max(100), cancelFee: z.number().int().min(0).max(2000),
  active: z.number().int().min(0).max(1).default(1),
});
adminRouter.put('/pricing', requireAdmin('pricing:manage'), h((req, res) => {
  const b = z.object({
    rules: z.array(ruleSchema).optional(),
    settings: z.object({
      commission_pct: z.number().min(0).max(50), min_wallet: z.number().int().min(0).max(100_000), offer_min_pct: z.number().min(0).max(50), offer_max_pct: z.number().min(0).max(100),
      counter_max_pct: z.number().min(0).max(100), dispatch_radius_km: z.number().min(0.5).max(30), request_ttl_s: z.number().int().min(20).max(600),
      free_wait_min: z.number().min(0).max(30), cancel_grace_min: z.number().min(0).max(30),
      peak_rules: z.array(z.object({ name: z.string().max(40), days: z.array(z.number().int().min(0).max(6)), from: z.string().regex(/^\d\d:\d\d$/), to: z.string().regex(/^\d\d:\d\d$/), mult: z.number().min(1).max(3) })).max(10),
    }).partial().optional(),
  }).parse(req.body);
  db.transaction(() => {
    for (const r of b.rules ?? []) {
      db.prepare('UPDATE fare_rules SET base=?,per_km=?,per_min=?,min_fare=?,wait_per_min=?,cancel_fee=?,active=? WHERE city_id=1 AND vehicle_type=?').run(r.base, r.perKm, r.perMin, r.minFare, r.waitPerMin, r.cancelFee, r.active, r.vehicleType);
    }
    if (b.settings) updateSettings(b.settings);
  })();
  audit('admin', req.admin!.id, req.admin!.name, 'pricing.updated', 'city:1', b);
  res.json({ ok: true });
}));

// ---------- Roles, staff, audit ----------
adminRouter.get('/roles', requireAdmin(), h((_req, res) => res.json({ roles: ROLES, permissions: PERMISSIONS })));
adminRouter.get('/admins', requireAdmin('roles:manage'), h((_req, res) => {
  res.json({ admins: db.prepare('SELECT id,email,name,role_key roleKey,city_id cityId,status,created_at createdAt FROM admins ORDER BY id').all() });
}));
adminRouter.post('/admins', requireAdmin('roles:manage'), h((req, res) => {
  const b = z.object({
    email: z.string().email(), name: z.string().trim().min(2).max(60), roleKey: z.string(),
    password: z.string().min(10, 'Use at least 10 characters').max(100),
  }).parse(req.body);
  if (!roleByKey(b.roleKey)) throw badRequest('Unknown role');
  // Only a Super Admin may create another Super Admin or Business Owner.
  if (['super_admin', 'business_owner'].includes(b.roleKey) && req.admin!.roleKey !== 'super_admin') throw forbidden('Only a Super Admin can create this role');
  if (db.prepare('SELECT 1 FROM admins WHERE email=?').get(b.email.toLowerCase())) throw conflict('An admin with this email already exists');
  const info = db.prepare('INSERT INTO admins(email,name,password_hash,role_key,created_at) VALUES (?,?,?,?,?)').run(b.email.toLowerCase(), b.name, hashPassword(b.password), b.roleKey, Date.now());
  audit('admin', req.admin!.id, req.admin!.name, 'admin.created', `admin:${info.lastInsertRowid}`, { email: b.email, role: b.roleKey });
  res.status(201).json({ ok: true, id: Number(info.lastInsertRowid) });
}));
adminRouter.post('/admins/:id/status', requireAdmin('roles:manage'), h((req, res) => {
  const b = z.object({ active: z.boolean() }).parse(req.body);
  const target = id(req.params.id);
  if (target === req.admin!.id) throw conflict('You cannot disable your own account');
  db.prepare('UPDATE admins SET status=? WHERE id=?').run(b.active ? 'active' : 'disabled', target);
  audit('admin', req.admin!.id, req.admin!.name, b.active ? 'admin.enabled' : 'admin.disabled', `admin:${target}`);
  res.json({ ok: true });
}));
adminRouter.get('/audit', requireAdmin('audit:view'), h((req, res) => {
  const { limit, offset } = page(req.query);
  const rows = db.prepare('SELECT id,actor_type actorType,actor_name actorName,action,target,detail,at FROM audit_log ORDER BY id DESC LIMIT ? OFFSET ?').all(limit, offset);
  res.json({ entries: rows, total: (db.prepare('SELECT COUNT(*) c FROM audit_log').get() as { c: number }).c });
}));

// ---------- Management dashboard (aggregates only, no personal data) ----------
adminRouter.get('/exec', requireAdmin('exec:view'), h((req, res) => {
  const days = Math.min(180, Math.max(1, Number(req.query.days ?? 30)));
  const since = Date.now() - days * 86_400_000;
  const tz = 5 * 3600;
  const totals = db.prepare(
    `SELECT COALESCE(SUM(status='completed'),0) rides, COALESCE(SUM(status='cancelled'),0) cancelled, COALESCE(SUM(status='no_driver'),0) unmatched,
            COALESCE(SUM(CASE WHEN status='completed' THEN final_fare END),0) gross, COALESCE(SUM(CASE WHEN status='completed' THEN commission END),0) revenue
     FROM orders WHERE created_at>=?`).get(since) as { rides: number; cancelled: number; unmatched: number; gross: number; revenue: number };
  const daily = db.prepare(
    `SELECT strftime('%Y-%m-%d', created_at/1000 + ?, 'unixepoch') day, SUM(status='completed') rides, COALESCE(SUM(CASE WHEN status='completed' THEN final_fare END),0) gross,
            COALESCE(SUM(CASE WHEN status='completed' THEN commission END),0) revenue
     FROM orders WHERE created_at>=? GROUP BY day ORDER BY day`).all(tz, since);
  const byHour = db.prepare(
    `SELECT CAST(strftime('%H', created_at/1000 + ?, 'unixepoch') AS INTEGER) hour, COUNT(*) requests, SUM(status='completed') completed
     FROM orders WHERE created_at>=? GROUP BY hour ORDER BY hour`).all(tz, since);
  const byVehicle = db.prepare(
    `SELECT vehicle_type vehicleType, COUNT(*) rides, COALESCE(SUM(final_fare),0) gross FROM orders WHERE created_at>=? AND status='completed' GROUP BY vehicle_type`).all(since);
  const newRiders = (db.prepare("SELECT COUNT(*) c FROM users WHERE role='rider' AND created_at>=?").get(since) as { c: number }).c;
  const newDrivers = (db.prepare("SELECT COUNT(*) c FROM users WHERE role='driver' AND created_at>=?").get(since) as { c: number }).c;
  const repeat = (db.prepare("SELECT COUNT(*) c FROM (SELECT rider_id FROM orders WHERE status='completed' AND created_at>=? GROUP BY rider_id HAVING COUNT(*)>=2)").get(since) as { c: number }).c;
  const riders = (db.prepare("SELECT COUNT(DISTINCT rider_id) c FROM orders WHERE status='completed' AND created_at>=?").get(since) as { c: number }).c;
  res.json({
    days, totals: { ...totals, avgFare: totals.rides ? Math.round(totals.gross / totals.rides) : 0, takeRate: totals.gross ? Math.round((totals.revenue / totals.gross) * 100) : 0, fillRate: totals.rides + totals.unmatched ? Math.round((totals.rides / (totals.rides + totals.unmatched + totals.cancelled)) * 100) : 0 },
    daily, byHour, byVehicle, growth: { newRiders, newDrivers, repeatRiders: repeat, activeRiders: riders, repeatRate: riders ? Math.round((repeat / riders) * 100) : 0 },
  });
}));

export { hasPerm };
