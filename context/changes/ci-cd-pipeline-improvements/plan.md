# Improve CI/CD Pipeline with Unit + E2E Test Gates Implementation Plan

## Overview

Add quality gates (lint, format:check, typecheck, unit tests) and an e2e gate to
`.github/workflows/pipeline.yml`, blocking the existing `deploy` job so a bad image
is never pushed to GHCR. Pin Node to 24 to match the Dockerfile. No test code changes —
the entire test infrastructure (4 test-plan phases, Playwright e2e harness) is already
wired and green; this change only authors the CI jobs that run it.

## Current State Analysis

`.github/workflows/pipeline.yml` is **deploy-only by deliberate design** — its header
comment says *"deploy + cleanup only (no linters/tests/security yet - those come later)"*
(`pipeline.yml:3`). Two jobs exist:

- `deploy` (`pipeline.yml:14-57`) — push-to-`main` / `workflow_dispatch`; QEMU → buildx →
  GHCR login → metadata → multi-arch `docker/build-push-action@v7`. The image is **never
  tested before push**. `actions/checkout@v5` at `:21` sets no `fetch-depth`.
- `cleanup` (`pipeline.yml:59-75`) — `needs: deploy`; manifest-aware GHCR prune.

Key facts established by research (`context/changes/ci-cd-pipeline-improvements/research.md`):

- **Test infra is fully green.** Unit tests run via Nx (`vitest`/node for `api`+`shared`,
  `@angular/build:unit-test`/jsdom for `web` — **no browser**). A separate Playwright `e2e`
  project (`tests/e2e`, Chromium only) with 4 specs + auth setup isolates its own DB.
- **Boot-time Joi validation is the single biggest CI footgun.** Any job that boots `api`
  (unit `api`, e2e) fails fast without four required env vars: `BETTER_AUTH_SECRET` (≥32),
  `ENCRYPTION_KEY` (44-char base64), `BETTER_AUTH_URL`, `TRUSTED_ORIGINS` (must include
  `http://localhost:4200`). See `apps/api/src/config/env.schema.ts:28-68`. `@nestjs/config`
  has **no `envFilePath`** → it reads `process.env`, so job-level `env:` satisfies it
  directly (no `.env` file needed). The e2e Playwright webServers spawn `nx serve` as child
  processes that **inherit** the job env.
- **Node is unpinned** (no `.nvmrc`/`engines`/`packageManager`); Dockerfile uses
  `node:24-alpine` (`Dockerfile:9,28,44`) — Node 24 is the as-built decision.
- **`web` has no `typecheck` target** — `nx run-many -t typecheck` covers only `api`+`shared`;
  web type-safety is validated only by `nx build web`.
- **Targets are plugin-inferred** (`@nx/vitest`, `@nx/eslint`, `@nx/vite`, `@nx/playwright`) —
  CI must invoke them via `nx`; there are no raw configs to call directly.
- **E2E cold-build vs 120 s webServer timeout** — `api:serve` `dependsOn:['build']`; on a cold
  runner the webpack build + web dev-server may approach the 120 s health-check timeout.

## Desired End State

`.github/workflows/pipeline.yml` runs three gating jobs on every push to `main` (and on
`workflow_dispatch`):

1. `quality` — lint, format:check, typecheck, unit tests across the whole graph (run-many).
2. `e2e` — full Playwright suite against freshly-built api+web, with report/trace artifacts.
3. `deploy` — unchanged build-and-push, but now `needs: [quality, e2e]` so it only runs when
   both gates are green. `cleanup` stays `needs: deploy`.

Verify: a push with a deliberately broken lint/test fails `quality`/`e2e` and `deploy` is
skipped; a clean push runs all gates green, then deploys, then cleans up. `.nvmrc` pins Node 24.

### Key Discoveries:

- `apps/api/src/config/env.schema.ts:28-68` — four required Joi-validated boot vars; fail-fast.
- `@nestjs/config` reads `process.env` (no `envFilePath`) → job-level `env:` is sufficient.
- `tests/e2e/playwright.config.ts:7-62` — dual webServer, inline `DATABASE_PATH` e2e DB,
  Chromium only, `retries: CI?2:0`, reporters `[['html',{open:'never'}],['list']]`,
  `timeout:120_000`. **Do not modify** — the harness already follows the isolation lesson.
- `package.json:6-28` — `test`=`nx run-many -t test` (api,shared,web), `lint`=`nx run-many -t lint`
  (5 projects), `format:check`=`nx format:check`, `e2e`=`nx e2e e2e`.
- `nx.json:77-112` — cached targets (build, lint, test, tsc); **Nx Cloud not configured**.
- `Dockerfile:9,28,44` — `node:24-alpine`.

## What We're NOT Doing

- **No test/config changes** — `playwright.config.ts`, vitest configs, specs, and the e2e DB
  isolation stay exactly as-is.
- **No `nx affected` / `nrwl/nx-set-shas`** — using `run-many` (small graph, no base-SHA dep).
- **No coverage gating** — unit tests run without `--coverage`; no thresholds this round.
- **No new `web:typecheck` target** — `nx build web` is web's type-check.
- **No `pull_request` trigger** — gates run on push-to-`main` (the repo's commit model). Adding
  a PR trigger is an easy future follow-up, out of scope here.
- **No security scanning** — explicitly deferred per the locked research scope.
- **No `.nx/cache` `actions/cache` step** — Nx Cloud is off; local cache warming is a future
  optimization, not required for correctness.
- **No real GH Actions secrets** — throwaway CI values (no real auth provider, fresh e2e DB).
- **No deploy-job logic changes** beyond adding `needs:`.

## Implementation Approach

Two new jobs (`quality`, `e2e`) authored in `pipeline.yml`, each self-contained
(checkout → setup-node@v4 with `node-version-file: .nvmrc` + `cache: npm` → `npm ci` → gate
commands). Throwaway boot env supplied via a job-level `env:` block on the jobs that boot `api`.
Node pinned via a new `.nvmrc`. Finally `deploy.needs: [quality, e2e]` wires the gate. Phases
1–2 add the jobs (initially non-gating); phase 3 flips the `needs:` so the change is verifiable
incrementally.

## Critical Implementation Details

- **Throwaway env values must satisfy Joi exactly.** `ENCRYPTION_KEY` must be **44-char base64**
  decoding to 32 bytes (e.g. generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`);
  `BETTER_AUTH_SECRET` ≥32 chars; `TRUSTED_ORIGINS` **must include** `http://localhost:4200` or
  the Better Auth signup in the e2e `setup` project is origin-rejected. A single wrong value →
  api fail-fast → webServer never healthy → e2e times out at 120 s.
- **Pre-warm ordering in the e2e job.** Run `nx run-many -t build -p api web` **before**
  `nx e2e e2e`. `api:serve` `dependsOn:['build']`, so a warm build makes the webServer pass its
  health check well under the 120 s timeout. The build is also web's only type-check.
- **Artifact upload must be `if: always()`** — traces/screenshots/videos only exist on failure,
  and they are exactly what's needed when e2e is red.

## Phase 1: Node Pin + Quality-Gates Job

### Overview

Add `.nvmrc` (Node 24) and a `quality` job that runs lint, format:check, typecheck, and unit
tests across the whole graph. The job exists and runs but does **not** yet gate `deploy`
(wired in Phase 3).

### Changes Required:

#### 1. Node version pin

**File**: `.nvmrc` (new)

**Intent**: Pin Node 24 to match the Dockerfile so CI and the container agree on the runtime.

**Contract**: File contains exactly `24` (single line). Consumed by `actions/setup-node` via
`node-version-file`.

#### 2. Quality job

**File**: `.github/workflows/pipeline.yml`

**Intent**: Add a `quality` job running the cheap-to-expensive gate stack on the whole graph.
Boot env vars supplied as job-level `env:` (throwaway) because `nx test api` boots the api
config/Joi validation.

**Contract**: New job `quality` (runs-on `ubuntu-latest`, `permissions: contents: read`),
triggered by the existing `on:` (push-to-`main` + `workflow_dispatch`). Steps in order:
`actions/checkout@v5` → `actions/setup-node@v4` (`node-version-file: .nvmrc`, `cache: npm`) →
`npm ci` → `npx nx run-many -t lint` → `npx nx format:check --all` →
`npx nx run-many -t typecheck` (api+shared) → `npx nx run-many -t test --projects=api,shared,web` →
`npx nx build web` (web's type-check). Job-level `env:` block sets the four throwaway boot vars
(`BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`, `BETTER_AUTH_URL=http://localhost:3000`,
`TRUSTED_ORIGINS=http://localhost:3000,http://localhost:4200`) plus `CI: true`.

### Success Criteria:

#### Automated Verification:

- Workflow YAML is valid: `npx --yes @action-validator/cli .github/workflows/pipeline.yml` (or `actionlint`)
- Local dry-run of the gate commands passes: `npx nx run-many -t lint && npx nx format:check --all && npx nx run-many -t typecheck && npx nx run-many -t test --projects=api,shared,web && npx nx build web` (with the four env vars exported)
- `.nvmrc` exists and contains `24`: `cat .nvmrc`

#### Manual Verification:

- Pushing a commit triggers the `quality` job in GitHub Actions and it completes green
- A deliberately broken lint/format/test makes the `quality` job fail (red), proving the gate works
- The job logs show `nx test api` booting without the Joi fail-fast error (env vars accepted)

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before
proceeding to the next phase.

---

## Phase 2: E2E Job

### Overview

Add an `e2e` job that installs Chromium, pre-warms the api+web builds, runs the Playwright
suite, and uploads reports/traces. Like `quality`, it runs but does not yet gate `deploy`.

### Changes Required:

#### 1. E2E job

**File**: `.github/workflows/pipeline.yml`

**Intent**: Add an `e2e` job running the full Playwright suite against freshly-built
api+web, with the same throwaway boot env (inherited by the `nx serve` child processes the
Playwright webServers spawn). Pre-warm builds so the 120 s webServer health-check timeout is
comfortable on a cold runner.

**Contract**: New job `e2e` (runs-on `ubuntu-latest`, `permissions: contents: read`),
same `on:` triggers. Steps: `actions/checkout@v5` → `actions/setup-node@v4`
(`node-version-file: .nvmrc`, `cache: npm`) → `npm ci` →
`npx playwright install --with-deps chromium` → `npx nx run-many -t build -p api web`
(pre-warm) → `npx nx e2e e2e` → `actions/upload-artifact@v4` (paths `playwright-report/` and
`test-results/`, `if: always()`). Job-level `env:` block identical to Phase 1 (four throwaway
boot vars + `CI: true`); `TRUSTED_ORIGINS` must include `http://localhost:4200`.

### Success Criteria:

#### Automated Verification:

- Workflow YAML is valid: `actionlint .github/workflows/pipeline.yml`
- Local e2e dry-run passes with the env vars exported: `npx nx run-many -t build -p api web && npx nx e2e e2e`

#### Manual Verification:

- The `e2e` job runs in GitHub Actions and the full Playwright suite passes green
- The webServers reach health within the 120 s timeout (no e2e timeout in logs)
- On a forced e2e failure, the `playwright-report/` + `test-results/` artifacts upload and contain traces/screenshots
- The `setup` project signs up successfully (TRUSTED_ORIGINS accepted, no origin rejection)

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before
proceeding to the next phase.

---

## Phase 3: Gate Deploy on Green

### Overview

Wire `deploy.needs: [quality, e2e]` so the image is only built/pushed when both gates pass,
and refresh the header comment that currently says the pipeline is deploy-only.

### Changes Required:

#### 1. Block deploy behind the gates

**File**: `.github/workflows/pipeline.yml`

**Intent**: Make `deploy` depend on both new jobs so a red gate skips the push to GHCR.
`cleanup` already `needs: deploy`, so it transitively waits too.

**Contract**: Add `needs: [quality, e2e]` to the `deploy` job. Update the file header comment
(`pipeline.yml:3`) to reflect that the pipeline now runs quality + e2e gates before deploy.
No change to `cleanup`.

### Success Criteria:

#### Automated Verification:

- Workflow YAML is valid: `actionlint .github/workflows/pipeline.yml`
- `deploy` declares `needs: [quality, e2e]`: `grep -A1 'deploy:' .github/workflows/pipeline.yml`

#### Manual Verification:

- A clean push runs `quality` + `e2e` green, then `deploy`, then `cleanup` (correct ordering in the Actions graph)
- A push with a broken test fails the gate and `deploy` is **skipped** (image not pushed to GHCR)
- GHCR shows the new image only for green pushes

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- No new unit tests — this change adds CI orchestration, not application code.
- The gate itself is validated by running the existing suites (`api`, `shared`, `web`) in CI.

### Integration Tests:

- The `e2e` job IS the integration/end-to-end test surface (full api+web boot + Playwright).

### Manual Testing Steps:

1. Push a clean commit; confirm `quality` → `e2e` → `deploy` → `cleanup` all green in order.
2. Push a commit with a deliberate lint error; confirm `quality` red and `deploy` skipped.
3. Push a commit with a deliberate e2e failure; confirm `e2e` red, artifacts uploaded, `deploy` skipped.
4. Inspect a green run's logs to confirm api boots without Joi fail-fast (env vars accepted).

## Performance Considerations

- `run-many` rebuilds the whole graph (5 projects), but the graph is small; Nx local cache
  within a job warms repeated targets. Nx Cloud is off, so cross-run caching is not available
  (acceptable; future optimization).
- Pre-warming `nx build api web` in the e2e job adds a build step but prevents 120 s webServer
  timeouts on cold runners; the build is also web's type-check, so it is not pure overhead.
- `deploy` now waits for `e2e` (~a few minutes) before pushing — an intentional trade of deploy
  latency for image safety.

## Migration Notes

- `.nvmrc` is additive; no existing tooling reads it today, so adding it is non-breaking.
- Throwaway CI env values are non-production and tied to a fresh e2e DB; they grant no access
  to real data and can be rotated freely.

## References

- Related research: `context/changes/ci-cd-pipeline-improvements/research.md`
- Current pipeline: `.github/workflows/pipeline.yml:1-75`
- Boot env schema: `apps/api/src/config/env.schema.ts:28-68`
- E2E harness: `tests/e2e/playwright.config.ts:7-62`
- Quality gates spec: `context/foundation/test-plan.md:124-136` (§5)
- Phase-2 deferral: `context/deployment/deploy-plan.md:67-86`
- Env-for-tests lesson: memory `nx-loads-root-env-for-tests`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Node Pin + Quality-Gates Job

#### Automated

- [x] 1.1 Workflow YAML is valid (actionlint / action-validator) — 55c4e15
- [x] 1.2 Local dry-run of gate commands passes with env vars exported — 55c4e15
- [x] 1.3 `.nvmrc` exists and contains `24` — 55c4e15

#### Manual

- [x] 1.4 Pushing a commit triggers the `quality` job and it completes green — 55c4e15
- [x] 1.5 A deliberately broken lint/format/test makes `quality` fail — 55c4e15
- [x] 1.6 Job logs show `nx test api` booting without Joi fail-fast — 55c4e15

### Phase 2: E2E Job

#### Automated

- [x] 2.1 Workflow YAML is valid (actionlint)
- [x] 2.2 Local e2e dry-run passes (build api web → nx e2e e2e) with env vars exported

#### Manual

- [ ] 2.3 The `e2e` job runs in GitHub Actions and the suite passes green
- [ ] 2.4 webServers reach health within the 120 s timeout (no e2e timeout)
- [ ] 2.5 On forced e2e failure, report + test-results artifacts upload with traces
- [ ] 2.6 The `setup` project signs up (TRUSTED_ORIGINS accepted)

### Phase 3: Gate Deploy on Green

#### Automated

- [ ] 3.1 Workflow YAML is valid (actionlint)
- [ ] 3.2 `deploy` declares `needs: [quality, e2e]`

#### Manual

- [ ] 3.3 Clean push runs quality → e2e → deploy → cleanup in order
- [ ] 3.4 Push with broken test fails gate and `deploy` is skipped (no image pushed)
- [ ] 3.5 GHCR shows new image only for green pushes
