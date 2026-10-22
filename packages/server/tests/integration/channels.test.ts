import { beforeEach, describe, expect, it } from 'vitest';
import { registerUser, truncateAll, type TestUser } from '../helpers/testApp.js';
import { Permissions } from '@aether/shared';

beforeEach(async () => {
  await truncateAll();
});

let owner: TestUser;
let member: TestUser;
let serverId: string;

async function setup() {
  owner = await registerUser({ username: 'chan_owner' });
  member = await registerUser({ username: 'chan_member' });
  const server = await owner.agent.post('/api/servers').send({ name: 'Chan Guild' });
  serverId = server.body.server.id as string;
  const code = (
    await owner.agent.post(`/api/servers/${serverId}/invites`).send({})
  ).body.invite.code as string;
  await member.agent.post(`/api/invites/${code}/join`);
}

describe('channel management', () => {
  it('creates, updates, reorders and deletes channels', async () => {
    await setup();
    const created = await owner.agent.post(`/api/servers/${serverId}/channels`).send({
      name: 'New Channel',
      type: 'TEXT',
      topic: 'topic here',
    });
    expect(created.status).toBe(201);
    expect(created.body.channel.name).toBe('new-channel');
    const channelId = created.body.channel.id as string;

    const patched = await owner.agent.patch(`/api/channels/${channelId}`).send({
      name: 'renamed-channel',
      topic: 'updated',
    });
    expect(patched.status).toBe(200);
    expect(patched.body.channel.name).toBe('renamed-channel');

    const reorder = await owner.agent
      .patch(`/api/servers/${serverId}/channels/reorder`)
      .send({ items: [{ id: channelId, position: 5 }] });
    expect(reorder.status).toBe(200);

    const del = await owner.agent.delete(`/api/channels/${channelId}`);
    expect(del.status).toBe(200);
  });

  it('regular members cannot manage channels', async () => {
    await setup();
    const res = await member.agent.post(`/api/servers/${serverId}/channels`).send({
      name: 'sneaky',
    });
    expect(res.status).toBe(403);
  });

  it('private channels are hidden from unauthorized members', async () => {
    await setup();
    const priv = await owner.agent.post(`/api/servers/${serverId}/channels`).send({
      name: 'secret-club',
      type: 'TEXT',
      isPrivate: true,
    });
    const privId = priv.body.channel.id as string;

    const allNames = (body: {
      categories: { channels: { name: string }[] }[];
      uncategorized: { name: string }[];
    }) => [
      ...body.categories.flatMap((c) => c.channels.map((ch) => ch.name)),
      ...body.uncategorized.map((ch) => ch.name),
    ];

    // Member must NOT see the private channel.
    const list = await member.agent.get(`/api/servers/${serverId}/channels`);
    expect(allNames(list.body)).not.toContain('secret-club');

    // Cannot read messages there either.
    const msgs = await member.agent.get(`/api/channels/${privId}/messages`);
    expect(msgs.status).toBe(403);

    // Owner sees it.
    const ownerList = await owner.agent.get(`/api/servers/${serverId}/channels`);
    expect(allNames(ownerList.body)).toContain('secret-club');

    // Grant the member access via user override allow VIEW_CHANNELS.
    const put = await owner.agent
      .put(`/api/channels/${privId}/overrides/${member.id}?type=user`)
      .send({
        allow: Permissions.VIEW_CHANNELS.toString(),
        deny: '0',
      });
    expect(put.status).toBe(200);
    const after = await member.agent.get(`/api/servers/${serverId}/channels`);
    expect(allNames(after.body)).toContain('secret-club');
  });

  it('channel deny override removes access even for role holders', async () => {
    await setup();
    const general = (
      await owner.agent.get(`/api/servers/${serverId}/channels`)
    ).body.categories.flatMap((c: { channels: { id: string; name: string }[] }) => c.channels)[0];
    // Deny SEND_MESSAGES for the default role via role override.
    const roles = (await owner.agent.get(`/api/servers/${serverId}/roles`)).body.roles as {
      id: string;
      isDefault: boolean;
    }[];
    const defaultRole = roles.find((r) => r.isDefault)!;
    await owner.agent
      .put(`/api/channels/${general.id}/overrides/${defaultRole.id}?type=role`)
      .send({ allow: '0', deny: Permissions.SEND_MESSAGES.toString() });

    const send = await member.agent.post('/api/messages').send({
      channelId: general.id,
      content: 'should fail',
    });
    expect(send.status).toBe(403);
  });

  it('categories can be created and channels assigned', async () => {
    await setup();
    const cat = await owner.agent
      .post(`/api/servers/${serverId}/channels/categories`)
      .send({ name: 'Projects' });
    expect(cat.status).toBe(201);
    const ch = await owner.agent.post(`/api/servers/${serverId}/channels`).send({
      name: 'proj-one',
      categoryId: cat.body.category.id,
    });
    expect(ch.body.channel.categoryId).toBe(cat.body.category.id);
  });
});
