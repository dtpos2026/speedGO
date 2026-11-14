import { db } from './db.js';
import { config } from './config.js';
import { getSettings, type Settings } from './settings.js';
import { VEHICLE_TYPES, type EstimateDto, type VehicleType } from '@speedgo/shared';
import { unprocessable } from './errors.js';

export interface FareRule {
  city_id: number;
  vehicle_type: VehicleType;
  base: number;
  per_km: number;
  per_min: number;
  min_fare: number;
  wait_per_min: number;
  cancel_fee: number;
  active: number;
}

export function fareRule(cityId: number, vehicle: VehicleType): FareRule {
  const r = db.prepare('SELECT * FROM fare_rules WHERE city_id=? AND vehicle_type=? AND active=1').get(cityId, vehicle) as FareRule | undefined;
  if (!r) throw unprocessable('This vehicle type is not available in your city', 'VEHICLE_UNAVAILABLE');
  return r;
}

const round10 = (n: number) => Math.round(n / 10) * 10;

/** Peak multiplier for "now" in Pakistan time. */
export function peakMultiplier(s: Settings, at = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  const hm = `${get('hour').padStart(2, '0')}:${get('minute')}`;
  let m = 1;
  for (const r of s.peak_rules) if (r.days.includes(day) && hm >= r.from && hm < r.to) m = Math.max(m, r.mult);
  return m;
}

export function estimateFare(cityId: number, vehicle: VehicleType, distanceM: number, durationS: number, at = new Date()): EstimateDto {
  const s = getSettings();
  const r = fareRule(cityId, vehicle);
  const distance = (distanceM / 1000) * r.per_km;
  const time = (durationS / 60) * r.per_min;
  const mult = peakMultiplier(s, at);
  const raw = (r.base + distance + time) * mult;
  const minApplied = raw < r.min_fare;
  const fare = round10(Math.max(raw, r.min_fare));
  const b = offerBounds(fare, s);
  return {
    vehicleType: vehicle,
    fare,
    minOffer: b.min,
    maxOffer: b.max,
    breakdown: { base: r.base, distance: Math.round(distance), time: Math.round(time), peakMultiplier: mult, minFareApplied: minApplied },
  };
}

export function estimateAll(cityId: number, distanceM: number, durationS: number): EstimateDto[] {
  const out: EstimateDto[] = [];
  for (const v of VEHICLE_TYPES) {
    try {
      out.push(estimateFare(cityId, v, distanceM, durationS));
    } catch {
      /* vehicle not offered in this city */
    }
  }
  return out;
}

export function offerBounds(estimate: number, s: Settings = getSettings()) {
  return {
    min: round10(estimate * (1 - s.offer_min_pct / 100)),
    max: round10(estimate * (1 + s.offer_max_pct / 100)),
  };
}
export function maxCounter(estimate: number, s: Settings = getSettings()) {
  return round10(estimate * (1 + s.counter_max_pct / 100));
}
export { round10 };
