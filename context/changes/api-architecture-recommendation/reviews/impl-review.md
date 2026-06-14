<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Restructure `apps/api` into Role Buckets

- **Plan**: context/changes/api-architecture-recommendation/plan.md
- **Scope**: Full plan (Phases 1–7 of 7)
- **Date**: 2026-06-14
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Success Criteria (re-run during review)

- `npm run format:check` — PASS
- `npx nx lint api` — PASS
- `npx nx test api` — PASS (cache)
- `npx nx build api` — PASS (cache)
- Grep gates P2–P7: no `from '../'`, no orphaned `@api/...`, no bare `@api/common/<file>`, `app/` removed, no scaffold refs — all clean.
- End-state tree matches "Desired End State": `app.module.ts · assets · common · config · core · integrations · main.ts · modules`.

## Findings

### F1 — eslint.config.mjs changed against the "No eslint changes" clause

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: eslint.config.mjs:18-24 (commit 4e77a0e, p1)
- **Detail**: Plan twice claimed (grep-verified) that `@api/*` needs NO allow-list entry and that ESLint stays untouched (Current State l.38-41; "What We're NOT Doing" l.120). Implementation added `'^@api/'` to the `@nx/enforce-module-boundaries` allow list (next to `'^@app/'`) because the alias DID trip the rule. The change is correct, minimal, and symmetric to the web migration; the divergence is plan-vs-reality, not code.
- **Fix**: Update plan (Current State + "NOT doing" + add a Phase 1 step) to reflect the required `'^@api/'` allow-list entry. Code unchanged.
- **Decision**: FIXED (plan updated in 3 places: Current State l.38-41, "NOT doing" clause, new Phase 1 step #3)

### F2 — Full parity with the web migration (positive)

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Location**: apps/api/src/** (whole migration)
- **Detail**: Clean, history-preserving relocation (`git mv` confirmed via `git log --follow` on audit.service.ts through the p1→p3→p5 rename chain). Zero logic/DI-token/route changes — the only non-move edits are import rewrites, the 2 CLI config path updates (relative, `./src/core/...`), and the planned scaffold deletion in p6. `apps/web` and `libs/shared` diffs empty. Import convention consistent (siblings `./x`, cross-folder `@api/<bucket>/...`). CLI configs correctly stayed relative (not `@api/*`) — critical since drizzle-kit / @better-auth/cli don't resolve tsconfig paths.
- **Decision**: NOTED (no action — positive observation)
