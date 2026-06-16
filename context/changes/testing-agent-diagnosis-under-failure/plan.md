# Testing Agent Diagnosis Under Failure — Implementation Plan

## Overview

Close the four residual test gaps for **Risk #1** (the `diagnoseLogs` agent path: bad
LLM output or a hung run yields a confident-but-useless synthesis, or no result) so
the risk is fully retired. The phase is **gap-closing, not greenfield**: two specs
already defend most of Risk #1 (`diagnose.service.spec.ts`, `diagnose.controller.spec.ts`).
The gaps left are the ones the test plan's "must challenge" warns about — the existing
specs **mock the entire `ai` boundary**, so they verify the error-mapper, not the SDK's
real abort/validation.

We close them at the cheapest layer that gives real signal (test-plan §1, principle #1):

- **Seam (b)** — `vi.mock('ai')` + injected pre-built errors — for the two cheap,
  mapper-level gaps (logs-timeout frame; the `NoObjectGeneratedError`-with-`cause`
  unwrap branch). Extends the existing `diagnose.service.spec.ts`.
- **Seam (a)** — a real `MockLanguageModelV3` (from `ai/test`) injected at
  `LlmProviderClientFactory.create`, driving the **real** `streamObject` — for the two
  high-signal gaps (real `AbortSignal.timeout` firing; a real `NoObjectGeneratedError`
  produced by the SDK validating a non-conformant object). Lives in a **new** spec file
  that does not mock `'ai'`.

## Current State Analysis

The diagnose flow is an **SSE streaming agent** built on Vercel AI SDK `streamObject()`,
not a request/response `generateObject` endpoint. Risk #1's surface is the streaming
**error taxonomy** (`delta`/`done`/`error` frames with a `code`), not an HTTP error body.

Already tested (`diagnose.service.spec.ts`, 12 cases; `diagnose.controller.spec.ts`,
5 e2e cases over a real temp SQLite): the `synthesis-failed` frame (via an *injected*
`NoObjectGeneratedError`), the `timeout` frame (via an *injected* `TimeoutError`),
`upstream-unavailable`, fail-fast-409-before-stream, no-secret-leak, the heartbeat ping,
and `agentContext` → `system` handling. The controller spec proves an in-stream error
returns **200 (not 401, not malformed)**.

The four genuine residual gaps (research §6):

1. **`logs-timeout` path never exercised.** `DiagnosisLogsTimeoutError` / the
   `Promise.race` in `fetchLogs` (`diagnose.service.ts:179-206`) and the `logs-timeout`
   code (`diagnose.errors.ts:31-33`) have zero assertions.
2. **Real `AbortSignal.timeout` wiring simulated, not fired.** The existing timeout test
   (`diagnose.service.spec.ts:236`) injects a hand-made `TimeoutError`; `streamObject` is
   fully mocked, so `AbortSignal.timeout(generateTimeoutMs)` never actually fires.
3. **The `NoObjectGeneratedError`-with-`TimeoutError`-`cause` unwrap branch**
   (`diagnose.errors.ts:53-56`) is untested — the existing test sets `name` directly
   rather than wrapping in `NoObjectGeneratedError`.
4. **No real schema rejection through the agent path.** Schema rejection is tested only
   in `libs/shared` in isolation; inside the flow `streamObject` is mocked, so the SDK's
   real validation against `diagnosisSynthesisSchema` (and the resulting
   `NoObjectGeneratedError`) is never produced from an actual malformed object.

### Key Discoveries:

- **`ai@6.0.201` ships `MockLanguageModelV3`** via the `ai/test` export, with a `doStream`
  hook (`node_modules/ai/dist/test/index.d.ts:53-67`). Returning it from
  `LlmProviderClientFactory.create` drives the **real** `streamObject` — this is what
  makes seam (a) viable (research open-question #2, now resolved). Note the V3 suffix:
  v6 uses the `LanguageModelV3` spec, not V2.
- **`vi.mock('ai', …)` is file-scoped.** The existing `diagnose.service.spec.ts` mocks
  `streamObject` at the top of the file (`:18-21`); seam-(a) tests need the genuine
  `streamObject`, so they **must** live in a separate spec file. This forces the
  Phase 1 / Phase 2 file split.
- **Two timeouts bound the run**: synthesis `llm.generateTimeoutMs` (default 12000, min
  1000) via `AbortSignal.any([AbortSignal.timeout(...), controller.signal])`
  (`diagnose.service.ts:113`) → `timeout` code; logs `llm.logsTimeoutMs` (default 5000)
  via `Promise.race` (`diagnose.service.ts:193-200`) → `logs-timeout` code. Both are
  config-DI tunables (`llmConfig.KEY`) — overridable to a tiny bound in a spec
  (lessons.md: config-layer tunables; the full `LlmConfig` shape must be supplied).
- **Explicit `@Inject(Token)` everywhere** (`diagnose.service.ts:26-35`) — esbuild drops
  `design:paramtypes`, so a Testing-module override keys on those tokens (lessons.md).
  The existing service spec hand-constructs `new DiagnoseService(...)` with positional
  mocks; the new spec will follow the same hand-built pattern (no DI graph needed for a
  plain class).
- **The error mapper never surfaces raw model text** (`diagnose.errors.ts:30-42`): the
  `synthesis-failed` frame carries a fixed sanitized message. The no-leak assertion
  (`JSON.stringify(frame).not.toContain('raw')`) must be re-run against the *real*
  `NoObjectGeneratedError` (which carries `.text`).
- **The synthesis schema** (`libs/shared/.../diagnosis-synthesis.schema.ts:11-18`):
  `z.strictObject({ problems: string[], status: enum[healthy|degraded|down],
  suggestions: string[], summary: string })`. `.strictObject` rejects unknown keys; a bad
  `status` enum value or a non-string array element is the cheapest structural violation
  to make the SDK reject.

## Desired End State

Risk #1 is retired: a new run of `npx nx test api` exercises, end to end through the real
SDK where it matters, that on bad LLM output the agent returns a clean surfaced `error`
frame (no crash, no hang, no leak) and that the synthesis timeout **actually fires**
within its configured bound. The test-plan §6.2 cookbook documents the fake-provider
pattern, §6.6 records what the real-abort test taught (research open-question #1), and
§3 Phase 1 status reflects the rollout progress.

Verify: `npx nx test api` is green with the new cases present; `npx nx lint api` and the
typecheck pass; the new real-model spec contains **no** `vi.mock('ai')`.

## What We're NOT Doing

- **Not asserting synthesis *content* correctness** — the oracle problem (test-plan §7).
  We assert schema-conformance, timeout, and clean errors, never "is the AI right."
- **Not copying an expected synthesis from the model's own output** (the tautology
  anti-pattern, test-plan §1 / Risk #1 row).
- **Not promoting the logs-timeout test to controller e2e** — the service-level test is
  the cheapest layer with real signal; the controller spec already proves the
  200-not-401 envelope for in-stream errors.
- **Not touching CI gate wiring** — the "unit+integration required after Phase 1" gate
  (test-plan §5) is a CI concern; no CI config exists yet to edit, and it is out of scope
  for this change.
- **Not refactoring** `diagnose.service.ts` / `diagnose.errors.ts` — this is a
  test-and-docs change; production code is the system under test, not the target.
- **Not bootstrapping Playwright / e2e** — that is Phase 4 of the rollout.

## Implementation Approach

Two test phases ordered cheapest-first, then a docs/ledger phase:

1. **Phase 1 (seam b, extend existing file)** closes the two mapper-level gaps with the
   tools already in `diagnose.service.spec.ts` — the `fakeStream` helper and the
   file-level `vi.mock('ai')`. No new infrastructure.
2. **Phase 2 (seam a, new file)** introduces the real-SDK seam: a `MockLanguageModelV3`
   returned from an overridden `LlmProviderClientFactory.create`, driving the real
   `streamObject` against the real `diagnosisSynthesisSchema`. This is the high-signal
   work that answers the test plan's "must challenge." It also fills §6.2 with the
   reusable pattern.
3. **Phase 3 (ledger)** appends the §6.6 per-phase note (after the real-abort test reveals
   whether v6 surfaces the abort bare or wrapped) and advances the §3 Phase 1 status.

## Critical Implementation Details

- **`vi.mock('ai')` file-scoping is load-bearing.** The seam-(a) tests fail silently
  (against a stub) if added to `diagnose.service.spec.ts`. They must be a new file with no
  `vi.mock('ai')` so `streamObject` is genuine.
- **Real-abort determinism.** Drive the real `AbortSignal.timeout` with a *tiny real*
  `generateTimeoutMs` (e.g. ~50 ms, ≥ the Joi `min(1000)`? — the Joi bound guards *env*
  at boot, not a spec's `.useValue`/positional config object, so a sub-1000 value is fine
  in-test) and a `MockLanguageModelV3.doStream` that returns a stream which **never
  settles but honors `options.abortSignal`** (reject/clean-up when the signal fires).
  This exercises the genuine `AbortSignal.any` composition on wall-clock without
  fake-timer/SDK interaction. Do **not** use `vi.useFakeTimers()` here — the SDK's
  internal microtasks do not advance cleanly under fake timers.
- **Real schema rejection.** `doStream` must emit text/JSON deltas that finish as a
  *non-conformant* object (e.g. `status: "exploded"` — outside the enum — or a non-string
  array element), so the SDK's own validation against `diagnosisSynthesisSchema` throws a
  real `NoObjectGeneratedError`. Then re-assert no leak of the raw `.text`.

## Phase 1: Cheap mapper-level gaps (seam b)

### Overview

Close gaps #1 (logs-timeout) and #3 (cause-unwrap) by extending the existing
`diagnose.service.spec.ts`, reusing its `vi.mock('ai')`, `fakeStream`, `collect`, and
hand-built `buildService()` helpers.

### Changes Required:

#### 1. logs-timeout frame (gap #1)

**File**: `apps/api/src/modules/diagnose/diagnose.service.spec.ts`

**Intent**: Prove that when the SSH logs fetch exceeds `logsTimeoutMs`, the run emits a
single `{ code: 'logs-timeout' }` error frame and synthesis is never reached. This is the
bounded path motivated by the `docker ps -s` 27 s lesson — currently zero assertions.

**Contract**: New `it(...)` in the existing `describe('DiagnoseService')`. Arrange
`mockExecutor.execute` to return a promise that never resolves within the bound (so the
`Promise.race` in `fetchLogs` loses to the timer); drive it deterministically by setting
`config.logsTimeoutMs` to a tiny value in this test (the `config` object is positional, so
override a local copy via `buildService` or mutate before `narrate`). Assert the single
`error` frame has `code: 'logs-timeout'`, that `mockedStreamObject` was **not** called, and
that `mockRunRecordService.create` was **not** called. Use real timers + a never-resolving
executor promise (the service's own `setTimeout(logsTimeoutMs)` fires the
`DiagnosisLogsTimeoutError`); keep the bound small so the test is fast.

#### 2. NoObjectGeneratedError-with-cause unwrap (gap #3)

**File**: `apps/api/src/modules/diagnose/diagnose.service.spec.ts`

**Intent**: Prove the `isSynthesisTimeout` unwrap branch — an `AbortSignal.timeout` abort
wrapped by the SDK as a `NoObjectGeneratedError` whose `.cause.name` is
`TimeoutError`/`AbortError` — maps to the **`timeout`** frame, not `synthesis-failed`.
The existing timeout test sets `name` directly and never wraps.

**Contract**: New `it(...)` reusing `fakeStream([], { reject: <wrapped error> })` where the
reject is a real `NoObjectGeneratedError` (kept real by the existing `vi.mock` that spreads
`actual`) constructed with `cause` set to an error whose `name` is `'TimeoutError'` (and a
sibling case `'AbortError'`). Assert the frame is `{ code: 'timeout', … }`. Optionally
`it.each` the two cause names.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npx nx test api -- src/modules/diagnose/diagnose.service.spec.ts`
- Lint passes: `npx nx lint api`
- Typecheck passes (via the test build / `npx nx test api`)
- The logs-timeout case asserts `streamObject` was not called and no run was persisted
- The cause-unwrap case maps both `TimeoutError` and `AbortError` causes to `timeout`

#### Manual Verification:

- The two new cases read as behavior assertions (frame `code`s), not implementation pokes
- The logs-timeout test completes quickly (small `logsTimeoutMs`), no multi-second hang

**Implementation Note**: After Phase 1 automated verification passes, pause for manual
confirmation before Phase 2.

---

## Phase 2: Real-SDK gaps (seam a) + cookbook

### Overview

Introduce the real-SDK seam: a `MockLanguageModelV3` injected at
`LlmProviderClientFactory.create`, driving the real `streamObject` so the genuine
`AbortSignal.timeout` fires (gap #2) and the SDK's real validation against
`diagnosisSynthesisSchema` produces a real `NoObjectGeneratedError` (gap #4). New spec
file (no `vi.mock('ai')`). Then document the pattern in test-plan §6.2.

### Changes Required:

#### 1. New real-model spec scaffold

**File**: `apps/api/src/modules/diagnose/diagnose.service.real-model.spec.ts` (new)

**Intent**: Host the seam-(a) tests in a file that does **not** mock `'ai'`, so
`streamObject` is genuine. Reuse the hand-built `DiagnoseService` construction pattern from
the existing spec (positional mocks for executor/service/device/llmProvider/runRecord/audit
+ a small `LlmConfig`), but replace `mockClientFactory.create` so it returns a
`MockLanguageModelV3` configured per test.

**Contract**: Imports `MockLanguageModelV3` from `ai/test` and the real
`diagnosisSynthesisSchema` from `@opspilot/shared`. A `buildService(model)` helper wires the
fake model through `mockClientFactory.create`. `getActiveProviderConfig` returns a dummy
config (its values are inert — the fake model ignores `apiKey`/`baseURL`). Executor returns
valid logs so the flow reaches synthesis. No `vi.mock('ai')` anywhere in this file.

#### 2. Real AbortSignal.timeout fires within bound (gap #2)

**File**: `apps/api/src/modules/diagnose/diagnose.service.real-model.spec.ts`

**Intent**: Prove the run's synthesis timeout actually fires (not a stand-in): with a tiny
real `generateTimeoutMs` and a fake model that hangs, the real
`AbortSignal.any([AbortSignal.timeout(...), …])` aborts the stream and the failure surfaces
as a single `timeout` frame within bound.

**Contract**: `MockLanguageModelV3({ doStream: async (options) => <stream that never
emits a finish and honors options.abortSignal> })`. Set `config.generateTimeoutMs` small
(~50 ms). Collect frames; assert exactly one `error` frame with `code: 'timeout'`, no
`done`, no persisted run. The `doStream` must observe `options.abortSignal` and settle
(reject/return) when it fires so the test does not leak a pending timer. **This case also
resolves research open-question #1** — capture whether the abort surfaces as a bare
`TimeoutError`/`AbortError` or wrapped as `NoObjectGeneratedError`-with-`cause` (record in
Phase 3's §6.6 note).

**Contract (snippet — the non-obvious abort-honoring stream):**

```ts
// doStream returns a ReadableStream that emits nothing and rejects when the
// run's AbortSignal.timeout fires — so the REAL AbortSignal.any composition
// drives the abort, not an injected error. counterintuitive: the stream must
// wire its own teardown to options.abortSignal or the timer leaks.
doStream: async ({ abortSignal }) => ({
  stream: new ReadableStream({
    start(controller) {
      abortSignal?.addEventListener('abort', () => controller.error(abortSignal.reason));
    },
  }),
});
```

#### 3. Real schema rejection through the SDK (gap #4)

**File**: `apps/api/src/modules/diagnose/diagnose.service.real-model.spec.ts`

**Intent**: Prove the SDK's real validation against `diagnosisSynthesisSchema` rejects a
non-conformant model object as a real `NoObjectGeneratedError`, mapped to `synthesis-failed`
with no leak of the raw model text.

**Contract**: `MockLanguageModelV3` whose `doStream` emits text deltas that finish as a
non-conformant object (e.g. `{"status":"exploded","summary":"x","problems":[],"suggestions":[]}`
— `status` outside the enum). Drive the real `streamObject`; assert a single `error` frame
with `code: 'synthesis-failed'`, no persisted run, and `JSON.stringify(frame)` does not
contain the raw model text. If shaping the exact `doStream` chunk sequence for a finished
object proves fiddly, the fallback is a thin contract test that feeds a non-conformant
object straight to `diagnosisSynthesisSchema.parse` *and* one flow test asserting the frame
mapping — but the primary target is the real end-to-end rejection through `streamObject`.

#### 4. Fill test-plan §6.2 cookbook

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the "6.2 Adding an integration test (LLM boundary) — TBD" placeholder
with the concrete fake-provider pattern this phase establishes, so future LLM-boundary
tests reuse it.

**Contract**: Rewrite §6.2 to document: inject `MockLanguageModelV3` (`ai/test`) at the
`LlmProviderClientFactory.create` seam to drive the real `streamObject`; reference
`diagnose.service.real-model.spec.ts` as the canonical example; note the file must **not**
`vi.mock('ai')`; note the timeout knob is the `llmConfig.KEY` override; restate the oracle
boundary (assert schema-conformance + timeout + clean error, never content). Keep the
existing §6 prose style.

### Success Criteria:

#### Automated Verification:

- New spec passes: `npx nx test api -- src/modules/diagnose/diagnose.service.real-model.spec.ts`
- Full api suite green: `npx nx test api`
- Lint passes: `npx nx lint api`
- The real-abort case fires the genuine `AbortSignal.timeout` (no injected error) and
  yields a single `timeout` frame within the small bound
- The schema-rejection case produces a real `NoObjectGeneratedError` from the SDK and maps
  to `synthesis-failed` with no raw-text leak
- The new file contains no `vi.mock('ai')` (grep check)

#### Manual Verification:

- The real-abort test completes in well under a second (small `generateTimeoutMs`), with no
  leaked timer warning at suite end
- The schema-rejection assertion fails if the mapper were to start echoing raw model text
  (verify by a scratch run, then revert)
- §6.2 reads as a usable recipe for the next LLM-boundary test author

**Implementation Note**: After Phase 2 automated verification passes, pause for manual
confirmation before Phase 3.

---

## Phase 3: Ledger updates

### Overview

Record what the rollout phase taught and advance its status — done last because §6.6 needs
the real-abort finding from Phase 2.

### Changes Required:

#### 1. Append §6.6 per-phase note

**File**: `context/foundation/test-plan.md`

**Intent**: Capture the 2-3 line "what this phase taught," centered on whether `ai` v6
surfaces an `AbortSignal.timeout` abort as a bare `TimeoutError`/`AbortError` or wrapped as
`NoObjectGeneratedError`-with-`cause` (resolves research open-question #1) — the fact that
justifies both branches of `isSynthesisTimeout`.

**Contract**: Append a dated note under §6.6 in the existing list style.

#### 2. Advance §3 Phase 1 status

**File**: `context/foundation/test-plan.md`

**Intent**: Move the §3 rollout-table Status for Phase 1 from `change opened` toward
`complete` per the fixed status vocabulary (`planned` once this plan lands; `complete` once
tests are merged green).

**Contract**: Edit the Phase 1 row Status cell using only the fixed literals
(`not started` → `change opened` → `researched` → `planned` → `implementing` →
`complete`). Also bump the `change.md` front-matter `status`/`updated` for this change.

### Success Criteria:

#### Automated Verification:

- `context/foundation/test-plan.md` §3 Phase 1 Status holds a valid status literal
- No test or lint regressions: `npx nx test api` && `npx nx lint api`

#### Manual Verification:

- §6.6 note accurately reflects the abort-surface finding from Phase 2's real-abort test
- The status reflects reality (e.g. `complete` only after the tests are actually merged)

**Implementation Note**: This phase is docs-only; no pause needed beyond the standard
review.

---

## Testing Strategy

This change *is* tests; the strategy is the layering itself.

### Unit / mapper-level (seam b — Phase 1):

- logs-timeout frame: executor never resolves within a tiny `logsTimeoutMs` → single
  `logs-timeout` frame, synthesis never reached, nothing persisted.
- cause-unwrap: `NoObjectGeneratedError` with a `TimeoutError`/`AbortError` `.cause` →
  `timeout` frame (both cause names).

### Integration / real-SDK (seam a — Phase 2):

- real `AbortSignal.timeout`: tiny `generateTimeoutMs` + hanging abort-honoring fake model
  → single `timeout` frame within bound, no leaked timer.
- real schema rejection: non-conformant `doStream` output → real `NoObjectGeneratedError`
  → `synthesis-failed` frame, no raw-text leak.

### Manual Testing Steps:

1. `npx nx test api` — full suite green, new cases present.
2. `grep -n "vi.mock('ai')" apps/api/src/modules/diagnose/diagnose.service.real-model.spec.ts`
   returns nothing (seam-(a) integrity).
3. Temporarily make the mapper echo raw model text → the no-leak assertion fails → revert.

## Performance Considerations

Tests must stay fast and non-flaky. The two timing-sensitive tests use *tiny real* bounds
(`logsTimeoutMs` / `generateTimeoutMs` ~50 ms) rather than the production defaults, and the
real-abort test wires the fake stream's teardown to `options.abortSignal` so no timer
leaks past suite end. No `vi.useFakeTimers()` around the real SDK (it does not advance the
SDK's internal microtasks cleanly).

## Migration Notes

None — additive tests plus doc edits. No production code, schema, or config changes.

## References

- Related research: `context/changes/testing-agent-diagnosis-under-failure/research.md`
- Source phase: `context/foundation/test-plan.md` §2 Risk #1 + Risk Response Guidance, §3 Phase 1
- LLM call boundary: `apps/api/src/modules/diagnose/diagnose.service.ts:112-118` (`streamObject`)
- Logs-timeout path: `apps/api/src/modules/diagnose/diagnose.service.ts:179-206` (`fetchLogs` `Promise.race`)
- Error taxonomy + unwrap: `apps/api/src/modules/diagnose/diagnose.errors.ts:30-58`
- Injection seam: `apps/api/src/modules/llm-provider/llm-provider.client-factory.ts:16-24` (`create`)
- Existing mapper-level spec: `apps/api/src/modules/diagnose/diagnose.service.spec.ts`
- Existing e2e spec: `apps/api/src/modules/diagnose/diagnose.controller.spec.ts`
- Synthesis schema: `libs/shared/src/lib/schemas/diagnosis-synthesis.schema.ts:11-18`
- Frame taxonomy: `libs/shared/src/lib/schemas/run-narration-event.schema.ts:10-16`
- Fake model: `ai/test` → `MockLanguageModelV3` (`node_modules/ai/dist/test/index.d.ts:53-67`)
- Lessons: config-layer tunables; explicit `@Inject` tokens (`context/foundation/lessons.md`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Cheap mapper-level gaps (seam b)

#### Automated

- [x] 1.1 Unit tests pass: `npx nx test api -- src/modules/diagnose/diagnose.service.spec.ts` — 522479e
- [x] 1.2 Lint passes: `npx nx lint api` — 522479e
- [x] 1.3 Typecheck passes (via the test build / `npx nx test api`) — 522479e
- [x] 1.4 The logs-timeout case asserts `streamObject` was not called and no run was persisted — 522479e
- [x] 1.5 The cause-unwrap case maps both `TimeoutError` and `AbortError` causes to `timeout` — 522479e

#### Manual

- [x] 1.6 The two new cases read as behavior assertions (frame `code`s), not implementation pokes — 522479e
- [x] 1.7 The logs-timeout test completes quickly (small `logsTimeoutMs`), no multi-second hang — 522479e

### Phase 2: Real-SDK gaps (seam a) + cookbook

#### Automated

- [x] 2.1 New spec passes: `npx nx test api -- src/modules/diagnose/diagnose.service.real-model.spec.ts` — 880b5a6
- [x] 2.2 Full api suite green: `npx nx test api` — 880b5a6
- [x] 2.3 Lint passes: `npx nx lint api` — 880b5a6
- [x] 2.4 The real-abort case fires the genuine `AbortSignal.timeout` and yields a single `timeout` frame within bound — 880b5a6
- [x] 2.5 The schema-rejection case produces a real `NoObjectGeneratedError` mapped to `synthesis-failed` with no raw-text leak — 880b5a6
- [x] 2.6 The new file contains no `vi.mock('ai')` (grep check) — 880b5a6

#### Manual

- [x] 2.7 The real-abort test completes in well under a second, with no leaked timer warning at suite end — 880b5a6
- [x] 2.8 The schema-rejection assertion fails if the mapper echoes raw model text (verify, then revert) — 880b5a6
- [x] 2.9 §6.2 reads as a usable recipe for the next LLM-boundary test author — 880b5a6

### Phase 3: Ledger updates

#### Automated

- [x] 3.1 `context/foundation/test-plan.md` §3 Phase 1 Status holds a valid status literal
- [x] 3.2 No test or lint regressions: `npx nx test api` && `npx nx lint api`

#### Manual

- [x] 3.3 §6.6 note accurately reflects the abort-surface finding from Phase 2's real-abort test
- [x] 3.4 The status reflects reality (`complete` only after the tests are actually merged)
