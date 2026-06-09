<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Account Auth Foundation (F-02)

- **Plan**: context/changes/account-auth-foundation/plan.md
- **Scope**: Phase 4 of 5 (Web Styling Stack — Tailwind v4 + spartan/ng)
- **Date**: 2026-06-09
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations
- **Commit reviewed**: b37e5b3

## Verdicts

| Dimension           | Verdict |
|---------------------|---------|
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Findings

### F1 — Unrelated paths bundled into the Phase 4 commit

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: .mcp.json, .claude/rules/spartan.md
- **Detail**: Commit b37e5b3 includes two paths unrelated to the styling stack (.mcp.json — spartan-ng MCP server; .claude/rules/spartan.md). Consciously included via the dirty-path ritual ("Stage all"). Audit-correct but widens the commit beyond its "styling stack" title.
- **Fix**: No action — conscious decision; commit already exists. Future: keep unrelated changes in a separate commit.
- **Decision**: SKIPPED

### F2 — Generator-default deps not yet referenced in source

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Versioning / Scope
- **Location**: package.json
- **Detail**: `tw-animate-css` and `luxon` are not referenced in any source (grep empty). `@angular/cdk` is a transitive peer of `@spartan-ng/brain` (load-bearing). The two unused ones are spartan generator defaults / peers staged for future primitives (e.g. date-picker).
- **Fix**: Leave; reconsider pruning if Phase 5 does not consume them.
- **Decision**: SKIPPED

### F3 — Helm primitives generated as libs/ui instead of plan's "apps/web/src/app"

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: libs/ui/**
- **Detail**: Plan text loosely said helm "under apps/web/src/app/", but the implementer (with explicit user approval) generated a single Nx library `libs/ui` (project `ui-helm`, spartan entrypoint mode, alias `@spartan-ng/helm/*`, tag `scope:web`). This is the idiomatic Nx + spartan approach and arguably superior (taggable module boundaries, lintable, matches the official entrypoint generator). web→ui boundaries hold.
- **Fix**: Documented in the plan as a Phase 4 addendum (2026-06-09) recording the libs/ui location and `@spartan-ng/helm/*` import path for Phase 5.
- **Decision**: FIXED (plan addendum)

## Success Criteria (verified 2026-06-09)

- 4.1 `nx build web` — PASS (Tailwind active; styles.css ~30–35 kB with layered imports + spartan preset + theme tokens)
- 4.2 `nx lint web` + `nx lint ui-helm` — PASS (0 errors)
- 4.3 `apps/web/.postcssrc.json` references `@tailwindcss/postcss` — PASS
- 4.4 `styles.scss` imports Tailwind; deps in `package.json` — PASS
- 4.5 Tailwind utility renders styled — PASS (user-confirmed)
- 4.6 Generated spartan helm primitive renders — PASS (user-confirmed)
