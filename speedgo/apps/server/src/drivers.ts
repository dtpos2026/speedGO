import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { audit, db } from './db.js';
import { config } from './config.js';
import { toAdmins, toUser } from './bus.js';
import { badRequest, conflict, forbidden, notFound } from './errors.js';
import { activeOrderForDriver, driverRow } from './orders.js';
import { getSettings } from './settings.js';
import { sniffImage, userDto } from './profile.js';
import {
  DOC_TYPES,
  REQUIRED_DOCS,
  type ApprovalStatus,
  type DocStatus,
  type DocType,
  type DriverProfileDto,
  type VehicleType,
} from '@speedgo/shared';

interface DriverFull {
  user_id: number;
  cnic: string | null;
  licence_no: string | null;
  vehicle_type: VehicleType | null;
  plate: string | null;
  model: string | null;
  color: string | null;
  year: number | null;
  approval_status: ApprovalStatus;
  review_note: string | null;
  online: number;
}

export function ensureDriverRow(userId: number) {
  db.prepare('INSERT OR IGNORE INTO drivers(user_id) VALUES (?)').run(userId);
}

export function driverProfile(userId: number): DriverProfileDto {
  ensureDriverRow(userId);
  const d = db.prepare('SELECT * FROM drivers WHERE user_id=?').get(userId) as DriverFull;
  const docs = db.prepare('SELECT type,status,reason FROM driver_documents WHERE driver_id=?').all(userId) as { type: DocType; status: DocStatus; reason: string | null }[];
  return {
    user: userDto(userId),
    profile: { cnic: d.cnic, licenceNo: d.licence_no, vehicleType: d.vehicle_type, plate: d.plate, model: d.model, color: d.color, year: d.year },
    approvalStatus: d.approval_status,
    reviewNote: d.review_note,
    online: d.online === 1,
    documents: docs,
  };
}

export function updateProfile(
  userId: number,
  p: { name: string; cnic: string; licenceNo: string; vehicleType: VehicleType; plate: string; model: string; color: string; year: number },
) {
  ensureDriverRow(userId);
  const d = db.prepare('SELECT approval_status FROM drivers WHERE user_id=?').get(userId) as { approval_status: ApprovalStatus };
  if (d.approval_status === 'approved') throw conflict('Your profile is approved. Contact support to change vehicle or CNIC details.', 'PROFILE_LOCKED');
  db.transaction(() => {
    db.prepare('UPDATE users SET name=? WHERE id=?').run(p.name, userId);
    db.prepare('UPDATE drivers SET cnic=?, licence_no=?, vehicle_type=?, plate=?, model=?, color=?, year=? WHERE user_id=?').run(
      p.cnic, p.licenceNo, p.vehicleType, p.plate.toUpperCase(), p.model, p.color, p.year, userId);
  })();
}

const ALLOWED_MIME: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

export function saveDocument(userId: number, type: string, buf: Buffer) {
  if (!(DOC_TYPES as readonly string[]).includes(type)) throw badRequest('Unknown document type');
  ensureDriverRow(userId);
  const mime = sniffImage(buf);
  if (!mime) throw badRequest('Please upload a JPG, PNG or WebP photo', 'BAD_FILE');
  const d = db.prepare('SELECT approval_status FROM drivers WHERE user_id=?').get(userId) as { approval_status: ApprovalStatus };
  if (d.approval_status === 'approved') throw conflict('Your profile is approved. Contact support to change documents.', 'PROFILE_LOCKED');
  const key = crypto.randomUUID() + ALLOWED_MIME[mime];
  fs.writeFileSync(path.join(config.uploadsDir, key), buf, { mode: 0o600 });
  const old = db.prepare('SELECT file_key FROM driver_documents WHERE driver_id=? AND type=?').get(userId, type) as { file_key: string } | undefined;
  db.prepare(
    `INSERT INTO driver_documents(driver_id,type,file_key,mime,status,reason,uploaded_at) VALUES (?,?,?,?, 'pending', NULL, ?)
     ON CONFLICT(driver_id,type) DO UPDATE SET file_key=excluded.file_key, mime=excluded.mime, status='pending', reason=NULL, uploaded_at=excluded.uploaded_at`,
  ).run(userId, type, key, mime, Date.now());
  if (old) fs.rmSync(path.join(config.uploadsDir, old.file_key), { force: true });
}

export function submitForReview(userId: number) {
  const p = driverProfile(userId);
  const missing: string[] = [];
  const pr = p.profile;
  if (!p.user.name || !pr.cnic || !pr.licenceNo || !pr.vehicleType || !pr.plate || !pr.model || !pr.color || !pr.year) missing.push('profile details');
  for (const t of REQUIRED_DOCS) if (!p.documents.some((d) => d.type === t)) missing.push(t);
  if (missing.length) throw badRequest(`Please complete: ${missing.join(', ')}`, 'INCOMPLETE');
  if (p.documents.some((d) => d.status === 'rejected')) throw badRequest('Please re-upload the rejected documents first', 'REJECTED_DOCS');
  if (p.approvalStatus === 'approved') return;
  db.prepare("UPDATE drivers SET approval_status='pending', review_note=NULL WHERE user_id=?").run(userId);
  toAdmins('driver:submitted', { id: userId });
}

export function setOnline(userId: number, online: boolean, loc?: { lat: number; lng: number }) {
  const d = driverRow(userId);
  if (!d) throw notFound('Driver not found');
  if (d.approval_status !== 'approved') throw forbidden('Your account is not approved yet', 'NOT_APPROVED');
  if (online) {
    const s = getSettings();
    if (d.wallet < s.min_wallet) throw forbidden(`Top up your wallet to at least Rs ${s.min_wallet} to go online`, 'LOW_WALLET');
    if (!loc) throw badRequest('Location is needed to go online', 'NO_LOCATION');
    db.prepare('UPDATE drivers SET online=1, lat=?, lng=?, loc_at=? WHERE user_id=?').run(loc.lat, loc.lng, Date.now(), userId);
  } else {
    if (activeOrderForDriver(userId)) throw conflict('Finish your current ride before going offline', 'DRIVER_BUSY');
    db.prepare('UPDATE drivers SET online=0 WHERE user_id=?').run(userId);
  }
  toAdmins('live:driver', { id: userId, online, lat: loc?.lat ?? d.lat, lng: loc?.lng ?? d.lng });
}

const lastBroadcast = new Map<number, number>();
export function updateLocation(userId: number, p: { lat: number; lng: number; heading?: number | null }) {
  const r = db.prepare('UPDATE drivers SET lat=?, lng=?, heading=?, loc_at=? WHERE user_id=? AND online=1').run(p.lat, p.lng, p.heading ?? null, Date.now(), userId);
  if (r.changes === 0) return;
  const active = activeOrderForDriver(userId);
  if (active) toUser(active.rider_id, 'driver:location', { orderId: active.id, lat: p.lat, lng: p.lng, heading: p.heading ?? null });
  const t = Date.now();
  if (t - (lastBroadcast.get(userId) ?? 0) > 2000) {
    lastBroadcast.set(userId, t);
    toAdmins('live:driver', { id: userId, online: true, lat: p.lat, lng: p.lng, heading: p.heading ?? null, busy: !!active });
  }
}

// ---------- Admin review ----------
export function reviewDocument(adminId: number, adminName: string, docId: number, status: 'approved' | 'rejected', reason?: string) {
  const doc = db.prepare('SELECT * FROM driver_documents WHERE id=?').get(docId) as { id: number; driver_id: number; type: string } | undefined;
  if (!doc) throw notFound('Document not found');
  if (status === 'rejected' && !reason?.trim()) throw badRequest('Please write a reason so the driver knows what to fix');
  db.prepare('UPDATE driver_documents SET status=?, reason=? WHERE id=?').run(status, status === 'rejected' ? reason!.trim() : null, docId);
  audit('admin', adminId, adminName, `document.${status}`, `driver:${doc.driver_id}`, { type: doc.type, reason });
}

export function decideDriver(adminId: number, adminName: string, driverId: number, decision: 'approve' | 'reject' | 'reupload', note?: string) {
  const d = db.prepare('SELECT approval_status FROM drivers WHERE user_id=?').get(driverId) as { approval_status: ApprovalStatus } | undefined;
  if (!d) throw notFound('Driver not found');
  const docs = db.prepare('SELECT type,status FROM driver_documents WHERE driver_id=?').all(driverId) as { type: DocType; status: DocStatus }[];
  if (decision === 'approve') {
    const missing = REQUIRED_DOCS.filter((t) => !docs.some((x) => x.type === t));
    if (missing.length) throw badRequest(`Required documents missing: ${missing.join(', ')}`, 'INCOMPLETE');
    if (docs.some((x) => x.status === 'rejected')) throw badRequest('Some documents are rejected. Use "Request re-upload" instead.', 'REJECTED_DOCS');
    db.transaction(() => {
      db.prepare("UPDATE driver_documents SET status='approved' WHERE driver_id=? AND status='pending'").run(driverId);
      db.prepare("UPDATE drivers SET approval_status='approved', review_note=NULL, reviewed_by=?, reviewed_at=? WHERE user_id=?").run(adminId, Date.now(), driverId);
    })();
  } else {
    if (!note?.trim()) throw badRequest('Please write a reason for the driver');
    db.prepare('UPDATE drivers SET approval_status=?, review_note=?, reviewed_by=?, reviewed_at=?, online=0 WHERE user_id=?').run(
      decision === 'reject' ? 'rejected' : 'incomplete', note.trim(), adminId, Date.now(), driverId);
  }
  audit('admin', adminId, adminName, `driver.${decision}`, `driver:${driverId}`, { note });
  toUser(driverId, 'driver:status', { approvalStatus: driverProfile(driverId).approvalStatus, reviewNote: note ?? null });
}
