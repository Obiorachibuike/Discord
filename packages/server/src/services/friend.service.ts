import { prisma } from '../context.js';
import { ApiError } from '../errors.js';
import { toPublicUser } from '../utils/dto.js';
import { tryGetIO } from '../socket/io.js';
import { notifications } from './notification.service.js';

export class FriendService {
  async list(userId: string) {
    const [accepted, incoming, outgoing] = await Promise.all([
      prisma.friendRequest.findMany({
        where: {
          status: 'ACCEPTED',
          OR: [{ senderId: userId }, { recipientId: userId }],
        },
        include: { sender: true, recipient: true },
        orderBy: { respondedAt: 'desc' },
      }),
      prisma.friendRequest.findMany({
        where: { status: 'PENDING', recipientId: userId },
        include: { sender: true, recipient: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.friendRequest.findMany({
        where: { status: 'PENDING', senderId: userId },
        include: { sender: true, recipient: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      friends: accepted.map((f) => {
        const other = f.senderId === userId ? f.recipient : f.sender;
        return {
          id: f.id,
          user: toPublicUser(other),
          status: 'ACCEPTED' as const,
          createdAt: (f.respondedAt ?? f.createdAt).toISOString(),
        };
      }),
      incoming: incoming.map((f) => ({
        id: f.id,
        user: toPublicUser(f.sender),
        status: 'PENDING_INCOMING' as const,
        createdAt: f.createdAt.toISOString(),
      })),
      outgoing: outgoing.map((f) => ({
        id: f.id,
        user: toPublicUser(f.recipient),
        status: 'PENDING_OUTGOING' as const,
        createdAt: f.createdAt.toISOString(),
      })),
    };
  }

  async sendRequest(fromId: string, username: string) {
    const to = await prisma.user.findUnique({
      where: { username: username.toLowerCase() },
    });
    if (!to) throw ApiError.notFound('User not found');
    if (to.id === fromId) throw ApiError.badRequest('You cannot friend yourself');
    await this.assertNotBlocked(fromId, to.id);
    const privacy = to.privacySettings as { allowFriendRequests?: boolean };
    if (privacy.allowFriendRequests === false) {
      throw ApiError.forbidden('This user is not accepting friend requests');
    }
    const existing = await prisma.friendRequest.findFirst({
      where: {
        OR: [
          { senderId: fromId, recipientId: to.id },
          { senderId: to.id, recipientId: fromId },
        ],
      },
    });
    if (existing) {
      if (existing.status === 'ACCEPTED') throw ApiError.conflict('You are already friends');
      if (existing.status === 'PENDING') {
        if (existing.recipientId === fromId) {
          // Symmetric accept of the opposite request.
          return this.respond(existing.id, fromId, 'ACCEPTED');
        }
        throw ApiError.conflict('A friend request is already pending');
      }
      // REJECTED / CANCELLED → allow a fresh request.
      await prisma.friendRequest.delete({ where: { id: existing.id } });
    }
    const req = await prisma.friendRequest.create({
      data: { senderId: fromId, recipientId: to.id },
      include: { sender: true, recipient: true },
    });
    const io = tryGetIO();
    io?.to(`user:${to.id}`).emit('friend:request', {
      id: req.id,
      user: toPublicUser(req.sender),
      direction: 'incoming',
    });
    const sender = await prisma.user.findUniqueOrThrow({ where: { id: fromId } });
    await notifications.push({
      userId: to.id,
      type: 'FRIEND_REQUEST',
      title: 'New friend request',
      body: `${sender.displayName} wants to be your friend`,
      data: { requestId: req.id, userId: fromId },
    });
    return req;
  }

  async respond(requestId: string, userId: string, action: 'ACCEPTED' | 'REJECTED') {
    const req = await prisma.friendRequest.findUnique({
      where: { id: requestId },
      include: { sender: true, recipient: true },
    });
    if (!req || req.recipientId !== userId) throw ApiError.notFound('Request not found');
    if (req.status !== 'PENDING') throw ApiError.conflict('This request was already handled');
    const updated = await prisma.friendRequest.update({
      where: { id: requestId },
      data: { status: action, respondedAt: new Date() },
    });
    const io = tryGetIO();
    io?.to(`user:${req.senderId}`).emit('friend:updated', {
      id: requestId,
      status: action,
      user: toPublicUser(req.recipient),
    });
    io?.to(`user:${req.recipientId}`).emit('friend:updated', {
      id: requestId,
      status: action,
      user: toPublicUser(req.sender),
    });
    if (action === 'ACCEPTED') {
      await notifications.push({
        userId: req.senderId,
        type: 'FRIEND_ACCEPTED',
        title: 'Friend request accepted',
        body: `${req.recipient.displayName} accepted your friend request`,
        data: { userId: req.recipientId },
      });
    }
    return updated;
  }

  async cancel(requestId: string, userId: string) {
    const req = await prisma.friendRequest.findUnique({ where: { id: requestId } });
    if (!req || req.senderId !== userId) throw ApiError.notFound('Request not found');
    if (req.status !== 'PENDING') throw ApiError.conflict('This request was already handled');
    await prisma.friendRequest.delete({ where: { id: requestId } });
    tryGetIO()?.to(`user:${req.recipientId}`).emit('friend:updated', {
      id: requestId,
      status: 'CANCELLED',
    });
  }

  async removeFriend(userId: string, otherId: string) {
    const req = await prisma.friendRequest.findFirst({
      where: {
        status: 'ACCEPTED',
        OR: [
          { senderId: userId, recipientId: otherId },
          { senderId: otherId, recipientId: userId },
        ],
      },
    });
    if (!req) throw ApiError.notFound('You are not friends with this user');
    await prisma.friendRequest.delete({ where: { id: req.id } });
    tryGetIO()?.to(`user:${otherId}`).emit('friend:updated', { status: 'REMOVED', userId });
    tryGetIO()?.to(`user:${userId}`).emit('friend:updated', { status: 'REMOVED', userId: otherId });
  }

  async block(blockerId: string, blockedId: string) {
    if (blockerId === blockedId) throw ApiError.badRequest('You cannot block yourself');
    const target = await prisma.user.findUnique({ where: { id: blockedId } });
    if (!target) throw ApiError.notFound('User not found');
    await prisma.userBlock.upsert({
      where: { blockerId_blockedId: { blockerId, blockedId } },
      create: { blockerId, blockedId },
      update: {},
    });
    // Blocking removes any friendship/request both ways.
    await prisma.friendRequest.deleteMany({
      where: {
        OR: [
          { senderId: blockerId, recipientId: blockedId },
          { senderId: blockedId, recipientId: blockerId },
        ],
      },
    });
    tryGetIO()?.to(`user:${blockerId}`).emit('friend:updated', { status: 'BLOCKED', userId: blockedId });
    tryGetIO()?.to(`user:${blockedId}`).emit('friend:updated', { status: 'BLOCKED_BY', userId: blockerId });
  }

  async unblock(blockerId: string, blockedId: string) {
    await prisma.userBlock.deleteMany({ where: { blockerId, blockedId } });
  }

  async listBlocks(userId: string) {
    const blocks = await prisma.userBlock.findMany({
      where: { blockerId: userId },
      include: { blocked: true },
    });
    return blocks.map((b) => toPublicUser(b.blocked));
  }

  private async assertNotBlocked(a: string, b: string) {
    const block = await prisma.userBlock.findFirst({
      where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] },
    });
    if (block) throw ApiError.forbidden('You cannot interact with this user');
  }

  /** Friend ids — used for presence fan-out. */
  async friendIds(userId: string): Promise<string[]> {
    const rows = await prisma.friendRequest.findMany({
      where: { status: 'ACCEPTED', OR: [{ senderId: userId }, { recipientId: userId }] },
      select: { senderId: true, recipientId: true },
    });
    return rows.map((r) => (r.senderId === userId ? r.recipientId : r.senderId));
  }
}

export const friends = new FriendService();
