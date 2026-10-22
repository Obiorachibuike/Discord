import { Router } from 'express';
import { db } from '@cove/db';
import { z } from 'zod';
import { id, serverSchema, inviteSchema, paginationSchema, permissionSchema } from '@cove/shared';
import { hash, randomToken } from '../lib/crypto';
import { allowedOrigins, config } from '../lib/config';
import { HttpError, route } from '../lib/errors';
import { context, requireServer, requireHigherRole, hasServerPermission } from '../services/permissions';
import { createServer, membershipChanged, serverView } from '../services/servers';
import { publicUser } from '../services/users';
import { disconnectUser, notify } from '../services/notifications';
import { lockOwnedImage } from '../services/storage';
const router = Router();
const sid = (req: { params: Record<string, string> }) => id.parse(req.params.serverId);

router.get('/', route(async (req, res) => {
  const memberships = await db.serverMember.findMany({ where: { userId: req.auth!.userId }, include: {
    server: { select: { id: true, name: true, description: true, iconUrl: true, ownerId: true, _count: { select: { members: true } } } }
  }, orderBy: { joinedAt: 'desc' } });
  res.json({ servers: memberships.map(m => m.server) });
}));
router.post('/', route(async (req, res) => {
  const input = serverSchema.parse(req.body);
  const server = await createServer(req.auth!.userId, input.name, input.description);
  res.status(201).json({ server: await serverView(req.auth!.userId, server.id) });
}));
router.get('/:serverId', route(async (req, res) => res.json({ server: await serverView(req.auth!.userId, sid(req)) })));
router.patch('/:serverId', route(async (req, res) => {
  const serverId = sid(req);
  await requireServer(req.auth!.userId, serverId, 'MANAGE_SERVER');
  const input = serverSchema.partial().extend({ iconUrl: z.string().regex(/^\/api\/attachments\/[0-9a-f-]{36}$/).nullable().optional() }).parse(req.body);
  const server = await db.$transaction(async tx => {
    if (input.iconUrl && !await lockOwnedImage(tx, input.iconUrl, req.auth!.userId))
      throw new HttpError(400, 'INVALID_ICON', 'Upload an image to use as a community icon.');
    const updated = await tx.server.update({ where: { id: serverId }, data: input });
    await tx.auditLog.create({ data: { serverId, actorId: req.auth!.userId, action: 'SERVER_UPDATED', targetType: 'server', targetId: serverId } });
    return updated;
  });
  membershipChanged(serverId);
  res.json({ server });
}));
router.delete('/:serverId', route(async (req, res) => {
  const serverId = sid(req);
  const server = await db.server.findUnique({ where: { id: serverId } });
  if (!server || server.ownerId !== req.auth!.userId) throw new HttpError(403, 'FORBIDDEN', 'Only the owner can delete this community.');
  z.object({ confirmName: z.literal(server.name) }).parse(req.body);
  await db.server.delete({ where: { id: serverId } });
  membershipChanged(serverId);
  res.status(204).send();
}));
router.post('/:serverId/transfer', route(async (req, res) => {
  const serverId = sid(req); const newOwnerId = id.parse(req.body?.userId);
  const server = await db.server.findUnique({ where: { id: serverId } });
  if (!server || server.ownerId !== req.auth!.userId) throw new HttpError(403, 'FORBIDDEN', 'Only the owner can transfer ownership.');
  if (newOwnerId === server.ownerId) throw new HttpError(400, 'INVALID_TARGET', 'Choose another member.');
  await context(newOwnerId, serverId);
  await db.$transaction(async tx => {
    const roles = await tx.role.findMany({ where: { serverId, name: { in: ['Owner','Administrator'] } } });
    const ownerRole = roles.find(r => r.name === 'Owner'); const adminRole = roles.find(r => r.name === 'Administrator');
    const previous = await tx.serverMember.findUniqueOrThrow({ where: { serverId_userId: { serverId, userId: server.ownerId } } });
    const next = await tx.serverMember.findUniqueOrThrow({ where: { serverId_userId: { serverId, userId: newOwnerId } } });
    if (ownerRole) {
      await tx.memberRole.deleteMany({ where: { memberId: previous.id, roleId: ownerRole.id } });
      await tx.memberRole.upsert({ where: { memberId_roleId: { memberId: next.id, roleId: ownerRole.id } }, create: { memberId: next.id, roleId: ownerRole.id }, update: {} });
    }
    if (adminRole) await tx.memberRole.upsert({ where: { memberId_roleId: { memberId: previous.id, roleId: adminRole.id } }, create: { memberId: previous.id, roleId: adminRole.id }, update: {} });
    await tx.server.update({ where: { id: serverId }, data: { ownerId: newOwnerId } });
    await tx.auditLog.create({ data: { serverId, actorId: req.auth!.userId, action: 'OWNERSHIP_TRANSFERRED', targetType: 'user', targetId: newOwnerId } });
  });
  disconnectUser(newOwnerId); disconnectUser(req.auth!.userId); membershipChanged(serverId);
  res.json({ message: 'Ownership transferred.' });
}));
router.post('/:serverId/leave', route(async (req, res) => {
  const serverId = sid(req);
  const server = await db.server.findUnique({ where: { id: serverId } });
  if (!server) throw new HttpError(404, 'NOT_FOUND', 'Community not found.');
  if (server.ownerId === req.auth!.userId) throw new HttpError(409, 'OWNER_CANNOT_LEAVE', 'Transfer ownership before leaving.');
  await db.serverMember.delete({ where: { serverId_userId: { serverId, userId: req.auth!.userId } } });
  disconnectUser(req.auth!.userId); membershipChanged(serverId);
  res.status(204).send();
}));
router.get('/:serverId/members', route(async (req, res) => {
  const serverId = sid(req); await context(req.auth!.userId, serverId);
  const { limit, cursor } = paginationSchema.parse(req.query);
  const members = await db.serverMember.findMany({ where: { serverId }, take: limit + 1,
    ...(cursor ? { cursor: { id: id.parse(cursor) }, skip: 1 } : {}), orderBy: { id: 'asc' },
    include: { user: true, roles: { include: { role: { select: { id: true, name: true, color: true, position: true } } } } }
  });
  const hasMore = members.length > limit;
  res.json({ members: members.slice(0, limit).map(m => ({ id: m.id, user: publicUser(m.user), roles: m.roles.map(r => r.role), joinedAt: m.joinedAt, timedOutUntil: m.timedOutUntil })), nextCursor: hasMore ? members[limit - 1]?.id : null });
}));
router.get('/:serverId/roles', route(async (req, res) => {
  const serverId = sid(req); await context(req.auth!.userId, serverId);
  const roles = await db.role.findMany({ where: { serverId }, include: { permissions: true }, orderBy: { position: 'desc' } });
  res.json({ roles: roles.map(r => ({ ...r, permissions: r.permissions.map(p => p.permission) })) });
}));
router.post('/:serverId/roles', route(async (req, res) => {
  const serverId = sid(req); const ctx = await requireServer(req.auth!.userId, serverId, 'MANAGE_ROLES');
  const input = z.object({ name: z.string().trim().min(1).max(50), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(), position: z.number().int().min(1).max(79).default(1), permissions: z.array(permissionSchema).max(18).default([]) }).parse(req.body);
  if (!ctx.owner && (input.position >= Math.max(0, ...ctx.roles.map(r => r.position)) || input.permissions.some(p => !hasServerPermission(ctx, p)))) throw new HttpError(403, 'ROLE_HIERARCHY', 'You cannot create a role with permissions or a position above your own.');
  const role = await db.$transaction(async tx => {
    const created = await tx.role.create({ data: { serverId, name: input.name, color: input.color, position: input.position, permissions: { create: [...new Set(input.permissions)].map(permission => ({ permission })) } } });
    await tx.auditLog.create({ data: { serverId, actorId: req.auth!.userId, action: 'ROLE_CREATED', targetType: 'role', targetId: created.id } });
    return created;
  });
  membershipChanged(serverId); res.status(201).json({ role });
}));
router.patch('/:serverId/roles/:roleId', route(async (req, res) => {
  const serverId = sid(req); const ctx = await requireServer(req.auth!.userId, serverId, 'MANAGE_ROLES');
  const roleId = id.parse(req.params.roleId); const role = await db.role.findFirst({ where: { id: roleId, serverId } });
  if (!role || role.isManaged) throw new HttpError(403, 'FORBIDDEN', 'Managed roles cannot be edited.');
  if (!ctx.owner && role.position >= Math.max(0, ...ctx.roles.map(r => r.position))) throw new HttpError(403, 'ROLE_HIERARCHY', 'That role is above yours.');
  const input = z.object({ name: z.string().trim().min(1).max(50).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(), position: z.number().int().min(1).max(79).optional(), permissions: z.array(permissionSchema).max(18).optional() }).parse(req.body);
  if (!ctx.owner && ((input.position ?? 0) >= Math.max(0, ...ctx.roles.map(r => r.position)) || input.permissions?.some(p => !hasServerPermission(ctx, p)))) throw new HttpError(403, 'ROLE_HIERARCHY', 'You cannot grant permissions you do not have.');
  const updated = await db.$transaction(async tx => {
    const updated = await tx.role.update({ where: { id: roleId }, data: { name: input.name, color: input.color, position: input.position } });
    if (input.permissions) { await tx.rolePermission.deleteMany({ where: { roleId } }); await tx.rolePermission.createMany({ data: [...new Set(input.permissions)].map(permission => ({ roleId, permission })) }); }
    await tx.auditLog.create({ data: { serverId, actorId: req.auth!.userId, action: 'ROLE_UPDATED', targetType: 'role', targetId: roleId } });
    return updated;
  });
  const members = await db.memberRole.findMany({ where: { roleId }, select: { member: { select: { userId: true } } } });
  for (const m of members) disconnectUser(m.member.userId);
  membershipChanged(serverId); res.json({ role: updated });
}));
router.delete('/:serverId/roles/:roleId', route(async (req, res) => {
  const serverId = sid(req); const ctx = await requireServer(req.auth!.userId, serverId, 'MANAGE_ROLES');
  const roleId = id.parse(req.params.roleId); const role = await db.role.findFirst({ where: { id: roleId, serverId } });
  if (!role || role.isManaged || (!ctx.owner && role.position >= Math.max(0, ...ctx.roles.map(r => r.position)))) throw new HttpError(403, 'FORBIDDEN', 'You cannot delete this role.');
  const members = await db.memberRole.findMany({ where: { roleId }, select: { member: { select: { userId: true } } } });
  await db.$transaction(async tx => {
    await tx.role.delete({ where: { id: roleId } });
    await tx.auditLog.create({ data: { serverId, actorId: req.auth!.userId, action: 'ROLE_DELETED', targetType: 'role', targetId: roleId } });
  });
  members.forEach(m => disconnectUser(m.member.userId)); membershipChanged(serverId);
  res.status(204).send();
}));
router.put('/:serverId/members/:userId/roles/:roleId', route(async (req, res) => {
  const serverId = sid(req); const targetId = id.parse(req.params.userId), roleId = id.parse(req.params.roleId);
  const ctx = await requireServer(req.auth!.userId, serverId, 'MANAGE_ROLES');
  const target = await context(targetId, serverId); requireHigherRole(ctx, target);
  const role = await db.role.findFirst({ where: { id: roleId, serverId }, include: { permissions: true } });
  if (!role || role.isManaged && role.name === 'Owner') throw new HttpError(403, 'FORBIDDEN', 'This role cannot be assigned.');
  if (!ctx.owner && (role.position >= Math.max(0, ...ctx.roles.map(r => r.position)) || role.permissions.some(p => !hasServerPermission(ctx, p.permission)))) throw new HttpError(403, 'ROLE_HIERARCHY', 'You cannot assign this role.');
  const member = await db.serverMember.findUniqueOrThrow({ where: { serverId_userId: { serverId, userId: targetId } } });
  await db.$transaction(async tx => {
    await tx.memberRole.upsert({ where: { memberId_roleId: { memberId: member.id, roleId } }, create: { memberId: member.id, roleId }, update: {} });
    await tx.auditLog.create({ data: { serverId, actorId: req.auth!.userId, action: 'ROLE_ASSIGNED', targetType: 'user', targetId, metadata: { roleId } } });
  });
  disconnectUser(targetId); membershipChanged(serverId); res.status(204).send();
}));
router.delete('/:serverId/members/:userId/roles/:roleId', route(async (req, res) => {
  const serverId = sid(req), targetId = id.parse(req.params.userId), roleId = id.parse(req.params.roleId);
  const ctx = await requireServer(req.auth!.userId, serverId, 'MANAGE_ROLES');
  const target = await context(targetId, serverId); requireHigherRole(ctx, target);
  const role = await db.role.findFirst({ where: { id: roleId, serverId } });
  if (!role || role.isManaged && (role.name === 'Owner' || role.name === 'Member') || !ctx.owner && role.position >= Math.max(0, ...ctx.roles.map(r => r.position))) throw new HttpError(403, 'FORBIDDEN', 'You cannot remove this role.');
  const member = await db.serverMember.findUniqueOrThrow({ where: { serverId_userId: { serverId, userId: targetId } } });
  await db.memberRole.deleteMany({ where: { memberId: member.id, roleId } });
  await db.auditLog.create({ data: { serverId, actorId: req.auth!.userId, action: 'ROLE_REMOVED', targetType: 'user', targetId, metadata: { roleId } } });
  disconnectUser(targetId); membershipChanged(serverId); res.status(204).send();
}));
router.get('/:serverId/invites', route(async (req, res) => {
  const serverId = sid(req); await requireServer(req.auth!.userId, serverId, 'MANAGE_INVITES');
  const invites = await db.invitation.findMany({ where: { serverId, revokedAt: null }, select: { id: true, issuerId: true, uses: true, maxUses: true, expiresAt: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 50 });
  res.json({ invites }); // Raw invite tokens are never stored and cannot be recovered.
}));
router.post('/:serverId/invites', route(async (req, res) => {
  const serverId = sid(req); await requireServer(req.auth!.userId, serverId, 'MANAGE_INVITES');
  const input = inviteSchema.parse(req.body); const token = randomToken();
  const invite = await db.invitation.create({ data: { serverId, issuerId: req.auth!.userId, tokenHash: hash(token), maxUses: input.maxUses, expiresAt: input.expiresInHours ? new Date(Date.now() + input.expiresInHours * 3600_000) : null } });
  await db.auditLog.create({ data: { serverId, actorId: req.auth!.userId, action: 'INVITE_CREATED', targetType: 'invitation', targetId: invite.id } });
  res.status(201).json({ invite: { id: invite.id, token, url: `${allowedOrigins.includes(req.get('origin') || '') ? req.get('origin') : config.WEB_ORIGIN}/invite/${token}`, maxUses: invite.maxUses, expiresAt: invite.expiresAt } });
}));
router.delete('/:serverId/invites/:inviteId', route(async (req, res) => {
  const serverId = sid(req); await requireServer(req.auth!.userId, serverId, 'MANAGE_INVITES');
  const result = await db.invitation.updateMany({ where: { id: id.parse(req.params.inviteId), serverId }, data: { revokedAt: new Date() } });
  if (!result.count) throw new HttpError(404, 'NOT_FOUND', 'Invite not found.');
  await db.auditLog.create({ data: { serverId, actorId: req.auth!.userId, action: 'INVITE_REVOKED', targetType: 'invitation', targetId: req.params.inviteId } });
  res.status(204).send();
}));
const moderationInput = z.object({ reason: z.string().trim().max(500).optional() });
router.post('/:serverId/members/:userId/kick', route(async (req, res) => {
  const serverId = sid(req), targetId = id.parse(req.params.userId);
  const ctx = await requireServer(req.auth!.userId, serverId, 'KICK_MEMBERS');
  const target = await context(targetId, serverId); requireHigherRole(ctx, target);
  const { reason } = moderationInput.parse(req.body);
  await db.$transaction(async tx => {
    await tx.serverMember.delete({ where: { serverId_userId: { serverId, userId: targetId } } });
    await tx.moderationAction.create({ data: { serverId, actorId: req.auth!.userId, targetId, kind: 'KICK', reason } });
    await tx.auditLog.create({ data: { serverId, actorId: req.auth!.userId, action: 'MEMBER_KICKED', targetType: 'user', targetId } });
  });
  disconnectUser(targetId); membershipChanged(serverId, targetId);
  await notify(targetId, 'MODERATION', { serverId, kind: 'KICK', reason: reason || null }, req.auth!.userId);
  res.status(204).send();
}));
router.post('/:serverId/members/:userId/ban', route(async (req, res) => {
  const serverId = sid(req), targetId = id.parse(req.params.userId);
  const ctx = await requireServer(req.auth!.userId, serverId, 'BAN_MEMBERS');
  const target = await context(targetId, serverId); requireHigherRole(ctx, target);
  const { reason } = moderationInput.parse(req.body);
  await db.$transaction(async tx => {
    await tx.serverBan.upsert({ where: { serverId_userId: { serverId, userId: targetId } }, create: { serverId, userId: targetId, actorId: req.auth!.userId, reason }, update: { actorId: req.auth!.userId, reason } });
    await tx.serverMember.delete({ where: { serverId_userId: { serverId, userId: targetId } } });
    await tx.moderationAction.create({ data: { serverId, actorId: req.auth!.userId, targetId, kind: 'BAN', reason } });
    await tx.auditLog.create({ data: { serverId, actorId: req.auth!.userId, action: 'MEMBER_BANNED', targetType: 'user', targetId } });
  });
  disconnectUser(targetId); membershipChanged(serverId, targetId);
  await notify(targetId, 'MODERATION', { serverId, kind: 'BAN', reason: reason || null }, req.auth!.userId);
  res.status(204).send();
}));
router.delete('/:serverId/bans/:userId', route(async (req, res) => {
  const serverId = sid(req), targetId = id.parse(req.params.userId);
  await requireServer(req.auth!.userId, serverId, 'BAN_MEMBERS');
  const result = await db.serverBan.deleteMany({ where: { serverId, userId: targetId } });
  if (!result.count) throw new HttpError(404, 'NOT_FOUND', 'Ban not found.');
  await db.moderationAction.create({ data: { serverId, actorId: req.auth!.userId, targetId, kind: 'UNBAN' } });
  await db.auditLog.create({ data: { serverId, actorId: req.auth!.userId, action: 'MEMBER_UNBANNED', targetType: 'user', targetId } });
  res.status(204).send();
}));
router.get('/:serverId/bans', route(async (req, res) => {
  const serverId = sid(req); await requireServer(req.auth!.userId, serverId, 'BAN_MEMBERS');
  const bans = await db.serverBan.findMany({ where: { serverId }, include: { user: true }, take: 50, orderBy: { createdAt: 'desc' } });
  res.json({ bans: bans.map(b => ({ user: publicUser(b.user), reason: b.reason, createdAt: b.createdAt })) });
}));
router.post('/:serverId/members/:userId/timeout', route(async (req, res) => {
  const serverId = sid(req), targetId = id.parse(req.params.userId);
  const ctx = await requireServer(req.auth!.userId, serverId, 'MODERATE_MEMBERS');
  const target = await context(targetId, serverId); requireHigherRole(ctx, target);
  const input = moderationInput.extend({ minutes: z.number().int().min(0).max(10080) }).parse(req.body);
  const expiresAt = input.minutes ? new Date(Date.now() + input.minutes * 60_000) : null;
  await db.$transaction(async tx => {
    await tx.serverMember.update({ where: { serverId_userId: { serverId, userId: targetId } }, data: { timedOutUntil: expiresAt } });
    await tx.moderationAction.create({ data: { serverId, actorId: req.auth!.userId, targetId, kind: expiresAt ? 'TIMEOUT' : 'CLEAR_TIMEOUT', expiresAt, reason: input.reason } });
    await tx.auditLog.create({ data: { serverId, actorId: req.auth!.userId, action: expiresAt ? 'MEMBER_TIMED_OUT' : 'TIMEOUT_CLEARED', targetType: 'user', targetId } });
  });
  disconnectUser(targetId); membershipChanged(serverId, targetId); res.json({ timedOutUntil: expiresAt });
}));
router.get('/:serverId/audit', route(async (req, res) => {
  const serverId = sid(req); await requireServer(req.auth!.userId, serverId, 'VIEW_AUDIT_LOG');
  const { limit, cursor } = paginationSchema.parse(req.query);
  const logs = await db.auditLog.findMany({ where: { serverId }, take: limit + 1, ...(cursor ? { cursor: { id: id.parse(cursor) }, skip: 1 } : {}), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true, actorId: true, action: true, targetType: true, targetId: true, metadata: true, createdAt: true } });
  res.json({ logs: logs.slice(0, limit), nextCursor: logs.length > limit ? logs[limit - 1]?.id : null });
}));
export default router;
