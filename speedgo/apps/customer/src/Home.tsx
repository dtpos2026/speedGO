import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Car, ChevronRight, Clock, Crosshair, History, LogOut, MapPin, Menu, MessageCircle, Minus, Navigation, Package, Phone, Plus, Search, Settings, Share2, ShieldAlert, ShoppingBag, X } from 'lucide-react';
import {
  Avatar, MapView, ProfileCard, Spinner, Stars, ThemeSwitch, useAction, useCountdown, useGeolocation, useI18n, useSocket, useSocketEvent, useToast, type MapLine, type MapMarker,
} from '@speedgo/ui';
import {
  fmtDistance, fmtDuration, formatPhone, formatPKR, haversineM, SERVICE_LABEL, SERVICE_TYPES, VEHICLE_LABEL, type EstimateResponse, type OfferDto, type OrderDto, type Place, type ServiceType, type UserDto, type VehicleType,
} from '@speedgo/shared';
import { api } from './App';
import { dict } from './strings';

interface Cfg { city: { lat: number; lng: number; name: string } }
type Step = 'idle' | 'search' | 'goods' | 'choose';
interface Goods { item: string; notes: string; receiverName: string; receiverPhone: string }
const NO_GOODS: Goods = { item: '', notes: '', receiverName: '', receiverPhone: '' };

const RATING_TAGS = ['Clean car', 'Safe driving', 'Good route', 'Polite'];

export function Home({ cfg, user, token, onUser, onLogout }: { cfg: Cfg; user: UserDto; token: string; onUser: (u: UserDto) => void; onLogout: () => void }) {
  const { t } = useI18n(dict);
  const toast = useToast();
  const { busy, run } = useAction();
  const { sock, connected } = useSocket(token);
  const { pos, error: geoError } = useGeolocation();

  const [order, setOrder] = useState<OrderDto | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const [service, setService] = useState<ServiceType>('ride');
  const [goods, setGoods] = useState<Goods>(NO_GOODS);
  const [searchFor, setSearchFor] = useState<'pickup' | 'drop'>('drop');
  const [pickup, setPickup] = useState<Place | null>(null);
  const [drop, setDrop] = useState<Place | null>(null);
  const [mapPick, setMapPick] = useState<'pickup' | 'drop' | null>(null);
  const [estimate, setEstimate] = useState<EstimateResponse | null>(null);
  const [vehicle, setVehicle] = useState<VehicleType>('mini');
  const [offer, setOffer] = useState(0);
  const [driverPos, setDriverPos] = useState<{ lat: number; lng: number; heading: number | null } | null>(null);
  const [menu, setMenu] = useState(false);
  const [rating, setRating] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [rated, setRated] = useState(false);
  const orderRef = useRef<OrderDto | null>(null);
  orderRef.current = order;

  // ---- restore an active ride after refresh
  useEffect(() => {
    api.get<{ activeOrder: OrderDto | null; user: UserDto }>('/api/rider/me').then((r) => { onUser(r.user); if (r.activeOrder) setOrder(r.activeOrder); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- realtime
  useSocketEvent<OrderDto>(sock, 'order:update', (o) => {
    const cur = orderRef.current;
    if (!cur || cur.id === o.id) setOrder(o);
  });
  useSocketEvent<OfferDto>(sock, 'offer:new', (of) => {
    setOrder((cur) => {
      if (!cur || cur.id !== of.orderId) return cur;
      const offers = [...(cur.offers ?? []).filter((x) => x.driver.id !== of.driver.id), of].sort((a, b) => a.price - b.price);
      return { ...cur, offers };
    });
  });
  useSocketEvent<{ orderId: number; lat: number; lng: number; heading: number | null }>(sock, 'driver:location', (p) => {
    if (orderRef.current?.id === p.orderId) setDriverPos({ lat: p.lat, lng: p.lng, heading: p.heading });
  });
  // after a reconnect, re-sync the ride we may have missed updates for
  useEffect(() => {
    if (!connected) return;
    api.get<{ order: OrderDto | null }>('/api/rider/orders/active').then((r) => { if (r.order) setOrder(r.order); }).catch(() => {});
  }, [connected]);

  // ---- pickup from GPS (or the city centre when GPS is unavailable)
  const reverse = useCallback(async (p: { lat: number; lng: number }): Promise<string> => {
    try { return (await api.get<{ addr: string }>(`/api/geo/reverse?lat=${p.lat}&lng=${p.lng}`)).addr; } catch { return `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`; }
  }, []);
  const gpsSet = useRef(false);
  useEffect(() => {
    if (!pos || gpsSet.current || pickup) return;
    gpsSet.current = true;
    reverse(pos).then((addr) => setPickup({ ...pos, addr }));
  }, [pos, pickup, reverse]);
  useEffect(() => {
    if (pickup || !geoError) return;
    setPickup({ lat: cfg.city.lat, lng: cfg.city.lng, addr: `${cfg.city.name} (tap the map to set your exact pickup)` });
  }, [geoError, pickup, cfg.city]);

  const onMapClick = async (p: { lat: number; lng: number }) => {
    if (order || !mapPick) return;
    const addr = await reverse(p);
    if (mapPick === 'pickup') setPickup({ ...p, addr });
    else { setDrop({ ...p, addr }); if (service === 'ride') setStep('choose'); }
    if (service !== 'ride') setStep('goods');
    setMapPick(null);
  };

  // ---- estimate when both points are known
  useEffect(() => {
    if (step !== 'choose' || !pickup || !drop) return;
    setEstimate(null);
    api.post<EstimateResponse>('/api/rider/estimate', { pickup, drop, service })
      .then((e) => {
        setEstimate(e);
        const pref = service === 'ride' ? 'mini' : 'bike';
        const v = e.estimates.find((x) => x.vehicleType === pref) ? pref : e.estimates[0]?.vehicleType;
        if (v) { setVehicle(v); setOffer(e.estimates.find((x) => x.vehicleType === v)!.fare); }
      })
      .catch((e) => { toast(e.message, 'error'); setStep(service === 'ride' ? 'idle' : 'goods'); if (service === 'ride') setDrop(null); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, pickup?.lat, pickup?.lng, drop?.lat, drop?.lng]);

  const est = estimate?.estimates.find((x) => x.vehicleType === vehicle);
  const pickVehicle = (v: VehicleType) => { setVehicle(v); const e = estimate?.estimates.find((x) => x.vehicleType === v); if (e) setOffer(e.fare); };
  const stepOffer = (d: number) => est && setOffer((o) => Math.min(est.maxOffer, Math.max(est.minOffer, o + d)));

  const requestRide = () => run(async () => {
    if (!pickup || !drop) return;
    const r = await api.post<{ order: OrderDto }>('/api/rider/orders', {
      service, vehicleType: vehicle, pickup, drop, offeredFare: offer,
      ...(service !== 'ride' ? { meta: { item: goods.item.trim(), notes: goods.notes.trim() || undefined, receiverName: goods.receiverName.trim() || undefined, receiverPhone: goods.receiverPhone.trim() || undefined } } : {}),
    });
    setOrder(r.order); setDriverPos(null); setRated(false); setRating(0); setTags([]);
  });

  const reset = () => { setOrder(null); setStep('idle'); setDrop(null); setGoods(NO_GOODS); setEstimate(null); setDriverPos(null); setRating(0); setTags([]); setRated(false); };
  const cancel = () => run(async () => {
    if (!order) return;
    if (!confirm(order.status === 'requested' ? 'Cancel this request?' : 'Cancel this ride? A fee may apply if the driver already arrived.')) return;
    await api.post(`/api/rider/orders/${order.id}/cancel`, { reason: 'Cancelled by rider' });
  });

  // ---- map content
  const markers = useMemo<MapMarker[]>(() => {
    const m: MapMarker[] = [];
    const a = order ? order.pickup : pickup;
    const b = order ? order.drop : drop;
    if (a) m.push({ id: 'pickup', lat: a.lat, lng: a.lng, kind: 'pickup' });
    if (b) m.push({ id: 'drop', lat: b.lat, lng: b.lng, kind: 'drop' });
    if (pos && !order) m.push({ id: 'me', lat: pos.lat, lng: pos.lng, kind: 'me' });
    const d = order?.driver;
    const dp = driverPos ?? (d?.lat != null && d?.lng != null ? { lat: d.lat, lng: d.lng, heading: d.heading } : null);
    if (order && ['accepted', 'arrived', 'in_progress'].includes(order.status) && dp) m.push({ id: 'car', lat: dp.lat, lng: dp.lng, kind: 'car', heading: dp.heading });
    return m;
  }, [order, pickup, drop, pos, driverPos]);

  const lines = useMemo<MapLine[]>(() => {
    const route = order?.route ?? estimate?.route;
    return route && route.length > 1 ? [{ id: 'route', points: route, color: '#8b5cf6' }] : [];
  }, [order, estimate]);

  const fitPts = useMemo<[number, number][]>(() => {
    const r = order?.route ?? estimate?.route;
    if (r && r.length > 1 && (order || step === 'choose')) return r;
    return pickup ? [[pickup.lat, pickup.lng]] : [];
  }, [order, estimate, step, pickup]);
  const fitKey = `${order?.id ?? 0}-${order ? 1 : 0}-${step}-${estimate ? 1 : 0}-${pickup ? 1 : 0}`;

  const center: [number, number] = pickup ? [pickup.lat, pickup.lng] : [cfg.city.lat, cfg.city.lng];

  // ---- derived trip info
  const distToDriver = order?.driver && driverPos ? haversineM(driverPos, order.pickup) : null;
  const etaMin = distToDriver != null ? Math.max(1, Math.round(distToDriver / 6 / 60)) : null;

  return (
    <>
      <MapView center={center} markers={markers} lines={lines} fit={fitPts} fitKey={fitKey} recenterKey={pickup ? `${pickup.lat}${pickup.lng}` : 'c'} padding={{ bottom: 360 }} onClick={onMapClick} />

      {/* top bar */}
      <div className="float row between" style={{ top: 16, left: 16, right: 16 }}>
        <button className="btn icon-btn glass" onClick={() => setMenu(true)} aria-label="Menu"><Menu size={22} /></button>
        {mapPick ? (
          <div className="glass chip" style={{ padding: '10px 16px' }}><Crosshair size={14} /> {mapPick === 'pickup' ? (service === 'ride' ? t('tapMap') : `Tap the map: ${SERVICE_LABEL[service].from}`) : `Tap the map: ${SERVICE_LABEL[service].to}`}</div>
        ) : (
          !connected && <div className="chip chip-warn"><Spinner size={14} /> Reconnecting…</div>
        )}
        {mapPick ? <button className="btn icon-btn glass" onClick={() => setMapPick(null)} aria-label="Cancel"><X size={20} /></button> : <span style={{ width: 48 }} />}
      </div>

      {/* bottom content */}
      {!mapPick && (
        <>
          {!order && step === 'idle' && <IdleSheet pickup={pickup} service={service} onService={(sv) => { setService(sv); setDrop(null); setEstimate(null); }}
            onSearch={() => { setSearchFor('drop'); setStep('search'); }} onPickOnMap={() => setMapPick('pickup')}
            onStartGoods={() => { if (service === 'pickup' && pos && !drop) reverse(pos).then((addr) => setDrop({ ...pos, addr })); setStep('goods'); }} />}
          {!order && step === 'search' && (
            <SearchSheet
              near={pickup ?? { lat: cfg.city.lat, lng: cfg.city.lng }}
              onBack={() => setStep(service === 'ride' ? 'idle' : 'goods')}
              onMapPick={() => { setMapPick(searchFor); }}
              onPick={(p) => { if (searchFor === 'pickup') setPickup(p); else setDrop(p); setStep(service === 'ride' ? 'choose' : 'goods'); }}
            />
          )}
          {!order && step === 'goods' && (
            <GoodsSheet service={service} pickup={pickup} drop={drop} goods={goods} setGoods={setGoods}
              onChange={(which) => { setSearchFor(which); setStep('search'); }} onBack={() => { setStep('idle'); setDrop(null); }}
              onNext={() => setStep('choose')} />
          )}
          {!order && step === 'choose' && (
            <div className="sheet">
              <div className="sheet-grab" />
              <div className="row between" style={{ marginBottom: 8 }}>
                <div className="heading">{service === 'ride' ? t('chooseRide') : 'Choose a vehicle'}</div>
                <div className="row">
                  {estimate && <span className="muted small">{fmtDistance(estimate.distanceM)} · {fmtDuration(estimate.durationS)}</span>}
                  <button className="btn btn-sm" onClick={() => { setEstimate(null); if (service === 'ride') { setStep('idle'); setDrop(null); } else setStep('goods'); }}>Change</button>
                </div>
              </div>
              {!estimate ? (
                <div className="col">{[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 62 }} />)}</div>
              ) : (
                <>
                  <div className="col" style={{ gap: 8 }}>
                    {estimate.estimates.map((e) => {
                      const l = VEHICLE_LABEL[e.vehicleType];
                      const sel = e.vehicleType === vehicle;
                      return (
                        <button key={e.vehicleType} className={`list-item ${sel ? 'selected' : ''}`} onClick={() => pickVehicle(e.vehicleType)} aria-pressed={sel}>
                          <span className="avatar" style={{ borderRadius: 14, background: sel ? 'rgba(255,255,255,.14)' : undefined, color: sel ? '#f5c76b' : undefined }}><Car size={22} /></span>
                          <span className="grow"><b>{l.en}</b><br /><span className="small" style={{ opacity: 0.75 }}>{l.seats} seat{l.seats > 1 ? 's' : ''} · {l.hint}</span></span>
                          <span className="bold">{formatPKR(e.fare)}{e.breakdown.peakMultiplier > 1 && <><br /><span className="small" style={{ color: 'var(--gold)' }}>Busy time ×{e.breakdown.peakMultiplier}</span></>}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="row between card" style={{ marginTop: 12, padding: 8 }}>
                    <button className="btn icon-btn" onClick={() => stepOffer(-10)} aria-label="Lower offer by 10 rupees" disabled={!est || offer <= est.minOffer}><Minus size={18} /></button>
                    <div className="center">
                      <div className="small muted">{t('yourOffer')}</div>
                      <div className="price">{formatPKR(offer)}</div>
                      <div className="small" style={{ color: est && offer < est.fare ? 'var(--warn)' : 'var(--ok)', fontWeight: 700 }}>{est && offer < est.fare ? 'Below suggested: fewer drivers may accept' : est && offer > est.fare ? 'Above suggested: faster pickup' : 'Suggested fare'}</div>
                    </div>
                    <button className="btn icon-btn btn-tonal" onClick={() => stepOffer(10)} aria-label="Raise offer by 10 rupees" disabled={!est || offer >= est.maxOffer}><Plus size={18} /></button>
                  </div>
                  <div className="row small muted" style={{ marginTop: 8 }}>Payment: <b style={{ color: 'var(--text)' }}>Cash to driver</b> · Easypaisa and JazzCash coming later</div>
                  <button className="btn btn-primary btn-lg btn-block" style={{ marginTop: 12 }} disabled={busy} onClick={requestRide}>{busy ? <Spinner /> : `${t('findDrivers')} · ${formatPKR(offer)}`}</button>
                </>
              )}
            </div>
          )}

          {order && <OrderSheet order={order} etaMin={etaMin} busy={busy} onCancel={cancel} onReset={reset} run={run}
            rating={rating} setRating={setRating} tags={tags} setTags={setTags} rated={rated} setRated={setRated} pos={pos} />}
        </>
      )}

      {menu && <MenuSheet user={user} onUser={onUser} onClose={() => setMenu(false)} onLogout={onLogout} />}
    </>
  );
}

// ---------------- Sheets ----------------

function IdleSheet({ pickup, service, onService, onSearch, onPickOnMap, onStartGoods }: { pickup: Place | null; service: ServiceType; onService: (s: ServiceType) => void; onSearch: () => void; onPickOnMap: () => void; onStartGoods: () => void }) {
  const { t } = useI18n(dict);
  return (
    <div className="sheet">
      <div className="sheet-grab" />
      <ServiceTabs service={service} onService={onService} />
      {service !== 'ride' ? (
        <button className="list-item" style={{ minHeight: 58 }} onClick={onStartGoods}>
          {service === 'pickup' ? <ShoppingBag size={22} color="var(--brand)" /> : <Package size={22} color="var(--brand)" />}
          <span className="grow"><b style={{ fontSize: 17 }}>{service === 'pickup' ? 'What should we bring you?' : 'What are you sending?'}</b><br /><span className="small muted">{SERVICE_LABEL[service].hint}</span></span>
          <ChevronRight size={18} />
        </button>
      ) : <>
      <button className="list-item" style={{ minHeight: 58 }} onClick={onSearch}>
        <Search size={22} color="var(--brand)" />
        <span className="grow heading" style={{ fontSize: 19 }}>{t('whereTo')}</span>
        <span className="chip chip-brand"><Clock size={13} /> Now</span>
      </button>
      <div className="row" style={{ marginTop: 12 }}>
        <MapPin size={18} color="var(--ok)" />
        <div className="grow small"><span className="muted">{t('pickup')}</span><br /><b>{pickup ? pickup.addr : <span className="muted">Finding your location…</span>}</b></div>
        <button className="btn btn-sm" onClick={onPickOnMap}><Crosshair size={14} /> Set on map</button>
      </div>
      </>}
    </div>
  );
}

function ServiceTabs({ service, onService }: { service: ServiceType; onService: (s: ServiceType) => void }) {
  const icons = { ride: <Car size={18} />, pickup: <ShoppingBag size={18} />, delivery: <Package size={18} /> };
  return (
    <div className="row" style={{ gap: 8, marginBottom: 12 }} role="tablist" aria-label="Service">
      {SERVICE_TYPES.map((sv) => (
        <button key={sv} role="tab" aria-selected={service === sv} className={`btn grow ${service === sv ? 'btn-primary' : ''}`} style={{ flexDirection: 'column', gap: 2, minHeight: 62, fontSize: 12.5, padding: '6px 4px' }} onClick={() => onService(sv)}>
          {icons[sv]}{SERVICE_LABEL[sv].en}
        </button>
      ))}
    </div>
  );
}

function GoodsSheet({ service, pickup, drop, goods, setGoods, onChange, onBack, onNext }: {
  service: ServiceType; pickup: Place | null; drop: Place | null; goods: Goods; setGoods: (g: Goods) => void; onChange: (w: 'pickup' | 'drop') => void; onBack: () => void; onNext: () => void;
}) {
  const L = SERVICE_LABEL[service];
  const ok = !!pickup && !!drop && goods.item.trim().length >= 2 && (service !== 'delivery' || goods.receiverPhone.trim().length >= 10);
  const set = (k: keyof Goods) => (e: { target: { value: string } }) => setGoods({ ...goods, [k]: e.target.value });
  return (
    <div className="sheet" style={{ maxHeight: '92%', overflowY: 'auto' }}>
      <div className="sheet-grab" />
      <div className="row between" style={{ marginBottom: 10 }}>
        <div className="heading">{L.en}</div>
        <button className="btn icon-btn" onClick={onBack} aria-label="Back"><X size={20} /></button>
      </div>
      <div className="card col" style={{ gap: 10 }}>
        <div className="row"><MapPin size={18} color="var(--ok)" /><div className="grow small"><span className="muted">{L.from}</span><br /><b>{pickup ? pickup.addr : <span className="muted">Not set</span>}</b></div><button className="btn btn-sm" onClick={() => onChange('pickup')}>{pickup ? 'Change' : 'Set'}</button></div>
        <div className="divider" />
        <div className="row"><Navigation size={18} color="var(--brand)" /><div className="grow small"><span className="muted">{L.to}</span><br /><b>{drop ? drop.addr : <span className="muted">Not set</span>}</b></div><button className="btn btn-sm" onClick={() => onChange('drop')}>{drop ? 'Change' : 'Set'}</button></div>
      </div>
      <div className="col" style={{ gap: 10, marginTop: 12 }}>
        <label className="field">{service === 'pickup' ? 'What should the driver collect?' : 'What are you sending?'}
          <input className="input" maxLength={200} placeholder={service === 'pickup' ? 'e.g. 2 biryani from Rana Hotel' : 'e.g. Documents envelope'} value={goods.item} onChange={set('item')} /></label>
        <label className="field">Notes for the driver (optional)
          <input className="input" maxLength={300} placeholder="Shop name, floor, how to find the place…" value={goods.notes} onChange={set('notes')} /></label>
        {service === 'delivery' && (
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <label className="field grow">Receiver name<input className="input" maxLength={60} value={goods.receiverName} onChange={set('receiverName')} /></label>
            <label className="field grow">Receiver mobile<input className="input" inputMode="tel" dir="ltr" placeholder="0300 1234567" value={goods.receiverPhone} onChange={set('receiverPhone')} /></label>
          </div>
        )}
        <div className="small muted">Payment: <b style={{ color: 'var(--text)' }}>Cash to the driver</b>. {service === 'pickup' ? 'You pay the shop price to the driver only if you agreed it with them; the fare here is for the trip.' : 'The fare here is for the delivery trip.'}</div>
      </div>
      <button className="btn btn-primary btn-lg btn-block" style={{ marginTop: 12 }} disabled={!ok} onClick={onNext}>Choose vehicle and fare</button>
    </div>
  );
}

function SearchSheet({ near, onBack, onPick, onMapPick }: { near: { lat: number; lng: number }; onBack: () => void; onPick: (p: Place) => void; onMapPick: () => void }) {
  const { t } = useI18n(dict);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [recent, setRecent] = useState<Place[]>([]);
  useEffect(() => {
    api.get<{ orders: OrderDto[] }>('/api/rider/orders').then((r) => {
      const seen = new Set<string>();
      const out: Place[] = [];
      for (const o of r.orders) if (!seen.has(o.drop.addr)) { seen.add(o.drop.addr); out.push(o.drop); }
      setRecent(out.slice(0, 4));
    }).catch(() => {});
  }, []);
  useEffect(() => {
    if (q.trim().length < 3) { setResults([]); return; }
    setLoading(true);
    const id = setTimeout(() => {
      api.get<{ results: { lat: number; lng: number; addr: string; name: string }[]; unavailable?: boolean }>(`/api/geo/search?q=${encodeURIComponent(q)}`)
        .then((r) => { setResults(r.results.map((x) => ({ lat: x.lat, lng: x.lng, addr: x.name + ', ' + x.addr.split(',').slice(1, 3).join(',') }))); setUnavailable(!!r.unavailable); })
        .catch(() => setUnavailable(true))
        .finally(() => setLoading(false));
    }, 500);
    return () => clearTimeout(id);
  }, [q]);
  void near;
  return (
    <div className="sheet" style={{ maxHeight: '92%', height: '78%' }}>
      <div className="sheet-grab" />
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="btn icon-btn" onClick={onBack} aria-label="Back"><X size={20} /></button>
        <input className="input" autoFocus placeholder={t('searchPlaces')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('destination')} />
      </div>
      <button className="list-item" onClick={onMapPick}><Crosshair size={20} color="var(--brand)" /><span className="grow bold">{t('chooseOnMap')}</span><ChevronRight size={18} /></button>
      <div className="col" style={{ marginTop: 10, gap: 6 }}>
        {loading && <div className="row muted"><Spinner size={16} /> Searching…</div>}
        {unavailable && <div className="banner">Address search is not available right now. Use "{t('chooseOnMap')}".</div>}
        {results.map((r, i) => (
          <button key={i} className="list-item" onClick={() => onPick(r)}><MapPin size={18} color="var(--muted)" /><span className="grow small"><b>{r.addr.split(',')[0]}</b><br /><span className="muted">{r.addr.split(',').slice(1).join(',')}</span></span></button>
        ))}
        {!q && recent.length > 0 && <div className="small muted bold" style={{ marginTop: 6 }}>Recent</div>}
        {!q && recent.map((r, i) => (
          <button key={i} className="list-item" onClick={() => onPick(r)}><History size={18} color="var(--muted)" /><span className="grow small"><b>{r.addr.split(',')[0]}</b></span></button>
        ))}
      </div>
    </div>
  );
}

type Run = <T,>(fn: () => Promise<T>) => Promise<T | undefined>;

function OrderSheet(props: {
  order: OrderDto; etaMin: number | null; busy: boolean; onCancel: () => void; onReset: () => void; run: Run;
  rating: number; setRating: (n: number) => void; tags: string[]; setTags: (t: string[]) => void; rated: boolean; setRated: (b: boolean) => void; pos: { lat: number; lng: number } | null;
}) {
  const { order, etaMin, busy, onCancel, onReset, run, rating, setRating, tags, setTags, rated, setRated, pos } = props;
  const { t } = useI18n(dict);
  const toast = useToast();
  const left = useCountdown(order.expiresAt);
  const ttl = order.expiresAt ? Math.max(1, Math.round((order.expiresAt - order.createdAt) / 1000)) : 90;

  const acceptOffer = (o: OfferDto) => run(async () => { await api.post(`/api/rider/orders/${order.id}/accept-offer`, { offerId: o.id }); });
  const raise = () => run(async () => { await api.post(`/api/rider/orders/${order.id}/offer`, { fare: order.offeredFare + 20 }); toast(`Offer raised to ${formatPKR(order.offeredFare + 20)}`); });
  const sos = () => run(async () => {
    if (!confirm('Send an SOS alert to SpeedGo safety team?')) return;
    await api.post(`/api/rider/orders/${order.id}/sos`, { location: pos });
    toast('SOS sent. The SpeedGo safety team has been alerted.');
  });
  const share = async () => {
    const d = order.driver;
    const text = `I'm riding with SpeedGo. Driver: ${d?.name ?? ''}, ${d?.vehicle.color ?? ''} ${d?.vehicle.model ?? ''} (${d?.vehicle.plate ?? ''}). From ${order.pickup.addr} to ${order.drop.addr}.`;
    try { if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(text); toast('Trip details copied'); } } catch { /* user cancelled */ }
  };
  const submitRating = () => run(async () => { await api.post(`/api/rider/orders/${order.id}/rate`, { rating, tags }); setRated(true); });

  const s = order.status;
  const d = order.driver;

  if (s === 'requested') {
    const offers = (order.offers ?? []) as OfferDto[];
    return (
      <div className="sheet" style={{ height: '70%' }}>
        <div className="sheet-grab" />
        <div className="row between">
          <div><div className="heading">{offers.length ? `${offers.length} driver${offers.length > 1 ? 's' : ''} replied` : t('searching')}</div>
            <div className="small muted">{order.bookingNo} · {VEHICLE_LABEL[order.vehicleType].en} · your offer {formatPKR(order.offeredFare)}</div>
            {order.meta?.item && <div className="small" style={{ marginTop: 2 }}><b>{SERVICE_LABEL[order.service].en}:</b> {order.meta.item}</div>}</div>
          <span className="chip chip-brand" dir="ltr">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span>
        </div>
        <div className="progress" style={{ margin: '10px 0' }}><i style={{ animation: `sg-bar ${ttl}s linear forwards`, animationDelay: `-${Math.max(0, ttl - left)}s` }} /></div>
        {offers.length === 0 && <div className="radar" style={{ margin: '14px auto' }}><i /><i /><b /></div>}
        <div className="col" style={{ gap: 8 }}>
          {offers.map((o) => (
            <div key={o.id} className="card" style={{ borderColor: o.matchesOffer ? 'var(--brand)' : undefined, borderWidth: o.matchesOffer ? 2 : 1 }}>
              <div className="row">
                <Avatar name={o.driver.name} url={o.driver.avatarUrl} />
                <div className="grow"><b>{o.driver.name}</b><div className="small muted">★ {o.driver.rating ?? 'New'} · {o.driver.vehicle.color} {o.driver.vehicle.model}{o.etaS != null && <> · {Math.max(1, Math.round(o.etaS / 60))} min</>}</div></div>
                <div style={{ textAlign: 'end' }}><div className="bold" style={{ fontSize: 18 }}>{formatPKR(o.price)}</div><div className="small" style={{ color: o.matchesOffer ? 'var(--ok)' : 'var(--warn)', fontWeight: 700 }}>{o.matchesOffer ? 'Your price' : `+${o.price - order.offeredFare}`}</div></div>
              </div>
              <button className="btn btn-primary btn-block" style={{ marginTop: 10 }} disabled={busy} onClick={() => acceptOffer(o)}>{t('accept')} {o.driver.name?.split(' ')[0]}</button>
            </div>
          ))}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn grow" onClick={raise} disabled={busy}>{t('raise')} +20</button>
          <button className="btn btn-danger-ghost grow" onClick={onCancel} disabled={busy}>{t('cancelRide')}</button>
        </div>
      </div>
    );
  }

  if (s === 'no_driver' || s === 'cancelled') {
    return (
      <div className="sheet center">
        <div className="sheet-grab" />
        <div className="heading">{s === 'no_driver' ? t('noDriver') : 'Ride cancelled'}</div>
        <p className="muted" style={{ margin: '6px 0 14px' }}>{s === 'no_driver' ? t('noDriverSub') : order.cancelledBy === 'driver' ? `The driver cancelled${order.cancelReason ? `: ${order.cancelReason}` : ''}.` : order.cancelFee ? `A cancellation fee of ${formatPKR(order.cancelFee)} was recorded.` : 'No charge.'}</p>
        <button className="btn btn-primary btn-lg btn-block" onClick={onReset}>{t('tryAgain')}</button>
      </div>
    );
  }

  if (s === 'completed') {
    return (
      <div className="sheet">
        <div className="sheet-grab" />
        <div className="center col" style={{ alignItems: 'center' }}>
          <div className="pop" style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--ok-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 34 }}>✓</div>
          <div className="title">{order.service === 'ride' ? t('arrivedDest') : 'Delivered'}</div>
          <div className="small muted">{order.bookingNo}</div>
        </div>
        <div className="card col" style={{ margin: '14px 0', gap: 6 }}>
          <div className="row between"><span className="muted">Agreed fare</span><b>{formatPKR(order.agreedFare)}</b></div>
          {order.waitingCharge > 0 && <div className="row between"><span className="muted">Waiting charge</span><b>{formatPKR(order.waitingCharge)}</b></div>}
          <div className="divider" />
          <div className="row between"><b>{t('total')}</b><span className="price">{formatPKR(order.finalFare)}</span></div>
          <div className="chip chip-ok" style={{ alignSelf: 'flex-start' }}>{t('payCash')}</div>
        </div>
        {!rated ? (
          <>
            <div className="center bold">{t('rateDriver')}</div>
            <Stars value={rating} onChange={setRating} />
            <div className="row" style={{ flexWrap: 'wrap', justifyContent: 'center', margin: '10px 0' }}>
              {RATING_TAGS.map((tg) => (
                <button key={tg} className={`chip ${tags.includes(tg) ? 'chip-brand' : ''}`} style={{ border: 0, cursor: 'pointer' }} onClick={() => setTags(tags.includes(tg) ? tags.filter((x) => x !== tg) : [...tags, tg])} aria-pressed={tags.includes(tg)}>{tg}</button>
              ))}
            </div>
            <div className="row"><button className="btn grow" onClick={onReset}>Skip</button><button className="btn btn-primary grow" disabled={!rating || busy} onClick={submitRating}>Submit</button></div>
          </>
        ) : (
          <button className="btn btn-primary btn-lg btn-block" onClick={onReset}>{t('done')}</button>
        )}
      </div>
    );
  }

  // accepted / arrived / in_progress
  const title = s === 'accepted' ? (etaMin != null ? `${t('arriving')} · ${etaMin} min` : t('arriving')) : s === 'arrived' ? t('arrived') : t('onTrip');
  return (
    <div className="sheet">
      <div className="sheet-grab" />
      <div className="row between" style={{ marginBottom: 10 }}>
        <div className="heading">{title}</div>
        <button className="btn btn-danger btn-sm" onClick={sos} aria-label={t('sos')}><ShieldAlert size={16} /> {t('sos')}</button>
      </div>
      {d && (
        <div className="row">
          <Avatar name={d.name} url={d.avatarUrl} size={56} />
          <div className="grow"><div className="bold" style={{ fontSize: 17 }}>{d.name}</div><div className="small muted">★ {d.rating ?? 'New'} · {d.vehicle.color} {d.vehicle.model}</div></div>
          <div className="card-flat center" style={{ padding: '6px 10px' }}><div className="small muted" style={{ fontSize: 10 }}>PLATE</div><b dir="ltr">{d.vehicle.plate}</b></div>
        </div>
      )}
      {s !== 'in_progress' && order.pin && (
        <div className="hero row between" style={{ margin: '12px 0' }}>
          <div><div className="small" style={{ color: '#ddd3fa' }}>{t('ridePin')}</div><div className="small" style={{ color: '#c9bdf2' }}>{t('pinHint')}</div></div>
          <div className="pin">{order.pin.split('').map((c, i) => <span key={i}>{c}</span>)}</div>
        </div>
      )}
      <div className="row" style={{ margin: s === 'in_progress' ? '12px 0' : '0 0 12px' }}>
        {d?.phone && <a className="btn grow" href={`tel:${d.phone}`}><Phone size={18} color="var(--brand)" /> Call</a>}
        {d?.phone && <a className="btn grow" href={`sms:${d.phone}`}><MessageCircle size={18} color="var(--brand)" /> Message</a>}
        <button className="btn grow" onClick={share}><Share2 size={18} color="var(--brand)" /> {t('share')}</button>
      </div>
      {order.service !== 'ride' && order.meta && (
        <div className="card-flat col" style={{ gap: 4, fontSize: 13, marginBottom: 8 }}>
          <div className="row between"><b>{SERVICE_LABEL[order.service].en}</b><span className="chip chip-brand">{order.bookingNo}</span></div>
          <div>{order.meta.item}</div>
          {order.meta.receiverName || order.meta.receiverPhone ? <div className="muted">Receiver: {order.meta.receiverName} {order.meta.receiverPhone && <span dir="ltr">{formatPhone(order.meta.receiverPhone)}</span>}</div> : null}
        </div>
      )}
      {order.service === 'ride' && <div className="small muted" style={{ marginBottom: 6 }}>Booking {order.bookingNo}</div>}
      <div className="card col" style={{ gap: 8, fontSize: 13 }}>
        <div className="row"><MapPin size={16} color="var(--ok)" /><span className="grow">{order.pickup.addr}</span></div>
        <div className="row"><Navigation size={16} /><span className="grow">{order.drop.addr}</span><b>{formatPKR(order.agreedFare)}</b></div>
      </div>
      {s !== 'in_progress' && <button className="btn btn-block" style={{ marginTop: 12 }} onClick={onCancel} disabled={busy}>{t('cancelRide')}</button>}
    </div>
  );
}

function MenuSheet({ user, onUser, onClose, onLogout }: { user: UserDto; onUser: (u: UserDto) => void; onClose: () => void; onLogout: () => void }) {
  const { t, lang, setLang } = useI18n(dict);
  const [tab, setTab] = useState<'menu' | 'history'>('menu');
  const [orders, setOrders] = useState<OrderDto[] | null>(null);
  useEffect(() => { if (tab === 'history') api.get<{ orders: OrderDto[] }>('/api/rider/orders').then((r) => setOrders(r.orders)).catch(() => setOrders([])); }, [tab]);
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, zIndex: 800, background: 'var(--scrim)' }} onClick={onClose} />
      <div className="sheet" style={{ zIndex: 900, height: '82%' }}>
        <div className="sheet-grab" />
        <div className="row between" style={{ marginBottom: 12 }}>
          <div className="row"><Avatar name={user.name} url={user.avatarUrl} /><div><b>{user.name}</b><div className="small muted" dir="ltr">{formatPhone(user.phone)}</div></div></div>
          <button className="btn icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div className="row" style={{ marginBottom: 12 }}>
          <button className={`btn grow ${tab === 'menu' ? 'btn-tonal' : ''}`} onClick={() => setTab('menu')}><Settings size={16} /> {t('settings')}</button>
          <button className={`btn grow ${tab === 'history' ? 'btn-tonal' : ''}`} onClick={() => setTab('history')}><History size={16} /> {t('history')}</button>
        </div>
        {tab === 'menu' && (
          <div className="col" style={{ gap: 14 }}>
            <ProfileCard api={api} base="/api/rider" user={user} onUser={onUser} tripsLabel="Bookings" />
            <div className="row between"><b>{t('language')}</b>
              <div className="row"><button className={`btn btn-sm ${lang === 'en' ? 'btn-tonal' : ''}`} onClick={() => setLang('en')}>English</button><button className={`btn btn-sm ${lang === 'ur' ? 'btn-tonal' : ''}`} onClick={() => setLang('ur')}>اردو</button></div></div>
            <div className="row between"><b>{t('theme')}</b><ThemeSwitch /></div>
            <button className="btn btn-danger-ghost btn-block" onClick={onLogout}><LogOut size={18} /> {t('logout')}</button>
            <div className="small muted center">Powered by Digital Target</div>
          </div>
        )}
        {tab === 'history' && (
          <div className="col" style={{ gap: 8 }}>
            {orders === null && [0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 70 }} />)}
            {orders?.length === 0 && <div className="center muted" style={{ padding: 30 }}><div className="heading" style={{ color: 'var(--text)' }}>{t('noRides')}</div>{t('noRidesSub')}</div>}
            {orders?.map((o) => (
              <div key={o.id} className="card">
                <div className="row between"><b className="small">{SERVICE_LABEL[o.service].en} · {o.bookingNo}</b>
                  <span className={`chip ${o.status === 'completed' ? 'chip-ok' : o.status === 'cancelled' || o.status === 'no_driver' ? 'chip-danger' : 'chip-brand'}`}>{o.status.replace('_', ' ')}</span></div>
                <div className="small muted">{new Date(o.createdAt).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })}{o.meta?.item ? ` · ${o.meta.item}` : ''}</div>
                <div className="small" style={{ marginTop: 6 }}><MapPin size={12} color="var(--ok)" /> {o.pickup.addr.split(',')[0]}<br /><Navigation size={12} /> {o.drop.addr.split(',')[0]}</div>
                <div className="row between" style={{ marginTop: 6 }}><span className="small muted">{fmtDistance(o.distanceM)} · {VEHICLE_LABEL[o.vehicleType].en}</span><b>{formatPKR(o.finalFare ?? o.agreedFare ?? o.offeredFare)}</b></div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
