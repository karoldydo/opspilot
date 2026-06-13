import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Device, DeviceCreateRequest, deviceSchema, DeviceUpdateRequest } from '@opspilot/shared';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { AuditService } from '../audit/audit.service';
import { DATABASE_CONNECTION, DatabaseConnection } from '../database/providers/database-connection.provider';
import { device } from '../database/schema/device.schema';

type DeviceRow = typeof device.$inferSelect;

@Injectable()
export class DeviceService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DatabaseConnection,
    @Inject(AuditService) private readonly auditService: AuditService
  ) {}

  async create(input: DeviceCreateRequest, userId: string): Promise<Device> {
    // wrap the bare insert in a transaction so the audit row commits or rolls back
    // with the device — pass tx to AuditService.record (the txn-handle nuance).
    const row = this.db.transaction((tx) => {
      const inserted = tx
        .insert(device)
        .values({ agentContext: input.agentContext ?? null, host: input.host, id: randomUUID(), name: input.name })
        .returning()
        .get();
      this.auditService.record(
        {
          action: 'device.create',
          metadata: { host: inserted.host, name: inserted.name },
          targetId: inserted.id,
          targetType: 'device',
          userId,
        },
        tx
      );
      return inserted;
    });
    return this.toContract(row);
  }

  async findAll(): Promise<Device[]> {
    const rows = this.db.select().from(device).all();
    return rows.map((row) => this.toContract(row));
  }

  async findOne(id: string): Promise<Device> {
    return this.toContract(this.requireRow(id));
  }

  async update(id: string, input: DeviceUpdateRequest, userId: string): Promise<Device> {
    this.requireRow(id);
    const row = this.db.transaction((tx) => {
      // project explicit columns (never spread the dto); drizzle ignores undefined
      // so a partial patch only touches the fields the caller sent.
      const updated = tx
        .update(device)
        .set({ agentContext: input.agentContext, host: input.host, name: input.name })
        .where(eq(device.id, id))
        .returning()
        .get();
      this.auditService.record(
        { action: 'device.update', metadata: { name: updated.name }, targetId: id, targetType: 'device', userId },
        tx
      );
      return updated;
    });
    return this.toContract(row);
  }

  async remove(id: string, userId: string): Promise<void> {
    const existing = this.requireRow(id);
    this.db.transaction((tx) => {
      // fk onDelete: 'cascade' removes the device's credential rows with it.
      tx.delete(device).where(eq(device.id, id)).run();
      this.auditService.record(
        { action: 'device.delete', metadata: { name: existing.name }, targetId: id, targetType: 'device', userId },
        tx
      );
    });
  }

  // read the row or fail with an entity-naming 404 (nestjs.md error rule).
  private requireRow(id: string): DeviceRow {
    const row = this.db.select().from(device).where(eq(device.id, id)).get();
    if (!row) {
      throw new NotFoundException(`device ${id} not found`);
    }
    return row;
  }

  // project safe fields only (never spread the row) and validate through the
  // shared contract, which normalizes the timestamp_ms dates to iso strings.
  private toContract(row: DeviceRow): Device {
    return deviceSchema.parse({
      agentContext: row.agentContext,
      createdAt: row.createdAt,
      host: row.host,
      id: row.id,
      name: row.name,
      updatedAt: row.updatedAt,
    });
  }
}
