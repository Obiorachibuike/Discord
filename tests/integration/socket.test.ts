import { createServer, request as httpRequest, type Server as HttpServer } from 'node:http';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { db } from '@cove/db';
import { app } from '../../apps/api/src/app';
import { createSocketServer } from '../../apps/api/src/socket';
import { SessionClient, origin } from './helpers';
let server: HttpServer; let ioServer: Awaited<ReturnType<typeof createSocketServer>>['io']; let url = '';
const sockets: Socket[] = [];
async function connect(client?: SessionClient): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(url, { path: '/socket.io', transports: ['polling','websocket'], withCredentials: true, reconnection: false,
      extraHeaders: { Origin: origin, ...(client ? { Cookie: client.cookies } : {}) } });
    sockets.push(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}
async function ack(socket: Socket, name: string, payload: unknown): Promise<{ ok: boolean; error?: { code: string }; data?: any }> {
  return new Promise((resolve, reject) => socket.timeout(5000).emit(name, payload, (error: Error, data: any) => error ? reject(error) : resolve(data)));
}
function event(socket: Socket, name: string) { return new Promise<any>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`${name} did not arrive`)), 5000);
  socket.once(name, (...args: any[]) => { clearTimeout(timeout); resolve(args[0]); });
}); }
beforeAll(async () => {
  await db.$connect(); server = createServer(app); const sockets = await createSocketServer(server); ioServer = sockets.io;
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (typeof address !== 'object' || !address) throw new Error('Socket server failed to bind');
  url = `http://127.0.0.1:${address.port}`;
});
beforeEach(async () => { for (const socket of sockets.splice(0)) socket.disconnect(); await db.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE'); });
afterAll(async () => { for (const socket of sockets) socket.disconnect(); await new Promise<void>(resolve => ioServer.close(() => resolve())); await db.$disconnect(); });
describe('Socket.IO authorization and delivery', () => {
  it('rejects connections without valid HTTP-only session cookies', async () => { await expect(connect()).rejects.toThrow('UNAUTHENTICATED'); });
  it('rejects cross-origin WebSocket upgrades even when a valid session cookie is supplied', async () => {
    const client = new SessionClient(); await client.register('OriginGuard');
    const handshake = (testOrigin: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = httpRequest(`${url}/socket.io/?EIO=4&transport=websocket`, { headers: {
        Origin: testOrigin, Cookie: client.cookies, Connection: 'Upgrade', Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': Buffer.from('0123456789abcdef').toString('base64')
      } });
      req.on('response', response => { let body = ''; response.setEncoding('utf8'); response.on('data', chunk => body += chunk); response.on('end', () => resolve({ status: response.statusCode!, body })); });
      req.on('upgrade', (_response, socket) => { socket.destroy(); resolve({ status: 101, body: '' }); });
      req.on('error', reject); req.end();
    });
    const denied = await handshake('https://untrusted.example');
    expect(denied.status).toBe(400); // Engine.IO's allowRequest rejection status.
    expect(denied.body).toContain('ORIGIN_DENIED');
    expect((await handshake(origin)).status).toBe(101);
  });
  it('delivers persisted messages only to subscribed authorized users; typing is ephemeral, retries deduplicate, reconnect resubscribes', async () => {
    const owner = new SessionClient(), guest = new SessionClient(); await owner.register('SocketOwner'); await guest.register('SocketGuest');
    const serverId = (await owner.request('post', '/servers', { name: 'Real Time Lab' })).body.server.id;
    const channelId = (await owner.request('get', `/servers/${serverId}`)).body.server.channels.find((c: { name: string }) => c.name === 'general').id;
    const privateId = (await owner.request('post', `/channels/servers/${serverId}`, { name: 'restricted', visibility: 'PRIVATE', kind: 'TEXT' })).body.channel.id;
    const token = (await owner.request('post', `/servers/${serverId}/invites`, { maxUses: 2 })).body.invite.token;
    await guest.request('post', `/invites/${token}/accept`, {});
    const sender = await connect(owner), receiver = await connect(guest);
    expect((await ack(receiver, 'channel:subscribe', { channelId: privateId })).error?.code).toBe('NOT_FOUND');
    expect((await ack(receiver, 'channel:subscribe', { channelId })).ok).toBe(true);
    expect((await ack(sender, 'channel:subscribe', { channelId })).ok).toBe(true);
    const delivered = event(receiver, 'message:created');
    const clientNonce = crypto.randomUUID();
    const first = await ack(sender, 'message:send', { target: { channelId }, message: { content: 'Synchronized across sockets', clientNonce, attachmentIds: [] } });
    expect(first.ok).toBe(true); expect(first.data.message.content).toBe('Synchronized across sockets');
    expect((await delivered).id).toBe(first.data.message.id);
    const retry = await ack(sender, 'message:send', { target: { channelId }, message: { content: 'Synchronized across sockets', clientNonce, attachmentIds: [] } });
    expect(retry.ok).toBe(true); expect(retry.data.deduplicated).toBe(true);
    expect(await db.message.count({ where: { channelId, clientNonce } })).toBe(1);
    // Do not persist ephemeral typing in the messages table.
    const typing = event(receiver, 'typing:updated');
    await new Promise(resolve => setTimeout(resolve, 710));
    expect((await ack(sender, 'typing:set', { target: { channelId }, typing: true })).ok).toBe(true);
    expect((await typing).userId).toBe(owner.id);
    expect(await db.message.count({ where: { channelId } })).toBe(1);
    receiver.disconnect();
    const reconnected = await connect(guest);
    expect((await ack(reconnected, 'channel:subscribe', { channelId })).ok).toBe(true);
    const afterReconnection = event(reconnected, 'message:created');
    await ack(sender, 'message:send', { target: { channelId }, message: { content: 'Back again', clientNonce: crypto.randomUUID(), attachmentIds: [] } });
    expect((await afterReconnection).content).toBe('Back again');
    expect((await ack(reconnected, 'message:send', { target: { channelId: privateId }, message: { content: 'Should fail', clientNonce: crypto.randomUUID() } })).ok).toBe(false);
    sender.disconnect(); reconnected.disconnect();
  });
  it('removes subscriptions when membership is revoked', async () => {
    const owner = new SessionClient(), guest = new SessionClient(); await owner.register('ModSocket'); await guest.register('GuestSocket');
    const serverId = (await owner.request('post', '/servers', { name: 'Moderated Room' })).body.server.id;
    const channelId = (await owner.request('get', `/servers/${serverId}`)).body.server.channels[0].id;
    const token = (await owner.request('post', `/servers/${serverId}/invites`, { maxUses: 3 })).body.invite.token;
    await guest.request('post', `/invites/${token}/accept`, {});
    const socket = await connect(guest); expect((await ack(socket, 'channel:subscribe', { channelId })).ok).toBe(true);
    const closed = event(socket, 'disconnect');
    expect((await owner.request('post', `/servers/${serverId}/members/${guest.id}/kick`, {})).status).toBe(204);
    await closed;
    const again = await connect(guest);
    expect((await ack(again, 'channel:subscribe', { channelId })).error?.code).toBe('NOT_FOUND');
    again.disconnect();
  });
});
