import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SkillCreateRequest } from '@opspilot/shared';
import { randomUUID } from 'node:crypto';
import { readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { ConfigModule } from '../config/config.module';
import { databaseConfig } from '../config/database.config';
import { DatabaseModule } from '../database/database.module';
import { MigrationService } from '../database/migration/migration.service';
import { DATABASE_CONNECTION, DatabaseConnection } from '../database/providers/database-connection.provider';
import { device } from '../database/schema/device.schema';
import { SkillService } from './skill.service';

describe('SkillService', () => {
  let moduleRef: TestingModule;
  let db: DatabaseConnection;
  let service: SkillService;
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
      imports: [ConfigModule, DatabaseModule],
      providers: [SkillService],
    })
      .overrideProvider(databaseConfig.KEY)
      .useValue({ backupRetention: 5, path: dbPath })
      .compile();
    db = moduleRef.get<DatabaseConnection>(DATABASE_CONNECTION);
    // apply real migrations (through 0006 skill table).
    await moduleRef.get(MigrationService).onApplicationBootstrap();
    service = moduleRef.get(SkillService);
  });

  afterEach(async () => {
    db?.$client.close();
    await moduleRef?.close();
    cleanupTempFiles();
  });

  it('creates a global skill and returns the iso-normalized contract', async () => {
    const actual = await service.create(baseSkill());

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

  it('creates a per-device skill scoped to its device', async () => {
    const deviceId = seedDevice();

    const actual = await service.create(baseSkill({ deviceId }));

    expect(actual.deviceId).toBe(deviceId);
  });

  it('persists timeoutMs when supplied', async () => {
    const actual = await service.create(baseSkill({ timeoutMs: 30000 }));

    expect(actual.timeoutMs).toBe(30000);
  });

  it('findForDevice returns global skills plus that device’s skills only', async () => {
    const deviceA = seedDevice();
    const deviceB = seedDevice();
    const global = await service.create(baseSkill({ name: 'global-logs' }));
    const onA = await service.create(baseSkill({ deviceId: deviceA, name: 'a-logs' }));
    await service.create(baseSkill({ deviceId: deviceB, name: 'b-logs' }));

    const actual = await service.findForDevice(deviceA);

    expect(actual.map((s) => s.id).sort()).toEqual([global.id, onA.id].sort());
  });

  it('rejects a duplicate name in the same global scope with a conflict', async () => {
    await service.create(baseSkill({ name: 'dup' }));

    await expect(service.create(baseSkill({ name: 'dup' }))).rejects.toThrow(ConflictException);
  });

  it('allows the same name in different scopes (global vs device, device vs device)', async () => {
    const deviceA = seedDevice();
    const deviceB = seedDevice();
    await service.create(baseSkill({ name: 'same' }));

    // same name on a device is a different scope — allowed.
    await expect(service.create(baseSkill({ deviceId: deviceA, name: 'same' }))).resolves.toBeDefined();
    // and on another device — still a different scope.
    await expect(service.create(baseSkill({ deviceId: deviceB, name: 'same' }))).resolves.toBeDefined();
  });

  it('rejects a duplicate name in the same device scope', async () => {
    const deviceId = seedDevice();
    await service.create(baseSkill({ deviceId, name: 'dup' }));

    await expect(service.create(baseSkill({ deviceId, name: 'dup' }))).rejects.toThrow(ConflictException);
  });

  it('updates the command template and parameters together', async () => {
    const created = await service.create(baseSkill());

    const actual = await service.update(created.id, {
      commandTemplate: 'docker logs --tail {{lines}} {{containerName}}',
      parameters: [
        { name: 'lines', required: true, source: 'input' },
        { name: 'containerName', required: true, source: 'service' },
      ],
    });

    expect(actual.commandTemplate).toBe('docker logs --tail {{lines}} {{containerName}}');
    expect(actual.parameters).toHaveLength(2);
  });

  it('rejects an update whose merged template/parameters break parity', async () => {
    const created = await service.create(baseSkill());

    // changing only the template (not parameters) orphans the {{tail}} param and
    // introduces an undeclared {{containerName}} — the merged parity refine fails.
    await expect(service.update(created.id, { commandTemplate: 'docker logs {{containerName}}' })).rejects.toThrow();
  });

  it('rejects a rename that collides with an existing name in the same scope', async () => {
    await service.create(baseSkill({ name: 'first' }));
    const second = await service.create(baseSkill({ name: 'second' }));

    await expect(service.update(second.id, { name: 'first' })).rejects.toThrow(ConflictException);
  });

  it('removes a skill', async () => {
    const created = await service.create(baseSkill());

    await service.remove(created.id);

    await expect(service.findOne(created.id)).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException for a missing id on findOne/update/remove', async () => {
    await expect(service.findOne('skill_missing')).rejects.toThrow(NotFoundException);
    await expect(service.update('skill_missing', { name: 'x' })).rejects.toThrow(NotFoundException);
    await expect(service.remove('skill_missing')).rejects.toThrow(NotFoundException);
  });
});
