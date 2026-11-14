import { config } from './config.js';
import type { LatLng } from '@speedgo/shared';

export function haversine(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export interface RouteResult {
  distanceM: number;
  durationS: number;
  points: [number, number][]; // [lat,lng]
  source: 'osrm' | 'estimate';
}

function decimate(points: [number, number][], max = 300): [number, number][] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const out: [number, number][] = [];
  for (let i = 0; i < max - 1; i++) out.push(points[Math.round(i * step)]);
  out.push(points[points.length - 1]);
  return out;
}

/** Road route from OSRM when reachable; otherwise a straight-line estimate (x1.35 for road winding, ~22 km/h in town). */
export async function route(from: LatLng, to: LatLng): Promise<RouteResult> {
  if (config.routing.enabled) {
    try {
      const url = `${config.routing.url}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
      const res = await fetch(url, { signal: AbortSignal.timeout(4000), headers: { 'User-Agent': 'SpeedGo-Local/0.1' } });
      if (res.ok) {
        const j = (await res.json()) as { routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[] };
        const r = j.routes?.[0];
        if (r) {
          return {
            distanceM: Math.round(r.distance),
            durationS: Math.round(r.duration),
            points: decimate(r.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number])),
            source: 'osrm',
          };
        }
      }
    } catch {
      /* fall through to the estimate */
    }
  }
  const straight = haversine(from, to);
  const distanceM = Math.round(straight * 1.35);
  return {
    distanceM,
    durationS: Math.round(distanceM / 6.1),
    points: [
      [from.lat, from.lng],
      [to.lat, to.lng],
    ],
    source: 'estimate',
  };
}

// ---------- Address search (OpenStreetMap Nominatim, cached and throttled to respect its usage policy) ----------
export interface GeoHit {
  lat: number;
  lng: number;
  addr: string;
  name: string;
}
const cache = new Map<string, { at: number; hits: GeoHit[] }>();
let lastCall = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function nominatim(path: string, key: string): Promise<unknown> {
  const wait = lastCall + 1100 - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  const res = await fetch(`${config.geocoder.url}${path}`, {
    signal: AbortSignal.timeout(5000),
    headers: { 'User-Agent': 'SpeedGo-Local/0.1 (local development)', 'Accept-Language': 'en,ur' },
  });
  if (!res.ok) throw new Error(`geocoder ${res.status} for ${key}`);
  return res.json();
}

export async function searchPlaces(q: string, near: LatLng): Promise<GeoHit[]> {
  if (!config.geocoder.enabled) return [];
  const key = `s:${q.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 600_000) return hit.hits;
  const d = 0.35;
  const viewbox = `${near.lng - d},${near.lat + d},${near.lng + d},${near.lat - d}`;
  const data = (await nominatim(
    `/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=6&countrycodes=pk&viewbox=${viewbox}`,
    key,
  )) as { lat: string; lon: string; display_name: string; name?: string }[];
  const hits = data.map((r) => ({
    lat: Number(r.lat),
    lng: Number(r.lon),
    addr: r.display_name,
    name: r.name || r.display_name.split(',')[0],
  }));
  cache.set(key, { at: Date.now(), hits });
  return hits;
}

export async function reverseGeocode(p: LatLng): Promise<string> {
  const fallback = `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
  if (!config.geocoder.enabled) return fallback;
  const key = `r:${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
  const hit = cache.get(key);
  if (hit) return hit.hits[0]?.addr ?? fallback;
  try {
    const r = (await nominatim(`/reverse?lat=${p.lat}&lon=${p.lng}&format=jsonv2&zoom=18`, key)) as { display_name?: string };
    const addr = r.display_name ?? fallback;
    cache.set(key, { at: Date.now(), hits: [{ lat: p.lat, lng: p.lng, addr, name: addr }] });
    return addr;
  } catch {
    return fallback;
  }
}
