import { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import type { Socket } from 'socket.io-client';
import { Avatar, Spinner, useAction, useToast } from '@speedgo/ui';
import { fmtDistance, formatPhone, SERVICE_LABEL, VEHICLE_LABEL, type OrderDto, type OrderMeta, type ServiceType, type VehicleType } from '@speedgo/shared';
import { api, type AdminMe } from '../api';
import { Drawer, Empty, Pager, TableSkeleton, Tabs, mediaUrl, money, statusChip, useLiveRefresh, when } from '../kit';

const SearchBox = ({ q, setQ, ph }: { q: string; setQ: (s: string) => void; ph: string }) => (
  <div className="row" style={{ position: 'relative' }}><Search size={16} style={{ position: 'absolute', insetInlineStart: 14 }} color="var(--muted)" /><input className="input" style={{ paddingInlineStart: 38, minWidth: 260 }} placeholder={ph} value={q} onChange={(e) => setQ(e.target.value)} aria-label={ph} /></div>
);

// ---------------- Customers ----------------
interface Cust { id: number; avatar: string | null; name: string | null; phone: string; status: string; createdAt: number; trips: number; cancelled: number; rating_sum: number; rating_count: number }

export function Customers({ me, sock }: { me: AdminMe; sock: Socket | null }) {
  const toast = useToast();
  const { run } = useAction();
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<Cust[] | null>(null);
  const [total, setTotal] = useState(0);
  const limit = 25;
  const load = useCallback(() => {
    const p = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (q.trim()) p.set('q', q.trim());
    api.get<{ customers: Cust[]; total: number }>(`/api/admin/customers?${p}`).then((r) => { setRows(r.customers); setTotal(r.total); }).catch(() => setRows([]));
  }, [q, offset]);
  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);
  useLiveRefresh(sock, ['live:order'], load);
  const block = (c: Cust) => run(async () => {
    const blocked = c.status !== 'blocked';
    const reason = blocked ? prompt('Reason for blocking (kept in the audit log):') : '';
    if (blocked && !reason?.trim()) return;
    await api.post(`/api/admin/customers/${c.id}/status`, { blocked, reason });
    toast(blocked ? 'Customer blocked' : 'Customer unblocked'); load();
  });
  return (
    <>
      <div><h1 className="title">Customers</h1><div className="muted small">{total} registered customers</div></div>
      <SearchBox q={q} setQ={(s) => { setQ(s); setOffset(0); }} ph="Search name or phone" />
      <div className="table-wrap">
        {rows === null ? <TableSkeleton /> : rows.length === 0 ? <Empty title="No customers yet" sub="Customers appear here after they sign up in the Customer app." /> : (
          <table className="table"><thead><tr><th>Customer</th><th>Joined</th><th>Completed</th><th>Cancelled</th><th>Rating</th><th>Status</th><th /></tr></thead>
            <tbody>{rows.map((c) => (
              <tr key={c.id}><td><div className="row"><Avatar name={c.name} url={mediaUrl(c.avatar)} size={36} /><div><b>{c.name ?? 'Unnamed'}</b><br /><span className="small muted" dir="ltr">{formatPhone(c.phone)}</span></div></div></td><td>{when(c.createdAt)}</td><td>{c.trips}</td><td>{c.cancelled}</td><td>{c.rating_count ? `★ ${(c.rating_sum / c.rating_count).toFixed(1)}` : '-'}</td><td>{statusChip(c.status)}</td>
                <td>{me.permissions.includes('customers:manage') && <button className={`btn btn-sm ${c.status === 'blocked' ? '' : 'btn-danger-ghost'}`} onClick={() => block(c)}>{c.status === 'blocked' ? 'Unblock' : 'Block'}</button>}</td></tr>))}</tbody></table>
        )}
      </div>
      <Pager total={total} offset={offset} limit={limit} onChange={setOffset} />
    </>
  );
}

// ---------------- Rides ----------------
interface RideRow { id: number; bookingNo: string; service: ServiceType; meta: string | null; riderAvatar: string | null; driverAvatar: string | null; status: string; vehicleType: VehicleType; pickup: string; drop: string; distanceM: number; offeredFare: number; agreedFare: number | null; finalFare: number | null; commission: number | null; paymentStatus: string; createdAt: number; sos: number; riderName: string | null; riderPhone: string; driverName: string | null }
type RF = 'active' | 'completed' | 'cancelled' | 'no_driver' | 'all';
type SF = 'all' | ServiceType;

export function Rides({ me, sock }: { me: AdminMe; sock: Socket | null }) {
  const [f, setF] = useState<RF>('active');
  const [sv, setSv] = useState<SF>('all');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<RideRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const limit = 25;
  const load = useCallback(() => {
    const p = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (f !== 'all') p.set('status', f);
    if (sv !== 'all') p.set('service', sv);
    if (q.trim()) p.set('q', q.trim());
    api.get<{ orders: RideRow[]; total: number }>(`/api/admin/orders?${p}`).then((r) => { setRows(r.orders); setTotal(r.total); }).catch(() => setRows([]));
  }, [f, sv, q, offset]);
  useEffect(() => { setRows(null); const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);
  useLiveRefresh(sock, ['live:order', 'sos:new'], load);
  return (
    <>
      <div className="row between"><div><h1 className="title">Bookings</h1><div className="muted small">Rides, Pick & Drop and Deliveries, from first tap to cash collected. Updates live.</div></div>
        <span className="chip chip-ok"><i className="live-dot" /> Live</span></div>
      <Tabs value={sv} onChange={(v) => { setSv(v); setOffset(0); }} items={[{ v: 'all', label: 'All services' }, { v: 'ride', label: 'Rides' }, { v: 'pickup', label: 'Pick & Drop' }, { v: 'delivery', label: 'Delivery' }]} />
      <div className="row between" style={{ flexWrap: 'wrap' }}>
        <Tabs value={f} onChange={(v) => { setF(v); setOffset(0); }} items={[{ v: 'active', label: 'Active' }, { v: 'completed', label: 'Completed' }, { v: 'cancelled', label: 'Cancelled' }, { v: 'no_driver', label: 'No driver' }, { v: 'all', label: 'All' }]} />
        <SearchBox q={q} setQ={(s) => { setQ(s); setOffset(0); }} ph="Search booking no, name, phone, place" />
      </div>
      <div className="table-wrap">
        {rows === null ? <TableSkeleton /> : rows.length === 0 ? <Empty title="No rides here" /> : (
          <table className="table"><thead><tr><th>Booking</th><th>When</th><th>Customer</th><th>Driver</th><th>Route</th><th>Fare</th><th>Status</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className="click" onClick={() => setOpen(r.id)}>
                <td><b dir="ltr">{r.bookingNo}</b><br /><span className="chip chip-brand" style={{ fontSize: 11 }}>{SERVICE_LABEL[r.service].en}</span></td><td className="small">{when(r.createdAt)}</td><td><div className="row"><Avatar name={r.riderName} url={mediaUrl(r.riderAvatar)} size={30} /><div>{r.riderName}<br /><span className="small muted" dir="ltr">{formatPhone(r.riderPhone)}</span></div></div></td><td>{r.driverName ? <div className="row"><Avatar name={r.driverName} url={mediaUrl(r.driverAvatar)} size={30} />{r.driverName}</div> : <span className="muted">-</span>}</td>
                <td className="small">{r.pickup.split(',')[0]} → {r.drop.split(',')[0]}<br /><span className="muted">{fmtDistance(r.distanceM)} · {VEHICLE_LABEL[r.vehicleType]?.en}{r.meta ? ` · ${(JSON.parse(r.meta) as OrderMeta).item}` : ''}</span></td>
                <td><b>{money(r.finalFare ?? r.agreedFare ?? r.offeredFare)}</b></td><td>{statusChip(r.status)} {r.sos ? <span className="chip chip-danger">SOS</span> : null}</td></tr>))}</tbody></table>
        )}
      </div>
      <Pager total={total} offset={offset} limit={limit} onChange={setOffset} />
      {open && <RideDrawer id={open} me={me} onClose={() => setOpen(null)} onChange={load} />}
    </>
  );
}

function RideDrawer({ id, me, onClose, onChange }: { id: number; me: AdminMe; onClose: () => void; onChange: () => void }) {
  const toast = useToast();
  const { busy, run } = useAction();
  const [d, setD] = useState<{ order: OrderDto; events: { type: string; actor: string | null; data: string | null; at: number }[] } | null>(null);
  const load = useCallback(() => api.get<{ order: OrderDto; events: { type: string; actor: string | null; data: string | null; at: number }[] }>(`/api/admin/orders/${id}`).then(setD).catch(onClose), [id, onClose]);
  useEffect(() => { load(); }, [load]);
  const cancel = () => run(async () => {
    const reason = prompt('Reason for cancelling this ride (both users are told):');
    if (!reason || reason.trim().length < 3) return;
    await api.post(`/api/admin/orders/${id}/cancel`, { reason: reason.trim() });
    toast('Ride cancelled'); await load(); onChange();
  });
  const o = d?.order;
  return (
    <Drawer title={o ? `${SERVICE_LABEL[o.service].en} ${o.bookingNo}` : `Booking #${id}`} onClose={onClose}>
      {!o ? <Spinner /> : (
        <>
          <div className="row" style={{ flexWrap: 'wrap' }}>{statusChip(o.status)} {o.sos && <span className="chip chip-danger">SOS raised</span>} <span className="chip">{VEHICLE_LABEL[o.vehicleType].en}</span> {statusChip(o.paymentStatus)}</div>
          {o.meta && (
            <div className="card col small" style={{ gap: 4 }}>
              <b>{o.service === 'pickup' ? 'Collect and bring' : 'Parcel'}</b><div>{o.meta.item}</div>
              {o.meta.notes && <div className="muted">Note: {o.meta.notes}</div>}
              {(o.meta.receiverName || o.meta.receiverPhone) && <div className="muted">Receiver: {o.meta.receiverName} <span dir="ltr">{o.meta.receiverPhone ? formatPhone(o.meta.receiverPhone) : ''}</span></div>}
            </div>
          )}
          <div className="card col small" style={{ gap: 6 }}>
            <div><span className="muted">Pickup</span><br /><b>{o.pickup.addr}</b></div>
            <div><span className="muted">Destination</span><br /><b>{o.drop.addr}</b></div>
            <div className="row between"><span className="muted">Distance · time</span><b>{fmtDistance(o.distanceM)} · {Math.round(o.durationS / 60)} min</b></div>
          </div>
          <div className="card col small" style={{ gap: 6 }}>
            <b>Fare</b>
            <div className="row between"><span className="muted">Estimate</span><span>{money(o.estFare)}</span></div>
            <div className="row between"><span className="muted">Customer offered</span><span>{money(o.offeredFare)}</span></div>
            <div className="row between"><span className="muted">Agreed</span><span>{o.agreedFare ? money(o.agreedFare) : '-'}</span></div>
            <div className="row between"><span className="muted">Waiting charge</span><span>{money(o.waitingCharge)}</span></div>
            <div className="row between"><b>Final</b><b>{o.finalFare ? money(o.finalFare) : '-'}</b></div>
            <div className="row between"><span className="muted">Commission</span><span>{o.commission != null ? money(o.commission) : '-'}</span></div>
            {o.cancelFee > 0 && <div className="row between"><span className="muted">Cancellation fee (recorded)</span><span>{money(o.cancelFee)}</span></div>}
          </div>
          <div className="card col small" style={{ gap: 6 }}>
            <div className="row between"><span className="muted">Customer</span><b>{o.rider?.name} · <span dir="ltr">{o.rider?.phone ? formatPhone(o.rider.phone) : ''}</span></b></div>
            <div className="row between"><span className="muted">Driver</span><b>{o.driver ? `${o.driver.name} · ${o.driver.vehicle.plate}` : '-'}</b></div>
            {o.driverRating != null && <div className="row between"><span className="muted">Customer rated driver</span><b>★ {o.driverRating}</b></div>}
            {o.cancelledBy && <div className="row between"><span className="muted">Cancelled by</span><b>{o.cancelledBy}{o.cancelReason ? `: ${o.cancelReason}` : ''}</b></div>}
          </div>
          <b>Timeline</b>
          <div className="card col small" style={{ gap: 8 }}>
            {d!.events.map((e, i) => <div key={i} className="row between"><span><b>{e.type.replace(/_/g, ' ')}</b> <span className="muted">· {e.actor}</span></span><span className="muted">{new Date(e.at).toLocaleTimeString('en-PK')}</span></div>)}
          </div>
          {me.permissions.includes('rides:manage') && ['requested', 'accepted', 'arrived', 'in_progress'].includes(o.status) && <button className="btn btn-danger" disabled={busy} onClick={cancel}>Cancel this ride</button>}
        </>
      )}
    </Drawer>
  );
}
