import { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { Skill } from '@opspilot/shared';
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
import { user } from '../database/schema/auth.schema';
import { ExecResult } from '../executor/executor.interface';
import { EXECUTOR } from '../executor/executor.token';
import { ServiceService } from '../service/service.service';
import { SkillModule } from './skill.module';

// e2e against a live temp db with a faked executor. the global AuthAppGuard is not wired
// here (only AppModule registers it), so routes are open — guard behavior is covered by
// auth.guard.spec.ts. SkillModule seeds the five global lifecycle rows on boot, so the
// run assertions key off the seeded start/restart/up/down skills resolved by name.
describe('SkillRunController (e2e)', () => {
  const inputKey = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';
  const inputDeviceId = '11111111-1111-4111-8111-111111111111';
  const otherDeviceId = '99999999-9999-4999-8999-999999999999';
  const inputContainerName = 'web-proxy';
  // the session user the fixture services are created under (audit fk → user.id).
  const userId = 'user-skill-run-ctrl-test';
  const pathPrefix = 'export PATH="/usr/local/bin:/usr/local/sbin:/volume1/@appstore/ContainerManager/usr/bin:$PATH"; ';

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

  const runUrl = (deviceId: string, id: string, skillId: string) =>
    `/devices/${deviceId}/services/${id}/skills/${skillId}/run`;

  async function skillIdByName(name: string): Promise<string> {
    const res = await request(server()).get('/skills').expect(200);
    const found = (res.body as Skill[]).find((candidate) => candidate.name === name);
    if (!found) {
      throw new Error(`seeded skill ${name} not found`);
    }
    return found.id;
  }

  beforeEach(async () => {
    mockExecutor.execute.mockReset();
    mockExecutor.execute.mockResolvedValue({ code: 0, stderr: '', stdout: inputContainerName });
    dbPath = join(tmpdir(), `opspilot-skill-run-ctrl-test-${process.pid}-${Date.now()}.db`);
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule, SkillModule],
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
    // @CurrentUserId resolves a non-null id for the audit writes (skill create over http).
    app.use((req: { session?: { user: { id: string } } }, _res: unknown, next: () => void) => {
      req.session = { user: { id: userId } };
      next();
    });
    // app.init() triggers onApplicationBootstrap: migrations apply, then the seed runs.
    await app.init();
    db = moduleRef.get<DatabaseConnection>(DATABASE_CONNECTION);
    db.insert(device).values({ host: '10.0.0.1', id: inputDeviceId, name: 'host-a' }).run();
    // seed the audit fk target — the fixture serviceService.create writes audit rows.
    db.insert(user).values({ email: 'u1@example.com', id: userId, name: 'u1' }).run();
    const serviceService = moduleRef.get(ServiceService);
    // a standalone container (no compose fields) — up/down must be rejected on it.
    const standalone = await serviceService.create(
      {
        containerName: inputContainerName,
        deviceId: inputDeviceId,
        name: 'Web Proxy',
      },
      userId
    );
    serviceId = standalone.id;
    // a compose-managed service — up/down allowed.
    const compose = await serviceService.create(
      {
        composePath: '/volume1/docker/stack/compose.yaml',
        composeProject: 'stack',
        containerName: 'stack-db',
        deviceId: inputDeviceId,
        name: 'Stack DB',
      },
      userId
    );
    composeServiceId = compose.id;
  });

  afterEach(async () => {
    db?.$client.close();
    await app?.close();
    cleanupTempFiles();
  });

  const server = () => app.getHttpServer();

  it('runs a seeded container-scoped skill and returns the succeeded result', async () => {
    const restartId = await skillIdByName('restart');

    const res = await request(server())
      .post(runUrl(inputDeviceId, serviceId, restartId))
      .send({})
      .expect(201);

    expect(res.body).toEqual({ message: inputContainerName, status: 'succeeded' });
    expect(mockExecutor.execute).toHaveBeenCalledWith(
      inputDeviceId,
      `${pathPrefix}docker restart ${inputContainerName}`,
      300000
    );
  });

  it('runs a seeded compose skill carrying both -f and -p', async () => {
    const upId = await skillIdByName('up');

    const res = await request(server())
      .post(runUrl(inputDeviceId, composeServiceId, upId))
      .send({})
      .expect(201);

    expect(res.body.status).toBe('succeeded');
    expect(mockExecutor.execute).toHaveBeenCalledWith(
      inputDeviceId,
      `${pathPrefix}docker compose -f /volume1/docker/stack/compose.yaml -p stack up -d`,
      300000
    );
  });

  it('rejects a compose skill on a standalone service with 400, running no command', async () => {
    const downId = await skillIdByName('down');
    mockExecutor.execute.mockClear();

    await request(server())
      .post(runUrl(inputDeviceId, serviceId, downId))
      .send({})
      .expect(400);

    expect(mockExecutor.execute).not.toHaveBeenCalled();
  });

  it('returns 404 for a cross-device serviceId, running no command', async () => {
    const restartId = await skillIdByName('restart');
    mockExecutor.execute.mockClear();

    await request(server())
      .post(runUrl(otherDeviceId, serviceId, restartId))
      .send({})
      .expect(404);

    expect(mockExecutor.execute).not.toHaveBeenCalled();
  });

  it('returns 404 for a skillId scoped to another device, running no command', async () => {
    // a skill scoped to otherDeviceId is out of scope for inputDeviceId → 404.
    db.insert(device).values({ host: '10.0.0.2', id: otherDeviceId, name: 'host-b' }).run();
    const created = await request(server())
      .post('/skills')
      .send({
        commandTemplate: 'docker restart {{containerName}}',
        deviceId: otherDeviceId,
        name: 'restart-b',
        parameters: [{ name: 'containerName', required: true, source: 'service' }],
      })
      .expect(201);
    mockExecutor.execute.mockClear();

    await request(server())
      .post(runUrl(inputDeviceId, serviceId, created.body.id))
      .send({})
      .expect(404);

    expect(mockExecutor.execute).not.toHaveBeenCalled();
  });

  it('rejects an input value carrying a shell metacharacter at the boundary, running no command', async () => {
    const created = await request(server())
      .post('/skills')
      .send({
        commandTemplate: 'docker logs --tail {{tail}} {{containerName}}',
        name: 'logs',
        parameters: [
          { name: 'tail', required: true, source: 'input' },
          { name: 'containerName', required: true, source: 'service' },
        ],
      })
      .expect(201);
    mockExecutor.execute.mockClear();

    await request(server())
      .post(runUrl(inputDeviceId, serviceId, created.body.id))
      .send({ inputs: { tail: '200; rm -rf /' } })
      .expect(400);

    expect(mockExecutor.execute).not.toHaveBeenCalled();
  });

  it('runs a custom skill substituting a clean input value', async () => {
    const created = await request(server())
      .post('/skills')
      .send({
        commandTemplate: 'docker logs --tail {{tail}} {{containerName}}',
        name: 'logs',
        parameters: [
          { name: 'tail', required: true, source: 'input' },
          { name: 'containerName', required: true, source: 'service' },
        ],
      })
      .expect(201);

    await request(server())
      .post(runUrl(inputDeviceId, serviceId, created.body.id))
      .send({ inputs: { tail: '200' } })
      .expect(201);

    expect(mockExecutor.execute).toHaveBeenCalledWith(
      inputDeviceId,
      `${pathPrefix}docker logs --tail 200 ${inputContainerName}`,
      300000
    );
  });

  it('surfaces a skill-specific non-zero exit as a failed result', async () => {
    const stopId = await skillIdByName('stop');
    mockExecutor.execute.mockResolvedValue({ code: 1, stderr: 'Error: No such container: web-proxy', stdout: '' });

    const res = await request(server())
      .post(runUrl(inputDeviceId, serviceId, stopId))
      .send({})
      .expect(201);

    expect(res.body).toEqual({ message: 'Error: No such container: web-proxy', status: 'failed' });
  });
});
