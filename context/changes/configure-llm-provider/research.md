---
date: 2026-06-10T22:00:00+02:00
researcher: Karol Dydo
git_commit: f7e16ac0a6ffda2b2966fa6980f887265de90754
branch: main
repository: opspilot
topic: "Configure LLM provider (S-03 / FR-012) — feature shape, secret reuse, config layer, contract"
tags: [research, codebase, llm-provider, encrypted-credential-store, drizzle, zod-contract, config]
status: complete
last_updated: 2026-06-10
last_updated_by: Karol Dydo
---

# Research: Configure LLM provider (S-03 / FR-012)

**Date**: 2026-06-10T22:00:00+02:00
**Researcher**: Karol Dydo
**Git Commit**: f7e16ac0a6ffda2b2966fa6980f887265de90754
**Branch**: main
**Repository**: opspilot

## Research Question

How to build the `configure-llm-provider` feature (slice S-03, FR-012: "the user configures their own
endpoint + LLM provider credentials **without a redeploy**"). Scope agreed with the user:
**only the feature itself** (persistence + contract + CRUD + UI), focused on four areas:

1. reuse of secrets (F-03 / encrypted-credential-store) for the API key,
2. the established feature pattern (devices/services) as a template,
3. the config/env layer,
4. the shape of the provider contract.

## Summary

**The most important architectural finding (revealed by the investigation):** the LLM provider should
be modeled as a **DB-backed entity in the `devices` style**, and **not** as environment variables.
FR-012 literally requires configuration "without a redeploy" (`prd.md:102-103`), and env vars
(`registerAs` + Joi) require editing `.env` and restarting = effectively a redeploy. The config/env
layer remains the right place only for **non-secret operational defaults** (if any existed), not for
the provider configuration itself.

**The secret (API key) travels the existing encryption channel, but not the existing table.**
`CryptoService` (AES-256-GCM) is fully generic and suitable for reuse 1:1. The `credential` table
and `CredentialService`, however, are hard-coupled to the SSH domain (required `deviceId` FK,
`username`, `authType` enum), so the provider key **cannot be forced in there as-is**. Recommended
path: a **dedicated `llm_provider` table + its own service injecting `CryptoService`**, which copies
the proven "secret-safe" pattern from `CredentialService` (`encrypt` on input, `toContract` projects
only safe fields, `getDecryptedSecret()` only for the internal consumer = the future S-04 agent).

**The Vercel AI SDK is still greenfield** — no `ai` or `@ai-sdk/*` package is installed
(`package.json:27-130`). S-03 need not install the SDK; the contract only carries the fields that
S-04 will pass to the client factory. FR-012 and `shape-notes.md:129` point to an
**OpenAI-compatible** provider (minimal shape: `baseURL` + `model` + `apiKey`, plus `kind` as an
extensible discriminator).

**The feature pattern is mature and repeatable** — `shared → api → web`, with Zod as the single
binding contract. `devices` (a flat, top-level resource) is the best template (not the nested
`services`). The full file checklist is in the "Architecture Insights" section.

## Detailed Findings

### Area 1 — Secret reuse (F-03 / encrypted-credential-store)

**`CryptoService` is generic and reusable as-is** — `apps/api/src/crypto/crypto.service.ts`:
- AES-256-GCM, a 12-byte random IV per-call, a 32-byte key, a 16-byte auth tag
  (`crypto.service.ts:7-10`).
- `encrypt(plaintext: string): EncryptedPayload` returns `{ authTag, ciphertext, iv }` (base64)
  (`crypto.service.ts:36-47`); `decrypt(input): string` with `setAuthTag` before `final()`, so
  tampering throws (`crypto.service.ts:27-34`).
- `EncryptedPayload = { authTag, ciphertext, iv }` (`crypto/encrypted-payload.type.ts:1-5`).
- Exported by `CryptoModule` (`crypto.module.ts:5-8`). Zero domain dependencies — it knows
  nothing about SSH/devices. **Suitable 1:1 for the LLM key.**
- There are **no** `rotate`/`store`/`retrieve` methods — these are not concepts in the code.
  `keyVersion` is just a forward-compat column (always written as `1`).

**Key management** — a single master key from the env var `ENCRYPTION_KEY`:
- Joi: `Joi.string().base64().length(44).required()` (no default, fail-fast at boot)
  (`config/env.schema.ts:30`).
- Exposed via the `crypto` namespace: `registerAs('crypto', () => ({ encryptionKey:
  process.env.ENCRYPTION_KEY }))` (`config/crypto.config.ts:5-7`), injected as
  `@Inject(cryptoConfig.KEY)` (`crypto.service.ts:16`). **The LLM key travels the same
  `ENCRYPTION_KEY` — a new env var is not needed.**

**`CredentialService` is SSH-specific** — `apps/api/src/credential/credential.service.ts`:
- `create(input)` encrypts `input.secret`, inserts a row, returns the contract without the secret
  (`credential.service.ts:22-39`); `getDecryptedSecret(id)` = the internal plaintext accessor,
  "must never be wired to a controller" (`:45-51`); `toContract()` projects only safe fields
  and parses through `credentialSchema` (`:91-100`).
- **SSH coupling:** the `credential` table (`database/schema/device.schema.ts:19-46`) has a required
  `deviceId` FK with `onDelete: 'cascade'`, a required `username`, an `authType: 'password' | 'key'`
  enum. `list`/`remove` are keyed by `deviceId` (`:53-77`). The LLM API key has no device, username
  nor auth type — **it will not fit here without generalization.**

**At-rest format:** three separate base64 columns (`iv`, `ciphertext`, `authTag`) + `keyVersion`; no
per-record KDF (the master key used directly, security from a random IV). Threat model (from the
archive): protects a backup/DB-file leak, **not** a live-host takeover.

**E2E consumer (SSH):** `SshExecutor.run()` (`apps/api/src/executor/ssh.executor.ts:35-80`) →
`resolveCredential(deviceId)` → `credentialService.list(deviceId)[0]` (`:84-91`) →
`getDecryptedSecret(id)` wrapped in a domain `CredentialDecryptError` (`:95-101`) → plaintext to
`ssh.connect(...)`. This is the pattern for how S-04 will read the provider key.

**Reuse verdict:** the LLM key does **not** drop into the `credential` table as-is. What is reusable
is the encryption channel itself (`ENCRYPTION_KEY` + `cryptoConfig` + `CryptoService.encrypt/decrypt`).
Recommendation: **Path A — a dedicated `llm_provider` table + a service depending on
`CryptoModule`/`CryptoService`**, storing `iv`/`ciphertext`/`authTag`/`keyVersion` + provider
metadata, copying the secret-safe pattern. Path B (generalizing `credential` with a `kind`
discriminator + nullable `deviceId`/`username`/`authType`) = a migration + contract changes touching
the existing SSH flow and its tests — not recommended for one new secret type.

### Area 2 — Feature pattern (devices / services)

Each domain = a Nest **feature module** = `{domain}.module.ts` + `.controller.ts` + `.service.ts`
(+ an optional `.errors.ts`). **No separate repository layer** — the service holds Drizzle queries
directly. Validation is per-`@Body` `ZodValidationPipe` (no global pipe).

**Routing / global prefix:**
- The global prefix `api` is set once in `apps/api/src/main.ts:12-13`, so `@Controller('devices')`
  serves `/api/devices`.
- `main.ts:11` creates the app with `bodyParser: false` (for Better Auth's raw-body catch-all), so
  **every domain module must re-apply the `json()` middleware** — `device.module.ts:16-20`,
  `service.module.ts:16-21`. This is easy to miss during scaffolding.
- The module is registered in `app.module.ts:18` (imports array).

**Devices controller** (`apps/api/src/device/device.controller.ts`) — `@Controller('devices')`,
`@Inject(DeviceService)`, 5 REST methods:
- `create(@Body(new ZodValidationPipe(deviceCreateRequestSchema)) body): Promise<Device>` (`:17-20`),
- `findAll(): Promise<Device[]>` (`:22-25`), `findOne(@Param('id') id): Promise<Device>` (`:27-30`),
- `update(@Param('id'), @Body(new ZodValidationPipe(deviceUpdateRequestSchema))): Promise<Device>`
  (`:32-38`), `remove(@Param('id')): Promise<void>` with `@Delete(':id')` + `@HttpCode(NO_CONTENT)`
  (`:40-44`).

**ZodValidationPipe** (`apps/api/src/common/zod-validation.pipe.ts:7-13`) — `schema.safeParse`, on
error `BadRequestException(result.error.issues)`. Shared infrastructure.

**Service layer** (`apps/api/src/device/device.service.ts`):
- `@Inject(DATABASE_CONNECTION) db` (`:13`), `type DeviceRow = typeof device.$inferSelect` locally
  (`:9`, never in shared), `id: randomUUID()` (`:18`), `requireRow(id)` throws a 404
  (`` `device ${id} not found` ``, `:53-59`), `toContract(row)` = `deviceSchema.parse({...})`
  projecting safe fields (`:63-71`). **Never spreads the DTO into `.set()`** — explicit columns
  (`:37-43`).

**Persistence (Drizzle + SQLite):**
- Schemas in `apps/api/src/database/schema/*.schema.ts`; the barrel
  `database/schema/index.ts:5-7` re-exports each file (the drizzle-kit generate target + the runtime type).
- Table conventions (`service.schema.ts:9-39`): `sqliteTable`, `id: text().primaryKey()`,
  timestamps `integer('created_at', { mode: 'timestamp_ms' }).default(sql\`...\`)` (+ `updated_at`
  with `.$onUpdate(() => new Date())`), FK `.references(() => device.id, { onDelete: 'cascade' })`,
  indexes in the third argument, `relations(...)`.
- DB client: the `DATABASE_CONNECTION` token (`database/providers/database-connection.provider.ts:11`),
  a single `better-sqlite3` (WAL, `foreign_keys = ON`), provided by the **`@Global()`
  `DatabaseModule`** (`database.module.ts:9-20`) — feature modules do not import it, only
  `@Inject(DATABASE_CONNECTION)`.
- Migrations: the drizzle-kit config `apps/api/drizzle.config.ts:9-16` (`schema: ...index.ts`,
  `out: ./migrations`, `dialect: sqlite`); SQL files in `apps/api/migrations/` + `meta/` snapshots;
  applied at boot by `migration/migration.service.ts`. **Do not write SQL by hand** — generate with
  drizzle-kit (the next will be `0003_*`).

**Shared contract** (`libs/shared/src/lib/schemas/`) — three files per domain, one export per file:
`{domain}.schema.ts` (response), `{domain}-create-request.schema.ts`, `{domain}-update-request.schema.ts`
+ co-located `.spec.ts`. Everything `export *` from `libs/shared/src/index.ts:8-15` (alphabetical).

**Web feature** (`apps/web/src/app/`) — layers: **client** (`core/clients/`) → **store**
(`core/stores/`) → **components** (`features/{domain}/`). Client/store provided at the
route/component level, **never `providedIn: 'root'`**:
- Client (`core/clients/devices.client.ts`): a manual `@Injectable()` with `HttpClient`, relative
  `/api/...` URLs (session cookie), **every response parsed through the shared schema**
  (`.then((row) => deviceSchema.parse(row))`, `:28-39`).
- Store (`core/stores/devices.store.ts`): `@ngrx/signals` **`signalState`/`patchState`** (NOT
  `signalStore()`), signals `devices`/`error`/`loading` + `isEmpty = computed`, **mutate-then-refetch**
  (`await this.load()` after every mutation), actions return `{ error: null | string }`, an
  `errorMessage` helper via `apiErrorSchema.safeParse(error.error)` (`:33-41`).
- Component (`features/devices/devices.component.ts`): `OnPush`, `selector: 'app-devices'`,
  `providers: [DevicesClient, DevicesStore]`, spartan `Hlm*`, `void this.store.load()` in the
  constructor; dialogs receive the store via `injectBrnDialogContext` (the CDK overlay is outside the
  route injector); forms via `schemaValidator(schema.shape.field)`
  (`core/validators/schema.validator.ts:7-15`).
- Routing (`app.routes.ts:15-20`): lazy `loadComponent` + `canActivate: [authGuard]`.

### Area 3 — Config/env layer

**Location:** `apps/api/src/config/`. `env.schema.ts` contains the `EnvConfig` interface (`:3-17`) and
the Joi `envSchema` (`:19-42`). Five `registerAs(...)` namespaces: `auth`, `crypto`, `database`,
`device`, `ssh`.

**Registration** (`config/config.module.ts:13-18`): `NestConfigModule.forRoot({ isGlobal: true,
load: [authConfig, cryptoConfig, databaseConfig, deviceConfig, sshConfig], validationOptions:
{ abortEarly: false, allowUnknown: true }, validationSchema: envSchema })`. No `envFilePath`
(`@nestjs/config` default behavior). Imported in `app.module.ts:17-18`.

**Read pattern** (always an explicit token, never `process.env` in a service):
- `@Inject(cryptoConfig.KEY) private readonly config: CryptoConfig` → `this.config.encryptionKey`
  (`crypto.service.ts:16-20`).
- `@Inject(sshConfig.KEY)` → `this.config.connectTimeoutMs` / `commandTimeoutMs`
  (`ssh.executor.ts:24,50,60`).
- In factories: `inject: [authConfig.KEY], useFactory: (config: AuthConfig) => ...`
  (`auth/providers/auth.provider.ts:12-21`).
- **Numerics coerced with `Number(...)`** in the namespace (Joi writes defaults back into
  `process.env` as strings) — `database.config.ts:4`, `device.config.ts:7`, `ssh.config.ts:7-8`.

**Existing secrets/endpoints:** `BETTER_AUTH_SECRET` (min 32), `ENCRYPTION_KEY` (base64/44),
`BETTER_AUTH_URL` (uri) — all `required()` with no default (fail-fast). **No LLM_*/OPENAI_*/ANTHROPIC_*
variables of any kind.**

**Conclusion for S-03:** the config layer **is not** the home for provider configuration (env requires
a restart, FR-012 forbids it — see "Open Questions"/Summary). It remains appropriate only for possible
**non-secret operational defaults** of the provider (e.g. an LLM request timeout), added via a new
`registerAs('llm', ...)` namespace per the tunables lesson. The API key itself travels the existing
`ENCRYPTION_KEY`, not a new variable.

### Area 4 — Provider contract shape

**Zod conventions in shared** (`.claude/rules/zod.md`, `.claude/rules/contracts.md`,
`shared-library.md`):
- Zod v4: top-level `z.uuid()`/`z.url()`/`z.email()`, messages via `error:` (not `message:`),
  `z.strictObject` for closed objects (`zod.md:21-28`; in use: `device.schema.ts:14`,
  `device-create-request.schema.ts:7-8`).
- Export: a `camelCase`+`Schema` schema + a `PascalCase` type via `z.infer`
  (`device.schema.ts:19`).
- Three-way split: entity/response (`device.schema.ts:11-17`, full shape with `id`+timestamps),
  create-request (`device-create-request.schema.ts:6-9`, only the user's fields, `.min(1, { error })`),
  update-request — **two idioms**: `createRequestSchema.partial().refine(len>0)`
  (`device-update-request.schema.ts:7-9`) or a closed single-field `strictObject`
  (`service-update-request.schema.ts:7-9`).
- **Timestamps = `z.iso.datetime()` on the wire**, via a shared preprocess `Date → toISOString()`
  (an identical block in `credential.schema.ts:6`, `device.schema.ts:6`, `service.schema.ts:6`). See
  the Date↔ISO lesson at the Better Auth client boundary.
- Enums: `z.enum([...])` (`credential.schema.ts:13`); the DB column is `text`, the enum is enforced in
  the contract/service. **No `.brand()`** anywhere in `libs/shared` — branding is not a convention.
- **Secret-omission convention (load-bearing for S-03):** `credentialSchema` is a `z.strictObject`
  deliberately, so that leaking a secret-bearing field is **rejected at parse** (`credential.schema.ts:11-19`;
  tests `credential.schema.spec.ts:47-73`). The create-request is "the only place plaintext enters" and
  "is never reused as a response" (`credential-create-request.schema.ts:4-12`).

**Vercel AI SDK provider model** (`.claude/rules/vercel-ai-sdk.md` says "server-side in apps/api,
against a user-configured LLM provider", forbids free-form chat; does not enumerate fields). FR-012 +
`shape-notes.md:129` ("OpenAI-compatible") → the minimal shape is an **OpenAI-compatible** provider
(`createOpenAICompatible`/`createOpenAI`): `baseURL` (custom endpoint, non-secret), `apiKey`
(secret), `model` id (non-secret), an optional `kind`/`name` discriminator (non-secret). This opens
the path to adding `@ai-sdk/anthropic` later via the `kind` field without breaking the contract.

**SDK = greenfield:** no `ai`/`@ai-sdk/*` in `package.json:27-130`. S-03 need not install the SDK —
building the client is S-04.

**"Key is set" vs returning the key:** the convention = omit the secret entirely from the response. For
the provider the UI wants to show whether a key is configured — hence a **derived `hasApiKey:
z.boolean()` flag** in the response (the service sets it from "the ciphertext column is non-empty"). The
key itself appears only inbound on create/update, exactly like `secret` in
`credential-create-request.schema.ts`.

## Code References

- `apps/api/src/crypto/crypto.service.ts:36-47` — `encrypt()` AES-256-GCM, returns `EncryptedPayload`
  (generic, reuse 1:1).
- `apps/api/src/crypto/crypto.module.ts:5-8` — exports `CryptoService`.
- `apps/api/src/credential/credential.service.ts:22-100` — the secret-safe pattern: `create`/`toContract`/
  `getDecryptedSecret` (SSH-specific, but the template to copy).
- `apps/api/src/database/schema/device.schema.ts:19-46` — the `credential` table with secret columns
  (`iv`/`ciphertext`/`authTag`/`keyVersion`) — the column model for `llm_provider`.
- `apps/api/src/device/device.controller.ts:13-44` — the REST controller pattern (flat resource).
- `apps/api/src/device/device.service.ts:9-71` — the service pattern (DI, `toContract`, `requireRow`).
- `apps/api/src/device/device.module.ts:16-20` — re-applying the `json()` middleware (required by
  `bodyParser: false`).
- `apps/api/src/common/zod-validation.pipe.ts:7-13` — the shared validation pipe.
- `apps/api/src/database/schema/index.ts:5-7` — the schema barrel (drizzle-kit target).
- `apps/api/src/database/database.module.ts:9-20` — the `@Global` DatabaseModule, the
  `DATABASE_CONNECTION` token.
- `apps/api/drizzle.config.ts:9-16` — the migration-generation config.
- `apps/api/src/config/env.schema.ts:3-42` — `EnvConfig` + Joi; `ENCRYPTION_KEY` at `:30`.
- `apps/api/src/config/crypto.config.ts:5-7` — the `crypto` namespace (master key).
- `apps/api/src/config/config.module.ts:13-18` — the global registration + `load` array.
- `libs/shared/src/lib/schemas/device.schema.ts:6,11-19` — entity schema, `isoTimestamp`,
  `z.infer`.
- `libs/shared/src/lib/schemas/credential.schema.ts:11-19` — the secret-omission pattern
  (`z.strictObject`).
- `libs/shared/src/lib/schemas/credential-create-request.schema.ts:4-12` — the only plaintext entry.
- `libs/shared/src/index.ts:8-15` — the contract barrel.
- `apps/web/src/app/core/clients/devices.client.ts:28-39` — the client parsing through the schema.
- `apps/web/src/app/core/stores/devices.store.ts:33-58` — the `signalState` + mutate-then-refetch store.
- `apps/web/src/app/features/devices/devices.component.ts:21-45` — the OnPush component + providers.
- `apps/web/src/app/app.routes.ts:15-20` — the lazy route + authGuard.
- `package.json:27-130` — no `ai`/`@ai-sdk/*` (greenfield).

## Architecture Insights

**Framing decision: a DB-backed entity, not an env var.** FR-012 "without a redeploy" (`prd.md:102-103`)
rules out configuration via `.env`. The provider is a managed entity in the `devices` style. This is the
main signal that resolves the tension between the "config layer" focus and the rest — config stays for
possible non-secret defaults, not for the configuration itself.

**Cardinality to be resolved in the plan.** FR-012 suggests one provider per install (a flat,
single-user model). If single-row → an upsert/PUT may fit better than create+update; if many providers
with one active → add `name` + an `active` flag. The roadmap does not pin this (`roadmap.md:151-161`) —
a decision flag for `/10x-plan`.

**Proposed contract shape (PROPOSAL for the planner, not code):**

`llm-provider.schema.ts` — `llmProviderSchema = z.strictObject({ ... })`:
| Field | Type | Secret | Notes |
|---|---|---|---|
| `id` | `z.uuid()` | no | like `device.schema.ts:14` |
| `kind` | `z.enum(['openai-compatible'])` | no | discriminator, extensible (anthropic later) |
| `baseURL` | `z.url()` | no | custom endpoint |
| `model` | `z.string()` | no | model id for `provider(modelId)` |
| `hasApiKey` | `z.boolean()` | no | derived "key is set" flag; the key is never returned |
| `createdAt` | `isoTimestamp` | no | shared preprocess |
| `updatedAt` | `isoTimestamp` | no | shared preprocess |

`llm-provider-create-request.schema.ts` — `z.strictObject`, the only key entry:
`kind` (enum, can `.default`), `baseURL` (`z.url({ error })`), `model` (`.min(1)`),
**`apiKey` (`z.string().min(1)` — SECRET**, encrypted with `CryptoService.encrypt()` before saving).

`llm-provider-update-request.schema.ts` — `createRequestSchema.partial().refine(len>0)`; `apiKey`
optional (present = key rotation, absent = keep the stored one).

**File checklist (template: `devices`, a flat resource):**

*Shared (`libs/shared/src/`):*
1. `lib/schemas/llm-provider.schema.ts` (+ type `LlmProvider`).
2. `lib/schemas/llm-provider-create-request.schema.ts` (+ type).
3. `lib/schemas/llm-provider-update-request.schema.ts` (+ type).
4. `.spec.ts` next to each schema.
5. 3× `export *` in `libs/shared/src/index.ts` (alphabetical).

*API (`apps/api/src/`):*
6. `database/schema/llm-provider.schema.ts` — `sqliteTable('llm_provider', {...})`: `id` PK,
   `created_at`/`updated_at` timestamp_ms, non-secret `kind`/`base_url`/`model`, secret
   `iv`/`ciphertext`/`auth_tag`/`key_version` (like `credential`), `relations(...)`.
7. `export *` in `database/schema/index.ts`.
8. Generate the migration with drizzle-kit → `migrations/0003_*.sql` + `meta/` (do not write by hand).
9. `llm-provider/llm-provider.service.ts` — `@Inject(DATABASE_CONNECTION)`,
   `@Inject(CryptoService)` (import `CryptoModule`), `type Row = typeof llmProvider.$inferSelect`,
   methods `create/findAll|findOne/update/remove` + `requireRow` (404) + `toContract`
   (`llmProviderSchema.parse` with `hasApiKey`) + an internal `getDecryptedApiKey()` (for S-04, not for
   the controller).
10. `llm-provider/llm-provider.controller.ts` — `@Controller('llm-providers')`, 5 REST methods with
    `ZodValidationPipe`, `@Delete` + `@HttpCode(NO_CONTENT)`.
11. `llm-provider/llm-provider.module.ts` — `@Module` + `implements NestModule` with
    `consumer.apply(json()).forRoutes(LlmProviderController)` (**mandatory** — `bodyParser` off),
    `imports: [CryptoModule]`.
12. (optional) `llm-provider/llm-provider.errors.ts`.
13. Register `LlmProviderModule` in `app.module.ts`.
14. `.spec.ts` for the controller and the service (remember the explicit `@Inject` in tests — esbuild lesson).

*Web (`apps/web/src/app/`):*
15. `core/clients/llm-providers.client.ts` — parse through `llmProviderSchema`.
16. `core/stores/llm-providers.store.ts` — `signalState` + mutate-then-refetch + `errorMessage`.
17. `features/llm-providers/llm-providers.component.ts` (+ `.html`) — OnPush, `app-llm-providers`,
    `providers: [...]`, spartan `Hlm*`.
18. `features/llm-providers/llm-provider-form.dialog.ts` (+ `.html`) — `injectBrnDialogContext`,
    `schemaValidator(...)`.
19. A lazy route in `app.routes.ts` + `authGuard`.
20. `.spec.ts` for the client and the store.

*Reuse (touch, do not recreate):* `common/zod-validation.pipe.ts`, `@Global DatabaseModule`,
`CryptoModule`/`CryptoService`, the global `AllExceptionsFilter`/`apiErrorSchema`,
`core/validators/schema.validator.ts`.

**Applicable lessons (`context/foundation/lessons.md`):**
- Always an explicit `@Inject(Class)` token (esbuild loses `design:paramtypes` in Vitest tests).
- Tunables via `@nestjs/config` + Joi (if there were non-secret LLM defaults).
- Timestamps `z.iso.datetime()` on the wire; the Date↔ISO conversion at the client boundary.
- Windows: `npx nx reset` before `git mv` of a folder if the Nx daemon locks it.

## Historical Context (from prior changes)

- `context/archive/2026-06-09-encrypted-credential-store/` — the F-03 foundation. Scope: only the crypto
  + storage layer (research.md:24-30), **no** HTTP for credentials, **no** rotation, **no** per-record
  KDF. Decisions (research.md:32-36, 312-322): a master key from env/Joi, AES-256-GCM, base64/44,
  separate `iv`/`authTag`/`ciphertext` columns, `keyVersion` for the future. The secret-omission
  convention (research.md:200-217): `$inferSelect` forbidden in shared; the service projects only safe
  fields; `z.strictObject` throws on a leak. Impl-review (reviews/impl-review.md:8-9): APPROVED, 0
  critical; F1 required the first consumer (SSH) to wrap the decrypt error in a domain error — done in
  `ssh.executor.ts:95-101`.
- `context/archive/2026-06-09-manage-devices/` — the flat CRUD domain pattern (the template for
  `llm-provider`).
- `context/archive/2026-06-10-scan-and-add-services/` — the nested-resource variant + SSH executor
  integration (less of a fit; the LLM provider is flat).
- `context/archive/2026-05-31-data-persistence-scaffold/` — the Drizzle/SQLite + migrations foundation.
- `context/archive/2026-06-07-account-auth-foundation/` — F-02 (an S-03 prerequisite), authGuard,
  the authConfig namespace.

## Roadmap / PRD anchors

- `context/foundation/roadmap.md:151-161` — S-03 outcome: "custom endpoint + credentials without a
  redeploy"; risk: "Provider credentials are a secret - store them via the F-03 contract"; parallel
  with S-01/S-02, prerequisite F-02.
- `context/foundation/prd.md:102-103` — FR-012 must-have: "swapping the provider (including a local
  one) without a redeploy matters to a homelabber controlling cost".
- `context/foundation/prd.md:129` + `roadmap.md:265-267` — load-bearing Non-Goals: no free-form
  chat, no user-defined output schemas (shapes the whole agent layer, but not this slice).
- `.claude/rules/vercel-ai-sdk.md` — the agent server-side in apps/api, `generateObject`/`generateText`,
  no free-form chat.

## Open Questions

1. **Provider cardinality:** single-row (one provider per install, upsert/PUT) vs a list of many with
   one `active`? FR-012/roadmap do not pin it. → decision in `/10x-plan`.
2. **"Works" validation:** should create/update do a test-call to the endpoint (e.g. list models) to
   detect a bad key/URL immediately, or save blindly? (Affects UX and whether a lightweight HTTP client
   is needed already in S-03, or only in S-04.)
3. **Non-secret LLM defaults:** are there any tunables (LLM request timeout, token limit) that should go
   into a new `registerAs('llm', ...)` namespace? If not — the config layer is not touched in this slice.
4. **Model selection:** a free string `model` vs a list fetched from the provider endpoint? A free string
   is minimal and sufficient for the MVP/OpenAI-compatible.

## Related Research

- No prior `research.md` documents for this change (this is the first).
- Related historical: `context/archive/2026-06-09-encrypted-credential-store/research.md`
  (the encryption channel), `context/archive/2026-06-09-manage-devices/` (the feature pattern).

## Next Step

`/10x-frame` (resolving cardinality + validation scope) or directly `/10x-plan`
configure-llm-provider, using the file checklist and the proposed contract above.
