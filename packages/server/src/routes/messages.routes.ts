import { Router } from 'express';
import {
  createMessageSchema,
  reactToMessageSchema,
  updateMessageSchema,
} from '@aether/shared';
import { hasPermission, Permissions } from '@aether/shared';
import { prisma } from '../context.js';
import { mustAuth, requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { messages } from '../services/message.service.js';
import { permissions } from '../services/permission.service.js';
import { toMessageDTO } from '../utils/dto.js';
import { ApiError } from '../errors.js';

export const messagesRouter = Router();
messagesRouter.use(requireAuth);

messagesRouter.post('/', validateBody(createMessageSchema), async (req, res) => {
  const auth = mustAuth(req);
  const message = await messages.createChannelMessage({
    channelId: req.body.channelId,
    authorId: auth.id,
    content: req.body.content,
    replyToId: req.body.replyToId ?? null,
    attachmentIds: req.body.attachmentIds,
    clientId: req.body.clientId,
  });
  res.status(201).json({ message });
});

messagesRouter.patch('/:id', validateBody(updateMessageSchema), async (req, res) => {
  const auth = mustAuth(req);
  const message = await messages.updateMessage(req.params.id!, auth.id, req.body.content);
  res.json({ message });
});

messagesRouter.delete('/:id', async (req, res) => {
  const auth = mustAuth(req);
  await messages.deleteMessage(req.params.id!, auth.id);
  res.json({ ok: true });
});

messagesRouter.post('/:id/reactions', validateBody(reactToMessageSchema), async (req, res) => {
  const auth = mustAuth(req);
  await messages.react(req.params.id!, auth.id, req.body.emoji);
  res.json({ ok: true });
});

messagesRouter.post('/:id/pin', async (req, res) => {
  const auth = mustAuth(req);
  await messages.pin(req.params.id!, auth.id);
  res.json({ ok: true });
});

messagesRouter.delete('/:id/pin', async (req, res) => {
  const auth = mustAuth(req);
  await messages.unpin(req.params.id!, auth.id);
  res.json({ ok: true });
});

messagesRouter.get('/:id', async (req, res) => {
  const auth = mustAuth(req);
  const messageId = (req.params as Record<string, string>).id!;
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: {
      author: true,
      replyTo: { include: { author: true } },
      attachments: true,
      reactions: true,
      pins: true,
    },
  });
  if (!message) throw ApiError.notFound('Message not found');
  if (message.channelId) {
    const { permissions: perms } = await permissions.getChannelContext(message.channelId, auth.id);
    if (!hasPermission(perms, Permissions.VIEW_CHANNELS)) {
      throw ApiError.forbidden('You cannot view this message');
    }
  } else if (message.conversationId) {
    const member = await prisma.conversationMember.findUnique({
      where: {
        conversationId_userId: { conversationId: message.conversationId, userId: auth.id },
      },
    });
    if (!member) throw ApiError.forbidden('You cannot view this message');
  }
  res.json({ message: toMessageDTO(message, auth.id) });
});
