// Network-restricted local fallback for the pinned Prisma migration SQL.
// Records Prisma-compatible checksums; prefer `prisma migrate deploy` in production.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
const dir = 'packages/db/prisma/migrations';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required; set it in .env or the environment.');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id" VARCHAR(36) PRIMARY KEY NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "finished_at" TIMESTAMPTZ,
    "migration_name" VARCHAR(255) NOT NULL,
    "logs" TEXT,
    "rolled_back_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0
  )`);
  const migrations = fs.readdirSync(dir).filter(name => fs.statSync(path.join(dir, name)).isDirectory()).sort();
  for (const name of migrations) {
    const sql = fs.readFileSync(path.join(dir, name, 'migration.sql'), 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    const existing = await client.query('SELECT checksum, finished_at FROM "_prisma_migrations" WHERE migration_name = $1 AND rolled_back_at IS NULL', [name]);
    if (existing.rows.length) {
      if (existing.rows[0].checksum !== checksum || !existing.rows[0].finished_at) throw new Error(`Migration ${name} was edited or failed. Resolve manually; do not apply over it.`);
      console.log(`Already applied ${name}`); continue;
    }
    const id = crypto.randomUUID();
    await client.query('INSERT INTO "_prisma_migrations" (id, checksum, migration_name) VALUES ($1,$2,$3)', [id, checksum, name]);
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('UPDATE "_prisma_migrations" SET finished_at = now(), applied_steps_count = 1 WHERE id = $1', [id]);
      await client.query('COMMIT');
      console.log(`Applied ${name}`);
    } catch (error) {
      await client.query('ROLLBACK');
      await client.query('UPDATE "_prisma_migrations" SET logs = $2 WHERE id = $1', [id, String(error)]);
      throw error;
    }
  }
} finally { await client.end(); }
