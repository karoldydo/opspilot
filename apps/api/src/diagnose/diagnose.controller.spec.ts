import { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { DiagnosisSynthesis } from '@opspilot/shared';
import { generateText, NoObjectGeneratedError } from 'ai';
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
import { LlmProviderService } from '../llm-provider/llm-provider.service';
import { ServiceService } from '../service/service.service';
import { DiagnoseModule } from './diagnose.module';

// stub generateText but keep the real Output + NoObjectGeneratedError so the
// service's Output.object call and the client factory build a real model.
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return { ...actual, generateText: vi.fn() };
});

const mockedGenerateText = vi.mocked(generateText);

// e2e against a live temp db with a faked executor + faked llm. the global
// AuthAppGuard is not wired here (only AppModule registers it), so routes are open —
// guard behavior is covered by auth.guard.spec.ts. asserts the diagnose route, the
// stderr merge, and that synthesis/docker failures shape into the right 5xx status.
describe('DiagnoseController (e2e)', () => {
  const inputKey = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';
  const inputDeviceId = '11111111-1111-4111-8111-111111111111';
  const inputContainerName = 'web-proxy';
  const validSynthesis: DiagnosisSynthesis = {
    problems: ['port 5432 connection refused'],
    status: 'degraded',
    suggestions: ['restart the database container'],
    summary: 'service is degraded due to a database connectivity error',
  };

  let moduleRef: TestingModule;
  let app: INestApplication;
  let db: DatabaseConnection;
  let dbPath: string;
  let serviceId: string;
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
    mockedGenerateText.mockReset();
    // the provider create probe runs a live test-call; stub fetch to 200 ok so the
    // seed persists without the network.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response));
    dbPath = join(tmpdir(), `opspilot-diag-ctrl-test-${process.pid}-${Date.now()}.db`);
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule, DiagnoseModule],
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
    // seed a managed service row (the diagnose resolver turns serviceId → containerName).
    const service = await moduleRef
      .get(ServiceService)
      .create({ containerName: inputContainerName, deviceId: inputDeviceId, name: 'Web Proxy' });
    serviceId = service.id;
    // seed an active provider so diagnose gets past the no-active precondition.
    await moduleRef
      .get(LlmProviderService)
      .create({
        apiKey: 'sk-active',
        baseURL: 'https://api.example.com/v1',
        kind: 'openai-compatible',
        model: 'gpt-4o',
      });
  });

  afterEach(async () => {
    db?.$client.close();
    await app?.close();
    cleanupTempFiles();
    vi.unstubAllGlobals();
  });

  const server = () => app.getHttpServer();

  it('returns the validated 4-field synthesis, merging stderr into the logs fetch', async () => {
    mockExecutor.execute.mockResolvedValue({ code: 0, stderr: 'panic: db down', stdout: '' });
    mockedGenerateText.mockResolvedValue({ output: validSynthesis } as never);

    const res = await request(server()).post(`/devices/${inputDeviceId}/services/${serviceId}/diagnose`).expect(201);

    expect(res.body).toEqual(validSynthesis);
    // docker logs writes to stderr, so the merged stream must reach the prompt.
    expect(mockExecutor.execute).toHaveBeenCalledWith(
      inputDeviceId,
      'export PATH="/usr/local/bin:/usr/local/sbin:/volume1/@appstore/ContainerManager/usr/bin:$PATH"; ' +
        'docker logs web-proxy --tail 200'
    );
    expect(mockedGenerateText.mock.calls[0][0].prompt as string).toContain('panic: db down');
  });

  it('maps schema-not-enforced (NoObjectGeneratedError) to a 502, not a 401 or malformed 200', async () => {
    mockExecutor.execute.mockResolvedValue({ code: 0, stderr: 'some logs', stdout: '' });
    mockedGenerateText.mockRejectedValue(
      new NoObjectGeneratedError({
        cause: undefined,
        finishReason: 'stop',
        message: 'no object',
        response: undefined,
        text: 'raw',
        usage: undefined,
      })
    );

    const res = await request(server()).post(`/devices/${inputDeviceId}/services/${serviceId}/diagnose`).expect(502);

    expect(res.body).toEqual({ message: expect.any(String), status: 502, timestamp: expect.any(String) });
    // the raw provider output must never leak through the envelope.
    expect(JSON.stringify(res.body)).not.toContain('raw');
  });

  it('surfaces a missing container as a docker 503, never reaching synthesis', async () => {
    mockExecutor.execute.mockResolvedValue({ code: 1, stderr: 'Error: No such container: web-proxy', stdout: '' });

    await request(server()).post(`/devices/${inputDeviceId}/services/${serviceId}/diagnose`).expect(503);

    expect(mockedGenerateText).not.toHaveBeenCalled();
  });

  it('returns 409 when no provider is active', async () => {
    // drop the only (active) provider — diagnose must fail the precondition fast.
    const providers = await moduleRef.get(LlmProviderService).findAll();
    await moduleRef.get(LlmProviderService).remove(providers[0].id);

    await request(server()).post(`/devices/${inputDeviceId}/services/${serviceId}/diagnose`).expect(409);

    expect(mockExecutor.execute).not.toHaveBeenCalled();
  });
});
