import { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { Spinner, useAction, useToast } from '@speedgo/ui';
import { DOC_LABEL, formatPhone, VEHICLE_LABEL, type DocType, type VehicleType } from '@speedgo/shared';
import { api, type AdminMe } from '../api';
import type { Socket } from 'socket.io-client';
import { Avatar } from '@speedgo/ui';
import { Drawer, Empty, Pager, SecureImage, TableSkeleton, Tabs, mediaUrl, money, statusChip, useLiveRefresh } from '../kit';

interface Row { id: number; name: string | null; phone: string; status: string; wallet: number; vehicleType: VehicleType | null; plate: string | null; model: string | null; approvalStatus: string; online: number; avatar: string | null; docCount: number; trips: number; rating_sum: number; rating_count: number }
type Filter = 'pending' | 'approved' | 'rejected' | 'incomplete' | 'all';

export function Drivers({ me, sock, onChange }: { me: AdminMe; sock: Socket | null; onChange: () => void }) {
  const [filter, setFilter] = useState<Filter>('pending');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const limit = 25;

  const load = useCallback(() => {
    const p = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (filter !== 'all') p.set('status', filter);
    if (q.trim()) p.set('q', q.trim());
    api.get<{ drivers: Row[]; total: number }>(`/api/admin/drivers?${p}`).then((r) => { setRows(r.drivers); setTotal(r.total); }).catch(() => setRows([]));
  }, [filter, q, offset]);
  useEffect(() => { setRows(null); const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);
  useLiveRefresh(sock, ['driver:submitted', 'live:order', 'live:driver'], load);

  return (
    <>
      <div className="topbar"><div><h1 className="title">Drivers</h1><div className="muted small">Verify documents, approve drivers and manage accounts.</div></div></div>
      <div className="row between" style={{ flexWrap: 'wrap' }}>
        <Tabs value={filter} onChange={(v) => { setFilter(v); setOffset(0); }} items={[{ v: 'pending', label: 'Pending review' }, { v: 'approved', label: 'Approved' }, { v: 'rejected', label: 'Rejected' }, { v: 'incomplete', label: 'Incomplete' }, { v: 'all', label: 'All' }]} />
        <div className="row" style={{ position: 'relative' }}><Search size={16} style={{ position: 'absolute', insetInlineStart: 14 }} color="var(--muted)" /><input className="input" style={{ paddingInlineStart: 38, minWidth: 260 }} placeholder="Search name, phone or plate" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} aria-label="Search drivers" /></div>
      </div>
      <div className="table-wrap">
        {rows === null ? <TableSkeleton /> : rows.length === 0 ? <Empty title={filter === 'pending' ? 'No drivers waiting for review' : 'No drivers found'} sub="New applications appear here as soon as drivers submit." /> : (
          <table className="table">
            <thead><tr><th>Driver</th><th>Vehicle</th><th>Docs</th><th>Trips</th><th>Wallet</th><th>Status</th></tr></thead>
            <tbody>{rows.map((d) => (
              <tr key={d.id} className="click" onClick={() => setOpen(d.id)}>
                <td><div className="row"><Avatar name={d.name} url={mediaUrl(d.avatar)} size={36} /><div><b>{d.name ?? 'Unnamed'}</b><br /><span className="small muted" dir="ltr">{formatPhone(d.phone)}</span></div></div></td>
                <td>{d.vehicleType ? VEHICLE_LABEL[d.vehicleType].en : '-'}<br /><span className="small muted" dir="ltr">{d.plate} {d.model}</span></td>
                <td>{d.docCount}/8</td><td>{d.trips}</td><td>{money(d.wallet)}</td>
                <td>{statusChip(d.status === 'blocked' ? 'blocked' : d.approvalStatus)} {d.online ? <span className="chip chip-ok">online</span> : null}</td>
              </tr>))}</tbody>
          </table>
        )}
      </div>
      <Pager total={total} offset={offset} limit={limit} onChange={setOffset} />
      {open && <DriverDrawer id={open} me={me} onClose={() => setOpen(null)} onChange={() => { load(); onChange(); }} />}
    </>
  );
}

interface Detail {
  user: { id: number; name: string | null; phone: string; wallet: number; rating: number | null };
  profile: { cnic: string | null; licenceNo: string | null; vehicleType: VehicleType | null; plate: string | null; model: string | null; color: string | null; year: number | null };
  approvalStatus: string; reviewNote: string | null; online: boolean;
  documents: { id: number; type: DocType; status: string; reason: string | null; uploadedAt: number }[];
  stats: { trips: number; gross: number; commission: number };
  duplicateCnic: boolean;
}

function DriverDrawer({ id, me, onClose, onChange }: { id: number; me: AdminMe; onClose: () => void; onChange: () => void }) {
  const toast = useToast();
  const { busy, run } = useAction();
  const [d, setD] = useState<Detail | null>(null);
  const [big, setBig] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const can = (p: string) => me.permissions.includes(p);
  const load = useCallback(() => api.get<Detail>(`/api/admin/drivers/${id}`).then(setD).catch(() => onClose()), [id, onClose]);
  useEffect(() => { load(); }, [load]);

  const reviewDoc = (docId: number, status: 'approved' | 'rejected') => run(async () => {
    let reason: string | undefined;
    if (status === 'rejected') { reason = prompt('Why is this photo rejected? The driver will see this.') ?? ''; if (!reason.trim()) return; }
    await api.post(`/api/admin/documents/${docId}/review`, { status, reason });
    await load();
  });
  const decide = (decision: 'approve' | 'reject' | 'reupload') => run(async () => {
    if (decision !== 'approve' && !note.trim()) { toast('Write a reason for the driver first', 'error'); return; }
    await api.post(`/api/admin/drivers/${id}/decision`, { decision, note: note.trim() || undefined });
    toast(decision === 'approve' ? 'Driver approved' : 'Decision sent to the driver');
    await load(); onChange();
  });
  const topup = () => run(async () => {
    const a = Number(prompt('Wallet amount in Rs (use a minus sign to deduct):'));
    if (!a) return;
    const n = prompt('Reason (shown in the driver wallet history):') ?? '';
    if (n.trim().length < 3) return;
    await api.post(`/api/admin/drivers/${id}/wallet`, { amount: Math.round(a), note: n.trim() });
    toast('Wallet updated'); await load(); onChange();
  });
  const suspend = (s: boolean) => run(async () => {
    if (!confirm(s ? 'Suspend this driver? They are taken offline immediately.' : 'Reinstate this driver?')) return;
    await api.post(`/api/admin/drivers/${id}/suspend`, { suspended: s });
    await load(); onChange();
  });

  return (
    <Drawer title={d?.user.name ?? 'Driver'} onClose={onClose}>
      {!d ? <Spinner /> : (
        <>
          <div className="row" style={{ flexWrap: 'wrap' }}>{statusChip(d.approvalStatus)} {d.online && <span className="chip chip-ok">online</span>} {d.duplicateCnic && <span className="chip chip-danger">Duplicate CNIC found</span>}</div>
          {d.reviewNote && <div className="banner">Last note to driver: {d.reviewNote}</div>}
          <div className="card col small" style={{ gap: 6 }}>
            <div className="row between"><span className="muted">Phone</span><b dir="ltr">{formatPhone(d.user.phone)}</b></div>
            <div className="row between"><span className="muted">CNIC</span><b dir="ltr">{d.profile.cnic ?? '-'}</b></div>
            <div className="row between"><span className="muted">Licence</span><b dir="ltr">{d.profile.licenceNo ?? '-'}</b></div>
            <div className="row between"><span className="muted">Vehicle</span><b>{d.profile.vehicleType ? VEHICLE_LABEL[d.profile.vehicleType].en : '-'} · {d.profile.color} {d.profile.model} {d.profile.year}</b></div>
            <div className="row between"><span className="muted">Plate</span><b dir="ltr">{d.profile.plate ?? '-'}</b></div>
            <div className="row between"><span className="muted">Wallet</span><b>{money(d.user.wallet)}</b></div>
            <div className="row between"><span className="muted">Trips · gross · commission</span><b>{d.stats.trips} · {money(d.stats.gross)} · {money(d.stats.commission)}</b></div>
          </div>

          <b>Documents</b>
          <div className="doc-grid">
            {d.documents.map((doc) => (
              <div className="doc" key={doc.id} style={{ borderColor: doc.status === 'rejected' ? 'var(--danger)' : doc.status === 'approved' ? 'var(--ok)' : undefined }}>
                <div className="thumb"><SecureImage docId={doc.id} onOpen={setBig} /></div>
                <div style={{ padding: 10 }} className="col">
                  <div className="small"><b>{DOC_LABEL[doc.type]}</b><br />{statusChip(doc.status)}{doc.reason && <div className="small" style={{ color: 'var(--danger)', marginTop: 4 }}>{doc.reason}</div>}</div>
                  {can('drivers:verify') && d.approvalStatus !== 'approved' && (
                    <div className="row"><button className="btn btn-sm grow" disabled={busy} onClick={() => reviewDoc(doc.id, 'approved')}>OK</button><button className="btn btn-sm btn-danger-ghost grow" disabled={busy} onClick={() => reviewDoc(doc.id, 'rejected')}>Reject</button></div>
                  )}
                </div>
              </div>
            ))}
            {d.documents.length === 0 && <div className="muted small">No documents uploaded yet.</div>}
          </div>

          {can('drivers:verify') && d.approvalStatus !== 'approved' && (
            <div className="card col">
              <b>Decision</b>
              <textarea className="input" style={{ minHeight: 70, padding: 12 }} placeholder="Message to the driver (required for reject or re-upload)" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button className="btn btn-ok" disabled={busy} onClick={() => decide('approve')}>Approve driver</button>
                <button className="btn" disabled={busy} onClick={() => decide('reupload')}>Request re-upload</button>
                <button className="btn btn-danger-ghost" disabled={busy} onClick={() => decide('reject')}>Reject</button>
              </div>
              <div className="small muted">Every decision is saved in the audit log with your name and time.</div>
            </div>
          )}
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {can('finance:manage') && <button className="btn" onClick={topup} disabled={busy}>Adjust wallet</button>}
            {can('drivers:manage') && <button className="btn btn-danger-ghost" onClick={() => suspend(true)} disabled={busy}>Suspend</button>}
            {can('drivers:manage') && <button className="btn" onClick={() => suspend(false)} disabled={busy}>Reinstate</button>}
          </div>
          <div className="small muted">Documents are private and every view is logged.</div>
        </>
      )}
      {big && <div className="modal" onClick={() => setBig(null)} role="dialog" aria-label="Document"><img src={big} alt="Document" /></div>}
    </Drawer>
  );
}
