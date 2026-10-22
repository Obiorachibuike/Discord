import { Router } from 'express';
import { db } from '@cove/db';
import { z } from 'zod';
import { categorySchema, channelSchema, id, permissionSchema } from '@cove/shared';
import { HttpError, route } from '../lib/errors';
import { context, requireChannel, requireServer, hasServerPermission } from '../services/permissions';
import { membershipChanged } from '../services/servers';
import { disconnectServer } from '../services/notifications';
const router = Router();
router.get('/:channelId', route(async (req, res) => {
  const { channel } = await requireChannel(req.auth!.userId, id.parse(req.params.channelId), 'VIEW_CHANNEL');
  const { overrides: _private, ...safe } = channel; res.json({ channel: safe });
}));
router.post('/servers/:serverId/categories', route(async (req, res) => {
  const serverId = id.parse(req.params.serverId); await requireServer(req.auth!.userId, serverId, 'MANAGE_CHANNELS');
  const input = categorySchema.parse(req.body);
  const category = await db.channelCategory.create({ data: { ...input, serverId } });
  membershipChanged(serverId); res.status(201).json({ category });
}));
router.patch('/categories/:categoryId', route(async (req, res) => {
  const categoryId = id.parse(req.params.categoryId);
  const old = await db.channelCategory.findUnique({ where: { id: categoryId } });
  if (!old) throw new HttpError(404, 'NOT_FOUND', 'Category not found.');
  await requireServer(req.auth!.userId, old.serverId, 'MANAGE_CHANNELS');
  const category = await db.channelCategory.update({ where: { id: categoryId }, data: categorySchema.partial().parse(req.body) });
  membershipChanged(old.serverId); res.json({ category });
}));
router.delete('/categories/:categoryId', route(async (req, res) => {
  const categoryId = id.parse(req.params.categoryId); const old = await db.channelCategory.findUnique({ where: { id: categoryId } });
  if (!old) throw new HttpError(404, 'NOT_FOUND', 'Category not found.');
  await requireServer(req.auth!.userId, old.serverId, 'MANAGE_CHANNELS');
  await db.channelCategory.delete({ where: { id: categoryId } }); // Channels become uncategorized, not deleted.
  membershipChanged(old.serverId); res.status(204).send();
}));
router.post('/servers/:serverId', route(async (req, res) => {
  const serverId = id.parse(req.params.serverId); await requireServer(req.auth!.userId, serverId, 'MANAGE_CHANNELS');
  const input = channelSchema.parse(req.body);
  if (input.categoryId) {
    const category = await db.channelCategory.findFirst({ where: { id: input.categoryId, serverId } });
    if (!category) throw new HttpError(400, 'INVALID_CATEGORY', 'Choose a category in this community.');
  }
  if (input.userLimit && input.kind !== 'VOICE') throw new HttpError(400, 'INVALID_LIMIT', 'Only voice channels have participant limits.');
  const channel = await db.$transaction(async tx => {
    const created = await tx.channel.create({ data: { ...input, serverId } });
    await tx.auditLog.create({ data: { serverId, actorId: req.auth!.userId, action: 'CHANNEL_CREATED', targetType: 'channel', targetId: created.id } });
    return created;
  });
  membershipChanged(serverId); res.status(201).json({ channel });
}));
router.patch('/:channelId', route(async (req, res) => {
  const channelId = id.parse(req.params.channelId); const old = await db.channel.findUnique({ where: { id: channelId } });
  if (!old) throw new HttpError(404, 'NOT_FOUND', 'Channel not found.');
  await requireServer(req.auth!.userId, old.serverId, 'MANAGE_CHANNELS');
  const input = channelSchema.partial().parse(req.body);
  if (input.categoryId) {
    const category = await db.channelCategory.findFirst({ where: { id: input.categoryId, serverId: old.serverId } });
    if (!category) throw new HttpError(400, 'INVALID_CATEGORY', 'Choose a category in this community.');
  }
  if (input.userLimit && (input.kind ?? old.kind) !== 'VOICE') throw new HttpError(400, 'INVALID_LIMIT', 'Only voice channels have participant limits.');
  const channel = await db.$transaction(async tx => {
    const updated = await tx.channel.update({ where: { id: channelId }, data: input });
    await tx.auditLog.create({ data: { serverId: old.serverId, actorId: req.auth!.userId, action: 'CHANNEL_UPDATED', targetType: 'channel', targetId: channelId } });
    return updated;
  });
  disconnectServer(old.serverId); membershipChanged(old.serverId); res.json({ channel });
}));
router.delete('/:channelId', route(async (req, res) => {
  const channelId = id.parse(req.params.channelId); const old = await db.channel.findUnique({ where: { id: channelId } });
  if (!old) throw new HttpError(404, 'NOT_FOUND', 'Channel not found.');
  await requireServer(req.auth!.userId, old.serverId, 'MANAGE_CHANNELS');
  await db.$transaction(async tx => {
    await tx.channel.delete({ where: { id: channelId } });
    await tx.auditLog.create({ data: { serverId: old.serverId, actorId: req.auth!.userId, action: 'CHANNEL_DELETED', targetType: 'channel', targetId: channelId } });
  });
  disconnectServer(old.serverId); membershipChanged(old.serverId); res.status(204).send();
}));
router.put('/:channelId/overrides', route(async (req, res) => {
  const channelId = id.parse(req.params.channelId); const channel = await db.channel.findUnique({ where: { id: channelId } });
  if (!channel) throw new HttpError(404, 'NOT_FOUND', 'Channel not found.');
  const ctx = await requireServer(req.auth!.userId, channel.serverId, 'MANAGE_CHANNELS');
  const input = z.object({ roleId: id.optional(), userId: id.optional(), allow: z.array(permissionSchema).max(18).default([]), deny: z.array(permissionSchema).max(18).default([]) })
    .refine(v => !!v.roleId !== !!v.userId, 'Choose one role or user')
    .refine(v => !v.allow.some(p => v.deny.includes(p)), 'Allow and deny cannot overlap').parse(req.body);
  if (!ctx.owner && input.allow.some(p => !hasServerPermission(ctx, p))) throw new HttpError(403, 'FORBIDDEN', 'You cannot grant a permission you do not have.');
  if (input.roleId) {
    const role = await db.role.findFirst({ where: { id: input.roleId, serverId: channel.serverId } });
    if (!role || role.name === 'Owner' || !ctx.owner && role.position >= Math.max(0, ...ctx.roles.map(r => r.position))) throw new HttpError(403, 'FORBIDDEN', 'You cannot override this role.');
  } else {
    const target = await context(input.userId!, channel.serverId);
    if (target.owner || !ctx.owner && Math.max(0, ...target.roles.map(r => r.position)) >= Math.max(0, ...ctx.roles.map(r => r.position))) throw new HttpError(403, 'ROLE_HIERARCHY', 'You cannot override this user.');
  }
  const override = await db.$transaction(async tx => {
    await tx.channelPermissionOverride.deleteMany({ where: { channelId, ...(input.roleId ? { roleId: input.roleId } : { userId: input.userId }) } });
    const updated = await tx.channelPermissionOverride.create({ data: { channelId, roleId: input.roleId, userId: input.userId, allow: input.allow, deny: input.deny } });
    await tx.auditLog.create({ data: { serverId: channel.serverId, actorId: req.auth!.userId, action: 'CHANNEL_PERMISSIONS_UPDATED', targetType: 'channel', targetId: channelId } });
    return updated;
  });
  disconnectServer(channel.serverId); membershipChanged(channel.serverId); res.json({ override });
}));
router.get('/:channelId/overrides', route(async (req, res) => {
  const channelId = id.parse(req.params.channelId);
  const { channel } = await requireChannel(req.auth!.userId, channelId, 'VIEW_CHANNEL');
  await requireServer(req.auth!.userId, channel.serverId, 'MANAGE_CHANNELS');
  res.json({ overrides: channel.overrides });
}));
export default router;
