import { useCallback, useEffect, useState } from 'react';
import { Spinner, useAction, useToast } from '@speedgo/ui';
import { api } from '../api';
import { Drawer, Pager, TableSkeleton, statusChip, when } from '../kit';

interface Role { key: string; label: string; perms: string[] }
interface Staff { id: number; email: string; name: string; roleKey: string; status: string; createdAt: number }

const PERM_LABEL: Record<string, string> = {
  'live:view': 'Live operations', 'drivers:view': 'View drivers', 'drivers:verify': 'Verify drivers', 'drivers:manage': 'Suspend drivers', 'customers:view': 'View customers', 'customers:manage': 'Block customers',
  'rides:view': 'View rides', 'rides:manage': 'Cancel rides', 'finance:view': 'View finance', 'finance:manage': 'Adjust wallets', 'pricing:view': 'View pricing', 'pricing:manage': 'Edit pricing',
  'support:manage': 'Support & SOS', 'roles:manage': 'Roles & staff', 'audit:view': 'Audit log', 'exec:view': 'Management dashboard',
};

export function Roles() {
  const toast = useToast();
  const { busy, run } = useAction();
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [perms, setPerms] = useState<string[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [sel, setSel] = useState('super_admin');
  const [form, setForm] = useState(false);
  const load = useCallback(() => {
    api.get<{ roles: Role[]; permissions: string[] }>('/api/admin/roles').then((r) => { setRoles(r.roles); setPerms(r.permissions); });
    api.get<{ admins: Staff[] }>('/api/admin/admins').then((r) => setStaff(r.admins));
  }, []);
  useEffect(load, [load]);
  if (!roles) return <Spinner />;
  const role = roles.find((r) => r.key === sel)!;
  const toggle = (s: Staff) => run(async () => { await api.post(`/api/admin/admins/${s.id}/status`, { active: s.status !== 'active' }); load(); });
  return (
    <>
      <div className="topbar"><div><h1 className="title">Roles &amp; staff</h1><div className="muted small">Each role sees only its own modules. The server checks every action again, so a hidden menu is never the only protection.</div></div>
        <button className="btn btn-primary" onClick={() => setForm(true)}>Add staff member</button></div>
      <section className="two-col">
        <div className="narrow card" style={{ padding: 0, overflow: 'hidden' }}>
          {roles.map((r) => <button key={r.key} className="nav" style={{ borderRadius: 0, padding: '13px 16px', borderBottom: '1px solid var(--border)', background: sel === r.key ? 'var(--brand-soft)' : 'transparent', color: 'var(--text)', borderInlineStart: sel === r.key ? '4px solid var(--brand)' : '4px solid transparent' }} onClick={() => setSel(r.key)}>
            {r.label}<span className="count" style={{ background: 'var(--surface2)', color: 'var(--muted)' }}>{staff.filter((s) => s.roleKey === r.key).length}</span></button>)}
        </div>
        <div className="wide card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}><b style={{ fontSize: 16 }}>{role.label}</b><div className="small muted">{role.perms.length} of {perms.length} permissions</div></div>
          <table className="table"><tbody>{perms.map((p) => <tr key={p}><td>{PERM_LABEL[p] ?? p}<br /><span className="small muted">{p}</span></td><td style={{ textAlign: 'end' }}>{role.perms.includes(p) ? <span className="perm-yes">✓ Allowed</span> : <span className="perm-no">–</span>}</td></tr>)}</tbody></table>
        </div>
      </section>
      <div className="table-wrap">
        <div className="row between" style={{ padding: '14px 18px' }}><b>Staff</b></div>
        <table className="table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th /></tr></thead>
          <tbody>{staff.map((s) => <tr key={s.id}><td><b>{s.name}</b></td><td>{s.email}</td><td>{roles.find((r) => r.key === s.roleKey)?.label}</td><td>{statusChip(s.status)}</td><td><button className="btn btn-sm" disabled={busy} onClick={() => toggle(s)}>{s.status === 'active' ? 'Disable' : 'Enable'}</button></td></tr>)}</tbody></table>
      </div>
      {form && <StaffForm roles={roles} onClose={() => setForm(false)} onDone={() => { setForm(false); toast('Staff member added'); load(); }} />}
    </>
  );
}

function StaffForm({ roles, onClose, onDone }: { roles: Role[]; onClose: () => void; onDone: () => void }) {
  const { busy, run } = useAction();
  const [f, setF] = useState({ name: '', email: '', roleKey: 'customer_support', password: '' });
  return (
    <Drawer title="Add staff member" onClose={onClose}>
      <label className="field">Full name<input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <label className="field">Email<input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
      <label className="field">Role<select className="input" value={f.roleKey} onChange={(e) => setF({ ...f, roleKey: e.target.value })}>{roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
      <label className="field">Temporary password (min 10 characters)<input className="input" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
      <button className="btn btn-primary btn-lg" disabled={busy || !f.name || !f.email || f.password.length < 10} onClick={() => run(async () => { await api.post('/api/admin/admins', f); onDone(); })}>{busy ? <Spinner /> : 'Create account'}</button>
    </Drawer>
  );
}

export function Audit() {
  const [rows, setRows] = useState<{ id: number; actorType: string; actorName: string | null; action: string; target: string | null; detail: string | null; at: number }[] | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  useEffect(() => { setRows(null); api.get<{ entries: any[]; total: number }>(`/api/admin/audit?limit=40&offset=${offset}`).then((r) => { setRows(r.entries); setTotal(r.total); }); }, [offset]);
  return (
    <>
      <div><h1 className="title">Audit log</h1><div className="muted small">Who did what, and when. Entries cannot be edited or deleted.</div></div>
      <div className="table-wrap">
        {rows === null ? <TableSkeleton /> : (
          <table className="table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.id} style={r.actorType === 'security' ? { background: 'var(--danger-soft)' } : undefined}><td className="small">{when(r.at)}</td><td>{r.actorName ?? r.actorType}</td><td><b>{r.action}</b></td><td className="small">{r.target}</td><td className="small muted" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.detail}</td></tr>)}</tbody></table>
        )}
      </div>
      <Pager total={total} offset={offset} limit={40} onChange={setOffset} />
    </>
  );
}
