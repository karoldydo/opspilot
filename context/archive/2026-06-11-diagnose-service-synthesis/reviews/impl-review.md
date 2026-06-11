<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Diagnose a Service → 4-Field Synthesis (S-04)

- **Plan**: context/changes/diagnose-service-synthesis/plan.md
- **Scope**: Phases 1–4 of 4 (full plan)
- **Date**: 2026-06-11
- **Verdict**: REJECTED (at review time) → all findings triaged; critical fixed
- **Findings**: 1 critical, 0 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | FAIL (F1 — fixed in triage) |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS (99 tests + lint + build green) |

## Findings

### F1 — Command injection via containerName in `docker logs`

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: apps/api/src/diagnose/diagnose.service.ts:58-60
- **Detail**: `fetchLogs` interpolated `containerName` raw into `docker logs ${containerName} --tail N`, shipped over SSH to a shell. `containerName` was a bare `z.string().min(1)` (service-create-request.schema.ts:10) with no charset restriction, so shell metacharacters (`;`, `$()`, backticks, `&&`, `|`) passed validation. Realistic vector: an authenticated operator POSTs a service create with an arbitrary `containerName` (the scan path is inherently safe — docker itself enforces the legal charset on `--name`, so a scan-derived name can never contain metacharacters). Result: arbitrary shell on the host over SSH at diagnose time.
- **Fix A (applied)**: Constrain containerName at the shared-schema source + re-validate at the diagnose boundary.
  - Strength: Removes the injection class at the single source of truth; docker already restricts names to exactly this charset so no legitimate value is lost.
  - Tradeoff: Touches shared contracts + specs; a pre-existing illegal row would now fail validation (acceptable).
  - Confidence: HIGH — charset is docker-enforced; mirrors the project's validate-at-the-boundary rule.
  - Blind spot: None significant.
- **Fix B (not chosen)**: Shell-escape containerName at the command-build site only. Defense-in-depth locally, but leaves stored data unconstrained.
- **Decision**: FIXED via Fix A
  - New `containerNameSchema` (`libs/shared/src/lib/schemas/container-name.schema.ts`, regex `^[a-zA-Z0-9][a-zA-Z0-9_.-]*$`) + spec; reused in `service-create-request`, `service`, and `scan-result` schemas; barrel export added.
  - Re-validation at the shell boundary: `containerNameSchema.parse(containerName)` in `diagnose.service.ts.fetchLogs` before building the command.
  - Verified: `nx test shared/api` (100 tests), `npm run build`, `nx lint shared/api` all green.

### F2 — Log payload bounded by line count, not byte size

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: apps/api/src/diagnose/diagnose.service.ts:60
- **Detail**: `--tail <logsTailLines>` (default 200) caps line count, not bytes; very long lines can still ship a large payload to the provider. Token-cost / context-limit risk, not a correctness bug.
- **Fix**: Optionally clamp `logs` to a max byte length before buildPrompt.
- **Decision**: SKIPPED

### F3 — Dropped english "not found" stderr fallback vs sibling mapper

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: apps/api/src/diagnose/diagnose.service.ts:141
- **Detail**: `mapLogsError` keys the missing-binary case on exit 127 only; `ServiceService.mapDockerError` also has a `/not found/i` stderr fallback. Exit 127 is the robust, locale-independent signal, so the divergence is arguably an improvement.
- **Fix**: Leave as-is, or add the fallback for strict parity.
- **Decision**: SKIPPED

### F4 — Capitalized prose emphasis inside lowercase-only comments

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: apps/api/src/diagnose/diagnose.errors.ts:8, diagnose.service.ts:32, llm-provider/llm-provider.client-factory.ts:9
- **Detail**: `.claude/rules/comments.md` mandates all-lowercase inline comments. The only true violations were emphatic ALL-CAPS prose words (`NEVER`, `BEFORE`, `ON`); the remaining capitals are genuine API/type/env identifiers (`Output.object`, `NoObjectGeneratedError`, `SSH_COMMAND_TIMEOUT_MS`, …) which the repo keeps capitalized elsewhere (e.g. `service.service.ts`) and which would be wrong to lowercase.
- **Fix**: Lowercase the emphasis-caps prose words; leave genuine identifiers.
- **Decision**: FIXED (NEVER→never, BEFORE→before, ON→on; identifiers left as-is per repo convention)
