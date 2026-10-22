import { createApp } from '../../src/app.js';
import { prisma } from '../../src/context.js';
import type { Express } from 'express';
import request from 'supertest';
import { CSRF_COOKIE, CSRF_HEADER } from '@aether/shared';

export interface TestAgent {
  app: Express;
  cookies: Map<string, string>;
  get(path: string): request.Test;
  post(path: string): request.Test;
  patch(path: string): request.Test;
  put(path: string): request.Test;
  delete(path: string): request.Test;
  raw(): ReturnType<typeof request.agent>;
}

function parseSetCookie(header: string[] | string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  const list = Array.isArray(header) ? header : header ? [header] : [];
  for (const raw of list) {
    const [pair] = raw.split(';');
    const idx = pair!.indexOf('=');
    if (idx > 0) out.set(pair!.slice(0, idx).trim(), pair!.slice(idx + 1).trim());
  }
  return out;
}

/** Cookie-aware API test client with CSRF handling. */
export function createTestAgent(): TestAgent {
  const app = createApp();
  const cookies = new Map<string, string>();

  const apply = (req: request.Test): request.Test => {
    if (cookies.size) {
      req.set(
        'Cookie',
        [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
      );
    }
    const csrf = cookies.get(CSRF_COOKIE);
    if (csrf) req.set(CSRF_HEADER, csrf);
    return req;
  };

  const capture = (res: request.Response) => {
    const setCookie = res.headers['set-cookie'] as string[] | string | undefined;
    for (const [k, v] of parseSetCookie(setCookie)) {
      if (v === '' || res.headers['set-cookie']?.includes(`${k}=;`)) cookies.delete(k);
      else cookies.set(k, v);
    }
    return res;
  };

  const wrap =
    (method: 'get' | 'post' | 'patch' | 'put' | 'delete') =>
    (path: string): request.Test => {
      const req = apply(request(app)[method](path));
      // Attach capture on end.
      const origEnd = req.end.bind(req);
      (req as unknown as { end: unknown }).end = (
        cb?: (err: unknown, res: request.Response) => void,
      ) => {
        return origEnd((err: unknown, res: request.Response) => {
          if (res) capture(res);
          cb?.(err, res);
        });
      };
      return req;
    };

  return {
    app,
    cookies,
    get: wrap('get'),
    post: wrap('post'),
    patch: wrap('patch'),
    put: wrap('put'),
    delete: wrap('delete'),
    raw: () => request.agent(app),
  };
}

let userCounter = 0;
export interface TestUser {
  id: string;
  email: string;
  username: string;
  password: string;
  agent: TestAgent;
}

export async function registerUser(
  overrides: Partial<{ username: string; email: string; password: string; displayName: string }> = {},
): Promise<TestUser> {
  const n = ++userCounter;
  const username = overrides.username ?? `user${n}_${Date.now().toString(36)}`;
  const email = overrides.email ?? `${username}@test.dev`;
  const password = overrides.password ?? 'Sup3rSecret!pass';
  const agent = createTestAgent();
  const res = await agent.post('/api/auth/register').send({
    email,
    username,
    password,
    displayName: overrides.displayName ?? username,
  });
  if (res.status !== 201) {
    throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { id: res.body.user.id, email, username, password, agent };
}

export async function truncateAll(): Promise<void> {
  const tables = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE '_aether%'`,
  );
  for (const t of tables) {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE "public"."${t.tablename}" CASCADE`,
    );
  }
}

export { prisma };
