import { db } from './db.js';

export interface PeakRule {
  name: string;
  days: number[]; // 0=Sun .. 6=Sat (Pakistan time)
  from: string; // HH:MM
  to: string;
  mult: number;
}

export interface Settings {
  commission_pct: number;
  min_wallet: number; // driver wallet needed to receive requests (Rs)
  offer_min_pct: number; // rider may offer this % below the estimate
  offer_max_pct: number; // rider may offer this % above the estimate
  counter_max_pct: number; // driver may counter up to this % above the estimate
  dispatch_radius_km: number;
  request_ttl_s: number;
  free_wait_min: number;
  cancel_grace_min: number;
  peak_rules: PeakRule[];
}

export const DEFAULT_SETTINGS: Settings = {
  commission_pct: 20,
  min_wallet: 0, // set higher (e.g. 500) once drivers top up wallets
  offer_min_pct: 20,
  offer_max_pct: 30,
  counter_max_pct: 40,
  dispatch_radius_km: 5,
  request_ttl_s: 90,
  free_wait_min: 2,
  cancel_grace_min: 3,
  peak_rules: [
    { name: 'Morning rush', days: [1, 2, 3, 4, 5, 6], from: '07:30', to: '09:30', mult: 1.2 },
    { name: 'Evening rush', days: [1, 2, 3, 4, 5, 6], from: '17:00', to: '20:00', mult: 1.3 },
  ],
};

let cache: Settings | null = null;

export function getSettings(): Settings {
  if (cache) return cache;
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of db.prepare('SELECT key,value FROM settings').all() as { key: string; value: string }[]) {
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      /* ignore bad row, keep default */
    }
  }
  cache = out as unknown as Settings;
  return cache;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const upsert = db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  const tx = db.transaction(() => {
    for (const [k, v] of Object.entries(patch)) {
      if (k in DEFAULT_SETTINGS) upsert.run(k, JSON.stringify(v));
    }
  });
  tx();
  cache = null;
  return getSettings();
}
