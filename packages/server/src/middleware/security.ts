import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import type { IncomingHttpHeaders } from 'node:http';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { ApiError } from '../errors.js';

function isSameOriginRequest(origin: string, headers: IncomingHttpHeaders): boolean {
  try {
    const originHost = new URL(origin).host;
    const rawForwarded = headers['x-forwarded-host'];
    const forwardedHost = (Array.isArray(rawForwarded) ? rawForwarded[0] : rawForwarded)
      ?.split(',')[0]
      ?.trim();
    const host = forwardedHost || headers.host;
    return Boolean(host && originHost === host);
  } catch {
    return false;
  }
}

export function securityMiddleware() {
  return [
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: [
            "'self'",
            'data:',
            'blob:',
            'https://res.cloudinary.com',
            'https://*.r2.cloudflarestorage.com',
          ],
          mediaSrc: ["'self'", 'blob:', 'https:'],
          connectSrc: ["'self'", ...config.corsOrigins, 'wss:', 'ws:'],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
    cors((req, cb) => {
      const origin = req.headers.origin;
      if (!origin || config.corsOrigins.includes(origin) || isSameOriginRequest(origin, req.headers)) {
        return cb(null, { origin: true, credentials: true });
      }
      cb(new Error('Not allowed by CORS'));
    }),
  ];
}

export function requestSizeLimit(maxBytes = 1024 * 1024) {
  return (req: Request, res: Response, next: NextFunction) => {
    const len = Number(req.headers['content-length'] ?? 0);
    if (len > maxBytes) {
      return next(ApiError.badRequest('Request body too large'));
    }
    next();
  };
}

/** General API rate limit. Auth endpoints add stricter limits on top. */
export const apiRateLimit = rateLimit({
  windowMs: 60_000,
  limit: config.API_RATE_LIMIT,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  handler: (_req, _res, next) => next(ApiError.tooMany('Too many requests — slow down.')),
});

export const authRateLimit = rateLimit({
  windowMs: 60_000,
  limit: config.AUTH_RATE_LIMIT,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  handler: (_req, _res, next) => next(ApiError.tooMany('Too many attempts — try again later.')),
});
