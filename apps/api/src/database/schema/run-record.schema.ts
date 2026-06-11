import { relations, sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { device } from './device.schema';
import { service } from './service.schema';

// persist one diagnose run, scoped to a device + service with cascade delete.
// the fixed 4-field synthesis is stored as a single json text column — replay
// only lists by service + recency and renders the saved object, never queries
// into it. `userId` is nullable + indexed, reserved for s-09 (no fk yet); it is
// never surfaced in the s-05 wire contract (runRecordSchema omits it).
export const runRecord = sqliteTable(
  'run_record',
  {
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    deviceId: text('device_id')
      .notNull()
      .references(() => device.id, { onDelete: 'cascade' }),
    id: text('id').primaryKey(),
    serviceId: text('service_id')
      .notNull()
      .references(() => service.id, { onDelete: 'cascade' }),
    // json of the fixed 4-field diagnosisSynthesis — opaque blob, never queried into.
    synthesis: text('synthesis').notNull(),
    // reserved for s-09 — nullable user link, no fk required yet.
    userId: text('user_id'),
  },
  (table) => [
    // drives the recent-list where(serviceId) / order by(createdAt desc).
    index('run_record_service_created_idx').on(table.serviceId, table.createdAt),
    // reserved s-09 — by-user lookup.
    index('run_record_user_idx').on(table.userId),
  ]
);

export const runRecordRelations = relations(runRecord, ({ one }) => ({
  device: one(device, {
    fields: [runRecord.deviceId],
    references: [device.id],
  }),
  service: one(service, {
    fields: [runRecord.serviceId],
    references: [service.id],
  }),
}));
