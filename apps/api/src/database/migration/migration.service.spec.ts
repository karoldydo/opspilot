import { Test, TestingModule } from '@nestjs/testing';
import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { ConfigModule } from '../../config/config.module';
import { databaseConfig } from '../../config/database.config';
import { DatabaseModule } from '../database.module';
import { DATABASE_CONNECTION, DatabaseConnection } from '../providers/database-connection.provider';
import { MIGRATIONS_FOLDER } from '../providers/migrations-folder.provider';
import { MigrationService } from './migration.service';

// integration: prove migrate() runs clean against the empty journal, that the
// backup gate fires only when migrations are pending, and that snapshots are
// pruned to the retention cap.
describe('MigrationService', () => {
  let moduleRef: TestingModule;
  let db: DatabaseConnection;
  let dbPath: string;
  let migrationsFolder: string;

  // a migrations folder with an empty journal (nothing to apply).
  function emptyMigrations(): string {
    const folder = join(tmpdir(), `opspilot-mig-empty-${process.pid}-${Date.now()}`);
    mkdirSync(join(folder, 'meta'), { recursive: true });
    writeFileSync(
      join(folder, 'meta', '_journal.json'),
      JSON.stringify({ dialect: 'sqlite', entries: [], version: '7' })
    );
    return folder;
  }

  // a migrations folder with one real, applyable migration + journal entry.
  function oneMigration(): string {
    const folder = join(tmpdir(), `opspilot-mig-one-${process.pid}-${Date.now()}`);
    mkdirSync(join(folder, 'meta'), { recursive: true });
    writeFileSync(
      join(folder, 'meta', '_journal.json'),
      JSON.stringify({
        dialect: 'sqlite',
        entries: [{ breakpoints: true, idx: 0, tag: '0000_init', version: '6', when: 1700000000000 }],
        version: '7',
      })
    );
    writeFileSync(join(folder, '0000_init.sql'), 'CREATE TABLE probe (id integer PRIMARY KEY);');
    return folder;
  }

  // build the module against the temp-db path + folder and trigger bootstrap.
  async function boot(): Promise<void> {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule],
    })
      .overrideProvider(databaseConfig.KEY)
      .useValue({ backupRetention: 5, path: dbPath })
      .overrideProvider(MIGRATIONS_FOLDER)
      .useValue(migrationsFolder)
      .compile();
    db = moduleRef.get<DatabaseConnection>(DATABASE_CONNECTION);
    await moduleRef.get(MigrationService).onApplicationBootstrap();
  }

  function backupCount(): number {
    const dir = dirname(dbPath);
    const base = basename(dbPath);
    return readdirSync(dir).filter((file) => file.startsWith(`${base}.`) && file.endsWith('.bak')).length;
  }

  // remove the temp db plus its -wal/-shm sidecars, any *.bak snapshots, and the
  // temp migrations folder.
  function cleanupTempFiles(): void {
    const dir = dirname(dbPath);
    const base = basename(dbPath);
    for (const file of readdirSync(dir)) {
      if (file.startsWith(base)) {
        rmSync(join(dir, file));
      }
    }
    rmSync(migrationsFolder, { force: true, recursive: true });
  }

  afterEach(async () => {
    db?.$client.close();
    await moduleRef?.close();
    cleanupTempFiles();
  });

  it('runs migrate() clean against the empty journal and skips backup on a fresh db', async () => {
    dbPath = join(tmpdir(), `opspilot-mig-test-${process.pid}-${Date.now()}.db`);
    migrationsFolder = emptyMigrations();
    await boot();
    // first run: no pre-existing file, so the backup gate is skipped.
    expect(backupCount()).toBe(0);
    // migrate() ran without throwing against the empty journal.
    const row = db.$client.prepare('SELECT 1 AS value').get() as { value: number };
    expect(row.value).toBe(1);
  });

  it('skips the backup when a pre-existing db has no pending migrations', async () => {
    dbPath = join(tmpdir(), `opspilot-mig-test-${process.pid}-${Date.now()}-noop.db`);
    migrationsFolder = emptyMigrations();
    // pre-create a real sqlite file: the file pre-exists but the empty journal
    // means nothing is pending, so the gate must not snapshot (f3 fix).
    new Database(dbPath).close();
    await boot();
    expect(backupCount()).toBe(0);
  });

  it('snapshots a pre-existing db with a pending migration, then prunes to the retention cap', async () => {
    dbPath = join(tmpdir(), `opspilot-mig-test-${process.pid}-${Date.now()}-pending.db`);
    migrationsFolder = oneMigration();
    new Database(dbPath).close();
    // seed more stale snapshots than the retention cap (5) with older timestamps
    // so the prune has something to remove (older flattened-iso names sort first).
    for (let day = 1; day <= 6; day++) {
      writeFileSync(`${dbPath}.2020-01-0${day}T00-00-00-000Z.bak`, '');
    }
    await boot();
    // gate fired (pending migration) and the prune capped the total at retention:
    // 6 stale + 1 fresh = 7, pruned down to the newest 5.
    expect(backupCount()).toBe(5);
  });
});
