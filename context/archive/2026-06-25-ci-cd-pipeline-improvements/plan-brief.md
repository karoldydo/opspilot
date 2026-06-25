# Improve CI/CD Pipeline with Unit + E2E Test Gates — Plan Brief

> Full plan: `context/changes/ci-cd-pipeline-improvements/plan.md`
> Research: `context/changes/ci-cd-pipeline-improvements/research.md`

## What & Why

The pipeline is **deploy-only by deliberate design** — it builds and pushes a multi-arch image
to GHCR without ever testing it first (`pipeline.yml:3`). This change adds the "later" that the
deploy-plan and test-plan §5 always anticipated: quality gates (lint, format, typecheck, unit)
and an e2e gate that **block deploy** so a broken image never reaches the registry.

## Starting Point

Test infrastructure is fully wired and green — all 4 test-plan phases complete, unit suites run
via Nx (vitest/node + Angular/jsdom, no browser), and a separate Playwright `e2e` project with
isolated DB exists. **No test code changes are needed**; the work is purely authoring the CI jobs
that run the existing tests.

## Desired End State

Every push to `main` runs two new jobs — `quality` and `e2e` — before `deploy`. `deploy.needs:
[quality, e2e]`, so a red gate skips the GHCR push; `cleanup` stays behind `deploy`. Node is
pinned to 24 via `.nvmrc`, matching the Dockerfile.

## Key Decisions Made

| Decision              | Choice                          | Why (1 sentence)                                                       | Source   |
| --------------------- | ------------------------------- | --------------------------------------------------------------------- | -------- |
| Project selection     | `run-many` (whole graph)        | Small graph, no base-SHA dependency on push-to-main                    | Plan     |
| Deploy gating         | Block (`needs: [quality, e2e]`) | Image is tested before push; matches test-plan §5                      | Plan     |
| Secrets delivery      | Throwaway job-level `env:`      | No real auth provider / fresh e2e DB; no real data to protect          | Plan     |
| Web typecheck gap     | `nx build web` as type-check    | Zero new config; build is needed anyway and is a full Angular TS check | Plan     |
| Coverage              | Deferred                        | Scope is "tests + CI hygiene"; thresholds would be arbitrary now       | Research |
| E2E cold-build timing | Pre-warm `nx build api web`     | Warm build keeps webServer health well under the 120 s timeout         | Plan     |

## Scope

**In scope:** `.nvmrc` (Node 24); `quality` job (lint, format:check --all, typecheck, unit
api/shared/web, build web); `e2e` job (Chromium install, pre-warm build, Playwright suite,
report/trace artifacts); `deploy.needs: [quality, e2e]`.

**Out of scope:** any test/config changes, `nx affected`/SHA wiring, coverage gating, a new
`web:typecheck` target, a `pull_request` trigger, security scanning, Nx Cloud / `.nx/cache`
caching, real GH secrets.

## Architecture / Approach

Two self-contained jobs (`checkout → setup-node@v4 (.nvmrc, cache: npm) → npm ci → gate
commands`). The four Joi-required boot vars are supplied as a job-level `env:` block of throwaway
values — `@nestjs/config` reads `process.env` (no `envFilePath`), and the Playwright webServers'
`nx serve` child processes inherit that env, so **no `.env` file is materialized**. Phases 1–2
add the jobs non-gating; Phase 3 flips `deploy.needs` for incremental verification.

## Phases at a Glance

| Phase                       | What it delivers                                       | Key risk                                                  |
| --------------------------- | ----------------------------------------------------- | -------------------------------------------------------- |
| 1. Node pin + quality job   | `.nvmrc` + lint/format/typecheck/unit gate            | Wrong throwaway env value → api Joi fail-fast            |
| 2. E2E job                  | Chromium + pre-warm build + Playwright + artifacts    | Cold-build approaching 120 s webServer timeout           |
| 3. Gate deploy              | `deploy.needs: [quality, e2e]` + header comment       | Flaky e2e blocking an otherwise-good release             |

**Prerequisites:** push access to `main`; the existing green test suites; GitHub Actions enabled.
**Estimated effort:** ~1 session, single workflow file + `.nvmrc`, verified across a few pushes.

## Open Risks & Assumptions

- Throwaway `ENCRYPTION_KEY` must be exactly 44-char base64 and `TRUSTED_ORIGINS` must include
  `http://localhost:4200`, or boot/signup fails fast.
- `deploy` latency increases by the e2e duration (intentional trade for image safety).
- A flaky e2e run can block a deploy; `retries: CI?2:0` already mitigates, but persistent flakes
  would need attention (not addressed here).

## Success Criteria (Summary)

- A clean push runs `quality` → `e2e` → `deploy` → `cleanup`, all green, in order.
- A push with a broken lint/test fails the gate and `deploy` is **skipped** (no image pushed).
- On e2e failure, `playwright-report/` + `test-results/` artifacts upload with traces.
