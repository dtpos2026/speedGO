import { useCallback, useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { useAction, useToast } from '@speedgo/ui';
import { api } from '../api';
import { Empty, TableSkeleton, statusChip, when } from '../kit';

interface Sos { id: number; orderId: number; role: string; lat: number | null; lng: number | null; status: string; at: number; name: string | null; phone: string }

export function Support() {
  const toast = useToast();
  const { busy, run } = useAction();
  const [rows, setRows] = useState<Sos[] | null>(null);
  const load = useCallback(() => api.get<{ sos: Sos[] }>('/api/admin/sos').then((r) => setRows(r.sos)).catch(() => setRows([])), []);
  useEffect(() => { load(); const i = setInterval(load, 10000); return () => clearInterval(i); }, [load]);
  const resolve = (s: Sos) => run(async () => {
    const note = prompt('What was done? (kept in the audit log)') ?? '';
    if (note.trim().length < 3) return;
    await api.post(`/api/admin/sos/${s.id}/resolve`, { note });
    toast('SOS marked resolved'); load();
  });
  return (
    <>
      <div><h1 className="title">Support &amp; safety</h1><div className="muted small">SOS alerts from riders and drivers. Call both people first, then resolve.</div></div>
      <div className="table-wrap">
        {rows === null ? <TableSkeleton rows={3} /> : rows.length === 0 ? <Empty title="No SOS alerts" sub="If a rider or driver presses SOS during a ride it appears here instantly." /> : (
          <table className="table"><thead><tr><th>When</th><th>Ride</th><th>Raised by</th><th>Location</th><th>Status</th><th /></tr></thead>
            <tbody>{rows.map((s) => (
              <tr key={s.id} style={s.status === 'open' ? { background: 'var(--danger-soft)' } : undefined}>
                <td>{when(s.at)}</td><td><a href="#/rides">#{s.orderId}</a></td><td><b>{s.name}</b> ({s.role})<br /><a href={`tel:${s.phone}`} dir="ltr">{s.phone}</a></td>
                <td>{s.lat != null ? <a href={`https://www.openstreetmap.org/?mlat=${s.lat}&mlon=${s.lng}#map=17/${s.lat}/${s.lng}`} target="_blank" rel="noreferrer">Open map <ExternalLink size={12} /></a> : <span className="muted">not shared</span>}</td>
                <td>{statusChip(s.status)}</td>
                <td>{s.status === 'open' && <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => resolve(s)}>Resolve</button>}</td></tr>))}</tbody></table>
        )}
      </div>
      <div className="card small muted">Customer complaints, lost items, disputes and refund requests are planned for the next phase. They will use this same page.</div>
    </>
  );
}
