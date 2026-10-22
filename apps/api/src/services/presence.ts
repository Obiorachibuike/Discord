import { db } from '@cove/db';
import { getRedis } from '../lib/redis';
import { emitRoom, emitUser } from './notifications';
// Without Redis this tracks connections ONLY in this API process. Documented single-instance mode.
const local = new Map<string, Set<string>>();
export async function setPresenceConnection(userId: string, socketId: string, active: boolean) {
  const redis = getRedis();
  if (redis) {
    const key = `presence:user:${userId}`;
    const pipeline = redis.multi();
    pipeline.zremrangebyscore(key, 0, Date.now() - 75_000);
    if (active) pipeline.zadd(key, Date.now(), socketId);
    else pipeline.zrem(key, socketId);
    pipeline.expire(key, 90);
    await pipeline.exec();
  } else {
    const sockets = local.get(userId) ?? new Set();
    if (active) sockets.add(socketId); else sockets.delete(socketId);
    if (sockets.size) local.set(userId, sockets); else local.delete(userId);
  }
  await broadcastPresence(userId);
}
export async function isConnected(userId: string) {
  const redis = getRedis();
  if (redis) {
    const key = `presence:user:${userId}`;
    await redis.zremrangebyscore(key, 0, Date.now() - 75_000);
    return (await redis.zcard(key)) > 0;
  }
  return (local.get(userId)?.size ?? 0) > 0;
}
export async function visiblePresence(userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { presence: true } });
  if (!user || user.presence === 'INVISIBLE' || user.presence === 'OFFLINE' || !await isConnected(userId)) return 'OFFLINE';
  return user.presence;
}
export async function broadcastPresence(userId: string) {
  const presence = await visiblePresence(userId);
  const memberships = await db.serverMember.findMany({ where: { userId }, select: { serverId: true } });
  for (const member of memberships) emitRoom(`server:${member.serverId}`, 'presence:updated', { userId, presence });
  const friendships = await db.friendship.findMany({ where: { status: 'ACCEPTED', OR: [{ requesterId: userId }, { recipientId: userId }] }, select: { requesterId: true, recipientId: true } });
  for (const friend of friendships) emitUser(friend.requesterId === userId ? friend.recipientId : friend.requesterId, 'presence:updated', { userId, presence });
}
