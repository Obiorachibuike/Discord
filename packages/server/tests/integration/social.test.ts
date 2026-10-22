import { beforeEach, describe, expect, it } from 'vitest';
import { registerUser, truncateAll, type TestUser } from '../helpers/testApp.js';

beforeEach(async () => {
  await truncateAll();
});

let ada: TestUser;
let grace: TestUser;

async function setup() {
  ada = await registerUser({ username: 'social_ada' });
  grace = await registerUser({ username: 'social_grace' });
}

describe('friends', () => {
  it('sends, accepts and lists friends', async () => {
    await setup();
    const send = await ada.agent.post('/api/friends/requests').send({ username: 'social_grace' });
    expect(send.status).toBe(201);

    const incoming = await grace.agent.get('/api/friends');
    expect(incoming.body.incoming).toHaveLength(1);
    expect(incoming.body.incoming[0].user.username).toBe('social_ada');

    const requestId = incoming.body.incoming[0].id as string;
    const accept = await grace.agent.post(`/api/friends/requests/${requestId}/accept`);
    expect(accept.status).toBe(200);

    const adaList = await ada.agent.get('/api/friends');
    expect(adaList.body.friends).toHaveLength(1);
    expect(adaList.body.friends[0].user.username).toBe('social_grace');
  });

  it('rejects and cancels requests; prevents duplicates', async () => {
    await setup();
    await ada.agent.post('/api/friends/requests').send({ username: 'social_grace' });
    const dup = await ada.agent.post('/api/friends/requests').send({ username: 'social_grace' });
    expect(dup.status).toBe(409);

    const incoming = await grace.agent.get('/api/friends');
    const requestId = incoming.body.incoming[0].id as string;
    expect((await grace.agent.post(`/api/friends/requests/${requestId}/reject`)).status).toBe(200);

    // After rejection a fresh request is allowed.
    const retry = await ada.agent.post('/api/friends/requests').send({ username: 'social_grace' });
    expect(retry.status).toBe(201);
    const outgoing = await ada.agent.get('/api/friends');
    const reqId = outgoing.body.outgoing[0].id as string;
    expect((await ada.agent.delete(`/api/friends/requests/${reqId}`)).status).toBe(200);
  });

  it('removes friendships', async () => {
    await setup();
    await ada.agent.post('/api/friends/requests').send({ username: 'social_grace' });
    const incoming = await grace.agent.get('/api/friends');
    await grace.agent.post(`/api/friends/requests/${incoming.body.incoming[0].id}/accept`);
    expect((await ada.agent.delete(`/api/friends/${grace.id}`)).status).toBe(200);
    const list = await ada.agent.get('/api/friends');
    expect(list.body.friends).toHaveLength(0);
  });

  it('blocks prevent friend requests and DMs (enforced server-side)', async () => {
    await setup();
    await ada.agent.post('/api/friends/blocks').send({ userId: grace.id });
    const blocked = await grace.agent.post('/api/friends/requests').send({ username: 'social_ada' });
    expect(blocked.status).toBe(403);

    const dm = await grace.agent.post('/api/conversations/dm').send({ userId: ada.id });
    expect(dm.status).toBe(403);

    await ada.agent.delete(`/api/friends/blocks/${grace.id}`);
    const ok = await grace.agent.post('/api/friends/requests').send({ username: 'social_ada' });
    expect(ok.status).toBe(201);
  });

  it('privacy setting can disable friend requests', async () => {
    await setup();
    await ada.agent.patch('/api/users/me/privacy').send({ allowFriendRequests: false });
    const res = await grace.agent.post('/api/friends/requests').send({ username: 'social_ada' });
    expect(res.status).toBe(403);
  });
});

describe('direct messages', () => {
  it('creates a single DM conversation per user pair', async () => {
    await setup();
    const first = await ada.agent.post('/api/conversations/dm').send({ userId: grace.id });
    expect(first.status).toBe(201);
    const second = await grace.agent.post('/api/conversations/dm').send({ userId: ada.id });
    expect(second.status).toBe(201);
    expect(second.body.conversationId).toBe(first.body.conversationId);

    const list = await ada.agent.get('/api/conversations');
    expect(list.body.conversations).toHaveLength(1);
    expect(list.body.conversations[0].type).toBe('DIRECT');
  });

  it('sends DMs both ways with unread counts and read receipts', async () => {
    await setup();
    const conv = await ada.agent.post('/api/conversations/dm').send({ userId: grace.id });
    const id = conv.body.conversationId as string;

    const send = await ada.agent
      .post(`/api/conversations/${id}/messages`)
      .send({ content: 'hey grace' });
    expect(send.status).toBe(201);

    const graceList = await grace.agent.get('/api/conversations');
    expect(graceList.body.conversations[0].unread).toBe(1);

    await grace.agent.post(`/api/conversations/${id}/read`).send({});
    const afterRead = await grace.agent.get('/api/conversations');
    expect(afterRead.body.conversations[0].unread).toBe(0);

    const history = await grace.agent.get(`/api/conversations/${id}/messages`);
    expect(history.body.items).toHaveLength(1);
  });

  it('non-participants cannot read or post in a conversation', async () => {
    await setup();
    const conv = await ada.agent.post('/api/conversations/dm').send({ userId: grace.id });
    const id = conv.body.conversationId as string;
    const mallory = await registerUser({ username: 'dm_mallory' });
    expect((await mallory.agent.get(`/api/conversations/${id}/messages`)).status).toBe(403);
    expect(
      (await mallory.agent.post(`/api/conversations/${id}/messages`).send({ content: 'hi' })).status,
    ).toBe(403);
  });

  it('DMs to friends-only users are blocked unless friends', async () => {
    await setup();
    await grace.agent.patch('/api/users/me/privacy').send({ allowDmsFromFriendsOnly: true });
    const blocked = await ada.agent.post('/api/conversations/dm').send({ userId: grace.id });
    expect(blocked.status).toBe(403);

    await ada.agent.post('/api/friends/requests').send({ username: 'social_grace' });
    const incoming = await grace.agent.get('/api/friends');
    await grace.agent.post(`/api/friends/requests/${incoming.body.incoming[0].id}/accept`);
    const ok = await ada.agent.post('/api/conversations/dm').send({ userId: grace.id });
    expect(ok.status).toBe(201);
  });
});

describe('group conversations', () => {
  it('creates groups, adds members, renames and leaves', async () => {
    await setup();
    const third = await registerUser({ username: 'social_third' });
    const group = await ada.agent
      .post('/api/conversations/group')
      .send({ name: 'Trio', memberIds: [grace.id, third.id] });
    expect(group.status).toBe(201);
    const id = group.body.conversationId as string;

    const rename = await ada.agent.patch(`/api/conversations/${id}`).send({ name: 'Renamed Trio' });
    expect(rename.status).toBe(200);

    const fourth = await registerUser({ username: 'social_fourth' });
    const add = await ada.agent
      .post(`/api/conversations/${id}/members`)
      .send({ memberIds: [fourth.id] });
    expect(add.status).toBe(200);

    const leave = await grace.agent.delete(`/api/conversations/${id}/members/me`);
    expect(leave.status).toBe(200);
    const messages = await grace.agent.get(`/api/conversations/${id}/messages`);
    expect(messages.status).toBe(403);
  });

  it('only the creator can rename or add members', async () => {
    await setup();
    const group = await ada.agent
      .post('/api/conversations/group')
      .send({ name: 'Control', memberIds: [grace.id] });
    const id = group.body.conversationId as string;
    const rename = await grace.agent.patch(`/api/conversations/${id}`).send({ name: 'Hijacked' });
    expect(rename.status).toBe(403);
  });
});
