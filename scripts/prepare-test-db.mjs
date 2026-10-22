// Destructive by design; refuses any database name not ending in _test.
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
const url = new URL(process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/cove_test');
const name = url.pathname.slice(1);
if (!/^[a-z][a-z0-9_]*_test$/.test(name)) throw new Error('Refusing to reset a database without an _test suffix');
const admin = new URL(url); admin.pathname = '/postgres';
const client = new pg.Client({ connectionString: admin.toString() });
await client.connect();
try {
  await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await client.query(`CREATE DATABASE "${name}" WITH ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`);
} finally { await client.end(); }
console.log(`Prepared isolated database ${name}`);
execFileSync(process.execPath, ['scripts/migrate-local.mjs'], { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url.toString() } });
