import { Router } from 'express';
import { friendRequestSchema } from '@aether/shared';
import { z } from 'zod';
import { mustAuth, requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { friends } from '../services/friend.service.js';

export const friendsRouter = Router();
friendsRouter.use(requireAuth);

friendsRouter.get('/', async (req, res) => {
  const auth = mustAuth(req);
  res.json(await friends.list(auth.id));
});

friendsRouter.post('/requests', validateBody(friendRequestSchema), async (req, res) => {
  const auth = mustAuth(req);
  await friends.sendRequest(auth.id, req.body.username);
  res.status(201).json({ ok: true });
});

friendsRouter.post('/requests/:id/accept', async (req, res) => {
  const auth = mustAuth(req);
  await friends.respond(req.params.id!, auth.id, 'ACCEPTED');
  res.json({ ok: true });
});

friendsRouter.post('/requests/:id/reject', async (req, res) => {
  const auth = mustAuth(req);
  await friends.respond(req.params.id!, auth.id, 'REJECTED');
  res.json({ ok: true });
});

friendsRouter.delete('/requests/:id', async (req, res) => {
  const auth = mustAuth(req);
  await friends.cancel(req.params.id!, auth.id);
  res.json({ ok: true });
});

friendsRouter.delete('/:userId', async (req, res) => {
  const auth = mustAuth(req);
  await friends.removeFriend(auth.id, req.params.userId!);
  res.json({ ok: true });
});

friendsRouter.get('/blocks', async (req, res) => {
  const auth = mustAuth(req);
  res.json({ blocked: await friends.listBlocks(auth.id) });
});

friendsRouter.post('/blocks', async (req, res) => {
  const auth = mustAuth(req);
  const parsed = z.object({ userId: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'userId required' } });
  await friends.block(auth.id, parsed.data.userId);
  res.status(201).json({ ok: true });
});

friendsRouter.delete('/blocks/:userId', async (req, res) => {
  const auth = mustAuth(req);
  await friends.unblock(auth.id, req.params.userId!);
  res.json({ ok: true });
});
