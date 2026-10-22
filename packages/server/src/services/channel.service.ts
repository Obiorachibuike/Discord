import {
  
  Permissions,
  hasPermission,
  type CreateChannelInput,
} from '@aether/shared';
import { prisma } from '../context.js';
import { ApiError } from '../errors.js';
import { permissions } from './permission.service.js';
import { audit } from './audit.service.js';
import { toChannelDTO } from '../utils/dto.js';
import { tryGetIO } from '../socket/io.js';

export class ChannelService {
  /** Channels visible to the user, grouped with categories. */
  async list(serverId: string, userId: string) {
    const ctx = await permissions.getServerContext(serverId, userId);
    const [categories, channels] = await Promise.all([
      prisma.channelCategory.findMany({ where: { serverId }, orderBy: { position: 'asc' } }),
      prisma.channel.findMany({ where: { serverId }, orderBy: { position: 'asc' } }),
    ]);
    const visibleIds = new Set(await permissions.visibleChannelIds(serverId, userId));
    const visible = channels.filter((c) => visibleIds.has(c.id));
    return {
      categories: categories.map((cat) => ({
        id: cat.id,
        name: cat.name,
        position: cat.position,
        channels: visible.filter((c) => c.categoryId === cat.id).map(toChannelDTO),
      })),
      uncategorized: visible.filter((c) => !c.categoryId).map(toChannelDTO),
      canManage:
        ctx.isOwner ||
        hasPermission(ctx.rolePermissions, Permissions.MANAGE_CHANNELS) ||
        hasPermission(ctx.rolePermissions, Permissions.MANAGE_SERVER),
    };
  }

  async create(serverId: string, actorId: string, input: CreateChannelInput) {
    const ctx = await permissions.getServerContext(serverId, actorId);
    if (!ctx.isOwner) permissions.requireChannel(ctx.rolePermissions, Permissions.MANAGE_CHANNELS);
    const count = await prisma.channel.count({ where: { serverId } });
    const channel = await prisma.channel.create({
      data: {
        serverId,
        categoryId: input.categoryId ?? null,
        name: input.name,
        type: input.type,
        topic: input.topic ?? null,
        isPrivate: input.isPrivate,
        position: count,
      },
    });
    await audit.log({ serverId, actorId, action: 'channel.create', targetId: channel.id, targetType: 'channel' });
    tryGetIO()?.to(`server:${serverId}`).emit('channel:updated', { serverId, channel: toChannelDTO(channel) });
    return channel;
  }

  async update(
    channelId: string,
    actorId: string,
    input: {
      name?: string;
      topic?: string | null;
      categoryId?: string | null;
      position?: number;
      isPrivate?: boolean;
    },
  ) {
    const channel = await prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) throw ApiError.notFound('Channel not found');
    const ctx = await permissions.getServerContext(channel.serverId, actorId);
    if (!ctx.isOwner) permissions.requireChannel(ctx.rolePermissions, Permissions.MANAGE_CHANNELS);
    const updated = await prisma.channel.update({
      where: { id: channelId },
      data: {
        name: input.name,
        topic: input.topic === undefined ? undefined : input.topic,
        categoryId: input.categoryId === undefined ? undefined : input.categoryId,
        position: input.position,
        isPrivate: input.isPrivate,
      },
    });
    await audit.log({
      serverId: channel.serverId,
      actorId,
      action: 'channel.update',
      targetId: channelId,
      targetType: 'channel',
      metadata: input as Record<string, unknown>,
    });
    tryGetIO()
      ?.to(`server:${channel.serverId}`)
      .emit('channel:updated', { serverId: channel.serverId, channel: toChannelDTO(updated) });
    return updated;
  }

  async remove(channelId: string, actorId: string) {
    const channel = await prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) throw ApiError.notFound('Channel not found');
    const ctx = await permissions.getServerContext(channel.serverId, actorId);
    if (!ctx.isOwner) permissions.requireChannel(ctx.rolePermissions, Permissions.MANAGE_CHANNELS);
    await prisma.channel.delete({ where: { id: channelId } });
    await audit.log({ serverId: channel.serverId, actorId, action: 'channel.delete', targetId: channelId, targetType: 'channel' });
    tryGetIO()?.to(`server:${channel.serverId}`).emit('channel:deleted', { serverId: channel.serverId, channelId });
    tryGetIO()?.in(`channel:${channelId}`).socketsLeave(`channel:${channelId}`);
  }

  async reorder(
    serverId: string,
    actorId: string,
    items: { id: string; position: number; categoryId?: string | null }[],
  ) {
    const ctx = await permissions.getServerContext(serverId, actorId);
    if (!ctx.isOwner) permissions.requireChannel(ctx.rolePermissions, Permissions.MANAGE_CHANNELS);
    await prisma.$transaction(
      items.map((item) =>
        prisma.channel.updateMany({
          where: { id: item.id, serverId },
          data: {
            position: item.position,
            ...(item.categoryId !== undefined ? { categoryId: item.categoryId } : {}),
          },
        }),
      ),
    );
    await audit.log({ serverId, actorId, action: 'channel.reorder', metadata: { count: items.length } });
  }

  async setOverride(
    channelId: string,
    actorId: string,
    target: { roleId?: string; userId?: string },
    input: { allow: string; deny: string },
  ) {
    const channel = await prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) throw ApiError.notFound('Channel not found');
    const ctx = await permissions.getServerContext(channel.serverId, actorId);
    if (!ctx.isOwner) permissions.requireChannel(ctx.rolePermissions, Permissions.MANAGE_ROLES);
    const allow = BigInt(input.allow);
    const deny = BigInt(input.deny);
    permissions.assertCanGrantPermissions(ctx, allow);
    if (target.roleId) {
      const existing = await prisma.channelPermissionOverride.findUnique({
        where: { channelId_roleId: { channelId, roleId: target.roleId } },
      });
      return existing
        ? prisma.channelPermissionOverride.update({
            where: { id: existing.id },
            data: { allow, deny },
          })
        : prisma.channelPermissionOverride.create({
            data: { channelId, roleId: target.roleId, allow, deny },
          });
    }
    if (target.userId) {
      const existing = await prisma.channelPermissionOverride.findUnique({
        where: { channelId_userId: { channelId, userId: target.userId } },
      });
      return existing
        ? prisma.channelPermissionOverride.update({
            where: { id: existing.id },
            data: { allow, deny },
          })
        : prisma.channelPermissionOverride.create({
            data: { channelId, userId: target.userId, allow, deny },
          });
    }
    throw ApiError.badRequest('roleId or userId is required');
  }

  // ── Categories ────────────────────────────────────────────────────────────

  async createCategory(serverId: string, actorId: string, name: string) {
    const ctx = await permissions.getServerContext(serverId, actorId);
    if (!ctx.isOwner) permissions.requireChannel(ctx.rolePermissions, Permissions.MANAGE_CHANNELS);
    const maxPos = await prisma.channelCategory.aggregate({
      where: { serverId },
      _max: { position: true },
    });
    return prisma.channelCategory.create({
      data: { serverId, name, position: (maxPos._max.position ?? -1) + 1 },
    });
  }

  async updateCategory(categoryId: string, actorId: string, name: string) {
    const cat = await prisma.channelCategory.findUnique({ where: { id: categoryId } });
    if (!cat) throw ApiError.notFound('Category not found');
    const ctx = await permissions.getServerContext(cat.serverId, actorId);
    if (!ctx.isOwner) permissions.requireChannel(ctx.rolePermissions, Permissions.MANAGE_CHANNELS);
    return prisma.channelCategory.update({ where: { id: categoryId }, data: { name } });
  }

  async deleteCategory(categoryId: string, actorId: string) {
    const cat = await prisma.channelCategory.findUnique({ where: { id: categoryId } });
    if (!cat) throw ApiError.notFound('Category not found');
    const ctx = await permissions.getServerContext(cat.serverId, actorId);
    if (!ctx.isOwner) permissions.requireChannel(ctx.rolePermissions, Permissions.MANAGE_CHANNELS);
    await prisma.channelCategory.delete({ where: { id: categoryId } });
  }
}

export const channels = new ChannelService();
