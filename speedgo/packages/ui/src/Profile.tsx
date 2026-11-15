import { useRef, useState } from 'react';
import { Camera, Star, Trash2 } from 'lucide-react';
import { formatPhone, type UserDto } from '@speedgo/shared';
import type { Api } from './api';
import { Spinner, errMsg, useAction, useToast } from './components';

export const initials = (name: string | null | undefined) => (name ?? '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';

/** Round profile picture, or the person's initials when they have not added one. */
export function Avatar({ name, url, size = 48 }: { name?: string | null; url?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: Math.max(12, size * 0.36), overflow: 'hidden' }}>
      {url && !broken ? <img src={url} alt="" onError={() => setBroken(true)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials(name)}
    </span>
  );
}

/** Shrink phone photos to a 512 px square-ish JPEG before upload. */
async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const out = Math.min(512, side);
  const c = document.createElement('canvas');
  c.width = out; c.height = out;
  c.getContext('2d')!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, out, out);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not read that photo'))), 'image/jpeg', 0.86));
}

/** Profile screen block: photo (camera button), name, phone, rating and trips. Shared by customer and driver apps. */
export function ProfileCard({ api, base, user, onUser, tripsLabel = 'Trips' }: { api: Api; base: '/api/rider' | '/api/driver'; user: UserDto; onUser: (u: UserDto) => void; tripsLabel?: string }) {
  const toast = useToast();
  const { busy, run } = useAction();
  const file = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(user.name ?? '');
  const pick = async (f: File) => {
    try {
      const blob = await shrink(f);
      const fd = new FormData();
      fd.append('file', blob, 'me.jpg');
      const r = await api.upload<{ user: UserDto }>(`${base}/me/avatar`, fd);
      onUser(r.user);
      toast('Photo updated');
    } catch (e) { toast(errMsg(e), 'error'); }
  };
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="col" style={{ alignItems: 'center', gap: 8 }}>
        <div style={{ position: 'relative' }}>
          <Avatar name={user.name} url={user.avatarUrl} size={96} />
          <button type="button" className="btn icon-btn btn-primary" style={{ position: 'absolute', insetInlineEnd: -6, bottom: -6, width: 38, height: 38, minHeight: 38, padding: 0 }} aria-label="Change profile photo" onClick={() => file.current?.click()} disabled={busy}><Camera size={17} /></button>
          <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) run(() => pick(f)); e.target.value = ''; }} />
        </div>
        {user.avatarUrl && <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => run(async () => { const r = await api.post<{ user: UserDto }>(`${base}/me/avatar/remove`); onUser(r.user); })}><Trash2 size={14} /> Remove photo</button>}
        {busy && <Spinner size={16} />}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <div className="card-flat grow center"><div className="bold" style={{ fontSize: 18 }}><Star size={14} fill="#F5C76B" color="#D9A441" /> {user.rating ?? 'New'}</div><div className="small muted">Rating</div></div>
        <div className="card-flat grow center"><div className="bold" style={{ fontSize: 18 }}>{user.trips}</div><div className="small muted">{tripsLabel}</div></div>
        <div className="card-flat grow center"><div className="bold" style={{ fontSize: 18 }}>{user.memberSince ? new Date(user.memberSince).toLocaleDateString('en-PK', { month: 'short', year: 'numeric' }) : '-'}</div><div className="small muted">Member since</div></div>
      </div>
      <label className="field">Full name
        <div className="row"><input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          <button className="btn btn-primary" disabled={busy || name.trim().length < 2 || name.trim() === user.name} onClick={() => run(async () => { const r = await api.put<{ user: UserDto }>(`${base}/me`, { name: name.trim() }); onUser(r.user); toast('Saved'); })}>Save</button></div>
      </label>
      <div className="field">Mobile number<div className="input" style={{ display: 'flex', alignItems: 'center', opacity: 0.8 }} dir="ltr">{formatPhone(user.phone)}</div><span className="small muted" style={{ fontWeight: 500 }}>To change your number, contact SpeedGo support.</span></div>
    </div>
  );
}
