import { LlmConfig } from '@api/config/llm.config';
import { ExecResult } from '@api/integrations/executor/executor.interface';
import { AuditService } from '@api/modules/audit/audit.service';
import { DeviceService } from '@api/modules/device/device.service';
import { LlmProviderClientFactory } from '@api/modules/llm-provider/llm-provider.client-factory';
import { LlmProviderService } from '@api/modules/llm-provider/llm-provider.service';
import { ServiceService } from '@api/modules/service/service.service';
import { MessageEvent } from '@nestjs/common';
import { Device, DiagnosisSynthesis, RunRecord, Service } from '@opspilot/shared';
import { LanguageModel } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { Observable } from 'rxjs';

import { DiagnoseService } from './diagnose.service';
import { RunRecordService } from './run-record.service';

// seam (a): this file drives the REAL streamObject against a MockLanguageModelV3
// injected at the LlmProviderClientFactory.create boundary, so the genuine
// AbortSignal.timeout fires and the sdk's own validation against
// diagnosisSynthesisSchema produces a real NoObjectGeneratedError. it must NOT
// stub the 'ai' module — a file-scoped vi-mock there would replace the very
// streamObject under test (plan: critical implementation details).

describe('DiagnoseService (real streamObject via MockLanguageModelV3)', () => {
  const inputDeviceId = '11111111-1111-4111-8111-111111111111';
  const inputServiceId = '22222222-2222-4222-8222-222222222222';
  const inputContainerName = 'web-proxy';
  const userId = 'user-diagnose-real';

  const savedRun: RunRecord = {
    createdAt: '2026-06-11T10:00:00.000Z',
    deviceId: inputDeviceId,
    id: '33333333-3333-4333-8333-333333333333',
    serviceId: inputServiceId,
    synthesis: {
      problems: [],
      status: 'healthy',
      suggestions: [],
      summary: 'ok',
    },
  };

  const mockExecutor = { execute: vi.fn<(deviceId: string, command: string) => Promise<ExecResult>>() };
  const mockServiceService = { findOne: vi.fn<(deviceId: string, id: string) => Promise<Service>>() };
  const mockDeviceService = { findOne: vi.fn<(id: string) => Promise<Device>>() };
  const mockLlmProviderService = {
    getActiveProviderConfig: vi.fn<() => Promise<{ apiKey: string; baseURL: string; kind: string; model: string }>>(),
  };
  // the fake model is swapped per test; create() just hands it back. its values are
  // inert — the mock model ignores apiKey/baseURL/model.
  const mockClientFactory = { create: vi.fn<() => LanguageModel>() };
  const mockRunRecordService = {
    create:
      vi.fn<
        (input: { deviceId: string; serviceId: string; synthesis: DiagnosisSynthesis; userId?: string }) => RunRecord
      >(),
    findRecent: vi.fn<(deviceId: string, serviceId: string, limit?: number, offset?: number) => RunRecord[]>(),
  };
  const mockAuditService = { recordOnInvocation: vi.fn() };
  // tiny generateTimeoutMs so the real AbortSignal.timeout fires fast; the Joi
  // min(1000) guards env at boot, not this positional config object (plan: critical
  // implementation details / lessons.md config-layer tunables).
  const config: LlmConfig = {
    generateTimeoutMs: 50,
    historyRetention: 20,
    logsTailLines: 200,
    logsTimeoutMs: 5000,
    // far longer than the tiny generateTimeoutMs so no progress frame fires before the
    // real abort — the heartbeat cadence is covered deterministically in the unit spec.
    narrationTickMs: 2000,
    testTimeoutMs: 5000,
  };

  // wire a fake model through the factory seam and hand-build the service (a plain
  // class, no di graph needed — mirrors diagnose.service.spec.ts).
  function buildService(model: LanguageModel): DiagnoseService {
    mockClientFactory.create.mockReturnValue(model);
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

  function serviceRow(): Service {
    return {
      composePath: null,
      composeProject: null,
      containerName: inputContainerName,
      createdAt: '2026-06-11T09:00:00.000Z',
      deviceId: inputDeviceId,
      id: inputServiceId,
      name: 'Web Proxy',
      updatedAt: '2026-06-11T09:00:00.000Z',
    };
  }

  function deviceRow(): Device {
    return {
      agentContext: null,
      createdAt: '2026-06-11T08:00:00.000Z',
      host: '192.168.1.10',
      id: inputDeviceId,
      name: 'NAS',
      updatedAt: '2026-06-11T08:00:00.000Z',
    };
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
    mockClientFactory.create.mockReset();
    mockRunRecordService.create.mockReset();
    mockRunRecordService.findRecent.mockReset();
    mockAuditService.recordOnInvocation.mockReset();

    mockServiceService.findOne.mockResolvedValue(serviceRow());
    mockDeviceService.findOne.mockResolvedValue(deviceRow());
    mockLlmProviderService.getActiveProviderConfig.mockResolvedValue({
      apiKey: 'sk-active',
      baseURL: 'https://api.example.com/v1',
      kind: 'openai-compatible',
      model: 'gpt-4o',
    });
    // executor returns valid logs so the flow reaches synthesis.
    mockExecutor.execute.mockResolvedValue({ code: 0, stderr: 'some logs', stdout: '' });
    mockRunRecordService.create.mockReturnValue(savedRun);
    config.generateTimeoutMs = 50;
  });

  it('fires the real AbortSignal.timeout and surfaces a single timeout error frame within bound', async () => {
    // doStream returns a stream that emits nothing and errors only when the run's
    // AbortSignal.timeout fires — so the REAL AbortSignal.any composition drives the
    // abort, not an injected error. the stream must wire its own teardown to
    // options.abortSignal or the timer leaks past suite end (plan snippet).
    const model = new MockLanguageModelV3({
      doStream: async ({ abortSignal }) => ({
        stream: new ReadableStream({
          start(controller) {
            abortSignal?.addEventListener('abort', () => controller.error(abortSignal.reason));
          },
        }),
      }),
    });

    const start = Date.now();
    const events = await collect(await buildService(model).narrate(inputDeviceId, inputServiceId, userId));
    const elapsed = Date.now() - start;

    // the opening step burst fired (the run reached synthesis), then the real abort
    // surfaced as the lone error — no delta, no done, no progress (abort beat the tick).
    const types = events.map((e) => (e.data as { type: string }).type);
    expect(types).not.toContain('delta');
    expect(types).not.toContain('done');
    expect(types).not.toContain('progress');
    const errorFrames = events.filter((e) => (e.data as { type: string }).type === 'error');
    expect(errorFrames).toHaveLength(1);
    expect(errorFrames[0].data).toEqual({
      code: 'timeout',
      message: 'active llm provider did not return a diagnosis in time',
      type: 'error',
    });
    // the genuine wall-clock abort fired within a small multiple of the bound.
    expect(elapsed).toBeLessThan(2000);
    // nothing persisted on a timeout.
    expect(mockRunRecordService.create).not.toHaveBeenCalled();
  });

  it('maps a real NoObjectGeneratedError from sdk schema validation to a synthesis-failed frame, no raw-text leak', async () => {
    // bigger bound: this run must finish (not time out) so the sdk validates the
    // accumulated object against diagnosisSynthesisSchema and rejects it for real.
    config.generateTimeoutMs = 5000;
    // a well-formed json object that PARSES but violates the schema: status is outside
    // the ['healthy','degraded','down'] enum. 'exploded' is the raw-text canary — it
    // must never reach the error frame.
    const rawText = '{"status":"exploded","summary":"boom","problems":[],"suggestions":[]}';
    const model = new MockLanguageModelV3({
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] });
            controller.enqueue({ id: '0', type: 'text-start' });
            controller.enqueue({ delta: rawText, id: '0', type: 'text-delta' });
            controller.enqueue({ id: '0', type: 'text-end' });
            controller.enqueue({
              finishReason: { raw: undefined, unified: 'stop' },
              type: 'finish',
              usage: {
                inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 0, total: 0 },
                outputTokens: { reasoning: 0, text: 0, total: 0 },
              },
            });
            controller.close();
          },
        }),
      }),
    });

    const events = await collect(await buildService(model).narrate(inputDeviceId, inputServiceId, userId));

    // the run ends in a single synthesis-failed error frame — no done, nothing
    // persisted. (delta frames may precede it: partialObjectStream streams the
    // progressively-parsed object, which is the intended live-render ux; the leak
    // risk being defended is the ERROR frame echoing the raw NoObjectGeneratedError
    // .text, not the legitimate partial stream.)
    const errorFrames = events.filter((e) => (e.data as { type: string }).type === 'error');
    expect(errorFrames).toHaveLength(1);
    expect(errorFrames[0].data).toEqual({
      code: 'synthesis-failed',
      message: 'active provider did not return schema-conformant output',
      type: 'error',
    });
    expect(events.map((e) => (e.data as { type: string }).type)).not.toContain('done');
    // the raw model .text (incl. the bad enum value 'exploded' and 'boom') must never
    // leak into the error frame — the mapper carries only a fixed sanitized message.
    // this assertion fails the moment the mapper starts echoing raw provider text.
    expect(JSON.stringify(errorFrames[0].data)).not.toContain('exploded');
    expect(JSON.stringify(errorFrames[0].data)).not.toContain('boom');
    expect(mockRunRecordService.create).not.toHaveBeenCalled();
  });
});
