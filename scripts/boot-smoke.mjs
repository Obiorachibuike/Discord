/**
 * End-to-end boot smoke:
 *   embedded PostgreSQL → migrate → seed → API server → web proxy → HTTP checks.
 * Verifies the single-origin web proxy actually reaches the API and that
 * session auth works through it. Exits non-zero on any failure.
 */
import { spawn } from 'node:child_process';
import { startEmbeddedPostgres } from './pg.mjs';
import { runMigrations } from '@aether/database';

const WEB_PORT = Number(process.env.WEB_PORT ?? 3000);
const API_PORT = Number(process.env.API_PORT ?? 4000);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHttp(url, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
    } catch {
      /* retry */
    }
    await wait(300);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function run(cmd, args, env) {
  return spawn(cmd, args, {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const children = [];
let ep = null;

try {
  console.log('· starting embedded PostgreSQL…');
  const { ep: embedded, url } = await startEmbeddedPostgres();
  ep = embedded;
  console.log(`· postgres up: ${url.replace(/:[^:@/]*@/, ':***@')}`);

  console.log('· running migrations…');
  await runMigrations(url);
  console.log('· migrations complete');

  console.log('· seeding demo data…');
  const seed = run('npx', ['tsx', 'packages/database/src/seed.ts'], { DATABASE_URL: url });
  await new Promise((resolve, reject) => {
    seed.stdout.on('data', () => {});
    seed.stderr.on('data', (d) => process.stderr.write(d));
    seed.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`seed exited ${code}`))));
  });
  console.log('· seed complete');

  console.log('· starting API server…');
  const api = run('node', ['packages/server/dist/index.js'], {
    DATABASE_URL: url,
    PORT: String(API_PORT),
    HOST: '127.0.0.1',
    EMAIL_PROVIDER: 'console',
    STORAGE_DRIVER: 'local',
    UPLOAD_DIR: '.smoke-uploads',
    LOG_LEVEL: 'warn',
  });
  children.push(api);
  api.stdout.on('data', (d) => process.stderr.write(`[api] ${d}`));
  api.stderr.on('data', (d) => process.stderr.write(`[api] ${d}`));

  console.log('· starting web server…');
  const web = run('node', ['packages/web/server.mjs'], {
    NODE_ENV: 'production',
    PORT: String(WEB_PORT),
    HOST: '0.0.0.0',
    API_ORIGIN: `http://127.0.0.1:${API_PORT}`,
  });
  children.push(web);
  web.stdout.on('data', (d) => process.stderr.write(`[web] ${d}`));
  web.stderr.on('data', (d) => process.stderr.write(`[web] ${d}`));

  const base = `http://127.0.0.1:${WEB_PORT}`;
  await waitForHttp(`${base}/api/health`);
  record('web proxy → API health', true);

  const landing = await fetch(`${base}/`);
  const landingHtml = await landing.text();
  record(
    'landing page renders',
    landing.status === 200 && landingHtml.includes('Aether'),
    `status=${landing.status}`,
  );

  const loginPage = await fetch(`${base}/login`);
  record('login page renders', loginPage.status === 200, `status=${loginPage.status}`);

  const health = await (await fetch(`${base}/api/health`)).json();
  record('API health payload', health.status === 'ok' || health.ok === true, JSON.stringify(health).slice(0, 120));

  // Session auth through the proxy.
  const loginRes = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ emailOrUsername: 'ada', password: 'Passw0rd!demo' }),
  });
  const setCookie = loginRes.headers.getSetCookie?.() ?? [];
  record('login with seeded user', loginRes.status === 200, `status=${loginRes.status}`);

  const session = setCookie.find((c) => c.startsWith('aether_session='));
  const csrf = setCookie.find((c) => c.startsWith('aether_csrf='))?.split(';')[0] ?? '';
  if (session) {
    const meRes = await fetch(`${base}/api/auth/me`, {
      headers: { cookie: [session.split(';')[0], csrf].filter(Boolean).join('; ') },
    });
    const me = await meRes.json();
    record(
      'GET /api/auth/me with session',
      meRes.status === 200 && me.user?.username === 'ada',
      `username=${me.user?.username}`,
    );

    const serversRes = await fetch(`${base}/api/servers`, {
      headers: { cookie: [session.split(';')[0], csrf].filter(Boolean).join('; ') },
    });
    const servers = await serversRes.json();
    record(
      'GET /api/servers (authenticated)',
      serversRes.status === 200 && Array.isArray(servers.servers),
      `servers=${servers.servers?.length ?? 0}`,
    );

    // CSRF double-submit enforcement check.
    const noCsrf = await fetch(`${base}/api/servers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: session.split(';')[0] },
      body: JSON.stringify({ name: 'CSRF probe' }),
    });
    record('CSRF token enforced on writes', noCsrf.status === 403, `status=${noCsrf.status}`);
  } else {
    record('session cookie issued', false, 'no aether_session cookie');
  }

  const unauth = await fetch(`${base}/api/servers`);
  record('unauthenticated API rejected', unauth.status === 401, `status=${unauth.status}`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} smoke checks passed`);
  if (failed.length) {
    console.error('FAILED:', failed.map((f) => f.name).join(', '));
    process.exitCode = 1;
  }
} catch (err) {
  console.error('SMOKE ERROR:', err);
  process.exitCode = 1;
} finally {
  for (const c of children) c.kill('SIGTERM');
  await wait(500);
  for (const c of children) c.kill('SIGKILL');
  if (ep) await ep.stop();
  process.exit(process.exitCode ?? 0);
}
