# SSH Executor Lifecycle + Bounded Timeout — Test Coverage Implementation Plan

## Overview

Rollout Phase 2 of `context/foundation/test-plan.md` defends Risk #2: an SSH connection
leaks after a run, or a command/scan exceeds its bounded timeout and the run never
terminates. Research (`research.md`) established that the executor **already defends this
structurally** — disposal lives in an unconditional `finally`, the command timeout is a
`setTimeout` + `Promise.race` rejecting a clean `SshCommandTimeoutError` (HTTP 504), and the
scan uses the safe explicit-field `docker ps` form. The existing `ssh.executor.spec.ts`
already pins dispose-on-success, dispose-on-connect-failure, command-timeout→dispose, and the
per-call override.

This phase therefore **does not build a seam or write a first timeout test**. It closes the
narrow residual gaps research identified, by **extending existing spec files** (no new Nest
module): complete the executor dispose matrix, prove the failure surfaces cleanly at the
consumer boundary the user actually hits, lock the scan command against regression to the
slow form, characterize the truncated-line parse fragility, and document what is deliberately
not tested.

## Current State Analysis

- **Executor disposal is structural** (`apps/api/src/integrations/executor/ssh.executor.ts:66-79`):
  `clearTimeout(timer)` + `ssh.dispose()` in an unconditional `finally`, with dispose wrapped
  in its own `try/catch` so a dispose error never masks the original mapped connect error.
- **Bounded command timeout** (`ssh.executor.ts:60-65`): hand-rolled `setTimeout` + `Promise.race`
  rejecting `SshCommandTimeoutError(commandTimeoutMs)` → `GatewayTimeoutException` → HTTP 504.
  Per-call `timeoutMs` overrides the configured default; scan omits it and rides the 30 s
  `SSH_COMMAND_TIMEOUT_MS` default.
- **The seam exists and is used**: `SSH_CLIENT_FACTORY` token + `() => new NodeSSH()`
  (`ssh-client.factory.ts`). `ssh.executor.spec.ts` fakes the transport through it (never
  `vi.mock('node-ssh')`).
- **`SCAN_COMMAND`** (`service.service.ts:31-34`) is the safe explicit-field form — five
  `{{json .Field}}` fields, no `{{json .}}`, no `-s`/`--size`. The dangerous form was a real
  ~27 s incident recorded in `lessons.md`.
- **Existing executor spec coverage** (`ssh.executor.spec.ts`): serialize-per-device,
  command-timeout→dispose (`:81`), per-call override (`:94`), dispose-on-success (`:108`),
  dispose-on-connect-failure (`:122`), auth-error mapping, decrypt short-circuit, no-credential,
  privateKey path.
- **Existing service spec coverage** (`service.service.spec.ts`): `ServiceService.scan` via a
  Nest `TestingModule` + `.overrideProvider(EXECUTOR).useValue(mockExecutor)` on a real temp
  SQLite DB. Happy-path NDJSON parse, audit row, docker-error mapping (127 / daemon-down). All
  cases feed **resolved** executor promises.

### Key Discoveries:

- **Two executor dispose branches from research Area 1 are not yet pinned**: (1) `execCommand`
  itself rejecting (non-timeout, e.g. a channel error) still flows through `finally` → dispose;
  (2) `dispose()` throwing on the connect-failure path must not mask the original mapped connect
  error (the `try/catch` around dispose at `ssh.executor.ts:74-78`).
- **No consumer-level "executor hangs / rejects" test** (`service.service.spec.ts` gap b): the
  "run never terminates" NFR is asserted inside the executor, never at the scan boundary the
  user hits. At this layer the executor is mocked (`EXECUTOR` override), so the test asserts
  **clean propagation** of `SshCommandTimeoutError` → 504, with **no audit row** written.
- **Scan-command regression is unguarded**: the existing `toHaveBeenCalledWith` full-string
  assertion (`service.service.spec.ts:116-121`) is updated in lockstep with any regression, so
  it does not protect the lesson. A dedicated negative assertion does.
- **Truncated-line parse fragility (gap d)**: `parseContainer` (`service.service.ts:178-189`)
  uses strict `JSON.parse` + `z.strictObject` with no per-line try/catch, so a timeout-killed
  command emitting a partial NDJSON line fails the **whole** scan. Research flags this as "not
  strictly Risk #2" — it is pinned as a characterization test and the fix is deferred.

## Desired End State

`ssh.executor.spec.ts` proves dispose runs on **every** lifecycle branch (success, connect
reject, command timeout, `execCommand` reject) and that a dispose error never masks the
original. `service.service.spec.ts` proves `scan()` surfaces a hung/timed-out executor as a
clean 504 (no hang, no audit row), guards `SCAN_COMMAND` against reverting to the slow form,
and documents the truncated-line behavior. `test-plan.md` §6.3 cookbook is filled, §7 records
the deliberately-untested connect-timeout and the deferred parse-hardening, and §6.6 carries a
phase note. A follow-up implementation change for the parse hardening (gap d) is flagged.

Verify: `npx nx test api` green; the new tests fail if disposal, timeout propagation, or the
safe scan command regress.

## What We're NOT Doing

- **Not building a new Nest `TestingModule` integration file** for the SSH executor (research
  gap c). The structural guarantee is already proven at the unit level; graph-level re-wiring
  re-asserts what the unit spec proves at higher setup cost. Explicitly out of scope.
- **Not wall-clock testing the connect timeout** (`readyTimeout`, research gap a). It is
  node-ssh's own option; a test would mostly assert node-ssh honors its own config and risks
  flakiness. Documented as deliberately-untested in §7.
- **Not hardening the truncated-line parse** in this phase (gap d). We pin current behavior and
  flag a separate implementation change — a testing phase must not smuggle a behavior change.
- **Not changing any production code in `ssh.executor.ts` or `service.service.ts`** — this is a
  coverage + documentation phase only.

## Implementation Approach

Mirror Phase 1's doctrine: extend existing spec files in place, fake at the right seam
(`SSH_CLIENT_FACTORY` for executor-internal, the `EXECUTOR` token mock for consumer-level),
use a **tiny real bound + a hanging fake** rather than fake timers, and never `vi.mock('node-ssh')`.
Phases are ordered cheapest-completeness-first (executor matrix), then the highest-signal new
test (consumer boundary), then documentation.

## Phase 1: Complete the executor dispose matrix

### Overview

Pin the two lifecycle branches from research Area 1 that the existing spec does not yet cover,
so dispose-on-all-paths is proven exhaustively and a dispose failure is shown not to mask the
real error.

### Changes Required:

#### 1. Executor spec — `execCommand`-reject dispose branch

**File**: `apps/api/src/integrations/executor/ssh.executor.spec.ts`

**Intent**: Prove that when `execCommand` rejects with a non-timeout error (e.g. a channel
error), the connection is still disposed and the error propagates — the fourth dispose branch
research enumerated.

**Contract**: New `it(...)` using `buildExecutor` with a `FakeClient` whose `execCommand` is
`vi.fn().mockRejectedValue(new Error('channel open failure'))`. Assert the call rejects and
`client.dispose` was called once. Follow the existing AAA + `inputX`/`actualX` convention.

#### 2. Executor spec — dispose-error does not mask the original

**File**: `apps/api/src/integrations/executor/ssh.executor.ts:74-78` (behavior under test),
`apps/api/src/integrations/executor/ssh.executor.spec.ts` (new test)

**Intent**: Prove the `try/catch` around `ssh.dispose()` swallows a dispose error so the
original mapped connect error still surfaces — disposal hygiene must never overwrite the
caller-visible failure.

**Contract**: New `it(...)` with a `FakeClient` whose `connect` rejects with a connect error and
whose `dispose` is `vi.fn(() => { throw new Error('dispose failed'); })`. Assert the call
rejects with `SshConnectError` (the mapped connect error), **not** the dispose error.

### Success Criteria:

#### Automated Verification:

- [ ] Executor spec passes: `npx nx test api -- src/integrations/executor/ssh.executor.spec.ts`
- [ ] Lint passes: `npx nx lint api`
- [ ] Full api suite green: `npx nx test api`

#### Manual Verification:

- [ ] Both new tests genuinely fail if disposal is removed from the `finally` / if the dispose
  `try/catch` is removed (sanity-check the assertions bite, not just pass).

**Implementation Note**: After completing this phase and all automated verification passes,
pause for manual confirmation before proceeding.

---

## Phase 2: Consumer-level timeout propagation + scan-command guard

### Overview

Add the highest-signal new tests at the boundary the user hits: a hung/timed-out executor must
surface as a clean 504 with no audit row, the scan command must not regress to the slow form,
and the truncated-line behavior is pinned.

### Changes Required:

#### 1. Service spec — executor-timeout propagates as a clean 504, no audit row

**File**: `apps/api/src/modules/service/service.service.spec.ts`

**Intent**: Prove `scan()` does not hang or swallow a timed-out executor: when
`executor.execute` rejects with `SshCommandTimeoutError`, `scan()` rejects with that same
504-mapped error and writes **no** `service.scan` audit row (the failure path leaves no row,
matching the existing docker-error case at `:144-149`).

**Contract**: New `it(...)` in the existing `describe('ServiceService')`. Arrange
`mockExecutor.execute.mockRejectedValue(new SshCommandTimeoutError(30000))` (import from
`@api/integrations/executor/executor.errors`). Assert `service.scan(inputDeviceId, userId)`
rejects with `SshCommandTimeoutError` and `auditService.list({ offset: 0 })` has length 0.
Uses the existing temp-SQLite `TestingModule` harness — no new setup.

#### 2. Service spec — `SCAN_COMMAND` regression guard

**File**: `apps/api/src/modules/service/service.service.spec.ts`

**Intent**: Lock in the `lessons.md` incident: the scan command must never revert to the
per-container layer-size walk that brushed the 30 s ceiling.

**Contract**: New `it(...)` capturing the command actually passed to the executor (from the
happy-path `mockExecutor.execute.mock.calls`, or a dedicated arrange) and asserting the string
contains **no** `-s`, `--size`, or `{{json .}}` (whole-struct marshal), and **does** contain
the explicit-field `{{json .Names}}` form. A negative content assertion, distinct from the
existing full-string `toHaveBeenCalledWith` (which moves with any regression).

#### 3. Service spec — truncated-line parse characterization (gap d)

**File**: `apps/api/src/modules/service/service.service.spec.ts`

**Intent**: Pin the current behavior — a partial/truncated NDJSON line (as a timeout-killed
command can emit) fails the **whole** scan — so the fragility is documented and a future fix is
a deliberate, reviewed change rather than a silent behavior shift.

**Contract**: New `it(...)` feeding `mockExecutor.execute` a stdout with one valid line plus one
truncated JSON line (e.g. `'{"Names":"web","Image":'`). Assert `service.scan(...)` rejects
(SyntaxError/ZodError from `parseContainer`). A comment names this as pinned-current-behavior
with the deferred-hardening reference, so the test reads as a characterization, not an
endorsement.

### Success Criteria:

#### Automated Verification:

- [ ] Service spec passes: `npx nx test api -- src/modules/service/service.service.spec.ts`
- [ ] Lint passes: `npx nx lint api`
- [ ] Full api suite green: `npx nx test api`

#### Manual Verification:

- [ ] The timeout-propagation test fails if `scan()` is changed to catch/swallow the executor
  rejection (assertion bites).
- [ ] The scan-guard test fails if `SCAN_COMMAND` is edited to include `-s` or `{{json .}}`.
- [ ] The characterization test's comment clearly marks it as pinned-current-behavior with the
  deferred-fix reference.

**Implementation Note**: After completing this phase and all automated verification passes,
pause for manual confirmation before proceeding.

---

## Phase 3: Documentation + deferred-fix flag

### Overview

Fill the cookbook so the next author can add an SSH boundary test, record what is deliberately
not tested, and flag the deferred parse-hardening as a real follow-up.

### Changes Required:

#### 1. Cookbook §6.3 — SSH executor boundary pattern

**File**: `context/foundation/test-plan.md` (§6.3)

**Intent**: Replace the `TBD` with the concrete pattern this phase established: fake at
`SSH_CLIENT_FACTORY` for executor-internal lifecycle/timeout tests (never `vi.mock('node-ssh')`),
fake at the `EXECUTOR` token for consumer-level (scan) tests; use a tiny real `commandTimeoutMs`
+ a never-resolving `execCommand` (no fake timers); the dispose matrix lives in
`ssh.executor.spec.ts`, the consumer 504-propagation in `service.service.spec.ts`.

**Contract**: Prose subsection mirroring the shape of the existing §6.2 (LLM boundary) entry,
including the run-locally commands for both spec files.

#### 2. §7 — record deliberately-untested items

**File**: `context/foundation/test-plan.md` (§7)

**Intent**: Document the two deliberate exclusions so a future reader does not mistake the gaps
for oversights: (a) connect-timeout (`readyTimeout`) wall-clock behavior is node-ssh's own
option and not tested; (d) truncated-line parse hardening is deferred to a separate
implementation change (current behavior = whole-scan failure, pinned by a characterization
test).

**Contract**: Two new bullets in §7, each with a one-line rationale and a "re-evaluate if…"
clause, matching the existing entry style.

#### 3. §6.6 — per-phase note

**File**: `context/foundation/test-plan.md` (§6.6)

**Intent**: 2–3 line note capturing what Phase 2 taught (the executor already defended Risk #2
structurally; this phase closed residual gaps by extending existing specs, deferred parse
hardening).

**Contract**: One dated bullet under §6.6, matching the Phase 1 entry style.

#### 4. Flag the deferred parse-hardening follow-up

**File**: `context/changes/testing-ssh-executor-lifecycle-timeout/change.md` (Notes) and/or a
new `/10x-new` change reference

**Intent**: Ensure the deferred gap-d hardening (per-line try/catch so a partial NDJSON line
skips rather than failing the whole scan) is not lost — record it as an explicit follow-up
implementation change.

**Contract**: A note in `change.md` naming the follow-up and its acceptance idea (skip malformed
lines, keep valid containers), so it can be opened with `/10x-new` later.

### Success Criteria:

#### Automated Verification:

- [ ] `test-plan.md` §6.3 no longer reads `TBD` and the markdown is well-formed:
  `grep -n "TBD" context/foundation/test-plan.md` shows §6.3 resolved.
- [ ] Format check passes: `npm run format:check`

#### Manual Verification:

- [ ] §6.3 pattern is accurate enough that a new author could add an SSH boundary test from it
  alone.
- [ ] §7 entries correctly describe the (a) and (d) exclusions and their re-evaluation triggers.
- [ ] The deferred gap-d follow-up is captured where it will be found again.

**Implementation Note**: Final phase — confirm the test-plan status (§3 Phase 2 → `complete`)
is updated by the orchestrator after manual confirmation.

---

## Testing Strategy

### Unit Tests:

- Executor dispose-on-all-paths matrix: success, connect-reject, command-timeout,
  `execCommand`-reject; plus dispose-error-does-not-mask (Phase 1).
- Edge case: a never-resolving `execCommand` raced against a tiny real `commandTimeoutMs`
  (existing pattern at `ssh.executor.spec.ts:81-106`, reused as the model).

### Integration Tests:

- Consumer-level `scan()` over the real temp-SQLite `TestingModule` with a mocked `EXECUTOR`:
  timeout-rejection → clean 504, no audit row; scan-command regression guard; truncated-line
  characterization (Phase 2).

### Manual Testing Steps:

1. Run `npx nx test api` — full suite green.
2. Temporarily break disposal (delete `ssh.dispose()` from the `finally`) and confirm the new
   `execCommand`-reject test fails; revert.
3. Temporarily add `-s` to `SCAN_COMMAND` and confirm the scan-guard test fails; revert.

## Performance Considerations

None. New tests use tiny real timeouts (~20 ms) and the existing temp-SQLite harness; no new
slow paths.

## Migration Notes

None — test and documentation changes only; no production code or schema changes.

## References

- Research: `context/changes/testing-ssh-executor-lifecycle-timeout/research.md`
- Test plan: `context/foundation/test-plan.md` (§2 Risk #2, §3 Phase 2, §6.3 cookbook)
- Phase 1 precedent (two-seams doctrine): `context/archive/2026-06-16-testing-agent-diagnosis-under-failure/`
- Executor under test: `apps/api/src/integrations/executor/ssh.executor.ts:35-79`
- Existing executor spec: `apps/api/src/integrations/executor/ssh.executor.spec.ts`
- Existing service spec: `apps/api/src/modules/service/service.service.spec.ts`
- Scan command: `apps/api/src/modules/service/service.service.ts:31-34`, parse at `:178-189`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Complete the executor dispose matrix

#### Automated

- [x] 1.1 Executor spec passes: `npx nx test api -- src/integrations/executor/ssh.executor.spec.ts` — 52afdd4
- [x] 1.2 Lint passes: `npx nx lint api` — 52afdd4
- [x] 1.3 Full api suite green: `npx nx test api` — 52afdd4

#### Manual

- [x] 1.4 Both new tests fail if disposal / the dispose try-catch is removed (assertions bite) — 52afdd4

### Phase 2: Consumer-level timeout propagation + scan-command guard

#### Automated

- [x] 2.1 Service spec passes: `npx nx test api -- src/modules/service/service.service.spec.ts` — 5e0b3d2
- [x] 2.2 Lint passes: `npx nx lint api` — 5e0b3d2
- [x] 2.3 Full api suite green: `npx nx test api` — 5e0b3d2

#### Manual

- [x] 2.4 Timeout-propagation test fails if `scan()` swallows the executor rejection — 5e0b3d2
- [x] 2.5 Scan-guard test fails if `SCAN_COMMAND` includes `-s` or `{{json .}}` — 5e0b3d2
- [x] 2.6 Characterization test comment marks it as pinned-current-behavior + deferred-fix ref — 5e0b3d2

### Phase 3: Documentation + deferred-fix flag

#### Automated

- [x] 3.1 §6.3 no longer reads `TBD`: `grep -n "TBD" context/foundation/test-plan.md`
- [x] 3.2 Format check passes: `npm run format:check`

#### Manual

- [x] 3.3 §6.3 pattern is sufficient for a new author to add an SSH boundary test
- [x] 3.4 §7 entries describe the (a) and (d) exclusions + re-evaluation triggers
- [x] 3.5 Deferred gap-d follow-up captured where it will be found again
