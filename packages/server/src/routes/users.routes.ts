import { Router } from 'express';
import { Readable } from 'node:stream';
import multer from 'multer';
import {
  LIMITS,
  notificationSettingsSchema,
  privacySettingsSchema,
  updateAccountSchema,
  updatePresenceSchema,
  updateProfileSchema,
} from '@aether/shared';
import { prisma } from '../context.js';
import { mustAuth, requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { toSelfUser, toPublicUser } from '../utils/dto.js';
import { ApiError } from '../errors.js';
import { hashPassword, verifyPassword } from '../services/password.service.js';
import { presence } from '../services/presence.service.js';
import { revokeAllSessions } from '../services/session.service.js';
import { uploads } from '../services/upload.service.js';

function bufferToStream(buffer: Buffer) {
  return Readable.from(buffer) as NodeJS.ReadableStream & { truncated?: boolean };
}

export const usersRouter = Router();

usersRouter.patch('/me', requireAuth, validateBody(updateProfileSchema), async (req, res) => {
  const auth = mustAuth(req);
  const user = await prisma.user.update({
    where: { id: auth.id },
    data: {
      displayName: req.body.displayName,
      bio: req.body.bio === undefined ? undefined : req.body.bio,
      customStatus: req.body.customStatus === undefined ? undefined : req.body.customStatus,
    },
  });
  res.json({ user: toSelfUser(user) });
});

usersRouter.patch('/me/account', requireAuth, validateBody(updateAccountSchema), async (req, res) => {
  const auth = mustAuth(req);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.id } });
  const data: { username?: string; passwordHash?: string } = {};
  if (req.body.username && req.body.username.toLowerCase() !== user.username) {
    const taken = await prisma.user.findUnique({
      where: { username: req.body.username.toLowerCase() },
    });
    if (taken) throw ApiError.conflict('That username is already in use');
    data.username = req.body.username.toLowerCase();
  }
  if (req.body.newPassword) {
    if (!user.passwordHash) throw ApiError.badRequest('Set a password first');
    const ok = await verifyPassword(user.passwordHash, req.body.currentPassword ?? '');
    if (!ok) throw ApiError.forbidden('Current password is incorrect');
    data.passwordHash = await hashPassword(req.body.newPassword);
  }
  const updated = await prisma.user.update({ where: { id: auth.id }, data });
  if (data.passwordHash) {
    // Changing the password revokes every other session.
    await revokeAllSessions(auth.id);
  }
  res.json({ user: toSelfUser(updated) });
});

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITS.imageMaxBytes, files: 1 },
});

usersRouter.post(
  '/me/avatar',
  requireAuth,
  avatarUpload.single('file'),
  async (req, res) => {
    const auth = mustAuth(req);
    if (!req.file) throw ApiError.badRequest('file field is required');
    const { url } = await uploads.putAvatar({
      userId: auth.id,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      stream: bufferToStream(req.file.buffer),
    });
    const user = await prisma.user.update({
      where: { id: auth.id },
      data: { avatarUrl: url },
    });
    res.json({ user: toSelfUser(user) });
  },
);

usersRouter.patch('/me/privacy', requireAuth, validateBody(privacySettingsSchema), async (req, res) => {
  const auth = mustAuth(req);
  const current = await prisma.user.findUniqueOrThrow({ where: { id: auth.id } });
  const merged = { ...(current.privacySettings as object), ...req.body };
  const user = await prisma.user.update({
    where: { id: auth.id },
    data: { privacySettings: merged },
  });
  res.json({ user: toSelfUser(user) });
});

usersRouter.patch(
  '/me/notifications',
  requireAuth,
  validateBody(notificationSettingsSchema),
  async (req, res) => {
    const auth = mustAuth(req);
    const current = await prisma.user.findUniqueOrThrow({ where: { id: auth.id } });
    const merged = { ...(current.notificationSettings as object), ...req.body };
    const user = await prisma.user.update({
      where: { id: auth.id },
      data: { notificationSettings: merged },
    });
    res.json({ user: toSelfUser(user) });
  },
);

usersRouter.patch('/me/presence', requireAuth, validateBody(updatePresenceSchema), async (req, res) => {
  const auth = mustAuth(req);
  await presence.setStatus(auth.id, req.body.status);
  res.json({ status: req.body.status });
});

usersRouter.delete('/me', requireAuth, async (req, res) => {
  const auth = mustAuth(req);
  const owned = await prisma.server.count({ where: { ownerId: auth.id } });
  if (owned > 0) {
    throw ApiError.badRequest('Transfer or delete your servers before deleting your account');
  }
  await prisma.user.delete({ where: { id: auth.id } });
  res.json({ ok: true });
});

usersRouter.get('/:username', async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { username: req.params.username!.toLowerCase() },
    select: {
      id: true,
      username: true,
      displayName: true,
      avatarUrl: true,
      bio: true,
      customStatus: true,
      createdAt: true,
      privacySettings: true,
    },
  });
  if (!user) throw ApiError.notFound('User not found');
  const privacy = user.privacySettings as { showPresenceToFriendsOnly?: boolean };
  // Public profiles never expose email or private account details.
  res.json({
    user: {
      ...toPublicUser(user),
      presenceStatus: privacy.showPresenceToFriendsOnly ? undefined : presence.getVisibleStatus(user.id),
    },
  });
});
