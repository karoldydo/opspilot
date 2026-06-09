---
date: 2026-06-09T21:26:33+0200
researcher: Karol Dydo
git_commit: 2f301ace963ad5059d18e61b195edcd8bfcbcd89
branch: main
repository: opspilot
topic: "Encrypted credential store — encrypting SSH credentials at-rest (FR-013)"
tags: [ research, codebase, crypto, credentials, drizzle, config, zod-contracts, security ]
status: complete
last_updated: 2026-06-09
last_updated_by: Karol Dydo
---

# Research: Encrypted credential store — encrypting SSH credentials at-rest (FR-013)

**Date**: 2026-06-09T21:26:33+0200
**Researcher**: Karol Dydo
**Git Commit**: 2f301ace963ad5059d18e61b195edcd8bfcbcd89
**Branch**: main
**Repository**: opspilot

## Research Question

How should OpsPilot implement an **encrypted credential store** for SSH credentials
(PRD FR-013: "stores SSH credentials in encrypted form at-rest"), given the existing
codebase foundation? Scope (confirmed with the user): the **crypto + storage layer** —
the crypto module, the credentials/device table, integration with the migration runner
and config layer, and the Zod contracts that must never leak secret material. The
`device` CRUD entity and node-ssh `IExecutor` are treated only as integration points,
not designed here.

**Key decision (confirmed with the user, resolving PRD Open Question 1):** the master
encryption key comes from an **env/secret var** (validated in the Joi `env.schema`),
using **AES-256-GCM**. This is consistent with the existing config layer and realistic
for the accepted threat model (self-host behind Cloudflare Access; protects against leak
of a backup / DB file, **not** against takeover of a running host — `prd.md:65,143`).

## Summary

The foundation is in place and the credential store is the next clean building block —
**no crypto code, no `device` entity, and no credential storage exist yet** (greenfield
for this feature, zero refactor risk). Every pattern this feature needs already has a
working precedent in the repo:

1. **Secret-from-env** — `BETTER_AUTH_SECRET` is the exact template: typed in `EnvConfig`,
   `Joi.string().min(32).required()` (no default, fail-fast at boot), surfaced via a
   `registerAs(...)` namespace, injected by `<config>.KEY`, never read from `process.env`
   in a service. The new `ENCRYPTION_KEY` mirrors this on a **new `crypto` namespace**.
2. **New table + migration** — define a `*.schema.ts`, re-export it from the schema barrel,
   run `npm run db:generate`; the boot-time `MigrationService` applies it automatically
   (behind a WAL-aware backup gate). Do **not** run `drizzle-kit migrate`/better-auth
   migrate at runtime — it forks the `__drizzle_migrations` history the backup gate tracks.
3. **Secret-safe contracts** — the `account.password` column lives only on the Drizzle
   table and is *absent* from the shared `authUserSchema`. That omission, plus
   `z.strictObject` (rejects unknown keys) and the rule banning `$inferSelect` from
   `@opspilot/shared`, is the exact template for keeping the encrypted blob (and any
   plaintext) off the `/api` boundary.
4. **Runtime** — Node 24 (`node:24-alpine`), so `node:crypto` `aes-256-gcm` + `scrypt`
   are available with **zero new dependencies**.

The one genuinely new thing is the crypto module itself (encrypt/decrypt helper over
`node:crypto`) and the first use of the **typed Drizzle query API** (all existing DB
access goes through the raw `$client`).

## Detailed Findings

### Area 1 — Config / env layer (where the master key plugs in)

The config layer lives in `apps/api/src/config/` and is the single sanctioned place to
read `process.env` (per `nestjs.md` + `lessons.md`).

- **Joi schema + typed interface in one file** — `apps/api/src/config/env.schema.ts`.
  `EnvConfig` interface at `env.schema.ts:3-13`; `envSchema` Joi object at
  `env.schema.ts:15-29`. Keys are kept **alphabetical**; inline comments lowercase
  (`comments.md`).
- **The exact secret template** (`env.schema.ts:16-17`):
  ```ts
  // no default — a missing/short secret must fail fast at boot.
  BETTER_AUTH_SECRET: Joi.string().min(32).required(),
  ```
- **Namespace factories** use `registerAs(...)` and export a `ConfigType<typeof x>`.
  String secrets read via `process.env.X as string`; numerics wrapped in `Number(...)`
  because Joi writes validated defaults back to `process.env` as **strings**
  (`auth.config.ts:3-8`, `database.config.ts:3-8`). Factories are registered in
  `config.module.ts:12` `load: [authConfig, databaseConfig]` (`isGlobal: true`,
  `validationSchema: envSchema`, `validationOptions: { abortEarly: false, allowUnknown: true }`).
- **Injection** is by namespace token, not `ConfigService.get`:
  `@Inject(databaseConfig.KEY) private readonly config: DatabaseConfig`
  (`migration.service.ts:19`), read as `this.config.path` / `this.config.backupRetention`
  (`migration.service.ts:28,88`). Same pattern in `auth.provider.ts:15-25`,
  `database-connection.provider.ts:18-21`.
- **Test overrides** match the *factory output shape*, not the env var name:
  `.overrideProvider(databaseConfig.KEY).useValue({ backupRetention: 5, path: dbPath })`
  (`migration.service.spec.ts:55-56`; also `database.module.spec.ts:24`,
  `health.controller.spec.ts:42`).

**Insertion points for `ENCRYPTION_KEY`:**

| Edit                                                 | File                                         | Location                                                               |
|------------------------------------------------------|----------------------------------------------|------------------------------------------------------------------------|
| `EnvConfig` field `ENCRYPTION_KEY: string;`          | `apps/api/src/config/env.schema.ts`          | alphabetical, ~between lines 7–8                                       |
| Joi rule (see below)                                 | `apps/api/src/config/env.schema.ts`          | alphabetical, ~between lines 21–22                                     |
| New `crypto.config.ts` (`registerAs('crypto', ...)`) | `apps/api/src/config/crypto.config.ts` (new) | mirror `database.config.ts`                                            |
| Register namespace                                   | `apps/api/src/config/config.module.ts:12`    | add `cryptoConfig` to `load: []`                                       |
| Consume                                              | crypto/credential service                    | `@Inject(cryptoConfig.KEY)` → `this.config.encryptionKey`              |
| Test override                                        | feature `.spec.ts`                           | `.overrideProvider(cryptoConfig.KEY).useValue({ encryptionKey: '…' })` |

Suggested Joi rule for a base64-encoded 32-byte AES-256 key (44 base64 chars with
padding) — `.base64()` validates encoding but not decoded length, so pin the length:

```ts
// no default — master aes-256 key, 32 raw bytes as base64 (44 chars). must fail fast at boot.
ENCRYPTION_KEY: Joi.string().base64().length(44).required(),
```

(hex alternative: `Joi.string().hex().length(64).required()`). Keep the string base64
in config; decode to a `Buffer` at the crypto use site (`Buffer.from(key, 'base64')`),
not in the factory.

### Area 2 — Database schema + migration (the credentials/device table)

Drizzle ORM over SQLite (WAL) via `better-sqlite3` (synchronous). Template table:
`apps/api/src/database/schema/auth.schema.ts`.

- **Table idiom** (`auth.schema.ts`):
  - id: `text('id').primaryKey()` — plain `text` PK, **no uuid/cuid helper, no `$defaultFn`**.
    better-auth supplies its ids; a new table must generate ids in the **service layer**
    (e.g. `crypto.randomUUID()`).
  - `createdAt` (`:5-7`): `integer('created_at', { mode: 'timestamp_ms' })` with
    `.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`).notNull()`.
  - `updatedAt` (`:13-16`): same default + `.$onUpdate(() => new Date()).notNull()`.
  - strings `text('col')` (nullable unless `.notNull()`/`.unique()`); booleans
    `integer('col', { mode: 'boolean' })`; columns alphabetized; DB names snake_case ↔ TS camelCase.
  - **FK inline**: `.references(() => user.id, { onDelete: 'cascade' })` (`:33-35`).
  - **Index** in the table-callback array: `index('session_userId_idx').on(table.userId)`
    (`:37`). `drizzle.md` requires indexing every `where`/`order by` column.
  - **Relations** as separate `relations(...)` exports (`:88-105`).
- **Barrel registration** — `apps/api/src/database/schema/index.ts:5`
  (`export * from './auth.schema';`). A new `device.schema.ts` needs one added line.
  The connection provider passes `drizzle(sqlite, { schema })`
  (`database-connection.provider.ts:8,17-33`), so a barrelled table is automatically
  typed — **no provider/module change needed**.
- **Connection** — token `DATABASE_CONNECTION`
  (`database-connection.provider.ts:11`); type adds `$client` (raw better-sqlite3) onto
  the drizzle instance (`:13`); pragmas `journal_mode = WAL` + `foreign_keys = ON` set at
  open. `DatabaseModule` is `@Global()` and exports `DATABASE_CONNECTION`
  (`database.module.ts:11`).
- **Migration workflow**:
  - `drizzle.config.ts`: `dialect: 'sqlite'`, `schema: './src/database/schema/index.ts'`,
    `out: './migrations'`.
  - npm scripts (`package.json:13-15`): `db:generate` (drizzle-kit generate, emits
    `NNNN_*.sql` + `meta/`), `db:migrate` (dev/manual only), `db:studio`.
  - **Runtime runner** — `migration.service.ts` (`OnApplicationBootstrap`): `backupGate()`
    then `migrate(connection, { migrationsFolder })` (`:24-38`). Backup only when
    `databaseExisted && hasPendingMigrations()` (`:42-55`), using the WAL-aware
    `$client.backup(...)` (`:52`); retention prunes to `config.backupRetention`
    (`:82-91`). Pending detection compares `_journal.json` entries to applied rows in
    `__drizzle_migrations` (`:59-79`). Folder resolved across image/dev layouts by
    `migrations-folder.provider.ts:9-19`.
  - Existing migration: `apps/api/migrations/0000_low_taskmaster.sql` (account, session,
    user, verification) + `meta/_journal.json` + `meta/0000_snapshot.json`. A new
    `db:generate` produces `0001_*`.
- **Type boundary** — there is currently **no `$inferSelect` use and no Drizzle
  query-builder call anywhere** (`.select/.insert/...`); all DB access hits raw
  `$client.prepare(...)` (`health.service.ts:14`, migration counting/backup). This feature
  is the **first** to use the typed Drizzle query API and the first row→contract mapping.
  Rule (`drizzle.md` "Type boundary", `contracts.md:33-38`): `$inferSelect` is Node/DB-bound
  and must **not** leak into `@opspilot/shared`.

**Add-a-table recipe:** create `device.schema.ts` (define `device`, then the credential
table referencing it: `deviceId ... .references(() => device.id, { onDelete: 'cascade' })`,
`index('credential_deviceId_idx')`, ciphertext stored as `text(...)` columns — e.g.
`encryptedSecret`, `iv`, `authTag` — plus `relations(...)`) → add the barrel line → run
`npm run db:generate`, commit the SQL + `meta/` → boot applies it (with an auto-backup).

### Area 3 — Shared Zod contracts & secret-safe DB→contract mapping

`contracts.md` is the load-bearing rule: every wire shape is a Zod schema defined **once**
in `libs/shared`, consumed via `z.infer` in both apps, never redefined.

- **Convention**: one schema per file, `kebab-case` + `*.schema.ts` (+ `*.schema.spec.ts`),
  re-exported from the barrel `libs/shared/src/index.ts:1-5`. Imports always via the
  `@opspilot/shared` alias (enforced by `@nx/enforce-module-boundaries`).
- **Template** — `auth-user.schema.ts:1-20`: `z.strictObject({...})` (rejects unknown keys),
  `export type AuthUser = z.infer<typeof authUserSchema>;`, timestamps via the
  `isoTimestamp` preprocessor → `z.iso.datetime()` (wire = ISO string; the preprocessor
  normalizes a `Date` the better-auth client hands back — the Date↔ISO lesson). v4 syntax:
  `z.email()`, `z.iso.datetime()`.
- **Request contract** style — `auth-login-request.schema.ts:5-13` (`z.strictObject` with
  field-level `error` messages). Error envelope — `api-error.schema.ts:1-11`.
- **Request validation** — `ZodValidationPipe` (`common/zod-validation.pipe.ts:7-13`):
  `safeParse` → `BadRequestException(result.error.issues)` (v4 `.issues`) → return
  `result.data`. Used as `@Body(new ZodValidationPipe(schema))`.
- **Response shaping** — the established pattern types the return with the `z.infer` type
  and builds the object in the service; it does **not** currently re-`parse()` the response
  (`health.controller.ts:14,17` returns `HealthResponse`; `health.service.ts:12-20` builds
  `{ db, status, timestamp: new Date().toISOString() }`). Optional outbound `schema.parse()`
  is allowed for runtime safety but is not the current convention.

**The secret-omission template (critical):** `account.password`
(`auth.schema.ts:53`), plus `accessToken/idToken/refreshToken` (`:43,51,55`), the session
`token` (`:28`) and verification `value` (`:83`) live **only on the Drizzle tables** and
are entirely absent from the shared `authUserSchema` (which exposes only
`createdAt, email, emailVerified, id, image, name, updatedAt`). Three enforcement layers:
(1) `$inferSelect` (which includes `password`) is banned from shared; (2) the service maps
rows by **projecting only safe fields** into the `z.infer` type — never spreading the raw
row — and `z.strictObject` throws if a secret sneaks in (proof:
`auth-user.schema.spec.ts:64-77`); (3) better-auth never surfaces the hash in the session
user.

**For this feature:** keep `encryptedSecret`/`iv`/`authTag` (and any plaintext) **only**
on the Drizzle table. Define the read contract (`device.schema.ts` / `credential.schema.ts`
in `libs/shared`) as a `z.strictObject` of safe metadata only (e.g. `id`, `deviceId`/`name`,
`host`, `username`, `authType: z.enum(['password','key'])`, `createdAt`/`updatedAt` via the
`isoTimestamp` idiom). Use a **separate** create-request schema (modeled on
`auth-login-request.schema.ts`) as the one place plaintext enters — never reuse it as the
read/response contract. Project rows to the contract in the service; never spread the row.

### Area 4 — Crypto primitives & existing secret handling

- **No crypto code exists** anywhere in `apps/**`: zero matches for `node:crypto`/
  `createCipheriv`/`randomBytes`/`scrypt`/`AES`/etc. No `device`/`credential`/
  `ENCRYPTION_KEY` references. Password hashing is intentionally delegated to better-auth
  (`better-auth.md`), so the only "secret-from-env used by the app" precedent is
  `BETTER_AUTH_SECRET` (full chain in Area 1: `env.schema.ts:4,16-17` →
  `auth.config.ts:5-6` → `config.module.ts:12` → `auth.provider.ts:15-25` →
  `create-auth.ts:8,33`).
- **Dependencies**: the only manifest is the root `package.json` (the deployable
  `apps/api/package.json` is generated by webpack `generatePackageJson`). **No** `argon2`,
  `bcrypt`, `jose`, `libsodium`, `tweetnacl`, `node-forge` installed — only
  `better-auth 1.6.15`. So the zero-dependency default is Node's built-in `node:crypto`.
- **Runtime**: `Dockerfile` uses `node:24-alpine` (Node 24); webpack `target: 'node'`,
  `compiler: 'tsc'`. Node 24 → `aes-256-gcm`, `scrypt`, `webcrypto` all available. (Note:
  `@types/node` is pinned to 20.x for dev typings only — runtime is 24.)

## Code References

- `apps/api/src/config/env.schema.ts:3-29` — `EnvConfig` + Joi schema; `:16-17` the
  `BETTER_AUTH_SECRET` template for a required secret.
- `apps/api/src/config/auth.config.ts:1-17` / `database.config.ts:3-8` — `registerAs(...)`
  namespace + numeric coercion pattern.
- `apps/api/src/config/config.module.ts:11-14` — global config wiring + `load: []` array.
- `apps/api/src/database/schema/auth.schema.ts:5-16,28,33-37,43,51,53,55,83,88-105` —
  table idiom (id/timestamps/index/FK/relations) and the secret-bearing columns to exclude.
- `apps/api/src/database/schema/index.ts:5` — schema barrel.
- `apps/api/src/database/providers/database-connection.provider.ts:8,11,13,17-33` —
  connection token/type/factory (`drizzle(sqlite, { schema })`, WAL + FK pragmas).
- `apps/api/src/database/migration/migration.service.ts:24-38,42-55,59-79,82-91` —
  boot migration runner + backup gate + pending detection + retention.
- `apps/api/drizzle.config.ts` + `package.json:13-15` — drizzle-kit config + db scripts.
- `apps/api/migrations/0000_low_taskmaster.sql` + `meta/_journal.json` — existing migration.
- `apps/api/src/health/health.service.ts:12-20` — the DB→shared-contract mapping precedent
  (object literal typed as the shared type; `Date → ISO`).
- `apps/api/src/common/zod-validation.pipe.ts:7-13` — request validation pipe.
- `libs/shared/src/index.ts:1-5` — contract barrel.
- `libs/shared/src/lib/schemas/auth-user.schema.ts:1-20` — `z.strictObject` + `z.infer` +
  `isoTimestamp` template; `auth-user.schema.spec.ts:64-77` — strict-mode leak rejection.
- `libs/shared/src/lib/schemas/auth-login-request.schema.ts:5-13` — request-contract style.
- `apps/api/src/auth/providers/auth.provider.ts:15-25` + `create-auth.ts:8,33` — secret
  injected by `.KEY` and used at the library boundary.

## Architecture Insights

- **One canonical way to add a secret**: Joi-validated env var (no default, fail-fast) →
  `registerAs` namespace in `config.module.ts` `load: []` → injected via `<config>.KEY`.
  Never `process.env` in a service (`nestjs.md`, `lessons.md`). A dedicated `crypto`
  namespace fits the feature boundary better than overloading `auth`.
- **Migration ordering is load-bearing**: schema file → barrel → `db:generate` → boot-time
  runner. Never `drizzle-kit migrate`/better-auth migrate at runtime (forks the
  `__drizzle_migrations` history the backup gate tracks).
- **Secrets are excluded by schema shape, not by filtering**: ciphertext columns live only
  on the Drizzle table; the shared `z.strictObject` read contract simply omits them, and
  the projection-not-spread mapping + strict-object + `$inferSelect`-ban make a leak a
  compile/runtime error rather than silent passthrough.
- **First typed Drizzle usage**: existing code only touches `$client`; this feature
  introduces `.select()/.insert()/...` and the first row→contract projection — set the
  precedent cleanly.
- **AES-256-GCM is authenticated encryption**: store `iv` (12-byte random per encryption,
  from `crypto.randomBytes`) and the GCM `authTag` alongside the ciphertext so decryption
  can verify integrity. Decode the base64 master key to a 32-byte Buffer at the use site.

## Historical Context (from prior changes)

- `context/archive/2026-05-31-data-persistence-scaffold/plan.md` (F-01) — built the config
  layer, boot-time migration runner + backup gate, and empty schema barrel; **explicitly
  defers credential encryption (F-03)**: "no credential encryption (F-03)". This change is
  that deferred F-03.
- `context/archive/2026-06-07-account-auth-foundation/plan.md` + `research.md` (F-02) — the
  direct precedent for a secret-from-env: "`BETTER_AUTH_SECRET` — `Joi.string().min(32)
  .required()`, no default (must be supplied)"; "Route every … tunable through
  `@nestjs/config` + Joi … Secrets/URL … are config, never in-file constants"; and the
  load-bearing migration rule: "Do not call Better Auth's own migrate, and do not run
  `drizzle-kit migrate` at runtime — either forks the `__drizzle_migrations` history the
  backup-gate tracks."
- `context/archive/2026-06-07-account-auth-foundation/change.md` — the precedent for
  recording a load-bearing security/threat-model assumption next to the code (Cloudflare
  Access as the deployment gate). This change should mirror that style when documenting its
  own key-location/threat-model decision (PRD Open Q1).
- `context/foundation/prd.md:42,64-65,111,143` — FR-013 + the accepted limitation
  ("protects against leak of a backup / DB file, NOT host takeover") + Open Question 1
  (now resolved: env/secret master key, AES-256-GCM).

## Related Research

- None yet for this change (`context/changes/encrypted-credential-store/` had only the
  stub `change.md`). Adjacent prior research:
  `context/archive/2026-06-07-account-auth-foundation/research.md` (config/Joi/`registerAs`
  + migration-via-existing-runner patterns).

## Open Questions

1. **Master key encoding** — base64 (`.length(44)`) vs hex (`.length(64)`). Recommendation:
   base64 (compact); pin the length so a wrong-size key fails at boot. *(Plan-time detail.)*
2. **KDF or raw key?** — use the 32-byte env key directly as the AES-256 key, or derive
   per-record via `scrypt`/HKDF? For a single app-held master key the direct key is simplest
   and sufficient for the accepted threat model; per-record random `iv` already gives
   semantic security. *(Plan-time decision.)*
3. **Encrypted blob layout** — separate `iv` / `authTag` / `ciphertext` columns vs a single
   packed `text` field (`iv:authTag:ciphertext` base64). Either works; separate columns are
   more explicit. *(Plan-time decision.)*
4. **Key rotation** — out of scope for MVP, but a `keyVersion` column now would make a future
   rotation cheap. *(Note for the plan; likely deferred.)*
5. **`device` entity boundary** — this research stops at the integration point; the `device`
   table/CRUD (FR-002) and how credentials feed the future node-ssh `IExecutor` are a
   separate planning concern, though the credential table will reference `device.id`.
