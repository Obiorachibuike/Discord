import { Router } from 'express';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '@aether/shared';
import { z } from 'zod';
import { prisma } from '../context.js';
import { authService } from '../services/auth.service.js';
import {
  clearSessionCookies,
  createSession,
  revokeAllSessions,
  revokeSessionByToken,
  setSessionCookies,
} from '../services/session.service.js';
import { mustAuth, requireAuth, optionalAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { authRateLimit } from '../middleware/security.js';
import { SESSION_COOKIE } from '@aether/shared';
import { toSelfUser } from '../utils/dto.js';
import { ApiError } from '../errors.js';

export const authRouter = Router();

authRouter.post('/register', authRateLimit, validateBody(registerSchema), async (req, res) => {
  const { user } = await authService.register(req.body, {
    userAgent: req.headers['user-agent'],
    ip: req.ip,
  });
  const session = await createSession(user.id, {
    userAgent: req.headers['user-agent'],
    ip: req.ip,
  });
  setSessionCookies(res, session);
  const full = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  res.status(201).json({ user: toSelfUser(full) });
});

authRouter.post('/login', authRateLimit, validateBody(loginSchema), async (req, res) => {
  const user = await authService.login(req.body);
  // Session fixation defense: always mint a fresh session on login.
  const session = await createSession(user.id, {
    userAgent: req.headers['user-agent'],
    ip: req.ip,
  });
  setSessionCookies(res, session);
  res.json({ user: toSelfUser(user) });
});

authRouter.post('/logout', optionalAuth, async (req, res) => {
  const raw = req.cookies?.[SESSION_COOKIE];
  if (raw) await revokeSessionByToken(raw);
  clearSessionCookies(res);
  res.json({ ok: true });
});

authRouter.post('/verify', authRateLimit, validateBody(verifyEmailSchema), async (req, res) => {
  await authService.verifyEmail(req.body.token);
  res.json({ ok: true });
});

authRouter.post('/resend-verification', requireAuth, authRateLimit, async (req, res) => {
  await authService.resendVerification(mustAuth(req).id);
  res.json({ ok: true });
});

authRouter.post('/forgot', authRateLimit, validateBody(forgotPasswordSchema), async (req, res) => {
  await authService.requestPasswordReset(req.body.email);
  // Always generic — do not reveal whether the account exists.
  res.json({ ok: true, message: 'If that email exists, a reset link has been sent.' });
});

authRouter.post('/reset', authRateLimit, validateBody(resetPasswordSchema), async (req, res) => {
  await authService.resetPassword(req.body.token, req.body.password);
  res.json({ ok: true });
});

authRouter.post('/google', authRateLimit, async (req, res) => {
  const parsed = z.object({ idToken: z.string().min(10) }).safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest('idToken is required');
  const user = await authService.loginWithGoogle(parsed.data.idToken);
  const session = await createSession(user.id, {
    userAgent: req.headers['user-agent'],
    ip: req.ip,
  });
  setSessionCookies(res, session);
  res.json({ user: toSelfUser(user) });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const auth = mustAuth(req);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.id } });
  res.json({ user: toSelfUser(user) });
});

authRouter.get('/sessions', requireAuth, async (req, res) => {
  const auth = mustAuth(req);
  const sessions = await prisma.session.findMany({
    where: { userId: auth.id, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, userAgent: true, ip: true, createdAt: true, expiresAt: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ sessions });
});

authRouter.delete('/sessions', requireAuth, async (req, res) => {
  await revokeAllSessions(mustAuth(req).id);
  clearSessionCookies(res);
  res.json({ ok: true });
});

authRouter.delete('/sessions/:id', requireAuth, async (req, res) => {
  const auth = mustAuth(req);
  const session = await prisma.session.findUnique({ where: { id: req.params.id } });
  if (!session || session.userId !== auth.id) throw ApiError.notFound('Session not found');
  await prisma.session.update({
    where: { id: session.id },
    data: { revokedAt: new Date() },
  });
  res.json({ ok: true });
});
