import type { Response } from 'express';
import { CSRF_COOKIE, SESSION_COOKIE } from '@aether/shared';
import { prisma } from '../context.js';
import { config } from '../config.js';
import { generateToken, hashToken } from '../utils/crypto.js';

export interface CreatedSession {
  token: string;
  csrfToken: string;
  sessionId: string;
}

/** Creates a server-side session and returns raw tokens (cookies only). */
export async function createSession(
  userId: string,
  meta: { userAgent?: string; ip?: string },
): Promise<CreatedSession> {
  const token = generateToken(32);
  const csrfToken = generateToken(24);
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_HOURS * 3600_000);
  const session = await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt,
      userAgent: meta.userAgent?.slice(0, 255),
      ip: meta.ip,
    },
  });
  return { token, csrfToken, sessionId: session.id };
}

export async function revokeSessionByToken(token: string): Promise<void> {
  await prisma.session.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export function setSessionCookies(res: Response, session: CreatedSession): void {
  res.cookie(SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd || config.COOKIE_SECURE,
    maxAge: config.SESSION_TTL_HOURS * 3600_000,
    path: '/',
  });
  res.cookie(CSRF_COOKIE, session.csrfToken, {
    httpOnly: false, // must be readable by same-origin JS
    sameSite: 'lax',
    secure: config.isProd || config.COOKIE_SECURE,
    maxAge: config.SESSION_TTL_HOURS * 3600_000,
    path: '/',
  });
}

export function clearSessionCookies(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.clearCookie(CSRF_COOKIE, { path: '/' });
}
