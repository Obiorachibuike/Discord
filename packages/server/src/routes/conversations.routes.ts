import { Router } from 'express';
import {
  addGroupMembersSchema,
  createConversationMessageSchema,
  createDmSchema,
  createGroupSchema,
  markReadSchema,
  updateConversationSchema,
} from '@aether/shared';
import { z } from 'zod';
import { mustAuth, requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { conversations } from '../services/conversation.service.js';

export const conversationsRouter = Router();
conversationsRouter.use(requireAuth);

conversationsRouter.get('/', async (req, res) => {
  const auth = mustAuth(req);
  res.json({ conversations: await conversations.list(auth.id) });
});

conversationsRouter.post('/dm', validateBody(createDmSchema), async (req, res) => {
  const auth = mustAuth(req);
  const conv = await conversations.openDirect(auth.id, req.body.userId);
  res.status(201).json({ conversationId: conv.id });
});

conversationsRouter.post('/group', validateBody(createGroupSchema), async (req, res) => {
  const auth = mustAuth(req);
  const conv = await conversations.createGroup(auth.id, req.body.name, req.body.memberIds);
  res.status(201).json({ conversationId: conv.id });
});

conversationsRouter.get('/:id', async (req, res) => {
  const auth = mustAuth(req);
  res.json({ conversation: await conversations.get(req.params.id!, auth.id) });
});

conversationsRouter.get('/:id/messages', async (req, res) => {
  const auth = mustAuth(req);
  const q = z
    .object({
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    })
    .parse(req.query);
  res.json(
    await conversations.listMessages(req.params.id!, auth.id, {
      cursor: q.cursor,
      limit: q.limit ?? 50,
    }),
  );
});

conversationsRouter.post(
  '/:id/messages',
  validateBody(createConversationMessageSchema),
  async (req, res) => {
    const auth = mustAuth(req);
    const message = await conversations.createMessage({
      conversationId: req.params.id!,
      authorId: auth.id,
      content: req.body.content,
      replyToId: req.body.replyToId ?? null,
      attachmentIds: req.body.attachmentIds,
      clientId: req.body.clientId,
    });
    res.status(201).json({ message });
  },
);

conversationsRouter.patch('/:id', validateBody(updateConversationSchema), async (req, res) => {
  const auth = mustAuth(req);
  const conversation = await conversations.rename(req.params.id!, auth.id, req.body.name);
  res.json({ conversation });
});

conversationsRouter.post('/:id/members', validateBody(addGroupMembersSchema), async (req, res) => {
  const auth = mustAuth(req);
  await conversations.addMembers(req.params.id!, auth.id, req.body.memberIds);
  res.json({ ok: true });
});

conversationsRouter.delete('/:id/members/me', async (req, res) => {
  const auth = mustAuth(req);
  await conversations.leave(req.params.id!, auth.id);
  res.json({ ok: true });
});

conversationsRouter.post('/:id/read', validateBody(markReadSchema), async (req, res) => {
  const auth = mustAuth(req);
  await conversations.markRead(req.params.id!, auth.id, req.body.messageId);
  res.json({ ok: true });
});
