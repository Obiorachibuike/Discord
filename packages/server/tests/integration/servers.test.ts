import { beforeEach, describe, expect, it } from 'vitest';
import { prisma, registerUser, truncateAll, type TestUser } from '../helpers/testApp.js';
import { ALL_PERMISSIONS, Permissions, hasPermission } from '@aether/shared';

beforeEach(async () => {
  await truncateAll();
});

let owner: TestUser;
let member: TestUser;

async function setupServer() {
  owner = await registerUser({ username: 'owner_user' });
  member = await registerUser({ username: 'member_user' });
  const create = await owner.agent.post('/api/servers').send({
    name: 'Test Guild',
    description: 'A test community',
  });
  expect(create.status).toBe(201);
  return create.body.server as { id: string; name: string };
}

describe('server creation', () => {
  it('creates default channels and roles; owner is a member', async () => {
    const server = await setupServer();
    const channels = await owner.agent.get(`/api/servers/${server.id}/channels`);
    expect(channels.status).toBe(200);
    const names = channels.body.categories.flatMap(
      (c: { channels: { name: string }[] }) => c.channels.map((ch) => ch.name),
    );
    expect(names).toContain('general');

    const roles = await owner.agent.get(`/api/servers/${server.id}/roles`);
    expect(roles.status).toBe(200);
    const roleNames = roles.body.roles.map((r: { name: string }) => r.name);
    expect(roleNames).toEqual(expect.arrayContaining(['Administrator', 'Moderator', 'Member']));

    const members = await owner.agent.get(`/api/servers/${server.id}/members`);
    expect(members.body.members).toHaveLength(1);
    expect(members.body.members[0].userId).toBe(owner.id);
  });

  it('lists only servers the user belongs to', async () => {
    const server = await setupServer();
    const mine = await owner.agent.get('/api/servers');
    expect(mine.body.servers.map((s: { id: string }) => s.id)).toContain(server.id);
    const theirs = await member.agent.get('/api/servers');
    expect(theirs.body.servers).toHaveLength(0);
  });
});

describe('invitations', () => {
  it('joins via invite, enforces single-use limits and revocation', async () => {
    const server = await setupServer();
    const create = await owner.agent
      .post(`/api/servers/${server.id}/invites`)
      .send({ maxUses: 1, expiresInHours: 24 });
    expect(create.status).toBe(201);
    const code = create.body.invite.code as string;

    const preview = await member.agent.get(`/api/invites/${code}`);
    expect(preview.status).toBe(200);
    expect(preview.body.invite.serverName).toBe('Test Guild');

    const join = await member.agent.post(`/api/invites/${code}/join`);
    expect(join.status).toBe(200);
    expect(join.body.alreadyMember).toBe(false);

    // Re-join is idempotent.
    const again = await member.agent.post(`/api/invites/${code}/join`);
    expect(again.body.alreadyMember).toBe(true);

    // maxUses reached → third user blocked.
    const third = await registerUser({ username: 'third_user' });
    const blocked = await third.agent.post(`/api/invites/${code}/join`);
    expect(blocked.status).toBe(400);
  });

  it('revoked and expired invites are rejected', async () => {
    const server = await setupServer();
    const create = await owner.agent.post(`/api/servers/${server.id}/invites`).send({});
    const code = create.body.invite.code as string;
    await owner.agent.delete(`/api/invites/${code}`);
    const join = await member.agent.post(`/api/invites/${code}/join`);
    expect(join.status).toBe(400);

    const expiring = await owner.agent
      .post(`/api/servers/${server.id}/invites`)
      .send({ expiresInHours: 1 });
    const expCode = expiring.body.invite.code as string;
    await prisma.invitation.update({
      where: { code: expCode },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const joinExpired = await member.agent.post(`/api/invites/${expCode}/join`);
    expect(joinExpired.status).toBe(400);
  });

  it('non-members cannot list invites', async () => {
    const server = await setupServer();
    const res = await member.agent.get(`/api/servers/${server.id}/invites`);
    expect(res.status).toBe(403);
  });

  it('banned users cannot join', async () => {
    const server = await setupServer();
    await member.agent.post(`/api/invites/${(await owner.agent.post(`/api/servers/${server.id}/invites`).send({})).body.invite.code}/join`);
    await owner.agent
      .post('/api/moderation/actions')
      .send({ type: 'BAN', userId: member.id, serverId: server.id, reason: 'spam' });
    await member.agent.post(`/api/servers/${server.id}/leave`);
    // member was banned + removed; trying to rejoin fails
    const code = (await owner.agent.post(`/api/servers/${server.id}/invites`).send({})).body.invite
      .code;
    const res = await member.agent.post(`/api/invites/${code}/join`);
    expect(res.status).toBe(403);
  });
});

describe('membership lifecycle', () => {
  it('kicks members with permission and records moderation action', async () => {
    const server = await setupServer();
    const code = (await owner.agent.post(`/api/servers/${server.id}/invites`).send({})).body.invite
      .code;
    await member.agent.post(`/api/invites/${code}/join`);

    const kick = await owner.agent.delete(
      `/api/servers/${server.id}/members/${member.id}?reason=spam`,
    );
    expect(kick.status).toBe(200);
    const actions = await owner.agent.get(
      `/api/moderation/actions?serverId=${server.id}`,
    );
    expect(actions.body.actions[0].type).toBe('KICK');
  });

  it('owner cannot leave without transferring ownership', async () => {
    const server = await setupServer();
    const code = (await owner.agent.post(`/api/servers/${server.id}/invites`).send({})).body.invite
      .code;
    await member.agent.post(`/api/invites/${code}/join`);
    const leave = await owner.agent.post(`/api/servers/${server.id}/leave`);
    expect(leave.status).toBe(400);

    const transfer = await owner.agent
      .post(`/api/servers/${server.id}/transfer`)
      .send({ userId: member.id });
    expect(transfer.status).toBe(200);
    const nowLeave = await owner.agent.post(`/api/servers/${server.id}/leave`);
    expect(nowLeave.status).toBe(200);
    const db = await prisma.server.findUniqueOrThrow({ where: { id: server.id } });
    expect(db.ownerId).toBe(member.id);
  });

  it('non-members cannot access server data (IDOR protection)', async () => {
    const server = await setupServer();
    for (const res of [
      await member.agent.get(`/api/servers/${server.id}`),
      await member.agent.get(`/api/servers/${server.id}/channels`),
      await member.agent.get(`/api/servers/${server.id}/members`),
    ]) {
      expect(res.status).toBe(403);
    }
  });
});

describe('roles', () => {
  it('creates roles and refuses privilege escalation', async () => {
    const server = await setupServer();
    const code = (await owner.agent.post(`/api/servers/${server.id}/invites`).send({})).body.invite
      .code;
    await member.agent.post(`/api/invites/${code}/join`);

    // Give member MANAGE_ROLES but not MANAGE_SERVER.
    const modRole = (
      await owner.agent.get(`/api/servers/${server.id}/roles`)
    ).body.roles.find((r: { name: string }) => r.name === 'Moderator');
    await owner.agent
      .put(`/api/servers/${server.id}/members/${member.id}/roles`)
      .send({ roleIds: [modRole.id] });

    // Moderator can create a role with permissions they have.
    const okCreate = await member.agent.post(`/api/servers/${server.id}/roles`).send({
      name: 'Helpers',
      permissions: Permissions.VIEW_CHANNELS.toString(),
    });
    expect(okCreate.status).toBe(201);

    // But cannot grant permissions they lack (BAN_MEMBERS).
    const escalate = await member.agent.post(`/api/servers/${server.id}/roles`).send({
      name: 'Evil',
      permissions: Permissions.BAN_MEMBERS.toString(),
    });
    expect(escalate.status).toBe(403);

    // And cannot assign roles above their own position (Administrator).
    const adminRole = (
      await owner.agent.get(`/api/servers/${server.id}/roles`)
    ).body.roles.find((r: { name: string }) => r.name === 'Administrator');
    const assign = await member.agent
      .put(`/api/servers/${server.id}/members/${owner.id}/roles`)
      .send({ roleIds: [adminRole.id] });
    expect(assign.status).toBe(403);
  });

  it('default role permissions grant chat but not moderation', async () => {
    const server = await setupServer();
    const code = (await owner.agent.post(`/api/servers/${server.id}/invites`).send({})).body.invite
      .code;
    await member.agent.post(`/api/invites/${code}/join`);
    const roles = (await member.agent.get(`/api/servers/${server.id}/roles`)).body.roles as {
      name: string;
      permissions: string;
      isDefault: boolean;
    }[];
    const def = roles.find((r) => r.isDefault)!;
    const perms = BigInt(def.permissions);
    expect(hasPermission(perms, Permissions.SEND_MESSAGES)).toBe(true);
    expect(hasPermission(perms, Permissions.KICK_MEMBERS)).toBe(false);
    expect(BigInt((roles.find((r) => r.name === 'Administrator')!).permissions)).toBe(
      ALL_PERMISSIONS,
    );
  });
});
