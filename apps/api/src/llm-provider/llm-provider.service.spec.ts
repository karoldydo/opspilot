import { AuditService } from '@api/audit/audit.service';
import { ConfigModule } from '@api/config/config.module';
import { cryptoConfig } from '@api/config/crypto.config';
import { databaseConfig } from '@api/config/database.config';
import { DatabaseModule } from '@api/database/database.module';
import { MigrationService } from '@api/database/migration/migration.service';
import { DATABASE_CONNECTION, DatabaseConnection } from '@api/database/providers/database-connection.provider';
import { user } from '@api/database/schema/auth.schema';
import { llmProvider } from '@api/database/schema/llm-provider.schema';
import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { LlmProviderNoActiveError } from './llm-provider.errors';
import { LlmProviderModule } from './llm-provider.module';
import { LlmProviderService } from './llm-provider.service';

describe('LlmProviderService', () => {
  // a fixed 32-byte key (0x01 * 32) base64-encoded to 44 chars.
  const inputKey = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';
  const baseInput = { baseURL: 'https://api.openai.com/v1', kind: 'openai-compatible' as const, model: 'gpt-4o' };
  // the session user whose id the audit insert keys off (fk → user.id).
  const userId = 'user-llm-test';

  let moduleRef: TestingModule;
  let db: DatabaseConnection;
  let service: LlmProviderService;
  let auditService: AuditService;
  let dbPath: string;
  let mockFetch: ReturnType<typeof vi.fn>;

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
    // the create/update probe runs a live test-call; stub fetch to a 200 ok so the
    // crud tests exercise persistence, not the network (probe mapping → probe.spec).
    mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    vi.stubGlobal('fetch', mockFetch);
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
    // apply real migrations (through 0007 audit_log).
    await moduleRef.get(MigrationService).onApplicationBootstrap();
    service = moduleRef.get(LlmProviderService);
    auditService = moduleRef.get(AuditService);
    // seed the audit fk target — audit_log.userId references user.id.
    db.insert(user).values({ email: 'u1@example.com', id: userId, name: 'u1' }).run();
  });

  afterEach(async () => {
    db?.$client.close();
    await moduleRef?.close();
    cleanupTempFiles();
    vi.unstubAllGlobals();
  });

  it('creates a provider and returns the secret-free, iso-normalized contract', async () => {
    const actual = await service.create({ ...baseInput, apiKey: 'sk-secret' }, userId);

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

  it('writes a secret-free audit row keyed off the session user on create', async () => {
    const inputApiKey = 'sk-super-secret-key';
    const created = await service.create({ ...baseInput, apiKey: inputApiKey }, userId);

    const events = auditService.list({ offset: 0 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'llmProvider.create',
      metadata: { kind: 'openai-compatible', model: 'gpt-4o' },
      targetId: created.id,
      targetType: 'llmProvider',
      userId,
    });
    // no plaintext key leaks into the audit metadata.
    expect(JSON.stringify(events[0])).not.toContain(inputApiKey);
  });

  it('stores ciphertext (not the plaintext apiKey) and never leaks it in the contract', async () => {
    const inputApiKey = 'sk-super-secret-key';
    const actual = await service.create({ ...baseInput, apiKey: inputApiKey }, userId);

    expect(JSON.stringify(actual)).not.toContain(inputApiKey);

    const row = db.select().from(llmProvider).where(eq(llmProvider.id, actual.id)).get();
    expect(row?.ciphertext).not.toBe(inputApiKey);
    expect(row?.ciphertext).toBeTruthy();
    expect(JSON.stringify(row)).not.toContain(inputApiKey);
  });

  it('round-trips: getDecryptedApiKey returns the original plaintext', async () => {
    const inputApiKey = 'sk-round-trip';
    const created = await service.create({ ...baseInput, apiKey: inputApiKey }, userId);

    expect(await service.getDecryptedApiKey(created.id)).toBe(inputApiKey);
  });

  it('auto-actives the first provider and leaves later ones inactive', async () => {
    const first = await service.create({ ...baseInput, apiKey: 'sk-1' }, userId);
    const second = await service.create({ ...baseInput, apiKey: 'sk-2', model: 'gpt-4o-mini' }, userId);

    expect(first.active).toBe(true);
    expect(second.active).toBe(false);
    expect((await service.findAll()).filter((p) => p.active)).toHaveLength(1);
  });

  it('activate switches the active provider atomically — exactly one stays active', async () => {
    const first = await service.create({ ...baseInput, apiKey: 'sk-1' }, userId);
    const second = await service.create({ ...baseInput, apiKey: 'sk-2', model: 'gpt-4o-mini' }, userId);

    const activated = await service.activate(second.id, userId);

    expect(activated.active).toBe(true);
    const all = await service.findAll();
    expect(all.filter((p) => p.active)).toHaveLength(1);
    expect(all.find((p) => p.id === first.id)?.active).toBe(false);
    expect(all.find((p) => p.id === second.id)?.active).toBe(true);
  });

  it('removing the active provider leaves zero active (no auto-promotion)', async () => {
    const first = await service.create({ ...baseInput, apiKey: 'sk-1' }, userId);
    await service.create({ ...baseInput, apiKey: 'sk-2', model: 'gpt-4o-mini' }, userId);

    await service.remove(first.id, userId);

    const all = await service.findAll();
    expect(all).toHaveLength(1);
    expect(all.filter((p) => p.active)).toHaveLength(0);
  });

  it('update without apiKey keeps the stored key and patches only the sent fields', async () => {
    const inputApiKey = 'sk-keep-me';
    const created = await service.create({ ...baseInput, apiKey: inputApiKey }, userId);

    const updated = await service.update(created.id, { model: 'gpt-4o-mini' }, userId);

    expect(updated.model).toBe('gpt-4o-mini');
    expect(updated.baseURL).toBe(baseInput.baseURL);
    expect(updated.hasApiKey).toBe(true);
    // the stored key is untouched when the patch omits apiKey.
    expect(await service.getDecryptedApiKey(created.id)).toBe(inputApiKey);
  });

  it('update with apiKey rotates the stored key', async () => {
    const created = await service.create({ ...baseInput, apiKey: 'sk-old' }, userId);

    await service.update(created.id, { apiKey: 'sk-new' }, userId);

    expect(await service.getDecryptedApiKey(created.id)).toBe('sk-new');
  });

  it('reject-on-fail: a probe error in create leaves no row persisted', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(service.create({ ...baseInput, apiKey: 'sk-bad' }, userId)).rejects.toThrow();
    expect(await service.findAll()).toHaveLength(0);
  });

  it('reject-on-fail: a probe error in update leaves the stored row untouched', async () => {
    const created = await service.create({ ...baseInput, apiKey: 'sk-keep' }, userId);
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(service.update(created.id, { model: 'gpt-4o-mini' }, userId)).rejects.toThrow();

    const unchanged = await service.findOne(created.id);
    expect(unchanged.model).toBe('gpt-4o');
    expect(await service.getDecryptedApiKey(created.id)).toBe('sk-keep');
  });

  it('update without apiKey probes the decrypted stored key against the effective baseURL', async () => {
    const created = await service.create({ ...baseInput, apiKey: 'sk-stored' }, userId);
    mockFetch.mockClear();

    await service.update(created.id, { model: 'gpt-4o-mini' }, userId);

    expect(mockFetch).toHaveBeenCalledWith(
      `${baseInput.baseURL}/models`,
      expect.objectContaining({ headers: { authorization: 'Bearer sk-stored' } })
    );
  });

  it('getActiveProviderConfig returns the decrypted runtime config for the active provider', async () => {
    const created = await service.create({ ...baseInput, apiKey: 'sk-active' }, userId);
    await service.create({ ...baseInput, apiKey: 'sk-inactive', model: 'gpt-4o-mini' }, userId);

    const actual = await service.getActiveProviderConfig();

    expect(actual).toEqual({
      apiKey: 'sk-active',
      baseURL: baseInput.baseURL,
      kind: 'openai-compatible',
      model: created.model,
    });
  });

  it('getActiveProviderConfig throws when no provider is active', async () => {
    const created = await service.create({ ...baseInput, apiKey: 'sk-active' }, userId);
    // removing the only (active) provider leaves zero active — no auto-promotion.
    await service.remove(created.id, userId);

    await expect(service.getActiveProviderConfig()).rejects.toThrow(LlmProviderNoActiveError);
  });

  it('throws NotFoundException for a missing id on findOne', async () => {
    await expect(service.findOne('llm_missing')).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException for a missing id on update', async () => {
    await expect(service.update('llm_missing', { model: 'x' }, userId)).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException for a missing id on activate', async () => {
    await expect(service.activate('llm_missing', userId)).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException for a missing id on remove', async () => {
    await expect(service.remove('llm_missing', userId)).rejects.toThrow(NotFoundException);
  });
});
