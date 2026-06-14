import { createApp } from './app';
import { createServer } from './server';
import { loadConfig } from './config/env';
import { logger } from './config/logger';
import { closeDatabase, pingDatabase } from './config/database';
import { closeRedis, pingRedis } from './config/redis';

/**
 * Entry point Backend_Server.
 * Memuat konfigurasi, memverifikasi dependensi, dan menjalankan server.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const app = createApp();
  const server = createServer(app, config);

  // Verifikasi dependensi (non-fatal di pengembangan agar server tetap naik).
  const [dbOk, redisOk] = await Promise.all([pingDatabase(), pingRedis()]);
  if (!dbOk) {
    logger.warn('PostgreSQL belum dapat dijangkau saat startup.');
  }
  if (!redisOk) {
    logger.warn('Redis belum dapat dijangkau saat startup.');
  }

  server.listen(config.port, config.host, () => {
    const scheme = config.tls.enabled ? 'https' : 'http';
    logger.info('Backend_Server berjalan', {
      url: `${scheme}://${config.host}:${config.port}`,
      env: config.nodeEnv,
    });
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info('Menerima sinyal shutdown', { signal });
    server.close(async () => {
      await Promise.allSettled([closeDatabase(), closeRedis()]);
      logger.info('Server berhenti dengan rapi.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('Gagal menjalankan server', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
