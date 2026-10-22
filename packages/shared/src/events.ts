import { z } from 'zod';
import { LIMITS } from './constants.js';

/**
 * Typed Socket.IO event contract.
 * Every client→server payload is validated with the zod schema below on the
 * server; never trust the wire. Room membership is never proof of access —
 * handlers re-check authorization against the database.
 */

export const ClientEvents = {
  PresenceUpdate: 'presence:update',
  ChannelSubscribe: 'channel:subscribe',
  ChannelUnsubscribe: 'channel:unsubscribe',
  ConversationSubscribe: 'conversation:subscribe',
  ConversationUnsubscribe: 'conversation:unsubscribe',
  MessageCreate: 'message:create',
  MessageUpdate: 'message:update',
  MessageDelete: 'message:delete',
  MessageReact: 'message:react',
  TypingStart: 'typing:start',
  TypingStop: 'typing:stop',
  ReadStateUpdate: 'readstate:update',
  VoiceState: 'voice:state',
  Ping: 'ping',
} as const;

export const ServerEvents = {
  Ready: 'ready',
  Pong: 'pong',
  MessageCreated: 'message:created',
  MessageUpdated: 'message:updated',
  MessageDeleted: 'message:deleted',
  MessageReaction: 'message:reaction',
  TypingChanged: 'typing:changed',
  PresenceUpdate: 'presence:update',
  NotificationNew: 'notification:new',
  FriendRequest: 'friend:request',
  FriendUpdated: 'friend:updated',
  ConversationUpdated: 'conversation:updated',
  ConversationCreated: 'conversation:created',
  ChannelUpdated: 'channel:updated',
  ChannelDeleted: 'channel:deleted',
  MemberUpdated: 'member:updated',
  ModerationUpdate: 'moderation:update',
  VoiceParticipants: 'voice:participants',
  ReadStateUpdated: 'readstate:updated',
} as const;

export const presenceUpdatePayload = z.object({
  status: z.enum(['ONLINE', 'IDLE', 'DND', 'INVISIBLE']),
});

export const channelSubscribePayload = z.object({ channelId: z.string().min(1) });
export const conversationSubscribePayload = z.object({
  conversationId: z.string().min(1),
});

export const messageCreatePayload = z.object({
  channelId: z.string().min(1),
  content: z.string().max(LIMITS.messageMax).optional(),
  replyToId: z.string().nullable().optional(),
  attachmentIds: z.array(z.string()).max(LIMITS.attachmentsPerMessage).optional(),
  clientId: z.string().min(8).max(64).optional(),
});

export const conversationMessageCreatePayload = z.object({
  conversationId: z.string().min(1),
  content: z.string().max(LIMITS.messageMax).optional(),
  replyToId: z.string().nullable().optional(),
  attachmentIds: z.array(z.string()).max(LIMITS.attachmentsPerMessage).optional(),
  clientId: z.string().min(8).max(64).optional(),
});

export const messageUpdatePayload = z.object({
  messageId: z.string().min(1),
  content: z.string().min(1).max(LIMITS.messageMax),
});

export const messageDeletePayload = z.object({ messageId: z.string().min(1) });

export const messageReactPayload = z.object({
  messageId: z.string().min(1),
  emoji: z.string().min(1).max(32),
});

export const typingPayload = z.object({ channelId: z.string().min(1) });
export const conversationTypingPayload = z.object({
  conversationId: z.string().min(1),
});

export const readStatePayload = z.object({
  channelId: z.string().optional(),
  conversationId: z.string().optional(),
  messageId: z.string().optional(),
});

export const voiceStatePayload = z.object({
  channelId: z.string().min(1),
  speaking: z.boolean().optional(),
  muted: z.boolean().optional(),
  deafened: z.boolean().optional(),
  videoOn: z.boolean().optional(),
  screenSharing: z.boolean().optional(),
});

export type MessageCreatePayload = z.infer<typeof messageCreatePayload>;
export type VoiceStatePayload = z.infer<typeof voiceStatePayload>;
