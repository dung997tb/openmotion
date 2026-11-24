import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { isMain } from '../../shared/entry.ts';
import { createDb, createDbPool } from './client.ts';

const MIGRATION_LOCK_KEY = 'openmotion:db:migrate';
const DEFAULT_MIGRATIONS_FOLDER = fileURLToPath(new URL('./migrations', import.meta.url));

export interface RunMigrationsOptions {
  connectionString?: string;
  migrationsFolder?: string;
}

/**
 * Programmatically apply SQL migrations from `src/db/migrations` under a PostgreSQL
 * session-level advisory lock so concurrent container startups serialize safely.
 */
export async function runMigrations(options: RunMigrationsOptions = {}): Promise<void> {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to run database migrations.');
  }
  const migrationsFolder = path.resolve(options.migrationsFolder ?? DEFAULT_MIGRATIONS_FOLDER);
  const pool = createDbPool({
    connectionString,
    max: 2,
    allowExitOnIdle: true,
  });
  const lockClient = await pool.connect();
  try {
    await lockClient.query('SELECT pg_advisory_lock(hashtext($1))', [MIGRATION_LOCK_KEY]);
    try {
      const db = createDb(pool);
      await migrate(db, { migrationsFolder });
    } finally {
      await lockClient.query('SELECT pg_advisory_unlock(hashtext($1))', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    lockClient.release();
    await pool.end();
  }
}

if (isMain(import.meta.url)) {
  runMigrations()
    .then(() => {
      process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: 'Database migrations applied' }) + '\n');
    })
    .catch((error) => {
      process.stderr.write(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: 'error',
          msg: 'Database migration failed',
          error: error instanceof Error ? error.message : String(error),
        }) + '\n',
      );
      process.exitCode = 1;
    });
}
