import type { Server as HttpServer, IncomingMessage } from 'node:http';
import { parseCookie } from 'cookie';
import { Server as IOServer, type Socket } from 'socket.io';
import {
  ClientEvents,
  ServerEvents,
  CONNECTION,
  SESSION_COOKIE,
  channelSubscribePayload,
  conversationSubscribePayload,
  messageCreatePayload,
  messageDeletePayload,
  messageReactPayload,
  messageUpdatePayload,
  presenceUpdatePayload,
  readStatePayload,
  typingPayload,
  conversationTypingPayload,
  voiceStatePayload,
  conversationMessageCreatePayload,
} from '@aether/shared';
import type { ZodSchema } from 'zod';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { prisma } from '../context.js';
import { hashToken } from '../utils/crypto.js';
import { presence } from '../services/presence.service.js';
import { messages } from '../services/message.service.js';
import { conversations } from '../services/conversation.service.js';
import { permissions } from '../services/permission.service.js';
import { voice } from '../services/voice.service.js';
import { friends } from '../services/friend.service.js';
import { setIO } from './io.js';

interface SocketData {
  userId: string;
  username: string;
  displayName: string;
}

/** Minimal token-bucket rate limiter per socket connection. */
class SocketRateLimiter {
  private buckets = new Map<string, { tokens: number; last: number }>();
  constructor(
    private capacity = 20,
    private refillPerSec = 5,
  ) {}
  allow(key: string): boolean {
    const now = Date.now();
    const b = this.buckets.get(key) ?? { tokens: this.capacity, last: now };
    b.tokens = Math.min(this.capacity, b.tokens + ((now - b.last) / 1000) * this.refillPerSec);
    b.last = now;
    if (b.tokens < 1) {
      this.buckets.set(key, b);
      return false;
    }
    b.tokens -= 1;
    this.buckets.set(key, b);
    return true;
  }
  clear(key: string) {
    this.buckets.delete(key);
  }
}

const limiter = new SocketRateLimiter();

async function authenticateHandshake(req: IncomingMessage): Promise<SocketData | null> {
  const raw = req.headers.cookie;
  if (!raw) return null;
  const cookies = parseCookie(raw);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  return {
    userId: session.user.id,
    username: session.user.username,
    displayName: session.user.displayName,
  };
}

export function initSocket(httpServer: HttpServer): IOServer {
  const io = new IOServer(httpServer, {
    cors: {
      origin: config.corsOrigins,
      credentials: true,
    },
    serveClient: false,
    pingInterval: CONNECTION.heartbeatIntervalMs,
    pingTimeout: CONNECTION.heartbeatIntervalMs + 5000,
  });
  setIO(io);

  io.use(async (socket, next) => {
    try {
      const data = await authenticateHandshake(
        socket.request as unknown as IncomingMessage,
      );
      if (!data) return next(new Error('unauthorized'));
      socket.data = data;
      next();
    } catch (err) {
      logger.warn({ err }, 'socket auth failed');
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => void onConnection(io, socket));
  return io;
}

function validate<T>(
  socket: Socket,
  schema: ZodSchema<T>,
  payload: unknown,
  event: string,
): T | null {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    socket.emit('error', {
      event,
      code: 'VALIDATION_ERROR',
      message: 'Invalid payload',
    });
    return null;
  }
  return parsed.data;
}

async function onConnection(io: IOServer, socket: Socket) {
  const data = socket.data as SocketData;
  const userId = data.userId;

  logger.debug({ userId, socketId: socket.id }, 'socket connected');

  const typingRooms = new Set<string>();

  const on = <T>(
    event: string,
    schema: ZodSchema<T>,
    handler: (payload: T) => unknown,
  ) => {
    socket.on(event, (payload: unknown, ack?: (r: unknown) => void) => {
      if (!limiter.allow(`${socket.id}:${event}`)) {
        socket.emit('error', { event, code: 'RATE_LIMITED', message: 'Slow down' });
        return;
      }
      const parsed = validate(socket, schema, payload, event);
      if (!parsed) return;
      void Promise.resolve(handler(parsed))
        .then((result) => ack?.({ ok: true, result }))
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : 'Request failed';
          socket.emit('error', { event, code: 'ERROR', message });
          ack?.({ ok: false, error: message });
        });
    });
  };

  // ── Presence ────────────────────────────────────────────────────────────────
  on(ClientEvents.PresenceUpdate, presenceUpdatePayload, async (payload) => {
    await presence.setStatus(userId, payload.status);
    await broadcastPresence(io, userId);
  });

  // ── Channel subscribe/unsubscribe ───────────────────────────────────────────
  on(ClientEvents.ChannelSubscribe, channelSubscribePayload, async (payload) => {
    // Room membership is NOT authorization — re-check access on every subscribe.
    const ok = await permissions.canViewChannel(payload.channelId, userId);
    if (!ok) {
      socket.emit('error', {
        event: ClientEvents.ChannelSubscribe,
        code: 'FORBIDDEN',
        message: 'You cannot access this channel',
      });
      return;
    }
    await socket.join(`channel:${payload.channelId}`);
  });

  on(ClientEvents.ChannelUnsubscribe, channelSubscribePayload, async (payload) => {
    await socket.leave(`channel:${payload.channelId}`);
  });

  on(ClientEvents.ConversationSubscribe, conversationSubscribePayload, async (payload) => {
    try {
      await conversations.assertMember(payload.conversationId, userId);
      await socket.join(`conversation:${payload.conversationId}`);
    } catch {
      socket.emit('error', {
        event: ClientEvents.ConversationSubscribe,
        code: 'FORBIDDEN',
        message: 'Not a participant',
      });
    }
  });

  on(ClientEvents.ConversationUnsubscribe, conversationSubscribePayload, async (payload) => {
    await socket.leave(`conversation:${payload.conversationId}`);
  });

  // ── Messages ────────────────────────────────────────────────────────────────
  on(ClientEvents.MessageCreate, messageCreatePayload, async (payload) => {
    // Persist BEFORE acknowledging delivery.
    const message = await messages.createChannelMessage({
      channelId: payload.channelId,
      authorId: userId,
      content: payload.content,
      replyToId: payload.replyToId ?? null,
      attachmentIds: payload.attachmentIds,
      clientId: payload.clientId,
    });
    return message;
  });

  // Conversation messages reuse the message:create event with conversationId
  // via a dedicated event payload.
  on('conversation:message:create', conversationMessageCreatePayload, async (payload) => {
    return conversations.createMessage({
      conversationId: payload.conversationId,
      authorId: userId,
      content: payload.content,
      replyToId: payload.replyToId ?? null,
      attachmentIds: payload.attachmentIds,
      clientId: payload.clientId,
    });
  });

  on(ClientEvents.MessageUpdate, messageUpdatePayload, async (payload) => {
    return messages.updateMessage(payload.messageId, userId, payload.content);
  });

  on(ClientEvents.MessageDelete, messageDeletePayload, async (payload) => {
    await messages.deleteMessage(payload.messageId, userId);
  });

  on(ClientEvents.MessageReact, messageReactPayload, async (payload) => {
    await messages.react(payload.messageId, userId, payload.emoji);
  });

  // ── Typing indicators (ephemeral — never persisted) ─────────────────────────
  const typingEmit = (room: string, start: boolean) => {
    io.to(room).emit(ServerEvents.TypingChanged, {
      userId,
      username: data.username,
      displayName: data.displayName,
      typing: start,
      ...(room.startsWith('channel:') ? { channelId: room.slice(8) } : { conversationId: room.slice(13) }),
    });
  };

  on(ClientEvents.TypingStart, typingPayload, async (payload) => {
    const ok = await permissions.canViewChannel(payload.channelId, userId);
    if (!ok) return;
    const room = `channel:${payload.channelId}`;
    typingRooms.add(room);
    typingEmit(room, true);
    setTimeout(() => {
      if (typingRooms.delete(room)) typingEmit(room, false);
    }, CONNECTION.typingExpiryMs);
  });

  on(ClientEvents.TypingStop, typingPayload, async (payload) => {
    const room = `channel:${payload.channelId}`;
    if (typingRooms.delete(room)) typingEmit(room, false);
  });

  on('conversation:typing:start', conversationTypingPayload, async (payload) => {
    await conversations.assertMember(payload.conversationId, userId);
    const room = `conversation:${payload.conversationId}`;
    typingRooms.add(room);
    typingEmit(room, true);
    setTimeout(() => {
      if (typingRooms.delete(room)) typingEmit(room, false);
    }, CONNECTION.typingExpiryMs);
  });

  on('conversation:typing:stop', conversationTypingPayload, async (payload) => {
    const room = `conversation:${payload.conversationId}`;
    if (typingRooms.delete(room)) typingEmit(room, false);
  });

  // ── Read states ─────────────────────────────────────────────────────────────
  on(ClientEvents.ReadStateUpdate, readStatePayload, async (payload) => {
    if (payload.conversationId) {
      await conversations.markRead(payload.conversationId, userId, payload.messageId);
    } else if (payload.channelId) {
      await prisma.channelReadState.upsert({
        where: { userId_channelId: { userId, channelId: payload.channelId } },
        create: { userId, channelId: payload.channelId, lastReadMessageId: payload.messageId ?? null },
        update: { lastReadAt: new Date(), lastReadMessageId: payload.messageId ?? null },
      });
      io.to(`user:${userId}`).emit(ServerEvents.ReadStateUpdated, {
        channelId: payload.channelId,
      });
    }
  });

  // ── Voice state (media itself flows through LiveKit) ────────────────────────
  on(ClientEvents.VoiceState, voiceStatePayload, async (payload) => {
    const { permissions: perms } = await permissions.getChannelContext(payload.channelId, userId);
    permissions.requireChannel(perms, 1n << 14n); // CONNECT_VOICE
    let participants;
    if (payload.speaking === undefined && payload.muted === undefined && payload.videoOn === undefined && payload.screenSharing === undefined) {
      participants = voice.join(payload.channelId, userId);
    } else {
      participants = [
        voice.setState(payload.channelId, userId, {
          speaking: payload.speaking,
          muted: payload.muted,
          deafened: payload.deafened,
          videoOn: payload.videoOn,
          screenSharing: payload.screenSharing,
        }) ?? voice.join(payload.channelId, userId),
      ];
    }
    io.to(`channel:${payload.channelId}`).emit(ServerEvents.VoiceParticipants, {
      channelId: payload.channelId,
      participants: voice.participants(payload.channelId),
    });
    void participants;
  });

  socket.on(ClientEvents.Ping, (payload: unknown, ack?: (r: unknown) => void) => {
    ack?.({ ts: Date.now() });
    socket.emit(ServerEvents.Pong, { ts: Date.now() });
  });

  // Join personal room + every server room the user belongs to.
  await socket.join(`user:${userId}`);
  const memberships = await prisma.serverMember.findMany({
    where: { userId },
    select: { serverId: true },
  });
  await socket.join(memberships.map((m) => `server:${m.serverId}`));

  // Conversations.
  const convs = await prisma.conversationMember.findMany({
    where: { userId },
    select: { conversationId: true },
  });
  await socket.join(convs.map((c) => `conversation:${c.conversationId}`));

  const status = await presence.connect(userId, socket.id);
  await broadcastPresence(io, userId);

  socket.emit(ServerEvents.Ready, {
    userId,
    status,
    serverIds: memberships.map((m) => m.serverId),
  });

  // ── Disconnect ──────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    void (async () => {
      limiter.clear(`${socket.id}:${ClientEvents.MessageCreate}`);
      // Remove voice presence from any rooms this socket was in.
      for (const room of socket.rooms) {
        if (room.startsWith('channel:')) {
          const channelId = room.slice(8);
          const left = voice.leave(channelId, userId);
          if (left) {
            io.to(room).emit(ServerEvents.VoiceParticipants, {
              channelId,
              participants: voice.participants(channelId),
            });
          }
        }
      }
      const newStatus = await presence.disconnect(userId, socket.id);
      if (newStatus) await broadcastPresence(io, userId);
    })();
  });
}

/** Fan out presence changes to servers the user belongs to and their friends. */
export async function broadcastPresence(io: IOServer, userId: string): Promise<void> {
  const visible = presence.getVisibleStatus(userId);
  const payload = { userId, status: visible };
  const memberships = await prisma.serverMember.findMany({
    where: { userId },
    select: { serverId: true },
  });
  for (const m of memberships) {
    io.to(`server:${m.serverId}`).emit(ServerEvents.PresenceUpdate, payload);
  }
  const friendIds = await friends.friendIds(userId);
  for (const fid of friendIds) {
    io.to(`user:${fid}`).emit(ServerEvents.PresenceUpdate, payload);
  }
}
