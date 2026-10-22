import http from 'node:http';
import { db } from '@cove/db';
import { app } from './app';
import { config } from './lib/config';
import { logger } from './lib/logger';
import { closeRedis } from './lib/redis';
import { createSocketServer } from './socket';
import { startCleanupWorker } from './workers/cleanup';

async function main() {
  // Fail fast on an unavailable database, not after the first user request.
  await db.$queryRaw`SELECT 1`;
  const server = http.createServer(app);
  const { io, closeAdapter } = await createSocketServer(server);
  const closeWorker = await startCleanupWorker();
  server.listen(config.API_PORT, '0.0.0.0', () => logger.info({ port: config.API_PORT }, 'Cove API listening'));
  let closing = false;
  const shutdown = async () => {
    if (closing) return; closing = true;
    logger.info('shutting down');
    await new Promise<void>(resolve => server.close(() => resolve()));
    await new Promise<void>(resolve => io.close(() => resolve()));
    await closeWorker?.(); await closeAdapter(); await closeRedis(); await db.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => { void shutdown(); });
  process.on('SIGINT', () => { void shutdown(); });
}
main().catch(error => { logger.fatal({ err: error }, 'startup failed'); process.exit(1); });
