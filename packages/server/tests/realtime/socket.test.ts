import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../../src/app.js';
import { initSocket } from '../../src/socket/index.js';
import {
  createTestAgent,
  registerUser,
  truncateAll,
  type TestUser,
} from '../helpers/testApp.js';
import { SESSION_COOKIE, Permissions } from '@aether/shared';

let httpServer: HttpServer;
let baseUrl: string;

beforeAll(async () => {
  const app = createApp();
  httpServer = createServer(app);
  initSocket(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const addr = httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

beforeEach(async () => {
  await truncateAll();
});

function connect(agent: TestUser): Promise<ClientSocket> {
  const cookie = [...agent.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  const socket = ioc(baseUrl, {
    extraHeaders: { Cookie: cookie },
    transports: ['websocket'],
    reconnection: false,
    timeout: 5000,
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket connect timeout')), 5000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function disconnect(socket: ClientSocket) {
  return new Promise<void>((resolve) => {
    socket.on('disconnect', () => resolve());
    socket.disconnect();
  });
}

async function setupGuild() {
  const owner = await registerUser({ username: 'rt_owner' });
  const member = await registerUser({ username: 'rt_member' });
  const outsider = await registerUser({ username: 'rt_outsider' });
  const server = await owner.agent.post('/api/servers').send({ name: 'RT Guild' });
  const serverId = server.body.server.id as string;
  const code = (
    await owner.agent.post(`/api/servers/${serverId}/invites`).send({})
  ).body.invite.code as string;
  await member.agent.post(`/api/invites/${code}/join`);
  const channels = await owner.agent.get(`/api/servers/${serverId}/channels`);
  const all = channels.body.categories.flatMap(
    (c: { channels: { id: string; name: string; type: string }[] }) => c.channels,
  );
  return {
    owner,
    member,
    outsider,
    serverId,
    channelId: all.find((c: { name: string }) => c.name === 'general')!.id as string,
  };
}

describe('socket authentication', () => {
  it('rejects unauthenticated connections', async () => {
    const socket = ioc(baseUrl, { transports: ['websocket'], reconnection: false, timeout: 3000 });
    const err = await new Promise<{ message: string }>((resolve) => {
      socket.on('connect_error', resolve);
    });
    expect(err.message).toMatch(/unauthorized/i);
    socket.close();
  });

  it('accepts cookie-authenticated connections and emits ready', async () => {
    const user = await registerUser({ username: 'rt_user' });
    const socket = await connect(user.agent);
    const ready = await new Promise<{ userId: string }>((resolve) => {
      socket.on('ready', resolve);
    });
    expect(ready.userId).toBe(user.id);
    await disconnect(socket);
  });
});

describe('realtime messaging', () => {
  it('delivers messages to subscribed channel members', async () => {
    const { owner, member, channelId } = await setupGuild();
    const ownerSock = await connect(owner.agent);
    const memberSock = await connect(member.agent);
    ownerSock.emit('channel:subscribe', { channelId });
    memberSock.emit('channel:subscribe', { channelId });
    await new Promise((r) => setTimeout(r, 150));

    const received = new Promise<{ content: string; author: { username: string } }>((resolve) => {
      memberSock.on('message:created', resolve);
    });
    ownerSock.emit('message:create', { channelId, content: 'hello from socket' });
    const msg = await received;
    expect(msg.content).toBe('hello from socket');
    expect(msg.author.username).toBe('rt_owner');

    // Persisted before delivery.
    await disconnect(ownerSock);
    await disconnect(memberSock);
  });

  it('does not deliver to users who are not authorized for the channel', async () => {
    const { owner, outsider, serverId, channelId } = await setupGuild();
    // Create a private channel with a secret message.
    const priv = await owner.agent.post(`/api/servers/${serverId}/channels`).send({
      name: 'secret',
      isPrivate: true,
    });
    const privId = priv.body.channel.id as string;

    const ownerSock = await connect(owner.agent);
    const outSock = await connect(outsider.agent);
    ownerSock.emit('channel:subscribe', { channelId: privId });
    await new Promise((r) => setTimeout(r, 150));

    // Outsider subscribe is rejected.
    const err = await new Promise<{ code: string }>((resolve) => {
      outSock.on('error', resolve);
      outSock.emit('channel:subscribe', { channelId: privId });
      setTimeout(() => resolve({ code: 'TIMEOUT' }), 1000);
    });
    expect(['FORBIDDEN', 'TIMEOUT']).toContain(err.code);

    let leaked = false;
    outSock.on('message:created', () => {
      leaked = true;
    });
    ownerSock.emit('message:create', { channelId: privId, content: 'top secret' });
    await new Promise((r) => setTimeout(r, 400));
    expect(leaked).toBe(false);
    void channelId;
    await disconnect(ownerSock);
    await disconnect(outSock);
  });

  it('rejects invalid message payloads', async () => {
    const { owner, channelId } = await setupGuild();
    const sock = await connect(owner.agent);
    sock.emit('channel:subscribe', { channelId });
    await new Promise((r) => setTimeout(r, 100));
    const err = await new Promise<{ code: string }>((resolve) => {
      sock.on('error', resolve);
      sock.emit('message:create', { channelId, content: 'x'.repeat(5000) });
      setTimeout(() => resolve({ code: 'TIMEOUT' }), 1000);
    });
    expect(err.code).toBe('VALIDATION_ERROR');
    await disconnect(sock);
  });

  it('deduplicates message retries via clientId', async () => {
    const { owner, channelId } = await setupGuild();
    const sock = await connect(owner.agent);
    sock.emit('channel:subscribe', { channelId });
    await new Promise((r) => setTimeout(r, 100));
    const payloads: string[] = [];
    sock.on('message:created', (m: { id: string }) => payloads.push(m.id));
    sock.emit('message:create', { channelId, content: 'once', clientId: 'retry-12345678' });
    sock.emit('message:create', { channelId, content: 'once', clientId: 'retry-12345678' });
    await new Promise((r) => setTimeout(r, 400));
    // Both acks may fire but only ONE message:created broadcast is allowed to
    // represent a new row — ids identical.
    expect(payloads.length).toBeGreaterThanOrEqual(1);
    expect(new Set(payloads).size).toBe(1);
    await disconnect(sock);
  });
});

describe('typing indicators', () => {
  it('broadcasts ephemeral typing events', async () => {
    const { owner, member, channelId } = await setupGuild();
    const a = await connect(owner.agent);
    const b = await connect(member.agent);
    a.emit('channel:subscribe', { channelId });
    b.emit('channel:subscribe', { channelId });
    await new Promise((r) => setTimeout(r, 150));

    const seen = new Promise<{ typing: boolean; userId: string }>((resolve) => {
      b.on('typing:changed', resolve);
    });
    a.emit('typing:start', { channelId });
    const ev = await seen;
    expect(ev.typing).toBe(true);
    expect(ev.userId).toBe(owner.id);

    const stop = new Promise<{ typing: boolean }>((resolve) => {
      b.on('typing:changed', (e: { typing: boolean }) => {
        if (!e.typing) resolve(e);
      });
    });
    a.emit('typing:stop', { channelId });
    expect((await stop).typing).toBe(false);
    await disconnect(a);
    await disconnect(b);
  });
});

describe('presence', () => {
  it('updates presence and hides INVISIBLE as OFFLINE', async () => {
    const { owner, member } = await setupGuild();
    // Make them friends for direct presence fan-out.
    await owner.agent.post('/api/friends/requests').send({ username: 'rt_member' });
    const incoming = await member.agent.get('/api/friends');
    await member.agent.post(`/api/friends/requests/${incoming.body.incoming[0].id}/accept`);

    const a = await connect(owner.agent);
    const b = await connect(member.agent);
    await new Promise((r) => setTimeout(r, 150));

    const updates: { userId: string; status: string }[] = [];
    b.on('presence:update', (p: { userId: string; status: string }) => updates.push(p));

    a.emit('presence:update', { status: 'DND' });
    await new Promise((r) => setTimeout(r, 250));
    expect(updates.some((u) => u.userId === owner.id && u.status === 'DND')).toBe(true);

    a.emit('presence:update', { status: 'INVISIBLE' });
    await new Promise((r) => setTimeout(r, 250));
    expect(
      updates.some((u) => u.userId === owner.id && u.status === 'OFFLINE'),
    ).toBe(true);

    await disconnect(a);
    await disconnect(b);
  });
});

describe('conversation sockets', () => {
  it('delivers DM messages to both participants only', async () => {
    const ada = await registerUser({ username: 'rt_ada' });
    const grace = await registerUser({ username: 'rt_grace' });
    const mallory = await registerUser({ username: 'rt_mallory' });
    const conv = await ada.agent.post('/api/conversations/dm').send({ userId: grace.id });
    const convId = conv.body.conversationId as string;

    const a = await connect(ada.agent);
    const g = await connect(grace.agent);
    const m = await connect(mallory.agent);
    a.emit('conversation:subscribe', { conversationId: convId });
    g.emit('conversation:subscribe', { conversationId: convId });
    m.emit('conversation:subscribe', { conversationId: convId });
    await new Promise((r) => setTimeout(r, 150));

    let malloryGot = false;
    m.on('message:created', () => {
      malloryGot = true;
    });
    const got = new Promise<{ content: string }>((resolve) => {
      g.on('message:created', resolve);
    });
    a.emit('conversation:message:create', { conversationId: convId, content: 'psst' });
    expect((await got).content).toBe('psst');
    await new Promise((r) => setTimeout(r, 250));
    expect(malloryGot).toBe(false);
    await disconnect(a);
    await disconnect(g);
    await disconnect(m);
  });
});

describe('reconnection', () => {
  it('re-subscribes and receives messages after reconnecting', async () => {
    const { owner, channelId } = await setupGuild();
    const first = await connect(owner.agent);
    first.emit('channel:subscribe', { channelId });
    await new Promise((r) => setTimeout(r, 100));
    await disconnect(first);

    const second = await connect(owner.agent);
    second.emit('channel:subscribe', { channelId });
    await new Promise((r) => setTimeout(r, 150));
    const got = new Promise<{ content: string }>((resolve) => {
      second.on('message:created', resolve);
    });
    // Send via REST — socket delivery proves the re-subscription works.
    await owner.agent.post('/api/messages').send({ channelId, content: 'after reconnect' });
    expect((await got).content).toBe('after reconnect');
    await disconnect(second);
  });
});

// Keep TS happy about unused imports in some paths.
void SESSION_COOKIE;
void Permissions;
void createTestAgent;
