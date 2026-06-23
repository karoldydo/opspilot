import { AllExceptionsFilter } from '@api/common/filters/all-exceptions.filter';
import { ConfigModule } from '@api/config/config.module';
import { cryptoConfig } from '@api/config/crypto.config';
import { databaseConfig } from '@api/config/database.config';
import { DatabaseModule } from '@api/core/database/database.module';
import { DATABASE_CONNECTION, DatabaseConnection } from '@api/core/database/providers/database-connection.provider';
import { device, runRecord } from '@api/core/database/schema';
import { user } from '@api/core/database/schema/auth.schema';
import { ExecResult } from '@api/integrations/executor/executor.interface';
import { EXECUTOR } from '@api/integrations/executor/executor.token';
import { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import request from 'supertest';

import { ServiceModule } from './service.module';

// guard faked here; real auth boundary is covered in auth.guard.spec.ts / auth.boundary.spec.ts.
// the fleet read is single-tenant (device/service carry no userId) — every service is returned
// with its latest-run status, mirroring GET /devices.
describe('ServiceAggregateController (e2e)', () => {
  const inputKey = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';
  const inputDeviceId = '11111111-1111-4111-8111-111111111111';
  const userId = 'user-svc-agg-test';

  let moduleRef: TestingModule;
  let app: INestApplication;
  let db: DatabaseConnection;
  let dbPath: string;
  const mockExecutor = { execute: vi.fn<(deviceId: string, command: string) => Promise<ExecResult>>() };

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
    mockExecutor.execute.mockReset();
    dbPath = join(tmpdir(), `opspilot-svc-agg-test-${process.pid}-${Date.now()}.db`);
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule, ServiceModule],
      providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
    })
      .overrideProvider(databaseConfig.KEY)
      .useValue({ backupRetention: 5, path: dbPath })
      .overrideProvider(cryptoConfig.KEY)
      .useValue({ encryptionKey: inputKey })
      .overrideProvider(EXECUTOR)
      .useValue(mockExecutor)
      .compile();
    app = moduleRef.createNestApplication();
    // fake the guard's session so @CurrentUserId resolves for the audit writes on create.
    app.use((req: { session?: { user: { id: string } } }, _res: unknown, next: () => void) => {
      req.session = { user: { id: userId } };
      next();
    });
    await app.init();
    db = moduleRef.get<DatabaseConnection>(DATABASE_CONNECTION);
    db.insert(device).values({ host: '10.0.0.1', id: inputDeviceId, name: 'host-a' }).run();
    db.insert(user).values({ email: 'u1@example.com', id: userId, name: 'u1' }).run();
  });

  afterEach(async () => {
    await app?.close();
    cleanupTempFiles();
  });

  const server = () => app.getHttpServer();

  function seedRun(serviceId: string, status: 'degraded' | 'down' | 'healthy', createdAt: Date): void {
    db.insert(runRecord)
      .values({
        createdAt,
        deviceId: inputDeviceId,
        id: randomUUID(),
        serviceId,
        synthesis: JSON.stringify({ problems: [], status, suggestions: [], summary: 's' }),
        userId,
      })
      .run();
  }

  it('returns every service with its latest-run status; no-runs ⇒ status null', async () => {
    const withRun = await request(server())
      .post(`/devices/${inputDeviceId}/services`)
      .send({ containerName: 'web', deviceId: inputDeviceId, name: 'Web' })
      .expect(201);
    const noRun = await request(server())
      .post(`/devices/${inputDeviceId}/services`)
      .send({ containerName: 'db', deviceId: inputDeviceId, name: 'Db' })
      .expect(201);
    seedRun(withRun.body.id, 'degraded', new Date(1000));
    // a newer run wins over the older one for the same service.
    seedRun(withRun.body.id, 'down', new Date(2000));

    const res = await request(server()).get('/services').expect(200);

    expect(res.body).toHaveLength(2);
    const byId = new Map<string, { status: null | string }>(res.body.map((row: { id: string }) => [row.id, row]));
    expect(byId.get(withRun.body.id)?.status).toBe('down');
    expect(byId.get(noRun.body.id)?.status).toBeNull();
  });

  it('returns an empty array when no services are managed', async () => {
    await request(server())
      .get('/services')
      .expect(200)
      .expect((r) => expect(r.body).toEqual([]));
  });
});
