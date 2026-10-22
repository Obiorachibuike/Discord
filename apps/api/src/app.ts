import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { randomUUID } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { db } from '@cove/db';
import { allowedOrigins, config } from './lib/config';
import { logger } from './lib/logger';
import { getRedis } from './lib/redis';
import { HttpError, errorHandler, route } from './lib/errors';
import { authenticate, requireAuth, requireCsrf } from './middleware/auth';
import authRoutes from './routes/auth';
import oauthRoutes from './routes/oauth';
import userRoutes from './routes/users';
import serverRoutes from './routes/servers';
import inviteRoutes from './routes/invites';
import channelRoutes from './routes/channels';
import messageRoutes from './routes/messages';
import socialRoutes from './routes/social';
import notificationRoutes from './routes/notifications';
import attachmentRoutes from './routes/attachments';
import moderationRoutes from './routes/moderation';
import callRoutes from './routes/calls';
import presenceRoutes from './routes/presence';
export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.TRUST_PROXY || false);
app.use(pinoHttp({ logger, genReqId: req => (typeof req.headers['x-request-id'] === 'string' && /^[\w-]{8,64}$/.test(req.headers['x-request-id']) ? req.headers['x-request-id'] : randomUUID()),
  autoLogging: { ignore: req => req.url === '/api/health' } }));
app.use(helmet({ contentSecurityPolicy: false })); // API serves JSON; CSP is set by the web app.
app.use(cors({ credentials: true, origin(origin, callback) {
  if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
  return callback(new HttpError(403, 'ORIGIN_DENIED', 'Origin not allowed.'));
} }));
app.use('/api/calls/webhook', express.raw({ type: '*/*', limit: '64kb' }));
app.use(express.json({ limit: '64kb', type: 'application/json' }));
app.use(cookieParser());
app.use((req, _res, next) => {
  if (!['GET','HEAD','OPTIONS'].includes(req.method) && !req.path.endsWith('/webhook')) {
    const origin = req.get('origin');
    if (origin && !allowedOrigins.includes(origin)) return next(new HttpError(403, 'ORIGIN_DENIED', 'Origin not allowed.'));
    const hasBody = Number(req.get('content-length') || 0) > 0 || !!req.get('transfer-encoding');
    if (hasBody && !req.is('application/json') && !req.is('multipart/form-data')) return next(new HttpError(415, 'JSON_REQUIRED', 'Use JSON or multipart form data.'));
  }
  next();
});
app.use(authenticate);
const redis = getRedis();
const common = { standardHeaders: 'draft-7' as const, legacyHeaders: false,
  ...(redis ? { store: new RedisStore({ sendCommand: (...args: string[]) => redis.call(args[0]!, ...args.slice(1)) as Promise<number>, prefix: 'rl:' }) } : {}) };
app.use('/api', rateLimit({ ...common, windowMs: 60_000, limit: 180, message: { error: { code: 'RATE_LIMITED', message: 'Please wait a moment.' } } }));
const authLimiter = rateLimit({ ...common, windowMs: 15 * 60_000, limit: config.NODE_ENV === 'test' ? 1000 : 15, keyGenerator: req => req.ip || 'unknown', message: { error: { code: 'RATE_LIMITED', message: 'Try again later.' } } });
app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'cove-api' }));
app.get('/api/ready', route(async (_req, res) => {
  await db.$queryRaw`SELECT 1`;
  if (redis) await redis.ping();
  res.json({ status: 'ready', database: 'connected', redis: redis ? 'connected' : 'single-instance' });
}));
app.use('/api/auth/google', oauthRoutes);
app.use('/api/auth', (req, res, next) => ['POST'].includes(req.method) && !['/logout','/reset-password'].includes(req.path) ? authLimiter(req, res, next) : next(), requireCsrf, authRoutes);
app.use('/api/invites', (req, res, next) => req.method === 'POST' ? requireAuth(req, res, next) : next(), requireCsrf, inviteRoutes); // Public preview, authenticated acceptance.
app.use('/api/calls', (req, res, next) => req.path === '/webhook' ? next() : requireAuth(req, res, next), requireCsrf, callRoutes);
app.use('/api', requireAuth, requireCsrf);
app.use('/api/users', userRoutes);
app.use('/api/presence', presenceRoutes);
app.use('/api/servers', serverRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/social', socialRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/attachments', attachmentRoutes);
app.use('/api/moderation', moderationRoutes);
app.use((_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'Endpoint not found.')));
app.use(errorHandler);
