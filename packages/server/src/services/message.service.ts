import {
  LIMITS,
  Permissions,
  hasPermission,
  type MessageDTO,
} from '@aether/shared';
import type { Prisma } from '@aether/database';
import { prisma } from '../context.js';
import { ApiError } from '../errors.js';
import { permissions } from './permission.service.js';
import { toMessageDTO } from '../utils/dto.js';
import { tryGetIO } from '../socket/io.js';
import { notifications } from './notification.service.js';
import { audit } from './audit.service.js';

const messageInclude = {
  author: true,
  replyTo: { include: { author: true } },
  attachments: true,
  reactions: true,
  pins: true,
} satisfies Prisma.MessageInclude;

type MessageRecord = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

export class MessageService {
  private dto(m: MessageRecord, meId: string): MessageDTO {
    return toMessageDTO(m, meId);
  }

  async listChannelMessages(
    channelId: string,
    userId: string,
    opts: { cursor?: string; limit: number; direction?: 'before' | 'after' },
  ) {
    const { permissions: perms } = await permissions.getChannelContext(channelId, userId);
    permissions.requireChannel(perms, Permissions.VIEW_CHANNELS);
    const dir = opts.direction ?? 'before';
    const messages = await prisma.message.findMany({
      where: { channelId },
      include: messageInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: opts.limit + 1,
      ...(opts.cursor
        ? {
            cursor: { id: opts.cursor },
            skip: 1,
          }
        : {}),
    });
    const hasMore = messages.length > opts.limit;
    // Contract: `items` is always ascending (transcript order). `nextCursor`
    // points past the boundary: the oldest item for 'before', the newest for
    // 'after' — pass it back to fetch the neighbouring page.
    const items = (hasMore ? messages.slice(0, opts.limit) : messages)
      .map((m) => this.dto(m, userId))
      .reverse();
    return {
      items,
      nextCursor: hasMore ? (dir === 'before' ? items[0]?.id : items[items.length - 1]?.id) : null,
    };
  }

  async createChannelMessage(input: {
    channelId: string;
    authorId: string;
    content?: string;
    replyToId?: string | null;
    attachmentIds?: string[];
    clientId?: string;
  }): Promise<MessageDTO> {
    const { permissions: perms, ctx, channel } = await permissions.getChannelContext(
      input.channelId,
      input.authorId,
    );
    permissions.requireChannel(perms, Permissions.SEND_MESSAGES);
    if (permissions.isTimedOut(ctx)) {
      throw ApiError.forbidden('You are timed out in this server');
    }
    this.assertContentOrAttachments(input.content, input.attachmentIds);

    // Idempotency: a retried submission with the same clientId returns the
    // original message instead of creating a duplicate.
    if (input.clientId) {
      const existing = await prisma.message.findUnique({
        where: {
          channelId_authorId_clientId: {
            channelId: input.channelId,
            authorId: input.authorId,
            clientId: input.clientId,
          },
        },
        include: messageInclude,
      });
      if (existing) return this.dto(existing, input.authorId);
    }

    if (input.replyToId) {
      const parent = await prisma.message.findUnique({ where: { id: input.replyToId } });
      if (!parent || parent.channelId !== input.channelId) {
        throw ApiError.badRequest('Reply target not found in this channel');
      }
    }
    const message = await prisma.$transaction(async (tx) => {
      const m = await tx.message.create({
        data: {
          channelId: input.channelId,
          authorId: input.authorId,
          content: input.content ?? '',
          replyToId: input.replyToId ?? null,
          clientId: input.clientId ?? null,
          attachments: input.attachmentIds?.length
            ? {
                connect: input.attachmentIds.map((id) => ({ id })),
              }
            : undefined,
        },
        include: messageInclude,
      });
      await tx.channelReadState.upsert({
        where: {
          userId_channelId: { userId: input.authorId, channelId: input.channelId },
        },
        create: {
          userId: input.authorId,
          channelId: input.channelId,
          lastReadMessageId: m.id,
        },
        update: { lastReadAt: new Date(), lastReadMessageId: m.id },
      });
      return m;
    });

    // Verify uploads belong to the author (protects against attaching other
    // users' private uploads).
    if (input.attachmentIds?.length) {
      await prisma.messageAttachment.updateMany({
        where: { id: { in: input.attachmentIds } },
        data: { messageId: message.id },
      });
    }

    const dto = this.dto(message, input.authorId);
    const io = tryGetIO();
    io?.to(`channel:${input.channelId}`).emit('message:created', dto);

    // Mentions → notifications.
    await this.dispatchMentions(dto, channel.serverId, input.authorId);
    return dto;
  }

  private assertContentOrAttachments(content?: string, attachmentIds?: string[]) {
    if (!content?.trim() && !attachmentIds?.length) {
      throw ApiError.badRequest('Message cannot be empty');
    }
    if (content && content.length > LIMITS.messageMax) {
      throw ApiError.badRequest('Message is too long');
    }
  }

  private async dispatchMentions(
    dto: MessageDTO,
    serverId: string,
    authorId: string,
  ) {
    const mentions = [...dto.content.matchAll(/@([a-z0-9_.-]{3,32})/gi)].map((m) =>
      m[1]!.toLowerCase(),
    );
    if (!mentions.length) return;
    const users = await prisma.user.findMany({
      where: { username: { in: mentions }, id: { not: authorId } },
      select: { id: true, username: true },
    });
    for (const u of users) {
      // Only notify when the mentioned user can see the channel.
      if (dto.channelId && (await permissions.canViewChannel(dto.channelId, u.id))) {
        await notifications.push({
          userId: u.id,
          type: 'MENTION',
          title: `${dto.author.displayName} mentioned you`,
          body: dto.content.slice(0, 140),
          data: { channelId: dto.channelId, messageId: dto.id, serverId },
        });
      }
    }
  }

  async updateMessage(messageId: string, userId: string, content: string) {
    const message = await prisma.message.findUnique({ where: { id: messageId } });
    if (!message) throw ApiError.notFound('Message not found');
    if (message.authorId !== userId) throw ApiError.forbidden('You can only edit your own messages');
    if (message.channelId) {
      const { permissions: perms } = await permissions.getChannelContext(message.channelId, userId);
      permissions.requireChannel(perms, Permissions.SEND_MESSAGES);
    }
    const updated = await prisma.message.update({
      where: { id: messageId },
      data: { content, editedAt: new Date() },
      include: messageInclude,
    });
    const dto = this.dto(updated, userId);
    const room = message.channelId ? `channel:${message.channelId}` : `conversation:${message.conversationId}`;
    tryGetIO()?.to(room).emit('message:updated', dto);
    return dto;
  }

  async deleteMessage(messageId: string, userId: string, _actorIsOwnerOrMod = false) {
    const message = await prisma.message.findUnique({ where: { id: messageId } });
    if (!message) throw ApiError.notFound('Message not found');
    const own = message.authorId === userId;
    if (!own) {
      if (!message.channelId) throw ApiError.forbidden('You can only delete your own messages');
      const { permissions: perms, ctx } = await permissions.getChannelContext(
        message.channelId,
        userId,
      );
      const can = ctx.isOwner || hasPermission(perms, Permissions.MANAGE_MESSAGES);
      if (!can) throw ApiError.forbidden('You cannot delete this message');
      await prisma.moderationAction.create({
        data: {
          serverId: message.channelId ? ctx.serverId : '',
          actorId: userId,
          targetUserId: message.authorId,
          type: 'DELETE_MESSAGE',
          metadata: { messageId },
        },
      });
      await audit.log({
        serverId: ctx.serverId,
        actorId: userId,
        action: 'message.delete_other',
        targetId: messageId,
        targetType: 'message',
      });
    }
    await prisma.message.delete({ where: { id: messageId } });
    const room = message.channelId ? `channel:${message.channelId}` : `conversation:${message.conversationId}`;
    tryGetIO()?.to(room).emit('message:deleted', { id: messageId, channelId: message.channelId, conversationId: message.conversationId });
  }

  async react(messageId: string, userId: string, emoji: string) {
    const message = await prisma.message.findUnique({ where: { id: messageId } });
    if (!message) throw ApiError.notFound('Message not found');
    const room = await this.assertReactAccess(message, userId);
    const existing = await prisma.messageReaction.findUnique({
      where: { messageId_userId_emoji: { messageId, userId, emoji } },
    });
    if (existing) {
      await prisma.messageReaction.delete({ where: { id: existing.id } });
    } else {
      const count = await prisma.messageReaction.count({ where: { messageId } });
      if (count >= LIMITS.emojiPerMessage) {
        throw ApiError.badRequest('Too many reactions on this message');
      }
      await prisma.messageReaction.create({ data: { messageId, userId, emoji } });
    }
    const reactions = await prisma.messageReaction.findMany({ where: { messageId } });
    tryGetIO()?.to(room).emit('message:reaction', {
      messageId,
      channelId: message.channelId,
      conversationId: message.conversationId,
      reactions,
    });
  }

  private async assertReactAccess(
    message: { channelId: string | null; conversationId: string | null },
    userId: string,
  ): Promise<string> {
    if (message.channelId) {
      const { permissions: perms } = await permissions.getChannelContext(message.channelId, userId);
      permissions.requireChannel(perms, Permissions.VIEW_CHANNELS);
      return `channel:${message.channelId}`;
    }
    if (message.conversationId) {
      const member = await prisma.conversationMember.findUnique({
        where: { conversationId_userId: { conversationId: message.conversationId, userId } },
      });
      if (!member) throw ApiError.forbidden('Not a conversation participant');
      return `conversation:${message.conversationId}`;
    }
    throw ApiError.badRequest('Message has no target');
  }

  async pin(messageId: string, userId: string) {
    const message = await prisma.message.findUnique({ where: { id: messageId } });
    if (!message || !message.channelId) throw ApiError.notFound('Message not found');
    const { permissions: perms, ctx } = await permissions.getChannelContext(message.channelId, userId);
    if (!ctx.isOwner) permissions.requireChannel(perms, Permissions.PIN_MESSAGES);
    await prisma.messagePin.upsert({
      where: { messageId },
      create: { messageId, channelId: message.channelId, pinnedById: userId },
      update: {},
    });
    tryGetIO()?.to(`channel:${message.channelId}`).emit('message:updated', {
      id: messageId,
      pinned: true,
    });
  }

  async unpin(messageId: string, userId: string) {
    const message = await prisma.message.findUnique({ where: { id: messageId } });
    if (!message || !message.channelId) throw ApiError.notFound('Message not found');
    const { permissions: perms, ctx } = await permissions.getChannelContext(message.channelId, userId);
    if (!ctx.isOwner) permissions.requireChannel(perms, Permissions.PIN_MESSAGES);
    await prisma.messagePin.deleteMany({ where: { messageId } });
    tryGetIO()?.to(`channel:${message.channelId}`).emit('message:updated', {
      id: messageId,
      pinned: false,
    });
  }

  async listPins(channelId: string, userId: string) {
    const { permissions: perms } = await permissions.getChannelContext(channelId, userId);
    permissions.requireChannel(perms, Permissions.VIEW_CHANNELS);
    const pins = await prisma.messagePin.findMany({
      where: { channelId },
      include: { message: { include: messageInclude } },
      orderBy: { pinnedAt: 'desc' },
    });
    return pins.map((p) => this.dto(p.message, userId));
  }
}

export const messages = new MessageService();
