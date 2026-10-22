import { Router } from 'express';
import { db } from '@cove/db';
import { id, profileSchema } from '@cove/shared';
import { HttpError, route } from '../lib/errors';
import { publicUser, selfUser } from '../services/users';
import { emitUser } from '../services/notifications';
import { broadcastPresence } from '../services/presence';
import { lockOwnedImage } from '../services/storage';
const router = Router();
router.get('/me', route(async (req, res) => {
  const user = await db.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });
  res.json({ user: selfUser(user) });
}));
router.patch('/me', route(async (req, res) => {
  const input = profileSchema.parse(req.body);
  const user = await db.$transaction(async tx => {
    if (input.avatarUrl && !await lockOwnedImage(tx, input.avatarUrl, req.auth!.userId))
      throw new HttpError(400, 'INVALID_AVATAR', 'Upload an image to use as your avatar.');
    return tx.user.update({ where: { id: req.auth!.userId }, data: input });
  });
  emitUser(user.id, 'profile:updated', publicUser(user));
  if (input.presence) await broadcastPresence(user.id);
  res.json({ user: selfUser(user) });
}));
router.get('/:id', route(async (req, res) => {
  const user = await db.user.findUnique({ where: { id: id.parse(req.params.id) } });
  if (!user) throw new HttpError(404, 'NOT_FOUND', 'User not found.');
  res.json({ user: publicUser(user) });
}));
export default router;
