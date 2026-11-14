import { useEffect, useState } from 'react';
import { Spinner, useAction, useToast } from '@speedgo/ui';
import { VEHICLE_LABEL, VEHICLE_TYPES, type VehicleType } from '@speedgo/shared';
import { api, type AdminMe } from '../api';
import { money } from '../kit';

interface Rule { vehicleType: VehicleType; base: number; perKm: number; perMin: number; minFare: number; waitPerMin: number; cancelFee: number; active: number }
interface Peak { name: string; days: number[]; from: string; to: string; mult: number }
interface Settings { commission_pct: number; min_wallet: number; offer_min_pct: number; offer_max_pct: number; counter_max_pct: number; dispatch_radius_km: number; request_ttl_s: number; free_wait_min: number; cancel_grace_min: number; peak_rules: Peak[] }

const COLS: { k: keyof Rule; label: string }[] = [
  { k: 'base', label: 'Base fare' }, { k: 'perKm', label: 'Per km' }, { k: 'perMin', label: 'Per min' }, { k: 'minFare', label: 'Min fare' }, { k: 'waitPerMin', label: 'Waiting / min' }, { k: 'cancelFee', label: 'Cancel fee' },
];
const SET_FIELDS: { k: keyof Omit<Settings, 'peak_rules'>; label: string; hint: string }[] = [
  { k: 'commission_pct', label: 'Platform commission (%)', hint: 'Taken from the driver wallet when a ride completes' },
  { k: 'min_wallet', label: 'Minimum driver wallet (Rs)', hint: 'Drivers below this cannot go online. 0 = no minimum' },
  { k: 'offer_min_pct', label: 'Rider may offer below estimate (%)', hint: 'Lowest allowed offer' },
  { k: 'offer_max_pct', label: 'Rider may offer above estimate (%)', hint: 'Highest allowed offer' },
  { k: 'counter_max_pct', label: 'Driver counter-offer limit (%)', hint: 'Above the estimate' },
  { k: 'dispatch_radius_km', label: 'Search radius (km)', hint: 'How far requests are sent' },
  { k: 'request_ttl_s', label: 'Request lifetime (seconds)', hint: 'Then "no driver found"' },
  { k: 'free_wait_min', label: 'Free waiting (minutes)', hint: 'After the driver arrives' },
  { k: 'cancel_grace_min', label: 'Free cancellation after arrival (min)', hint: 'Then the cancel fee is recorded' },
];

export function Pricing({ me }: { me: AdminMe }) {
  const toast = useToast();
  const { busy, run } = useAction();
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [s, setS] = useState<Settings | null>(null);
  const [dirty, setDirty] = useState(false);
  const can = me.permissions.includes('pricing:manage');
  useEffect(() => { api.get<{ rules: Rule[]; settings: Settings }>('/api/admin/pricing').then((r) => { setRules([...r.rules].sort((a, b) => VEHICLE_TYPES.indexOf(a.vehicleType) - VEHICLE_TYPES.indexOf(b.vehicleType))); setS(r.settings); }); }, []);
  if (!rules || !s) return <Spinner />;

  const setRule = (i: number, k: keyof Rule, v: number) => { setRules(rules.map((r, j) => (j === i ? { ...r, [k]: v } : r))); setDirty(true); };
  const setSet = (k: keyof Omit<Settings, 'peak_rules'>, v: number) => { setS({ ...s, [k]: v }); setDirty(true); };
  const setPeak = (i: number, patch: Partial<Peak>) => { setS({ ...s, peak_rules: s.peak_rules.map((p, j) => (j === i ? { ...p, ...patch } : p)) }); setDirty(true); };
  const save = () => run(async () => { await api.put('/api/admin/pricing', { rules, settings: s }); setDirty(false); toast('Saved. New requests use these rules.'); });

  const mini = rules.find((r) => r.vehicleType === 'mini');
  const preview = mini ? Math.max(mini.minFare, Math.round((mini.base + 4.2 * mini.perKm + 12 * mini.perMin) / 10) * 10) : 0;
  const keep = Math.round(preview * (1 - s.commission_pct / 100));

  return (
    <>
      <div className="topbar"><div><h1 className="title">Pricing &amp; settings</h1><div className="muted small">Burewala · changes apply to new requests only. {!can && 'You can view but not edit.'}</div></div>
        {can && <button className="btn btn-primary" disabled={!dirty || busy} onClick={save}>{busy ? <Spinner /> : 'Save and publish'}</button>}</div>

      <div className="table-wrap">
        <table className="table"><thead><tr><th>Vehicle</th>{COLS.map((c) => <th key={c.k}>{c.label} (Rs)</th>)}<th>Active</th></tr></thead>
          <tbody>{rules.map((r, i) => (
            <tr key={r.vehicleType}><td><b>{VEHICLE_LABEL[r.vehicleType].en}</b></td>
              {COLS.map((c) => <td key={c.k}><input className="input" style={{ minHeight: 42, width: 92 }} type="number" min={0} disabled={!can} value={r[c.k] as number} onChange={(e) => setRule(i, c.k, Number(e.target.value))} aria-label={`${VEHICLE_LABEL[r.vehicleType].en} ${c.label}`} /></td>)}
              <td><input type="checkbox" disabled={!can} checked={!!r.active} onChange={(e) => setRule(i, 'active', e.target.checked ? 1 : 0)} aria-label="Active" /></td></tr>))}</tbody></table>
      </div>

      <section className="two-col">
        <div className="wide card col">
          <b>Rules</b>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 14 }}>
            {SET_FIELDS.map((f) => (
              <label key={f.k} className="field">{f.label}
                <input className="input" type="number" min={0} disabled={!can} value={s[f.k]} onChange={(e) => setSet(f.k, Number(e.target.value))} /><span className="small" style={{ fontWeight: 500 }}>{f.hint}</span></label>
            ))}
          </div>
          <b style={{ marginTop: 8 }}>Peak-hour pricing</b>
          {s.peak_rules.map((p, i) => (
            <div key={i} className="card-flat row" style={{ flexWrap: 'wrap' }}>
              <b className="grow">{p.name}</b>
              <input className="input" style={{ width: 110, minHeight: 42 }} type="time" disabled={!can} value={p.from} onChange={(e) => setPeak(i, { from: e.target.value })} aria-label="From" />
              <span>to</span>
              <input className="input" style={{ width: 110, minHeight: 42 }} type="time" disabled={!can} value={p.to} onChange={(e) => setPeak(i, { to: e.target.value })} aria-label="To" />
              <span>×</span><input className="input" style={{ width: 80, minHeight: 42 }} type="number" step="0.05" min={1} max={3} disabled={!can} value={p.mult} onChange={(e) => setPeak(i, { mult: Number(e.target.value) })} aria-label="Multiplier" />
              <span className="small muted">Mon–Sat</span>
            </div>
          ))}
        </div>
        <div className="narrow hero col" style={{ gap: 8, borderRadius: 24, padding: 20 }}>
          <b>Preview · Mini · 4.2 km · 12 min</b>
          {mini && <>
            <div className="row between small"><span>Base</span><span>{money(mini.base)}</span></div>
            <div className="row between small"><span>Distance 4.2 × {mini.perKm}</span><span>{money(4.2 * mini.perKm)}</span></div>
            <div className="row between small"><span>Time 12 × {mini.perMin}</span><span>{money(12 * mini.perMin)}</span></div>
            <div style={{ height: 1, background: 'rgba(255,255,255,.2)' }} />
            <div className="row between" style={{ alignItems: 'baseline' }}><b>Estimated fare</b><span className="price">{money(preview)}</span></div>
            <div className="small" style={{ color: '#c9bdf2' }}>Driver keeps {money(keep)} · SpeedGo {money(preview - keep)} ({s.commission_pct}%)</div>
            <div className="small" style={{ color: '#c9bdf2' }}>Rider may offer {money(preview * (1 - s.offer_min_pct / 100))} to {money(preview * (1 + s.offer_max_pct / 100))}</div>
          </>}
        </div>
      </section>
    </>
  );
}
