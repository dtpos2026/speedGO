import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { Loader2, Moon, Star, Sun, SunMoon } from 'lucide-react';
import logoMark from './assets/logo-mark.png';
import logoWord from './assets/logo-wordmark.png';
import { ApiError } from './api';
import { useTheme } from './theme';

/** Official SpeedGo logo (car + bike mark, wordmark, no tagline) on the brand night-purple plate. */
export function Logo({ size = 40, word = true }: { size?: number; word?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.25, padding: `${size * 0.2}px ${size * 0.3}px`, borderRadius: size * 0.4, background: '#2E1065' }}>
      <img src={logoMark} alt="" style={{ height: size * 0.7, width: 'auto' }} />
      {word && <img src={logoWord} alt="Speed Go" style={{ height: size * 0.4, width: 'auto' }} />}
    </span>
  );
}

export function Spinner({ size = 20 }: { size?: number }) {
  return <Loader2 size={size} className="spin" aria-label="Loading" />;
}

export function Stars({ value, onChange, size = 34 }: { value: number; onChange?: (n: number) => void; size?: number }) {
  return (
    <div className="row" style={{ gap: 6, justifyContent: 'center' }} role={onChange ? 'radiogroup' : undefined} aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" disabled={!onChange} onClick={() => onChange?.(n)} aria-label={`${n} star${n > 1 ? 's' : ''}`} aria-checked={value === n} style={{ background: 'none', border: 0, padding: 2, cursor: onChange ? 'pointer' : 'default' }}>
          <Star size={size} fill={n <= value ? '#F5C76B' : 'none'} color={n <= value ? '#D9A441' : 'var(--border)'} strokeWidth={1.6} />
        </button>
      ))}
    </div>
  );
}

// ---------- Toasts ----------
const ToastCtx = createContext<(msg: string, kind?: 'info' | 'error') => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ msg: string; kind: 'info' | 'error'; id: number } | null>(null);
  const show = useCallback((msg: string, kind: 'info' | 'error' = 'info') => setT({ msg, kind, id: Date.now() }), []);
  useEffect(() => {
    if (!t) return;
    const x = setTimeout(() => setT(null), 3800);
    return () => clearTimeout(x);
  }, [t]);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t && (
        <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''}`} role="status" aria-live="polite">
          {t.msg}
        </div>
      )}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);
export function errMsg(e: unknown): string {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Something went wrong';
}

/** Run an async action with a busy flag and an error toast. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      setBusy(true);
      try {
        return await fn();
      } catch (e) {
        toast(errMsg(e), 'error');
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { busy, run };
}

export function ThemeSwitch({ compact }: { compact?: boolean }) {
  const { mode, setMode } = useTheme();
  const opts = [
    { v: 'light' as const, icon: <Sun size={16} />, label: 'Light' },
    { v: 'dark' as const, icon: <Moon size={16} />, label: 'Dark' },
    { v: 'system' as const, icon: <SunMoon size={16} />, label: 'Auto' },
  ];
  return (
    <div className="row" style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 999, padding: 4, gap: 2 }} role="radiogroup" aria-label="Theme">
      {opts.map((o) => (
        <button key={o.v} role="radio" aria-checked={mode === o.v} onClick={() => setMode(o.v)} className="btn btn-sm" style={{ borderRadius: 999, border: 0, background: mode === o.v ? 'var(--brand)' : 'transparent', color: mode === o.v ? '#fff' : 'var(--muted)', minHeight: 34, padding: compact ? '0 10px' : '0 14px' }}>
          {o.icon}
          {!compact && o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Realtime ----------
export function useSocket(token: string | null, kind: 'user' | 'admin' = 'user') {
  const [sock, setSock] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (!token) return;
    const s = io({ auth: { token, kind }, transports: ['websocket', 'polling'], reconnectionDelayMax: 5000 });
    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    setSock(s);
    return () => {
      s.close();
      setSock(null);
      setConnected(false);
    };
  }, [token, kind]);
  return { sock, connected };
}

/** Subscribe to a socket event for the lifetime of the component. */
export function useSocketEvent<T = any>(sock: Socket | null, event: string, handler: (payload: T) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!sock) return;
    const fn = (p: T) => ref.current(p);
    sock.on(event, fn);
    return () => {
      sock.off(event, fn);
    };
  }, [sock, event]);
}

export function useCountdown(until: number | null | undefined): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}

export function useGeolocation() {
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setError('Location is not available on this device');
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude });
        setError(null);
      },
      (e) => setError(e.code === 1 ? 'Location permission is off' : 'Cannot get your location'),
      { enableHighAccuracy: true, maximumAge: 4000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);
  return { pos, error };
}
