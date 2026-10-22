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
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'prisma', 'migrations');

export async function runMigrations(connectionString: string): Promise<string[]> {
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
      ? readdirSync(migrationsDir).filter((n) => existsSync(join(migrationsDir, n, 'migration.sql'))).sort()
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

// CLI entry
import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL;
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
