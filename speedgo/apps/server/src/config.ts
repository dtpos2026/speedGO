import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const serverRoot = path.resolve(import.meta.dirname, '..');
const dataDir = process.env.SPEEDGO_DATA_DIR
  ? path.resolve(process.env.SPEEDGO_DATA_DIR)
  : path.join(serverRoot, 'data');
fs.mkdirSync(dataDir, { recursive: true });

// Tiny .env loader (no dependency). Real environment variables always win.
const fileEnv: Record<string, string> = {};
const envPath = path.join(serverRoot, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) fileEnv[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
}
const env = (k: string): string | undefined => process.env[k] ?? fileEnv[k];

/** Secrets are generated once and kept in the (git-ignored) data folder. Never hardcoded. */
function persistedSecret(name: string): string {
  const fromEnv = env(name);
  if (fromEnv) return fromEnv;
  const file = path.join(dataDir, `.${name.toLowerCase()}`);
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

const isProd = env('NODE_ENV') === 'production';

export const config = {
  isProd,
  port: Number(env('PORT') ?? 4000),
  dataDir,
  dbPath: path.join(dataDir, 'speedgo.db'),
  uploadsDir: path.join(dataDir, 'uploads'),
  avatarsDir: path.join(dataDir, 'avatars'),
  jwtSecret: persistedSecret('JWT_SECRET'),
  /** dev = fixed OTP code (local testing only). sms = real provider (not built yet). */
  otpMode: (env('OTP_MODE') ?? (isProd ? 'sms' : 'dev')) as 'dev' | 'sms',
  devOtpCode: '123456',
  corsOrigins: (env('CORS_ORIGINS') ?? 'http://localhost:5171,http://localhost:5172,http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  routing: { enabled: env('ROUTING') !== 'off', url: env('OSRM_URL') ?? 'https://router.project-osrm.org' },
  geocoder: { enabled: env('GEOCODER') !== 'off', url: env('NOMINATIM_URL') ?? 'https://nominatim.openstreetmap.org' },
  timezone: 'Asia/Karachi',
  seedAdmin: { email: env('SEED_ADMIN_EMAIL') ?? 'admin@speedgo.local', password: env('SEED_ADMIN_PASSWORD') },
};

if (config.isProd && config.otpMode === 'dev') {
  throw new Error('OTP_MODE=dev is not allowed in production. Configure a real SMS provider first.');
}
fs.mkdirSync(config.uploadsDir, { recursive: true });
fs.mkdirSync(config.avatarsDir, { recursive: true });
