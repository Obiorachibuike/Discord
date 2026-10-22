/**
 * Boots an embedded PostgreSQL for the whole test run and applies migrations.
 * Skips boot when TEST_DATABASE_URL is provided (e.g. CI with a real Postgres).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startEmbeddedPostgres } from '../../../../scripts/pg.mjs';
import { runMigrations } from '@aether/database';

export async function setup() {
  let url = process.env.TEST_DATABASE_URL;
  let stop: (() => Promise<void>) | null = null;
  if (!url) {
    let started: Awaited<ReturnType<typeof startEmbeddedPostgres>> | null = null;
    let lastErr: unknown;
    for (let port = 55440; port < 55480 && !started; port++) {
      const dataDir = mkdtempSync(join(tmpdir(), 'aether-test-pg-'));
      try {
        started = await startEmbeddedPostgres({
          dataDir,
          port,
          database: 'aether_test',
          persistent: false,
        });
      } catch (err) {
        lastErr = err;
      }
    }
    if (!started) throw lastErr ?? new Error('could not start embedded postgres');
    url = started.url;
    stop = () => started!.ep.stop();
  }
  process.env.DATABASE_URL = url;
  process.env.TEST_DATABASE_URL = url;
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-that-is-long-enough-000';
  process.env.EMAIL_PROVIDER = 'none';
  // Tests exercise many auth requests from one IP; keep the limiter enabled
  // (a dedicated test asserts it works) but with a high ceiling.
  process.env.AUTH_RATE_LIMIT = '100000';
  process.env.API_RATE_LIMIT = '100000';
  await runMigrations(url);
  return async () => {
    if (stop) await stop();
  };
}
