# Configure LLM Provider (S-03 / FR-012) Implementation Plan

## Overview

Build the `configure-llm-provider` feature: the user configures their own LLM provider
endpoints + API keys **without a redeploy** (FR-012). The resource model is a **list** of
many providers with exactly **one active**. Every write (create/update) is validated with a
**live test-call** to the provider endpoint — the first outbound HTTP in the api. The API key
travels the existing crypto channel (`CryptoService`) into a **dedicated** `llm_provider` table
and never comes back in a response (secret-omission).

The plan is built around **two net-new mechanisms** (the single-active invariant via a
transaction; the outbound test-call), not around CRUD scaffolding — CRUD/contract/secret/UI
reuse the ready `devices` template + the `credential` secret-omission pattern.

## Current State Analysis

From research (`research.md`) and frame (`frame.md`), verified directly in the code:

- **The crypto channel is generic and reusable 1:1.** `CryptoService.encrypt()` returns
  `{ authTag, ciphertext, iv }` base64 (`crypto.service.ts:36-47`), exported by `CryptoModule`,
  with zero domain coupling. The LLM key travels the same `ENCRYPTION_KEY` — no new env var needed.
- **The `credential` table is SSH-coupled** (required `deviceId` FK, `username`, `authType` enum —
  `device.schema.ts:19-46`), so the provider key cannot be forced in there. The secret-safe pattern
  (`CredentialService`: `encrypt` on input, `toContract` projects safe fields, `getDecryptedSecret`
  internal-only — `credential.service.ts:22-100`) is, however, the template to copy.
- **The flat-CRUD pattern is mature** (`DeviceService`/`DeviceController`/`DeviceModule`): the
  service holds Drizzle queries directly (no repository), `randomUUID()` for id, `requireRow` throws
  an entity-naming 404, `toContract` parses through the shared schema (`device.service.ts:9-71`).
  The module **must re-apply `json()` middleware** (`device.module.ts:16-20`) — `main.ts` runs with
  `bodyParser: false`.
- **The "one active" invariant has NO template in the repo** — no active/default columns, zero
  `.transaction(` in `apps/api/src`, no partial-unique-index. The transaction primitive
  (better-sqlite3 + drizzle) is available, unused.
- **Outbound HTTP has NO precedent** — no axios/undici/@nestjs/axios/ai/@ai-sdk in `package.json`;
  the only outbound is SSH. Node 24 → global `fetch` (no new dependency). The error-wrapping pattern
  (`executor.errors.ts`: each domain error extends a distinct `HttpException` so the global filter
  yields a legible status) and the timeout pattern (`AbortSignal.timeout`) are ready to mirror.
- **Config is `@nestjs/config` + Joi** with `registerAs(...)` namespaces (`ssh.config.ts`,
  `env.schema.ts:19-42`); numerics coerced with `Number(...)`. That is the home for a non-secret
  test-call timeout tunable.
- **The shared contract is Zod v4**, three schemas per domain, `z.strictObject` for secret-omission
  (`credential.schema.ts:12-19`), a shared `isoTimestamp` preprocess.
- **The Vercel AI SDK is greenfield** — S-03 does not install the SDK; the contract only carries the
  fields S-04 will pass to the client factory (`createOpenAICompatible`).

## Desired End State

When the plan is complete:

- An `llm_provider` table exists (migration `0003_*`) with non-secret columns
  (`kind`/`base_url`/`model`/`active`) and secret columns (`iv`/`ciphertext`/`auth_tag`/`key_version`).
- `GET /api/llm-providers` returns the list of providers; each carries `active: boolean` and
  `hasApiKey: boolean`, **never** the raw key.
- `POST /api/llm-providers` and `PATCH /api/llm-providers/:id` validate the provider with a
  test-call GET `{baseURL}/models` **before** persisting — on a bad key/URL/timeout they return a
  domain error (502/503/504) and **do not** persist a row.
- `PATCH /api/llm-providers/:id/activate` atomically makes the chosen provider the only active one
  (set-active-unset-others transaction). The first created provider is active automatically;
  deleting the active one leaves zero active.
- `DELETE /api/llm-providers/:id` removes a provider (204).
- Web: route `/llm-providers` (lazy, `authGuard`) with a list, a create/edit form (dialog), an
  active toggle and delete — the `signalState` + mutate-then-refetch store pattern.
- A non-secret tunable `LLM_TEST_TIMEOUT_MS` (Joi, default 5000) via a new `registerAs('llm', ...)`.

### Key Discoveries:

- Secret-safe service template: `credential.service.ts:22-100` (encrypt → insert → toContract;
  `getDecryptedSecret` internal).
- Flat-CRUD + `json()` middleware template: `device.service.ts:9-71`, `device.module.ts:16-20`.
- Domain-error taxonomy via distinct `HttpException`s: `executor.errors.ts:1-43` (deliberately
  **not** 401, to avoid tripping the web session-expiry interceptor — `better-auth.md`).
- Tunable timeout pattern: `ssh.config.ts:6-9` + `env.schema.ts:37-39` (`Number(...)`, Joi `.min().default()`).
- Secret-omission `z.strictObject` + `isoTimestamp` preprocess: `credential.schema.ts:6,12-19`.
- Secret column shape (template for `llm_provider`): `device.schema.ts:22-38`.
- Schema barrel (drizzle-kit target): `database/schema/index.ts`; contract barrel:
  `libs/shared/src/index.ts` (alphabetical).

## What We're NOT Doing

- **Not installing** `ai`/`@ai-sdk/*` and not building the LLM client/agent — that is S-04.
  The test-call is a raw `fetch`, not the SDK.
- **Not generalizing** the `credential` table (research Path B) — a dedicated `llm_provider`.
- **Not using** a partial-unique-index or DB-level double-guard — the single-active invariant is
  app-enforced via a transaction (planning decision).
- **Not auto-promoting** a new active after deleting the active one — deleting the active provider
  leaves zero active (the user activates manually).
- **Not testing** real inference (chat/completion) — the test-call is a lightweight GET `/models`.
- **Not configuring** the provider through `.env` — that would break FR-012 "without a redeploy".
- No free-form chat / user-defined output schemas (PRD Non-Goals — outside this slice anyway).

## Implementation Approach

Four phases, in dependency order (each independently verifiable):

1. **Shared contract** — the Zod foundation both layers consume.
2. **API persistence + single-active** — table, migration, CRUD service + activation transaction +
   auto-active-first, controller, module. **No** test-call yet (writes persist) — the single-active
   mechanism is verified in isolation.
3. **API test-call** — `llmConfig` namespace, probe `fetch` GET `/models`, domain errors, wired into
   create/update with reject-on-fail. The first outbound HTTP in isolation.
4. **Web feature** — client → store → component + dialog + route.

## Critical Implementation Details

- **Ordering in `create`/`update`: the test-call comes BEFORE the DB mutation.** Reject-on-fail
  means the probe must throw before a row is created/changed — otherwise an unvalidated provider is
  left in the database. In `update` without `apiKey` in the payload, the probe tests the **stored**
  key (decrypted internally), against the effective `baseURL`/`model` after merging the patch with
  the row state.
- **The activation transaction must clear the old active before/together with setting the new one**
  inside a single `db.transaction(...)`; with the app-enforced invariant the order does not cause a
  constraint violation (no partial-index), but the transaction guarantees atomicity ("never zero or
  two active mid-flight").
- **Test-call domain errors must NOT be 401** — the web has an interceptor that clears the session
  on 401 (`better-auth.md`); a bad-key maps to 502 (`BadGatewayException`), like `SshAuthError`.
- **`bodyParser: false` in `main.ts`** — `LlmProviderModule` must `consumer.apply(json()).forRoutes(...)`;
  skipping it = empty `@Body` with no error (easy to miss).
- **Explicit `@Inject(Class)`** for every service dependency (esbuild loses `design:paramtypes` in
  Vitest tests — `lessons.md`).

## Phase 1: Shared contract

### Overview

Define the three provider Zod schemas in `@opspilot/shared` (response + create-request +
update-request) with tests and exports. This is the single contract source for api and web.

### Changes Required:

#### 1. Response schema (entity)

**File**: `libs/shared/src/lib/schemas/llm-provider.schema.ts`

**Intent**: The safe provider shape the rest of the app sees — no raw key, with the derived flags
`active` and `hasApiKey`. Template: `credential.schema.ts` (secret-omission).

**Contract**: `export const llmProviderSchema = z.strictObject({ ... })` + `export type LlmProvider`.
Fields: `active: z.boolean()`, `baseURL: z.url()`, `createdAt: isoTimestamp`, `hasApiKey: z.boolean()`,
`id: z.string()`, `kind: z.enum(['openai-compatible'])`, `model: z.string()`, `updatedAt: isoTimestamp`.
`z.strictObject` is load-bearing — it rejects any secret-field leak at parse. Copy `isoTimestamp` as
the shared preprocess (identical block to `credential.schema.ts:6`).

#### 2. Create-request schema

**File**: `libs/shared/src/lib/schemas/llm-provider-create-request.schema.ts`

**Intent**: The only place the plaintext key enters the system. Never reused as a response.
Template: `credential-create-request.schema.ts`.

**Contract**: `z.strictObject({ apiKey, baseURL, kind, model })` + type. `apiKey: z.string().min(1, { error })`
(SECRET), `baseURL: z.url({ error })`, `kind: z.enum(['openai-compatible']).default('openai-compatible')`,
`model: z.string().min(1, { error })`. **`active` does NOT enter here** — auto-active-first is computed by
the service, change happens via a separate activate endpoint.

#### 3. Update-request schema

**File**: `libs/shared/src/lib/schemas/llm-provider-update-request.schema.ts`

**Intent**: Partial patch; a present `apiKey` = key rotation, absent = keep the stored one.
Template: `device-update-request.schema.ts` (the `partial().refine(len>0)` idiom).

**Contract**: `llmProviderCreateRequestSchema.partial().refine((v) => Object.keys(v).length > 0, { error })`
+ type. All fields optional; `apiKey` optional.

#### 4. Specs + barrel

**File**: `*.spec.ts` co-located next to each of the 3 schemas; `libs/shared/src/index.ts`

**Intent**: Tests asserting secret-omission (the response rejects key/ciphertext via `strictObject`)
and create/update validation. Export through the barrel.

**Contract**: 3× `export *` in `index.ts` in alphabetical order (between the existing `device-*` and
the rest). The response spec **must** include a "parse throws when `apiKey`/`ciphertext` supplied" test
(template: `credential.schema.spec.ts:47-73`).

### Success Criteria:

#### Automated Verification:

- [ ] Shared tests pass: `npx nx test shared`
- [ ] Shared lint clean: `npx nx lint shared`
- [ ] Shared build (`z.infer` types): `npx nx build shared`
- [ ] Format: `npm run format:check`

#### Manual Verification:

- [ ] `strictObject` actually rejects a secret leak (the spec proves it, not just the happy path)
- [ ] `kind` has a sensible default and is extensible (adding `'anthropic'` later does not break the contract)

---

## Phase 2: API — persistence + single-active invariant

### Overview

The `llm_provider` table + migration, a service copying the secret-safe pattern, the activation
transaction (set-active-unset-others), auto-active for the first row, a REST controller + the
activate endpoint, a module with `json()` middleware, registration in `app.module`. **No test-call
yet** — create/update persists without endpoint validation (added in Phase 3).

### Changes Required:

#### 1. DB table

**File**: `apps/api/src/database/schema/llm-provider.schema.ts` + `export *` in `database/schema/index.ts`

**Intent**: A flat provider table with secret columns (`credential` template) + non-secret metadata +
the `active` flag. Index on `active` (column used in the activation `where` and the future find-active
for S-04).

**Contract**: `sqliteTable('llm_provider', { ... }, (t) => [index('llm_provider_active_idx').on(t.active)])`.
Columns: `active: integer('active', { mode: 'boolean' }).notNull().default(false)`, `authTag`/`ciphertext`/`iv`
(`text().notNull()`), `keyVersion: integer('key_version').default(1).notNull()`, `baseURL: text('base_url').notNull()`,
`createdAt`/`updatedAt` (`timestamp_ms`, `unixepoch` default, `updatedAt` with `.$onUpdate(() => new Date())`),
`id: text('id').primaryKey()`, `kind: text('kind').notNull()`, `model: text('model').notNull()`. No
`relations(...)` (FK-less resource).

#### 2. Migration

**File**: `apps/api/migrations/0003_*.sql` + `meta/` snapshot

**Intent**: Generate the migration from the new schema — **do not hand-write SQL**.

**Contract**: `npx drizzle-kit generate --config=apps/api/drizzle.config.ts` (next number `0003`).
The migration is applied at boot by `migration/migration.service.ts`.

#### 3. Service

**File**: `apps/api/src/llm-provider/llm-provider.service.ts`

**Intent**: CRUD + activation copying the `DeviceService`/`CredentialService` pattern. Encrypts the key
on input, projects only safe fields in `toContract`, holds an internal `getDecryptedApiKey` for the
future consumer (S-04). The single-active invariant is maintained by a transaction.

**Contract**: `@Inject(DATABASE_CONNECTION) db` + `@Inject(CryptoService) crypto`, `type Row = typeof llmProvider.$inferSelect`.
Methods:
- `create(input: LlmProviderCreateRequest): Promise<LlmProvider>` — `active = (existing row count === 0)`;
  `crypto.encrypt(input.apiKey)`; insert explicit columns; `toContract`. (The test-call lands here in
  Phase 3, **before** encrypt/insert.)
- `findAll(): Promise<LlmProvider[]>`, `findOne(id): Promise<LlmProvider>`.
- `update(id, input): Promise<LlmProvider>` — `requireRow`; re-encrypt only when `input.apiKey` is present;
  explicit columns in `.set()` (never spread the DTO; drizzle ignores `undefined`).
- `activate(id): Promise<LlmProvider>` — `requireRow`; transaction:
  ```ts
  // app-enforced single-active invariant: unset all, set one, atomically.
  this.db.transaction((tx) => {
    tx.update(llmProvider).set({ active: false }).run();
    tx.update(llmProvider).set({ active: true }).where(eq(llmProvider.id, id)).run();
  });
  ```
- `remove(id): Promise<void>` — `requireRow`; delete (deleting the active one leaves zero active — no promotion).
- `getDecryptedApiKey(id): Promise<string>` — internal accessor, "must never be wired to a controller"
  (template `getDecryptedSecret`).
- `requireRow(id)` — entity-naming 404 (`` `llm provider ${id} not found` ``).
- `toContract(row)` — `llmProviderSchema.parse({ active: row.active, baseURL: row.baseURL, createdAt, hasApiKey: row.ciphertext.length > 0, id, kind, model, updatedAt })`.

#### 4. Controller

**File**: `apps/api/src/llm-provider/llm-provider.controller.ts`

**Intent**: A thin REST controller, 5 CRUD methods + the activate endpoint. `@Body` validation via
`ZodValidationPipe`. Template: `device.controller.ts`.

**Contract**: `@Controller('llm-providers')`, `@Inject(LlmProviderService)`. `create` (POST,
`new ZodValidationPipe(llmProviderCreateRequestSchema)`), `findAll` (GET), `findOne` (GET `:id`),
`update` (PATCH `:id`, `llmProviderUpdateRequestSchema`), `activate` (PATCH `:id/activate`, no body),
`remove` (DELETE `:id`, `@HttpCode(NO_CONTENT)`).

#### 5. Module + registration

**File**: `apps/api/src/llm-provider/llm-provider.module.ts` + edit `apps/api/src/app.module.ts`

**Intent**: A feature module with the mandatory `json()` middleware (because `bodyParser: false`) and a
`CryptoModule` import. Export the service (for S-04). Register in `app.module` imports.

**Contract**: `@Module({ controllers: [LlmProviderController], exports: [LlmProviderService], imports: [CryptoModule], providers: [LlmProviderService] })`
+ `implements NestModule` with `configure(c) { c.apply(json()).forRoutes(LlmProviderController); }`. Add
`LlmProviderModule` to `app.module.ts` imports.

#### 6. Tests

**File**: `apps/api/src/llm-provider/llm-provider.service.spec.ts` + `*.controller.spec.ts`

**Intent**: Cover the single-active invariant (after `activate(B)` only B is active; after the first
`create` it is active, the second is not; after `remove` of the active one zero active), secret-omission
(`toContract` returns no key, `hasApiKey: true`), entity-naming 404.

**Contract**: Explicit `@Inject` in test setup (esbuild lesson). Invariant assertion: after two
`create` + `activate` the second, `findAll().filter(p => p.active).length === 1`.

### Success Criteria:

#### Automated Verification:

- [ ] API tests pass: `npx nx test api`
- [ ] API lint clean: `npx nx lint api`
- [ ] API build (webpack): `npx nx build api`
- [ ] Migration `0003_*.sql` generated and present in `apps/api/migrations/`

#### Manual Verification:

- [ ] `POST` two providers → first `active: true`, second `active: false`
- [ ] `PATCH :id/activate` on the second → first `active: false`, second `active: true` (exactly one active)
- [ ] `DELETE` the active one → `findAll` shows zero active, no error
- [ ] Migration applies cleanly at boot (`npm run start:api`, no migration error)
- [ ] The response never contains `apiKey`/`ciphertext`; `hasApiKey: true` after creation

---

## Phase 3: API — test-call mechanism

### Overview

Add provider validation via a live test-call GET `{baseURL}/models` on create/update with
**reject-on-fail**. Introduces a new `registerAs('llm', ...)` namespace (timeout), a probe built on
global `fetch` + `AbortSignal.timeout`, and a domain-error taxonomy à la `executor.errors.ts`.

### Changes Required:

#### 1. Config namespace + env

**File**: `apps/api/src/config/llm.config.ts`, edits to `apps/api/src/config/env.schema.ts` and `config.module.ts`

**Intent**: A non-secret test-call timeout tunable through the config layer (tunables lesson — not a
magic-number in the service). Template: `ssh.config.ts`.

**Contract**: `export const llmConfig = registerAs('llm', () => ({ testTimeoutMs: Number(process.env.LLM_TEST_TIMEOUT_MS) }))`
+ `export type LlmConfig = ConfigType<typeof llmConfig>`. In `env.schema.ts`: add `LLM_TEST_TIMEOUT_MS: number`
to `EnvConfig` and `LLM_TEST_TIMEOUT_MS: Joi.number().integer().min(1000).default(5000)` to `envSchema`.
In `config.module.ts`: add `llmConfig` to the `load` array.

#### 2. Domain errors

**File**: `apps/api/src/llm-provider/llm-provider.errors.ts`

**Intent**: Legible test-call errors, each extending a distinct `HttpException` so the global filter
yields the right status — **never 401** (web session interceptor). Template: `executor.errors.ts`.

**Contract**: `LlmProviderUnreachableError extends ServiceUnavailableException` (503, network/refused),
`LlmProviderAuthError extends BadGatewayException` (502, provider returned 401/403 = bad key),
`LlmProviderTimeoutError extends GatewayTimeoutException` (504, `AbortSignal.timeout` fired). Messages
name the `baseURL`.

#### 3. Probe (test-call)

**File**: `apps/api/src/llm-provider/llm-provider.probe.ts`

**Intent**: A single responsibility — perform a lightweight GET `{baseURL}/models` with `Authorization: Bearer`,
map the result to success or a domain error. The first outbound HTTP in the api.

**Contract**: `@Injectable`, `@Inject(llmConfig.KEY) config`. Method
`async verify(baseURL: string, apiKey: string): Promise<void>`:
```ts
// first outbound http in api: lightweight openai-compatible reachability + auth probe.
// strips trailing slash so `${baseURL}/models` doesn't double up.
const url = `${baseURL.replace(/\/$/, '')}/models`;
let res: Response;
try {
  res = await fetch(url, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(this.config.testTimeoutMs),
  });
} catch (e) {
  // name === 'TimeoutError' when AbortSignal.timeout fires
  throw (e as Error)?.name === 'TimeoutError'
    ? new LlmProviderTimeoutError(baseURL)
    : new LlmProviderUnreachableError(baseURL);
}
if (res.status === 401 || res.status === 403) throw new LlmProviderAuthError(baseURL);
if (!res.ok) throw new LlmProviderUnreachableError(baseURL);
```

#### 4. Wiring into the service

**File**: `apps/api/src/llm-provider/llm-provider.service.ts` (edit) + `llm-provider.module.ts` (add `LlmProviderProbe` to providers)

**Intent**: Call the probe **before** the DB mutation in create/update (reject-on-fail). In update without
`apiKey`, test the stored key against the effective `baseURL`.

**Contract**: `@Inject(LlmProviderProbe)`. In `create`: `await this.probe.verify(input.baseURL, input.apiKey)`
**before** `encrypt`/insert. In `update`: build the effective `baseURL` (`input.baseURL ?? row.baseURL`) and
effective `apiKey` (`input.apiKey ?? await this.getDecryptedApiKey(id)`), `await this.probe.verify(...)`
**before** `.set()`. The probe throws → the exception propagates, the row is untouched.

#### 5. Tests

**File**: `apps/api/src/llm-provider/llm-provider.probe.spec.ts` + additions to `service.spec.ts`

**Intent**: Cover the fetch→error mapping (mock global `fetch`: 200→ok, 401→AuthError, reject→Unreachable,
TimeoutError→TimeoutError) and reject-on-fail (when the probe throws in create, `findAll` is empty — the row
was not created).

**Contract**: Mock `globalThis.fetch` (vi.fn). Assertion: after a probe-throw in `create`, the `db` has no row.

### Success Criteria:

#### Automated Verification:

- [ ] API tests pass: `npx nx test api`
- [ ] API lint clean: `npx nx lint api`
- [ ] API build: `npx nx build api`
- [ ] Boot with `LLM_TEST_TIMEOUT_MS` (default 5000) does not fail Joi validation

#### Manual Verification:

- [ ] `POST` a valid OpenAI-compatible provider (e.g. a local endpoint or OpenAI) → save succeeds
- [ ] `POST` with a bad key → 502, the row is NOT created (`findAll` without the new entry)
- [ ] `POST` with an unreachable URL → 503, no row
- [ ] `POST` with a URL that hangs the connection → 504 after `LLM_TEST_TIMEOUT_MS`
- [ ] `PATCH` rotating only `model` (no `apiKey`) → the probe uses the stored key, success

---

## Phase 4: Web feature

### Overview

The `client → store → component` layers + a form dialog + a lazy route, copying the `devices`
pattern: the client parses through the shared schema, the store uses `signalState` +
mutate-then-refetch, the component is OnPush with providers at the route level.

### Changes Required:

#### 1. Client

**File**: `apps/web/src/app/core/clients/llm-providers.client.ts`

**Intent**: A thin `HttpClient` wrapper over `/api/llm-providers`, each response parsed through
`llmProviderSchema`. Template: `devices.client.ts`.

**Contract**: `@Injectable()` (NOT `providedIn: 'root'`). Methods `list()`, `get(id)`, `create(body)`,
`update(id, body)`, `activate(id)` (PATCH `:id/activate`, empty body), `remove(id)`. Relative `/api/...`
URLs (session cookie); `.then((row) => llmProviderSchema.parse(row))` on every entity-returning response.

#### 2. Store

**File**: `apps/web/src/app/core/stores/llm-providers.store.ts`

**Intent**: List state via `@ngrx/signals` `signalState`/`patchState` (NOT `signalStore()`),
mutate-then-refetch after every mutation, actions return `{ error: null | string }`. Template: `devices.store.ts`.

**Contract**: `signalState({ providers, error, loading })`, `isEmpty = computed`, actions `load`, `create`,
`update`, `activate`, `remove` (each `await this.load()` on success), an `errorMessage` helper via
`apiErrorSchema.safeParse(error.error)`.

#### 3. Component + dialog

**File**: `apps/web/src/app/features/llm-providers/llm-providers.component.ts` (+ `.html`),
`apps/web/src/app/features/llm-providers/llm-provider-form.dialog.ts` (+ `.html`)

**Intent**: A list of providers with an active indicator + an "activate" button, add/edit/delete actions
through a dialog. The form validates via `schemaValidator(schema.shape.field)`; the `apiKey` field is a
password, in edit mode an empty value = keep the key. Template: `devices.component.ts` + `*-form.dialog.ts`.

**Contract**: `OnPush`, `selector: 'app-llm-providers'`, `providers: [LlmProvidersClient, LlmProvidersStore]`,
spartan `Hlm*`, `void this.store.load()` in the constructor. Dialog: `injectBrnDialogContext` (the store is
injected via context, because the CDK overlay is outside the route injector). Active shown as a badge; the
activate button calls `store.activate(id)`.

#### 4. Route

**File**: `apps/web/src/app/app.routes.ts` (edit)

**Intent**: A lazy route `/llm-providers` with `authGuard`. Template: the existing routes.

**Contract**: `{ path: 'llm-providers', loadComponent: () => import(...).then(m => m.LlmProvidersComponent), canActivate: [authGuard] }`.

#### 5. Tests

**File**: `*.client.spec.ts` + `*.store.spec.ts`

**Intent**: The client parses the response through the schema (rejects a bad shape); the store does
mutate-then-refetch and maps the error.

**Contract**: Mock `HttpClient`; assert that after `create` the store calls `list` again.

### Success Criteria:

#### Automated Verification:

- [ ] Web tests pass: `npx nx test web`
- [ ] Web lint clean: `npx nx lint web`
- [ ] Web build: `npx nx build web`
- [ ] Format: `npm run format:check`

#### Manual Verification:

- [ ] Route `/llm-providers` loads only when logged in (authGuard); the list renders providers
- [ ] Adding a provider via the dialog → it appears on the list with an active badge (if first)
- [ ] Toggling active via the button → the badge jumps to the chosen one, the previous loses active
- [ ] Edit without changing `apiKey` keeps the key (the provider still works); a test-call error is shown in the UI
- [ ] Deleting a provider removes it from the list; deleting the active one does not pick a new one automatically

---

## Testing Strategy

### Unit Tests:

- **Shared**: secret-omission (`strictObject` throws on `apiKey`/`ciphertext` in the response), create
  validation (required `apiKey`/`baseURL`/`model`) and update (`partial` + refine non-empty).
- **API service**: the single-active invariant (auto-active first, `activate` switches atomically,
  `remove` of the active one leaves zero), reject-on-fail (the probe throws → no row), entity-naming 404, `hasApiKey`.
- **API probe**: fetch→domain-error mapping (200/401/403/network/timeout).
- **Web**: the client parses through the schema; the store mutate-then-refetch + `errorMessage`.

### Integration Tests:

- E2E path: create (with a mocked `fetch` 200) → findAll shows active → activate the second →
  the invariant holds → remove → 204.

### Manual Testing Steps:

1. Run `npm start`; log in; go to `/llm-providers`.
2. Add an OpenAI-compatible provider with a valid key → save OK, active badge.
3. Add a second one with a bad key → error in the UI, no entry on the list.
4. Activate the second one (after fixing the key) → exactly one active.
5. Edit `model` without supplying the key → save OK (the stored key is tested).
6. Delete the active one → zero active, no auto-promotion.

## Performance Considerations

- The test-call adds create/update latency equal to the provider's response time (bounded by
  `LLM_TEST_TIMEOUT_MS`, default 5000). Acceptable — this is a configuration action, not a hot path.
- Lists are small (single-user homelab); no pagination required, but an unbounded `findAll` is fine
  for this scale (if it grows — add `.limit()` per `drizzle.md`).

## Migration Notes

- New table, no data migration. Migration `0003_*` applied at boot (`migration.service.ts`).
- No new secret env var — the LLM key travels the existing `ENCRYPTION_KEY`. The only new var is the
  non-secret `LLM_TEST_TIMEOUT_MS` with a default (deploy needs no operator action).

## References

- Frame brief: `context/changes/configure-llm-provider/frame.md`
- Research: `context/changes/configure-llm-provider/research.md`
- Secret-safe pattern: `apps/api/src/credential/credential.service.ts:22-100`
- Flat-CRUD + middleware pattern: `apps/api/src/device/device.service.ts:9-71`, `apps/api/src/device/device.module.ts:16-20`
- Error taxonomy: `apps/api/src/executor/executor.errors.ts:1-43`
- Tunable pattern: `apps/api/src/config/ssh.config.ts:6-9`, `apps/api/src/config/env.schema.ts:37-39`
- Secret-omission contract: `libs/shared/src/lib/schemas/credential.schema.ts:6,12-19`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared contract

#### Automated

- [x] 1.1 Shared tests pass: `npx nx test shared` — e8215f1
- [x] 1.2 Shared lint clean: `npx nx lint shared` — e8215f1
- [x] 1.3 Shared build (`z.infer` types): `npx nx build shared` — e8215f1
- [x] 1.4 Format: `npm run format:check` — e8215f1

#### Manual

- [x] 1.5 `strictObject` rejects a secret leak (spec proves it) — e8215f1
- [x] 1.6 `kind` has a default and is extensible — e8215f1

### Phase 2: API — persistence + single-active invariant

#### Automated

- [x] 2.1 API tests pass: `npx nx test api`
- [x] 2.2 API lint clean: `npx nx lint api`
- [x] 2.3 API build (webpack): `npx nx build api`
- [x] 2.4 Migration `0003_*.sql` generated and present

#### Manual

- [x] 2.5 Two `POST` → first active, second not
- [x] 2.6 `activate` the second → exactly one active
- [x] 2.7 `DELETE` the active one → zero active, no error
- [x] 2.8 Migration applies cleanly at boot
- [x] 2.9 The response never contains the key; `hasApiKey: true`

### Phase 3: API — test-call mechanism

#### Automated

- [ ] 3.1 API tests pass: `npx nx test api`
- [ ] 3.2 API lint clean: `npx nx lint api`
- [ ] 3.3 API build: `npx nx build api`
- [ ] 3.4 Boot with `LLM_TEST_TIMEOUT_MS` does not fail Joi

#### Manual

- [ ] 3.5 `POST` a valid provider → save OK
- [ ] 3.6 `POST` a bad key → 502, no row
- [ ] 3.7 `POST` an unreachable URL → 503, no row
- [ ] 3.8 `POST` a hanging URL → 504 after timeout
- [ ] 3.9 `PATCH` only `model` → the probe uses the stored key

### Phase 4: Web feature

#### Automated

- [ ] 4.1 Web tests pass: `npx nx test web`
- [ ] 4.2 Web lint clean: `npx nx lint web`
- [ ] 4.3 Web build: `npx nx build web`
- [ ] 4.4 Format: `npm run format:check`

#### Manual

- [ ] 4.5 Route `/llm-providers` protected by authGuard, list renders
- [ ] 4.6 Adding a provider → on the list with an active badge
- [ ] 4.7 Toggling active → the badge jumps
- [ ] 4.8 Edit without `apiKey` keeps the key; a test-call error in the UI
- [ ] 4.9 Deleting the active one without auto-promotion
