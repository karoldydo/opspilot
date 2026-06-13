import { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { DiagnosisSynthesis } from '@opspilot/shared';
import { NoObjectGeneratedError, streamObject } from 'ai';
import { eq } from 'drizzle-orm';
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
import { auditLog } from '../database/schema/audit-log.schema';
import { user } from '../database/schema/auth.schema';
import { runRecord } from '../database/schema/run-record.schema';
import { DeviceService } from '../device/device.service';
import { ExecResult } from '../executor/executor.interface';
import { EXECUTOR } from '../executor/executor.token';
import { LlmProviderService } from '../llm-provider/llm-provider.service';
import { ServiceService } from '../service/service.service';
import { DiagnoseModule } from './diagnose.module';

// stub streamObject but keep the real NoObjectGeneratedError so the error mapper's
// .isInstance narrowing behaves for real.
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return { ...actual, streamObject: vi.fn() };
});

const mockedStreamObject = vi.mocked(streamObject);

// a faked streamObject result: yields the partials, then resolves `object` to the
// final synthesis (or rejects it with the given error).
function fakeStream(partials: Partial<DiagnosisSynthesis>[], final: { object?: DiagnosisSynthesis; reject?: unknown }) {
  const object = final.reject ? Promise.reject(final.reject) : Promise.resolve(final.object as DiagnosisSynthesis);
  object.catch(() => undefined);
  return {
    object,
    partialObjectStream: (async function* () {
      for (const partial of partials) {
        yield partial;
      }
    })(),
  } as unknown as ReturnType<typeof streamObject>;
}

// pull the parsed `data:` frames out of a buffered sse body (heartbeat `event: ping`
// frames carry no data line, so they drop out here).
function parseSseData(body: string): { [key: string]: unknown; type: string }[] {
  return body
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => JSON.parse(line.slice('data:'.length).trim()));
}

// e2e against a live temp db with a faked executor + faked llm stream. the global
// AuthAppGuard is not wired here (only AppModule registers it), so routes are open —
// guard behavior is covered by auth.guard.spec.ts. asserts the live sse stream, the
// stderr merge, persistence + the replay list, and that the no-active precondition
// stays a clean 409 before any stream opens.
describe('DiagnoseController (e2e)', () => {
  const inputKey = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';
  const inputDeviceId = '11111111-1111-4111-8111-111111111111';
  const inputContainerName = 'web-proxy';
  // the session user the fixture service/provider are created under (audit fk → user.id).
  const userId = 'user-diagnose-ctrl-test';
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

  const streamUrl = () => `/devices/${inputDeviceId}/services/${serviceId}/diagnose/stream`;
  const runsUrl = () => `/devices/${inputDeviceId}/services/${serviceId}/diagnose/runs`;

  beforeEach(async () => {
    mockExecutor.execute.mockReset();
    mockedStreamObject.mockReset();
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
    // stand in for the unwired AuthAppGuard: attach the session the guard would so
    // @CurrentUserId resolves a non-null id for the run's userId + the linked audit row.
    app.use((req: { session?: { user: { id: string } } }, _res: unknown, next: () => void) => {
      req.session = { user: { id: userId } };
      next();
    });
    await app.init();
    db = moduleRef.get<DatabaseConnection>(DATABASE_CONNECTION);
    db.insert(device).values({ host: '10.0.0.1', id: inputDeviceId, name: 'host-a' }).run();
    // seed the audit fk target — the fixture create calls write audit rows.
    db.insert(user).values({ email: 'u1@example.com', id: userId, name: 'u1' }).run();
    // seed a managed service row (the diagnose resolver turns serviceId → containerName).
    const service = await moduleRef
      .get(ServiceService)
      .create({ containerName: inputContainerName, deviceId: inputDeviceId, name: 'Web Proxy' }, userId);
    serviceId = service.id;
    // seed an active provider so diagnose gets past the no-active precondition.
    await moduleRef.get(LlmProviderService).create(
      {
        apiKey: 'sk-active',
        baseURL: 'https://api.example.com/v1',
        kind: 'openai-compatible',
        model: 'gpt-4o',
      },
      userId
    );
  });

  afterEach(async () => {
    db?.$client.close();
    await app?.close();
    cleanupTempFiles();
    vi.unstubAllGlobals();
  });

  const server = () => app.getHttpServer();

  it('streams delta + done frames, merges stderr, persists the run, and lists it via runs', async () => {
    mockExecutor.execute.mockResolvedValue({ code: 0, stderr: 'panic: db down', stdout: '' });
    mockedStreamObject.mockReturnValue(
      fakeStream([{ summary: 'service is' }, validSynthesis], { object: validSynthesis })
    );

    const res = await request(server()).get(streamUrl()).buffer(true).expect(200);

    const frames = parseSseData(res.text);
    expect(frames.map((f) => f.type)).toEqual(['delta', 'delta', 'done']);
    const done = frames.at(-1) as { run: { createdAt: string; id: string; synthesis: DiagnosisSynthesis } };
    expect(done.run.id).toEqual(expect.any(String));
    expect(done.run.synthesis).toEqual(validSynthesis);
    // docker logs writes to stderr, so the merged stream must reach the prompt.
    expect(mockExecutor.execute).toHaveBeenCalledWith(
      inputDeviceId,
      'export PATH="/usr/local/bin:/usr/local/sbin:/volume1/@appstore/ContainerManager/usr/bin:$PATH"; ' +
        'docker logs web-proxy --tail 200'
    );
    expect(mockedStreamObject.mock.calls[0][0].prompt as string).toContain('panic: db down');

    // the persisted run surfaces newest-first via the replay list.
    const list = await request(server()).get(runsUrl()).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(done.run.id);
    expect(list.body[0].synthesis).toEqual(validSynthesis);

    // s-09: the run carries the authenticated user (stripped from the wire contract,
    // read here straight off the row) and a linked diagnose.run audit row points at it.
    const runRow = db.select().from(runRecord).where(eq(runRecord.id, done.run.id)).get();
    expect(runRow?.userId).toBe(userId);
    const auditRows = db.select().from(auditLog).where(eq(auditLog.action, 'diagnose.run')).all();
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({ runRecordId: done.run.id, targetId: serviceId, userId });
  });

  it('emits an in-stream synthesis-failed error frame (200), never a 401 or a malformed object', async () => {
    mockExecutor.execute.mockResolvedValue({ code: 0, stderr: 'some logs', stdout: '' });
    mockedStreamObject.mockReturnValue(
      fakeStream([{ summary: 'partial' }], {
        reject: new NoObjectGeneratedError({
          cause: undefined,
          finishReason: 'stop',
          message: 'no object',
          response: undefined,
          text: 'raw',
          usage: undefined,
        }),
      })
    );

    const res = await request(server()).get(streamUrl()).buffer(true).expect(200);

    const frames = parseSseData(res.text);
    expect(frames.map((f) => f.type)).toEqual(['delta', 'error']);
    expect(frames[1]).toEqual({
      code: 'synthesis-failed',
      message: 'active provider did not return schema-conformant output',
      type: 'error',
    });
    // the raw provider output must never leak through the frame.
    expect(res.text).not.toContain('raw');
    // a failed run is never persisted.
    const list = await request(server()).get(runsUrl()).expect(200);
    expect(list.body).toHaveLength(0);
  });

  it("injects the device's agentContext into the synthesis system instruction (set → reflected)", async () => {
    // persist a host-level persona through the real device service projection path.
    await moduleRef
      .get(DeviceService)
      .update(inputDeviceId, { agentContext: 'config lives under /volume2; sudo needs a password' }, userId);
    mockExecutor.execute.mockResolvedValue({ code: 0, stderr: 'some logs', stdout: '' });
    mockedStreamObject.mockReturnValue(fakeStream([validSynthesis], { object: validSynthesis }));

    await request(server()).get(streamUrl()).buffer(true).expect(200);

    // the device context reaches the model as the `system` instruction — the agent
    // is told the host convention before it synthesizes.
    expect(mockedStreamObject.mock.calls[0][0].system).toBe('config lives under /volume2; sudo needs a password');
  });

  it('omits the system instruction when the device has no agentContext (null → no regression)', async () => {
    // the beforeEach seed inserts the device without agentContext (null column).
    mockExecutor.execute.mockResolvedValue({ code: 0, stderr: 'some logs', stdout: '' });
    mockedStreamObject.mockReturnValue(fakeStream([validSynthesis], { object: validSynthesis }));

    await request(server()).get(streamUrl()).buffer(true).expect(200);

    // identical to today's call shape — no `system` key on the streamObject args.
    expect(mockedStreamObject.mock.calls[0][0]).not.toHaveProperty('system');
  });

  it('returns 409 before any stream opens when no provider is active', async () => {
    // drop the only (active) provider — diagnose must fail the precondition fast.
    const providers = await moduleRef.get(LlmProviderService).findAll();
    await moduleRef.get(LlmProviderService).remove(providers[0].id, userId);

    await request(server()).get(streamUrl()).expect(409);

    expect(mockExecutor.execute).not.toHaveBeenCalled();
    expect(mockedStreamObject).not.toHaveBeenCalled();
  });
});
