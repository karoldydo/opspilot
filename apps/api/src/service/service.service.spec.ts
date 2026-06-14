import { AuditService } from '@api/audit/audit.service';
import { ConfigModule } from '@api/config/config.module';
import { cryptoConfig } from '@api/config/crypto.config';
import { databaseConfig } from '@api/config/database.config';
import { DatabaseModule } from '@api/core/database/database.module';
import { MigrationService } from '@api/core/database/migration/migration.service';
import { DATABASE_CONNECTION, DatabaseConnection } from '@api/core/database/providers/database-connection.provider';
import { device } from '@api/core/database/schema';
import { user } from '@api/core/database/schema/auth.schema';
import { ExecResult } from '@api/integrations/executor/executor.interface';
import { EXECUTOR } from '@api/integrations/executor/executor.token';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { DockerDaemonDownError, DockerNotFoundError } from './service.errors';
import { ServiceModule } from './service.module';
import { ServiceService } from './service.service';

describe('ServiceService', () => {
  // a fixed 32-byte key (0x01 * 32) base64-encoded — cryptoConfig is read through
  // the imported CredentialModule even though decryption is never exercised here.
  const inputKey = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';
  // valid uuids — serviceSchema/toContract enforce z.uuid() on id + deviceId.
  const inputDeviceId = '11111111-1111-4111-8111-111111111111';
  const otherDeviceId = '22222222-2222-4222-8222-222222222222';
  // the session user whose id the audit insert keys off (fk → user.id).
  const userId = 'user-svc-test';

  let moduleRef: TestingModule;
  let db: DatabaseConnection;
  let service: ServiceService;
  let auditService: AuditService;
  let dbPath: string;
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
    dbPath = join(tmpdir(), `opspilot-svc-test-${process.pid}-${Date.now()}.db`);
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule, ServiceModule],
    })
      .overrideProvider(databaseConfig.KEY)
      .useValue({ backupRetention: 5, path: dbPath })
      .overrideProvider(cryptoConfig.KEY)
      .useValue({ encryptionKey: inputKey })
      .overrideProvider(EXECUTOR)
      .useValue(mockExecutor)
      .compile();
    db = moduleRef.get<DatabaseConnection>(DATABASE_CONNECTION);
    await moduleRef.get(MigrationService).onApplicationBootstrap();
    service = moduleRef.get(ServiceService);
    auditService = moduleRef.get(AuditService);
    // seed the fk targets — service.deviceId references device.id (cascade).
    db.insert(device).values({ host: '10.0.0.1', id: inputDeviceId, name: 'host-a' }).run();
    db.insert(device).values({ host: '10.0.0.2', id: otherDeviceId, name: 'host-b' }).run();
    // seed the audit fk target — audit_log.userId references user.id.
    db.insert(user).values({ email: 'u1@example.com', id: userId, name: 'u1' }).run();
  });

  afterEach(async () => {
    db?.$client.close();
    await moduleRef?.close();
    cleanupTempFiles();
  });

  function execResult(overrides: Partial<ExecResult> = {}): ExecResult {
    return { code: 0, stderr: '', stdout: '', ...overrides };
  }

  it('parses docker ps NDJSON into a ScanResult, deriving compose labels', async () => {
    const stdout = [
      JSON.stringify({
        Image: 'nginx:latest',
        Labels: 'com.docker.compose.project=web,com.docker.compose.project.config_files=/srv/web/compose.yml',
        Names: 'web-proxy',
        State: 'running',
        Status: 'Up 2 hours',
      }),
      JSON.stringify({ Image: 'redis:7', Labels: '', Names: 'standalone-redis', State: 'running', Status: 'Up 1 day' }),
    ].join('\n');
    mockExecutor.execute.mockResolvedValue(execResult({ stdout }));

    const actual = await service.scan(inputDeviceId, userId);

    expect(actual.containers).toEqual([
      {
        composePath: '/srv/web/compose.yml',
        composeProject: 'web',
        containerName: 'web-proxy',
        image: 'nginx:latest',
        state: 'running',
        status: 'Up 2 hours',
      },
      {
        composePath: null,
        composeProject: null,
        containerName: 'standalone-redis',
        image: 'redis:7',
        state: 'running',
        status: 'Up 1 day',
      },
    ]);
    expect(mockExecutor.execute).toHaveBeenCalledWith(
      inputDeviceId,
      'export PATH="/usr/local/bin:/usr/local/sbin:/volume1/@appstore/ContainerManager/usr/bin:$PATH"; ' +
        'docker ps --no-trunc --format ' +
        `'{"Names":{{json .Names}},"Image":{{json .Image}},"State":{{json .State}},"Status":{{json .Status}},"Labels":{{json .Labels}}}'`
    );
  });

  it('writes one service.scan audit row carrying the live container count', async () => {
    const stdout = [
      JSON.stringify({ Image: 'nginx', Labels: '', Names: 'web', State: 'running', Status: 'Up' }),
      JSON.stringify({ Image: 'redis', Labels: '', Names: 'cache', State: 'running', Status: 'Up' }),
    ].join('\n');
    mockExecutor.execute.mockResolvedValue(execResult({ stdout }));

    await service.scan(inputDeviceId, userId);

    const events = auditService.list({ offset: 0 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'service.scan',
      metadata: { found: 2 },
      targetId: inputDeviceId,
      targetType: 'device',
      userId,
    });
  });

  it('records no audit row when a scan fails (docker error throws)', async () => {
    mockExecutor.execute.mockResolvedValue(execResult({ code: 127, stderr: 'bash: docker: command not found' }));

    await expect(service.scan(inputDeviceId, userId)).rejects.toBeInstanceOf(DockerNotFoundError);
    expect(auditService.list({ offset: 0 })).toHaveLength(0);
  });

  it('maps a missing docker binary to DockerNotFoundError', async () => {
    mockExecutor.execute.mockResolvedValue(execResult({ code: 127, stderr: 'bash: docker: command not found' }));

    await expect(service.scan(inputDeviceId, userId)).rejects.toBeInstanceOf(DockerNotFoundError);
  });

  it('maps a localized "command not found" to DockerNotFoundError via exit code 127', async () => {
    // a non-english host localizes the shell error (polish), so the english regex
    // misses it — exit code 127 is the locale-independent signal that classifies it.
    mockExecutor.execute.mockResolvedValue(
      execResult({ code: 127, stderr: 'bash: docker: nie odnaleziono polecenia' })
    );

    await expect(service.scan(inputDeviceId, userId)).rejects.toBeInstanceOf(DockerNotFoundError);
  });

  it('maps a stopped daemon to DockerDaemonDownError', async () => {
    mockExecutor.execute.mockResolvedValue(
      execResult({ code: 1, stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock.' })
    );

    await expect(service.scan(inputDeviceId, userId)).rejects.toBeInstanceOf(DockerDaemonDownError);
  });

  it('round-trips a service through create / findAll / update / remove', async () => {
    const created = await service.create(
      {
        containerName: 'web-proxy',
        deviceId: inputDeviceId,
        name: 'Web Proxy',
      },
      userId
    );
    expect(created).toEqual({
      composePath: null,
      composeProject: null,
      containerName: 'web-proxy',
      createdAt: expect.any(String),
      deviceId: inputDeviceId,
      id: expect.any(String),
      name: 'Web Proxy',
      updatedAt: expect.any(String),
    });

    const listed = await service.findAll(inputDeviceId);
    expect(listed).toHaveLength(1);

    const renamed = await service.update(inputDeviceId, created.id, { name: 'Reverse Proxy' }, userId);
    expect(renamed.name).toBe('Reverse Proxy');

    await service.remove(inputDeviceId, created.id, userId);
    expect(await service.findAll(inputDeviceId)).toHaveLength(0);
  });

  it('writes one audit row keyed off the session user on create', async () => {
    const created = await service.create({ containerName: 'web', deviceId: inputDeviceId, name: 'Web' }, userId);

    const events = auditService.list({ offset: 0 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'service.create',
      metadata: { containerName: 'web', deviceId: inputDeviceId, name: 'Web' },
      targetId: created.id,
      targetType: 'service',
      userId,
    });
  });

  it('rejects a duplicate (deviceId, containerName) with a ConflictException', async () => {
    await service.create({ containerName: 'dup', deviceId: inputDeviceId, name: 'first' }, userId);

    await expect(
      service.create({ containerName: 'dup', deviceId: inputDeviceId, name: 'second' }, userId)
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('isolates services per device (no cross-device read or mutation)', async () => {
    const created = await service.create({ containerName: 'web', deviceId: inputDeviceId, name: 'web' }, userId);

    // a different device sees none of inputDevice's services.
    expect(await service.findAll(otherDeviceId)).toHaveLength(0);
    // and cannot mutate them — the cross-device id yields a 404.
    await expect(service.update(otherDeviceId, created.id, { name: 'x' }, userId)).rejects.toBeInstanceOf(
      NotFoundException
    );
    await expect(service.remove(otherDeviceId, created.id, userId)).rejects.toBeInstanceOf(NotFoundException);
  });
});
