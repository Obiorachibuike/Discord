import { Router } from 'express';
import { db, Prisma } from '@cove/db';
import { id, paginationSchema, editMessageSchema } from '@cove/shared';
import { z } from 'zod';
import { HttpError, route } from '../lib/errors';
import { canChannel, context, requireChannel } from '../services/permissions';
import { deleteMessage, editMessage, messageHistory, sendMessage, toggleReaction, togglePin, serializeMessage } from '../services/messages';
const router = Router();
router.get('/channels/:channelId', route(async (req, res) => {
  const { limit, cursor } = paginationSchema.parse(req.query);
  res.json(await messageHistory(req.auth!.userId, { channelId: id.parse(req.params.channelId) }, limit, cursor));
}));
router.post('/channels/:channelId', route(async (req, res) => res.status(201).json(await sendMessage(req.auth!.userId, { channelId: id.parse(req.params.channelId) }, req.body))));
router.get('/conversations/:conversationId', route(async (req, res) => {
  const { limit, cursor } = paginationSchema.parse(req.query);
  res.json(await messageHistory(req.auth!.userId, { conversationId: id.parse(req.params.conversationId) }, limit, cursor));
}));
router.post('/conversations/:conversationId', route(async (req, res) => res.status(201).json(await sendMessage(req.auth!.userId, { conversationId: id.parse(req.params.conversationId) }, req.body))));
router.patch('/:messageId', route(async (req, res) => {
  const { content } = editMessageSchema.parse(req.body);
  res.json({ message: await editMessage(req.auth!.userId, id.parse(req.params.messageId), content) });
}));
router.delete('/:messageId', route(async (req, res) => { await deleteMessage(req.auth!.userId, id.parse(req.params.messageId)); res.status(204).send(); }));
router.post('/:messageId/reactions', route(async (req, res) => res.json(await toggleReaction(req.auth!.userId, id.parse(req.params.messageId), req.body))));
router.post('/:messageId/pin', route(async (req, res) => res.json({ message: await togglePin(req.auth!.userId, id.parse(req.params.messageId)) })));
router.get('/channels/:channelId/pins', route(async (req, res) => {
  const channelId = id.parse(req.params.channelId); await requireChannel(req.auth!.userId, channelId, 'VIEW_CHANNEL');
  const pins = await db.message.findMany({ where: { channelId, pin: { isNot: null }, deletedAt: null }, include: {
    author: true, attachments: true, reactions: { select: { userId: true, emoji: true } }, pin: { select: { pinnedById: true, createdAt: true } }, replyTo: { select: { id: true, authorId: true, content: true, deletedAt: true } }
  }, orderBy: { createdAt: 'desc' }, take: 50 });
  res.json({ messages: pins.map(serializeMessage) });
}));
// Authorization FIRST, then PostgreSQL full-text search; private channels never enter the SQL channel set.
router.get('/search', route(async (req, res) => {
  const query = z.object({
    q: z.string().trim().min(2).max(100), serverId: id.optional(), channelId: id.optional(), authorId: id.optional(),
    from: z.coerce.date().optional(), to: z.coerce.date().optional(),
    page: z.coerce.number().int().min(0).max(100).default(0), limit: z.coerce.number().int().min(1).max(30).default(20)
  }).parse(req.query);
  let channelIds: string[];
  if (query.channelId) {
    const { channel } = await requireChannel(req.auth!.userId, query.channelId, 'VIEW_CHANNEL');
    if (channel.kind === 'VOICE' || query.serverId && channel.serverId !== query.serverId) throw new HttpError(404, 'NOT_FOUND', 'Channel not found.');
    channelIds = [channel.id];
  } else {
    const memberships = await db.serverMember.findMany({ where: { userId: req.auth!.userId, ...(query.serverId ? { serverId: query.serverId } : {}) }, select: { serverId: true } });
    if (query.serverId && !memberships.length) throw new HttpError(404, 'NOT_FOUND', 'Community not found.');
    const channels = await db.channel.findMany({ where: { serverId: { in: memberships.map(m => m.serverId) }, kind: { not: 'VOICE' } }, include: { overrides: true } });
    const contexts = new Map(await Promise.all(memberships.map(async m => [m.serverId, await context(req.auth!.userId, m.serverId)] as const)));
    channelIds = channels.filter(c => { const ctx = contexts.get(c.serverId); return ctx && canChannel(ctx, c, 'VIEW_CHANNEL'); }).map(c => c.id);
  }
  if (!channelIds.length) return res.json({ results: [], nextPage: null });
  const conditions = [Prisma.sql`m."channelId" IN (${Prisma.join(channelIds.map(channelId => Prisma.sql`${channelId}::uuid`))})`, Prisma.sql`m."deletedAt" IS NULL`,
    Prisma.sql`to_tsvector('simple', coalesce(m."content", '')) @@ plainto_tsquery('simple', ${query.q})`];
  if (query.authorId) conditions.push(Prisma.sql`m."authorId" = ${query.authorId}::uuid`);
  if (query.from) conditions.push(Prisma.sql`m."createdAt" >= ${query.from}`);
  if (query.to) conditions.push(Prisma.sql`m."createdAt" <= ${query.to}`);
  const result = await db.$queryRaw<{ id: string; channelId: string; serverId: string; createdAt: Date; content: string; authorId: string }[]>(Prisma.sql`
    SELECT m."id", m."channelId", c."serverId", m."createdAt", m."content", m."authorId" FROM "Message" m JOIN "Channel" c ON c."id" = m."channelId"
    WHERE ${Prisma.join(conditions, ' AND ')}
    ORDER BY ts_rank(to_tsvector('simple', coalesce(m."content", '')), plainto_tsquery('simple', ${query.q})) DESC, m."createdAt" DESC
    LIMIT ${query.limit + 1} OFFSET ${query.page * query.limit}
  `);
  const users = await db.user.findMany({ where: { id: { in: result.map(r => r.authorId) } } });
  const byId = new Map(users.map(u => [u.id, { id: u.id, username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl }]));
  res.json({ results: result.slice(0, query.limit).map(r => ({ ...r, preview: r.content.slice(0, 250), author: byId.get(r.authorId) })), nextPage: result.length > query.limit ? query.page + 1 : null });
}));
export default router;
