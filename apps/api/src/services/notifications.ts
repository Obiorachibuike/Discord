import { db, NotificationKind, Prisma } from '@cove/db';
import type { Server } from 'socket.io';
let io: Server | undefined;
export function setNotificationIO(server: Server) { io = server; }
export function emitUser(userId: string, event: string, data: unknown) { io?.to(`user:${userId}`).emit(event, data); }
export function disconnectUser(userId: string) { io?.in(`user:${userId}`).disconnectSockets(true); }
export function disconnectServer(serverId: string) { io?.in(`server:${serverId}`).disconnectSockets(true); }
export async function revokeSessionSockets(userId: string, sessionId: string) {
  for (const socket of await io?.in(`user:${userId}`).fetchSockets() || []) {
    if (socket.data.sessionId === sessionId) { socket.emit('session:revoked', { sessionId }); socket.disconnect(true); }
  }
}
export function revokeUserSockets(userId: string) { io?.in(`user:${userId}`).emit('session:revoked', { all: true }); io?.in(`user:${userId}`).disconnectSockets(true); }
export function emitRoom(room: string, event: string, data: unknown) { io?.to(room).emit(event, data); }
export async function notify(userId: string, kind: NotificationKind, data: Prisma.InputJsonValue, actorId?: string, dedupeKey?: string) {
  if (userId === actorId) return;
  const prefs = await db.user.findUnique({ where: { id: userId }, select: { notifyDMs: true, notifyMentions: true, notifyFriends: true } });
  if ((kind === 'DIRECT_MESSAGE' && !prefs?.notifyDMs) || (kind === 'MENTION' && !prefs?.notifyMentions) || (kind.startsWith('FRIEND_') && !prefs?.notifyFriends)) return;
  let notification;
  if (dedupeKey) {
    const created = await db.notification.createMany({ data: [{ userId, actorId, kind, data, dedupeKey }], skipDuplicates: true });
    if (!created.count) return null;
    notification = await db.notification.findUnique({ where: { dedupeKey } });
  } else notification = await db.notification.create({ data: { userId, actorId, kind, data } });
  if (notification) emitUser(userId, 'notification:new', notification);
  return notification;
}
