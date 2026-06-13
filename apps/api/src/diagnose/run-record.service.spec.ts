import { Test, TestingModule } from '@nestjs/testing';
import { DiagnosisSynthesis } from '@opspilot/shared';
import { readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { ConfigModule } from '../config/config.module';
import { databaseConfig } from '../config/database.config';
import { llmConfig } from '../config/llm.config';
import { DatabaseModule } from '../database/database.module';
import { MigrationService } from '../database/migration/migration.service';
import { DATABASE_CONNECTION, DatabaseConnection } from '../database/providers/database-connection.provider';
import { user } from '../database/schema/auth.schema';
import { device } from '../database/schema/device.schema';
import { service } from '../database/schema/service.schema';
import { RunRecordService } from './run-record.service';

describe('RunRecordService', () => {
  const retention = 3;
  const deviceId = 'device-1';
  const serviceId = 'service-1';
  const userId = 'user-1';
  const synthesis: DiagnosisSynthesis = {
    problems: ['disk full'],
    status: 'degraded',
    suggestions: ['free space'],
    summary: 'the service is degraded',
  };

  let moduleRef: TestingModule;
  let db: DatabaseConnection;
  let runRecordService: RunRecordService;
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

  // createdAt is millisecond-precision; space inserts so ordering is deterministic
  // (production runs are seconds apart — collisions only happen in tight test loops).
  function delay(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 3));
  }

  beforeEach(async () => {
    dbPath = join(tmpdir(), `opspilot-run-record-test-${process.pid}-${Date.now()}.db`);
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule],
      providers: [RunRecordService],
    })
      .overrideProvider(databaseConfig.KEY)
      .useValue({ backupRetention: 5, path: dbPath })
      .overrideProvider(llmConfig.KEY)
      .useValue({ historyRetention: retention })
      .compile();
    db = moduleRef.get<DatabaseConnection>(DATABASE_CONNECTION);
    // apply real migrations (through 0004 run_record).
    await moduleRef.get(MigrationService).onApplicationBootstrap();
    runRecordService = moduleRef.get(RunRecordService);
    // satisfy the user/device/service foreign keys (fk pragma on).
    db.insert(user).values({ email: 'u1@example.com', id: userId, name: 'u1' }).run();
    db.insert(device).values({ host: '10.0.0.1', id: deviceId, name: 'nas' }).run();
    db.insert(service).values({ containerName: 'nginx', deviceId, id: serviceId, name: 'nginx' }).run();
  });

  afterEach(async () => {
    db?.$client.close();
    await moduleRef?.close();
    cleanupTempFiles();
  });

  it('creates a run and returns the iso-normalized contract without userId', () => {
    const actual = runRecordService.create({ deviceId, serviceId, synthesis, userId });

    expect(actual).toEqual({
      createdAt: expect.any(String),
      deviceId,
      id: expect.any(String),
      serviceId,
      synthesis,
    });
    // createdAt is an iso string on the wire, never a Date; userId never surfaces.
    expect(() => new Date(actual.createdAt).toISOString()).not.toThrow();
    expect(actual).not.toHaveProperty('userId');
  });

  it('prunes older runs beyond retention, keeping the newest historyRetention', async () => {
    const ids: string[] = [];
    for (let i = 0; i < retention + 3; i++) {
      ids.push(runRecordService.create({ deviceId, serviceId, synthesis, userId }).id);
      await delay();
    }

    const surviving = runRecordService.findRecent(deviceId, serviceId, 100);
    expect(surviving).toHaveLength(retention);
    // the newest `retention` insertions survive; the oldest are pruned.
    expect(surviving.map((r) => r.id)).toEqual(ids.slice(-retention).reverse());
  });

  it('findRecent returns newest-first and respects the limit', async () => {
    const first = runRecordService.create({ deviceId, serviceId, synthesis, userId });
    await delay();
    const second = runRecordService.create({ deviceId, serviceId, synthesis, userId });

    const actual = runRecordService.findRecent(deviceId, serviceId, 1);
    expect(actual).toHaveLength(1);
    expect(actual[0].id).toBe(second.id);
    expect(actual[0].id).not.toBe(first.id);
  });

  it('findRecent is scoped to the owning device + service', () => {
    db.insert(service).values({ containerName: 'redis', deviceId, id: 'service-2', name: 'redis' }).run();
    runRecordService.create({ deviceId, serviceId, synthesis, userId });
    runRecordService.create({ deviceId, serviceId: 'service-2', synthesis, userId });

    expect(runRecordService.findRecent(deviceId, serviceId)).toHaveLength(1);
    expect(runRecordService.findRecent(deviceId, 'service-2')).toHaveLength(1);
    // a different device never sees this device's runs.
    expect(runRecordService.findRecent('device-other', serviceId)).toHaveLength(0);
  });
});
