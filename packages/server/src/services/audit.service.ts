import type { Prisma } from '@aether/database';
import { prisma } from '../context.js';

export class AuditService {
  log(entry: {
    serverId?: string | null;
    actorId: string;
    action: string;
    targetId?: string | null;
    targetType?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    return prisma.auditLog.create({
      data: {
        serverId: entry.serverId ?? null,
        actorId: entry.actorId,
        action: entry.action,
        targetId: entry.targetId ?? null,
        targetType: entry.targetType ?? null,
        metadata: (entry.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  list(serverId: string, limit = 50) {
    return prisma.auditLog.findMany({
      where: { serverId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}

export const audit = new AuditService();
