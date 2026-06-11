# Live Narration and Replay (S-05) Implementation Plan

## Overview

Add **diagnose-specific live narration** and **replay** to the existing diagnose vertical
slice. Today diagnose is fully batch (`generateText` + `Output.object`, one blocking await)
and ephemeral (no persistence). This plan replaces that single round-trip with a **streamed**
synthesis over `@Sse` — the same LLM pass that streams progressive partials to the browser also
accumulates the final 4-field synthesis and **persists** it to a new minimal `run_record` table,
so an earlier run can be replayed (static render of the saved synthesis).

The contract is **neutrally named** (`run-narration-event`, `run-record`) but **NOT abstracted** —
one diagnose-specific shape per concrete payload, no generic ops-event union (frame brief D3).

## Current State Analysis

The diagnose feature is a textbook three-layer vertical slice, all of it batch/ephemeral:

- **API orchestration** — `diagnose.service.ts:29-50`: resolve service (404) → fail-fast active
  provider (`getActiveProviderConfig()`, 409 before the SSH cost) → fetch logs over the executor
  → `synthesize()`. The synthesis at `diagnose.service.ts:90-114` does
  `generateText({ output: Output.object({ schema: diagnosisSynthesisSchema }) })` and returns the
  whole object at once. Error taxonomy in `diagnose.errors.ts` maps to 502/503/504, **never 401**
  (a 401 would trip the web session-expiry interceptor).
- **Controller** — `diagnose.controller.ts:13-16`: thin `@Post('diagnose')`, no body, returns
  `Promise<DiagnosisSynthesis>`.
- **Web** — client `diagnosis.client.ts:15-19` (`firstValueFrom(http.post(...))` + parse-at-boundary);
  store `diagnosis.store.ts` (plain `@Injectable` `signalState`, keyed per `serviceId`,
  `DiagnosisEntry = { error, loading, result }`); component
  `device-services.component.{ts,html}` renders a binary loading→result card per service row,
  store provided **at the component** (`providers: [DiagnosisClient, DiagnosisStore]`).
- **Shared** — `diagnosis-synthesis.schema.ts:11-18`: `z.strictObject({ problems, status, suggestions, summary })`.
  No stream/delta/event type exists. No persisted run shape exists.
- **DB machinery is ready** — `DATABASE_CONNECTION` provider (WAL, FK on), `@Global` database
  module, schema barrel `database/schema/index.ts`, drizzle-kit (`0000…0003` migrations), and
  auto-migrate on boot with a WAL-aware backup gate (`migration.service.ts`). Migrations are
  bundled by webpack (`webpack.config.js:22`). Adding a table is a well-trodden path.
- **Config-layer tunable pattern** — `llm.config.ts` (`registerAs('llm', …)`, `Number(process.env.X)`)
  + `env.schema.ts` Joi-bounded vars. Precedent for a retention knob: `DATABASE_BACKUP_RETENTION`.

### Key constraints discovered (from the rules + research)

- **SSE is rule-prescribed** (`sse.md`): `@Sse()` returns `Observable<MessageEvent>` from the
  **service**; controller is pass-through. Heartbeat `: ping\n\n` every ~30 s. Headers
  `X-Accel-Buffering: no` + `Cache-Control: no-cache`. Client uses native `EventSource` → signal,
  torn down via `DestroyRef`.
- **Cloudflare edge reaps idle streams > ~100 s** (`roadmap.md:184`) — heartbeat + anti-buffer
  headers are a **day-1 requirement**, not polish.
- **Vercel AI SDK v6**: `streamObject({ schema, model, prompt })` exposes `partialObjectStream`
  (progressively-filled partials of the fixed schema) — the rule-compliant streaming analog of
  the current `generateText`+`Output.object`. Do **not** use `toDataStreamResponse()` /
  `toUIMessageStreamResponse()` (Web `Response`, do not compose with `@Sse → Observable`).
- **Contract-first is non-negotiable** (`contracts.md`): every wire shape is one Zod schema in
  `@opspilot/shared`, consumed via `z.infer`; Drizzle `$infer*` never leaks to shared.

## Desired End State

When this plan is complete:

- Clicking **Diagnose** on a service row opens an SSE stream. The result card fills **progressively
  live** — `summary` streams in, `status`/`problems`/`suggestions` populate as the model produces
  them — instead of snapping in after a blocking wait.
- When the run completes, the synthesis is **saved** to `run_record`. A compact **"Recent runs"**
  list under the row lets the user click an earlier run and **replay** it (the saved synthesis is
  rendered statically in the same card).
- The fail-fast precondition checks (404 unknown service, 409 no active provider) still resolve as
  **HTTP errors before the stream opens**; failures mid-stream arrive as an in-stream `error` event
  rendered in the panel.
- Old run records are pruned to a configurable retention bound (`LLM_DIAGNOSE_HISTORY_RETENTION`).

Verify: diagnose a service, watch the card fill incrementally; reload, see the prior run in the
recent list, click it, see it render; confirm a no-active-provider state still produces a clean
409 (not an open-then-error stream).

### Key Discoveries

- `streamObject().partialObjectStream` emits deltas AND lets the service accumulate the final
  object in **one** `for await` loop — one LLM pass feeds both live + persist (frame D1).
- `diagnose.service.ts:90-114` is the clean seam to swap `generateText` → `streamObject`.
- `llm-provider.service.ts` is the CRUD pattern to copy for `run_record`: local
  `type Row = typeof table.$inferSelect` (unexported), explicit `@Inject(DATABASE_CONNECTION)`,
  `randomUUID()` ids, `.returning().get()`, compute-then-write in one `this.db.transaction(...)`,
  `toContract(row)` projecting **safe fields only** through the shared Zod schema (never spread a row).
- `llm-provider.schema.ts:6` `isoTimestamp` preprocess is the Date↔ISO boundary pattern for the
  persisted `createdAt`.
- `service.schema.ts` is the drizzle table pattern: `timestamp_ms` defaults via `sql`,
  `references(() => …, { onDelete: 'cascade' })`, `index(...)` declarations.
- `EventSource` is **GET-only** (no body, no custom headers) — the live endpoint must be a `@Sse`
  **GET**, replacing the current `@Post('diagnose')` trigger.

## What We're NOT Doing

- **No generic ops-narration abstraction.** Only one skill exists; the repo rule
  (`vercel-ai-sdk.md:19`), contract convention, and research OQ7 all warn against it. Name neutrally,
  do not abstract. Generalize in S-08/S-09 when a second skill makes the shared shape real.
- **No re-stream replay.** Replay is a static render of the saved final synthesis (frame D5 / research
  OQ5). We do **not** store raw ordered deltas or reproduce original token timing.
- **No `streamText` free-text narration.** Narration = progressive fill of the fixed 4-field schema
  (`streamObject`); the generality argument for free-text collapsed with D3.
- **No global run-history view / dedicated route.** That is S-09 ("adds … the view"). S-05 replay is
  an inline list scoped to the service row.
- **No `userId` surfaced in the contract.** The DB column is added now (nullable + indexed) reserved
  for S-09, but it is not part of the S-05 wire shape.
- **No new auth/guard work, no WebSocket fallback** (SSE + heartbeat is the default path).

## Implementation Approach

Contract-first, four phases in dependency order: **shared → db → api → web**. The shared schemas
land first so both apps consume one source of truth. The DB table + CRUD service land next so the
API has somewhere to persist. The API converts the synthesis to a stream and wires `@Sse` +
persistence + the recent-runs endpoint. The web layer consumes the stream via `EventSource`, extends
the keyed store with a live partial + recent-runs list, and renders progressive fill + click-to-replay.

## Critical Implementation Details

- **SSE pre-flight ordering (lifecycle).** Once `@Sse` returns its `Observable`, the response is
  already `200`. The fail-fast checks (`serviceService.findOne` → 404, `getActiveProviderConfig()`
  → 409) must run and throw **before** the Observable is subscribed, so they surface as real HTTP
  status codes (and never 401). Implement pre-flight as an `await`ed step in the handler path that
  precedes returning the cold Observable; verify Nest 11 resolves a `Promise<Observable>` from an
  `@Sse` handler, otherwise gate pre-flight in a route guard. Errors that occur **after** the stream
  opens (logs timeout, docker failure, synthesis timeout, `NoObjectGeneratedError`, dropped pipe)
  map to an in-stream `{ type: 'error', code }` event, then the stream completes.
- **Cloudflare day-1 requirement.** The service's Observable must `merge` a `: ping\n\n` heartbeat
  every ~30 s, and the response must carry `X-Accel-Buffering: no` + `Cache-Control: no-cache`.
  Without both, runs past ~100 s are silently reaped at the edge (`roadmap.md:184`).
- **Streaming-aware error classification.** `supportsStructuredOutputs: true` changes the
  `NoObjectGeneratedError`/timeout semantics under `streamObject`; the existing `isTimeout` /
  `NoObjectGeneratedError.isInstance` classification (`diagnose.service.ts:103-167`) needs a
  streaming-aware equivalent applied to the `for await` rejection, reusing the same error taxonomy
  mapped to stream `code`s.
- **Persist before `done`.** The final accumulated synthesis is written to `run_record` (insert +
  prune in one transaction) **before** emitting the `done` event, so `done` carries the real saved
  record (id + createdAt) the FE prepends to its recent list.

---

## Phase 1: Shared contracts

### Overview

Define the two neutrally-named wire shapes in `@opspilot/shared`, consumed by both apps via
`z.infer`. No abstraction over diagnose — the delta carries a partial of the existing fixed schema.

### Changes Required

#### 1. Run-record persisted contract

**File**: `libs/shared/src/lib/schemas/run-record.schema.ts`

**Intent**: The saved, replayable shape of one diagnose run. Reuses the existing synthesis schema
nested under metadata so the web can render a replayed run with the current card template unchanged.

**Contract**: `runRecordSchema = z.strictObject({ id, deviceId, serviceId, synthesis: diagnosisSynthesisSchema, createdAt })`
where `createdAt` uses the `isoTimestamp` preprocess pattern from `llm-provider.schema.ts:6`
(Date from the drizzle row ↔ ISO string on the wire). Export `runRecordSchema` + `RunRecord` type.
`userId` is **not** in this shape (reserved for S-09 at the DB layer only).

#### 2. Run-narration SSE event contract

**File**: `libs/shared/src/lib/schemas/run-narration-event.schema.ts`

**Intent**: The discriminated union of frames the SSE stream emits. `delta` carries a partial fill
of the fixed synthesis; `done` carries the persisted record; `error` carries a stream error code.

**Contract**: `runNarrationEventSchema = z.discriminatedUnion('type', [...])` with three members:
- `{ type: 'delta', partial: <partial-of-diagnosisSynthesis> }` — all four synthesis fields
  optional (a deeply/partially filled object as `partialObjectStream` yields). Build the partial
  shape inside this file from the field set of `diagnosisSynthesisSchema` (do not re-key it by hand
  elsewhere).
- `{ type: 'done', run: runRecordSchema }` — the saved run.
- `{ type: 'error', code: z.string(), message: z.string() }` — `code` drawn from the diagnose error
  taxonomy (e.g. `logs-timeout`, `synthesis-failed`, `timeout`, `upstream-unavailable`).

Export `runNarrationEventSchema` + `RunNarrationEvent` type. The `: ping` heartbeat is an SSE comment,
**not** a domain event — it never appears in this union.

#### 3. Barrel exports

**File**: `libs/shared/src/index.ts`

**Intent**: Re-export both new schemas alphabetically (perfectionist lint).

**Contract**: add `export * from './lib/schemas/run-narration-event.schema';` and
`export * from './lib/schemas/run-record.schema';` in alphabetical position.

### Success Criteria

#### Automated Verification

- Shared builds: `npx nx build shared`
- Shared lint passes (perfectionist barrel order): `npx nx lint shared`
- Type checking passes across consumers: `npx nx run-many -t typecheck` (or `build`)

#### Manual Verification

- `runNarrationEventSchema.parse({ type: 'delta', partial: { summary: 'x' } })` succeeds; a frame
  with an unknown `type` is rejected.
- `runRecordSchema.parse(...)` normalizes a `Date` `createdAt` to an ISO string.

**Implementation Note**: After automated verification passes, pause for manual confirmation before
Phase 2.

---

## Phase 2: Persistence — `run_record` table, CRUD service, retention

### Overview

Add the minimal `run_record` drizzle table, its migration, a CRUD service mirroring
`LlmProviderService`, and a config-layer retention knob with pruning. Persisting and the recent-list
read both live here; the API stream calls into this service in Phase 3.

### Changes Required

#### 1. Drizzle table

**File**: `apps/api/src/database/schema/run-record.schema.ts`

**Intent**: Persist one diagnose run, scoped to a device + service with cascade delete, plus a
nullable user link reserved for S-09. The 4-field synthesis is stored as a single JSON `text`
column (never queried into — replay only lists by service + recency).

**Contract**: `sqliteTable('run_record', { … })` with: `id` text pk; `deviceId` text notNull
`references(() => device.id, { onDelete: 'cascade' })`; `serviceId` text notNull
`references(() => service.id, { onDelete: 'cascade' })`; `synthesis` text notNull (JSON of the
4-field object); `userId` text **nullable** (reserve for S-09 — no FK required yet, or a nullable FK
to the auth user table); `createdAt` integer `timestamp_ms` with the `sql` default from
`service.schema.ts:19-21`. Indexes: `run_record_service_created_idx` on `(serviceId, createdAt)`
(drives the recent-list `where`/`order by`); `run_record_user_idx` on `(userId)` (reserved S-09).
Add a `relations(...)` block if it mirrors `serviceRelations`.

#### 2. Schema barrel

**File**: `apps/api/src/database/schema/index.ts`

**Intent**: Register the new table so drizzle-kit generates it and the runtime `drizzle(sqlite, { schema })`
typing sees it.

**Contract**: add `export * from './run-record.schema';` (alphabetical).

#### 3. Generated migration

**File**: `apps/api/migrations/0004_*.sql` (drizzle-kit generated)

**Intent**: The schema delta that creates `run_record` + its indexes; auto-applies on boot via
`migration.service.ts` and is webpack-bundled.

**Contract**: produced by the repo's drizzle-kit generate step (do not hand-write). Verify the
generated SQL creates the table + both indexes and that nothing else drifted.

#### 4. Run-record CRUD service

**File**: `apps/api/src/database/run-record/run-record.service.ts` (or under the diagnose slice —
follow feature-cohesion; a DB-backed service near the connection provider is acceptable)

**Intent**: Insert a completed run (pruning oldest beyond retention in the same transaction) and read
the recent runs for a service row. Maps rows to the shared `runRecordSchema` before returning.

**Contract**: copy the `LlmProviderService` shape — local `type RunRecordRow = typeof runRecord.$inferSelect`
(unexported), `@Inject(DATABASE_CONNECTION) private readonly db`, explicit `@Inject` config token.
Methods:
- `create(input): RunRecord` — `randomUUID()` id, JSON-encode the synthesis, `.insert().values().returning().get()`,
  then prune within **one** `this.db.transaction((tx) => …)` (compute-then-write invariant,
  `lessons.md:34-38`): keep the newest `historyRetention` rows per `serviceId`, delete the rest.
- `findRecent(deviceId, serviceId, limit?, offset?): RunRecord[]` — `where serviceId` (and verify the
  device owns it), `order by createdAt desc`, `.limit().offset()` (no unbounded scan, `drizzle.md`).
- `toContract(row): RunRecord` — project safe fields only, `JSON.parse` the synthesis column,
  `runRecordSchema.parse(...)` (normalizes `createdAt` Date → ISO). Never spread the row, never
  surface `userId`.

#### 5. Retention tunable

**Files**: `apps/api/src/config/env.schema.ts`, `apps/api/src/config/llm.config.ts`

**Intent**: Route the history bound through the config layer, not a module-level const
(`lessons.md:5-10`). Pruning analog of `DATABASE_BACKUP_RETENTION`.

**Contract**: add `LLM_DIAGNOSE_HISTORY_RETENTION` to the Joi env schema (`Joi.number().min(1).default(20)`),
and `historyRetention: Number(process.env.LLM_DIAGNOSE_HISTORY_RETENTION)` to `llmConfig`. The CRUD
service injects `@Inject(llmConfig.KEY)` and reads `config.historyRetention`.

#### 6. Module wiring

**File**: the database module (or diagnose module) providers

**Intent**: Provide/export `RunRecordService` so the diagnose service (Phase 3) can inject it.

**Contract**: register `RunRecordService` as a provider and export it from its module (it is `@Global`
DB-backed, so wiring mirrors how other DB services are exposed).

### Success Criteria

#### Automated Verification

- Migration generates cleanly (drizzle-kit) and is the only new `0004_*` file.
- API builds (bundles the new migration): `npx nx build api`
- API unit tests pass: `npx nx test api`
- Lint passes: `npx nx lint api`

#### Manual Verification

- Boot the api; `migration.service.ts` applies `0004` and creates `run_record` (a backup snapshot is
  taken because migrations are pending).
- Insert > retention runs for one service; confirm only the newest `historyRetention` survive.
- `findRecent` returns newest-first and respects the limit.

**Implementation Note**: Pause for manual confirmation before Phase 3.

---

## Phase 3: API streaming — `@Sse` + persistence + replay endpoint

### Overview

Swap `generateText` → `streamObject`, build the SSE `Observable<MessageEvent>` in the service
(heartbeat + delta mapping + on-done persist), expose it through a thin `@Sse` GET handler with
pre-flight fail-fast, and add a GET endpoint for the recent-runs list.

### Changes Required

#### 1. Streamed synthesis + narration Observable

**File**: `apps/api/src/diagnose/diagnose.service.ts`

**Intent**: Replace the blocking `synthesize()` with a streaming path. Iterate
`streamObject(...).partialObjectStream`, map each partial to a `{ type: 'delta', partial }`
`MessageEvent`, accumulate the final synthesis, persist it via `RunRecordService.create`, and emit
`{ type: 'done', run }`. Merge a 30 s `: ping` heartbeat. Map any mid-stream rejection to a
`{ type: 'error', code }` event using a streaming-aware version of the existing taxonomy.

**Contract**: a method returning `Observable<MessageEvent>` (e.g. `narrate(deviceId, serviceId)`),
built from the `streamObject` async iterable bridged into RxJS and `merge`d with an `interval`-driven
heartbeat. Pre-flight (`serviceService.findOne`, `getActiveProviderConfig`, logs fetch) stays — the
fail-fast provider/service checks run **before** the stream opens (see Critical Implementation
Details). Keep `AbortSignal.timeout(generateTimeoutMs)` on the stream. The old batch `diagnose()` /
`synthesize()` return path is removed (superseded by the stream's `done`).

#### 2. SSE + replay controller

**File**: `apps/api/src/diagnose/diagnose.controller.ts`

**Intent**: Expose the live stream as a thin `@Sse` GET (pass-through to the service Observable) and
the recent-runs list as a GET. Replace the existing `@Post('diagnose')`.

**Contract**:
- `@Sse('diagnose/stream')` GET → returns the service's `Observable<MessageEvent>` (after pre-flight).
  Set `X-Accel-Buffering: no` + `Cache-Control: no-cache` on the response (`sse.md`).
- `@Get('diagnose/runs')` → `RunRecord[]` from `RunRecordService.findRecent(deviceId, serviceId)`,
  paginated. Params only (device + service ids from the path); optional `@Query` limit/offset.
- Remove `@Post('diagnose')`.

#### 3. Streaming-aware error codes

**File**: `apps/api/src/diagnose/diagnose.errors.ts` (extend)

**Intent**: Provide a mapping from the existing error classes (timeout, synthesis-failed, logs-timeout,
docker/upstream) to the stable string `code`s carried in the `error` event, distinct from the HTTP
status codes used by pre-flight.

**Contract**: a small mapper (error → `{ code, message }`) reusing `isTimeout` /
`NoObjectGeneratedError.isInstance` logic, applied where the `for await` loop rejects. Pre-flight
errors keep throwing HTTP exceptions (404/409) — never 401.

### Success Criteria

#### Automated Verification

- API builds: `npx nx build api`
- API unit tests pass (stream mapping, persist-on-done, error→event mapping, pre-flight throws): `npx nx test api`
- Lint passes: `npx nx lint api`

#### Manual Verification

- `curl -N` the SSE endpoint: receive `delta` frames, a `: ping` within ~30 s on a slow run, and a
  final `done` carrying a `run` with an id.
- With no active provider, the request returns **409 before** any stream opens (not an open-then-error).
- After a run, `GET diagnose/runs` lists it newest-first.
- A forced synthesis failure arrives as an in-stream `error` event, and the connection completes.

**Implementation Note**: Pause for manual confirmation before Phase 4.

---

## Phase 4: Web — `EventSource` consumption, store, progressive render + replay

### Overview

Consume the stream with native `EventSource`, extend the keyed store with a live partial and a
recent-runs list, and update the component/template to render progressive fill and a click-to-replay
recent list. Tear the stream down via `DestroyRef`.

### Changes Required

#### 1. Diagnosis client — stream + recent runs

**File**: `apps/web/src/app/core/clients/diagnosis.client.ts`

**Intent**: Replace the POST with an `EventSource`-based stream opener (parse each message via
`runNarrationEventSchema`) and add a typed GET for recent runs (parse via `runRecordSchema`).

**Contract**:
- `stream(deviceId, serviceId, handlers)` — open `new EventSource('/api/devices/:deviceId/services/:serviceId/diagnose/stream')`,
  parse each `message` payload through `runNarrationEventSchema`, dispatch to handlers, and return the
  `EventSource` (or a teardown fn) so the caller can `close()` it.
- `recentRuns(deviceId, serviceId): Promise<RunRecord[]>` — `HttpClient` GET + `runRecordSchema.array().parse(...)`.

#### 2. Store — live partial + recent runs

**File**: `apps/web/src/app/core/stores/diagnosis.store.ts`

**Intent**: Extend `DiagnosisEntry` with the in-progress `partial` and the `runs` list; replace the
batch `diagnose()` with a streaming method that patches the keyed entry on each event; add a loader
for recent runs and a `replay(serviceId, run)` that sets `result` from a saved run. Tear down the
`EventSource` on destroy.

**Contract**: `DiagnosisEntry` gains `partial: Partial<DiagnosisSynthesis> | null` and
`runs: RunRecord[]`. New `stream(deviceId, serviceId)` opens the client stream, on `delta` patches
`partial` (merge), on `done` sets `result` + clears `partial` + prepends `run` to `runs`, on `error`
sets `error`. `inject(DestroyRef)` and `destroyRef.onDestroy(() => source.close())` (`sse.md` /
`angular.md` — no `ngOnDestroy`). Keep the existing `errorMessage` / keyed `patchEntry` helpers and
the per-`serviceId` isolation. Add `loadRuns(deviceId, serviceId)` and `replay(serviceId, run)`.

#### 3. Component + template — progressive render + recent list

**Files**: `apps/web/src/app/features/services/device-services.component.ts`,
`apps/web/src/app/features/services/device-services.component.html`

**Intent**: Trigger the stream from the Diagnose button, render the live partial in the existing card
(fields appear as they fill), and show a compact "Recent runs" list per row whose items replay a saved
run statically. Load recent runs for visible rows.

**Contract**: the `diagnose(service)` handler calls `diagnosis.stream(...)`. The result card renders
from `diag.result ?? diag.partial` so it fills progressively; the loading state reflects an open
stream. Add a recent-runs sub-list (reuse spartan primitives, keep the component under the ~150-line /
single-responsibility threshold — extract a child component if needed) whose click calls
`diagnosis.replay(service.id, run)`. Keep the existing badge/card markup; `badgeClass` only renders
once `status` is present.

### Success Criteria

#### Automated Verification

- Web builds: `npx nx build web`
- Web unit tests pass (store delta/done/error patching, replay sets result): `npx nx test web`
- Lint + format: `npx nx lint web` and `npm run format:check`

#### Manual Verification

- Click Diagnose: the card fills incrementally (summary streams, lists populate), not all-at-once.
- On completion the run appears at the top of the recent list; clicking an earlier run renders its
  saved synthesis statically.
- Diagnosing one row never disturbs another row's panel (keyed isolation holds).
- Navigating away mid-stream closes the `EventSource` (no leaked connection).
- A no-active-provider error renders as a legible line in the panel (409 path) — not 401, no
  session-expiry redirect.

**Implementation Note**: Pause for final manual confirmation.

---

## Testing Strategy

### Unit Tests

- **Shared**: `runNarrationEventSchema` discriminates `delta`/`done`/`error` and rejects unknown
  `type`; `runRecordSchema` normalizes `createdAt` Date → ISO and rejects extra keys.
- **API**: `RunRecordService.create` prunes beyond retention in one transaction; `findRecent` orders
  newest-first and is bounded; the diagnose stream maps partials → `delta`, persists then emits
  `done`, maps a mid-stream throw → `error` event; pre-flight throws 404/409 before the Observable.
- **Web**: store patches `partial` on `delta`, sets `result`/prepends `run` on `done`, sets `error`
  on `error`; `replay` sets `result` from a saved run; teardown closes the source.

### Integration Tests

- End-to-end stream against a faked executor + faked model: open stream → deltas → done → row
  persisted → `GET diagnose/runs` returns it.

### Manual Testing Steps

1. Diagnose a healthy service; watch progressive fill + a `done`.
2. Diagnose with no active provider; confirm a clean 409 before any stream.
3. Force a slow/long run; confirm a `: ping` keeps it alive (Cloudflare path).
4. Reload; replay an earlier run from the recent list (static render).
5. Start a diagnose, navigate away; confirm the `EventSource` is closed.

## Performance Considerations

- The recent-list query is bounded and indexed on `(serviceId, createdAt)`; no unbounded scans.
- Retention pruning runs inside the insert transaction — bounded row growth per service.
- The heartbeat interval (~30 s) is well under the ~100 s edge-reap threshold.

## Migration Notes

- `run_record` is additive (new table + indexes), auto-applied on boot with a WAL-aware backup
  snapshot taken because migrations are pending. No data backfill — prior diagnose runs were
  ephemeral and are not reconstructable.
- The nullable `userId` column is forward-compat for S-09; S-09's migration adds the user-action side
  and linkage without altering this column's shape.

## References

- Frame brief: `context/changes/live-narration-and-replay/frame.md`
- Research: `context/changes/live-narration-and-replay/research.md`
- Seam to convert: `apps/api/src/diagnose/diagnose.service.ts:90-114`
- CRUD pattern to copy: `apps/api/src/llm-provider/llm-provider.service.ts`
- Drizzle table pattern: `apps/api/src/database/schema/service.schema.ts`
- Persisted-entity contract pattern: `libs/shared/src/lib/schemas/llm-provider.schema.ts:6,13-22`
- Store/component to extend: `apps/web/src/app/core/stores/diagnosis.store.ts`,
  `apps/web/src/app/features/services/device-services.component.{ts,html}`
- Rules: `.claude/rules/sse.md`, `vercel-ai-sdk.md`, `drizzle.md`, `contracts.md`, `zod.md`, `angular.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared contracts

#### Automated

- [x] 1.1 Shared builds: `npx nx build shared` — 55bd282
- [x] 1.2 Shared lint passes (perfectionist barrel order): `npx nx lint shared` — 55bd282
- [x] 1.3 Type checking passes across consumers — 55bd282

#### Manual

- [x] 1.4 `runNarrationEventSchema` parses a `delta` and rejects an unknown `type` — 55bd282
- [x] 1.5 `runRecordSchema` normalizes a `Date` `createdAt` to ISO — 55bd282

### Phase 2: Persistence — `run_record` table, CRUD service, retention

#### Automated

- [x] 2.1 Migration generates cleanly and is the only new `0004_*` file — 8aea43b
- [x] 2.2 API builds (bundles the new migration): `npx nx build api` — 8aea43b
- [x] 2.3 API unit tests pass: `npx nx test api` — 8aea43b
- [x] 2.4 Lint passes: `npx nx lint api` — 8aea43b

#### Manual

- [x] 2.5 Boot applies `0004` and creates `run_record` (backup snapshot taken) — 8aea43b
- [x] 2.6 Inserting > retention runs prunes to the newest `historyRetention` — 8aea43b
- [x] 2.7 `findRecent` returns newest-first and respects the limit — 8aea43b

### Phase 3: API streaming — `@Sse` + persistence + replay endpoint

#### Automated

- [x] 3.1 API builds: `npx nx build api` — 47d8bf3
- [x] 3.2 API unit tests pass (stream mapping, persist-on-done, error→event, pre-flight throws): `npx nx test api` — 47d8bf3
- [x] 3.3 Lint passes: `npx nx lint api` — 47d8bf3

#### Manual

- [x] 3.4 `curl -N` receives `delta` frames, a `: ping`, and a final `done` with a run id — 47d8bf3
- [x] 3.5 No active provider returns 409 before any stream opens — 47d8bf3
- [x] 3.6 `GET diagnose/runs` lists the new run newest-first — 47d8bf3
- [x] 3.7 A forced synthesis failure arrives as an in-stream `error` event and completes — 47d8bf3

### Phase 4: Web — `EventSource` consumption, store, progressive render + replay

#### Automated

- [x] 4.1 Web builds: `npx nx build web`
- [x] 4.2 Web unit tests pass (delta/done/error patching, replay sets result): `npx nx test web`
- [x] 4.3 Lint + format: `npx nx lint web` and `npm run format:check`

#### Manual

- [x] 4.4 The card fills incrementally on diagnose (not all-at-once)
- [x] 4.5 Completed run appears atop the recent list; clicking an earlier run renders it statically
- [x] 4.6 Diagnosing one row never disturbs another row's panel
- [x] 4.7 Navigating away mid-stream closes the `EventSource`
- [x] 4.8 No-active-provider renders as a legible line (409), no 401/session-expiry redirect
