---
date: 2026-06-13T00:00:00Z
researcher: Karol Dydo
git_commit: c86ed9f866429cb3ffc0011919ae7f4e3a1e47b8
branch: main
repository: opspilot
topic: "Audit log + linked history view (S-09 / FR-011)"
tags: [research, codebase, audit-log, run-record, better-auth, drizzle, history-view]
status: complete
last_updated: 2026-06-13
last_updated_by: Karol Dydo
---

# Research: Audit log + linked history view (S-09 / FR-011)

**Date**: 2026-06-13T00:00:00Z
**Researcher**: Karol Dydo
**Git Commit**: c86ed9f866429cb3ffc0011919ae7f4e3a1e47b8
**Branch**: main
**Repository**: opspilot

## Research Question

How should the audit-log-and-history feature (roadmap slice S-09, PRD FR-011) be implemented?
The audit trail must reliably record "who did what" — user actions and agent runs (with the run
transcript), linked to each other — keyed off the in-app Better Auth session as the audit identity.
Map the existing run-record/transcript model, the identity threading, every auditable user action,
the reusable web history/replay UI, and the schema/contract/migration path; then evaluate one-table
vs two-linked-tables and recommend a concrete structure.

**Scope decisions confirmed with the user before research:**
- **Identity source**: assume the in-app Better Auth session (per `infrastructure.md`, treat
  Cloudflare Access as a network gate only). Open Roadmap Question 2 resolved to the default.
- **Table structure**: evaluate one-vs-two tables and recommend a concrete schema grounded in
  current conventions.
- **Depth**: comprehensive — feeds `/10x-plan` directly.

## Summary

The agent-run half of FR-011 **already exists** and was deliberately built S-09-ready: the
`run_record` table carries a **nullable, FK-less, indexed `userId` column explicitly reserved for
S-09**, but it is never written, never read, and stripped from the wire contract. The auth half is
also in place — the global `AuthAppGuard` validates every non-public request and attaches
`request.session` (containing `user.id`) — but **no `@CurrentUser()` accessor exists yet**, and **no
feature controller reads the session today**. So S-09 is precisely the slice that activates plumbing
that prior slices pre-positioned.

Three structural gaps the plan must close:

1. **No user identity on agent runs.** The diagnose/SSE flow never threads the authenticated user
   into `RunRecordService.create()`. The `userId` column, its index, and its (future) FK exist but
   carry NULL for every run written so far.
2. **No user-action audit surface at all.** There are ~18 authenticated mutating endpoints across
   device / service / skill / llm-provider / credential / diagnose, none of which record an audit
   entry. This is the "user-action side" the roadmap says S-09 adds.
3. **No "transcript" persisted.** Despite FR-011's "run transcript" wording, runs persist only the
   final 4-field synthesis JSON blob (`run_record.synthesis`). Live narration partials are ephemeral
   (SSE only). "Replay" = re-render the saved synthesis, not a step-by-step transcript. The plan must
   decide whether FR-011's "transcript" is satisfied by the stored synthesis (recommended — matches
   the current product) or requires capturing narration steps (a larger scope expansion).

**Recommended structure (evaluated below): two linked tables.** A new `audit_log` table for user
actions, linked to the existing `run_record` table via a nullable `run_record.userActionId` (or an
`audit_log.runRecordId`) FK — plus finally wiring `run_record.userId`. This matches the shape-notes
proposal, keeps the rich diagnose-run shape intact, and avoids forcing a polymorphic single table to
carry both a heterogeneous action payload and a structured synthesis.

## Detailed Findings

### Area 1 — The agent-run + transcript model (the half that exists)

**`run_record` Drizzle table** — `apps/api/src/database/schema/run-record.schema.ts:12-36`:
- Columns: `id` (text PK, app-generated UUID), `deviceId` (FK→`device.id`, cascade, NOT NULL),
  `serviceId` (FK→`service.id`, cascade, NOT NULL), `synthesis` (text, JSON blob, NOT NULL),
  `createdAt` (integer `timestamp_ms`, `unixepoch` default, NOT NULL), and
  **`userId` (text, nullable, NO FK)** — header comment at lines 7-11 states verbatim it is
  *"reserved for s-09 (no fk yet); it is never surfaced in the s-05 wire contract"*.
- Indexes (`run-record.schema.ts:30-35`): `run_record_service_created_idx` on `(serviceId, createdAt)`
  drives the recent-list query; **`run_record_user_idx` on `(userId)` is pre-positioned for the S-09
  by-user lookup** but no code path uses it.
- Relations (`run-record.schema.ts:38-47`): `device` + `service` only. **No `user` relation** despite
  the column.

**Shared wire contract** — `libs/shared/src/lib/schemas/run-record.schema.ts:15-23`:
```ts
export const runRecordSchema = z.strictObject({
  createdAt: isoTimestamp,
  deviceId: z.string(),
  id: z.string(),
  serviceId: z.string(),
  synthesis: diagnosisSynthesisSchema,
});
export type RunRecord = z.infer<typeof runRecordSchema>;
```
`userId` is **deliberately absent** (comment lines 11-14). `synthesis` is the rich 4-field object
(`diagnosis-synthesis.schema.ts:11-18`: `status` enum, `problems[]`, `suggestions[]`, `summary`).
`isoTimestamp` (line 9) normalizes a Drizzle `Date` or wire ISO string to an ISO string.

**Who writes runs / the identity gap** — `apps/api/src/diagnose/`:
- `DiagnoseService.buildNarration()` calls `runRecordService.create({ deviceId, serviceId, synthesis })`
  at `diagnose.service.ts:129`, inside the SSE stream, persisting **before** the `done` frame.
- `RunRecordService.create()` (`run-record.service.ts:35-62`) accepts only
  `{ deviceId, serviceId, synthesis }` (`run-record.service.ts:12-16`) — comment line 11:
  *"userId is reserved for s-09 and not part of the s-05 flow, so it isn't accepted here."* It inserts
  in one transaction, then prunes older runs beyond `historyRetention`.
- The trigger (`@Sse('diagnose/stream')`, `diagnose.controller.ts:39-45`) reads **no** session/user.
  **A run record carries device + service identity only, never the user.**

**No transcript** — full-text search for "transcript" across `apps/api/src` + `libs/shared/src` =
zero hits. Narration partials stream via `streamObject().partialObjectStream`
(`diagnose.service.ts:117-122`) over SSE frames (`run-narration-event.schema.ts:17-31`, a
`delta`/`done`/`error` union) but are **never persisted**. Only the final synthesis is saved.

**Existing run query surface** (`diagnose.controller.ts`):
- `GET .../diagnose/runs` → `runs()` (`:21-32`) — recent saved runs for one service, newest-first,
  `?limit`/`?offset`, limit capped at `MAX_RUNS_LIMIT = 100`. Filtering is **only** by
  `(deviceId, serviceId)`. **No global list, no get-one-by-id, no by-user / by-date filter.**

### Area 2 — Identity threading (the audit "who")

**Better Auth tables** — `apps/api/src/database/schema/auth.schema.ts`:
- `user` (`:4-17`): `id: text('id').primaryKey()` (app-generated text) — the id the audit must key off.
- `session` (`:19-38`): `userId` FK→`user.id` (cascade), `session_userId_idx`.
- Type-compatible with a future `run_record.userId → user.id` FK (both `text`).

**Auth wiring** — `apps/api/src/auth/`: single `betterAuth(...)` factory (`create-auth.ts:19-42`,
`basePath:'/auth'`, drizzle SQLite adapter, email+password); DI token `AUTH_INSTANCE`
(`providers/auth.provider.ts:7-23`); catch-all `@All('*splat')` → `toNodeHandler`
(`auth.controller.ts:8-17`, `@Public()`).

**Global guard** — registered as `APP_GUARD` in `app/app.module.ts:35`. `AuthAppGuard`
(`auth.guard.ts:15-42`): `@Public()` short-circuits; otherwise `getSession(...)`, null →
`UnauthorizedException`. **Critically, it attaches the session to the request** (`auth.guard.ts:38-39`):
```ts
// attach the validated session so handlers read the identity without re-querying.
request.session = session;
```
Typed shapes at `auth.guard.ts:9-13`; `getSession` returns `{ session, user: { id, ... } }`.

**The missing accessor** — repo-wide, `request.session`/`getSession`/`AuthenticatedRequest` appear
**only** in `auth.guard.ts` + `auth.controller.ts`. **No `@CurrentUser()` / `@CurrentUserId()`
param decorator exists, and no feature controller reads the user today.** The plumbing is present
(guard-populated `request.session.user.id`); the ergonomic accessor must be **added** — recommended:
a `createParamDecorator` in `apps/api/src/common/` returning `req.session.user.id`. No re-query or
request-scoped provider needed.

**Shared auth contracts** — `libs/shared/src/lib/schemas/auth-user.schema.ts:10-18` (`authUserSchema`,
`id` is the user id). The known timestamp lesson is encoded here (`:5-6`): `isoTimestamp` preprocess
handles ISO-on-wire vs Date-at-the-Better-Auth-client boundary — reuse for any audit timestamp that
may originate client-side. See [[wire-level-timestamps-iso-strings-better-auth-boundary]].

### Area 3 — Inventory of auditable user actions

~18 authenticated mutating endpoints (all behind `AuthAppGuard`, so `request.session.user.id` is
guaranteed available). GET/read endpoints excluded.

| Module | Endpoint | Service method | Action | File:line |
|---|---|---|---|---|
| Device | `POST /devices` | `deviceService.create` | device.create | `device.controller.ts:18` |
| Device | `PATCH /devices/:id` | `deviceService.update` | device.update | `device.controller.ts:37` |
| Device | `DELETE /devices/:id` | `deviceService.remove` | device.delete | `device.controller.ts:42` |
| Service | `POST /devices/:deviceId/scan` | `serviceService.scan` | service.scan | `service.controller.ts:34` |
| Service | `POST /devices/:deviceId/services` | `serviceService.create` | service.create | `service.controller.ts:52` |
| Service | `PATCH .../services/:serviceId` | `serviceService.update` | service.update | `service.controller.ts:61` |
| Service | `DELETE .../services/:serviceId` | `serviceService.remove` | service.delete | `service.controller.ts:67` |
| Skill | `POST /skills` | `skillService.create` | skill.create | `skill.controller.ts:19` |
| Skill | `PATCH /skills/:id` | `skillService.update` | skill.update | `skill.controller.ts:40` |
| Skill | `DELETE /skills/:id` | `skillService.remove` | skill.delete | `skill.controller.ts:45` |
| Skill run | `POST .../skills/:skillId/run` | `skillRunService.run` | skill.run (SSH op) | `skill-run.controller.ts:23` |
| Diagnose | `SSE .../diagnose/stream` | `diagnoseService.narrate` | diagnose.run (→ run_record) | `diagnose.controller.ts:44` |
| Credential | `POST /devices/:deviceId/credentials` | `credentialService.create` | credential.create | `device-credential.controller.ts:42` |
| Credential | `DELETE .../credentials/:credentialId` | `credentialService.remove` | credential.delete | `device-credential.controller.ts:59` |
| LLM provider | `POST /llm-providers` | `llmProviderService.create` | llmProvider.create | `llm-provider.controller.ts:21` |
| LLM provider | `PATCH /llm-providers/:id` | `llmProviderService.update` | llmProvider.update | `llm-provider.controller.ts:39` |
| LLM provider | `PATCH /llm-providers/:id/activate` | `llmProviderService.activate` | llmProvider.activate | `llm-provider.controller.ts:44` |
| LLM provider | `DELETE /llm-providers/:id` | `llmProviderService.remove` | llmProvider.delete | `llm-provider.controller.ts:50` |

Auth endpoints (`auth.controller.ts:15`): `sign-up`/`sign-in` are `@Public()` (no prior identity),
`sign-out` requires a session. Whether to audit login/logout/registration is a plan decision (these
flow through Better Auth's catch-all, so capturing them needs a different hook than the param decorator).

**Two design notes the plan must weigh:**
- `skill.run` and `diagnose.run` are **SSH/agent operations**, not DB CRUD — they map onto the
  agent-run side. `diagnose.run` already produces a `run_record`; `skill.run` currently persists
  nothing.
- `credential` and `llm-provider` handle secrets — **never store plaintext credentials/keys in the
  audit payload** (they are encrypted at rest and never cross `/api`). Audit metadata only (which
  provider id, which credential id), not the secret.

### Area 4 — Reusable web history / replay UI

The web app is flat: `core/clients` (HTTP+Zod), `core/stores` (`@ngrx/signals`), `features/*` (lazy
routes). `app.html` is just `<router-outlet>`; nav links live in `home/home.component.html:14-18`.

**Closest analog — diagnosis run history + replay (S-05):** embedded in the device-services view,
not a standalone route, but exactly the list→detail-of-saved-record pattern:
- `core/clients/diagnosis.client.ts:27-31` — `recentRuns()` = `GET` → `runRecordSchema.array().parse(rows)`.
- `core/stores/diagnosis.store.ts:68-77` — `replay(serviceId, run)` does **not** re-fetch; it sets
  `result: run.synthesis` and the same card re-renders. (Click history row → render saved detail.)
- `features/services/device-services.component.html:101-112` — recent-runs row list
  (`{{ run.createdAt | date:'short' }} · {{ run.synthesis.status }}`, `(click)="replay(...)"`) — the
  **audit-timeline row pattern**; lines 60-99 the detail card (status badge + summary + lists) — the
  **audit detail pattern**.

**Canonical list view — devices:** `features/devices/devices.component.ts` (`OnPush`,
`providers:[DevicesClient, DevicesStore]`, `store.load()` in ctor) + `.html` (spartan
`hlmTable*`, `<hlm-empty>` empty state, `{{ ... | date:'short' }}` via `DatePipe`, error line with
`role="alert"`). Store `devices.store.ts`: `signalState`, `load()`, `isEmpty` computed, and a reusable
`errorMessage()` helper (`:33-41`) that parses `HttpErrorResponse.error` through `apiErrorSchema`.

**Contract→http→render (contracts.md enforced):** `devices.client.ts:38-40` types the response as
`unknown[]` then `.parse()` at the boundary — never trusts the wire. Filtered lists use query params
(`skills.client.ts:24-27`, `http.get('/api/skills', { params: { deviceId } })`) — the model for audit
filters (`?deviceId=`, `?action=`, `?from=`, `?to=`).

**Routing:** `app.routes.ts` flat lazy array, every route `canActivate:[authGuard]`. Add an audit
route before `path:''` and the `'**'` wildcard. For a `:id` detail route, `provideRouter` currently
lacks `withComponentInputBinding` (`app.config.ts:12`) — either add it, or follow the diagnosis
approach (single component, in-store selected record, no new route). Nav link → `home.component.html`.

**Pagination contract to mirror:** `credential-list-query.schema.ts` (`limit` 1–100, `offset` ≥0,
`z.coerce.number()`). Date formatting: Angular `DatePipe` everywhere, no custom helper.

### Area 5 — Schema / contract / migration path (how to add the table)

Walked `run_record` + `skill` end-to-end as templates.

**Drizzle** (`run-record.schema.ts:12-47`): `sqliteTable('snake_case', {...}, (t)=>[indexes])`;
`id: text('id').primaryKey()` (UUID from `randomUUID()` in the service, no DB default);
timestamps `integer('created_at',{mode:'timestamp_ms'}).default(sql\`...unixepoch...\`).notNull()`
(`updated_at` adds `.$onUpdate(()=>new Date())`); FK `.references(()=>parent.id,{onDelete:'cascade'})`
(drop `.notNull()` for nullable/global); JSON as `text(...)` + `JSON.stringify`/`parse` in the service;
index every list `where`/`order by` column. Barrel: one `export *` line in `schema/index.ts` (the
`drizzle(sqlite,{schema})` connection auto-types from it).

**Migration:** `npm run db:generate` (`drizzle-kit generate`) diffs schema → emits numbered SQL into
`apps/api/migrations/` + updates `meta/_journal.json`. **Applied automatically at boot** by
`MigrationService` (`migration.service.ts:24-38`, `OnApplicationBootstrap` → backup gate → `migrate()`),
not via CLI.

**Shared Zod** (`run-record.schema.ts`): kebab `.schema.ts`, one export/file, `z.strictObject` +
`export type X = z.infer<...>`, the `isoTimestamp` preprocess for timestamps, Zod v4 idioms
(`z.uuid()`, `z.iso.datetime()`, `{ error: '...' }`). Barrel line in `libs/shared/src/index.ts`.
Drizzle `$inferSelect` types stay in api; map rows through the Zod contract in a `toContract()`
(`run-record.service.ts:82-90`) — never spread the raw row.

**NestJS wiring:** `@Injectable` service, **explicit `@Inject(DATABASE_CONNECTION)`** for the db and
`@Inject(<config>.KEY)` for config — type-based DI returns `undefined` under vitest/esbuild (see
[[inject-nestjs-deps-with-explicit-token]]). `better-sqlite3` is synchronous (`.get/.all/.run`, no
await). Compute-then-write invariants (e.g. prune-on-insert) go in one `db.transaction(...)` (see
[[compute-then-write-invariants-one-transaction]]). New module must re-apply `json()` via
`configure(consumer)` (global body parser is off for the better-auth catch-all); register in
`app.module.ts` imports.

**Retention tunable** (if the audit log prunes): route through the config layer, never an in-file
`const` — `config/env.schema.ts` (Joi `.integer().min(1).default(...)`), a `registerAs` factory
coercing with `Number(...)`, register in `config.module.ts` `load:[...]`, add the field to every
spec's `.overrideProvider(<config>.KEY).useValue({...})`. See
[[operational-tunables-in-config-layer-not-in-file-const]].

## Architecture Insights

- **S-09 was designed-in, not greenfield.** The `userId` column + `run_record_user_idx` index +
  "reserved for s-09" comments mean prior slices left an intentional seam. The plan's job is to
  activate it (write `userId`, add the FK + `user` relation), not redesign the run model.
- **Identity is one decorator away.** The guard already attaches `request.session`; a single
  `@CurrentUser()`/`@CurrentUserId()` param decorator in `common/` unlocks every authenticated
  handler. This is the lowest-risk, highest-leverage addition.
- **"Transcript" is a scope fork.** The product stores final synthesis only; live narration is
  ephemeral. Reading FR-011's "transcript" as "the saved run + its synthesis" keeps S-09 bounded and
  consistent with S-05's own "replay = re-render saved synthesis" semantics. Reading it as
  "step-by-step narration capture" is a real expansion (new persistence in the SSE hot path). Flag
  this for the user in `/10x-frame` or `/10x-plan`.
- **Strict contract boundary holds throughout.** Every list is `http.get<unknown[]>` → `.parse()`;
  every row maps through a Zod `toContract()`. The audit feature should not break this — define
  `auditLogSchema` once in `@opspilot/shared`, consume via `z.infer` on both sides.
- **Secrets must never enter the audit payload.** Credential/LLM-provider actions are auditable, but
  only their metadata (ids, which provider), never the encrypted secret material.

## One-vs-two tables — evaluation and recommendation

FR-011 left this open (`prd.md:98-99`); shape-notes proposed two tables
(`audit_log_user` / `audit_log_agent` linked via `triggeredBy*` ids, `shape-notes.md:227`).

**Option A — single polymorphic `audit_log` table.** One row per event (user action *or* agent run),
a `type`/`action` discriminator, a nullable JSON `payload`, nullable `userId`/`deviceId`/`serviceId`,
and a self-FK `triggeredById` for linkage.
- Pros: one table, one list query, one contract; simplest timeline read.
- Cons: it would either **duplicate or absorb** the existing rich `run_record` shape (synthesis,
  retention pruning, service-scoped replay already shipped in S-04/S-05). Folding runs into a generic
  payload column throws away the typed `synthesis` contract and the existing replay UI's data source;
  keeping runs separate but mirroring them into `audit_log` means double-writes and drift.

**Option B — two linked tables (recommended).** Keep `run_record` as the agent-run table (already
built, already has `userId` reserved). Add a new `audit_log` table for **user actions** (CRUD + ops),
with: `id`, `userId` (FK→`user.id`), `action` (enum/text), `targetType` + `targetId` (which device /
service / skill / provider / credential), nullable JSON `metadata`, `createdAt`, and a nullable
`runRecordId` (FK→`run_record.id`) for the linkage (e.g. the `diagnose.run` action row points at the
`run_record` it produced). Simultaneously activate `run_record.userId` (write it + add the FK +
`user` relation).
- Pros: preserves the shipped run model, contract, retention, and replay UI untouched; each table has
  a coherent, typed shape (heterogeneous action metadata vs structured synthesis); linkage is an
  explicit FK matching the shape-notes intent; the `run_record_user_idx` already supports by-user run
  queries.
- Cons: the unified "timeline" view must merge/union two sources (two list endpoints or a combined
  query) — a modest web/api cost, mitigated by the fact the two have genuinely different detail
  renderers anyway (an action line vs a synthesis card).

**Recommendation:** **Option B (two linked tables).** It aligns with how the codebase already
separates concerns, avoids regressing S-04/S-05, satisfies the "linked to each other" requirement via
a real FK, and keeps each contract strict and typed. The single-table option only wins if runs had no
pre-existing rich model — but they do.

## Code References

- `apps/api/src/database/schema/run-record.schema.ts:12-47` — run table; `userId` reserved + indexes/relations
- `apps/api/src/database/schema/auth.schema.ts:4-38` — Better Auth `user`/`session` (FK target + id source)
- `apps/api/src/auth/auth.guard.ts:15-42` — global guard; attaches `request.session` (`:38-39`)
- `apps/api/src/auth/auth.controller.ts:8-17` — better-auth catch-all (`@Public()`)
- `apps/api/src/common/public.decorator.ts` — `@Public()` marker (where a `@CurrentUser()` decorator should live)
- `apps/api/src/diagnose/run-record.service.ts:35-90` — create (txn + prune) + `findRecent` + `toContract`
- `apps/api/src/diagnose/diagnose.service.ts:117-129` — SSE narration; persists run on `done`
- `apps/api/src/diagnose/diagnose.controller.ts:21-45` — `GET runs` list + `SSE stream`
- `libs/shared/src/lib/schemas/run-record.schema.ts:9-23` — wire contract; `isoTimestamp`; omits `userId`
- `libs/shared/src/lib/schemas/auth-user.schema.ts:5-18` — `authUserSchema`; timestamp preprocess
- `libs/shared/src/lib/schemas/credential-list-query.schema.ts` — limit/offset pagination contract to mirror
- `apps/api/src/{device,service,skill,llm-provider}/...controller.ts` — the ~18 mutating endpoints (table above)
- `apps/api/src/database/migration/migration.service.ts:24-91` — boot-time migrate + backup gate
- `apps/api/drizzle.config.ts` / `apps/api/migrations/` — generate-then-boot-apply migration flow
- `apps/web/src/app/core/clients/diagnosis.client.ts:27-31` — `recentRuns` list call (audit list analog)
- `apps/web/src/app/core/stores/diagnosis.store.ts:68-77` — `replay()` (render-saved-detail mechanism)
- `apps/web/src/app/features/services/device-services.component.html:60-112` — timeline row + detail card
- `apps/web/src/app/features/devices/devices.component.{ts,html}` — canonical spartan list view
- `apps/web/src/app/core/stores/devices.store.ts:33-99` — `signalState` store + `errorMessage()` helper
- `apps/web/src/app/app.routes.ts` / `home/home.component.html:14-18` — route + nav registration

## Architecture Insights (conventions to follow)

- IDs are app-generated `randomUUID()`, not DB-side defaults.
- Inject the db/config with explicit `@Inject` tokens (vitest/esbuild drops type metadata).
- Never let Drizzle `$inferSelect` types reach `@opspilot/shared`; map through the Zod contract.
- Operational tunables (retention) go through `@nestjs/config` + Joi, never an in-file `const`.
- New NestJS module → re-apply `json()` middleware (the global body parser is disabled for better-auth).
- Web: response typed `unknown` then `.parse()` at the boundary; server-side filtering via query params.

## Historical Context (from prior changes)

- `context/foundation/prd.md:97-99` — FR-011: audit covers user actions + agent runs (with
  transcript), linked; **one-vs-two tables explicitly pushed down to implementation**.
- `context/foundation/prd.md:121,130` — flat multi-user, no RBAC; **accountability is *solely* the
  audit log** — raising the bar on reliable linkage.
- `context/foundation/roadmap.md:223-234` — S-09 spec; prerequisites F-02 + S-04; Open Q2 (identity
  source) resolved to Better Auth session per `infrastructure.md`.
- `context/foundation/infrastructure.md:69-100` — the double-auth identity-mismatch risk; recommends
  treating Cloudflare Access as a network gate and the app session as the audit identity.
- `context/foundation/shape-notes.md:227` — original two-table proposal
  (`audit_log_user` / `audit_log_agent` + `transcript` JSON, linked via `triggeredBy*`).
- `context/archive/2026-06-07-account-auth-foundation/` (F-02) — the guard + session this slice keys off.
- `context/archive/2026-06-11-diagnose-service-synthesis/` (S-04) + `.../2026-06-11-live-narration-and-replay/`
  (S-05) — origin of `run_record`, the synthesis blob, and the replay UI this slice extends.

## Related Research

- No prior `research.md` exists for this change; this is the first. Prior slice research lives under
  `context/archive/2026-06-11-*/` for the run-record/diagnose lineage.

## Open Questions

1. **"Transcript" definition (scope fork):** does FR-011's "run transcript" mean the stored final
   synthesis (recommended, bounded) or step-by-step narration capture (expands S-05's hot path)?
   Owner: user — resolve in `/10x-frame` or at plan start.
2. **Linkage direction:** put the FK on `audit_log.runRecordId → run_record.id` (action points at the
   run it triggered) or also/instead `run_record.userActionId`? The shape-notes proposed both
   directions; one nullable FK on the action side is likely sufficient.
3. **Which user-actions to audit, and at what granularity:** all ~18 mutating endpoints, or a curated
   set? Capture old→new diffs on updates, or just the action + target? Audit login/logout/registration
   (needs a different hook than the param decorator, since auth flows through better-auth's catch-all)?
4. **Where to write audit rows:** per-service inline calls vs a NestJS interceptor over mutating
   routes. An interceptor is DRY but must reliably derive action/target from each route and runs
   outside the service transaction (an audit write could succeed while the action rolls back, or vice
   versa). Inline writes can join the action's own transaction. Decide consistency guarantees.
5. **Retention:** does the audit log prune (like `run_record`'s `historyRetention`) or retain
   indefinitely? If it prunes, add an `AUDIT_LOG_RETENTION` config tunable per the config-layer lesson.
6. **Timeline view shape:** one merged chronological view unioning actions + runs, or two tabs? Detail
   renderers differ (action line vs synthesis card), which nudges toward two sources behind one page.
