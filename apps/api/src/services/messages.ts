import { db, Prisma } from '@cove/db';
import { id, messageSchema, reactionSchema, type MessageInput } from '@cove/shared';
import { HttpError } from '../lib/errors';
import { getRedis } from '../lib/redis';
import { logger } from '../lib/logger';
import { emitRoom, notify } from './notifications';
import { requireChannel, requireConversation, hasServerPermission } from './permissions';
import { publicUser } from './users';
const messageInclude = { author: true, attachments: true, reactions: { select: { userId: true, emoji: true } }, pin: { select: { pinnedById: true, createdAt: true } }, replyTo: { select: { id: true, authorId: true, content: true, deletedAt: true } } } as const;
export type Target = { channelId: string } | { conversationId: string };
export const roomFor = (target: Target) => 'channelId' in target ? `channel:${target.channelId}` : `conversation:${target.conversationId}`;

const localLimits = new Map<string, { count: number; until: number }>();
export async function messageRateLimit(userId: string) {
  const redis = getRedis();
  if (redis) {
    const key = `limit:message:${userId}:${Math.floor(Date.now() / 10000)}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 12);
    if (count > 15) throw new HttpError(429, 'RATE_LIMITED', 'Slow down for a moment.');
  } else {
    const now = Date.now(); const entry = localLimits.get(userId);
    const next = entry && entry.until > now ? { count: entry.count + 1, until: entry.until } : { count: 1, until: now + 10_000 };
    localLimits.set(userId, next);
    if (localLimits.size > 10000) for (const [key, value] of localLimits) if (value.until < now) localLimits.delete(key);
    if (next.count > 15) throw new HttpError(429, 'RATE_LIMITED', 'Slow down for a moment.');
  }
}
export async function authorizeTarget(userId: string, target: Target, sending = false) {
  if ('channelId' in target) return requireChannel(userId, target.channelId, sending ? 'SEND_MESSAGES' : 'VIEW_CHANNEL');
  return requireConversation(userId, target.conversationId, sending);
}
export function serializeMessage(message: Prisma.MessageGetPayload<{ include: typeof messageInclude }>) {
  return { id: message.id, channelId: message.channelId, conversationId: message.conversationId,
    author: publicUser(message.author), content: message.deletedAt ? '' : message.content,
    clientNonce: message.clientNonce, replyTo: message.replyTo ? { id: message.replyTo.id, authorId: message.replyTo.authorId, content: message.replyTo.deletedAt ? '' : message.replyTo.content } : null,
    attachments: message.deletedAt ? [] : message.attachments.map(a => ({ id: a.id, filename: a.filename, mimeType: a.mimeType, size: a.size, url: `/api/attachments/${a.id}` })),
    reactions: message.reactions, pin: message.pin, editedAt: message.editedAt, deletedAt: message.deletedAt, createdAt: message.createdAt };
}
export async function fetchMessage(messageId: string) {
  const message = await db.message.findUnique({ where: { id: messageId }, include: messageInclude });
  if (!message) throw new HttpError(404, 'NOT_FOUND', 'Message not found.');
  return message;
}
export async function assertMessageAccess(userId: string, messageId: string, sending = false) {
  const message = await fetchMessage(messageId);
  if (message.channelId) await authorizeTarget(userId, { channelId: message.channelId }, sending);
  else if (message.conversationId) await authorizeTarget(userId, { conversationId: message.conversationId }, sending);
  else throw new HttpError(404, 'NOT_FOUND', 'Message not found.');
  return message;
}
function verifyRetry(prior: Awaited<ReturnType<typeof fetchMessage>>, input: MessageInput, target: Target, attachmentIds: string[]) {
  if (prior.content !== input.content || prior.channelId !== ('channelId' in target ? target.channelId : null) || prior.conversationId !== ('conversationId' in target ? target.conversationId : null) || prior.replyToId !== (input.replyToId ?? null) || prior.attachments.length !== attachmentIds.length || !prior.attachments.every(a => attachmentIds.includes(a.id)))
    throw new HttpError(409, 'NONCE_CONFLICT', 'This submission identifier was already used for another message.');
  return prior;
}
export async function sendMessage(userId: string, target: Target, raw: unknown) {
  const input = messageSchema.parse(raw);
  await authorizeTarget(userId, target, true);
  const attachmentIds = [...new Set(input.attachmentIds)];
  if (attachmentIds.length !== input.attachmentIds.length) throw new HttpError(400, 'DUPLICATE_ATTACHMENT', 'An attachment was listed twice.');
  const prior = await db.message.findUnique({ where: { authorId_clientNonce: { authorId: userId, clientNonce: input.clientNonce } }, include: messageInclude });
  if (prior) return { message: serializeMessage(verifyRetry(prior, input, target, attachmentIds)), deduplicated: true };
  await messageRateLimit(userId);
  if (input.content.includes('@everyone') || input.content.includes('@here') || /@&[\da-f-]{36}/i.test(input.content)) {
    if (!('channelId' in target)) throw new HttpError(400, 'INVALID_MENTION', 'Role mentions only work in communities.');
    const { ctx } = await requireChannel(userId, target.channelId, 'MENTION_EVERYONE');
    if (!hasServerPermission(ctx, 'MENTION_EVERYONE')) throw new HttpError(403, 'FORBIDDEN', 'You cannot mention everyone or roles.');
  }
  let created = true; let messageId: string;
  try {
    messageId = await db.$transaction(async tx => {
      if (input.replyToId) {
        const reply = await tx.message.findUnique({ where: { id: input.replyToId } });
        if (!reply || reply.deletedAt || reply.channelId !== ('channelId' in target ? target.channelId : null) || reply.conversationId !== ('conversationId' in target ? target.conversationId : null))
          throw new HttpError(400, 'INVALID_REPLY', 'That message is not in this conversation.');
      }
      const message = await tx.message.create({ data: { ...target, authorId: userId, content: input.content, clientNonce: input.clientNonce, replyToId: input.replyToId } });
      if (attachmentIds.length) {
        const claimed = await tx.messageAttachment.updateMany({ where: { id: { in: attachmentIds }, uploadedById: userId, messageId: null,
          createdAt: { gt: new Date(Date.now() - 24 * 3600_000) } }, data: { messageId: message.id } });
        if (claimed.count !== attachmentIds.length) throw new HttpError(400, 'INVALID_ATTACHMENT', 'Upload attachments before sending.');
      }
      return message.id;
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    const prior = await db.message.findUnique({ where: { authorId_clientNonce: { authorId: userId, clientNonce: input.clientNonce } }, include: messageInclude });
    if (!prior) throw error;
    verifyRetry(prior, input, target, attachmentIds);
    created = false; messageId = prior.id;
  }
  const message = serializeMessage(await fetchMessage(messageId));
  if (created) {
    emitRoom(roomFor(target), 'message:created', message);
    if ('conversationId' in target) {
      const members = await db.conversationMember.findMany({ where: { conversationId: target.conversationId }, select: { userId: true } });
      for (const member of members) if (member.userId !== userId) void notify(member.userId, 'DIRECT_MESSAGE', { conversationId: target.conversationId, messageId }, userId, `dm:${messageId}:${member.userId}`).catch(error => logger.warn({ err: error }, 'DM notification failed'));
    } else {
      // Only notify mentioned users who are currently authorized to view the channel.
      const usernames = [...new Set([...input.content.matchAll(/@([a-z0-9_]{3,24})\b/gi)].map(m => m[1]?.toLowerCase()).filter(Boolean))] as string[];
      if (usernames.length) {
        const channel = await db.channel.findUniqueOrThrow({ where: { id: target.channelId } });
        const users = await db.user.findMany({ where: { username: { in: usernames }, memberships: { some: { serverId: channel.serverId } } } });
        for (const user of users) if (user.id !== userId) {
          const result = await requireChannel(user.id, channel.id, 'VIEW_CHANNEL').catch(() => null);
          if (result) void notify(user.id, 'MENTION', { serverId: channel.serverId, channelId: channel.id, messageId }, userId, `mention:${messageId}:${user.id}`).catch(error => logger.warn({ err: error }, 'mention notification failed'));
        }
      }
    }
  }
  return { message, deduplicated: !created };
}
export function decodeCursor(cursor?: string) {
  if (!cursor) return undefined;
  try {
    const [date, messageId] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!date || !messageId || isNaN(new Date(date).getTime())) throw new Error('Invalid cursor');
    return { at: new Date(date), messageId: id.parse(messageId) };
  } catch { throw new HttpError(400, 'INVALID_CURSOR', 'Invalid pagination cursor.'); }
}
export const encodeCursor = (message: { createdAt: Date; id: string }) => Buffer.from(`${message.createdAt.toISOString()}|${message.id}`).toString('base64url');
export async function messageHistory(userId: string, target: Target, limit: number, cursor?: string) {
  await authorizeTarget(userId, target);
  const anchor = decodeCursor(cursor);
  const messages = await db.message.findMany({ where: { ...target, ...(anchor ? { OR: [{ createdAt: { lt: anchor.at } }, { createdAt: anchor.at, id: { lt: anchor.messageId } }] } : {}) },
    include: messageInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1 });
  return { messages: messages.slice(0, limit).map(serializeMessage), nextCursor: messages.length > limit ? encodeCursor(messages[limit - 1]!) : null };
}
export async function editMessage(userId: string, messageId: string, content: string) {
  const old = await assertMessageAccess(userId, messageId, true);
  if (old.authorId !== userId || old.deletedAt) throw new HttpError(403, 'FORBIDDEN', 'You cannot edit that message.');
  const updated = await db.message.update({ where: { id: old.id }, data: { content, editedAt: new Date() }, include: messageInclude });
  const message = serializeMessage(updated);
  emitRoom(roomFor(old.channelId ? { channelId: old.channelId } : { conversationId: old.conversationId! }), 'message:updated', message);
  return message;
}
export async function deleteMessage(userId: string, messageId: string) {
  const old = await assertMessageAccess(userId, messageId);
  if (old.authorId !== userId) {
    if (!old.channelId) throw new HttpError(403, 'FORBIDDEN', 'Only the author can delete this message.');
    const { channel } = await requireChannel(userId, old.channelId, 'DELETE_MESSAGES');
    await db.auditLog.create({ data: { serverId: channel.serverId, actorId: userId, action: 'MESSAGE_DELETED', targetType: 'message', targetId: old.id } });
  }
  if (!old.deletedAt) await db.message.update({ where: { id: old.id }, data: { deletedAt: new Date(), content: '' } });
  const target = old.channelId ? { channelId: old.channelId } : { conversationId: old.conversationId! };
  emitRoom(roomFor(target), 'message:deleted', { id: messageId, ...target });
  return { id: messageId };
}
export async function toggleReaction(userId: string, messageId: string, raw: unknown) {
  const { emoji } = reactionSchema.parse(raw);
  const message = await assertMessageAccess(userId, messageId, true);
  if (message.deletedAt) throw new HttpError(400, 'DELETED', 'Cannot react to a deleted message.');
  const key = { messageId_userId_emoji: { messageId, userId, emoji } };
  const exists = await db.messageReaction.findUnique({ where: key });
  if (exists) await db.messageReaction.delete({ where: key });
  else await db.messageReaction.create({ data: { messageId, userId, emoji } });
  const reactions = await db.messageReaction.findMany({ where: { messageId }, select: { emoji: true, userId: true } });
  emitRoom(roomFor(message.channelId ? { channelId: message.channelId } : { conversationId: message.conversationId! }), 'reaction:updated', { messageId, reactions });
  return { reactions };
}
export async function togglePin(userId: string, messageId: string) {
  const message = await assertMessageAccess(userId, messageId);
  if (!message.channelId || message.deletedAt) throw new HttpError(400, 'INVALID_PIN', 'Only channel messages can be pinned.');
  await requireChannel(userId, message.channelId, 'PIN_MESSAGES');
  if (message.pin) await db.messagePin.delete({ where: { messageId } });
  else await db.messagePin.create({ data: { messageId, pinnedById: userId } });
  const updated = serializeMessage(await fetchMessage(messageId));
  emitRoom(`channel:${message.channelId}`, 'message:updated', updated);
  return updated;
}
