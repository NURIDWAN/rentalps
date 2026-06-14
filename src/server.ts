import fs from 'fs';
import http from 'http';
import https from 'https';
import { Application } from 'express';
import { AppConfig } from './config/env';
import { logger } from './config/logger';

/**
 * Membuat server HTTP atau HTTPS sesuai konfigurasi.
 *
 * Req 12.4: seluruh komunikasi Mobile ↔ Backend menggunakan HTTPS/TLS 1.2+.
 * Ketika TLS diaktifkan, server menolak negosiasi di bawah TLSv1.2 melalui
 * opsi `minVersion` (dipaksa ke baseline aman di env loader).
 */
export function createServer(app: Application, config: AppConfig): http.Server | https.Server {
  if (!config.tls.enabled) {
    logger.warn(
      'TLS dinonaktifkan (TLS_ENABLED=false). Mode ini hanya untuk pengembangan lokal. ' +
        'Produksi WAJIB mengaktifkan HTTPS/TLS 1.2+ (Req 12.4).',
    );
    return http.createServer(app);
  }

  const key = fs.readFileSync(config.tls.keyPath);
  const cert = fs.readFileSync(config.tls.certPath);

  const server = https.createServer(
    {
      key,
      cert,
      // Penegakan TLS 1.2+ (Req 12.4). minVersion dijamin >= TLSv1.2 oleh env loader.
      minVersion: config.tls.minVersion,
      // honorCipherOrder agar preferensi cipher server diutamakan.
      honorCipherOrder: true,
    },
    app,
  );

  logger.info('Server HTTPS dikonfigurasi', { minTlsVersion: config.tls.minVersion });
  return server;
}
