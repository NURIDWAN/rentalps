import dotenv from 'dotenv';

dotenv.config();

/**
 * Konfigurasi environment terpusat dan tervalidasi.
 * Seluruh akses ke process.env dilakukan melalui modul ini.
 */

function readString(key: string, fallback?: string): string {
  const value = process.env[key];
  if (value === undefined || value === '') {
    if (fallback !== undefined) {
      return fallback;
    }
    throw new Error(`Variabel environment wajib tidak ditemukan: ${key}`);
  }
  return value;
}

function readNumber(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`Variabel environment ${key} harus berupa angka, diterima: ${raw}`);
  }
  return parsed;
}

function readBoolean(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

export type SecureVersion = 'TLSv1.2' | 'TLSv1.3';

export interface TlsConfig {
  enabled: boolean;
  keyPath: string;
  certPath: string;
  /** Versi TLS minimum. Dibatasi minimal TLSv1.2 sesuai Req 12.4. */
  minVersion: SecureVersion;
}

export interface PostgresConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  poolMax: number;
}

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db: number;
}

export interface AppConfig {
  nodeEnv: string;
  port: number;
  host: string;
  tls: TlsConfig;
  postgres: PostgresConfig;
  redis: RedisConfig;
  jwt: {
    secret: string;
    expiresIn: string;
  };
}

/**
 * Memastikan versi TLS minimum tidak pernah di bawah TLSv1.2 (Req 12.4).
 * Jika dikonfigurasi dengan nilai lebih rendah, dipaksa ke TLSv1.2.
 */
function normalizeTlsMinVersion(raw: string): SecureVersion {
  const normalized = raw.trim();
  if (normalized === 'TLSv1.3') {
    return 'TLSv1.3';
  }
  // Tolak TLSv1.0 / TLSv1.1 / nilai lain — paksa ke baseline aman.
  return 'TLSv1.2';
}

let cached: AppConfig | undefined;

export function loadConfig(): AppConfig {
  if (cached) {
    return cached;
  }

  cached = {
    nodeEnv: readString('NODE_ENV', 'development'),
    port: readNumber('PORT', 8443),
    host: readString('HOST', '0.0.0.0'),
    tls: {
      enabled: readBoolean('TLS_ENABLED', false),
      keyPath: readString('TLS_KEY_PATH', 'certs/server.key'),
      certPath: readString('TLS_CERT_PATH', 'certs/server.crt'),
      minVersion: normalizeTlsMinVersion(readString('TLS_MIN_VERSION', 'TLSv1.2')),
    },
    postgres: {
      host: readString('PGHOST', 'localhost'),
      port: readNumber('PGPORT', 5432),
      database: readString('PGDATABASE', 'ps_rental'),
      user: readString('PGUSER', 'ps_rental'),
      password: readString('PGPASSWORD', ''),
      ssl: readString('PGSSLMODE', 'disable') !== 'disable',
      poolMax: readNumber('PG_POOL_MAX', 10),
    },
    redis: {
      host: readString('REDIS_HOST', 'localhost'),
      port: readNumber('REDIS_PORT', 6379),
      password: process.env.REDIS_PASSWORD || undefined,
      db: readNumber('REDIS_DB', 0),
    },
    jwt: {
      secret: readString('JWT_SECRET', 'dev_insecure_secret_change_me'),
      expiresIn: readString('JWT_EXPIRES_IN', '8h'),
    },
  };

  return cached;
}
