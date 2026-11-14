import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Crosshair, Home, MapPin, MessageCircle, Navigation, Phone, Power, ShieldAlert, User, Wallet } from 'lucide-react';
import { MapView, Spinner, Stars, ThemeSwitch, useAction, useCountdown, useGeolocation, useI18n, useSocket, useSocketEvent, useToast, type MapLine, type MapMarker } from '@speedgo/ui';
import { fmtDistance, fmtDuration, formatPhone, formatPKR, VEHICLE_LABEL, type OrderDto, type RequestDto } from '@speedgo/shared';
import { api, type Me, type PublicConfig } from './App';
import { dict } from './strings';

type Tab = 'home' | 'earnings' | 'account';
interface Earn { today: Sum; week: Sum; month: Sum; daily: { day: string; trips: number; gross: number; commission: number; net: number }[]; wallet: number; ledger: { kind: string; amount: number; balance_after: number; note: string | null; at: number }[] }
interface Sum { trips: number; gross: number; commission: number; net: number }

let audio: AudioContext | null = null;
function beep() {
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.5);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.5);
  } catch { /* audio not allowed yet */ }
}

const navUrl = (p: { lat: number; lng: number }) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=driving`;

export function Drive({ me, token, cfg, refresh, onLogout }: { me: Me; token: string; cfg: PublicConfig; refresh: () => void; onLogout: () => void }) {
  const { t } = useI18n(dict);
  const toast = useToast();
  const { busy, run } = useAction();
  const { sock, connected } = useSocket(token);
  const { pos, error: geoError } = useGeolocation();
  const [tab, setTab] = useState<Tab>('home');
  const [online, setOnline] = useState(me.online);
  const [requests, setRequests] = useState<RequestDto[]>([]);
  const [sent, setSent] = useState<Set<number>>(new Set());
  const [order, setOrder] = useState<OrderDto | null>(me.activeOrder);
  const [sim, setSim] = useState<{ lat: number; lng: number } | null>(null);
  const [simMode, setSimMode] = useState(false);
  const [earn, setEarn] = useState<Earn | null>(null);
  const orderRef = useRef(order);
  orderRef.current = order;

  const dev = import.meta.env.DEV;
  const cityCentre = { lat: cfg.city.lat, lng: cfg.city.lng };
  const myPos = sim ?? pos ?? (dev ? cityCentre : null);
  const posRef = useRef(myPos);
  posRef.current = myPos;

  const loadEarn = useCallback(() => { api.get<Earn>('/api/driver/earnings').then(setEarn).catch(() => {}); }, []);
  useEffect(loadEarn, [loadEarn]);

  // ---- realtime
  useSocketEvent<RequestDto>(sock, 'order:new', (r) => {
    if (orderRef.current && ['accepted', 'arrived', 'in_progress'].includes(orderRef.current.status)) return;
    setRequests((cur) => { const n = cur.filter((x) => x.id !== r.id); if (!cur.some((x) => x.id === r.id)) beep(); return [...n, r].sort((a, b) => (a.pickupDistanceM ?? 0) - (b.pickupDistanceM ?? 0)); });
  });
  useSocketEvent<{ id: number }>(sock, 'order:gone', ({ id }) => setRequests((cur) => cur.filter((x) => x.id !== id)));
  useSocketEvent<OrderDto>(sock, 'order:update', (o) => {
    const cur = orderRef.current;
    if (cur?.id === o.id || o.status === 'accepted') {
      setOrder(o);
      if (o.status === 'accepted') { setRequests([]); setSent(new Set()); }
      if (o.status === 'completed') loadEarn();
    }
  });
  useSocketEvent<{ online?: boolean }>(sock, 'driver:status', (s) => { if (s.online === false) { setOnline(false); toast('You were taken offline (connection lost). Go online again.', 'error'); } });
  useEffect(() => { // after a reconnect, re-sync
    if (!connected) return;
    api.get<{ requests: RequestDto[] }>('/api/driver/requests').then((r) => online && !orderRef.current && setRequests(r.requests)).catch(() => {});
    api.get<Me>('/api/driver/me').then((m) => { setOnline(m.online); if (m.activeOrder) setOrder(m.activeOrder); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  // ---- share location while online (every 4 s)
  useEffect(() => {
    if (!online || !sock) return;
    const send = () => { const p = posRef.current; if (p) sock.emit('driver:location', { lat: p.lat, lng: p.lng }); };
    send();
    const id = setInterval(send, 4000);
    return () => clearInterval(id);
  }, [online, sock]);

  const toggleOnline = () => run(async () => {
    if (online && order && ['accepted', 'arrived', 'in_progress'].includes(order.status)) { toast('Finish your current ride first', 'error'); return; }
    if (!online && !myPos) { toast(geoError ?? 'Turn on location to go online', 'error'); return; }
    const r = await api.post<{ online: boolean; requests: RequestDto[] }>('/api/driver/online', { online: !online, location: myPos ?? undefined });
    setOnline(r.online);
    setRequests(r.requests);
    beep();
  });

  const offer = (req: RequestDto, price?: number) => run(async () => {
    await api.post(`/api/driver/orders/${req.id}/offer`, price ? { price } : {});
    setSent((s) => new Set(s).add(req.id));
  });
  const skip = (req: RequestDto) => { setRequests((c) => c.filter((x) => x.id !== req.id)); api.post(`/api/driver/orders/${req.id}/skip`).catch(() => {}); };

  const finishOrder = () => { setOrder(null); loadEarn(); refresh(); };

  // ---- map
  const markers = useMemo<MapMarker[]>(() => {
    const m: MapMarker[] = [];
    if (myPos) m.push({ id: 'me', lat: myPos.lat, lng: myPos.lng, kind: order ? 'car' : 'me' });
    if (order && ['accepted', 'arrived'].includes(order.status)) m.push({ id: 'pickup', lat: order.pickup.lat, lng: order.pickup.lng, kind: 'pickup' });
    if (order && ['accepted', 'arrived', 'in_progress'].includes(order.status)) m.push({ id: 'drop', lat: order.drop.lat, lng: order.drop.lng, kind: 'drop' });
    if (!order) for (const r of requests.slice(0, 5)) m.push({ id: `r${r.id}`, lat: r.pickup.lat, lng: r.pickup.lng, kind: 'order' });
    return m;
  }, [myPos, order, requests]);
  const lines = useMemo<MapLine[]>(() => {
    const l: MapLine[] = [];
    if (order && ['accepted', 'arrived', 'in_progress'].includes(order.status) && order.route.length > 1) l.push({ id: 'route', points: order.route, color: '#8b5cf6' });
    if (order && ['accepted'].includes(order.status) && myPos) l.push({ id: 'toPickup', points: [[myPos.lat, myPos.lng], [order.pickup.lat, order.pickup.lng]], color: '#22c55e', dashed: true, weight: 4 });
    return l;
  }, [order, myPos]);
  const fit = useMemo<[number, number][]>(() => {
    if (order && ['accepted', 'arrived'].includes(order.status) && myPos) return [[myPos.lat, myPos.lng], [order.pickup.lat, order.pickup.lng]];
    if (order?.status === 'in_progress') return order.route.length > 1 ? order.route : [[order.drop.lat, order.drop.lng]];
    return myPos ? [[myPos.lat, myPos.lng]] : [];
  }, [order?.id, order?.status, myPos?.lat, myPos?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  const lowWallet = me.minWallet > 0 && me.user.wallet < me.minWallet;
  const activeReq = !order ? requests[0] : undefined;

  return (
    <>
      <MapView center={myPos ? [myPos.lat, myPos.lng] : [cityCentre.lat, cityCentre.lng]} markers={markers} lines={lines} fit={fit} fitKey={`${order?.id ?? 0}-${order?.status ?? ''}-${myPos ? 1 : 0}`}
        recenterKey={`${online}`} padding={{ bottom: 330 }} onClick={simMode ? (p) => { setSim(p); setSimMode(false); } : undefined} />

      {/* top bar */}
      <div className="float row between" style={{ top: 14, left: 14, right: 14, alignItems: 'flex-start' }}>
        <button className="glass row" style={{ padding: '8px 14px 8px 8px', borderRadius: 999, border: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => setTab('account')}>
          <span className="avatar" style={{ width: 36, height: 36 }}>{(me.user.name ?? '?').slice(0, 2).toUpperCase()}</span>
          <b className="small">{me.user.name?.split(' ')[0]} · ★ {me.user.rating ?? 'New'}</b>
        </button>
        <div className="glass" style={{ padding: '8px 14px', borderRadius: 16, textAlign: 'end' }}><div className="small muted">Today</div><div className="bold" style={{ fontSize: 18 }}>{formatPKR(earn?.today.net ?? 0)}</div></div>
      </div>
      {!connected && <div className="float chip chip-warn" style={{ top: 70, left: 14 }}><Spinner size={14} /> Reconnecting…</div>}
      {lowWallet && <div className="float banner" style={{ top: 70, left: 14, right: 14 }}>Wallet is Rs {me.user.wallet}. You need Rs {me.minWallet} to receive rides. Ask SpeedGo to top up.</div>}
      {dev && (
        <button className="float btn btn-sm glass" style={{ top: 120, right: 14 }} onClick={() => setSimMode((s) => !s)} aria-pressed={simMode}>
          <Crosshair size={14} /> {simMode ? 'Tap the map…' : 'Move me (test)'}
        </button>
      )}
      {geoError && !sim && !dev && <div className="float banner" style={{ top: 70, left: 14, right: 14 }}>{geoError}</div>}

      {/* bottom */}
      {!order && !activeReq && (
        <div className="sheet" style={{ paddingBottom: 90 }}>
          <div className="sheet-grab" />
          <div className="row between">
            <div><div className="title" style={{ fontSize: 22 }}>{online ? t('youOnline') : t('youOffline')}</div><div className="muted small">{online ? t('waiting') : t('goOnlineHint')}</div></div>
            <span className={`chip ${online ? 'chip-ok' : ''}`}>{online ? 'ONLINE' : 'OFFLINE'}</span>
          </div>
          <button className={`btn btn-xl btn-block ${online ? 'btn-danger' : 'btn-ok'}`} style={{ marginTop: 14 }} disabled={busy} onClick={toggleOnline} aria-pressed={online}>
            {busy ? <Spinner /> : <><Power size={24} /> {online ? t('goOffline') : t('goOnline')}</>}
          </button>
        </div>
      )}
      {activeReq && <RequestCard key={activeReq.id} req={activeReq} more={requests.length - 1} sent={sent.has(activeReq.id)} busy={busy} onOffer={(p) => offer(activeReq, p)} onSkip={() => skip(activeReq)} />}
      {order && <Trip order={order} pos={myPos} onDone={finishOrder} onUpdate={setOrder} />}

      {tab === 'earnings' && <EarningsScreen earn={earn} reload={loadEarn} />}
      {tab === 'account' && <AccountScreen me={me} onLogout={onLogout} onClose={() => setTab('home')} />}

      <div className="tabbar">
        <button className={`tab ${tab === 'home' ? 'active' : ''}`} onClick={() => setTab('home')}><Home size={24} />{t('home')}</button>
        <button className={`tab ${tab === 'earnings' ? 'active' : ''}`} onClick={() => { setTab('earnings'); loadEarn(); }}><BarChart3 size={24} />{t('earnings')}</button>
        <button className={`tab ${tab === 'account' ? 'active' : ''}`} onClick={() => setTab('account')}><User size={24} />{t('account')}</button>
      </div>
    </>
  );
}

// ---------------- Incoming request ----------------
function RequestCard({ req, more, sent, busy, onOffer, onSkip }: { req: RequestDto; more: number; sent: boolean; busy: boolean; onOffer: (price?: number) => void; onSkip: () => void }) {
  const { t } = useI18n(dict);
  const left = useCountdown(req.expiresAt);
  const [price, setPrice] = useState(req.offeredFare);
  useEffect(() => setPrice(req.offeredFare), [req.offeredFare]);
  const total = Math.max(1, Math.round((req.expiresAt - Date.now()) / 1000) + 1);
  const ring = useRef(total);
  const pct = Math.min(1, left / Math.max(ring.current, left));
  const counter = price > req.offeredFare;
  return (
    <div className="sheet" style={{ paddingBottom: 90, background: 'var(--surface)' }}>
      <div className="sheet-grab" />
      <div className="row between">
        <div><div className="small bold" style={{ color: 'var(--brand)', letterSpacing: 1 }}>{t('newRequest')}{more > 0 && ` · +${more}`}</div><div className="small muted">{VEHICLE_LABEL[req.vehicleType].en} · cash</div></div>
        <div style={{ position: 'relative', width: 56, height: 56 }}>
          <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="24" fill="none" stroke="var(--border)" strokeWidth="5" /><circle cx="28" cy="28" r="24" fill="none" stroke="#f5c76b" strokeWidth="5" strokeLinecap="round" strokeDasharray={150.8} strokeDashoffset={150.8 * (1 - pct)} transform="rotate(-90 28 28)" /></svg>
          <b style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{left}</b>
        </div>
      </div>
      <div className="row" style={{ alignItems: 'baseline', margin: '6px 0' }}><span style={{ fontSize: 40, fontWeight: 800, letterSpacing: -1 }}>{formatPKR(req.offeredFare)}</span><span className="small" style={{ color: 'var(--ok)', fontWeight: 700 }}>rider's offer</span></div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        <span className="chip">Pickup {req.pickupDistanceM != null ? `${fmtDistance(req.pickupDistanceM)}` : ''}{req.pickupEtaS != null ? ` · ${fmtDuration(req.pickupEtaS)}` : ''}</span>
        <span className="chip">Trip {fmtDistance(req.distanceM)} · {fmtDuration(req.durationS)}</span>
        <span className="chip">★ {req.riderRating ?? 'New'} {req.riderName?.split(' ')[0]}</span>
      </div>
      <div className="card-flat col" style={{ margin: '12px 0', gap: 8 }}>
        <div className="row"><span style={{ width: 12, height: 12, borderRadius: '50%', background: '#22c55e', flex: 'none' }} /><b>{req.pickup.addr}</b></div>
        <div className="row"><span style={{ width: 12, height: 12, borderRadius: 3, background: '#f5c76b', flex: 'none' }} /><b>{req.drop.addr}</b></div>
      </div>
      {sent ? (
        <div className="center col" style={{ alignItems: 'center', padding: 8 }}><Spinner /><b>Offer sent: {formatPKR(price)}</b><span className="muted small">Waiting for the rider to choose…</span>
          <button className="btn btn-sm" onClick={onSkip}>Withdraw</button></div>
      ) : (
        <>
          <div className="row between card" style={{ padding: 6, marginBottom: 10 }}>
            <button className="btn icon-btn" onClick={() => setPrice((p) => Math.max(req.offeredFare, p - 10))} disabled={price <= req.offeredFare} aria-label="Lower price">−10</button>
            <div className="center"><div className="small muted">Your price</div><b style={{ fontSize: 20 }}>{formatPKR(price)}</b></div>
            <button className="btn icon-btn btn-tonal" onClick={() => setPrice((p) => Math.min(req.maxCounter, p + 10))} disabled={price >= req.maxCounter} aria-label="Raise price">+10</button>
          </div>
          <div className="row">
            <button className="btn btn-lg" style={{ width: 90 }} onClick={onSkip}>{t('skip')}</button>
            <button className="btn btn-ok btn-xl grow" disabled={busy} onClick={() => onOffer(counter ? price : undefined)}>{counter ? `Offer ${formatPKR(price)}` : t('accept')}</button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------- Active trip ----------------
type OrderSetter = (o: OrderDto) => void;
function Trip({ order, pos, onDone, onUpdate }: { order: OrderDto; pos: { lat: number; lng: number } | null; onDone: () => void; onUpdate: OrderSetter }) {
  const { t } = useI18n(dict);
  const toast = useToast();
  const { busy, run } = useAction();
  const [pin, setPin] = useState('');
  const [rating, setRating] = useState(0);
  const [rated, setRated] = useState(false);
  const act = (path: string, body?: unknown) => run(async () => { const r = await api.post<{ order: OrderDto }>(`/api/driver/orders/${order.id}/${path}`, body); onUpdate(r.order); return r.order; });
  const s = order.status;
  const rider = order.rider;
  const keep = order.finalFare != null ? order.finalFare - (order.commission ?? 0) : (order.agreedFare ?? order.offeredFare) - Math.round(((order.agreedFare ?? order.offeredFare) * 20) / 100);
  const sos = () => run(async () => { if (!confirm('Send an SOS alert to SpeedGo safety team?')) return; await api.post(`/api/driver/orders/${order.id}/sos`, { location: pos }); toast('SOS sent. The SpeedGo safety team has been alerted.'); });
  const waited = order.arrivedAt && !order.startedAt ? Math.floor((Date.now() - order.arrivedAt) / 60000) : 0;

  if (s === 'cancelled' || s === 'no_driver') {
    return (
      <div className="sheet center" style={{ paddingBottom: 90 }}>
        <div className="sheet-grab" />
        <div className="heading">Ride cancelled{order.cancelledBy === 'rider' ? ' by the rider' : ''}</div>
        <p className="muted" style={{ margin: '6px 0 14px' }}>{order.cancelReason ?? ''}</p>
        <button className="btn btn-primary btn-lg btn-block" onClick={onDone}>OK</button>
      </div>
    );
  }

  if (s === 'completed') {
    return (
      <div className="sheet" style={{ paddingBottom: 90 }}>
        <div className="sheet-grab" />
        <div className="center title">Ride complete</div>
        <div className="card col" style={{ margin: '12px 0', gap: 6 }}>
          <div className="row between"><span className="muted">Fare</span><b>{formatPKR(order.finalFare)}</b></div>
          {order.waitingCharge > 0 && <div className="row between"><span className="muted">Includes waiting</span><b>{formatPKR(order.waitingCharge)}</b></div>}
          <div className="row between"><span className="muted">SpeedGo commission</span><b style={{ color: 'var(--danger)' }}>− {formatPKR(order.commission)}</b></div>
          <div className="divider" />
          <div className="row between"><b>You keep</b><span className="price" style={{ color: 'var(--ok)' }}>{formatPKR(keep)}</span></div>
        </div>
        {order.paymentStatus === 'pending' ? (
          <>
            <div className="banner" style={{ marginBottom: 10 }}>Collect <b>{formatPKR(order.finalFare)}</b> in cash from the rider.</div>
            <button className="btn btn-ok btn-xl btn-block" disabled={busy} onClick={() => act('cash-confirm')}>{t('collectCash')}</button>
          </>
        ) : !rated ? (
          <>
            <div className="center bold">Rate {rider?.name?.split(' ')[0] ?? 'the rider'}</div>
            <Stars value={rating} onChange={setRating} />
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn grow" onClick={onDone}>Skip</button>
              <button className="btn btn-primary grow" disabled={!rating || busy} onClick={() => run(async () => { await api.post(`/api/driver/orders/${order.id}/rate`, { rating }); setRated(true); })}>Submit</button>
            </div>
          </>
        ) : <button className="btn btn-primary btn-xl btn-block" onClick={onDone}>{t('done')}</button>}
      </div>
    );
  }

  return (
    <div className="sheet" style={{ paddingBottom: 90 }}>
      <div className="sheet-grab" />
      <div className="row between" style={{ marginBottom: 8 }}>
        <div className="heading">{s === 'accepted' ? 'Go to pickup' : s === 'arrived' ? 'Waiting for the rider' : 'Ride in progress'}</div>
        <button className="btn btn-danger btn-sm" onClick={sos}><ShieldAlert size={16} /> SOS</button>
      </div>
      <div className="row">
        <span className="avatar" style={{ width: 52, height: 52 }}>{(rider?.name ?? '?').slice(0, 2).toUpperCase()}</span>
        <div className="grow"><div className="bold" style={{ fontSize: 17 }}>{rider?.name}</div><div className="small muted">★ {rider?.rating ?? 'New'}{rider?.phone && <> · <span dir="ltr">{formatPhone(rider.phone)}</span></>}</div></div>
        {rider?.phone && <a className="btn icon-btn" href={`tel:${rider.phone}`} aria-label="Call rider"><Phone size={22} /></a>}
        {rider?.phone && <a className="btn icon-btn" href={`sms:${rider.phone}`} aria-label="Message rider"><MessageCircle size={22} /></a>}
      </div>
      <div className="row between card-flat" style={{ margin: '10px 0' }}>
        <div><div className="small muted">Fare · cash</div><b style={{ fontSize: 20 }}>{formatPKR(order.agreedFare)}</b></div>
        <div style={{ textAlign: 'end' }}><div className="small muted">You keep</div><b style={{ fontSize: 20, color: 'var(--ok)' }}>{formatPKR(keep)}</b></div>
      </div>
      <div className="card col" style={{ gap: 8, fontSize: 14 }}>
        {s !== 'in_progress' && <div className="row"><MapPin size={16} color="var(--ok)" /><span className="grow">{order.pickup.addr}</span></div>}
        <div className="row"><Navigation size={16} /><span className="grow">{order.drop.addr}</span></div>
      </div>

      {s === 'accepted' && (
        <div className="col" style={{ marginTop: 12 }}>
          <a className="btn btn-lg btn-block" href={navUrl(order.pickup)} target="_blank" rel="noreferrer"><Navigation size={20} /> Navigate to pickup</a>
          <button className="btn btn-primary btn-xl btn-block" disabled={busy} onClick={() => act('arrived')}>{t('arrived')}</button>
          <button className="btn btn-danger-ghost btn-block" disabled={busy} onClick={() => { const r = prompt('Reason for cancelling?'); if (r && r.trim().length > 1) act('cancel', { reason: r.trim() }); }}>Cancel ride</button>
        </div>
      )}
      {s === 'arrived' && (
        <div className="col" style={{ marginTop: 12 }}>
          <div className="small muted center">Waiting {waited} min · first 2 minutes are free</div>
          <label className="field">Ask the rider for their 4-digit ride PIN
            <input className="input" style={{ fontSize: 28, textAlign: 'center', letterSpacing: 12, fontWeight: 800, minHeight: 64 }} inputMode="numeric" maxLength={4} dir="ltr" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} aria-label="Ride PIN" autoFocus />
          </label>
          <button className="btn btn-primary btn-xl btn-block" disabled={busy || pin.length !== 4} onClick={() => act('start', { pin }).then((o) => o && setPin(''))}>{t('startRide')}</button>
          <button className="btn btn-danger-ghost btn-block" disabled={busy} onClick={() => { const r = prompt('Reason for cancelling?'); if (r && r.trim().length > 1) act('cancel', { reason: r.trim() }); }}>Cancel ride</button>
        </div>
      )}
      {s === 'in_progress' && (
        <div className="col" style={{ marginTop: 12 }}>
          <a className="btn btn-lg btn-block" href={navUrl(order.drop)} target="_blank" rel="noreferrer"><Navigation size={20} /> Navigate to destination</a>
          <button className="btn btn-primary btn-xl btn-block" disabled={busy} onClick={() => { if (confirm('Complete this ride?')) act('complete'); }}>{t('completeRide')}</button>
        </div>
      )}
    </div>
  );
}

// ---------------- Earnings ----------------
function EarningsScreen({ earn, reload }: { earn: Earn | null; reload: () => void }) {
  const [range, setRange] = useState<'today' | 'week' | 'month'>('week');
  const sum = earn?.[range];
  const max = Math.max(1, ...(earn?.daily.map((d) => d.net) ?? [1]));
  useEffect(reload, [reload]);
  return (
    <div className="screen" style={{ position: 'absolute', inset: 0, zIndex: 650, background: 'var(--bg)', paddingBottom: 100 }}>
      <div className="row between"><h1 className="title">Earnings</h1>
        <div className="row" style={{ background: 'var(--surface2)', borderRadius: 999, padding: 4 }}>
          {(['today', 'week', 'month'] as const).map((r) => <button key={r} className="btn btn-sm" style={{ border: 0, borderRadius: 999, background: range === r ? 'var(--brand)' : 'transparent', color: range === r ? '#fff' : 'var(--muted)', textTransform: 'capitalize' }} onClick={() => setRange(r)}>{r === 'today' ? 'Day' : r}</button>)}
        </div></div>
      {!earn ? <div className="skeleton" style={{ height: 190 }} /> : (
        <div className="hero col" style={{ gap: 4, padding: 20 }}>
          <div className="small" style={{ color: '#ddd3fa' }}>You kept · {range === 'today' ? 'today' : range === 'week' ? 'last 7 days' : 'last 30 days'}</div>
          <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: -1 }}>{formatPKR(sum?.net)}</div>
          <div className="small" style={{ color: '#c9bdf2' }}>{sum?.trips} trip{sum?.trips === 1 ? '' : 's'}</div>
          <div className="row" style={{ alignItems: 'flex-end', height: 90, gap: 8, marginTop: 10 }}>
            {earn.daily.length === 0 && <span className="small" style={{ color: '#c9bdf2' }}>Complete a ride to see your daily chart.</span>}
            {earn.daily.map((d) => <div key={d.day} title={`${d.day}: ${formatPKR(d.net)}`} style={{ flex: '1 1 0', maxWidth: 44, height: `${Math.max(6, (d.net / max) * 100)}%`, background: '#f5c76b', borderRadius: '6px 6px 2px 2px' }} />)}
          </div>
        </div>
      )}
      <div className="card col" style={{ gap: 8 }}>
        <b className="small" style={{ color: 'var(--brand-text)' }}>Commission breakdown</b>
        <div className="row between"><span className="muted">Fares collected</span><b>{formatPKR(sum?.gross)}</b></div>
        <div className="row between"><span className="muted">SpeedGo commission</span><b style={{ color: 'var(--danger)' }}>− {formatPKR(sum?.commission)}</b></div>
        <div className="divider" />
        <div className="row between"><b>You kept</b><b>{formatPKR(sum?.net)}</b></div>
      </div>
      <div className="card row between"><div><div className="small muted">Wallet balance</div><div className="price">{formatPKR(earn?.wallet)}</div></div><Wallet size={32} color="var(--brand)" /></div>
      {earn && earn.ledger.length > 0 && (
        <div className="card col" style={{ gap: 6 }}>
          <b className="small muted">Wallet history</b>
          {earn.ledger.map((l, i) => <div key={i} className="row between small"><span>{l.note ?? l.kind}<br /><span className="muted">{new Date(l.at).toLocaleString('en-PK', { dateStyle: 'short', timeStyle: 'short' })}</span></span><b style={{ color: l.amount < 0 ? 'var(--danger)' : 'var(--ok)' }}>{l.amount < 0 ? '−' : '+'} {formatPKR(Math.abs(l.amount))}</b></div>)}
        </div>
      )}
    </div>
  );
}

// ---------------- Account ----------------
function AccountScreen({ me, onLogout, onClose }: { me: Me; onLogout: () => void; onClose: () => void }) {
  const { t, lang, setLang } = useI18n(dict);
  const [orders, setOrders] = useState<OrderDto[] | null>(null);
  useEffect(() => { api.get<{ orders: OrderDto[] }>('/api/driver/orders').then((r) => setOrders(r.orders)).catch(() => setOrders([])); }, []);
  const p = me.profile;
  return (
    <div className="screen" style={{ position: 'absolute', inset: 0, zIndex: 650, background: 'var(--bg)', paddingBottom: 100 }}>
      <div className="row between"><h1 className="title">{t('account')}</h1><button className="btn btn-sm" onClick={onClose}>Close</button></div>
      <div className="card row"><span className="avatar" style={{ width: 60, height: 60 }}>{(me.user.name ?? '?').slice(0, 2).toUpperCase()}</span>
        <div className="grow"><b style={{ fontSize: 18 }}>{me.user.name}</b><div className="small muted" dir="ltr">{formatPhone(me.user.phone)}</div><div className="small">★ {me.user.rating ?? 'New'}</div></div></div>
      <div className="card col small" style={{ gap: 6 }}>
        <b>Vehicle</b>
        <div className="row between"><span className="muted">Type</span><b>{p.vehicleType ? VEHICLE_LABEL[p.vehicleType].en : '-'}</b></div>
        <div className="row between"><span className="muted">Model</span><b>{p.color} {p.model} {p.year}</b></div>
        <div className="row between"><span className="muted">Plate</span><b dir="ltr">{p.plate}</b></div>
        <div className="row between"><span className="muted">CNIC</span><b dir="ltr">{p.cnic}</b></div>
      </div>
      <div className="card col" style={{ gap: 12 }}>
        <div className="row between"><b>{t('language')}</b><div className="row"><button className={`btn btn-sm ${lang === 'en' ? 'btn-tonal' : ''}`} onClick={() => setLang('en')}>English</button><button className={`btn btn-sm ${lang === 'ur' ? 'btn-tonal' : ''}`} onClick={() => setLang('ur')}>اردو</button></div></div>
        <div className="row between"><b>{t('theme')}</b><ThemeSwitch /></div>
      </div>
      <div className="col"><b>Recent rides</b>
        {orders === null && <div className="skeleton" style={{ height: 70 }} />}
        {orders?.length === 0 && <div className="muted small">No rides yet.</div>}
        {orders?.map((o) => <div key={o.id} className="card small"><div className="row between"><b>{new Date(o.createdAt).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })}</b><span className={`chip ${o.status === 'completed' ? 'chip-ok' : 'chip-danger'}`}>{o.status.replace('_', ' ')}</span></div>
          <div style={{ marginTop: 4 }}>{o.pickup.addr.split(',')[0]} → {o.drop.addr.split(',')[0]}</div><div className="row between muted"><span>{fmtDistance(o.distanceM)}</span><b style={{ color: 'var(--text)' }}>{formatPKR(o.finalFare ?? o.agreedFare)}</b></div></div>)}
      </div>
      <button className="btn btn-danger-ghost btn-block" onClick={onLogout}>{t('logout')}</button>
      <div className="small muted center">Powered by Digital Target</div>
    </div>
  );
}
