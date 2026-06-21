import { relations, sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { user } from './auth.schema';
import { device } from './device.schema';
import { service } from './service.schema';

// persist one diagnose run, scoped to a device + service with cascade delete.
// the fixed 4-field synthesis is stored as a single json text column — replay
// only lists by service + recency and renders the saved object, never queries
// into it. `userId` is nullable + indexed; activated in s-09 with a fk + relation
// (set null on user delete so a retained run keeps its history). it is still never
// surfaced in the s-05 wire contract (runRecordSchema omits it).
export const runRecord = sqliteTable(
  'run_record',
  {
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    deviceId: text('device_id')
      .notNull()
      .references(() => device.id, { onDelete: 'cascade' }),
    // wall-clock ms the synthesis generation took (s-05 avg-diagnose tile). nullable:
    // backfill is unnecessary — rows predating this column read null and are excluded
    // from the average; new runs populate it in the same insert.
    durationMs: integer('duration_ms'),
    id: text('id').primaryKey(),
    serviceId: text('service_id')
      .notNull()
      .references(() => service.id, { onDelete: 'cascade' }),
    // json of the fixed 4-field diagnosisSynthesis — opaque blob, never queried into.
    synthesis: text('synthesis').notNull(),
    // nullable user link, activated in s-09; set null on user delete (historical
    // nulls remain valid for runs written before s-09).
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
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
  user: one(user, {
    fields: [runRecord.userId],
    references: [user.id],
  }),
}));
