import { z } from 'zod';

export const id = z.string().uuid();
export const username = z.string().trim().toLowerCase().min(3).max(24).regex(/^[a-z0-9_]+$/, 'Use letters, numbers, or underscores');
export const email = z.string().trim().toLowerCase().email().max(320);
export const password = z.string().min(12).max(128);
export const registerSchema = z.object({ email, username, displayName: z.string().trim().min(1).max(80), password });
export const loginSchema = z.object({ email, password: z.string().min(1) });
export const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  bio: z.string().trim().max(500).nullable().optional(),
  statusMessage: z.string().trim().max(140).nullable().optional(),
  presence: z.enum(['ONLINE', 'IDLE', 'DND', 'INVISIBLE', 'OFFLINE']).optional(),
  avatarUrl: z.string().regex(/^\/api\/attachments\/[0-9a-f-]{36}$/).nullable().optional(),
  allowDMFromMembers: z.boolean().optional(), notifyDMs: z.boolean().optional(),
  notifyMentions: z.boolean().optional(), notifyFriends: z.boolean().optional(),
  theme: z.enum(['system', 'dark', 'light']).optional(),
  accent: z.enum(['violet', 'teal', 'rose', 'amber']).optional()
}).strict();
export const serverSchema = z.object({ name: z.string().trim().min(2).max(80), description: z.string().trim().max(500).optional() });
export const categorySchema = z.object({ name: z.string().trim().min(1).max(80), position: z.number().int().min(0).max(10000).optional() });
export const channelSchema = z.object({
  name: z.string().trim().toLowerCase().min(1).max(80).regex(/^[a-z0-9_-]+$/),
  topic: z.string().trim().max(500).optional(),
  kind: z.enum(['TEXT', 'ANNOUNCEMENT', 'VOICE']).default('TEXT'),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'),
  categoryId: id.nullable().optional(), position: z.number().int().min(0).max(10000).optional(),
  userLimit: z.number().int().min(2).max(100).nullable().optional()
});
export const permissionNames = [
  'MANAGE_SERVER','MANAGE_CHANNELS','MANAGE_ROLES','MANAGE_INVITES','VIEW_CHANNEL','SEND_MESSAGES',
  'DELETE_MESSAGES','PIN_MESSAGES','MANAGE_MEMBERS','KICK_MEMBERS','BAN_MEMBERS','MODERATE_MEMBERS',
  'VIEW_AUDIT_LOG','CONNECT_VOICE','SPEAK','SHARE_VIDEO','SHARE_SCREEN','MENTION_EVERYONE'
] as const;
export const permissionSchema = z.enum(permissionNames);
export type PermissionName = z.infer<typeof permissionSchema>;
export const messageSchema = z.object({
  content: z.string().trim().max(4000),
  clientNonce: z.string().uuid(),
  replyToId: id.optional(), attachmentIds: z.array(id).max(5).default([])
}).refine(v => v.content.length > 0 || v.attachmentIds.length > 0, 'Add a message or attachment');
export const editMessageSchema = z.object({ content: z.string().trim().min(1).max(4000) });
export const paginationSchema = z.object({ cursor: z.string().max(150).optional(), limit: z.coerce.number().int().min(1).max(50).default(30) });
export const inviteSchema = z.object({ maxUses: z.number().int().min(1).max(1000).nullable().optional(), expiresInHours: z.number().int().min(1).max(720).nullable().optional() });
export const reactionSchema = z.object({ emoji: z.string().min(1).max(32) });
export const conversationSchema = z.object({ kind: z.enum(['DIRECT', 'GROUP']), participantIds: z.array(id).min(1).max(19), name: z.string().trim().min(1).max(80).optional() });
export const reportSchema = z.object({ serverId: id.optional(), targetUserId: id.optional(), targetMessageId: id.optional(), reason: z.string().trim().min(10).max(1000) })
  .refine(v => !!v.targetUserId || !!v.targetMessageId, 'Select a user or message');
export type MessageInput = z.infer<typeof messageSchema>;
export type ProfileInput = z.infer<typeof profileSchema>;

// Contract shared between Socket.IO server and browser. Acknowledgements are {ok,data?} or {ok:false,error}.
export interface SocketServerEvents {
  'message:created': (message: unknown) => void;
  'message:updated': (message: unknown) => void;
  'message:deleted': (payload: { id: string; channelId?: string; conversationId?: string }) => void;
  'reaction:updated': (payload: { messageId: string; reactions: unknown[] }) => void;
  'typing:updated': (payload: { userId: string; targetId: string; kind: 'channel' | 'conversation'; typing: boolean }) => void;
  'presence:updated': (payload: { userId: string; presence: string }) => void;
  'notification:new': (notification: unknown) => void;
  'friend:updated': (payload: { userId: string }) => void;
  'membership:changed': (payload: { serverId: string }) => void;
  'voice:updated': (payload: { room: string; participantId: string; joined: boolean }) => void;
  'connection:ready': (payload: { userId: string }) => void;
}
