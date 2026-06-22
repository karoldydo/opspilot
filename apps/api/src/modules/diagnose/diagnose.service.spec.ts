import { LlmConfig } from '@api/config/llm.config';
import { ExecResult } from '@api/integrations/executor/executor.interface';
import { AuditService } from '@api/modules/audit/audit.service';
import { DeviceService } from '@api/modules/device/device.service';
import { LlmProviderClientFactory } from '@api/modules/llm-provider/llm-provider.client-factory';
import { LlmProviderService } from '@api/modules/llm-provider/llm-provider.service';
import { ServiceService } from '@api/modules/service/service.service';
import { MessageEvent } from '@nestjs/common';
import { Device, DiagnosisSynthesis, RunRecord, RunStep, Service } from '@opspilot/shared';
import { NoObjectGeneratedError, streamObject } from 'ai';
import { Observable } from 'rxjs';

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
    // non-trivial tick so a fast mocked stream resolves before any progress frame fires;
    // the dedicated fake-timer test below drives the heartbeat deterministically.
    narrationTickMs: 2000,
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

  // the ordered frame `type`s, minus the timer-driven `progress` heartbeat (its count is
  // non-deterministic under real timers) — so step/delta/done/error ordering asserts cleanly.
  function frameTypes(events: MessageEvent[]): string[] {
    return events.map((e) => (e.data as { type: string }).type).filter((type) => type !== 'progress');
  }

  // the honest `step` payloads in emission order, for asserting the opening burst.
  function stepFrames(events: MessageEvent[]): RunStep[] {
    return events
      .filter((e) => (e.data as { type: string }).type === 'step')
      .map((e) => (e.data as { step: RunStep }).step);
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

    // the honest opening step burst, then two delta partials, then the closing result
    // step + the done frame (progress heartbeat filtered — timer-driven, non-deterministic).
    expect(frameTypes(events)).toEqual([
      'step',
      'step',
      'step',
      'step',
      'step',
      'step',
      'delta',
      'delta',
      'step',
      'done',
    ]);
    // the steps are real signals: the typed command, the resolved host, the configured
    // tail, the assembled line/byte counts, the resolved model · provider, then the close.
    const steps = stepFrames(events);
    expect(steps.slice(0, 6)).toEqual([
      { kind: 'cmd', text: '$ opspilot diagnose web-proxy@NAS' },
      { kind: 'sys', text: 'connecting to 192.168.1.10 via ssh' },
      { kind: 'sys', text: 'fetching last 200 log lines' },
      { kind: 'ok', text: 'received 2 lines (0.0 KB)' },
      { kind: 'sys', text: 'analyzing with gpt-4o · openai-compatible' },
      { kind: 'sys', text: 'synthesizing assessment' },
    ]);
    expect(steps[6].kind).toBe('result');
    expect(steps[6].text).toMatch(/^done in \d+\.\d+s — status: degraded$/);
    // the first delta partial and the done run land after the burst.
    const deltas = events.filter((e) => (e.data as { type: string }).type === 'delta');
    expect((deltas[0].data as { partial: unknown }).partial).toEqual({ summary: 'service is' });
    const done = events.find((e) => (e.data as { type: string }).type === 'done');
    expect((done?.data as { run: RunRecord }).run).toEqual(savedRun);
    // persisted with the accumulated final synthesis + the authenticated user + the
    // measured synthesis duration (s-05), before the done frame.
    expect(mockRunRecordService.create).toHaveBeenCalledWith({
      deviceId: inputDeviceId,
      durationMs: expect.any(Number),
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

    // the opening burst happened (logs were fetched + analysis started), then one delta,
    // then the mapped error — no closing result step, nothing persisted.
    expect(frameTypes(events)).toEqual(['step', 'step', 'step', 'step', 'step', 'step', 'delta', 'error']);
    const errorFrame = events.find((e) => (e.data as { type: string }).type === 'error');
    expect(errorFrame?.data).toEqual({
      code: 'synthesis-failed',
      message: 'active provider did not return schema-conformant output',
      type: 'error',
    });
    // the raw provider .text must never leak into the error frame.
    expect(JSON.stringify(errorFrame?.data)).not.toContain('raw');
    expect(mockRunRecordService.create).not.toHaveBeenCalled();
  });

  it('maps a synthesis timeout (AbortSignal.timeout) to a timeout error frame', async () => {
    mockExecutor.execute.mockResolvedValue(execResult({ stderr: 'some logs' }));
    const timeoutError = new Error('the operation was aborted');
    timeoutError.name = 'TimeoutError';
    mockedStreamObject.mockReturnValue(fakeStream([], { reject: timeoutError }));

    const events = await collect(await buildService().narrate(inputDeviceId, inputServiceId, userId));

    // the opening burst fired (the run reached synthesis), then a single trailing error
    // frame — no delta (nothing streamed) and no closing result step.
    expect(frameTypes(events)).toEqual(['step', 'step', 'step', 'step', 'step', 'step', 'error']);
    const errorFrame = events.find((e) => (e.data as { type: string }).type === 'error');
    expect(errorFrame?.data).toEqual({
      code: 'timeout',
      message: 'active llm provider did not return a diagnosis in time',
      type: 'error',
    });
  });

  it('emits a single logs-timeout error frame when the ssh logs fetch exceeds logsTimeoutMs, never reaching synthesis', async () => {
    // executor never resolves, so the Promise.race in fetchLogs loses to the timer
    // and the service's own setTimeout fires the DiagnosisLogsTimeoutError.
    mockExecutor.execute.mockReturnValue(new Promise<ExecResult>(() => undefined));
    const originalLogsTimeoutMs = config.logsTimeoutMs;
    // tiny bound keeps the test fast — no multi-second hang.
    config.logsTimeoutMs = 10;
    try {
      const events = await collect(await buildService().narrate(inputDeviceId, inputServiceId, userId));

      // the cmd/connecting/fetching steps genuinely happened before the fetch timed out,
      // so they precede the single trailing error frame — no received/analyzing steps.
      expect(frameTypes(events)).toEqual(['step', 'step', 'step', 'error']);
      expect(stepFrames(events)).toEqual([
        { kind: 'cmd', text: '$ opspilot diagnose web-proxy@NAS' },
        { kind: 'sys', text: 'connecting to 192.168.1.10 via ssh' },
        { kind: 'sys', text: 'fetching last 200 log lines' },
      ]);
      const errorFrame = events.find((e) => (e.data as { type: string }).type === 'error');
      expect(errorFrame?.data).toEqual({
        code: 'logs-timeout',
        message: `fetching logs for ${inputContainerName} timed out after 10ms`,
        type: 'error',
      });
      // synthesis is never reached and nothing is persisted.
      expect(mockedStreamObject).not.toHaveBeenCalled();
      expect(mockRunRecordService.create).not.toHaveBeenCalled();
    } finally {
      config.logsTimeoutMs = originalLogsTimeoutMs;
    }
  });

  it.each([['TimeoutError'], ['AbortError']])(
    'maps a NoObjectGeneratedError whose cause name is %s (sdk-wrapped abort) to a timeout error frame',
    async (causeName) => {
      mockExecutor.execute.mockResolvedValue(execResult({ stderr: 'some logs' }));
      // the sdk wraps an AbortSignal.timeout abort inside NoObjectGeneratedError with
      // the abort as its .cause — the unwrap branch must classify this as a timeout,
      // not a generic synthesis failure.
      const cause = new Error('the operation was aborted');
      cause.name = causeName;
      mockedStreamObject.mockReturnValue(
        fakeStream([], {
          reject: new NoObjectGeneratedError({
            cause,
            finishReason: 'stop',
            message: 'no object',
            response: undefined,
            text: 'raw',
            usage: undefined,
          }),
        })
      );

      const events = await collect(await buildService().narrate(inputDeviceId, inputServiceId, userId));

      // the opening burst fired before the sdk-wrapped abort surfaced as the lone error.
      expect(frameTypes(events)).toEqual(['step', 'step', 'step', 'step', 'step', 'step', 'error']);
      const errorFrame = events.find((e) => (e.data as { type: string }).type === 'error');
      expect(errorFrame?.data).toEqual({
        code: 'timeout',
        message: 'active llm provider did not return a diagnosis in time',
        type: 'error',
      });
      expect(mockRunRecordService.create).not.toHaveBeenCalled();
    }
  );

  it('maps a non-zero docker exit to an upstream error frame, never reaching synthesis', async () => {
    mockExecutor.execute.mockResolvedValue(execResult({ code: 1, stderr: 'Error: No such container: web-proxy' }));

    const events = await collect(await buildService().narrate(inputDeviceId, inputServiceId, userId));

    // the cmd/connecting/fetching steps fired before the non-zero exit threw; the bad
    // docker result short-circuits before the received step, leaving one error frame.
    expect(frameTypes(events)).toEqual(['step', 'step', 'step', 'error']);
    const errorFrame = events.find((e) => (e.data as { type: string }).type === 'error');
    expect(errorFrame?.data as { code: string; type: string }).toMatchObject({
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

  it('fires progress frames during a delayed inference and stops them after the first delta', async () => {
    vi.useFakeTimers();
    try {
      mockExecutor.execute.mockResolvedValue(execResult({ stderr: 'some logs' }));
      // hold the first partial behind a gate so the inference window stays open: the
      // progress heartbeat is the only thing that can tick until the gate is released.
      let releaseFirst: () => void = () => undefined;
      const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      mockedStreamObject.mockReturnValue({
        object: Promise.resolve(validSynthesis),
        partialObjectStream: (async function* () {
          await firstGate;
          yield { summary: 'service is' } as Partial<DiagnosisSynthesis>;
        })(),
      } as unknown as ReturnType<typeof streamObject>);

      const events: MessageEvent[] = [];
      const observable = await buildService().narrate(inputDeviceId, inputServiceId, userId);
      const subscription = observable.subscribe((event) => events.push(event));

      // flush the synchronous opening steps + the analyzing/synthesizing burst so the
      // for-await parks on the gate with the progress interval armed; no tick at t=0.
      await vi.advanceTimersByTimeAsync(0);
      const progressOf = (collected: MessageEvent[]) =>
        collected.filter((e) => (e.data as { type: string }).type === 'progress');
      expect(progressOf(events)).toHaveLength(0);

      // cross several 2000ms tick boundaries during the inference gap.
      await vi.advanceTimersByTimeAsync(6_000);
      const during = progressOf(events);
      expect(during.length).toBeGreaterThanOrEqual(3);
      expect(during[0].data).toMatchObject({ phase: 'analyzing', type: 'progress' });
      expect((during[0].data as { elapsedMs: number }).elapsedMs).toBeGreaterThan(0);

      // release the first partial — ttft. progress must stop now (cleared before delta).
      releaseFirst();
      await vi.advanceTimersByTimeAsync(0);
      const afterDelta = progressOf(events).length;

      // advancing further yields no new progress frames once content is alive.
      await vi.advanceTimersByTimeAsync(6_000);
      expect(progressOf(events)).toHaveLength(afterDelta);

      // the delta landed and the run completed normally with a done frame.
      expect(frameTypes(events)).toContain('delta');
      expect(frameTypes(events)).toContain('done');
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
