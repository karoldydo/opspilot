import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { ConfigModule } from '../config/config.module';
import { cryptoConfig } from '../config/crypto.config';
import { databaseConfig } from '../config/database.config';
import { DatabaseModule } from '../database/database.module';
import { MigrationService } from '../database/migration/migration.service';
import { DATABASE_CONNECTION, DatabaseConnection } from '../database/providers/database-connection.provider';
import { credential, device } from '../database/schema/device.schema';
import { CredentialModule } from './credential.module';
import { CredentialService } from './credential.service';

describe('CredentialService', () => {
  // a fixed 32-byte key (0x01 * 32) base64-encoded to 44 chars.
  const inputKey = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';
  const inputDeviceId = 'dev_test';

  let moduleRef: TestingModule;
  let db: DatabaseConnection;
  let service: CredentialService;
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
    dbPath = join(tmpdir(), `opspilot-cred-test-${process.pid}-${Date.now()}.db`);
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule, CredentialModule],
    })
      .overrideProvider(databaseConfig.KEY)
      .useValue({ backupRetention: 5, path: dbPath })
      .overrideProvider(cryptoConfig.KEY)
      .useValue({ encryptionKey: inputKey })
      .compile();
    db = moduleRef.get<DatabaseConnection>(DATABASE_CONNECTION);
    // apply real migrations (0000 better-auth + 0001 device/credential).
    await moduleRef.get(MigrationService).onApplicationBootstrap();
    service = moduleRef.get(CredentialService);
    // seed the fk target — credential.deviceId references device.id (cascade).
    db.insert(device).values({ host: '10.0.0.1', id: inputDeviceId, name: 'test-host' }).run();
  });

  afterEach(async () => {
    db?.$client.close();
    await moduleRef?.close();
    cleanupTempFiles();
  });

  it('stores ciphertext (not plaintext) and returns secret-free metadata', async () => {
    const inputSecret = 'super-secret-ssh-password';
    const actual = await service.create({
      authType: 'password',
      deviceId: inputDeviceId,
      secret: inputSecret,
      username: 'ops',
    });

    // returned contract is metadata only — no secret material.
    expect(actual).toEqual({
      authType: 'password',
      createdAt: expect.any(String),
      deviceId: inputDeviceId,
      id: expect.any(String),
      updatedAt: expect.any(String),
      username: 'ops',
    });

    // the stored row holds ciphertext, never the plaintext.
    const row = db.select().from(credential).where(eq(credential.id, actual.id)).get();
    expect(row?.ciphertext).not.toBe(inputSecret);
    expect(row?.ciphertext).toBeTruthy();
    expect(JSON.stringify(row)).not.toContain(inputSecret);
  });

  it('round-trips: getDecryptedSecret returns the original plaintext', async () => {
    const inputSecret = 'id_rsa-private-key-material';
    const created = await service.create({
      authType: 'key',
      deviceId: inputDeviceId,
      secret: inputSecret,
      username: 'root',
    });

    expect(await service.getDecryptedSecret(created.id)).toBe(inputSecret);
  });

  it('lists credentials for a device as secret-free metadata', async () => {
    await service.create({ authType: 'password', deviceId: inputDeviceId, secret: 'a', username: 'u1' });
    await service.create({ authType: 'key', deviceId: inputDeviceId, secret: 'b', username: 'u2' });

    const actual = await service.list(inputDeviceId);
    expect(actual).toHaveLength(2);
    expect(actual.map((c) => c.username).sort()).toEqual(['u1', 'u2']);
  });

  it('throws NotFoundException for a missing id on findById', async () => {
    await expect(service.findById('cred_missing')).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException for a missing id on getDecryptedSecret', async () => {
    await expect(service.getDecryptedSecret('cred_missing')).rejects.toThrow(NotFoundException);
  });
});
