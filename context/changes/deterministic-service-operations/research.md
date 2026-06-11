---
date: 2026-06-11T22:15:00+02:00
researcher: Karol Dydo
git_commit: 59bdb73eed0f02a7a62c27ba57ef914430b031e8
branch: main
repository: karoldydo/opspilot
topic: "Deterministic service operations (S-06): start/stop/restart/up/down on a managed service"
tags: [research, codebase, executor, ssh, run-record, contracts, service-operations, s-06]
status: complete
last_updated: 2026-06-11
last_updated_by: Karol Dydo
---

# Research: Deterministic service operations (S-06)

**Date**: 2026-06-11T22:15:00+02:00
**Researcher**: Karol Dydo
**Git Commit**: 59bdb73eed0f02a7a62c27ba57ef914430b031e8
**Branch**: main
**Repository**: karoldydo/opspilot

> Local `file:line` references below are clickable in the terminal. GitHub permalink base for this commit:
> `https://github.com/karoldydo/opspilot/blob/59bdb73eed0f02a7a62c27ba57ef914430b031e8/<path>#L<line>`

## Research Question

Comprehensive research for roadmap slice **S-06 — deterministic service operations**: a user runs one of the 5 fixed, non-LLM operations (`start`, `stop`, `restart`, `up`, `down`) on a managed service over SSH and sees confirmation in the UI in < 10 s (FR-007/FR-008, NFR). Full vertical slice — backend execution engine reuse, SSH/executor determinism + safety, shared contracts, and the web trigger/confirmation surface.

## Summary

S-06 is **lighter than it looks** — exactly as the roadmap predicted (`roadmap.md:196`). The hard infrastructure already exists and is verified working:

- The **SSH executor** (`IExecutor.execute(deviceId, command)`) with **per-device `async-mutex` serialization is real and wired** (not just documented), with connect + command timeouts, a complete error taxonomy, and the Synology `PATH`-prefix gotcha already solved.
- The **run-record persistence + retention** machinery exists from S-05, and the data-acquisition half of the diagnose engine (`ServiceService.scan` / `fetchLogs`) is the exact template the 5 operations follow.
- The **web surface** — device → services table with per-row action buttons, confirm-dialog primitive, signal-store-keyed-by-serviceId, parse-at-boundary HTTP clients — is mature and idiomatic; op buttons slot into the existing `device-services` actions cell.

What is genuinely **new**: 3 shared Zod contracts (an operation enum + request + result), 5 hardcoded command templates, an operation execution method + endpoint, op-specific docker error mapping, and the web client/store/buttons. The **single load-bearing architectural decision** is how the operation run relates to the diagnose-locked `run_record` table/contract — and S-05 deliberately left a neutrally-named seam (`run-record`, not `diagnose-record`) open for exactly this moment.

The deterministic ops differ from diagnose in two meaningful ways: **(1) no LLM dependency** → the "no active provider" 409 precondition disappears; **(2) no progressive output** → request/response confirmation is the right shape, not SSE streaming (which carries no `delta` partials without an LLM filling a schema).

## Detailed Findings

### Area 1 — Reuse of the S-04/S-05 execution engine

**The diagnose flow end-to-end** (`apps/api/src/diagnose/diagnose.service.ts`, controller `diagnose.controller.ts`):
- Controller mounted at `@Controller('devices/:deviceId/services/:serviceId')` (`diagnose.controller.ts:15`); two entry points — `@Sse('diagnose/stream')` (`:39-45`) and `@Get('diagnose/runs')` replay list capped at `MAX_RUNS_LIMIT=100` (`:9,:30`).
- Pre-flight fail-fast **before** the stream opens (`diagnose.service.ts:42-51`): `serviceService.findOne(deviceId, serviceId)` (404 + yields `containerName`) → `llmProviderService.getActiveProviderConfig()` (409 if none) → `clientFactory.create(...)`.
- Cold Observable with `AbortController` teardown + 30 s `ping` heartbeat (`:65-145`, `HEARTBEAT_INTERVAL_MS=30_000` `:18`).
- `fetchLogs` re-validates `containerNameSchema.parse(...)` at the shell boundary (`:157`), runs `docker logs <name> --tail N` with the Synology PATH prefix (`:158-160`) via `executor.execute(deviceId, command)`, raced against `logsTimeoutMs`.
- LLM synthesis via `streamObject({ schema: diagnosisSynthesisSchema })` (`:99-112`) — **this is the half that is skipped for deterministic ops**.
- Persist `runRecordService.create(...)` **before** the `done` frame so it carries the saved id/createdAt (`:118-119`).

**Run-record is diagnose-locked today** — the biggest decision point:
- DB table `run_record` (`apps/api/src/database/schema/run-record.schema.ts`): `id`, `deviceId` (FK cascade), `serviceId` (FK cascade), `createdAt`, `synthesis` (text, JSON of the 4-field synthesis — *"opaque blob, never queried into"* `:25-26`), `userId` (nullable, reserved for S-09 `:27-28`). Indexes `(serviceId, createdAt)` `:32`, `(userId)` `:34`.
- Wire contract `runRecordSchema` (`libs/shared/src/lib/schemas/run-record.schema.ts:15-21`): `z.strictObject({ createdAt, deviceId, id, serviceId, synthesis: diagnosisSynthesisSchema })`. `userId` deliberately off the wire.
- `RunRecordService` (`apps/api/src/diagnose/run-record.service.ts`): `create` is a single transaction insert + retention prune to `historyRetention` newest rows per service (`:35-62`); `findRecent(...)` paginated newest-first (`:67-77`); `toContract` parses through `runRecordSchema` (`:82-90`).
- **Verdict:** not generic as-is — column named `synthesis`, typed to the 4-field schema, `RunRecordCreate` hard-requires a `DiagnosisSynthesis`. To record an op you must generalize the payload (discriminated `kind`) or add a parallel table. Everything else (FK cascade, retention-prune transaction, pagination, parse-at-boundary `toContract`, `isoTimestamp` Date↔ISO preprocess) is directly reusable.

**No skill-as-data abstraction exists.** `diagnoseLogs` is a *hidden built-in* — hardcoded logic running a fixed command, mirroring `scanServices` (`ServiceService.scan`, `service.service.ts:43-54`). The skill-table model is S-08, ~2 slices downstream — **do not build it here**. The 5 deterministic ops slot in identically: hardcoded methods running fixed commands via `executor.execute`.

**SSE vs request/response:** the full SSE engine exists (heartbeat, teardown, `delta`/`done`/`error` union `run-narration-event.schema.ts:17-31`, anti-buffer headers `diagnose.controller.ts:36-38`). But a deterministic op is a single short command with **no progressive partials** — the `delta` frame is meaningless without an LLM. **Recommendation: request/response confirmation** (the shape S-04 had as a `@Post('diagnose')` before S-05 converted it to `@Sse`), reusing only the run-record persistence, not the streaming machinery.

### Area 2 — Executor / SSH / per-device concurrency / determinism + safety

**The implemented `IExecutor` is a single method** — `execute(deviceId, command): Promise<ExecResult>` (`apps/api/src/executor/executor.interface.ts:14-16`). **Correction to the rule docs:** `node-ssh.md`/`nestjs.md` describe `connect`/`disconnect`/`execute`; the real contract encapsulates connect→run→dispose inside `execute` per call (`:10-13`). `ExecResult = { code: null | number; stderr: string; stdout: string }` (`:4-8`); `code` is `null` when the channel closed without an exit status.
- A **non-zero exit is not an executor error** — it returns in `ExecResult.code`, interpreted by the caller (`ServiceService.mapDockerError`). Only transport/connect/auth/timeout/decrypt failures throw.
- DI via the `EXECUTOR` symbol token (`executor.token.ts:4`), bound `{ provide: EXECUTOR, useClass: SshExecutor }` (`executor.module.ts:14-16`), injected at `service.service.ts:37`. The symbol-token indirection exists because interface DI resolves to `undefined` under the vitest/esbuild transform (matches `lessons.md` DI rule).

**Per-device concurrency — VERIFIED IMPLEMENTED (not just documented):**
- `async-mutex` in `package.json` (`^0.5.0`), imported `ssh.executor.ts:3`.
- `private readonly mutexes = new Map<string, Mutex>()` (`:21`); `execute()` returns `this.mutexFor(deviceId).runExclusive(() => this.run(deviceId, command))` (`:30-32`); get-or-create `mutexFor` (`:114-125`) is race-free (no `await` between `get` and `set`).
- One mutex per device serializes that device's SSH work; different devices run in parallel. **S-06 ops automatically serialize per device through the same path — no new concurrency work.** Known accepted limitation: map grows one entry per device-id ever seen (unbounded but tiny at homelab scale, `:116-118`). No instance-wide concurrent-op cap (deliberate homelab choice).

**Timeouts** (`config/env.schema.ts`, `config/ssh.config.ts`):
- `SSH_CONNECT_TIMEOUT_MS` default 10000, `min(1000)` → node-ssh `readyTimeout` (`env.schema.ts:53-54`, `ssh.executor.ts:48-53`).
- `SSH_COMMAND_TIMEOUT_MS` default 30000, `min(1000)` → **hand-rolled** `Promise.race` + `setTimeout` (node-ssh has no command-timeout option), rejects `SshCommandTimeoutError` → HTTP 504 (`env.schema.ts:51-52`, `ssh.executor.ts:58-64`, `executor.errors.ts:30-35`).
- `finally` always `clearTimeout` + `ssh.dispose()` (`ssh.executor.ts:66-79`) — the "no run hangs" NFR.
- **S-06 note:** `docker compose up -d` pulling images can exceed 30 s. There is precedent for a per-skill timeout (S-04 added `LLM_DIAGNOSE_LOGS_TIMEOUT_MS`, `env.schema.ts:40-41`); S-06 likely wants its own op-timeout var (config layer, per `lessons.md` — never a const).

**Error taxonomy — split in two halves by design:**
- *Executor half* (`executor.errors.ts`): `CredentialDecryptError`→500 (`:16-20`); `SshAuthError`→**502 (deliberately not 401**, to avoid tripping the web session-expiry interceptor) (`:22-28`); `SshCommandTimeoutError`→504 (`:30-35`); `SshConnectError`→503 (`:37-42`). Connect failures classified by `mapConnectError` (`ssh.executor.ts:105-112`).
- *Docker half* (`ServiceService.mapDockerError`, `service.service.ts:113-121`): daemon-down regex first (`:114-115`), then `code === 127 || /not found/i` → `DockerNotFoundError` (`:117-118`; **exit 127 is the robust locale-independent signal**, stderr is localized), else generic 503. Currently `private` with a hardcoded `docker ps failed` message — S-06 needs to generalize or add an op-specific mapper.

**Docker command pattern + safety:**
- `SCAN_COMMAND` = `export PATH="/usr/local/bin:/usr/local/sbin:/volume1/@appstore/ContainerManager/usr/bin:$PATH"; docker ps --format '{{json .}}' --no-trunc` (`service.service.ts:27-29`) — the PATH prefix resolves docker on non-interactive Synology sessions, harmless elsewhere (`ssh.md`).
- The 5 ops follow the **same PATH-prefix shape** then a compose/container invocation. The `service` row carries `composeProject`/`composePath` from labels (`:30-31,:128-134`), both **nullable** for standalone containers — so the command builder must handle the non-compose case (e.g. `docker start/stop/restart <containerName>` for container-scoped ops vs `docker compose -f <path> up -d/down` for compose-scoped). **This nullability is a real design decision.**
- **`down` is the destructive outlier** — `docker compose down` stops *and removes* containers (and the default network); not a benign inverse of `up`. `start`/`stop`/`restart`/`up -d` are effectively idempotent.
- **Shell-injection guard:** reuse `containerNameSchema.parse` at the command boundary (already used `diagnose.service.ts:157`). NOTE `composeProject`/`composePath` are currently **free text, not charset-constrained** — interpolating them into a command needs new validation.
- Per-device scoping enforced by `requireRow(deviceId, id)` → 404 on cross-device id, never a cross-device mutation (`service.service.ts:156-168`); op endpoints must reuse this.
- Host keys: executor connects without `hostVerifier` (TOFU, trusted-LAN tradeoff, `ssh.executor.ts:45-47`, `node-ssh.md`) — inherited posture.

### Area 3 — PRD FR-007/FR-008 spec + shared contracts

**Verbatim PRD (`context/foundation/prd.md`):**
- **FR-007** (`:84`): *"The application provides 6 default skills (start, stop, restart, up, down, diagnoseLogs) and a hidden built-in skill scanServices."* → `diagnoseLogs` (S-04) + `scanServices` already shipped, so S-06's new surface is exactly the **5 lifecycle ops**.
- **FR-008** (`:88-89`): *"A user can run a skill on a selected service; the agent executes it deterministically and sees only the skills proper to the given device."* Socratic note: agent-first from day 0 (no refactor when chat added); per-device filtering *"protects against acting on the wrong host."*
- **NFR** (`:107-111`): *"An operation on a service (e.g. restart) is confirmed in the UI in < 10 s"*; *"At least 95% of skill runs complete successfully"*; *"Every skill run ends with a result or an unambiguous error within a finite time — none stays hanging indefinitely."*
- **Success criterion** (`:34`): *"A user performs an operation on a service (e.g. restart) from the browser, with confirmation in the UI in < 10 s."*
- **Access Control** (`:121`): flat, no RBAC; unauthenticated has no access — all ops behind the existing `authGuard`.
- **Non-Goals (load-bearing, `:127-134`):** no chat/free-form prompts (predefined skills as guardrails); no user-defined LLM output schemas; **no bulk operations (v2)** → S-06 is one service per op.

**"Per-device filtering" for this slice is degenerate** — the 5 ops are the universal *global default set*, available on every service/device; the real per-device skill table is S-08 (FR-006). The safety property still binds: the execution path must tie the op to a resolved `(deviceId, serviceId)` and never cross hosts. The ops split by data model: **container-scoped** `start/stop/restart` (any row), **compose-scoped** `up/down` (require non-null `composePath`/`composeProject`) — a per-service availability filter to surface in contract/UI.

**Existing contracts** (`libs/shared/src/lib/schemas/*.schema.ts`, flat, one export per file, Zod v4 `z.strictObject`/`z.enum`, barrel `libs/shared/src/index.ts`). **No `skill`/`operation` schema exists yet** (grep of shared + api returns zero):
- `service.schema.ts:14-23` — the op target (`containerName`, `deviceId`, nullable `composePath`/`composeProject`).
- `scan-result.schema.ts:10-27` — ephemeral-result precedent (no id/timestamps).
- `diagnosis-synthesis.schema.ts:11-16` — the lowercase-literal `z.enum(['healthy','degraded','down'])` house convention to mirror.
- `run-record.schema.ts:15-21` — persisted run envelope (`id`/`deviceId`/`serviceId`/`createdAt` + `synthesis`), with the `isoTimestamp` Date↔ISO preprocess.
- `run-narration-event.schema.ts:17-31` — the SSE discriminated union (diagnose-specific).

**Decisive prior decision** (`context/changes/live-narration-and-replay/plan.md:14,92-95`): the run contracts were **named neutrally** (`run-record`, `run-narration-event`) but **explicitly not abstracted** into a generic ops union — *"Only one skill exists … Name neutrally, do not abstract. Generalize in S-08/S-09 when a second skill makes the shared shape real."* **S-06 is that second skill family — this is the slice where the planner must consciously flip that decision.**

### Area 4 — Web trigger + confirmation UI

The device → services → per-service-action loop already exists; op buttons slot into the existing table row.
- **Host component:** `apps/web/src/app/features/services/device-services.component.{ts,html}`. Per-service actions cell `device-services.component.html:30-51` already holds Diagnose/Edit/Delete — **op buttons attach here**, inside `@for (service of store.services(); track service.id)` (`:24`). Component providers array (`device-services.component.ts:35`) is where a new `ServiceOperationsStore`/`Client` would be added.
- **Trigger affordance to mirror:** the Diagnose button `device-services.component.html:31-40` — `hlmBtn` with `[disabled]="diag.loading"` + label flip `'Diagnosing…'`. **This disabled-while-pending + label-swap is exactly the < 10 s confirmation affordance.**
- **Store pattern (deterministic, mutate-then-confirm):** `core/stores/services.store.ts` — `signalState` + `patchState` (`@ngrx/signals`), `DeviceActionResult = { error: null | string }` return shape, `errorMessage(error, fallback)` helper that reads `apiErrorSchema.safeParse(error.error)` from the global filter, `remove()`/`rename()` try→`{ error }`→refetch (`:87-105`). `diagnosis.store.ts` shows state **keyed by `serviceId`** (`entries: Record<string, DiagnosisEntry>`, `:24`) so one row never clobbers another — op state must do the same. Cleanup via `DestroyRef.onDestroy` (`diagnosis.store.ts:45`).
- **Client pattern (single request/response):** `core/clients/services.client.ts:21-49` — `firstValueFrom(http.post<unknown>(...)).then(row => serviceSchema.parse(row))`, parse at boundary. An op client mirrors this with a `POST .../operations` → `operationResultSchema.parse`. **Plain HttpClient (not EventSource) gets 401 interception for free** (`auth.interceptor.ts:10-23`); native EventSource bypasses the interceptor (`diagnosis.client.ts:9-10`).
- **Confirm dialog for destructive ops (FR-007 / `down`):** the `<hlm-alert-dialog>` confirm/cancel primitive is already used for Delete service (`device-services.component.html:122-136`) — `requestDelete(service, dialog)` sets a `serviceToDelete` signal (`device-services.component.ts:53,:115-118`), `confirmDelete(dialog)` runs + closes (`:82-88`). Mirror with a `pendingOp`/`serviceToStop` signal for `stop`/`down`; non-destructive `start`/`restart`/`up` can fire directly.
- **Confirmation display:** reuse the `hlmBadge` + `BADGE_CLASS` status-chip pattern (`device-services.component.ts:21-25`), or a `toast()` (recommended in `spartan.md`, not yet used) for the < 10 s "done".
- **Routing/guards:** no new route — ops live inside the already-guarded `/devices` → `app-device-services` subtree (`app.routes.ts:5-35`, `auth.guard.ts:8-13`).

## Code References

- `apps/api/src/executor/executor.interface.ts:4-16` — `ExecResult` + single-method `IExecutor` contract.
- `apps/api/src/executor/ssh.executor.ts:21,30-32,58-79,105-125` — per-device mutex, command-timeout race, no-hang `finally`, connect-error mapping.
- `apps/api/src/executor/executor.errors.ts:16-42` — executor error taxonomy → HTTP codes.
- `apps/api/src/executor/executor.token.ts:4`, `executor.module.ts:14-16` — symbol-token DI.
- `apps/api/src/config/env.schema.ts:51-54`, `config/ssh.config.ts:6-9` — SSH timeouts (config layer).
- `apps/api/src/service/service.service.ts:27-54,113-121,156-168` — SCAN_COMMAND pattern, `mapDockerError`, `requireRow` device scoping.
- `apps/api/src/service/service.errors.ts` — `DockerDaemonDownError` / `DockerNotFoundError`.
- `apps/api/src/diagnose/diagnose.service.ts:42-145,152-179` — diagnose flow, fetchLogs (the reuse template).
- `apps/api/src/diagnose/run-record.service.ts:35-90` — txn insert + retention prune + paginated list + toContract.
- `apps/api/src/database/schema/run-record.schema.ts:25-34` — diagnose-locked `synthesis` column + reserved `userId`.
- `libs/shared/src/lib/schemas/run-record.schema.ts:15-21` — neutrally-named persisted-run envelope.
- `libs/shared/src/lib/schemas/diagnosis-synthesis.schema.ts:11-16` — lowercase `z.enum` convention.
- `libs/shared/src/lib/schemas/service.schema.ts:14-23` — op target, nullable compose fields.
- `apps/web/src/app/features/services/device-services.component.{ts,html}` — host for op buttons + confirm dialog.
- `apps/web/src/app/core/stores/{services,diagnosis}.store.ts` — store templates (serviceId-keyed, mutate-then-confirm).
- `apps/web/src/app/core/clients/services.client.ts:21-49` — parse-at-boundary HTTP client template.

## Architecture Insights

- **The execution seam is `IExecutor.execute(deviceId, command)`** — every remote operation in the codebase (scan, diagnose-logs, future ops) funnels through this one method, getting per-device serialization, timeouts, and the no-hang guarantee for free. New ops add *commands*, not infrastructure.
- **Two-layer error model:** generic SSH transport errors (executor) vs domain docker errors (service). Ops reuse the executor half unchanged and add an op-specific docker mapper.
- **Determinism = fixed command set + per-device mutex + (deviceId, serviceId) binding.** No LLM, no free-form input (PRD Non-Goal), no cross-host leakage (`requireRow`).
- **Config-layer tunables only** (`lessons.md`): any op timeout/retention goes through `env.schema.ts` + Joi + `registerAs`, never a module const.
- **Contracts single-source-of-truth** (`contracts.md`): the operation enum, request, and result live once in `@opspilot/shared`; both apps consume via `z.infer`. The enum is the runtime guardrail enforcing "predefined skills only."
- **The run-record generalization is the pivot of this slice** — S-05 left a neutrally-named seam precisely so S-06 could turn the run payload into a discriminated union (`synthesis` | operation-result) feeding one record table into S-09's audit log, rather than forking a parallel table.

## Open Questions

1. **Run-record relationship (load-bearing).** Pick one for the plan:
   - **(A) Extend `run_record` to a discriminated payload** (`kind: 'diagnose' | 'operation'`) — widen the column's union, `RunRecordCreate`, and `runRecordSchema`. Keeps one record table for S-09 audit + replay. *Recommended — matches the S-05 neutral-naming intent and PRD trajectory.*
   - **(B) Ephemeral confirmation, no persistence** — simplest, meets < 10 s, but defers the FR-011 audit link and regresses the established persistence pattern.
   - **(C) Parallel `operation_record` table** — lowest coupling, but S-09 would need to join two tables; works against the neutral-naming grain.
2. **Execution mode:** request/response `@Post('.../operations')` confirmation (recommended — no progressive output) vs reusing the `@Sse` stream (overkill — carries only a single `done` frame).
3. **Command form for nullable compose fields:** container-scoped `docker start/stop/restart <containerName>` vs compose-scoped `docker compose -f <path> up -d/down` — and how the UI/contract gates `up`/`down` to compose-derived services only.
4. **`down` confirmation:** the PRD's "confirmation in the UI" is a general < 10 s affordance, not a mandated destructive modal — but `down` *removes* containers; decide whether it gets the alert-dialog confirm beyond the general button affordance.
5. **Op timeout:** reuse the 30 s `SSH_COMMAND_TIMEOUT_MS` default or add a dedicated longer op var (image pulls on `up -d` can exceed 30 s)?
6. **New validation for `composeProject`/`composePath`** before interpolating into a command (currently free text, not charset-constrained — shell-injection surface).

## Historical Context (from prior changes)

- `context/changes/live-narration-and-replay/plan.md:14,92-95` — the run-record / narration-event contracts were named neutrally **but explicitly not abstracted**; generalization deferred to "when a second skill makes the shared shape real." S-06 is that moment.
- `context/changes/diagnose-service-synthesis/` (S-04) — established the hidden-built-in skill pattern (`diagnoseLogs` as hardcoded logic, not a skill-table row), the executor reuse, and the originally-ephemeral `@Post` shape before S-05 added SSE + persistence.
- `context/archive/2026-06-10-scan-and-add-services/plan.md:82-83` — built the executor/SSH layer; documents per-device mutex as the only concurrency control (no instance-wide cap) as a deliberate homelab-scale choice; established the SCAN_COMMAND PATH-prefix pattern.
- `context/foundation/lessons.md` — config-layer-tunables (no consts), explicit `@Inject(token)` DI, compute-then-write invariants in one transaction — all directly applicable to the op timeout, the operation service DI, and any run-record write.

## Related Research

- `context/changes/diagnose-service-synthesis/research.md` — execution engine + LLM synthesis origins.
- `context/changes/live-narration-and-replay/research.md` — SSE narration, run-record persistence, neutral-naming decision.

## Roadmap Anchor

`context/foundation/roadmap.md:187-197` (S-06): Outcome — *"a user runs a deterministic operation (start, stop, restart, up, down) on a service and sees confirmation in the UI."* Change ID `deterministic-service-operations`. Prereqs S-02, S-04. Risk note: *"reuses the agent-execution engine born in S-04, so this is lighter than it looks."*
