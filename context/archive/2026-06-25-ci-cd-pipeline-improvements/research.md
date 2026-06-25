---
date: 2026-06-25T21:57:49+02:00
researcher: Karol Dydo
git_commit: 55e636880a52bdd2d458f4645127a3c7f1ed25e4
branch: main
repository: opspilot
topic: "Improve CI/CD pipeline with unit + e2e test gates and CI hygiene"
tags: [research, codebase, ci-cd, github-actions, nx, vitest, playwright, e2e]
status: complete
last_updated: 2026-06-25
last_updated_by: Karol Dydo
---

# Research: Improve CI/CD pipeline with unit + e2e test gates and CI hygiene

**Date**: 2026-06-25T21:57:49+02:00
**Researcher**: Karol Dydo
**Git Commit**: 55e636880a52bdd2d458f4645127a3c7f1ed25e4
**Branch**: main
**Repository**: opspilot

## Research Question

Improve `.github/workflows/pipeline.yml` — add unit-test and e2e-test gates plus
CI hygiene (lint, format:check, typecheck, nx affected/cache) to the GitHub Actions
pipeline. Scope locked with the user: **tests + CI hygiene** (no security scanning
this round). Depth: **plan-ready**.

## Summary

The current pipeline is **deploy-only by deliberate design** — its own header comment
says *"deploy + cleanup only (no linters/tests/security yet - those come later)"*
(`.github/workflows/pipeline.yml:3`). This change is exactly the "later" that
`context/deployment/deploy-plan.md` (Phase 2) and `context/foundation/test-plan.md`
(§5 Quality Gates) already anticipated.

The **test infrastructure is fully wired and green**: all 4 phases of the test-plan
rollout are complete as of 2026-06-25. Unit tests run via Nx (`vitest` for `api`/`shared`,
`@angular/build:unit-test` on jsdom for `web` — **no browser needed**), and a dedicated
Playwright `e2e` project (`tests/e2e`) with 4 specs + auth setup already isolates its DB
correctly. Nothing about the test code needs to change; the work is **authoring the CI
jobs that run it**.

The hard parts are all in the **CI environment**, not the tests:

1. **Node is unpinned** — no `.nvmrc`/`engines`/`packageManager`. Dockerfile uses
   `node:24-alpine`; CI should pin Node 24 with `setup-node` + `npm ci`.
2. **`api` unit tests + the e2e api boot both need a root `.env`** (git-ignored) — four
   required Joi-validated vars (`BETTER_AUTH_SECRET` ≥32, `ENCRYPTION_KEY` 44-char base64,
   `BETTER_AUTH_URL`, `TRUSTED_ORIGINS` incl. `http://localhost:4200`). Missing any → fail
   fast at boot. Two are real secrets.
3. **`nx affected` needs `fetch-depth: 0`** + an explicit base/head (no `defaultBase`, no
   `nrwl/nx-set-shas` wired). For a simpler first cut, run-many is base-independent.
4. **`web` has no `typecheck` target** — `nx run-many -t typecheck` silently covers only
   `api`+`shared`; web type-safety is validated only by `nx build web`.
5. **E2E in CI** needs `npx playwright install --with-deps chromium`, the 120 s webServer
   timeout vs. cold builds, and artifact upload of `playwright-report/` + `test-results/`.
6. **No external LLM/SSH deps** — intentionally absent; e2e specs run with no active LLM
   provider by design. Nothing to stub.

## Detailed Findings

### Current pipeline (the thing being improved)

`.github/workflows/pipeline.yml` — two jobs, **no gates today**:

- `deploy` (`pipeline.yml:14-57`) — `push` to `main` or `workflow_dispatch`; QEMU →
  buildx → GHCR login → metadata → multi-arch `docker/build-push-action@v7`
  (`linux/amd64,linux/arm64`, GHA cache). The image is **never tested before push**.
- `cleanup` (`pipeline.yml:59-75`) — `needs: deploy`; `dataaxiom/ghcr-cleanup-action@v1`,
  manifest-aware (safe for multi-arch), keeps 5 tagged + `latest`.
- `actions/checkout@v5` at `pipeline.yml:21` sets **no `fetch-depth`** (defaults to depth 1).
- **No other workflows** exist under `.github/workflows/` — no test/lint CI, no dependabot.

### Unit tests — how each project runs

Root scripts (`package.json:6-28`):

```
"test":         "nx run-many -t test"          # covers api, shared, web
"lint":         "nx run-many -t lint"          # 5 projects (incl. e2e, ui-helm)
"format:check": "nx format:check"
"pre-commit":   "lint-staged --relative && nx run-many -t typecheck"   # api+shared only
"affected:test":"nx affected -t test"
"e2e":          "nx e2e e2e"
```

- **`api` / `shared`** — Vitest, target synthesized by `@nx/vitest` plugin
  (`nx.json:53-58`). Config: `apps/api/vitest.config.mts` + `libs/shared/vitest.config.mts`
  (identical), `watch:false` (single-run, CI-safe), `environment:'node'`, coverage provider
  `v8` **off unless `--coverage` is passed**. 31 specs each. **No browser.**
- **`web`** — `@angular/build:unit-test` (`apps/web/project.json:77-82`), `watch:false`,
  runs on **jsdom** (`jsdom` is a devDependency) — **no Chromium required**. 24 specs.
- **Gotcha (confirmed):** `api` specs that bootstrap config/auth need the root `.env`,
  which Nx auto-loads. `.env` is git-ignored; only `.env.example` is committed. CI must
  materialize a `.env` (or export the vars) before `nx test api`. See
  [[nx-loads-root-env-for-tests]].

### Lint / format / typecheck

- **Lint** — `nx run-many -t lint` → `@nx/eslint` synthesized targets (`nx.json:33-39`),
  flat config `eslint.config.mjs`, module boundaries `@nx/enforce-module-boundaries`
  (`eslint.config.mjs:24-51`) with tags `scope:shared|api|web|e2e`. Lint-capable projects:
  **shared, e2e, api, web, ui-helm** (5).
- **Format** — `nx format:check`. In CI prefer **`nx format:check --all`** to avoid a
  base-SHA dependency.
- **Typecheck** — synthesized by `@nx/vite` (`nx.json:47`) for **api** (`tsc --noEmit -p
  tsconfig.app.json`) and **shared** (`tsc --noEmit -p tsconfig.lib.json`) only. **`web`
  has NO typecheck target** — covered only by `nx build web`. So `nx run-many -t typecheck`
  silently skips web (and the `pre-commit` hook does too).

### Nx caching & affected

- **Cached targets** (`nx.json:77-112`): build, web unit-test, esbuild, eslint/lint, tsc,
  vitest test. Named inputs at `nx.json:19-32` (`production` excludes specs/eslint config).
- **Nx Cloud: NOT configured** — no `nxCloudId`/access token anywhere. CI runs are cold
  unless `.nx/cache` is cached via `actions/cache`.
- **Affected base:** no `defaultBase` in `nx.json` (Nx falls back to `main`). `nx affected`
  in CI needs `actions/checkout` with **`fetch-depth: 0`** and an explicit
  `--base=origin/main --head=HEAD` (or `nrwl/nx-set-shas`). **Neither is wired today.**
  Cache key includes `{"env":"CI"}` — set `CI=true` consistently.

### Node / package manager

- **No pinning anywhere**: no `.nvmrc`/`.node-version`/`volta`/`engines`/`packageManager`.
- **Dockerfile uses `node:24-alpine`** (`Dockerfile:9,28,44`). `@types/node` is `20.x` in
  `package.json` (legacy). `deploy-plan.md:168` records the as-built decision: **Node 24
  everywhere** (user decision, overriding the original "22 LTS" plan).
- **Recommendation:** add `.nvmrc` (`24`) and use `actions/setup-node@v4`
  (`node-version-file: .nvmrc` or `node-version: 24`, `cache: npm`) + `npm ci`.
- Tooling versions (`package.json`): `nx 22.7.2`, `vitest 4.1.9`, `@vitest/coverage-v8
  4.1.9`, `@playwright/test ^1.36.0` (via `@nx/playwright 22.7.2`), `eslint ^9.8.0`,
  `prettier ^3.8.1`, `typescript ~5.9.2`, `husky/lint-staged`.

### E2E (Playwright) harness — `tests/e2e`

- **Project `e2e`** (`tests/e2e/project.json`): `tags:["scope:e2e"]`,
  `implicitDependencies:["web","api"]`, **`targets:{}` empty** — the `e2e` target is
  inferred by `@nx/playwright/plugin` (`nx.json:70-75`). Invoke via `nx e2e e2e`
  (`package.json:16`). 4 specs + `auth.setup.ts` in `tests/e2e/specs/`.
- **Config** `tests/e2e/playwright.config.ts`: `testDir ./specs`; **Chromium only**;
  projects `setup` (signup → storageState `.auth/user.json`) + `chromium`
  (`dependencies:['setup']`); `retries: CI?2:0`, `forbidOnly:!!CI`, `fullyParallel:true`;
  `screenshot:'only-on-failure'`, `trace:'on-first-retry'`, `video:'retain-on-failure'`.
- **Two webServers**, both `cwd: rootDir` (repo root), `timeout:120_000`:
  - api `:3000` — `` `DATABASE_PATH=${DATABASE_PATH} NODE_ENV=test PORT=3000 npx nx run
    api:serve` `` (env **inlined**), `reuseExistingServer:false` (unconditional fresh boot),
    health `http://localhost:3000/api/health`.
  - web `:4200` — `npx nx run web:serve`, `reuseExistingServer:!CI` (fresh in CI).
  - This matches [[isolate-e2e-db-nx-playwright]] / test-plan lesson exactly: inline env,
    no server reuse on the stateful api, cwd anchored to repo root.
- **DB isolation:** `DATABASE_PATH='./data/opspilot.e2e.db'` (config line 10) → repo-root
  `data/opspilot.e2e.db`. Without the inline override the api falls back to the **dev** DB
  (`apps/api/src/config/database.config.ts` default `./data/opspilot.db`). Schema is
  auto-migrated at boot (`MigrationService.onApplicationBootstrap()`), so a clean runner
  gets a migrated DB on first boot. **No globalSetup/teardown, no reset/truncate** — per-test
  isolation is unique timestamp ids + `afterEach` cascade-delete; the `setup` project makes a
  fresh `e2e+${Date.now()}@opspilot.local` user each run.
- **Direct-DB seed helper** `tests/e2e/helpers/seed-run-record.ts` opens a *second*
  better-sqlite3 connection with a **hard-coded** `../../../data/opspilot.e2e.db` path
  (inserts a `run_record` — no API exists). If the config DB path ever changes, this must
  change too.

### What the E2E job needs in CI (the hard parts)

1. **Four required boot env vars** (`apps/api/src/config/env.schema.ts:28-68`; `@nestjs/config`
   has no `envFilePath`, so it reads root `.env` or real env):
   - `BETTER_AUTH_SECRET` — required, ≥32 chars, no default. **SECRET.**
   - `ENCRYPTION_KEY` — required, base64, exactly 44 chars (32 bytes). **SECRET.**
   - `BETTER_AUTH_URL` — required URI → `http://localhost:3000`.
   - `TRUSTED_ORIGINS` — required, must include `http://localhost:4200` (else Better Auth
     signup is origin-rejected and the `setup` project fails).
   - Missing any → api fails fast → webServer never healthy → e2e times out at 120 s.
2. **No external LLM/SSH deps** — the LLM provider lives in the DB, not env; e2e specs run
   with **no active LLM provider** by design (`diagnosis-clean-error.spec.ts` asserts the 409
   pre-flight; `diagnosis-synthesis-renders.spec.ts` seeds the result directly). Nothing to stub.
3. **`npx playwright install --with-deps chromium`** on the runner.
4. **Cold-build timing vs. 120 s webServer timeout** — `api:serve` `dependsOn:['build']`;
   on a cold runner the api webpack build + web dev-server may approach 120 s. Mitigate:
   pre-warm `npx nx run-many -t build -p api web`, or raise the timeout.
5. **Artifacts** — reporter `[['html',{open:'never'}],['list']]`. Upload `playwright-report/`
   and `test-results/` (traces/screenshots/videos) with `if: always()`.
6. **DB hygiene** — e2e DB is git-ignored and accumulates locally; CI is clean per run, but if
   runners/caches are reused add `rm -f data/opspilot.e2e.db*` before the run (not done today).

### Project inventory (test / lint / typecheck targets)

| Project | root | tags | test | lint | typecheck |
|---|---|---|---|---|---|
| `api` | `apps/api` | `scope:api` | vitest | yes | `tsc -p tsconfig.app.json` |
| `web` | `apps/web` | `scope:web` | `@angular/build:unit-test` (jsdom) | yes | **NO** (build only) |
| `shared` | `libs/shared` | `scope:shared` | vitest | yes | `tsc -p tsconfig.lib.json` |
| `ui-helm` | `libs/ui` | `scope:web` | **NO test** | yes | **NO** |
| `e2e` | `tests/e2e` | `scope:e2e` | n/a (Playwright `e2e`) | yes | **NO** |

`nx run-many -t test` covers exactly **api, shared, web**.

## Code References

- `.github/workflows/pipeline.yml:3` — "no linters/tests/security yet - those come later"
- `.github/workflows/pipeline.yml:14-57` — deploy job; `:21` checkout (no fetch-depth)
- `.github/workflows/pipeline.yml:59-75` — cleanup job
- `package.json:6-28` — all scripts (test/lint/format/affected/e2e)
- `nx.json:33-75` — eslint/vite/vitest/webpack/playwright plugins (synthesized targets)
- `nx.json:77-112` — cached targetDefaults; no `defaultBase`
- `apps/api/vitest.config.mts` / `libs/shared/vitest.config.mts` — vitest, node env, v8, watch:false
- `apps/web/project.json:77-82` — `@angular/build:unit-test`, watch:false, jsdom
- `apps/api/src/config/env.schema.ts:28-68` — required boot vars (Joi)
- `apps/api/src/config/database.config.ts:5` — reads `DATABASE_PATH`, default dev DB
- `apps/api/src/core/database/migration/migration.service.ts:23-37` — auto-migrate at boot
- `tests/e2e/playwright.config.ts:7-62` — webServers, inline DB env, Chromium, reporters
- `tests/e2e/helpers/seed-run-record.ts:10` — hard-coded e2e DB path (keep in sync)
- `tests/e2e/project.json` — `scope:e2e`, implicit deps web+api, empty targets
- `Dockerfile:9,28,44` — `node:24-alpine` (Node 24 is the de-facto pin)

## Architecture Insights

- **Targets are plugin-inferred, not declared.** `test`/`lint`/`typecheck`/`e2e` come from
  Nx plugins (`@nx/vitest`, `@nx/eslint`, `@nx/vite`, `@nx/playwright`), so the CI must call
  them via `nx` — there are no raw vitest/eslint configs to invoke directly.
- **Two unit-test runners side by side**, but neither needs a browser in CI: vitest(node) +
  Angular builder(jsdom). Only the separate Playwright `e2e` job needs Chromium.
- **Boot-time config validation is the single biggest CI footgun.** Joi fail-fast means any
  job that boots the api (unit `api`, e2e) dies without the four env vars. This is the
  recurring `.env`-for-tests theme already in lessons/memory.
- **The e2e harness already follows the hard-won isolation lesson** — the CI job just has to
  not undo it (keep env inline, don't reuse the api server, run from repo root).
- **Layered gate options** (cheapest → most expensive), all already runnable:
  `lint` → `format:check --all` → `typecheck` (api+shared) → unit `test` (+ optional
  `--coverage`) → `build` (also web's only type-check) → `e2e`.

## Recommended CI shape (for the plan to refine)

A new **test/quality job (or workflow)** gating before/independent of `deploy`:

```
- actions/checkout@v5            # fetch-depth: 0 only if using nx affected
- actions/setup-node@v4          # node 24, cache: npm
- npm ci
- write root .env from secrets   # BETTER_AUTH_SECRET, ENCRYPTION_KEY, BETTER_AUTH_URL, TRUSTED_ORIGINS
- npx nx run-many -t lint
- npx nx format:check --all
- npx nx run-many -t typecheck   # api + shared (web via build)
- npx nx run-many -t test --projects=api,shared,web   # optional: -- --coverage
```

A separate **e2e job** (needs the same `.env` secrets):

```
- checkout / setup-node / npm ci / write .env
- npx playwright install --with-deps chromium
- (optional) npx nx run-many -t build -p api web    # pre-warm vs 120s webServer timeout
- npx nx e2e e2e
- actions/upload-artifact (playwright-report/, test-results/) if: always()
```

Open design choices for `/10x-plan`: (a) **affected vs run-many** — push-to-main has no PR
base, so affected needs SHA wiring (`nrwl/nx-set-shas`); run-many is simpler and the repo is
small. (b) **gate vs. inform** — make jobs `needs:` of `deploy` (block bad images) vs. run in
parallel. (c) **secrets delivery** — GH Actions secrets → root `.env` vs. job-level `env:`.
(d) **web typecheck gap** — accept build-as-typecheck, or add a `web:typecheck`. (e) **coverage
thresholds** — opt-in `--coverage` with thresholds, or skip for now.

## Historical Context (from prior changes / foundation)

- `context/deployment/deploy-plan.md:67-86` — **Phase 2 scoped CI/CD to "deploy + cleanup
  only (no linters/tests/security - those come later)"**; this change is that "later."
  `:152-185` records as-built deviations (Node 24, `nx prune` skipped, expat fix).
- `context/foundation/test-plan.md:124-136` — **§5 Quality Gates** already specifies the
  intended gates: `lint + typecheck` (all phases), module-boundary enforcement, `unit +
  integration` (required after Phase 1), `e2e on critical flows` (required after Phase 4),
  optional pre-prod smoke. `:75-96` — all 4 rollout phases **complete** as of 2026-06-25.
  `:299-364` — e2e patterns (auth.setup, dual webServer, isolated `opspilot.e2e.db`).
- `context/foundation/infrastructure.md:94-106` — risk register: arm64 build slow/flaky under
  QEMU (mitigation = native ARM runner matrix); `:124` explicitly lists CI/CD pipeline setup
  as out-of-scope for that doc (a pointer, not configured).
- `context/foundation/lessons.md:54-59` — **e2e DB isolation lesson** (inline env, no reuse,
  repo-root cwd) — already implemented in `playwright.config.ts`.

## Related Research

- No prior `research.md` exists under `context/changes/**` or `context/archive/**` for CI/CD.
  Closest siblings: `context/deployment/deploy-plan.md` (Phase 2 pipeline) and
  `context/foundation/test-plan.md` (§5 gates) — both treated as direction above.

## Open Questions

1. **affected vs run-many** for push-to-`main` (no PR base) — wire `nrwl/nx-set-shas`, or
   keep run-many for simplicity given the small graph?
2. **Block deploy on green tests** (`deploy.needs: [test, e2e]`) vs. run gates in parallel
   with deploy this round?
3. **`web` typecheck gap** — accept `nx build web` as the type-check, or add an explicit
   `web:typecheck` target so `run-many -t typecheck` is complete?
4. **Coverage gating** — turn on `--coverage` + thresholds now, or defer?
5. **E2E cold-build vs 120 s timeout** — pre-warm builds, raise the webServer timeout, or both?
6. **Secrets** — generate throwaway CI values for `BETTER_AUTH_SECRET`/`ENCRYPTION_KEY`
   (e2e uses a fresh DB and no real auth provider), or store real GH secrets?
