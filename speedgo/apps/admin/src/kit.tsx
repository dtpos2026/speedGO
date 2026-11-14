import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Spinner } from '@speedgo/ui';
import { api } from './api';

export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="row between"><h2 className="title" style={{ fontSize: 22 }}>{title}</h2><button className="btn icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button></div>
        {children}
      </aside>
    </>
  );
}

export function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'danger' | 'ok' }) {
  return (
    <div className="kpi" style={tone === 'danger' ? { background: 'var(--danger-soft)', borderColor: 'var(--danger)' } : undefined}>
      <div className="l">{label}</div>
      <div className="v" style={tone === 'danger' ? { color: 'var(--danger)' } : undefined}>{value}</div>
      {sub && <div className="small" style={{ color: tone === 'ok' ? 'var(--ok)' : 'var(--muted)', fontWeight: 700 }}>{sub}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { v: T; label: string }[] }) {
  return <div className="tabs" role="tablist">{items.map((i) => <button key={i.v} role="tab" aria-selected={value === i.v} className={`tab-pill ${value === i.v ? 'active' : ''}`} onClick={() => onChange(i.v)}>{i.label}</button>)}</div>;
}

export function Pager({ total, offset, limit, onChange }: { total: number; offset: number; limit: number; onChange: (o: number) => void }) {
  if (total <= limit) return null;
  return (
    <div className="row between small muted" style={{ padding: '4px 4px' }}>
      <span>{offset + 1}–{Math.min(total, offset + limit)} of {total}</span>
      <div className="row"><button className="btn btn-sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>Previous</button><button className="btn btn-sm" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>Next</button></div>
    </div>
  );
}

export function Empty({ title, sub }: { title: string; sub?: string }) {
  return <div className="center muted" style={{ padding: 40 }}><div className="heading" style={{ color: 'var(--text)' }}>{title}</div>{sub}</div>;
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return <div className="col" style={{ padding: 14 }}>{Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton" style={{ height: 40 }} />)}</div>;
}

/** Documents are private. We fetch them with the admin token and show them via a temporary object URL. */
export function SecureImage({ docId, onOpen }: { docId: number; onOpen?: (url: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let revoke: string | null = null;
    let alive = true;
    api.blob(`/api/admin/documents/${docId}/file`).then((b) => { if (!alive) return; revoke = URL.createObjectURL(b); setUrl(revoke); }).catch(() => alive && setErr(true));
    return () => { alive = false; if (revoke) URL.revokeObjectURL(revoke); };
  }, [docId]);
  if (err) return <span className="small muted">Cannot load</span>;
  if (!url) return <Spinner />;
  return <img src={url} alt="" onClick={() => onOpen?.(url)} />;
}

export const money = (n: number | null | undefined) => 'Rs ' + Math.round(n ?? 0).toLocaleString('en-PK');
export const when = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' }) : '-');

export function statusChip(s: string) {
  const tone = ['completed', 'approved', 'active', 'paid'].includes(s) ? 'chip-ok' : ['cancelled', 'rejected', 'no_driver', 'blocked', 'open'].includes(s) ? 'chip-danger' : ['pending', 'incomplete', 'requested'].includes(s) ? 'chip-warn' : 'chip-brand';
  return <span className={`chip ${tone}`}>{s.replace('_', ' ')}</span>;
}
