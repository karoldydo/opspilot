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
import { llmProvider } from '../database/schema/llm-provider.schema';
import { LlmProviderModule } from './llm-provider.module';
import { LlmProviderService } from './llm-provider.service';

describe('LlmProviderService', () => {
  // a fixed 32-byte key (0x01 * 32) base64-encoded to 44 chars.
  const inputKey = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';
  const baseInput = { baseURL: 'https://api.openai.com/v1', kind: 'openai-compatible' as const, model: 'gpt-4o' };

  let moduleRef: TestingModule;
  let db: DatabaseConnection;
  let service: LlmProviderService;
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
    dbPath = join(tmpdir(), `opspilot-llm-test-${process.pid}-${Date.now()}.db`);
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule, LlmProviderModule],
    })
      .overrideProvider(databaseConfig.KEY)
      .useValue({ backupRetention: 5, path: dbPath })
      .overrideProvider(cryptoConfig.KEY)
      .useValue({ encryptionKey: inputKey })
      .compile();
    db = moduleRef.get<DatabaseConnection>(DATABASE_CONNECTION);
    // apply real migrations (through 0003 llm_provider).
    await moduleRef.get(MigrationService).onApplicationBootstrap();
    service = moduleRef.get(LlmProviderService);
  });

  afterEach(async () => {
    db?.$client.close();
    await moduleRef?.close();
    cleanupTempFiles();
  });

  it('creates a provider and returns the secret-free, iso-normalized contract', async () => {
    const actual = await service.create({ ...baseInput, apiKey: 'sk-secret' });

    expect(actual).toEqual({
      active: true,
      baseURL: baseInput.baseURL,
      createdAt: expect.any(String),
      hasApiKey: true,
      id: expect.any(String),
      kind: 'openai-compatible',
      model: 'gpt-4o',
      updatedAt: expect.any(String),
    });
    // createdAt is an iso string on the wire, never a Date.
    expect(() => new Date(actual.createdAt).toISOString()).not.toThrow();
  });

  it('stores ciphertext (not the plaintext apiKey) and never leaks it in the contract', async () => {
    const inputApiKey = 'sk-super-secret-key';
    const actual = await service.create({ ...baseInput, apiKey: inputApiKey });

    expect(JSON.stringify(actual)).not.toContain(inputApiKey);

    const row = db.select().from(llmProvider).where(eq(llmProvider.id, actual.id)).get();
    expect(row?.ciphertext).not.toBe(inputApiKey);
    expect(row?.ciphertext).toBeTruthy();
    expect(JSON.stringify(row)).not.toContain(inputApiKey);
  });

  it('round-trips: getDecryptedApiKey returns the original plaintext', async () => {
    const inputApiKey = 'sk-round-trip';
    const created = await service.create({ ...baseInput, apiKey: inputApiKey });

    expect(await service.getDecryptedApiKey(created.id)).toBe(inputApiKey);
  });

  it('auto-actives the first provider and leaves later ones inactive', async () => {
    const first = await service.create({ ...baseInput, apiKey: 'sk-1' });
    const second = await service.create({ ...baseInput, apiKey: 'sk-2', model: 'gpt-4o-mini' });

    expect(first.active).toBe(true);
    expect(second.active).toBe(false);
    expect((await service.findAll()).filter((p) => p.active)).toHaveLength(1);
  });

  it('activate switches the active provider atomically — exactly one stays active', async () => {
    const first = await service.create({ ...baseInput, apiKey: 'sk-1' });
    const second = await service.create({ ...baseInput, apiKey: 'sk-2', model: 'gpt-4o-mini' });

    const activated = await service.activate(second.id);

    expect(activated.active).toBe(true);
    const all = await service.findAll();
    expect(all.filter((p) => p.active)).toHaveLength(1);
    expect(all.find((p) => p.id === first.id)?.active).toBe(false);
    expect(all.find((p) => p.id === second.id)?.active).toBe(true);
  });

  it('removing the active provider leaves zero active (no auto-promotion)', async () => {
    const first = await service.create({ ...baseInput, apiKey: 'sk-1' });
    await service.create({ ...baseInput, apiKey: 'sk-2', model: 'gpt-4o-mini' });

    await service.remove(first.id);

    const all = await service.findAll();
    expect(all).toHaveLength(1);
    expect(all.filter((p) => p.active)).toHaveLength(0);
  });

  it('update without apiKey keeps the stored key and patches only the sent fields', async () => {
    const inputApiKey = 'sk-keep-me';
    const created = await service.create({ ...baseInput, apiKey: inputApiKey });

    const updated = await service.update(created.id, { model: 'gpt-4o-mini' });

    expect(updated.model).toBe('gpt-4o-mini');
    expect(updated.baseURL).toBe(baseInput.baseURL);
    expect(updated.hasApiKey).toBe(true);
    // the stored key is untouched when the patch omits apiKey.
    expect(await service.getDecryptedApiKey(created.id)).toBe(inputApiKey);
  });

  it('update with apiKey rotates the stored key', async () => {
    const created = await service.create({ ...baseInput, apiKey: 'sk-old' });

    await service.update(created.id, { apiKey: 'sk-new' });

    expect(await service.getDecryptedApiKey(created.id)).toBe('sk-new');
  });

  it('throws NotFoundException for a missing id on findOne', async () => {
    await expect(service.findOne('llm_missing')).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException for a missing id on update', async () => {
    await expect(service.update('llm_missing', { model: 'x' })).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException for a missing id on activate', async () => {
    await expect(service.activate('llm_missing')).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException for a missing id on remove', async () => {
    await expect(service.remove('llm_missing')).rejects.toThrow(NotFoundException);
  });
});
