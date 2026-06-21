<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Web Terminal Design System

- **Plan**: context/changes/web-terminal-design-system/plan.md
- **Scope**: All 6 phases (full plan)
- **Date**: 2026-06-21
- **Verdict**: NEEDS ATTENTION (all findings triaged — 3 fixed, 1 skipped)
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Automated success criteria re-run at review time: `npm run build` (web + api) ✅, `npm run lint` (4 projects) ✅, `npm run test` (208 tests) ✅, `npm run format:check` ✅.

## Findings

### F1 — Unbounded audit_log scan with no covering index

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (performance)
- **Location**: apps/api/src/modules/overview/overview.service.ts:51-57 (mirror at :35-41 for run_record)
- **Detail**: skillRuns24h() filters audit_log on (userId, action='skill.run', createdAt >= cutoff) with no .limit(), but audit-log.schema.ts:37-42 declares only single-column indexes (created_idx, user_idx). SQLite picks one and filters the rest in memory. audit_log is retained indefinitely, so this degrades to a per-user scan on every overview load. drizzle.md: "index every column used in a where… no unbounded scans." avgDiagnoseMs (:35-41) has the same shape on run_record.
- **Fix**: Add composite index (userId, action, createdAt) to audit_log and (userId, createdAt) to run_record via an additive drizzle-kit migration.
  - Strength: Satisfies drizzle.md; keeps overview O(window) not O(table) as the audit log grows.
  - Tradeoff: One more migration + two index writes; negligible at homelab scale today.
  - Confidence: HIGH — where-clause and index DDL both verified in-file.
  - Blind spot: None significant.
- **Decision**: FIXED — added `audit_log_user_action_created_idx` and `run_record_user_created_idx` to the schemas; generated migration `0009_naive_magik.sql` (two additive CREATE INDEX).

### F2 — Unguarded JSON.parse on audit metadata can 500 the tile

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability)
- **Location**: apps/api/src/modules/overview/overview.service.ts:66
- **Detail**: JSON.parse(row.metadata) runs inside .filter() with no try/catch. A single malformed metadata blob (rows can predate the current shape; audit-log.schema.ts:22 calls metadata an "opaque blob, never queried into") throws and the whole /api/overview/metrics endpoint 500s. The web sibling reads metadata defensively; the service did not.
- **Fix**: Wrap the parse in try/catch and treat a parse failure as "not succeeded".
- **Decision**: FIXED — parse wrapped in try/catch; a parse failure counts as not-succeeded rather than throwing.

### F3 — Window tunables hardcoded as module consts

- **Severity**: ⚪ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: apps/api/src/modules/overview/overview.service.ts:10-11
- **Detail**: SKILL_RUNS_WINDOW_MS (24h) and AVG_DIAGNOSE_WINDOW_MS (7d) were module-level consts — exactly the class lessons.md flags ("operational tunables belong in the @nestjs/config layer"). Siblings comply (RunRecordService reads config.historyRetention, DiagnoseService reads config.generateTimeoutMs).
- **Fix**: Move both into an overviewConfig registerAs() + Joi-bounded env vars, inject via ConfigService.
- **Decision**: FIXED — added `OVERVIEW_SKILL_RUNS_WINDOW_MS` / `OVERVIEW_AVG_DIAGNOSE_WINDOW_MS` to env.schema.ts (Joi, min 60000, defaulted 24h/7d), new `config/overview.config.ts` namespace registered in config.module.ts, injected into OverviewService via explicit `@Inject(overviewConfig.KEY)`.

### F4 — Unrelated change-scaffold swept into the p6 commit

- **Severity**: ⚪ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: context/changes/diagnose-run-step-narration/change.md (added in commit 869c095, the p6 commit)
- **Detail**: A /10x-new scaffold for a separate future change ("Stream real-time agent run-step narration") was committed inside the diagnose-hero p6 commit. Valid pending change-folder, not code, not part of this plan — pure commit-hygiene noise, no functional impact.
- **Fix**: Leave as-is — it's a legitimate follow-up scaffold.
- **Decision**: SKIPPED — left as-is per user.
