# Restructure `apps/api` into Role Buckets — Plan Brief

> Full plan: `context/changes/api-architecture-recommendation/plan.md`
> Seed recommendation: `.ai/api-architecture-recommendation.md`
> Precedent (merged): `context/archive/2026-06-14-web-architecture-recommendation/plan.md`

## What & Why

`apps/api/src` is a flat ~17-folder pile where 6 business domains and ~8 infra/cross-cutting folders
sit at one level, so the structure no longer signals "what is domain vs. what is plumbing." We
restructure it into four role buckets — `modules/` (domains), `core/` (internal infra),
`integrations/` (external-system wrappers), `common/` (framework utils) — plus an `@api/*` alias.
This is the API parallel of the just-merged web restructure. **No logic, contract, or API changes.**

## Starting Point

The code is already feature-modular (each domain has its own module/controller/service) and idiomatic
— the only smell is the flat top-level layout. All 12 roadmap slices are `done`. Tooling is restructure-ready:
`vitest` uses `nxViteTsPaths()` and the tsconfigs chain to base, so `@api/*` resolves in test+build
with no extra config; eslint/webpack/project.json/.gitignore need no change. Only `drizzle.config.ts`
and `better-auth.config.ts` hardcode `./src/...` paths.

## Desired End State

`apps/api/src` has `modules/`, `core/`, `integrations/executor/`, and a typed `common/`
(`filters`/`pipes`/`decorators`); `app.module.ts` sits at `src/` root and the Nx scaffold hello-world
is gone. Every internal import uses `@api/*` — no `../` chains remain. Full workspace lint/test/build/
format is green and `nx graph` shows no new cross-project edges.

## Key Decisions Made

| Decision                     | Choice                                  | Why (1 sentence)                                                                 | Source   |
| ---------------------------- | --------------------------------------- | ------------------------------------------------------------------------------- | -------- |
| Target architecture          | 4 role buckets, no hexagonal/Clean      | Right altitude for homelab scale; matches NestJS 2026 consensus                 | Seed     |
| Phasing                      | Bucket-by-bucket (7 phases)             | Domains share dense edges (audit hub), so they move into `modules/` as one pass | Plan     |
| Import-rewrite scope         | Full `@api/*` normalization             | Makes future moves trivial; uniform with web's `@app/*` end-state               | Plan     |
| `app.module.ts` + scaffold   | Hoist to root + delete hello-world      | Idiomatic; removes dead generated code already covered by `health/`             | Plan     |
| Alias introduction           | Alias-first as its own Phase 1          | Isolates "alias resolves?" risk from "move broke paths?" risk                   | Plan     |
| CLI configs                  | Keep relative, update paths in P3       | `drizzle-kit`/`better-auth` CLIs may not resolve `@api/*`                       | Plan     |

## Scope

**In scope:** `tsconfig.base.json` (`@api/*` entry); moving all `apps/api/src` folders into buckets;
rewriting all intra-api imports to `@api/*`; updating `drizzle.config.ts` + `better-auth.config.ts`
paths; hoisting `app.module.ts`; deleting the scaffold hello-world.

**Out of scope:** any logic/behavior/DI-token/API-route/migration change; module internals
(no `use-cases/`/`repositories/` layering); `config/` (stays top-level); hexagonal architecture;
`apps/web` and `libs/shared`; eslint/webpack/project.json/.gitignore (verified unnecessary).

## Architecture / Approach

Alias-first, then strangle the flat layout bucket by bucket. P1 adds `@api/*` and normalizes all
relative imports on the still-flat tree, so every later move is a one-segment find-replace. Then move
in dependency-safe order: `common/` → `core/` (+CLI configs) → `integrations/executor/` → all 6
domains into `modules/` in one pass (forced by cross-domain edges) → hoist `app.module.ts` + delete
scaffold → final sweep. Each phase is `git mv` + `@api/*` segment rewrites + `nx lint/test/build api`,
committed independently green.

## Phases at a Glance

| Phase                                  | What it delivers                                  | Key risk                                              |
| -------------------------------------- | ------------------------------------------------- | ---------------------------------------------------- |
| 1. Alias + full normalization          | `@api/*` works; all imports normalized (flat)     | Large diff; alias must resolve in webpack+vitest     |
| 2. `common/` regrouping                | filters/pipes/decorators subfolders               | Wide importer set (~18) but mechanical               |
| 3. `core/` bucket (+CLI configs)       | database/auth/crypto/credential/health under core | `drizzle`/`better-auth` CLI path breakage            |
| 4. `integrations/executor/`            | executor relocated                                | SSH path correctness                                 |
| 5. `modules/` (6 domains, one pass)    | all domains bucketed                              | Largest diff; dense cross-domain `@api/*` rewrites   |
| 6. Hoist `app.module.ts` + del scaffold| root module; dead code removed                    | Accidentally deleting a referenced route (grep-clear)|
| 7. Final sweep                         | green workspace, clean graph, no `../` left       | Catching any missed importer                         |

**Prerequisites:** clean green baseline (`nx lint/test/build api`); git working tree clean except this
change's docs.
**Estimated effort:** ~2-3 sessions across 7 small, independently-revertible commits.

## Open Risks & Assumptions

- The two CLI configs (`drizzle.config.ts`, `better-auth.config.ts`) are the only consumers outside
  tsconfig path-resolution; P3 verifies them via `drizzle-kit generate` / `@better-auth/cli generate`.
- Cross-domain edges (audit hub, diagnose orchestration) mean domains must move together (P5) — the
  one phase with a non-trivial diff.
- Assumes the merged web restructure's tooling lessons hold (they were grep-re-verified for api).

## Success Criteria (Summary)

- `apps/api/src` is bucketed (`modules`/`core`/`integrations`/`common`) with `app.module.ts` at root.
- All internal imports use `@api/*`; no `../` cross-folder imports remain.
- Full workspace lint/test/build/format green; `nx graph` shows no new cross-project edges; the
  running stack smoke-tests clean (login, CRUD, SSE skill run, diagnose, audit).
