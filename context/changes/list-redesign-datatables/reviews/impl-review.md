<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Fleet services datatable + skills/providers/audit datatables

- **Plan**: context/changes/list-redesign-datatables/plan.md
- **Scope**: Full plan — Phases 1–8 of 8
- **Date**: 2026-06-24
- **Verdict**: APPROVED
- **Findings**: 0 critical · 1 warning · 2 observations

## Automated gate (Phase 8)

| Check | Result |
|-------|--------|
| `npx nx run-many -t typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run test` (221 tests, 31 files) | PASS |
| `npm run build` | PASS |
| `npm run format:check` | PASS |

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Plan fully delivered across all 8 phases: `clientTable<T>` with a unit-tested page-reset-to-1
invariant; `status` util as single source (inline `STATUS_RANK`/`badgeClass`/`worstStatus`
duplicates deleted from every consumer); `app-synthesis-card` extracted and adopted;
`device-services.component.*` actually deleted (commit ae04321, no dangling refs); four
datatables with search + one column filter + sortable headers + client pagination; audit
keeps its expandable synthesis. Repo conventions held throughout (explicit `@Inject` tokens,
component-level store/client providers, dialog-via-context, pure no-DI `clientTable`,
lowercase comments, `Promise`-returning clients).

## Findings

### F1 — Aggregate is not user-scoped, yet Progress 2.7 claimed "cross-user isolation verified"

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: apps/api/src/modules/service/service.service.ts:80 · service-aggregate.controller.ts:16
- **Detail**: Plan (Critical Implementation Details + Phase 2 contract) required `findAllWithStatus(userId)` "scoped to user's devices", and manual criterion 2.7 "Cross-user isolation verified" was checked `[x]`. The implementation deliberately returns the whole fleet — `findAllWithStatus()` with no userId — because the device/service domain has no `userId` column (single-tenant), consistent with the existing `GET /devices`. This is documented in code comments (controller:8-10, service:75-79) and aligns with better-auth.md (flat model, no RBAC); the endpoint is still guarded by the global `AuthAppGuard`. The issue is documentation-only: the controller test verifies latest-run⇒status and no-runs⇒null, not isolation — so Progress claimed something that does not exist.
- **Fix**: Reword plan.md Progress 2.7 + the Phase 2 Manual bullet to state the single-tenant reality, consistent with the code comments. Code unchanged — behavior is correct.
- **Decision**: FIXED — reworded Progress 2.7 and the Phase 2 Manual "Cross-user isolation" bullet in plan.md to the single-tenant statement; no code change.

### F2 — Unbounded ORDER BY over run_record (no LIMIT) in findAllWithStatus

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Performance)
- **Location**: apps/api/src/modules/service/service.service.ts:83-87
- **Detail**: The query loads every `run_record` `ORDER BY created_at DESC` with no `WHERE` and no `LIMIT`, then folds latest-per-service in memory (Map, first-wins). No N+1 (exactly 2 queries), but it is the one query that scales with run history rather than service count; the `(service_id, created_at)` index can't satisfy a global `created_at` sort, so SQLite sorts the full set. Conflicts with drizzle.md ("paginate every list query … no unbounded scans"); the inline comment explicitly accepts this for homelab scale.
- **Fix**: Leave as-is (deliberately documented for homelab scale), or — if run history is expected to grow — replace the full scan with a correlated `row_number()` per `serviceId`.
- **Decision**: SKIPPED — accepted as documented for homelab dataset size.

### F3 — Unrelated file-mode change to scripts/deploy.sh in the p1 commit

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: scripts/deploy.sh (mode 100644 → 100755)
- **Detail**: Commit f48f935 (Phase 1) bundled an executable-bit change on `scripts/deploy.sh` (0 content changes), outside the plan's scope — entirely benign. (`mockups/**` and the `tsconfig.base.json` +1 are expected plan artifacts: the visual reference and the `@spartan-ng/helm/pagination` alias.)
- **Fix**: Ignore — the executable bit on the deploy script is harmless.
- **Decision**: SKIPPED — harmless, already in history.

## Triage summary

- **Fixed**: F1 (plan.md Progress 2.7 + Phase 2 Manual bullet)
- **Skipped**: F2, F3
