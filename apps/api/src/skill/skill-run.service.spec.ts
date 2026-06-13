import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Service, Skill, SkillParameter } from '@opspilot/shared';
import { ZodError } from 'zod';

import { AuditService } from '../audit/audit.service';
import { SkillConfig } from '../config/skill.config';
import { ExecResult } from '../executor/executor.interface';
import { DockerDaemonDownError, DockerNotFoundError } from '../service/service.errors';
import { ServiceService } from '../service/service.service';
import { SkillRunService } from './skill-run.service';
import { SkillService } from './skill.service';

describe('SkillRunService', () => {
  const inputDeviceId = '11111111-1111-4111-8111-111111111111';
  const inputServiceId = '22222222-2222-4222-8222-222222222222';
  const inputSkillId = '33333333-3333-4333-8333-333333333333';
  const inputContainerName = 'web-proxy';
  // the session user whose id the tier-2 skill.run audit row keys off.
  const userId = 'user-skill-run-test';
  const pathPrefix = 'export PATH="/usr/local/bin:/usr/local/sbin:/volume1/@appstore/ContainerManager/usr/bin:$PATH"; ';
  const config: SkillConfig = { timeoutMs: 300000 };

  const mockExecutor = {
    execute: vi.fn<(deviceId: string, command: string, timeoutMs?: number) => Promise<ExecResult>>(),
  };
  const mockServiceService = { findOne: vi.fn<(deviceId: string, id: string) => Promise<Service>>() };
  const mockSkillService = { findForDevice: vi.fn<(deviceId: string) => Promise<Skill[]>>() };
  const mockAuditService = { record: vi.fn() };

  function buildService(): SkillRunService {
    return new SkillRunService(
      mockExecutor,
      mockServiceService as unknown as ServiceService,
      mockSkillService as unknown as SkillService,
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

  function composeRow(overrides: Partial<Service> = {}): Service {
    return serviceRow({ composePath: '/volume1/docker/stack/compose.yaml', composeProject: 'stack', ...overrides });
  }

  const serviceParam = (name: string): SkillParameter => ({ name, required: true, source: 'service' });
  const inputParam = (name: string): SkillParameter => ({ name, required: true, source: 'input' });

  function skillRow(overrides: Partial<Skill> = {}): Skill {
    return {
      commandTemplate: 'docker restart {{containerName}}',
      createdAt: '2026-06-11T09:00:00.000Z',
      deviceId: null,
      id: inputSkillId,
      name: 'restart',
      parameters: [serviceParam('containerName')],
      timeoutMs: null,
      updatedAt: '2026-06-11T09:00:00.000Z',
      ...overrides,
    };
  }

  function execResult(overrides: Partial<ExecResult> = {}): ExecResult {
    return { code: 0, stderr: '', stdout: '', ...overrides };
  }

  beforeEach(() => {
    mockExecutor.execute.mockReset();
    mockServiceService.findOne.mockReset();
    mockSkillService.findForDevice.mockReset();
    mockAuditService.record.mockReset();
    mockServiceService.findOne.mockResolvedValue(serviceRow());
    mockSkillService.findForDevice.mockResolvedValue([skillRow()]);
    mockExecutor.execute.mockResolvedValue(execResult({ stdout: inputContainerName }));
  });

  it('renders a container-scoped skill, substituting the service param under the config timeout', async () => {
    const actual = await buildService().run(inputDeviceId, inputServiceId, inputSkillId, {}, userId);

    expect(mockExecutor.execute).toHaveBeenCalledWith(
      inputDeviceId,
      `${pathPrefix}docker restart ${inputContainerName}`,
      config.timeoutMs
    );
    expect(actual).toEqual({ message: inputContainerName, status: 'succeeded' });
  });

  it('renders a compose-scoped skill carrying both -f and -p', async () => {
    mockServiceService.findOne.mockResolvedValue(composeRow());
    mockSkillService.findForDevice.mockResolvedValue([
      skillRow({
        commandTemplate: 'docker compose -f {{composePath}} -p {{composeProject}} up -d',
        name: 'up',
        parameters: [serviceParam('composePath'), serviceParam('composeProject')],
      }),
    ]);

    await buildService().run(inputDeviceId, inputServiceId, inputSkillId, {}, userId);

    expect(mockExecutor.execute).toHaveBeenCalledWith(
      inputDeviceId,
      `${pathPrefix}docker compose -f /volume1/docker/stack/compose.yaml -p stack up -d`,
      config.timeoutMs
    );
  });

  it('uses the skill row timeoutMs override when present', async () => {
    mockSkillService.findForDevice.mockResolvedValue([skillRow({ timeoutMs: 60000 })]);

    await buildService().run(inputDeviceId, inputServiceId, inputSkillId, {}, userId);

    expect(mockExecutor.execute).toHaveBeenCalledWith(inputDeviceId, expect.any(String), 60000);
  });

  it('substitutes an input param read from the request body', async () => {
    mockSkillService.findForDevice.mockResolvedValue([
      skillRow({
        commandTemplate: 'docker logs --tail {{tail}} {{containerName}}',
        name: 'logs',
        parameters: [inputParam('tail'), serviceParam('containerName')],
      }),
    ]);

    await buildService().run(inputDeviceId, inputServiceId, inputSkillId, { tail: '200' }, userId);

    expect(mockExecutor.execute).toHaveBeenCalledWith(
      inputDeviceId,
      `${pathPrefix}docker logs --tail 200 ${inputContainerName}`,
      config.timeoutMs
    );
  });

  it('returns 404 for a skillId out of scope (forged / other device), running no command', async () => {
    mockSkillService.findForDevice.mockResolvedValue([]);

    await expect(buildService().run(inputDeviceId, inputServiceId, inputSkillId, {}, userId)).rejects.toBeInstanceOf(
      NotFoundException
    );
    expect(mockExecutor.execute).not.toHaveBeenCalled();
  });

  it('rejects a compose skill on a service with null compose fields with a 400, building no command', async () => {
    mockSkillService.findForDevice.mockResolvedValue([
      skillRow({
        commandTemplate: 'docker compose -f {{composePath}} -p {{composeProject}} down',
        name: 'down',
        parameters: [serviceParam('composePath'), serviceParam('composeProject')],
      }),
    ]);

    await expect(buildService().run(inputDeviceId, inputServiceId, inputSkillId, {}, userId)).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(mockExecutor.execute).not.toHaveBeenCalled();
  });

  it('rejects a missing required input with a 400, building no command', async () => {
    mockSkillService.findForDevice.mockResolvedValue([
      skillRow({
        commandTemplate: 'docker logs --tail {{tail}} {{containerName}}',
        name: 'logs',
        parameters: [inputParam('tail'), serviceParam('containerName')],
      }),
    ]);

    await expect(buildService().run(inputDeviceId, inputServiceId, inputSkillId, {}, userId)).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(mockExecutor.execute).not.toHaveBeenCalled();
  });

  it('rejects a tainted service value at the charset boundary before any command is built', async () => {
    mockServiceService.findOne.mockResolvedValue(serviceRow({ containerName: 'web-proxy; whoami' }));

    await expect(buildService().run(inputDeviceId, inputServiceId, inputSkillId, {}, userId)).rejects.toBeInstanceOf(
      ZodError
    );
    expect(mockExecutor.execute).not.toHaveBeenCalled();
  });

  it('maps a clean exit (code 0) to a succeeded result carrying the merged output', async () => {
    mockExecutor.execute.mockResolvedValue(execResult({ stderr: 'err line', stdout: 'out line' }));

    const actual = await buildService().run(inputDeviceId, inputServiceId, inputSkillId, {}, userId);

    expect(actual).toEqual({ message: 'out line\nerr line', status: 'succeeded' });
  });

  it('maps a skill-specific non-zero exit to a failed result with the cleaned stderr', async () => {
    mockExecutor.execute.mockResolvedValue(execResult({ code: 1, stderr: 'Error: No such container: web-proxy\n' }));

    const actual = await buildService().run(inputDeviceId, inputServiceId, inputSkillId, {}, userId);

    expect(actual).toEqual({ message: 'Error: No such container: web-proxy', status: 'failed' });
  });

  it('throws a daemon-down 503 on the docker daemon-unreachable message', async () => {
    mockExecutor.execute.mockResolvedValue(
      execResult({ code: 1, stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock.' })
    );

    await expect(buildService().run(inputDeviceId, inputServiceId, inputSkillId, {}, userId)).rejects.toBeInstanceOf(
      DockerDaemonDownError
    );
  });

  it('throws a docker-not-found 503 on exit code 127', async () => {
    mockExecutor.execute.mockResolvedValue(execResult({ code: 127, stderr: 'docker: command not found' }));

    await expect(buildService().run(inputDeviceId, inputServiceId, inputSkillId, {}, userId)).rejects.toBeInstanceOf(
      DockerNotFoundError
    );
  });

  it('records a tier-2 skill.run audit row carrying the succeeded outcome', async () => {
    await buildService().run(inputDeviceId, inputServiceId, inputSkillId, {}, userId);

    expect(mockAuditService.record).toHaveBeenCalledTimes(1);
    // recorded on the base connection (no tx) with secret-free metadata.
    expect(mockAuditService.record).toHaveBeenCalledWith({
      action: 'skill.run',
      metadata: { outcome: 'succeeded', skillName: 'restart' },
      targetId: inputServiceId,
      targetType: 'service',
      userId,
    });
  });

  it('records the failed outcome on a skill-specific non-zero exit', async () => {
    mockExecutor.execute.mockResolvedValue(execResult({ code: 1, stderr: 'Error: No such container: web-proxy\n' }));

    await buildService().run(inputDeviceId, inputServiceId, inputSkillId, {}, userId);

    expect(mockAuditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'skill.run', metadata: { outcome: 'failed', skillName: 'restart' } })
    );
  });

  it('records no audit row when an infra error (daemon-down) throws before the result', async () => {
    mockExecutor.execute.mockResolvedValue(
      execResult({ code: 1, stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock.' })
    );

    await expect(buildService().run(inputDeviceId, inputServiceId, inputSkillId, {}, userId)).rejects.toBeInstanceOf(
      DockerDaemonDownError
    );
    expect(mockAuditService.record).not.toHaveBeenCalled();
  });

  it('propagates the findOne 404 (cross-device / absent service) without running a command', async () => {
    mockServiceService.findOne.mockRejectedValue(new Error('service not found'));

    await expect(buildService().run(inputDeviceId, inputServiceId, inputSkillId, {}, userId)).rejects.toThrow();
    expect(mockExecutor.execute).not.toHaveBeenCalled();
  });
});
