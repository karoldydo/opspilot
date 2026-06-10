import { relations, sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { device } from './device.schema';

// the curated managed-services subset — stable scan-derived identity only, never
// runtime facts (image/status go stale and live on the ephemeral scan result).
// scoped to a device with cascade delete, mirroring the credential table.
export const service = sqliteTable(
  'service',
  {
    // com.docker.compose.project.config_files label — nullable for standalone
    // containers (no compose stack).
    composePath: text('compose_path'),
    // com.docker.compose.project label — nullable for standalone containers.
    composeProject: text('compose_project'),
    // docker container name — scan-derived identity, part of the unique guard.
    containerName: text('container_name').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    deviceId: text('device_id')
      .notNull()
      .references(() => device.id, { onDelete: 'cascade' }),
    id: text('id').primaryKey(),
    // editable display name (the only mutable field).
    name: text('name').notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index('service_deviceId_idx').on(table.deviceId),
    // containerName is notNull, so the guard is sound — sqlite treats NULLs as
    // distinct, which is why composeProject (nullable) must NOT join the key.
    uniqueIndex('service_device_container_unq').on(table.deviceId, table.containerName),
  ]
);

export const serviceRelations = relations(service, ({ one }) => ({
  device: one(device, {
    fields: [service.deviceId],
    references: [device.id],
  }),
}));
