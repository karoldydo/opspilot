# Custom Skill CRUD (S-08) Implementation Plan

## Overview

Introduce **skill-as-data** for the first time: a persisted `skill` table (nullable
`deviceId` where `null` = global, otherwise per-device), a `@opspilot/shared` contract
set, a thin NestJS CRUD module, and a web feature — then route **deterministic,
per-device-scoped HTTP execution** through the rows. The single genuinely-new
load-bearing control is a **safe parameterized-command renderer**: a fixed-structure
command template with typed `{{placeholder}}` substitution, every substituted value
charset-constrained and re-parsed at the shell boundary.

The five lifecycle operations (`start/stop/restart/up/down`) **migrate** from the
compile-time `z.enum` + hand-written `buildCommand` switch onto seeded **global skill
rows**, and the existing `operation/` module + web operations surface are **removed**.
`diagnoseLogs` and `scanServices` stay hidden built-ins (no `kind` discriminator, no
`RunRecord` for skill runs — runs stay ephemeral, respecting the S-09 boundary).

## Current State Analysis

- **Skills are hardcoded TypeScript today.** The 5 lifecycle ops are a `z.enum`
  (`service-operation.schema.ts:8`) + a `switch`/template-literal builder
  (`operation.service.ts:66-82`). `diagnoseLogs`/`scanServices` are fixed-command
  built-ins, not user-configurable.
- **The op enum is "the single runtime guardrail — predefined skills only"**
  (`service-operation.schema.ts:3-8`). S-08 must move this guardrail from a compile-time
  enum to a runtime check against user-defined rows **without losing** the property that
  a forged/unknown skill never reaches a command.
- **Execution resolves identity server-side and never trusts the FE.**
  `operation.service.run` (`operation.service.ts:39-59`) resolves the service (404 if
  absent or cross-device), reads `containerName`/`composePath`/`composeProject` from the
  row, re-parses each through its charset schema at the boundary, executes under a
  dedicated long timeout (`operationConfig`, default 5 min), and maps the exit to an
  **ephemeral** `serviceOperationResult` — nothing is persisted.
- **The executor seam is already correct.** `IExecutor.execute(deviceId, command,
  timeoutMs?)` (`executor.interface.ts:14-20`) takes an arbitrary command + per-call
  timeout; `SshExecutor` gives per-device mutex serialization, a per-command timeout, and
  unconditional `dispose()`. **No executor change.**
- **The CRUD vertical-slice blueprint is copy-ready** from `device`/`llm-provider`:
  shared Zod trio → Drizzle table + boot-time auto-migration → thin controller +
  `ZodValidationPipe` (+ mandatory per-module `json()` re-apply) → `signalState` store +
  schema-driven form validators.
- **Per-device scope filtering is greenfield.** The `eq(table.deviceId, deviceId)` filter
  exists (`service.service.ts:61,167`); the `or(isNull(deviceId), eq(deviceId, X))`
  global+device predicate does **not** exist anywhere yet.
- **No parameterized-template capability exists.** Three hand-written builders interpolate
  a fixed charset-constrained field set; there is no placeholder grammar and no typed-
  parameter abstraction. This is the new thing S-08 builds.
- **Web operations surface is a fixed enum of buttons**: `service-operations.component`
  renders start/stop/restart unconditionally and up/down only when `canCompose()`, via
  `service-operations.client` + `service-operations.store`, embedded at
  `device-services.component.html:41`.

## Desired End State

A user can create, edit, and delete skills (global or per-device) in the web UI; each
skill is a fixed-structure command template with typed parameters. On a service's row the
user sees only the skills **in scope for that service's device** (global + that device's),
gated to those whose required service-bound parameters are satisfiable for the service,
and can run one — the agent (HTTP path) executes it deterministically and returns an
ephemeral success/failure result. The five lifecycle operations behave exactly as before,
now sourced from seeded global skill rows. The old `operation/` module and web operations
surface no longer exist.

**Verification**: the 5 lifecycle ops still run from the services list (start/stop/restart
always, up/down only for compose services); a user-created custom skill appears and runs on
its scoped device only; a forged/out-of-scope `skillId` returns 404; an input parameter
containing shell metacharacters is rejected at the boundary; `npm run lint`, `npm run test`,
`npm run build` pass.

### Key Discoveries:

- The runtime guardrail to generalize: `service-operation.schema.ts:3-8` (enum → row scope check).
- The builder to replace: `operation.service.ts:66-82` (switch + charset-reparse) — the
  charset-reparse-at-the-shell-boundary discipline is the pattern the renderer must keep.
- Identity is resolved server-side, never trusted from FE: `operation.service.ts:42,67`.
- Table/UUID-PK/timestamp pattern to copy: `device.schema.ts:6-20`; nullable-FK divergence
  modeled on the cascade FK + index at `service.schema.ts` (skill drops `.notNull()` on `deviceId`).
- Charset-whitelist injection precedent: `container-name.schema.ts:9-12`,
  `compose-path.schema.ts`, `compose-project.schema.ts`.
- Per-module `json()` re-apply is mandatory (`device.module.ts:9-21`) — global body parser
  is disabled in `main.ts` for Better Auth.
- Config-not-const for the timeout: precedent `operationConfig` / `OP_TIMEOUT_MS`
  (`operation.service.ts:32,46`), via `env.schema` + Joi + `registerAs` (`lessons.md:5-10`).
- Explicit `@Inject(Token)` DI for every constructor dep (`lessons.md:19-24`).
- Uniqueness-per-scope is a read-then-write invariant → one Drizzle transaction (`lessons.md:34-38`).

## What We're NOT Doing

- **No AI-SDK tool-calling layer.** No `generateText`/`tool()`/per-device tool registry.
  The agent-shell (chat) is deferred to v2; `vercel-ai-sdk.md:18` is treated as a v2 direction.
- **No `RunRecord` / persistence / replay for skill runs.** Runs stay ephemeral, like S-06.
  The `run_record` generalization remains S-09's.
- **No `kind` discriminator and no folding `diagnoseLogs`/`scanServices` into skill rows.**
  They stay hidden built-ins (forcing `diagnoseLogs` into a row would reimplement
  `streamObject` + SSE + `RunRecord`).
- **No raw user-authored shell.** The command structure is template + typed placeholders;
  values are charset-constrained, never shell-escaped free text.
- **No skill scheduling, no bulk ops, no roles/RBAC** (PRD load-bearing Non-Goals).
- **No executor change.** The `IExecutor` seam is reused as-is.

## Implementation Approach

Build the vertical slice on the well-trodden CRUD blueprint, then migrate the execution
path. The load-bearing security work concentrates in two shared schemas (the command
template grammar and the parameter definition) and in the API run method that resolves the
service server-side, scope-checks the skill, fills **service-bound** parameters from the
resolved service row, validates **input-bound** parameters from the request, renders the
template, and re-parses every substituted value at the shell boundary before handing the
command to the executor. The five lifecycle ops are seeded as global rows so the migration
deletes the old `operation/` module and web operations surface entirely, leaving one
canonical execution path.

## Critical Implementation Details

- **Parameter source binding (load-bearing).** A skill parameter is one of two sources:
  `service` (auto-filled server-side from the resolved service row — `containerName`,
  `composePath`, `composeProject`) or `input` (supplied by the caller at run time). The run
  request carries values **only** for `input` params; `service` params are read from the
  resolved row and **never trusted from the FE**, preserving the exact S-06 guarantee. The 5
  seeded lifecycle ops use `service` params exclusively, so their run request carries no
  inputs.
- **Compose-gating preserved without special-casing.** `up`/`down` template `composePath`/
  `composeProject` as required `service` params; when the resolved service has either as
  `null`, the run fails with the existing `BadRequestException("… requires a compose-managed
  service")`, and the web list hides a skill whose required `service` params are unsatisfiable
  for that service (mirrors today's `canCompose()`).
- **Charset re-parse at the shell boundary is non-negotiable.** Every substituted value —
  both service-derived and input — is re-parsed through a charset schema immediately before
  interpolation, exactly as `operation.service.ts:67,72-73` does today. A failed parse throws
  before any command is built.
- **Migration ordering.** Seed the 5 global rows (Phase 2) and ship the new run endpoint
  (Phase 4) **before** deleting the `operation/` module and rewiring the web (Phases 4 & 6),
  so the lifecycle ops never regress. The seed must be idempotent (boot-safe).

## Phase 1: Shared contracts

### Overview

Define the skill contract trio, the parameterized-command security schemas (template
grammar + parameter definition + value charset), and the new run request/result. Remove
the `service-operation*` schemas that the migration retires.

### Changes Required:

#### 1. Skill parameter + command-template schemas (the security contract)

**File**: `libs/shared/src/lib/schemas/skill-parameter.schema.ts`, `skill-command-template.schema.ts`, `skill-parameter-value.schema.ts`

**Intent**: Define what a typed skill parameter is, the placeholder grammar of a command
template, and the charset every substituted value must satisfy. This is the load-bearing
injection control — model it on `container-name.schema.ts`'s "constrain the alphabet, not
escape the string" discipline.

**Contract**: A parameter is `{ name, source: 'service' | 'input', required }` where `name`
is a `{{placeholder}}`-legal identifier (`^[a-zA-Z][a-zA-Z0-9_]*$`); `source: 'service'`
names are constrained to the known service fields (`containerName | composePath |
composeProject`). The command template is a string whose only dynamic content is
`{{name}}` placeholders drawn from the skill's declared parameter names — a structurally
fixed command, no free shell. The parameter-value schema is the charset whitelist applied
to every substituted value at render time (`^[a-zA-Z0-9][a-zA-Z0-9_.:/=-]*$`-style, broad
enough for container names, compose paths, and project names but excluding shell
metacharacters). One export per file (`zod.md`).

#### 2. Skill contract trio

**File**: `libs/shared/src/lib/schemas/skill.schema.ts`, `skill-create-request.schema.ts`, `skill-update-request.schema.ts`

**Intent**: The persisted skill shape plus create/update request shapes, following the
`device` trio template exactly.

**Contract**: `skillSchema` = `z.strictObject` with `id`, `name` (min 1), `deviceId`
(`uuid().nullable()` — `null` = global), `commandTemplate` (the template schema),
`parameters` (array of the parameter schema), `timeoutMs` (`positive int nullable` —
`null` inherits config default), `createdAt`/`updatedAt` (`isoTimestamp` preprocessor).
Create-request = user fields only (`name`, `deviceId`, `commandTemplate`, `parameters`,
`timeoutMs`), no id/timestamps. Update-request = `createRequest.partial().refine(at least
one field)`. A cross-field refine ensures every `{{placeholder}}` in `commandTemplate` has
a matching entry in `parameters` and vice-versa.

#### 3. Skill run request + result

**File**: `libs/shared/src/lib/schemas/skill-run-request.schema.ts`, `skill-run-result.schema.ts`

**Intent**: The run endpoint's body (input-param values only) and the ephemeral result
envelope, replacing `serviceOperationResultSchema`.

**Contract**: `skillRunRequestSchema` = `z.strictObject({ inputs: z.record(z.string(),
skillParameterValueSchema) })` (defaultable to `{}`; only `source: 'input'` params appear).
`skillRunResultSchema` = `z.strictObject({ message, status: z.enum(['succeeded',
'failed']) })` — modeled on `serviceOperationResultSchema:16-20` but without the `operation`
enum field.

#### 4. Barrel + removals

**File**: `libs/shared/src/index.ts`

**Intent**: Export the new schemas alphabetically; remove the retired ones.

**Contract**: Add `export * from './lib/schemas/skill*.schema';` entries; delete the
`service-operation.schema` and `service-operation-request.schema` exports.

#### 5. Remove retired schemas

**File**: `libs/shared/src/lib/schemas/service-operation.schema.ts`, `service-operation-request.schema.ts`

**Intent**: These are subsumed by the skill run contract — delete after the seed/run path
exists. (Deletion lands in this phase at the contract level; the API/web consumers are
removed in Phases 4 & 6.)

**Contract**: File deletions. Note ordering — these break the api `operation/` build until
Phase 4 removes its module; do the deletions and the api removal in the same working set so
the tree compiles.

### Success Criteria:

#### Automated Verification:

- Shared lib builds: `npx nx build shared`
- Lint passes: `npx nx lint shared`
- Type check passes: `npx nx test shared` (schema unit specs, if added)

#### Manual Verification:

- A template with an undeclared `{{placeholder}}` fails the cross-field refine.
- A parameter value with a shell metacharacter (`;`, `|`, `` ` ``, `$()`) fails
  `skillParameterValueSchema`.

---

## Phase 2: Database table + seed defaults

### Overview

Add the `skill` table (nullable `deviceId`, cascade FK, index), generate migration `0006`,
register it in the schema barrel, and seed the five lifecycle ops as idempotent global rows.

### Changes Required:

#### 1. Skill table

**File**: `apps/api/src/database/schema/skill.schema.ts`

**Intent**: Persist skills, diverging from the child-entity pattern by making `deviceId`
nullable (`null` = global).

**Contract**: `sqliteTable('skill', { id text pk, name text notNull, deviceId text NULL
references(() => device.id, { onDelete: 'cascade' }), commandTemplate text notNull,
parameters text notNull (JSON), timeoutMs integer NULL, createdAt/updatedAt timestamp_ms
with unixepoch default + $onUpdate })` + `index('skill_deviceId_idx').on(deviceId)`. UUID PK
assigned in the service via `randomUUID()`. `parameters` stored as serialized JSON text
(SQLite), mapped to/from the array in `toContract`.

#### 2. Register table + generate migration

**File**: `apps/api/src/database/schema/index.ts`, `apps/api/migrations/0006_*.sql`

**Intent**: Register the table so both `drizzle.config.ts` and the runtime `drizzle(...)`
pick it up; generate the migration (auto-applies at boot).

**Contract**: Add the `skill` export to the schema barrel; `npm run db:generate` emits
`0006_*.sql`. Never hand-write SQL (`drizzle.md:12-13`).

#### 3. Seed the five lifecycle ops as global rows

**File**: `apps/api/src/skill/skill.seed.ts` (+ invoked from `SkillModule` boot hook)

**Intent**: Make the lifecycle ops available as data so the migration can delete the
hardcoded `operation/` path, preserving exact current behavior.

**Contract**: Idempotent seed (insert-if-absent by a stable name within global scope) of 5
global rows (`deviceId = null`): container-scoped `start`/`stop`/`restart` with template
`docker {op} {{containerName}}` and one `service` param `containerName`; compose-scoped
`up`/`down` with template `docker compose -f {{composePath}} -p {{composeProject}} {up -d|
down}` and two `service` params `composePath`/`composeProject`. The `PATH_PREFIX`
(`operation.service.ts:20`) is prepended by the renderer/executor wiring, not stored in the
template. Runs on `OnApplicationBootstrap`, after migrations apply.

### Success Criteria:

#### Automated Verification:

- Migration generates cleanly: `npm run db:generate` produces `0006_*.sql`
- API builds: `npx nx build api`
- API boots and auto-applies the migration without error: `npx nx serve api` (smoke)

#### Manual Verification:

- After boot, the `skill` table contains exactly the 5 global rows (no duplicates on a
  second boot — idempotency holds).
- `up`/`down` rows carry both `composePath` and `composeProject` service params.

---

## Phase 3: API skill CRUD module

### Overview

A thin CRUD module mirroring `device`, plus the scope-aware query methods and the
uniqueness-per-scope invariant.

### Changes Required:

#### 1. Skill service

**File**: `apps/api/src/skill/skill.service.ts`

**Intent**: CRUD with projection-not-spread, the scope filter, and uniqueness enforcement.

**Contract**: `@Injectable()`, `@Inject(DATABASE_CONNECTION) db`. `create/findAll/findOne/
update/remove` + private `requireRow` (`NotFoundException` `` `skill ${id} not found` ``) +
private `toContract` projecting explicit columns, JSON-parsing `parameters`, returning
`skillSchema.parse(...)`. `findForDevice(deviceId)` filters
`or(isNull(skill.deviceId), eq(skill.deviceId, deviceId))`. Uniqueness: name unique within
its scope (global vs a given device) — enforced as a read-then-write check inside one
`db.transaction(...)` on create/update (`lessons.md:34-38`), throwing a conflict
(`ConflictException`) on violation. Never spread the DTO/row; set explicit columns; serialize
`parameters` to JSON text on write.

#### 2. Skill controller + module

**File**: `apps/api/src/skill/skill.controller.ts`, `skill.module.ts`

**Intent**: Thin REST controller and a module that re-applies `json()`.

**Contract**: `@Controller('skills')` with `@Post`/`@Get`/`@Get(':id')`/`@Patch(':id')`/
`@Delete(':id')` (`@HttpCode(NO_CONTENT)` on delete), bodies validated by
`new ZodValidationPipe(skillCreateRequestSchema | skillUpdateRequestSchema)`. Module
`implements NestModule` and re-applies `json()` to its controller in `configure()`
(`device.module.ts:9-21`). Register `SkillModule` in `app/app.module.ts` imports.

### Success Criteria:

#### Automated Verification:

- API builds: `npx nx build api`
- Lint passes: `npx nx lint api`
- Unit tests pass: `npx nx test api` (service CRUD + scope filter + uniqueness specs)

#### Manual Verification:

- `POST /api/skills` creates a global and a per-device skill; `GET` lists them.
- Creating a second skill with the same name in the same scope returns a conflict; the same
  name in a different scope (global vs device) is allowed.
- `PATCH`/`DELETE` behave; unknown id → 404.

---

## Phase 4: API skill execution + operation migration

### Overview

The deterministic run endpoint and the per-skill timeout config, then delete the
`operation/` module so one canonical execution path remains.

### Changes Required:

#### 1. Skill timeout config

**File**: `apps/api/src/config/skill.config.ts` (+ `env.schema` Joi entry)

**Intent**: Config-not-const default timeout, with per-skill override from the row.

**Contract**: `registerAs('skill', () => ({ timeoutMs: <env> }))` with a Joi-validated,
bounded `SKILL_TIMEOUT_MS` (default mirroring the current 5-min op bound). The run uses
`skill.timeoutMs ?? config.timeoutMs`.

#### 2. Skill run service + endpoint

**File**: `apps/api/src/skill/skill-run.service.ts`, and a run route (nested under the service)

**Intent**: Resolve the service server-side, scope-check the skill, render the template
safely, execute, and return an ephemeral result — the generalization of
`operation.service.run`.

**Contract**: `run(deviceId, serviceId, skillId, inputs)`: (1) resolve the service via
`serviceService.findOne(deviceId, serviceId)` (404 + identity fields); (2) load the skill
and assert it is **in scope** for `deviceId` (global or that device) else 404 — the runtime
guardrail replacing the enum; (3) build the param map: `service` params read from the
resolved row (`containerName`/`composePath`/`composeProject`; null compose field → the
existing `BadRequestException("… requires a compose-managed service")`), `input` params from
the request; (4) **re-parse every value through `skillParameterValueSchema`** then substitute
into the template; (5) prepend `PATH_PREFIX`; (6) `executor.execute(deviceId, command,
skill.timeoutMs ?? config.timeoutMs)`; (7) map exit to `skillRunResultSchema` reusing the
existing `classifyExit`/`cleanOutput` logic (daemon-down/127 → 5xx, other non-zero →
`status:'failed'`). Route: `@Post('devices/:deviceId/services/:serviceId/skills/:skillId/run')`
with `ZodValidationPipe(skillRunRequestSchema)`.

**Contract (renderer)**: the substitution is the one non-obvious bit — render by replacing
each `{{name}}` with its **already-charset-validated** value; reject (throw) on any
unresolved placeholder or any value failing the charset re-parse, before the command string
is assembled. Mirrors `operation.service.ts:61-82`.

#### 3. Remove the operation module

**File**: delete `apps/api/src/operation/` (controller, service, module, config if op-only) and de-register from `app.module.ts`

**Intent**: One canonical path — the lifecycle ops now run as seeded skill rows.

**Contract**: Remove `OperationModule` from `app.module.ts`; delete the `operation/` files;
remove `operationConfig` if it has no other consumer (the long-timeout default moves to
`skillConfig`). Update any DI mocks/specs that referenced `OperationService`.

### Success Criteria:

#### Automated Verification:

- API builds with `operation/` removed: `npx nx build api`
- Lint passes: `npx nx lint api`
- Unit tests pass: `npx nx test api` (run service: scope-check 404, compose-gating
  BadRequest, charset-reparse rejection, succeeded/failed mapping)

#### Manual Verification:

- Running a seeded `start`/`stop`/`restart` row on a container service succeeds exactly as
  the old operation did.
- Running `up`/`down` on a non-compose service returns the compose-managed 400.
- A run request whose input value contains `;`/`|`/`` ` `` is rejected at the boundary.
- A `skillId` belonging to a different device returns 404.

---

## Phase 5: Web skill CRUD feature

### Overview

The web client, store, list, and create/edit form for skills, on the `devices` feature
blueprint.

### Changes Required:

#### 1. Skills client + store

**File**: `apps/web/src/app/core/clients/skills.client.ts`, `core/stores/skills.store.ts`

**Intent**: One method per endpoint, each parsed through the shared schema; a `signalState`
store with mutate-then-refetch methods.

**Contract**: Client `@Injectable()` (route-provided) hitting `/api/skills`, each response
`.then((row) => skillSchema.parse(row))`. Store = `@Injectable()` wrapping `signalState` +
`patchState` (not `signalStore()`), methods returning `{ error: null | string }` via the
`errorMessage(error, fallback)` helper (`devices.store.ts:33-41`).

#### 2. Skills list + form dialog + route

**File**: `apps/web/src/app/features/skills/skills.component.ts(.html)`, `skill-form.dialog.ts`, route in `app.routes.ts`

**Intent**: List with delete-confirm + empty state; a create+edit dialog with schema-driven
validators; a lazy authGuard route.

**Contract**: List component `OnPush`, `providers: [SkillsClient, SkillsStore]`, spartan
table + `hlm-alert-dialog` confirm-delete, opening the form via `HlmDialogService` passing
the store through dialog **context**. Form `FormBuilder.nonNullable.group`, each control's
validator from `schemaValidator(skillCreateRequestSchema.shape.<field>)` — no FE-only
validators (`contracts.md:28`). The form must let the user author the template, declare
parameters (name + source `service|input`), the scope (global vs a device), and optional
`timeoutMs`. Lazy `authGuard` route in `app.routes.ts`.

### Success Criteria:

#### Automated Verification:

- Web builds: `npx nx build web`
- Lint passes: `npx nx lint web`
- Unit tests pass: `npx nx test web` (store mutate-then-refetch, form validators)

#### Manual Verification:

- Create/edit/delete a global skill and a per-device skill through the UI.
- Form validation rejects an empty name and a template/parameter mismatch.
- Per-device skill shows its device; global skill shows "global".

---

## Phase 6: Web execution rewire

### Overview

Replace the fixed-enum operations surface with a skill-driven run scoped to the service's
device, then remove the old operations client/store/component.

### Changes Required:

#### 1. Skill-run client + store + component

**File**: `apps/web/src/app/features/services/service-skills.component.ts(.html)` (replacing `service-operations.*`), plus a run client/store

**Intent**: Render the skills in scope for the service's device, gated to those whose
required `service` params are satisfiable for the service, and run one — preserving the
current per-service pending/result UX.

**Contract**: Component `OnPush`, fetches `findForDevice(deviceId)` (global + that device)
and filters to skills whose required `service` params are non-null on the service (this
reproduces `canCompose()` gating for `up`/`down`). Each skill renders a run control; destructive
skills (e.g. `down`) keep the `hlm-alert-dialog` confirm. Run posts to
`/api/devices/:deviceId/services/:serviceId/skills/:skillId/run` with `inputs` for any
`input` params, response parsed through `skillRunResultSchema`. Per-service
pending/result/error state mirrors `service-operations.store.ts:47-72`.

#### 2. Embed + remove old surface

**File**: `apps/web/src/app/features/services/device-services.component.html`, delete `service-operations.client.ts`/`.store.ts`/`.component.ts(.html)`

**Intent**: Swap the embedded component and delete the retired operations surface.

**Contract**: Replace `<app-service-operations …>` at `device-services.component.html:41`
with the new component; delete the three old files and their imports.

### Success Criteria:

#### Automated Verification:

- Web builds with operations surface removed: `npx nx build web`
- Lint passes: `npx nx lint web`
- Unit tests pass: `npx nx test web`

#### Manual Verification:

- On a container service, start/stop/restart appear and run; `up`/`down` do not appear.
- On a compose service, `up`/`down` also appear and run; `down` prompts for confirmation.
- A per-device custom skill appears only on services of its device; a global custom skill
  appears on all.
- Result/error line renders per service exactly as before.

---

## Testing Strategy

### Unit Tests:

- **Shared**: command-template cross-field refine (placeholder ↔ parameter parity);
  `skillParameterValueSchema` rejects shell metacharacters; create/update request shapes.
- **API skill service**: CRUD projection; `or(isNull, eq)` scope filter; uniqueness-per-scope
  conflict vs cross-scope allow (transaction).
- **API run service**: out-of-scope `skillId` → 404; compose-gating 400 on null compose
  field; charset re-parse rejection on a tainted input/service value; succeeded/failed exit
  mapping (reuse `classifyExit` cases).
- **Web**: store mutate-then-refetch + `errorMessage`; form validators from shared shape;
  service-skills scope+gating filter.

### Integration Tests:

- Boot → migration `0006` applies → 5 seeded global rows present (idempotent on re-boot).
- End-to-end run of a seeded lifecycle row matches prior operation behavior.

### Manual Testing Steps:

1. Fresh boot; confirm the 5 lifecycle rows seeded once.
2. Run start/stop/restart on a container service; confirm result line.
3. Run up/down on a compose service; confirm `down` confirm + result.
4. Create a per-device custom skill with an `input` param; run it on that device's service;
   confirm it is absent on another device's services.
5. Attempt a run with a shell-metacharacter input value; confirm boundary rejection.

## Performance Considerations

Runs stay synchronous and ephemeral (no persistence), per-device-serialized by the existing
SSH mutex; the per-skill/config timeout bounds every run (the "no run hangs" NFR). List
queries index `deviceId`. No new hotspots.

## Migration Notes

- Migration `0006` only **adds** the `skill` table; no data migration of existing rows. The
  lifecycle ops are introduced via the idempotent seed, not a data backfill.
- The `operation/` module and `service-operation*` schemas are deleted in the same change;
  ship the seed + run endpoint (Phases 2 & 4) before deleting so the lifecycle ops never
  regress.
- No rollback of the table is needed; reverting the change reverts the schema barrel and
  re-introduces the `operation/` module.

## References

- Frame brief: `context/changes/custom-skill-crud/frame.md`
- Research: `context/changes/custom-skill-crud/research.md`
- Builder to generalize: `apps/api/src/operation/operation.service.ts:39-82`
- Guardrail enum: `libs/shared/src/lib/schemas/service-operation.schema.ts:3-8`
- Charset precedent: `libs/shared/src/lib/schemas/container-name.schema.ts:9-12`
- Table/PK/timestamp template: `apps/api/src/database/schema/device.schema.ts:6-20`
- CRUD blueprint: `apps/api/src/device/device.service.ts:11-73`, `device.controller.ts:13-45`, `device.module.ts:9-21`
- Web blueprint: `apps/web/src/app/core/clients/devices.client.ts:18-53`, `core/stores/devices.store.ts:47-139`, `features/devices/devices.component.ts:21-72`, `device-form.dialog.ts:29-159`
- Web operations surface to replace: `apps/web/src/app/features/services/service-operations.component.ts`, `device-services.component.html:41`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared contracts

#### Automated

- [x] 1.1 Shared lib builds: `npx nx build shared` (no `build` target on shared — verified via `npx nx typecheck shared`) — e0dd9ce
- [x] 1.2 Lint passes: `npx nx lint shared` — e0dd9ce
- [x] 1.3 Type check / schema specs pass: `npx nx test shared` — e0dd9ce

#### Manual

- [x] 1.4 Template with undeclared placeholder fails the cross-field refine — e0dd9ce
- [x] 1.5 Parameter value with a shell metacharacter fails `skillParameterValueSchema` — e0dd9ce

### Phase 2: Database table + seed defaults

#### Automated

- [x] 2.1 Migration generates cleanly: `npm run db:generate` produces `0006_*.sql` — 7a446e0
- [x] 2.2 API builds: `npx nx build api` — 7a446e0
- [x] 2.3 API boots and auto-applies the migration without error — 7a446e0

#### Manual

- [x] 2.4 `skill` table contains exactly the 5 global rows; idempotent on re-boot — 7a446e0
- [x] 2.5 `up`/`down` rows carry both `composePath` and `composeProject` service params — 7a446e0

### Phase 3: API skill CRUD module

#### Automated

- [x] 3.1 API builds: `npx nx build api` — bc301ad
- [x] 3.2 Lint passes: `npx nx lint api` — bc301ad
- [x] 3.3 Unit tests pass: `npx nx test api` (CRUD + scope filter + uniqueness) — bc301ad

#### Manual

- [x] 3.4 `POST`/`GET` create and list a global and a per-device skill — bc301ad
- [x] 3.5 Same name same scope → conflict; same name different scope → allowed — bc301ad
- [x] 3.6 `PATCH`/`DELETE` behave; unknown id → 404 — bc301ad

### Phase 4: API skill execution + operation migration

#### Automated

- [x] 4.1 API builds with `operation/` removed: `npx nx build api` — 4fe33fe
- [x] 4.2 Lint passes: `npx nx lint api` — 4fe33fe
- [x] 4.3 Unit tests pass: `npx nx test api` (run service scope/gating/charset/exit-mapping) — 4fe33fe

#### Manual

- [x] 4.4 Seeded start/stop/restart run on a container service as before — 4fe33fe
- [x] 4.5 `up`/`down` on a non-compose service returns the compose-managed 400 — 4fe33fe
- [x] 4.6 Run input with a shell metacharacter is rejected at the boundary — 4fe33fe
- [x] 4.7 A `skillId` from a different device returns 404 — 4fe33fe

### Phase 5: Web skill CRUD feature

#### Automated

- [x] 5.1 Web builds: `npx nx build web` — 9ed0b88
- [x] 5.2 Lint passes: `npx nx lint web` — 9ed0b88
- [x] 5.3 Unit tests pass: `npx nx test web` (store + form validators) — 9ed0b88

#### Manual

- [x] 5.4 Create/edit/delete a global and a per-device skill through the UI — 9ed0b88
- [x] 5.5 Form rejects empty name and template/parameter mismatch — 9ed0b88
- [x] 5.6 Per-device skill shows its device; global shows "global" — 9ed0b88

### Phase 6: Web execution rewire

#### Automated

- [x] 6.1 Web builds with operations surface removed: `npx nx build web`
- [x] 6.2 Lint passes: `npx nx lint web`
- [x] 6.3 Unit tests pass: `npx nx test web`

#### Manual

- [x] 6.4 Container service: start/stop/restart appear and run; `up`/`down` absent
- [x] 6.5 Compose service: `up`/`down` also appear; `down` confirms
- [x] 6.6 Per-device custom skill scoped correctly; global appears everywhere
- [x] 6.7 Result/error line renders per service as before
