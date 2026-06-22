<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Diagnose Run-Step Narration

- **Plan**: context/changes/diagnose-run-step-narration/plan.md
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-06-22
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Summary

Full-plan review of the additive `step` + `progress` SSE frames across shared contract,
API emission, and web rendering. Both review agents (plan-drift + safety/quality) and a
manual read of the core files converged on the same conclusion: clean implementation, no
drift, no scope creep, correct timer lifecycle.

- **Timer lifecycle (central risk) correct** — the new `progress` interval is cleared on
  every exit path (TTFT, `finally`, error, observable teardown) and each tick is gated on
  `controller.signal.aborted`. No leak, no emit on a torn-down stream. No race with the
  pre-existing `ping` heartbeat.
- **No drift / no creep** — all planned items MATCH; none of the fictional mockup lines
  leaked; `delta`/`done`/`error`, persistence, and `durationMs` untouched; reserved `warn`
  kind ships with no emitter as planned.
- **Patterns** — `narrationTickMs` via config + Joi (`min(500).default(2000)`), explicit
  `@Inject` tokens, `z.strictObject` one-export-per-file, web `STEP_CLASS` mirrors sibling
  `BADGE_CLASS`/`DOT_CLASS`.
- **Tests assert behavior** — fake-timer test proves progress "fires then stops after first
  delta"; store test covers append/set/replace/clear/reset.
- **Refinement beyond plan** — component splits steps into `leadSteps()`/`doneStep()` so the
  closing `= done in Xs` line renders below the synthesis it summarizes (within scope).

Automated success criteria re-run green: lint, typecheck, tests (shared 138, api 212, web 72).

## Findings

### F1 — "received 1 lines (0.0 KB)" on empty logs

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: apps/api/src/modules/diagnose/diagnose.service.ts:134-137
- **Detail**: When both stdout and stderr are empty/whitespace, the filter+join yields
  `logs === ''`, and `''.split('\n').length === 1`, so the honest step reads
  "received 1 lines (0.0 KB)" for genuinely empty output (over-count + ungrammatical
  "1 lines"). No NaN/Infinity, no crash — purely cosmetic.
- **Fix**: Guard the count — `const lineCount = logs.length > 0 ? logs.split('\n').length : 0;`
- **Decision**: FIXED (Fix now)
