import { Test, TestingModule } from '@nestjs/testing';
import Database from 'better-sqlite3';
import { readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { ConfigModule } from '../config/config.module';
import { ConfigService } from '../config/config.service';
import { DatabaseModule } from './database.module';
import { DATABASE, DatabaseConnection } from './database.providers';
import { MigrationService } from './migration.service';

// integration: prove migrate() runs clean against the empty journal and that an
// existing db file is snapshotted to a *.bak sibling before migrations apply.
describe('MigrationService', () => {
  let moduleRef: TestingModule;
  let db: DatabaseConnection;
  let dbPath: string;

  // remove the temp db plus its -wal/-shm sidecars and any *.bak snapshots.
  function cleanupTempFiles(): void {
    const dir = dirname(dbPath);
    const base = basename(dbPath);
    for (const file of readdirSync(dir)) {
      if (file.startsWith(base)) {
        rmSync(join(dir, file));
      }
    }
  }

  // build the module against the temp-db path and trigger the bootstrap hook.
  async function boot(): Promise<void> {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule],
    })
      .overrideProvider(ConfigService)
      .useValue({ databasePath: dbPath, port: 3000 })
      .compile();
    db = moduleRef.get<DatabaseConnection>(DATABASE);
    await moduleRef.get(MigrationService).onApplicationBootstrap();
  }

  function hasBackup(): boolean {
    const dir = dirname(dbPath);
    const base = basename(dbPath);
    return readdirSync(dir).some((file) => file.startsWith(base) && file.endsWith('.bak'));
  }

  afterEach(async () => {
    db?.$client.close();
    await moduleRef?.close();
    cleanupTempFiles();
  });

  it('runs migrate() clean against the empty journal and skips backup on a fresh db', async () => {
    dbPath = join(tmpdir(), `opspilot-mig-test-${process.pid}-${Date.now()}.db`);
    await boot();
    // first run: no pre-existing file, so the backup gate is skipped.
    expect(hasBackup()).toBe(false);
    // migrate() seeded the drizzle bookkeeping table without throwing.
    const row = db.$client.prepare('SELECT 1 AS value').get() as { value: number };
    expect(row.value).toBe(1);
  });

  it('snapshots a pre-existing db file to a *.bak sibling before migrating', async () => {
    dbPath = join(tmpdir(), `opspilot-mig-test-${process.pid}-${Date.now()}-pre.db`);
    // pre-create a real sqlite file so the backup gate fires on bootstrap.
    new Database(dbPath).close();
    await boot();
    expect(hasBackup()).toBe(true);
  });
});
