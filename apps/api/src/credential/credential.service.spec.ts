import { AuditService } from '@api/audit/audit.service';
import { ConfigModule } from '@api/config/config.module';
import { cryptoConfig } from '@api/config/crypto.config';
import { databaseConfig } from '@api/config/database.config';
import { DatabaseModule } from '@api/database/database.module';
import { MigrationService } from '@api/database/migration/migration.service';
import { DATABASE_CONNECTION, DatabaseConnection } from '@api/database/providers/database-connection.provider';
import { user } from '@api/database/schema/auth.schema';
import { credential, device } from '@api/database/schema/device.schema';
import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { CredentialModule } from './credential.module';
import { CredentialService } from './credential.service';

describe('CredentialService', () => {
  // a fixed 32-byte key (0x01 * 32) base64-encoded to 44 chars.
  const inputKey = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';
  const inputDeviceId = 'dev_test';
  // the session user whose id the audit insert keys off (fk → user.id).
  const userId = 'user-cred-test';

  let moduleRef: TestingModule;
  let db: DatabaseConnection;
  let service: CredentialService;
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
    // apply real migrations (through 0007 audit_log).
    await moduleRef.get(MigrationService).onApplicationBootstrap();
    service = moduleRef.get(CredentialService);
    auditService = moduleRef.get(AuditService);
    // seed the fk target — credential.deviceId references device.id (cascade).
    db.insert(device).values({ host: '10.0.0.1', id: inputDeviceId, name: 'test-host' }).run();
    // seed the audit fk target — audit_log.userId references user.id.
    db.insert(user).values({ email: 'u1@example.com', id: userId, name: 'u1' }).run();
  });

  afterEach(async () => {
    db?.$client.close();
    await moduleRef?.close();
    cleanupTempFiles();
  });

  it('stores ciphertext (not plaintext) and returns secret-free metadata', async () => {
    const inputSecret = 'super-secret-ssh-password';
    const actual = await service.create(
      {
        authType: 'password',
        deviceId: inputDeviceId,
        secret: inputSecret,
        username: 'ops',
      },
      userId
    );

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

  it('writes a secret-free audit row keyed off the session user on create', async () => {
    const inputSecret = 'super-secret-ssh-password';
    const created = await service.create(
      { authType: 'password', deviceId: inputDeviceId, secret: inputSecret, username: 'ops' },
      userId
    );

    const events = auditService.list({ offset: 0 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'credential.create',
      metadata: { authType: 'password', deviceId: inputDeviceId, username: 'ops' },
      targetId: created.id,
      targetType: 'credential',
      userId,
    });
    // no plaintext secret leaks into the audit metadata.
    expect(JSON.stringify(events[0])).not.toContain(inputSecret);
  });

  it('round-trips: getDecryptedSecret returns the original plaintext', async () => {
    const inputSecret = 'id_rsa-private-key-material';
    const created = await service.create(
      {
        authType: 'key',
        deviceId: inputDeviceId,
        secret: inputSecret,
        username: 'root',
      },
      userId
    );

    expect(await service.getDecryptedSecret(created.id)).toBe(inputSecret);
  });

  it('lists credentials for a device as secret-free metadata', async () => {
    await service.create({ authType: 'password', deviceId: inputDeviceId, secret: 'a', username: 'u1' }, userId);
    await service.create({ authType: 'key', deviceId: inputDeviceId, secret: 'b', username: 'u2' }, userId);

    const actual = await service.list(inputDeviceId);
    expect(actual).toHaveLength(2);
    expect(actual.map((c) => c.username).sort()).toEqual(['u1', 'u2']);
  });

  it('removes a credential and records a delete audit row', async () => {
    const created = await service.create(
      { authType: 'password', deviceId: inputDeviceId, secret: 's', username: 'ops' },
      userId
    );

    await service.remove(inputDeviceId, created.id, userId);

    await expect(service.findById(created.id)).rejects.toThrow(NotFoundException);
    const events = auditService.list({ action: 'credential.delete', offset: 0 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'credential.delete',
      targetId: created.id,
      targetType: 'credential',
      userId,
    });
  });

  it('throws NotFoundException for a missing id on remove', async () => {
    await expect(service.remove(inputDeviceId, 'cred_missing', userId)).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException for a missing id on findById', async () => {
    await expect(service.findById('cred_missing')).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException for a missing id on getDecryptedSecret', async () => {
    await expect(service.getDecryptedSecret('cred_missing')).rejects.toThrow(NotFoundException);
  });
});
