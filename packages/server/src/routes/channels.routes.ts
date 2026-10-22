import { Router } from 'express';
import {
  channelOverrideSchema,
  createCategorySchema,
  createChannelSchema,
  reorderChannelsSchema,
  updateChannelSchema,
} from '@aether/shared';
import { z } from 'zod';
import { mustAuth, requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { channels } from '../services/channel.service.js';
import { messages } from '../services/message.service.js';
import { toChannelDTO } from '../utils/dto.js';

export const serverChannelsRouter = Router({ mergeParams: true });
serverChannelsRouter.use(requireAuth);

serverChannelsRouter.get('/', async (req, res) => {
  const auth = mustAuth(req);
  const result = await channels.list((req.params as Record<string, string>).id!, auth.id);
  res.json(result);
});

serverChannelsRouter.post('/', validateBody(createChannelSchema), async (req, res) => {
  const auth = mustAuth(req);
  const channel = await channels.create((req.params as Record<string, string>).id!, auth.id, req.body);
  res.status(201).json({ channel: toChannelDTO(channel) });
});

serverChannelsRouter.patch('/reorder', validateBody(reorderChannelsSchema), async (req, res) => {
  const auth = mustAuth(req);
  await channels.reorder((req.params as Record<string, string>).id!, auth.id, req.body.items);
  res.json({ ok: true });
});

serverChannelsRouter.post('/categories', validateBody(createCategorySchema), async (req, res) => {
  const auth = mustAuth(req);
  const category = await channels.createCategory((req.params as Record<string, string>).id!, auth.id, req.body.name);
  res.status(201).json({ category });
});

serverChannelsRouter.patch('/categories/:categoryId', validateBody(createCategorySchema), async (req, res) => {
  const auth = mustAuth(req);
  const category = await channels.updateCategory((req.params as Record<string, string>).categoryId!, auth.id, req.body.name);
  res.json({ category });
});

serverChannelsRouter.delete('/categories/:categoryId', async (req, res) => {
  const auth = mustAuth(req);
  await channels.deleteCategory((req.params as Record<string, string>).categoryId!, auth.id);
  res.json({ ok: true });
});

export const channelRouter = Router({ mergeParams: true });
channelRouter.use(requireAuth);

channelRouter.patch('/', validateBody(updateChannelSchema), async (req, res) => {
  const auth = mustAuth(req);
  const channel = await channels.update((req.params as Record<string, string>).channelId!, auth.id, req.body);
  res.json({ channel: toChannelDTO(channel) });
});

channelRouter.delete('/', async (req, res) => {
  const auth = mustAuth(req);
  await channels.remove((req.params as Record<string, string>).channelId!, auth.id);
  res.json({ ok: true });
});

channelRouter.put('/overrides/:targetId', validateBody(channelOverrideSchema), async (req, res) => {
  const auth = mustAuth(req);
  const target = z
    .object({ type: z.enum(['role', 'user']).default('role') })
    .parse(req.query);
  const override = await channels.setOverride(
    (req.params as Record<string, string>).channelId!,
    auth.id,
    target.type === 'user' ? { userId: (req.params as Record<string, string>).targetId! } : { roleId: (req.params as Record<string, string>).targetId! },
    req.body,
  );
  res.json({ override: { id: override.id, allow: override.allow.toString(), deny: override.deny.toString() } });
});

channelRouter.get('/messages', async (req, res) => {
  const auth = mustAuth(req);
  const q = z
    .object({
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      direction: z.enum(['before', 'after']).optional(),
    })
    .parse(req.query);
  const result = await messages.listChannelMessages((req.params as Record<string, string>).channelId!, auth.id, {
    cursor: q.cursor,
    limit: q.limit ?? 50,
    direction: q.direction,
  });
  res.json(result);
});

channelRouter.get('/pins', async (req, res) => {
  const auth = mustAuth(req);
  const items = await messages.listPins((req.params as Record<string, string>).channelId!, auth.id);
  res.json({ pins: items });
});
