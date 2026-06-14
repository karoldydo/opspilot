import { AllExceptionsFilter } from '@api/common/all-exceptions.filter';
import { ConfigModule } from '@api/config/config.module';
import { cryptoConfig } from '@api/config/crypto.config';
import { databaseConfig } from '@api/config/database.config';
import { DatabaseModule } from '@api/database/database.module';
import { DATABASE_CONNECTION, DatabaseConnection } from '@api/database/providers/database-connection.provider';
import { device } from '@api/database/schema';
import { user } from '@api/database/schema/auth.schema';
import { ExecResult } from '@api/executor/executor.interface';
import { EXECUTOR } from '@api/executor/executor.token';
import { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import request from 'supertest';

import { ServiceModule } from './service.module';

// e2e against a live temp db with a faked executor. the global AuthAppGuard is not
// wired here (only AppModule registers it), so routes are open — a tiny middleware
// stands in for the guard, attaching the seeded session user so @CurrentUserId
// resolves for the audit writes. asserts route wiring, the body-vs-path guard, and
// apiError shaping via the global filter.
describe('ServiceController (e2e)', () => {
  const inputKey = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';
  const inputDeviceId = '11111111-1111-4111-8111-111111111111';
  const userId = 'user-svc-ctrl-test';

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
    dbPath = join(tmpdir(), `opspilot-svc-ctrl-test-${process.pid}-${Date.now()}.db`);
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
    // stand in for the unwired AuthAppGuard: attach the session the guard would so
    // @CurrentUserId resolves a non-null id for the audit writes.
    app.use((req: { session?: { user: { id: string } } }, _res: unknown, next: () => void) => {
      req.session = { user: { id: userId } };
      next();
    });
    await app.init();
    db = moduleRef.get<DatabaseConnection>(DATABASE_CONNECTION);
    db.insert(device).values({ host: '10.0.0.1', id: inputDeviceId, name: 'host-a' }).run();
    // seed the audit fk target — audit_log.userId references user.id.
    db.insert(user).values({ email: 'u1@example.com', id: userId, name: 'u1' }).run();
  });

  afterEach(async () => {
    await app?.close();
    cleanupTempFiles();
  });

  const server = () => app.getHttpServer();

  it('scans a device and returns the live container list', async () => {
    const stdout = JSON.stringify({
      Image: 'nginx:latest',
      Labels: '',
      Names: 'web',
      State: 'running',
      Status: 'Up 1 hour',
    });
    mockExecutor.execute.mockResolvedValue({ code: 0, stderr: '', stdout });

    const res = await request(server()).post(`/devices/${inputDeviceId}/scan`).expect(201);
    expect(res.body.containers).toHaveLength(1);
    expect(res.body.containers[0].containerName).toBe('web');
  });

  it('creates, lists, updates and deletes a managed service', async () => {
    const created = await request(server())
      .post(`/devices/${inputDeviceId}/services`)
      .send({ containerName: 'web', deviceId: inputDeviceId, name: 'Web' })
      .expect(201);
    expect(created.body.name).toBe('Web');
    const id = created.body.id;

    await request(server())
      .get(`/devices/${inputDeviceId}/services`)
      .expect(200)
      .expect((r) => expect(r.body).toHaveLength(1));

    const updated = await request(server())
      .patch(`/devices/${inputDeviceId}/services/${id}`)
      .send({ name: 'Reverse Proxy' })
      .expect(200);
    expect(updated.body.name).toBe('Reverse Proxy');

    await request(server()).delete(`/devices/${inputDeviceId}/services/${id}`).expect(204);
    await request(server())
      .get(`/devices/${inputDeviceId}/services`)
      .expect(200)
      .expect((r) => expect(r.body).toHaveLength(0));
  });

  it('rejects a service body whose deviceId contradicts the path', async () => {
    const res = await request(server())
      .post(`/devices/${inputDeviceId}/services`)
      .send({ containerName: 'web', deviceId: '99999999-9999-4999-8999-999999999999', name: 'Web' })
      .expect(400);
    expect(res.body).toEqual({
      message: expect.any(String),
      status: 400,
      timestamp: expect.any(String),
    });
  });
});
