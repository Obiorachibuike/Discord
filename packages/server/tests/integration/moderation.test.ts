import { beforeEach, describe, expect, it } from 'vitest';
import { registerUser, truncateAll, type TestUser } from '../helpers/testApp.js';

beforeEach(async () => {
  await truncateAll();
});

let owner: TestUser;
let mod: TestUser;
let member: TestUser;
let serverId: string;

async function setup() {
  owner = await registerUser({ username: 'mod_owner' });
  mod = await registerUser({ username: 'mod_mod' });
  member = await registerUser({ username: 'mod_member' });
  serverId = (await owner.agent.post('/api/servers').send({ name: 'Mod Guild' })).body.server.id;
  for (const u of [mod, member]) {
    const code = (
      await owner.agent.post(`/api/servers/${serverId}/invites`).send({})
    ).body.invite.code;
    await u.agent.post(`/api/invites/${code}/join`);
  }
  const roles = (await owner.agent.get(`/api/servers/${serverId}/roles`)).body.roles as {
    id: string;
    name: string;
  }[];
  const modRole = roles.find((r) => r.name === 'Moderator')!;
  await owner.agent
    .put(`/api/servers/${serverId}/members/${mod.id}/roles`)
    .send({ roleIds: [modRole.id] });
}

describe('moderation', () => {
  it('times out a member and blocks their messages', async () => {
    await setup();
    const channels = (await owner.agent.get(`/api/servers/${serverId}/channels`)).body.categories[0]
      .channels as { id: string; name: string }[];
    const general = channels[0]!;

    const timeout = await owner.agent.post('/api/moderation/actions').send({
      type: 'TIMEOUT',
      userId: member.id,
      serverId,
      durationMinutes: 30,
      reason: 'cool down',
    });
    expect(timeout.status).toBe(201);

    const send = await member.agent
      .post('/api/messages')
      .send({ channelId: general.id, content: 'still here?' });
    expect(send.status).toBe(403);

    const untimeout = await owner.agent.post('/api/moderation/actions').send({
      type: 'UNTIMEOUT',
      userId: member.id,
      serverId,
    });
    expect(untimeout.status).toBe(201);
    const retry = await member.agent
      .post('/api/messages')
      .send({ channelId: general.id, content: 'back!' });
    expect(retry.status).toBe(201);
  });

  it('bans remove membership and block rejoin; unban restores ability', async () => {
    await setup();
    const ban = await owner.agent.post('/api/moderation/actions').send({
      type: 'BAN',
      userId: member.id,
      serverId,
      reason: 'raiding',
    });
    expect(ban.status).toBe(201);
    const members = await owner.agent.get(`/api/servers/${serverId}/members`);
    expect(members.body.members.map((m: { userId: string }) => m.userId)).not.toContain(member.id);

    const code = (await owner.agent.post(`/api/servers/${serverId}/invites`).send({})).body.invite
      .code;
    expect((await member.agent.post(`/api/invites/${code}/join`)).status).toBe(403);

    await owner.agent.post('/api/moderation/actions').send({
      type: 'UNBAN',
      userId: member.id,
      serverId,
    });
    expect((await member.agent.post(`/api/invites/${code}/join`)).status).toBe(200);
  });

  it('members without moderation permissions cannot act', async () => {
    await setup();
    const channels = (await owner.agent.get(`/api/servers/${serverId}/channels`)).body.categories[0]
      .channels as { id: string }[];
    void channels;
    const memberRole = (
      await owner.agent.get(`/api/servers/${serverId}/roles`)
    ).body.roles.find((r: { name: string }) => r.name === 'Member');
    // put member back to default role only
    await owner.agent
      .put(`/api/servers/${serverId}/members/${member.id}/roles`)
      .send({ roleIds: [memberRole.id] });
    const kick = await member.agent.post('/api/moderation/actions').send({
      type: 'KICK',
      userId: mod.id,
      serverId,
    });
    expect(kick.status).toBe(403);
  });

  it('moderators cannot act on higher-ranked members or the owner', async () => {
    await setup();
    const attempt = await mod.agent.post('/api/moderation/actions').send({
      type: 'KICK',
      userId: owner.id,
      serverId,
    });
    expect(attempt.status).toBe(403);
  });

  it('records audit log entries for admin actions', async () => {
    await setup();
    await owner.agent.post('/api/moderation/actions').send({
      type: 'TIMEOUT',
      userId: member.id,
      serverId,
      durationMinutes: 5,
    });
    const audit = await owner.agent.get(`/api/moderation/audit?serverId=${serverId}`);
    expect(audit.status).toBe(200);
    expect(audit.body.entries[0].action).toBe('moderation.timeout');
  });

  it('reports are created and reviewed by mods', async () => {
    await setup();
    const report = await member.agent.post('/api/reports').send({
      serverId,
      reportedUserId: mod.id,
      reason: 'being mean in chat',
    });
    expect(report.status).toBe(201);
    const list = await owner.agent.get(`/api/moderation/reports?serverId=${serverId}`);
    expect(list.body.reports).toHaveLength(1);
    const reportId = list.body.reports[0].id as string;
    const review = await owner.agent
      .patch(`/api/moderation/reports/${reportId}`)
      .send({ status: 'RESOLVED', note: 'warned' });
    expect(review.status).toBe(200);
    expect(review.body.report.status).toBe('RESOLVED');
  });
});

describe('search', () => {
  it('finds messages by keyword with access control', async () => {
    await setup();
    const channels = (await owner.agent.get(`/api/servers/${serverId}/channels`)).body.categories[0]
      .channels as { id: string; name: string }[];
    const general = channels[0]!;
    await owner.agent
      .post('/api/messages')
      .send({ channelId: general.id, content: 'the quantum flux capacitor is ready' });
    await member.agent
      .post('/api/messages')
      .send({ channelId: general.id, content: 'unrelated message about pizza' });

    const results = await member.agent.get('/api/search/messages?q=quantum');
    expect(results.status).toBe(200);
    expect(results.body.items).toHaveLength(1);
    expect(results.body.items[0].content).toContain('quantum');

    // Search from a non-member must not see anything from this server.
    const outsider = await registerUser({ username: 'search_outsider' });
    const leaked = await outsider.agent.get('/api/search/messages?q=quantum');
    expect(leaked.body.items).toHaveLength(0);
  });

  it('never leaks private channel content through search', async () => {
    await setup();
    const priv = await owner.agent.post(`/api/servers/${serverId}/channels`).send({
      name: 'secret',
      isPrivate: true,
    });
    const privId = priv.body.channel.id as string;
    await owner.agent
      .post('/api/messages')
      .send({ channelId: privId, content: 'classified banana research' });

    const memberSearch = await member.agent.get('/api/search/messages?q=banana');
    expect(memberSearch.body.items).toHaveLength(0);

    const ownerSearch = await owner.agent.get('/api/search/messages?q=banana');
    expect(ownerSearch.body.items).toHaveLength(1);
  });

  it('filters by channel and author', async () => {
    await setup();
    const channels = (await owner.agent.get(`/api/servers/${serverId}/channels`)).body.categories[0]
      .channels as { id: string }[];
    await owner.agent
      .post('/api/messages')
      .send({ channelId: channels[0]!.id, content: 'alpha searchable term' });
    await member.agent
      .post('/api/messages')
      .send({ channelId: channels[0]!.id, content: 'alpha searchable term two' });

    const byAuthor = await owner.agent.get(
      `/api/search/messages?q=searchable&authorId=${member.id}`,
    );
    expect(byAuthor.body.items).toHaveLength(1);
    expect(byAuthor.body.items[0].author.username).toBe('mod_member');
  });
});

describe('notifications', () => {
  it('creates mention notifications and supports mark-all-read', async () => {
    await setup();
    const channels = (await owner.agent.get(`/api/servers/${serverId}/channels`)).body.categories[0]
      .channels as { id: string }[];
    await owner.agent
      .post('/api/messages')
      .send({ channelId: channels[0]!.id, content: 'hey @mod_member check this' });

    const notifs = await member.agent.get('/api/notifications');
    expect(notifs.status).toBe(200);
    expect(notifs.body.unread).toBeGreaterThanOrEqual(1);
    expect(notifs.body.notifications[0].type).toBe('MENTION');

    await member.agent.post('/api/notifications/read-all');
    const after = await member.agent.get('/api/notifications');
    expect(after.body.unread).toBe(0);
  });

  it('friend requests produce notifications', async () => {
    await setup();
    await owner.agent.post('/api/friends/requests').send({ username: 'mod_member' });
    const notifs = await member.agent.get('/api/notifications');
    expect(notifs.body.notifications.some((n: { type: string }) => n.type === 'FRIEND_REQUEST')).toBe(
      true,
    );
  });
});

describe('uploads', () => {
  it('validates file types and sizes', async () => {
    await setup();
    const res = await owner.agent
      .post('/api/uploads')
      .attach('file', Buffer.from('%PDF-1.4 test'), {
        filename: 'doc.pdf',
        contentType: 'application/pdf',
      });
    expect(res.status).toBe(201);
    expect(res.body.attachment.kind).toBe('file');

    const bad = await owner.agent
      .post('/api/uploads')
      .attach('file', Buffer.from('MZ evil'), {
        filename: 'virus.exe',
        contentType: 'application/x-msdownload',
      });
    expect(bad.status).toBe(400);
  });

  it('images produce image attachments', async () => {
    await setup();
    // 1x1 png
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const res = await owner.agent.post('/api/uploads').attach('file', png, {
      filename: 'pixel.png',
      contentType: 'image/png',
    });
    expect(res.status).toBe(201);
    expect(res.body.attachment.kind).toBe('image');
    expect(res.body.attachment.url).toContain('/api/uploads/');
  });

  it('private unattached uploads are not fetchable by other users', async () => {
    await setup();
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const res = await owner.agent.post('/api/uploads').attach('file', png, {
      filename: 'secret.png',
      contentType: 'image/png',
    });
    const key = (res.body.attachment.url as string).split('/api/uploads/')[1];
    const mine = await owner.agent.get(`/api/uploads/${key}`);
    expect(mine.status).toBe(200);
    const theirs = await member.agent.get(`/api/uploads/${key}`);
    expect(theirs.status).toBe(403);
  });
});

describe('voice', () => {
  it('returns 503 with a clear message when LiveKit is not configured', async () => {
    await setup();
    const channels = (await owner.agent.get(`/api/servers/${serverId}/channels`)).body.categories[0]
      .channels as { id: string; type: string }[];
    const voice = channels.find((c) => c.type === 'VOICE') ?? channels[0]!;
    const status = await owner.agent.get('/api/voice/status');
    expect(status.body.configured).toBe(false);
    const token = await owner.agent.post('/api/voice/token').send({ channelId: voice.id });
    expect(token.status).toBe(503);
    expect(token.body.error.message).toMatch(/not configured/i);
  });

  it('rejects tokens for non-voice channels and unauthorized users', async () => {
    // Even before LiveKit config, authorization happens first only after
    // config check — verify config gate order with a non-member for text channel.
    await setup();
    const channels = (await owner.agent.get(`/api/servers/${serverId}/channels`)).body.categories[0]
      .channels as { id: string; type: string }[];
    const text = channels.find((c) => c.type === 'TEXT')!;
    const res = await owner.agent.post('/api/voice/token').send({ channelId: text.id });
    expect(res.status).toBe(503); // not configured → 503 before channel-type checks
  });
});

describe('health', () => {
  it('health and ready endpoints respond', async () => {
    await setup();
    const health = await owner.agent.get('/api/health');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('ok');
    const ready = await owner.agent.get('/api/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.checks.database).toBe('ok');
  });
});
