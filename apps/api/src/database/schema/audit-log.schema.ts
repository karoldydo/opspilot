import { relations, sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { user } from './auth.schema';
import { runRecord } from './run-record.schema';

// persist one row per authenticated user action (s-09). keyed off the session
// user; `runRecordId` links a diagnose.run row to the run_record it produced so
// the timeline can expand the saved synthesis inline. metadata is a secret-free
// json text blob (ids/labels only — never plaintext credentials/keys). audit rows
// are retained indefinitely, so the runRecordId fk uses `set null` (pruning a run
// nulls the link without deleting the retained audit row).
export const auditLog = sqliteTable(
  'audit_log',
  {
    // the action enum string (see auditActionSchema in @opspilot/shared).
    action: text('action').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    id: text('id').primaryKey(),
    // secret-free json metadata — opaque blob, never queried into.
    metadata: text('metadata'),
    // nullable link to the diagnose run this action produced; set null on prune.
    runRecordId: text('run_record_id').references(() => runRecord.id, { onDelete: 'set null' }),
    targetId: text('target_id'),
    targetType: text('target_type'),
    // not-null by design — every audit row is attributed to a user. the fk is left at
    // the default `on delete no action` (NOT `set null` like run_record.userId, whose
    // column is nullable): the audit log is retained indefinitely, so we preserve
    // attribution and block deleting a user who still has audit rows rather than
    // orphaning them. `set null` would conflict with this not-null column.
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
  },
  (table) => [
    // drives the timeline order by(createdAt desc).
    index('audit_log_created_idx').on(table.createdAt),
    // by-user lookup.
    index('audit_log_user_idx').on(table.userId),
  ]
);

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  runRecord: one(runRecord, {
    fields: [auditLog.runRecordId],
    references: [runRecord.id],
  }),
  user: one(user, {
    fields: [auditLog.userId],
    references: [user.id],
  }),
}));
