# Manage Devices (FR-002 + FR-013) Implementation Plan

## Overview

Build the `manage-devices` feature as a full-stack vertical slice: a **shared** device
inventory (add / edit / delete), with SSH credentials encrypted at-rest and managed as a
separate sub-resource. The slice reuses the already-shipped `encrypted-credential-store`
infrastructure (both Drizzle tables, `CryptoService`, `CredentialService`,
`ZodValidationPipe`, the global `AuthAppGuard`) and wires them into the app's first real
domain HTTP surface plus the Angular devices UI. This is primarily assembly, not invention.

## Current State Analysis

What exists today (verified in research, `research.md:32-44`):

- **Both tables exist** — `device` (`id`, `name`, `host`, timestamps; no `userId`) and
  `credential` (FK to device, `onDelete: 'cascade'`, secret material columns) at
  `apps/api/src/database/schema/device.schema.ts:4-15,17-44`.
- **Crypto + credential storage exist and are wired** — `CryptoService` (AES-256-GCM,
  `crypto.service.ts:27-47`) and `CredentialService` (encrypt-on-create, service-only
  decrypt, `toContract` projection, `list(deviceId, offset, limit)`) at
  `credential.service.ts:17-85`.
- **`ZodValidationPipe` exists but has no consumer yet** (`common/zod-validation.pipe.ts`).
- **Global `AuthAppGuard` guards every route unless `@Public()`** and attaches
  `request.session` (`auth.guard.ts:33-39`, `app.module.ts:13-17`).
- **No domain controller exists** — only `health` and the Better Auth catch-all.
- **No global exception filter is registered**, though `nestjs.md` mandates one.
- **Web has no generic HttpClient API wrapper** — only the Better Auth client. spartan/ng
  is wired (`libs/ui/`) but only `button/card/input/label` are installed;
  `table/dialog/alert-dialog/select` are **not**.

What's missing (this change): `DeviceModule` (service + controller), device Zod contracts,
the credential HTTP sub-resource, the global exception filter, and the Angular devices UI.

### Key Discoveries

- **`device` table needs no migration** under the shared model — no `userId` column is
  added (`device.schema.ts:4-15`).
- **Explicit `@Inject(Class)` DI is mandatory** — type-based DI resolves to `undefined`
  under the Vitest/esbuild transform (`lessons.md:19-24`; `credential.service.ts:17-20`).
- **Secret containment is enforced by shape**: request schema carries the plaintext,
  response schema is `z.strictObject` without it, the service projects safe fields and
  `parse`s (`credential.schema.ts:8-19`, `credential.service.ts:76-85`). Device contracts
  must follow the identical split — though devices carry no secrets, the response contract
  is still `z.strictObject`.
- **Wire timestamps are ISO strings** — reuse the `isoTimestamp` preprocess from
  `auth-user.schema.ts:3-6` (`lessons.md:12-17`).
- **Operational tunables go through the config layer**, never as in-file `const`s
  (`lessons.md:5-9`) — the credential-list `limit` cap belongs in `registerAs('device', …)`
  + Joi, not a literal.
- **`credentialCreateRequestSchema.deviceId` is required** (`credential-create-request.schema.ts:9`)
  — the data model already forces device-before-credential ordering, so the two-call create
  flow is the path of least resistance.
- **Inherited handoff from the archive**: impl-review **F2** — clamp the caller-supplied
  `limit` on the credential `list` when the controller is added (i.e. here),
  `research.md:91-92`.

## Desired End State

A logged-in user can, from the web UI, see a shared list of all devices, add a device by
entering its name + host + SSH credentials in a single form step, edit a device's name/host,
replace its credentials, and delete a device (which cascades the credential). All requests
flow through shared Zod contracts; SSH secrets are encrypted at-rest and never cross `/api`
in plaintext on the way out. A single global exception filter shapes every error response.

**Verification of end state**: `npm run build`, `npm run lint`, `npm run test` all pass;
manually adding/editing/deleting a device through the UI works, credentials are stored
encrypted (the `credential` row has `ciphertext`/`iv`/`authTag`, never the plaintext), and
the GET responses never contain secret material.

## What We're NOT Doing

- **No per-user ownership** — devices are shared across all logged-in users; no `userId`
  column, no per-query ownership filter, no `userId` migration (decision: shared, per
  `prd.md:121` "no separation of permissions"; frame reframe confirmed).
- **No credential rotation / in-place re-encrypt** — there is **no** `PATCH`/`PUT` on a
  credential. Replacing credentials is delete + recreate. True rotation belongs to the
  node-ssh executor slice (S-02+), frame cut.
- **No reading of `request.session.user.id`** — the shared model needs no per-user filtering
  and the audit log is not in this slice, so no `@CurrentUser()` decorator is added here.
- **No FR-003 LAN auto-discovery** — zero groundwork; parked post-MVP (`research.md:210-213`).
- **No node-ssh / connection testing** — credentials are stored, never used to connect yet.
- **No decrypt HTTP surface** — `getDecryptedSecret` stays service-only (`credential.service.ts:45-51`).

## Implementation Approach

Build bottom-up along the vertical slice's dependency order: shared contracts first (both
apps depend on them), then the API (service → controller → module wiring → global exception
filter), then the web UI (store → list → add/edit dialog → delete confirm). The create flow
is **one UI step backed by two API calls** (`POST /devices` then
`POST /devices/:id/credentials`); on credential-call failure the web orchestrator rolls back
by issuing `DELETE /devices/:id` and surfacing an error, so no device is ever orphaned
without credentials.

## Critical Implementation Details

- **Two-call create rollback ordering** — the web `DevicesStore.add(...)` must `await` the
  `POST /devices` response to obtain the new `id`, then `POST /devices/:id/credentials`; if
  the second call rejects, issue `DELETE /devices/:id` before surfacing the error. The
  rollback `DELETE` is best-effort — if it also fails, surface the original credential error
  (homelab single-writer makes a double failure negligible). State is only patched after both
  calls succeed, then `load()` refetches.
- **`@Inject(Class)` everywhere in `apps/api`** — `DeviceService` and the controllers must
  inject every dependency with an explicit token, or the Vitest specs throw on `undefined`
  (`lessons.md:19-24`).
- **`authType` drives the secret control shape** — `password` → single-line input;
  `key` → multiline textarea (a private key). The reactive form swaps the control's
  validation/rendering on the `authType` value; the contract field is the same `secret`
  string either way (`credential-create-request.schema.ts:8`).

## Phase 1: Shared Zod Contracts

### Overview

Define the device request/response contracts once in `@opspilot/shared`, plus a bounded
list-query schema, following the request-vs-response secret-containment split and the
`isoTimestamp` wire convention. Both apps consume these via `z.infer`.

### Changes Required

#### 1. Device response contract

**File**: `libs/shared/src/lib/schemas/device.schema.ts`

**Intent**: The canonical device shape returned to clients. Carries no secret material;
timestamps are ISO strings on the wire.

**Contract**: `z.strictObject` with `id` (`z.uuid()`), `name`, `host`, `createdAt`,
`updatedAt`. `createdAt`/`updatedAt` use the `isoTimestamp` preprocess copied from
`auth-user.schema.ts:3-6` (`z.preprocess(Date→toISOString, z.iso.datetime())`). Export
`deviceSchema` and `type Device = z.infer<typeof deviceSchema>`.

#### 2. Device create-request contract

**File**: `libs/shared/src/lib/schemas/device-create-request.schema.ts`

**Intent**: Body for `POST /devices`. Device identity only — credentials are a separate call.

**Contract**: `z.strictObject({ name, host })` with non-empty constraints (custom messages
via `error`, per `zod.md`). Export `deviceCreateRequestSchema` + inferred type.

#### 3. Device update-request contract

**File**: `libs/shared/src/lib/schemas/device-update-request.schema.ts`

**Intent**: Body for `PATCH /devices/:id`. Edits name/host only.

**Contract**: A partial of the create shape (`name?`, `host?`), `z.strictObject`, at least
one field present. Export `deviceUpdateRequestSchema` + inferred type.

#### 4. Bounded list-query contract (credential list limit clamp — impl-review F2)

**File**: `libs/shared/src/lib/schemas/credential-list-query.schema.ts` (new)

**Intent**: Validate + clamp the caller-supplied paging params on the credential list
endpoint so an unbounded `limit` can't be requested (`research.md:91-92`).

**Contract**: `z.strictObject({ offset?: number≥0 default 0, limit?: number≥1 max from
config default … })`. The hard ceiling (≤100) is enforced here as a Zod `.max(...)`; the
default page size is the config-layer value (Phase 2). Coerce from query strings
(`z.coerce.number()`). Export schema + inferred type.

#### 5. Barrel exports

**File**: `libs/shared/src/index.ts`

**Intent**: Re-export the new schemas so both apps resolve them via `@opspilot/shared`.

**Contract**: Add one `export *` line per new file (`device.schema`,
`device-create-request.schema`, `device-update-request.schema`,
`credential-list-query.schema`), matching the existing barrel style (`research.md:231`).

### Success Criteria

#### Automated Verification

- [ ] Shared lib builds: `npx nx build shared`
- [ ] Shared tests pass: `npx nx test shared`
- [ ] Lint passes: `npx nx lint shared`
- [ ] Type checking passes across consumers: `npm run build`

#### Manual Verification

- [ ] `deviceSchema` rejects an object containing any unknown key (strictObject) and
  normalizes a `Date` `createdAt` to an ISO string
- [ ] `credentialListQuerySchema` rejects `limit` above the ceiling

**Implementation Note**: After completing this phase and all automated verification passes,
pause for manual confirmation before proceeding.

---

## Phase 2: API — DeviceModule, Credential Sub-resource, Global Exception Filter

### Overview

Add the first domain module: `DeviceService` (persistence) + `DeviceController` (REST), the
credential sub-resource controller (reusing `CredentialService`), the device config
namespace for the list-limit tunable, the app's first global exception filter, and module
wiring. Includes the first `ZodValidationPipe` consumer.

### Changes Required

#### 1. Device config namespace (list-limit tunable)

**Files**: `apps/api/src/config/env.schema.ts`, `apps/api/src/config/device.config.ts` (new)

**Intent**: Surface the credential-list default page size + ceiling as config, not a literal
(`lessons.md:5-9`).

**Contract**: Add a bounded+defaulted Joi entry (e.g. `DEVICE_CREDENTIAL_LIST_LIMIT`) to
`env.schema.ts` typed in `EnvConfig`; expose it via `registerAs('device', …)` in
`device.config.ts` (coerce with `Number(...)`). Read in the controller/DTO; add to any spec
`.overrideProvider(deviceConfig.KEY).useValue({ … })`.

#### 2. DeviceService

**File**: `apps/api/src/device/device.service.ts`

**Intent**: CRUD persistence for devices, mirroring `CredentialService` exactly — typed
Drizzle, app-generated `randomUUID()` ids, `requireRow → NotFoundException`, `toContract`
projection through `deviceSchema.parse(...)`.

**Contract**: Methods `create(input: DeviceCreateRequest): Device`,
`findAll(): Device[]`, `findOne(id): Device`,
`update(id, input: DeviceUpdateRequest): Device`, `remove(id): void`. All deps via
`@Inject(DATABASE_CONNECTION)`. `findOne`/`update`/`remove` throw
`NotFoundException(\`device ${id} not found\`)` on a missing row (pattern at
`credential.service.ts:65-71`). `toContract` is projection-not-spread then
`deviceSchema.parse(...)`.

#### 3. DeviceController

**File**: `apps/api/src/device/device.controller.ts`

**Intent**: The app's first domain HTTP surface and first `ZodValidationPipe` consumer.

**Contract**: Routes under `/devices` (global `/api` prefix applies):
`POST /` (`@Body(new ZodValidationPipe(deviceCreateRequestSchema))`),
`GET /`, `GET /:id`, `PATCH /:id` (`ZodValidationPipe(deviceUpdateRequestSchema)`),
`DELETE /:id` (returns 204). Thin controller, explicit `@Inject(DeviceService)`
(template: `health.controller.ts`). No `@Public()` — inherits the global guard. Does **not**
read `request.session`.

#### 4. Credential sub-resource controller

**File**: `apps/api/src/device/device-credential.controller.ts` (or methods on a sub-path)

**Intent**: The first HTTP surface for credentials, scoped under a device. Reuses the
existing `CredentialService` — no new crypto.

**Contract**: Routes under `/devices/:deviceId/credentials`:
`POST /` → `CredentialService.create({ authType, deviceId, secret, username })` (validate
body with `ZodValidationPipe(credentialCreateRequestSchema)`; `deviceId` comes from the path,
not the body — reconcile per existing schema which requires `deviceId`);
`GET /` → `CredentialService.list(deviceId, offset, limit)` with `offset`/`limit` validated

+ clamped via `credentialListQuerySchema` (ceiling from device config);
  `DELETE /:credentialId` → remove a credential (enables the delete+recreate edit flow).
  Never exposes `getDecryptedSecret`. Returns only `toContract`-projected rows.

> Note: `credentialCreateRequestSchema` requires `deviceId`. The controller takes `deviceId`
> from the path param as the source of truth; if the body also carries it, assert they match
> (else `BadRequestException`). Decide in implementation whether the web sends `deviceId` in
> the body (simplest: yes, matching the existing required contract).

#### 5. Global exception filter

**File**: `apps/api/src/common/all-exceptions.filter.ts` (new)

**Intent**: The app's first global exception filter — shapes every error into the shared
`apiErrorSchema` response. Architectural decision established here since this slice adds the
first error-producing endpoints (`nestjs.md:54-56`, `research.md:128`).

**Contract**: An `@Catch()` filter mapping `HttpException` → its status + a body conforming
to `apiErrorSchema` (`libs/shared/.../api-error.schema.ts`); unknown errors → 500 with a
generic message (never leak internals). Register globally via `APP_FILTER` in the module
providers (alongside the existing `APP_GUARD`). Confirm `apiErrorSchema` shape and reuse it.

#### 6. Module wiring

**File**: `apps/api/src/device/device.module.ts` (new), `apps/api/src/app/app.module.ts`

**Intent**: Register `DeviceModule` (providing `DeviceService`, both controllers, importing
`CredentialModule` for `CredentialService`) and the global filter.

**Contract**: `DeviceModule` declares the controllers + `DeviceService`, imports
`CredentialModule`. `app.module.ts` adds `DeviceModule` to imports and the
`{ provide: APP_FILTER, useClass: AllExceptionsFilter }` provider (`app.module.ts:13-17`).
Load `deviceConfig` in the `ConfigModule.forRoot` config array.

#### 7. Specs

**Files**: `apps/api/src/device/device.service.spec.ts`,
`apps/api/src/device/device.controller.spec.ts`

**Intent**: Cover persistence (integration) and the HTTP surface (with the guard overridden).

**Contract**: Service spec mirrors `credential.service.spec.ts` (temp DB under `tmpdir()`,
`.overrideProvider(databaseConfig.KEY)`, manual `MigrationService.onApplicationBootstrap()`,
sidecar cleanup); asserts create/findAll/findOne/update/remove and `NotFound` on missing id.
Controller spec uses `.overrideGuard(AuthGuard).useValue({ canActivate: () => true })`
(`research.md:135`) and asserts the routes + the limit clamp + that responses carry no secret
fields.

### Success Criteria

#### Automated Verification

- [ ] API builds: `npx nx build api`
- [ ] API tests pass: `npx nx test api`
- [ ] Lint passes: `npx nx lint api`
- [ ] Migration check: `npm run db:generate` produces **no** new migration (no schema change)

#### Manual Verification

- [ ] `POST /api/devices` then `POST /api/devices/:id/credentials` stores a device with an
  encrypted credential (DB row has `ciphertext`/`iv`/`authTag`, never the plaintext)
- [ ] `GET /api/devices` and `GET /api/devices/:id/credentials` responses contain no secret
  material
- [ ] An invalid body returns a shaped `apiError` response via the global filter
- [ ] A `limit` above the ceiling is rejected/clamped
- [ ] `DELETE /api/devices/:id` cascades and removes the credential

**Implementation Note**: After completing this phase and all automated verification passes,
pause for manual confirmation before proceeding.

---

## Phase 3: Web — DevicesStore + Devices UI

### Overview

Add the Angular devices feature: generate the missing spartan primitives, a `DevicesStore`
(mutate-then-refetch), the list view, the single-step add/edit dialog with conditional
`authType` control, the two-call create-with-rollback orchestration, the delete-confirm
flow, and the credential delete+recreate edit path. Lazy + guarded route.

### Changes Required

#### 1. Generate missing spartan primitives

**Command**: `npx nx generate @spartan-ng/cli:ui --name=table,dialog,alert-dialog,select`

**Intent**: Install the UI primitives this feature needs (peer dep `@angular/cdk`),
honoring `spartan.md` composition rules (`research.md:199-202`).

**Contract**: New helm components land in `libs/ui/`; `tsconfig.base.json` aliases updated by
the generator. No hand-written primitive code.

#### 2. Devices API service

**File**: `apps/web/src/app/core/clients/devices.client.ts` (or a feature service)

**Intent**: Typed HTTP I/O against `/api/devices` and `/api/devices/:id/credentials`. Same-
origin cookie rides automatically (`research.md:181`).

**Contract**: Methods for list/get/create/update/remove device + create/list/delete
credential. Responses validated through `deviceSchema.array()` / `deviceSchema` to normalize
ISO timestamps (`lessons.md:12-17`). Uses `HttpClient` (relative URLs).

#### 3. DevicesStore

**File**: `apps/web/src/app/core/stores/devices.store.ts`

**Intent**: Signal-based state with mutate-then-refetch, mirroring `AuthStore`
(`auth.store.ts:40-68`, `research.md:206-209`).

**Contract**: `@ngrx/signals` `signalState` (devices list, loading, error) provided at root.
`load()` fetches + parses. `add(deviceInput, credentialInput)` orchestrates the two-call
create with rollback: `POST /devices` → `POST /devices/:id/credentials`; on the second
failing, `DELETE /devices/:id` (best-effort) then re-throw/surface; on success `load()`.
`update(id, …)`, `remove(id)`, `replaceCredential(deviceId, credId, newInput)`
(delete+recreate) each mutate then `load()`.

#### 4. Devices list component

**File**: `apps/web/src/app/features/devices/devices.component.ts` (+ template)

**Intent**: The shared device inventory view — table of name/host/timestamps with row
actions (edit, delete), empty state, add button.

**Contract**: Standalone `app-`-prefixed component, zoneless/signals, reads `DevicesStore`.
Uses spartan `table`; `hlm-empty` for the empty state (`spartan.md`); opens the add/edit
dialog and the delete `alert-dialog`. No RxJS data fetching in the component.

#### 5. Add/edit device dialog (conditional authType control)

**File**: `apps/web/src/app/features/devices/device-form.dialog.ts` (+ template)

**Intent**: Single-step form capturing name + host + credentials (username, authType,
secret). For create: issues the two-call flow. For edit: PATCHes name/host and, if secret
changed, runs delete+recreate of the credential.

**Contract**: Reactive `formBuilder.nonNullable.group`, Zod bridged per-field via
`schemaValidator(schema.shape.<field>)` (`schema.validator.ts:7-15`). `authType` is a spartan
`select` (`password`|`key`); the `secret` control renders as a single-line `input` for
`password` and a multiline textarea for `key`, swapping on `authType` change. Error display
via `@if (ctrl.touched && ctrl.invalid)` + `text-destructive` (`research.md:204-205`). Dialog
uses `hlmDialogTitle` per spartan composition rules.

#### 6. Delete confirmation

**File**: within the list component / a confirm dialog

**Intent**: Guard destructive delete behind a confirm step.

**Contract**: spartan `alert-dialog` for the delete confirm (`research.md:202`); on confirm
calls `DevicesStore.remove(id)`.

#### 7. Route + navigation

**File**: `apps/web/src/app/app.routes.ts` (+ nav entry)

**Intent**: Expose the devices feature behind the auth guard.

**Contract**: Lazy `loadComponent` route (e.g. `/devices`) with `canActivate: [authGuard]`,
matching the existing flat-route pattern (`app.routes.ts`, `research.md:192`).

### Success Criteria

#### Automated Verification

- [ ] Web builds: `npx nx build web`
- [ ] Web tests pass: `npx nx test web`
- [ ] Lint passes: `npx nx lint web`
- [ ] Format check passes: `npm run format:check`

#### Manual Verification

- [ ] Adding a device with `password` auth (single-line secret) creates device + credential
  in one form step
- [ ] Adding a device with `key` auth shows a multiline secret control and stores it
- [ ] If the credential call fails, the device is rolled back (not left orphaned) and an
  error is shown
- [ ] Editing name/host persists; replacing the secret works via delete+recreate
- [ ] Deleting a device asks for confirmation, then removes it (and its credential) from the
  list
- [ ] The list shows all devices regardless of which user created them (shared model)
- [ ] No secret material is visible in any network response (DevTools)

**Implementation Note**: After completing this phase and all automated verification passes,
pause for final manual confirmation.

---

## Testing Strategy

### Unit Tests

- Shared: `deviceSchema` strictObject rejection + `isoTimestamp` normalization;
  `credentialListQuerySchema` limit-ceiling rejection.
- API: `DeviceService` CRUD + `NotFound` paths; `toContract` projects only safe fields.
- Web: `DevicesStore` two-call create happy path and rollback-on-credential-failure path
  (mock the client).

### Integration Tests

- `device.service.spec.ts` against a temp SQLite DB (harness from `credential.service.spec.ts`).
- `device.controller.spec.ts` with the auth guard overridden — routes, limit clamp, no-secret
  response assertions, exception-filter shaping.

### Manual Testing Steps

1. Log in, open `/devices` — empty state shows.
2. Add a device with `password` auth — appears in the list; check the DB row is encrypted.
3. Add a device with `key` auth (paste a multiline key) — stored; secret never in responses.
4. Edit name/host — persists. Replace the secret — old credential gone, new one stored.
5. Delete a device — confirm dialog, then it (and its credential) disappear.
6. Simulate a credential-call failure (e.g. invalid body) — device is rolled back.

## Performance Considerations

Negligible — homelab scale (a handful of devices, single-writer). No pagination needed in
the UI; the credential-list `limit` ceiling exists only as a safety bound, not a perf
measure.

## Migration Notes

**No migration** — the shared model adds no columns. `npm run db:generate` must emit no new
SQL in Phase 2; if it does, a schema change crept in unintentionally.

## References

- Frame brief: `context/changes/manage-devices/frame.md`
- Research: `context/changes/manage-devices/research.md`
- Crypto/credential reuse: `apps/api/src/credential/credential.service.ts:17-85`
- Service/controller templates: `credential.service.ts`, `apps/api/src/health/health.controller.ts`
- Secret-containment pattern: `libs/shared/src/lib/schemas/credential.schema.ts:8-19`
- ISO timestamp preprocess: `libs/shared/src/lib/schemas/auth-user.schema.ts:3-6`
- Store pattern: `apps/web/src/app/core/stores/auth.store.ts:40-68`
- Lessons: `context/foundation/lessons.md` (DI, ISO timestamps, config tunables)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared Zod Contracts

#### Automated

- [x] 1.1 Shared lib builds: `npx nx build shared` — fe3bf27
- [x] 1.2 Shared tests pass: `npx nx test shared` — fe3bf27
- [x] 1.3 Lint passes: `npx nx lint shared` — fe3bf27
- [x] 1.4 Type checking passes across consumers: `npm run build` — fe3bf27

#### Manual

- [x] 1.5 `deviceSchema` rejects unknown keys and normalizes `Date` to ISO string — fe3bf27
- [x] 1.6 `credentialListQuerySchema` rejects `limit` above the ceiling — fe3bf27

### Phase 2: API — DeviceModule, Credential Sub-resource, Global Exception Filter

#### Automated

- [x] 2.1 API builds: `npx nx build api` — b0f0b91
- [x] 2.2 API tests pass: `npx nx test api` — b0f0b91
- [x] 2.3 Lint passes: `npx nx lint api` — b0f0b91
- [x] 2.4 Migration check: `npm run db:generate` produces no new migration — b0f0b91

#### Manual

- [x] 2.5 Device + encrypted credential stored via the two-call flow (DB row encrypted) — b0f0b91
- [x] 2.6 GET responses contain no secret material — b0f0b91
- [x] 2.7 Invalid body returns a shaped `apiError` via the global filter — b0f0b91
- [x] 2.8 `limit` above the ceiling is rejected/clamped — b0f0b91
- [x] 2.9 `DELETE /api/devices/:id` cascades and removes the credential — b0f0b91

### Phase 3: Web — DevicesStore + Devices UI

#### Automated

- [x] 3.1 Web builds: `npx nx build web` — 3f99ef6
- [x] 3.2 Web tests pass: `npx nx test web` — 3f99ef6
- [x] 3.3 Lint passes: `npx nx lint web` — 3f99ef6
- [x] 3.4 Format check passes: `npm run format:check` — 3f99ef6

#### Manual

- [x] 3.5 Add device with `password` auth (single-line secret) in one step — 3f99ef6
- [x] 3.6 Add device with `key` auth shows multiline control and stores it — 3f99ef6
- [ ] 3.7 Credential-call failure rolls back the device (no orphan) and shows an error
- [x] 3.8 Edit name/host persists; replace secret works via delete+recreate — 3f99ef6
- [x] 3.9 Delete asks for confirmation, then removes device + credential — 3f99ef6
- [x] 3.10 List shows all devices regardless of creator (shared model) — 3f99ef6
- [x] 3.11 No secret material in any network response — 3f99ef6
