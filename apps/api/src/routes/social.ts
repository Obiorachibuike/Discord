import { Router } from 'express';
import { db } from '@cove/db';
import { z } from 'zod';
import { conversationSchema, id, username } from '@cove/shared';
import { pairKey } from '../lib/crypto';
import { HttpError, route } from '../lib/errors';
import { requireConversation } from '../services/permissions';
import { disconnectUser, emitUser, notify } from '../services/notifications';
import { publicUser } from '../services/users';
const router = Router();
const me = (req: { auth?: { userId: string } }) => req.auth!.userId;
const friendEvent = (a: string, b: string) => { emitUser(a, 'friend:updated', { userId: b }); emitUser(b, 'friend:updated', { userId: a }); };
async function canContact(from: string, to: string) {
  if (from === to) throw new HttpError(400, 'INVALID_TARGET', 'Choose someone else.');
  const blocked = await db.userBlock.findFirst({ where: { OR: [{ blockerId: from, blockedId: to }, { blockerId: to, blockedId: from }] } });
  if (blocked) throw new HttpError(403, 'BLOCKED', 'You cannot contact this person.');
  const peer = await db.user.findUnique({ where: { id: to } });
  if (!peer) throw new HttpError(404, 'NOT_FOUND', 'User not found.');
  const friendship = await db.friendship.findUnique({ where: { pairKey: pairKey(from, to) } });
  if (friendship?.status === 'ACCEPTED') return peer;
  if (peer.allowDMFromMembers) {
    const shared = await db.serverMember.findFirst({ where: { userId: from, server: { members: { some: { userId: to } } } }, select: { id: true } });
    if (shared) return peer;
  }
  throw new HttpError(403, 'PRIVACY_RESTRICTION', 'This user accepts messages from friends or shared community members only.');
}
router.get('/friends', route(async (req, res) => {
  const userId = me(req);
  const [friendships, blocks] = await Promise.all([
    db.friendship.findMany({ where: { OR: [{ requesterId: userId }, { recipientId: userId }] }, include: { requester: true, recipient: true }, orderBy: { updatedAt: 'desc' } }),
    db.userBlock.findMany({ where: { blockerId: userId }, include: { blocked: true } })
  ]);
  res.json({ friends: friendships.filter(f => f.status === 'ACCEPTED').map(f => publicUser(f.requesterId === userId ? f.recipient : f.requester)),
    incoming: friendships.filter(f => f.status === 'PENDING' && f.recipientId === userId).map(f => ({ id: f.id, user: publicUser(f.requester), createdAt: f.createdAt })),
    outgoing: friendships.filter(f => f.status === 'PENDING' && f.requesterId === userId).map(f => ({ id: f.id, user: publicUser(f.recipient), createdAt: f.createdAt })),
    blocked: blocks.map(b => publicUser(b.blocked)) });
}));
router.post('/friends/requests', route(async (req, res) => {
  const input = z.object({ username }).parse(req.body);
  const peer = await db.user.findUnique({ where: { username: input.username } });
  if (!peer) throw new HttpError(404, 'NOT_FOUND', 'User not found.');
  if (peer.id === me(req)) throw new HttpError(400, 'INVALID_TARGET', 'You cannot add yourself.');
  const blocked = await db.userBlock.findFirst({ where: { OR: [{ blockerId: me(req), blockedId: peer.id }, { blockerId: peer.id, blockedId: me(req) }] } });
  if (blocked) throw new HttpError(403, 'BLOCKED', 'You cannot contact this person.');
  const existing = await db.friendship.findUnique({ where: { pairKey: pairKey(me(req), peer.id) } });
  if (existing) throw new HttpError(409, 'REQUEST_EXISTS', existing.status === 'ACCEPTED' ? 'You are already friends.' : 'A friend request already exists.');
  const request = await db.friendship.create({ data: { pairKey: pairKey(me(req), peer.id), requesterId: me(req), recipientId: peer.id } });
  friendEvent(me(req), peer.id);
  await notify(peer.id, 'FRIEND_REQUEST', { requestId: request.id }, me(req), `friend-request:${request.id}`);
  res.status(201).json({ request: { id: request.id, status: request.status } });
}));
router.post('/friends/requests/:requestId/accept', route(async (req, res) => {
  const request = await db.friendship.findUnique({ where: { id: id.parse(req.params.requestId) } });
  if (!request || request.recipientId !== me(req) || request.status !== 'PENDING') throw new HttpError(404, 'NOT_FOUND', 'Request not found.');
  const blocked = await db.userBlock.findFirst({ where: { OR: [{ blockerId: me(req), blockedId: request.requesterId }, { blockerId: request.requesterId, blockedId: me(req) }] } });
  if (blocked) throw new HttpError(403, 'BLOCKED', 'You cannot accept this request.');
  await db.friendship.update({ where: { id: request.id }, data: { status: 'ACCEPTED' } });
  friendEvent(me(req), request.requesterId);
  await notify(request.requesterId, 'FRIEND_ACCEPTED', { userId: me(req) }, me(req), `friend-accepted:${request.id}`);
  res.json({ status: 'ACCEPTED' });
}));
router.delete('/friends/requests/:requestId', route(async (req, res) => {
  const request = await db.friendship.findUnique({ where: { id: id.parse(req.params.requestId) } });
  if (!request || request.status !== 'PENDING' || request.requesterId !== me(req) && request.recipientId !== me(req)) throw new HttpError(404, 'NOT_FOUND', 'Request not found.');
  await db.friendship.delete({ where: { id: request.id } });
  friendEvent(request.requesterId, request.recipientId); res.status(204).send();
}));
router.delete('/friends/:userId', route(async (req, res) => {
  const peerId = id.parse(req.params.userId);
  const removed = await db.friendship.deleteMany({ where: { pairKey: pairKey(me(req), peerId), status: 'ACCEPTED' } });
  if (!removed.count) throw new HttpError(404, 'NOT_FOUND', 'Friend not found.');
  friendEvent(me(req), peerId); res.status(204).send();
}));
router.post('/blocks/:userId', route(async (req, res) => {
  const peerId = id.parse(req.params.userId);
  if (peerId === me(req)) throw new HttpError(400, 'INVALID_TARGET', 'You cannot block yourself.');
  await db.user.findUniqueOrThrow({ where: { id: peerId } });
  await db.$transaction(async tx => {
    await tx.userBlock.upsert({ where: { blockerId_blockedId: { blockerId: me(req), blockedId: peerId } }, create: { blockerId: me(req), blockedId: peerId }, update: {} });
    await tx.friendship.deleteMany({ where: { pairKey: pairKey(me(req), peerId) } });
  });
  // Prevent an existing DM socket room from being used to bypass the new block.
  disconnectUser(peerId); disconnectUser(me(req)); friendEvent(me(req), peerId);
  res.status(204).send();
}));
router.delete('/blocks/:userId', route(async (req, res) => {
  await db.userBlock.deleteMany({ where: { blockerId: me(req), blockedId: id.parse(req.params.userId) } });
  res.status(204).send();
}));
router.get('/conversations', route(async (req, res) => {
  const memberships = await db.conversationMember.findMany({ where: { userId: me(req) }, include: { conversation: { include: {
    members: { include: { user: true } }, messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, content: true, createdAt: true, deletedAt: true, authorId: true } }
  } } }, orderBy: { joinedAt: 'desc' }, take: 100 });
  res.json({ conversations: memberships.map(m => ({ id: m.conversation.id, kind: m.conversation.kind, name: m.conversation.name, createdById: m.conversation.createdById,
    members: m.conversation.members.map(member => publicUser(member.user)), lastMessage: m.conversation.messages[0] ? { ...m.conversation.messages[0], content: m.conversation.messages[0].deletedAt ? '' : m.conversation.messages[0].content } : null, lastReadAt: m.lastReadAt })) });
}));
router.post('/conversations', route(async (req, res) => {
  const input = conversationSchema.parse(req.body);
  const participantIds = [...new Set(input.participantIds)];
  if (participantIds.length !== input.participantIds.length || participantIds.includes(me(req)) || input.kind === 'DIRECT' && participantIds.length !== 1 || input.kind === 'GROUP' && participantIds.length < 2)
    throw new HttpError(400, 'INVALID_PARTICIPANTS', 'Select distinct participants (one for a DM, at least two for a group).');
  for (const userId of participantIds) await canContact(me(req), userId);
  if (input.kind === 'DIRECT') {
    const directKey = pairKey(me(req), participantIds[0]!);
    const existing = await db.conversation.findUnique({ where: { directKey } });
    if (existing) return res.json({ conversation: existing });
    try {
      const conversation = await db.conversation.create({ data: { kind: 'DIRECT', directKey, createdById: me(req), members: { create: [me(req), participantIds[0]!].map(userId => ({ userId })) } } });
      emitUser(participantIds[0]!, 'conversation:updated', { conversationId: conversation.id });
      return res.status(201).json({ conversation });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
        const conversation = await db.conversation.findUniqueOrThrow({ where: { directKey } });
        return res.json({ conversation });
      }
      throw error;
    }
  }
  const conversation = await db.conversation.create({ data: { kind: 'GROUP', name: input.name || 'New group', createdById: me(req), members: { create: [me(req), ...participantIds].map(userId => ({ userId })) } } });
  for (const userId of participantIds) emitUser(userId, 'conversation:updated', { conversationId: conversation.id });
  res.status(201).json({ conversation });
}));
router.get('/conversations/:conversationId', route(async (req, res) => {
  const conversation = await requireConversation(me(req), id.parse(req.params.conversationId));
  const users = await db.user.findMany({ where: { id: { in: conversation.members.map(m => m.userId) } } });
  res.json({ conversation: { ...conversation, members: users.map(publicUser) } });
}));
router.patch('/conversations/:conversationId', route(async (req, res) => {
  const conversation = await requireConversation(me(req), id.parse(req.params.conversationId));
  if (conversation.kind !== 'GROUP' || conversation.createdById !== me(req)) throw new HttpError(403, 'FORBIDDEN', 'Only the group creator can rename it.');
  const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body);
  const updated = await db.conversation.update({ where: { id: conversation.id }, data: { name } });
  for (const member of conversation.members) emitUser(member.userId, 'conversation:updated', { conversationId: conversation.id });
  res.json({ conversation: updated });
}));
router.post('/conversations/:conversationId/members', route(async (req, res) => {
  const conversation = await requireConversation(me(req), id.parse(req.params.conversationId));
  if (conversation.kind !== 'GROUP' || conversation.createdById !== me(req)) throw new HttpError(403, 'FORBIDDEN', 'Only the group creator can add members.');
  if (conversation.members.length >= 20) throw new HttpError(400, 'GROUP_FULL', 'Groups can have at most 20 participants.');
  const userId = id.parse(req.body?.userId);
  if (conversation.members.some(m => m.userId === userId)) throw new HttpError(409, 'ALREADY_MEMBER', 'Already in this group.');
  await canContact(me(req), userId);
  // Reject adding somebody who blocks (or is blocked by) any existing participant.
  const others = conversation.members.map(m => m.userId);
  const blocked = await db.userBlock.findFirst({ where: { OR: [{ blockerId: userId, blockedId: { in: others } }, { blockedId: userId, blockerId: { in: others } }] } });
  if (blocked) throw new HttpError(403, 'BLOCKED', 'This person cannot be added to the group.');
  await db.conversationMember.create({ data: { conversationId: conversation.id, userId } });
  for (const member of [...conversation.members, { userId }]) emitUser(member.userId, 'conversation:updated', { conversationId: conversation.id });
  res.status(201).json({ userId });
}));
router.post('/conversations/:conversationId/leave', route(async (req, res) => {
  const conversation = await requireConversation(me(req), id.parse(req.params.conversationId));
  if (conversation.kind === 'DIRECT') throw new HttpError(400, 'DIRECT_CONVERSATION', 'Direct messages cannot be left.');
  await db.conversationMember.delete({ where: { conversationId_userId: { conversationId: conversation.id, userId: me(req) } } });
  if (conversation.members.length === 1) await db.conversation.delete({ where: { id: conversation.id } });
  else if (conversation.createdById === me(req)) await db.conversation.update({ where: { id: conversation.id }, data: { createdById: conversation.members.find(m => m.userId !== me(req))!.userId } });
  disconnectUser(me(req));
  for (const member of conversation.members) emitUser(member.userId, 'conversation:updated', { conversationId: conversation.id });
  res.status(204).send();
}));
router.post('/conversations/:conversationId/read', route(async (req, res) => {
  const conversationId = id.parse(req.params.conversationId);
  await requireConversation(me(req), conversationId);
  await db.conversationMember.update({ where: { conversationId_userId: { conversationId, userId: me(req) } }, data: { lastReadAt: new Date() } });
  res.status(204).send();
}));
export default router;
