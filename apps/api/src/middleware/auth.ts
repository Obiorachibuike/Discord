import type { Request, Response, NextFunction } from 'express';
import { db } from '@cove/db';
import { config } from '../lib/config';
import { hash, safeEqual, randomToken } from '../lib/crypto';
import { HttpError } from '../lib/errors';

export const SESSION_COOKIE = 'cove_session';
export const CSRF_COOKIE = 'cove_csrf';
export const SESSION_MS = 14 * 24 * 60 * 60 * 1000;
export type AuthContext = { userId: string; sessionId: string; csrfHash: string };
declare module 'express-serve-static-core' { interface Request { auth?: AuthContext } }

export function cookieOptions(httpOnly: boolean) {
  return { httpOnly, secure: config.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', maxAge: SESSION_MS };
}
export async function createSession(res: Response, userId: string, userAgent?: string) {
  const token = randomToken(); const csrf = randomToken();
  await db.session.create({ data: { userId, tokenHash: hash(token), csrfHash: hash(csrf), userAgent: userAgent?.slice(0, 255), expiresAt: new Date(Date.now() + SESSION_MS) } });
  res.cookie(SESSION_COOKIE, token, cookieOptions(true));
  res.cookie(CSRF_COOKIE, csrf, cookieOptions(false));
}
export function clearCookies(res: Response) {
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(true), maxAge: undefined });
  res.clearCookie(CSRF_COOKIE, { ...cookieOptions(false), maxAge: undefined });
}
export async function sessionFromToken(token?: string): Promise<AuthContext | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const session = await db.session.findUnique({ where: { tokenHash: hash(token) }, select: { id: true, userId: true, csrfHash: true, expiresAt: true, revokedAt: true, lastSeenAt: true } });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  if (Date.now() - session.lastSeenAt.getTime() > 300_000) void db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  return { userId: session.userId, sessionId: session.id, csrfHash: session.csrfHash };
}
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try { req.auth = await sessionFromToken(req.cookies?.[SESSION_COOKIE]) ?? undefined; next(); } catch (error) { next(error); }
}
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(new HttpError(401, 'UNAUTHENTICATED', 'Please sign in to continue.'));
  next();
}
export function requireCsrf(req: Request, _res: Response, next: NextFunction) {
  if (['GET','HEAD','OPTIONS'].includes(req.method) || !req.auth) return next();
  const header = req.get('x-csrf-token');
  const cookie = req.cookies?.[CSRF_COOKIE];
  if (!header || !cookie || !safeEqual(header, cookie) || !safeEqual(hash(header), req.auth.csrfHash)) return next(new HttpError(403, 'CSRF_FAILED', 'Your session has changed. Refresh and try again.'));
  next();
}
