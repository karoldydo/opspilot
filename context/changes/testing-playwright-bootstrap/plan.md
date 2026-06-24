# Playwright E2E Bootstrap — Implementation Plan

## Overview

`context/foundation/test-plan.md` §3 Phase 4 ("diagnoseLogs e2e + SSE through the edge") is
`not started` and explicitly bootstraps Playwright — **none exists**. This change is the
infrastructure-only enabling step: install Playwright, stand up an Nx E2E project at `tests/e2e`,
auto-start both apps against an isolated test DB, authenticate without the UI (Better Auth cookie →
`storageState`), and prove the wiring with one smoke test.

The actual browser-level tests for the diagnoseLogs UI→synthesis path (4-field result) and SSE
narration with heartbeats are **NOT** part of this change — `/10x-e2e` authors those next (the
skill deliberately does not install Playwright, hence this bootstrap first).

See `research.md` for the grounded workspace facts (Nx 22.7.2, ports 4200/3000, proxy `/api→3000`,
cookie sessions, self-provisioning SQLite via `DATABASE_PATH`, module-boundary tags).

## Current State Analysis

- No `playwright.config.*`, no E2E project, `@nx/playwright` not in `devDependencies` (transitive
  only). `nx.json` has no `@nx/playwright/plugin`.
- web → 4200, api → 3000, `apps/web/proxy.conf.json` proxies `/api → :3000`.
- Better Auth, HTTP-only cookie sessions; open signup at `POST /api/auth/sign-up/email`; global
  guard → 401; web guard redirects unauth to `/login`.
- SQLite migrations + seed run automatically on api boot; `DATABASE_PATH` selects the file.
- `@nx/enforce-module-boundaries` requires a scope tag on every project.

## Desired End State

`npx nx e2e e2e` starts api (on `./data/opspilot.e2e.db`) + web, the `setup` project signs up a
unique test user and writes `storageState`, and the smoke test loads `/` authenticated (no redirect
to `/login`) — green. `npx nx lint e2e` passes (tag `scope:e2e` + playwright rules, no boundary
violations). Dev `opspilot.db` is untouched. The Nx graph shows the inferred `e2e` target.

## What We're NOT Doing

- **No diagnoseLogs / SSE E2E tests** — that's `/10x-e2e` after this lands.
- **No CI workflow** — local-only this change; test-plan §5 e2e-in-CI is a follow-up.
- **No seed exemplar (`seed.spec.ts`) or E2E rules file** — `/10x-e2e` creates those on first use.
- **No multi-browser matrix** — Chromium only (DOM-snapshot default).

## Phase 1: Install Playwright & scaffold the Nx E2E project

### Changes Required

- Run `npx nx add @nx/playwright@22.7.2` (installs `@nx/playwright` + `@playwright/test`/`playwright`,
  registers `@nx/playwright/plugin` in `nx.json` → infers `e2e` target from `playwright.config.ts`).
- Run `npx playwright install --with-deps chromium`.
- Create `tests/e2e/project.json` — name `e2e`, `projectType: application`, `tags: ["scope:e2e"]`,
  `implicitDependencies: ["web", "api"]`. Rely on plugin inference for the `e2e` target; add an
  explicit `@nx/playwright:playwright` target only if inference doesn't pick up the config.
- Create `tests/e2e/tsconfig.json` — `extends` `tsconfig.base.json`, `types: ["node", "@playwright/test"]`,
  include specs (gives the `@opspilot/shared` alias for contract types).
- Create `tests/e2e/eslint.config.mjs` — flat config extending the base + `playwright` plugin rules.
- Add to `eslint.config.mjs` `depConstraints`:
  `{ sourceTag: 'scope:e2e', onlyDependOnLibsWithTags: ['scope:e2e', 'scope:shared'] }`.
- Append to `.gitignore`: `tests/e2e/.auth/`, `playwright-report/`, `test-results/`,
  `data/opspilot.e2e.db*`.

### Success Criteria

- `@nx/playwright@22.7.2` in `devDependencies`; `@nx/playwright/plugin` in `nx.json`.
- `npx nx show project e2e --web` lists the project with tag `scope:e2e` and an `e2e` target.
- `npx nx lint e2e` passes (config present, no boundary violation).

## Phase 2: Playwright config, auth fixture, smoke test

### Changes Required

- Create `tests/e2e/playwright.config.ts`:
  - `testDir: './specs'`, `use.baseURL: 'http://localhost:4200'`, `trace: 'on-first-retry'`,
    `screenshot: 'only-on-failure'`, `video: 'retain-on-failure'`,
    `reporter: [['html', { open: 'never' }], ['list']]`, `forbidOnly: !!process.env.CI`.
  - `projects`: `setup` (`testMatch: /.*\.setup\.ts/`) and `chromium`
    (`use: { ...devices['Desktop Chrome'], storageState: 'tests/e2e/.auth/user.json' }`,
    `dependencies: ['setup']`).
  - `webServer` (array, `reuseExistingServer: !process.env.CI`, `timeout: 120_000`):
    - api: `command: 'npx nx run api:serve'`, `url: 'http://localhost:3000/api/health'`,
      `env: { DATABASE_PATH: './data/opspilot.e2e.db', NODE_ENV: 'test', PORT: '3000' }`.
    - web: `command: 'npx nx run web:serve'`, `url: 'http://localhost:4200'`.
- Create `tests/e2e/specs/auth.setup.ts` — `page.request.post('/api/auth/sign-up/email', …)` with a
  unique email (`e2e+${Date.now()}@opspilot.local`) + password (env `E2E_USER_PASSWORD`, fallback
  fixed >=8 chars); confirm via `GET /api/auth/get-session`; save
  `page.context().storageState({ path: 'tests/e2e/.auth/user.json' })`.
- Create `tests/e2e/specs/smoke.spec.ts` — authenticated: `page.goto('/')`, assert the Overview
  dashboard renders (a `getByRole` anchor) and `expect(page).toHaveURL(/\/$/)` (no redirect to
  `/login`).
- Add npm scripts to `package.json`: `"e2e": "nx e2e e2e"`, `"e2e:ui": "nx e2e e2e -- --ui"`,
  `"e2e:report": "npx playwright show-report"`.

### Success Criteria

- `npx nx e2e e2e` is green: both servers start, `setup` writes `storageState`, smoke test passes.
- After the run `data/opspilot.e2e.db*` exists and `data/opspilot.db` is unchanged (isolation).
- `npm run e2e:report` opens the HTML report.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Install Playwright & scaffold the Nx E2E project

#### Automated

- [x] 1.1 `@nx/playwright@22.7.2` installed and `@nx/playwright/plugin` registered in `nx.json`
- [x] 1.2 Chromium engine installed (`npx playwright install --with-deps chromium`)
- [x] 1.3 `tests/e2e/{project.json,tsconfig.json,eslint.config.mjs}` created; `scope:e2e` depConstraint added; `.gitignore` updated
- [x] 1.4 `npx nx show project e2e --web` lists project + `e2e` target with tag `scope:e2e`
- [x] 1.5 `npx nx lint e2e` passes

#### Manual

- [x] 1.6 No module-boundary regression elsewhere (`npx nx lint web api shared` still green)

### Phase 2: Playwright config, auth fixture, smoke test

#### Automated

- [ ] 2.1 `tests/e2e/playwright.config.ts` + `specs/auth.setup.ts` + `specs/smoke.spec.ts` created; npm scripts added
- [ ] 2.2 `npx nx e2e e2e` green (servers start, setup writes storageState, smoke passes)
- [ ] 2.3 Formatting clean: `npm run format:check`

#### Manual

- [ ] 2.4 Isolation verified: `data/opspilot.e2e.db*` created, `data/opspilot.db` (dev) untouched
- [ ] 2.5 `npm run e2e:report` renders the HTML report
