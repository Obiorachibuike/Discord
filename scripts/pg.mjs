/**
 * Boots an embedded PostgreSQL (npm-shipped binaries) for local development
 * and testing when no external DATABASE_URL is provided. Used by
 * scripts/devdb.mjs and the test harness.
 */
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function startEmbeddedPostgres({
  dataDir = join(repoRoot, '.pgdata'),
  port = Number(process.env.PGPORT || 5433),
  user = 'aether',
  password = 'aether',
  database = 'aether',
  persistent = true,
} = {}) {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  const ep = new EmbeddedPostgres({
    databaseDir: dataDir,
    user,
    password,
    port,
    persistent,
    initdbFlags: ['--encoding=UTF8', '--locale=C', '--auth=trust'],
    onLog: () => {},
  });
  const fresh = !existsSync(join(dataDir, 'PG_VERSION'));
  if (fresh) await ep.initialise();
  await ep.start();
  try {
    await ep.createDatabase(database);
  } catch {
    /* already exists */
  }
  return {
    ep,
    url: `postgresql://${user}:${password}@127.0.0.1:${port}/${database}`,
  };
}

export { repoRoot };
