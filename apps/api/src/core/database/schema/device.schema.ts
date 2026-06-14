import { relations, sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { service } from './service.schema';

export const device = sqliteTable('device', {
  // host-level free-text persona injected as the diagnostic agent's `system`
  // instruction (fr-005 / s-07). nullable: blank = no system sent.
  agentContext: text('agent_context'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  host: text('host').notNull(),
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const credential = sqliteTable(
  'credential',
  {
    // base64 gcm auth tag — integrity check, paired with iv on decrypt
    authTag: text('auth_tag').notNull(),
    // 'password' | 'key' — enforced at the contract/service layer, stored as text
    authType: text('auth_type').notNull(),
    // base64 aes-256-gcm ciphertext of the ssh secret (a.k.a. encryptedSecret)
    ciphertext: text('ciphertext').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    deviceId: text('device_id')
      .notNull()
      .references(() => device.id, { onDelete: 'cascade' }),
    id: text('id').primaryKey(),
    // base64 random per-record iv
    iv: text('iv').notNull(),
    // forward-compat for key rotation — all rows write 1 for now
    keyVersion: integer('key_version').default(1).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    username: text('username').notNull(),
  },
  (table) => [index('credential_deviceId_idx').on(table.deviceId)]
);

export const deviceRelations = relations(device, ({ many }) => ({
  credentials: many(credential),
  services: many(service),
}));

export const credentialRelations = relations(credential, ({ one }) => ({
  device: one(device, {
    fields: [credential.deviceId],
    references: [device.id],
  }),
}));
