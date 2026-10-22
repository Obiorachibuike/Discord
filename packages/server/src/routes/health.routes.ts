import { Router } from 'express';
import { prisma } from '../context.js';
import { config } from '../config.js';
import { presence } from '../services/presence.service.js';

export const healthRouter = Router();

/** Liveness: process is up. */
healthRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), ts: new Date().toISOString() });
});

/** Readiness: dependencies reachable. */
healthRouter.get('/ready', async (_req, res) => {
  const checks: Record<string, 'ok' | 'fail'> = { database: 'fail' };
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = 'ok';
  } catch {
    checks.database = 'fail';
  }
  checks.presence = presence.mode === 'redis' ? 'ok' : 'ok'; // local mode is valid single-node
  const ok = checks.database === 'ok';
  res.status(ok ? 200 : 503).json({ status: ok ? 'ready' : 'degraded', checks, presenceMode: presence.mode });
});

healthRouter.get('/config', (_req, res) => {
  // Non-sensitive configuration surface for the client (never secrets).
  res.json({
    storageDriver: config.STORAGE_DRIVER,
    emailProvider: config.EMAIL_PROVIDER,
    voiceConfigured: Boolean(config.LIVEKIT_URL && config.LIVEKIT_API_KEY),
    googleAuthConfigured: Boolean(config.GOOGLE_CLIENT_ID),
    presenceMode: presence.mode,
  });
});
