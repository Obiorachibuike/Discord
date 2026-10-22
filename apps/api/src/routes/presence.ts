import { Router } from 'express';
import { db } from '@cove/db';
import { z } from 'zod';
import { id } from '@cove/shared';
import { route } from '../lib/errors';
import { visiblePresence } from '../services/presence';
const router = Router();
router.get('/', route(async (req, res) => {
  const userIds = z.array(id).max(100).parse(String(req.query.ids || '').split(',').filter(Boolean));
  if (!userIds.length) return res.json({ presences: {} });
  const [mine, friendships] = await Promise.all([
    db.serverMember.findMany({ where: { userId: req.auth!.userId }, select: { serverId: true } }),
    db.friendship.findMany({ where: { status: 'ACCEPTED', OR: [{ requesterId: req.auth!.userId }, { recipientId: req.auth!.userId }] }, select: { requesterId: true, recipientId: true } })
  ]);
  const friends = new Set(friendships.map(f => f.requesterId === req.auth!.userId ? f.recipientId : f.requesterId));
  const members = await db.serverMember.findMany({ where: { userId: { in: userIds }, serverId: { in: mine.map(m => m.serverId) } }, select: { userId: true } });
  const allowed = new Set([...members.map(m => m.userId), ...friends, req.auth!.userId]);
  res.json({ presences: Object.fromEntries(await Promise.all(userIds.filter(userId => allowed.has(userId)).map(async userId => [userId, await visiblePresence(userId)]))) });
}));
export default router;
