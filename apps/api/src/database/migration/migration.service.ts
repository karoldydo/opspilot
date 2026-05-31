import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { databaseConfig, DatabaseConfig } from '../../config/database.config';
import { DATABASE_CONNECTION, DatabaseConnection } from '../providers/database-connection.provider';
import { DATABASE_EXISTED } from '../providers/database-existed.provider';
import { MIGRATIONS_FOLDER } from '../providers/migrations-folder.provider';

@Injectable()
export class MigrationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MigrationService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly databaseConnection: DatabaseConnection,
    @Inject(DATABASE_EXISTED) private readonly databaseExisted: boolean,
    @Inject(MIGRATIONS_FOLDER) private readonly migrationsFolder: string,
    @Inject(databaseConfig.KEY) private readonly config: DatabaseConfig
  ) {}

  // runs after the connection is built, before app.listen(). each step logs
  // what failed then rethrows — fail-fast, but the error isn't anonymous.
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.backupGate();
    } catch (error) {
      this.logger.error(`db backup failed for ${this.config.path}`, error instanceof Error ? error.stack : error);
      throw error;
    }
    try {
      migrate(this.databaseConnection, { migrationsFolder: this.migrationsFolder });
    } catch (error) {
      this.logger.error(`migration failed from ${this.migrationsFolder}`, error instanceof Error ? error.stack : error);
      throw error;
    }
    this.logger.log('migrations applied');
  }

  // snapshot an existing db only when migrations are pending — keeps restart
  // loops from filling /data with redundant pre-migration backups.
  private async backupGate(): Promise<void> {
    if (!this.databaseExisted || !this.hasPendingMigrations()) {
      return;
    }
    // flatten the iso timestamp (colons/dots are illegal on windows); pid suffix
    // avoids same-millisecond boots overwriting each other. timestamp leads so
    // the lexical sort stays chronological.
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${this.config.path}.${timestamp}.${process.pid}.bak`;
    // wal-aware online backup on the raw handle; fs.copyFile could miss the -wal sidecar.
    await this.databaseConnection.$client.backup(backupPath);
    this.logger.log(`db backed up to ${backupPath}`);
    this.pruneBackups();
  }

  // pending = journal lists more migrations than __drizzle_migrations has applied.
  // that table is absent until the first migration runs, so absent means zero.
  private hasPendingMigrations(): boolean {
    const journalPath = join(this.migrationsFolder, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries?: unknown[] };
    const total = journal.entries?.length ?? 0;
    return total > this.appliedMigrationCount();
  }

  private appliedMigrationCount(): number {
    const table = this.databaseConnection.$client
      .prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get('__drizzle_migrations') as { count: number };
    if (table.count === 0) {
      return 0;
    }
    const applied = this.databaseConnection.$client
      .prepare('SELECT count(*) AS count FROM __drizzle_migrations')
      .get() as {
      count: number;
    };
    return applied.count;
  }

  // keep the newest backupRetention snapshots; flattened-iso names sort oldest-first.
  private pruneBackups(): void {
    const dir = dirname(this.config.path);
    const base = basename(this.config.path);
    const backups = readdirSync(dir)
      .filter((file) => file.startsWith(`${base}.`) && file.endsWith('.bak'))
      .sort();
    for (const stale of backups.slice(0, -this.config.backupRetention)) {
      rmSync(join(dir, stale));
    }
  }
}
