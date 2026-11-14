import L from 'leaflet';
import { useEffect, useRef } from 'react';

export type MarkerKind = 'me' | 'pickup' | 'drop' | 'car' | 'free' | 'busy' | 'sos' | 'order';
export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  kind: MarkerKind;
  heading?: number | null;
  title?: string;
}
export interface MapLine {
  id: string;
  points: [number, number][];
  color?: string;
  dashed?: boolean;
  weight?: number;
}
interface Props {
  center: [number, number];
  zoom?: number;
  markers?: MapMarker[];
  lines?: MapLine[];
  /** Fit the view to these points whenever fitKey changes. */
  fit?: [number, number][];
  fitKey?: string | number;
  /** Re-center on `center` whenever recenterKey changes. */
  recenterKey?: string | number;
  padding?: { top?: number; bottom?: number };
  onClick?: (p: { lat: number; lng: number }) => void;
  className?: string;
}

const COLORS: Record<MarkerKind, string> = {
  me: '#6d28d9',
  pickup: '#16a34a',
  drop: '#17132a',
  car: '#8b5cf6',
  free: '#22c55e',
  busy: '#8b5cf6',
  sos: '#ef4444',
  order: '#f59e0b',
};

function icon(m: MapMarker): L.DivIcon {
  const c = COLORS[m.kind];
  let html: string;
  if (m.kind === 'drop') html = `<div class="sg-marker"><div class="sg-square" style="background:${c}"></div></div>`;
  else if (m.kind === 'car')
    html = `<div class="sg-marker sg-car" style="transform:rotate(${m.heading ?? 0}deg)"><svg width="28" height="28" viewBox="0 0 30 30"><rect x="7" y="3" width="16" height="24" rx="6" fill="${c}" stroke="#fff" stroke-width="2"/><rect x="10" y="7" width="10" height="5" rx="2" fill="#fff" opacity=".8"/></svg></div>`;
  else if (m.kind === 'sos' || m.kind === 'me')
    html = `<div class="sg-marker"><span class="sg-pulse" style="background:${c}"></span><div class="sg-dot" style="background:${c}"></div></div>`;
  else html = `<div class="sg-marker"><div class="sg-dot" style="background:${c}"></div></div>`;
  return L.divIcon({ html, className: '', iconSize: [28, 28], iconAnchor: [14, 14] });
}

/** Thin Leaflet wrapper (OpenStreetMap tiles, free, no key). Dark mode is handled with a CSS filter on the tile layer. */
export function MapView({ center, zoom = 14, markers = [], lines = [], fit, fitKey, recenterKey, padding, onClick, className }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const markerRefs = useRef(new Map<string, L.Marker>());
  const lineRefs = useRef(new Map<string, L.Polyline>());
  const clickRef = useRef(onClick);
  clickRef.current = onClick;

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { center, zoom, zoomControl: false, attributionControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    m.on('click', (e) => clickRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng }));
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
      markerRefs.current.clear();
      lineRefs.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // markers: update in place so cars glide instead of blinking
  useEffect(() => {
    const g = layer.current;
    if (!g) return;
    const seen = new Set<string>();
    for (const mk of markers) {
      seen.add(mk.id);
      const ex = markerRefs.current.get(mk.id);
      if (ex) {
        ex.setLatLng([mk.lat, mk.lng]);
        ex.setIcon(icon(mk));
      } else {
        const n = L.marker([mk.lat, mk.lng], { icon: icon(mk), title: mk.title, keyboard: false }).addTo(g);
        markerRefs.current.set(mk.id, n);
      }
    }
    for (const [id, mk] of markerRefs.current) if (!seen.has(id)) { mk.remove(); markerRefs.current.delete(id); }
  }, [markers]);

  useEffect(() => {
    const g = layer.current;
    if (!g) return;
    const seen = new Set<string>();
    for (const ln of lines) {
      seen.add(ln.id);
      const opts: L.PolylineOptions = { color: ln.color ?? '#8b5cf6', weight: ln.weight ?? 5, opacity: 0.95, dashArray: ln.dashed ? '8 10' : undefined, lineCap: 'round', lineJoin: 'round' };
      const ex = lineRefs.current.get(ln.id);
      if (ex) { ex.setLatLngs(ln.points); ex.setStyle(opts); }
      else lineRefs.current.set(ln.id, L.polyline(ln.points, opts).addTo(g));
    }
    for (const [id, pl] of lineRefs.current) if (!seen.has(id)) { pl.remove(); lineRefs.current.delete(id); }
  }, [lines]);

  useEffect(() => {
    const m = map.current;
    if (!m || !fit || fit.length === 0) return;
    if (fit.length === 1) m.setView(fit[0], Math.max(m.getZoom(), 15), { animate: true });
    else m.fitBounds(L.latLngBounds(fit), { paddingTopLeft: [40, 60 + (padding?.top ?? 0)], paddingBottomRight: [40, 40 + (padding?.bottom ?? 0)], maxZoom: 17, animate: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  useEffect(() => {
    map.current?.setView(center, map.current.getZoom(), { animate: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterKey]);

  return <div ref={el} className={className ?? 'map-fill'} />;
}
