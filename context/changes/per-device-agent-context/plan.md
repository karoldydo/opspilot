# Per-device agent context (FR-005 / S-07) Implementation Plan

## Overview

Add one optional, host-level free-text field — `agentContext` — to the `device`
entity, thread it end-to-end (DB column → shared Zod contracts → API projection →
web form), and inject it as the AI SDK `system` parameter into the diagnostic
agent's `streamObject` call so diagnoses respect that host's shared conventions
(path conventions, privileged-access requirements, availability hours). The field
is nullable; when null/empty the `system` argument is omitted entirely so the
existing diagnosis flow is unchanged.

## Current State Analysis

- **No storage** — `device` table (`device.schema.ts:6-17`) carries only
  `id, name, host, createdAt, updatedAt`; no context column. The shared response
  contract `deviceSchema` (`device.schema.ts:11-17`) is a `z.strictObject` that
  rejects unknown keys, so a new field must be declared there explicitly.
- **No access** — `DiagnoseService` cannot reach the device: `diagnose.module.ts:18`
  imports `ExecutorModule, LlmProviderModule, ServiceModule` but **not** `DeviceModule`;
  `narrate()` (`diagnose.service.ts:42-51`) loads only the *service* row and passes
  `deviceId` through as a plain string. `DeviceModule` already exports `DeviceService`
  (`device.module.ts:12`), so the wiring path is open.
- **No injection slot** — the model call (`diagnose.service.ts:99-104`) passes only
  `prompt` (built by `buildPrompt`, `:183-196`); there is no `system` parameter today.
- **Projection-not-spread** — `device.service.ts` whitelists every column in
  `create.values` (`:18`), `update.set` (`:39`), and the `toContract` projection
  (`:63-71`, runs `deviceSchema.parse`). A new column is invisible to clients until
  added to all three.
- **Web form ready to extend** — `device-form.dialog.ts:52-60` builds the reactive
  group with `schemaValidator(<schema>.shape.<field>)`; an existing multi-line
  precedent (`<textarea hlmInput rows="6">` for the SSH key) lives at
  `device-form.dialog.html:53-60`. Edit mode patches name/host in the constructor
  (`:78-79`); both submit paths build the device input object (`:103`, `:116`).

## Desired End State

A user editing a device sees an "Agent context" multi-line field. What they type is
persisted on the device, returned on every device read, and — when non-empty — passed
as the `system` instruction to the diagnostic agent for every service on that host.
Leaving it blank keeps the current behaviour exactly (no `system` sent). Verify by:
setting a context on a device, running a diagnosis, and confirming the diagnosis
respects the stated host convention; clearing it and confirming no regression.

### Key Discoveries:

- `device.schema.ts:11-17` — response contract is `z.strictObject`; the field must be
  added here or `toContract`'s `.parse` rejects the row.
- `device.service.ts:63-71` — `toContract` is the mandatory projection whitelist.
- `diagnose.service.ts:99-104` — the single `streamObject` call; `system` is added here.
- `diagnose.module.ts:18` — add `DeviceModule` to imports; `DeviceService` is already exported.
- `device-form.dialog.html:53-60` — the `<textarea hlmInput rows="6">` pattern to mirror.
- Devices have **no `userId`** (`context/archive/2026-06-09-manage-devices/plan.md:75`) —
  the context is shared across all users; there is no per-user override.

## What We're NOT Doing

- **Not** putting per-service path conventions in this field. Structured path data
  already lives on `service.composePath` (consumed by up/down). This field is a
  host-level free-text persona only — the frame's single guardrail.
- **Not** persisting the context into the run record / narration schema. Those carry
  only the 4-field synthesis; transcript-replay of the exact context used is deferred
  (FR-010/FR-011, revisit only if audit needs it).
- **Not** adding a per-service or per-user variant; `device` granularity is mandated by
  FR-005 + S-07 and confirmed by the frame.
- **Not** introducing a config-layer tunable for the max length — the bound is a shared
  contract constraint (used by both FE validator and BE pipe), so it lives as a literal
  in the shared schema.

## Implementation Approach

A single nullable text field threaded along the existing, well-worn device CRUD path,
then consumed at one injection point in the diagnose service. Build storage + contract
first (FE validation and BE boundary parsing come "for free" from `@opspilot/shared`),
then the consumer (agent), then the UI. Field name is `agentContext` (DB column
`agent_context`); max length is `4000` characters; injection uses the AI SDK `system`
slot, omitted when the trimmed context is empty.

## Critical Implementation Details

- **Empty-context handling (load-bearing).** The agent must behave identically to today
  when the context is null, empty, or whitespace-only. Resolve a trimmed context once
  and pass `system` to `streamObject` **only** when it is non-empty — do not send
  `system: ''` or `system: null`. This single guard covers a row that was never set
  (null), one cleared in the UI (empty string), and a whitespace-only entry.
- **Nullable contract, normalize at the boundary.** The DB column is nullable; the
  create-request field is optional+nullable; the response field is nullable. The web
  form normalizes its text control to `null` when blank (`trim() || null`) so a cleared
  field actually clears the column rather than storing `''`.

## Phase 1: Storage & Contract

### Overview

Add the `agentContext` field to the DB schema, generate the migration, declare it in the
shared Zod contracts, and project it through the device service.

### Changes Required:

#### 1. DB schema

**File**: `apps/api/src/database/schema/device.schema.ts`

**Intent**: add a nullable text column so existing rows stay valid (safe `ADD COLUMN`).

**Contract**: new column `agentContext: text('agent_context')` (no `.notNull()`) on the
`device` table. No index needed (not used in any `where`/`order by`).

#### 2. Migration

**File**: `apps/api/migrations/0005_*.sql` (generated)

**Intent**: emit the `ALTER TABLE device ADD COLUMN` migration via drizzle-kit; never
hand-write it (`drizzle.md`). Auto-applies on boot via `MigrationService`.

**Contract**: run `npm run db:generate` → produces `0005_*.sql` + snapshot + journal
entry. Current head is `0004`.

#### 3. Shared create-request contract

**File**: `libs/shared/src/lib/schemas/device-create-request.schema.ts`

**Intent**: add the field to the create contract; the update contract
(`device-update-request.schema.ts`, a `.partial().refine()` of create) inherits it as
optional automatically — no separate edit there.

**Contract**: `agentContext: z.string().max(4000, { error: '...' }).nullable().optional()`
on the `z.strictObject`. Accepts a string ≤ 4000 chars, `null`, or absent.

#### 4. Shared response contract

**File**: `libs/shared/src/lib/schemas/device.schema.ts`

**Intent**: add the field to the strict response shape so `toContract`'s `.parse`
accepts (and clients receive) it.

**Contract**: `agentContext: z.string().max(4000).nullable()` on the `z.strictObject`
(DB returns `string | null`).

#### 5. Device service projection

**File**: `apps/api/src/device/device.service.ts`

**Intent**: project the new column through all three explicit whitelists; normalize
`undefined` → `null` on create so the column is explicit.

**Contract**: `create.values` (`:18`) adds `agentContext: input.agentContext ?? null`;
`update.set` (`:39`) adds `agentContext: input.agentContext` (drizzle ignores `undefined`,
so an omitted field is untouched while an explicit `null` clears it); `toContract`
(`:63-71`) adds `agentContext: row.agentContext`.

### Success Criteria:

#### Automated Verification:

- Migration generates cleanly: `npm run db:generate` (emits `0005_*.sql`)
- Type checking passes: `npx nx typecheck api` and `npx nx typecheck shared` (or `npm run build`)
- Linting passes: `npm run lint`
- Shared + api tests pass: `npx nx test shared` and `npx nx test api` (incl. `device.service.spec.ts`)

#### Manual Verification:

- Creating a device with an `agentContext` value persists it and the value round-trips on read
- Updating a device with a new `agentContext` changes it; updating *without* the field leaves it untouched
- Clearing the field (sending `null`) nulls the column

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to Phase 2.

---

## Phase 2: Diagnose agent injection

### Overview

Wire `DeviceService` into the diagnose module, load the device's `agentContext` in
`narrate()`, thread it to the model call, and inject it as `system` when non-empty.

### Changes Required:

#### 1. Module wiring

**File**: `apps/api/src/diagnose/diagnose.module.ts`

**Intent**: give `DiagnoseService` access to `DeviceService`.

**Contract**: add `DeviceModule` to the `imports` array (`:18`). `DeviceModule` already
exports `DeviceService`.

#### 2. Diagnose service — load, thread, inject

**File**: `apps/api/src/diagnose/diagnose.service.ts`

**Intent**: read the device in the `narrate()` pre-flight (alongside the existing service
+ provider reads), carry its trimmed context to the `streamObject` call, and pass it as
`system` only when non-empty.

**Contract**:
- constructor (`:24-31`): add `@Inject(DeviceService) private readonly deviceService: DeviceService`
  (explicit `@Inject` — esbuild drops `design:paramtypes`, per `lessons.md`).
- `narrate()` (`:42-51`): `const device = await this.deviceService.findOne(deviceId)`;
  pass `device.agentContext` into `buildNarration`.
- `buildNarration` (`:65-70`): add an `agentContext: null | string` parameter, thread it
  to the `run()` closure.
- `streamObject` call (`:99-104`): compute `const system = agentContext?.trim()` and
  spread `...(system ? { system } : {})` into the call args. Do **not** pass `system`
  when empty (see Critical Implementation Details).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx nx typecheck api` (or `npm run build`)
- Linting passes: `npm run lint`
- Api tests pass: `npx nx test api` (incl. `diagnose.service.spec.ts` — update the spec's
  `DeviceService` mock/provider so DI resolves)

#### Manual Verification:

- A diagnosis on a device with `agentContext` set reflects the stated host convention in its output
- A diagnosis on a device with empty/null `agentContext` behaves exactly as before (no regression)
- The diagnosis run still completes well within the < 15 s NFR for ~200 log lines

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to Phase 3.

---

## Phase 3: Web devices form

### Overview

Add an "Agent context" multi-line control to the device form, validated from the shared
schema, patched on edit, and sent in both submit paths.

### Changes Required:

#### 1. Form control + edit patch + submit

**File**: `apps/web/src/app/features/devices/device-form.dialog.ts`

**Intent**: add the control, populate it on edit, and include it (normalized to `null`
when blank) in both the create and update device inputs.

**Contract**:
- group (`:52-60`): add `agentContext: ['', [schemaValidator(deviceCreateRequestSchema.shape.agentContext)]]`.
- edit patch (`:78-79`): include `agentContext: this.context.device.agentContext ?? ''`.
- create submit (`:103`): device input adds `agentContext: value.agentContext.trim() || null`.
- update submit (`:116`): device input adds `agentContext: value.agentContext.trim() || null`.

#### 2. Form markup

**File**: `apps/web/src/app/features/devices/device-form.dialog.html`

**Intent**: render an "Agent context" textarea mirroring the existing SSH-key textarea
markup, with help text and the standard error block.

**Contract**: a `flex flex-col gap-2` block with `<label hlmLabel>Agent context</label>`,
`<textarea formControlName="agentContext" hlmInput rows="6" placeholder="...">`, a
`text-muted-foreground text-sm` helper line (e.g. "host-level conventions the diagnostic
agent should respect"), and the `@if (touched && invalid)` `text-destructive text-sm`
error block reading `getError('zod')`. Run `npm run format` after editing the template
(prettier tailwind class ordering).

### Success Criteria:

#### Automated Verification:

- Linting passes: `npx nx lint web`
- Build passes: `npx nx build web` (or `npm run build`)
- Web unit tests pass: `npx nx test web`
- Format check passes: `npm run format:check`

#### Manual Verification:

- The form shows the "Agent context" textarea in both create and edit modes
- Creating a device with a context value persists and reappears on edit
- Editing the context updates it; clearing it nulls it
- Entering > 4000 characters surfaces the zod validation error and blocks submit

**Implementation Note**: After completing this phase and all automated verification passes, pause for final manual confirmation.

---

## Testing Strategy

### Unit Tests:

- `device.service.spec.ts` — `create`/`update`/`toContract` carry `agentContext`
  (string, null, and undefined-on-update cases).
- `diagnose.service.spec.ts` — `system` is passed to `streamObject` when context is set,
  and omitted when null/empty/whitespace; `DeviceService` mock wired into the test module.

### Integration Tests:

- End-to-end: create device with context → run diagnosis → assert the model call received
  `system` (mock the AI SDK boundary as the existing diagnose spec does).

### Manual Testing Steps:

1. Add a device with an agent-context note (e.g. "config lives under /volume2; sudo needs a password").
2. Run a diagnosis on one of its services; confirm the output respects the note.
3. Clear the context, re-run; confirm a normal diagnosis with no regression.
4. Paste > 4000 chars into the field; confirm the validation error and blocked submit.

## Performance Considerations

The context adds a small `system` string to one LLM call per run; it must not push the
run past the < 15 s NFR for ~200 log lines (`diagnose-service-synthesis` north-star).
The 4000-char bound (~1k tokens) keeps the added prompt overhead negligible.

## Migration Notes

`ADD COLUMN agent_context` is nullable, so it is safe on existing rows; the
`MigrationService` applies it automatically on boot (with the pending-migration backup
gate). No backfill required.

## References

- Frame brief: `context/changes/per-device-agent-context/frame.md`
- Related research: `context/changes/per-device-agent-context/research.md`
- Requirements: `context/foundation/prd.md:78-79` (FR-005); `context/foundation/roadmap.md:199-209` (S-07)
- Projection whitelist pattern: `apps/api/src/device/device.service.ts:63-71`
- Injection point: `apps/api/src/diagnose/diagnose.service.ts:99-104`
- Textarea precedent: `apps/web/src/app/features/devices/device-form.dialog.html:53-60`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Storage & Contract

#### Automated

- [x] 1.1 Migration generates cleanly: `npm run db:generate` (emits `0005_*.sql`) — 49e7837
- [x] 1.2 Type checking passes: `npx nx typecheck api` and `npx nx typecheck shared` — 49e7837
- [x] 1.3 Linting passes: `npm run lint` — 49e7837
- [x] 1.4 Shared + api tests pass: `npx nx test shared` and `npx nx test api` — 49e7837

#### Manual

- [x] 1.5 Creating a device with `agentContext` persists and round-trips on read — 49e7837
- [x] 1.6 Update with the field changes it; update without it leaves it untouched — 49e7837
- [x] 1.7 Clearing the field (sending `null`) nulls the column — 49e7837

### Phase 2: Diagnose agent injection

#### Automated

- [x] 2.1 Type checking passes: `npx nx typecheck api`
- [x] 2.2 Linting passes: `npm run lint`
- [x] 2.3 Api tests pass: `npx nx test api` (incl. `diagnose.service.spec.ts` DI updated)

#### Manual

- [x] 2.4 Diagnosis with `agentContext` set reflects the host convention
- [x] 2.5 Diagnosis with empty/null context behaves exactly as before
- [x] 2.6 Run still completes within the < 15 s NFR for ~200 log lines

### Phase 3: Web devices form

#### Automated

- [ ] 3.1 Linting passes: `npx nx lint web`
- [ ] 3.2 Build passes: `npx nx build web`
- [ ] 3.3 Web unit tests pass: `npx nx test web`
- [ ] 3.4 Format check passes: `npm run format:check`

#### Manual

- [ ] 3.5 The "Agent context" textarea shows in create and edit modes
- [ ] 3.6 Creating with a context value persists and reappears on edit
- [ ] 3.7 Editing updates it; clearing nulls it
- [ ] 3.8 Entering > 4000 chars surfaces the zod error and blocks submit
