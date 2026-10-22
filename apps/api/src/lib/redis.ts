import Redis from 'ioredis';
import { config } from './config';
import { logger } from './logger';
let redis: Redis | undefined;
export function getRedis(): Redis | undefined {
  if (!config.REDIS_URL) return;
  if (!redis) {
    redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
    redis.on('error', error => logger.warn({ message: error.message }, 'Redis connection error'));
  }
  return redis;
}
export async function closeRedis() { if (redis) await redis.quit().catch(() => redis?.disconnect()); }
