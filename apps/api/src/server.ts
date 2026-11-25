import { createApp } from './app.js';
import { config } from './config/env.js';
import { pool, prisma } from './lib/db.js';
import { logger } from './lib/logger.js';

const server = createApp().listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'PB-1 Publication Tracker API listening');
});

// Close connections cleanly when Docker stops the container (SIGTERM).
function shutdown(signal: string): void {
  logger.info({ signal }, 'Shutting down');
  server.close(() => {
    void prisma
      .$disconnect()
      .then(() => pool.end())
      .finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
