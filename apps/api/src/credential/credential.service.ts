import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Credential, CredentialCreateRequest, credentialSchema } from '@opspilot/shared';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { CryptoService } from '../crypto/crypto.service';
import { DATABASE_CONNECTION, DatabaseConnection } from '../database/providers/database-connection.provider';
import { credential } from '../database/schema/device.schema';

// the drizzle row shape (typed via $inferSelect) carries secret columns + dates;
// it is node/db-bound and never leaves this service — rows map to the shared
// credential contract by projection before they cross the /api boundary.
type CredentialRow = typeof credential.$inferSelect;

// the current key version every row writes — forward-compat for a future rotation
// flow that is out of scope here.
const KEY_VERSION = 1;
// default page size for list(); callers can narrow via the offset/limit params.
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
