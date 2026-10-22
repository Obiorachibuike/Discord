import fs from 'node:fs';
import { Router } from 'express';
import multer from 'multer';
import { db } from '@cove/db';
import { id } from '@cove/shared';
import { config } from '../lib/config';
import { HttpError, route } from '../lib/errors';
import { requireChannel, requireConversation } from '../services/permissions';
import { accessObject, inspectFile, store } from '../services/storage';
const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 1 } });
router.post('/', upload.single('file'), route(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'NO_FILE', 'Select a file to upload.');
  const userId = req.auth!.userId;
  const recent = await db.messageAttachment.aggregate({ where: { uploadedById: userId, createdAt: { gte: new Date(Date.now() - 86400_000) } }, _count: true, _sum: { size: true } });
  if ((recent._count ?? 0) >= 100 || (recent._sum.size ?? 0) + req.file.size > 100 * 1024 * 1024) throw new HttpError(429, 'UPLOAD_QUOTA', 'Daily upload quota reached.');
  const { mime, safeName } = await inspectFile(req.file.buffer, req.file.originalname);
  const stored = await store(req.file.buffer, mime);
  try {
    const attachment = await db.messageAttachment.create({ data: { uploadedById: userId, provider: stored.provider, storageKey: stored.storageKey, filename: safeName, mimeType: mime, size: req.file.size } });
    res.status(201).json({ attachment: { id: attachment.id, filename: attachment.filename, mimeType: attachment.mimeType, size: attachment.size, url: `/api/attachments/${attachment.id}` } });
  } catch (error) { const { deleteObject } = await import('../services/storage.js'); await deleteObject(stored); throw error; }
}));
router.get('/:attachmentId', route(async (req, res) => {
  const attachment = await db.messageAttachment.findUnique({ where: { id: id.parse(req.params.attachmentId) }, include: { message: { select: { channelId: true, conversationId: true, deletedAt: true } } } });
  if (!attachment) throw new HttpError(404, 'NOT_FOUND', 'Attachment not found.');
  const avatar = await db.user.findFirst({ where: { avatarUrl: `/api/attachments/${attachment.id}` }, select: { id: true } });
  const icon = await db.server.findFirst({ where: { iconUrl: `/api/attachments/${attachment.id}`, members: { some: { userId: req.auth!.userId } } }, select: { id: true } });
  if (!avatar && !icon) {
    if (attachment.message?.deletedAt) throw new HttpError(404, 'NOT_FOUND', 'Attachment not found.');
    if (attachment.message?.channelId) await requireChannel(req.auth!.userId, attachment.message.channelId, 'VIEW_CHANNEL');
    else if (attachment.message?.conversationId) await requireConversation(req.auth!.userId, attachment.message.conversationId);
    else if (attachment.uploadedById !== req.auth!.userId) throw new HttpError(404, 'NOT_FOUND', 'Attachment not found.');
  }
  const access = await accessObject(attachment);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', attachment.mimeType);
  res.setHeader('Content-Disposition', `${attachment.mimeType.startsWith('image/') ? 'inline' : 'attachment'}; filename="${attachment.filename.replace(/["\\\r\n]/g, '_')}"`);
  if ('url' in access) return res.redirect(302, access.url!);
  fs.createReadStream(access.localPath!).on('error', () => { if (!res.headersSent) res.status(404).end(); else res.destroy(); }).pipe(res);
}));
export default router;
