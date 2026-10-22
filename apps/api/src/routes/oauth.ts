import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { db } from '@cove/db';
import { config } from '../lib/config';
import { hash, randomToken, safeEqual } from '../lib/crypto';
import { HttpError, route } from '../lib/errors';
import { createSession, cookieOptions } from '../middleware/auth';
const router = Router();
const stateCookie = 'cove_google_state';
function enabled() {
  if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET || !config.GOOGLE_REDIRECT_URI)
    throw new HttpError(503, 'OAUTH_UNAVAILABLE', 'Google sign-in is not configured.');
}
router.get('/', route(async (_req, res) => {
  enabled();
  const state = randomToken(), verifier = randomToken();
  const payload = Buffer.from(JSON.stringify({ state, verifier, at: Date.now() })).toString('base64url');
  const signature = hash(`${config.SESSION_SECRET}:${payload}`);
  res.cookie(stateCookie, `${payload}.${signature}`, { ...cookieOptions(true), maxAge: 10 * 60_000 });
  const params = new URLSearchParams({ client_id: config.GOOGLE_CLIENT_ID!, redirect_uri: config.GOOGLE_REDIRECT_URI!,
    response_type: 'code', scope: 'openid email profile', state, code_challenge: Buffer.from(hash(verifier), 'hex').toString('base64url'), code_challenge_method: 'S256', prompt: 'select_account' });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}));
router.get('/callback', route(async (req, res) => {
  enabled();
  const saved: unknown = req.cookies?.[stateCookie];
  res.clearCookie(stateCookie, { ...cookieOptions(true), maxAge: undefined });
  if (typeof saved !== 'string') throw new HttpError(400, 'INVALID_OAUTH_STATE', 'Sign-in expired. Please try again.');
  const [payload, signature] = saved.split('.');
  if (!payload || !signature || !safeEqual(hash(`${config.SESSION_SECRET}:${payload}`), signature)) throw new HttpError(400, 'INVALID_OAUTH_STATE', 'Sign-in expired. Please try again.');
  const { state, verifier, at } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { state: string; verifier: string; at: number };
  if (!safeEqual(state, String(req.query.state || '')) || !Number.isFinite(at) || Date.now() - at > 600_000 || !req.query.code)
    throw new HttpError(400, 'INVALID_OAUTH_STATE', 'Sign-in expired. Please try again.');
  const client = new OAuth2Client(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET, config.GOOGLE_REDIRECT_URI);
  const { tokens } = await client.getToken({ code: String(req.query.code), codeVerifier: verifier, redirect_uri: config.GOOGLE_REDIRECT_URI });
  if (!tokens.id_token) throw new HttpError(401, 'OAUTH_FAILED', 'Google could not verify your account.');
  const verified = await client.verifyIdToken({ idToken: tokens.id_token, audience: config.GOOGLE_CLIENT_ID });
  const profile = verified.getPayload();
  if (!profile?.sub || !profile.email || !profile.email_verified) throw new HttpError(401, 'OAUTH_FAILED', 'Google could not verify your email.');
  const email = profile.email.toLowerCase();
  let account = await db.account.findUnique({ where: { provider_providerAccountId: { provider: 'google', providerAccountId: profile.sub } }, include: { user: true } });
  if (!account) {
    // Never silently link a new OAuth identity to an existing password account.
    if (await db.user.findUnique({ where: { email } })) return res.redirect(`${config.WEB_ORIGIN}/login?error=account-exists`);
    const base = email.split('@')[0]!.replace(/[^a-z0-9_]/g, '_').slice(0, 16) || 'member';
    let username = `${base}_${randomToken().slice(0, 6)}`;
    while (await db.user.findUnique({ where: { username } })) username = `${base}_${randomToken().slice(0, 6)}`;
    account = await db.account.create({ data: { provider: 'google', providerAccountId: profile.sub, user: { create: {
      email, username, displayName: (profile.name || base).slice(0, 80), avatarUrl: profile.picture,
      emailVerifiedAt: new Date()
    } } }, include: { user: true } });
  }
  await createSession(res, account.userId, req.get('user-agent'));
  res.redirect(`${config.WEB_ORIGIN}/app`);
}));
export default router;
