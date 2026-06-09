# Encrypted Credential Store Implementation Plan

## Overview

Implement the **crypto + storage layer** for SSH credentials encrypted at-rest (PRD FR-013).
A master AES-256 key is sourced from an env/secret var and validated at boot; SSH secrets are
encrypted with **AES-256-GCM** (`node:crypto`, zero new dependencies) on write and decrypted on
read inside a NestJS service. Secret material (ciphertext, IV, auth tag, plaintext) lives only on
the Drizzle table and never crosses the `/api` boundary — the shared Zod read contract exposes
safe metadata only.

This change deliberately stops at the **service + storage** boundary: no HTTP controllers/endpoints
and no `device` CRUD. A *thin* `device` table is created only as the FK target for credentials; its
full CRUD (FR-002) and the node-ssh `IExecutor` integration are separate planning concerns.

## Current State Analysis

The foundation is in place and this feature is a clean greenfield building block — **no crypto
code, no `device` entity, and no credential storage exist yet** (zero refactor risk). Every pattern
this feature needs already has a working precedent (verified against `2f301ac`, current HEAD):

- **Secret-from-env** — `BETTER_AUTH_SECRET` is the exact template: typed in `EnvConfig`,
  `Joi.string().min(32).required()` (no default, fail-fast at boot), surfaced via a `registerAs(...)`
  namespace, injected by `<config>.KEY`, never read from `process.env` in a service
  (`env.schema.ts:4,17`, `database.config.ts:3-8`, `config.module.ts`).
- **New table + migration** — define a `*.schema.ts`, re-export from the schema barrel
  (`database/schema/index.ts`), run `npm run db:generate`; the boot-time `MigrationService` applies
  it automatically behind a WAL-aware backup gate. **Never** run `drizzle-kit migrate` / better-auth
  migrate at runtime — it forks the `__drizzle_migrations` history the backup gate tracks.
- **Secret-safe contracts** — `account.password` (`auth.schema.ts:53`) lives only on the Drizzle
  table and is absent from the shared `authUserSchema` (`auth-user.schema.ts:10-18`). That omission,
  plus `z.strictObject` (rejects unknown keys), the projection-not-spread mapping, and the rule
  banning `$inferSelect` from `@opspilot/shared`, is the template for keeping the encrypted blob off
  the wire.
- **Runtime** — `node:24-alpine` (Node 24), so `aes-256-gcm` from `node:crypto` is available with
  zero new deps. (`@types/node` pinned to 20.x is dev-typings only; runtime is 24.)

Two genuinely new things: the crypto module (encrypt/decrypt over `node:crypto`) and the **first use
of the typed Drizzle query API** (`.select()/.insert()`) plus the first row→contract projection — all
existing DB access goes through the raw `$client`.

## Desired End State

After this plan:

- The API **refuses to boot** without a valid 32-byte (base64, 44-char) `ENCRYPTION_KEY`.
- A `CryptoService` encrypts/decrypts arbitrary plaintext with AES-256-GCM and a random per-record
  IV, returning/consuming `{ ciphertext, iv, authTag }` (all base64). Tampering with any component
  fails decryption (GCM auth).
- A `credential` table (referencing a thin `device` table) stores SSH secrets **only** as ciphertext
  + IV + auth tag + `keyVersion`. A `CredentialService` writes credentials (encrypting the secret)
    and reads them back (decrypting), mapping rows to a shared `z.strictObject` contract that contains
    **no** secret material.
- A new migration `0001_*` exists and applies cleanly at boot (with an auto-backup).

**Verification**: `npx nx test api` (crypto round-trip + tamper + credential write/read tests pass),
`npx nx test shared` (contract leak-rejection test passes), `npx nx lint api`/`lint shared` clean,
`npm run build:api` succeeds, and a fresh boot applies `0001_*`.

### Key Discoveries:

- The exact secret-from-env chain to mirror: `env.schema.ts:17` (`BETTER_AUTH_SECRET`
  Joi rule) → `database.config.ts:3-8` (`registerAs` + `process.env.X as string`) →
  `config.module.ts` `load: []`.
- Table idiom in `auth.schema.ts`: `text('id').primaryKey()` (no `$defaultFn` — id generated in the
  service via `crypto.randomUUID()`), timestamp default
  `sql\`(cast(unixepoch('subsecond') * 1000 as integer))\``, inline FK
  `.references(() => user.id, { onDelete: 'cascade' })` (`:33-35`), index in the table-callback array
  (`:37`), alphabetized columns, snake_case DB ↔ camelCase TS, separate `relations(...)` exports.
- Secret-omission template: `account.password` is on the Drizzle table but absent from
  `authUserSchema`; `auth-user.schema.spec.ts:64-77` proves `z.strictObject` rejects a leaked secret.
- Drizzle connection passes `drizzle(sqlite, { schema })` (`database-connection.provider.ts`), so a
  barrelled table is automatically typed — **no provider/module change** needed for the schema.
- `isoTimestamp` preprocessor idiom (`auth-user.schema.ts:6`) for wire timestamps; Zod v4 syntax
  (`z.iso.datetime()`, `z.email()`, `z.strictObject`, `error` not `message`, `.issues`).

## What We're NOT Doing

- **No `device` CRUD** — no controllers, no create/update/delete, no device read contract. Only a
  thin FK-target table (`id`, `name`, `host`, timestamps).
- **No HTTP surface for credentials** — no controllers/endpoints/guards/request-response wire
  contracts wired to a route. The read contract schema is defined in shared (for the service return
  type and future reuse) but nothing is exposed over `/api` yet.
- **No node-ssh `IExecutor` integration** — how decrypted credentials feed remote execution is a
  separate change.
- **No key rotation logic** — `keyVersion` column is added for cheap forward-compat, but no rotation
  / re-encrypt flow is built; all rows write `keyVersion = 1`.
- **No per-record KDF** — the 32-byte master key is used directly as the AES-256 key; per-record
  semantic security comes from the random IV.
- **No raw-`$client` usage for this feature** — credentials use the typed Drizzle query API.

## Implementation Approach

Build bottom-up so each phase has a real, independent gate: (1) make the key a hard boot
requirement; (2) build the crypto primitive in isolation and prove it with unit tests; (3) land the
schema + migration; (4) wire the service that joins crypto + storage and maps to a secret-safe
contract. The crypto module is framework-thin (a single injectable over `node:crypto`); the
credential service is the first consumer of the typed Drizzle API and sets the precedent for
projection-not-spread row mapping.

## Critical Implementation Details

- **Key decode at the use site, not in the factory.** `crypto.config.ts` keeps `encryptionKey` as
  the base64 *string*; decode to a 32-byte Buffer (`Buffer.from(key, 'base64')`) inside
  `CryptoService`. Joi `.base64().length(44)` validates encoding + encoded length but not decoded
  byte length — `CryptoService` should assert the decoded Buffer is exactly 32 bytes at construction
  so a structurally-valid-but-wrong-size key fails fast rather than at first encrypt.
- **Migration ordering is load-bearing.** schema file → barrel line → `npm run db:generate` (commit
  the emitted `0001_*.sql` + updated `meta/`) → boot-time runner applies it. Do **not** run
  `drizzle-kit migrate` at runtime.
- **GCM auth tag is mandatory for integrity.** Store the 16-byte `authTag` from
  `cipher.getAuthTag()`; pass it back via `decipher.setAuthTag(...)` before `final()` so a tampered
  ciphertext throws instead of returning garbage.

## Phase 1: Config & Master Key

### Overview

Make `ENCRYPTION_KEY` a validated, fail-fast boot requirement and expose it through a dedicated
`crypto` config namespace, mirroring the `database`/`auth` namespace pattern.

### Changes Required:

#### 1. Env schema — typed field + Joi rule

**File**: `apps/api/src/config/env.schema.ts`

**Intent**: Add `ENCRYPTION_KEY` so a missing/malformed master key fails fast at boot, matching the
`BETTER_AUTH_SECRET` precedent.

**Contract**: Add `ENCRYPTION_KEY: string;` to the `EnvConfig` interface (alphabetical, before
`NODE_ENV`) and a Joi rule to `envSchema` (alphabetical), with a lowercase inline comment:

```ts
// no default — master aes-256 key, 32 raw bytes as base64 (44 chars). must fail fast at boot.
ENCRYPTION_KEY: Joi.string().base64().length(44).required(),
```

#### 2. New crypto config namespace

**File**: `apps/api/src/config/crypto.config.ts` (new)

**Intent**: Surface the key as an injectable namespace token, mirroring `database.config.ts`.

**Contract**: `registerAs('crypto', () => ({ encryptionKey: process.env.ENCRYPTION_KEY as string }))`
plus `export type CryptoConfig = ConfigType<typeof cryptoConfig>;`. One export concept per file
(factory + its `ConfigType`, matching `database.config.ts`). Keep the value as the base64 string —
do **not** decode here.

#### 3. Register the namespace

**File**: `apps/api/src/config/config.module.ts`

**Intent**: Load the new namespace so `cryptoConfig.KEY` is injectable.

**Contract**: Add `cryptoConfig` to the `load: [...]` array (keep existing ordering convention).

### Success Criteria:

#### Automated Verification:

- Type checking / build passes: `npm run build:api`
- Lint passes: `npx nx lint api`
- Boot fails fast when `ENCRYPTION_KEY` is absent or wrong-length (covered by a config-module spec
  or asserted in the crypto service spec setup): `npx nx test api`

#### Manual Verification:

- Starting the API without `ENCRYPTION_KEY` in `.env` aborts at boot with a Joi validation error
  naming `ENCRYPTION_KEY`.
- A valid 44-char base64 key boots normally.

**Implementation Note**: After completing this phase and all automated verification passes, pause for
manual confirmation before proceeding.

---

## Phase 2: Crypto Module (AES-256-GCM)

### Overview

A single injectable `CryptoService` over `node:crypto` that encrypts/decrypts plaintext with
AES-256-GCM and a random per-record IV. Self-contained and unit-testable in isolation.

### Changes Required:

#### 1. CryptoService + module

**File**: `apps/api/src/crypto/crypto.service.ts` (new), `apps/api/src/crypto/crypto.module.ts` (new)

**Intent**: Provide `encrypt(plaintext)` and `decrypt(...)` primitives used by the credential
service; decode the master key to a 32-byte Buffer once and validate its length.

**Contract**:

- Inject the key via `@Inject(cryptoConfig.KEY) private readonly config: CryptoConfig`; decode
  `Buffer.from(this.config.encryptionKey, 'base64')` and assert `length === 32` at construction.
- `encrypt(plaintext: string): { ciphertext: string; iv: string; authTag: string }` — random 12-byte
  IV via `randomBytes(12)`, `createCipheriv('aes-256-gcm', key, iv)`, capture `getAuthTag()`; all
  three returned base64.
- `decrypt(input: { ciphertext: string; iv: string; authTag: string }): string` — `createDecipheriv`,
  `setAuthTag(Buffer.from(authTag, 'base64'))` before `final()`; returns utf8 plaintext.
- `CryptoModule` provides + exports `CryptoService`. Decide a shared `EncryptedPayload` TS type for
  the `{ ciphertext, iv, authTag }` shape (api-local — it is I/O-bound, **not** in `@opspilot/shared`).

#### 2. Crypto unit tests

**File**: `apps/api/src/crypto/crypto.service.spec.ts` (new)

**Intent**: Prove correctness and integrity guarantees.

**Contract**: Override `cryptoConfig.KEY` with a fixed test key
(`.overrideProvider(cryptoConfig.KEY).useValue({ encryptionKey: '<44-char base64>' })`). Cover:
round-trip (`decrypt(encrypt(x)) === x`); distinct IVs/ciphertext across two encrypts of the same
plaintext; tampered `authTag`/`ciphertext` throws; wrong-size key rejected at construction.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npx nx test api -- src/crypto/crypto.service.spec.ts`
- Lint passes: `npx nx lint api`
- Build passes: `npm run build:api`

#### Manual Verification:

- Encrypting the same plaintext twice yields different ciphertext (random IV confirmed).
- Flipping a byte of stored ciphertext makes decryption throw rather than return corrupt data.

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Schema & Migration (device + credential tables)

### Overview

Add a thin `device` table (FK target) and the `credential` table that stores the encrypted secret,
then generate and commit the migration. Boot-time runner applies it.

### Changes Required:

#### 1. Device + credential tables

**File**: `apps/api/src/database/schema/device.schema.ts` (new)

**Intent**: Create a minimal `device` (FK target only) and the `credential` table holding ciphertext
columns; follow the `auth.schema.ts` idiom exactly.

**Contract**:

- `device` (sqliteTable `'device'`): `id text primaryKey`, `name text notNull`, `host text notNull`,
  `createdAt`/`updatedAt` integer `timestamp_ms` with the `unixepoch` default (and `$onUpdate` on
  `updatedAt`). Columns alphabetized.
- `credential` (sqliteTable `'credential'`): `id text primaryKey`; `authTag text notNull`,
  `ciphertext text notNull` (a.k.a. `encryptedSecret`), `iv text notNull` (all base64);
  `keyVersion integer notNull default 1`; `username text notNull`; `authType text notNull`
  (`'password' | 'key'` enforced at the contract/service layer, stored as text);
  `deviceId text notNull .references(() => device.id, { onDelete: 'cascade' })`; `createdAt`/`updatedAt`
  as above. Table-callback index `index('credential_deviceId_idx').on(table.deviceId)`.
- Separate `relations(...)` exports: `device` has many `credential`; `credential` belongs to one
  `device` (mirror `accountRelations`/`userRelations`).

#### 2. Barrel registration

**File**: `apps/api/src/database/schema/index.ts`

**Intent**: Make the new tables part of the typed schema passed to `drizzle(sqlite, { schema })`.

**Contract**: Add `export * from './device.schema';`.

#### 3. Generate migration

**File**: `apps/api/migrations/0001_*.sql` + `apps/api/migrations/meta/*` (generated)

**Intent**: Produce the migration the boot runner applies; do not hand-write SQL.

**Contract**: Run `npm run db:generate`; commit the emitted `0001_*.sql` and updated `meta/_journal.json`

+ `meta/0001_snapshot.json`. Do not run `db:migrate` against a real DB at runtime.

### Success Criteria:

#### Automated Verification:

- Migration generated and present: `npm run db:generate` emits `migrations/0001_*.sql`
- Build passes (schema typechecks): `npm run build:api`
- Lint passes: `npx nx lint api`
- Existing migration/backup tests still pass: `npx nx test api`

#### Manual Verification:

- A fresh boot against an empty data dir applies `0000_*` then `0001_*`; `__drizzle_migrations` shows
  both, and `device`/`credential` tables exist with the expected columns + FK + index.
- Booting against a DB that already has `0000_*` triggers an auto-backup before applying `0001_*`.

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: Shared Contracts & CredentialService

### Overview

Define the secret-safe read contract and create-request schema in `@opspilot/shared`, then build
`CredentialService` — the first consumer of the typed Drizzle query API — wiring crypto + storage and
mapping rows to the contract via projection (never spreading the row).

### Changes Required:

#### 1. Shared read contract

**File**: `libs/shared/src/lib/schemas/credential.schema.ts` (new)

**Intent**: The safe-metadata shape the rest of the app may see; secret columns are simply omitted.

**Contract**: `z.strictObject` with `id`, `deviceId`, `username`, `authType: z.enum(['password','key'])`,
`createdAt`/`updatedAt` via the `isoTimestamp` idiom. **No** `ciphertext`/`iv`/`authTag`/plaintext/
`keyVersion`. `export type Credential = z.infer<typeof credentialSchema>;`. One export per file.

#### 2. Shared create-request contract

**File**: `libs/shared/src/lib/schemas/credential-create-request.schema.ts` (new)

**Intent**: The single place plaintext secret enters; modeled on `auth-login-request.schema.ts`.

**Contract**: `z.strictObject` with `deviceId`, `username`, `authType: z.enum(['password','key'])`, and
`secret: z.string().min(1, { error: '...' })` (the plaintext to encrypt). `z.infer` type exported.
Never reuse this as the read/response contract.

#### 3. Barrel exports

**File**: `libs/shared/src/index.ts`

**Intent**: Publish both schemas through the single barrel.

**Contract**: Add the two `export * from './lib/schemas/...'` lines.

#### 4. CredentialService + module

**File**: `apps/api/src/credential/credential.service.ts` (new),
`apps/api/src/credential/credential.module.ts` (new)

**Intent**: Encrypt-on-write / decrypt-on-read; map rows to the shared contract by projecting safe
fields only. First typed Drizzle usage.

**Contract**:

- Inject `DATABASE_CONNECTION` and `CryptoService` (import `CryptoModule`).
- `create(input: CredentialCreateRequest): Promise<Credential>` — generate `id` via
  `crypto.randomUUID()`, `CryptoService.encrypt(input.secret)` → `ciphertext/iv/authTag`,
  `keyVersion = 1`, `.insert(credential).values({...})` (typed query API), then **project** the safe
  fields into the `Credential` type (do not spread the row; map timestamps `Date → ISO`).
- `findById(id)` / `list(deviceId)` — `.select()` with a `.where(...)` on the indexed `deviceId`
  (paginate `list` per `drizzle.md`), project to `Credential` (metadata only).
- `getDecryptedSecret(id): Promise<string>` — internal/service-only accessor that reads the row and
  returns `CryptoService.decrypt(...)`; its return is **not** a contract type and must never be wired
  to a controller in this change. Throw `NotFoundException(\`credential ${id} not found\`)` when
  absent.
- `CredentialModule` imports `CryptoModule`, provides + exports `CredentialService`. Register the
  module in `app.module.ts`. Do **not** import `$inferSelect` into `@opspilot/shared`.

#### 5. Service + contract tests

**File**: `apps/api/src/credential/credential.service.spec.ts` (new),
`libs/shared/src/lib/schemas/credential.schema.spec.ts` (new)

**Intent**: Prove write→read round-trip and that the contract rejects secret leakage.

**Contract**: Service test (real in-memory/temp SQLite + real `CryptoService` with a fixed test key,
or `crypto`/db overrides) covers: `create` stores ciphertext (not plaintext) and returns metadata
with no secret fields; `getDecryptedSecret` returns the original plaintext; `findById` on a missing id
throws `NotFoundException`. Shared schema test mirrors `auth-user.schema.spec.ts:64-77`: a row with a
`ciphertext`/`secret` field fails `credentialSchema.parse` (strict-object rejection).

### Success Criteria:

#### Automated Verification:

- API tests pass: `npx nx test api -- src/credential/credential.service.spec.ts`
- Shared tests pass: `npx nx test shared`
- Lint passes: `npx nx lint api` and `npx nx lint shared`
- Build passes: `npm run build:api`
- Module-boundary lint clean (no `$inferSelect` or Drizzle types leaking into shared): `npm run lint`

#### Manual Verification:

- Creating a credential, then inspecting the `credential` row in `db:studio`, shows only ciphertext
  (no plaintext secret anywhere).
- The decrypted secret from `getDecryptedSecret` equals the original input.
- The returned `Credential` object contains no `ciphertext`/`iv`/`authTag`/`secret`/`keyVersion`.

**Implementation Note**: Final phase — confirm the full write→encrypt→store→read→decrypt loop manually.

---

## Testing Strategy

### Unit Tests:

- **Crypto**: round-trip; non-deterministic IV/ciphertext; tampered authTag/ciphertext throws;
  wrong-size key rejected at construction.
- **Shared contract**: `credentialSchema` strict-object rejects any secret-bearing field; `authType`
  enum rejects unknown values; timestamps normalize `Date → ISO`.
- **Credential service**: `create` persists ciphertext only and returns secret-free metadata;
  `getDecryptedSecret` recovers plaintext; missing id throws `NotFoundException`.

### Integration Tests:

- Boot-time migration applies `0001_*` (fresh DB) and triggers a backup when `0000_*` already exists
  (extends the existing `migration.service.spec.ts` coverage style).

### Manual Testing Steps:

1. Remove `ENCRYPTION_KEY` from `.env` → API aborts at boot naming `ENCRYPTION_KEY`.
2. Restore a valid 44-char base64 key → boots; `0001_*` applied; `device`/`credential` tables present.
3. Via a temporary script/spec, create a credential and open `npm run db:studio` → row shows only
   ciphertext/iv/authTag, never the plaintext secret.
4. Decrypt the stored credential → matches the original secret.

## Performance Considerations

AES-256-GCM over short SSH secrets is negligible. Using the master key directly (no per-record KDF)
avoids scrypt cost on every read. `list` queries hit the `credential_deviceId_idx` index and must be
paginated per `drizzle.md` (no unbounded scans).

## Migration Notes

New install only — no existing credential data to migrate. The boot runner auto-backs-up the DB
before applying `0001_*` when a prior migration history exists. `keyVersion` defaults to 1, leaving a
cheap path to a future rotation change without a schema migration.

## References

- Related research: `context/changes/encrypted-credential-store/research.md`
- Secret-from-env precedent: `apps/api/src/config/env.schema.ts:17`,
  `apps/api/src/config/database.config.ts:3-8`
- Table idiom + FK/index/relations: `apps/api/src/database/schema/auth.schema.ts:4-105`
- Boot migration runner + backup gate: `apps/api/src/database/migration/migration.service.ts:24-91`
- Secret-omission contract template: `libs/shared/src/lib/schemas/auth-user.schema.ts:10-18`,
  `libs/shared/src/lib/schemas/auth-user.schema.spec.ts:64-77`
- Prior deferral of this work (F-03): `context/archive/2026-05-31-data-persistence-scaffold/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Config & Master Key

#### Automated

- [x] 1.1 Type checking / build passes: `npm run build:api` — e21ce9e
- [x] 1.2 Lint passes: `npx nx lint api` — e21ce9e
- [x] 1.3 Boot fails fast on absent/wrong-length `ENCRYPTION_KEY`: `npx nx test api` — e21ce9e

#### Manual

- [x] 1.4 API without `ENCRYPTION_KEY` aborts at boot with a Joi error naming `ENCRYPTION_KEY` — e21ce9e
- [x] 1.5 A valid 44-char base64 key boots normally — e21ce9e

### Phase 2: Crypto Module (AES-256-GCM)

#### Automated

- [x] 2.1 Unit tests pass: `npx nx test api -- src/crypto/crypto.service.spec.ts` — 3ee7b83
- [x] 2.2 Lint passes: `npx nx lint api` — 3ee7b83
- [x] 2.3 Build passes: `npm run build:api` — 3ee7b83

#### Manual

- [x] 2.4 Same plaintext twice yields different ciphertext (random IV) — 3ee7b83
- [x] 2.5 Flipping a ciphertext byte makes decryption throw — 3ee7b83

### Phase 3: Schema & Migration (device + credential tables)

#### Automated

- [x] 3.1 Migration generated: `npm run db:generate` emits `migrations/0001_*.sql`
- [x] 3.2 Build passes (schema typechecks): `npm run build:api`
- [x] 3.3 Lint passes: `npx nx lint api`
- [x] 3.4 Existing migration/backup tests still pass: `npx nx test api`

#### Manual

- [x] 3.5 Fresh boot applies `0000_*` then `0001_*`; tables/FK/index present
- [x] 3.6 Boot against existing `0000_*` DB triggers auto-backup before `0001_*`

### Phase 4: Shared Contracts & CredentialService

#### Automated

- [ ] 4.1 API service tests pass: `npx nx test api -- src/credential/credential.service.spec.ts`
- [ ] 4.2 Shared tests pass: `npx nx test shared`
- [ ] 4.3 Lint passes: `npx nx lint api` and `npx nx lint shared`
- [ ] 4.4 Build passes: `npm run build:api`
- [ ] 4.5 Module-boundary lint clean (no Drizzle types in shared): `npm run lint`

#### Manual

- [ ] 4.6 `db:studio` shows only ciphertext in the credential row (no plaintext)
- [ ] 4.7 `getDecryptedSecret` equals the original input
- [ ] 4.8 Returned `Credential` has no `ciphertext`/`iv`/`authTag`/`secret`/`keyVersion`
