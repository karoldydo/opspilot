import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { ConfigModule } from '../config/config.module';
import { databaseConfig } from '../config/database.config';
import { DatabaseModule } from '../database/database.module';
import { MigrationService } from '../database/migration/migration.service';
import { DATABASE_CONNECTION, DatabaseConnection } from '../database/providers/database-connection.provider';
import { DeviceService } from './device.service';

describe('DeviceService', () => {
  let moduleRef: TestingModule;
  let db: DatabaseConnection;
  let service: DeviceService;
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
      imports: [ConfigModule, DatabaseModule],
      providers: [DeviceService],
    })
      .overrideProvider(databaseConfig.KEY)
      .useValue({ backupRetention: 5, path: dbPath })
      .compile();
    db = moduleRef.get<DatabaseConnection>(DATABASE_CONNECTION);
    // apply real migrations (0000 better-auth + 0001 device/credential).
    await moduleRef.get(MigrationService).onApplicationBootstrap();
    service = moduleRef.get(DeviceService);
  });

  afterEach(async () => {
    db?.$client.close();
    await moduleRef?.close();
    cleanupTempFiles();
  });

  it('creates a device and returns the iso-normalized contract', async () => {
    const actual = await service.create({ host: '10.0.0.1', name: 'nas' });

    expect(actual).toEqual({
      createdAt: expect.any(String),
      host: '10.0.0.1',
      id: expect.any(String),
      name: 'nas',
      updatedAt: expect.any(String),
    });
    // createdAt is an iso string on the wire, never a Date.
    expect(() => new Date(actual.createdAt).toISOString()).not.toThrow();
  });

  it('lists all devices regardless of creator (shared model)', async () => {
    await service.create({ host: '10.0.0.1', name: 'a' });
    await service.create({ host: '10.0.0.2', name: 'b' });

    const actual = await service.findAll();

    expect(actual).toHaveLength(2);
    expect(actual.map((d) => d.name).sort()).toEqual(['a', 'b']);
  });

  it('findOne returns the created device', async () => {
    const created = await service.create({ host: '10.0.0.1', name: 'nas' });

    expect(await service.findOne(created.id)).toEqual(created);
  });

  it('updates name/host and bumps updatedAt', async () => {
    const created = await service.create({ host: '10.0.0.1', name: 'nas' });

    const actual = await service.update(created.id, { name: 'renamed' });

    expect(actual.name).toBe('renamed');
    expect(actual.host).toBe('10.0.0.1');
    expect(actual.id).toBe(created.id);
  });

  it('removes a device', async () => {
    const created = await service.create({ host: '10.0.0.1', name: 'nas' });

    await service.remove(created.id);

    await expect(service.findOne(created.id)).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException for a missing id on findOne', async () => {
    await expect(service.findOne('dev_missing')).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException for a missing id on update', async () => {
    await expect(service.update('dev_missing', { name: 'x' })).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException for a missing id on remove', async () => {
    await expect(service.remove('dev_missing')).rejects.toThrow(NotFoundException);
  });
});
