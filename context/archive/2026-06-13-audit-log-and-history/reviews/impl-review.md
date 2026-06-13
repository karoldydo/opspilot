<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Audit Log + Linked History (S-09 / FR-011)

- **Plan**: context/changes/audit-log-and-history/plan.md
- **Scope**: Full plan (Phases 1–4 of 4)
- **Date**: 2026-06-14
- **Verdict**: NEEDS ATTENTION (all findings now triaged)
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS (cosmetic drift only) |
| Scope Discipline | PASS |
| Safety & Quality | WARNING (2 findings) |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS (1 observation) |

Live verification (at review time): api 179 tests ✓ · web 68 tests ✓ · lint ✓ · build api ✓ · build web ✓ · db:generate → "no schema changes" ✓. After triage fixes: api 181 tests ✓ · typecheck shared ✓ · lint api ✓ · db:generate clean ✓.

## Findings

### F1 — Tier-2 audit insert can mask a successful side-effect op

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: skill-run.service.ts:82, service.service.ts:63, diagnose.service.ts:137
- **Detail**: Tier-2 ops call `auditService.record(...)` on the base connection AFTER the real work (SSH command / scan / run persist) has already succeeded, with no try/catch. If the audit insert throws (e.g. DB locked), it propagates and the caller sees a 500 for an action that actually ran. The code documented the inverse case (a failed op leaves no row) but not this direction. For diagnose, the failure surfaced as an in-stream error frame after the run already persisted.
- **Fix A ⭐ Recommended**: Wrap each Tier-2 post-success `record()` in a try/catch that logs and swallows the audit error.
  - Strength: A successful op never gets reported as a failure; matches the plan's own posture that Tier-2 has "no atomic-with-effect guarantee" — audit is best-effort.
  - Tradeoff: A dropped audit row is silent (only in logs); the timeline can miss a Tier-2 event under DB contention.
  - Confidence: HIGH — better-sqlite3 is synchronous and these inserts are trivial; failure is rare and logging is sufficient.
  - Blind spot: Whether ops want a hard guarantee that every executed op is auditable.
- **Fix B**: Document the current fail-loud behavior as intentional.
  - Strength: Zero code change; keeps audit-write failures loud.
  - Tradeoff: Leaves a successful op surfacing as a 500/error frame.
  - Confidence: MED — acceptable only if audit completeness is valued over op-success fidelity.
  - Blind spot: User-facing impact of a 500 on an op that succeeded.
- **Decision**: FIXED via Fix A — added `AuditService.recordOnInvocation()` (log-and-swallow), switched the three Tier-2 call sites to it; `record(input, tx)` stays hard-failing for Tier-1. Added 2 unit tests (write + swallow); updated skill-run/diagnose specs to `recordOnInvocation`.

### F2 — @CurrentUserId() typed string but returns string | undefined

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: common/current-user-id.decorator.ts:9
- **Detail**: The decorator resolves `req.session?.user.id` → `string | undefined`, but every consumer types the param as `userId: string` and `audit_log.userId` is NOT NULL. The global guard makes it non-null on guarded routes today, but if any audit-recording route were ever marked `@Public`, `record()` would attempt a NOT NULL insert of undefined — a Tier-1 in-transaction throw or a Tier-2 crash.
- **Fix**: Have `AuditService.record()` guard a missing userId with a clear thrown error (fail fast with context, not a raw constraint violation).
- **Decision**: FIXED — `record()` throws `cannot record <action> audit row: missing userId` when `userId` is falsy. For Tier-2 the throw is caught/logged by `recordOnInvocation`; for Tier-1 it propagates and rolls back.

### F3 — audit_log.userId FK is no-action while run_record.userId is set-null

- **Severity**: 📝 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: database/schema/audit-log.schema.ts:30, migrations/0007:11
- **Detail**: `audit_log.userId` FK uses the drizzle default ON DELETE no action, diverging from `run_record.userId`'s set null. The divergence was undocumented. NOTE during triage: `set null` is incompatible with this NOT NULL column (run_record's column is nullable) — aligning literally would require making userId nullable and losing attribution, which contradicts the design.
- **Fix**: Confirm intent and add a one-line comment noting no-action is deliberate (preserve attribution), since the audit log is retained indefinitely.
- **Decision**: FIXED — kept `no action` and documented it on the column (every audit row is attributed; deleting a user with audit rows is blocked rather than orphaning them; `set null` would conflict with NOT NULL). No migration needed.

### F4 — Provider audit metadata uses {kind,model}, plan said {providerId,label}

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: llm-provider.service.ts:57,102,125
- **Detail**: Plan specified llmProvider audit metadata `{providerId, label}`; implementation stores `{kind, model}`. Still strictly secret-free. NOTE during triage: the provider model has no `label` column, and `providerId` would duplicate `targetId` — so the plan's keys were inaccurate and `{kind, model}` is the faithful, more useful secret-free choice.
- **Fix**: Accept as-is (functionally equivalent, secret-free).
- **Decision**: ACCEPTED — no change; plan was inaccurate, `{kind, model}` retained.

### F5 — AuditModule omits the planned json() body-parser re-apply

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: audit/audit.module.ts
- **Detail**: Plan said AuditModule should re-apply `json()` via `configure(consumer)` (global body parser is off for the better-auth catch-all). Implementation drops it with a comment noting the only route is a body-less GET /api/audit. Sensible deviation.
- **Fix**: None needed now. If a body-carrying route is added to AuditModule later, re-introduce the json() middleware.
- **Decision**: ACCEPTED — no change; deviation is correct for a GET-only module.

### F6 — Success-criterion `npx nx build shared` has no such target

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: plan.md:226 (Phase 1 automated criteria)
- **Detail**: `npx nx build shared` errors "Cannot find configuration for task shared:build". The shared lib has no build target; it's consumed via the `@opspilot/shared` path alias and bundled transitively (api + web builds both pass). The criterion was never runnable as written, yet was checked [x].
- **Fix**: Drop the `build shared` criterion (or replace with a real target).
- **Decision**: FIXED — plan.md criterion 1.3 changed to `npx nx typecheck shared` (a real target), in both the Phase 1 criteria list and the Progress checkbox.
