import { Router } from 'express';
import { db } from '@cove/db';
import { id, paginationSchema } from '@cove/shared';
import { route } from '../lib/errors';
const router = Router();
router.get('/', route(async (req, res) => {
  const { limit, cursor } = paginationSchema.parse(req.query);
  const [notifications, unreadCount] = await Promise.all([
    db.notification.findMany({ where: { userId: req.auth!.userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1,
      ...(cursor ? { cursor: { id: id.parse(cursor) }, skip: 1 } : {}) }),
    db.notification.count({ where: { userId: req.auth!.userId, readAt: null } })
  ]);
  res.json({ notifications: notifications.slice(0, limit), unreadCount, nextCursor: notifications.length > limit ? notifications[limit - 1]?.id : null });
}));
router.post('/read-all', route(async (req, res) => {
  await db.notification.updateMany({ where: { userId: req.auth!.userId, readAt: null }, data: { readAt: new Date() } });
  res.status(204).send();
}));
router.post('/:notificationId/read', route(async (req, res) => {
  await db.notification.updateMany({ where: { id: id.parse(req.params.notificationId), userId: req.auth!.userId }, data: { readAt: new Date() } });
  res.status(204).send();
}));
export default router;
