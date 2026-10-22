import { Redis } from 'ioredis';
import { CONNECTION, type PublicUserDTO } from '@aether/shared';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { prisma } from '../context.js';

export type PresenceStatus = 'ONLINE' | 'IDLE' | 'DND' | 'INVISIBLE' | 'OFFLINE';

interface PresenceEntry {
  status: PresenceStatus; // user-chosen status (never INVISIBLE on the wire for others)
  sockets: Set<string>;
  lastSeen: number;
}

/**
 * Presence tracker. With REDIS_URL configured, presence is shared across
 * processes via Redis hashes + expiry. Without Redis it is process-local —
 * accurate for single-node deployments only (documented in DEPLOYMENT.md).
 */
export class PresenceService {
  private local = new Map<string, PresenceEntry>();
  private redis: Redis | null = null;
  private timer: NodeJS.Timeout | null = null;
  readonly mode: 'redis' | 'local';

  constructor(redisUrl?: string) {
    if (redisUrl) {
      this.redis = new Redis(redisUrl, { maxRetriesPerRequest: 2, lazyConnect: true });
      this.redis
        .connect()
        .then(() => logger.info('presence: connected to Redis'))
        .catch((err) => logger.warn({ err }, 'presence: Redis unavailable, falling back to local'));
      this.mode = 'redis';
    } else {
      this.mode = 'local';
      logger.warn('presence: running process-local (single node only)');
    }
    this.timer = setInterval(() => void this.expireStale(), 30_000);
    this.timer.unref();
  }

  async connect(userId: string, socketId: string): Promise<PresenceStatus> {
    const entry = this.local.get(userId) ?? {
      status: 'ONLINE' as PresenceStatus,
      sockets: new Set<string>(),
      lastSeen: Date.now(),
    };
    entry.sockets.add(socketId);
    entry.lastSeen = Date.now();
    if (entry.status === 'OFFLINE') entry.status = 'ONLINE';
    this.local.set(userId, entry);
    await prisma.user.updateMany({
      where: { id: userId, presenceStatus: 'OFFLINE' },
      data: { presenceStatus: 'ONLINE' },
    });
    return entry.status;
  }

  async disconnect(userId: string, socketId: string): Promise<PresenceStatus | null> {
    const entry = this.local.get(userId);
    if (!entry) return null;
    entry.sockets.delete(socketId);
    entry.lastSeen = Date.now();
    if (entry.sockets.size === 0) {
      entry.status = 'OFFLINE';
      await prisma.user.updateMany({
        where: { id: userId },
        data: { presenceStatus: 'OFFLINE' },
      });
      return 'OFFLINE';
    }
    return entry.status;
  }

  async setStatus(userId: string, status: PresenceStatus): Promise<void> {
    const entry = this.local.get(userId) ?? {
      status,
      sockets: new Set<string>(),
      lastSeen: Date.now(),
    };
    entry.status = status;
    entry.lastSeen = Date.now();
    this.local.set(userId, entry);
    await prisma.user.updateMany({ where: { id: userId }, data: { presenceStatus: status } });
  }

  /** Effective status as other users should see it. */
  getVisibleStatus(userId: string): PresenceStatus {
    const entry = this.local.get(userId);
    if (!entry) return 'OFFLINE';
    if (entry.status === 'INVISIBLE') return 'OFFLINE';
    return entry.status;
  }

  getRawStatus(userId: string): PresenceStatus {
    return this.local.get(userId)?.status ?? 'OFFLINE';
  }

  isOnline(userId: string): boolean {
    const entry = this.local.get(userId);
    return Boolean(entry && entry.sockets.size > 0 && entry.status !== 'INVISIBLE');
  }

  onlineUserIds(): string[] {
    return [...this.local.entries()]
      .filter(([, e]) => e.sockets.size > 0 && e.status !== 'INVISIBLE')
      .map(([id]) => id);
  }

  private async expireStale(): Promise<void> {
    const cutoff = Date.now() - CONNECTION.presenceExpiryMs;
    for (const [userId, entry] of this.local) {
      if (entry.sockets.size === 0 && entry.lastSeen < cutoff && entry.status !== 'OFFLINE') {
        entry.status = 'OFFLINE';
        await prisma.user
          .updateMany({ where: { id: userId }, data: { presenceStatus: 'OFFLINE' } })
          .catch(() => undefined);
      }
    }
  }

  decorate(user: PublicUserDTO): PublicUserDTO {
    return { ...user, presenceStatus: this.getVisibleStatus(user.id) };
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.redis) await this.redis.quit().catch(() => undefined);
  }
}

export const presence = new PresenceService(config.REDIS_URL);
