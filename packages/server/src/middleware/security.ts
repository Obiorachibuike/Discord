import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { ApiError } from '../errors.js';

export function securityMiddleware() {
  return [
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:', 'https://res.cloudinary.com', 'https://*.r2.cloudflarestorage.com'],
          mediaSrc: ["'self'", 'blob:', 'https:'],
          connectSrc: ["'self'", ...config.corsOrigins, 'wss:', 'ws:'],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
    cors({
      origin(origin, cb) {
        if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
        cb(new Error('Not allowed by CORS'));
      },
      credentials: true,
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
  handler: (_req, _res, next) => next(ApiError.tooMany('Too many requests — slow down.')),
});

export const authRateLimit = rateLimit({
  windowMs: 60_000,
  limit: config.AUTH_RATE_LIMIT,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, _res, next) => next(ApiError.tooMany('Too many attempts — try again later.')),
});
