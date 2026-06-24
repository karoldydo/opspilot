<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Playwright E2E Bootstrap

- **Plan**: context/changes/testing-playwright-bootstrap/plan.md
- **Scope**: Full plan (Phase 1–2 of 2)
- **Date**: 2026-06-25
- **Verdict**: APPROVED (one warning, fixed during triage)
- **Findings**: 0 critical, 1 warning, 2 observations — all resolved

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING (F1, fixed) |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Plan Adherence is a full MATCH across both phases. The four implementation
deviations from the plan's literal config (inline env on the api command,
`cwd: rootDir` on both webServers, absolute `__dirname`-anchored storageState,
heading-based smoke locator) were each the correct call — three are strictly
required to satisfy the plan's own isolation success criterion 2.4.

## Findings

### F1 — reuseExistingServer:!CI on the api server can route local runs at the dev db

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (data safety)
- **Location**: tests/e2e/playwright.config.ts:47
- **Detail**: With `reuseExistingServer: !process.env.CI`, if a dev `npm run start:api`
  is already on :3000 (dev db, since `DATABASE_PATH` is commented out in `.env` and
  defaults to `./data/opspilot.db`), Playwright reuses it instead of booting the
  isolated `DATABASE_PATH=./data/opspilot.e2e.db` process. The signup setup then writes
  `e2e+<ts>@opspilot.local` users into the dev db, silently defeating the isolation the
  config promises (line 9) and success criterion 2.4. This actually occurred during this
  session (3 leaked users, since cleaned up).
- **Fix A ⭐ (applied)**: Set `reuseExistingServer: false` on the api webServer only.
  Isolation becomes unconditional; a port clash with a running dev api now fails loudly
  ("port in use") instead of silently reusing the dev-db server. Web server reuse kept.
  - Tradeoff: the api boots fresh each local run (~seconds); can't attach to a running dev api.
  - Confidence: HIGH — standard, unambiguous Playwright switch.
- **Fix B (not chosen)**: dedicated e2e api port (PORT=3001 + separate proxy/baseURL).
- **Decision**: FIXED via Fix A (reuseExistingServer: false on api, comments updated).

### F2 — Leftover empty directories tests/e2e/tests/ and tests/e2e/data/

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: tests/e2e/tests/, tests/e2e/data/
- **Detail**: Empty residue from pre-fix cwd/nesting-bug runs. Untracked, uncommitted, harmless.
- **Fix**: rmdir both empty directories.
- **Decision**: FIXED (both directories removed).

### F3 — Opaque failure message on signup/get-session in auth.setup.ts

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability)
- **Location**: tests/e2e/specs/auth.setup.ts:17
- **Detail**: `expect(response.ok()).toBeTruthy()` hides the server status/body on failure,
  making first-run debugging (e.g. a 422 password-policy error) harder. The flow otherwise
  correctly waits on real state (no timeouts) and genuinely proves authentication.
- **Fix**: Pass the response body as the assertion message for both signup and get-session.
- **Decision**: FIXED (`expect(response.ok(), await response.text()).toBeTruthy()`).

## Notes

- Reusing the shared auth Zod schemas (`authRegisterRequestSchema`, `authUserSchema`) in the
  specs was assessed by both review agents as over-engineering at bootstrap scale and correctly
  skipped — `contracts.md` governs FE↔BE app types, not a one-field test fixture assertion.
- The hardcoded test-only fallback password (`e2e-passw0rd`, env-overridable) is acceptable,
  idiomatic E2E practice for an ephemeral per-run user against a disposable database.
- "What We're NOT Doing" guardrails all respected: no diagnoseLogs/SSE tests, no CI workflow,
  no seed.spec.ts / e2e rules file, Chromium only.
