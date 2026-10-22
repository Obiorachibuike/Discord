import { createServer } from 'node:http';
import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { initSocket } from './socket/index.js';
import { disconnectPrisma } from './context.js';
import { presence } from './services/presence.service.js';

async function main() {
  const app = createApp();
  const httpServer = createServer(app);
  const io = initSocket(httpServer);

  await new Promise<void>((resolve) => {
    httpServer.listen(config.PORT, config.HOST, () => {
      logger.info(
        { port: config.PORT, host: config.HOST, env: config.NODE_ENV },
        'aether server listening',
      );
      resolve();
    });
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down gracefully');
    const force = setTimeout(() => {
      logger.error('forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
    force.unref();
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await presence.stop();
    await disconnectPrisma();
    clearTimeout(force);
    logger.info('shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => {
    logger.error({ err }, 'unhandled rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'uncaught exception');
    void shutdown('uncaughtException');
  });
}

main().catch((err) => {
  logger.error({ err }, 'failed to start server');
  process.exit(1);
});
