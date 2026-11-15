import crypto from 'node:crypto';
import { db } from './db.js';
import { toAdmins, toDrivers, toUser } from './bus.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from './errors.js';
import { haversine, route } from './geo.js';
import { estimateFare, fareRule, maxCounter, round10 } from './pricing.js';
import { getSettings } from './settings.js';
import {
  ACTIVE_ORDER_STATUSES,
  ASSIGNED_ORDER_STATUSES,
  type DriverSummaryDto,
  type LatLng,
  type OfferDto,
  type OrderMeta,
  type ServiceType,
  bookingNo,
  GOODS_VEHICLES,
  type OrderDto,
  type OrderStatus,
  type Place,
  type RequestDto,
  type VehicleType,
} from '@speedgo/shared';

export interface OrderRow {
  id: number;
  service: string;
  city_id: number;
  rider_id: number;
  driver_id: number | null;
  status: OrderStatus;
  vehicle_type: VehicleType;
  pickup_lat: number;
  pickup_lng: number;
  pickup_addr: string;
  drop_lat: number;
  drop_lng: number;
  drop_addr: string;
  distance_m: number;
  duration_s: number;
  route: string;
  est_fare: number;
  offered_fare: number;
  agreed_fare: number | null;
  waiting_charge: number;
  final_fare: number | null;
  commission: number | null;
  cancel_fee: number;
  payment_method: string;
  payment_status: string;
  pin: string;
  pin_attempts: number;
  expires_at: number | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  sos: number;
  driver_rating: number | null;
  rider_rating: number | null;
  created_at: number;
  accepted_at: number | null;
  arrived_at: number | null;
  started_at: number | null;
  completed_at: number | null;
  booking_no: string | null;
  meta: string | null;
}
interface OfferRow {
  id: number;
  order_id: number;
  driver_id: number;
  price: number;
  status: OfferDto['status'];
  created_at: number;
}
interface DriverRow {
  id: number;
  name: string | null;
  avatar: string | null;
  phone: string;
  status: string;
  wallet: number;
  rating_sum: number;
  rating_count: number;
  vehicle_type: VehicleType | null;
  plate: string | null;
  model: string | null;
  color: string | null;
  year: number | null;
  approval_status: string;
  online: number;
  lat: number | null;
  lng: number | null;
  heading: number | null;
  loc_at: number | null;
}

const now = () => Date.now();
const ACTIVE_SQL = ACTIVE_ORDER_STATUSES.map((s) => `'${s}'`).join(',');
const ASSIGNED_SQL = ASSIGNED_ORDER_STATUSES.map((s) => `'${s}'`).join(',');

export const getOrder = (id: number) => db.prepare('SELECT * FROM orders WHERE id=?').get(id) as OrderRow | undefined;
export const activeOrderForRider = (riderId: number) =>
  db.prepare(`SELECT * FROM orders WHERE rider_id=? AND status IN (${ACTIVE_SQL}) ORDER BY id DESC LIMIT 1`).get(riderId) as OrderRow | undefined;
export const activeOrderForDriver = (driverId: number) =>
  db.prepare(`SELECT * FROM orders WHERE driver_id=? AND status IN (${ASSIGNED_SQL}) ORDER BY id DESC LIMIT 1`).get(driverId) as OrderRow | undefined;
const driverBusy = (driverId: number) => !!activeOrderForDriver(driverId);

function logEvent(orderId: number, type: string, actor: string, data?: unknown) {
  db.prepare('INSERT INTO order_events(order_id,type,actor,data,at) VALUES (?,?,?,?,?)').run(orderId, type, actor, data === undefined ? null : JSON.stringify(data), now());
}

export function driverRow(id: number): DriverRow | undefined {
  return db
    .prepare(
      `SELECT u.id,u.name,u.avatar,u.phone,u.status,u.wallet,u.rating_sum,u.rating_count,
              d.vehicle_type,d.plate,d.model,d.color,d.year,d.approval_status,d.online,d.lat,d.lng,d.heading,d.loc_at
       FROM users u JOIN drivers d ON d.user_id=u.id WHERE u.id=? AND u.role='driver'`,
    )
    .get(id) as DriverRow | undefined;
}
export const avatarUrl = (file: string | null) => (file ? `/api/media/avatar/${file}` : null);
const avg = (sum: number, count: number) => (count > 0 ? Math.round((sum / count) * 10) / 10 : null);

function driverSummary(id: number, withPhone: boolean): DriverSummaryDto | undefined {
  const d = driverRow(id);
  if (!d) return undefined;
  return {
    id: d.id,
    name: d.name,
    avatarUrl: avatarUrl(d.avatar),
    ...(withPhone ? { phone: d.phone } : {}),
    rating: avg(d.rating_sum, d.rating_count),
    ratingCount: d.rating_count,
    vehicle: { type: d.vehicle_type ?? 'mini', model: d.model, color: d.color, plate: d.plate, year: d.year },
    lat: d.lat,
    lng: d.lng,
    heading: d.heading,
  };
}

function offerDto(o: OfferRow, order: OrderRow): OfferDto {
  const d = driverSummary(o.driver_id, false)!;
  const dist = d.lat != null && d.lng != null ? Math.round(haversine({ lat: d.lat, lng: d.lng }, { lat: order.pickup_lat, lng: order.pickup_lng })) : null;
  return {
    id: o.id,
    orderId: o.order_id,
    price: o.price,
    matchesOffer: o.price === order.offered_fare,
    status: o.status,
    createdAt: o.created_at,
    distanceM: dist,
    etaS: dist != null ? Math.round(dist / 6) : null,
    driver: d,
  };
}

export function orderDto(o: OrderRow, viewer: 'rider' | 'driver' | 'admin'): OrderDto {
  const assigned = o.driver_id != null;
  const dto: OrderDto = {
    id: o.id,
    bookingNo: o.booking_no ?? bookingNo(o.service as ServiceType, o.id),
    service: o.service as OrderDto['service'],
    meta: orderMeta(o, viewer),
    status: o.status,
    vehicleType: o.vehicle_type,
    pickup: { lat: o.pickup_lat, lng: o.pickup_lng, addr: o.pickup_addr },
    drop: { lat: o.drop_lat, lng: o.drop_lng, addr: o.drop_addr },
    distanceM: o.distance_m,
    durationS: o.duration_s,
    route: JSON.parse(o.route),
    estFare: o.est_fare,
    offeredFare: o.offered_fare,
    agreedFare: o.agreed_fare,
    waitingCharge: o.waiting_charge,
    finalFare: o.final_fare,
    commission: viewer === 'rider' ? null : o.commission,
    cancelFee: o.cancel_fee,
    paymentMethod: 'cash',
    paymentStatus: o.payment_status as 'pending' | 'paid',
    expiresAt: o.expires_at,
    createdAt: o.created_at,
    acceptedAt: o.accepted_at,
    arrivedAt: o.arrived_at,
    startedAt: o.started_at,
    completedAt: o.completed_at,
    cancelledBy: o.cancelled_by,
    cancelReason: o.cancel_reason,
    sos: !!o.sos,
    driverRating: o.driver_rating,
    riderRating: o.rider_rating,
  };
  if (viewer !== 'driver') dto.pin = o.pin;
  if (assigned && viewer !== 'driver') dto.driver = driverSummary(o.driver_id!, true);
  const r = db.prepare('SELECT id,name,avatar,phone,rating_sum,rating_count FROM users WHERE id=?').get(o.rider_id) as
    | { id: number; name: string | null; avatar: string | null; phone: string; rating_sum: number; rating_count: number }
    | undefined;
  if (r) {
    // Drivers only learn the rider's phone once the ride is theirs.
    const showPhone = viewer === 'admin' || (viewer === 'driver' && assigned);
    dto.rider = { id: r.id, name: r.name, avatarUrl: avatarUrl(r.avatar), ...(showPhone ? { phone: r.phone } : {}), rating: avg(r.rating_sum, r.rating_count) };
  }
  if (viewer === 'rider' && o.status === 'requested') {
    const offers = db.prepare("SELECT * FROM offers WHERE order_id=? AND status='pending' ORDER BY price ASC, created_at ASC").all(o.id) as OfferRow[];
    dto.offers = offers.map((x) => offerDto(x, o));
  }
  return dto;
}

/** Item details. The receiver's phone is only shown to the assigned driver and to staff. */
function orderMeta(o: OrderRow, viewer: 'rider' | 'driver' | 'admin'): OrderMeta | null {
  if (!o.meta) return null;
  const m = JSON.parse(o.meta) as OrderMeta;
  const assigned = o.driver_id != null;
  if (viewer === 'driver' && !assigned) return { item: m.item, notes: m.notes };
  return m;
}

function publish(o: OrderRow) {
  toUser(o.rider_id, 'order:update', orderDto(o, 'rider'));
  if (o.driver_id) toUser(o.driver_id, 'order:update', orderDto(o, 'driver'));
  toAdmins('live:order', { id: o.id, status: o.status, vehicleType: o.vehicle_type, pickup: { lat: o.pickup_lat, lng: o.pickup_lng }, drop: { lat: o.drop_lat, lng: o.drop_lng }, driverId: o.driver_id });
}

// ---------- Dispatch ----------
export function cityForPoint(p: LatLng) {
  const cities = db.prepare('SELECT * FROM cities WHERE active=1').all() as { id: number; name: string; lat: number; lng: number; radius_km: number }[];
  return cities.find((c) => haversine(p, c) <= c.radius_km * 1000);
}

function eligibleDrivers(o: OrderRow): { id: number; lat: number; lng: number; dist: number }[] {
  const s = getSettings();
  const rows = db
    .prepare(
      `SELECT u.id, d.lat, d.lng FROM drivers d JOIN users u ON u.id=d.user_id
       WHERE d.online=1 AND d.approval_status='approved' AND u.status='active' AND d.vehicle_type=?
         AND d.lat IS NOT NULL AND d.loc_at > ? AND u.wallet >= ?
         AND NOT EXISTS (SELECT 1 FROM orders x WHERE x.driver_id=u.id AND x.status IN (${ASSIGNED_SQL}))`,
    )
    .all(o.vehicle_type, now() - 120_000, s.min_wallet) as { id: number; lat: number; lng: number }[];
  const pickup = { lat: o.pickup_lat, lng: o.pickup_lng };
  return rows
    .map((r) => ({ ...r, dist: haversine(pickup, r) }))
    .filter((r) => r.dist <= s.dispatch_radius_km * 1000)
    .sort((a, b) => a.dist - b.dist);
}

function requestDto(o: OrderRow, driverLoc: LatLng | null): RequestDto {
  const rider = db.prepare('SELECT name,avatar,rating_sum,rating_count FROM users WHERE id=?').get(o.rider_id) as { name: string | null; avatar: string | null; rating_sum: number; rating_count: number };
  const meta = o.meta ? (JSON.parse(o.meta) as OrderMeta) : null;
  const dist = driverLoc ? Math.round(haversine(driverLoc, { lat: o.pickup_lat, lng: o.pickup_lng })) : null;
  return {
    id: o.id,
    bookingNo: o.booking_no ?? bookingNo(o.service as ServiceType, o.id),
    service: o.service as ServiceType,
    item: meta?.item ?? null,
    riderAvatarUrl: avatarUrl(rider.avatar),
    vehicleType: o.vehicle_type,
    pickup: { lat: o.pickup_lat, lng: o.pickup_lng, addr: o.pickup_addr },
    drop: { lat: o.drop_lat, lng: o.drop_lng, addr: o.drop_addr },
    distanceM: o.distance_m,
    durationS: o.duration_s,
    pickupDistanceM: dist,
    pickupEtaS: dist != null ? Math.round(dist / 6) : null,
    estFare: o.est_fare,
    offeredFare: o.offered_fare,
    maxCounter: maxCounter(o.est_fare),
    expiresAt: o.expires_at ?? 0,
    riderName: rider.name,
    riderRating: avg(rider.rating_sum, rider.rating_count),
    route: JSON.parse(o.route),
  };
}

function dispatch(o: OrderRow) {
  const drivers = eligibleDrivers(o);
  for (const d of drivers) toUser(d.id, 'order:new', requestDto(o, d));
  logEvent(o.id, 'dispatched', 'system', { drivers: drivers.length });
  return drivers.length;
}

/** Open requests a driver can currently respond to (used when a driver opens the app or goes online). */
export function openRequestsForDriver(driverId: number): RequestDto[] {
  const d = driverRow(driverId);
  if (!d || d.online !== 1 || d.approval_status !== 'approved' || !d.vehicle_type || d.lat == null || d.lng == null) return [];
  const s = getSettings();
  if (d.wallet < s.min_wallet || driverBusy(driverId)) return [];
  const rows = db
    .prepare(
      `SELECT o.* FROM orders o WHERE o.status='requested' AND o.expires_at > ? AND o.vehicle_type=?
         AND NOT EXISTS (SELECT 1 FROM offers f WHERE f.order_id=o.id AND f.driver_id=? AND f.status IN ('declined'))`,
    )
    .all(now(), d.vehicle_type, driverId) as OrderRow[];
  const loc = { lat: d.lat, lng: d.lng };
  return rows
    .filter((o) => haversine(loc, { lat: o.pickup_lat, lng: o.pickup_lng }) <= s.dispatch_radius_km * 1000)
    .map((o) => requestDto(o, loc));
}

// ---------- Rider actions ----------
export interface CreateOrderInput {
  service?: ServiceType;
  meta?: OrderMeta;
  vehicleType: VehicleType;
  pickup: Place;
  drop: Place;
  offeredFare: number;
}

export async function createOrder(riderId: number, input: CreateOrderInput): Promise<OrderDto> {
  const s = getSettings();
  const service: ServiceType = input.service ?? 'ride';
  if (service !== 'ride') {
    if (!GOODS_VEHICLES.includes(input.vehicleType)) throw unprocessable('Choose a bike, rickshaw or mini for goods', 'BAD_VEHICLE');
    if (!input.meta?.item || input.meta.item.trim().length < 2) throw unprocessable('Tell the driver what to collect or deliver', 'ITEM_REQUIRED');
    if (service === 'delivery' && !input.meta.receiverPhone) throw unprocessable('Enter the receiver\'s phone number', 'RECEIVER_REQUIRED');
  }
  const meta = service === 'ride' ? null : JSON.stringify(input.meta);
  const city = cityForPoint(input.pickup);
  if (!city) throw unprocessable('SpeedGo is not available at this pickup location yet', 'OUTSIDE_SERVICE_AREA');
  const r = await route(input.pickup, input.drop);
  if (r.distanceM < 200) throw unprocessable('Pickup and destination are too close', 'TOO_CLOSE');
  const est = estimateFare(city.id, input.vehicleType, r.distanceM, r.durationS);
  if (input.offeredFare < est.minOffer || input.offeredFare > est.maxOffer) {
    throw unprocessable(`Your offer must be between Rs ${est.minOffer} and Rs ${est.maxOffer}`, 'OFFER_OUT_OF_RANGE');
  }
  const pin = String(crypto.randomInt(1000, 10000));
  const create = db.transaction(() => {
    if (activeOrderForRider(riderId)) throw conflict('You already have an active ride', 'ACTIVE_ORDER_EXISTS');
    const info = db
      .prepare(
        `INSERT INTO orders(service,city_id,rider_id,status,vehicle_type,pickup_lat,pickup_lng,pickup_addr,drop_lat,drop_lng,drop_addr,
           distance_m,duration_s,route,est_fare,offered_fare,pin,expires_at,created_at)
         VALUES (?,?,?,'requested',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(service, city.id, riderId, input.vehicleType, input.pickup.lat, input.pickup.lng, input.pickup.addr, input.drop.lat, input.drop.lng, input.drop.addr,
        r.distanceM, r.durationS, JSON.stringify(r.points), est.fare, input.offeredFare, pin, now() + s.request_ttl_s * 1000, now());
    const newId = Number(info.lastInsertRowid);
    db.prepare('UPDATE orders SET booking_no=?, meta=? WHERE id=?').run(bookingNo(service, newId), meta, newId);
    return newId;
  });
  const id = create();
  logEvent(id, 'requested', `rider:${riderId}`, { offered: input.offeredFare, est: est.fare, route: r.source });
  const o = getOrder(id)!;
  dispatch(o);
  publish(o);
  return orderDto(o, 'rider');
}

/** Rider raises the offer (e.g. "Raise to Rs 360") to attract drivers; request time is extended. */
export function raiseOffer(riderId: number, orderId: number, fare: number): OrderDto {
  const o = getOrder(orderId);
  if (!o || o.rider_id !== riderId) throw notFound('Ride not found');
  if (o.status !== 'requested') throw conflict('This request is no longer open', 'BAD_STATE');
  const est = estimateFare(o.city_id, o.vehicle_type, o.distance_m, o.duration_s);
  if (fare < est.minOffer || fare > est.maxOffer) throw unprocessable(`Your offer must be between Rs ${est.minOffer} and Rs ${est.maxOffer}`, 'OFFER_OUT_OF_RANGE');
  db.prepare('UPDATE orders SET offered_fare=?, expires_at=? WHERE id=?').run(round10(fare), now() + getSettings().request_ttl_s * 1000, orderId);
  logEvent(orderId, 'offer_changed', `rider:${riderId}`, { fare });
  const n = getOrder(orderId)!;
  dispatch(n);
  publish(n);
  return orderDto(n, 'rider');
}

export function acceptOffer(riderId: number, orderId: number, offerId: number): OrderDto {
  const s = getSettings();
  const run = db.transaction(() => {
    const o = getOrder(orderId);
    if (!o || o.rider_id !== riderId) throw notFound('Ride not found');
    if (o.status !== 'requested') throw conflict('This request is no longer open', 'BAD_STATE');
    const offer = db.prepare('SELECT * FROM offers WHERE id=? AND order_id=?').get(offerId, orderId) as OfferRow | undefined;
    if (!offer || offer.status !== 'pending') throw conflict('This offer is no longer available', 'OFFER_GONE');
    const d = driverRow(offer.driver_id);
    if (!d || d.online !== 1 || d.approval_status !== 'approved' || d.status !== 'active' || d.wallet < s.min_wallet || driverBusy(d.id)) {
      db.prepare("UPDATE offers SET status='expired' WHERE id=?").run(offerId);
      throw conflict('That driver is no longer available. Please pick another offer.', 'DRIVER_BUSY');
    }
    db.prepare("UPDATE orders SET driver_id=?, status='accepted', agreed_fare=?, accepted_at=?, expires_at=NULL WHERE id=?").run(offer.driver_id, offer.price, now(), orderId);
    db.prepare("UPDATE offers SET status='accepted' WHERE id=?").run(offerId);
    const others = db.prepare("SELECT driver_id FROM offers WHERE order_id=? AND id<>? AND status IN ('pending')").all(orderId, offerId) as { driver_id: number }[];
    db.prepare("UPDATE offers SET status='rejected' WHERE order_id=? AND id<>? AND status='pending'").run(orderId, offerId);
    return { others, driverId: offer.driver_id, price: offer.price };
  });
  const { others, driverId, price } = run();
  logEvent(orderId, 'accepted', `rider:${riderId}`, { driverId, price });
  for (const x of others) toUser(x.driver_id, 'order:gone', { id: orderId });
  toDrivers('order:gone', { id: orderId });
  const n = getOrder(orderId)!;
  publish(n);
  return orderDto(n, 'rider');
}

export function cancelByRider(riderId: number, orderId: number, reason: string): OrderDto {
  const o = getOrder(orderId);
  if (!o || o.rider_id !== riderId) throw notFound('Ride not found');
  if (!['requested', 'accepted', 'arrived'].includes(o.status)) throw conflict('This ride can no longer be cancelled', 'BAD_STATE');
  let fee = 0;
  if (o.status === 'arrived' && o.arrived_at && now() - o.arrived_at > getSettings().cancel_grace_min * 60_000) {
    fee = fareRule(o.city_id, o.vehicle_type).cancel_fee; // recorded now; charging happens with the payments phase
  }
  db.prepare("UPDATE orders SET status='cancelled', cancelled_by='rider', cancel_reason=?, cancel_fee=?, expires_at=NULL WHERE id=?").run(reason, fee, orderId);
  db.prepare("UPDATE offers SET status='expired' WHERE order_id=? AND status='pending'").run(orderId);
  logEvent(orderId, 'cancelled', `rider:${riderId}`, { reason, fee });
  toDrivers('order:gone', { id: orderId });
  const n = getOrder(orderId)!;
  publish(n);
  return orderDto(n, 'rider');
}

// ---------- Driver actions ----------
function requireDriverReady(driverId: number): DriverRow {
  const d = driverRow(driverId);
  if (!d) throw notFound('Driver not found');
  if (d.approval_status !== 'approved') throw forbidden('Your account is not approved yet', 'NOT_APPROVED');
  if (d.status !== 'active') throw forbidden('Your account is suspended', 'ACCOUNT_BLOCKED');
  return d;
}

/** Driver answers a request. price defaults to the rider's offer (plain accept); a higher price is a counter-offer. */
export function driverOffer(driverId: number, orderId: number, price?: number): OfferDto {
  const s = getSettings();
  const d = requireDriverReady(driverId);
  if (d.online !== 1) throw conflict('Go online to receive rides', 'NOT_ONLINE');
  if (d.wallet < s.min_wallet) throw forbidden(`Your wallet must be at least Rs ${s.min_wallet} to accept rides`, 'LOW_WALLET');
  if (driverBusy(driverId)) throw conflict('Finish your current ride first', 'DRIVER_BUSY');
  const o = getOrder(orderId);
  if (!o || o.status !== 'requested' || (o.expires_at ?? 0) < now()) throw conflict('This request is no longer available', 'REQUEST_GONE');
  if (o.vehicle_type !== d.vehicle_type) throw forbidden('This request needs a different vehicle type');
  const p = round10(price ?? o.offered_fare);
  const cap = maxCounter(o.est_fare, s);
  if (p < o.offered_fare || p > cap) throw unprocessable(`Your price must be between Rs ${o.offered_fare} and Rs ${cap}`, 'PRICE_OUT_OF_RANGE');
  db.prepare(
    `INSERT INTO offers(order_id,driver_id,price,status,created_at) VALUES (?,?,?,'pending',?)
     ON CONFLICT(order_id,driver_id) DO UPDATE SET price=excluded.price, status='pending', created_at=excluded.created_at`,
  ).run(orderId, driverId, p, now());
  const offer = db.prepare('SELECT * FROM offers WHERE order_id=? AND driver_id=?').get(orderId, driverId) as OfferRow;
  logEvent(orderId, p === o.offered_fare ? 'driver_accepted_price' : 'driver_counter', `driver:${driverId}`, { price: p });
  const dto = offerDto(offer, o);
  toUser(o.rider_id, 'offer:new', dto);
  publish(o);
  return dto;
}

export function driverSkip(driverId: number, orderId: number) {
  const o = getOrder(orderId);
  if (!o) return;
  db.prepare(
    `INSERT INTO offers(order_id,driver_id,price,status,created_at) VALUES (?,?,0,'declined',?)
     ON CONFLICT(order_id,driver_id) DO UPDATE SET status='declined'`,
  ).run(orderId, driverId, now());
}

function assignedTo(driverId: number, orderId: number, allowed: OrderStatus[]): OrderRow {
  const o = getOrder(orderId);
  if (!o || o.driver_id !== driverId) throw notFound('Ride not found');
  if (!allowed.includes(o.status)) throw conflict(`This cannot be done while the ride is "${o.status.replace('_', ' ')}"`, 'BAD_STATE');
  return o;
}

export function driverArrived(driverId: number, orderId: number): OrderDto {
  const o = assignedTo(driverId, orderId, ['accepted']);
  const d = driverRow(driverId)!;
  const radius = Number(process.env.ARRIVE_RADIUS_M ?? 0); // 0 = not enforced (local testing); set e.g. 300 for real use
  if (radius > 0 && d.lat != null && d.lng != null && haversine({ lat: d.lat, lng: d.lng }, { lat: o.pickup_lat, lng: o.pickup_lng }) > radius) {
    throw unprocessable('You are not near the pickup point yet', 'NOT_AT_PICKUP');
  }
  db.prepare("UPDATE orders SET status='arrived', arrived_at=? WHERE id=?").run(now(), orderId);
  logEvent(orderId, 'arrived', `driver:${driverId}`);
  const n = getOrder(orderId)!;
  publish(n);
  return orderDto(n, 'driver');
}

export function driverStart(driverId: number, orderId: number, pin: string): OrderDto {
  const o = assignedTo(driverId, orderId, ['arrived']);
  if (o.pin_attempts >= 5) throw forbidden('Too many wrong PIN attempts. Ask the customer to contact support.', 'PIN_LOCKED');
  if (pin !== o.pin) {
    db.prepare('UPDATE orders SET pin_attempts=pin_attempts+1 WHERE id=?').run(orderId);
    throw badRequest('That PIN is not correct. Ask the customer to read it again.', 'PIN_WRONG');
  }
  db.prepare("UPDATE orders SET status='in_progress', started_at=? WHERE id=?").run(now(), orderId);
  logEvent(orderId, 'started', `driver:${driverId}`);
  const n = getOrder(orderId)!;
  publish(n);
  return orderDto(n, 'driver');
}

function addLedger(userId: number, kind: string, amount: number, orderId: number | null, note?: string) {
  const bal = (db.prepare('UPDATE users SET wallet=wallet+? WHERE id=? RETURNING wallet').get(amount, userId) as { wallet: number }).wallet;
  db.prepare('INSERT INTO ledger(user_id,kind,amount,balance_after,order_id,note,at) VALUES (?,?,?,?,?,?,?)').run(userId, kind, amount, bal, orderId, note ?? null, now());
  return bal;
}
export { addLedger };

export function driverComplete(driverId: number, orderId: number): OrderDto {
  const s = getSettings();
  const o = assignedTo(driverId, orderId, ['in_progress']);
  const rule = fareRule(o.city_id, o.vehicle_type);
  const waitedMin = o.arrived_at && o.started_at ? (o.started_at - o.arrived_at) / 60_000 : 0;
  const chargeable = Math.max(0, Math.ceil(waitedMin - s.free_wait_min));
  const waiting = chargeable * rule.wait_per_min;
  const final = (o.agreed_fare ?? o.offered_fare) + waiting;
  const commission = Math.round((final * s.commission_pct) / 100);
  db.transaction(() => {
    db.prepare("UPDATE orders SET status='completed', waiting_charge=?, final_fare=?, commission=?, completed_at=? WHERE id=?").run(waiting, final, commission, now(), orderId);
    addLedger(driverId, 'commission', -commission, orderId, `${s.commission_pct}% commission on ride #${orderId}`);
  })();
  logEvent(orderId, 'completed', `driver:${driverId}`, { final, commission, waiting });
  const n = getOrder(orderId)!;
  publish(n);
  return orderDto(n, 'driver');
}

export function driverCashConfirm(driverId: number, orderId: number): OrderDto {
  const o = assignedTo(driverId, orderId, ['completed']);
  if (o.payment_status === 'paid') return orderDto(o, 'driver');
  db.prepare("UPDATE orders SET payment_status='paid' WHERE id=?").run(orderId);
  logEvent(orderId, 'cash_confirmed', `driver:${driverId}`, { amount: o.final_fare });
  const n = getOrder(orderId)!;
  publish(n);
  return orderDto(n, 'driver');
}

export function cancelByDriver(driverId: number, orderId: number, reason: string): OrderDto {
  const o = assignedTo(driverId, orderId, ['accepted', 'arrived']);
  db.prepare("UPDATE orders SET status='cancelled', cancelled_by='driver', cancel_reason=? WHERE id=?").run(reason, o.id);
  logEvent(orderId, 'cancelled', `driver:${driverId}`, { reason });
  const n = getOrder(orderId)!;
  publish(n);
  return orderDto(n, 'driver');
}

// ---------- Ratings & safety ----------
export function rateDriver(riderId: number, orderId: number, rating: number, tags: string[], comment: string | null): OrderDto {
  const o = getOrder(orderId);
  if (!o || o.rider_id !== riderId) throw notFound('Ride not found');
  if (o.status !== 'completed' || !o.driver_id) throw conflict('You can rate a ride after it is completed', 'BAD_STATE');
  if (o.driver_rating != null) throw conflict('You already rated this ride', 'ALREADY_RATED');
  db.transaction(() => {
    db.prepare('UPDATE orders SET driver_rating=?, driver_tags=?, driver_comment=? WHERE id=?').run(rating, JSON.stringify(tags), comment, orderId);
    db.prepare('UPDATE users SET rating_sum=rating_sum+?, rating_count=rating_count+1 WHERE id=?').run(rating, o.driver_id);
  })();
  logEvent(orderId, 'driver_rated', `rider:${riderId}`, { rating });
  return orderDto(getOrder(orderId)!, 'rider');
}

export function rateRider(driverId: number, orderId: number, rating: number): OrderDto {
  const o = assignedTo(driverId, orderId, ['completed']);
  if (o.rider_rating != null) throw conflict('You already rated this customer', 'ALREADY_RATED');
  db.transaction(() => {
    db.prepare('UPDATE orders SET rider_rating=? WHERE id=?').run(rating, orderId);
    db.prepare('UPDATE users SET rating_sum=rating_sum+?, rating_count=rating_count+1 WHERE id=?').run(rating, o.rider_id);
  })();
  logEvent(orderId, 'rider_rated', `driver:${driverId}`, { rating });
  return orderDto(getOrder(orderId)!, 'driver');
}

export function raiseSos(userId: number, role: 'rider' | 'driver', orderId: number, loc: LatLng | null) {
  const o = getOrder(orderId);
  if (!o || (role === 'rider' ? o.rider_id !== userId : o.driver_id !== userId)) throw notFound('Ride not found');
  if (!['accepted', 'arrived', 'in_progress'].includes(o.status)) throw conflict('SOS is available during an active ride', 'BAD_STATE');
  const info = db.prepare('INSERT INTO sos_events(order_id,user_id,role,lat,lng,at) VALUES (?,?,?,?,?,?)').run(orderId, userId, role, loc?.lat ?? null, loc?.lng ?? null, now());
  db.prepare('UPDATE orders SET sos=1 WHERE id=?').run(orderId);
  logEvent(orderId, 'sos', `${role}:${userId}`, loc);
  const payload = { id: Number(info.lastInsertRowid), orderId, role, lat: loc?.lat ?? null, lng: loc?.lng ?? null, at: now() };
  toAdmins('sos:new', payload);
  publish(getOrder(orderId)!);
  return payload;
}

// ---------- Lists ----------
export function ordersForUser(userId: number, role: 'rider' | 'driver', limit = 30): OrderDto[] {
  const col = role === 'rider' ? 'rider_id' : 'driver_id';
  const rows = db.prepare(`SELECT * FROM orders WHERE ${col}=? ORDER BY id DESC LIMIT ?`).all(userId, limit) as OrderRow[];
  return rows.map((o) => orderDto(o, role));
}

export function driverEarnings(driverId: number) {
  const tz = 5 * 3600; // Pakistan time (UTC+5, no DST)
  const sumFor = (sinceMs: number) =>
    db.prepare("SELECT COUNT(*) trips, COALESCE(SUM(final_fare),0) gross, COALESCE(SUM(commission),0) commission FROM orders WHERE driver_id=? AND status='completed' AND completed_at>=?").get(driverId, sinceMs) as { trips: number; gross: number; commission: number };
  const startOfDay = (() => {
    const t = new Date(Date.now() + tz * 1000);
    t.setUTCHours(0, 0, 0, 0);
    return t.getTime() - tz * 1000;
  })();
  const fmt = (r: { trips: number; gross: number; commission: number }) => ({ ...r, net: r.gross - r.commission });
  const daily = db
    .prepare(
      `SELECT strftime('%Y-%m-%d', completed_at/1000 + ?, 'unixepoch') day, COUNT(*) trips, SUM(final_fare) gross, SUM(commission) commission
       FROM orders WHERE driver_id=? AND status='completed' AND completed_at>=? GROUP BY day ORDER BY day`,
    )
    .all(tz, driverId, startOfDay - 6 * 86_400_000) as { day: string; trips: number; gross: number; commission: number }[];
  const wallet = (db.prepare('SELECT wallet FROM users WHERE id=?').get(driverId) as { wallet: number }).wallet;
  const ledger = db.prepare('SELECT kind,amount,balance_after,order_id,note,at FROM ledger WHERE user_id=? ORDER BY id DESC LIMIT 30').all(driverId);
  return {
    today: fmt(sumFor(startOfDay)),
    week: fmt(sumFor(startOfDay - 6 * 86_400_000)),
    month: fmt(sumFor(startOfDay - 29 * 86_400_000)),
    daily: daily.map((d) => ({ ...d, net: d.gross - d.commission })),
    wallet,
    ledger,
  };
}

// ---------- Background sweeps ----------
export function sweep() {
  const t = now();
  const expired = db.prepare("SELECT * FROM orders WHERE status='requested' AND expires_at < ?").all(t) as OrderRow[];
  for (const o of expired) {
    db.prepare("UPDATE orders SET status='no_driver', expires_at=NULL WHERE id=? AND status='requested'").run(o.id);
    db.prepare("UPDATE offers SET status='expired' WHERE order_id=? AND status='pending'").run(o.id);
    logEvent(o.id, 'no_driver', 'system');
    toDrivers('order:gone', { id: o.id });
    publish(getOrder(o.id)!);
  }
  // Drivers that stopped sending location (app killed, no network) are taken offline so riders never see ghost drivers.
  const stale = db
    .prepare(`SELECT user_id FROM drivers d WHERE online=1 AND (loc_at IS NULL OR loc_at < ?) AND NOT EXISTS (SELECT 1 FROM orders x WHERE x.driver_id=d.user_id AND x.status IN (${ASSIGNED_SQL}))`)
    .all(t - 180_000) as { user_id: number }[];
  for (const s of stale) {
    db.prepare('UPDATE drivers SET online=0 WHERE user_id=?').run(s.user_id);
    toUser(s.user_id, 'driver:status', { online: false, reason: 'connection_lost' });
  }
}
