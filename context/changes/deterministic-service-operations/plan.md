# Deterministic Service Operations (S-06) Implementation Plan

## Overview

Add 5 fixed, non-LLM lifecycle operations (`start`, `stop`, `restart`, `up`, `down`) that a user
runs on a managed service over SSH and sees confirmed in the UI. The slice rides the existing
execution seam (`IExecutor.execute` → per-device mutex, timeouts, no-hang `finally`) and the mature
device → services web surface — it adds *commands and contracts*, not infrastructure. The
load-bearing work is three things the frame brief fixed: (a) a synchronous confirmation model with a
dedicated long op-timeout so a slow `up -d` (image pulls) finishes inside a finite bound instead of
tripping the 30 s SSH command timeout; (b) a compose-vs-standalone command-form branch with
injection-guarded interpolation of `composePath`/`composeProject`; (c) a destructive-`down` confirm
plus extracting the op surface out of `DeviceServicesComponent`. `run_record` generalization is
explicitly **out of scope** — ephemeral confirmation only.

## Current State Analysis

- **Execution seam is real and verified.** `IExecutor.execute(deviceId, command)` connects → runs
  under a per-device `async-mutex` → races the command against `SSH_COMMAND_TIMEOUT_MS` (default
  30 s) → always disposes (`ssh.executor.ts:30-32,58-79`). A non-zero exit is **not** an executor
  error — it returns in `ExecResult.code` for the caller to interpret; only transport/connect/auth/
  timeout/decrypt failures throw (`executor.interface.ts:4-16`, `executor.errors.ts:16-42`).
- **The command timeout is baked into `run()`** as `this.config.commandTimeoutMs`
  (`ssh.executor.ts:58-63`). A 5-minute `up -d` would hit this 30 s ceiling first → 504. The
  diagnose `fetchLogs` races a *shorter* per-command timeout in the service (`diagnose.service.ts:
  152-179`); that pattern does **not** extend to a *longer* op timeout, because the executor's inner
  30 s race fires before any longer service-level race.
- **Two-layer error model.** Executor half (connect/auth/timeout/decrypt → 5xx, `executor.errors.ts`)
  vs docker half (`ServiceService.mapDockerError`, `service.service.ts:113-121`): daemon-down regex
  first, then `code === 127 || /not found/i` → `DockerNotFoundError`, else generic 503. `mapDockerError`
  is `private` with a hardcoded `docker ps failed` message; `DiagnoseService.mapLogsError`
  (`diagnose.service.ts:202-217`) is the precedent for a per-service copy of this mapper.
- **Command + PATH-prefix pattern.** `SCAN_COMMAND` (`service.service.ts:27-29`) prefixes the
  Synology `PATH` then runs docker; the 5 ops follow the same shape. `containerNameSchema`
  (`container-name.schema.ts:9-12`) closes the injection class for `containerName` and is re-parsed
  at the command boundary (`diagnose.service.ts:157`). **`composePath`/`composeProject` are
  `z.string().nullable()` with no charset constraint** (`service.schema.ts:15-16`), populated raw from
  docker labels (`service.service.ts:128-134`) — a new, unguarded injection surface.
- **Device scoping.** `requireRow(deviceId, id)` → 404 on a cross-device id, never a cross-device
  mutation (`service.service.ts:156-168`); `ServiceService.findOne` resolves a row and carries
  `containerName`/`composePath`/`composeProject`.
- **Config-layer tunables.** Op timeout goes through `env.schema.ts` (Joi) + a `registerAs` factory
  (`ssh.config.ts` pattern), never a const (`lessons.md`).
- **Web surface is mature.** The actions cell (`device-services.component.html:30-51`) holds
  Diagnose/Edit/Delete; the Diagnose button's `[disabled]="diag.loading"` + label flip
  (`:31-40`) is exactly the < 10 s confirmation affordance. `diagnosis.store.ts` is the
  serviceId-keyed mutate-then-confirm template; `services.client.ts:21-49` is the parse-at-boundary
  HTTP client template (plain `HttpClient` gets 401 interception for free). The destructive confirm
  is an `<hlm-alert-dialog>` driven by a `serviceToDelete` signal (`device-services.component.ts:
  53,82-88,115-118`). `DeviceServicesComponent` is 119 lines TS — near the ~150-line angular.md
  budget, so the op surface must extract rather than inline.

## Desired End State

A user opens a device's services, and each managed service row exposes lifecycle buttons:
`Start`/`Stop`/`Restart` on every service, plus `Up`/`Down` only on compose-managed services. Clicking
a non-destructive op fires immediately, disables the button with a `Running…` label, and shows a
short success/failure line within a finite time. `Down` first asks for confirmation in a modal
(it removes containers + the network). A slow `up -d` that pulls images completes inside the
dedicated op timeout (default 5 min) instead of failing at 30 s. Interpolated compose fields are
charset-validated at the command boundary, so a malformed label can never inject a shell command.
No run is persisted; nothing touches `run_record`.

Verify: trigger each op against a live device, observe confirmation; trigger `up -d` on a service
whose image must be pulled and watch it finish past 30 s; attempt `up`/`down` on a standalone
service and see the buttons absent (and the API reject a forged request); confirm `DeviceServicesComponent`
stays within the line budget.

### Key Discoveries:

- Executor command timeout is internal and fixed (`ssh.executor.ts:58-63`) — supporting a longer
  synchronous op **requires** a per-call timeout override on `IExecutor.execute`, not a service-level
  race. **This is the single load-bearing implementation detail.**
- `composePath`/`composeProject` are unconstrained free text from labels (`service.schema.ts:15-16`,
  `service.service.ts:128-134`); `containerNameSchema` (`container-name.schema.ts:9-12`) is the exact
  mitigation pattern to mirror, re-parsed at the boundary (`diagnose.service.ts:157`).
- `DiagnoseService.mapLogsError` (`diagnose.service.ts:202-217`) shows the house style: a per-service
  private docker-error mapper, not a shared generalization — mirror it, do not abstract.
- The run contracts were named neutrally but **explicitly not abstracted** until a real second-skill
  shape exists (`live-narration-and-replay/plan.md:14,92-95`); the frame defers that to S-09, so this
  slice leaves `run_record` untouched.

## What We're NOT Doing

- **No `run_record` generalization / discriminated union** — no persistence of operation runs, no
  audit link. Ephemeral confirmation only; deferred to S-09/FR-011.
- **No SSE / streaming / polling** for op status — synchronous request/response per the frame's
  carried-forward decision.
- **No skill-as-data table** (S-08) — the 5 ops are hardcoded command templates, like `diagnoseLogs`
  and `scanServices`.
- **No bulk operations** (PRD non-goal, v2) — one service per op.
- **No per-device concurrency change** — ops serialize through the existing mutex; a slow `up -d`
  holding the device mutex is accepted (single-operator homelab, frame hypothesis 5 ruled out).
- **No retightening of `serviceSchema`/`scannedContainerSchema`** compose fields — charset validation
  applies only as a boundary re-parse in the op path (avoids breaking scan/add of legitimately-odd
  paths; defense-in-depth mirrors `containerName`).
- **No new auth guard** — the global `authGuard` already covers the route subtree.

## Implementation Approach

Mirror the diagnose slice's shape, minus the LLM and streaming halves. A new `operation/` feature
module (sibling of `diagnose/`) owns the op service, controller, and its private docker-error mapper.
The op service resolves the row via `ServiceService.findOne`, builds the command (compose vs
standalone branch, charset re-parse at the boundary), runs it through the executor with the dedicated
op timeout, and maps the result to `{ operation, status, message }`. The operation enum lives once in
`@opspilot/shared` as the runtime guardrail. The web side extracts a thin `app-service-operations`
component (own client + store, serviceId-keyed) into the existing actions cell.

## Critical Implementation Details

- **Executor timeout override (load-bearing, ordering).** The synchronous long-op model only works if
  the executor's per-command timeout is overridable per call. Add an optional third arg to
  `IExecutor.execute(deviceId, command, timeoutMs?)`; in `SshExecutor.run`, the timeout race uses
  `timeoutMs ?? this.config.commandTimeoutMs`, so existing callers (`scan`, `fetchLogs`) keep the 30 s
  default unchanged. The op service passes `OP_TIMEOUT_MS`. Without this change a slow `up -d` fails at
  30 s regardless of any service-level wrapper.
- **Result vs error split.** Executor failures (connect/auth/timeout/decrypt) propagate as 5xx and
  never reach a result. Docker *infrastructure* failures (daemon-down, docker-not-found via the
  daemon-regex / `code === 127`) throw a 503 like `scan`. A command that ran but exited non-zero for an
  *op-specific* reason (e.g. "no such container", a compose config error) returns
  `{ status: 'failed', message: <cleaned stderr> }` — this is what gives the contract's `'failed'`
  real meaning, distinct from infra unavailability. `code === 0` → `{ status: 'succeeded' }`.
- **Compose command form.** Compose ops pass both `-f <composePath>` and `-p <composeProject>` so the
  project name is not silently re-derived from the file's directory. Both fields are interpolated →
  both are re-parsed through their charset schema at the boundary before the command string is built.

## Phase 1: Foundation — contracts, config, executor timeout override

### Overview

Lay the shared contracts, the op-timeout config var, and the executor signature change. No new
runtime behavior — these are the rails Phases 2–3 consume.

### Changes Required:

#### 1. Operation enum + request + result contracts

**File**: `libs/shared/src/lib/schemas/service-operation.schema.ts` (operation enum + result),
`libs/shared/src/lib/schemas/service-operation-request.schema.ts` (request), barrel
`libs/shared/src/index.ts`

**Intent**: Define the 5-op enum as the single runtime guardrail ("predefined skills only"), the
request body the controller validates, and the result envelope the UI renders. One export per file
(`zod.md`), lowercase-literal enum mirroring `diagnosisSynthesisSchema` (`diagnosis-synthesis.schema.ts:11-16`).

**Contract**: `serviceOperationSchema = z.enum(['start','stop','restart','up','down'])`;
`serviceOperationResultSchema = z.strictObject({ operation: serviceOperationSchema, status: z.enum(['succeeded','failed']), message: z.string() })`;
`serviceOperationRequestSchema = z.strictObject({ operation: serviceOperationSchema })`. Export each
plus its `z.infer` type through the barrel.

#### 2. Compose-field charset schemas

**File**: `libs/shared/src/lib/schemas/compose-project.schema.ts`,
`libs/shared/src/lib/schemas/compose-path.schema.ts`, barrel `libs/shared/src/index.ts`

**Intent**: Close the injection class for the two compose fields interpolated into the shell command,
exactly as `containerNameSchema` does for `containerName`. Used only as a boundary re-parse in the op
path — `serviceSchema`/`scannedContainerSchema` stay unchanged.

**Contract**: `composeProjectSchema` — docker compose project charset, lowercase: `^[a-z0-9][a-z0-9_-]*$`.
`composePathSchema` — a filesystem path with no shell metacharacters: `^[a-zA-Z0-9/._-]+$` (allows
`/ . _ -` and alphanumerics; rejects space, `; | & $`, backtick, quotes, redirects). Both `z.string().min(1)`
with v4 `error` messages. Export both + `z.infer` types via the barrel.

#### 3. `OP_TIMEOUT_MS` config var

**File**: `apps/api/src/config/env.schema.ts` (Joi + `EnvConfig`), `apps/api/src/config/operation.config.ts`
(new `registerAs('operation', ...)` factory), wherever `ConfigModule.forRoot({ load: [...] })` registers
factories

**Intent**: A dedicated long bound for synchronous ops (`up -d` image pulls exceed 30 s), config-layer
not a const (`lessons.md`); precedent `LLM_DIAGNOSE_LOGS_TIMEOUT_MS` (`env.schema.ts:40-41`).

**Contract**: `OP_TIMEOUT_MS: Joi.number().integer().min(1000).default(300000)` added to `EnvConfig` +
`envSchema`. `operationConfig = registerAs('operation', () => ({ timeoutMs: Number(process.env.OP_TIMEOUT_MS) }))`
mirroring `ssh.config.ts:6-9`. Add `operationConfig` to the `load` array.

#### 4. Executor per-call timeout override

**File**: `apps/api/src/executor/executor.interface.ts`, `apps/api/src/executor/ssh.executor.ts`,
any test fake implementing `IExecutor`

**Intent**: Make the per-command timeout overridable so a long op can outlast the 30 s default while
`scan`/`fetchLogs` keep it. The default-arg behavior is the backward-compat guarantee.

**Contract**: `IExecutor.execute(deviceId: string, command: string, timeoutMs?: number): Promise<ExecResult>`.
In `SshExecutor.run`, thread the optional `timeoutMs` through and use `timeoutMs ?? this.config.commandTimeoutMs`
in the `SshCommandTimeoutError` race (`ssh.executor.ts:58-63`). Existing call sites pass no third arg.

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes: `npx nx run-many -t typecheck` (or `npm run build`)
- [ ] Lint passes: `npm run lint`
- [ ] Shared unit tests pass: `npx nx test shared`
- [ ] API unit tests pass (executor fake + config still resolve): `npx nx test api`
- [ ] New schemas are exported from the barrel (import resolves in a `z.infer` use site)

#### Manual Verification:

- [ ] `OP_TIMEOUT_MS` is documented alongside the other env vars and boots with its default
- [ ] Existing scan/diagnose flows still run (no regression from the executor signature change)

**Implementation Note**: After Phase 1 automated verification passes, pause for manual confirmation
before Phase 2.

---

## Phase 2: Backend — operation execution

### Overview

A new `operation/` module executes a validated op against a resolved row: build the command (compose
vs standalone branch + charset re-parse), run it with the op timeout, map the result. End-to-end
testable from the API alone.

### Changes Required:

#### 1. Operation service + command builder

**File**: `apps/api/src/operation/operation.service.ts`

**Intent**: Resolve the row (`ServiceService.findOne` → 404 + carries identity fields), gate up/down to
compose-managed services, build the PATH-prefixed command, run it through the executor with
`OP_TIMEOUT_MS`, and map the exit to a result. Mirror `DiagnoseService` structure minus LLM/SSE.

**Contract**: `run(deviceId, serviceId, operation): Promise<ServiceOperationResult>`. Steps: (1)
`findOne` to resolve `containerName`/`composePath`/`composeProject`; (2) if `operation` is `up`/`down`
and either compose field is null → `BadRequestException` ("operation <op> requires a compose-managed
service"); (3) re-parse `containerNameSchema.parse(containerName)` and, for compose ops,
`composePathSchema.parse(composePath)` + `composeProjectSchema.parse(composeProject)` at the boundary;
(4) build command — container-scoped `docker start|stop|restart <containerName>`, compose-scoped
`docker compose -f <composePath> -p <composeProject> up -d` / `down`, both behind the Synology PATH
prefix (`service.service.ts:27-28`); (5) `executor.execute(deviceId, command, operationConfig.timeoutMs)`;
(6) on `code === 0` → `{ operation, status: 'succeeded', message }`, else map via the private docker
mapper (throw infra 503, or return `{ status: 'failed', message: cleaned stderr }`). Inject via explicit
`@Inject` tokens (`lessons.md`): `EXECUTOR`, `ServiceService`, `operationConfig.KEY`.

#### 2. Operation docker-error mapper

**File**: `apps/api/src/operation/operation.service.ts` (private method) — reuse `service.errors.ts`

**Intent**: Interpret a non-zero op exit. Mirror `DiagnoseService.mapLogsError` (`diagnose.service.ts:
202-217`): daemon-down regex → `DockerDaemonDownError` (503), `code === 127` → `DockerNotFoundError`
(503); anything else is an op-specific failure → returned as `status: 'failed'`, not thrown.

**Contract**: `private classifyExit(deviceId, code, stderr): DockerDaemonDownError | DockerNotFoundError | { message }`
— throw the two infra errors, return a cleaned message for the rest. Reuse the existing
`DockerDaemonDownError`/`DockerNotFoundError` from `service.errors.ts`.

#### 3. Operation controller

**File**: `apps/api/src/operation/operation.controller.ts`

**Intent**: Thin HTTP boundary nested under the service, mirroring `DiagnoseController` thinness and
`ServiceController`'s `ZodValidationPipe` body validation.

**Contract**: `@Controller('devices/:deviceId/services/:serviceId')` with
`@Post('operations')` → `run(@Param deviceId, @Param serviceId, @Body(new ZodValidationPipe(serviceOperationRequestSchema)) body)`
returning `Promise<ServiceOperationResult>`. Delegates straight to `OperationService.run`.

#### 4. Operation module wiring

**File**: `apps/api/src/operation/operation.module.ts`, app root module imports

**Intent**: Wire the module like `ServiceModule`/`DiagnoseModule` — import `ServiceModule` (for
`ServiceService`) and `ExecutorModule` (for `EXECUTOR`), re-apply `json()` middleware for the POST
body (the global body parser is disabled for better-auth, `service.module.ts:17-22`).

**Contract**: `@Module({ controllers: [OperationController], imports: [ServiceModule, ExecutorModule], providers: [OperationService] })`
implementing `NestModule.configure` to `apply(json()).forRoutes(OperationController)`. Register the
module in the app root.

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes: `npm run build`
- [ ] Lint passes: `npm run lint`
- [ ] API unit tests pass: `npx nx test api`
- [ ] Unit test: up/down on a service with null compose fields → 400
- [ ] Unit test: a malformed `composePath`/`composeProject` is rejected at the boundary (no command built)
- [ ] Unit test: `code === 0` → `succeeded`; op-specific non-zero → `failed` with message; daemon-down/127 → 503

#### Manual Verification:

- [ ] `start`/`stop`/`restart` on a standalone container confirm against a live device
- [ ] `up -d` on a compose service whose image must be pulled completes past 30 s (proves the op timeout)
- [ ] `down` on a compose service stops + removes its containers
- [ ] Forged `up`/`down` on a standalone service (direct API call) is rejected with 400
- [ ] A cross-device `serviceId` yields 404 (device scoping intact)

**Implementation Note**: After Phase 2 automated verification passes, pause for manual confirmation
before Phase 3.

---

## Phase 3: Web — operation surface

### Overview

Extract a thin `app-service-operations` component (own client + store, serviceId-keyed) holding the 5
op buttons, the `down` confirm modal, and the result line; drop it into the existing actions cell so
`DeviceServicesComponent` stays within budget.

### Changes Required:

#### 1. Operations HTTP client

**File**: `apps/web/src/app/core/clients/service-operations.client.ts`

**Intent**: Single request/response client mirroring `services.client.ts:21-49` — parse the result at
the boundary. Plain `HttpClient` so 401 interception applies (`auth.interceptor.ts`).

**Contract**: `run(deviceId, serviceId, operation): Promise<ServiceOperationResult>` =
`firstValueFrom(http.post<unknown>('/api/devices/${deviceId}/services/${serviceId}/operations', { operation })).then(r => serviceOperationResultSchema.parse(r))`.

#### 2. Operations store (serviceId-keyed)

**File**: `apps/web/src/app/core/stores/service-operations.store.ts`

**Intent**: Per-service op slice with mutate-then-confirm, keyed by serviceId so one row never clobbers
another — mirror `diagnosis.store.ts` keying and the `signalState` + `patchState` shape, with the
`errorMessage(error, fallback)` helper (`services.store.ts:21-29`) for transport failures.

**Contract**: state `entries: Record<string, { pending: ServiceOperation | null; result: ServiceOperationResult | null; error: null | string }>`;
`run(deviceId, serviceId, operation)` sets `pending`, calls the client, patches `result` (or `error` on
throw), clears `pending`. `entry(serviceId)` returns the keyed slice or an empty default. `@Injectable()`
provided at the component (not root, `angular.md`).

#### 3. Extracted operations component

**File**: `apps/web/src/app/features/services/service-operations.component.{ts,html}`

**Intent**: Own the op affordance for one row so `DeviceServicesComponent` does not grow. Render the 3
container-scoped buttons always; render `Up`/`Down` only when `composePath && composeProject` (computed
from the `service` input). Non-destructive ops fire `store.run` directly with a `Running…` label flip
(mirror the Diagnose button `device-services.component.html:31-40`); `Down` opens an `<hlm-alert-dialog>`
confirm (mirror `requestDelete`/`confirmDelete`, `device-services.component.ts:82-88,115-118`) before
running. Show the result/error as a short inline line keyed off the store entry.

**Contract**: `app-service-operations` with `deviceId = input.required<string>()` and
`service = input.required<Service>()`; `providers: [ServiceOperationsClient, ServiceOperationsStore]`;
`ChangeDetectionStrategy.OnPush`. A `canCompose = computed(() => !!service().composePath && !!service().composeProject)`
gates the up/down buttons. A `pendingDown` signal drives the confirm dialog copy ("removes the
containers and network").

#### 4. Wire into the actions cell

**File**: `apps/web/src/app/features/services/device-services.component.{ts,html}`

**Intent**: Place `<app-service-operations [deviceId]="deviceId()" [service]="service" />` in the
existing actions cell next to Diagnose/Edit/Delete; add the import. Verify the host component stays
within the ~150-line budget.

**Contract**: Template insertion in the `@for` actions cell (`device-services.component.html:30-51`);
add `ServiceOperationsComponent` to the `imports` array (`device-services.component.ts:34`). No store
change in the host — the new component owns its own providers.

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes: `npm run build`
- [ ] Lint passes: `npm run lint`
- [ ] Web unit tests pass: `npx nx test web`
- [ ] `npm run format:check` is clean (Tailwind class order)
- [ ] `DeviceServicesComponent` TS stays within the ~150-line budget

#### Manual Verification:

- [ ] Each of the 5 ops triggers from the row and shows a confirmation/failure line in < 10 s (fast ops)
- [ ] `Up`/`Down` buttons are absent on a standalone (non-compose) service
- [ ] `Down` shows the confirm modal before running; Cancel aborts
- [ ] A slow `up -d` keeps the button disabled with `Running…` until it completes
- [ ] One row's pending/result state never bleeds into another row
- [ ] A failed op (e.g. container already removed) surfaces a legible message, not a raw stack

**Implementation Note**: After Phase 3 automated verification passes, pause for final manual sign-off.

---

## Testing Strategy

### Unit Tests:

- **Command builder**: container-scoped vs compose-scoped command strings for each op; both compose
  fields appear (`-f` and `-p`); PATH prefix present.
- **Gating**: `up`/`down` with a null `composePath` or `composeProject` → 400; `start`/`stop`/`restart`
  allowed on any row.
- **Injection guard**: a `composePath`/`composeProject` with a shell metacharacter is rejected at the
  boundary before any command is built.
- **Result mapping**: `code === 0` → `succeeded`; op-specific non-zero → `failed` + cleaned message;
  daemon-down regex and `code === 127` → 503 (thrown).
- **Executor override**: `execute` with no third arg uses the 30 s default; with `timeoutMs` uses the
  override (the long-op path).

### Integration Tests:

- POST `.../operations` with each op against a faked executor: 200 + result for success, 400 for a
  forged compose op, 404 for a cross-device serviceId.

### Manual Testing Steps:

1. Run `start`/`stop`/`restart` on a standalone container; confirm the row reflects each op.
2. Run `up -d` on a compose service whose image must be pulled; confirm it finishes past 30 s.
3. Run `down` on a compose service; confirm the modal, then that containers are removed.
4. Confirm `up`/`down` are hidden on a standalone service and that a direct forged API call is rejected.
5. Trigger two rows' ops back-to-back; confirm no state bleed.

## Performance Considerations

A slow `up -d` holds the device mutex for its full duration (up to `OP_TIMEOUT_MS`), serializing other
ops on that device. Accepted: single-operator homelab, "one action at a time" (frame hypothesis 5
ruled out). The op timeout default (5 min) bounds the worst case so no run hangs indefinitely
(NFR `prd.md:108-110`).

## Migration Notes

No DB schema change, no data migration — `run_record` is untouched. The only env addition is
`OP_TIMEOUT_MS` (defaulted), so existing deployments boot unchanged.

## References

- Frame brief: `context/changes/deterministic-service-operations/frame.md`
- Research: `context/changes/deterministic-service-operations/research.md`
- Execution seam: `apps/api/src/executor/ssh.executor.ts:30-32,58-79`
- Diagnose template (reuse shape): `apps/api/src/diagnose/diagnose.service.ts:152-217`,
  `apps/api/src/diagnose/diagnose.controller.ts`
- Injection-guard precedent: `libs/shared/src/lib/schemas/container-name.schema.ts:9-12`,
  re-parse `apps/api/src/diagnose/diagnose.service.ts:157`
- Web templates: `apps/web/src/app/core/stores/diagnosis.store.ts`,
  `apps/web/src/app/core/clients/services.client.ts:21-49`,
  `apps/web/src/app/features/services/device-services.component.{ts,html}`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Foundation — contracts, config, executor timeout override

#### Automated

- [x] 1.1 Type checking passes (`npm run build`) — 5c07e77
- [x] 1.2 Lint passes (`npm run lint`) — 5c07e77
- [x] 1.3 Shared unit tests pass (`npx nx test shared`) — 5c07e77
- [x] 1.4 API unit tests pass (`npx nx test api`) — 5c07e77
- [x] 1.5 New schemas exported from the barrel (resolves in a `z.infer` use site) — 5c07e77

#### Manual

- [x] 1.6 `OP_TIMEOUT_MS` documented and boots with its default — 5c07e77
- [x] 1.7 Existing scan/diagnose flows still run after the executor signature change — 5c07e77

### Phase 2: Backend — operation execution

#### Automated

- [x] 2.1 Type checking passes (`npm run build`) — dd135f5
- [x] 2.2 Lint passes (`npm run lint`) — dd135f5
- [x] 2.3 API unit tests pass (`npx nx test api`) — dd135f5
- [x] 2.4 Up/down on null compose fields → 400 — dd135f5
- [x] 2.5 Malformed compose field rejected at the boundary (no command built) — dd135f5
- [x] 2.6 Result mapping: succeeded / failed+message / daemon-down+127 → 503 — dd135f5

#### Manual

- [x] 2.7 start/stop/restart confirm against a live device — dd135f5
- [x] 2.8 `up -d` with an image pull completes past 30 s — dd135f5
- [x] 2.9 `down` stops + removes containers — dd135f5
- [x] 2.10 Forged up/down on a standalone service rejected with 400 — dd135f5
- [x] 2.11 Cross-device serviceId yields 404 — dd135f5

### Phase 3: Web — operation surface

#### Automated

- [x] 3.1 Type checking passes (`npm run build`)
- [x] 3.2 Lint passes (`npm run lint`)
- [x] 3.3 Web unit tests pass (`npx nx test web`)
- [x] 3.4 `npm run format:check` clean
- [x] 3.5 `DeviceServicesComponent` stays within the ~150-line budget

#### Manual

- [x] 3.6 Each op triggers and confirms in < 10 s (fast ops)
- [x] 3.7 Up/Down absent on a standalone service
- [x] 3.8 `Down` confirm modal gates the run; Cancel aborts
- [x] 3.9 Slow `up -d` keeps the button `Running…` until done
- [x] 3.10 No state bleed between rows
- [x] 3.11 A failed op surfaces a legible message
