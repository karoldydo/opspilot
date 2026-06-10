# Scan and Add Services (S-02) Implementation Plan

## Overview

S-02 is the product's **first SSH-out operation**. A user scans the docker containers running on a
device over SSH and curates a managed-services subset (add selected, edit display name, delete).
The slice introduces three new pieces of architecture at once: a reusable **SSH executor**
(node-ssh behind an `IExecutor` token, per-device `async-mutex`, per-command timeout, unconditional
`dispose()`), a new **`service` domain** (Drizzle table + shared Zod contracts + NestJS module +
Angular feature), and a **scan-vs-managed split** (`POST /devices/:id/scan` returns an *ephemeral*
list of all detected containers for the curation UI; the chosen subset is persisted as stable
`service` rows). PRD refs: FR-004 (scan + curate) and FR-007 (the hidden built-in `scanServices`).

## Current State Analysis

- **Nothing SSH-related exists.** No `node-ssh`/`ssh2`/`async-mutex` in `package.json`; zero
  executor/connect code in `apps/api/src`. S-01 deliberately stored credentials but never connected
  (`context/archive/2026-06-09-manage-devices/plan.md:82`).
- **The credential-decryption seam is built and waiting for its first caller.**
  `CredentialService.getDecryptedSecret(id)` (`apps/api/src/credential/credential.service.ts:48-51`)
  decrypts via `CryptoService.decrypt()` (`apps/api/src/crypto/crypto.service.ts:27-34`). **It takes
  a *credential id*, not a device id** — the executor must resolve the right credential for a device
  via `CredentialService.list(deviceId)` (`credential.service.ts:53-62`). The deferred obligation to
  wrap raw `node:crypto` "unable to authenticate data" errors in a domain error is now due
  (`context/archive/2026-06-09-encrypted-credential-store/reviews/impl-review.md:51-52`).
- **The `device`/`credential` slice is the verbatim template.** Shared contracts
  (`libs/shared/src/lib/schemas/device.schema.ts`), Drizzle table + FK + index + relations
  (`apps/api/src/database/schema/device.schema.ts:4-55`), service with `requireRow` + `toContract`
  (`apps/api/src/device/device.service.ts:9-71`), nested sub-resource controller
  (`apps/api/src/device/credential/device-credential.controller.ts`), web signal store
  (`apps/web/src/app/core/stores/devices.store.ts`), schema-validated client
  (`apps/web/src/app/core/clients/devices.client.ts`), and spartan dialog
  (`apps/web/src/app/features/devices/device-form.dialog.ts`) all map 1:1.
- **No `service`/`skill`/`container` table or contract exists anywhere** — this slice introduces the
  services domain. The only domain tables today are `device` and `credential`.
- **Config tunables flow through one path** (`env.schema.ts` Joi → `registerAs` + `Number(...)` →
  `@Inject(Config.KEY)` → override in specs) — `apps/api/src/config/device.config.ts`,
  `config/config.module.ts:14`, `config/env.schema.ts:26`.
- **Global body parser is disabled** (`apps/api/src/main.ts:11`) for Better Auth's raw-body
  catch-all; every domain module re-applies `json()` in `NestModule.configure()`
  (`apps/api/src/device/device.module.ts:14-19`).

## Desired End State

A logged-in user opens the devices view, clicks **Scan** on a device row, and sees a dialog listing
every container detected on that host (name, image, live status) with checkboxes. They select a
subset and confirm; the chosen containers are persisted as `service` rows. The device row exposes
its managed services with edit (display name) and delete actions. A scan against an unreachable
host, a host without docker, a stopped daemon, or a hung command surfaces a distinct, legible error
rather than a generic failure. Verify: scan a real device over SSH, curate a subset, edit a name,
delete a service, and trigger each of the four failure classes.

### Key Discoveries:

- `CredentialService.getDecryptedSecret(id)` takes a **credential id**, not a device id — the
  executor resolves the credential via `CredentialService.list(deviceId)` first
  (`credential.service.ts:48-51,53-62`).
- node-ssh has **no built-in per-command timeout** — use `readyTimeout` for connect and
  `Promise.race([ssh.execCommand(cmd), rejectAfter(ms)])` (clear the timer in `finally`) for the
  command (research.md:101).
- `docker ps --format '{{json .}}' --no-trunc` emits **NDJSON** (one JSON object per line) — robust
  against spaces in names that break column parsing; useful fields `.Names`, `.Image`, `.State`,
  `.Status`, `.Labels` (compose project/service live in `.Labels`) (research.md:103).
- Synology non-interactive sessions lack docker on PATH (`.claude/rules/ssh.md:8`) — a real-world
  signal that `docker` may be absent; the scan must distinguish "docker not on PATH" from "daemon
  down" by exit code / stderr.
- esbuild/Vitest drops `design:paramtypes`, so interface DI **needs an explicit token**:
  `{ provide: EXECUTOR, useClass: SshExecutor }` and `@Inject(EXECUTOR)` at every consumer
  (`lessons.md:19-24`).
- `z.strictObject` on every read/contract shape rejects any leaked column; `isoTimestamp`
  normalizes Drizzle `Date` rows and wire ISO strings (`device.schema.ts:6,11`).

## What We're NOT Doing

- **No skill-as-data model.** `scanServices` stays a private backend capability (a `docker ps` call
  through the executor); the `skill` table + agent tool-filtering is S-08's job (~6 slices
  downstream). FR-007 "hidden built-in" is the explicit signal it is hardcoded.
- **No AI-SDK / tool-calling.** No `ai`/`@ai-sdk` dependency; that lands in S-04.
- **No drift detection / reconciliation.** A managed service whose container has vanished is not
  flagged here — that is a later health skill's concern. Scan always returns fresh host state;
  managed rows are not auto-reconciled against it.
- **No instance-wide concurrent-scan cap.** Per-device serialization via mutex is the only
  concurrency control (homelab scale — a global cap is premature).
- **No editing of identity fields.** Only the display `name` is editable; `containerName` /
  `composeProject` / `composePath` are scan-derived identity. Re-targeting = delete + re-scan.
- **No connection-test-on-add** for devices (that was an S-01 aspiration; out of this slice's scope).
- **No persisted runtime facts.** Image/ports/status live only on the ephemeral scan result, never
  on the `service` row (they go stale).

## Implementation Approach

Build bottom-up so each phase is independently verifiable. **Phase 1** lands the shared contracts
that both the executor's scan-result parsing and the service domain consume. **Phase 2** builds the
executor as a cross-cutting provider module (like `CryptoModule`), exporting `IExecutor` via a DI
token, with the credential-resolution + decrypt-error-wrapping seam and the connect/auth/timeout
error taxonomy — generic SSH only, no docker knowledge. **Phase 3** adds the `service` table +
migration and the backend domain: `ServiceService.scan(deviceId)` runs `docker ps` through the
executor and interprets exit code / stderr to distinguish docker-not-found vs daemon-down (the
docker-specific half of the error taxonomy), and the CRUD persists the curated subset.
**Phase 4** wires the Angular feature: client, store, scan-and-curate dialog, and managed-services
list, reusing the S-01 store/dialog patterns.

**Error-taxonomy split** (4 distinct classes, all shaped by the global filter): connect failure and
auth failure and command timeout are **executor-level** domain errors (Phase 2); docker-not-on-PATH
and daemon-down are **ServiceService-level** interpretations of a non-zero exit + stderr from the
`docker ps` command (Phase 3).

## Critical Implementation Details

- **Interface DI needs an explicit token.** Define `export const EXECUTOR = Symbol('EXECUTOR')` (or
  a string token) and wire `{ provide: EXECUTOR, useClass: SshExecutor }`; every consumer uses
  `@Inject(EXECUTOR) private readonly executor: IExecutor`. Type-based DI resolves to `undefined`
  under Vitest (`lessons.md:19-24`).
- **node-ssh per-command timeout must be hand-rolled.** `ssh.execCommand` has no timeout option;
  race it against a timer and **clear the timer in `finally`** so a fast command doesn't leak a
  pending timeout. `dispose()` (node-ssh `ssh.dispose()`) must run in a `finally` regardless of
  success/failure/timeout — the "no run hangs indefinitely" NFR is an executor property born here.
- **Credential resolution ordering.** `getDecryptedSecret` needs a *credential id*; resolve it by
  listing the device's credentials first and picking the credential whose `authType` + `username`
  drive the node-ssh auth (password vs private key). Combine plaintext with `device.host`.
- **NULL semantics in the unique guard.** The `(deviceId, containerName)` unique index is correct
  because `containerName` is `NOT NULL`; do **not** add `composeProject` to the guard (it is
  nullable and SQLite treats NULLs as distinct, which would let standalone containers duplicate).

---

## Phase 1: Shared Contracts

### Overview

Define the four Zod contracts the rest of the slice consumes — the persisted `service` read shape,
its create/update request shapes, and the ephemeral scan result (with the inner scanned-container
shape) — and export them through the single barrel.

### Changes Required:

#### 1. Service read contract

**File**: `libs/shared/src/lib/schemas/service.schema.ts`

**Intent**: The canonical persisted `service` shape returned to clients — stable identity only, no
runtime facts. Modeled on `device.schema.ts`.

**Contract**: `serviceSchema = z.strictObject({ id: z.uuid(), deviceId: z.uuid(), name, containerName,
composeProject: nullable, composePath: nullable, createdAt: isoTimestamp, updatedAt: isoTimestamp })`;
`export type Service = z.infer<...>`. Reuse the `isoTimestamp` preprocess helper from
`device.schema.ts:6` (copy it — there is no shared util module today; keep parity with the existing
duplication in `credential.schema.ts:6`). `composeProject` / `composePath` are `z.string().nullable()`.

#### 2. Service create-request contract

**File**: `libs/shared/src/lib/schemas/service-create-request.schema.ts`

**Intent**: Request body for persisting one curated container as a managed service — identity only.

**Contract**: `z.strictObject({ deviceId: z.uuid(), name: min(1), containerName: min(1),
composeProject: nullable optional, composePath: nullable optional })`. Mirror
`device-create-request.schema.ts` custom `{ error: '...' }` messages. The web batch-add issues one
create per selected container.

#### 3. Service update-request contract

**File**: `libs/shared/src/lib/schemas/service-update-request.schema.ts`

**Intent**: Edit a managed service — display `name` only (identity fields are immutable).

**Contract**: `z.strictObject({ name: z.string().min(1) })`. (Not a `.partial()` of create — only
`name` is editable, so a closed single-field object is clearer than a partial+refine.)

#### 4. Scan result + scanned-container contract

**File**: `libs/shared/src/lib/schemas/scan-result.schema.ts`

**Intent**: The ephemeral shape `POST /devices/:id/scan` returns — every detected container with live
facts, for the curation UI only; never persisted.

**Contract**: inner `scannedContainerSchema = z.strictObject({ containerName, image, state, status,
composeProject: nullable, composePath: nullable })` (the fields parsed out of `docker ps` NDJSON);
outer `scanResultSchema = z.strictObject({ containers: scannedContainerSchema.array() })`. Export
both types via `z.infer`. The backend validates each parsed NDJSON line against
`scannedContainerSchema`.

#### 5. Barrel exports

**File**: `libs/shared/src/index.ts`

**Intent**: Surface the four new schema files through the single public barrel.

**Contract**: Add `export *` lines for `scan-result.schema`, `service-create-request.schema`,
`service-update-request.schema`, `service.schema` (alphabetical, matching the existing ordering at
`index.ts:1-11`).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx nx typecheck shared` (or `npm run build`)
- Linting passes: `npx nx lint shared`
- Shared unit tests pass: `npx nx test shared`
- Schemas are importable from `@opspilot/shared` (no relative-path imports)

#### Manual Verification:

- `serviceSchema.parse(...)` rejects an unknown key (strictObject closed) and normalizes a `Date`
  `createdAt` to an ISO string
- `scannedContainerSchema` parses a representative `docker ps --format '{{json .}}'` line

**Implementation Note**: After this phase and all automated verification passes, pause for manual
confirmation before proceeding.

---

## Phase 2: SSH Executor (cross-cutting module)

### Overview

Build the reusable SSH executor: install node-ssh + async-mutex, add SSH timeout config, define the
`IExecutor` interface behind a DI token, implement `SshExecutor` (per-device mutex, hand-rolled
command timeout, unconditional dispose, credential resolution + decrypt-error wrapping), and the
connect/auth/timeout error taxonomy. Generic SSH only — no docker knowledge here.

### Changes Required:

#### 1. Dependencies

**File**: `package.json`

**Intent**: Add the runtime SSH transport and the per-device serialization primitive.

**Contract**: Install `node-ssh` and `async-mutex` (`npm install node-ssh async-mutex`). No types
package needed (both ship their own). Run from repo root so the workspace lockfile updates.

#### 2. SSH config tunables

**Files**: `apps/api/src/config/env.schema.ts`, `apps/api/src/config/ssh.config.ts`,
`apps/api/src/config/config.module.ts`

**Intent**: Route connect/command timeouts through the config layer (never in-file `const`s —
`lessons.md:5-9`).

**Contract**: Add `SSH_CONNECT_TIMEOUT_MS` (`Joi.number().integer().min(1000).default(10000)`) and
`SSH_COMMAND_TIMEOUT_MS` (`Joi.number().integer().min(1000).default(30000)`) to `EnvConfig` +
`envSchema`. New `ssh.config.ts`: `registerAs('ssh', () => ({ connectTimeoutMs:
Number(process.env.SSH_CONNECT_TIMEOUT_MS), commandTimeoutMs:
Number(process.env.SSH_COMMAND_TIMEOUT_MS) }))` + `export type SshConfig = ConfigType<typeof
sshConfig>`. Add `sshConfig` to `config.module.ts` `load: [...]`.

#### 3. Executor interface + token + result/error types

**Files**: `apps/api/src/executor/executor.interface.ts`, `apps/api/src/executor/executor.token.ts`
(or co-locate the token in the interface file — one export per file per `nestjs.md`)

**Intent**: The transport-agnostic contract skills depend on, plus the DI token interface DI
requires, plus the domain error types for the executor-level taxonomy.

**Contract**: `interface IExecutor { execute(deviceId: string, command: string):
Promise<ExecResult> }` where `ExecResult = { stdout: string; stderr: string; code: number | null }`.
Connect and command lifecycle (`connect`/`disconnect`) are encapsulated *inside* `execute` per call
(connect → run → dispose) so callers never manage connections — the node-ssh.md `connect`/
`disconnect`/`execute` triad is satisfied internally. Token: `export const EXECUTOR =
Symbol('EXECUTOR')`. Define domain errors for **connect failure**, **auth failure**, and **command
timeout** (distinct classes — see error-taxonomy split). These extend a NestJS HTTP exception or are
mapped by the global filter to a legible message; pick the exception type that yields a sensible
status (e.g. `ServiceUnavailableException` for connect/daemon, `RequestTimeoutException` for
timeout, `BadGatewayException`/`UnauthorizedException`-style for auth — confirm against
`all-exceptions.filter.ts` shaping during implementation).

#### 4. SshExecutor implementation

**File**: `apps/api/src/executor/ssh.executor.ts`

**Intent**: node-ssh-backed `IExecutor`: resolve the device's credential, connect with auth + connect
timeout, run the command under a per-device mutex with a hand-rolled command timeout, and always
dispose.

**Contract**: `@Injectable() class SshExecutor implements IExecutor`. Inject `@Inject(sshConfig.KEY)`,
`@Inject(CredentialService)`, `@Inject(DeviceService)` (to resolve `device.host`) — all explicit
tokens. Hold `private readonly mutexes = new Map<string, Mutex>()`; `execute` does
`mutex(deviceId).runExclusive(async () => { ... })`. Inside: resolve credential via
`credentialService.list(deviceId)` (pick the credential; combine `username`/`authType` +
`getDecryptedSecret(credential.id)` + `device.host`), `new NodeSSH().connect({ host, username,
[password|privateKey], readyTimeout: connectTimeoutMs })`, then
`Promise.race([ssh.execCommand(command), rejectAfter(commandTimeoutMs)])`, `finally { clearTimeout;
ssh.dispose() }`. Map node-ssh connect/auth rejections to the connect/auth domain errors; the race
rejection to the timeout error. **Wrap the `getDecryptedSecret` `node:crypto` "unable to
authenticate data" error in a domain error here** (discharges the F1 deferred obligation —
`impl-review.md:51-52`).

#### 5. Executor module

**File**: `apps/api/src/executor/executor.module.ts`

**Intent**: Cross-cutting provider module exporting the executor via its token, so feature modules
import it and depend on the interface (fakeable in tests).

**Contract**: `@Module({ imports: [CredentialModule, DeviceModule-or-DeviceService-provider],
providers: [{ provide: EXECUTOR, useClass: SshExecutor }], exports: [EXECUTOR] })`. Resolve the
`DeviceService` dependency cleanly — either import a module that exports it or add the host-lookup
seam; confirm `DeviceModule` exports `DeviceService` (today it does not — add `exports:
[DeviceService]` to `device.module.ts` if the executor needs it, or inject the DB connection +
`device` table directly). Prefer importing `CredentialModule` (already exports `CredentialService`).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx nx typecheck api`
- Linting passes: `npx nx lint api`
- API unit tests pass: `npx nx test api` — including a new `ssh.executor.spec.ts` that fakes the
  transport / credential service and asserts: per-device serialization (two concurrent `execute`
  calls on one device do not interleave), command timeout rejects with the timeout domain error,
  `dispose()` runs on both success and failure paths, and a decrypt failure surfaces the wrapped
  domain error (not a raw `node:crypto` error)
- Bad SSH timeout env value fails fast at boot (covered by `env.schema.spec.ts` style assertion)

#### Manual Verification:

- `execute(deviceId, 'echo hi')` against a real reachable device returns stdout `hi`
- Pointing at an unreachable host yields the connect error within ~connect-timeout, not a hang
- A deliberately long command (`sleep 60`) is killed at ~command-timeout with the timeout error
- A device with a wrong stored secret yields the auth/decrypt error, legibly

**Implementation Note**: After this phase and all automated verification passes, pause for manual
confirmation before proceeding.

---

## Phase 3: Service Domain (backend)

### Overview

Add the `service` table + migration and the backend domain: the scan capability
(`docker ps` through the executor → NDJSON parse → docker-error interpretation) and the curated-subset
CRUD, exposed nested under `/devices/:id`.

### Changes Required:

#### 1. Drizzle table + relations

**File**: `apps/api/src/database/schema/service.schema.ts` (+ barrel
`apps/api/src/database/schema/index.ts`)

**Intent**: Persist the curated managed-services subset, scoped to a device with cascade delete.

**Contract**: `service` table mirroring `credential` (`device.schema.ts:17-44`): `id` text PK,
`deviceId` text FK → `device.id` `onDelete: 'cascade'`, `name`, `containerName` (notNull),
`composeProject` (nullable), `composePath` (nullable), `createdAt`/`updatedAt` `timestamp_ms` with
the `unixepoch` default + `$onUpdate`. Table extras: `index('service_deviceId_idx').on(deviceId)` +
`uniqueIndex('service_device_container_unq').on(deviceId, containerName)`. Add a `serviceRelations`
block (`one(device)`) and a `services: many(service)` line to `deviceRelations`. Export from the
schema barrel.

#### 2. Migration

**File**: `apps/api/src/database/migrations/*.sql` (generated)

**Intent**: Create the `service` table + indexes against the schema barrel.

**Contract**: Run drizzle-kit generate (the project's existing generate target) so the migration is
applied at boot by `migration.service.ts`. Do not hand-write the SQL; generate from the schema.

#### 3. Service domain service

**File**: `apps/api/src/service/service.service.ts`

**Intent**: All service logic — scan (ephemeral) and CRUD (persisted) — following the
`device.service.ts` template (`requireRow`, `toContract` + `schema.parse`, `randomUUID` ids).

**Contract**: `@Injectable() class ServiceService`, inject `@Inject(DATABASE_CONNECTION)` and
`@Inject(EXECUTOR)`. Methods:

- `scan(deviceId): Promise<ScanResult>` — run `docker ps --format '{{json .}}' --no-trunc` via the
  executor; split stdout on newlines, `JSON.parse` + `scannedContainerSchema.parse` each non-empty
  line; map compose project/path out of the container's `.Labels`
  (`com.docker.compose.project` / `com.docker.compose.project.config_files`). **Interpret the
  docker-specific errors** (the ServiceService half of the taxonomy): non-zero exit + stderr
  containing "command not found"/"not found" → docker-not-on-PATH domain error; stderr containing
  "Cannot connect to the Docker daemon" → daemon-down domain error. Connect/auth/timeout already
  arrive as executor domain errors and propagate.
- `findAll(deviceId)`, `create(input)`, `update(deviceId, id, {name})`, `remove(deviceId, id)` —
  device-scoped (the `:deviceId` path param is source of truth; cross-device access yields 404,
  mirroring `credential.service.ts:67-77`). `create` relies on the unique index to reject a
  duplicate container (map the SQLite unique-constraint error to a legible `ConflictException`).
- `toContract(row)` projects explicit safe fields and runs `serviceSchema.parse(...)`.

#### 4. Service controller (nested sub-resource)

**File**: `apps/api/src/service/service.controller.ts`

**Intent**: Thin HTTP boundary nested under the device, mirroring `DeviceCredentialController`.

**Contract**: `@Controller('devices/:deviceId/services')` (plus the scan route). Routes:
`POST devices/:deviceId/scan` (separate controller method or a second `@Controller('devices/:deviceId')`
— pick one; the scan path is a sibling of `services`, so a dedicated method on a controller mounted
at `devices/:deviceId` is cleanest) → `scan(deviceId)`; `GET services` → `findAll`; `POST services`
(`ZodValidationPipe(serviceCreateRequestSchema)`, reject body whose `deviceId` ≠ path param like
`device-credential.controller.ts:39`) → `create`; `PATCH services/:serviceId`
(`ZodValidationPipe(serviceUpdateRequestSchema)`) → `update`; `DELETE services/:serviceId`
(`@HttpCode(NO_CONTENT)`) → `remove`. Inject `@Inject(ServiceService)`.

#### 5. Service module + app wiring

**Files**: `apps/api/src/service/service.module.ts`, `apps/api/src/app/app.module.ts`

**Intent**: Register the domain module, re-apply the JSON body parser, and add it to the app.

**Contract**: `@Module({ controllers: [...], imports: [ExecutorModule], providers: [ServiceService]
})` implementing `NestModule` with `configure()` applying `json()` to the service controllers
(`device.module.ts:14-19` pattern). Add `ServiceModule` to `app.module.ts` `imports`.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly at boot (covered by the service spec booting `MigrationService`)
- Type checking passes: `npx nx typecheck api`
- Linting passes: `npx nx lint api`
- API unit tests pass: `npx nx test api` — new `service.service.spec.ts` (real SQLite in tmpdir,
  faked `IExecutor` via `.overrideProvider(EXECUTOR).useValue(...)`) asserting: scan parses NDJSON
  into `ScanResult`; docker-not-found and daemon-down stderr map to their distinct errors; CRUD
  round-trips through `toContract`; a duplicate `(deviceId, containerName)` create yields a
  conflict; cross-device `update`/`remove`/`findAll` yields 404. New `service.controller.spec.ts`
  (guard overridden) asserting body-vs-path `deviceId` mismatch is rejected
- E2E (optional, if the slice adds one): scan + create + list + delete over supertest

#### Manual Verification:

- `POST /devices/:id/scan` against a real device returns the live container list
- The four error classes each return a distinct, legible message body (connect, timeout,
  docker-not-on-PATH, daemon-down)
- A persisted `service` row carries no runtime status; re-scanning does not mutate managed rows

**Implementation Note**: After this phase and all automated verification passes, pause for manual
confirmation before proceeding.

---

## Phase 4: Web Feature

### Overview

Wire the Angular feature: a schema-validated services client, a signal store with mutate-then-refetch
and batch-add, a scan-and-curate dialog (multi-select of detected containers), and the managed
services list (edit name, delete) integrated into the devices view.

### Changes Required:

#### 1. Services client

**File**: `apps/web/src/app/core/clients/services.client.ts`

**Intent**: Typed HTTP I/O against the scan + services endpoints, validating every response against
the shared contract (`devices.client.ts` pattern).

**Contract**: `@Injectable() class ServicesClient` injecting `HttpClient`. Methods: `scan(deviceId)`
→ `POST /api/devices/:id/scan` → `scanResultSchema.parse`; `listServices(deviceId)` →
`serviceSchema.array().parse`; `createService(deviceId, input)` → `serviceSchema.parse`;
`updateService(deviceId, serviceId, {name})` → `serviceSchema.parse`;
`removeService(deviceId, serviceId)` → void. All via `firstValueFrom` + `.then(parse)`.

#### 2. Services store

**File**: `apps/web/src/app/core/stores/services.store.ts`

**Intent**: Per-device signal state with mutate-then-refetch and batch-add, mirroring
`devices.store.ts` (`@Injectable()` without `providedIn: 'root'`, `signalState` + `patchState`,
`errorMessage` helper reading `apiErrorSchema`).

**Contract**: State `{ services: Service[]; scan: ScannedContainer[] | null; error; loading }`.
Methods: `load(deviceId)`, `runScan(deviceId)` (populates the ephemeral scan signal), `addSelected
(deviceId, ScannedContainer[])` — issues one `createService` per selected container, **handling
partial failure** (report which containers failed, refetch the list on completion), `rename(deviceId,
id, name)`, `remove(deviceId, id)`. Each returns `{ error: null | string }` (the
`DeviceActionResult` shape).

#### 3. Scan-and-curate dialog

**File**: `apps/web/src/app/features/services/scan-services.dialog.ts` (+ `.html`)

**Intent**: The curation UI — list detected containers with checkboxes + live facts, persist the
selected subset on confirm.

**Contract**: `OnPush` spartan dialog (helm dialog + checkbox/table + button). Receives the device +
store via dialog **context** (not DI — renders in a CDK overlay, per
`device-form.dialog.ts:17-22`). On open, triggers `store.runScan`; renders each
`ScannedContainer` (name, image, status) with a checkbox; confirm calls `store.addSelected` with the
checked rows and closes on success (surfacing partial-failure messages). `hlmDialogTitle` required
(sr-only if hidden, per `spartan.md`).

#### 4. Managed services list + devices view integration

**Files**: `apps/web/src/app/features/services/*` (a services list component or section) and the
devices view (`apps/web/src/app/features/devices/devices.component.*`)

**Intent**: Expose a **Scan** action per device row and surface its managed services with edit-name
and delete actions, reusing the spartan table + alert-dialog patterns from `devices.component.ts`.

**Contract**: Add a Scan button to each device row that opens the scan dialog (provide
`ServicesClient` + `ServicesStore` alongside the existing `DevicesClient`/`DevicesStore` at the
feature component, per `devices.component.ts:23`). Surface managed services (table with name +
container + edit/delete) — either an expandable section per device or a per-device services view;
keep components under the ~150-line threshold (`angular.md`), splitting if needed. Edit opens a small
name-only form; delete uses the alert-dialog confirm pattern (`devices.component.ts:39-58`).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx nx typecheck web` (or `npm run build:web`)
- Linting passes: `npx nx lint web`
- Web unit tests pass: `npx nx test web` — store spec asserting mutate-then-refetch, batch-add
  partial-failure handling, and rollback-free error surfacing; client spec asserting schema parse
  at the boundary
- Format check passes: `npm run format:check`

#### Manual Verification:

- Clicking **Scan** on a device row opens the dialog and lists live containers
- Selecting a subset and confirming persists exactly those as managed services; the list refreshes
- Editing a service name updates it; deleting removes it (with confirm)
- A scan against an unreachable host / docker-less host / stopped daemon shows the distinct,
  legible error in the dialog
- Partial batch-add failure (e.g. one duplicate) surfaces which container failed without losing the
  successful ones

**Implementation Note**: After this phase and all automated verification passes, pause for manual
confirmation. This is the final phase — confirm the full scan → curate → manage flow end to end.

---

## Testing Strategy

### Unit Tests:

- **Executor** (`ssh.executor.spec.ts`): per-device mutex serialization; command timeout →
  timeout error; `dispose()` on success + failure; decrypt failure → wrapped domain error;
  connect/auth rejection mapping. Fake the node-ssh transport + `CredentialService`/`DeviceService`.
- **ServiceService** (`service.service.spec.ts`, real SQLite + faked `IExecutor`): NDJSON parse;
  docker-not-found vs daemon-down stderr mapping; CRUD round-trip; duplicate-container conflict;
  cross-device 404.
- **ServiceController** (`service.controller.spec.ts`, guard overridden): body-vs-path `deviceId`
  mismatch rejection; route wiring.
- **Shared**: strictObject rejects unknown keys; `isoTimestamp` normalizes Date → ISO;
  `scannedContainerSchema` parses a representative NDJSON line.
- **Web**: store mutate-then-refetch + batch-add partial failure; client schema parse at boundary.

### Integration Tests:

- Optional supertest E2E for the nested service routes (scan with a faked executor + CRUD), per
  `nestjs-testing.md` E2E guidance.

### Manual Testing Steps:

1. Scan a real reachable device → verify the live container list renders.
2. Curate a subset → verify exactly those persist as managed services.
3. Edit a name, delete a service → verify each.
4. Scan an unreachable host → connect error within ~10s (not a hang).
5. Scan a host without docker on PATH → docker-not-found error.
6. Scan a host with a stopped daemon → daemon-down error.
7. Run a long command through the executor (test seam) → killed at ~30s with timeout error.

## Performance Considerations

- The per-device mutex serializes SSH work per device but leaves different devices concurrent
  (`node-ssh.md:19-21`) — correct for homelab scale; no instance-wide cap.
- `docker ps` is cheap; the 30s command timeout is generous headroom. Connect timeout (10s) bounds
  the unreachable-host wait so the UI fails fast.
- Each `execute` opens and disposes a fresh connection (no pooling) — simplest correct behavior at
  this scale; connection reuse is a later optimization if scan latency ever matters.

## Migration Notes

- The `service` table is additive; the drizzle-kit migration is applied at boot by
  `migration.service.ts` with the existing backup gate. No data backfill (no prior services).
- On Windows, if archiving/moving the change folder later fails with `Permission denied`, run
  `npx nx reset` first (`lessons.md:26-31`).

## References

- Related research: `context/changes/scan-and-add-services/research.md`
- Executor rule: `.claude/rules/node-ssh.md:7-25`
- Service template: `apps/api/src/device/device.service.ts:9-71`
- Nested sub-resource controller: `apps/api/src/device/credential/device-credential.controller.ts`
- Credential/crypto seam: `apps/api/src/credential/credential.service.ts:48-62`,
  `apps/api/src/crypto/crypto.service.ts:27-34`
- Config tunable pattern: `apps/api/src/config/device.config.ts`, `config/env.schema.ts:26`,
  `config/config.module.ts:14`
- Web patterns: `apps/web/src/app/core/stores/devices.store.ts`,
  `core/clients/devices.client.ts`, `features/devices/device-form.dialog.ts`
- Deferred decrypt-error obligation:
  `context/archive/2026-06-09-encrypted-credential-store/reviews/impl-review.md:51-52`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared Contracts

#### Automated

- [x] 1.1 Type checking passes (`npx nx typecheck shared` / `npm run build`) — 57fbbb6
- [x] 1.2 Linting passes (`npx nx lint shared`) — 57fbbb6
- [x] 1.3 Shared unit tests pass (`npx nx test shared`) — 57fbbb6
- [x] 1.4 Schemas importable from `@opspilot/shared` (no relative imports) — 57fbbb6

#### Manual

- [x] 1.5 `serviceSchema` rejects unknown key + normalizes Date → ISO — 57fbbb6
- [x] 1.6 `scannedContainerSchema` parses a representative `docker ps` NDJSON line — 57fbbb6

### Phase 2: SSH Executor

#### Automated

- [x] 2.1 Type checking passes (`npx nx typecheck api`) — 5a4cf28
- [x] 2.2 Linting passes (`npx nx lint api`) — 5a4cf28
- [x] 2.3 API unit tests pass incl. `ssh.executor.spec.ts` (serialization, timeout, dispose, wrapped decrypt error) — 5a4cf28
- [x] 2.4 Bad SSH timeout env value fails fast at boot — 5a4cf28

#### Manual

- [x] 2.5 `execute(deviceId, 'echo hi')` against a real device returns `hi` — 5a4cf28
- [x] 2.6 Unreachable host → connect error within ~connect-timeout (no hang) — 5a4cf28
- [x] 2.7 Long command killed at ~command-timeout with timeout error — 5a4cf28
- [x] 2.8 Wrong stored secret → legible auth/decrypt error — 5a4cf28

### Phase 3: Service Domain (backend)

#### Automated

- [x] 3.1 Migration applies cleanly at boot — 196a3a1
- [x] 3.2 Type checking passes (`npx nx typecheck api`) — 196a3a1
- [x] 3.3 Linting passes (`npx nx lint api`) — 196a3a1
- [x] 3.4 API unit tests pass incl. `service.service.spec.ts` + `service.controller.spec.ts` (NDJSON parse, docker-error mapping, CRUD, duplicate conflict, cross-device 404, body-vs-path mismatch) — 196a3a1

#### Manual

- [x] 3.5 `POST /devices/:id/scan` against a real device returns live container list — 196a3a1
- [x] 3.6 Four error classes each return a distinct legible body — 196a3a1
- [x] 3.7 Persisted `service` row carries no runtime status; re-scan does not mutate managed rows — 196a3a1

### Phase 4: Web Feature

#### Automated

- [x] 4.1 Type checking passes (`npx nx typecheck web` / `npm run build:web`) — d39166a
- [x] 4.2 Linting passes (`npx nx lint web`) — d39166a
- [x] 4.3 Web unit tests pass (store mutate-then-refetch + batch-add partial failure; client schema parse) — d39166a
- [x] 4.4 Format check passes (`npm run format:check`) — d39166a

#### Manual

- [x] 4.5 Scan opens dialog and lists live containers — d39166a
- [x] 4.6 Curated subset persists exactly; list refreshes — d39166a
- [x] 4.7 Edit name + delete (with confirm) work — d39166a
- [x] 4.8 Unreachable / docker-less / stopped-daemon scan shows distinct legible error — d39166a
- [x] 4.9 Partial batch-add failure surfaces the failed container without losing successes — d39166a
