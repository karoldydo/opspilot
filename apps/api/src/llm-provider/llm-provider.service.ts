import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { LlmProvider, LlmProviderCreateRequest, llmProviderSchema, LlmProviderUpdateRequest } from '@opspilot/shared';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { CryptoService } from '../crypto/crypto.service';
import { DATABASE_CONNECTION, DatabaseConnection } from '../database/providers/database-connection.provider';
import { llmProvider } from '../database/schema/llm-provider.schema';

type LlmProviderRow = typeof llmProvider.$inferSelect;

const KEY_VERSION = 1;

@Injectable()
export class LlmProviderService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DatabaseConnection,
    @Inject(CryptoService) private readonly crypto: CryptoService
  ) {}

  async create(input: LlmProviderCreateRequest): Promise<LlmProvider> {
    // the test-call probe lands here in phase 3, BEFORE encrypt/insert (reject-on-fail).
    // auto-active-first: the very first provider is active; later ones are not (the
    // user activates manually via the activate endpoint).
    const active = this.db.select().from(llmProvider).all().length === 0;
    const { authTag, ciphertext, iv } = this.crypto.encrypt(input.apiKey);
    const row = this.db
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
    return this.toContract(row);
  }

  async findAll(): Promise<LlmProvider[]> {
    const rows = this.db.select().from(llmProvider).all();
    return rows.map((row) => this.toContract(row));
  }

  async findOne(id: string): Promise<LlmProvider> {
    return this.toContract(this.requireRow(id));
  }

  async update(id: string, input: LlmProviderUpdateRequest): Promise<LlmProvider> {
    this.requireRow(id);
    // project explicit columns (never spread the dto); drizzle ignores undefined,
    // so a partial patch only touches the fields the caller sent. re-encrypt only
    // when a new apiKey is supplied — an absent key keeps the stored ciphertext.
    const patch: Partial<LlmProviderRow> = { baseURL: input.baseURL, kind: input.kind, model: input.model };
    if (input.apiKey) {
      const { authTag, ciphertext, iv } = this.crypto.encrypt(input.apiKey);
      patch.authTag = authTag;
      patch.ciphertext = ciphertext;
      patch.iv = iv;
      patch.keyVersion = KEY_VERSION;
    }
    const row = this.db.update(llmProvider).set(patch).where(eq(llmProvider.id, id)).returning().get();
    return this.toContract(row);
  }

  async activate(id: string): Promise<LlmProvider> {
    this.requireRow(id);
    // app-enforced single-active invariant: unset all, set one, atomically. no
    // partial-index means the unset-then-set order never trips a constraint; the
    // transaction guarantees there is never zero or two active mid-flight.
    this.db.transaction((tx) => {
      tx.update(llmProvider).set({ active: false }).run();
      tx.update(llmProvider).set({ active: true }).where(eq(llmProvider.id, id)).run();
    });
    return this.toContract(this.requireRow(id));
  }

  async remove(id: string): Promise<void> {
    this.requireRow(id);
    // deleting the active provider leaves zero active — no auto-promotion (plan).
    this.db.delete(llmProvider).where(eq(llmProvider.id, id)).run();
  }

  // service-only accessor: decrypts and returns the raw provider api key for the
  // future s-04 client factory. its return is NOT a contract type and must never
  // be wired to a controller — decrypted plaintext does not cross the /api boundary.
  async getDecryptedApiKey(id: string): Promise<string> {
    const row = this.requireRow(id);
    return this.crypto.decrypt({ authTag: row.authTag, ciphertext: row.ciphertext, iv: row.iv });
  }

  // read the row or fail with an entity-naming 404 (nestjs.md error rule).
  private requireRow(id: string): LlmProviderRow {
    const row = this.db.select().from(llmProvider).where(eq(llmProvider.id, id)).get();
    if (!row) {
      throw new NotFoundException(`llm provider ${id} not found`);
    }
    return row;
  }

  // project safe fields only (never spread the row) and validate through the
  // shared contract, which normalizes the timestamp_ms dates to iso strings and
  // rejects any secret leakage. hasApiKey is derived from a stored ciphertext.
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
