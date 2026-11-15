import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { hashPassword } from './password.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS cities(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL,
  radius_km REAL NOT NULL DEFAULT 25, active INTEGER NOT NULL DEFAULT 1);

CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, phone TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('rider','driver')),
  name TEXT, status TEXT NOT NULL DEFAULT 'active',
  rating_sum REAL NOT NULL DEFAULT 0, rating_count INTEGER NOT NULL DEFAULT 0,
  wallet INTEGER NOT NULL DEFAULT 0, city_id INTEGER, created_at INTEGER NOT NULL,
  UNIQUE(phone, role));

CREATE TABLE IF NOT EXISTS drivers(
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  cnic TEXT, licence_no TEXT, vehicle_type TEXT, plate TEXT, model TEXT, color TEXT, year INTEGER,
  approval_status TEXT NOT NULL DEFAULT 'incomplete', review_note TEXT, reviewed_by INTEGER, reviewed_at INTEGER,
  online INTEGER NOT NULL DEFAULT 0, lat REAL, lng REAL, heading REAL, loc_at INTEGER);

CREATE TABLE IF NOT EXISTS driver_documents(
  id INTEGER PRIMARY KEY, driver_id INTEGER NOT NULL REFERENCES drivers(user_id),
  type TEXT NOT NULL, file_key TEXT NOT NULL, mime TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', reason TEXT, uploaded_at INTEGER NOT NULL,
  UNIQUE(driver_id, type));

CREATE TABLE IF NOT EXISTS admins(
  id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL,
  role_key TEXT NOT NULL, city_id INTEGER, status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS otps(
  phone TEXT NOT NULL, role TEXT NOT NULL, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(phone, role));
CREATE TABLE IF NOT EXISTS otp_requests(phone TEXT NOT NULL, at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS fare_rules(
  city_id INTEGER NOT NULL, vehicle_type TEXT NOT NULL, base INTEGER NOT NULL, per_km INTEGER NOT NULL,
  per_min INTEGER NOT NULL, min_fare INTEGER NOT NULL, wait_per_min INTEGER NOT NULL, cancel_fee INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(city_id, vehicle_type));

CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS orders(
  id INTEGER PRIMARY KEY, service TEXT NOT NULL DEFAULT 'ride', city_id INTEGER NOT NULL,
  rider_id INTEGER NOT NULL REFERENCES users(id), driver_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL, vehicle_type TEXT NOT NULL,
  pickup_lat REAL NOT NULL, pickup_lng REAL NOT NULL, pickup_addr TEXT NOT NULL,
  drop_lat REAL NOT NULL, drop_lng REAL NOT NULL, drop_addr TEXT NOT NULL,
  distance_m INTEGER NOT NULL, duration_s INTEGER NOT NULL, route TEXT NOT NULL,
  est_fare INTEGER NOT NULL, offered_fare INTEGER NOT NULL, agreed_fare INTEGER,
  waiting_charge INTEGER NOT NULL DEFAULT 0, final_fare INTEGER, commission INTEGER, cancel_fee INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'cash', payment_status TEXT NOT NULL DEFAULT 'pending',
  pin TEXT NOT NULL, pin_attempts INTEGER NOT NULL DEFAULT 0, expires_at INTEGER,
  cancelled_by TEXT, cancel_reason TEXT, sos INTEGER NOT NULL DEFAULT 0,
  driver_rating INTEGER, driver_tags TEXT, driver_comment TEXT, rider_rating INTEGER,
  created_at INTEGER NOT NULL, accepted_at INTEGER, arrived_at INTEGER, started_at INTEGER, completed_at INTEGER,
  meta TEXT);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_rider ON orders(rider_id);
CREATE INDEX IF NOT EXISTS idx_orders_driver ON orders(driver_id);

CREATE TABLE IF NOT EXISTS offers(
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), driver_id INTEGER NOT NULL REFERENCES users(id),
  price INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL,
  UNIQUE(order_id, driver_id));
CREATE INDEX IF NOT EXISTS idx_offers_order ON offers(order_id);

CREATE TABLE IF NOT EXISTS order_events(
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, type TEXT NOT NULL, actor TEXT, data TEXT, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_events_order ON order_events(order_id);

CREATE TABLE IF NOT EXISTS ledger(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, kind TEXT NOT NULL, amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL, order_id INTEGER, note TEXT, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger(user_id);

CREATE TABLE IF NOT EXISTS sos_events(
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, user_id INTEGER NOT NULL, role TEXT NOT NULL,
  lat REAL, lng REAL, status TEXT NOT NULL DEFAULT 'open', at INTEGER NOT NULL, handled_by INTEGER, handled_at INTEGER);

CREATE TABLE IF NOT EXISTS audit_log(
  id INTEGER PRIMARY KEY, actor_type TEXT NOT NULL, actor_id INTEGER, actor_name TEXT,
  action TEXT NOT NULL, target TEXT, detail TEXT, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
`);

/** Adds a column to an existing database (older local test databases keep working). */
function addColumn(table: string, column: string, def: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
}
addColumn('users', 'avatar', 'TEXT');
addColumn('orders', 'booking_no', 'TEXT');
// Bookings made before booking numbers existed get one too.
db.exec(`UPDATE orders SET booking_no='SG-' || CASE service WHEN 'pickup' THEN 'PD' WHEN 'delivery' THEN 'DL' ELSE 'RD' END || '-' || substr('000000' || id, -6, 6) WHERE booking_no IS NULL`);
db.exec('CREATE INDEX IF NOT EXISTS idx_orders_booking ON orders(booking_no)');

export function audit(actorType: 'admin' | 'system' | 'security', actorId: number | null, actorName: string | null, action: string, target?: string, detail?: unknown) {
  db.prepare('INSERT INTO audit_log(actor_type,actor_id,actor_name,action,target,detail,at) VALUES (?,?,?,?,?,?,?)').run(
    actorType, actorId, actorName, action, target ?? null, detail === undefined ? null : JSON.stringify(detail), Date.now());
}

/** Idempotent first-run data: one city, fare rules, settings and (if none exist) a super admin. */
export function seedIfEmpty(): { adminPassword?: string; adminEmail?: string } {
  const out: { adminPassword?: string; adminEmail?: string } = {};
  if (!db.prepare('SELECT 1 FROM cities LIMIT 1').get()) {
    db.prepare('INSERT INTO cities(id,name,lat,lng,radius_km) VALUES (1,?,?,?,?)').run('Burewala', 30.1667, 72.65, 25);
  }
  if (!db.prepare('SELECT 1 FROM fare_rules LIMIT 1').get()) {
    const rules: [string, number, number, number, number, number, number][] = [
      // vehicle, base, per_km, per_min, min_fare, wait_per_min, cancel_fee
      ['bike', 50, 18, 3, 100, 2, 30],
      ['rickshaw', 80, 26, 4, 150, 3, 40],
      ['mini', 120, 38, 6, 250, 4, 60],
      ['ac', 160, 46, 7, 320, 5, 80],
      ['vip', 300, 70, 10, 600, 8, 150],
    ];
    const ins = db.prepare('INSERT INTO fare_rules(city_id,vehicle_type,base,per_km,per_min,min_fare,wait_per_min,cancel_fee) VALUES (1,?,?,?,?,?,?,?)');
    for (const r of rules) ins.run(...r);
  }
  if (!db.prepare('SELECT 1 FROM admins LIMIT 1').get()) {
    const email = config.seedAdmin.email;
    const password = config.seedAdmin.password ?? crypto.randomBytes(9).toString('base64url');
    db.prepare('INSERT INTO admins(email,name,password_hash,role_key,created_at) VALUES (?,?,?,?,?)').run(
      email, 'Super Admin', hashPassword(password), 'super_admin', Date.now());
    audit('system', null, 'system', 'admin.seeded', email);
    out.adminEmail = email;
    if (!config.seedAdmin.password) out.adminPassword = password;
  }
  return out;
}
