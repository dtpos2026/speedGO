import { useRef, useState } from 'react';
import { Camera, Check, Clock, LogOut, X } from 'lucide-react';
import { Logo, Spinner, ThemeSwitch, useAction, useToast } from '@speedgo/ui';
import { DOC_LABEL, DOC_TYPES, REQUIRED_DOCS, VEHICLE_LABEL, VEHICLE_TYPES, normalizeCnic, type DocType, type VehicleType } from '@speedgo/shared';
import { api, type Me } from './App';

/** Shrink phone photos before upload (max 1600 px, JPEG) so registration works on slow mobile data. */
async function compress(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('compress failed'))), 'image/jpeg', 0.85));
  } catch {
    return file;
  }
}

function Header({ title, sub, onLogout }: { title: string; sub?: string; onLogout: () => void }) {
  return (
    <div className="col" style={{ gap: 4 }}>
      <div className="row between"><Logo size={36} /><div className="row"><ThemeSwitch compact /><button className="btn icon-btn" onClick={onLogout} aria-label="Log out"><LogOut size={18} /></button></div></div>
      <div className="title" style={{ marginTop: 14 }}>{title}</div>
      {sub && <p className="muted">{sub}</p>}
    </div>
  );
}

export function Onboarding({ me, onChange, onLogout }: { me: Me; onChange: () => void; onLogout: () => void }) {
  const toast = useToast();
  const { busy, run } = useAction();
  const p = me.profile;
  const hasProfile = !!(me.user.name && p.cnic && p.licenceNo && p.vehicleType && p.plate && p.model && p.color && p.year);
  const [step, setStep] = useState<'profile' | 'docs'>(hasProfile ? 'docs' : 'profile');
  const [f, setF] = useState({
    name: me.user.name ?? '', cnic: p.cnic ?? '', licenceNo: p.licenceNo ?? '', vehicleType: (p.vehicleType ?? 'mini') as VehicleType,
    plate: p.plate ?? '', model: p.model ?? '', color: p.color ?? '', year: String(p.year ?? ''),
  });
  const [err, setErr] = useState<Record<string, string>>({});

  const saveProfile = () => run(async () => {
    const e: Record<string, string> = {};
    if (f.name.trim().length < 2) e.name = 'Enter your full name';
    if (!normalizeCnic(f.cnic)) e.cnic = 'CNIC must be 13 digits, e.g. 35202-1234567-1';
    if (f.licenceNo.trim().length < 3) e.licenceNo = 'Enter your licence number';
    if (f.plate.trim().length < 3) e.plate = 'Enter the number plate';
    if (f.model.trim().length < 2) e.model = 'Enter the vehicle model';
    if (f.color.trim().length < 2) e.color = 'Enter the colour';
    const y = Number(f.year);
    if (!(y >= 1990 && y <= new Date().getFullYear() + 1)) e.year = 'Enter a valid model year';
    setErr(e);
    if (Object.keys(e).length) return;
    await api.put('/api/driver/profile', { ...f, year: y });
    await onChange();
    setStep('docs');
  });

  const field = (k: keyof typeof f, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="field">{label}
      <input className={`input ${err[k] ? 'invalid' : ''}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} />
      {err[k] && <span className="field-error">{err[k]}</span>}
    </label>
  );

  if (step === 'profile') {
    return (
      <div className="screen">
        <Header title="Your details" sub="Step 1 of 2 · This must match your CNIC and vehicle papers." onLogout={onLogout} />
        {me.reviewNote && <div className="banner">Message from SpeedGo: {me.reviewNote}</div>}
        {field('name', 'Full name', { autoComplete: 'name' })}
        {field('cnic', 'CNIC number', { inputMode: 'numeric', placeholder: '35202-1234567-1', dir: 'ltr' })}
        {field('licenceNo', 'Driving licence number', { dir: 'ltr' })}
        <label className="field">Vehicle type
          <select className="input" value={f.vehicleType} onChange={(e) => setF({ ...f, vehicleType: e.target.value as VehicleType })}>
            {VEHICLE_TYPES.map((v) => <option key={v} value={v}>{VEHICLE_LABEL[v].en}</option>)}
          </select>
        </label>
        {field('plate', 'Number plate', { placeholder: 'LEB-1234', dir: 'ltr' })}
        {field('model', 'Vehicle model', { placeholder: 'Suzuki Cultus' })}
        <div className="row">{field('color', 'Colour')}{field('year', 'Model year', { inputMode: 'numeric', dir: 'ltr' })}</div>
        <button className="btn btn-primary btn-lg btn-block" disabled={busy} onClick={saveProfile}>{busy ? <Spinner /> : 'Continue'}</button>
      </div>
    );
  }

  const docs = new Map(me.documents.map((d) => [d.type, d]));
  const missing = REQUIRED_DOCS.filter((t) => !docs.has(t));
  const rejected = me.documents.filter((d) => d.status === 'rejected');
  return (
    <div className="screen">
      <Header title="Upload documents" sub="Step 2 of 2 · Clear, uncropped photos. They are kept private and only seen by SpeedGo verification staff." onLogout={onLogout} />
      {me.reviewNote && <div className="banner">Message from SpeedGo: {me.reviewNote}</div>}
      <div className="col" style={{ gap: 10 }}>
        {DOC_TYPES.map((t) => <DocRow key={t} type={t} doc={docs.get(t)} required={REQUIRED_DOCS.includes(t)} onDone={onChange} />)}
      </div>
      <button className="btn btn-ghost" onClick={() => setStep('profile')}>Edit my details</button>
      <button className="btn btn-primary btn-lg btn-block" disabled={busy || missing.length > 0 || rejected.length > 0}
        onClick={() => run(async () => { await api.post('/api/driver/submit'); toast('Submitted for review'); await onChange(); })}>
        {busy ? <Spinner /> : 'Submit for review'}
      </button>
      {(missing.length > 0 || rejected.length > 0) && <p className="muted small center">{missing.length ? `${missing.length} required photo${missing.length > 1 ? 's' : ''} missing. ` : ''}{rejected.length ? 'Please retake the rejected photos.' : ''}</p>}
    </div>
  );
}

function DocRow({ type, doc, required, onDone }: { type: DocType; doc?: { status: string; reason: string | null }; required: boolean; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const { busy, run } = useAction();
  const upload = (file: File) => run(async () => {
    const blob = await compress(file);
    const fd = new FormData();
    fd.append('type', type);
    fd.append('file', blob, 'photo.jpg');
    await api.upload('/api/driver/documents', fd);
    await onDone();
  });
  const rejected = doc?.status === 'rejected';
  const ok = doc && !rejected;
  return (
    <div className="card" style={{ borderColor: rejected ? 'var(--danger)' : ok ? 'var(--ok)' : undefined, borderStyle: doc ? 'solid' : 'dashed' }}>
      <div className="row">
        <span className="avatar" style={{ background: rejected ? 'var(--danger-soft)' : ok ? 'var(--ok-soft)' : undefined, color: rejected ? 'var(--danger)' : ok ? 'var(--ok)' : undefined }}>
          {busy ? <Spinner /> : rejected ? <X size={20} /> : ok ? <Check size={20} /> : <Camera size={20} />}
        </span>
        <div className="grow">
          <div className="bold">{DOC_LABEL[type]}{!required && <span className="muted small"> (optional)</span>}</div>
          <div className="small" style={{ color: rejected ? 'var(--danger)' : 'var(--muted)' }}>
            {rejected ? `Rejected: ${doc?.reason}` : doc?.status === 'approved' ? 'Approved' : doc ? 'Uploaded' : 'Tap to take or choose a photo'}
          </div>
        </div>
        <button className="btn btn-sm" disabled={busy} onClick={() => input.current?.click()}>{doc ? 'Retake' : 'Add'}</button>
        <input ref={input} type="file" accept="image/*" capture={type === 'cnic_selfie' || type === 'profile_photo' ? 'user' : 'environment'} hidden
          onChange={(e) => { const fl = e.target.files?.[0]; if (fl) upload(fl); e.target.value = ''; }} />
      </div>
    </div>
  );
}

export function PendingReview({ me, onChange, onLogout }: { me: Me; onChange: () => void; onLogout: () => void }) {
  const rejected = me.documents.filter((d) => d.status === 'rejected');
  return (
    <div className="screen">
      <Header title="Under review" sub="Our team is checking your documents. This usually takes up to 24 hours. This screen updates by itself when you are approved." onLogout={onLogout} />
      <div className="center" style={{ padding: 20 }}>
        <div style={{ width: 92, height: 92, borderRadius: '50%', background: 'var(--warn-soft)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Clock size={40} color="var(--warn)" /></div>
      </div>
      <div className="card">
        {me.documents.map((d) => (
          <div key={d.type} className="row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
            <div><b className="small">{DOC_LABEL[d.type]}</b>{d.reason && <div className="small" style={{ color: 'var(--danger)' }}>{d.reason}</div>}</div>
            <span className={`chip ${d.status === 'approved' ? 'chip-ok' : d.status === 'rejected' ? 'chip-danger' : 'chip-warn'}`}>{d.status === 'pending' ? 'In review' : d.status}</span>
          </div>
        ))}
      </div>
      {rejected.length > 0 && <div className="banner">{rejected.length} document{rejected.length > 1 ? 's were' : ' was'} rejected. Retake them below, then submit again.</div>}
      {rejected.length > 0 && <RetakeList me={me} onChange={onChange} />}
      <button className="btn" onClick={onChange}>Check status now</button>
    </div>
  );
}

function RetakeList({ me, onChange }: { me: Me; onChange: () => void }) {
  const { run } = useAction();
  return (
    <div className="col">
      {me.documents.filter((d) => d.status === 'rejected').map((d) => <DocRow key={d.type} type={d.type} doc={d} required onDone={onChange} />)}
      <button className="btn btn-primary btn-block" onClick={() => run(async () => { await api.post('/api/driver/submit'); await onChange(); })}>Submit again</button>
    </div>
  );
}
