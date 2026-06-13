import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Credential, CredentialCreateRequest, credentialSchema } from '@opspilot/shared';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../crypto/crypto.service';
import { DATABASE_CONNECTION, DatabaseConnection } from '../database/providers/database-connection.provider';
import { credential } from '../database/schema/device.schema';

type CredentialRow = typeof credential.$inferSelect;

const KEY_VERSION = 1;
const LIST_LIMIT = 50;

@Injectable()
export class CredentialService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DatabaseConnection,
    @Inject(CryptoService) private readonly crypto: CryptoService,
    @Inject(AuditService) private readonly auditService: AuditService
  ) {}

  async create(input: CredentialCreateRequest, userId: string): Promise<Credential> {
    // encryption runs before the transaction (it rejects early on a bad input);
    // only the db write + audit insert are atomic together.
    const { authTag, ciphertext, iv } = this.crypto.encrypt(input.secret);
    const row = this.db.transaction((tx) => {
      const inserted = tx
        .insert(credential)
        .values({
          authTag,
          authType: input.authType,
          ciphertext,
          deviceId: input.deviceId,
          id: randomUUID(),
          iv,
          keyVersion: KEY_VERSION,
          username: input.username,
        })
        .returning()
        .get();
      // metadata stores ids/labels only — never the plaintext secret or ciphertext.
      this.auditService.record(
        {
          action: 'credential.create',
          metadata: { authType: inserted.authType, deviceId: inserted.deviceId, username: inserted.username },
          targetId: inserted.id,
          targetType: 'credential',
          userId,
        },
        tx
      );
      return inserted;
    });
    return this.toContract(row);
  }

  async findById(id: string): Promise<Credential> {
    return this.toContract(this.requireRow(id));
  }

  // service-only accessor: decrypts and returns the raw ssh secret. its return is
  // NOT a contract type and must never be wired to a controller — decrypted
  // plaintext does not cross the /api boundary.
  async getDecryptedSecret(id: string): Promise<string> {
    const row = this.requireRow(id);
    return this.crypto.decrypt({ authTag: row.authTag, ciphertext: row.ciphertext, iv: row.iv });
  }

  async list(deviceId: string, offset = 0, limit = LIST_LIMIT): Promise<Credential[]> {
    const rows = this.db
      .select()
      .from(credential)
      .where(eq(credential.deviceId, deviceId))
      .limit(limit)
      .offset(offset)
      .all();
    return rows.map((row) => this.toContract(row));
  }

  // delete a credential scoped to its device (the nested route's :deviceId is the
  // source of truth). a credential that doesn't belong to the device yields a
  // 404, never a cross-device delete. enables the web delete+recreate edit flow.
  async remove(deviceId: string, id: string, userId: string): Promise<void> {
    const row = this.db
      .select()
      .from(credential)
      .where(and(eq(credential.id, id), eq(credential.deviceId, deviceId)))
      .get();
    if (!row) {
      throw new NotFoundException(`credential ${id} not found`);
    }
    this.db.transaction((tx) => {
      tx.delete(credential).where(eq(credential.id, id)).run();
      this.auditService.record(
        {
          action: 'credential.delete',
          metadata: { deviceId: row.deviceId, username: row.username },
          targetId: id,
          targetType: 'credential',
          userId,
        },
        tx
      );
    });
  }

  // read the row or fail with an entity-naming 404 (nestjs.md error rule).
  private requireRow(id: string): CredentialRow {
    const row = this.db.select().from(credential).where(eq(credential.id, id)).get();
    if (!row) {
      throw new NotFoundException(`credential ${id} not found`);
    }
    return row;
  }

  // project safe fields only (never spread the row) and validate through the
  // shared contract, which normalizes the timestamp_ms dates to iso strings and
  // rejects any secret leakage.
  private toContract(row: CredentialRow): Credential {
    return credentialSchema.parse({
      authType: row.authType,
      createdAt: row.createdAt,
      deviceId: row.deviceId,
      id: row.id,
      updatedAt: row.updatedAt,
      username: row.username,
    });
  }
}
