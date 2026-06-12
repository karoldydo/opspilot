<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Per-device agent context (FR-005 / S-07)

- **Plan**: context/changes/per-device-agent-context/plan.md
- **Scope**: All phases (1–3 of 3)
- **Date**: 2026-06-13
- **Verdict**: APPROVED
- **Findings**: 0 critical · 0 warnings · 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Success Criteria — verified live

| Check | Result |
|-------|--------|
| `npx nx test shared` | ✅ pass |
| `npx nx test api` (device + diagnose specs) | ✅ pass |
| `npx nx test web` | ✅ pass |
| `npm run lint` (4 projects) | ✅ pass |
| `npm run format:check` | ✅ pass |
| `npx nx typecheck api` / `shared` | ✅ pass |
| migration `0005_broken_moira_mactaggert.sql` | ✅ present, drizzle-generated |

Manual criteria (1.5–1.7, 2.4–2.6, 3.5–3.8) are marked `[x]` in Progress. The
behaviours they assert (persist/round-trip, `system` injection, empty→no-regression,
>4000-char block) are each mirrored by an automated test, so the checks are
evidence-backed, not rubber-stamped.

## Plan adherence

All 9 planned changes plus both load-bearing critical details — the empty-context
`system` guard (`diagnose.service.ts:108,114`) and the web blank→null normalization
(`device-form.dialog.ts:108,122`) — verified as **MATCH**. No DRIFT, MISSING, or
EXTRA changes. Spec-file touches (`device.controller.spec.ts`, `diagnose.controller.spec.ts`,
`devices.store.spec.ts`) are fixture updates carrying `agentContext: null` — expected,
not scope creep.

## Findings

### F1 — agentContext is trusted-operator free text used as LLM `system`

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: apps/api/src/diagnose/diagnose.service.ts:108-115
- **Detail**: The field is passed verbatim as the AI SDK `system` parameter — operator-authored prompt steering. Acceptable under OpsPilot's single-tenant, flat-auth trust model (the author and the diagnosis runner are the same trusted operator; no privilege boundary is crossed). This is the intended steering mechanism, not third-party data. Revisit only if a multi-user / role model ever lands.
- **Fix**: None now. Optionally leave a one-line code comment marking it as trusted-operator input so a future auth change flags this.
- **Decision**: SKIPPED

### F2 — Update projection relies on drizzle's "ignore undefined in .set()"

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: apps/api/src/device/device.service.ts:39
- **Detail**: `update.set` sets `agentContext: input.agentContext` unconditionally; correctness of "omitted field stays untouched, explicit null clears" hinges on drizzle's undefined-skip semantics, documented only by an inline comment. Explicitly covered for all three cases in `device.service.spec.ts:104-127` (sent / omitted-untouched / null-clears). Behaviour is sound.
- **Fix**: None — the test matrix locks the behaviour. No change recommended.
- **Decision**: SKIPPED
