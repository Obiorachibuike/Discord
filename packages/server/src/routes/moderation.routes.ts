import { Router } from 'express';
import { moderationActionSchema, reportSchema, reviewReportSchema } from '@aether/shared';
import { mustAuth, requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { moderation } from '../services/moderation.service.js';

export const moderationRouter = Router();
moderationRouter.use(requireAuth);

moderationRouter.post('/actions', validateBody(moderationActionSchema), async (req, res) => {
  const auth = mustAuth(req);
  const serverId = (req.body.serverId ?? req.query.serverId) as string;
  if (!serverId) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'serverId is required' } });
  }
  await moderation.act(serverId, auth.id, req.body);
  res.status(201).json({ ok: true });
});

moderationRouter.get('/actions', async (req, res) => {
  const auth = mustAuth(req);
  const serverId = String(req.query.serverId ?? '');
  res.json({ actions: await moderation.history(serverId, auth.id) });
});

moderationRouter.get('/reports', async (req, res) => {
  const auth = mustAuth(req);
  const serverId = String(req.query.serverId ?? '');
  res.json({ reports: await moderation.listReports(serverId, auth.id) });
});

moderationRouter.patch('/reports/:id', validateBody(reviewReportSchema), async (req, res) => {
  const auth = mustAuth(req);
  const report = await moderation.reviewReport(req.params.id!, auth.id, req.body);
  res.json({ report });
});

moderationRouter.get('/audit', async (req, res) => {
  const auth = mustAuth(req);
  const serverId = String(req.query.serverId ?? '');
  res.json({ entries: await moderation.auditLog(serverId, auth.id) });
});

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

reportsRouter.post('/', validateBody(reportSchema), async (req, res) => {
  const auth = mustAuth(req);
  const report = await moderation.report({
    reporterId: auth.id,
    serverId: (req.body.serverId ?? (req.query.serverId as string | undefined)) ?? null,
    reportedUserId: req.body.reportedUserId ?? null,
    messageId: req.body.messageId ?? null,
    reason: req.body.reason,
  });
  res.status(201).json({ report });
});
