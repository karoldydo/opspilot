---
date: 2026-06-10T18:30:00+02:00
researcher: Karol Dydo
git_commit: 0f63fe8acaf69e27fbf473ade9525b0407260b15
branch: main
repository: opspilot
topic: "Scan a device's containers over SSH and curate a managed-services subset (S-02)"
tags: [ research, codebase, scan-and-add-services, ssh, node-ssh, executor, services, drizzle, zod ]
status: complete
last_updated: 2026-06-10
last_updated_by: Karol Dydo
---

# Research: Scan and add services (S-02)

**Date**: 2026-06-10T18:30:00+02:00
**Researcher**: Karol Dydo
**Git Commit**: 0f63fe8acaf69e27fbf473ade9525b0407260b15
**Branch**: main
**Repository**: opspilot

## Research Question

Prepare a planning-grade research base for the roadmap slice **S-02 `scan-and-add-services`**: a user scans the docker containers on a device over SSH and curates a managed-services subset (add selected, edit, delete). This is the **first SSH-out operation** in the product and builds the SSH executor every later skill reuses. PRD refs: **FR-004** (scan containers + curate managed set) and **FR-007** (the hidden built-in `scanServices` skill). Prerequisite **S-01 `manage-devices`** is done.

Focus areas (user-selected, full dive): (1) S-01 patterns to replicate, (2) node-ssh integration + executor, (3) the service data model + `scanServices`, (4) historical decisions that bind this change.

## Summary

S-02 is a **vertical slice with three new pieces of architecture, all introduced here for the first time**:

1. **A reusable SSH executor** (`IExecutor` behind a provider, node-ssh-backed, per-device `async-mutex`, per-command timeout, unconditional `dispose()`). This is the load-bearing deliverable — it satisfies the "no skill run hangs indefinitely" NFR and is reused by S-04/S-06/S-08. *Nothing SSH-related exists in the code yet* — S-01 deliberately deferred all connect logic to S-02.
2. **A new `service` domain** (Drizzle table + shared Zod contracts + NestJS module + Angular feature), modeled verbatim on the `device`/`credential` pattern from S-01. A service belongs to a device via a cascade FK.
3. **A scan-vs-managed split**: `POST /devices/:id/scan` returns an *ephemeral* list of all detected containers (with live runtime facts) used only for the curation UI; the user's chosen subset is persisted as stable `service` rows. Curating a subset (not showing all containers) is a deliberate guardrail to limit the agent's reach (PRD FR-004).

`scanServices` should be implemented as a **private backend capability** (a `docker ps` call through the executor), **not** as a persisted "skill" record — the skill-as-data model is S-08's job (~6 slices downstream). "Hidden built-in" is the explicit signal it is hardcoded, not user-CRUD'd.

The credential-decryption seam (`CredentialService.getDecryptedSecret(id)`) is already built and waiting for its first caller — **S-02 is that caller**, and it inherits the deferred obligation to wrap raw `node:crypto` decrypt errors in a domain error.

All the established conventions (contracts-once-in-shared, `z.strictObject` + `isoTimestamp`, explicit `@Inject(Class)` DI, config-layer tunables, global exception filter, mutate-then-refetch signal stores, schema-validated client responses, spartan helm UI) apply directly and are documented below with file:line anchors.

## Detailed Findings

### Area 1 — S-01 (manage-devices) patterns to replicate

**Shared contracts** (`libs/shared/src`): one schema per kebab-case `*.schema.ts` file with role suffix, `z.infer` type alongside, re-exported via `export *` from `libs/shared/src/index.ts`.

- Domain/read shape uses **`z.strictObject`** (closed — rejects any leaked secret column) — `libs/shared/src/lib/schemas/device.schema.ts:11-19`.
- Timestamps use a shared `isoTimestamp = z.preprocess((v) => v instanceof Date ? v.toISOString() : v, z.iso.datetime())` helper that normalizes both Drizzle `Date` rows and wire ISO strings — `device.schema.ts:6`, duplicated in `credential.schema.ts:6`.
- Create request captures **identity only**; secret material lives on a separate sub-resource — `device-create-request.schema.ts:6-9`.
- Update = create `.partial().refine(len>0)` — `device-update-request.schema.ts:7-9`.
- List query: `z.coerce.number().int().min().max(100)` ceiling in the schema, **default page size from config, not schema** — `credential-list-query.schema.ts:7-10`.
- Error envelope `{ message, status, timestamp }` — `api-error.schema.ts:5-9`.
- Zod v4 idioms only: `z.uuid()`, `z.iso.datetime()`, `z.enum([...])`, custom messages via `{ error: '...' }`.

**Drizzle schema** (`apps/api/src/database/schema/*.schema.ts`, barrelled by `index.ts`):

- `id: text('id').primaryKey()` filled app-side via `randomUUID()` (not autoincrement).
- Timestamps: `integer('created_at', { mode: 'timestamp_ms' })` with `sql\`(cast(unixepoch('subsecond') * 1000 as integer))\`` default; `updated_at` adds `.$onUpdate(() => new Date())` — `device.schema.ts:4-15`.
- FK style: `text('device_id').notNull().references(() => device.id, { onDelete: 'cascade' })` + `index('credential_deviceId_idx').on(table.deviceId)` + a `relations()` block — `device.schema.ts:29-55`.
- Secrets are split columns `ciphertext`/`iv`/`authTag`/`keyVersion`, never in the contract — `device.schema.ts:17-44`.
- Migrations: drizzle-kit generate against the schema barrel; **applied at boot** by `migration.service.ts` (`OnApplicationBootstrap`), with a backup gate when migrations are pending — `apps/api/src/database/migration/migration.service.ts:32-55`. Single app-scoped connection provider `DATABASE_CONNECTION`, WAL + `foreign_keys = ON` — `apps/api/src/database/providers/database-connection.provider.ts:17-33`.

**NestJS backend** (`apps/api/src/device/`):

- Thin `@Controller('devices')`; Zod validation at the boundary via `@Body(new ZodValidationPipe(schema))` — `device.controller.ts:17-20`; pipe at `common/zod-validation.pipe.ts`.
- The module re-applies `json()` body parser in `NestModule.configure()` because the global parser is disabled in `main.ts` for Better Auth's raw-body catch-all — **every domain module must do this** — `device.module.ts:14-19`.
- Service holds all logic: `@Inject(DATABASE_CONNECTION)`, local `type DeviceRow = typeof device.$inferSelect` (never leaked to shared), `randomUUID()` ids, synchronous better-sqlite3 (`.returning().get()`), `requireRow(id)` → `NotFoundException(\`device ${id} not found\`)`, and a `toContract(row)` that **projects explicit safe fields and runs `schema.parse()`** (the leak/normalize boundary) — `device.service.ts:9-71`.
- Nested sub-resource controller `@Controller('devices/:deviceId/credentials')` treats the path param as source of truth and applies the config default page size — `device/credential/device-credential.controller.ts:39,52`.
- **Every constructor dep uses an explicit `@Inject(Class)` token** — `device.controller.ts:15`, `device.service.ts:13` (see Lesson, Area 4).
- One global `AllExceptionsFilter` (`@Catch()`, `APP_FILTER`) shapes every error to `apiErrorSchema` — `common/all-exceptions.filter.ts`, `app/app.module.ts:21`.

**Crypto reuse**: `CredentialService.getDecryptedSecret(id)` is a service-only plaintext accessor (never wired to a controller) — `apps/api/src/credential/credential.service.ts:48-51`. `CryptoService.decrypt()` (AES-256-GCM, key from `@Inject(cryptoConfig.KEY)`, base64 32-byte assertion at construction) — `apps/api/src/crypto/crypto.service.ts:16-34`. Import `CryptoModule`/`CredentialModule`; do not re-implement crypto.

**Angular frontend** (`apps/web/src/app/features/devices/` + `core/`):

- Lazy `loadComponent` route guarded by `authGuard` — `app.routes.ts:15-20`.
- Store via `@ngrx/signals`: `@Injectable()` **without** `providedIn: 'root'` (provided at the feature component), `signalState` + `patchState`, `computed()` selectors, mutate-then-refetch returning `{ error: null | string }`, multi-call orchestration with rollback in the store — `core/stores/devices.store.ts:33-128`.
- Client validates **every** response against the shared schema at the boundary: `http.post<unknown>(...)` then `deviceSchema.parse(row)` / `.array().parse(rows)` — `core/clients/devices.client.ts:29,39`.
- Component is `OnPush`, `providers: [DevicesClient, DevicesStore]`, opens dialogs and reads signals only — `features/devices/devices.component.ts:22-23`. Dialog gets the store via dialog **context**, not DI, because the CDK overlay renders outside the route injector.
- Forms validate against the shared schema via `schemaValidator(deviceCreateRequestSchema.shape.host)` — `features/devices/device-form.dialog.ts:56-59`; bridge at `core/validators/schema.validator.ts`. UI is spartan helm primitives, templates in separate `.html` files.

**Config** (the binding rule, see Lesson): a new tunable flows `env.schema.ts` (Joi typed+bounded+defaulted) → `registerAs('<ns>', () => ({...}))` with `Number(...)` coercion → injected `@Inject(<x>Config.KEY)`, and added to any `.overrideProvider(...).useValue(...)` in specs — `config/env.schema.ts:26`, `config/device.config.ts:6-8`, `config/config.module.ts:12-16`.

### Area 2 — node-ssh integration + SSH executor

**Nothing SSH-related exists yet.** No `node-ssh`/`ssh2`/`async-mutex` in `package.json`; zero `NodeSSH`/`execCommand`/`AbortController`/`Promise.race`/`setTimeout` matches in `apps/api/src`. S-01 explicitly cut connect logic — `context/archive/2026-06-09-manage-devices/plan.md:82` ("No node-ssh / connection testing — credentials are stored, never used to connect yet"). **S-02 builds the executor from scratch.**

**Two distinct SSH stories — do not conflate**:

- `.claude/rules/ssh.md` is **OPS-ONLY**: the MCP SSH tools (`mcp__ssh-synology__*`) used by the agent to inspect the remote NAS host. Not a model for the product. Useful hint only: Synology non-interactive sessions lack docker on PATH (`ssh.md:8`) → prefix `export PATH="/volume1/@appstore/ContainerManager/usr/bin:$PATH"`. This is a real-world signal that `docker` may not be on a target device's default PATH.
- `.claude/rules/node-ssh.md` is the **binding rule for the app's own SSH-out** (`paths: apps/api/**/*.ts`):
  - "Remote commands run over node-ssh **behind an executor abstraction**, with **async-mutex** enforcing per-device isolation. This is in `apps/api` only — never in `@opspilot/shared` (it is I/O)." (node-ssh.md:7-9)
  - Define an `IExecutor` interface (`connect`, `disconnect`, `execute`); skills depend on the interface, not node-ssh — so transport can be faked in tests. (node-ssh.md:13-15)
  - Serialize per device with `Map<deviceId, Mutex>` + `mutex.runExclusive(...)`. (node-ssh.md:19-21)
  - "Give every command a timeout and dispose the connection after use — no run hangs indefinitely." (node-ssh.md:25)
  - Reinforced by `nestjs.md:40,57` and `vercel-ai-sdk.md:21`.

**Credential decryption seam (ready, untested by a real caller)**: the executor injects `CredentialService`, resolves the device's credential (`CredentialService.list(deviceId)` — `credential.service.ts:53-62`), calls `getDecryptedSecret(credentialId)` (`credential.service.ts:48-51`), and combines plaintext with `credential.username` + `credential.authType` (`z.enum(['password','key'])`) + `device.host`. **Note**: `getDecryptedSecret` takes a *credential id*, not a device id — S-02 must resolve the right credential for a device. **Deferred obligation now due**: wrap raw `node:crypto` "unable to authenticate data" errors in a domain error — `context/archive/2026-06-09-encrypted-credential-store/reviews/impl-review.md:51-52` explicitly punts this "to the node-ssh integration change."

**Timeout + config**: no timeout pattern exists. Recommended: `readyTimeout` for connect (node-ssh option) and `Promise.race([ssh.execCommand(cmd), rejectAfter(timeoutMs)])` (clear timer in `finally`) for the per-command timeout, since node-ssh has no built-in per-command timeout. Add a new `apps/api/src/config/ssh.config.ts` (`registerAs('ssh', () => ({ commandTimeoutMs: Number(process.env.SSH_COMMAND_TIMEOUT_MS), connectTimeoutMs: ... }))`), declare `SSH_COMMAND_TIMEOUT_MS` in `env.schema.ts` (`.integer().min().default(30000)` per the 30s design default), and add the factory to `config.module.ts:14`'s `load: [...]`.

**Docker output parsing**: none exists. Recommend `docker ps --format '{{json .}}' --no-trunc` → NDJSON (one JSON object per line; split on newlines, `JSON.parse` each non-empty line — robust against spaces in names that break column parsing). Useful fields: `.ID`, `.Names`, `.Image`, `.State`, `.Status`, `.Ports`, `.Labels` (compose project/service live in `.Labels`). Validate each parsed line against a shared Zod schema. Distinguish exit codes: "docker not found / not on PATH" vs "daemon down" vs connect/auth failure vs command timeout.

### Area 3 — service data model + `scanServices`

**Existing domain model** (confirmed exhaustive): only `user`/`session`/`account`/`verification` (Better Auth, `auth.schema.ts`) + `device` (`device.schema.ts:4`) + `credential` (`device.schema.ts:17`). Shared contracts at `index.ts:1-11`. **No services/skills/containers table or contract exists anywhere** — S-02 introduces the services domain.

**Relation modeling**: a `service` belongs to a `device` via the exact device↔credential template — `text('device_id').notNull().references(() => device.id, { onDelete: 'cascade' })` + `service_deviceId_idx` + a `relations()` block. Add a `(deviceId, containerName)` unique guard to prevent adding the same container twice. Device-scoped child access yields 404 across parents (mirror `credential.service.ts:67-77`).

**`scanServices`: implement as a private backend capability, NOT a persisted skill record.** Rationale:

- The skill-as-data model (a `skill` table, per-device scope, parameterized commands, agent tool-filtering) is the deliverable of **S-08 custom-skill-crud** (prereq S-06, itself post-S-04). Building it in S-02 front-runs S-08 by ~6 slices, before S-04/S-06 reveal what tool-calling needs.
- PRD/shape-notes call `scanServices` "hidden" and "built-in" (FR-007; shape-notes:111) — the explicit signal it is hardcoded, never in the FR-006 user skill list, never per-device-scoped by a user.
- No `ai`/`@ai-sdk` dependency installed; AI-SDK tool-calling lands in S-04, not here.
- S-02's real deliverable is the SSH plumbing (executor + mutex + timeout + dispose), not a skill registry. Keep `scanServices` as a private service method named after the action.

**Minimal `service` record fields** (each tied to a downstream consumer):

| Field                     | Type                    | Justified by                                                                                                        |
|---------------------------|-------------------------|---------------------------------------------------------------------------------------------------------------------|
| `id`                      | text PK (uuid)          | every table convention                                                                                              |
| `deviceId`                | text FK→device, cascade | service belongs to a device; per-device agent filtering (FR-008); cascade delete                                    |
| `name`                    | text                    | display name in the UI list (parallels `device.name`)                                                               |
| `containerName`           | text                    | **S-04 diagnoseLogs** → `docker logs <containerName>`; **S-06** restart/stop target a container                     |
| `composeProject`          | text, nullable          | **S-06 up/down** → `docker compose -p <project>`; null = standalone container                                       |
| `composePath`             | text, nullable          | per-device path conventions (FR-005); `up`/`down` may need `-f <composePath>`; nullable (labels may not surface it) |
| `createdAt` / `updatedAt` | timestamp_ms            | every table convention                                                                                              |

Keep volatile runtime facts (image, ports, status) **off** the persisted record — they belong on the ephemeral scan result and would go stale.

**Curation split (scan ephemeral vs managed persisted)**:

- `POST /devices/:id/scan` → ephemeral `scanResult` listing **all** containers with live facts (`image`, `status`) for the curation UI only — never persisted.
- The chosen subset is POSTed as `serviceCreateRequest`s and persisted as `service` rows carrying only stable identity.

Proposed shared contracts (one export per file, `z.strictObject`, Zod v4): `scan-result.schema.ts` (with inner `scannedContainerSchema`), `service.schema.ts` (read, with `isoTimestamp`), `service-create-request.schema.ts` (identity-only), `service-update-request.schema.ts` (`.partial().refine(len>0)`) — all added to the `index.ts` barrel. Endpoints likely nested under the device: `POST /devices/:id/scan`, `GET/POST /devices/:id/services`, `PATCH/DELETE /devices/:id/services/:serviceId` (mirror the credential sub-resource).

### Area 4 — historical decisions & lessons that bind S-02

From `context/foundation/lessons.md` — three apply directly:

1. **Operational tunables in config, never in-file `const`** (`lessons.md:5-9`): SSH connect/command timeouts go through `env.schema.ts` (Joi) + `registerAs` (+ `Number(...)`) + `@Inject(...Config.KEY)`.
2. **Wire timestamps are ISO strings; convert at the Better Auth client boundary** (`lessons.md:12-17`): reuse `isoTimestamp` for `service` timestamps; never feed a hydrated `Date` into the ISO-string schema.
3. **Inject NestJS deps with explicit `@Inject(Class)` tokens** (`lessons.md:19-24`): esbuild/Vitest drops `design:paramtypes`; the `IExecutor` implementation and every consumer must use explicit tokens (a `provide`/`useClass` token for the interface).
4. **(dev-time) On Windows, `npx nx reset` before moving a folder if the daemon locks it** (`lessons.md:26-31`) — relevant when archiving, not a code constraint.

From the archives:

- **Devices/services are shared, not per-user-owned** — `device` has no `userId`; accountability is via the audit log (S-09), not visibility filtering (PRD Access Control, `prd.md:121`). S-02 service endpoints need no user-scoping filters. (`context/archive/2026-06-09-manage-devices/research.md:36-44`)
- **S-01 explicitly deferred SSH to S-02** — `manage-devices/plan.md:78,82`.
- **F1 (decrypt-error wrapping) is now due in S-02** — `encrypted-credential-store/reviews/impl-review.md:51-52`.
- **F2 (clamp credential list `limit` ≤ 100) was already resolved in S-01** — no longer outstanding.

## Code References

- `libs/shared/src/lib/schemas/device.schema.ts:6,11-19` — `isoTimestamp` helper + `z.strictObject` read contract (template for `service.schema.ts`)
- `libs/shared/src/lib/schemas/device-create-request.schema.ts:6-9` / `device-update-request.schema.ts:7-9` — create/update contract pattern
- `libs/shared/src/lib/schemas/credential-list-query.schema.ts:7-10` — paginated list query (ceiling in schema, default from config)
- `libs/shared/src/index.ts:1-11` — the barrel every new schema must be added to
- `apps/api/src/database/schema/device.schema.ts:4-55` — table + FK + index + relations idiom (template for the `service` table)
- `apps/api/src/database/schema/index.ts:5-6` — schema barrel (drizzle-kit generate target)
- `apps/api/src/device/device.service.ts:9-71` — service template (id, requireRow, toContract+parse)
- `apps/api/src/device/device.controller.ts:15-20` — thin controller + ZodValidationPipe + `@Inject` token
- `apps/api/src/device/device.module.ts:14-19` — `json()` re-apply in `NestModule.configure()`
- `apps/api/src/credential/credential.service.ts:48-51,53-62` — `getDecryptedSecret(id)` (executor seam) + `list(deviceId)`
- `apps/api/src/crypto/crypto.service.ts:16-34` — AES-256-GCM encrypt/decrypt + key sourcing
- `apps/api/src/common/all-exceptions.filter.ts` + `apps/api/src/app/app.module.ts:21` — global error shaping to `apiErrorSchema`
- `apps/api/src/config/device.config.ts:6-8` + `config/env.schema.ts:26` + `config/config.module.ts:12-16` — config tunable pattern (template for `ssh.config.ts`)
- `apps/web/src/app/core/stores/devices.store.ts:33-128` — signal store, mutate-then-refetch, rollback orchestration
- `apps/web/src/app/core/clients/devices.client.ts:29,39` — response validation against shared schema
- `apps/web/src/app/features/devices/devices.component.ts:22-23` + `device-form.dialog.ts:56-59` — OnPush feature component + schema-validated forms
- `apps/web/src/app/app.routes.ts:15-20` — lazy guarded route
- `.claude/rules/node-ssh.md:7-25` — the binding executor + mutex + timeout/dispose rule
- `.claude/rules/ssh.md:8` — Synology docker-not-on-PATH hint (ops only)

## Architecture Insights

- **The executor is a cross-cutting provider module** (like `CryptoModule`/`CredentialModule`), exporting `IExecutor` via a DI token — *not* a feature module. Feature services depend on the interface so it can be faked in tests (node-ssh.md). Inject with an explicit token (interface DI needs `{ provide: EXECUTOR, useClass: SshExecutor }`).
- **Contracts are the binding seam**: every request/response and the docker scan line shape is a single Zod schema in `@opspilot/shared`, consumed via `z.infer`, validated at both the NestJS boundary (`ZodValidationPipe` / `schema.parse` in `toContract`) and the Angular client boundary (`schema.parse(response)`). Drizzle `$inferSelect` types stay local to the service.
- **Scan vs persist is a deliberate guardrail, not an accident**: showing all containers but persisting only a curated subset limits the agent's reach (PRD FR-004). The scan result is ephemeral; the managed `service` row carries only stable identity, no runtime status.
- **The "no hang" NFR is an executor property, born here**: per-command timeout + `finally { dispose() }` + per-device mutex is the template every later skill (S-04/S-06/S-08) inherits. Getting the error taxonomy right now (connect/auth failure vs command timeout vs non-zero exit vs decrypt failure) pays off across the whole agent layer.
- **One open modeling decision for `/10x-plan`**: confirm whether `scanServices` stays a private method this slice (recommended) or whether any thin "skill" seam is introduced early; the research strongly recommends deferring the skill-as-data model to S-08.

## Historical Context (from prior changes)

- `context/archive/2026-06-09-manage-devices/plan.md:78,82` — S-01 deliberately stored credentials but never connected; node-ssh executor explicitly scoped to "S-02+".
- `context/archive/2026-06-09-manage-devices/research.md:36-44,136` — devices are a shared (non-per-user) inventory; "connection-verification on add" was a design aspiration left for the executor.
- `context/archive/2026-06-09-encrypted-credential-store/reviews/impl-review.md:51-52` — the deferred decrypt-error-wrapping obligation that S-02, as the first real caller of `getDecryptedSecret`, must discharge.
- `context/archive/2026-05-31-data-persistence-scaffold/` — migration-at-boot + WAL + backup-gate conventions the `service` table inherits unchanged.

## Related Research

- `context/archive/2026-06-09-manage-devices/research.md` — the most directly relevant prior research (S-02's prerequisite slice).
- `context/archive/2026-06-09-encrypted-credential-store/` — the crypto/credential contract S-02's executor consumes.

## Open Questions

1. **Service identity stability** — key the managed `service` on `containerName` (+ optional `composeProject`)? Container *ids* change on recreate, so name-based identity is preferred, but two compose projects can reuse a container name on one host — hence the proposed `(deviceId, containerName)` unique guard. Confirm during planning.
2. **Timeout defaults** — design note suggests 30s per command; pick connect vs command defaults and bound them in Joi.
3. **Concurrent-scan policy** — per-device serialization via mutex is settled; is there also an instance-wide cap on parallel device scans? Likely not needed at homelab scale, but note it.
4. **Scan command robustness on the target** — handle "docker not on PATH" (Synology hint) and "daemon down" as distinct, user-legible errors rather than a generic failure.
5. **Endpoint shape** — confirm nesting under `/devices/:id/services` + `/devices/:id/scan` (mirrors the credential sub-resource) vs a top-level `/services` resource.

> Note: one sub-agent initially stated "S-02 adds no tables (HTTP + executor logic only)" — this is **incorrect** and is resolved here: the roadmap S-02 outcome ("curate managed services — add selected, edit, delete") requires persisting the curated subset, so a new `service` table **is** in scope. The other three agents converge on this.
