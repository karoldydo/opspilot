import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { ConfigModule } from '../config/config.module';
import { cryptoConfig } from '../config/crypto.config';
import { databaseConfig } from '../config/database.config';
import { DatabaseModule } from '../database/database.module';
import { MigrationService } from '../database/migration/migration.service';
import { DATABASE_CONNECTION, DatabaseConnection } from '../database/providers/database-connection.provider';
import { device } from '../database/schema';
import { ExecResult } from '../executor/executor.interface';
import { EXECUTOR } from '../executor/executor.token';
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

  let moduleRef: TestingModule;
  let db: DatabaseConnection;
  let service: ServiceService;
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
    // seed the fk targets — service.deviceId references device.id (cascade).
    db.insert(device).values({ host: '10.0.0.1', id: inputDeviceId, name: 'host-a' }).run();
    db.insert(device).values({ host: '10.0.0.2', id: otherDeviceId, name: 'host-b' }).run();
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

    const actual = await service.scan(inputDeviceId);

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

  it('maps a missing docker binary to DockerNotFoundError', async () => {
    mockExecutor.execute.mockResolvedValue(execResult({ code: 127, stderr: 'bash: docker: command not found' }));

    await expect(service.scan(inputDeviceId)).rejects.toBeInstanceOf(DockerNotFoundError);
  });

  it('maps a localized "command not found" to DockerNotFoundError via exit code 127', async () => {
    // a non-english host localizes the shell error (polish), so the english regex
    // misses it — exit code 127 is the locale-independent signal that classifies it.
    mockExecutor.execute.mockResolvedValue(
      execResult({ code: 127, stderr: 'bash: docker: nie odnaleziono polecenia' })
    );

    await expect(service.scan(inputDeviceId)).rejects.toBeInstanceOf(DockerNotFoundError);
  });

  it('maps a stopped daemon to DockerDaemonDownError', async () => {
    mockExecutor.execute.mockResolvedValue(
      execResult({ code: 1, stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock.' })
    );

    await expect(service.scan(inputDeviceId)).rejects.toBeInstanceOf(DockerDaemonDownError);
  });

  it('round-trips a service through create / findAll / update / remove', async () => {
    const created = await service.create({
      containerName: 'web-proxy',
      deviceId: inputDeviceId,
      name: 'Web Proxy',
    });
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

    const renamed = await service.update(inputDeviceId, created.id, { name: 'Reverse Proxy' });
    expect(renamed.name).toBe('Reverse Proxy');

    await service.remove(inputDeviceId, created.id);
    expect(await service.findAll(inputDeviceId)).toHaveLength(0);
  });

  it('rejects a duplicate (deviceId, containerName) with a ConflictException', async () => {
    await service.create({ containerName: 'dup', deviceId: inputDeviceId, name: 'first' });

    await expect(
      service.create({ containerName: 'dup', deviceId: inputDeviceId, name: 'second' })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('isolates services per device (no cross-device read or mutation)', async () => {
    const created = await service.create({ containerName: 'web', deviceId: inputDeviceId, name: 'web' });

    // a different device sees none of inputDevice's services.
    expect(await service.findAll(otherDeviceId)).toHaveLength(0);
    // and cannot mutate them — the cross-device id yields a 404.
    await expect(service.update(otherDeviceId, created.id, { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(otherDeviceId, created.id)).rejects.toBeInstanceOf(NotFoundException);
  });
});
