import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { ConfigService } from '../config/config.service';
import { DATABASE, DATABASE_FILE_PREEXISTED, DatabaseConnection } from './database.providers';

// runs migrate() on bootstrap behind a backup gate. forward-only sqlite has no
// auto-rollback (infrastructure.md), so a pre-existing db file is snapshotted
// before migrations apply — the at-rest safety net.
@Injectable()
export class MigrationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MigrationService.name);

  constructor(
    @Inject(DATABASE) private readonly db: DatabaseConnection,
    @Inject(DATABASE_FILE_PREEXISTED) private readonly dbFilePreexisted: boolean,
    // explicit token: vitest transforms with esbuild (no emitDecoratorMetadata),
    // so type-based DI would resolve to undefined — inject the class token directly.
    @Inject(ConfigService) private readonly config: ConfigService
  ) {}

  // runs after the connection provider is constructed, before app.listen().
  async onApplicationBootstrap(): Promise<void> {
    await this.backupGate();
    migrate(this.db, { migrationsFolder: this.migrationsFolder() });
    this.logger.log('migrations applied');
  }

  // snapshot an existing db before migrating; skip silently on first run.
  private async backupGate(): Promise<void> {
    if (!this.dbFilePreexisted) {
      return;
    }
    // colons/dots are illegal in windows filenames — flatten the iso timestamp.
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${this.config.databasePath}.${timestamp}.bak`;
    // wal-aware online backup on the raw handle — a plain fs.copyFile can miss
    // data still in the -wal sidecar since the connection is already open in wal.
    await this.db.$client.backup(backupPath);
    this.logger.log(`db backed up to ${backupPath}`);
  }

  // bundle-relative next to main.js in the container / nx serve; repo path under
  // vitest, where cwd is the project root (apps/api) or the workspace root.
  private migrationsFolder(): string {
    const candidates = [
      join(__dirname, 'migrations'),
      join(process.cwd(), 'migrations'),
      join(process.cwd(), 'apps', 'api', 'migrations'),
    ];
    return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
  }
}
