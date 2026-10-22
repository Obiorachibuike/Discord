import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  Permissions,
  combineRolePermissions,
  hasPermission,
  resolveChannelPermissions,
  canManageRole,
} from '@aether/shared';
import { prisma } from '../context.js';
import { ApiError } from '../errors.js';

export interface ServerContext {
  serverId: string;
  userId: string;
  isOwner: boolean;
  memberId: string | null;
  roleIds: string[];
  rolePermissions: bigint;
  highestRolePosition: number;
  timeoutUntil: Date | null;
}

/**
 * Centralized authorization. Deny by default: every sensitive operation goes
 * through one of these checks on the server (REST and Socket.IO alike).
 */
export class PermissionService {
  async getServerContext(serverId: string, userId: string): Promise<ServerContext> {
    const server = await prisma.server.findUnique({
      where: { id: serverId },
      select: { id: true, ownerId: true },
    });
    if (!server) throw ApiError.notFound('Server not found');
    const member = await prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId, userId } },
      include: { roles: { include: { role: true } } },
    });
    if (!member) throw ApiError.forbidden('You are not a member of this server');
    // Explicit roles plus the server's default role (applies to everyone).
    const defaultRole = await prisma.role.findFirst({
      where: { serverId, isDefault: true },
    });
    const rolePerms = member.roles.map((r) => BigInt(r.role.permissions.toString()));
    if (defaultRole) rolePerms.push(BigInt(defaultRole.permissions.toString()));
    const roleIds = member.roles.map((r) => r.roleId);
    if (defaultRole) roleIds.push(defaultRole.id);
    return {
      serverId,
      userId,
      isOwner: server.ownerId === userId,
      memberId: member.id,
      roleIds,
      rolePermissions: combineRolePermissions(rolePerms),
      highestRolePosition: member.roles.reduce((m, r) => Math.max(m, r.role.position), 0),
      timeoutUntil: member.timeoutUntil,
    };
  }

  /** Effective permissions for a channel (server roles + channel overrides). */
  async getChannelContext(
    channelId: string,
    userId: string,
  ): Promise<{ ctx: ServerContext; channel: { id: string; serverId: string; type: string; isPrivate: boolean }; permissions: bigint }> {
    const channel = await prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) throw ApiError.notFound('Channel not found');
    const ctx = await this.getServerContext(channel.serverId, userId);
    let channelAllow = 0n;
    let channelDeny = 0n;
    const overrides = await prisma.channelPermissionOverride.findMany({
      where: {
        channelId,
        OR: [{ userId }, { roleId: { in: ctx.roleIds } }],
      },
    });
    for (const o of overrides) {
      channelAllow |= BigInt(o.allow.toString());
      channelDeny |= BigInt(o.deny.toString());
    }
    const permissions = resolveChannelPermissions({
      serverBase: ctx.isOwner ? ALL_PERMISSIONS : ctx.rolePermissions,
      channelAllow,
      channelDeny,
      isOwner: ctx.isOwner,
    });
    // Private channels are deny-by-default: viewing requires an explicit
    // channel-level allow (a role/user override), regardless of role base.
    const effective =
      channel.isPrivate && !ctx.isOwner && (channelAllow & Permissions.VIEW_CHANNELS) !== Permissions.VIEW_CHANNELS
        ? permissions & ~Permissions.VIEW_CHANNELS
        : permissions;
    return {
      ctx,
      channel: {
        id: channel.id,
        serverId: channel.serverId,
        type: channel.type,
        isPrivate: channel.isPrivate,
      },
      permissions: effective,
    };
  }

  requireChannel(permissions: bigint, permission: bigint): void {
    if (!hasPermission(permissions, permission)) {
      throw ApiError.forbidden('Missing permission');
    }
  }

  /** True when the member may view the channel (private + override aware). */
  async canViewChannel(channelId: string, userId: string): Promise<boolean> {
    try {
      const { permissions } = await this.getChannelContext(channelId, userId);
      return hasPermission(permissions, Permissions.VIEW_CHANNELS);
    } catch {
      return false;
    }
  }

  /** Channel ids of a server the user may see. */
  async visibleChannelIds(serverId: string, userId: string): Promise<string[]> {
    const ctx = await this.getServerContext(serverId, userId);
    const channels = await prisma.channel.findMany({
      where: { serverId },
      select: { id: true, isPrivate: true },
    });
    if (ctx.isOwner) return channels.map((c) => c.id);
    const overrides = await prisma.channelPermissionOverride.findMany({
      where: { channelId: { in: channels.map((c) => c.id) }, OR: [{ userId }, { roleId: { in: ctx.roleIds } }] },
    });
    const byChannel = new Map<string, { allow: bigint; deny: bigint }>();
    for (const o of overrides) {
      const cur = byChannel.get(o.channelId) ?? { allow: 0n, deny: 0n };
      cur.allow |= BigInt(o.allow.toString());
      cur.deny |= BigInt(o.deny.toString());
      byChannel.set(o.channelId, cur);
    }
    return channels
      .filter((c) => {
        const o = byChannel.get(c.id);
        // Private channels need an explicit allow of VIEW_CHANNELS.
        if (
          c.isPrivate &&
          !ctx.isOwner &&
          ((o?.allow ?? 0n) & Permissions.VIEW_CHANNELS) !== Permissions.VIEW_CHANNELS
        ) {
          return false;
        }
        const perms = resolveChannelPermissions({
          serverBase: ctx.rolePermissions,
          channelAllow: o?.allow,
          channelDeny: o?.deny,
          isOwner: false,
        });
        return hasPermission(perms, Permissions.VIEW_CHANNELS);
      })
      .map((c) => c.id);
  }

  isTimedOut(ctx: ServerContext): boolean {
    return Boolean(ctx.timeoutUntil && ctx.timeoutUntil > new Date());
  }

  /**
   * Role hierarchy guard: actors may only manage targets below their highest
   * role; the owner is untouchable; nobody grants permissions they lack.
   */
  assertCanManageMember(actor: ServerContext, target: { userId: string; isOwner: boolean; highestRolePosition: number }): void {
    if (!canManageRole(actor.highestRolePosition, target.highestRolePosition, actor.isOwner, target.isOwner)) {
      throw ApiError.forbidden('You cannot moderate this member');
    }
  }

  async assertCanAssignRole(actor: ServerContext, roleId: string): Promise<void> {
    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role || role.serverId !== actor.serverId) throw ApiError.notFound('Role not found');
    if (!actor.isOwner && role.position >= actor.highestRolePosition) {
      throw ApiError.forbidden('You cannot assign roles at or above your highest role');
    }
  }

  /** Users cannot grant permissions they do not themselves possess. */
  assertCanGrantPermissions(actor: ServerContext, requested: bigint): void {
    if (actor.isOwner) return;
    const missing = requested & ~actor.rolePermissions;
    if (missing !== 0n && (actor.rolePermissions & Permissions.MANAGE_ROLES) === 0n) {
      throw ApiError.forbidden('Missing permission');
    }
    if (!actor.isOwner && missing !== 0n) {
      throw ApiError.forbidden('You cannot grant permissions you do not have');
    }
  }

  /** Default role (everyone) gets the base member permission set. */
  defaultRolePermissions(): bigint {
    return DEFAULT_ROLE_PERMISSIONS.Member;
  }
}

export const permissions = new PermissionService();
