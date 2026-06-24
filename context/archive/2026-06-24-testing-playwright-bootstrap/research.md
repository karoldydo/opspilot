---
date: 2026-06-24T22:35:24+02:00
researcher: Karol Dydo
git_commit: a860dce8a9a3ce0c2c5849d355447df33193c24f
branch: main
repository: karoldydo/opspilot
topic: "Playwright E2E bootstrap — what the workspace exposes for auth, ports, DB, and module boundaries"
tags: [research, codebase, e2e, playwright, nx, better-auth, sqlite]
status: complete
last_updated: 2026-06-24
last_updated_by: Karol Dydo
---

# Research: Playwright E2E Bootstrap

**Date**: 2026-06-24T22:35:24+02:00
**Researcher**: Karol Dydo
**Git Commit**: a860dce8a9a3ce0c2c5849d355447df33193c24f
**Branch**: main
**Repository**: karoldydo/opspilot

## Research Question

`context/foundation/test-plan.md` §3 Phase 4 ("diagnoseLogs e2e + SSE through the edge") is
`not started` and explicitly bootstraps Playwright — none exists. Before authoring any E2E test via
`/10x-e2e`, ground the workspace facts that determine how Playwright is installed, how the two apps
start, how a test authenticates, and how the new project sits inside the Nx graph / module
boundaries.

## Current State

- **No Playwright anywhere.** No `playwright.config.*`, no E2E project, `@nx/playwright` absent from
  `devDependencies` (present only transitively in `package-lock.json` at 22.7.2). All 86 `*.spec.ts`
  are Vitest unit/integration specs. `.playwright-mcp/` holds only MCP console logs, not config.
- Test-plan phases 1–3 (integration/contract, api) are `complete`; Phase 4 (the only browser layer)
  is the bootstrap moment.

## Key Discoveries

### Nx workspace
- Nx **22.7.2** across all `@nx/*` packages; `@nx/playwright` must be added explicitly at 22.7.2.
  Node 20.19, TypeScript ~5.9.2, Angular 21.2.x, NestJS ^11.
- `nx.json` plugins: `@nx/eslint`, `@nx/vite`, `@nx/vitest`, `@nx/webpack`. **No `@nx/playwright/plugin`** yet.
- `production` namedInputs already exclude `**/*.spec.ts` from build inputs, so E2E specs following
  `*.spec.ts` stay out of production builds.

### Ports & proxy
- web (`@angular/build:dev-server`) → **4200** (Angular default, not overridden in `apps/web/project.json`).
- api (NestJS via `@nx/js:node`, `serve` dependsOn `build`) → **3000** (`PORT` env, default 3000; `apps/api/src/main.ts`).
- `apps/web/proxy.conf.json` proxies `/api → http://localhost:3000` (`changeOrigin: true`, `secure: false`).
  ⇒ Playwright `baseURL: http://localhost:4200`; `/api/*` calls route through the proxy automatically.
- Health probe for webServer readiness: `GET /api/health` (public, 200).

### Auth (Playwright-friendly)
- **Better Auth v1.6.x, HTTP-only cookie sessions** (not JWT) — `storageState` captures the cookie.
  - `apps/api/src/core/auth/create-auth.ts` (`emailAndPassword.enabled: true`, open signup),
    `apps/api/better-auth.config.ts`, web client `apps/web/src/app/core/auth/auth.client.ts`.
- Endpoints under `/api/auth/*`: `POST /sign-up/email` (`{ email, password>=8, name }`),
  `POST /sign-in/email`, `POST /sign-out`, `GET /get-session`.
- Sessions persisted in SQLite `session` table (`apps/api/src/core/database/schema/auth.schema.ts`),
  default 7-day expiry. Shared Zod contracts at `libs/shared/src/lib/schemas/auth-*.schema.ts`.
- Global guard `AuthAppGuard` (`apps/api/src/core/auth/auth.guard.ts`) → 401 on every
  non-`@Public()` route. Web routes guarded by `apps/web/src/app/core/guards/auth.guard.ts`;
  `/login`, `/register` public; `/` (Overview) + `audit|devices|llm-providers|skills` protected.
  Session hydrated at app init via `AuthStore.loadSession()` (`apps/web/src/app/app.config.ts`).
- **No pre-seeded test user** — create one per run via `POST /api/auth/sign-up/email`.

### Database (isolation)
- SQLite + Drizzle (`better-sqlite3`, WAL). Path from `DATABASE_PATH` (default `./data/opspilot.db`).
  Connection: `apps/api/src/core/database/providers/database-connection.provider.ts`.
- Migrations (`apps/api/migrations/`, 10 files) + global skill seed run **automatically** on api
  boot. ⇒ pointing `DATABASE_PATH` at `./data/opspilot.e2e.db` gives a self-provisioning isolated
  test DB; dev `opspilot.db` stays untouched.

### Env
- Required api vars (`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ENCRYPTION_KEY`, `TRUSTED_ORIGINS`)
  already present in root `.env`; **Nx loads `.env` automatically** for targets (see memory:
  nx-loads-root-env-for-tests). E2E only needs to override `DATABASE_PATH`/`NODE_ENV`.
- web needs no env in dev (proxy handles `/api`).

### Module boundaries
- `eslint.config.mjs` enforces `@nx/enforce-module-boundaries` with scope tags
  `scope:shared|api|web` in each `project.json`. A new E2E project needs its own tag (`scope:e2e`)
  and a `depConstraints` entry, otherwise lint fails on any import.

## Open Questions / Decisions taken
- **Project location**: `tests/e2e` (flat) — chosen over Nx-native `apps/web-e2e`. Still gets a
  `project.json` (tag `scope:e2e`, `implicitDependencies: [web, api]`) so it lives in the Nx graph
  and `nx affected` re-triggers it.
- **CI**: out of scope for this change (local-only). Test-plan §5 still requires e2e-in-CI after
  Phase 4 — a follow-up.
- **Browser**: Chromium only on bootstrap (DOM-snapshot default per CLAUDE.md).

## References
- `context/foundation/test-plan.md` §3 (Phase 4), §4 (stack), §6.5 (e2e cookbook = TBD).
- `apps/web/project.json`, `apps/api/project.json`, `nx.json`, `eslint.config.mjs`, `tsconfig.base.json`.
