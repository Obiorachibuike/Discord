/**
 * Runs the full stack for development/preview:
 *   embedded PostgreSQL → migrations (+ seed on fresh DB) → API :4000 → web :3000
 * Keeps running until stopped. `SKIP_SEED=1` to skip seeding.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { startEmbeddedPostgres } from './pg.mjs';
import { runMigrations } from '@aether/database';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const API_PORT = Number(process.env.API_PORT ?? 4000);
const WEB_PORT = Number(process.env.WEB_PORT ?? 3000);

function run(cmd, args, env, label) {
  const child = spawn(cmd, args, {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => process.stdout.write(`[${label}] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[${label}] ${d}`));
  return child;
}

const { ep, url } = await startEmbeddedPostgres();
console.log(`· postgres up: ${url.replace(/:[^:@/]*@/, ':***@')}`);
const fresh = !existsSync(new URL('../.pg-data/seeded.marker', import.meta.url).pathname);
await runMigrations(url);
console.log('· migrations complete');

if (fresh && !process.env.SKIP_SEED) {
  await new Promise((resolve, reject) => {
    const seed = run('npx', ['tsx', 'packages/database/src/seed.ts'], { DATABASE_URL: url }, 'seed');
    seed.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`seed exited ${code}`))));
  });
  console.log('· seed complete');
}

const api = run(
  'node',
  ['packages/server/dist/index.js'],
  {
    DATABASE_URL: url,
    PORT: String(API_PORT),
    HOST: '0.0.0.0',
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER ?? 'console',
    STORAGE_DRIVER: process.env.STORAGE_DRIVER ?? 'local',
    UPLOAD_DIR: process.env.UPLOAD_DIR ?? 'uploads',
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
  },
  'api',
);

const web = run(
  'node',
  ['packages/web/server.mjs'],
  {
    NODE_ENV: process.env.NODE_ENV ?? 'production',
    PORT: String(WEB_PORT),
    HOST: '0.0.0.0',
    API_ORIGIN: `http://127.0.0.1:${API_PORT}`,
  },
  'web',
);

console.log(`· Aether running → http://localhost:${WEB_PORT}  (API :${API_PORT})`);
console.log('· demo login: ada / Passw0rd!demo');

async function shutdown() {
  api.kill('SIGTERM');
  web.kill('SIGTERM');
  await wait(500);
  api.kill('SIGKILL');
  web.kill('SIGKILL');
  await ep.stop();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
