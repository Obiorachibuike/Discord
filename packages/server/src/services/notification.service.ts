import type { NotificationDTO } from '@aether/shared';
import type { Prisma } from '@aether/database';
import { prisma } from '../context.js';
import { toNotificationDTO } from '../utils/dto.js';
import { getIO } from '../socket/io.js';

export class NotificationService {
  async push(input: {
    userId: string;
    type: NotificationDTO['type'];
    title: string;
    body: string;
    data?: Record<string, unknown>;
  }) {
    // Suppress floods: skip duplicate unread notifications of same type+target.
    const recent = await prisma.notification.findFirst({
      where: {
        userId: input.userId,
        type: input.type,
        readAt: null,
        createdAt: { gt: new Date(Date.now() - 60_000) },
        data: { equals: (input.data ?? {}) as Prisma.InputJsonValue },
      },
    });
    if (recent) return null;
    const n = await prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: (input.data ?? {}) as Prisma.InputJsonValue,
      },
    });
    try {
      getIO().to(`user:${input.userId}`).emit('notification:new', toNotificationDTO(n));
    } catch {
      /* socket server not started (unit tests) */
    }
    return n;
  }

  list(userId: string, limit = 50) {
    return prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  unreadCount(userId: string) {
    return prisma.notification.count({ where: { userId, readAt: null } });
  }

  async markRead(userId: string, id: string) {
    await prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(userId: string) {
    await prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }
}

export const notifications = new NotificationService();
