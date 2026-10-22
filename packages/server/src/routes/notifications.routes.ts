import { Router } from 'express';
import { mustAuth, requireAuth } from '../middleware/auth.js';
import { notifications } from '../services/notification.service.js';
import { toNotificationDTO } from '../utils/dto.js';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get('/', async (req, res) => {
  const auth = mustAuth(req);
  const items = await notifications.list(auth.id);
  res.json({
    notifications: items.map(toNotificationDTO),
    unread: await notifications.unreadCount(auth.id),
  });
});

notificationsRouter.post('/read-all', async (req, res) => {
  const auth = mustAuth(req);
  await notifications.markAllRead(auth.id);
  res.json({ ok: true });
});

notificationsRouter.post('/:id/read', async (req, res) => {
  const auth = mustAuth(req);
  await notifications.markRead(auth.id, req.params.id!);
  res.json({ ok: true });
});
