import { Router } from 'express';
import { db } from '@cove/db';
import { z } from 'zod';
import { registerSchema, loginSchema, email as emailSchema, password, id } from '@cove/shared';
import { config } from '../lib/config';
import { hash, randomToken } from '../lib/crypto';
import { hashPassword, verifyPassword } from '../lib/password';
import { HttpError, route } from '../lib/errors';
import { createSession, clearCookies, requireAuth } from '../middleware/auth';
import { emailReady, sendEmail } from '../services/email';
import { selfUser } from '../services/users';
import { revokeSessionSockets, revokeUserSockets } from '../services/notifications';
const router = Router();
const generic = { message: 'If this account exists, an email will arrive shortly.' };
router.get('/providers', (_req, res) => res.json({ google: !!(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET && config.GOOGLE_REDIRECT_URI), emailVerificationRequired: emailReady }));

async function issueToken(userId: string, purpose: 'EMAIL_VERIFY' | 'PASSWORD_RESET') {
  const token = randomToken();
  await db.verificationToken.create({ data: { userId, purpose, tokenHash: hash(token), expiresAt: new Date(Date.now() + (purpose === 'EMAIL_VERIFY' ? 24 : 1) * 3600_000) } });
  return token;
}
router.post('/register', route(async (req, res) => {
  const input = registerSchema.parse(req.body);
  // Registration responses do not distinguish existing accounts.
  const existing = await db.user.findFirst({ where: { OR: [{ email: input.email }, { username: input.username }] }, select: { id: true } });
  if (existing) return res.status(202).json(generic);
  const user = await db.user.create({ data: {
    email: input.email, username: input.username, displayName: input.displayName,
    passwordHash: await hashPassword(input.password),
    // Local-only shortcut; production startup requires SMTP. Never return verification tokens in JSON.
    emailVerifiedAt: !emailReady && config.NODE_ENV !== 'production' ? new Date() : undefined
  } });
  if (emailReady) {
    const token = await issueToken(user.id, 'EMAIL_VERIFY');
    await sendEmail(user.email, 'Verify your Cove email', `Welcome to Cove! Verify your email: ${config.WEB_ORIGIN}/verify?token=${token}\nThis link expires in 24 hours.`);
    return res.status(201).json({ message: 'Check your inbox to verify your email.' });
  }
  if (req.auth) { await db.session.update({ where: { id: req.auth.sessionId }, data: { revokedAt: new Date() } }); await revokeSessionSockets(req.auth.userId, req.auth.sessionId); }
  await createSession(res, user.id, req.get('user-agent'));
  res.status(201).json({ user: selfUser(user) });
}));
router.post('/login', route(async (req, res) => {
  const input = loginSchema.parse(req.body);
  const user = await db.user.findUnique({ where: { email: input.email } });
  // Equalize non-existent account timing without disclosing account existence.
  const matches = await verifyPassword(user?.passwordHash, input.password);
  if (!user || !matches) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  if (!user.emailVerifiedAt) throw new HttpError(403, 'EMAIL_UNVERIFIED', 'Verify your email before signing in.');
  if (req.auth) { await db.session.update({ where: { id: req.auth.sessionId }, data: { revokedAt: new Date() } }); await revokeSessionSockets(req.auth.userId, req.auth.sessionId); }
  await createSession(res, user.id, req.get('user-agent'));
  res.json({ user: selfUser(user) });
}));
router.get('/me', requireAuth, route(async (req, res) => {
  const user = await db.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });
  res.json({ user: selfUser(user) });
}));
router.post('/logout', requireAuth, route(async (req, res) => {
  await db.session.update({ where: { id: req.auth!.sessionId }, data: { revokedAt: new Date() } });
  await revokeSessionSockets(req.auth!.userId, req.auth!.sessionId);
  clearCookies(res); res.status(204).send();
}));
router.get('/sessions', requireAuth, route(async (req, res) => {
  const sessions = await db.session.findMany({ where: { userId: req.auth!.userId, revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true }, orderBy: { createdAt: 'desc' } });
  res.json({ sessions: sessions.map(s => ({ ...s, current: s.id === req.auth!.sessionId })) });
}));
router.delete('/sessions/:id', requireAuth, route(async (req, res) => {
  const sessionId = id.parse(req.params.id);
  const result = await db.session.updateMany({ where: { id: sessionId, userId: req.auth!.userId }, data: { revokedAt: new Date() } });
  if (!result.count) throw new HttpError(404, 'NOT_FOUND', 'Session not found.');
  await revokeSessionSockets(req.auth!.userId, sessionId);
  if (sessionId === req.auth!.sessionId) clearCookies(res);
  res.status(204).send();
}));
router.post('/resend-verification', route(async (req, res) => {
  const email = emailSchema.parse(req.body?.email);
  const user = await db.user.findUnique({ where: { email } });
  if (user && !user.emailVerifiedAt && emailReady) {
    const token = await issueToken(user.id, 'EMAIL_VERIFY');
    await sendEmail(user.email, 'Verify your Cove email', `Verify your email: ${config.WEB_ORIGIN}/verify?token=${token}`);
  }
  res.json(generic);
}));
router.post('/verify', route(async (req, res) => {
  const token = z.string().regex(/^[a-f0-9]{64}$/).parse(req.body?.token);
  const record = await db.verificationToken.findUnique({ where: { tokenHash: hash(token) } });
  if (!record || record.purpose !== 'EMAIL_VERIFY' || record.usedAt || record.expiresAt < new Date()) throw new HttpError(400, 'INVALID_TOKEN', 'This link has expired or has already been used.');
  await db.$transaction(async tx => {
    const claimed = await tx.verificationToken.updateMany({ where: { id: record.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
    if (!claimed.count) throw new HttpError(400, 'INVALID_TOKEN', 'This link has expired or has already been used.');
    await tx.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } });
  });
  res.json({ message: 'Email verified. You can now sign in.' });
}));
router.post('/forgot-password', route(async (req, res) => {
  const email = emailSchema.parse(req.body?.email);
  if (!emailReady) throw new HttpError(503, 'EMAIL_UNAVAILABLE', 'Password recovery requires a configured email provider.');
  const user = await db.user.findUnique({ where: { email } });
  if (user) {
    const token = await issueToken(user.id, 'PASSWORD_RESET');
    await sendEmail(user.email, 'Reset your Cove password', `Reset your password: ${config.WEB_ORIGIN}/reset-password?token=${token}\nThis link expires in one hour.`);
  }
  res.json(generic);
}));
router.post('/reset-password', route(async (req, res) => {
  const input = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), password }).parse(req.body);
  const record = await db.verificationToken.findUnique({ where: { tokenHash: hash(input.token) } });
  if (!record || record.purpose !== 'PASSWORD_RESET' || record.usedAt || record.expiresAt < new Date()) throw new HttpError(400, 'INVALID_TOKEN', 'This link has expired or has already been used.');
  const passwordHash = await hashPassword(input.password);
  await db.$transaction(async tx => {
    const claimed = await tx.verificationToken.updateMany({ where: { id: record.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
    if (!claimed.count) throw new HttpError(400, 'INVALID_TOKEN', 'This link has expired or has already been used.');
    await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
    await tx.session.updateMany({ where: { userId: record.userId }, data: { revokedAt: new Date() } });
  });
  revokeUserSockets(record.userId);
  res.json({ message: 'Password updated. Sign in with your new password.' });
}));
export default router;
