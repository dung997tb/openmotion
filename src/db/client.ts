import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema/index.ts';

const { Pool } = pg;

export type DbSchema = typeof schema;
export type Database = NodePgDatabase<DbSchema>;
export type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DbExecutor = Database | DbTransaction;

export interface DbPoolOptions {
  connectionString: string;
  max?: number;
  idleTimeoutMs?: number;
  connectionTimeoutMs?: number;
  allowExitOnIdle?: boolean;
}

export interface DbHandle {
  readonly pool: pg.Pool;
  readonly db: Database;
  checkHealth(): Promise<boolean>;
  close(): Promise<void>;
}

export function createDbPool(options: DbPoolOptions): pg.Pool {
  return new Pool({
    connectionString: options.connectionString,
    max: options.max ?? 20,
    idleTimeoutMillis: options.idleTimeoutMs ?? 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 10_000,
    allowExitOnIdle: options.allowExitOnIdle ?? false,
  });
}

export function createDb(pool: pg.Pool): Database {
  return drizzle(pool, { schema });
}

export function createDbHandle(options: DbPoolOptions): DbHandle {
  const pool = createDbPool(options);
  const db = createDb(pool);
  return {
    pool,
    db,
    async checkHealth(): Promise<boolean> {
      const client = await pool.connect();
      try {
        await client.query('SELECT 1');
        return true;
      } finally {
        client.release();
      }
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}
