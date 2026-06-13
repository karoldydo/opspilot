---
date: 2026-06-13T11:55:58+0200
researcher: Karol Dydo
git_commit: 8a13d778a771b38b146d065826a8038dfa1f01f2
branch: main
repository: opspilot
topic: "Custom skill CRUD (S-08) — skill-as-data table, per-device scope, and agent execution"
tags: [research, codebase, skills, crud, agent, executor, drizzle, vercel-ai-sdk, per-device]
status: complete
last_updated: 2026-06-13
last_updated_by: Karol Dydo
---

# Research: Custom skill CRUD (S-08)

**Date**: 2026-06-13T11:55:58+0200
**Researcher**: Karol Dydo
**Git Commit**: 8a13d778a771b38b146d065826a8038dfa1f01f2
**Branch**: main
**Repository**: opspilot

## Research Question

Comprehensive research for the `custom-skill-crud` change (roadmap slice **S-08**): what does it take to let a user define, edit, and delete custom **skills** (parameterized commands) with a **global** or **per-device** scope, where the agent executes a skill deterministically and sees only the skills proper to a given device (FR-006, FR-008)?

## Summary

**S-08 is the slice that introduces "skill-as-data" for the first time.** Today every skill is hardcoded TypeScript:

- The 5 lifecycle ops (`start/stop/restart/up/down`) are a `z.enum` + a hand-written `switch`/template-literal command builder.
- `diagnoseLogs` and `scanServices` are "hidden built-ins" — fixed commands, no enum, not user-configurable.

This was a **deliberate deferral**: multiple archived changes say "the skill-table model is S-08 — do not build it here." S-08 flips that decision: it adds a persisted `skill` table, a `@opspilot/shared` contract set, a NestJS CRUD feature module, and a web feature, then routes execution through the rows while preserving the load-bearing runtime guardrail **"predefined skills only."**

Three findings shape the whole design:

1. **There is no Vercel AI SDK tool-calling layer yet.** The only AI-SDK call is `streamObject` for diagnose synthesis. "Skill-as-data" replaces hand-written command builders, *not* a tool registry. Whether S-08 introduces `generateText` + `tool()` (per `vercel-ai-sdk.md`) or stays HTTP-only (mirroring operations) is the single biggest open scope decision.
2. **The CRUD vertical-slice pattern is well-trodden and copy-ready.** `device` / `service` / `llm-provider` give a precise, layer-by-layer blueprint (shared Zod → Drizzle table + auto-migration → thin controller + `ZodValidationPipe` → signal-store web feature with schema-driven form validators).
3. **Per-device scope has a clean precedent but the *filtering* is greenfield.** S-07 (`agentContext`) shows the threading pattern, and `service.deviceId` queries show the `eq(table.deviceId, deviceId)` filter — but "global (`deviceId = null`) OR per-device" and "agent sees only this device's skills" do not exist yet and must be built.

The **biggest new capability** S-08 must build that has no precedent: a **safe parameterized command template** (typed parameters + injection-safe rendering). Today injection safety is by charset-whitelist of a *fixed* set of fields; user-authored skill commands are a strictly larger attack surface.

## Detailed Findings

### 1. The CRUD vertical-slice blueprint (template entities: device, llm-provider)

The full recipe to add a new CRUD entity, with the exact precedents:

**Shared contracts** (`libs/shared/src/lib/schemas/`)
- Entity schema is `z.strictObject` with an `isoTimestamp` preprocessor for timestamps — `device.schema.ts:6,11,21`. Strict so any leaked column fails the parse.
- Create-request: `z.strictObject`, user fields only, `.min(1, { error: '...' })` messages, no id/timestamps — `device-create-request.schema.ts:6-14`.
- Update-request: `createRequestSchema.partial().refine((v) => Object.keys(v).length > 0, { error: 'at least one field is required' })` — `device-update-request.schema.ts:7-9`.
- Barrel: add alphabetized `export * from './lib/schemas/skill*.schema';` to `libs/shared/src/index.ts:11-13`.
- Binding rules: `contracts.md:16-22` (one schema, both apps `z.infer`), `zod.md:17,20-28` (one export per file, v4 idioms, `error` not `message`).

**Drizzle DB layer** (`apps/api/src/database/`)
- Table: `sqliteTable('skill', { id: text('id').primaryKey(), createdAt/updatedAt integer timestamp_ms with unixepoch default + $onUpdate, ... })` — model on `device.schema.ts:6-20`. UUID PK assigned in the service via `randomUUID()` (not auto-increment).
- Register the new table file in `apps/api/src/database/schema/index.ts:5-9` — **both** `drizzle.config.ts` and the runtime `drizzle(sqlite, { schema })` read this barrel.
- `npm run db:generate` emits a numbered SQL file into `apps/api/migrations/` (next head is `0006`). **Migrations auto-apply at boot** via `MigrationService` (`apps/api/src/database/migration/migration.service.ts:24-38`, `OnApplicationBootstrap`, backs up the DB when migrations are pending). Never hand-write SQL (`drizzle.md:12-13`).

**API module** (`apps/api/src/skill/`)
- Thin controller `@Controller('skills')` with `@Post`/`@Get`/`@Get(':id')`/`@Patch(':id')`/`@Delete(':id')` (`@HttpCode(NO_CONTENT)`), bodies validated by `new ZodValidationPipe(...)` — pattern at `device.controller.ts:13-45`. `ZodValidationPipe` = safeParse → `BadRequestException(issues)` (`common/zod-validation.pipe.ts:4-14`).
- Service `@Injectable()`, inject `@Inject(DATABASE_CONNECTION) db` — `create/findAll/findOne/update/remove` + private `requireRow` (`NotFoundException` `\`skill ${id} not found\``) + private `toContract` that projects explicit columns and returns `skillSchema.parse(...)` — pattern at `device.service.ts:11-73`. **Never spread the DTO/row**; set explicit columns only.
- Module **must** `implements NestModule` and re-apply `json()` body parser to its controller in `configure()` — `device.module.ts:9-21`. (Global body parser is disabled in `main.ts` for Better Auth's raw-body catch-all; **every CRUD module repeats this** or POST/PATCH bodies arrive empty.)
- Register `SkillModule` in `app/app.module.ts:21-32` imports. Global filter `all-exceptions.filter.ts:5-28` already shapes errors through `apiErrorSchema`.
- Optional `skill.errors.ts` only if a richer taxonomy is needed (precedent `llm-provider.errors.ts:15-51`; device uses bare `NotFoundException`).

**Web feature** (`apps/web/src/app/`)
- HTTP client `@Injectable()` (route-provided, not root), one method per endpoint hitting `/api/skills`, each parsed through the shared schema: `.then((row) => skillSchema.parse(row))` — pattern `core/clients/devices.client.ts:18-53`.
- Store is **NgRx `signalState` + `patchState`** (a plain `@Injectable()` wrapping `signalState`, *not* `signalStore()`) — `core/stores/devices.store.ts:47-139`. Mutate-then-refetch methods return `{ error: null | string }`; reuse the `errorMessage(error, fallback)` helper that reads `apiErrorSchema.safeParse(error.error)` (`devices.store.ts:33-41`).
- List component: `OnPush`, `providers: [SkillsClient, SkillsStore]` (feature owns lifecycle), spartan table + `hlm-alert-dialog` confirm-delete + empty state; opens the form via `HlmDialogService` passing the store through dialog **context** (CDK overlay is outside the route injector) — `features/devices/devices.component.ts:21-72`.
- Form dialog (create+edit in one): `FormBuilder.nonNullable.group`, **each control's validator from the shared schema field** via `schemaValidator(skillCreateRequestSchema.shape.<field>)` — `device-form.dialog.ts:29-159` + `core/validators/schema.validator.ts:7-15`. No FE-only validators (`contracts.md:28`, `angular.md:18-19`).
- Lazy `authGuard`-protected route in `app.routes.ts:15-28`.

### 2. Skill execution + agent layer (the integration surface)

**The operation enum is the guardrail to generalize.** `service-operation.schema.ts:8` = `z.enum(['start','stop','restart','up','down'])`; its header comment calls it "**the single runtime guardrail — 'predefined skills only'**." S-08 must move this guardrail from a compile-time enum to a runtime check against user-defined rows **without losing** the property that a forged/unknown skill never reaches a command.

**`buildCommand` is the switch to replace.** `operation.service.ts:66-82`:
- container-scoped (`start/stop/restart`): `` `${PATH_PREFIX}docker ${operation} ${containerName}` ``
- compose-scoped (`up/down`, gated by `COMPOSE_OPERATIONS` set, line 23): requires non-null `composePath`/`composeProject` else `BadRequestException` (lines 69-71).
- **injection defense is charset re-parse at the shell boundary**: `containerNameSchema.parse` / `composePathSchema.parse` / `composeProjectSchema.parse` (lines 67,72-73). This becomes "render the skill's command template with validated parameters."

**The executor needs no change — it's already the right seam.** `IExecutor.execute(deviceId, command, timeoutMs?)` (`executor/executor.interface.ts:14-20`) takes an arbitrary command + per-call timeout. `SshExecutor` (`executor/ssh.executor.ts`) gives per-device mutex serialization, a hand-rolled `Promise.race` per-command timeout (lines 60-64), and unconditional `ssh.dispose()` in `finally` (66-79) — the "no run hangs" NFR comes for free. A skill row likely needs its own `timeoutMs` (config var, not const — precedent `OP_TIMEOUT_MS` via `operationConfig`, `operation.service.ts:46`).

**Diagnose is the persisted/streaming precedent.** `diagnose.service.ts` runs a fixed `docker logs` command (169-171) then `streamObject` with the fixed `diagnosisSynthesisSchema` (109-115), persists a `RunRecord`, and streams `run-narration-event` frames over `@Sse` (`diagnose.controller.ts:39-45`). If custom skills need streaming/replay, this is the reusable template; operations today are **ephemeral** (no persistence — `serviceOperationResultSchema`, S-09 deferred).

**No parameterized-template capability exists today.** There are three hand-written command builders, each interpolating a fixed, charset-constrained field set. There is no shell-quoting/escaping library and no typed-parameter abstraction. **This is the genuinely new thing S-08 builds**: `{ command template, typed parameters }` + a safe renderer. The `COMPOSE_OPERATIONS` split (different ops need different parameter sets) is the precedent for "different skills need different parameters."

### 3. Per-device scope (S-07 precedent) and the missing filtering

**S-07 added a nullable column, not a table.** `agentContext: text('agent_context')` on the existing `device` table (`database/schema/device.schema.ts:9`, migration `0005_broken_moira_mactaggert.sql`), threaded through the shared contract (`device.schema.ts:13`, `.max(4000).nullable()`), whitelisted in `device.service.ts:18,39,65` (normalize `undefined`→`null` on create, explicit `null` clears on update), surfaced in the web form (`device-form.dialog.ts:53,81,108`). **No controller change** — the `ZodValidationPipe` reads the shared schema.

**Injection into the agent run** is the extension point for skills. In `diagnose.service.ts` `narrate()` the device is loaded in pre-flight (`:49`), `device.agentContext` is threaded into `buildNarration` (`:55`), and injected as the model `system` param exactly where `...(system ? { system } : {})` sits (`:108-115`). To inject *skills as tools*, mirror this: load `skillService.findForDevice(deviceId)` in pre-flight, thread the list, and spread a `tools` map built solely from the filtered rows into the model call.

**Global-vs-per-device modeling does not exist yet.** No `deviceId = null → global` pattern anywhere; no tool-list filtering. The closest nullable-link precedent is `run_record.userId` (nullable, indexed, no FK — `run-record.schema.ts:28,34`, "reserved for s-09"). The per-device *filter* precedent is `service.service.ts:61,167` (`eq(service.deviceId, deviceId)`; cross-device id → 404). For S-08's global+device query the natural (not-yet-existing) predicate is `or(isNull(skill.deviceId), eq(skill.deviceId, deviceId))`.

**Device identity & FK pattern.** `device.id = text('id').primaryKey()` (UUID via `randomUUID()`), **no `userId`** (devices are shared across users). Child entities use `deviceId: text('device_id').notNull().references(() => device.id, { onDelete: 'cascade' })` + an index (`service.schema.ts:22-24,34`). **S-08's deliberate divergence:** `skill.deviceId` must be **nullable** (`null = global`) — drop `.notNull()`, keep the cascade FK + index.

### 4. Requirements, constraints, prior decisions

**PRD (verbatim):**
- **FR-006** (`prd.md:82`): "A user can define, edit and delete skills (parameterized commands) with a global scope or assigned to a device." (must-have)
- **FR-007** (`prd.md:84`): 6 default skills (`start, stop, restart, up, down, diagnoseLogs`) + hidden built-in `scanServices`.
- **FR-008** (`prd.md:88`): "A user can run a skill on a selected service; the agent executes it deterministically and sees only the skills proper to the given device."
- Load-bearing Non-Goals: **no chat/free-form prompts** (`:127`), **no user-defined LLM output schemas** (`:129`); v2: **no skill scheduling** (`:132`), **no bulk ops** (`:134`); **no roles/RBAC** — flat multi-user (`:130`).
- NFRs binding every run: result-or-unambiguous-error in finite time (`:110`), op confirmation < 10 s (`:108`), ≥95% success (`:109`).
- **Tension to respect:** FR-006 allows user-defined *parameterized commands* but `:127`/`:129` forbid free-form prompts and custom output schemas → a "skill" is a **parameterized command template**, never a prompt or an LLM-schema definition.

**Roadmap (`roadmap.md:211-221`):** S-08, prereq **S-06 (done)**, parallel with S-05/S-07/S-09, a *leaf* in Stream D (unlocks nothing). Risk note: "Per-device skill filtering (FR-008) is the guard against running the wrong command on the wrong host — verify it holds for custom skills, not just the defaults."

**The deferral S-08 flips** (the explicit "build it in S-08" passages):
- `deterministic-service-operations/research.md:59`: "**No skill-as-data abstraction exists.** … The skill-table model is S-08 … do not build it here."
- `deterministic-service-operations/research.md:102`: "the real per-device skill table is S-08 (FR-006)."
- `deterministic-service-operations/plan.md:89` / `plan-brief.md:50-51`: "**No skill-as-data table** (S-08)."

**The deferral S-08 must NOT pull forward:** the `run_record` generalization / persistence / audit link was **re-deferred to S-09** (`deterministic-service-operations/frame.md:86-88`, `plan.md:79-86`). S-06 shipped ephemeral confirmation with no operation persistence; S-08 should follow that unless it genuinely needs run history. S-08 is **not** a prerequisite of S-09 and vice-versa.

## Code References

- `libs/shared/src/lib/schemas/service-operation.schema.ts:8` — the `z.enum` "predefined skills only" guardrail S-08 generalizes
- `apps/api/src/operation/operation.service.ts:66-82` — `buildCommand` switch + charset-reparse injection defense (the builder to replace)
- `apps/api/src/operation/operation.controller.ts:15-22` — operation request route, `ZodValidationPipe`
- `apps/api/src/executor/executor.interface.ts:14-20` — `execute(deviceId, command, timeoutMs?)` (the unchanged seam)
- `apps/api/src/executor/ssh.executor.ts:60-79` — per-command timeout + unconditional dispose
- `apps/api/src/diagnose/diagnose.service.ts:49,55,108-115` — per-device `agentContext` injection point (extends to per-device tools)
- `apps/api/src/database/schema/device.schema.ts:6-20` — table/UUID-PK/timestamp pattern to copy; `:9` the S-07 `agentContext` column
- `apps/api/src/database/schema/service.schema.ts:22-24,34,37` — `deviceId` notNull cascade FK + index + unique composite (skill diverges: nullable deviceId)
- `apps/api/src/database/schema/run-record.schema.ts:28,34` — nullable-indexed-no-FK link precedent
- `apps/api/src/database/schema/index.ts:5-9` — schema barrel (register new table here)
- `apps/api/src/database/migration/migration.service.ts:24-38` — boot-time auto-migration
- `apps/api/src/device/device.service.ts:11-73` — CRUD service projection-not-spread + `toContract` parse boundary
- `apps/api/src/device/device.controller.ts:13-45` — thin CRUD controller
- `apps/api/src/device/device.module.ts:9-21` — `json()` re-application (mandatory per module)
- `apps/api/src/service/service.service.ts:61,167` — `eq(service.deviceId, deviceId)` per-device filter (skill needs `or(isNull(...), eq(...))`)
- `apps/api/src/common/zod-validation.pipe.ts:4-14`, `apps/api/src/common/all-exceptions.filter.ts:5-28` — boundary validation + error shaping
- `libs/shared/src/lib/schemas/device.schema.ts:6,11,21`, `device-create-request.schema.ts:6-14`, `device-update-request.schema.ts:7-9` — contract trio template
- `libs/shared/src/lib/schemas/container-name.schema.ts:9-12`, `compose-path.schema.ts:9-13`, `compose-project.schema.ts:10-14` — charset-whitelist injection-safety precedent
- `apps/web/src/app/core/clients/devices.client.ts:18-53`, `core/stores/devices.store.ts:47-139`, `core/validators/schema.validator.ts:7-15` — web client/store/validator template
- `apps/web/src/app/features/devices/devices.component.ts:21-72`, `device-form.dialog.ts:29-159` — list + create/edit dialog template
- `apps/web/src/app/app.routes.ts:15-28` — lazy authGuard route

## Architecture Insights

- **Contracts are the binding rule** (`contracts.md`): every shape lives once in `@opspilot/shared`; both apps `z.infer`; Drizzle `$inferSelect` types never cross into shared — the service maps rows to the Zod contract via `toContract(...).parse()`.
- **Determinism today is enforced by data shape + hand-written builders, not `toolChoice`.** The closed `z.strictObject` request + `z.enum` op + charset re-parse are the guardrail. S-08 must reproduce that guarantee for runtime rows: validate the skill id belongs to the resolved `(deviceId, serviceId)` scope, and re-parse every interpolated parameter at the shell boundary.
- **Injection safety = constrain the alphabet, not escape the string.** Existing schemas whitelist `^[a-zA-Z0-9...]$`. User-authored skill commands/parameters are a larger surface; the safest design keeps parameters charset-constrained and the command template structurally fixed (placeholders), rather than letting users author raw shell.
- **Config-not-const** (`lessons.md:5-10`): any per-skill timeout goes through `env.schema.ts` + Joi + `registerAs`, never a module-level const.
- **Explicit `@Inject(Token)` DI** (`lessons.md:19-24`): esbuild/vitest drops `design:paramtypes`; every service constructor dep needs an explicit token. When wiring `SkillService` into diagnose, update the diagnose spec's DI mocks (precedent: S-07's `DeviceService` mock).
- **The agent tool-calling layer is greenfield.** `vercel-ai-sdk.md:17-19` mandates `generateText` + Zod-typed tools, "no free-form chat, scoped to the target device" — none implemented. S-08 is the natural moment, but it can also stay HTTP-only like operations. This is the key scope fork (see Open Questions).

## Historical Context (from prior changes)

- `context/archive/2026-06-11-deterministic-service-operations/` — S-06, the direct prerequisite. Established the op-enum guardrail, hardcoded command templates, per-call executor timeout (`OP_TIMEOUT_MS`), and explicitly deferred the skill table + run persistence. `research.md:59,102`, `plan.md:89`, `plan-brief.md:50-51`, `frame.md:86-88`.
- `context/archive/2026-06-11-live-narration-and-replay/` — S-05, the "name neutrally, do not abstract until a second skill makes the shared shape real" decision (`plan.md:93-95`, `frame.md:79-84`). Established the `run-record` + `run-narration-event` + SSE pattern S-08 can reuse if it needs streaming.
- `context/archive/2026-06-12-per-device-agent-context/` — S-07, the per-device threading + agent-`system`-injection precedent S-08's per-device tool filtering mirrors.
- `context/archive/2026-06-09-manage-devices/` — devices are shared across users (no `userId`), confirming flat access control.

## Related Research

- `context/archive/2026-06-11-deterministic-service-operations/research.md` — closest prior research; reads the same op/executor seam from the S-06 angle.
- `context/archive/2026-06-12-per-device-agent-context/research.md` — per-device injection research.

## Open Questions

1. **Execution path: AI-SDK tool-calling vs HTTP-only?** Does S-08 introduce `generateText` + `tool()` with per-device tool filtering (satisfying `vercel-ai-sdk.md`'s "agent runs only predefined skills, scoped to device" literally), or run skills HTTP-only like operations (`POST .../services/:serviceId/skills/:skillId`) and treat "the agent sees only this device's skills" as a query-time filter on the listing/run endpoints? This is the largest scope decision and should be framed before planning.
2. **Skill data model — how parameterized?** Is a skill `{ name, scope (deviceId|null), commandTemplate, parameters[] }` with typed placeholders, or a simpler `{ name, command, timeoutMs, deviceId|null }` with a constrained alphabet? FR-006 says "parameterized commands" — how much parameterization is in-scope for the MVP vs a fixed command string?
3. **Do the 6 defaults become rows or stay built-in?** FR-007 keeps the 6 defaults + `scanServices`. Are they seeded as global skill rows (uniform execution path, the cleanest generalization), or do hardcoded builtins coexist with custom rows (a union the executor must merge)? The cleanest design seeds defaults as global rows.
4. **Ephemeral vs persisted runs?** Operations are ephemeral (S-09 owns persistence). Do custom-skill runs need streaming/replay (reuse `run-record`/SSE), or ephemeral confirmation like operations? Default to ephemeral unless a concrete need appears, to respect the S-09 boundary.
5. **Injection-safety contract for user commands.** What is the exact charset/placeholder grammar for a skill command + parameters? This needs its own `@opspilot/shared` schema (mirroring `container-name.schema.ts`) and is the load-bearing security control for the slice.
6. **Uniqueness / naming.** Is skill name unique per scope (global vs per-device)? If so it's a read-then-write invariant → one Drizzle transaction (`lessons.md:34-38`), mirroring `service`'s unique composite index.
