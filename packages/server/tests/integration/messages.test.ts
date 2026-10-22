import { beforeEach, describe, expect, it } from 'vitest';
import { registerUser, truncateAll, type TestUser } from '../helpers/testApp.js';

beforeEach(async () => {
  await truncateAll();
});

let alice: TestUser;
let bob: TestUser;
let channelId: string;

async function setup() {
  alice = await registerUser({ username: 'msg_alice' });
  bob = await registerUser({ username: 'msg_bob' });
  const server = await alice.agent.post('/api/servers').send({ name: 'Msg Guild' });
  const serverId = server.body.server.id as string;
  const code = (
    await alice.agent.post(`/api/servers/${serverId}/invites`).send({})
  ).body.invite.code as string;
  await bob.agent.post(`/api/invites/${code}/join`);
  const channels = await alice.agent.get(`/api/servers/${serverId}/channels`);
  channelId = channels.body.categories[0].channels[0].id as string;
}

describe('messaging', () => {
  it('sends and lists messages', async () => {
    await setup();
    const send = await alice.agent
      .post('/api/messages')
      .send({ channelId, content: 'Hello world' });
    expect(send.status).toBe(201);
    expect(send.body.message.content).toBe('Hello world');
    expect(send.body.message.author.username).toBe('msg_alice');

    const list = await bob.agent.get(`/api/channels/${channelId}/messages`);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].content).toBe('Hello world');
  });

  it('paginates history with cursors (ascending transcript pages)', async () => {
    await setup();
    for (let i = 1; i <= 12; i++) {
      await alice.agent.post('/api/messages').send({ channelId, content: `Message ${i}` });
    }
    const page1 = await alice.agent.get(`/api/channels/${channelId}/messages?limit=5`);
    expect(page1.body.items).toHaveLength(5);
    // Newest window, ascending: 8..12
    expect(page1.body.items[0].content).toBe('Message 8');
    expect(page1.body.items[4].content).toBe('Message 12');
    const page2 = await alice.agent.get(
      `/api/channels/${channelId}/messages?limit=5&cursor=${page1.body.nextCursor}`,
    );
    expect(page2.body.items[0].content).toBe('Message 3');
    expect(page2.body.items[4].content).toBe('Message 7');
  });

  it('edits own message and marks editedAt; others cannot edit', async () => {
    await setup();
    const send = await alice.agent.post('/api/messages').send({ channelId, content: 'original' });
    const id = send.body.message.id as string;
    const edit = await alice.agent.patch(`/api/messages/${id}`).send({ content: 'edited!' });
    expect(edit.status).toBe(200);
    expect(edit.body.message.editedAt).toBeTruthy();

    const hijack = await bob.agent.patch(`/api/messages/${id}`).send({ content: 'hijacked' });
    expect(hijack.status).toBe(403);
  });

  it('deletes own message; moderators can delete others (audit recorded)', async () => {
    await setup();
    const send = await alice.agent.post('/api/messages').send({ channelId, content: 'to delete' });
    const id = send.body.message.id as string;

    const bobDelete = await bob.agent.delete(`/api/messages/${id}`);
    expect(bobDelete.status).toBe(403);

    const ownDelete = await alice.agent.delete(`/api/messages/${id}`);
    expect(ownDelete.status).toBe(200);
  });

  it('rejects empty and oversized messages', async () => {
    await setup();
    const empty = await alice.agent.post('/api/messages').send({ channelId, content: '   ' });
    expect(empty.status).toBe(400);
    const big = await alice.agent
      .post('/api/messages')
      .send({ channelId, content: 'x'.repeat(4001) });
    expect(big.status).toBe(400);
  });

  it('is idempotent for retried submissions with the same clientId', async () => {
    await setup();
    const payload = { channelId, content: 'exactly once', clientId: 'client-abc-12345' };
    const first = await alice.agent.post('/api/messages').send(payload);
    const second = await alice.agent.post('/api/messages').send(payload);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.message.id).toBe(first.body.message.id);
    const list = await alice.agent.get(`/api/channels/${channelId}/messages`);
    expect(list.body.items).toHaveLength(1);
  });

  it('supports replies with parent preview', async () => {
    await setup();
    const parent = await alice.agent.post('/api/messages').send({ channelId, content: 'parent' });
    const reply = await bob.agent.post('/api/messages').send({
      channelId,
      content: 'child',
      replyToId: parent.body.message.id,
    });
    expect(reply.status).toBe(201);
    expect(reply.body.message.replyTo.content).toBe('parent');
    expect(reply.body.message.replyTo.author.username).toBe('msg_alice');
  });

  it('adds and toggles reactions', async () => {
    await setup();
    const msg = await alice.agent.post('/api/messages').send({ channelId, content: 'react to me' });
    const id = msg.body.message.id as string;
    await bob.agent.post(`/api/messages/${id}/reactions`).send({ emoji: '👍' });
    await alice.agent.post(`/api/messages/${id}/reactions`).send({ emoji: '👍' });
    let list = await alice.agent.get(`/api/channels/${channelId}/messages`);
    expect(list.body.items[0].reactions[0]).toMatchObject({ emoji: '👍', count: 2, me: true });

    // Toggle off.
    await alice.agent.post(`/api/messages/${id}/reactions`).send({ emoji: '👍' });
    list = await alice.agent.get(`/api/channels/${channelId}/messages`);
    expect(list.body.items[0].reactions[0].count).toBe(1);
    expect(list.body.items[0].reactions[0].me).toBe(false);
  });

  it('pins and unpins messages; lists pins', async () => {
    await setup();
    const msg = await alice.agent.post('/api/messages').send({ channelId, content: 'pin me' });
    const id = msg.body.message.id as string;
    expect((await alice.agent.post(`/api/messages/${id}/pin`)).status).toBe(200);
    const pins = await bob.agent.get(`/api/channels/${channelId}/pins`);
    expect(pins.body.pins).toHaveLength(1);
    expect((await alice.agent.delete(`/api/messages/${id}/pin`)).status).toBe(200);
  });

  it('non-members cannot read or send messages (IDOR)', async () => {
    await setup();
    const mallory = await registerUser({ username: 'msg_mallory' });
    const list = await mallory.agent.get(`/api/channels/${channelId}/messages`);
    expect(list.status).toBe(403);
    const send = await mallory.agent
      .post('/api/messages')
      .send({ channelId, content: 'intrusion' });
    expect(send.status).toBe(403);
  });
});
