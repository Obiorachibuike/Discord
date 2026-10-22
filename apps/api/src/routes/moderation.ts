import { Router } from 'express';
import { db } from '@cove/db';
import { z } from 'zod';
import { id, paginationSchema, reportSchema } from '@cove/shared';
import { HttpError, route } from '../lib/errors';
import { assertMessageAccess } from '../services/messages';
import { context, requireServer } from '../services/permissions';
import { emitRoom } from '../services/notifications';
const router = Router();
router.post('/reports', route(async (req, res) => {
  const input = reportSchema.parse(req.body);
  if (!input.serverId) throw new HttpError(400, 'SERVER_REQUIRED', 'Reports must be associated with a community.');
  await context(req.auth!.userId, input.serverId);
  if (input.targetMessageId) {
    const message = await assertMessageAccess(req.auth!.userId, input.targetMessageId);
    if (!message.channelId || (await db.channel.findUniqueOrThrow({ where: { id: message.channelId } })).serverId !== input.serverId)
      throw new HttpError(400, 'INVALID_TARGET', 'The reported message must belong to this community.');
  }
  if (input.targetUserId) {
    const member = await db.serverMember.findUnique({ where: { serverId_userId: { serverId: input.serverId, userId: input.targetUserId } } });
    if (!member) throw new HttpError(400, 'INVALID_TARGET', 'The reported user must belong to this community.');
  }
  const report = await db.moderationReport.create({ data: { serverId: input.serverId, reporterId: req.auth!.userId, targetUserId: input.targetUserId, targetMessageId: input.targetMessageId, reason: input.reason } });
  emitRoom(`server:${input.serverId}`, 'moderation:updated', { serverId: input.serverId });
  res.status(201).json({ report: { id: report.id, status: report.status } });
}));
router.get('/servers/:serverId/reports', route(async (req, res) => {
  const serverId = id.parse(req.params.serverId); await requireServer(req.auth!.userId, serverId, 'MODERATE_MEMBERS');
  const { limit, cursor } = paginationSchema.parse(req.query);
  const reports = await db.moderationReport.findMany({ where: { serverId }, include: {
    reporter: { select: { id: true, displayName: true, username: true } }, targetUser: { select: { id: true, displayName: true, username: true } }
  }, take: limit + 1, orderBy: { createdAt: 'desc' }, ...(cursor ? { cursor: { id: id.parse(cursor) }, skip: 1 } : {}) });
  res.json({ reports: reports.slice(0, limit), nextCursor: reports.length > limit ? reports[limit - 1]?.id : null });
}));
router.patch('/servers/:serverId/reports/:reportId', route(async (req, res) => {
  const serverId = id.parse(req.params.serverId); await requireServer(req.auth!.userId, serverId, 'MODERATE_MEMBERS');
  const reportId = id.parse(req.params.reportId); const { status } = z.object({ status: z.enum(['RESOLVED', 'DISMISSED']) }).parse(req.body);
  const result = await db.moderationReport.updateMany({ where: { id: reportId, serverId, status: 'OPEN' }, data: { status, reviewerId: req.auth!.userId, reviewedAt: new Date() } });
  if (!result.count) throw new HttpError(404, 'NOT_FOUND', 'Open report not found.');
  await db.auditLog.create({ data: { serverId, actorId: req.auth!.userId, action: 'REPORT_REVIEWED', targetType: 'report', targetId: reportId, metadata: { status } } });
  res.json({ status });
}));
router.get('/servers/:serverId/history', route(async (req, res) => {
  const serverId = id.parse(req.params.serverId); await requireServer(req.auth!.userId, serverId, 'MODERATE_MEMBERS');
  const { limit, cursor } = paginationSchema.parse(req.query);
  const actions = await db.moderationAction.findMany({ where: { serverId }, take: limit + 1, orderBy: { createdAt: 'desc' }, ...(cursor ? { cursor: { id: id.parse(cursor) }, skip: 1 } : {}) });
  res.json({ actions: actions.slice(0, limit), nextCursor: actions.length > limit ? actions[limit - 1]?.id : null });
}));
export default router;
