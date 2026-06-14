import { databaseConfig, DatabaseConfig } from '@api/config/database.config';
import * as schema from '@api/core/database/schema';
import { Provider } from '@nestjs/common';
import Database from 'better-sqlite3';
import { BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { DATABASE_EXISTED } from './database-existed.provider';

export const DATABASE_CONNECTION = 'DATABASE_CONNECTION';

export type DatabaseConnection = { $client: InstanceType<typeof Database> } & BetterSQLite3Database<typeof schema>;

// one better-sqlite3 connection with wal, exposed as the drizzle instance.
// the driver is synchronous — no await.
export const databaseConnectionProvider: Provider = {
  inject: [databaseConfig.KEY, DATABASE_EXISTED],
  provide: DATABASE_CONNECTION,
  useFactory: (config: DatabaseConfig): DatabaseConnection => {
    const path = config.path;
    // better-sqlite3 creates the file but not its parent dir — ensure it exists.
    const dir = dirname(path);
    if (dir && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const sqlite = new Database(path);
    // wal for read/write concurrency; foreign keys on for referential integrity.
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    return drizzle(sqlite, { schema });
  },
};
