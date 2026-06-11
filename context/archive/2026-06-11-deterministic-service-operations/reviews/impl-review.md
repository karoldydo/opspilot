<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Deterministic Service Operations (S-06)

- **Plan**: context/changes/deterministic-service-operations/plan.md
- **Scope**: Phases 1–3 of 3 (all complete)
- **Date**: 2026-06-12
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension           | Verdict |
|---------------------|---------|
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

Automated criteria re-verified live: lint + test + build green for shared/api/web (128 API
tests, incl. operation.service ×16, operation.controller ×6). `device-services.component.ts` =
128 lines (≤150 budget). Every "What We're NOT Doing" guardrail held (no run_record, no SSE, no
skill-table, no bulk, no mutex change, no schema retighten, no new guard). The load-bearing
security control — boundary charset re-parse on every interpolated field (containerName,
composePath, composeProject), both command branches — is correct and the regexes genuinely reject
shell metacharacters.

## Findings

### F1 — Failed-op message can be blank / contextless

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: apps/api/src/operation/operation.service.ts:96
- **Detail**: classifyExit returned bare `stderr.trim()` for any non-zero exit that isn't
  daemon-down/127. If the command exits non-zero with empty stderr (some compose failures write
  only to stdout), the failed result's message was `''` — z.string() accepts it and the UI renders
  an empty failure line (service-operations.component.html:41). Unlike the diagnose/scan siblings,
  it also carried no operation/container context. The success path already merges stdout+stderr via
  cleanOutput; the failure path did not.
- **Fix**: classifyExit now takes `operation` + `stdout`, merges stdout+stderr via cleanOutput, and
  falls back to a generic `operation <op> failed` line so a failed op never renders a blank message.
- **Decision**: FIXED (Fix now)

### F2 — Store comment describes shared provisioning, but it's per-row

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: apps/web/src/app/core/stores/service-operations.store.ts:19-21
- **Detail**: ServiceOperationsStore is provided per-row at the app-service-operations component
  (service-operations.component.ts:31), so each row gets its own single-key `entries` record. The
  class comment said "a device has many service rows sharing that store" — describing the
  diagnosis.store model (provided once at DeviceServicesComponent, shared across rows), not this
  one. No bug — state isolation holds either way — but the comment was misleading.
- **Fix**: Comment corrected to reflect per-row provisioning (single-key record; keying is
  defensive and would also hold if the provider were hoisted to a shared parent).
- **Decision**: FIXED (Fix now)
