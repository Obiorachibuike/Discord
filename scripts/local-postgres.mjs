// Optional test/dev convenience for hosts without Docker; NOT a production database.
import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';
const dir = '.local-postgres';
const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'postgres', port: 5432, persistent: true });
if (!fs.existsSync(`${dir}/PG_VERSION`)) await pg.initialise();
await pg.start();
try {
  const client = pg.getPgClient();
  await client.connect();
  const existing = await client.query("SELECT 1 FROM pg_database WHERE datname = 'cove'");
  if (existing.rowCount === 0) await client.query("CREATE DATABASE cove WITH ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0");
  await client.end();
} catch (error) { throw new Error(`Unable to create local UTF8 database: ${error}`); }
console.log('PostgreSQL ready on port 5432 (local development only)');
const stop = async () => { await pg.stop(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
