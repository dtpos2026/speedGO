import { useCallback, useEffect, useRef, useState } from 'react';
import { AuthFlow, createApi, useI18n } from '@speedgo/ui';
import type { UserDto } from '@speedgo/shared';
import { Home } from './Home';
import { dict } from './strings';

export const api = createApi('speedgo-rider-token', () => window.dispatchEvent(new Event('speedgo:logout')));

interface PublicConfig {
  city: { id: number; name: string; lat: number; lng: number; radius_km: number };
  otpMode: 'dev' | 'sms';
  devOtpCode?: string;
}

export function App() {
  const [token, setToken] = useState<string | null>(api.token());
  const [user, setUser] = useState<UserDto | null>(null);
  const [cfg, setCfg] = useState<PublicConfig | null>(null);
  const [cfgError, setCfgError] = useState(false);

  useEffect(() => {
    api.get<PublicConfig>('/api/public/config').then(setCfg).catch(() => setCfgError(true));
  }, []);
  useEffect(() => {
    const out = () => { api.setToken(null); setToken(null); setUser(null); };
    window.addEventListener('speedgo:logout', out);
    return () => window.removeEventListener('speedgo:logout', out);
  }, []);
  useEffect(() => {
    if (!token) return;
    api.get<{ user: UserDto }>('/api/rider/me').then((r) => setUser(r.user)).catch(() => {});
  }, [token]);

  if (cfgError) return <Center>Cannot reach the SpeedGo server. Start it with <code>npm run dev</code> and refresh.</Center>;
  if (!cfg) return <Center>Loading…</Center>;
  if (!token || !user) {
    return (
      <div className="app">
        <RiderAuth cfg={cfg} onDone={(t, u) => { api.setToken(t); setToken(t); setUser(u); }} />
      </div>
    );
  }
  return (
    <div className="app">
      <Home cfg={cfg} user={user} token={token} onUser={setUser} onLogout={() => window.dispatchEvent(new Event('speedgo:logout'))} />
    </div>
  );
}

const Center = ({ children }: { children: React.ReactNode }) => (
  <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }} className="muted">{children}</div>
);

export function useStable<T>(v: T): React.MutableRefObject<T> {
  const r = useRef(v);
  r.current = v;
  return r;
}
export const useNow = (every = 1000) => {
  const [n, setN] = useState(Date.now());
  const cb = useCallback(() => setN(Date.now()), []);
  useEffect(() => { const i = setInterval(cb, every); return () => clearInterval(i); }, [cb, every]);
  return n;
};

function RiderAuth({ cfg, onDone }: { cfg: PublicConfig; onDone: (token: string, user: UserDto) => void }) {
  const { t, lang, setLang } = useI18n(dict);
  return <AuthFlow role="rider" api={api} cfg={cfg} t={t} lang={lang} setLang={setLang} onDone={onDone} />;
}
