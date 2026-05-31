import { Provider } from '@nestjs/common';
import Database from 'better-sqlite3';
import { BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { ConfigService } from '../config/config.service';
import * as schema from './schema';

// injection token for the single app-scoped drizzle connection.
export const DATABASE = 'DATABASE';

// the drizzle instance type every later feature module injects.
export type DatabaseConnection = BetterSQLite3Database<typeof schema>;

// constructs one better-sqlite3 connection with WAL enabled and exposes the
// drizzle(...) instance as a single injectable provider (drizzle.md).
// better-sqlite3 is synchronous — no await on the driver.
export const databaseProvider: Provider = {
  inject: [ConfigService],
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
