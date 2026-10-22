import { db, Permission } from '@cove/db';
import { HttpError } from '../lib/errors';
import { emitRoom, emitUser } from './notifications';
import { context, canChannel } from './permissions';

const memberPermissions: Permission[] = ['VIEW_CHANNEL','SEND_MESSAGES','CONNECT_VOICE','SPEAK','SHARE_VIDEO','SHARE_SCREEN'];
const modPermissions: Permission[] = [...memberPermissions,'DELETE_MESSAGES','PIN_MESSAGES','KICK_MEMBERS','MODERATE_MEMBERS','MANAGE_INVITES'];
const adminPermissions: Permission[] = Object.values(Permission);
export async function createServer(ownerId: string, name: string, description?: string) {
  return db.$transaction(async tx => {
    const server = await tx.server.create({ data: { name, description, ownerId } });
    const member = await tx.serverMember.create({ data: { serverId: server.id, userId: ownerId } });
    for (const def of [
      { name: 'Owner', position: 100, permissions: adminPermissions },
      { name: 'Administrator', position: 80, permissions: adminPermissions },
      { name: 'Moderator', position: 60, permissions: modPermissions },
      { name: 'Member', position: 0, permissions: memberPermissions }
    ]) {
      const role = await tx.role.create({ data: { serverId: server.id, name: def.name, position: def.position, isManaged: true, isDefault: def.name === 'Member', permissions: { create: def.permissions.map(permission => ({ permission })) } } });
      if (def.name === 'Owner') await tx.memberRole.create({ data: { memberId: member.id, roleId: role.id } });
    }
    const category = await tx.channelCategory.create({ data: { serverId: server.id, name: 'START HERE', position: 0 } });
    await tx.channel.createMany({ data: [
      { serverId: server.id, categoryId: category.id, name: 'welcome', topic: 'A place to say hello', kind: 'TEXT', position: 0 },
      { serverId: server.id, categoryId: category.id, name: 'general', topic: 'The conversation starts here', kind: 'TEXT', position: 1 },
      { serverId: server.id, categoryId: category.id, name: 'lounge', kind: 'VOICE', position: 2 }
    ] });
    await tx.auditLog.create({ data: { serverId: server.id, actorId: ownerId, action: 'SERVER_CREATED', targetType: 'server', targetId: server.id } });
    return server;
  });
}
export async function joinServer(userId: string, serverId: string) {
  const ban = await db.serverBan.findUnique({ where: { serverId_userId: { serverId, userId } } });
  if (ban) throw new HttpError(403, 'BANNED', 'You cannot join this community.');
  return db.$transaction(async tx => {
    const member = await tx.serverMember.upsert({ where: { serverId_userId: { serverId, userId } }, create: { serverId, userId }, update: {} });
    const defaultRole = await tx.role.findFirst({ where: { serverId, isDefault: true } });
    if (defaultRole) await tx.memberRole.upsert({ where: { memberId_roleId: { memberId: member.id, roleId: defaultRole.id } }, create: { memberId: member.id, roleId: defaultRole.id }, update: {} });
    return member;
  });
}
export async function serverView(userId: string, serverId: string) {
  const ctx = await context(userId, serverId);
  const server = await db.server.findUniqueOrThrow({ where: { id: serverId }, include: {
    categories: { orderBy: { position: 'asc' } },
    channels: { include: { overrides: true }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
    _count: { select: { members: true } }
  } });
  const channels = server.channels.filter(c => canChannel(ctx, c, 'VIEW_CHANNEL')).map(({ overrides: _overrides, ...c }) => c);
  const { channels: _all, ...safeServer } = server;
  return { ...safeServer, channels, myPermissions: ctx.owner ? Object.values(Permission) : [...new Set(ctx.roles.flatMap(r => r.permissions.map(p => p.permission)))] };
}
export function membershipChanged(serverId: string, userId?: string) {
  emitRoom(`server:${serverId}`, 'membership:changed', { serverId });
  if (userId) emitUser(userId, 'membership:changed', { serverId });
}
