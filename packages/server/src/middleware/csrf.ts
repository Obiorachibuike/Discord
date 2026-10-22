import type { NextFunction, Request, Response } from 'express';
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from '@aether/shared';
import { ApiError } from '../errors.js';
import { safeEqual } from '../utils/crypto.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit CSRF protection for cookie-authenticated mutations.
 * The CSRF cookie is readable by same-origin JS; the client echoes it in the
 * `x-aether-csrf` header. Cross-site requests cannot read the cookie.
 */
export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();
  // Anonymous mutations (register/login/forgot/reset) carry no ambient
  // credential: session cookies are SameSite=Lax so browsers will not attach
  // them to cross-site POSTs. Once a session cookie IS present we require the
  // double-submit token as defense-in-depth.
  const cookies = req.cookies as Record<string, string> | undefined;
  const hasSession = Boolean(cookies?.[SESSION_COOKIE]);
  const origin = req.headers.origin;
  if (origin) {
    const allowed = [req.headers.host ? `https://${req.headers.host}` : '', req.headers.host ? `http://${req.headers.host}` : '', ...[]];
    const host = req.headers.host;
    if (host && !allowed.includes(`${origin}`) && !originEndsWithHost(origin, host)) {
      return next(ApiError.forbidden('Cross-origin request rejected'));
    }
  }
  const cookie = cookies?.[CSRF_COOKIE];
  const header = req.headers[CSRF_HEADER];
  if (hasSession && (!cookie || typeof header !== 'string' || !safeEqual(cookie, header))) {
    return next(ApiError.forbidden('Invalid CSRF token'));
  }
  next();
}

function originEndsWithHost(origin: string, host: string): boolean {
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
