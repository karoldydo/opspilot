import { AuditModule } from '@api/audit/audit.module';
import { AuditService } from '@api/audit/audit.service';
import { ConfigModule } from '@api/config/config.module';
import { databaseConfig } from '@api/config/database.config';
import { DatabaseModule } from '@api/core/database/database.module';
import { MigrationService } from '@api/core/database/migration/migration.service';
import { DATABASE_CONNECTION, DatabaseConnection } from '@api/core/database/providers/database-connection.provider';
import { user } from '@api/core/database/schema/auth.schema';
import { device } from '@api/core/database/schema/device.schema';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SkillCreateRequest } from '@opspilot/shared';
import { randomUUID } from 'node:crypto';
import { readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { SkillService } from './skill.service';

describe('SkillService', () => {
  // the session user whose id the audit insert keys off (fk → user.id).
  const userId = 'user-skill-test';

  let moduleRef: TestingModule;
  let db: DatabaseConnection;
  let service: SkillService;
  let auditService: AuditService;
  let dbPath: string;

  // a container-scoped skill template with one input param — the simplest valid shape.
  const baseSkill = (overrides: Partial<SkillCreateRequest> = {}): SkillCreateRequest => ({
    commandTemplate: 'docker logs {{tail}}',
    name: 'logs',
    parameters: [{ name: 'tail', required: true, source: 'input' }],
    ...overrides,
  });

  // insert a real device row so a per-device skill satisfies the cascade fk.
  function seedDevice(): string {
    const id = randomUUID();
    db.insert(device).values({ host: '10.0.0.1', id, name: 'nas' }).run();
    return id;
  }

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
    dbPath = join(tmpdir(), `opspilot-skill-test-${process.pid}-${Date.now()}.db`);
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule, AuditModule],
      providers: [SkillService],
    })
      .overrideProvider(databaseConfig.KEY)
      .useValue({ backupRetention: 5, path: dbPath })
      .compile();
    db = moduleRef.get<DatabaseConnection>(DATABASE_CONNECTION);
    // apply real migrations (through 0007 audit_log).
    await moduleRef.get(MigrationService).onApplicationBootstrap();
    service = moduleRef.get(SkillService);
    auditService = moduleRef.get(AuditService);
    // seed the audit fk target — audit_log.userId references user.id.
    db.insert(user).values({ email: 'u1@example.com', id: userId, name: 'u1' }).run();
  });

  afterEach(async () => {
    db?.$client.close();
    await moduleRef?.close();
    cleanupTempFiles();
  });

  it('creates a global skill and returns the iso-normalized contract', async () => {
    const actual = await service.create(baseSkill(), userId);

    expect(actual).toEqual({
      commandTemplate: 'docker logs {{tail}}',
      createdAt: expect.any(String),
      deviceId: null,
      id: expect.any(String),
      name: 'logs',
      parameters: [{ name: 'tail', required: true, source: 'input' }],
      timeoutMs: null,
      updatedAt: expect.any(String),
    });
    // timestamps are iso strings on the wire, never a Date.
    expect(() => new Date(actual.createdAt).toISOString()).not.toThrow();
  });

  it('writes one audit row keyed off the session user on create', async () => {
    const created = await service.create(baseSkill(), userId);

    const events = auditService.list({ offset: 0 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'skill.create',
      metadata: { name: 'logs' },
      targetId: created.id,
      targetType: 'skill',
      userId,
    });
  });

  it('rolls the skill back when the audit insert throws (atomicity)', async () => {
    vi.spyOn(auditService, 'record').mockImplementationOnce(() => {
      throw new Error('forced audit failure');
    });

    await expect(service.create(baseSkill({ name: 'rollback' }), userId)).rejects.toThrow('forced audit failure');
    // the create transaction also covers the audit insert, so nothing persists.
    expect((await service.findAll()).some((s) => s.name === 'rollback')).toBe(false);
  });

  it('creates a per-device skill scoped to its device', async () => {
    const deviceId = seedDevice();

    const actual = await service.create(baseSkill({ deviceId }), userId);

    expect(actual.deviceId).toBe(deviceId);
  });

  it('persists timeoutMs when supplied', async () => {
    const actual = await service.create(baseSkill({ timeoutMs: 30000 }), userId);

    expect(actual.timeoutMs).toBe(30000);
  });

  it('findForDevice returns global skills plus that device’s skills only', async () => {
    const deviceA = seedDevice();
    const deviceB = seedDevice();
    const global = await service.create(baseSkill({ name: 'global-logs' }), userId);
    const onA = await service.create(baseSkill({ deviceId: deviceA, name: 'a-logs' }), userId);
    await service.create(baseSkill({ deviceId: deviceB, name: 'b-logs' }), userId);

    const actual = await service.findForDevice(deviceA);

    expect(actual.map((s) => s.id).sort()).toEqual([global.id, onA.id].sort());
  });

  it('rejects a duplicate name in the same global scope with a conflict', async () => {
    await service.create(baseSkill({ name: 'dup' }), userId);

    await expect(service.create(baseSkill({ name: 'dup' }), userId)).rejects.toThrow(ConflictException);
  });

  it('allows the same name in different scopes (global vs device, device vs device)', async () => {
    const deviceA = seedDevice();
    const deviceB = seedDevice();
    await service.create(baseSkill({ name: 'same' }), userId);

    // same name on a device is a different scope — allowed.
    await expect(service.create(baseSkill({ deviceId: deviceA, name: 'same' }), userId)).resolves.toBeDefined();
    // and on another device — still a different scope.
    await expect(service.create(baseSkill({ deviceId: deviceB, name: 'same' }), userId)).resolves.toBeDefined();
  });

  it('rejects a duplicate name in the same device scope', async () => {
    const deviceId = seedDevice();
    await service.create(baseSkill({ deviceId, name: 'dup' }), userId);

    await expect(service.create(baseSkill({ deviceId, name: 'dup' }), userId)).rejects.toThrow(ConflictException);
  });

  it('updates the command template and parameters together', async () => {
    const created = await service.create(baseSkill(), userId);

    const actual = await service.update(
      created.id,
      {
        commandTemplate: 'docker logs --tail {{lines}} {{containerName}}',
        parameters: [
          { name: 'lines', required: true, source: 'input' },
          { name: 'containerName', required: true, source: 'service' },
        ],
      },
      userId
    );

    expect(actual.commandTemplate).toBe('docker logs --tail {{lines}} {{containerName}}');
    expect(actual.parameters).toHaveLength(2);
  });

  it('rejects an update whose merged template/parameters break parity', async () => {
    const created = await service.create(baseSkill(), userId);

    // changing only the template (not parameters) orphans the {{tail}} param and
    // introduces an undeclared {{containerName}} — the merged parity refine fails.
    await expect(
      service.update(created.id, { commandTemplate: 'docker logs {{containerName}}' }, userId)
    ).rejects.toThrow();
  });

  it('rejects a rename that collides with an existing name in the same scope', async () => {
    await service.create(baseSkill({ name: 'first' }), userId);
    const second = await service.create(baseSkill({ name: 'second' }), userId);

    await expect(service.update(second.id, { name: 'first' }, userId)).rejects.toThrow(ConflictException);
  });

  it('removes a skill', async () => {
    const created = await service.create(baseSkill(), userId);

    await service.remove(created.id, userId);

    await expect(service.findOne(created.id)).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException for a missing id on findOne/update/remove', async () => {
    await expect(service.findOne('skill_missing')).rejects.toThrow(NotFoundException);
    await expect(service.update('skill_missing', { name: 'x' }, userId)).rejects.toThrow(NotFoundException);
    await expect(service.remove('skill_missing', userId)).rejects.toThrow(NotFoundException);
  });
});
