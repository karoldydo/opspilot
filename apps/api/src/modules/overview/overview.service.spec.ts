import { ConfigModule } from '@api/config/config.module';
import { databaseConfig } from '@api/config/database.config';
import { DatabaseModule } from '@api/core/database/database.module';
import { MigrationService } from '@api/core/database/migration/migration.service';
import { DATABASE_CONNECTION, DatabaseConnection } from '@api/core/database/providers/database-connection.provider';
import { auditLog } from '@api/core/database/schema/audit-log.schema';
import { user } from '@api/core/database/schema/auth.schema';
import { device } from '@api/core/database/schema/device.schema';
import { runRecord } from '@api/core/database/schema/run-record.schema';
import { service } from '@api/core/database/schema/service.schema';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditAction, DiagnosisSynthesis } from '@opspilot/shared';
import { randomUUID } from 'node:crypto';
import { readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { OverviewService } from './overview.service';

describe('OverviewService', () => {
  const userId = 'user-1';
  const otherUserId = 'user-2';
  const deviceId = 'device-1';
  const serviceId = 'service-1';
  const synthesis: DiagnosisSynthesis = {
    problems: [],
    status: 'healthy',
    suggestions: [],
    summary: 'all good',
  };

  let moduleRef: TestingModule;
  let db: DatabaseConnection;
  let overviewService: OverviewService;
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

  // insert one skill.run audit row with an explicit timestamp + outcome metadata.
  function seedSkillRun(owner: string, outcome: string, createdAt: Date): void {
    db.insert(auditLog)
      .values({
        action: 'skill.run' satisfies AuditAction,
        createdAt,
        id: randomUUID(),
        metadata: JSON.stringify({ outcome, skillName: 'restart' }),
        targetId: serviceId,
        targetType: 'service',
        userId: owner,
      })
      .run();
  }

  // insert one run_record with an explicit timestamp + (nullable) duration.
  function seedRun(owner: string, durationMs: null | number, createdAt: Date): void {
    db.insert(runRecord)
      .values({
        createdAt,
        deviceId,
        durationMs,
        id: randomUUID(),
        serviceId,
        synthesis: JSON.stringify(synthesis),
        userId: owner,
      })
      .run();
  }

  beforeEach(async () => {
    dbPath = join(tmpdir(), `opspilot-overview-test-${process.pid}-${Date.now()}.db`);
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule],
      providers: [OverviewService],
    })
      .overrideProvider(databaseConfig.KEY)
      .useValue({ backupRetention: 5, path: dbPath })
      .compile();
    db = moduleRef.get<DatabaseConnection>(DATABASE_CONNECTION);
    // apply real migrations (through 0008 run_record.duration_ms).
    await moduleRef.get(MigrationService).onApplicationBootstrap();
    overviewService = moduleRef.get(OverviewService);
    // satisfy the user/device/service foreign keys (fk pragma on).
    db.insert(user).values({ email: 'u1@example.com', id: userId, name: 'u1' }).run();
    db.insert(user).values({ email: 'u2@example.com', id: otherUserId, name: 'u2' }).run();
    db.insert(device).values({ host: '10.0.0.1', id: deviceId, name: 'nas' }).run();
    db.insert(service).values({ containerName: 'nginx', deviceId, id: serviceId, name: 'nginx' }).run();
  });

  afterEach(async () => {
    db?.$client.close();
    await moduleRef?.close();
    cleanupTempFiles();
  });

  it('returns zeroed metrics on a fresh install', () => {
    expect(overviewService.metrics(userId)).toEqual({
      avgDiagnoseMs: null,
      skillRuns24h: { count: 0, successRate: 0 },
    });
  });

  it('counts skill runs in the trailing 24h and computes the success rate', () => {
    const now = Date.now();
    seedSkillRun(userId, 'succeeded', new Date(now - 60_000));
    seedSkillRun(userId, 'succeeded', new Date(now - 120_000));
    seedSkillRun(userId, 'succeeded', new Date(now - 180_000));
    seedSkillRun(userId, 'failed', new Date(now - 240_000));

    const metrics = overviewService.metrics(userId);
    expect(metrics.skillRuns24h.count).toBe(4);
    expect(metrics.skillRuns24h.successRate).toBeCloseTo(0.75);
  });

  it('excludes skill runs older than 24h from the count', () => {
    const now = Date.now();
    seedSkillRun(userId, 'succeeded', new Date(now - 60_000));
    // just outside the window — must not be counted.
    seedSkillRun(userId, 'succeeded', new Date(now - 25 * 60 * 60 * 1000));

    expect(overviewService.metrics(userId).skillRuns24h.count).toBe(1);
  });

  it('scopes skill runs and diagnose durations to the authed user', () => {
    const now = Date.now();
    seedSkillRun(otherUserId, 'succeeded', new Date(now - 60_000));
    seedRun(otherUserId, 5000, new Date(now - 60_000));

    expect(overviewService.metrics(userId)).toEqual({
      avgDiagnoseMs: null,
      skillRuns24h: { count: 0, successRate: 0 },
    });
  });

  it('averages run durations over the recent window, ignoring null durations', () => {
    const now = Date.now();
    seedRun(userId, 10_000, new Date(now - 60_000));
    seedRun(userId, 20_000, new Date(now - 120_000));
    // null duration (predates the column) — excluded from the average.
    seedRun(userId, null, new Date(now - 180_000));

    expect(overviewService.metrics(userId).avgDiagnoseMs).toBe(15_000);
  });

  it('excludes diagnose runs older than the 7-day window from the average', () => {
    const now = Date.now();
    seedRun(userId, 10_000, new Date(now - 60_000));
    // just outside the 7-day window — must not skew the average.
    seedRun(userId, 90_000, new Date(now - 8 * 24 * 60 * 60 * 1000));

    expect(overviewService.metrics(userId).avgDiagnoseMs).toBe(10_000);
  });
});
