import { ConfigModule } from '@api/config/config.module';
import { databaseConfig } from '@api/config/database.config';
import { Test, TestingModule } from '@nestjs/testing';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DatabaseModule } from './database.module';
import { DATABASE_CONNECTION, DatabaseConnection } from './providers/database-connection.provider';

// integration: prove the connection opens against a temp-file db, the wal pragma
// is set, and a trivial query runs — the contract every later slice depends on.
describe('DatabaseModule', () => {
  let testingModule: TestingModule;
  let databaseConnection: DatabaseConnection;
  let dbPath: string;

  beforeEach(async () => {
    // temp-db seam: never let the default ./data/opspilot.db be opened in ci.
    dbPath = join(tmpdir(), `opspilot-db-test-${process.pid}-${Date.now()}.db`);
    testingModule = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule],
    })
      .overrideProvider(databaseConfig.KEY)
      .useValue({ path: dbPath })
      .compile();
    databaseConnection = testingModule.get<DatabaseConnection>(DATABASE_CONNECTION);
  });

  afterEach(async () => {
    databaseConnection.$client.close();
    await testingModule.close();
    // clean up the temp file + wal/shm sidecars.
    for (const suffix of ['', '-wal', '-shm']) {
      const path = `${dbPath}${suffix}`;
      if (existsSync(path)) {
        rmSync(path);
      }
    }
  });

  it('opens the connection in WAL journal mode', () => {
    expect(databaseConnection.$client.pragma('journal_mode', { simple: true })).toBe('wal');
  });

  it('runs a trivial query against the connection', () => {
    const row = databaseConnection.$client.prepare('SELECT 1 AS value').get() as { value: number };
    expect(row.value).toBe(1);
  });
});
