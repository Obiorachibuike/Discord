import { Router } from 'express';
import { Readable } from 'node:stream';
import multer from 'multer';
import { LIMITS } from '@aether/shared';
import { mustAuth, requireAuth, optionalAuth } from '../middleware/auth.js';
import { uploads } from '../services/upload.service.js';
import { ApiError } from '../errors.js';
import { prisma } from '../context.js';
import { permissions } from '../services/permission.service.js';
import { hasPermission, Permissions } from '@aether/shared';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITS.uploadMaxBytes, files: 1 },
});

export const uploadsRouter = Router();

uploadsRouter.post('/', requireAuth, upload.single('file'), async (req, res) => {
  const auth = mustAuth(req);
  if (!req.file) throw ApiError.badRequest('file field is required');
  const attachment = await uploads.createAttachment({
    userId: auth.id,
    fileName: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
    stream: bufferToStream(req.file.buffer),
  });
  res.status(201).json({ attachment });
});

function bufferToStream(buffer: Buffer) {
  return Readable.from(buffer) as NodeJS.ReadableStream & { truncated?: boolean };
}

/**
 * Private attachment downloads. Authorization: the file is either owned by the
 * requester (storage key prefix), attached to a message in a channel/conversation
 * the requester can access, or public via signed provider URL.
 */
uploadsRouter.get('/:key', optionalAuth, async (req, res) => {
  const key = decodeURIComponent(req.params.key!);
  const attachment = await prisma.messageAttachment.findFirst({ where: { storageKey: key } });

  if (attachment?.messageId) {
    const message = await prisma.message.findUnique({
      where: { id: attachment.messageId },
      select: { channelId: true, conversationId: true },
    });
    const viewer = req.auth?.id;
    if (message?.channelId) {
      if (!viewer) throw ApiError.unauthorized();
      const { permissions: perms } = await permissions.getChannelContext(message.channelId, viewer);
      if (!hasPermission(perms, Permissions.VIEW_CHANNELS)) throw ApiError.forbidden();
    } else if (message?.conversationId) {
      if (!viewer) throw ApiError.unauthorized();
      const member = await prisma.conversationMember.findUnique({
        where: {
          conversationId_userId: {
            conversationId: message.conversationId,
            userId: viewer,
          },
        },
      });
      if (!member) throw ApiError.forbidden();
    }
  } else {
    // Unattached upload — only the uploader may fetch it.
    const viewer = req.auth?.id;
    if (!viewer || !key.startsWith(`${viewer}/`)) throw ApiError.forbidden();
  }

  const { url } = await uploads.serve(key, req.auth?.id ?? '');
  if (url && !url.startsWith('/api/uploads/')) {
    res.redirect(url);
    return;
  }
  const stream = await uploads.getStream(key);
  if (attachment) res.setHeader('Content-Type', attachment.mimeType);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  stream.pipe(res);
});
