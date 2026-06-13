import { MessageEvent } from '@nestjs/common';
import { Device, DiagnosisSynthesis, RunRecord, Service } from '@opspilot/shared';
import { NoObjectGeneratedError, streamObject } from 'ai';
import { Observable } from 'rxjs';

import { AuditService } from '../audit/audit.service';
import { LlmConfig } from '../config/llm.config';
import { DeviceService } from '../device/device.service';
import { ExecResult } from '../executor/executor.interface';
import { LlmProviderClientFactory } from '../llm-provider/llm-provider.client-factory';
import { LlmProviderService } from '../llm-provider/llm-provider.service';
import { ServiceService } from '../service/service.service';
import { DiagnoseService } from './diagnose.service';
import { RunRecordService } from './run-record.service';

// stub streamObject but keep the real NoObjectGeneratedError so the error-event
// mapper's .isInstance narrowing behaves for real.
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return { ...actual, streamObject: vi.fn() };
});

const mockedStreamObject = vi.mocked(streamObject);

describe('DiagnoseService', () => {
  const inputDeviceId = '11111111-1111-4111-8111-111111111111';
  const inputServiceId = '22222222-2222-4222-8222-222222222222';
  const inputContainerName = 'web-proxy';
  // the session user threaded onto the run + the linked diagnose.run audit row.
  const userId = 'user-diagnose-test';
  const expectedCommand =
    'export PATH="/usr/local/bin:/usr/local/sbin:/volume1/@appstore/ContainerManager/usr/bin:$PATH"; ' +
    'docker logs web-proxy --tail 200';
  const validSynthesis: DiagnosisSynthesis = {
    problems: ['port 5432 connection refused'],
    status: 'degraded',
    suggestions: ['restart the database container'],
    summary: 'service is degraded due to a database connectivity error',
  };
  const savedRun: RunRecord = {
    createdAt: '2026-06-11T10:00:00.000Z',
    deviceId: inputDeviceId,
    id: '33333333-3333-4333-8333-333333333333',
    serviceId: inputServiceId,
    synthesis: validSynthesis,
  };

  const mockExecutor = { execute: vi.fn<(deviceId: string, command: string) => Promise<ExecResult>>() };
  const mockServiceService = { findOne: vi.fn<(deviceId: string, id: string) => Promise<Service>>() };
  const mockDeviceService = { findOne: vi.fn<(id: string) => Promise<Device>>() };
  const mockLlmProviderService = {
    getActiveProviderConfig: vi.fn<() => Promise<{ apiKey: string; baseURL: string; kind: string; model: string }>>(),
  };
  const mockModel = { id: 'fake-model' };
  const mockClientFactory = { create: vi.fn(() => mockModel) };
  const mockRunRecordService = {
    create:
      vi.fn<
        (input: { deviceId: string; serviceId: string; synthesis: DiagnosisSynthesis; userId?: string }) => RunRecord
      >(),
    findRecent: vi.fn<(deviceId: string, serviceId: string, limit?: number, offset?: number) => RunRecord[]>(),
  };
  const mockAuditService = { recordOnInvocation: vi.fn() };
  const config: LlmConfig = {
    generateTimeoutMs: 12000,
    historyRetention: 20,
    logsTailLines: 200,
    logsTimeoutMs: 5000,
    testTimeoutMs: 5000,
  };

  function buildService(): DiagnoseService {
    return new DiagnoseService(
      mockExecutor,
      mockServiceService as unknown as ServiceService,
      mockDeviceService as unknown as DeviceService,
      mockLlmProviderService as unknown as LlmProviderService,
      mockClientFactory as unknown as LlmProviderClientFactory,
      mockRunRecordService as unknown as RunRecordService,
      mockAuditService as unknown as AuditService,
      config
    );
  }

  function serviceRow(overrides: Partial<Service> = {}): Service {
    return {
      composePath: null,
      composeProject: null,
      containerName: inputContainerName,
      createdAt: '2026-06-11T09:00:00.000Z',
      deviceId: inputDeviceId,
      id: inputServiceId,
      name: 'Web Proxy',
      updatedAt: '2026-06-11T09:00:00.000Z',
      ...overrides,
    };
  }

  function deviceRow(overrides: Partial<Device> = {}): Device {
    return {
      agentContext: null,
      createdAt: '2026-06-11T08:00:00.000Z',
      host: '192.168.1.10',
      id: inputDeviceId,
      name: 'NAS',
      updatedAt: '2026-06-11T08:00:00.000Z',
      ...overrides,
    };
  }

  function execResult(overrides: Partial<ExecResult> = {}): ExecResult {
    return { code: 0, stderr: '', stdout: '', ...overrides };
  }

  // a faked streamObject result: yields the given partials, then resolves `object`
  // to the final synthesis (or rejects it with the given error).
  function fakeStream(
    partials: Partial<DiagnosisSynthesis>[],
    final: { object?: DiagnosisSynthesis; reject?: unknown }
  ) {
    const object = final.reject ? Promise.reject(final.reject) : Promise.resolve(final.object as DiagnosisSynthesis);
    // pre-attach a handler so an eager rejection never trips an unhandled-rejection
    // warning; the service's own `await object` still observes the rejection.
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

  // subscribe and collect every frame until the stream completes.
  function collect(observable: Observable<MessageEvent>): Promise<MessageEvent[]> {
    return new Promise((resolve, reject) => {
      const events: MessageEvent[] = [];
      observable.subscribe({ complete: () => resolve(events), error: reject, next: (event) => events.push(event) });
    });
  }

  beforeEach(() => {
    mockExecutor.execute.mockReset();
    mockServiceService.findOne.mockReset();
    mockDeviceService.findOne.mockReset();
    mockLlmProviderService.getActiveProviderConfig.mockReset();
    mockClientFactory.create.mockClear();
    mockRunRecordService.create.mockReset();
    mockRunRecordService.findRecent.mockReset();
    mockAuditService.recordOnInvocation.mockReset();
    mockedStreamObject.mockReset();

    mockServiceService.findOne.mockResolvedValue(serviceRow());
    mockDeviceService.findOne.mockResolvedValue(deviceRow());
    mockLlmProviderService.getActiveProviderConfig.mockResolvedValue({
      apiKey: 'sk-active',
      baseURL: 'https://api.example.com/v1',
      kind: 'openai-compatible',
      model: 'gpt-4o',
    });
    mockRunRecordService.create.mockReturnValue(savedRun);
  });

  it('streams delta frames, persists the final synthesis, then emits done with the saved run', async () => {
    mockExecutor.execute.mockResolvedValue(execResult({ stderr: 'err line', stdout: 'out line' }));
    mockedStreamObject.mockReturnValue(
      fakeStream([{ summary: 'service is' }, { status: 'degraded', summary: 'service is degraded' }], {
        object: validSynthesis,
      })
    );

    const events = await collect(await buildService().narrate(inputDeviceId, inputServiceId, userId));

    // two delta frames carrying the progressive partials, then a single done frame.
    expect(events.map((e) => (e.data as { type: string }).type)).toEqual(['delta', 'delta', 'done']);
    expect((events[0].data as { partial: unknown }).partial).toEqual({ summary: 'service is' });
    expect((events[2].data as { run: RunRecord }).run).toEqual(savedRun);
    // persisted with the accumulated final synthesis + the authenticated user, before
    // the done frame.
    expect(mockRunRecordService.create).toHaveBeenCalledWith({
      deviceId: inputDeviceId,
      serviceId: inputServiceId,
      synthesis: validSynthesis,
      userId,
    });
    // the linked tier-2 audit row is recorded at the same point, pointing at the run.
    expect(mockAuditService.recordOnInvocation).toHaveBeenCalledWith({
      action: 'diagnose.run',
      runRecordId: savedRun.id,
      targetId: inputServiceId,
      targetType: 'service',
      userId,
    });
    // docker logs → stderr, so both streams must reach the synthesis prompt.
    expect(mockExecutor.execute).toHaveBeenCalledWith(inputDeviceId, expectedCommand);
    const prompt = mockedStreamObject.mock.calls[0][0].prompt as string;
    expect(prompt).toContain('out line');
    expect(prompt).toContain('err line');
    expect(mockClientFactory.create).toHaveBeenCalledWith({
      apiKey: 'sk-active',
      baseURL: 'https://api.example.com/v1',
      kind: 'openai-compatible',
      model: 'gpt-4o',
    });
  });

  it('maps a NoObjectGeneratedError mid-stream to a synthesis-failed error frame, never persisting', async () => {
    mockExecutor.execute.mockResolvedValue(execResult({ stderr: 'some logs' }));
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

    const events = await collect(await buildService().narrate(inputDeviceId, inputServiceId, userId));

    expect(events.map((e) => (e.data as { type: string }).type)).toEqual(['delta', 'error']);
    expect(events[1].data).toEqual({
      code: 'synthesis-failed',
      message: 'active provider did not return schema-conformant output',
      type: 'error',
    });
    // the raw provider .text must never leak into the error frame.
    expect(JSON.stringify(events[1].data)).not.toContain('raw');
    expect(mockRunRecordService.create).not.toHaveBeenCalled();
  });

  it('maps a synthesis timeout (AbortSignal.timeout) to a timeout error frame', async () => {
    mockExecutor.execute.mockResolvedValue(execResult({ stderr: 'some logs' }));
    const timeoutError = new Error('the operation was aborted');
    timeoutError.name = 'TimeoutError';
    mockedStreamObject.mockReturnValue(fakeStream([], { reject: timeoutError }));

    const events = await collect(await buildService().narrate(inputDeviceId, inputServiceId, userId));

    expect(events).toHaveLength(1);
    expect(events[0].data).toEqual({
      code: 'timeout',
      message: 'active llm provider did not return a diagnosis in time',
      type: 'error',
    });
  });

  it('maps a non-zero docker exit to an upstream error frame, never reaching synthesis', async () => {
    mockExecutor.execute.mockResolvedValue(execResult({ code: 1, stderr: 'Error: No such container: web-proxy' }));

    const events = await collect(await buildService().narrate(inputDeviceId, inputServiceId, userId));

    expect(events).toHaveLength(1);
    expect(events[0].data as { code: string; type: string }).toMatchObject({
      code: 'upstream-unavailable',
      type: 'error',
    });
    expect(mockedStreamObject).not.toHaveBeenCalled();
    expect(mockRunRecordService.create).not.toHaveBeenCalled();
  });

  it('fails fast on no active provider before opening the stream', async () => {
    mockLlmProviderService.getActiveProviderConfig.mockRejectedValue(new Error('no active llm provider configured'));

    // narrate rejects with the http precondition before any observable is returned;
    // the ssh logs fetch is never reached.
    await expect(buildService().narrate(inputDeviceId, inputServiceId, userId)).rejects.toThrow();
    expect(mockExecutor.execute).not.toHaveBeenCalled();
    expect(mockedStreamObject).not.toHaveBeenCalled();
  });

  it('fails fast on an unknown service before resolving the provider', async () => {
    mockServiceService.findOne.mockRejectedValue(new Error('service not found'));

    await expect(buildService().narrate(inputDeviceId, inputServiceId, userId)).rejects.toThrow();
    expect(mockLlmProviderService.getActiveProviderConfig).not.toHaveBeenCalled();
  });

  it('delegates recentRuns to the run-record service', () => {
    mockRunRecordService.findRecent.mockReturnValue([savedRun]);

    const actual = buildService().recentRuns(inputDeviceId, inputServiceId, 5, 10);

    expect(actual).toEqual([savedRun]);
    expect(mockRunRecordService.findRecent).toHaveBeenCalledWith(inputDeviceId, inputServiceId, 5, 10);
  });

  it('emits a keep-alive ping frame on the ~30s heartbeat while the synthesis is in flight', async () => {
    vi.useFakeTimers();
    try {
      mockExecutor.execute.mockResolvedValue(execResult({ stderr: 'some logs' }));
      // a stream that never yields and whose object never resolves keeps the run
      // open, so the heartbeat interval is the only thing that can fire.
      mockedStreamObject.mockReturnValue({
        object: new Promise<DiagnosisSynthesis>(() => undefined),
        // an async iterable whose next() never settles — the for-await hangs, so the
        // run stays open and only the heartbeat interval can emit.
        partialObjectStream: {
          [Symbol.asyncIterator]: () => ({
            next: () => new Promise<IteratorResult<Partial<DiagnosisSynthesis>>>(() => undefined),
          }),
        },
      } as unknown as ReturnType<typeof streamObject>);

      const events: MessageEvent[] = [];
      const observable = await buildService().narrate(inputDeviceId, inputServiceId, userId);
      const subscription = observable.subscribe((event) => events.push(event));

      // flush microtasks (the async pump reaches the hanging for-await) and cross
      // the 30s heartbeat boundary; the keep-alive is a named `ping` with empty data
      // (the browser EventSource ignores named events — the analog of a `: ping`).
      await vi.advanceTimersByTimeAsync(30_000);

      expect(events).toContainEqual({ data: '', type: 'ping' });
      expect(mockRunRecordService.create).not.toHaveBeenCalled();
      subscription.unsubscribe();
    } finally {
      vi.useRealTimers();
    }
  });

  it('injects the device agentContext as the streamObject system instruction when set', async () => {
    mockDeviceService.findOne.mockResolvedValue(
      deviceRow({ agentContext: 'config lives under /volume2; sudo needs a password' })
    );
    mockExecutor.execute.mockResolvedValue(execResult({ stderr: 'some logs' }));
    mockedStreamObject.mockReturnValue(fakeStream([{ summary: 'ok' }], { object: validSynthesis }));

    await collect(await buildService().narrate(inputDeviceId, inputServiceId, userId));

    expect(mockedStreamObject.mock.calls[0][0].system).toBe('config lives under /volume2; sudo needs a password');
  });

  it('trims surrounding whitespace from the agentContext before injecting it', async () => {
    mockDeviceService.findOne.mockResolvedValue(deviceRow({ agentContext: '  ports are remapped  ' }));
    mockExecutor.execute.mockResolvedValue(execResult({ stderr: 'some logs' }));
    mockedStreamObject.mockReturnValue(fakeStream([{ summary: 'ok' }], { object: validSynthesis }));

    await collect(await buildService().narrate(inputDeviceId, inputServiceId, userId));

    expect(mockedStreamObject.mock.calls[0][0].system).toBe('ports are remapped');
  });

  it.each([
    ['null', null],
    ['empty', ''],
    ['whitespace-only', '   \n\t  '],
  ])('omits system entirely when the agentContext is %s', async (_label, agentContext) => {
    mockDeviceService.findOne.mockResolvedValue(deviceRow({ agentContext }));
    mockExecutor.execute.mockResolvedValue(execResult({ stderr: 'some logs' }));
    mockedStreamObject.mockReturnValue(fakeStream([{ summary: 'ok' }], { object: validSynthesis }));

    await collect(await buildService().narrate(inputDeviceId, inputServiceId, userId));

    expect(mockedStreamObject.mock.calls[0][0]).not.toHaveProperty('system');
  });
});
