import { useCallback, useEffect, useState } from 'react';
import { AuthFlow, createApi, Spinner, useI18n, useSocket, useSocketEvent } from '@speedgo/ui';
import type { DriverProfileDto, OrderDto } from '@speedgo/shared';
import { Drive } from './Drive';
import { Onboarding, PendingReview } from './Onboarding';
import { dict } from './strings';

export const api = createApi('speedgo-driver-token', () => window.dispatchEvent(new Event('speedgo:logout')));

export interface PublicConfig {
  city: { id: number; name: string; lat: number; lng: number };
  otpMode: 'dev' | 'sms';
  devOtpCode?: string;
}
export type Me = DriverProfileDto & { activeOrder: OrderDto | null; minWallet: number };

export function App() {
  const { t, lang, setLang } = useI18n(dict);
  const [token, setToken] = useState<string | null>(api.token());
  const [cfg, setCfg] = useState<PublicConfig | null>(null);
  const [cfgError, setCfgError] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const { sock } = useSocket(token);

  useEffect(() => { api.get<PublicConfig>('/api/public/config').then(setCfg).catch(() => setCfgError(true)); }, []);
  useEffect(() => {
    const out = () => { api.setToken(null); setToken(null); setMe(null); };
    window.addEventListener('speedgo:logout', out);
    return () => window.removeEventListener('speedgo:logout', out);
  }, []);

  const refresh = useCallback(async () => {
    try { setMe(await api.get<Me>('/api/driver/me')); } catch { /* 401 handled by api */ }
  }, []);
  useEffect(() => { if (token) refresh(); }, [token, refresh]);
  // admin decisions arrive live
  useSocketEvent(sock, 'driver:status', () => refresh());

  if (cfgError) return <div style={{ padding: 24, textAlign: 'center' }} className="muted">Cannot reach the SpeedGo server. Start it with <code>npm run dev</code> and refresh.</div>;
  if (!cfg) return <div style={{ padding: 24, textAlign: 'center' }}><Spinner /></div>;

  if (!token) {
    return (
      <div className="app">
        <AuthFlow role="driver" api={api} cfg={cfg} t={t} lang={lang} setLang={setLang} welcome={{ badge1: 'Keep 80% of every fare', badge2: 'Cash payments' }}
          onDone={(tk) => { api.setToken(tk); setToken(tk); }} />
      </div>
    );
  }
  if (!me) return <div style={{ padding: 24, textAlign: 'center' }}><Spinner /></div>;

  const logout = () => window.dispatchEvent(new Event('speedgo:logout'));
  const s = me.approvalStatus;
  return (
    <div className="app">
      {(s === 'incomplete' || s === 'rejected') && <Onboarding me={me} onChange={refresh} onLogout={logout} />}
      {s === 'pending' && <PendingReview me={me} onChange={refresh} onLogout={logout} />}
      {s === 'approved' && <Drive me={me} token={token} cfg={cfg} refresh={refresh} onLogout={logout} />}
    </div>
  );
}
