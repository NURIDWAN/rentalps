import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { loadConfig } from './env';
import { logger } from './logger';

/**
 * Modul koneksi PostgreSQL.
 * Menyediakan connection pool tunggal untuk data persisten transaksional
 * (User, Unit, Rental_Session, dst — lihat design.md Data Models).
 */

let pool: Pool | undefined;

export function getPool(): Pool {
  if (pool) {
    return pool;
  }

  const { postgres } = loadConfig();

  pool = new Pool({
    host: postgres.host,
    port: postgres.port,
    database: postgres.database,
    user: postgres.user,
    password: postgres.password,
    max: postgres.poolMax,
    ssl: postgres.ssl ? { rejectUnauthorized: false } : undefined,
  });

  pool.on('error', (err) => {
    logger.error('Kesalahan tak terduga pada PostgreSQL pool', { error: err.message });
  });

  return pool;
}

/**
 * Menjalankan query parameterized (mencegah SQL injection).
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params as never[]);
}

/**
 * Menjalankan sekumpulan operasi dalam satu transaksi atomik.
 * Digunakan untuk perubahan Rental_Session + pencatatan transaksi
 * agar tidak terjadi state parsial (lihat design.md Error Handling).
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Verifikasi konektivitas database (digunakan oleh health check & startup).
 */
export async function pingDatabase(): Promise<boolean> {
  try {
    await query('SELECT 1');
    return true;
  } catch (err) {
    logger.error('Gagal terhubung ke PostgreSQL', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
