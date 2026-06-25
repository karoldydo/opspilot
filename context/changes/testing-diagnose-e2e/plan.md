# Diagnose run-history replay E2E Implementation Plan

## Overview

Author the one remaining browser-fit E2E spec for the diagnose feature — the **multi-run
replay** facet of Risk #1 — then sync the test-plan documentation so Phase 4's deterministic
E2E ceiling is recorded as reached.

Research established that the deterministic diagnose E2E backlog is essentially complete:
Risk #1's clean-error facet (a) and single-run render facet (b) already ship (commit
`9804435`), and Risk #6 (SSE through the edge) is explicitly *not* E2E. The single facet
that genuinely extends browser coverage beyond what exists is **run-history replay**: seed
≥2 saved runs, confirm the page renders the newest on entry and a clickable replay chip per
run, then click an older chip and prove the result card swaps to that run **without opening
a new live stream**. The live UI→synthesis happy path and a second clean-error cause are
both out of scope (decided during planning); pagination evaporated as an E2E concern because
the UI never sends `limit`/`offset` (see Current State Analysis).

## Current State Analysis

**What exists:**

- `tests/e2e/specs/diagnosis-clean-error.spec.ts` — Risk #1 facet (a): 409-no-provider →
  `EventSource.onerror` → clean error + button re-enable.
- `tests/e2e/specs/diagnosis-synthesis-renders.spec.ts` — Risk #1 facet (b): a single seeded
  `run_record` renders all four synthesis fields.
- `tests/e2e/helpers/seed-run-record.ts` — `seedRunRecord({ deviceId, serviceId, synthesis,
  createdAtMs? }) → runId`; a `better-sqlite3` insert against the e2e db with a `busy_timeout`
  WAL writer lock. Accepts `createdAtMs`, so run ordering is controllable.
- `tests/e2e/playwright.config.ts` — isolated `./data/opspilot.e2e.db` (inline `DATABASE_PATH`,
  no api server reuse), `storageState` auth, `baseURL http://localhost:4200`.

**Replay behavior (the thing under test):**

- `apps/web/.../diagnosis.store.ts:77-88` — `replay(serviceId, run)` tears down any open
  stream, then sets `result = run.synthesis` and clears `partial`/`error`/`steps`/`progress`.
  **It never calls `stream()`** — no new `EventSource` is opened on replay.
- `apps/web/.../service-detail.component.html:139-151` — the **run history** section renders
  only when `entry().runs.length > 0`; each run is a `<button>` whose accessible name is
  `● {createdAt | date:'short'} · {synthesis.status}`. Clicking it calls `replay(run)`.
- `service-detail.component.html:73` — the terminal-panel header reads `agent run ·
  {{ entry().loading ? 'live' : 'idle' }}` — a DOM-observable signal that no stream is live.
- `service-detail.component.html:54` — the re-run button is `[disabled]="entry().loading"`,
  so it stays enabled when no stream is open.
- `service-detail.component.ts:101-107` — `view()` falls back `result ?? partial ??
  latestRun()?.synthesis`; `latestRun()` is `runs[0]`. `isLatest()` is true only while no
  `result`/`partial` is set, driving the "last run · {date}" label (`html:128-132`).

**Why pagination is not an E2E concern:** `diagnosis.client.ts:25-29` `recentRuns()` calls
`GET /api/.../diagnose/runs` with **no query params**. The UI never paginates — the
`limit`/`offset` slicing capped 0–100 lives entirely behind the API contract, so it is an
integration concern, not a browser interaction.

**Run ordering:** `GET /diagnose/runs` returns newest-first (`runRecordSchema.array()` parse,
`diagnosis.client.ts` comment "newest-first"); the store's `latestRun = runs[0]`.

## Desired End State

A reviewed, deliberate-break-verified E2E spec
`tests/e2e/specs/diagnosis-run-history-replay.spec.ts` exists and passes green: it seeds two
saved runs with distinct statuses/summaries/timestamps, asserts the newest renders on entry
with both replay chips present, clicks the older chip, and asserts the card swaps to the
older run's synthesis while **no `/diagnose/stream` request fires and the panel stays idle**.
The deliberate-break check (making `replay()` wrongly open a stream, or not swap the result)
turns the test red. `test-plan.md §6.5` documents facet (c) and the pagination-is-integration
decision; the Phase 4 row reads `complete`.

### Key Discoveries:

- `replay()` is a pure state swap with stream teardown — no new stream (`diagnosis.store.ts:77-88`).
- Replay chips are `getByRole('button')` whose name carries the run's `status`
  (`service-detail.component.html:144-147`) — seeding two **distinct** statuses makes each
  chip uniquely locatable without depending on the brittle `date:'short'` string.
- Status enum is `'healthy' | 'degraded' | 'down'` (`diagnosis-synthesis.schema.ts:13`).
- The terminal-panel `agent run · idle|live` text + the `[disabled]` re-run button are clean
  DOM proofs that no stream opened, complementing a network-level `**/diagnose/stream` assertion.
- The summary renders in both the terminal panel (`html:104`) and the synthesis card
  (`html:133`) — use `.first()` for presence, `toHaveCount(0)` for absence.

## What We're NOT Doing

- **Not** covering the live UI→synthesis happy path (a real streamed run). It is blocked on a
  missing test seam; covering it needs an app-side fake-LLM/fake-SSH swap (its own
  product/infra plan) or a `page.route()` mock of an internal boundary (breaks the
  "internal stays real" rule). Decided out of scope.
- **Not** adding a second clean-error cause (device-unreachable / SSH-failure). The store's
  error/spinner contract is already proven by facet (a) — low marginal value.
- **Not** writing an E2E for `limit`/`offset` pagination — the UI sends no pagination params;
  it is an API/integration concern.
- **Not** touching Risk #6 (SSE heartbeat/edge) — explicitly integration-only per §6.5.
- **Not** modifying any application code (`apps/web`, `apps/api`, `libs/shared`). This is a
  test-authoring + docs change only.

## Implementation Approach

Drive Phase 1 through the `/10x-e2e` skill — its workflow (risk → seed pattern + rules →
generate → review against the five anti-patterns → deliberate-break verify → commit on green)
is the single source of truth for authoring the spec. The spec reuses the established
**seed-the-DB, never mock-the-network** pattern: real auth (storageState), real routing, the
real `/api/.../diagnose/runs` read, the real db, the real zod boundary, and the rendered
Angular components — only the saved runs are seeded (no api endpoint creates a run). The
"no new stream on replay" proof is belt-and-suspenders: a negative network assertion on
`**/diagnose/stream` plus the DOM `agent run · idle` / enabled-button checks.

Phase 2 mirrors how commit `9804435` landed facet (a)/(b): the spec and the `§6.5` cookbook
entry move together, so the documentation never drifts from the shipped specs.

## Phase 1: Run-history replay E2E spec

### Overview

Author and verify `tests/e2e/specs/diagnosis-run-history-replay.spec.ts` covering Risk #1's
replay facet, via `/10x-e2e`.

### Changes Required:

#### 1. New E2E spec

**File**: `tests/e2e/specs/diagnosis-run-history-replay.spec.ts` (new)

**Intent**: Prove that with multiple saved runs the page renders the newest on entry, exposes
one replay chip per run, and that clicking an older chip swaps the result card to that run's
synthesis **without** opening a live stream — the browser-level guarantee that replay is a
static history view, not a re-run. This extends facet (b) (single-run render) to the
multi-run history + click-to-replay interaction.

**Contract**: Mirror the structure of `diagnosis-synthesis-renders.spec.ts` — a provenance
header naming `test-plan.md` Risk #1, `test.describe`, an `afterEach` that deletes the created
device (FK cascade removes service + runs), a `Date.now()` stamp for collision-free strings.
Setup: `page.request.post('/api/devices')` + `.../services`, then two `seedRunRecord(...)`
calls with distinct `createdAtMs` (older = `stamp - 60_000`, newer = `stamp`), distinct
`status` (older `'healthy'`, newer `'down'`), and distinct `summary`/`problems`/`suggestions`
strings carrying the stamp. Assertions, all web-first (`toBeVisible`/`toBeEnabled`/
`toHaveCount`), `getByRole`/`getByText` only:

- on entry: newest `summary` visible (`.first()`); both replay chips present via
  `getByRole('button', { name: /healthy/ })` and `{ name: /down/ }`; panel header
  `agent run · idle` visible; re-run button enabled.
- click the older (`/healthy/`) chip; assert older `summary` visible and newest `summary`
  `toHaveCount(0)`; panel header still `idle`, button still enabled.
- a negative network assertion that **no** request to `**/diagnose/stream` fired during the
  replay (register a `page.on('request')` collector before the click, assert empty after the
  card swap settles).

**Deliberate-break check** (run during `/10x-e2e` review, then revert): temporarily make
`diagnosis.store.replay()` call `stream(...)` (or skip the `result` patch) and confirm the
spec goes red — proving it actually guards the replay-without-stream behavior.

### Success Criteria:

#### Automated Verification:

- [ ] Spec file exists: `tests/e2e/specs/diagnosis-run-history-replay.spec.ts`
- [ ] Spec passes green: `npx nx e2e e2e -- specs/diagnosis-run-history-replay.spec.ts`
- [ ] Full e2e suite still passes (no cross-spec state leak): `npm run e2e`
- [ ] Lint passes: `npx nx lint e2e` (or `npm run lint`)
- [ ] Format clean: `npm run format:check`

#### Manual Verification:

- [ ] Deliberate-break confirmed: with `replay()` wrongly opening a stream (or not swapping
      `result`), the spec fails — then reverted to green.
- [ ] Spec uses only `getByRole`/`getByText` locators and web-first waits (no
      `waitForTimeout`, no CSS/XPath), per `/10x-e2e` anti-pattern review.
- [ ] `afterEach` device-delete cleanup runs; re-running the spec twice in a row stays green.

**Implementation Note**: After Phase 1's automated verification passes, pause for human
confirmation that the deliberate-break and locator-discipline manual checks passed before
proceeding to Phase 2.

---

## Phase 2: Documentation sync

### Overview

Record facet (c) and the pagination decision in the test plan, and mark Phase 4 complete —
keeping `§6.5` and the rollout table aligned with the shipped specs (the same coupling commit
`9804435` used for facets a/b).

### Changes Required:

#### 1. §6.5 cookbook — add the replay facet

**File**: `context/foundation/test-plan.md` (§6.5, around lines 320-337)

**Intent**: Document facet (c) as the canonical multi-run replay example alongside (a) and
(b), and record that UI pagination is not E2E-able because the client sends no `limit`/`offset`.

**Contract**: Add a `(c) Run-history replay facet` bullet naming
`tests/e2e/specs/diagnosis-run-history-replay.spec.ts` as the canonical example, stating it
seeds ≥2 runs and asserts the older-run swap opens no stream. Add a one-line note under the
pagination/runs discussion that `recentRuns()` sends no params, so `limit`/`offset` is an
integration concern (`diagnose.controller.spec.ts`), not E2E. No code snippet.

#### 2. Phase 4 rollout row → complete

**File**: `context/foundation/test-plan.md` (§3 rollout table, line 86; optionally §6.6)

**Intent**: Move the Phase 4 row Status to `complete` — Risk #1's E2E facets (a/b/c) all ship
and Risk #6 is covered at integration — and optionally append a 2–3 line §6.6 note that the
live happy path remains out of scope pending a test seam.

**Contract**: Edit the `| 4 | diagnoseLogs e2e + SSE through the edge | … |` row Status cell
from `not started` to `complete`. Keep the status vocabulary literal (`complete`).

#### 3. change.md status

**File**: `context/changes/testing-diagnose-e2e/change.md`

**Intent**: Reflect that this change is implemented.

**Contract**: Set `status: complete` (or `implementing` until Phase 1 commits) and
`updated: <today>` in the frontmatter.

### Success Criteria:

#### Automated Verification:

- [ ] §6.5 references the new spec path: `grep -q "diagnosis-run-history-replay" context/foundation/test-plan.md`
- [ ] Phase 4 row no longer reads `not started`: `grep -n "diagnoseLogs e2e" context/foundation/test-plan.md` shows `complete`
- [ ] Format clean: `npm run format:check`

#### Manual Verification:

- [ ] §6.5 facet (c) reads consistently with facets (a)/(b) and the pagination note is accurate.
- [ ] Phase 4 status change is justified (all three deterministic facets shipped; #6 at integration).

**Implementation Note**: Phase 2 is docs-only; commit together with or immediately after the
Phase 1 spec so the cookbook never references a spec that isn't on disk.

---

## Testing Strategy

### Unit Tests:

- None. This change authors an E2E spec and edits docs; no application code changes, so no
  new unit/integration tests.

### Integration Tests:

- None added. Pagination (`limit`/`offset`) and the SSE `:ping`/header contract (#6) are
  already owned by existing api specs (`diagnose.controller.spec.ts` / `diagnose.service.spec.ts`).

### Manual Testing Steps:

1. Run the new spec alone: `npx nx e2e e2e -- specs/diagnosis-run-history-replay.spec.ts` — green.
2. Run the full suite: `npm run e2e` — all specs green, no leaked e2e users/devices.
3. Deliberate-break: edit `diagnosis.store.replay()` to call `stream(...)`, re-run the spec —
   it must go red; revert.
4. Re-run the spec twice consecutively to confirm `afterEach` cleanup keeps it independent.

## Performance Considerations

None. Two extra `better-sqlite3` inserts per test run; negligible.

## Migration Notes

None — no schema, no data migration.

## References

- Related research: `context/changes/testing-diagnose-e2e/research.md`
- E2E cookbook + risk map: `context/foundation/test-plan.md:44-49,86,299-349`
- Replay behavior: `apps/web/src/app/features/diagnosis/data/diagnosis.store.ts:77-88`
- Run-history template: `apps/web/src/app/features/services/service-detail.component.html:139-151`
- Seed helper: `tests/e2e/helpers/seed-run-record.ts`
- Canonical sibling spec: `tests/e2e/specs/diagnosis-synthesis-renders.spec.ts`
- Synthesis status enum: `libs/shared/src/lib/schemas/diagnosis-synthesis.schema.ts:13`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Run-history replay E2E spec

#### Automated

- [x] 1.1 Spec file exists: `tests/e2e/specs/diagnosis-run-history-replay.spec.ts`
- [x] 1.2 Spec passes green: `npx nx e2e e2e -- specs/diagnosis-run-history-replay.spec.ts`
- [x] 1.3 Full e2e suite still passes: `npm run e2e`
- [x] 1.4 Lint passes: `npx nx lint e2e`
- [x] 1.5 Format clean: `npm run format:check`

#### Manual

- [ ] 1.6 Deliberate-break confirmed red then reverted to green
- [ ] 1.7 Locator/wait discipline verified (getByRole/getByText, web-first, no waitForTimeout)
- [ ] 1.8 afterEach cleanup verified; spec independent across consecutive runs

### Phase 2: Documentation sync

#### Automated

- [ ] 2.1 §6.5 references the new spec path
- [ ] 2.2 Phase 4 row reads `complete`
- [ ] 2.3 Format clean: `npm run format:check`

#### Manual

- [ ] 2.4 §6.5 facet (c) + pagination note read consistently
- [ ] 2.5 Phase 4 status change justified
