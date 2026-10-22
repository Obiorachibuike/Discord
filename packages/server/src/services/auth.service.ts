import { prisma } from '../context.js';
import { ApiError } from '../errors.js';
import { generateToken, hashToken } from '../utils/crypto.js';
import { hashPassword, verifyPassword } from './password.service.js';
import {
  sendPasswordResetEmail,
  sendVerificationEmail,
} from './email.service.js';
import type { LoginInput, RegisterInput } from '@aether/shared';

const EMAIL_VERIFY_TTL_MS = 24 * 3600_000;
const PASSWORD_RESET_TTL_MS = 3600_000;

export class AuthService {
  async register(input: RegisterInput, meta: { userAgent?: string; ip?: string }) {
    const existing = await prisma.user.findFirst({
      where: { OR: [{ email: input.email.toLowerCase() }, { username: input.username.toLowerCase() }] },
    });
    if (existing) {
      // Do not reveal which field collided.
      throw ApiError.conflict('That email or username is already in use');
    }
    const passwordHash = await hashPassword(input.password);
    const user = await prisma.user.create({
      data: {
        email: input.email.toLowerCase(),
        username: input.username.toLowerCase(),
        displayName: input.displayName ?? input.username,
        passwordHash,
      },
    });
    const verifyToken = await this.issueVerificationToken(user.id, 'EMAIL_VERIFY');
    await sendVerificationEmail(user.email, verifyToken);
    return { user, meta };
  }

  async login(input: LoginInput) {
    const ident = input.emailOrUsername.toLowerCase();
    const user = await prisma.user.findFirst({
      where: { OR: [{ email: ident }, { username: ident }] },
    });
    if (!user || !user.passwordHash) {
      throw ApiError.unauthorized('Invalid email/username or password');
    }
    const ok = await verifyPassword(user.passwordHash, input.password);
    if (!ok) {
      throw ApiError.unauthorized('Invalid email/username or password');
    }
    return user;
  }

  private async issueVerificationToken(
    userId: string,
    type: 'EMAIL_VERIFY' | 'PASSWORD_RESET',
  ): Promise<string> {
    const token = generateToken(32);
    await prisma.verificationToken.create({
      data: {
        tokenHash: hashToken(token),
        userId,
        type,
        expiresAt: new Date(
          Date.now() + (type === 'EMAIL_VERIFY' ? EMAIL_VERIFY_TTL_MS : PASSWORD_RESET_TTL_MS),
        ),
      },
    });
    return token;
  }

  async verifyEmail(token: string) {
    const record = await prisma.verificationToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!record || record.usedAt || record.type !== 'EMAIL_VERIFY' || record.expiresAt < new Date()) {
      throw ApiError.badRequest('This verification link is invalid or has expired');
    }
    await prisma.$transaction([
      prisma.verificationToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      prisma.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: new Date() },
      }),
    ]);
  }

  async requestPasswordReset(email: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) return; // generic response — never reveal account existence
    const token = await this.issueVerificationToken(user.id, 'PASSWORD_RESET');
    await sendPasswordResetEmail(user.email, token);
  }

  async resetPassword(token: string, newPassword: string) {
    const record = await prisma.verificationToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!record || record.usedAt || record.type !== 'PASSWORD_RESET' || record.expiresAt < new Date()) {
      throw ApiError.badRequest('This reset link is invalid or has expired');
    }
    const passwordHash = await hashPassword(newPassword);
    await prisma.$transaction([
      prisma.verificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      // Revoke every session — password reset invalidates existing logins.
      prisma.session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  async resendVerification(userId: string) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.emailVerifiedAt) return;
    const token = await this.issueVerificationToken(user.id, 'EMAIL_VERIFY');
    await sendVerificationEmail(user.email, token);
  }

  /** Google OAuth: verify ID token, upsert user + Account row. */
  async loginWithGoogle(idToken: string) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) throw ApiError.unavailable('Google sign-in is not configured');
    const { OAuth2Client } = await import('google-auth-library');
    const client = new OAuth2Client(clientId);
    let payload;
    try {
      const ticket = await client.verifyIdToken({ idToken, audience: clientId });
      payload = ticket.getPayload();
    } catch {
      throw ApiError.unauthorized('Google sign-in failed');
    }
    if (!payload?.email || !payload.sub) throw ApiError.unauthorized('Google sign-in failed');
    const email = payload.email.toLowerCase();
    const account = await prisma.account.findUnique({
      where: { provider_providerAccountId: { provider: 'google', providerAccountId: payload.sub } },
      include: { user: true },
    });
    if (account) return account.user;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      await prisma.account.create({
        data: { userId: existing.id, provider: 'google', providerAccountId: payload.sub },
      });
      return existing;
    }
    const baseUsername = (payload.email.split('@')[0] ?? 'user').replace(/[^a-z0-9_.-]/gi, '').slice(0, 28) || 'user';
    let username = baseUsername.toLowerCase();
    for (let i = 1; await prisma.user.findUnique({ where: { username } }); i++) {
      username = `${baseUsername.toLowerCase()}${i}`;
    }
    return prisma.user.create({
      data: {
        email,
        username,
        displayName: payload.name ?? baseUsername,
        avatarUrl: payload.picture ?? null,
        emailVerifiedAt: new Date(),
        accounts: { create: { provider: 'google', providerAccountId: payload.sub } },
      },
    });
  }
}

export const authService = new AuthService();
