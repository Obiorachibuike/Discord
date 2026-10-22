import { db, Permission } from '@cove/db';
import type { Channel, ChannelPermissionOverride, RolePermission } from '@prisma/client';
import { HttpError } from '../lib/errors';

export type RoleGrant = { id: string; position: number; permissions: Pick<RolePermission, 'permission'>[] };
export type PermissionContext = { userId: string; serverId: string; owner: boolean; timedOutUntil: Date | null; roles: RoleGrant[] };
export type ChannelAccess = Pick<Channel, 'id' | 'visibility' | 'kind'> & { overrides: Pick<ChannelPermissionOverride, 'roleId' | 'userId' | 'allow' | 'deny'>[] };

export function hasServerPermission(ctx: PermissionContext, permission: Permission): boolean {
  return ctx.owner || ctx.roles.some(r => r.permissions.some(p => p.permission === permission));
}
export function canChannel(ctx: PermissionContext, channel: ChannelAccess, permission: Permission): boolean {
  if (ctx.owner) return true;
  if (ctx.timedOutUntil && ctx.timedOutUntil > new Date() && ['SEND_MESSAGES','SPEAK','SHARE_VIDEO','SHARE_SCREEN'].includes(permission)) return false;
  const manage = hasServerPermission(ctx, 'MANAGE_CHANNELS');
  const roleIds = new Set(ctx.roles.map(r => r.id));
  const roleOverrides = channel.overrides.filter(o => o.roleId && roleIds.has(o.roleId));
  const personal = channel.overrides.find(o => o.userId === ctx.userId);
  // Private means explicit view grant (or manage channels), never inheriting the Member role.
  const privateView = channel.visibility === 'PRIVATE' && !manage &&
    !roleOverrides.some(o => o.allow.includes('VIEW_CHANNEL')) && !personal?.allow.includes('VIEW_CHANNEL');
  if (privateView) return false;
  if (permission !== 'VIEW_CHANNEL' && !canChannel(ctx, channel, 'VIEW_CHANNEL')) return false;
  let granted = hasServerPermission(ctx, permission);
  if (roleOverrides.some(o => o.deny.includes(permission))) granted = false;
  if (roleOverrides.some(o => o.allow.includes(permission))) granted = true;
  if (personal?.deny.includes(permission)) granted = false;
  if (personal?.allow.includes(permission)) granted = true;
  // View rights are a prerequisite for all actions, including voice.
  return granted || (permission === 'VIEW_CHANNEL' && manage);
}
export async function context(userId: string, serverId: string): Promise<PermissionContext> {
  const [server, member] = await Promise.all([
    db.server.findUnique({ where: { id: serverId }, select: { ownerId: true } }),
    db.serverMember.findUnique({ where: { serverId_userId: { serverId, userId } }, include: { roles: { include: { role: { include: { permissions: true } } } } } })
  ]);
  if (!server || !member) throw new HttpError(404, 'NOT_FOUND', 'Community not found.');
  return { userId, serverId, owner: server.ownerId === userId, timedOutUntil: member.timedOutUntil,
    roles: member.roles.filter(r => r.role.serverId === serverId).map(r => ({ id: r.role.id, position: r.role.position, permissions: r.role.permissions })) };
}
export async function requireServer(userId: string, serverId: string, permission: Permission) {
  const ctx = await context(userId, serverId);
  if (!hasServerPermission(ctx, permission)) throw new HttpError(403, 'FORBIDDEN', 'You do not have permission to do that.');
  return ctx;
}
export async function requireChannel(userId: string, channelId: string, permission: Permission) {
  const channel = await db.channel.findUnique({ where: { id: channelId }, include: { overrides: true } });
  if (!channel) throw new HttpError(404, 'NOT_FOUND', 'Channel not found.');
  // Hide unauthorized/private channel existence behind 404.
  let ctx: PermissionContext;
  try { ctx = await context(userId, channel.serverId); } catch { throw new HttpError(404, 'NOT_FOUND', 'Channel not found.'); }
  if (!canChannel(ctx, channel, permission)) throw new HttpError(404, 'NOT_FOUND', 'Channel not found.');
  if (channel.kind === 'VOICE' && ['SEND_MESSAGES','PIN_MESSAGES'].includes(permission)) throw new HttpError(400, 'WRONG_CHANNEL_TYPE', 'This is a voice channel.');
  if (channel.kind === 'ANNOUNCEMENT' && permission === 'SEND_MESSAGES' && !hasServerPermission(ctx, 'MANAGE_CHANNELS')) throw new HttpError(403, 'FORBIDDEN', 'Only community managers can post announcements.');
  return { channel, ctx };
}
export async function requireConversation(userId: string, conversationId: string, _sending = false) {
  const conversation = await db.conversation.findFirst({ where: { id: conversationId, members: { some: { userId } } }, include: { members: { select: { userId: true } } } });
  if (!conversation) throw new HttpError(404, 'NOT_FOUND', 'Conversation not found.');
  {
    // Blocked pairs may not subscribe to or send in private/group conversations.
    const others = conversation.members.map(m => m.userId).filter(id => id !== userId);
    const block = await db.userBlock.findFirst({ where: { OR: [
      { blockerId: userId, blockedId: { in: others } }, { blockedId: userId, blockerId: { in: others } }
    ] } });
    if (block) throw new HttpError(403, 'BLOCKED', 'You cannot message this conversation.');
  }
  return conversation;
}
export function requireHigherRole(actor: PermissionContext, target: PermissionContext) {
  if (target.owner || (!actor.owner && Math.max(0, ...actor.roles.map(r => r.position)) <= Math.max(0, ...target.roles.map(r => r.position))))
    throw new HttpError(403, 'ROLE_HIERARCHY', 'You cannot moderate someone with an equal or higher role.');
}
