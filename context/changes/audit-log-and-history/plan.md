# Audit Log + Linked History (S-09 / FR-011) Implementation Plan

## Overview

Activate the pre-positioned audit seam: add a new `audit_log` table for user actions, finally
wire the reserved `run_record.userId` (+ FK + `user` relation), write audit rows **inline in each
action's transaction** where one exists (and record-on-invocation where one cannot), and ship a
bundled, single merged-chronological history/replay view. The `audit_log` table is the spine of
the timeline; rows linked to a diagnose run expand to the saved synthesis via the
`audit_log.runRecordId → run_record.id` FK.

This is the slice that turns plumbing prior slices left in place (the reserved `userId` column +
`run_record_user_idx`, the guard-populated `request.session`) into a working accountability record.

## Current State Analysis

The agent-run half of FR-011 already exists and was built S-09-ready:

- `run_record` (`apps/api/src/database/schema/run-record.schema.ts:12-36`) carries a **nullable,
  FK-less, indexed `userId`** explicitly reserved for S-09 — never written, never read, stripped
  from the wire contract (`run-record.service.ts:11-16`, `libs/shared/.../run-record.schema.ts`).
- The global `AuthAppGuard` validates every non-public request and attaches `request.session`
  (`auth.guard.ts:38-39`), but **no `@CurrentUser()`/`@CurrentUserId()` accessor exists** and no
  feature controller reads the session today.
- There is **no user-action audit surface**: ~18 authenticated mutating endpoints across
  device / service / skill / llm-provider / credential / diagnose record nothing.

Transaction reality (verified, drives the two-tier model):

- **Single-statement writes** (need a wrapping txn to join the audit insert atomically):
  `device.create/update/remove` (`device.service.ts:15,33,46`),
  `service.create/update/remove` (`service.service.ts:72,98,106`),
  `skill.remove` (`skill.service.ts:94`),
  `llm-provider.update/remove` (`llm-provider.service.ts:64,99`),
  `credential.create/remove` (`credential.service.ts:22,67`).
- **Already in `db.transaction()`** (audit insert joins the existing block):
  `skill.create/update` (`skill.service.ts:24,66`),
  `llm-provider.create/activate` (`llm-provider.service.ts:34,92`),
  `RunRecordService.create` (`run-record.service.ts:36`).
- **External call before the DB write** (stays outside the txn — already rejects early):
  LLM probe in `llm-provider.create/update` (`:27,71`), encryption in `credential.create` (`:23`).
- **Side-effect ops with no DB write** (Tier 2, record-on-invocation): `skill.run` SSH
  (`skill-run.service.ts:52`), `service.scan` SSH (`service.service.ts:47`), and `diagnose.run`
  whose `run_record` is written inside the SSE stream (`diagnose.service.ts:129`).

All mutating services already `@Inject(DATABASE_CONNECTION)`, so an audit insert can share the
connection. `better-sqlite3` is synchronous.

## Desired End State

Every authenticated mutating action writes exactly one `audit_log` row keyed off
`request.session.user.id`. Tier-1 CRUD writes are atomic with the action (a failed audit insert
rolls the action back); Tier-2 ops record on invocation with an outcome. `diagnose.run` writes both
`run_record` (with `userId`) and a linked `audit_log` row. A new `/audit` route renders one merged
chronological timeline; clicking a run-linked row expands the saved synthesis card.

Verify: `npm run db:generate` produces a clean migration; `npx nx test api` and `npx nx test web`
pass; performing each mutating action via the UI produces an audit row; the `/audit` view lists
actions newest-first and expands diagnose-run detail.

### Key Discoveries:

- The `userId` column + `run_record_user_idx` + "reserved for s-09" comments mean the run model is
  activated, not redesigned (`run-record.schema.ts:7-11,27-34`).
- Identity is one decorator away — the guard already attaches `request.session.user.id`
  (`auth.guard.ts:38-39`); add a `createParamDecorator` mirroring `public.decorator.ts`.
- The strict contract boundary holds everywhere: list = `http.get<unknown[]>` → `.parse()`; rows map
  through a Zod `toContract()` (`devices.client.ts`, `run-record.service.ts:82-90`). The audit
  feature must not break this — define `auditEventSchema` once in `@opspilot/shared`.
- Secrets must never enter the audit payload — credential/llm-provider rows store metadata (ids,
  labels) only (`research.md` Area 3).
- `provideRouter` lacks `withComponentInputBinding` (`app.config.ts`) — the view is a single
  component with in-store selected detail (the diagnosis approach), so **no router change needed**.

## What We're NOT Doing

- **No narration/transcript capture.** "Transcript" = the stored final synthesis (frame Dim 1 ruled
  out); the SSE hot path is untouched.
- **No auth-flow auditing** (login/logout/registration) — they flow through better-auth's catch-all
  and need a different hook; out of scope for this slice.
- **No dedicated skill-run record table.** `skill.run` gets an `audit_log` row, not a rich
  `run_record`-style model.
- **No old→new field diffs.** Granularity is action + target + lightweight metadata.
- **No bidirectional linkage.** A single nullable `audit_log.runRecordId → run_record.id` FK; we do
  **not** add `run_record.userActionId`.
- **No audit-log pruning.** Audit rows are retained indefinitely (no `AUDIT_LOG_RETENTION` tunable).
- **No backfill.** Historical `run_record` rows keep `userId = NULL` and have no audit row; only
  new actions are recorded.

## Implementation Approach

Two linked tables (frame Dim 5 settled): keep `run_record` as the agent-run table and add
`audit_log` for user actions, linked via `audit_log.runRecordId`. An `AuditService.record(...)`
accepts a transaction handle so Tier-1 callers pass their own `tx` (atomic) and Tier-2 callers pass
the base connection (record-on-invocation). Controllers obtain the user id via a new
`@CurrentUserId()` param decorator and thread it into service methods. The web timeline is a single
`audit_log`-driven list with a LEFT JOIN to `run_record` so run-linked rows carry their synthesis
inline — one list query, no client-side union.

Phasing builds foundation-first so behavior wiring lands on a tested base: (1) schema + contract +
identity accessor + audit service, (2) Tier-1 inline CRUD writes, (3) Tier-2 record-on-invocation
ops + diagnose-run linkage, (4) web history view.

## Critical Implementation Details

**Transaction handle threading.** `AuditService.record` must accept an optional Drizzle transaction
(`tx`) and fall back to the base connection. Tier-1 callers invoke it **inside** their
`db.transaction((tx) => …)` block passing `tx`, so the audit insert and the action commit or roll
back together. Passing the base `db` instead of `tx` would run the audit insert in a separate
implicit transaction and break the atomic guarantee — the whole point of the "guaranteed in
transaction" posture.

**FK on-delete for `audit_log.runRecordId`.** `run_record` prunes by retention
(`run-record.service.ts:47-58`) but the audit log is retained indefinitely. The FK must be
`onDelete: 'set null'` so pruning a run nulls the link without deleting the (retained) audit row.

**External calls stay outside the txn.** The LLM probe and credential encryption already run before
the DB write and reject early; do not pull them into the new transaction wrapper — only the DB write
+ audit insert are atomic (frame Tier-1 caveat).

**Tier-2 has no atomic-with-effect guarantee.** `skill.run`/`service.scan` persist nothing and
`diagnose.run` writes inside the SSE stream, so their audit rows are written on invocation with the
observed outcome. A run that errors before its persist point leaves no audit row — an accepted
limitation, identical to how `run_record` itself behaves today.

## Phase 1: Schema, Contract & Identity Foundation

### Overview

Add the `audit_log` table, activate `run_record.userId` (FK + relation), define the shared contract,
add the `@CurrentUserId()` accessor, and build `AuditService` + `AuditModule`. No action wiring yet.

### Changes Required:

#### 1. `audit_log` Drizzle schema

**File**: `apps/api/src/database/schema/audit-log.schema.ts` (new)

**Intent**: Persist one row per user action, keyed off the session user, linkable to a diagnose run.

**Contract**: `sqliteTable('audit_log', …)` mirroring `run-record.schema.ts` conventions. Columns:
`id` (text PK, app `randomUUID`), `userId` (text, NOT NULL, FK→`user.id`), `action` (text),
`targetType` (text, nullable), `targetId` (text, nullable), `metadata` (text JSON, nullable),
`runRecordId` (text, nullable, FK→`run_record.id`, **`onDelete: 'set null'`**), `createdAt`
(integer `timestamp_ms`, `unixepoch` default, NOT NULL). Indexes: `audit_log_created_idx` on
`(createdAt)` (timeline order-by) and `audit_log_user_idx` on `(userId)`. A `user` + `runRecord`
relations block. Add the `export *` line to `database/schema/index.ts`.

#### 2. Activate `run_record.userId`

**File**: `apps/api/src/database/schema/run-record.schema.ts`

**Intent**: Add the FK and `user` relation the column was reserved for; keep it nullable (historical
NULLs remain valid).

**Contract**: `userId: text('user_id').references(() => user.id, { onDelete: 'set null' })`; add a
`user: one(user, …)` entry to `runRecordRelations`. Index `run_record_user_idx` already exists.

#### 3. Accept `userId` in `RunRecordService.create`

**File**: `apps/api/src/diagnose/run-record.service.ts`

**Intent**: Allow the diagnose flow to persist the authenticated user on a run.

**Contract**: Add `userId: string` to the `RunRecordCreate` interface (`:12-16`) and write it in the
insert (`:38-44`). `toContract` (`:82-90`) still omits `userId` from the wire shape.

#### 4. Generate migration

**File**: `apps/api/migrations/*` (generated)

**Intent**: Emit the numbered SQL for the new table + FK; applied automatically at boot by
`MigrationService`.

**Contract**: `npm run db:generate` diffs the schema and updates `meta/_journal.json`. Review the
generated SQL creates `audit_log` and alters `run_record` (FK add).

#### 5. Shared contract schemas

**File**: `libs/shared/src/lib/schemas/audit-log.schema.ts`, `audit-event.schema.ts`,
`audit-list-query.schema.ts` (new), barrel line in `libs/shared/src/index.ts`

**Intent**: One source of truth for the action enum, the wire event shape, and the list query.

**Contract**: `auditActionSchema` = a `z.enum([...])` of the action strings
(`device.create|update|delete`, `service.scan|create|update|delete`, `skill.create|update|delete|run`,
`llmProvider.create|update|activate|delete`, `credential.create|delete`, `diagnose.run`).
`auditEventSchema` = `z.strictObject({ id, userId, action: auditActionSchema, targetType: nullable,
targetId: nullable, metadata: nullable record, runRecordId: nullable, createdAt: isoTimestamp,
synthesis: diagnosisSynthesisSchema.optional() })` — `synthesis` populated only for run-linked rows
via the join. `auditListQuerySchema` mirrors `credential-list-query.schema.ts` (`limit` 1–100,
`offset` ≥0, `z.coerce.number()`) plus optional `action`, `from`, `to` filters. Reuse `isoTimestamp`
([[wire-level-timestamps-iso-strings-better-auth-boundary]]). One export per file.

#### 6. `@CurrentUserId()` param decorator

**File**: `apps/api/src/common/current-user-id.decorator.ts` (new)

**Intent**: Ergonomic accessor returning the guard-attached user id; no re-query.

**Contract**: `createParamDecorator((_, ctx) => ctx.switchToHttp().getRequest<AuthenticatedRequest>()
.session?.user.id)` returning `string`. Mirror the placement/style of `public.decorator.ts`. Reuse
`AuthenticatedRequest` from `auth.guard.ts:9-11`.

#### 7. `AuditService` + `AuditModule`

**File**: `apps/api/src/audit/audit.service.ts`, `audit.module.ts` (new); register in
`app/app.module.ts`

**Intent**: Central insert (txn-aware) + the timeline list query; consumed by every mutating module.

**Contract**: `record(input: { userId; action; targetType?; targetId?; metadata?; runRecordId? },
tx?)` inserts one row using `tx ?? this.db` (the txn-handle nuance above), `randomUUID` id. `list(query)`
selects `audit_log` LEFT JOIN `run_record` on `runRecordId`, order by `createdAt desc`, paginated,
mapping each row through `auditEventSchema` (synthesis parsed from the joined run for linked rows).
Explicit `@Inject(DATABASE_CONNECTION)`. `AuditModule` exports `AuditService`; re-apply `json()` via
`configure(consumer)` (global body parser is off for the better-auth catch-all). Imported by every
feature module that records.

### Success Criteria:

#### Automated Verification:

- Migration generates cleanly: `npm run db:generate` (no error, new files emitted)
- API type-checks and builds: `npx nx build api`
- Shared lib builds: `npx nx build shared`
- API unit tests pass: `npx nx test api`
- Lint passes: `npm run lint`

#### Manual Verification:

- Booting the api applies the migration without error (`audit_log` table exists, `run_record` FK added)
- `@CurrentUserId()` resolves a non-null id when called from an authenticated handler (smoke via a temp log or a unit test of the decorator)

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Tier-1 Inline CRUD Audit Writes

### Overview

Thread `userId` from controllers into every Tier-1 CRUD service method and write the audit row inside
the action's transaction — wrapping single-statement writes in a new `db.transaction()` and joining
the audit insert into the services that already have one.

### Changes Required:

#### 1. Thread `@CurrentUserId()` through CRUD controllers

**File**: `apps/api/src/{device,service,skill,llm-provider}/...controller.ts`,
`device/credential/device-credential.controller.ts`

**Intent**: Pass the session user id into each mutating service call.

**Contract**: Add a `@CurrentUserId() userId: string` param to each mutating handler
(create/update/remove/scan/activate per the inventory in `research.md` Area 3) and forward it to the
service method. Controllers stay thin — no logic beyond passing the id.

#### 2. Audit writes in already-transactional services

**File**: `apps/api/src/skill/skill.service.ts` (`create:24`, `update:66`),
`apps/api/src/llm-provider/llm-provider.service.ts` (`create:34`, `activate:92`)

**Intent**: Record the action atomically by joining the existing transaction.

**Contract**: Each method takes `userId`; inside the existing `db.transaction((tx) => …)` call
`auditService.record({ userId, action, targetType, targetId, metadata }, tx)` after the write. Inject
`AuditService`. Metadata is secret-free (skill: `{ name }`; provider: `{ providerId, label }`).

#### 3. Wrap single-statement writes in a transaction + audit insert

**File**: `apps/api/src/device/device.service.ts` (`:15,33,46`),
`apps/api/src/service/service.service.ts` (`create:72,update:98,remove:106`),
`apps/api/src/skill/skill.service.ts` (`remove:94`),
`apps/api/src/llm-provider/llm-provider.service.ts` (`update:64,remove:99`),
`apps/api/src/credential/credential.service.ts` (`create:22,remove:67`)

**Intent**: Make the audit insert atomic with writes that are currently bare statements.

**Contract**: Wrap the existing write in `this.db.transaction((tx) => { …write via tx…;
auditService.record({…}, tx); return row; })`. Keep external calls (LLM probe `:71`, encryption
`:23`) **before** and outside the transaction. Preserve the unique-constraint try/catch in
`service.create` (`:72`). Credential/provider metadata stores ids/labels only — never the secret.

### Success Criteria:

#### Automated Verification:

- API unit tests pass (services + a rollback test: a forced audit failure rolls the action back): `npx nx test api`
- API builds: `npx nx build api`
- Lint passes: `npm run lint`

#### Manual Verification:

- Creating/updating/deleting a device, service, skill, llm-provider, and credential each inserts one `audit_log` row with the correct `userId`, `action`, and `targetId`
- No plaintext secret appears in any `credential.*` or `llmProvider.*` audit `metadata`
- A simulated audit-insert failure leaves the action un-committed (atomicity holds)

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 3.

---

## Phase 3: Tier-2 Record-on-Invocation (Ops + Agent Runs)

### Overview

Record audit rows for the side-effect ops that have no DB transaction to join: `skill.run`,
`service.scan`, and `diagnose.run` — the last co-writing `run_record.userId` and a linked
`audit_log` row.

### Changes Required:

#### 1. `skill.run` audit row

**File**: `apps/api/src/skill/skill-run.service.ts` (`run:52`), `skill-run.controller.ts`

**Intent**: Record who ran which skill on which service, with the observed outcome.

**Contract**: Thread `@CurrentUserId()` into `run(...)`; after the SSH op resolves, call
`auditService.record({ userId, action: 'skill.run', targetType: 'service', targetId: serviceId,
metadata: { skillName, outcome } })` on the base connection (no txn). Inject `AuditService` +
`AuditModule` into `SkillModule`.

#### 2. `service.scan` audit row

**File**: `apps/api/src/service/service.service.ts` (`scan:47`), `service.controller.ts`

**Intent**: Record who triggered a scan and the result count.

**Contract**: Thread `userId`; after the scan resolves, `auditService.record({ userId,
action: 'service.scan', targetType: 'device', targetId: deviceId, metadata: { found } })` on the base
connection.

#### 3. `diagnose.run` userId + linked audit row

**File**: `apps/api/src/diagnose/diagnose.controller.ts` (`stream:39`),
`apps/api/src/diagnose/diagnose.service.ts` (`narrate:44`, persist `:129`)

**Intent**: Persist the user on the run and emit one linked audit row at the same point the
`run_record` is written.

**Contract**: Add `@CurrentUserId() userId` to the SSE handler and thread it through `narrate` →
`buildNarration` → `RunRecordService.create({ …, userId })`. After the run record is created
(`:129`), call `auditService.record({ userId, action: 'diagnose.run', targetType: 'service',
targetId: serviceId, runRecordId: run.id })`. Inject `AuditService` into the diagnose module.

### Success Criteria:

#### Automated Verification:

- API unit tests pass (run-record now persists `userId`; diagnose/skill-run services record audit): `npx nx test api`
- API builds: `npx nx build api`
- Lint passes: `npm run lint`

#### Manual Verification:

- Running a skill inserts a `skill.run` audit row with `outcome`; scanning a device inserts a `service.scan` row
- Completing a diagnose run writes `run_record.userId` AND a linked `diagnose.run` audit row whose `runRecordId` points at the run
- The diagnose SSE stream behaves unchanged (no regression in narration/replay)

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 4.

---

## Phase 4: Web History / Timeline View

### Overview

Add the `/audit` route: a single merged chronological timeline driven by `audit_log`, where
run-linked rows expand to the saved synthesis card — reusing the S-05 replay renderer.

### Changes Required:

#### 1. Audit list endpoint

**File**: `apps/api/src/audit/audit.controller.ts` (new)

**Intent**: Serve the paginated, filterable timeline.

**Contract**: `GET /api/audit` validating `auditListQuerySchema` on the query (`ZodValidationPipe`),
delegating to `AuditService.list`, returning `AuditEvent[]`. Thin controller; guarded by the global
`AuthAppGuard`.

#### 2. Audit HTTP client

**File**: `apps/web/src/app/core/clients/audit.client.ts` (new)

**Intent**: Typed boundary call mirroring `diagnosis.client.ts`.

**Contract**: `list(query?)` → `http.get<unknown[]>('/api/audit', { params })` →
`auditEventSchema.array().parse(rows)`. Query params follow the `skills.client.ts` pattern.

#### 3. Audit store

**File**: `apps/web/src/app/core/stores/audit.store.ts` (new)

**Intent**: `signalState` list store with selected-row detail (no re-fetch, like `diagnosis.store.replay`).

**Contract**: State `{ events, error, loading, selectedId }`; `load(query?)`, `select(id)`,
`isEmpty` computed, reuse the `errorMessage(error, fallback)` helper pattern from `devices.store.ts:33-41`.

#### 4. Audit feature component + template

**File**: `apps/web/src/app/features/audit/audit.component.{ts,html}` (new)

**Intent**: Spartan list with expandable detail; run-linked rows render the synthesis card.

**Contract**: `OnPush`, `providers: [AuditClient, AuditStore]`, `store.load()` in ctor. Template
mirrors `devices.component.html` (error `role="alert"`, `<hlm-empty>`, `hlmTable`) for the row list
(`{{ event.createdAt | date:'short' }} · {{ event.action }} · target`) and
`device-services.component.html:60-99` (the `hlmCard` synthesis block) for the expanded detail of a
row whose `synthesis` is present. `DatePipe` for timestamps.

#### 5. Route + nav link

**File**: `apps/web/src/app/app.routes.ts`, `apps/web/src/app/home/home.component.html`

**Intent**: Lazy `/audit` route (guarded) + a nav link.

**Contract**: Add `{ canActivate: [authGuard], loadComponent: () => import('./features/audit/
audit.component').then(({ AuditComponent }) => AuditComponent), path: 'audit' }` before the `''` and
`'**'` routes. Add `<a routerLink="/audit">…</a>` to the nav block (`home.component.html:14-18`). No
`withComponentInputBinding` change (single-component, in-store selection).

### Success Criteria:

#### Automated Verification:

- Web builds: `npx nx build web`
- Web unit tests pass: `npx nx test web`
- API tests pass (audit controller/list): `npx nx test api`
- Lint passes: `npm run lint`

#### Manual Verification:

- `/audit` lists actions newest-first, paginated, with correct action/target/time
- Clicking a `diagnose.run` row expands the saved synthesis card (status badge + summary + problems/suggestions)
- Empty state and error line render correctly; the nav link reaches the view
- Performing any mutating action then refreshing `/audit` shows the new row

**Implementation Note**: After automated verification passes, pause for final manual confirmation.

---

## Testing Strategy

### Unit Tests:

- `AuditService.record` writes a row with the passed `tx` (joins the caller's transaction) and falls
  back to base `db` when no `tx`; `list` maps run-linked rows to include synthesis.
- A Tier-1 rollback test: forcing the audit insert to throw inside a CRUD transaction leaves the
  action un-committed.
- `@CurrentUserId()` returns `req.session.user.id`.
- Secret-free metadata: credential/llm-provider audit rows contain no plaintext secret.
- `RunRecordService.create` persists `userId`; `auditEventSchema` round-trips a row (timestamp → ISO).

### Integration Tests:

- End-to-end per Tier-1 action: call the controller, assert one audit row with correct fields.
- `diagnose.run`: stream completes → `run_record.userId` set AND a linked `audit_log` row exists.

### Manual Testing Steps:

1. Create/update/delete one entity in each module via the UI; confirm one audit row each.
2. Run a skill and scan a device; confirm `skill.run` / `service.scan` rows with outcome/count.
3. Run a diagnose; confirm `run_record.userId` + linked `diagnose.run` row; open `/audit` and expand it.
4. Inspect credential/provider audit metadata — confirm no secret material.
5. Verify `/audit` pagination, empty state, error line, and nav link.

## Performance Considerations

One extra insert per mutating action (synchronous `better-sqlite3`, negligible on a homelab volume).
The timeline list is a single indexed `audit_log` query (`audit_log_created_idx`) with a LEFT JOIN to
`run_record` and `.limit()/.offset()` — no unbounded scan. Indefinite retention grows the table
unbounded, but homelab action volume is low; revisit only if it ever matters.

## Migration Notes

`npm run db:generate` emits the SQL; `MigrationService` applies it at boot behind the backup gate
(`migration.service.ts:24-38`). The `run_record.userId` FK is additive on a nullable column — existing
rows stay valid with `userId = NULL`. No data backfill. The `audit_log.runRecordId` FK uses
`onDelete: 'set null'` so run pruning never deletes a retained audit row.

## References

- Frame brief: `context/changes/audit-log-and-history/frame.md`
- Research: `context/changes/audit-log-and-history/research.md`
- Run-record txn template: `apps/api/src/diagnose/run-record.service.ts:35-90`
- Guard identity source: `apps/api/src/auth/auth.guard.ts:38-39`
- Web replay pattern: `apps/web/src/app/core/stores/diagnosis.store.ts:68-77`,
  `apps/web/src/app/features/services/device-services.component.html:60-112`
- Lessons: [[inject-nestjs-deps-with-explicit-token]],
  [[compute-then-write-invariants-one-transaction]],
  [[wire-level-timestamps-iso-strings-better-auth-boundary]],
  [[operational-tunables-in-config-layer-not-in-file-const]]

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema, Contract & Identity Foundation

#### Automated

- [x] 1.1 Migration generates cleanly: `npm run db:generate` — 0cd68b3
- [x] 1.2 API type-checks and builds: `npx nx build api` — 0cd68b3
- [x] 1.3 Shared lib builds: `npx nx build shared` — 0cd68b3
- [x] 1.4 API unit tests pass: `npx nx test api` — 0cd68b3
- [x] 1.5 Lint passes: `npm run lint` — 0cd68b3

#### Manual

- [x] 1.6 Booting the api applies the migration without error (`audit_log` table + `run_record` FK) — 0cd68b3
- [x] 1.7 `@CurrentUserId()` resolves a non-null id from an authenticated handler — 0cd68b3

### Phase 2: Tier-1 Inline CRUD Audit Writes

#### Automated

- [x] 2.1 API unit tests pass incl. rollback test: `npx nx test api` — 9934a38
- [x] 2.2 API builds: `npx nx build api` — 9934a38
- [x] 2.3 Lint passes: `npm run lint` — 9934a38

#### Manual

- [x] 2.4 Each CRUD action inserts one audit row with correct userId/action/targetId — 9934a38
- [x] 2.5 No plaintext secret in any credential/llmProvider audit metadata — 9934a38
- [x] 2.6 A simulated audit-insert failure leaves the action un-committed (atomicity holds) — 9934a38

### Phase 3: Tier-2 Record-on-Invocation (Ops + Agent Runs)

#### Automated

- [x] 3.1 API unit tests pass (run-record userId; diagnose/skill-run audit): `npx nx test api`
- [x] 3.2 API builds: `npx nx build api`
- [x] 3.3 Lint passes: `npm run lint`

#### Manual

- [x] 3.4 skill.run inserts a row with outcome; service.scan inserts a row with count
- [x] 3.5 diagnose run writes run_record.userId AND a linked diagnose.run audit row
- [x] 3.6 Diagnose SSE stream unchanged (no narration/replay regression)

### Phase 4: Web History / Timeline View

#### Automated

- [ ] 4.1 Web builds: `npx nx build web`
- [ ] 4.2 Web unit tests pass: `npx nx test web`
- [ ] 4.3 API tests pass (audit controller/list): `npx nx test api`
- [ ] 4.4 Lint passes: `npm run lint`

#### Manual

- [ ] 4.5 `/audit` lists actions newest-first, paginated, correct fields
- [ ] 4.6 Clicking a diagnose.run row expands the saved synthesis card
- [ ] 4.7 Empty state, error line, and nav link work
- [ ] 4.8 Performing a mutating action then refreshing `/audit` shows the new row
