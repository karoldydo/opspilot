import { AllExceptionsFilter } from '@api/common/filters/all-exceptions.filter';
import { ConfigModule } from '@api/config/config.module';
import { databaseConfig } from '@api/config/database.config';
import { DatabaseModule } from '@api/core/database/database.module';
import { DATABASE_CONNECTION, DatabaseConnection } from '@api/core/database/providers/database-connection.provider';
import { user } from '@api/core/database/schema/auth.schema';
import { device } from '@api/core/database/schema/device.schema';
import { runRecord } from '@api/core/database/schema/run-record.schema';
import { service } from '@api/core/database/schema/service.schema';
import { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { DiagnosisSynthesis } from '@opspilot/shared';
import { randomUUID } from 'node:crypto';
import { readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import request from 'supertest';

import { AuditModule } from './audit.module';
import { AuditService } from './audit.service';

// guard faked here; real auth boundary is covered in auth.guard.spec.ts / auth.boundary.spec.ts
describe('AuditController (e2e)', () => {
  const userId = 'user-audit-ctrl-test';
  const deviceId = 'device-audit-ctrl-test';
  const serviceId = 'service-audit-ctrl-test';
  const synthesis: DiagnosisSynthesis = {
    problems: ['disk full'],
    status: 'degraded',
    suggestions: ['free space'],
    summary: 'the service is degraded',
  };

  let moduleRef: TestingModule;
  let app: INestApplication;
  let db: DatabaseConnection;
  let auditService: AuditService;
  let dbPath: string;

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
    dbPath = join(tmpdir(), `opspilot-audit-ctrl-test-${process.pid}-${Date.now()}.db`);
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule, AuditModule],
      providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
    })
      .overrideProvider(databaseConfig.KEY)
      .useValue({ backupRetention: 5, path: dbPath })
      .compile();
    app = moduleRef.createNestApplication();
    // app.init() triggers onApplicationBootstrap: migrations apply (through 0007 audit_log).
    await app.init();
    db = moduleRef.get<DatabaseConnection>(DATABASE_CONNECTION);
    auditService = moduleRef.get(AuditService);
    // satisfy the user/device/service foreign keys (fk pragma on).
    db.insert(user).values({ email: 'u1@example.com', id: userId, name: 'u1' }).run();
    db.insert(device).values({ host: '10.0.0.1', id: deviceId, name: 'nas' }).run();
    db.insert(service).values({ containerName: 'nginx', deviceId, id: serviceId, name: 'nginx' }).run();
  });

  afterEach(async () => {
    await app?.close();
    cleanupTempFiles();
  });

  const server = () => app.getHttpServer();

  it('lists audit rows newest-first with a run-linked row carrying its synthesis', async () => {
    auditService.record({ action: 'device.create', metadata: { name: 'nas' }, targetId: deviceId, userId });
    await new Promise((resolve) => setTimeout(resolve, 3));
    const runRecordId = randomUUID();
    db.insert(runRecord)
      .values({ deviceId, id: runRecordId, serviceId, synthesis: JSON.stringify(synthesis), userId })
      .run();
    auditService.record({ action: 'diagnose.run', runRecordId, targetId: serviceId, targetType: 'service', userId });

    const res = await request(server()).get('/audit').expect(200);
    expect(res.body.map((e: { action: string }) => e.action)).toEqual(['diagnose.run', 'device.create']);
    expect(res.body[0].runRecordId).toBe(runRecordId);
    expect(res.body[0].synthesis).toEqual(synthesis);
    // createdAt is an iso string on the wire.
    expect(typeof res.body[0].createdAt).toBe('string');
  });

  it('narrows to one action via the query filter', async () => {
    auditService.record({ action: 'device.create', userId });
    auditService.record({ action: 'skill.run', targetId: serviceId, targetType: 'service', userId });

    const res = await request(server()).get('/audit').query({ action: 'skill.run' }).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].action).toBe('skill.run');
  });

  it('shapes a bad query param into the apiError envelope', async () => {
    // limit above the clamp ceiling fails the boundary parse.
    const res = await request(server()).get('/audit').query({ limit: '500' }).expect(400);
    expect(res.body).toEqual({
      message: expect.any(String),
      status: 400,
      timestamp: expect.any(String),
    });
  });
});
