import http from 'node:http';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import multer from 'multer';
import { ZodError } from 'zod';
import { config } from './config.js';
import { seedIfEmpty } from './db.js';
import { HttpError } from './errors.js';
import { sweep } from './orders.js';
import { initRealtime } from './realtime.js';
import { adminRouter } from './routes/admin-routes.js';
import { driverRouter, publicRouter, riderRouter } from './routes/app-routes.js';

export function createApp() {
  const seeded = seedIfEmpty();
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json({ limit: '200kb' }));

  app.get('/health', (_req, res) => res.json({ ok: true, time: Date.now() }));
  app.use('/api', publicRouter);
  app.use('/api/rider', riderRouter);
  app.use('/api/driver', driverRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }));

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err instanceof ZodError) {
      const i = err.issues[0];
      return res.status(400).json({ error: `${i.path.join('.') || 'Request'}: ${i.message}`, code: 'VALIDATION' });
    }
    if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Photo is too large (max 6 MB)' : 'Upload failed', code: 'UPLOAD' });
    if ((err as { type?: string })?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON', code: 'VALIDATION' });
    console.error('[error]', err);
    res.status(500).json({ error: 'Something went wrong on our side. Please try again.', code: 'INTERNAL' });
  });

  const server = http.createServer(app);
  const io = initRealtime(server);
  const timer = setInterval(() => {
    try {
      sweep();
    } catch (e) {
      console.error('[sweep]', e);
    }
  }, 5000);
  timer.unref();
  return { app, server, io, seeded, stop: () => { clearInterval(timer); io.close(); server.close(); } };
}
