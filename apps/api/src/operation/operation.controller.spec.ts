import { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import request from 'supertest';

import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { ConfigModule } from '../config/config.module';
import { cryptoConfig } from '../config/crypto.config';
import { databaseConfig } from '../config/database.config';
import { DatabaseModule } from '../database/database.module';
import { DATABASE_CONNECTION, DatabaseConnection } from '../database/providers/database-connection.provider';
import { device } from '../database/schema';
import { ExecResult } from '../executor/executor.interface';
import { EXECUTOR } from '../executor/executor.token';
import { ServiceService } from '../service/service.service';
import { OperationModule } from './operation.module';

// e2e against a live temp db with a faked executor. the global AuthAppGuard is not
// wired here (only AppModule registers it), so routes are open — guard behavior is
// covered by auth.guard.spec.ts. asserts the synchronous op result, the forged-compose
// 400, the cross-device 404, and the boundary enum rejection of a bogus operation.
describe('OperationController (e2e)', () => {
  const inputKey = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';
  const inputDeviceId = '11111111-1111-4111-8111-111111111111';
  const otherDeviceId = '99999999-9999-4999-8999-999999999999';
  const inputContainerName = 'web-proxy';

  let moduleRef: TestingModule;
  let app: INestApplication;
  let db: DatabaseConnection;
  let dbPath: string;
  let serviceId: string;
  let composeServiceId: string;
  const mockExecutor = {
    execute: vi.fn<(deviceId: string, command: string, timeoutMs?: number) => Promise<ExecResult>>(),
  };

  function cleanupTempFiles(): void {
    const dir = dirname(dbPath);
    const base = basename(dbPath);
    for (const file of readdirSync(dir)) {
      if (file.startsWith(base)) {
        rmSync(join(dir, file));
      }
    }
  }

  const opsUrl = (deviceId: string, id: string) => `/devices/${deviceId}/services/${id}/operations`;

  beforeEach(async () => {
    mockExecutor.execute.mockReset();
    mockExecutor.execute.mockResolvedValue({ code: 0, stderr: '', stdout: inputContainerName });
    dbPath = join(tmpdir(), `opspilot-op-ctrl-test-${process.pid}-${Date.now()}.db`);
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule, OperationModule],
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
    await app.init();
    db = moduleRef.get<DatabaseConnection>(DATABASE_CONNECTION);
    db.insert(device).values({ host: '10.0.0.1', id: inputDeviceId, name: 'host-a' }).run();
    const serviceService = moduleRef.get(ServiceService);
    // a standalone container (no compose fields) — up/down must be rejected on it.
    const standalone = await serviceService.create({
      containerName: inputContainerName,
      deviceId: inputDeviceId,
      name: 'Web Proxy',
    });
    serviceId = standalone.id;
    // a compose-managed service — up/down allowed.
    const compose = await serviceService.create({
      composePath: '/volume1/docker/stack/compose.yaml',
      composeProject: 'stack',
      containerName: 'stack-db',
      deviceId: inputDeviceId,
      name: 'Stack DB',
    });
    composeServiceId = compose.id;
  });

  afterEach(async () => {
    db?.$client.close();
    await app?.close();
    cleanupTempFiles();
  });

  const server = () => app.getHttpServer();

  it('runs a container-scoped op and returns the succeeded result', async () => {
    const res = await request(server())
      .post(opsUrl(inputDeviceId, serviceId))
      .send({ operation: 'restart' })
      .expect(201);

    expect(res.body).toEqual({ message: inputContainerName, operation: 'restart', status: 'succeeded' });
    expect(mockExecutor.execute).toHaveBeenCalledWith(
      inputDeviceId,
      'export PATH="/usr/local/bin:/usr/local/sbin:/volume1/@appstore/ContainerManager/usr/bin:$PATH"; ' +
        `docker restart ${inputContainerName}`,
      300000
    );
  });

  it('runs a compose op carrying both -f and -p', async () => {
    const res = await request(server())
      .post(opsUrl(inputDeviceId, composeServiceId))
      .send({ operation: 'up' })
      .expect(201);

    expect(res.body.status).toBe('succeeded');
    expect(mockExecutor.execute).toHaveBeenCalledWith(
      inputDeviceId,
      'export PATH="/usr/local/bin:/usr/local/sbin:/volume1/@appstore/ContainerManager/usr/bin:$PATH"; ' +
        'docker compose -f /volume1/docker/stack/compose.yaml -p stack up -d',
      300000
    );
  });

  it('rejects a forged compose op on a standalone service with 400, running no command', async () => {
    await request(server()).post(opsUrl(inputDeviceId, serviceId)).send({ operation: 'down' }).expect(400);

    expect(mockExecutor.execute).not.toHaveBeenCalled();
  });

  it('returns 404 for a cross-device serviceId, running no command', async () => {
    await request(server()).post(opsUrl(otherDeviceId, serviceId)).send({ operation: 'start' }).expect(404);

    expect(mockExecutor.execute).not.toHaveBeenCalled();
  });

  it('rejects a bogus operation at the enum boundary with 400', async () => {
    await request(server()).post(opsUrl(inputDeviceId, serviceId)).send({ operation: 'nuke' }).expect(400);

    expect(mockExecutor.execute).not.toHaveBeenCalled();
  });

  it('surfaces an op-specific non-zero exit as a failed result', async () => {
    mockExecutor.execute.mockResolvedValue({ code: 1, stderr: 'Error: No such container: web-proxy', stdout: '' });

    const res = await request(server()).post(opsUrl(inputDeviceId, serviceId)).send({ operation: 'stop' }).expect(201);

    expect(res.body).toEqual({ message: 'Error: No such container: web-proxy', operation: 'stop', status: 'failed' });
  });
});
