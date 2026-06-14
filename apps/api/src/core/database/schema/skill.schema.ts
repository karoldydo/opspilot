import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { device } from './device.schema';

// skill-as-data: a fixed-structure command template with typed {{placeholder}}
// parameters. diverges from the child-entity pattern (credential/service) by making
// deviceId nullable — null marks a global skill (visible on every device), a uuid
// scopes it to one device. cascade delete drops a device's per-device skills with it;
// global rows (null deviceId) are untouched.
export const skill = sqliteTable(
  'skill',
  {
    // the structurally-fixed shell command; its only dynamic content is {{name}}
    // placeholders drawn from `parameters` (parity enforced at the write boundary in
    // shared). the PATH prefix is prepended by the renderer at run time, not stored.
    commandTemplate: text('command_template').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    // null = global skill; a uuid scopes it to one device (cascade delete).
    deviceId: text('device_id').references(() => device.id, { onDelete: 'cascade' }),
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    // serialized json array of typed parameters ({ name, source, required }); mapped
    // to/from the array in the service's toContract (phase 3).
    parameters: text('parameters').notNull(),
    // null inherits the config default (skill.config.ts, phase 4); a positive int
    // overrides the per-run timeout.
    timeoutMs: integer('timeout_ms'),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index('skill_deviceId_idx').on(table.deviceId)]
);
