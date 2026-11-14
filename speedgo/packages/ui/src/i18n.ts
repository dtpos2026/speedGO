import { useSyncExternalStore } from 'react';

export type Lang = 'en' | 'ur';
export type Dict = Record<Lang, Record<string, string>>;

const KEY = 'speedgo-lang';
const listeners = new Set<() => void>();
let lang: Lang = (() => {
  try {
    return localStorage.getItem(KEY) === 'ur' ? 'ur' : 'en';
  } catch {
    return 'en';
  }
})();

function apply() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ur' ? 'rtl' : 'ltr';
  listeners.forEach((l) => l());
}
if (typeof document !== 'undefined') apply();

export function setLang(l: Lang) {
  lang = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* ignore */
  }
  apply();
}

/** Returns t(key, vars). Urdu falls back to English for strings that are not translated yet. */
export function useI18n(dict: Dict) {
  const l = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => lang,
  );
  const t = (key: string, vars?: Record<string, string | number>) => {
    let s = dict[l][key] ?? dict.en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
    return s;
  };
  return { t, lang: l, setLang };
}
