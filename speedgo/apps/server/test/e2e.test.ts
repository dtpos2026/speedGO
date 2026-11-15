// End-to-end test of the whole Phase 1 ride flow against a real server (temp database, no network needed).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import { io as ioc, type Socket } from 'socket.io-client';

process.env.SPEEDGO_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'speedgo-test-'));
process.env.ROUTING = 'off'; // straight-line estimates, so the test needs no internet
process.env.GEOCODER = 'off';
process.env.SEED_ADMIN_EMAIL = 'root@test.local';
process.env.SEED_ADMIN_PASSWORD = 'correct-horse-battery';

const { createApp } = await import('../src/app.js');

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

let base = '';
let stop: () => void;
const sockets: Socket[] = [];

async function api(method: string, url: string, token?: string, body?: unknown, expect = 200) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, any>;
  assert.equal(res.status, expect, `${method} ${url} expected ${expect}, got ${res.status}: ${JSON.stringify(json)}`);
  return json;
}
async function login(role: 'rider' | 'driver', phone: string, name: string) {
  const r = await api('POST', '/api/auth/otp/request', undefined, { phone, role });
  assert.equal(r.devCode, '123456');
  const v = await api('POST', '/api/auth/otp/verify', undefined, { phone, role, code: '123456', name });
  return { token: v.token as string, user: v.user };
}
async function adminLogin(email: string, password: string) {
  return (await api('POST', '/api/admin/login', undefined, { email, password })).token as string;
}
function connect(token: string, kind: 'user' | 'admin' = 'user'): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = ioc(base, { auth: { token, kind }, transports: ['websocket'], forceNew: true });
    sockets.push(s);
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}
const waitFor = <T,>(s: Socket, ev: string, pred: (x: T) => boolean = () => true, ms = 3000) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${ev}`)), ms);
    s.on(ev, (x: T) => {
      if (pred(x)) {
        clearTimeout(t);
        resolve(x);
      }
    });
  });

// Burewala city centre and two nearby points
const PICKUP = { lat: 30.1667, lng: 72.65, addr: 'Model Town, Burewala' };
const DROP = { lat: 30.18, lng: 72.67, addr: 'Rail Bazaar, Burewala' };

before(async () => {
  const { server, stop: s } = createApp();
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  stop = s;
});
after(() => {
  sockets.forEach((s) => s.close());
  stop();
  fs.rmSync(process.env.SPEEDGO_DATA_DIR!, { recursive: true, force: true });
});

let adminToken = '';
let estimate = 0;
let driver: { token: string; user: any };
let rider: { token: string; user: any };

describe('auth', () => {
  it('normalizes Pakistani numbers and rejects bad ones', async () => {
    const ok = await api('POST', '/api/auth/otp/request', undefined, { phone: '0300 1234567', role: 'rider' });
    assert.equal(ok.phone, '+923001234567');
    await api('POST', '/api/auth/otp/request', undefined, { phone: '12345', role: 'rider' }, 400);
  });
  it('rejects a wrong OTP and locks after 5 tries', async () => {
    await api('POST', '/api/auth/otp/request', undefined, { phone: '03111111111', role: 'rider' });
    for (let i = 0; i < 5; i++) await api('POST', '/api/auth/otp/verify', undefined, { phone: '03111111111', role: 'rider', code: '000000' }, 400);
    await api('POST', '/api/auth/otp/verify', undefined, { phone: '03111111111', role: 'rider', code: '123456' }, 429);
  });
  it('admin login works and wrong password fails', async () => {
    adminToken = await adminLogin('root@test.local', 'correct-horse-battery');
    await api('POST', '/api/admin/login', undefined, { email: 'root@test.local', password: 'nope' }, 401);
  });
  it('a rider token cannot use driver or admin APIs', async () => {
    const r = await login('rider', '03001110001', 'Cross Check');
    await api('GET', '/api/driver/me', r.token, undefined, 403);
    await api('GET', '/api/admin/stats', r.token, undefined, 401);
  });
});

describe('driver onboarding and approval', () => {
  it('driver registers, uploads documents and cannot go online before approval', async () => {
    driver = await login('driver', '03002220001', 'Ahmed Khan');
    await api('PUT', '/api/driver/profile', driver.token, { name: 'Ahmed Khan', cnic: '3520212345671', licenceNo: 'LHR-19-04421', vehicleType: 'mini', plate: 'leb-1234', model: 'Suzuki Cultus', color: 'White', year: 2019 });
    await api('PUT', '/api/driver/profile', driver.token, { name: 'Ahmed Khan', cnic: '123', licenceNo: 'LHR-19-04421', vehicleType: 'mini', plate: 'LEB-1234', model: 'Suzuki Cultus', color: 'White', year: 2019 }, 400);
    await api('POST', '/api/driver/submit', driver.token, {}, 400); // docs missing
    for (const type of ['profile_photo', 'cnic_front', 'cnic_back', 'cnic_selfie', 'licence_front', 'licence_back', 'vehicle_reg_front', 'vehicle_photo']) {
      const fd = new FormData();
      fd.append('type', type);
      fd.append('file', new Blob([PNG], { type: 'image/png' }), 'x.png');
      const res = await fetch(base + '/api/driver/documents', { method: 'POST', headers: { Authorization: `Bearer ${driver.token}` }, body: fd });
      assert.equal(res.status, 200, await res.text());
    }
    // a non-image disguised as a photo is refused
    const bad = new FormData();
    bad.append('type', 'cnic_front');
    bad.append('file', new Blob(['<script>alert(1)</script>'], { type: 'image/png' }), 'x.png');
    assert.equal((await fetch(base + '/api/driver/documents', { method: 'POST', headers: { Authorization: `Bearer ${driver.token}` }, body: bad })).status, 400);
    const sub = await api('POST', '/api/driver/submit', driver.token, {});
    assert.equal(sub.approvalStatus, 'pending');
    await api('POST', '/api/driver/online', driver.token, { online: true, location: PICKUP }, 403);
  });

  it('verification officer can review documents but not touch pricing or wallets', async () => {
    await api('POST', '/api/admin/admins', adminToken, { email: 'verify@test.local', name: 'Vera Officer', roleKey: 'verification_officer', password: 'a-long-password-1' }, 201);
    const vt = await adminLogin('verify@test.local', 'a-long-password-1');
    await api('GET', '/api/admin/pricing', vt, undefined, 403);
    await api('POST', `/api/admin/drivers/${driver.user.id}/wallet`, vt, { amount: 1000, note: 'sneaky topup' }, 403);
    await api('GET', '/api/admin/stats', vt, undefined, 403);
    const d = await api('GET', `/api/admin/drivers/${driver.user.id}`, vt);
    assert.equal(d.documents.length, 8);
    // reject one document with a reason, driver must re-upload, then approve
    const doc = d.documents[0];
    await api('POST', `/api/admin/documents/${doc.id}/review`, vt, { status: 'rejected' }, 400); // reason required
    await api('POST', `/api/admin/documents/${doc.id}/review`, vt, { status: 'rejected', reason: 'Photo is blurry' });
    await api('POST', `/api/admin/drivers/${driver.user.id}/decision`, vt, { decision: 'approve' }, 400);
    const fd = new FormData();
    fd.append('type', doc.type);
    fd.append('file', new Blob([PNG], { type: 'image/png' }), 'x.png');
    await fetch(base + '/api/driver/documents', { method: 'POST', headers: { Authorization: `Bearer ${driver.token}` }, body: fd });
    const res = await fetch(base + `/api/admin/documents/${doc.id}/file`, { headers: { Authorization: `Bearer ${vt}` } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.equal((await fetch(base + `/api/admin/documents/${doc.id}/file`)).status, 401); // no token, no document
    await api('POST', `/api/admin/drivers/${driver.user.id}/decision`, vt, { decision: 'approve' });
    const audit = await api('GET', '/api/admin/audit', adminToken);
    assert.ok(audit.entries.some((e: any) => e.action === 'permission.denied'), 'denied attempts are logged');
    assert.ok(audit.entries.some((e: any) => e.action === 'driver.approve'));
  });
});

describe('ride flow: request, offers, accept, PIN, complete, cash', () => {
  let driverSock: Socket;
  let riderSock: Socket;
  let orderId = 0;

  it('approved driver goes online and gets a socket connection', async () => {
    driverSock = await connect(driver.token);
    const on = await api('POST', '/api/driver/online', driver.token, { online: true, location: { lat: 30.167, lng: 72.651 } });
    assert.equal(on.online, true);
    rider = await login('rider', '03003330001', 'Ayesha Siddiqui');
    riderSock = await connect(rider.token);
  });

  it('estimate returns all vehicle types with offer bounds', async () => {
    const e = await api('POST', '/api/rider/estimate', rider.token, { pickup: PICKUP, drop: DROP });
    assert.equal(e.estimates.length, 5);
    const mini = e.estimates.find((x: any) => x.vehicleType === 'mini');
    estimate = mini.fare;
    assert.ok(mini.minOffer < mini.fare && mini.fare < mini.maxOffer);
    await api('POST', '/api/rider/estimate', rider.token, { pickup: { lat: 31.5, lng: 74.3 }, drop: DROP }, 400); // Lahore: outside Burewala
  });

  it('rejects out-of-range offers and creates a valid request that reaches the driver', async () => {
    await api('POST', '/api/rider/orders', rider.token, { vehicleType: 'mini', pickup: PICKUP, drop: DROP, offeredFare: 10 }, 422);
    const gotRequest = waitFor<any>(driverSock, 'order:new');
    const r = await api('POST', '/api/rider/orders', rider.token, { vehicleType: 'mini', pickup: PICKUP, drop: DROP, offeredFare: estimate }, 201);
    orderId = r.order.id;
    assert.equal(r.order.status, 'requested');
    assert.match(r.order.pin, /^\d{4}$/);
    const req = await gotRequest;
    assert.equal(req.id, orderId);
    assert.equal(req.offeredFare, estimate);
    assert.equal(req.riderName, 'Ayesha Siddiqui');
    assert.equal('pin' in req, false, 'drivers never receive the PIN');
    assert.equal('riderPhone' in req, false, 'drivers do not get the rider phone before accepting');
    await api('POST', '/api/rider/orders', rider.token, { vehicleType: 'mini', pickup: PICKUP, drop: DROP, offeredFare: estimate }, 409); // one active ride at a time
  });

  it('driver counter-offers, rider sees it live and accepts', async () => {
    const counter = estimate + 30;
    const seen = waitFor<any>(riderSock, 'offer:new');
    await api('POST', `/api/driver/orders/${orderId}/offer`, driver.token, { price: counter });
    const offer = await seen;
    assert.equal(offer.price, counter);
    assert.equal(offer.matchesOffer, false);
    assert.equal(offer.driver.name, 'Ahmed Khan');
    assert.equal(offer.driver.vehicle.plate, 'LEB-1234');
    await api('POST', `/api/driver/orders/${orderId}/offer`, driver.token, { price: estimate * 5 }, 422); // absurd counter
    const updated = waitFor<any>(driverSock, 'order:update', (o) => o.status === 'accepted');
    const acc = await api('POST', `/api/rider/orders/${orderId}/accept-offer`, rider.token, { offerId: offer.id });
    assert.equal(acc.order.status, 'accepted');
    assert.equal(acc.order.agreedFare, counter);
    assert.equal(acc.order.driver.name, 'Ahmed Khan');
    const d = await updated;
    assert.equal('pin' in d, false);
    assert.equal(d.rider.phone, '+923003330001'); // revealed once accepted
    await api('POST', `/api/rider/orders/${orderId}/accept-offer`, rider.token, { offerId: offer.id }, 409); // cannot double-accept
  });

  it('driver location streams to the rider during the ride', async () => {
    const loc = waitFor<any>(riderSock, 'driver:location', (x) => x.orderId === orderId);
    driverSock.emit('driver:location', { lat: 30.1668, lng: 72.6502, heading: 45 });
    const p = await loc;
    assert.equal(p.lat, 30.1668);
  });

  it('start needs arrival first, then the correct PIN', async () => {
    await api('POST', `/api/driver/orders/${orderId}/start`, driver.token, { pin: '0000' }, 409);
    await api('POST', `/api/driver/orders/${orderId}/arrived`, driver.token, {});
    const ride = await api('GET', `/api/rider/orders/${orderId}`, rider.token);
    const pin = ride.order.pin as string;
    const wrong = pin === '1234' ? '4321' : '1234';
    await api('POST', `/api/driver/orders/${orderId}/start`, driver.token, { pin: wrong }, 400);
    const started = await api('POST', `/api/driver/orders/${orderId}/start`, driver.token, { pin });
    assert.equal(started.order.status, 'in_progress');
    assert.equal(started.order.pin, undefined);
  });

  it('SOS reaches the admin live channel', async () => {
    const admin = await connect(adminToken, 'admin');
    const got = waitFor<any>(admin, 'sos:new');
    await api('POST', `/api/rider/orders/${orderId}/sos`, rider.token, { location: { lat: 30.17, lng: 72.66 } });
    assert.equal((await got).orderId, orderId);
    const list = await api('GET', '/api/admin/sos', adminToken);
    assert.equal(list.sos[0].status, 'open');
    await api('POST', `/api/admin/sos/${list.sos[0].id}/resolve`, adminToken, { note: 'Called both, all fine' });
  });

  it('complete books commission; cash confirm marks paid; ratings update', async () => {
    const done = await api('POST', `/api/driver/orders/${orderId}/complete`, driver.token, {});
    assert.equal(done.order.status, 'completed');
    assert.equal(done.order.finalFare, estimate + 30);
    assert.equal(done.order.commission, Math.round((estimate + 30) * 0.2));
    const paid = await api('POST', `/api/driver/orders/${orderId}/cash-confirm`, driver.token, {});
    assert.equal(paid.order.paymentStatus, 'paid');
    const me = await api('GET', '/api/driver/me', driver.token);
    assert.equal(me.user.wallet, -Math.round((estimate + 30) * 0.2), 'commission was taken from the wallet');
    await api('POST', `/api/rider/orders/${orderId}/rate`, rider.token, { rating: 5, tags: ['Clean car'] });
    await api('POST', `/api/rider/orders/${orderId}/rate`, rider.token, { rating: 1 }, 409);
    await api('POST', `/api/driver/orders/${orderId}/rate`, driver.token, { rating: 4 });
    const after = await api('GET', '/api/driver/me', driver.token);
    assert.equal(after.user.rating, 5);
    const earn = await api('GET', '/api/driver/earnings', driver.token);
    assert.equal(earn.today.trips, 1);
    assert.equal(earn.today.net, estimate + 30 - Math.round((estimate + 30) * 0.2));
  });

  it('admin sees the ride in stats, history and the management dashboard', async () => {
    const stats = await api('GET', '/api/admin/stats', adminToken);
    assert.equal(stats.today.completed, 1);
    assert.equal(stats.onlineDrivers, 1);
    const orders = await api('GET', '/api/admin/orders?status=completed', adminToken);
    assert.equal(orders.total, 1);
    const detail = await api('GET', `/api/admin/orders/${orderId}`, adminToken);
    assert.ok(detail.events.length >= 6);
    const exec = await api('GET', '/api/admin/exec?days=7', adminToken);
    assert.equal(exec.totals.rides, 1);
  });
});

describe('cancellation, expiry and blocking', () => {
  it('rider can cancel while searching; driver gets order:gone', async () => {
    const t = await login('rider', '03003330002', 'Second Rider');
    const dsock = await connect(driver.token);
    const gone = waitFor<any>(dsock, 'order:gone');
    const r = await api('POST', '/api/rider/orders', t.token, { vehicleType: 'mini', pickup: PICKUP, drop: DROP, offeredFare: estimate }, 201);
    await api('POST', `/api/rider/orders/${r.order.id}/cancel`, t.token, { reason: 'Found another ride' });
    assert.equal((await gone).id, r.order.id);
  });

  it('a request nobody answers expires into no_driver', async () => {
    const t = await login('rider', '03003330003', 'Third Rider');
    const est = await api('POST', '/api/rider/estimate', t.token, { pickup: PICKUP, drop: DROP });
    const vip = est.estimates.find((x: any) => x.vehicleType === 'vip'); // no vip driver is online
    const r = await api('POST', '/api/rider/orders', t.token, { vehicleType: 'vip', pickup: PICKUP, drop: DROP, offeredFare: vip.fare }, 201);
    // make the request overdue, then run the sweeper (it runs every 5 s in the real server)
    const { db } = await import('../src/db.js');
    db.prepare('UPDATE orders SET expires_at=? WHERE id=?').run(Date.now() - 1000, r.order.id);
    const { sweep } = await import('../src/orders.js');
    sweep();
    const o = await api('GET', `/api/rider/orders/${r.order.id}`, t.token);
    assert.equal(o.order.status, 'no_driver');
  });

  it('a blocked rider is refused immediately', async () => {
    const t = await login('rider', '03003330004', 'To Be Blocked');
    await api('GET', '/api/rider/me', t.token);
    await api('POST', `/api/admin/customers/${t.user.id}/status`, adminToken, { blocked: true, reason: 'abuse' });
    await api('GET', '/api/rider/me', t.token, undefined, 403);
  });

  it('driver below the minimum wallet cannot go online', async () => {
    await api('PUT', '/api/admin/pricing', adminToken, { settings: { min_wallet: 500 } });
    await api('POST', '/api/driver/online', driver.token, { online: false });
    await api('POST', '/api/driver/online', driver.token, { online: true, location: PICKUP }, 403);
    await api('POST', `/api/admin/drivers/${driver.user.id}/wallet`, adminToken, { amount: 2000, note: 'Initial top-up' });
    await api('POST', '/api/driver/online', driver.token, { online: true, location: PICKUP });
  });
});

describe('profile photo, pick & drop and delivery', () => {
  let cust: { token: string; user: any };
  it('customer uploads a profile photo; it is served; bad files are refused', async () => {
    cust = await login('rider', '03003330010', 'Photo Customer');
    const fd = new FormData();
    fd.append('file', new Blob([PNG], { type: 'image/png' }), 'me.png');
    const res = await fetch(base + '/api/rider/me/avatar', { method: 'POST', headers: { Authorization: `Bearer ${cust.token}` }, body: fd });
    assert.equal(res.status, 200);
    const u = (await res.json() as any).user;
    assert.match(u.avatarUrl, /^\/api\/media\/avatar\/[a-f0-9]{32}\.png$/);
    const img = await fetch(base + u.avatarUrl);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
    const bad = new FormData();
    bad.append('file', new Blob(['<html>not an image</html>'], { type: 'image/png' }), 'x.png');
    assert.equal((await fetch(base + '/api/rider/me/avatar', { method: 'POST', headers: { Authorization: `Bearer ${cust.token}` }, body: bad })).status, 400);
    assert.equal((await fetch(base + '/api/media/avatar/..%2F..%2Fspeedgo.db')).status, 404);
  });

  it('goods estimates only offer bike, rickshaw and mini', async () => {
    const e = await api('POST', '/api/rider/estimate', cust.token, { pickup: PICKUP, drop: DROP, service: 'pickup' });
    assert.deepEqual(e.estimates.map((x: any) => x.vehicleType).sort(), ['bike', 'mini', 'rickshaw']);
  });

  it('pick & drop needs an item, gets a booking number, and the driver sees it', async () => {
    const e = await api('POST', '/api/rider/estimate', cust.token, { pickup: PICKUP, drop: DROP, service: 'pickup' });
    const mini = e.estimates.find((x: any) => x.vehicleType === 'mini').fare;
    await api('POST', '/api/rider/orders', cust.token, { service: 'pickup', vehicleType: 'mini', pickup: PICKUP, drop: DROP, offeredFare: mini }, 422); // no item
    await api('POST', '/api/rider/orders', cust.token, { service: 'pickup', vehicleType: 'vip', pickup: PICKUP, drop: DROP, offeredFare: mini, meta: { item: 'Biryani' } }, 422); // cars do not carry goods
    const dsock = await connect(driver.token);
    const got = waitFor<any>(dsock, 'order:new');
    const r = await api('POST', '/api/rider/orders', cust.token, { service: 'pickup', vehicleType: 'mini', pickup: PICKUP, drop: DROP, offeredFare: mini, meta: { item: '2 biryani from Rana Hotel', receiverName: 'Ali', receiverPhone: '0300 5556667' } }, 201);
    assert.match(r.order.bookingNo, /^SG-PD-\d{6}$/);
    assert.equal(r.order.service, 'pickup');
    const req = await got;
    assert.equal(req.bookingNo, r.order.bookingNo);
    assert.equal(req.item, '2 biryani from Rana Hotel');
    assert.equal(req.service, 'pickup');
    await api('POST', `/api/driver/orders/${r.order.id}/offer`, driver.token, {});
    const o = await api('GET', `/api/rider/orders/${r.order.id}`, cust.token);
    const offer = o.order.offers[0];
    await api('POST', `/api/rider/orders/${r.order.id}/accept-offer`, cust.token, { offerId: offer.id });
    const d = await api('GET', `/api/driver/orders/${r.order.id}`, driver.token);
    assert.equal(d.order.meta.receiverPhone, '+923005556667'); // revealed once the job is the driver's
    await api('POST', `/api/driver/orders/${r.order.id}/cancel`, driver.token, { reason: 'test cleanup' });
    await api('POST', `/api/rider/orders/${r.order.id}/cancel`, cust.token, { reason: 'test cleanup' }, 409).catch(() => {});
  });

  it('delivery needs a receiver phone; admin can filter by service and find the booking number', async () => {
    const e = await api('POST', '/api/rider/estimate', cust.token, { pickup: PICKUP, drop: DROP, service: 'delivery' });
    const bike = e.estimates.find((x: any) => x.vehicleType === 'bike').fare;
    const bad = await api('POST', '/api/rider/orders', cust.token, { service: 'delivery', vehicleType: 'bike', pickup: PICKUP, drop: DROP, offeredFare: bike, meta: { item: 'Documents' } }, 422);
    assert.equal(bad.code, 'RECEIVER_REQUIRED');
    const r = await api('POST', '/api/rider/orders', cust.token, { service: 'delivery', vehicleType: 'bike', pickup: PICKUP, drop: DROP, offeredFare: bike, meta: { item: 'Documents', receiverName: 'Sara', receiverPhone: '03005556668' } }, 201);
    assert.match(r.order.bookingNo, /^SG-DL-\d{6}$/);
    const list = await api('GET', `/api/admin/orders?service=delivery&q=${r.order.bookingNo}`, adminToken);
    assert.equal(list.orders.length, 1);
    assert.equal(list.orders[0].bookingNo, r.order.bookingNo);
    await api('POST', `/api/rider/orders/${r.order.id}/cancel`, cust.token, { reason: 'test cleanup' });
  });
});
