import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import fs from 'node:fs/promises';
import { db } from '@cove/db';
import { accessObject } from '../../apps/api/src/services/storage';
import { cleanupOrphanUploads } from '../../apps/api/src/workers/cleanup';
import { app } from '../../apps/api/src/app';
import { SessionClient, origin } from './helpers';
beforeAll(async () => { await db.$connect(); });
beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE'); });
afterAll(async () => { await db.$disconnect(); });

describe('authentication and sessions', () => {
  it('registers, logs in, rejects wrong credentials and CSRF, revokes sessions', async () => {
    const alice = new SessionClient(); const registration = await alice.register('Alice');
    expect(registration.body.user.passwordHash).toBeUndefined();
    expect(registration.headers['set-cookie'].join(' ')).toContain('HttpOnly');
    expect((await alice.request('get', '/auth/me')).body.user.id).toBe(alice.id);
    const unsafe = await request(app).post('/api/servers').set('Origin', origin).set('Cookie', alice.cookies).send({ name: 'No CSRF' });
    expect(unsafe.status).toBe(403); expect(unsafe.body.error.code).toBe('CSRF_FAILED');
    const wrong = await alice.request('post', '/auth/login', { email: `${alice.username}@example.test`, password: 'wrong' });
    expect(wrong.status).toBe(401); expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    const login = await alice.request('post', '/auth/login', { email: `${alice.username}@example.test`, password: 'a very strong password 123!' });
    expect(login.status).toBe(200); alice.remember(login);
    const sessions = await alice.request('get', '/auth/sessions');
    expect(sessions.body.sessions).toHaveLength(1); // Login rotated and revoked the old session.
    const logout = await alice.request('post', '/auth/logout');
    expect(logout.status).toBe(204);
    expect((await alice.request('get', '/auth/me')).status).toBe(401);
  });
});

describe('communities, invitations, permissions, search and messaging', () => {
  it('hides private channel content in lists, history, search, attachments and sockets; persists idempotent messages', async () => {
    const owner = new SessionClient(), guest = new SessionClient(), outsider = new SessionClient();
    await owner.register('Owner'); await guest.register('Guest'); await outsider.register('Outsider');
    const serverRes = await owner.request('post', '/servers', { name: 'Study Circle', description: 'Learning together' });
    expect(serverRes.status).toBe(201);
    const server = serverRes.body.server; const serverId = server.id as string;
    const general = server.channels.find((c: { name: string }) => c.name === 'general');
    expect(general).toBeDefined();
    const category = await owner.request('post', `/channels/servers/${serverId}/categories`, { name: 'Inner circle', position: 1 });
    expect(category.status).toBe(201);
    const privateChannel = await owner.request('post', `/channels/servers/${serverId}`, { name: 'private-notes', kind: 'TEXT', visibility: 'PRIVATE', categoryId: category.body.category.id });
    expect(privateChannel.status).toBe(201); const privateId = privateChannel.body.channel.id;
    const nonce = crypto.randomUUID();
    const first = await owner.request('post', `/messages/channels/${privateId}`, { content: 'private comet notebook', clientNonce: nonce, attachmentIds: [] });
    expect(first.status).toBe(201); expect(first.body.message.content).toBe('private comet notebook');
    const duplicate = await owner.request('post', `/messages/channels/${privateId}`, { content: 'private comet notebook', clientNonce: nonce, attachmentIds: [] });
    expect(duplicate.status).toBe(201); expect(duplicate.body.deduplicated).toBe(true);
    expect(duplicate.body.message.id).toBe(first.body.message.id);
    expect((await owner.request('post', `/messages/channels/${privateId}`, { content: 'different', clientNonce: nonce })).status).toBe(409);
    const invite = await owner.request('post', `/servers/${serverId}/invites`, { maxUses: 1, expiresInHours: 1 });
    expect(invite.status).toBe(201); const token = invite.body.invite.token as string;
    expect((await request(app).get(`/api/invites/${token}`)).status).toBe(200);
    const accepted = await guest.request('post', `/invites/${token}/accept`, {});
    expect(accepted.status).toBe(201);
    expect((await outsider.request('post', `/invites/${token}/accept`, {})).status).toBe(404);
    const guestView = await guest.request('get', `/servers/${serverId}`);
    expect(guestView.body.server.channels.map((c: { id: string }) => c.id)).not.toContain(privateId);
    expect((await guest.request('get', `/channels/${privateId}`)).status).toBe(404);
    expect((await guest.request('get', `/messages/channels/${privateId}`)).status).toBe(404);
    const search = await guest.request('get', `/messages/search?q=private&serverId=${serverId}`);
    expect(search.status).toBe(200); expect(search.body.results).toHaveLength(0);
    const ownerSearch = await owner.request('get', `/messages/search?q=private&serverId=${serverId}`);
    expect(ownerSearch.status).toBe(200); expect(ownerSearch.body.results[0].id).toBe(first.body.message.id);
    const second = await guest.request('post', `/messages/channels/${general.id}`, { content: `A public hello from guest @${owner.username.toLowerCase()}`, clientNonce: crypto.randomUUID() });
    expect(second.status).toBe(201);
    await vi.waitFor(async () => {
      const inbox = await owner.request('get', '/notifications');
      expect(inbox.body.notifications.find((n: { kind: string }) => n.kind === 'MENTION')?.data).toMatchObject({ serverId, channelId: general.id, messageId: second.body.message.id });
    }, { timeout: 3000 });
    expect((await owner.request('get', `/messages/channels/${general.id}`)).body.messages[0].content).toContain('A public hello from guest');
    const edit = await guest.request('patch', `/messages/${second.body.message.id}`, { content: 'An edited hello' });
    expect(edit.status).toBe(200); expect(edit.body.message.editedAt).toBeTruthy();
    const react = await owner.request('post', `/messages/${second.body.message.id}/reactions`, { emoji: '💜' });
    expect(react.status).toBe(200); expect(react.body.reactions).toHaveLength(1);
    const pin = await owner.request('post', `/messages/${second.body.message.id}/pin`, {});
    expect(pin.status).toBe(200); expect(pin.body.message.pin).toBeTruthy();
    const deletion = await owner.request('delete', `/messages/${second.body.message.id}`);
    expect(deletion.status).toBe(204);
    expect((await guest.request('get', `/messages/channels/${general.id}`)).body.messages[0].deletedAt).not.toBeNull();
    const roles = await owner.request('get', `/servers/${serverId}/roles`);
    const memberRole = roles.body.roles.find((r: { name: string }) => r.name === 'Member');
    const granted = await owner.request('put', `/channels/${privateId}/overrides`, { roleId: memberRole.id, allow: ['VIEW_CHANNEL'], deny: [] });
    expect(granted.status).toBe(200);
    expect((await guest.request('get', `/servers/${serverId}`)).body.server.channels.map((c: { id: string }) => c.id)).toContain(privateId);
    expect((await guest.request('get', `/messages/channels/${privateId}`)).body.messages[0].content).toBe('private comet notebook');
  });
});

describe('friends, conversations, files, and moderation', () => {
  it('accepts friend requests, creates one direct conversation, blocks messaging, and protects private attachments', async () => {
    const alex = new SessionClient(), sam = new SessionClient(), outsider = new SessionClient();
    await alex.register('Alex'); await sam.register('Sam'); await outsider.register('Other');
    const sent = await alex.request('post', '/social/friends/requests', { username: sam.username });
    expect(sent.status).toBe(201);
    expect((await sam.request('get', '/social/friends')).body.incoming).toHaveLength(1);
    expect((await sam.request('post', `/social/friends/requests/${sent.body.request.id}/accept`, {})).status).toBe(200);
    expect((await alex.request('get', '/social/friends')).body.friends[0].id).toBe(sam.id);
    const dm = await alex.request('post', '/social/conversations', { kind: 'DIRECT', participantIds: [sam.id] });
    expect(dm.status).toBe(201); const conversationId = dm.body.conversation.id;
    const reverse = await sam.request('post', '/social/conversations', { kind: 'DIRECT', participantIds: [alex.id] });
    expect(reverse.body.conversation.id).toBe(conversationId);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL1NwAAAABJRU5ErkJggg==', 'base64');
    const upload = await request(app).post('/api/attachments').set('Origin', origin).set('Cookie', alex.cookies).set('x-csrf-token', alex.csrf).attach('file', png, 'little.png');
    expect(upload.status).toBe(201); const attachment = upload.body.attachment;
    expect((await outsider.request('get', `/attachments/${attachment.id}`)).status).toBe(404);
    const message = await alex.request('post', `/messages/conversations/${conversationId}`, { content: 'An image for you', clientNonce: crypto.randomUUID(), attachmentIds: [attachment.id] });
    expect(message.status).toBe(201); expect(message.body.message.attachments[0].id).toBe(attachment.id);
    expect((await sam.request('get', `/attachments/${attachment.id}`)).status).toBe(200);
    expect((await outsider.request('get', `/attachments/${attachment.id}`)).status).toBe(404);
    expect((await sam.request('get', `/messages/conversations/${conversationId}`)).body.messages[0].content).toBe('An image for you');
    expect((await sam.request('get', '/notifications')).body.unreadCount).toBeGreaterThan(0);
    expect((await alex.request('post', `/social/blocks/${sam.id}`, {})).status).toBe(204);
    expect((await sam.request('post', `/messages/conversations/${conversationId}`, { content: 'bypass?', clientNonce: crypto.randomUUID() })).status).toBe(403);
    expect((await sam.request('get', `/messages/conversations/${conversationId}`)).status).toBe(403);
  });
  it('removes stale unclaimed files but preserves old message attachments, avatars and community icons', async () => {
    const owner = new SessionClient(); await owner.register('Cleaner');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL1NwAAAABJRU5ErkJggg==', 'base64');
    const upload = async () => {
      const response = await request(app).post('/api/attachments').set('Origin', origin)
        .set('Cookie', owner.cookies).set('x-csrf-token', owner.csrf).attach('file', png, 'little.png');
      expect(response.status).toBe(201);
      return response.body.attachment as { id: string; url: string };
    };
    const avatar = await upload(), icon = await upload(), claimed = await upload(), orphan = await upload();
    const orphanFile = await accessObject(await db.messageAttachment.findUniqueOrThrow({ where: { id: orphan.id } }));
    expect('localPath' in orphanFile).toBe(true);
    const server = (await owner.request('post', '/servers', { name: 'Storage Lab' })).body.server;
    expect((await owner.request('patch', '/users/me', { avatarUrl: avatar.url })).status).toBe(200);
    expect((await owner.request('patch', `/servers/${server.id}`, { iconUrl: icon.url })).status).toBe(200);
    const channelId = server.channels.find((channel: { name: string }) => channel.name === 'general').id;
    expect((await owner.request('post', `/messages/channels/${channelId}`, {
      content: 'Keep my upload', attachmentIds: [claimed.id], clientNonce: crypto.randomUUID()
    })).status).toBe(201);
    await db.messageAttachment.updateMany({ where: { id: { in: [avatar.id, icon.id, claimed.id, orphan.id] } },
      data: { createdAt: new Date(Date.now() - 3 * 86400_000) } });
    expect(await cleanupOrphanUploads()).toBe(1);
    expect(await db.messageAttachment.findUnique({ where: { id: orphan.id } })).toBeNull();
    expect((await owner.request('get', `/attachments/${orphan.id}`)).status).toBe(404);
    if ('localPath' in orphanFile) await expect(fs.access(orphanFile.localPath!)).rejects.toMatchObject({ code: 'ENOENT' });
    for (const attachment of [avatar, icon, claimed]) {
      expect(await db.messageAttachment.findUnique({ where: { id: attachment.id } })).not.toBeNull();
      expect((await owner.request('get', `/attachments/${attachment.id}`)).status).toBe(200);
    }
  });
  it('enforces owner/role hierarchy, kick, ban, timeouts and audit log access', async () => {
    const owner = new SessionClient(), member = new SessionClient(), stranger = new SessionClient();
    await owner.register('Owner'); await member.register('Member'); await stranger.register('Stranger');
    const server = (await owner.request('post', '/servers', { name: 'Neighborhood' })).body.server;
    const serverId = server.id as string;
    const invite = (await owner.request('post', `/servers/${serverId}/invites`, { maxUses: 3 })).body.invite.token;
    await member.request('post', `/invites/${invite}/accept`, {});
    expect((await member.request('post', `/channels/servers/${serverId}`, { name: 'evil', kind: 'TEXT' })).status).toBe(403);
    expect((await member.request('get', `/servers/${serverId}/audit`)).status).toBe(403);
    expect((await member.request('post', `/servers/${serverId}/members/${owner.id}/kick`, {})).status).toBe(403);
    expect((await owner.request('post', `/servers/${serverId}/members/${member.id}/timeout`, { minutes: 60 })).status).toBe(200);
    const channelId = server.channels.find((c: { name: string }) => c.name === 'general').id;
    expect((await member.request('post', `/messages/channels/${channelId}`, { content: 'Muted attempt', clientNonce: crypto.randomUUID() })).status).toBe(404);
    expect((await owner.request('post', `/servers/${serverId}/members/${member.id}/ban`, { reason: 'Repeated abuse' })).status).toBe(204);
    expect((await member.request('post', `/invites/${invite}/accept`, {})).status).toBe(403);
    expect((await owner.request('get', `/servers/${serverId}/audit`)).body.logs.some((log: { action: string }) => log.action === 'MEMBER_BANNED')).toBe(true);
    expect((await owner.request('delete', `/servers/${serverId}/bans/${member.id}`)).status).toBe(204);
    expect((await member.request('post', `/invites/${invite}/accept`, {})).status).toBe(201);
    expect((await owner.request('post', `/servers/${serverId}/members/${member.id}/kick`, { reason: 'Cleanup' })).status).toBe(204);
    expect((await member.request('get', `/servers/${serverId}`)).status).toBe(404);
    expect((await stranger.request('post', `/invites/${invite}/accept`, {})).status).toBe(201);
    expect((await owner.request('post', `/servers/${serverId}/transfer`, { userId: stranger.id })).status).toBe(200);
    expect((await owner.request('delete', `/servers/${serverId}`, { confirmName: server.name })).status).toBe(403);
    expect((await stranger.request('delete', `/servers/${serverId}`, { confirmName: 'wrong name' })).status).toBe(400);
    expect((await stranger.request('delete', `/servers/${serverId}`, { confirmName: server.name })).status).toBe(204);
    expect((await stranger.request('get', `/servers/${serverId}`)).status).toBe(404);
  });
});
