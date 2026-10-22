import type { NextFunction, Request, Response } from 'express';
import { SESSION_COOKIE } from '@aether/shared';
import { ApiError } from '../errors.js';
import { hashToken } from '../utils/crypto.js';
import { prisma } from '../context.js';

export interface AuthContext {
  id: string;
  username: string;
  displayName: string;
  email: string;
  emailVerified: boolean;
  avatarUrl: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
      requestId?: string;
    }
  }
}

/** Loads the session user when a valid session cookie is present. */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const raw = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (raw) {
      const session = await prisma.session.findUnique({
        where: { tokenHash: hashToken(raw) },
        include: { user: true },
      });
      if (
        session &&
        !session.revokedAt &&
        session.expiresAt > new Date()
      ) {
        req.auth = {
          id: session.user.id,
          username: session.user.username,
          displayName: session.user.displayName,
          email: session.user.email,
          emailVerified: Boolean(session.user.emailVerifiedAt),
          avatarUrl: session.user.avatarUrl,
        };
      }
    }
  } catch {
    /* treat as anonymous */
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(ApiError.unauthorized());
  next();
}

/** Returns the authenticated user or throws. */
export function mustAuth(req: Request): AuthContext {
  if (!req.auth) throw ApiError.unauthorized();
  return req.auth;
}
