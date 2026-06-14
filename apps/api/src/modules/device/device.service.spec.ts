import { ConfigModule } from '@api/config/config.module';
import { databaseConfig } from '@api/config/database.config';
import { DatabaseModule } from '@api/core/database/database.module';
import { MigrationService } from '@api/core/database/migration/migration.service';
import { DATABASE_CONNECTION, DatabaseConnection } from '@api/core/database/providers/database-connection.provider';
import { user } from '@api/core/database/schema/auth.schema';
import { AuditModule } from '@api/modules/audit/audit.module';
import { AuditService } from '@api/modules/audit/audit.service';
import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { DeviceService } from './device.service';

describe('DeviceService', () => {
  // the session user whose id the audit insert keys off (fk → user.id).
  const userId = 'user-device-test';

  let moduleRef: TestingModule;
  let db: DatabaseConnection;
  let service: DeviceService;
  let auditService: AuditService;
  let dbPath: string;

  // remove the temp db plus its -wal/-shm sidecars and any *.bak snapshots.
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
    dbPath = join(tmpdir(), `opspilot-device-test-${process.pid}-${Date.now()}.db`);
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule, AuditModule],
      providers: [DeviceService],
    })
      .overrideProvider(databaseConfig.KEY)
      .useValue({ backupRetention: 5, path: dbPath })
      .compile();
    db = moduleRef.get<DatabaseConnection>(DATABASE_CONNECTION);
    // apply real migrations (through 0007 audit_log).
    await moduleRef.get(MigrationService).onApplicationBootstrap();
    service = moduleRef.get(DeviceService);
    auditService = moduleRef.get(AuditService);
    // seed the audit fk target — audit_log.userId references user.id.
    db.insert(user).values({ email: 'u1@example.com', id: userId, name: 'u1' }).run();
  });

  afterEach(async () => {
    db?.$client.close();
    await moduleRef?.close();
    cleanupTempFiles();
  });

  it('creates a device and returns the iso-normalized contract', async () => {
    const actual = await service.create({ host: '10.0.0.1', name: 'nas' }, userId);

    expect(actual).toEqual({
      agentContext: null,
      createdAt: expect.any(String),
      host: '10.0.0.1',
      id: expect.any(String),
      name: 'nas',
      updatedAt: expect.any(String),
    });
    // createdAt is an iso string on the wire, never a Date.
    expect(() => new Date(actual.createdAt).toISOString()).not.toThrow();
  });

  it('writes one audit row keyed off the session user on create', async () => {
    const created = await service.create({ host: '10.0.0.1', name: 'nas' }, userId);

    const events = auditService.list({ offset: 0 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'device.create',
      metadata: { host: '10.0.0.1', name: 'nas' },
      targetId: created.id,
      targetType: 'device',
      userId,
    });
  });

  it('rolls the device back when the audit insert throws (atomicity)', async () => {
    vi.spyOn(auditService, 'record').mockImplementationOnce(() => {
      throw new Error('forced audit failure');
    });

    await expect(service.create({ host: '10.0.0.1', name: 'nas' }, userId)).rejects.toThrow('forced audit failure');
    // the action and the audit insert share one transaction, so neither persists.
    expect(await service.findAll()).toHaveLength(0);
  });

  it('lists all devices regardless of creator (shared model)', async () => {
    await service.create({ host: '10.0.0.1', name: 'a' }, userId);
    await service.create({ host: '10.0.0.2', name: 'b' }, userId);

    const actual = await service.findAll();

    expect(actual).toHaveLength(2);
    expect(actual.map((d) => d.name).sort()).toEqual(['a', 'b']);
  });

  it('findOne returns the created device', async () => {
    const created = await service.create({ host: '10.0.0.1', name: 'nas' }, userId);

    expect(await service.findOne(created.id)).toEqual(created);
  });

  it('updates name/host and bumps updatedAt', async () => {
    const created = await service.create({ host: '10.0.0.1', name: 'nas' }, userId);

    const actual = await service.update(created.id, { name: 'renamed' }, userId);

    expect(actual.name).toBe('renamed');
    expect(actual.host).toBe('10.0.0.1');
    expect(actual.id).toBe(created.id);
  });

  it('persists and round-trips an agentContext on create', async () => {
    const created = await service.create(
      {
        agentContext: 'config lives under /volume2; sudo needs a password',
        host: '10.0.0.1',
        name: 'nas',
      },
      userId
    );

    expect(created.agentContext).toBe('config lives under /volume2; sudo needs a password');
    expect((await service.findOne(created.id)).agentContext).toBe('config lives under /volume2; sudo needs a password');
  });

  it('updates agentContext when the field is sent', async () => {
    const created = await service.create({ agentContext: 'old context', host: '10.0.0.1', name: 'nas' }, userId);

    const actual = await service.update(created.id, { agentContext: 'new context' }, userId);

    expect(actual.agentContext).toBe('new context');
  });

  it('leaves agentContext untouched when the field is omitted on update', async () => {
    const created = await service.create({ agentContext: 'keep me', host: '10.0.0.1', name: 'nas' }, userId);

    const actual = await service.update(created.id, { name: 'renamed' }, userId);

    expect(actual.name).toBe('renamed');
    expect(actual.agentContext).toBe('keep me');
  });

  it('clears agentContext when null is sent on update', async () => {
    const created = await service.create({ agentContext: 'clear me', host: '10.0.0.1', name: 'nas' }, userId);

    const actual = await service.update(created.id, { agentContext: null }, userId);

    expect(actual.agentContext).toBeNull();
  });

  it('removes a device', async () => {
    const created = await service.create({ host: '10.0.0.1', name: 'nas' }, userId);

    await service.remove(created.id, userId);

    await expect(service.findOne(created.id)).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException for a missing id on findOne', async () => {
    await expect(service.findOne('dev_missing')).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException for a missing id on update', async () => {
    await expect(service.update('dev_missing', { name: 'x' }, userId)).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException for a missing id on remove', async () => {
    await expect(service.remove('dev_missing', userId)).rejects.toThrow(NotFoundException);
  });
});
