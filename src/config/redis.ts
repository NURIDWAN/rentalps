import Redis from 'ioredis';
import { loadConfig } from './env';
import { logger } from './logger';

/**
 * Modul koneksi Redis.
 * Redis dipakai sebagai penyimpanan job/queue untuk Timer_Engine
 * (penjadwalan event ambang & auto-shutdown) serta cache (lihat design.md).
 */

let client: Redis | undefined;

export function getRedis(): Redis {
  if (client) {
    return client;
  }

  const { redis } = loadConfig();

  client = new Redis({
    host: redis.host,
    port: redis.port,
    password: redis.password,
    db: redis.db,
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  });

  client.on('error', (err) => {
    logger.error('Kesalahan koneksi Redis', { error: err.message });
  });

  client.on('connect', () => {
    logger.info('Terhubung ke Redis', { host: redis.host, port: redis.port });
  });

  return client;
}

/**
 * Memastikan koneksi aktif. Aman dipanggil berulang (idempoten).
 */
export async function connectRedis(): Promise<void> {
  const redis = getRedis();
  if (redis.status === 'wait' || redis.status === 'end') {
    await redis.connect();
  }
}

export async function pingRedis(): Promise<boolean> {
  try {
    await connectRedis();
    const pong = await getRedis().ping();
    return pong === 'PONG';
  } catch (err) {
    logger.error('Gagal terhubung ke Redis', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = undefined;
  }
}
