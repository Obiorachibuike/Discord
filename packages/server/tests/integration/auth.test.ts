import { beforeEach, describe, expect, it } from 'vitest';
import {
  createTestAgent,
  prisma,
  registerUser,
  truncateAll,
} from '../helpers/testApp.js';
import { CSRF_COOKIE,  SESSION_COOKIE } from '@aether/shared';
import { generateToken, hashToken } from '../../src/utils/crypto.js';

beforeEach(async () => {
  await truncateAll();
});

describe('registration & login', () => {
  it('registers a user, sets secure session + csrf cookies', async () => {
    const agent = createTestAgent();
    const res = await agent.post('/api/auth/register').send({
      email: 'new@aether.dev',
      username: 'newbie',
      password: 'longenoughpassword',
      displayName: 'New B',
    });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('new@aether.dev');
    expect(res.body.user.emailVerified).toBe(false);
    expect(agent.cookies.has(SESSION_COOKIE)).toBe(true);
    expect(agent.cookies.has(CSRF_COOKIE)).toBe(true);
    // Password hash must never leak.
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('rejects duplicate email and username with a generic message', async () => {
    await registerUser({ username: 'taken_name', email: 'taken@x.dev' });
    const agent = createTestAgent();
    const byEmail = await agent.post('/api/auth/register').send({
      email: 'taken@x.dev',
      username: 'other_name',
      password: 'longenoughpassword',
    });
    expect(byEmail.status).toBe(409);
    expect(byEmail.body.error.message).toMatch(/already in use/i);
    const byUsername = await agent.post('/api/auth/register').send({
      email: 'other@x.dev',
      username: 'taken_name',
      password: 'longenoughpassword',
    });
    expect(byUsername.status).toBe(409);
  });

  it('logs in and out; logout revokes the session server-side', async () => {
    const user = await registerUser({ username: 'login_test' });
    const me = await user.agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe('login_test');

    await user.agent.post('/api/auth/logout');
    const after = await user.agent.get('/api/auth/me');
    expect(after.status).toBe(401);
    const sessions = await prisma.session.count({ where: { userId: user.id, revokedAt: null } });
    expect(sessions).toBe(0);
  });

  it('login failure returns the same generic error for unknown user and wrong password', async () => {
    await registerUser({ username: 'real_user', password: 'longenoughpassword' });
    const agent = createTestAgent();
    const unknown = await agent
      .post('/api/auth/login')
      .send({ emailOrUsername: 'ghost', password: 'whatever123' });
    const wrongPw = await agent
      .post('/api/auth/login')
      .send({ emailOrUsername: 'real_user', password: 'wrong-password-x' });
    expect(unknown.status).toBe(401);
    expect(wrongPw.status).toBe(401);
    expect(unknown.body.error.message).toBe(wrongPw.body.error.message);
  });

  it('rejects mutations without a CSRF header', async () => {
    const user = await registerUser({ username: 'csrf_test' });
    const cookieHeader = [...user.agent.cookies.entries()]
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    const res = await user.agent
      .post('/api/servers')
      .set('Cookie', cookieHeader) // no CSRF header on purpose
      .send({ name: 'No CSRF' });
    // supertest wrapper adds the header from cookie jar — use raw request instead.
    const req = await import('supertest').then((m) => m.default(user.agent.app));
    const raw = await req
      .post('/api/servers')
      .set('Cookie', cookieHeader)
      .send({ name: 'No CSRF' });
    expect(raw.status).toBe(403);
    expect(res.status).toBe(201); // agent auto-attaches CSRF — proving the header is what grants access
  });
});

describe('email verification & password reset', () => {
  it('verifies email with a valid token and rejects reuse', async () => {
    const user = await registerUser({ username: 'verify_me' });
    const token = generateToken();
    await prisma.verificationToken.create({
      data: {
        tokenHash: hashToken(token),
        userId: user.id,
        type: 'EMAIL_VERIFY',
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    const ok = await user.agent.post('/api/auth/verify').send({ token });
    expect(ok.status).toBe(200);
    const me = await user.agent.get('/api/auth/me');
    expect(me.body.user.emailVerified).toBe(true);
    const again = await user.agent.post('/api/auth/verify').send({ token });
    expect(again.status).toBe(400);
  });

  it('password reset: request is generic, reset works, old sessions revoked', async () => {
    const user = await registerUser({ username: 'reset_me' });
    const forgot = await user.agent.post('/api/auth/forgot').send({ email: user.email });
    expect(forgot.status).toBe(200);
    const ghost = await user.agent.post('/api/auth/forgot').send({ email: 'ghost@nowhere.dev' });
    expect(ghost.status).toBe(200);
    expect(ghost.body.message).toBe(forgot.body.message);

    const token = generateToken();
    await prisma.verificationToken.create({
      data: {
        tokenHash: hashToken(token),
        userId: user.id,
        type: 'PASSWORD_RESET',
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    const reset = await user.agent
      .post('/api/auth/reset')
      .send({ token, password: 'brandNewPassw0rd!' });
    expect(reset.status).toBe(200);

    // Old session revoked.
    const me = await user.agent.get('/api/auth/me');
    expect(me.status).toBe(401);

    // New password works.
    const agent = createTestAgent();
    const login = await agent
      .post('/api/auth/login')
      .send({ emailOrUsername: user.email, password: 'brandNewPassw0rd!' });
    expect(login.status).toBe(200);
  });

  it('rejects expired reset tokens', async () => {
    const user = await registerUser({ username: 'expired_tok' });
    const token = generateToken();
    await prisma.verificationToken.create({
      data: {
        tokenHash: hashToken(token),
        userId: user.id,
        type: 'PASSWORD_RESET',
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const reset = await user.agent
      .post('/api/auth/reset')
      .send({ token, password: 'brandNewPassw0rd!' });
    expect(reset.status).toBe(400);
  });
});

describe('session management', () => {
  it('lists and revokes sessions', async () => {
    const user = await registerUser({ username: 'sessions_user' });
    const list = await user.agent.get('/api/auth/sessions');
    expect(list.status).toBe(200);
    expect(list.body.sessions.length).toBeGreaterThanOrEqual(1);
    const sessionId = list.body.sessions[0].id as string;
    const del = await user.agent.delete(`/api/auth/sessions/${sessionId}`);
    expect(del.status).toBe(200);
    const me = await user.agent.get('/api/auth/me');
    expect(me.status).toBe(401);
  });

  it('revoke-all invalidates every session', async () => {
    const user = await registerUser({ username: 'revoke_all' });
    await user.agent.delete('/api/auth/sessions');
    const me = await user.agent.get('/api/auth/me');
    expect(me.status).toBe(401);
  });
});

describe('account settings', () => {
  it('updates profile fields', async () => {
    const user = await registerUser({ username: 'profile_user' });
    const res = await user.agent.patch('/api/users/me').send({
      displayName: 'Renamed',
      bio: 'Hello bio',
      customStatus: 'Building things',
    });
    expect(res.status).toBe(200);
    expect(res.body.user.displayName).toBe('Renamed');
    expect(res.body.user.bio).toBe('Hello bio');
  });

  it('requires current password to change password', async () => {
    const user = await registerUser({ username: 'pw_change' });
    const wrong = await user.agent.patch('/api/users/me/account').send({
      currentPassword: 'not-the-password',
      newPassword: 'anotherPassw0rd!',
    });
    expect(wrong.status).toBe(403);
    const ok = await user.agent.patch('/api/users/me/account').send({
      currentPassword: user.password,
      newPassword: 'anotherPassw0rd!',
    });
    expect(ok.status).toBe(200);
    // Password change revokes sessions → need to log in again.
    const agent = createTestAgent();
    const login = await agent
      .post('/api/auth/login')
      .send({ emailOrUsername: user.username, password: 'anotherPassw0rd!' });
    expect(login.status).toBe(200);
  });

  it('public profile never exposes email', async () => {
    const user = await registerUser({ username: 'public_prof' });
    const agent = createTestAgent();
    const res = await agent.get('/api/users/public_prof');
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(user.email);
  });
});
