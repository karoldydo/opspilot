import { AllExceptionsFilter } from '@api/common/all-exceptions.filter';
import { ConfigModule } from '@api/config/config.module';
import { cryptoConfig } from '@api/config/crypto.config';
import { databaseConfig } from '@api/config/database.config';
import { deviceConfig } from '@api/config/device.config';
import { DatabaseModule } from '@api/database/database.module';
import { DATABASE_CONNECTION, DatabaseConnection } from '@api/database/providers/database-connection.provider';
import { auditLog } from '@api/database/schema/audit-log.schema';
import { user } from '@api/database/schema/auth.schema';
import { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import request from 'supertest';

import { DeviceModule } from './device.module';

// e2e against a live temp db. the global AuthAppGuard is not wired here (only
// AppModule registers it via APP_GUARD), so routes are open — guard behavior is
// covered by auth.guard.spec.ts. a tiny middleware stands in for the guard,
// attaching the seeded session user so @CurrentUserId resolves for the audit
// writes. these tests assert the routes, the limit clamp, the apiError shaping
// via the global filter, and that no secret leaks.
describe('DeviceController (e2e)', () => {
  // a fixed 32-byte key (0x01 * 32) base64-encoded to 44 chars.
  const inputKey = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';
  const userId = 'user-device-ctrl-test';

  let moduleRef: TestingModule;
  let app: INestApplication;
  let db: DatabaseConnection;
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
    dbPath = join(tmpdir(), `opspilot-device-ctrl-test-${process.pid}-${Date.now()}.db`);
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule, DeviceModule],
      providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
    })
      .overrideProvider(databaseConfig.KEY)
      .useValue({ backupRetention: 5, path: dbPath })
      .overrideProvider(cryptoConfig.KEY)
      .useValue({ encryptionKey: inputKey })
      .overrideProvider(deviceConfig.KEY)
      .useValue({ credentialListLimit: 50 })
      .compile();
    app = moduleRef.createNestApplication();
    // stand in for the unwired AuthAppGuard: attach the session the guard would so
    // @CurrentUserId resolves a non-null id for the audit writes (registered before
    // init so it runs ahead of the route handlers).
    app.use((req: { session?: { user: { id: string } } }, _res: unknown, next: () => void) => {
      req.session = { user: { id: userId } };
      next();
    });
    // app.init() triggers onApplicationBootstrap, which runs the migrations.
    await app.init();
    db = moduleRef.get<DatabaseConnection>(DATABASE_CONNECTION);
    // seed the audit fk target — audit_log.userId references user.id.
    db.insert(user).values({ email: 'u1@example.com', id: userId, name: 'u1' }).run();
  });

  afterEach(async () => {
    await app?.close();
    cleanupTempFiles();
  });

  const server = () => app.getHttpServer();

  it('creates, lists, fetches, updates and deletes a device', async () => {
    const created = await request(server()).post('/devices').send({ host: '10.0.0.1', name: 'nas' }).expect(201);
    expect(created.body).toEqual({
      agentContext: null,
      createdAt: expect.any(String),
      host: '10.0.0.1',
      id: expect.any(String),
      name: 'nas',
      updatedAt: expect.any(String),
    });
    const id = created.body.id;

    await request(server())
      .get('/devices')
      .expect(200)
      .expect((res) => expect(res.body).toHaveLength(1));
    await request(server())
      .get(`/devices/${id}`)
      .expect(200)
      .expect((res) => expect(res.body.name).toBe('nas'));

    const updated = await request(server()).patch(`/devices/${id}`).send({ name: 'renamed' }).expect(200);
    expect(updated.body.name).toBe('renamed');

    await request(server()).delete(`/devices/${id}`).expect(204);
    await request(server()).get(`/devices/${id}`).expect(404);
  });

  it('writes an audit row keyed off the session user for a create over http', async () => {
    const created = await request(server()).post('/devices').send({ host: '10.0.0.1', name: 'nas' }).expect(201);

    const rows = db.select().from(auditLog).where(eq(auditLog.targetId, created.body.id)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'device.create', targetType: 'device', userId });
  });

  it('stores an encrypted credential and never returns secret material', async () => {
    const inputSecret = 'super-secret-ssh-password';
    const device = await request(server()).post('/devices').send({ host: '10.0.0.1', name: 'nas' }).expect(201);
    const deviceId = device.body.id;

    const credential = await request(server())
      .post(`/devices/${deviceId}/credentials`)
      .send({ authType: 'password', deviceId, secret: inputSecret, username: 'ops' })
      .expect(201);

    // the create response is metadata only — no secret, ciphertext, iv or authTag.
    expect(credential.body).toEqual({
      authType: 'password',
      createdAt: expect.any(String),
      deviceId,
      id: expect.any(String),
      updatedAt: expect.any(String),
      username: 'ops',
    });
    expect(JSON.stringify(credential.body)).not.toContain(inputSecret);

    const list = await request(server()).get(`/devices/${deviceId}/credentials`).expect(200);
    expect(list.body).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(inputSecret);
    expect(list.body[0]).not.toHaveProperty('secret');
    expect(list.body[0]).not.toHaveProperty('ciphertext');
  });

  it('rejects a credential body whose deviceId contradicts the path', async () => {
    const device = await request(server()).post('/devices').send({ host: '10.0.0.1', name: 'nas' }).expect(201);
    const deviceId = device.body.id;

    await request(server())
      .post(`/devices/${deviceId}/credentials`)
      .send({ authType: 'password', deviceId: 'someone-else', secret: 's', username: 'ops' })
      .expect(400);
  });

  it('clamps the credential-list limit at the hard ceiling and shapes the apiError', async () => {
    const device = await request(server()).post('/devices').send({ host: '10.0.0.1', name: 'nas' }).expect(201);
    const deviceId = device.body.id;

    const res = await request(server()).get(`/devices/${deviceId}/credentials?limit=999`).expect(400);
    // the global filter shaped the rejection into the shared apiError envelope.
    expect(res.body).toEqual({
      message: expect.any(String),
      status: 400,
      timestamp: expect.any(String),
    });
  });

  it('cascades the credential when its device is deleted', async () => {
    const device = await request(server()).post('/devices').send({ host: '10.0.0.1', name: 'nas' }).expect(201);
    const deviceId = device.body.id;
    await request(server())
      .post(`/devices/${deviceId}/credentials`)
      .send({ authType: 'password', deviceId, secret: 's', username: 'ops' })
      .expect(201);

    await request(server()).delete(`/devices/${deviceId}`).expect(204);

    // the device is gone; its credentials are listed against a now-missing device
    // and return an empty set (cascade removed the row).
    const list = await request(server()).get(`/devices/${deviceId}/credentials`).expect(200);
    expect(list.body).toHaveLength(0);
  });

  it('shapes a validation error into the apiError envelope', async () => {
    const res = await request(server()).post('/devices').send({ host: '', name: '' }).expect(400);
    expect(res.body).toEqual({
      message: expect.any(String),
      status: 400,
      timestamp: expect.any(String),
    });
  });
});
