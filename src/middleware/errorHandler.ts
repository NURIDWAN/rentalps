import { NextFunction, Request, Response } from 'express';
import { logger } from '../config/logger';

/**
 * Error aplikasi dengan kode status HTTP. Service melempar ini untuk
 * memetakan kegagalan ke kode status konsisten (lihat design.md Error Handling).
 */
export class AppError extends Error {
  public readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
  }
}

/**
 * Handler 404 untuk route yang tidak dikenal.
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: 'NOT_FOUND',
    message: `Rute tidak ditemukan: ${req.method} ${req.path}`,
  });
}

/**
 * Handler error terpusat. Mengembalikan pesan dalam Bahasa Indonesia.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: 'APP_ERROR',
      message: err.message,
    });
    return;
  }

  logger.error('Kesalahan internal tidak tertangani', {
    error: err instanceof Error ? err.message : String(err),
  });

  res.status(500).json({
    error: 'INTERNAL_SERVER_ERROR',
    message: 'Terjadi kesalahan internal pada server.',
  });
}
