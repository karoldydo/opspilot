import { BadRequestException } from '@nestjs/common';
import { Service } from '@opspilot/shared';
import { ZodError } from 'zod';

import { OperationConfig } from '../config/operation.config';
import { ExecResult } from '../executor/executor.interface';
import { DockerDaemonDownError, DockerNotFoundError } from '../service/service.errors';
import { ServiceService } from '../service/service.service';
import { OperationService } from './operation.service';

describe('OperationService', () => {
  const inputDeviceId = '11111111-1111-4111-8111-111111111111';
  const inputServiceId = '22222222-2222-4222-8222-222222222222';
  const inputContainerName = 'web-proxy';
  const pathPrefix = 'export PATH="/usr/local/bin:/usr/local/sbin:/volume1/@appstore/ContainerManager/usr/bin:$PATH"; ';
  const config: OperationConfig = { timeoutMs: 300000 };

  const mockExecutor = {
    execute: vi.fn<(deviceId: string, command: string, timeoutMs?: number) => Promise<ExecResult>>(),
  };
  const mockServiceService = { findOne: vi.fn<(deviceId: string, id: string) => Promise<Service>>() };

  function buildService(): OperationService {
    return new OperationService(mockExecutor, mockServiceService as unknown as ServiceService, config);
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

  function composeRow(overrides: Partial<Service> = {}): Service {
    return serviceRow({ composePath: '/volume1/docker/stack/compose.yaml', composeProject: 'stack', ...overrides });
  }

  function execResult(overrides: Partial<ExecResult> = {}): ExecResult {
    return { code: 0, stderr: '', stdout: '', ...overrides };
  }

  beforeEach(() => {
    mockExecutor.execute.mockReset();
    mockServiceService.findOne.mockReset();
    mockServiceService.findOne.mockResolvedValue(serviceRow());
    mockExecutor.execute.mockResolvedValue(execResult({ stdout: inputContainerName }));
  });

  it.each(['start', 'stop', 'restart'] as const)(
    'builds a container-scoped `docker %s <containerName>` command under the op timeout',
    async (operation) => {
      const actual = await buildService().run(inputDeviceId, inputServiceId, operation);

      expect(mockExecutor.execute).toHaveBeenCalledWith(
        inputDeviceId,
        `${pathPrefix}docker ${operation} ${inputContainerName}`,
        config.timeoutMs
      );
      expect(actual).toEqual({ message: inputContainerName, operation, status: 'succeeded' });
    }
  );

  it('builds a compose-scoped `up -d` command carrying both -f and -p', async () => {
    mockServiceService.findOne.mockResolvedValue(composeRow());

    await buildService().run(inputDeviceId, inputServiceId, 'up');

    expect(mockExecutor.execute).toHaveBeenCalledWith(
      inputDeviceId,
      `${pathPrefix}docker compose -f /volume1/docker/stack/compose.yaml -p stack up -d`,
      config.timeoutMs
    );
  });

  it('builds a compose-scoped `down` command carrying both -f and -p', async () => {
    mockServiceService.findOne.mockResolvedValue(composeRow());

    await buildService().run(inputDeviceId, inputServiceId, 'down');

    expect(mockExecutor.execute).toHaveBeenCalledWith(
      inputDeviceId,
      `${pathPrefix}docker compose -f /volume1/docker/stack/compose.yaml -p stack down`,
      config.timeoutMs
    );
  });

  it.each(['up', 'down'] as const)(
    'rejects %s on a service with null compose fields with a 400, building no command',
    async (operation) => {
      mockServiceService.findOne.mockResolvedValue(serviceRow());

      await expect(buildService().run(inputDeviceId, inputServiceId, operation)).rejects.toBeInstanceOf(
        BadRequestException
      );
      expect(mockExecutor.execute).not.toHaveBeenCalled();
    }
  );

  it('rejects a compose op when only one compose field is present (400)', async () => {
    mockServiceService.findOne.mockResolvedValue(composeRow({ composeProject: null }));

    await expect(buildService().run(inputDeviceId, inputServiceId, 'up')).rejects.toBeInstanceOf(BadRequestException);
    expect(mockExecutor.execute).not.toHaveBeenCalled();
  });

  it('rejects a malformed composePath at the boundary before any command is built', async () => {
    mockServiceService.findOne.mockResolvedValue(composeRow({ composePath: '/tmp/x; rm -rf /' }));

    await expect(buildService().run(inputDeviceId, inputServiceId, 'up')).rejects.toBeInstanceOf(ZodError);
    expect(mockExecutor.execute).not.toHaveBeenCalled();
  });

  it('rejects a malformed composeProject at the boundary before any command is built', async () => {
    mockServiceService.findOne.mockResolvedValue(composeRow({ composeProject: 'stack$(whoami)' }));

    await expect(buildService().run(inputDeviceId, inputServiceId, 'down')).rejects.toBeInstanceOf(ZodError);
    expect(mockExecutor.execute).not.toHaveBeenCalled();
  });

  it('rejects a malformed containerName at the boundary before any command is built', async () => {
    mockServiceService.findOne.mockResolvedValue(serviceRow({ containerName: 'web-proxy; whoami' }));

    await expect(buildService().run(inputDeviceId, inputServiceId, 'start')).rejects.toBeInstanceOf(ZodError);
    expect(mockExecutor.execute).not.toHaveBeenCalled();
  });

  it('maps a clean exit (code 0) to a succeeded result carrying the merged output', async () => {
    mockExecutor.execute.mockResolvedValue(execResult({ stderr: 'err line', stdout: 'out line' }));

    const actual = await buildService().run(inputDeviceId, inputServiceId, 'restart');

    expect(actual).toEqual({ message: 'out line\nerr line', operation: 'restart', status: 'succeeded' });
  });

  it('maps an op-specific non-zero exit to a failed result with the cleaned stderr', async () => {
    mockExecutor.execute.mockResolvedValue(execResult({ code: 1, stderr: 'Error: No such container: web-proxy\n' }));

    const actual = await buildService().run(inputDeviceId, inputServiceId, 'stop');

    expect(actual).toEqual({ message: 'Error: No such container: web-proxy', operation: 'stop', status: 'failed' });
  });

  it('throws a daemon-down 503 on the docker daemon-unreachable message', async () => {
    mockExecutor.execute.mockResolvedValue(
      execResult({ code: 1, stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock.' })
    );

    await expect(buildService().run(inputDeviceId, inputServiceId, 'start')).rejects.toBeInstanceOf(
      DockerDaemonDownError
    );
  });

  it('throws a docker-not-found 503 on exit code 127', async () => {
    mockExecutor.execute.mockResolvedValue(execResult({ code: 127, stderr: 'docker: command not found' }));

    await expect(buildService().run(inputDeviceId, inputServiceId, 'start')).rejects.toBeInstanceOf(
      DockerNotFoundError
    );
  });

  it('propagates the findOne 404 (cross-device / absent service) without running a command', async () => {
    mockServiceService.findOne.mockRejectedValue(new Error('service not found'));

    await expect(buildService().run(inputDeviceId, inputServiceId, 'start')).rejects.toThrow();
    expect(mockExecutor.execute).not.toHaveBeenCalled();
  });
});
