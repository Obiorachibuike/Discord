import {
  ALL_PERMISSIONS,
  Permissions,
  type ModerationActionInput,
} from '@aether/shared';
import type { Prisma } from '@aether/database';
import { prisma } from '../context.js';
import { ApiError } from '../errors.js';
import { permissions } from './permission.service.js';
import { audit } from './audit.service.js';
import { tryGetIO } from '../socket/io.js';
import { notifications } from './notification.service.js';

export class ModerationService {
  async act(serverId: string, actorId: string, input: ModerationActionInput) {
    const ctx = await permissions.getServerContext(serverId, actorId);
    const required: Record<string, bigint> = {
      KICK: Permissions.KICK_MEMBERS,
      BAN: Permissions.BAN_MEMBERS,
      UNBAN: Permissions.BAN_MEMBERS,
      TIMEOUT: Permissions.MODERATE_MEMBERS,
      UNTIMEOUT: Permissions.MODERATE_MEMBERS,
    };
    const need = required[input.type];
    if (need && !ctx.isOwner) permissions.requireChannel(ctx.rolePermissions, need);

    const targetMember = await prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId, userId: input.userId } },
      include: { roles: { include: { role: true } } },
    });
    const server = await prisma.server.findUniqueOrThrow({ where: { id: serverId } });

    if (input.type !== 'UNBAN') {
      if (!targetMember) throw ApiError.notFound('Member not found');
      permissions.assertCanManageMember(ctx, {
        userId: input.userId,
        isOwner: input.userId === server.ownerId,
        highestRolePosition: targetMember.roles.reduce((m, r) => Math.max(m, r.role.position), 0),
      });
    }

    switch (input.type) {
      case 'KICK': {
        await prisma.serverMember.delete({
          where: { serverId_userId: { serverId, userId: input.userId } },
        });
        this.evict(input.userId, serverId, 'KICK');
        break;
      }
      case 'BAN': {
        await prisma.banEntry.upsert({
          where: { serverId_userId: { serverId, userId: input.userId } },
          create: { serverId, userId: input.userId, reason: input.reason, bannedById: actorId },
          update: { reason: input.reason, bannedById: actorId },
        });
        await prisma.serverMember.deleteMany({
          where: { serverId, userId: input.userId },
        });
        this.evict(input.userId, serverId, 'BAN');
        break;
      }
      case 'UNBAN': {
        const banned = await prisma.banEntry.findUnique({
          where: { serverId_userId: { serverId, userId: input.userId } },
        });
        if (!banned) throw ApiError.notFound('This user is not banned');
        await prisma.banEntry.delete({
          where: { serverId_userId: { serverId, userId: input.userId } },
        });
        break;
      }
      case 'TIMEOUT': {
        await prisma.serverMember.update({
          where: { serverId_userId: { serverId, userId: input.userId } },
          data: { timeoutUntil: new Date(Date.now() + input.durationMinutes * 60_000) },
        });
        tryGetIO()?.to(`server:${serverId}`).emit('member:updated', {
          serverId,
          userId: input.userId,
          timeoutUntil: new Date(Date.now() + input.durationMinutes * 60_000).toISOString(),
        });
        break;
      }
      case 'UNTIMEOUT': {
        await prisma.serverMember.update({
          where: { serverId_userId: { serverId, userId: input.userId } },
          data: { timeoutUntil: null },
        });
        tryGetIO()?.to(`server:${serverId}`).emit('member:updated', {
          serverId,
          userId: input.userId,
          timeoutUntil: null,
        });
        break;
      }
    }

    await prisma.moderationAction.create({
      data: {
        serverId,
        actorId,
        targetUserId: input.userId,
        type: input.type,
        reason: input.reason,
        metadata:
        input.type === 'TIMEOUT'
          ? ({ durationMinutes: input.durationMinutes } as Prisma.InputJsonValue)
          : ({} as Prisma.InputJsonValue),
      },
    });
    await audit.log({
      serverId,
      actorId,
      action: `moderation.${input.type.toLowerCase()}`,
      targetId: input.userId,
      targetType: 'user',
      metadata: { reason: input.reason },
    });
    await notifications.push({
      userId: input.userId,
      type: 'MODERATION',
      title: `Moderation action: ${input.type}`,
      body: input.reason ?? `You were ${input.type.toLowerCase()}ed in a server`,
      data: { serverId, type: input.type },
    });
  }

  private evict(userId: string, serverId: string, type: string) {
    const io = tryGetIO();
    io?.to(`user:${userId}`).emit('moderation:update', { type, serverId });
    io?.in(`user:${userId}`).socketsLeave(`server:${serverId}`);
  }

  history(serverId: string, actorId: string, limit = 50) {
    return permissions.getServerContext(serverId, actorId).then(async (ctx) => {
      if (!ctx.isOwner) permissions.requireChannel(ctx.rolePermissions | ALL_PERMISSIONS, Permissions.VIEW_AUDIT_LOG);
      return prisma.moderationAction.findMany({
        where: { serverId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    });
  }

  async report(input: {
    reporterId: string;
    serverId?: string | null;
    reportedUserId?: string | null;
    messageId?: string | null;
    reason: string;
  }) {
    if (!input.reportedUserId && !input.messageId) {
      throw ApiError.badRequest('Report a user or a message');
    }
    let serverId = input.serverId ?? null;
    if (input.messageId) {
      const msg = await prisma.message.findUnique({
        where: { id: input.messageId },
        include: { channel: true },
      });
      if (!msg) throw ApiError.notFound('Message not found');
      // Derive the server from the message when not provided explicitly.
      serverId = serverId ?? msg.channel?.serverId ?? null;
    }
    return prisma.moderationReport.create({
      data: {
        serverId,
        reporterId: input.reporterId,
        reportedUserId: input.reportedUserId ?? null,
        messageId: input.messageId ?? null,
        reason: input.reason,
      },
    });
  }

  async listReports(serverId: string, actorId: string) {
    const ctx = await permissions.getServerContext(serverId, actorId);
    if (!ctx.isOwner) permissions.requireChannel(ctx.rolePermissions, Permissions.MANAGE_MEMBERS);
    return prisma.moderationReport.findMany({
      where: { serverId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async reviewReport(
    reportId: string,
    actorId: string,
    input: { status: 'RESOLVED' | 'DISMISSED'; note?: string },
  ) {
    const report = await prisma.moderationReport.findUnique({ where: { id: reportId } });
    if (!report) throw ApiError.notFound('Report not found');
    if (report.serverId) {
      const ctx = await permissions.getServerContext(report.serverId, actorId);
      if (!ctx.isOwner) permissions.requireChannel(ctx.rolePermissions, Permissions.MANAGE_MEMBERS);
    }
    return prisma.moderationReport.update({
      where: { id: reportId },
      data: {
        status: input.status,
        reviewNote: input.note,
        reviewedById: actorId,
      },
    });
  }

  async auditLog(serverId: string, actorId: string) {
    const ctx = await permissions.getServerContext(serverId, actorId);
    if (!ctx.isOwner) permissions.requireChannel(ctx.rolePermissions, Permissions.VIEW_AUDIT_LOG);
    return audit.list(serverId);
  }
}

export const moderation = new ModerationService();
