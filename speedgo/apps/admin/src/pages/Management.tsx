import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { Spinner } from '@speedgo/ui';
import { VEHICLE_LABEL, type VehicleType } from '@speedgo/shared';
import { api } from '../api';
import { Kpi, money } from '../kit';

interface Exec {
  days: number;
  totals: { rides: number; cancelled: number; unmatched: number; gross: number; revenue: number; avgFare: number; takeRate: number; fillRate: number };
  daily: { day: string; rides: number; gross: number; revenue: number }[];
  byHour: { hour: number; requests: number; completed: number }[];
  byVehicle: { vehicleType: VehicleType; rides: number; gross: number }[];
  growth: { newRiders: number; newDrivers: number; repeatRiders: number; activeRiders: number; repeatRate: number };
}

export function Management() {
  const [days, setDays] = useState(30);
  const [d, setD] = useState<Exec | null>(null);
  useEffect(() => { setD(null); api.get<Exec>(`/api/admin/exec?days=${days}`).then(setD); }, [days]);

  const exportCsv = () => {
    if (!d) return;
    const rows = [['date', 'completed_rides', 'gross_pkr', 'platform_revenue_pkr'], ...d.daily.map((x) => [x.day, x.rides, x.gross, x.revenue])];
    const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `speedgo-report-${days}d.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const maxRev = Math.max(1, ...(d?.daily.map((x) => x.gross) ?? [1]));
  const maxHr = Math.max(1, ...(d?.byHour.map((x) => x.requests) ?? [1]));
  const hours = Array.from({ length: 24 }, (_, h) => d?.byHour.find((x) => x.hour === h)?.requests ?? 0);
  return (
    <>
      <div className="topbar">
        <div><h1 className="title">Management</h1><div className="muted small">Business performance. Totals only: no rider or driver personal details are shown here.</div></div>
        <div className="row">
          <div className="row" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 4 }}>
            {[7, 30, 90].map((n) => <button key={n} className="btn btn-sm" style={{ border: 0, background: days === n ? 'var(--night)' : 'transparent', color: days === n ? '#fff' : 'var(--text)' }} onClick={() => setDays(n)}>{n} days</button>)}
          </div>
          <button className="btn" onClick={exportCsv} disabled={!d}><Download size={16} /> Export CSV</button>
        </div>
      </div>
      {!d ? <Spinner /> : (
        <>
          <section className="grid-kpi">
            <Kpi label="Gross booking value" value={money(d.totals.gross)} />
            <Kpi label="Platform revenue" value={money(d.totals.revenue)} sub={`take rate ${d.totals.takeRate}%`} />
            <Kpi label="Completed rides" value={d.totals.rides.toLocaleString()} sub={`${d.totals.cancelled} cancelled · ${d.totals.unmatched} unmatched`} />
            <Kpi label="Average fare" value={money(d.totals.avgFare)} />
            <Kpi label="Fill rate" value={`${d.totals.fillRate}%`} sub="requests that became rides" />
          </section>
          <section className="two-col">
            <div className="wide card col">
              <div className="row between"><b>Gross value per day</b><span className="small muted">peak {money(maxRev)}</span></div>
              {d.daily.length === 0 ? <div className="muted center" style={{ padding: 40 }}>No rides in this period yet.</div> : <div className="bars" role="img" aria-label="Gross value per day">{d.daily.map((x, i) => <div key={x.day} title={`${x.day}: ${money(x.gross)} · ${x.rides} rides`} style={{ height: `${Math.max(3, (x.gross / maxRev) * 100)}%`, animationDelay: `${i * 12}ms` }} />)}</div>}
              <div className="row between small muted"><span>{d.daily[0]?.day}</span><span>{d.daily[d.daily.length - 1]?.day}</span></div>
            </div>
            <div className="narrow card col">
              <b>Demand by hour</b>
              <div className="bars" style={{ height: 120 }} role="img" aria-label="Requests by hour of day">{hours.map((v, h) => <div key={h} title={`${h}:00 · ${v} requests`} style={{ height: `${Math.max(3, (v / maxHr) * 100)}%`, background: v === maxHr && v > 0 ? 'var(--gold)' : undefined }} />)}</div>
              <div className="row between small muted"><span>12 am</span><span>12 pm</span><span>11 pm</span></div>
            </div>
          </section>
          <section className="two-col">
            <div className="narrow card col">
              <b>Growth</b>
              <div className="row between small"><span className="muted">New riders</span><b>{d.growth.newRiders}</b></div>
              <div className="row between small"><span className="muted">New drivers</span><b>{d.growth.newDrivers}</b></div>
              <div className="row between small"><span className="muted">Active riders</span><b>{d.growth.activeRiders}</b></div>
              <div className="row between small"><span className="muted">Repeat riders (2+ rides)</span><b>{d.growth.repeatRiders} ({d.growth.repeatRate}%)</b></div>
            </div>
            <div className="narrow card col">
              <b>By vehicle</b>
              {d.byVehicle.length === 0 && <div className="muted small">No completed rides yet.</div>}
              {d.byVehicle.map((v) => <div key={v.vehicleType} className="row between small"><span>{VEHICLE_LABEL[v.vehicleType]?.en}</span><span><b>{v.rides}</b> rides · {money(v.gross)}</span></div>)}
            </div>
            <div className="narrow card small muted">Forecasts, city comparison, marketing ROI and retention cohorts need several weeks of real data. They are planned for a later phase, once there is history to learn from.</div>
          </section>
        </>
      )}
    </>
  );
}
