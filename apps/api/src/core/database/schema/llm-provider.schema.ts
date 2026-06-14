import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// a flat, fk-less provider table: secret columns (the credential template) plus
// non-secret metadata and the single-active flag. the raw apiKey never lands
// here — only its aes-256-gcm ciphertext/iv/authTag (see crypto.service.ts).
// indexed on `active` (the activation where-clause + the future find-active for s-04).
export const llmProvider = sqliteTable(
  'llm_provider',
  {
    // single-active invariant: exactly one row is active at a time (app-enforced
    // via a transaction in the service — no partial-unique-index, see plan).
    active: integer('active', { mode: 'boolean' }).notNull().default(false),
    // base64 gcm auth tag — integrity check, paired with iv on decrypt
    authTag: text('auth_tag').notNull(),
    // openai-compatible base url the test-call and s-04 client factory target
    baseURL: text('base_url').notNull(),
    // base64 aes-256-gcm ciphertext of the provider api key
    ciphertext: text('ciphertext').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    id: text('id').primaryKey(),
    // base64 random per-record iv
    iv: text('iv').notNull(),
    // forward-compat for key rotation — all rows write 1 for now
    keyVersion: integer('key_version').default(1).notNull(),
    // provider family — 'openai-compatible' for now, extensible later
    kind: text('kind').notNull(),
    // the model id passed to the client factory
    model: text('model').notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index('llm_provider_active_idx').on(table.active)]
);
