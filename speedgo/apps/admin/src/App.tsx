import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Activity, BarChart3, Car, ClipboardList, DollarSign, LogOut, ScrollText, ShieldAlert, SlidersHorizontal, Users, UserCog } from 'lucide-react';
import { Logo, Spinner, ThemeSwitch, useAction, useSocket, useSocketEvent } from '@speedgo/ui';
import { api, type AdminMe } from './api';
import { Live } from './pages/Live';
import { Drivers } from './pages/Drivers';
import { Customers, Rides } from './pages/People';
import { Pricing } from './pages/Pricing';
import { Support } from './pages/Support';
import { Audit, Roles } from './pages/Roles';
import { Management } from './pages/Management';

interface NavItem { key: string; label: string; perm: string; icon: ReactNode }
const NAV: NavItem[] = [
  { key: 'live', label: 'Live operations', perm: 'live:view', icon: <Activity size={18} /> },
  { key: 'drivers', label: 'Drivers', perm: 'drivers:view', icon: <Car size={18} /> },
  { key: 'customers', label: 'Customers', perm: 'customers:view', icon: <Users size={18} /> },
  { key: 'rides', label: 'Bookings', perm: 'rides:view', icon: <ClipboardList size={18} /> },
  { key: 'pricing', label: 'Pricing & settings', perm: 'pricing:view', icon: <SlidersHorizontal size={18} /> },
  { key: 'support', label: 'Support & safety', perm: 'support:manage', icon: <ShieldAlert size={18} /> },
  { key: 'management', label: 'Management', perm: 'exec:view', icon: <BarChart3 size={18} /> },
  { key: 'roles', label: 'Roles & staff', perm: 'roles:manage', icon: <UserCog size={18} /> },
  { key: 'audit', label: 'Audit log', perm: 'audit:view', icon: <ScrollText size={18} /> },
];

export function App() {
  const [token, setToken] = useState<string | null>(api.token());
  const [me, setMe] = useState<AdminMe | null>(null);
  const [page, setPage] = useState(() => location.hash.replace('#/', '') || 'live');
  const [badges, setBadges] = useState({ pending: 0, sos: 0 });
  const { sock } = useSocket(token, 'admin');

  useEffect(() => {
    const out = () => { api.setToken(null); setToken(null); setMe(null); };
    window.addEventListener('speedgo:logout', out);
    const h = () => setPage(location.hash.replace('#/', '') || 'live');
    window.addEventListener('hashchange', h);
    return () => { window.removeEventListener('speedgo:logout', out); window.removeEventListener('hashchange', h); };
  }, []);
  useEffect(() => { if (token) api.get<{ admin: AdminMe }>('/api/admin/me').then((r) => setMe(r.admin)).catch(() => {}); }, [token]);

  const loadBadges = useCallback(() => {
    if (!me?.permissions.includes('live:view')) return;
    api.get<{ pendingApprovals: number; openSos: number }>('/api/admin/stats').then((s) => setBadges({ pending: s.pendingApprovals, sos: s.openSos })).catch(() => {});
  }, [me]);
  useEffect(() => { loadBadges(); const i = setInterval(loadBadges, 20000); return () => clearInterval(i); }, [loadBadges]);
  useSocketEvent(sock, 'sos:new', loadBadges);
  useSocketEvent(sock, 'driver:submitted', loadBadges);

  if (!token) return <Login onDone={(t) => { api.setToken(t); setToken(t); }} />;
  if (!me) return <div style={{ padding: 40, textAlign: 'center' }}><Spinner /></div>;

  const allowed = NAV.filter((n) => me.permissions.includes(n.perm));
  const current = allowed.find((n) => n.key === page) ?? allowed[0];
  const go = (k: string) => { location.hash = `#/${k}`; };
  const body = (() => {
    switch (current?.key) {
      case 'live': return <Live me={me} sock={sock} />;
      case 'drivers': return <Drivers me={me} sock={sock} onChange={loadBadges} />;
      case 'customers': return <Customers me={me} sock={sock} />;
      case 'rides': return <Rides me={me} sock={sock} />;
      case 'pricing': return <Pricing me={me} />;
      case 'support': return <Support />;
      case 'management': return <Management />;
      case 'roles': return <Roles />;
      case 'audit': return <Audit />;
      default: return <div className="card">Your role has no modules yet.</div>;
    }
  })();

  return (
    <div className="shell">
      <nav className="side" aria-label="Main">
        <div style={{ padding: '4px 6px 16px' }} className="hide-sm"><Logo size={40} /></div>
        {allowed.map((n) => (
          <button key={n.key} className={`nav ${current?.key === n.key ? 'active' : ''}`} onClick={() => go(n.key)} aria-current={current?.key === n.key ? 'page' : undefined}>
            {n.icon}{n.label}
            {n.key === 'drivers' && badges.pending > 0 && <span className="count">{badges.pending}</span>}
            {n.key === 'support' && badges.sos > 0 && <span className="count red">{badges.sos}</span>}
          </button>
        ))}
        <div style={{ flex: 1 }} className="hide-sm" />
        <div className="hide-sm small" style={{ padding: 10, opacity: 0.7 }}>Powered by <b>Digital Target</b></div>
      </nav>
      <main className="main">
        <header className="topbar">
          <div className="small muted">SpeedGo · Burewala</div>
          <div className="row">
            <ThemeSwitch />
            <div className="row" style={{ gap: 10 }}><span className="avatar" style={{ width: 40, height: 40 }}>{me.name.slice(0, 2).toUpperCase()}</span><div className="small"><b>{me.name}</b><br /><span className="muted">{me.roleLabel}</span></div></div>
            <button className="btn icon-btn" onClick={() => window.dispatchEvent(new Event('speedgo:logout'))} aria-label="Sign out"><LogOut size={18} /></button>
          </div>
        </header>
        {body}
      </main>
    </div>
  );
}

function Login({ onDone }: { onDone: (t: string) => void }) {
  const { busy, run } = useAction();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = () => run(async () => {
    setError('');
    try {
      const r = await api.post<{ token: string }>('/api/admin/login', { email, password });
      onDone(r.token);
    } catch (e: any) { setError(e.message); }
  });
  return (
    <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'linear-gradient(160deg,#2e1065,#0f0b20)' }}>
      <form className="card col" style={{ width: 'min(440px,100%)', gap: 16, padding: 28, borderRadius: 28 }} onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Logo size={46} />
        <div><h1 className="title">Admin sign in</h1><p className="muted small">SpeedGo operations and management</p></div>
        <label className="field">Email<input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></label>
        <label className="field">Password<input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {error && <div className="field-error">{error}</div>}
        <button className="btn btn-primary btn-lg btn-block" disabled={busy || !email || !password} type="submit">{busy ? <Spinner /> : <><DollarSign size={0} />Sign in</>}</button>
        <div className="row between"><span className="small muted">Powered by <b>Digital Target</b></span><ThemeSwitch compact /></div>
      </form>
    </div>
  );
}
