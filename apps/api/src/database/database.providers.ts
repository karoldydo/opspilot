import { Provider } from '@nestjs/common';
import Database from 'better-sqlite3';
import { BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { ConfigService } from '../config/config.service';
import * as schema from './schema';

// injection token for the single app-scoped drizzle connection.
export const DATABASE = 'DATABASE';

// injection token for whether the db file already existed before the connection
// opened it — the backup gate skips the first-run snapshot when this is false.
export const DATABASE_FILE_PREEXISTED = 'DATABASE_FILE_PREEXISTED';

// the drizzle instance type every later feature module injects. $client (the raw
// better-sqlite3 handle, used for pragmas + the wal-aware backup) lives on the
// drizzle(...) return intersection, not on the bare class — restate it here.
export type DatabaseConnection = { $client: InstanceType<typeof Database> } & BetterSQLite3Database<typeof schema>;

// captures file existence BEFORE databaseProvider opens (and thereby creates)
// the file. databaseProvider depends on this token so nest resolves it first.
export const databaseFilePreexistedProvider: Provider = {
  inject: [ConfigService],
  provide: DATABASE_FILE_PREEXISTED,
  useFactory: (config: ConfigService): boolean => existsSync(config.databasePath),
};

// constructs one better-sqlite3 connection with WAL enabled and exposes the
// drizzle(...) instance as a single injectable provider (drizzle.md).
// better-sqlite3 is synchronous — no await on the driver.
export const databaseProvider: Provider = {
  inject: [ConfigService, DATABASE_FILE_PREEXISTED],
  provide: DATABASE,
  useFactory: (config: ConfigService): DatabaseConnection => {
    const path = config.databasePath;
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
