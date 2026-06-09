import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Device, DeviceCreateRequest, deviceSchema, DeviceUpdateRequest } from '@opspilot/shared';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { DATABASE_CONNECTION, DatabaseConnection } from '../database/providers/database-connection.provider';
import { device } from '../database/schema/device.schema';

type DeviceRow = typeof device.$inferSelect;

@Injectable()
export class DeviceService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: DatabaseConnection) {}

  async create(input: DeviceCreateRequest): Promise<Device> {
    const row = this.db
      .insert(device)
      .values({ host: input.host, id: randomUUID(), name: input.name })
      .returning()
      .get();
    return this.toContract(row);
  }

  async findAll(): Promise<Device[]> {
    const rows = this.db.select().from(device).all();
    return rows.map((row) => this.toContract(row));
  }

  async findOne(id: string): Promise<Device> {
    return this.toContract(this.requireRow(id));
  }

  async update(id: string, input: DeviceUpdateRequest): Promise<Device> {
    this.requireRow(id);
    const row = this.db.update(device).set(input).where(eq(device.id, id)).returning().get();
    return this.toContract(row);
  }

  async remove(id: string): Promise<void> {
    this.requireRow(id);
    // fk onDelete: 'cascade' removes the device's credential rows with it.
    this.db.delete(device).where(eq(device.id, id)).run();
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
      createdAt: row.createdAt,
      host: row.host,
      id: row.id,
      name: row.name,
      updatedAt: row.updatedAt,
    });
  }
}
