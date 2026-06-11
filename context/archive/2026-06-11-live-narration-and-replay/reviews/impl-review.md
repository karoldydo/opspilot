<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Live Narration and Replay (S-05)

- **Plan**: context/changes/live-narration-and-replay/plan.md
- **Scope**: Phases 1–4 (all)
- **Date**: 2026-06-11
- **Verdict**: APPROVED (with minor warnings)
- **Findings**: 0 critical · 1 warning · 2 observations

## Verdicts

| Dimension           | Verdict |
|---------------------|---------|
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

Every planned change landed as MATCH — no DRIFT, MISSING, or scope creep. All
"What We're NOT Doing" boundaries held (no abstraction, no re-stream replay, no
userId on the wire, no new auth/WebSocket). Re-ran automated criteria live:
api/web/shared test + lint green (105 api tests, 45 web tests), format:check
clean. SSE pre-flight 404/409, the one-transaction prune, the Date↔ISO boundary,
explicit @Inject tokens, and EventSource teardown via DestroyRef are all correct.
Verified Nest's SseStream sets `X-Accel-Buffering: no` + a no-cache `Cache-Control`
(sse-stream.js:70-77), so the Cloudflare day-1 requirement holds.

## Findings

### F1 — Unbounded `limit` on GET diagnose/runs

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Performance)
- **Location**: apps/api/src/diagnose/diagnose.controller.ts:42-45
- **Detail**: `toPositiveInt` coerced any positive integer with no upper ceiling, so `?limit=100000` flowed straight into `findRecent(...).limit(100000)`. The query is indexed and paginated, but the page size was fully caller-controlled — the credential list endpoint caps at `<=100`, this one did not.
- **Fix**: Clamp the coerced limit at the boundary (`Math.min(parsed, MAX_RUNS_LIMIT=100)`), leaving offset uncapped so deep pagination still works.
- **Decision**: FIXED

### F2 — Dead error classes from the removed batch path

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: apps/api/src/diagnose/diagnose.errors.ts:25,33
- **Detail**: `DiagnosisTimeoutError` was defined but never thrown (timeouts classified via `isSynthesisTimeout`); `DiagnosisSynthesisError` survived only in an unreachable `instanceof` branch. Both were remnants of the deleted batch synthesize().
- **Fix**: Deleted both classes, simplified the branch to `NoObjectGeneratedError.isInstance(error)` alone, and dropped the now-unused `BadGatewayException` import.
- **Decision**: FIXED

### F3 — Heartbeat interval not cleared on the abort early-returns

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: apps/api/src/diagnose/diagnose.service.ts:107-115
- **Detail**: The two `if (controller.signal.aborted) return;` branches returned without `clearInterval(heartbeat)`. No leak in practice (teardown and both terminal paths cleared it), but the invariant was spread across three sites and fragile to future edits.
- **Fix**: Wrapped the pump body in `try { … } finally { clearInterval(heartbeat) }` so a single unconditional teardown covers success, error, and the abort early-returns; removed the three scattered clears (the teardown fn keeps its own clear for immediate cleanup on unsubscribe).
- **Decision**: FIXED

## Triage Summary

- **Fixed**: F1, F2, F3
- **Skipped**: —
- **Accepted**: —
- **Post-fix verification**: `npx nx run-many -t test lint -p api --skip-nx-cache` → 105 tests pass, lint clean.
