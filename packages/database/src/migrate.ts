/**
 * SQL migration runner.
 *
 * Applies every `prisma/migrations/<name>/migration.sql` that is not yet
 * recorded in `_aether_migrations`, inside a transaction per migration.
 * This is equivalent to `prisma migrate deploy` for environments where the
 * Prisma schema-engine binary cannot be downloaded; the SQL files are the
 * single source of truth either way.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

function resolveMigrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '..', 'prisma', 'migrations'),
    resolve(process.cwd(), 'packages/database/prisma/migrations'),
    resolve(process.cwd(), '../database/prisma/migrations'),
    resolve(process.cwd(), '../../packages/database/prisma/migrations'),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return candidates[0]!;
}

export async function runMigrations(connectionString: string): Promise<string[]> {
  const migrationsDir = resolveMigrationsDir();
  const client = new pg.Client({ connectionString });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(
      'CREATE TABLE IF NOT EXISTS "_aether_migrations" (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
    );
    const done = new Set(
      (await client.query<{ name: string }>('SELECT name FROM "_aether_migrations"')).rows.map(
        (r) => r.name,
      ),
    );
    const names = existsSync(migrationsDir)
      ? readdirSync(migrationsDir)
          .filter((n) => existsSync(join(migrationsDir, n, 'migration.sql')))
          .sort()
      : [];
    for (const name of names) {
      if (done.has(name)) continue;
      const sql = readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO "_aether_migrations" (name) VALUES ($1)', [name]);
        await client.query('COMMIT');
        applied.push(name);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
    return applied;
  } finally {
    await client.end();
  }
}

const globalForMigrations = globalThis as unknown as {
  __aetherMigrations?: Map<string, Promise<string[]>>;
};

/**
 * Idempotent per-process migration guard for serverless cold starts.
 * Runs `runMigrations` once per connection string and caches the promise;
 * evicts the entry if migration fails so subsequent requests can retry.
 */
export function ensureMigrated(connectionString: string): Promise<string[]> {
  if (!globalForMigrations.__aetherMigrations) {
    globalForMigrations.__aetherMigrations = new Map();
  }
  const cache = globalForMigrations.__aetherMigrations;
  const existing = cache.get(connectionString);
  if (existing) return existing;

  const pending = runMigrations(connectionString).catch((err) => {
    cache.delete(connectionString);
    throw err;
  });
  cache.set(connectionString, pending);
  return pending;
}

// CLI entry
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  runMigrations(url)
    .then((applied) => {
      console.log(
        applied.length ? `Applied migrations: ${applied.join(', ')}` : 'Database is up to date.',
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
