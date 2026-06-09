---
date: 2026-06-09T00:00:00Z
researcher: Karol Dydo
git_commit: fc067a38188809c8775522833f0ab5b651f26b0e
branch: main
repository: opspilot
topic: "Manage devices (FR-002): full-stack CRUD over the existing device table, with encrypted SSH credentials (FR-013)"
tags: [ research, codebase, devices, crypto, drizzle, nestjs, angular, zod-contracts, better-auth ]
status: complete
last_updated: 2026-06-09
last_updated_by: Karol Dydo
---

# Research: Manage devices (FR-002) — full-stack CRUD

**Date**: 2026-06-09T00:00:00Z
**Researcher**: Karol Dydo
**Git Commit**: fc067a38188809c8775522833f0ab5b651f26b0e
**Branch**: main
**Repository**: opspilot

## Research Question

How do we implement the `manage-devices` feature — FR-002 (add manually with address + SSH
credentials, edit, delete) backed by FR-013 (SSH credentials encrypted at-rest) — as a full-stack
vertical slice (NestJS api + Angular web + shared Zod contracts), reusing the existing
encrypted-credential-store infrastructure, following repo CRUD/persistence/auth conventions, and
with a light recon of FR-003 (LAN auto-discovery)?

## Summary

Most of the storage and crypto foundation already shipped with the archived `encrypted-credential-store`
change. `manage-devices` is therefore **primarily a CRUD + HTTP-surface + shared-contract + web-UI
addition on top of existing storage/crypto**, not a from-scratch build:

- The **`device` Drizzle table already exists** (`id`, `name`, `host`, `createdAt`, `updatedAt`),
  created deliberately as a thin FK target without CRUD — `apps/api/src/database/schema/device.schema.ts:4-15`.
- The **`credential` table, `CryptoService` (AES-256-GCM), and `CredentialService`
  (encrypt-on-create, secret-omitting contract projection) already exist and are wired**. A device
  feature does **not** re-implement crypto; it calls `CredentialService.create(...)`.
- **What's missing for this change**: a `DeviceModule` (controller + service), device Zod contracts
  in `@opspilot/shared`, the **first HTTP surface in the whole app** (no domain controller exists
  yet — only `health` and the Better Auth catch-all), the **first consumer of `ZodValidationPipe`**,
  the **first controller that reads `request.session.user.id`**, and the Angular devices UI.

Two decisions need the user's call before planning (see **Open Questions**):

1. **User-scoping of devices** — the `device` table has **no `userId` column**. Are devices
   per-user-owned or shared across all (trusted) users? The PRD's flat multi-user model is
   ambiguous and the table currently implies *shared*.
2. **How SSH credentials are captured in the device flow** — one combined "create device + credential"
   call, or device CRUD first and credentials as a separate sub-resource.

FR-003 (LAN scan) has **zero groundwork** and is explicitly demoted to nice-to-have / parked
post-MVP — do **not** build scanning into this change.

## Detailed Findings

### Area 1 — Crypto / credential store integration (FR-013 reuse)

The archived `encrypted-credential-store` change already delivers everything needed to store a
device's SSH secret. **Reuse, do not rebuild.**

- **`CryptoService`** — `apps/api/src/crypto/crypto.service.ts`
  - AES-256-GCM; constants `ALGORITHM='aes-256-gcm'`, `IV_BYTES=12`, `KEY_BYTES=32` (`crypto.service.ts:7-10`).
  - **No KDF** — the 32-byte master key is used directly; per-record semantic security comes from a
    random 12-byte IV. Key injected as base64, decoded once at construction with a 32-byte assertion
    (`crypto.service.ts:16-25`).
  - `encrypt(plaintext): EncryptedPayload` (`crypto.service.ts:36-47`) and `decrypt(input)`
    (`crypto.service.ts:27-34`) return/consume `{ authTag, ciphertext, iv }` all base64
    (`apps/api/src/crypto/encrypted-payload.type.ts:1-5`, api-local interface, not shared).
- **`CredentialService`** — `apps/api/src/credential/credential.service.ts`
  - `create(input: CredentialCreateRequest)` calls `this.crypto.encrypt(input.secret)`, writes
    `ciphertext/iv/authTag/keyVersion=1` with a `randomUUID()` id (`credential.service.ts:22-39`).
  - `getDecryptedSecret(id)` is **service-only** — explicitly commented never to be wired to a
    controller; plaintext never crosses `/api` (`credential.service.ts:45-51`).
  - `list(deviceId, offset=0, limit=50)` filters by `deviceId` and hits the
    `credential_deviceId_idx` index (`credential.service.ts:53-62`).
  - `toContract(row)` is **projection-not-spread** + `credentialSchema.parse(...)` — only 6 safe
    fields, never `ciphertext/iv/authTag/keyVersion` (`credential.service.ts:76-85`).
- **DI wiring** — `CredentialService` uses **explicit `@Inject(Class)` tokens for every dependency**
  including the class (`@Inject(CryptoService)`, `@Inject(DATABASE_CONNECTION)`) —
  `credential.service.ts:17-20`. A new `DeviceService` **must** follow this (type-based DI breaks
  under Vitest/esbuild — see lessons.md).
- **Config** — `ENCRYPTION_KEY` env var, Joi `base64().length(44).required()`
  (`apps/api/src/config/env.schema.ts:8,23-24`), surfaced as `cryptoConfig` namespace
  (`apps/api/src/config/crypto.config.ts:5-9`). Untouched by this change.
- **Deferred items from the archive directly relevant here** (`context/archive/2026-06-09-encrypted-credential-store/`):
  - Device CRUD (FR-002) was explicitly carved out as a separate concern (plan `:77-80`).
  - **No HTTP surface for credentials** was built (plan `:81-83`) — `manage-devices` adds the first.
  - Impl-review **F2**: `list()` has no upper bound on caller-supplied `limit` — clamp it (e.g. ≤100)
    in the request DTO **when the controller is added** — i.e. in this change.
  - Impl-review **F1**: `getDecryptedSecret` lets the raw node:crypto auth error bubble — wrap in a
    domain error when the first real caller (node-ssh `IExecutor`) is wired (likely a later change).

**Net plumbing**: to store a device's SSH credentials, call
`CredentialService.create({ authType, deviceId, secret, username })` — the FK and `onDelete: 'cascade'`
already exist, so deleting a device auto-removes its credentials. No new crypto, table, or config.

### Area 2 — API CRUD + persistence patterns

- **Module layout is slice-per-folder** under `apps/api/src/`: `auth/`, `config/`, `credential/`,
  `crypto/`, `database/` (`@Global`), `health/`, `app/`. Root wiring imports
  `[AuthModule, ConfigModule, CredentialModule, DatabaseModule, HealthModule]` and registers a
  **global guard** `{ provide: APP_GUARD, useClass: AuthAppGuard }` — `apps/api/src/app/app.module.ts:13-17`.
- **Best service template** = `credential.service.ts` (typed Drizzle `.insert().returning().get()`,
  `randomUUID()` ids, `requireRow → NotFoundException`, `toContract` projection). **Best controller
  template** = `apps/api/src/health/health.controller.ts` (thin `@Controller`, explicit `@Inject`).
  No single existing module has *both* a CRUD controller and a persistence service — `manage-devices`
  is the first to combine them.
- **Drizzle**: schema files at `apps/api/src/database/schema/*.ts` (barrel `index.ts`); connection
  provider opens one `better-sqlite3` handle with WAL + `foreign_keys = ON` and returns
  `drizzle(sqlite, { schema })` (`apps/api/src/database/providers/database-connection.provider.ts:17-33`);
  migrations live in `apps/api/migrations/` and run automatically at boot via
  `MigrationService.onApplicationBootstrap()` (`apps/api/src/database/migration/migration.service.ts:24-38`).
  Workflow: edit schema → `npm run db:generate` → applied at boot.
  - **`device` table already exists** with the project conventions: `text('id').primaryKey()`
    (app-generated uuid), timestamps as `integer(..., { mode: 'timestamp_ms' })` with the
    `unixepoch` default and `.$onUpdate(() => new Date())` on `updatedAt`
    (`apps/api/src/database/schema/device.schema.ts:4-15`). **No base-table migration is needed**
    unless columns are added (e.g. a `userId` FK — then `npm run db:generate` emits `0002_*.sql`).
- **Validation**: `ZodValidationPipe` exists and is unit-tested but is **wired into no controller yet**
  (`apps/api/src/common/zod-validation.pipe.ts`) — `manage-devices` is its first consumer:
  `@Body(new ZodValidationPipe(deviceCreateRequestSchema)) body: DeviceCreateRequest`.
- **Errors**: thrown from the service, naming entity + id —
  `throw new NotFoundException(\`device ${id} not found\`)` (pattern at `credential.service.ts:65-71`).
  `device.name`/`host` have no unique constraint today; `ConflictException` would be the idiom if one
  is added. Note: nestjs.md calls for a global exception filter but **none is registered yet**.
- **Config tunables**: any device list page-size limit belongs in a `registerAs('device', ...)`
  factory + Joi entry, **not** an in-file `const` (lessons.md "operational tunables in the config layer").
- **Testing**: Vitest with `globals: true`. Integration spec harness = `credential.service.spec.ts`
  — temp DB under `tmpdir()`, `.overrideProvider(databaseConfig.KEY).useValue({...})` and
  `cryptoConfig.KEY`, manual `MigrationService.onApplicationBootstrap()`, sidecar
  (`-wal`/`-shm`/`.bak`) cleanup. A **controller** spec must also
  `.overrideGuard(AuthGuard).useValue({ canActivate: () => true })` (no example exists yet).

### Area 3 — Shared Zod contracts (FE↔BE single source of truth)

- **Binding rule** (`.claude/rules/contracts.md:14-37`): every request/response shape is a Zod schema
  defined **once** in `@opspilot/shared`; both apps consume via `z.infer`, never redeclare. Drizzle
  `$inferSelect` types are Node/SQLite-bound and **must not** leak into shared — the api maps rows to
  the shared contract before returning.
- **Zod v4 idioms** (`.claude/rules/zod.md:19-34`): `z.email()`/`z.uuid()` top-level, custom messages
  via `error` not `message`, `z.strictObject({...})` for closed shapes, read issues from `error.issues`,
  parse untrusted input **once** at the boundary.
- **File/naming conventions** (`.claude/rules/shared-library.md`): kebab-case files with role suffix
  (`device.schema.ts`, `device-create-request.schema.ts`), one `export *` line per file in
  `libs/shared/src/index.ts`, never import `@angular/*` or `@nestjs/*`.
- **Existing schemas** in `libs/shared/src/lib/schemas/`: `api-error`, `auth-login-request`,
  `auth-register-request`, `auth-user`, `credential`, `credential-create-request`, `health-response`.
- **Request vs response split is the load-bearing pattern for secrets**:
  - Request includes plaintext: `credentialCreateRequestSchema` has `secret`
    (`credential-create-request.schema.ts:3-12`) — the only place a secret enters.
  - Response omits all secret material via `z.strictObject` so a leak fails the parse:
    `credentialSchema` excludes `ciphertext/iv/authTag/keyVersion`
    (`credential.schema.ts:8-19`), with regression tests asserting rejection
    (`credential.schema.spec.ts:47-59`).
- **Timestamp wire-truth**: `isoTimestamp = z.preprocess(Date→toISOString, z.iso.datetime())`
  normalizes both Drizzle `Date` rows and Better Auth client `Date` objects to ISO strings
  (`auth-user.schema.ts:3-6`; consumed at `auth.store.ts:42-43`). The device read contract should
  reuse this exact preprocess.

### Area 4 — Auth / user scoping (Better Auth)

- **Server**: `createAuth()` factory wraps `betterAuth` with the Drizzle adapter, `basePath:'/auth'`
  → effective `/api/auth` (`apps/api/src/auth/create-auth.ts:19-42`); mounted via a `@Public()`
  catch-all `@All('*splat')` controller (`apps/api/src/auth/auth.controller.ts:8-17`).
  `main.ts:11` sets `bodyParser: false` so Better Auth gets the raw body.
- **Global guard** `AuthAppGuard` (`app.module.ts:16`): every route is guarded unless `@Public()`.
  It validates the session and **attaches it to the request**: `request.session = session`
  (`apps/api/src/auth/auth.guard.ts:33-39`); user id is reachable as `request.session.user.id` via
  the typed `AuthenticatedRequest` (`auth.guard.ts:9-13`).
- **No controller reads `request.session` yet** — `manage-devices` is the first feature to consume
  the authenticated identity. Recommended: add a thin `@CurrentUser()` param decorator (does not
  exist yet) returning `request.session.user.id`.
- **Web**: `authClient = createAuthClient({ basePath: '/api/auth' })`
  (`apps/web/src/app/core/clients/auth.client.ts:12`); `AuthStore` (`@ngrx/signals` `signalState`)
  hydrated before first nav via `provideAppInitializer` (`app.config.ts:20`); functional
  `authGuard` redirects unauthenticated users to `/login` (`core/guards/auth.guard.ts:8-13`);
  401 interceptor clears state + redirects (`core/interceptors/auth.interceptor.ts:10-23`).
  Same-origin `withFetch()` carries the session cookie automatically — no `withCredentials` needed.
- **Ownership model (open)**: `device` and `credential` have **no `userId` column**; `user_id`
  appears only in Better Auth `session`/`account` tables. **No user-owned operational resource exists
  yet.** If devices are to be per-user, the agent-inferred pattern is: add `userId` FK +
  `device_userId_idx`, never accept `userId` from the body, filter **every** query by
  `and(eq(device.id, id), eq(device.userId, currentUserId))`, and return `NotFoundException` (not 403)
  for another user's id to avoid leaking existence. See Open Questions — this may not be the intent.

### Area 5 — Web / Angular patterns (+ FR-003 recon)

- **Routing**: flat `Route[]`, lazy `loadComponent`, guarded home via `canActivate:[authGuard]`
  (`apps/web/src/app/app.routes.ts`). Zoneless, signals-first; no RxJS data fetching in components.
- **No generic HttpClient api wrapper exists** — the only api I/O today is the Better Auth client.
  A devices service should call relative `'/api/devices'` with `HttpClient` (or `httpResource()` per
  angular.md) — same-origin cookie rides automatically.
- **spartan/ng is wired** as a local Nx lib `libs/ui/` (not `node_modules`), aliased in
  `tsconfig.base.json:14-19`. **Installed: `button`, `card`, `input`, `label` + `utils`** only.
  Tailwind v4 + brain preset in `apps/web/src/styles.scss:2-6`. **`table`, `dialog`, `alert-dialog`,
  `select` are NOT installed** — generate via
  `npx nx generate @spartan-ng/cli:ui --name=table,dialog,alert-dialog,select` (peer dep
  `@angular/cdk`). Honor spartan.md composition rules (dialog needs `hlmDialogTitle`, use `hlm-empty`
  for empty state, `alert-dialog` for delete confirm).
- **Forms**: reactive (`formBuilder.nonNullable.group`) with **Zod bridged per-field** via
  `schemaValidator(schema.shape.<field>)` (`core/validators/schema.validator.ts:7-15`; usage
  `login.component.ts:26-29`). Error display via `@if (ctrl.touched && ctrl.invalid)` + `text-destructive`.
- **State / mutate-then-refetch**: `AuthStore` (`@ngrx/signals` `signalState`/`patchState`, provided
  explicitly at root) performs async I/O then re-`loadSession()` (`auth.store.ts:54,68`) — the
  pattern a `DevicesStore` should mirror (create/update/remove → re-`load()`). Parse responses through
  `deviceSchema.array()` to normalize timestamps.
- **FR-003 LAN scan — NO groundwork**: grep across source for `nmap|arp-scan|discover|scan|LAN`
  found **zero** scanning code; all hits are docs/PRD/roadmap. PRD demotes FR-003 to nice-to-have
  (`prd.md:70-71`); roadmap parks it post-MVP pending `network_mode: host` + `NET_ADMIN` validation
  (`roadmap.md:264`). **Build manual add/edit/delete only.**

## Code References

- `apps/api/src/database/schema/device.schema.ts:4-15` — existing `device` table (no CRUD, no `userId`)
- `apps/api/src/database/schema/device.schema.ts:17-44` — `credential` table, FK + cascade + index
- `apps/api/src/crypto/crypto.service.ts:27-47` — encrypt/decrypt (AES-256-GCM)
- `apps/api/src/credential/credential.service.ts:17-20` — explicit `@Inject` DI pattern (mandatory)
- `apps/api/src/credential/credential.service.ts:22-39` — encrypt-on-create
- `apps/api/src/credential/credential.service.ts:76-85` — projection-not-spread + `schema.parse`
- `apps/api/src/common/zod-validation.pipe.ts` — Zod pipe (no consumer yet)
- `apps/api/src/auth/auth.guard.ts:33-39` — global guard attaches `request.session`
- `apps/api/src/app/app.module.ts:13-17` — module wiring + global `AuthAppGuard`
- `apps/api/src/health/health.controller.ts` — thin controller template
- `apps/api/src/credential/credential.service.spec.ts` — integration test harness (temp DB, overrides)
- `libs/shared/src/lib/schemas/credential.schema.ts:8-19` — secret-omitting response contract
- `libs/shared/src/lib/schemas/credential-create-request.schema.ts:3-12` — plaintext-in request
- `libs/shared/src/lib/schemas/auth-user.schema.ts:3-6` — `isoTimestamp` preprocess
- `libs/shared/src/index.ts:1-7` — barrel (add 3 device lines)
- `apps/web/src/app/core/validators/schema.validator.ts:7-15` — Zod→Angular validator bridge
- `apps/web/src/app/core/stores/auth.store.ts:40-68` — mutate-then-refetch store pattern
- `apps/web/src/app/app.routes.ts` — lazy + guarded route pattern
- `tsconfig.base.json:14-19` — spartan helm aliases (button/card/input/label only)

## Architecture Insights

- **The feature is mostly assembly, not invention.** Storage (both tables), crypto, the config chain,
  the Zod pipe, the auth guard, and the contract patterns all exist. The change wires them into the
  app's first real HTTP surface + UI.
- **Three "firsts" land in this change** and define new repo conventions worth getting right:
  the first domain controller, the first `ZodValidationPipe` consumer, and the first reader of
  `request.session.user.id`. Future features will copy whatever this change establishes.
- **Secret containment is enforced by shape, not vigilance**: request schema carries `secret`,
  response schema is `z.strictObject` without it, the service projects safe fields and `parse`s.
  The device contracts must follow the identical split.
- **Timestamps are ISO strings on the wire**; reuse the `isoTimestamp` preprocess so both Drizzle
  rows and (if ever) Better Auth client objects normalize cleanly.

## Historical Context (from prior changes)

- `context/archive/2026-06-09-encrypted-credential-store/` — built `CryptoService`/`CredentialService`,
  both tables, and the `device` thin FK target; explicitly deferred device CRUD, the credential HTTP
  surface, and node-ssh `IExecutor` integration. Impl-review F1 (decrypt error wrapping) and **F2
  (clamp `list` limit in the DTO)** are the handoff points this change inherits.
- `context/archive/2026-06-07-account-auth-foundation/` — Better Auth + the global guard + web auth
  store / guard / interceptor (the auth plumbing this change is the first to consume for ownership).
- `context/archive/2026-05-31-data-persistence-scaffold/` — Drizzle + migration-at-boot scaffold.
- `context/foundation/lessons.md` — explicit `@Inject(Class)` DI; ISO-string wire timestamps;
  config-layer tunables; `npx nx reset` before moving folders on Windows.

## Related Research

- None prior for `manage-devices` (first artifact for this change). Closest is the archived
  `encrypted-credential-store/research.md` (credential storage model and its Open Q5, which named
  device CRUD as a separate concern).

## Open Questions

1. **Are devices per-user-owned or shared across all users?** The `device` table has no `userId`
   column today, implying *shared*. The PRD is flat multi-user with "all logged-in users have the
   same permissions" and accountability via audit log — which can read as *shared devices, audit who
   touched them* rather than *private per-user devices*. This decision drives whether a `userId` FK +
   migration + per-user query filtering is in scope. **Needs the user's call before planning.**
2. **How are SSH credentials captured in the device flow?** Options: (a) one combined "create device
   with credentials" request that the service splits into `DeviceService.create` +
   `CredentialService.create`; (b) device CRUD first, credentials managed as a separate
   `/api/devices/:id/credentials` sub-resource. FR-002 phrases it as "add manually (address + SSH
   credentials)", leaning toward (a) for the create path. Affects contract shape and controller surface.
3. **`authType: 'password' | 'key'` UX** — for `key` auth the "secret" is a private key (multiline);
   for `password` it's a single line. The create form and `credentialCreateRequestSchema` already
   support both, but the web form needs a conditional control. In scope?
4. **Edit semantics for credentials** — editing a device's name/host is a plain `PATCH`; rotating the
   SSH secret is a credential replace (encrypt new, drop old). Is credential rotation part of this
   change or deferred with the node-ssh executor?
5. **Global exception filter** — nestjs.md wants one and none exists. Establish it in this change
   (since it adds the first error-producing endpoints) or leave for later?
