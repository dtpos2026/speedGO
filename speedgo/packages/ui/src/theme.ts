import { useEffect, useSyncExternalStore } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

const KEY = 'speedgo-theme';
const listeners = new Set<() => void>();
const mq = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function read(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* ignore */
  }
  return 'system';
}
let mode: ThemeMode = read();

const resolve = (m: ThemeMode) => (m === 'system' ? !!mq?.matches : m === 'dark');
function apply() {
  document.documentElement.dataset.theme = resolve(mode) ? 'dark' : 'light';
  listeners.forEach((l) => l());
}
mq?.addEventListener('change', () => mode === 'system' && apply());
if (typeof document !== 'undefined') apply();

export function setThemeMode(m: ThemeMode) {
  mode = m;
  try {
    localStorage.setItem(KEY, m);
  } catch {
    /* ignore */
  }
  apply();
}

/** Light, dark, or follow the phone. Persisted per browser. */
export function useTheme() {
  const m = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => mode,
  );
  useEffect(() => apply(), []);
  return { mode: m, dark: resolve(m), setMode: setThemeMode };
}
