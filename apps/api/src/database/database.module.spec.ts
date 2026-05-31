import { Test, TestingModule } from '@nestjs/testing';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConfigModule } from '../config/config.module';
import { ConfigService } from '../config/config.service';
import { DatabaseModule } from './database.module';
import { DATABASE, DatabaseConnection } from './database.providers';

// integration: prove the connection opens against a temp-file db, the wal pragma
// is set, and a trivial query runs — the contract every later slice depends on.
describe('DatabaseModule', () => {
  let moduleRef: TestingModule;
  let db: DatabaseConnection;
  let dbPath: string;

  beforeEach(async () => {
    // temp-db seam: never let the default ./data/opspilot.db be opened in ci.
    dbPath = join(tmpdir(), `opspilot-db-test-${process.pid}-${Date.now()}.db`);
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule],
    })
      .overrideProvider(ConfigService)
      .useValue({ databasePath: dbPath, port: 3000 })
      .compile();
    db = moduleRef.get<DatabaseConnection>(DATABASE);
  });

  afterEach(async () => {
    db.$client.close();
    await moduleRef.close();
    // clean up the temp file + wal/shm sidecars.
    for (const suffix of ['', '-wal', '-shm']) {
      const path = `${dbPath}${suffix}`;
      if (existsSync(path)) {
        rmSync(path);
      }
    }
  });

  it('opens the connection in WAL journal mode', () => {
    expect(db.$client.pragma('journal_mode', { simple: true })).toBe('wal');
  });

  it('runs a trivial query against the connection', () => {
    const row = db.$client.prepare('SELECT 1 AS value').get() as { value: number };
    expect(row.value).toBe(1);
  });
});
