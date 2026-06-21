import { CryptoService } from '@api/core/crypto/crypto.service';
import { DATABASE_CONNECTION, DatabaseConnection } from '@api/core/database/providers/database-connection.provider';
import { llmProvider } from '@api/core/database/schema/llm-provider.schema';
import { AuditService } from '@api/modules/audit/audit.service';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { LlmProvider, LlmProviderCreateRequest, llmProviderSchema, LlmProviderUpdateRequest } from '@opspilot/shared';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { LlmProviderKeyDecryptError, LlmProviderNoActiveError } from './llm-provider.errors';
import { LlmProviderProbe } from './llm-provider.probe';

type LlmProviderRow = typeof llmProvider.$inferSelect;

const KEY_VERSION = 1;

@Injectable()
export class LlmProviderService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DatabaseConnection,
    @Inject(CryptoService) private readonly crypto: CryptoService,
    @Inject(LlmProviderProbe) private readonly probe: LlmProviderProbe,
    @Inject(AuditService) private readonly auditService: AuditService
  ) {}

  async create(input: LlmProviderCreateRequest, userId: string): Promise<LlmProvider> {
    // reject-on-fail: live test-call BEFORE persisting, so a bad key/url never leaves a row behind.
    await this.probe.verify(input.baseURL, input.apiKey);
    const { authTag, ciphertext, iv } = this.crypto.encrypt(input.apiKey);
    // auto-active-first: the first provider is active, later ones are not. count read +
    // insert in one transaction so two concurrent creates can't both see an empty table
    // and both write active: true (single-active is app-enforced, no partial-index).
    const row = this.db.transaction((tx) => {
      const active = tx.select().from(llmProvider).all().length === 0;
      const inserted = tx
        .insert(llmProvider)
        .values({
          active,
          authTag,
          baseURL: input.baseURL,
          ciphertext,
          id: randomUUID(),
          iv,
          keyVersion: KEY_VERSION,
          kind: input.kind,
          model: input.model,
        })
        .returning()
        .get();
      // join the existing transaction; metadata is secret-free (kind/model only).
      this.auditService.record(
        {
          action: 'llmProvider.create',
          metadata: { kind: inserted.kind, model: inserted.model },
          targetId: inserted.id,
          targetType: 'llmProvider',
          userId,
        },
        tx
      );
      return inserted;
    });
    return this.toContract(row);
  }

  async findAll(): Promise<LlmProvider[]> {
    const rows = this.db.select().from(llmProvider).all();
    return rows.map((row) => this.toContract(row));
  }

  async findOne(id: string): Promise<LlmProvider> {
    return this.toContract(this.requireRow(id));
  }

  async update(id: string, input: LlmProviderUpdateRequest, userId: string): Promise<LlmProvider> {
    const row = this.requireRow(id);
    // reject-on-fail: probe the effective config BEFORE the mutation; absent baseURL/apiKey
    // fall back to the stored row, so the patch tests the merged state.
    const effectiveBaseURL = input.baseURL ?? row.baseURL;
    const effectiveApiKey = input.apiKey ?? (await this.getDecryptedApiKey(id));
    await this.probe.verify(effectiveBaseURL, effectiveApiKey);
    // project explicit columns (never spread the dto); drizzle ignores undefined, so a
    // partial patch only touches sent fields. re-encrypt only when a new apiKey is supplied.
    const patch: Partial<LlmProviderRow> = { baseURL: input.baseURL, kind: input.kind, model: input.model };
    if (input.apiKey) {
      const { authTag, ciphertext, iv } = this.crypto.encrypt(input.apiKey);
      patch.authTag = authTag;
      patch.ciphertext = ciphertext;
      patch.iv = iv;
      patch.keyVersion = KEY_VERSION;
    }
    const updated = this.db.transaction((tx) => {
      const u = tx.update(llmProvider).set(patch).where(eq(llmProvider.id, id)).returning().get();
      this.auditService.record(
        {
          action: 'llmProvider.update',
          metadata: { kind: u.kind, model: u.model },
          targetId: id,
          targetType: 'llmProvider',
          userId,
        },
        tx
      );
      return u;
    });
    return this.toContract(updated);
  }

  async activate(id: string, userId: string): Promise<LlmProvider> {
    const existing = this.requireRow(id);
    // app-enforced single-active: unset all, set one, atomically — no partial-index, so the
    // transaction guarantees never zero or two active mid-flight.
    this.db.transaction((tx) => {
      tx.update(llmProvider).set({ active: false }).run();
      tx.update(llmProvider).set({ active: true }).where(eq(llmProvider.id, id)).run();
      this.auditService.record(
        {
          action: 'llmProvider.activate',
          metadata: { kind: existing.kind, model: existing.model },
          targetId: id,
          targetType: 'llmProvider',
          userId,
        },
        tx
      );
    });
    return this.toContract(this.requireRow(id));
  }

  async remove(id: string, userId: string): Promise<void> {
    const existing = this.requireRow(id);
    this.db.transaction((tx) => {
      // deleting the active provider leaves zero active — no auto-promotion (plan).
      tx.delete(llmProvider).where(eq(llmProvider.id, id)).run();
      this.auditService.record(
        {
          action: 'llmProvider.delete',
          metadata: { kind: existing.kind, model: existing.model },
          targetId: id,
          targetType: 'llmProvider',
          userId,
        },
        tx
      );
    });
  }

  // service-only accessor: returns the decrypted raw api key — NOT a contract type, must
  // never be wired to a controller (plaintext never crosses /api).
  async getDecryptedApiKey(id: string): Promise<string> {
    const row = this.requireRow(id);
    try {
      return this.crypto.decrypt({ authTag: row.authTag, ciphertext: row.ciphertext, iv: row.iv });
    } catch {
      // corrupt ciphertext / rotated key → a legible 500, not a raw crypto throw.
      throw new LlmProviderKeyDecryptError(id);
    }
  }

  // service-only accessor: resolve the active provider's runtime config for the s-04 client
  // factory, decrypting the key. like getDecryptedApiKey its return is NOT a contract type and
  // must never reach a controller; throws when none is active so diagnose fails fast (409).
  async getActiveProviderConfig(): Promise<{ apiKey: string; baseURL: string; kind: string; model: string }> {
    const row = this.db.select().from(llmProvider).where(eq(llmProvider.active, true)).get();
    if (!row) {
      throw new LlmProviderNoActiveError();
    }
    return {
      apiKey: await this.getDecryptedApiKey(row.id),
      baseURL: row.baseURL,
      kind: row.kind,
      model: row.model,
    };
  }

  // read the row or fail with an entity-naming 404 (nestjs.md error rule).
  private requireRow(id: string): LlmProviderRow {
    const row = this.db.select().from(llmProvider).where(eq(llmProvider.id, id)).get();
    if (!row) {
      throw new NotFoundException(`llm provider ${id} not found`);
    }
    return row;
  }

  // never spread the row — the contract rejects secret leakage; hasApiKey is derived from ciphertext.
  private toContract(row: LlmProviderRow): LlmProvider {
    return llmProviderSchema.parse({
      active: row.active,
      baseURL: row.baseURL,
      createdAt: row.createdAt,
      hasApiKey: row.ciphertext.length > 0,
      id: row.id,
      kind: row.kind,
      model: row.model,
      updatedAt: row.updatedAt,
    });
  }
}
