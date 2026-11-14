// Creates clearly-fake demo accounts so you can test the ride flow without registering drivers by hand.
// Run:  npm run seed:demo      (safe to run again; it skips accounts that already exist)
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { db, seedIfEmpty } from './db.js';
import { ensureDriverRow } from './drivers.js';
import { addLedger } from './orders.js';

if (config.isProd) throw new Error('Demo data is for local use only');
const seeded = seedIfEmpty();
if (seeded.adminEmail) {
  console.log(`\nAdmin account created.\n  Email:    ${seeded.adminEmail}\n  Password: ${seeded.adminPassword ?? '(from SEED_ADMIN_PASSWORD)'}\n`);
  if (seeded.adminPassword) {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(path.join(config.dataDir, 'first-admin.txt'), `${seeded.adminEmail}\n${seeded.adminPassword}\n`, { mode: 0o600 });
  }
}

const centre = { lat: 30.1667, lng: 72.65 };
const drivers: [string, string, string, string, string, string, number, number][] = [
  // phone, name, vehicle, plate, model, color, dLat, dLng
  ['+923000000001', 'Demo Driver Ahmed', 'mini', 'DEMO-101', 'Suzuki Cultus', 'White', 0.004, 0.003],
  ['+923000000002', 'Demo Driver Bilal', 'mini', 'DEMO-102', 'Toyota Vitz', 'Silver', -0.006, 0.005],
  ['+923000000003', 'Demo Driver Hamza', 'bike', 'DEMO-201', 'Honda CD70', 'Red', 0.002, -0.004],
  ['+923000000004', 'Demo Driver Usman', 'rickshaw', 'DEMO-301', 'Sazgar', 'Green', -0.003, -0.002],
  ['+923000000005', 'Demo Driver Saad', 'ac', 'DEMO-401', 'Honda City', 'Black', 0.007, -0.006],
];

for (const [phone, name, vehicle, plate, model, color, dLat, dLng] of drivers) {
  if (db.prepare("SELECT 1 FROM users WHERE phone=? AND role='driver'").get(phone)) {
    console.log('exists  ', phone);
    continue;
  }
  const id = Number(db.prepare("INSERT INTO users(phone,role,name,city_id,created_at) VALUES (?,'driver',?,1,?)").run(phone, name, Date.now()).lastInsertRowid);
  ensureDriverRow(id);
  db.prepare(
    "UPDATE drivers SET cnic=?, licence_no=?, vehicle_type=?, plate=?, model=?, color=?, year=2020, approval_status='approved', reviewed_at=?, lat=?, lng=?, loc_at=? WHERE user_id=?",
  ).run('00000-0000000-0', 'DEMO-LIC', vehicle, plate, model, color, Date.now(), centre.lat + dLat, centre.lng + dLng, Date.now(), id);
  addLedger(id, 'topup', 2000, null, 'Demo starting balance');
  console.log('created ', phone, name, vehicle);
}
if (!db.prepare("SELECT 1 FROM users WHERE phone='+923000000100' AND role='rider'").get()) {
  db.prepare("INSERT INTO users(phone,role,name,city_id,created_at) VALUES ('+923000000100','rider','Demo Rider',1,?)").run(Date.now());
  console.log('created  +923000000100 Demo Rider');
}
console.log('\nLog in with any of these numbers. OTP code (dev mode): ' + config.devOtpCode);
console.log('Demo drivers show as "online" only after they open the Driver app and tap Go online.');
