---
date: 2026-06-12T00:00:00+02:00
researcher: Karol Dydo
git_commit: d958366c2c303c852034c479d10207247b995d20
branch: main
repository: opspilot
topic: "Per-device agent context (FR-005) — adding a user-defined per-device system prompt that feeds the diagnostic agent"
tags: [research, codebase, devices, diagnose, agent-context, fr-005, s-07]
status: complete
last_updated: 2026-06-12
last_updated_by: Karol Dydo
---

# Research: Per-device agent context (FR-005)

**Date**: 2026-06-12T00:00:00+02:00
**Researcher**: Karol Dydo
**Git Commit**: d958366c2c303c852034c479d10207247b995d20
**Branch**: main
**Repository**: opspilot

## Research Question

`per-device-agent-context` (roadmap slice **S-07**, **FR-005**): a user can define a per-device system prompt (path conventions, privileged-access requirements, availability hours) that shapes the agent's behaviour on that host. Where exactly does this field live, how does it travel from the device-edit form to the diagnostic agent's LLM call, and what are the precise integration points across DB, shared contracts, API, and web?

## Summary

The feature is a **single optional text field on the `device` entity**, threaded end-to-end and injected into the diagnose agent's LLM call. Every layer already has a clean, established pattern to extend — there is no architectural gap, only **two real wiring gaps** and one **design decision** to settle:

1. **Storage gap** — the `device` table and `deviceSchema` contract have no context column today; it must be added (nullable text column → drizzle-kit migration → shared contracts → `toContract` projection).
2. **Access gap** — `DiagnoseService` cannot currently reach the device: `DeviceModule`/`DeviceService` is **not** imported in `diagnose.module.ts` and not injected into `DiagnoseService`. This must be wired so the agent can read the per-device context.
3. **Injection point** — the diagnose prompt is built in a single place (`diagnose.service.ts` `buildPrompt`) and passed as `prompt` to the Vercel AI SDK `streamObject` call. There is **no `system` parameter today**; the idiomatic move is to add `system: deviceContext` to that call.

No run-record / narration schema change is required for the core injection — those persist/stream only the 4-field synthesis output, which is unaffected. The naming of the field (`context` vs `agentContext` vs `systemPrompt`) and its max-length bound are **open design decisions** — no precedent is enshrined yet.

## Detailed Findings

### Area 1 — Device entity & CRUD (where the field lives)

**DB schema — `apps/api/src/database/schema/device.schema.ts:6-17`.** The `device` table has only `id` (text PK), `name` (text notNull), `host` (text notNull), `createdAt`, `updatedAt` (both `integer timestamp_ms` with epoch defaults; `updatedAt` has `.$onUpdate`). No FKs/indexes on the table itself; `credential` and `service` reference `device.id` with cascade delete (`device.schema.ts:19-58`).

- Adding a nullable text column is `context: text('context')` (no `.notNull()`), then `npm run db:generate` (root `package.json:13`, `cd apps/api && drizzle-kit generate`) emits a new `apps/api/migrations/0005_*.sql` (`ALTER TABLE device ADD COLUMN` — safe on existing rows) plus snapshot + journal entry.
- Migrations auto-apply on boot via `MigrationService` (`apps/api/src/database/migration/migration.service.ts:32`, `OnApplicationBootstrap`, `migrate(...)` with a backup gate when migrations are pending). Per `drizzle.md`: never hand-mutate, always go through drizzle-kit. Current head is `0004`.

**Shared Zod contracts (`libs/shared/src/lib/schemas/`):**
- `device.schema.ts:11-17` — response/domain shape, `z.strictObject`, fields `createdAt, host, id, name, updatedAt`. **Strict object → a new field must be added here explicitly or parse rejects it.** Not derived via pick/omit; it manually duplicates the field set.
- `device-create-request.schema.ts:6-9` — `z.strictObject` with `host` and `name`, each `z.string().min(1, { error: '...' })`. **No `.max()` precedent here** — the only `.max()` in the schemas dir is in the auth schemas (`128`).
- `device-update-request.schema.ts:7-9` — `deviceCreateRequestSchema.partial().refine(non-empty)`. **A new create-schema field auto-propagates to update as optional** — no separate edit needed there.
- Re-exported from `libs/shared/src/index.ts:11-13`.

**API layer (`apps/api/src/device/`):**
- `device.controller.ts` — thin pass-through; `POST` uses `ZodValidationPipe(deviceCreateRequestSchema)` (`:18`), `PATCH` uses `deviceUpdateRequestSchema` (`:35`). **No controller change needed** — pipes use the shared schemas.
- `device.service.ts` — uses **explicit columns, never spreads the DTO**: `create` `.values({...})` (`:18`), `update` `.set({...})` (`:39`). The critical whitelist is **`toContract` (`:63-71`)** which builds the response field-by-field and runs `deviceSchema.parse(...)`. **A new DB column is silently dropped from every response unless added to `toContract` AND `deviceSchema`.**

> Exact API integration points for a `context` field: `device.schema.ts` (DB) → `db:generate` → `device-create-request.schema.ts` (auto-propagates to update) → `device.schema.ts` (response, strict) → `device.service.ts` `create.values` + `update.set` + **`toContract`**.

### Area 2 — Diagnose agent prompt assembly (where the field is consumed)

**`apps/api/src/diagnose/diagnose.service.ts`** is the consumer:
- `narrate()` (`:42-51`) pre-flight loads **only the service row** (`serviceService.findOne`, `:44`) and the active provider config (`:48`), builds the model handle (`clientFactory.create`, `:49`), then calls `buildNarration(...)` carrying only `service.containerName` and `deviceId` as a plain string. **It does not load the `Device` entity and has no `DeviceService` injected.**
- The model call is `streamObject({ model, prompt: this.buildPrompt(containerName, logs), schema: diagnosisSynthesisSchema, abortSignal })` (`:99-104`). **There is no `system` parameter today** — everything is one `prompt` string.
- `buildPrompt(containerName, logs)` (`:183-196`) is the **only** prompt assembled and is hardcoded (`"You are an ops diagnostician..."` + field spec + logs tail). No placeholder for device context exists.

**Injection options (the single design choice in the agent layer):**
- **Idiomatic (recommended):** add `system: deviceContext` to the `streamObject` call at `:99-104` — AI SDK splits `system` (persona/instructions) from `prompt` (task+data); leaves the fixed schema untouched.
- **Alternative:** prepend the context as the first array element inside `buildPrompt` at `:184`.
- Either way, thread the context string from `narrate()` (`:48`, alongside existing pre-flight reads) through `buildNarration` (`:65-70`) to the call site. `deviceId` is already in scope at every hop.

**LLM plumbing is not involved:** `llm-provider.client-factory.ts:16-24` returns an opaque `LanguageModel` handle (`supportsStructuredOutputs: true`); `llm-provider.service.ts:125-136` returns `{ apiKey, baseURL, kind, model }`. Neither touches `system`/`prompt` — injection is purely a `diagnose.service.ts` concern.

**Run records / narration unaffected:** `run-record.service.ts:35-62` persists only `{ deviceId, serviceId, id, JSON.stringify(synthesis) }`; the prompt/context/logs are **not** persisted today. `run-record.schema.ts:15-21`, `diagnosis-synthesis.schema.ts:11-16`, and `run-narration-event.schema.ts:17-31` carry only the synthesis. **No change required** unless we choose to persist/narrate the context (each would need a schema + column edit, all `z.strictObject`).

**Wiring gap:** `diagnose.module.ts:18` imports `ExecutorModule, LlmProviderModule, ServiceModule` — **not `DeviceModule`**. `DeviceModule` already exports `DeviceService` (`device.module.ts:12`), so the path is: add `DeviceModule` to the diagnose module imports + `@Inject(DeviceService)` into `DiagnoseService` (constructor `:24-31`), then call `deviceService.findOne(deviceId)` in `narrate()`.

### Area 3 — Web devices form (where the user types the field)

**Folder `apps/web/src/app/features/devices/`:**
- `device-form.dialog.ts:52-60` — `FormBuilder.nonNullable.group()` with controls `name, host, username, authType, secret`, each validated via `schemaValidator(<schema>.shape.<field>)` (the bridge in `core/validators/schema.validator.ts:1-15` wrapping Zod `safeParse` into an Angular `ValidatorFn`).
- **An existing multi-line precedent already exists:** the `secret` field renders as `<textarea rows="6" hlmInput>` when `authType === 'key'` (`device-form.dialog.html:53-60`, driven by the `secretIsKey` computed signal at `device-form.dialog.ts:72`). A new "agent context" textarea should mirror this exact markup pattern (spartan `hlmInput` directive applied directly to `<textarea>`, `flex flex-col gap-2` container, `text-destructive text-sm` error block).
- Edit mode patches the form in the constructor (`device-form.dialog.ts:77-86`) — a new field would be patched from `this.context.device.<field>` there.
- Submit routes to `store.add(deviceInput, credentialInput)` (create, `:102-104`) or `store.update(id, deviceUpdateInput)` (edit, `:116`) — a new field is added to the device input object in both.

**Data access (no architectural change):**
- `core/clients/devices.client.ts` — `createDevice`/`updateDevice` parse responses through `deviceSchema` (`:24,29,39,51`); a new shared-schema field is picked up automatically for validation.
- `core/stores/devices.store.ts:50-140` — signal store; `add` (two-call device+credential with rollback), `update`, `replaceCredential`, `remove`, `load`. The new field rides along in the existing `DeviceCreateRequest`/`DeviceUpdateRequest` payloads.

> Exact web integration: add a control at `device-form.dialog.ts:52-60`, a textarea block at `device-form.dialog.html` (~after the secret field, before its error block), patch in the constructor (`:77-86`), and add the field to the device input in both submit paths (`:102-104`, `:116`). Validation + response parsing come for free from `@opspilot/shared`.

## Code References

- `apps/api/src/database/schema/device.schema.ts:6-17` — device table; add nullable `context` column here.
- `apps/api/src/database/migration/migration.service.ts:32` — migrations auto-apply on boot.
- `libs/shared/src/lib/schemas/device.schema.ts:11-17` — response contract (strict) — add field here.
- `libs/shared/src/lib/schemas/device-create-request.schema.ts:6-9` — create contract — add field here (auto-propagates to update).
- `libs/shared/src/lib/schemas/device-update-request.schema.ts:7-9` — `partial().refine()` of create.
- `apps/api/src/device/device.service.ts:18,39,63-71` — `create.values`, `update.set`, and the `toContract` whitelist (mandatory).
- `apps/api/src/diagnose/diagnose.service.ts:42-51` — `narrate()` pre-flight; resolve device context here.
- `apps/api/src/diagnose/diagnose.service.ts:99-104` — `streamObject` call; add `system: deviceContext`.
- `apps/api/src/diagnose/diagnose.service.ts:183-196` — `buildPrompt`; alternative concat injection point.
- `apps/api/src/diagnose/diagnose.module.ts:18` — imports; add `DeviceModule`.
- `apps/api/src/device/device.module.ts:12` — already exports `DeviceService`.
- `apps/web/src/app/features/devices/device-form.dialog.ts:52-60,72,77-86,102-104,116` — form controls, secret textarea precedent, edit patch, submit paths.
- `apps/web/src/app/features/devices/device-form.dialog.html:53-60` — existing `<textarea hlmInput>` pattern to mirror.
- `apps/web/src/app/core/validators/schema.validator.ts:1-15` — Zod→Angular validator bridge.
- `apps/web/src/app/core/clients/devices.client.ts` / `core/stores/devices.store.ts` — response parsing + store mutations (no change needed beyond payload).

## Architecture Insights

- **Single-source contracts (`contracts.md`):** the field is defined once in `@opspilot/shared` and consumed by both api (pipes) and web (validators + response parse). FE form validation and HTTP-boundary parsing come "for free" once the shared schemas carry the field.
- **Projection-not-spread:** `device.service.ts` whitelists every column in `create.values`/`update.set`/`toContract` — a new column is invisible to clients until explicitly projected. This is deliberate (prevents leaking internal/sensitive columns) and applies here.
- **`partial()`-derived update:** adding to the create schema is the only contract edit needed for the request side; update inherits it.
- **AI SDK `system` vs `prompt`:** the diagnose call uses only `prompt` today. Per-device context maps cleanly onto the AI SDK `system` slot — the conventional place for per-host persona/conventions — without disturbing the fixed `diagnosisSynthesisSchema`.
- **Optional/empty-tolerant by design:** roadmap explicitly notes S-04 "can run with empty context; this slice improves accuracy per host rather than enabling the flow" — so the field is optional/nullable and the prompt must behave when it's absent.
- **Lessons that constrain implementation:** explicit `@Inject(DeviceService)` (esbuild drops `design:paramtypes` — `lessons.md`); operational tunables via config layer, not in-file consts (relevant only if a max-length or default is introduced as a tunable).

## Historical Context (from prior changes)

- `context/foundation/roadmap.md:199-209` — S-07 `per-device-agent-context`, FR-005, status proposed; prerequisites S-01 (manage-devices) + S-04 (diagnose-service-synthesis); rationale: *"Different hosts having different conventions is exactly why a global prompt was rejected."*
- `context/archive/2026-06-09-manage-devices/plan.md:58-94,75` — device entity design; **no `userId`** (devices shared across users), so the context applies to all users — no per-user override.
- `context/archive/2026-06-10-scan-and-add-services/research.md:127` — `composePath` ("per-device path conventions") was noted against FR-005; a candidate to consider as structured context vs free-text prompt (but currently unimplemented).
- `context/archive/2026-06-11-diagnose-service-synthesis/plan.md:88-110` — synthesis north-star is synthesis-only; per-device refinement deferred to S-07; NFR < 15 s for ~200 lines (context injection must not add overhead).
- **No code-level placeholder/TODO exists** for the field — deferral is at the roadmap level only. Field naming (`context`/`agentContext`/`systemPrompt`/`instructions`) is **not yet enshrined**; roadmap wording is "system prompt".

## Related Research

- `context/archive/2026-06-09-manage-devices/research.md` — device entity exploration.
- `context/archive/2026-06-11-diagnose-service-synthesis/research.md` — diagnose prompt/agent exploration.

## Open Questions

1. **Field name** — `context`, `agentContext`, `systemPrompt`, or `instructions`? No precedent; roadmap says "system prompt". (Affects DB column, shared contracts, form control.)
2. **Max length** — no `.max()` precedent for device text fields (auth uses 128). A system prompt is long-form; pick a sensible bound (e.g. a few KB) and decide whether it's a config-layer tunable or a literal in the schema.
3. **Injection style** — AI SDK `system` parameter (recommended) vs concatenation into `buildPrompt`. The `system` slot is cleaner and idiomatic.
4. **Persist the context in the run record?** Not required for the core flow, but persisting the exact context used would aid transcript replay/audit (FR-010/FR-011) — would need `run-record` schema + column changes.
5. **Free-text vs structured** — pure free-text prompt now, or also capture structured `composePath` (noted in scan-and-add-services) that the `up`/`down` operations could reuse? MVP leans free-text; structured paths may be a separate concern.
6. **Empty-context behaviour** — confirm the prompt reads cleanly when context is null/empty (omit the `system` arg entirely vs send empty string).
