import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Credential, CredentialCreateRequest, credentialSchema } from '@opspilot/shared';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

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
    @Inject(CryptoService) private readonly crypto: CryptoService
  ) {}

  async create(input: CredentialCreateRequest): Promise<Credential> {
    const { authTag, ciphertext, iv } = this.crypto.encrypt(input.secret);
    const row = this.db
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

  // delete a credential by id (enables the web delete+recreate edit flow).
  async remove(id: string): Promise<void> {
    this.requireRow(id);
    this.db.delete(credential).where(eq(credential.id, id)).run();
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
