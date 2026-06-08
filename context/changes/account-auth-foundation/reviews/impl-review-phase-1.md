<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Account Auth Foundation (F-02)

- **Plan**: context/changes/account-auth-foundation/plan.md
- **Scope**: Phase 1 of 5 (Backend — Better Auth Integration)
- **Date**: 2026-06-08
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 1 observation
- **Phase 1 commit**: 3291d7a

## Verdicts

| Dimension           | Verdict |
|---------------------|---------|
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

All 8 planned Phase 1 changes verified MATCH (deps, config+env, schema barrel, migration,
auth provider, auth slice, raw body, deployment-assumption docs). No drift, missing, or
safety defects. Automated criteria (typecheck/lint/build) green; manual 1.6–1.9 verified
(sign-up/sign-in/get-session round-trip, SQLite tables, secret fail-fast, no double prefix).

## Findings

### F1 — Phase 1 commit bundles unrelated tooling/docs

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: commit 3291d7a (.claude/skills/*, .10x-cli-manifest.json, CLAUDE.md)
- **Detail**: Commit 3291d7a bundles 13 unrelated tooling/doc paths alongside the F-02 code,
  staged deliberately at the user's request ("Dodaj wszystko"). Harmless to the implementation
  but mixes scopes in history.
- **Fix**: Conscious decision — no action. Future: keep phase commits to phase files only;
  route tooling/doc churn to a separate chore(config)/docs commit.
- **Decision**: SKIPPED

### F2 — express v4 in deps while runtime is express v5 (Nest)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency / Reliability
- **Location**: package.json:42 (express ^4.21.2), :82 (@types/express ^4.17.21)
- **Detail**: @nestjs/platform-express@11 runs express 5.2.1 (nested), but the repo pinned a
  direct express ^4 + @types/express ^4. Controller Request/Response types were typed against
  v4 while the runtime was v5. Pre-existing from the scaffold; surfaced by the new auth controller.
- **Fix A ⭐ (applied)**: Bump express→^5 and @types/express→^5 so deps declare the actual runtime.
  - Strength: types align with runtime; single express; removes the drift.
  - Tradeoff: major bump — required re-running build/lint/typecheck.
  - Confidence: MED — Nest already ran v5, so runtime absorbs it cleanly.
  - Result: express ^5.2.1, @types/express ^5.0.6; typecheck/lint/build green (fresh, no cache).
- **Fix B**: Drop the direct express dep, let platform-express own it (+ @types/express→v5).
- **Decision**: FIXED via Fix A

### F3 — main.ts reads PORT by raw key instead of a namespace

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: apps/api/src/main.ts:15
- **Detail**: `app.get(ConfigService).get<number>('PORT', 3000)` is a raw read. nestjs.md
  explicitly sanctions reading PORT in main.ts via ConfigService, and no PORT namespace exists.
  Pre-existing; untouched by F-02.
- **Fix**: No action — compliant with the rule.
- **Decision**: SKIPPED
