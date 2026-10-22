import express from 'express';
// Patches Express 4 to forward async handler rejections to the error middleware.
import 'express-async-errors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { logger } from './logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { apiRateLimit, requestSizeLimit, securityMiddleware } from './middleware/security.js';
import { csrfProtection } from './middleware/csrf.js';
import { optionalAuth } from './middleware/auth.js';
import { authRouter } from './routes/auth.routes.js';
import { usersRouter } from './routes/users.routes.js';
import { serversRouter, invitesRouter } from './routes/servers.routes.js';
import { serverChannelsRouter, channelRouter } from './routes/channels.routes.js';
import { messagesRouter } from './routes/messages.routes.js';
import { conversationsRouter } from './routes/conversations.routes.js';
import { friendsRouter } from './routes/social.routes.js';
import { notificationsRouter } from './routes/notifications.routes.js';
import { moderationRouter, reportsRouter } from './routes/moderation.routes.js';
import { searchRouter } from './routes/search.routes.js';
import { uploadsRouter } from './routes/uploads.routes.js';
import { voiceRouter } from './routes/voice.routes.js';
import { healthRouter } from './routes/health.routes.js';

export function createApp() {
  const app = express();
  if (config.TRUST_PROXY) app.set('trust proxy', 1);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req.headers['x-request-id'] as string) ?? randomUUID(),
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
    }),
  );
  app.use((req, res, next) => {
    req.requestId = req.id as string;
    res.setHeader('X-Request-Id', req.requestId);
    next();
  });

  app.use(securityMiddleware());
  app.use(cookieParser());
  app.use(express.json({ limit: '512kb' }));
  app.use(requestSizeLimit(1024 * 1024));
  app.use(optionalAuth);

  // Health endpoints bypass rate limiting and CSRF.
  app.use('/api', healthRouter);

  app.use('/api', apiRateLimit);
  app.use('/api', csrfProtection);

  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/servers/:id/channels', serverChannelsRouter);
  app.use('/api/channels/:channelId', channelRouter);
  app.use('/api/servers', serversRouter);
  app.use('/api/invites', invitesRouter);
  app.use('/api/messages', messagesRouter);
  app.use('/api/conversations', conversationsRouter);
  app.use('/api/friends', friendsRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/moderation', moderationRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/search', searchRouter);
  app.use('/api/uploads', uploadsRouter);
  app.use('/api/voice', voiceRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
