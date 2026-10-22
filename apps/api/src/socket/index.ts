import { Server } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import { parse } from 'cookie';
import { createAdapter } from '@socket.io/redis-adapter';
import { id, editMessageSchema, messageSchema, reactionSchema } from '@cove/shared';
import { z } from 'zod';
import { db } from '@cove/db';
import { allowedOrigins } from '../lib/config';
import { getRedis } from '../lib/redis';
import { HttpError } from '../lib/errors';
import { logger } from '../lib/logger';
import { SESSION_COOKIE, sessionFromToken } from '../middleware/auth';
import { setNotificationIO } from '../services/notifications';
import { deleteMessage, editMessage, roomFor, sendMessage, toggleReaction, type Target } from '../services/messages';
import { context, requireChannel, requireConversation } from '../services/permissions';
import { setPresenceConnection } from '../services/presence';
const targetSchema = z.union([z.object({ channelId: id }).strict(), z.object({ conversationId: id }).strict()]);
function socketError(error: unknown) {
  if (error instanceof HttpError) return { ok: false, error: { code: error.code, message: error.message } };
  if (error instanceof z.ZodError) return { ok: false, error: { code: 'INVALID_INPUT', message: 'Please check your input.' } };
  logger.error({ err: error }, 'socket event failed');
  return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' } };
}
export async function createSocketServer(server: HttpServer) {
  const io = new Server(server, { path: '/socket.io', cors: { origin: allowedOrigins, credentials: true }, maxHttpBufferSize: 64 * 1024,
    // Engine.IO CORS alone does not reject cross-origin WebSocket handshakes.
    allowRequest: (req, done) => {
      const origin = req.headers.origin;
      done(origin && !allowedOrigins.includes(origin) ? 'ORIGIN_DENIED' : null, !origin || allowedOrigins.includes(origin));
    },
    pingInterval: 25_000, pingTimeout: 20_000 });
  setNotificationIO(io);
  const redis = getRedis();
  let closeAdapter = async () => {};
  if (redis) {
    await redis.connect();
    const sub = redis.duplicate(); await sub.connect();
    io.adapter(createAdapter(redis, sub));
    closeAdapter = async () => { await sub.quit(); };
  }
  io.use(async (socket, next) => {
    try {
      const token = parse(socket.request.headers.cookie || '')[SESSION_COOKIE];
      const auth = await sessionFromToken(token);
      if (!auth) return next(new Error('UNAUTHENTICATED'));
      socket.data.userId = auth.userId; socket.data.sessionId = auth.sessionId; socket.data.sessionToken = token;
      next();
    } catch (error) { logger.warn({ err: error }, 'socket authentication failed'); next(new Error('UNAUTHENTICATED')); }
  });
  io.on('connection', socket => {
    const userId = socket.data.userId as string;
    socket.join(`user:${userId}`);
    // Revalidate the session before EVERY client event, including typing and subscriptions.
    let eventWindow = Date.now(), eventCount = 0;
    socket.use(async (_packet, next) => {
      if (Date.now() - eventWindow > 10_000) { eventWindow = Date.now(); eventCount = 0; }
      if (++eventCount > 100) { socket.disconnect(true); return next(new Error('RATE_LIMITED')); }
      const auth = await sessionFromToken(socket.data.sessionToken).catch(() => null);
      if (!auth || auth.sessionId !== socket.data.sessionId) { socket.disconnect(true); return next(new Error('UNAUTHENTICATED')); }
      next();
    });
    const safe = (handler: (payload: unknown) => Promise<unknown>) => async (payload: unknown, ack?: (value: unknown) => void) => {
      try { const data = await handler(payload); ack?.({ ok: true, data }); } catch (error) { ack?.(socketError(error)); }
    };
    socket.on('server:subscribe', safe(async payload => { const { serverId } = z.object({ serverId: id }).parse(payload); await context(userId, serverId); socket.join(`server:${serverId}`); return { serverId }; }));
    socket.on('channel:subscribe', safe(async payload => {
      const { channelId } = z.object({ channelId: id }).parse(payload);
      await requireChannel(userId, channelId, 'VIEW_CHANNEL'); socket.join(`channel:${channelId}`); return { channelId };
    }));
    socket.on('channel:unsubscribe', safe(async payload => { const { channelId } = z.object({ channelId: id }).parse(payload); socket.leave(`channel:${channelId}`); return {}; }));
    socket.on('conversation:subscribe', safe(async payload => {
      const { conversationId } = z.object({ conversationId: id }).parse(payload);
      await requireConversation(userId, conversationId, true); socket.join(`conversation:${conversationId}`); return { conversationId };
    }));
    socket.on('conversation:unsubscribe', safe(async payload => { const { conversationId } = z.object({ conversationId: id }).parse(payload); socket.leave(`conversation:${conversationId}`); return {}; }));
    socket.on('message:send', safe(async payload => {
      const input = z.object({ target: targetSchema, message: messageSchema }).parse(payload);
      return sendMessage(userId, input.target as Target, input.message);
    }));
    socket.on('message:edit', safe(async payload => { const input = z.object({ messageId: id, content: editMessageSchema.shape.content }).parse(payload); return editMessage(userId, input.messageId, input.content); }));
    socket.on('message:delete', safe(async payload => { const { messageId } = z.object({ messageId: id }).parse(payload); return deleteMessage(userId, messageId); }));
    socket.on('reaction:toggle', safe(async payload => { const input = z.object({ messageId: id, emoji: reactionSchema.shape.emoji }).parse(payload); return toggleReaction(userId, input.messageId, input); }));
    let lastTyping = 0;
    const typingRooms = new Set<string>();
    socket.on('typing:set', safe(async payload => {
      if (Date.now() - lastTyping < 700) return {};
      lastTyping = Date.now();
      const input = z.object({ target: targetSchema, typing: z.boolean() }).parse(payload);
      const target = input.target as Target;
      if ('channelId' in target) await requireChannel(userId, target.channelId, 'SEND_MESSAGES');
      else await requireConversation(userId, target.conversationId, true);
      const room = roomFor(target);
      if (input.typing) typingRooms.add(room); else typingRooms.delete(room);
      socket.to(room).emit('typing:updated', { userId, targetId: 'channelId' in target ? target.channelId : target.conversationId, kind: 'channelId' in target ? 'channel' : 'conversation', typing: input.typing });
      return {};
    }));
    socket.on('presence:heartbeat', safe(async () => { await setPresenceConnection(userId, socket.id, true); return {}; }));
    // Install handlers synchronously: clients may emit immediately after `connect`.
    void (async () => {
      const memberships = await db.serverMember.findMany({ where: { userId }, select: { serverId: true } });
      if (!socket.connected) return;
      for (const m of memberships) socket.join(`server:${m.serverId}`);
      await setPresenceConnection(userId, socket.id, true);
      if (socket.connected) socket.emit('connection:ready', { userId });
    })().catch(error => logger.warn({ err: error }, 'socket setup failed'));
    socket.on('disconnect', () => {
      for (const room of typingRooms) socket.to(room).emit('typing:updated', { userId, targetId: room.split(':')[1], kind: room.startsWith('channel:') ? 'channel' : 'conversation', typing: false });
      void setPresenceConnection(userId, socket.id, false).catch(error => logger.warn({ err: error }, 'presence cleanup failed'));
    });
  });
  return { io, closeAdapter };
}
