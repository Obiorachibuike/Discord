import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  Permissions,
  type CreateInviteInput,
  type CreateServerInput,
} from '@aether/shared';
import { prisma } from '../context.js';
import { ApiError } from '../errors.js';
import { generateInviteCode } from '../utils/crypto.js';
import { permissions } from './permission.service.js';
import { audit } from './audit.service.js';
import { toRoleDTO } from '../utils/dto.js';
import { tryGetIO } from '../socket/io.js';

export class ServerService {
  async create(ownerId: string, input: CreateServerInput) {
    const server = await prisma.$transaction(async (tx) => {
      const s = await tx.server.create({
        data: {
          name: input.name,
          description: input.description ?? null,
          ownerId,
          members: { create: { userId: ownerId } },
          roles: {
            create: [
              { name: 'Administrator', permissions: ALL_PERMISSIONS, position: 3, color: '#e11d48' },
              { name: 'Moderator', permissions: DEFAULT_ROLE_PERMISSIONS.Moderator, position: 2, color: '#2563eb' },
              {
                name: 'Member',
                permissions: DEFAULT_ROLE_PERMISSIONS.Member,
                position: 1,
                isDefault: true,
              },
            ],
          },
          categories: { create: [{ name: 'Text Channels', position: 0 }] },
        },
        include: { categories: true },
      });
      await tx.channel.create({
        data: {
          serverId: s.id,
          categoryId: s.categories[0]?.id,
          name: 'general',
          type: 'TEXT',
          position: 0,
        },
      });
      await tx.channel.create({
        data: {
          serverId: s.id,
          categoryId: s.categories[0]?.id,
          name: 'General Voice',
          type: 'VOICE',
          position: 1,
        },
      });
      return s;
    });
    await audit.log({ serverId: server.id, actorId: ownerId, action: 'server.create', targetId: server.id, targetType: 'server' });
    tryGetIO()?.to(`user:${ownerId}`).socketsJoin(`server:${server.id}`);
    return server;
  }

  async listForUser(userId: string) {
    const memberships = await prisma.serverMember.findMany({
      where: { userId },
      include: {
        server: { include: { _count: { select: { members: true } } } },
      },
      orderBy: { joinedAt: 'asc' },
    });
    return memberships.map((m) => m.server);
  }

  async getForUser(serverId: string, userId: string) {
    const ctx = await permissions.getServerContext(serverId, userId);
    const server = await prisma.server.findUniqueOrThrow({
      where: { id: serverId },
      include: { _count: { select: { members: true } } },
    });
    return { server, ctx };
  }

  async update(
    serverId: string,
    actorId: string,
    input: { name?: string; description?: string | null },
  ) {
    const ctx = await permissions.getServerContext(serverId, actorId);
    if (!ctx.isOwner) permissions.requireChannel(ctx.rolePermissions | (ctx.isOwner ? ALL_PERMISSIONS : 0n), Permissions.MANAGE_SERVER);
    const server = await prisma.server.update({
      where: { id: serverId },
      data: { name: input.name, description: input.description ?? undefined },
      include: { _count: { select: { members: true } } },
    });
    await audit.log({ serverId, actorId, action: 'server.update', targetId: serverId, targetType: 'server', metadata: input as Record<string, unknown> });
    tryGetIO()?.to(`server:${serverId}`).emit('channel:updated', { serverId, name: server.name });
    return server;
  }

  async remove(serverId: string, actorId: string) {
    const ctx = await permissions.getServerContext(serverId, actorId);
    if (!ctx.isOwner) throw ApiError.forbidden('Only the owner can delete a server');
    await prisma.server.delete({ where: { id: serverId } });
    await audit.log({ serverId: null, actorId, action: 'server.delete', targetId: serverId, targetType: 'server' });
    tryGetIO()?.to(`server:${serverId}`).emit('channel:deleted', { serverId });
  }

  async leave(serverId: string, userId: string) {
    const ctx = await permissions.getServerContext(serverId, userId);
    if (ctx.isOwner) {
      throw ApiError.badRequest(
        'You own this server — transfer ownership before leaving, or delete the server.',
      );
    }
    await prisma.serverMember.delete({
      where: { serverId_userId: { serverId, userId } },
    });
    await audit.log({ serverId, actorId: userId, action: 'member.leave', targetId: userId, targetType: 'user' });
    const io = tryGetIO();
    io?.to(`server:${serverId}`).emit('member:updated', { serverId, userId, left: true });
    io?.in(`user:${userId}`).socketsLeave(`server:${serverId}`);
  }

  async transferOwnership(serverId: string, actorId: string, newOwnerId: string) {
    const ctx = await permissions.getServerContext(serverId, actorId);
    if (!ctx.isOwner) throw ApiError.forbidden('Only the owner can transfer ownership');
    if (newOwnerId === actorId) throw ApiError.badRequest('You already own this server');
    const target = await prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId, userId: newOwnerId } },
    });
    if (!target) throw ApiError.badRequest('Target user is not a member of this server');
    await prisma.server.update({ where: { id: serverId }, data: { ownerId: newOwnerId } });
    await audit.log({ serverId, actorId, action: 'server.transfer_ownership', targetId: newOwnerId, targetType: 'user' });
  }

  // ── Membership ────────────────────────────────────────────────────────────

  async listMembers(serverId: string, userId: string, opts: { cursor?: string; limit: number }) {
    await permissions.getServerContext(serverId, userId);
    const members = await prisma.serverMember.findMany({
      where: { serverId },
      include: { user: true, roles: true },
      orderBy: { joinedAt: 'asc' },
      take: opts.limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    const hasMore = members.length > opts.limit;
    const items = hasMore ? members.slice(0, opts.limit) : members;
    return {
      items,
      nextCursor: hasMore ? items[items.length - 1]?.id : null,
    };
  }

  async kick(serverId: string, actorId: string, targetId: string, reason?: string) {
    const ctx = await permissions.getServerContext(serverId, actorId);
    permissions.requireChannel(ctx.rolePermissions | (ctx.isOwner ? ALL_PERMISSIONS : 0n), Permissions.KICK_MEMBERS);
    const target = await prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId, userId: targetId } },
      include: { roles: { include: { role: true } } },
    });
    if (!target) throw ApiError.notFound('Member not found');
    permissions.assertCanManageMember(ctx, {
      userId: targetId,
      isOwner: targetId === (await this.ownerId(serverId)),
      highestRolePosition: target.roles.reduce((m, r) => Math.max(m, r.role.position), 0),
    });
    await prisma.serverMember.delete({ where: { serverId_userId: { serverId, userId: targetId } } });
    await prisma.moderationAction.create({
      data: { serverId, actorId, targetUserId: targetId, type: 'KICK', reason },
    });
    await audit.log({ serverId, actorId, action: 'member.kick', targetId, targetType: 'user', metadata: { reason } });
    const io = tryGetIO();
    io?.to(`server:${serverId}`).emit('member:updated', { serverId, userId: targetId, kicked: true });
    io?.in(`user:${targetId}`).socketsLeave(`server:${serverId}`);
    io?.to(`user:${targetId}`).emit('moderation:update', { type: 'KICK', serverId });
  }

  private async ownerId(serverId: string): Promise<string> {
    const s = await prisma.server.findUniqueOrThrow({ where: { id: serverId }, select: { ownerId: true } });
    return s.ownerId;
  }

  // ── Invites ───────────────────────────────────────────────────────────────

  async createInvite(serverId: string, actorId: string, input: CreateInviteInput) {
    const ctx = await permissions.getServerContext(serverId, actorId);
    permissions.requireChannel(ctx.rolePermissions | (ctx.isOwner ? ALL_PERMISSIONS : 0n), Permissions.MANAGE_INVITES);
    const code = generateInviteCode();
    const invite = await prisma.invitation.create({
      data: {
        code,
        serverId,
        inviterId: actorId,
        expiresAt: input.expiresInHours
          ? new Date(Date.now() + input.expiresInHours * 3600_000)
          : null,
        maxUses: input.maxUses ?? null,
      },
      include: { server: true },
    });
    await audit.log({ serverId, actorId, action: 'invite.create', targetId: code, targetType: 'invite' });
    return invite;
  }

  async listInvites(serverId: string, actorId: string) {
    const ctx = await permissions.getServerContext(serverId, actorId);
    permissions.requireChannel(ctx.rolePermissions | (ctx.isOwner ? ALL_PERMISSIONS : 0n), Permissions.MANAGE_INVITES);
    return prisma.invitation.findMany({
      where: { serverId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { server: true },
    });
  }

  async revokeInvite(code: string, actorId: string) {
    const invite = await prisma.invitation.findUnique({ where: { code }, include: { server: true } });
    if (!invite) throw ApiError.notFound('Invite not found');
    const ctx = await permissions.getServerContext(invite.serverId, actorId);
    const canManage = ctx.isOwner || (ctx.rolePermissions & Permissions.MANAGE_INVITES) !== 0n;
    if (!canManage && invite.inviterId !== actorId) {
      throw ApiError.forbidden('You cannot revoke this invite');
    }
    await prisma.invitation.update({ where: { code }, data: { revokedAt: new Date() } });
    await audit.log({ serverId: invite.serverId, actorId, action: 'invite.revoke', targetId: code, targetType: 'invite' });
  }

  async previewInvite(code: string) {
    const invite = await prisma.invitation.findUnique({
      where: { code },
      include: {
        server: { include: { _count: { select: { members: true } } } },
      },
    });
    this.assertInviteUsable(invite);
    return {
      code: invite.code,
      serverId: invite.serverId,
      serverName: invite.server.name,
      serverIconUrl: invite.server.iconUrl,
      inviterName: (await prisma.user.findUnique({ where: { id: invite.inviterId } }))?.displayName ?? 'Someone',
      expiresAt: invite.expiresAt?.toISOString() ?? null,
      maxUses: invite.maxUses,
      uses: invite.uses,
    };
  }

  async joinByInvite(code: string, userId: string) {
    const invite = await prisma.invitation.findUnique({ where: { code }, include: { server: true } });
    if (!invite) throw ApiError.notFound('Invite not found');
    const existing = await prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId: invite.serverId, userId } },
    });
    if (existing) {
      // Idempotent re-join: never consumes invite uses or fails on limits.
      return { serverId: invite.serverId, alreadyMember: true };
    }
    this.assertInviteUsable(invite);
    const banned = await prisma.banEntry.findUnique({
      where: { serverId_userId: { serverId: invite.serverId, userId } },
    });
    if (banned) throw ApiError.forbidden('You are banned from this server');
    await prisma.$transaction([
      prisma.serverMember.create({ data: { serverId: invite.serverId, userId } }),
      prisma.invitation.update({ where: { id: invite.id }, data: { uses: { increment: 1 } } }),
    ]);
    await audit.log({ serverId: invite.serverId, actorId: userId, action: 'member.join', targetId: userId, targetType: 'user', metadata: { code } });
    const io = tryGetIO();
    io?.in(`user:${userId}`).socketsJoin(`server:${invite.serverId}`);
    io?.to(`server:${invite.serverId}`).emit('member:updated', {
      serverId: invite.serverId,
      userId,
      joined: true,
    });
    return { serverId: invite.serverId, alreadyMember: false };
  }

  private assertInviteUsable(
    invite: { expiresAt: Date | null; maxUses: number | null; uses: number; revokedAt: Date | null } | null,
  ): asserts invite is NonNullable<typeof invite> {
    if (!invite) throw ApiError.notFound('Invite not found');
    if (invite.revokedAt) throw ApiError.badRequest('This invite has been revoked');
    if (invite.expiresAt && invite.expiresAt < new Date()) {
      throw ApiError.badRequest('This invite has expired');
    }
    if (invite.maxUses !== null && invite.uses >= invite.maxUses) {
      throw ApiError.badRequest('This invite has reached its usage limit');
    }
  }

  // ── Roles ─────────────────────────────────────────────────────────────────

  async listRoles(serverId: string, userId: string) {
    await permissions.getServerContext(serverId, userId);
    return prisma.role.findMany({ where: { serverId }, orderBy: { position: 'desc' } });
  }

  async createRole(
    serverId: string,
    actorId: string,
    input: { name: string; permissions: string; color?: string | null },
  ) {
    const ctx = await permissions.getServerContext(serverId, actorId);
    if (!ctx.isOwner) permissions.requireChannel(ctx.rolePermissions, Permissions.MANAGE_ROLES);
    const requested = BigInt(input.permissions);
    permissions.assertCanGrantPermissions(ctx, requested);
    const maxPos = await prisma.role.aggregate({ where: { serverId }, _max: { position: true } });
    const role = await prisma.role.create({
      data: {
        serverId,
        name: input.name,
        color: input.color ?? null,
        permissions: requested,
        position: (maxPos._max.position ?? 0) + 1,
      },
    });
    await audit.log({ serverId, actorId, action: 'role.create', targetId: role.id, targetType: 'role' });
    return toRoleDTO(role);
  }

  async updateRole(
    serverId: string,
    roleId: string,
    actorId: string,
    input: { name?: string; permissions?: string; color?: string | null; position?: number },
  ) {
    const ctx = await permissions.getServerContext(serverId, actorId);
    if (!ctx.isOwner) permissions.requireChannel(ctx.rolePermissions, Permissions.MANAGE_ROLES);
    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role || role.serverId !== serverId) throw ApiError.notFound('Role not found');
    if (!ctx.isOwner && role.position >= ctx.highestRolePosition) {
      throw ApiError.forbidden('You cannot edit roles at or above your highest role');
    }
    if (input.permissions) {
      permissions.assertCanGrantPermissions(ctx, BigInt(input.permissions));
    }
    const updated = await prisma.role.update({
      where: { id: roleId },
      data: {
        name: input.name,
        color: input.color === undefined ? undefined : input.color,
        permissions: input.permissions ? BigInt(input.permissions) : undefined,
        position: input.position,
      },
    });
    await audit.log({ serverId, actorId, action: 'role.update', targetId: roleId, targetType: 'role' });
    return toRoleDTO(updated);
  }

  async deleteRole(serverId: string, roleId: string, actorId: string) {
    const ctx = await permissions.getServerContext(serverId, actorId);
    if (!ctx.isOwner) permissions.requireChannel(ctx.rolePermissions, Permissions.MANAGE_ROLES);
    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role || role.serverId !== serverId) throw ApiError.notFound('Role not found');
    if (role.isDefault) throw ApiError.badRequest('The default role cannot be deleted');
    if (!ctx.isOwner && role.position >= ctx.highestRolePosition) {
      throw ApiError.forbidden('You cannot delete roles at or above your highest role');
    }
    await prisma.role.delete({ where: { id: roleId } });
    await audit.log({ serverId, actorId, action: 'role.delete', targetId: roleId, targetType: 'role' });
  }

  async setMemberRoles(serverId: string, targetId: string, roleIds: string[], actorId: string) {
    const ctx = await permissions.getServerContext(serverId, actorId);
    if (!ctx.isOwner) permissions.requireChannel(ctx.rolePermissions, Permissions.MANAGE_ROLES);
    const member = await prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId, userId: targetId } },
      include: { roles: { include: { role: true } } },
    });
    if (!member) throw ApiError.notFound('Member not found');
    for (const roleId of roleIds) {
      await permissions.assertCanAssignRole(ctx, roleId);
    }
    await prisma.$transaction([
      prisma.memberRole.deleteMany({ where: { serverId, userId: targetId } }),
      prisma.memberRole.createMany({
        data: roleIds.map((roleId) => ({ roleId, userId: targetId, serverId })),
        skipDuplicates: true,
      }),
    ]);
    await audit.log({ serverId, actorId, action: 'member.roles_update', targetId, targetType: 'user', metadata: { roleIds } });
    tryGetIO()?.to(`server:${serverId}`).emit('member:updated', { serverId, userId: targetId, roleIds });
  }
}

export const servers = new ServerService();
