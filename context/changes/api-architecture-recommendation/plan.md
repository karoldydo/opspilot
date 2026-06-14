# Restructure `apps/api` into Role Buckets (`modules`/`core`/`integrations`/`common`) — Implementation Plan

## Overview

Migrate `apps/api/src` from a **flat ~17-folder layout** — where 6 business domains and ~8
infrastructure/cross-cutting folders sit side-by-side at one level — to a **role-bucketed** layout:
`modules/` (the 6 domains), `core/` (internal infra: database, auth, crypto, credential, health),
`integrations/` (the SSH executor), and a regrouped `common/` (`filters`/`pipes`/`decorators`).
`app.module.ts` is hoisted to `src/` root, the Nx scaffold hello-world is deleted, and `config/`,
`main.ts`, `assets/` are untouched. A single `@api/*` path alias (mirroring web's `@app/*`) replaces
every `../../../` relative chain.

This change introduces **no logic, contract, API, build-graph, or migration changes** — it relocates
files and rewrites import specifiers only. It is the direct API parallel of the just-merged
`web-architecture-recommendation` (archived `2026-06-14-web-architecture-recommendation`).

## Current State Analysis

The current `apps/api/src/` (verified 2026-06-14, matches seed `.ai/api-architecture-recommendation.md`):

- **6 domains** (each a folder with `*.module.ts` + controller + service + specs): `audit`, `device`
  (with `device/credential/` sub-controller), `service`, `skill`, `diagnose`, `llm-provider`.
- **Infra / cross-cutting**: `database/` (connection, migration, `schema/`, `providers/`), `auth/`
  (Better Auth handler, guard, `providers/`), `crypto/`, `credential/`, `executor/` (node-ssh behind
  `IExecutor`), `health/`, `common/` (filter + pipe + 2 decorators, flat).
- **Bootstrap / config**: `app/` (`app.module.ts` + scaffold `app.controller.ts`/`app.service.ts` +
  spec), `config/` (10 files: `config.module.ts`, `env.schema.ts`, 7 `*.config.ts`), `assets/`,
  `main.ts`.

**Key constraints discovered (grep-verified 2026-06-14):**

- **`@api/*` alias resolves with zero extra config.** `apps/api/vitest.config.mts` already loads
  `nxViteTsPaths()` (reads tsconfig `paths`), and `tsconfig.app.json`/`tsconfig.spec.json` both
  `extends` → `tsconfig.base.json`. The webpack build uses `NxAppWebpackPlugin` with `compiler: 'tsc'`
  + `tsConfig: './tsconfig.app.json'`, which inherits base paths. The monorepo already resolves
  `@app/*` the same way for web — mechanism is proven.
- **ESLint needs NO change.** `@nx/enforce-module-boundaries` polices only the `api ↔ web ↔ shared`
  scope line via `depConstraints`; `scope:api` may depend on `scope:api`+`scope:shared`. `@api/*` is
  intra-`scope:api`, so it needs **no** `allow`-list entry (unlike web's `^@app/`, which was added
  only because that rule's `allow` list is the gate the web alias tripped — the api alias does not
  trip it). The `depConstraints` block is untouched.
- **`.gitignore` is safe.** `/data/` is root-anchored (`/data/`, not `data/`); no pattern shadows a
  folder named `modules`/`core`/`common`/`integrations`/`data` under `src/`.
- **`webpack.config.js` and `project.json` need NO change.** `main: './src/main.ts'` and
  `assets: ['./src/assets', { input: './migrations', … }]` resolve against the project root and stay
  valid (entry + assets remain at the `src/` level; `apps/api/migrations/` is outside `src/`).
  `sourceRoot: "apps/api/src"` is unaffected by sub-folder moves within `src/`.
- **Two CLI configs hardcode `./src/...` and MUST be updated when `database`/`auth` move:**
  - `drizzle.config.ts:15` → `schema: './src/database/schema/index.ts'`.
  - `better-auth.config.ts:1-2` → `import { createAuth } from './src/auth/create-auth'` and
    `import { DatabaseConnection } from './src/database/providers/database-connection.provider'`.
    These are run by external CLIs (`drizzle-kit`, `@better-auth/cli`) that may not resolve tsconfig
    paths, so they **stay relative** — only the relative path is updated, not converted to `@api/*`.
- **Import fan-out (importer counts, grep-verified):** `database` 31, `config` 27, `audit` 26,
  `common` 18, `device` 17, `service` 17, `executor` 15, `llm-provider` 14, `skill` 11, `auth` 9,
  `crypto` 7, `credential` 7, `diagnose` 6, `health` 4, `app` 4.
- **The seed's "no cross-domain imports" claim is REFUTED — and this shapes the phasing.** There are
  real service-injection edges between domains:
  - `audit` is a **hub**: `AuditService` is imported by all 5 other domains (device, service, skill,
    diagnose, llm-provider) to record actions.
  - `diagnose` **orchestrates**: imports `DeviceService`, `ServiceService`, `LlmProviderService` (+
    `LlmProviderClientFactory`).
  - `service` is imported by `skill-run.service` and `diagnose.service` (+ its module by skill/diagnose).
  - `device` is imported by `diagnose` and by `executor` (SSH host lookup).
  - `executor` (`IExecutor`/`EXECUTOR` token) is imported by `skill`, `service`, `diagnose`.
  Because these edges cross domain folders, the 6 domains must move into `modules/` **together** in a
  single phase, so all cross-domain `@api/*` segments rewrite in one consistent pass (no half-moved
  intermediate state). Alias-first normalization makes this a pure path-segment find-replace.

## Desired End State

```
apps/api/src/
├── main.ts                 # unchanged
├── app.module.ts           # hoisted from app/ to root
├── assets/                 # unchanged
├── config/                 # unchanged (10 files)
├── common/
│   ├── filters/            # all-exceptions.filter.ts (+spec if any)
│   ├── pipes/              # zod-validation.pipe.ts (+spec)
│   └── decorators/         # current-user-id.decorator.ts (+spec), public.decorator.ts
├── core/
│   ├── database/           # connection, migration, schema/, providers/
│   ├── auth/               # better-auth handler, guard, providers/
│   ├── crypto/
│   ├── credential/
│   └── health/
├── integrations/
│   └── executor/           # node-ssh + async-mutex behind IExecutor
└── modules/
    ├── audit/  device/  service/  skill/  diagnose/  llm-provider/
```

Every internal import uses `@api/*`; **no `../` relative import remains** in `apps/api/src`. The
scaffold `app.controller.ts`/`app.service.ts` (+specs) are deleted. `npm run lint && npm run test &&
npm run build` are green, `npm run format:check` is clean, `npx nx graph` shows no new cross-project
edges, and `drizzle-kit generate` / `@better-auth/cli generate` still resolve (no new migration
emitted).

### Key Discoveries:

- Target tree, placement rules, before→after map, migration mechanics, and step order are fully
  specified in the seed `.ai/api-architecture-recommendation.md` (§4–§6, §9).
- Tooling readiness (alias resolution in webpack+vitest, no eslint/gitignore/webpack/project.json
  changes) is grep-verified above — only `drizzle.config.ts` and `better-auth.config.ts` carry
  hardcoded `./src/...` paths.
- The dense cross-domain dependency graph (audit hub, diagnose orchestration, executor abstraction)
  is the reason domains move as one bucket, unlike web's independent per-domain slices.

## What We're NOT Doing

- **No layering inside modules** (`use-cases/`, `repositories/`, `dto/`) — module internals are
  untouched; contracts stay in `@opspilot/shared`, DB access stays the thin Drizzle layer.
- **No hexagonal / Clean / FBCA architecture** — over-engineering at homelab scale (seed §3).
- **No logic, behavior, DI-token, API-route, or migration changes** — relocation + import rewrites only.
- **No contract changes** — `@opspilot/shared` remains the single source of truth; `@api/*` is an
  intra-app alias, independent of `@opspilot/shared`.
- **No `apps/web` or `libs/shared` changes** — this is `apps/api` only.
- **No eslint / webpack / project.json / .gitignore changes** — verified unnecessary (see Current
  State). Only `tsconfig.base.json` (one `paths` entry), `drizzle.config.ts`, and
  `better-auth.config.ts` change outside `apps/api/src`.
- **No multi-alias scheme** (`@core`/`@modules`/…) — one `@api/*` only.
- **`config/` is NOT moved** — already cohesive; stays top-level (seed §4).

## Implementation Approach

Alias-first, then strangle the flat layout bucket by bucket. Land `@api/*` and normalize **all**
relative imports on the still-flat structure first (P1) so every subsequent move is a one-segment
find-replace (`@api/database/…` → `@api/core/database/…`) rather than a `../../../` recomputation.
Then move buckets in dependency-safe order: `common/` regrouping (P2, leaf — imported widely but
imports nothing domain-specific) → `core/` (P3, the most-depended-on infra; also updates the two CLI
configs) → `integrations/executor/` (P4) → the 6 domains into `modules/` as one pass (P5, because of
cross-domain edges) → hoist `app.module.ts` + delete scaffold (P6) → final full-workspace sweep (P7).
Each phase is one `git mv` set + `@api/*` segment rewrites + `npx nx lint api && npx nx test api &&
npx nx build api`, committed independently green and revertible.

## Critical Implementation Details

- **CLI configs stay relative, updated in P3.** `drizzle.config.ts` and `better-auth.config.ts` run
  under external CLIs that do not reliably resolve `@api/*`; keep their imports relative and update
  the `./src/...` paths to `./src/core/...` in the same phase that moves `database`/`auth`. Verify
  with `npx drizzle-kit generate` (must emit **no** new migration) and `@better-auth/cli generate`.
- **Domains move together (P5), not one-by-one.** `AuditService` is injected by all 5 other domains
  and `diagnose` imports three sibling services; moving domains individually would leave dangling
  `@api/<domain>/…` segments mid-phase. Move all 6 in one `git mv` set and rewrite every
  `@api/<domain>/…` → `@api/modules/<domain>/…` in one pass.
- **P1 is a large but low-risk diff.** Full normalization touches files that don't themselves move;
  this is intentional — it's what makes P2–P6 trivial segment edits and is the user-chosen end-state
  (parallel to web's full `@app/*` adoption).

## Phase 1: Path alias `@api/*` + full normalization (flat)

### Overview

Establish a green baseline, add the `@api/*` alias, rewrite **all** `apps/api/src` relative imports
to `@api/*` on the still-flat structure, and prove it resolves in webpack build + vitest before any
folder moves.

### Changes Required:

#### 1. Baseline gate (no edit)

**Intent**: Confirm a clean start so any later red is attributable to the migration.

**Contract**: `npx nx lint api && npx nx test api && npx nx build api` all green before edits.

#### 2. Add the project alias

**File**: `tsconfig.base.json`

**Intent**: Add one project-wide alias so internal api imports become move-resistant, mirroring web's `@app/*`.

**Contract**: New entry in `compilerOptions.paths` alongside `@app/*` and `@opspilot/shared`:

```jsonc
"@api/*": ["./apps/api/src/*"]
```

#### 3. Normalize all relative imports to `@api/*`

**Files**: every `.ts` in `apps/api/src` that imports another `apps/api/src` file via `./` or `../`
(the importer sets across all folders — `database` 31, `config` 27, `audit` 26, `common` 18, etc.).

**Intent**: Replace all intra-api relative import specifiers with `@api/<current-flat-path>` while the
structure is still flat, so subsequent moves are one-segment rewrites.

**Contract**: No `import … from '../…'` or `'./…'` pointing at another `src` folder remains (sibling
imports within the same leaf folder, e.g. a service importing its own `*.module`, may stay relative
or be normalized — choose consistently; prefer normalizing cross-folder, leaving same-folder
siblings as-is is acceptable). `@opspilot/shared` and third-party imports are untouched. The two CLI
configs (`drizzle.config.ts`, `better-auth.config.ts`) are **not** touched in this phase.

### Success Criteria:

#### Automated Verification:

- Api lints: `npx nx lint api`
- Api unit tests pass: `npx nx test api`
- Api builds: `npx nx build api`

#### Manual Verification:

- The alias path string reads as a clear locator (`@api/database/...`, `@api/common/...`).

**Implementation Note**: After completing this phase and all automated verification passes, pause for
manual confirmation before proceeding to the next phase. Phase blocks use plain bullets — the
corresponding `- [ ]` checkboxes live in the `## Progress` section.

---

## Phase 2: `common/` regrouping (`filters`/`pipes`/`decorators`)

### Overview

Sub-group the flat `common/` files by type, the lowest-risk move (it imports nothing domain-specific
and is purely framework-level).

### Changes Required:

#### 1. Move common files into typed subfolders

**Files** (`git mv`): `common/all-exceptions.filter.ts` → `common/filters/`;
`common/zod-validation.pipe.ts` (+`.spec`) → `common/pipes/`;
`common/current-user-id.decorator.ts` (+`.spec`) and `common/public.decorator.ts` →
`common/decorators/`.

**Intent**: Regroup cross-cutting framework utils by type per the target tree.

**Contract**: Files under `common/{filters,pipes,decorators}/`; no file left directly in `common/`.

#### 2. Rewrite common consumers

**Files**: the ~18 importers of `common/*` (controllers across all domains + `app.module.ts` for the
exception filter), and the moved specs' own imports.

**Intent**: Point every consumer at the new `@api/common/<subfolder>/...` segment.

**Contract**: All references use `@api/common/{filters,pipes,decorators}/...`; no reference to a
bare `@api/common/<file>` (without subfolder) remains.

### Success Criteria:

#### Automated Verification:

- Api lints: `npx nx lint api`
- Api unit tests pass: `npx nx test api`
- Api builds: `npx nx build api`
- No stale paths: `grep -rn "@api/common/[a-z-]*\.\(filter\|pipe\|decorator\)" apps/api/src` returns
  nothing (every common import now includes a subfolder segment).

#### Manual Verification:

- A request that triggers the Zod pipe and the exception filter still validates/serializes correctly.

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: `core/` bucket (+ CLI config path updates)

### Overview

Move the internal-infrastructure folders under `core/` and update the two CLI configs that hardcode
`./src/database` and `./src/auth`. This is the most-depended-on bucket (`database` 31 importers).

### Changes Required:

#### 1. Move infra folders into `core/`

**Files** (`git mv`): `database/` → `core/database/`; `auth/` → `core/auth/`; `crypto/` →
`core/crypto/`; `credential/` → `core/credential/`; `health/` → `core/health/`.

**Intent**: Group internal infrastructure (configured once, no outbound I/O) under `core/`.

**Contract**: Five folders now under `core/`; their internal cross-references (e.g. `credential` →
`crypto`, `auth` → `database`) rewritten to `@api/core/...`.

#### 2. Rewrite core consumers

**Files**: all importers of the moved folders — `database` (31), `auth` (9), `crypto` (7),
`credential` (7), `health` (4), including `app.module.ts` and all domain modules/services/specs.

**Intent**: Repoint every `@api/{database,auth,crypto,credential,health}/...` to `@api/core/...`.

**Contract**: No `@api/database/`, `@api/auth/`, `@api/crypto/`, `@api/credential/`, `@api/health/`
(without the `core/` segment) remains in `apps/api/src`.

#### 3. Update the two CLI configs (relative paths)

**Files**: `apps/api/drizzle.config.ts`, `apps/api/better-auth.config.ts`.

**Intent**: Update the hardcoded `./src/...` paths that the move breaks; keep them relative (external
CLIs may not resolve `@api/*`).

**Contract**: `drizzle.config.ts` → `schema: './src/core/database/schema/index.ts'`;
`better-auth.config.ts` → `import { createAuth } from './src/core/auth/create-auth'` and
`import { DatabaseConnection } from './src/core/database/providers/database-connection.provider'`.

### Success Criteria:

#### Automated Verification:

- Api lints: `npx nx lint api`
- Api unit tests pass: `npx nx test api`
- Api builds: `npx nx build api`
- Drizzle resolves with no new migration: `npx drizzle-kit generate` (from `apps/api`) emits nothing new.
- No stale infra paths: `grep -rn "@api/\(database\|auth\|crypto\|credential\|health\)/" apps/api/src`
  returns nothing.

#### Manual Verification:

- App boots, runs migrations on startup, and a Better-Auth login + a DB-backed read both work.
- `@better-auth/cli generate` runs without error and produces no schema diff.

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: `integrations/` bucket (`executor`)

### Overview

Move the SSH executor (the one external-system wrapper) under `integrations/`.

### Changes Required:

#### 1. Move executor

**File** (`git mv`): `executor/` → `integrations/executor/`.

**Intent**: Establish the `integrations/` boundary for outbound-system wrappers; relocate `executor`.

**Contract**: `executor/` now under `integrations/`; its internal references (e.g. `ssh.executor` →
`@api/core/credential`, `@api/modules/device` is not yet moved — still `@api/device` at this point)
rewritten as needed to current locations.

#### 2. Rewrite executor consumers

**Files**: the 15 importers — `skill` (skill-run service/specs + module), `service`
(service.service + specs + module), `diagnose` (service + specs + module).

**Intent**: Repoint every `@api/executor/...` to `@api/integrations/executor/...`.

**Contract**: No `@api/executor/` (without `integrations/`) remains in `apps/api/src`.

### Success Criteria:

#### Automated Verification:

- Api lints: `npx nx lint api`
- Api unit tests pass: `npx nx test api`
- Api builds: `npx nx build api`
- No stale paths: `grep -rn "@api/executor/" apps/api/src` returns nothing.

#### Manual Verification:

- A skill run / service scan that goes over SSH still executes against a device.

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 5: `modules/` bucket (all 6 domains, one pass)

### Overview

Move all 6 business domains into `modules/` in a single `git mv` set and rewrite every cross-domain
`@api/<domain>/...` segment at once — required because `audit` is injected by all others and
`diagnose` orchestrates `device`/`service`/`llm-provider`.

### Changes Required:

#### 1. Move all domains into `modules/`

**Files** (`git mv`): `audit/`, `device/` (incl. `device/credential/` sub-controller), `service/`,
`skill/`, `diagnose/`, `llm-provider/` → `modules/<domain>/`.

**Intent**: Group all business domains under `modules/`.

**Contract**: Six domain folders under `modules/`; each domain's internal references stay valid
(intra-domain imports are within the moved folder).

#### 2. Rewrite all domain consumers (incl. cross-domain edges)

**Files**: every importer of a domain — the cross-domain hub/orchestration edges (audit ← all 5;
diagnose → device/service/llm-provider; service ← skill-run/diagnose; device ← diagnose/executor),
plus `app.module.ts` (imports all 6 domain modules), plus `executor` (already in `integrations/`,
imports `@api/device` → must become `@api/modules/device`).

**Intent**: Repoint every `@api/{audit,device,service,skill,diagnose,llm-provider}/...` to
`@api/modules/<domain>/...` in one consistent pass.

**Contract**: No bare `@api/{audit,device,service,skill,diagnose,llm-provider}/` (without `modules/`)
remains anywhere in `apps/api/src`; `app.module.ts` imports all six via `@api/modules/...`.

### Success Criteria:

#### Automated Verification:

- Api lints: `npx nx lint api`
- Api unit tests pass: `npx nx test api`
- Api builds: `npx nx build api`
- No stale domain paths:
  `grep -rnE "@api/(audit|device|service|skill|diagnose|llm-provider)/" apps/api/src` returns nothing.

#### Manual Verification:

- Each domain's primary endpoint works end-to-end: device CRUD, service list, skill run (SSE stream),
  diagnose (LLM synthesis), llm-provider CRUD, audit log read.

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 6: Hoist `app.module.ts` to root + delete scaffold

### Overview

Move `app.module.ts` to `src/` root (idiomatic NestJS/Encore) and delete the Nx scaffold hello-world
(`app.controller.ts`/`app.service.ts` + specs), whose liveness role is already covered by `health/`.

### Changes Required:

#### 1. Hoist `app.module.ts`

**File** (`git mv`): `app/app.module.ts` → `src/app.module.ts`.

**Intent**: Place the root module at `src/` root; remove the `app/` folder.

**Contract**: `app.module.ts` at `src/app.module.ts`; its imports already use `@api/...` (from prior
phases) and resolve unchanged from the new location.

#### 2. Delete scaffold hello-world

**Files**: `app/app.controller.ts`, `app/app.controller.spec.ts`, `app/app.service.ts` (delete). Grep
confirmed only `main.ts` and these files reference `app/`; nothing imports the hello-world controller/
service outside `app/`.

**Intent**: Remove dead generated code superseded by `health/`.

**Contract**: No `app.controller`/`app.service` references remain; `app/` folder gone.

#### 3. Update `main.ts`

**File**: `apps/api/src/main.ts`.

**Intent**: Repoint the `AppModule` import to the hoisted location.

**Contract**: `import { AppModule } from './app.module'` (was `'./app/app.module'`); `main.ts` itself
does not move (webpack entry `./src/main.ts` unchanged).

### Success Criteria:

#### Automated Verification:

- Api lints: `npx nx lint api`
- Api unit tests pass: `npx nx test api`
- Api builds: `npx nx build api`
- `app/` folder gone: `test ! -d apps/api/src/app`.
- No scaffold refs: `grep -rn "app.controller\|app.service" apps/api/src` returns nothing.

#### Manual Verification:

- App boots from the hoisted `AppModule`; `health/` endpoint responds (liveness intact without the
  deleted scaffold route).

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 7: Final sweep

### Overview

Full-workspace verification, formatting, boundary-graph check, and a grep proving no relative imports
remain — closes the migration.

### Changes Required:

#### 1. Full verification + format

**Intent**: Confirm the whole monorepo is green (not just `api`) and formatting is clean after the
mass move.

**Contract**: `npm run lint`, `npm run test`, `npm run build` green; `npm run format` applied.

#### 2. Boundary graph + relative-import check

**Intent**: Confirm no new cross-project edges and no leftover relative imports in `apps/api/src`.

**Contract**: `npx nx graph` shows `api`/`web`/`shared` edges unchanged from baseline; grep finds no
cross-folder `../` import in `apps/api/src`.

### Success Criteria:

#### Automated Verification:

- Full lint: `npm run lint`
- Full test: `npm run test`
- Full build: `npm run build`
- Format clean: `npm run format:check`
- No cross-folder relative imports remain:
  `grep -rnE "from '\.\./" apps/api/src` returns nothing (or only documented same-leaf exceptions).

#### Manual Verification:

- `npx nx graph` reviewed — no new `api ↔ web` or `api ↔ shared` edges.
- Smoke test the running stack: login, device CRUD, service scan, skill run (SSE), diagnose, audit log.

**Implementation Note**: Final phase — confirm the full smoke test passes before closing the change.

---

## Testing Strategy

### Unit Tests:

- Existing `*.spec.ts` files move with their subjects; no test logic changes. Each phase's
  `npx nx test api` proves the moved specs still resolve and pass.
- P1's normalization is the explicit guard that `@api/*` resolves through both the vitest unit-test
  target (`nxViteTsPaths`) and the webpack `tsc` build before any move relies on it.

### Integration Tests:

- No new integration tests; the per-phase `npx nx build api` is the integration signal that the
  webpack/tsc build resolves every moved import.
- P3 adds two CLI-resolution checks (`drizzle-kit generate` emits no new migration;
  `@better-auth/cli generate` produces no schema diff) — the only consumers outside the tsconfig
  path-resolution context.

### Manual Testing Steps:

1. After P3, boot the app, confirm startup migrations run and a Better-Auth login + DB read work.
2. After P4, confirm an SSH-backed action (skill run / service scan) executes against a device.
3. After P5, exercise each domain's primary endpoint end-to-end (CRUD + SSE stream + LLM synthesis).
4. After P6, confirm the app boots from the hoisted `AppModule` and `health/` responds.
5. After P7, full smoke test across the running stack.

## Performance Considerations

None. The webpack bundle, DI graph, and runtime behavior are unchanged; only source-file locations
and import specifiers change.

## Migration Notes

- Use `git mv` for every move to preserve file history.
- One commit per phase (`refactor(api): …` — a no-release type per `.claude/rules/commit.md`; P1's
  alias addition may be `refactor(api): …` too since no behavior changes), each independently green
  and revertible.
- On Windows, if a `git mv` of a folder fails with `Permission denied`, run `npx nx reset` to release
  the Nx daemon's file-watchers, then retry (per `lessons.md`, hit during the web migration).
- `apps/api/migrations/` lives at the project root (outside `src/`) and is **not** part of this
  restructure.

## References

- Seed recommendation: `.ai/api-architecture-recommendation.md` (§4 target tree, §5 before→after map,
  §6 migration mechanics, §9 step order).
- Direct precedent (merged): `context/archive/2026-06-14-web-architecture-recommendation/plan.md`
  (alias-first, per-bucket, each-phase-green pattern; `.gitignore`/eslint addendum lessons).
- NestJS structure rule: `.claude/rules/nestjs.md` (feature modules; cross-cutting infra as shared
  modules; structure is a recommendation, not enforced).
- Contract flow (unchanged): `.claude/rules/contracts.md` (`@opspilot/shared` stays the single source
  of truth; `@api/*` is intra-app, independent of it).
- Audit-hub edge example: `apps/api/src/device/device.service.ts` imports `AuditService`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Path alias `@api/*` + full normalization (flat)

#### Automated

- [x] 1.1 Api lints: `npx nx lint api` — 4e77a0e
- [x] 1.2 Api unit tests pass: `npx nx test api` — 4e77a0e
- [x] 1.3 Api builds: `npx nx build api` — 4e77a0e

#### Manual

- [x] 1.4 Alias path string reads as a clear locator — 4e77a0e

### Phase 2: `common/` regrouping (`filters`/`pipes`/`decorators`)

#### Automated

- [x] 2.1 Api lints: `npx nx lint api` — fb14f66
- [x] 2.2 Api unit tests pass: `npx nx test api` — fb14f66
- [x] 2.3 Api builds: `npx nx build api` — fb14f66
- [x] 2.4 No stale common paths (every common import includes a subfolder segment) — fb14f66

#### Manual

- [x] 2.5 A request triggering the Zod pipe + exception filter still validates/serializes — fb14f66

### Phase 3: `core/` bucket (+ CLI config path updates)

#### Automated

- [x] 3.1 Api lints: `npx nx lint api`
- [x] 3.2 Api unit tests pass: `npx nx test api`
- [x] 3.3 Api builds: `npx nx build api`
- [x] 3.4 `npx drizzle-kit generate` emits no new migration
- [x] 3.5 No stale infra paths: `grep -rn "@api/\(database\|auth\|crypto\|credential\|health\)/" apps/api/src` empty

#### Manual

- [ ] 3.6 App boots, startup migrations run, Better-Auth login + DB read work
- [ ] 3.7 `@better-auth/cli generate` runs and produces no schema diff

### Phase 4: `integrations/` bucket (`executor`)

#### Automated

- [ ] 4.1 Api lints: `npx nx lint api`
- [ ] 4.2 Api unit tests pass: `npx nx test api`
- [ ] 4.3 Api builds: `npx nx build api`
- [ ] 4.4 No stale paths: `grep -rn "@api/executor/" apps/api/src` empty

#### Manual

- [ ] 4.5 An SSH-backed skill run / service scan still executes against a device

### Phase 5: `modules/` bucket (all 6 domains, one pass)

#### Automated

- [ ] 5.1 Api lints: `npx nx lint api`
- [ ] 5.2 Api unit tests pass: `npx nx test api`
- [ ] 5.3 Api builds: `npx nx build api`
- [ ] 5.4 No stale domain paths: `grep -rnE "@api/(audit|device|service|skill|diagnose|llm-provider)/" apps/api/src` empty

#### Manual

- [ ] 5.5 Each domain's primary endpoint works end-to-end (CRUD, SSE, LLM synthesis, audit read)

### Phase 6: Hoist `app.module.ts` to root + delete scaffold

#### Automated

- [ ] 6.1 Api lints: `npx nx lint api`
- [ ] 6.2 Api unit tests pass: `npx nx test api`
- [ ] 6.3 Api builds: `npx nx build api`
- [ ] 6.4 `app/` folder gone: `test ! -d apps/api/src/app`
- [ ] 6.5 No scaffold refs: `grep -rn "app.controller\|app.service" apps/api/src` empty

#### Manual

- [ ] 6.6 App boots from hoisted `AppModule`; `health/` endpoint responds

### Phase 7: Final sweep

#### Automated

- [ ] 7.1 Full lint: `npm run lint`
- [ ] 7.2 Full test: `npm run test`
- [ ] 7.3 Full build: `npm run build`
- [ ] 7.4 Format clean: `npm run format:check`
- [ ] 7.5 No cross-folder relative imports remain: `grep -rnE "from '\.\./" apps/api/src` empty

#### Manual

- [ ] 7.6 `npx nx graph` reviewed — no new cross-project edges
- [ ] 7.7 Full smoke test across the running stack passes
