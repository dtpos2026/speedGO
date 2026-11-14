import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Car, CheckCircle2, Clock, Wallet, AlertTriangle } from 'lucide-react';
import type { Socket } from 'socket.io-client';
import { MapView, useSocketEvent, type MapLine, type MapMarker } from '@speedgo/ui';
import { VEHICLE_LABEL, type VehicleType } from '@speedgo/shared';
import { api, type AdminMe } from '../api';
import { Empty, Kpi, money, statusChip } from '../kit';

interface Stats { activeRides: number; searching: number; onlineDrivers: number; busyDrivers: number; pendingApprovals: number; openSos: number; totalRiders: number; totalDrivers: number; today: { completed: number; gross: number; revenue: number; cancelled: number } }
interface LiveDriver { id: number; name: string | null; vehicleType: VehicleType; plate: string; lat: number; lng: number; busy: number | boolean; heading?: number | null }
interface LiveOrder { id: number; status: string; vehicleType: VehicleType; pickup_lat: number; pickup_lng: number; pickup_addr: string; drop_addr: string; driverId: number | null; offeredFare: number; agreedFare: number | null; sos: number }

export function Live({ sock }: { me: AdminMe; sock: Socket | null }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [drivers, setDrivers] = useState<Map<number, LiveDriver>>(new Map());
  const [orders, setOrders] = useState<LiveOrder[]>([]);
  const [centre, setCentre] = useState<[number, number]>([30.1667, 72.65]);

  const load = useCallback(() => {
    api.get<Stats>('/api/admin/stats').then(setStats).catch(() => {});
    api.get<{ drivers: LiveDriver[]; orders: LiveOrder[] }>('/api/admin/live').then((r) => { setDrivers(new Map(r.drivers.map((d) => [d.id, d]))); setOrders(r.orders); }).catch(() => {});
  }, []);
  useEffect(() => { load(); api.get<{ city: { lat: number; lng: number } }>('/api/public/config').then((c) => setCentre([c.city.lat, c.city.lng])).catch(() => {}); const i = setInterval(load, 15000); return () => clearInterval(i); }, [load]);

  // debounce refetches triggered by bursts of events
  const timer = useRef<number | null>(null);
  const soon = useCallback(() => { if (timer.current) return; timer.current = window.setTimeout(() => { timer.current = null; load(); }, 800); }, [load]);
  useSocketEvent(sock, 'live:order', soon);
  useSocketEvent(sock, 'sos:new', soon);
  useSocketEvent<{ id: number; online: boolean; lat: number; lng: number; heading?: number | null; busy?: boolean }>(sock, 'live:driver', (d) => {
    setDrivers((cur) => {
      const n = new Map(cur);
      if (!d.online) n.delete(d.id);
      else { const ex = n.get(d.id); n.set(d.id, { id: d.id, name: ex?.name ?? null, vehicleType: ex?.vehicleType ?? 'mini', plate: ex?.plate ?? '', lat: d.lat, lng: d.lng, busy: d.busy ?? ex?.busy ?? false, heading: d.heading }); if (!ex) soon(); }
      return n;
    });
  });

  const markers = useMemo<MapMarker[]>(() => {
    const m: MapMarker[] = [];
    for (const d of drivers.values()) m.push({ id: `d${d.id}`, lat: d.lat, lng: d.lng, kind: d.busy ? 'busy' : 'free', title: `${d.name ?? 'Driver'} ${d.plate}` });
    for (const o of orders) m.push({ id: `o${o.id}`, lat: o.pickup_lat, lng: o.pickup_lng, kind: o.sos ? 'sos' : 'order', title: `Ride #${o.id}` });
    return m;
  }, [drivers, orders]);
  const lines = useMemo<MapLine[]>(() => [], []);

  const needs = (stats?.openSos ?? 0) + (stats?.searching ?? 0);
  return (
    <>
      <div><h1 className="title">Live operations</h1><div className="muted small">Real-time overview. Updates by itself.</div></div>
      <section className="grid-kpi">
        <Kpi label="Active rides" value={stats?.activeRides ?? '–'} sub={`${stats?.searching ?? 0} searching`} />
        <Kpi label="Online drivers" value={stats?.onlineDrivers ?? '–'} sub={`${stats?.busyDrivers ?? 0} on a trip`} />
        <Kpi label="Completed today" value={stats?.today.completed ?? '–'} sub={`${stats?.today.cancelled ?? 0} cancelled`} />
        <Kpi label="Platform revenue today" value={money(stats?.today.revenue)} sub={`of ${money(stats?.today.gross)} gross`} />
        <Kpi label="Needs attention" value={needs} tone={needs ? 'danger' : undefined} sub={`${stats?.openSos ?? 0} SOS · ${stats?.pendingApprovals ?? 0} approvals`} />
      </section>

      <section className="two-col">
        <div className="wide card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="row between" style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
            <b>Live map · Burewala</b>
            <div className="row small"><span className="chip chip-ok">● Free {[...drivers.values()].filter((d) => !d.busy).length}</span><span className="chip chip-brand">● On trip {[...drivers.values()].filter((d) => d.busy).length}</span><span className="chip chip-warn">● Requests {orders.filter((o) => o.status === 'requested').length}</span></div>
          </div>
          <div className="map-box"><MapView center={centre} zoom={13} markers={markers} lines={lines} recenterKey="c" /></div>
        </div>
        <aside className="narrow col">
          <div className="card col">
            <b>Alerts</b>
            {(stats?.openSos ?? 0) > 0 && <a className="card-flat row" href="#/support" style={{ background: 'var(--danger-soft)', textDecoration: 'none', color: 'var(--text)' }}><AlertTriangle color="var(--danger)" /><span><b>{stats!.openSos} open SOS</b><br /><span className="small muted">Open Support &amp; safety</span></span></a>}
            {(stats?.pendingApprovals ?? 0) > 0 && <a className="card-flat row" href="#/drivers" style={{ textDecoration: 'none', color: 'var(--text)' }}><CheckCircle2 color="var(--brand)" /><span><b>{stats!.pendingApprovals} driver{stats!.pendingApprovals > 1 ? 's' : ''} waiting for approval</b><br /><span className="small muted">Open Drivers</span></span></a>}
            {(stats?.searching ?? 0) > 0 && <div className="card-flat row"><Clock color="var(--warn)" /><span><b>{stats!.searching} request{stats!.searching > 1 ? 's' : ''} searching for a driver</b></span></div>}
            {!needs && !stats?.pendingApprovals && <div className="muted small">All clear.</div>}
          </div>
          <div className="card col">
            <b>Fleet</b>
            <div className="row between small"><span className="muted"><Car size={14} /> Drivers registered</span><b>{stats?.totalDrivers ?? 0}</b></div>
            <div className="row between small"><span className="muted"><Wallet size={14} /> Riders registered</span><b>{stats?.totalRiders ?? 0}</b></div>
          </div>
        </aside>
      </section>

      <section className="table-wrap">
        <div className="row between" style={{ padding: '14px 18px' }}><b>Active rides</b><span className="small muted">{orders.length} open</span></div>
        {orders.length === 0 ? <Empty title="No active rides" sub="They appear here the moment a rider requests one." /> : (
          <table className="table">
            <thead><tr><th>#</th><th>Vehicle</th><th>Pickup</th><th>Destination</th><th>Fare</th><th>Status</th></tr></thead>
            <tbody>{orders.map((o) => (
              <tr key={o.id} style={o.sos ? { background: 'var(--danger-soft)' } : undefined}>
                <td><b>{o.id}</b></td><td>{VEHICLE_LABEL[o.vehicleType]?.en}</td><td>{o.pickup_addr.split(',')[0]}</td><td>{o.drop_addr.split(',')[0]}</td><td>{money(o.agreedFare ?? o.offeredFare)}</td><td>{statusChip(o.status)} {o.sos ? <span className="chip chip-danger">SOS</span> : null}</td>
              </tr>))}</tbody>
          </table>
        )}
      </section>
    </>
  );
}
