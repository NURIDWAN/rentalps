import { Router } from 'express';
import { pingDatabase } from '../config/database';
import { pingRedis } from '../config/redis';

/**
 * Endpoint health check untuk memverifikasi server, PostgreSQL, dan Redis.
 */
export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'ps-rental-control-backend' });
});

healthRouter.get('/health/ready', async (_req, res) => {
  const [db, redis] = await Promise.all([pingDatabase(), pingRedis()]);
  const ready = db && redis;
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    dependencies: {
      postgres: db ? 'up' : 'down',
      redis: redis ? 'up' : 'down',
    },
  });
});
