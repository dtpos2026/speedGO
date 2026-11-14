import { useRef, useState } from 'react';
import { ArrowLeft, Phone, ShieldCheck } from 'lucide-react';
import { formatPhone, type UserDto } from '@speedgo/shared';
import type { Api } from './api';
import { Logo, ThemeSwitch, useAction } from './components';

export function AuthFlow({ role, api, cfg, t, lang, setLang, onDone, welcome }: {
  role: 'rider' | 'driver';
  api: Api;
  cfg: { otpMode: 'dev' | 'sms'; devOtpCode?: string };
  t: (k: string) => string;
  lang: 'en' | 'ur';
  setLang: (l: 'en' | 'ur') => void;
  onDone: (token: string, user: UserDto) => void;
  welcome?: { badge1: string; badge2: string };
}) {
  const { busy, run } = useAction();
  const [step, setStep] = useState<'phone' | 'otp' | 'name'>('phone');
  const [phone, setPhone] = useState('');
  const [normalized, setNormalized] = useState('');
  const [digits, setDigits] = useState<string[]>(Array(6).fill(''));
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState<{ token: string; user: UserDto } | null>(null);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  const sendCode = () =>
    run(async () => {
      setError('');
      try {
        const r = await api.post<{ phone: string }>('/api/auth/otp/request', { phone, role });
        setNormalized(r.phone);
        setStep('otp');
        setTimeout(() => boxes.current[0]?.focus(), 50);
      } catch (e: any) {
        setError(e.message);
      }
    });

  const verify = (code: string) =>
    run(async () => {
      setError('');
      try {
        const r = await api.post<{ token: string; user: UserDto; isNew: boolean }>('/api/auth/otp/verify', { phone: normalized, role, code });
        api.setToken(r.token);
        if (!r.user.name) { setPending({ token: r.token, user: r.user }); setStep('name'); }
        else onDone(r.token, r.user);
      } catch (e: any) {
        setError(e.message);
        setDigits(Array(6).fill(''));
        boxes.current[0]?.focus();
      }
    });

  const setDigit = (i: number, v: string) => {
    const clean = v.replace(/\D/g, '');
    if (clean.length > 1) {
      const d = clean.slice(0, 6).split('');
      const next = [...Array(6).fill('')].map((_, k) => d[k] ?? '');
      setDigits(next);
      if (d.length === 6) verify(d.join(''));
      return;
    }
    const next = [...digits];
    next[i] = clean;
    setDigits(next);
    if (clean && i < 5) boxes.current[i + 1]?.focus();
    if (next.every(Boolean)) verify(next.join(''));
  };

  const saveName = () =>
    run(async () => {
      const r = await api.put<{ user: UserDto }>(`/api/${role}/me`, { name });
      onDone(pending!.token, r.user);
    });

  return (
    <div style={{ height: '100%', background: 'linear-gradient(170deg,#4c1d95 0%,#2e1065 45%,#14072e 100%)', display: 'flex', flexDirection: 'column' }}>
      <div className="row between" style={{ padding: '24px 22px 0' }}>
        <Logo size={44} />
        <div className="row" style={{ background: 'rgba(255,255,255,.12)', borderRadius: 999, padding: 4 }}>
          <button className="btn btn-sm" onClick={() => setLang('en')} style={{ border: 0, borderRadius: 999, background: lang === 'en' ? '#fff' : 'transparent', color: lang === 'en' ? '#2e1065' : '#fff' }}>EN</button>
          <button className="btn btn-sm" onClick={() => setLang('ur')} style={{ border: 0, borderRadius: 999, background: lang === 'ur' ? '#fff' : 'transparent', color: lang === 'ur' ? '#2e1065' : '#fff' }}>اردو</button>
        </div>
      </div>
      <div style={{ padding: '36px 22px 0', color: '#fff' }}>
        <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: -0.8, lineHeight: 1.2 }}>{t('welcome')}</div>
        <p style={{ marginTop: 12, color: '#ddd3fa' }}>{t('welcomeSub')}</p>
        <div className="row" style={{ marginTop: 20, flexWrap: 'wrap' }}>
          <span className="chip" style={{ background: 'rgba(255,255,255,.12)', color: '#fff' }}><ShieldCheck size={14} /> {welcome?.badge1 ?? 'CNIC-verified drivers'}</span>
          <span className="chip" style={{ background: 'rgba(255,255,255,.12)', color: '#fff' }}>{welcome?.badge2 ?? 'SOS'}</span>
        </div>
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ background: 'var(--surface)', borderRadius: '32px 32px 0 0', padding: '26px 22px calc(26px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {step === 'phone' && (
          <>
            <div className="heading" style={{ fontSize: 22 }}>{t('enterMobile')}</div>
            <label className="field">
              <div className="phone-input">
                <span className="bold" dir="ltr">🇵🇰 +92</span>
                <input inputMode="tel" autoComplete="tel" dir="ltr" placeholder="300 1234567" value={phone} onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && phone && sendCode()} aria-label="Mobile number" />
              </div>
            </label>
            {error && <div className="field-error">{error}</div>}
            <button className="btn btn-primary btn-lg btn-block" disabled={busy || phone.replace(/\D/g, '').length < 10} onClick={sendCode}>{t('sendCode')}</button>
            {cfg.otpMode === 'dev' && <div className="banner">Local test mode: the code is always <b>{cfg.devOtpCode}</b></div>}
          </>
        )}
        {step === 'otp' && (
          <>
            <button className="btn icon-btn" onClick={() => setStep('phone')} aria-label="Back"><ArrowLeft size={20} /></button>
            <div>
              <div className="heading" style={{ fontSize: 22 }}>{t('enterCode')}</div>
              <p className="muted small" style={{ marginTop: 4 }}>SMS → <b dir="ltr">{formatPhone(normalized)}</b></p>
            </div>
            <div className="otp-boxes" role="group" aria-label="Verification code">
              {digits.map((d, i) => (
                <input key={i} ref={(el) => { boxes.current[i] = el; }} inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'} maxLength={6} value={d} onChange={(e) => setDigit(i, e.target.value)} onKeyDown={(e) => e.key === 'Backspace' && !d && i > 0 && boxes.current[i - 1]?.focus()} aria-label={`Digit ${i + 1}`} />
              ))}
            </div>
            {error && <div className="field-error">{error}</div>}
            <button className="btn btn-primary btn-lg btn-block" disabled={busy || digits.some((d) => !d)} onClick={() => verify(digits.join(''))}>{t('verify')}</button>
            {cfg.otpMode === 'dev' && <div className="banner">Local test mode: use <b>{cfg.devOtpCode}</b></div>}
          </>
        )}
        {step === 'name' && (
          <>
            <div className="heading" style={{ fontSize: 22 }}>{t('yourName')}</div>
            <input className="input" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-label="Your name" />
            <button className="btn btn-primary btn-lg btn-block" disabled={busy || name.trim().length < 2} onClick={saveName}>{t('done')}</button>
          </>
        )}
        <div className="row small muted" style={{ justifyContent: 'center' }}><Phone size={12} /> By continuing you agree to the SpeedGo Terms and Privacy Policy.</div>
        <div className="row between"><span className="small muted">Powered by <b>Digital Target</b></span><ThemeSwitch compact /></div>
      </div>
    </div>
  );
}

