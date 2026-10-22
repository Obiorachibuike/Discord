/** Drop all application tables and re-run migrations. Destructive — dev only. */
import pg from 'pg';
import { runMigrations } from './migrate.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
const { rows } = await client.query<{ table: string }>(
  `SELECT tablename AS table FROM pg_tables WHERE schemaname = 'public'`,
);
for (const { table } of rows) {
  await client.query(`DROP TABLE IF EXISTS "public"."${table.replace(/"/g, '""')}" CASCADE`);
}
await client.end();
const applied = await runMigrations(url);
console.log(`Reset complete. Applied: ${applied.join(', ') || '(none)'}`);
