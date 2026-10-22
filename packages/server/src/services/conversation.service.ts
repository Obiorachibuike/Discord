import { LIMITS, type ConversationDTO, type MessageDTO } from '@aether/shared';
import type { Prisma } from '@aether/database';
import { prisma } from '../context.js';
import { ApiError } from '../errors.js';
import { toConversationDTO, toMessageDTO } from '../utils/dto.js';
import { tryGetIO } from '../socket/io.js';
import { notifications } from './notification.service.js';

const convMessageInclude = {
  author: true,
  replyTo: { include: { author: true } },
  attachments: true,
  reactions: true,
  pins: true,
} satisfies Prisma.MessageInclude;

type ConvMessageRecord = Prisma.MessageGetPayload<{ include: typeof convMessageInclude }>;

export class ConversationService {
  /** Single DM per user pair via normalized `directKey`. */
  async openDirect(userId: string, otherId: string) {
    if (userId === otherId) throw ApiError.badRequest('You cannot DM yourself');
    await this.assertNotBlocked(userId, otherId);
    const other = await prisma.user.findUnique({ where: { id: otherId } });
    if (!other) throw ApiError.notFound('User not found');
    const privacy = other.privacySettings as { allowDmsFromFriendsOnly?: boolean };
    if (privacy.allowDmsFromFriendsOnly) {
      const friends = await this.areFriends(userId, otherId);
      if (!friends) throw ApiError.forbidden('This user only accepts DMs from friends');
    }
    const directKey = [userId, otherId].sort().join(':');
    const existing = await prisma.conversation.findUnique({
      where: { directKey },
      include: { members: { include: { user: true } } },
    });
    if (existing) return existing;
    const created = await prisma.conversation.create({
      data: {
        type: 'DIRECT',
        directKey,
        creatorId: userId,
        members: { create: [{ userId }, { userId: otherId }] },
      },
      include: { members: { include: { user: true } } },
    });
    const io = tryGetIO();
    for (const uid of [userId, otherId]) {
      io?.to(`user:${uid}`).socketsJoin(`conversation:${created.id}`);
    }
    io?.to(`user:${userId}`).emit('conversation:created', { id: created.id });
    io?.to(`user:${otherId}`).emit('conversation:created', { id: created.id });
    return created;
  }

  async createGroup(userId: string, name: string, memberIds: string[]) {
    const unique = [...new Set(memberIds.filter((id) => id !== userId))];
    if (!unique.length) throw ApiError.badRequest('Add at least one other member');
    if (unique.length > 9) throw ApiError.badRequest('Groups support up to 10 members');
    for (const id of unique) await this.assertNotBlocked(userId, id);
    const conversation = await prisma.conversation.create({
      data: {
        type: 'GROUP',
        name: name.slice(0, LIMITS.conversationNameMax),
        creatorId: userId,
        members: { create: [{ userId }, ...unique.map((id) => ({ userId: id }))], },
      },
      include: { members: { include: { user: true } } },
    });
    const io = tryGetIO();
    for (const m of conversation.members) {
      io?.to(`user:${m.userId}`).socketsJoin(`conversation:${conversation.id}`);
      io?.to(`user:${m.userId}`).emit('conversation:created', { id: conversation.id });
    }
    return conversation;
  }

  async list(userId: string) {
    const convs = await prisma.conversation.findMany({
      where: { members: { some: { userId } } },
      include: {
        members: { include: { user: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { author: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
    const result: ConversationDTO[] = [];
    for (const c of convs) {
      const read = await prisma.conversationReadState.findUnique({
        where: { userId_conversationId: { userId, conversationId: c.id } },
      });
      const unread = await prisma.message.count({
        where: {
          conversationId: c.id,
          authorId: { not: userId },
          ...(read ? { createdAt: { gt: read.lastReadAt } } : {}),
        },
      });
      result.push(toConversationDTO(c, unread));
    }
    return result;
  }

  async assertMember(conversationId: string, userId: string) {
    const member = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!member) throw ApiError.forbidden('Not a conversation participant');
    return member;
  }

  async get(conversationId: string, userId: string) {
    await this.assertMember(conversationId, userId);
    const c = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: {
        members: { include: { user: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1, include: { author: true } },
      },
    });
    const read = await prisma.conversationReadState.findUnique({
      where: { userId_conversationId: { userId, conversationId } },
    });
    const unread = await prisma.message.count({
      where: {
        conversationId,
        authorId: { not: userId },
        ...(read ? { createdAt: { gt: read.lastReadAt } } : {}),
      },
    });
    return toConversationDTO(c, unread);
  }

  async listMessages(
    conversationId: string,
    userId: string,
    opts: { cursor?: string; limit: number },
  ) {
    await this.assertMember(conversationId, userId);
    const messages = await prisma.message.findMany({
      where: { conversationId },
      include: convMessageInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: opts.limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    const hasMore = messages.length > opts.limit;
    const items = (hasMore ? messages.slice(0, opts.limit) : messages)
      .map((m) => toMessageDTO(m, userId))
      .reverse();
    return {
      items,
      nextCursor: hasMore ? items[0]?.id : null,
    };
  }

  private dto(m: ConvMessageRecord, meId: string): MessageDTO {
    return toMessageDTO(m, meId);
  }

  async createMessage(input: {
    conversationId: string;
    authorId: string;
    content?: string;
    replyToId?: string | null;
    attachmentIds?: string[];
    clientId?: string;
  }): Promise<MessageDTO> {
    await this.assertMember(input.conversationId, input.authorId);
    if (!input.content?.trim() && !input.attachmentIds?.length) {
      throw ApiError.badRequest('Message cannot be empty');
    }
    if (input.content && input.content.length > LIMITS.messageMax) {
      throw ApiError.badRequest('Message is too long');
    }
    if (input.clientId) {
      const existing = await prisma.message.findFirst({
        where: {
          conversationId: input.conversationId,
          authorId: input.authorId,
          clientId: input.clientId,
        },
        include: convMessageInclude,
      });
      if (existing) return this.dto(existing, input.authorId);
    }
    const message = await prisma.message.create({
      data: {
        conversationId: input.conversationId,
        authorId: input.authorId,
        content: input.content ?? '',
        replyToId: input.replyToId ?? null,
        clientId: input.clientId ?? null,
        attachments: input.attachmentIds?.length
          ? { connect: input.attachmentIds.map((id) => ({ id })) }
          : undefined,
      },
      include: convMessageInclude,
    });
    await prisma.conversation.update({
      where: { id: input.conversationId },
      data: { updatedAt: new Date() },
    });
    const dto = this.dto(message, input.authorId);
    tryGetIO()
      ?.to(`conversation:${input.conversationId}`)
      .emit('message:created', dto);

    // DM notifications + presence of blocks on read receipts.
    const conv = await prisma.conversation.findUniqueOrThrow({
      where: { id: input.conversationId },
      include: { members: true },
    });
    for (const member of conv.members) {
      if (member.userId === input.authorId) continue;
      await notifications.push({
        userId: member.userId,
        type: 'DM',
        title: `New message from ${dto.author.displayName}`,
        body: (dto.content || 'Sent an attachment').slice(0, 140),
        data: { conversationId: input.conversationId, messageId: dto.id },
      });
    }
    return dto;
  }

  async rename(conversationId: string, userId: string, name: string) {
    await this.assertMember(conversationId, userId);
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    if (conv.type !== 'GROUP') throw ApiError.badRequest('Only group conversations can be renamed');
    if (conv.creatorId !== userId) throw ApiError.forbidden('Only the creator can rename this group');
    const updated = await prisma.conversation.update({
      where: { id: conversationId },
      data: { name },
      include: { members: { include: { user: true } }, messages: { orderBy: { createdAt: 'desc' }, take: 1, include: { author: true } } },
    });
    tryGetIO()?.to(`conversation:${conversationId}`).emit('conversation:updated', {
      id: conversationId,
      name,
    });
    return toConversationDTO(updated, 0);
  }

  async addMembers(conversationId: string, userId: string, memberIds: string[]) {
    await this.assertMember(conversationId, userId);
    const conv = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: { members: true },
    });
    if (conv.type !== 'GROUP') throw ApiError.badRequest('Members can only be added to groups');
    if (conv.creatorId !== userId) throw ApiError.forbidden('Only the creator can add members');
    if (conv.members.length + memberIds.length > 10) {
      throw ApiError.badRequest('Groups support up to 10 members');
    }
    for (const id of memberIds) {
      await this.assertNotBlocked(userId, id);
    }
    await prisma.conversationMember.createMany({
      data: memberIds.map((id) => ({ conversationId, userId: id })),
      skipDuplicates: true,
    });
    const io = tryGetIO();
    for (const id of memberIds) {
      io?.to(`user:${id}`).socketsJoin(`conversation:${conversationId}`);
      io?.to(`user:${id}`).emit('conversation:created', { id: conversationId });
    }
  }

  async leave(conversationId: string, userId: string) {
    await this.assertMember(conversationId, userId);
    const conv = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: { members: true },
    });
    if (conv.type === 'DIRECT') throw ApiError.badRequest('You cannot leave a direct conversation');
    await prisma.conversationMember.delete({
      where: { conversationId_userId: { conversationId, userId } },
    });
    tryGetIO()?.in(`user:${userId}`).socketsLeave(`conversation:${conversationId}`);
    if (conv.members.length <= 2) {
      await prisma.conversation.delete({ where: { id: conversationId } });
      tryGetIO()?.to(`conversation:${conversationId}`).emit('conversation:updated', {
        id: conversationId,
        deleted: true,
      });
    } else {
      tryGetIO()?.to(`conversation:${conversationId}`).emit('conversation:updated', {
        id: conversationId,
        memberLeft: userId,
      });
    }
  }

  async markRead(conversationId: string, userId: string, messageId?: string) {
    await this.assertMember(conversationId, userId);
    await prisma.conversationReadState.upsert({
      where: { userId_conversationId: { userId, conversationId } },
      create: {
        userId,
        conversationId,
        lastReadMessageId: messageId ?? null,
      },
      update: { lastReadAt: new Date(), lastReadMessageId: messageId ?? null },
    });
    tryGetIO()?.to(`user:${userId}`).emit('readstate:updated', { conversationId });
  }

  private async assertNotBlocked(a: string, b: string) {
    const block = await prisma.userBlock.findFirst({
      where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] },
    });
    if (block) throw ApiError.forbidden('You cannot message this user');
  }

  private async areFriends(a: string, b: string): Promise<boolean> {
    const fr = await prisma.friendRequest.findFirst({
      where: {
        status: 'ACCEPTED',
        OR: [
          { senderId: a, recipientId: b },
          { senderId: b, recipientId: a },
        ],
      },
    });
    return Boolean(fr);
  }
}

export const conversations = new ConversationService();
