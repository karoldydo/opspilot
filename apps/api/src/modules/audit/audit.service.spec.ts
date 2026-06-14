import { ConfigModule } from '@api/config/config.module';
import { databaseConfig } from '@api/config/database.config';
import { DatabaseModule } from '@api/core/database/database.module';
import { MigrationService } from '@api/core/database/migration/migration.service';
import { DATABASE_CONNECTION, DatabaseConnection } from '@api/core/database/providers/database-connection.provider';
import { user } from '@api/core/database/schema/auth.schema';
import { device } from '@api/core/database/schema/device.schema';
import { runRecord } from '@api/core/database/schema/run-record.schema';
import { service } from '@api/core/database/schema/service.schema';
import { Test, TestingModule } from '@nestjs/testing';
import { DiagnosisSynthesis } from '@opspilot/shared';
import { randomUUID } from 'node:crypto';
import { readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { AuditService } from './audit.service';

describe('AuditService', () => {
  const userId = 'user-1';
  const deviceId = 'device-1';
  const serviceId = 'service-1';
  const synthesis: DiagnosisSynthesis = {
    problems: ['disk full'],
    status: 'degraded',
    suggestions: ['free space'],
    summary: 'the service is degraded',
  };

  let moduleRef: TestingModule;
  let db: DatabaseConnection;
  let auditService: AuditService;
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

  beforeEach(async () => {
    dbPath = join(tmpdir(), `opspilot-audit-test-${process.pid}-${Date.now()}.db`);
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule],
      providers: [AuditService],
    })
      .overrideProvider(databaseConfig.KEY)
      .useValue({ backupRetention: 5, path: dbPath })
      .compile();
    db = moduleRef.get<DatabaseConnection>(DATABASE_CONNECTION);
    // apply real migrations (through 0007 audit_log).
    await moduleRef.get(MigrationService).onApplicationBootstrap();
    auditService = moduleRef.get(AuditService);
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

  it('records a row on the base connection and lists it back', () => {
    auditService.record({
      action: 'device.create',
      metadata: { name: 'nas' },
      targetId: deviceId,
      targetType: 'device',
      userId,
    });

    const events = auditService.list({ offset: 0 });
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      action: 'device.create',
      createdAt: expect.any(String),
      id: expect.any(String),
      metadata: { name: 'nas' },
      runRecordId: null,
      targetId: deviceId,
      targetType: 'device',
      userId,
    });
    // createdAt is an iso string on the wire, never a Date.
    expect(() => new Date(events[0].createdAt).toISOString()).not.toThrow();
  });

  it('joins the caller transaction: a throw after record() rolls the audit row back', () => {
    expect(() =>
      db.transaction((tx) => {
        auditService.record({ action: 'device.delete', targetId: deviceId, targetType: 'device', userId }, tx);
        throw new Error('forced rollback');
      })
    ).toThrow('forced rollback');

    // the insert ran through tx, so the rollback leaves no row.
    expect(auditService.list({ offset: 0 })).toHaveLength(0);
  });

  it('expands a run-linked row to the saved synthesis via the join', () => {
    const runRecordId = randomUUID();
    db.insert(runRecord)
      .values({ deviceId, id: runRecordId, serviceId, synthesis: JSON.stringify(synthesis), userId })
      .run();
    auditService.record({ action: 'diagnose.run', runRecordId, targetId: serviceId, targetType: 'service', userId });

    const events = auditService.list({ offset: 0 });
    expect(events).toHaveLength(1);
    expect(events[0].runRecordId).toBe(runRecordId);
    expect(events[0].synthesis).toEqual(synthesis);
  });

  it('filters by action and returns newest-first', async () => {
    auditService.record({ action: 'device.create', userId });
    await new Promise((resolve) => setTimeout(resolve, 3));
    auditService.record({ action: 'device.update', userId });

    const all = auditService.list({ offset: 0 });
    expect(all.map((e) => e.action)).toEqual(['device.update', 'device.create']);

    const filtered = auditService.list({ action: 'device.create', offset: 0 });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].action).toBe('device.create');
  });

  it('stores null metadata when none is provided', () => {
    auditService.record({ action: 'skill.run', targetId: serviceId, targetType: 'service', userId });

    const events = auditService.list({ offset: 0 });
    expect(events[0].metadata).toBeNull();
    expect(events[0].synthesis).toBeUndefined();
  });

  it('recordOnInvocation writes a tier-2 row on the base connection', () => {
    auditService.recordOnInvocation({
      action: 'service.scan',
      metadata: { found: 2 },
      targetId: deviceId,
      targetType: 'device',
      userId,
    });

    const events = auditService.list({ offset: 0 });
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('service.scan');
    expect(events[0].metadata).toEqual({ found: 2 });
  });

  it('recordOnInvocation swallows an insert failure so a successful op is not masked', () => {
    // a missing user violates the not-null user fk (pragma on) — record() throws, but
    // the tier-2 wrapper must log-and-swallow rather than propagate to the caller.
    expect(() => auditService.recordOnInvocation({ action: 'skill.run', userId: 'no-such-user' })).not.toThrow();
    expect(auditService.list({ offset: 0 })).toHaveLength(0);
  });
});
