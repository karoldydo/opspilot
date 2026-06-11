import { ServiceUnavailableException } from '@nestjs/common';
import { DiagnosisSynthesis, Service } from '@opspilot/shared';
import { generateText, NoObjectGeneratedError } from 'ai';

import { LlmConfig } from '../config/llm.config';
import { ExecResult } from '../executor/executor.interface';
import { LlmProviderClientFactory } from '../llm-provider/llm-provider.client-factory';
import { LlmProviderService } from '../llm-provider/llm-provider.service';
import { ServiceService } from '../service/service.service';
import { DiagnosisSynthesisError, DiagnosisTimeoutError } from './diagnose.errors';
import { DiagnoseService } from './diagnose.service';

// stub generateText but keep the real Output + NoObjectGeneratedError so the
// service's Output.object call and the .isInstance narrowing behave for real.
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return { ...actual, generateText: vi.fn() };
});

const mockedGenerateText = vi.mocked(generateText);

describe('DiagnoseService', () => {
  const inputDeviceId = '11111111-1111-4111-8111-111111111111';
  const inputServiceId = '22222222-2222-4222-8222-222222222222';
  const inputContainerName = 'web-proxy';
  const expectedCommand =
    'export PATH="/usr/local/bin:/usr/local/sbin:/volume1/@appstore/ContainerManager/usr/bin:$PATH"; ' +
    'docker logs web-proxy --tail 200';
  const validSynthesis: DiagnosisSynthesis = {
    problems: ['port 5432 connection refused'],
    status: 'degraded',
    suggestions: ['restart the database container'],
    summary: 'service is degraded due to a database connectivity error',
  };

  const mockExecutor = { execute: vi.fn<(deviceId: string, command: string) => Promise<ExecResult>>() };
  const mockServiceService = { findOne: vi.fn<(deviceId: string, id: string) => Promise<Service>>() };
  const mockLlmProviderService = {
    getActiveProviderConfig: vi.fn<() => Promise<{ apiKey: string; baseURL: string; kind: string; model: string }>>(),
  };
  const mockModel = { id: 'fake-model' };
  const mockClientFactory = { create: vi.fn(() => mockModel) };
  const config: LlmConfig = { generateTimeoutMs: 12000, logsTailLines: 200, logsTimeoutMs: 5000, testTimeoutMs: 5000 };

  function buildService(): DiagnoseService {
    return new DiagnoseService(
      mockExecutor,
      mockServiceService as unknown as ServiceService,
      mockLlmProviderService as unknown as LlmProviderService,
      mockClientFactory as unknown as LlmProviderClientFactory,
      config
    );
  }

  function serviceRow(overrides: Partial<Service> = {}): Service {
    return {
      composePath: null,
      composeProject: null,
      containerName: inputContainerName,
      createdAt: new Date().toISOString(),
      deviceId: inputDeviceId,
      id: inputServiceId,
      name: 'Web Proxy',
      updatedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  function execResult(overrides: Partial<ExecResult> = {}): ExecResult {
    return { code: 0, stderr: '', stdout: '', ...overrides };
  }

  beforeEach(() => {
    mockExecutor.execute.mockReset();
    mockServiceService.findOne.mockReset();
    mockLlmProviderService.getActiveProviderConfig.mockReset();
    mockClientFactory.create.mockClear();
    mockedGenerateText.mockReset();

    mockServiceService.findOne.mockResolvedValue(serviceRow());
    mockLlmProviderService.getActiveProviderConfig.mockResolvedValue({
      apiKey: 'sk-active',
      baseURL: 'https://api.example.com/v1',
      kind: 'openai-compatible',
      model: 'gpt-4o',
    });
  });

  it('runs docker logs with the PATH-prefix + --tail and merges stderr into the prompt', async () => {
    mockExecutor.execute.mockResolvedValue(execResult({ stderr: 'err line', stdout: 'out line' }));
    mockedGenerateText.mockResolvedValue({ output: validSynthesis } as never);

    const actual = await buildService().diagnose(inputDeviceId, inputServiceId);

    expect(actual).toEqual(validSynthesis);
    expect(mockExecutor.execute).toHaveBeenCalledWith(inputDeviceId, expectedCommand);
    // docker logs → stderr, so both streams must reach the synthesis input.
    const prompt = mockedGenerateText.mock.calls[0][0].prompt as string;
    expect(prompt).toContain('out line');
    expect(prompt).toContain('err line');
    expect(mockClientFactory.create).toHaveBeenCalledWith({
      apiKey: 'sk-active',
      baseURL: 'https://api.example.com/v1',
      kind: 'openai-compatible',
      model: 'gpt-4o',
    });
  });

  it('maps NoObjectGeneratedError (schema not enforced) to a 5xx DiagnosisSynthesisError', async () => {
    mockExecutor.execute.mockResolvedValue(execResult({ stderr: 'some logs' }));
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

    await expect(buildService().diagnose(inputDeviceId, inputServiceId)).rejects.toBeInstanceOf(
      DiagnosisSynthesisError
    );
  });

  it('maps a generation timeout (AbortSignal.timeout) to a 504 DiagnosisTimeoutError', async () => {
    mockExecutor.execute.mockResolvedValue(execResult({ stderr: 'some logs' }));
    const timeoutError = new Error('the operation was aborted');
    timeoutError.name = 'TimeoutError';
    mockedGenerateText.mockRejectedValue(timeoutError);

    await expect(buildService().diagnose(inputDeviceId, inputServiceId)).rejects.toBeInstanceOf(DiagnosisTimeoutError);
  });

  it('surfaces a non-zero docker exit as a docker 5xx, never reaching synthesis', async () => {
    mockExecutor.execute.mockResolvedValue(execResult({ code: 1, stderr: 'Error: No such container: web-proxy' }));

    await expect(buildService().diagnose(inputDeviceId, inputServiceId)).rejects.toBeInstanceOf(
      ServiceUnavailableException
    );
    expect(mockClientFactory.create).not.toHaveBeenCalled();
    expect(mockedGenerateText).not.toHaveBeenCalled();
  });

  it('fails fast on no active provider before any ssh logs fetch', async () => {
    mockLlmProviderService.getActiveProviderConfig.mockRejectedValue(new Error('no active llm provider configured'));

    await expect(buildService().diagnose(inputDeviceId, inputServiceId)).rejects.toThrow();
    expect(mockExecutor.execute).not.toHaveBeenCalled();
  });
});
