import express, { Application, NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { healthRouter } from './routes/health';
import { mvpRouter } from './routes/mvp';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

/**
 * Membangun dan mengkonfigurasi instance aplikasi Express.
 * Dipisahkan dari bootstrap server agar dapat diuji secara terisolasi.
 */
export function createApp(): Application {
  const app = express();

  // Header keamanan dasar.
  app.use(helmet());

  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    if (req.method === 'OPTIONS') {
      res.status(204).send();
      return;
    }
    next();
  });

  // Parsing body JSON.
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Rute aplikasi.
  app.use('/api', healthRouter);
  app.use('/api', mvpRouter);

  // 404 + error handler harus didaftarkan paling akhir.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
