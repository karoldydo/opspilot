# Restructure `apps/web` to a Feature-Sliced Architecture — Implementation Plan

## Overview

Migrate `apps/web/src/app` from a **layer-by-type** topology — where `core/clients/` and
`core/stores/` are two flat "god-folders" holding all 8 domains at once — to a **feature-sliced**
layout where each domain is one vertical slice under `features/<domain>/{data,dialogs,components}`.
`core/` is reduced to cross-cutting only (auth client+store, guards, interceptors); a new `shared/`
holds pure reusable code (the Zod→Angular validator bridge). A single `@app/*` path alias replaces
the `../../../` relative chains. The migration is purely mechanical, reversible per-domain (one
small green commit per slice), and performed with `git mv` to preserve history.

This change introduces **no logic, contract, or build-config changes** — it relocates files and
rewrites import specifiers only.

## Current State Analysis

The current tree (verified 2026-06-14, matches the seed `.ai/web-architecture-recommendation.md`
exactly):

- `core/clients/` — 14 files: 8 domains × `client.ts` (+ some `.spec`), flat.
- `core/stores/` — 15 files: 8 domains × `store.ts` (+ some `.spec`), flat.
- `core/guards/auth.guard.ts` (+spec), `core/interceptors/auth.interceptor.ts` (+spec),
  `core/validators/schema.validator.ts`.
- `features/` — thin route components per domain (`audit`, `devices`, `llm-providers`, `skills`),
  plus `services/` (2 sub-components + 3 dialogs), with dialogs sitting loose in each feature root.
- `auth/{login,register}/` and `home/` — route components currently outside `features/`.

**Key constraints discovered (verified by grep, 2026-06-14):**

- **No barrels exist** — `find apps/web/src -name index.ts` returns nothing. Imports go directly
  to the file via relative paths (e.g. `../clients/devices.client`). This stays a rule.
- **No cycles** — the vertical slice is self-contained: `*.client.ts` imports only
  `@opspilot/shared`; `*.store.ts` imports its own `*.client.ts`; the feature component `providers`
  both. Stores are `@Injectable` classes provided per-feature (e.g. `devices.component.ts:
  providers: [DevicesClient, DevicesStore]`), **not** `providedIn:'root'`. Moving a client+store
  pair into the domain folder is safe.
- **Verified cross-feature consumers** (the only ones, by grep):
  - `skill-run` client/store → consumed by `services/service-skills.component.ts` and
    `services/run-skill.dialog.ts` → lands in `features/services/data/`.
  - `diagnosis` client/store → consumed **only** by `services/device-services.component.ts` →
    lands in its own `features/diagnosis/data/` (decision below).
  - `devices.component.ts` imports `DeviceServicesComponent` from `../services/...` — this
    cross-feature import already exists and is acceptable; its path changes when `services` moves.
- **Importer sets to rewrite** (from grep): `core/clients/` is imported by 6 files; `core/stores/`
  by 18 files; `core/validators/` by 8 files; `auth.client`/`auth.store` by 10 files.
- **Nx boundaries untouched** — every move is an import **within** `scope:web`;
  `@nx/enforce-module-boundaries` only polices the `api ↔ web ↔ shared` line.
- **Build/test configs need no change** — `apps/web/tsconfig.app.json` and `tsconfig.spec.json`
  both `extends` `tsconfig.base.json`, so a `@app/*` alias added to base is inherited by the
  `@angular/build` builder, webpack, and the `@angular/build:unit-test` (vitest) target alike.

## Desired End State

`apps/web/src/app` is feature-sliced: `core/` holds only `auth/`, `guards/`, `interceptors/`;
`shared/validators/` holds `schema.validator.ts`; every domain lives under `features/<domain>/`
with `data/` (client+store+specs), `dialogs/`, and `components/` (where a domain has >1 component).
All route components (`auth`, `home`, and the domain components) sit under `features/`. Internal
imports use `@app/*`. `npm run lint && npm run test && npm run build` is green, `npm run format`
is clean, and `npx nx graph` shows no new cross-project edges.

### Key Discoveries:

- Target tree, placement rules, before→after file map, and step plan are fully specified in
  `.ai/web-architecture-recommendation.md` (§2–§7).
- The seed's consumer mapping (`.ai/...md` §3 table) is confirmed by independent grep.
- `device-form.dialog.ts` imports both `core/stores` and `core/validators`, so it is touched in
  both the validators phase (P3) and the devices phase (P4).
- Stores rely on relative imports to their client (`devices.store.ts:12 import { DevicesClient }
  from '../clients/devices.client'`) — these relative links break on move and must be rewritten to
  `@app/...` in the same step.

## What We're NOT Doing

- **No barrels** (`index.ts`) anywhere — not on `data/`, `dialogs/`, `components/`, per-feature,
  nor `shared/`. Direct file imports remain the rule (the `@app/*` alias removes the only reason to
  reach for them).
- **No logic, behavior, DI-scope, or contract changes** — stores stay per-feature `@Injectable`,
  Zod validation at the client boundary is untouched.
- **No build/test/lint config changes** beyond the single `@app/*` `paths` entry in
  `tsconfig.base.json`.
- **No `apps/api` or `libs/shared` changes** — this is `scope:web` only.
- **No multi-alias scheme** (`@core`/`@features`/`@shared`) — one `@app/*` only.
- **Not migrating away from relative imports wholesale in untouched files** — only files that move
  or whose imports break get rewritten to `@app/*`; opportunistic rewrites of unrelated imports are
  out of scope to keep each diff minimal.

## Implementation Approach

Strangle the god-folders domain by domain. Land the alias first (P1) so every subsequent move can
target `@app/...` immediately. Then peel off the two cross-cutting slices (`core/auth` P2,
`shared/validators` P3) since the most files depend on them. Then migrate the 8 domains in
dependency-safe order (P4–P8): `devices` → `services` (absorbing `skill-run`, with `diagnosis` as
its own data-only slice) → `skills` → `llm-providers` → `audit`. Move route screens last (P9), then
a final full-workspace sweep + format + graph check (P10). Each phase is one `git mv` set + import
rewrites + `npx nx lint web && npx nx test web && npx nx build web` + commit — independently green
and revertible.

## Critical Implementation Details

- **Timing & lifecycle (ordering dependency):** `devices.component.ts` imports
  `DeviceServicesComponent` from `services`. `devices` (P4) is migrated before `services` (P5), so
  after P4 the devices→services import is still `../services/device-services.component`; **P5 must
  rewrite that import in `devices.component.ts`** when `device-services.component` moves into
  `features/services/components/`. Conversely, the `services` slice consumes `diagnosis` and
  `skill-run` — both must already be in their target `data/` folders before P5's import rewrites
  resolve, so move them within P5 (skill-run into `services/data/`, diagnosis into
  `features/diagnosis/data/`) and rewrite consumers in the same phase.
- **Per-move relative-link breakage:** moving a `*.store.ts` breaks its relative import of its
  sibling `*.client.ts` (e.g. `../clients/x.client`). Rewrite the store's own import to `@app/...`
  in the same step as the move, not just the external consumers.

## Phase 1: Path alias `@app/*` + baseline

### Overview

Establish a clean green baseline, then add the `@app/*` alias and prove it resolves in both build
and test before any file moves.

### Changes Required:

#### 1. Baseline gate (no edit)

**Intent**: Confirm a clean starting point so any later red is attributable to the migration.

**Contract**: `git status` clean (ignoring this change's docs); `npx nx lint web && npx nx test web
&& npx nx build web` all green.

#### 2. Add the project alias

**File**: `tsconfig.base.json`

**Intent**: Add one project-wide path alias so internal `web` imports become move-resistant.

**Contract**: New entry in `compilerOptions.paths`, alongside the existing `@opspilot/shared` and
`@spartan-ng/*` entries:

```jsonc
"@app/*": ["./apps/web/src/app/*"]
```

#### 3. Resolution sanity-check

**File**: 1–2 existing imports (e.g. in `app.config.ts` or a feature component)

**Intent**: Swap one or two relative imports to `@app/...` and run the web test+build to confirm the
alias resolves through both the Angular builder and the vitest unit-test target before relying on it
for the bulk moves.

**Contract**: Chosen imports use `@app/...`; `npx nx test web && npx nx build web` green.

### Success Criteria:

#### Automated Verification:

- Web lints: `npx nx lint web`
- Web unit tests pass: `npx nx test web`
- Web builds: `npx nx build web`

#### Manual Verification:

- The alias path string reads as a clear layer indicator (`@app/core/...`, `@app/features/...`).

**Implementation Note**: After completing this phase and all automated verification passes, pause
for manual confirmation before proceeding.

---

## Phase 2: `core/auth/` slice

### Overview

Relocate the auth client+store (the only domain-bearing pair that legitimately stays in `core/`,
because the session is cross-cutting) into a `core/auth/` folder.

### Changes Required:

#### 1. Move auth data files

**Files**: `core/clients/auth.client.ts` → `core/auth/auth.client.ts`;
`core/stores/auth.store.ts` → `core/auth/auth.store.ts` (`git mv`).

**Intent**: Co-locate the cross-cutting auth client+store under `core/auth/`.

**Contract**: Both files live in `core/auth/`; `auth.client.ts`'s relative import of `auth.store`
(and vice-versa) rewritten to `@app/core/auth/...`.

#### 2. Rewrite auth consumers

**Files**: `app.config.ts`, `core/guards/auth.guard.ts` (+spec), `core/interceptors/auth.interceptor.ts`
(+spec), `auth/login/login.component.ts`, `auth/register/register.component.ts`,
`home/home.component.ts` (the verified `auth.client`/`auth.store` importers).

**Intent**: Point every auth-session consumer at the new `@app/core/auth/...` location.

**Contract**: All listed files import `AuthStore`/`auth client` via `@app/core/auth/...`; no
remaining reference to `core/stores/auth.store` or `core/clients/auth.client`.

### Success Criteria:

#### Automated Verification:

- Web lints: `npx nx lint web`
- Web unit tests pass: `npx nx test web`
- Web builds: `npx nx build web`
- No stale references: `grep -rn "core/stores/auth\|core/clients/auth" apps/web/src` returns nothing.

#### Manual Verification:

- Login, logout, and a guarded route still behave (session flow intact).

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: `shared/validators/`

### Overview

Move the pure, I/O-free Zod→Angular validator bridge out of `core/` into a new `shared/`.

### Changes Required:

#### 1. Move the validator

**File**: `core/validators/schema.validator.ts` → `shared/validators/schema.validator.ts` (`git mv`).

**Intent**: Establish `shared/` for pure reusable code; relocate `schema.validator.ts` there.

**Contract**: File at `shared/validators/schema.validator.ts`; `core/validators/` removed.

#### 2. Rewrite validator consumers

**Files**: the 8 verified importers — `auth/login/login.component.ts`,
`auth/register/register.component.ts`, `features/devices/device-form.dialog.ts`,
`features/llm-providers/llm-provider-form.dialog.ts`, `features/services/rename-service.dialog.ts`,
`features/services/run-skill.dialog.ts`, `features/skills/skill-form.dialog.ts`,
`features/skills/skill-form.validators.spec.ts`.

**Intent**: Point every form that bridges Zod into Angular validators at `@app/shared/validators/...`.

**Contract**: All 8 import via `@app/shared/validators/schema.validator`; no reference to
`core/validators` remains.

### Success Criteria:

#### Automated Verification:

- Web lints: `npx nx lint web`
- Web unit tests pass: `npx nx test web`
- Web builds: `npx nx build web`
- No stale references: `grep -rn "core/validators" apps/web/src` returns nothing.

#### Manual Verification:

- A form with validation (e.g. device form) still shows validation errors correctly.

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: Domain — `devices`

### Overview

First domain slice: prove the per-domain pattern end-to-end.

### Changes Required:

#### 1. Create `data/` and move client+store

**Files**: `core/clients/devices.client.ts` → `features/devices/data/devices.client.ts`;
`core/stores/devices.store.ts` (+`.spec`) → `features/devices/data/` (`git mv`).

**Intent**: Co-locate the devices data layer under its slice.

**Contract**: Files under `features/devices/data/`; `devices.store.ts`'s relative import of
`devices.client` rewritten to `@app/features/devices/data/devices.client`.

#### 2. Move the dialog

**File**: `features/devices/device-form.dialog.{ts,html}` → `features/devices/dialogs/` (`git mv`).

**Intent**: Group the domain's dialog under `dialogs/`.

**Contract**: Dialog at `features/devices/dialogs/device-form.dialog.*`.

#### 3. Rewrite devices consumers

**Files**: `features/devices/devices.component.ts` (imports devices client+store),
`features/devices/dialogs/device-form.dialog.ts` (imports devices store + the already-moved validator).

**Intent**: Point the devices component and dialog at the new `@app/features/devices/...` paths.

**Contract**: Both import devices `data/` via `@app/features/devices/data/...` and the dialog via
`@app/features/devices/dialogs/...`; no reference to `core/clients/devices` or `core/stores/devices`
remains. (The `devices.component` → `services/device-services` import stays untouched here; it is
rewritten in P5.)

### Success Criteria:

#### Automated Verification:

- Web lints: `npx nx lint web`
- Web unit tests pass: `npx nx test web`
- Web builds: `npx nx build web`
- No stale references: `grep -rn "core/.*devices" apps/web/src` returns nothing.

#### Manual Verification:

- `/devices` route loads, lists devices, and the device form dialog opens.

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 5: Domain — `services` (+ `skill-run`, + `diagnosis`)

### Overview

The largest slice: `services` absorbs `skill-run` (co-consumed), gets a `components/` and `dialogs/`
folder, and `diagnosis` is extracted into its own data-only feature. Re-grep `skill-run`/`diagnosis`
ownership before moving (per seed §7.4).

### Changes Required:

#### 1. Move `services` + `skill-run` data into `services/data/`

**Files**: `core/clients/services.client.ts` (+spec), `core/stores/services.store.ts` (+spec),
`core/clients/skill-run.client.ts` (+spec), `core/stores/skill-run.store.ts` (+spec) →
`features/services/data/` (`git mv`).

**Intent**: Co-locate both the services and skill-run data layers under the `services` slice (the
only consumers of `skill-run` are in `services`).

**Contract**: Four pairs under `features/services/data/`; each store's relative import of its client
rewritten to `@app/features/services/data/...`.

#### 2. Extract `diagnosis` into its own data-only slice

**Files**: `core/clients/diagnosis.client.ts` (+spec), `core/stores/diagnosis.store.ts` (+spec) →
`features/diagnosis/data/` (`git mv`).

**Intent**: Promote `diagnosis` (product north-star) to its own data-only feature with no route,
leaving room for a future replay screen.

**Contract**: Pair under `features/diagnosis/data/`; `diagnosis.store`'s import of `diagnosis.client`
rewritten to `@app/features/diagnosis/data/...`.

#### 3. Move services sub-components and dialogs

**Files**: `features/services/{device-services,service-skills}.component.{ts,html}` →
`features/services/components/`; `features/services/{scan-services,rename-service,run-skill}.dialog.*`
→ `features/services/dialogs/` (`git mv`).

**Intent**: Group the domain's >1 components under `components/` and its dialogs under `dialogs/`.

**Contract**: Two components under `components/`, three dialogs under `dialogs/`.

#### 4. Rewrite services + cross-feature consumers

**Files**: the moved components/dialogs (import services/skill-run/skills clients+stores, diagnosis
store, sibling dialogs) and **`features/devices/devices.component.ts`** (its
`DeviceServicesComponent` import path changes).

**Intent**: Point every consumer at the new `@app/features/services/...`, `@app/features/diagnosis/data/...`,
and (for skills client referenced by `service-skills`) `@app/features/skills/data/...` paths; update
`devices.component`'s cross-feature import to `@app/features/services/components/device-services.component`.

**Contract**: No reference to `core/.*services`, `core/.*skill-run`, or `core/.*diagnosis` remains;
`devices.component` imports `device-services` via `@app/features/services/components/...`. (Note:
`service-skills.component` imports the skills client/store, which still live in `core/` until P6 —
those specific imports are rewritten to `@app/features/skills/data/...` in P6, or temporarily kept
as `core/...` here and cleaned in P6; keep this phase green by rewriting only the paths whose targets
have already moved.)

### Success Criteria:

#### Automated Verification:

- Web lints: `npx nx lint web`
- Web unit tests pass: `npx nx test web`
- Web builds: `npx nx build web`
- No stale references: `grep -rn "core/.*\(services\|skill-run\|diagnosis\)" apps/web/src` returns nothing.

#### Manual Verification:

- `/devices` still renders the embedded device-services view; scan-services, rename-service, and
  run-skill dialogs open; a skill run still streams.

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 6: Domain — `skills`

### Overview

Move the skills data layer, dialog, and the dialog's validator spec into the `skills` slice; finish
any `service-skills`→skills imports left from P5.

### Changes Required:

#### 1. Move client+store into `data/`

**Files**: `core/clients/skills.client.ts` (+spec), `core/stores/skills.store.ts` (+spec) →
`features/skills/data/` (`git mv`).

**Intent**: Co-locate the skills data layer.

**Contract**: Pair under `features/skills/data/`; store→client import rewritten to `@app/...`.

#### 2. Move dialog + validator spec

**Files**: `features/skills/skill-form.dialog.{ts,html}` → `features/skills/dialogs/`;
`features/skills/skill-form.validators.spec.ts` → `features/skills/dialogs/` (`git mv`).

**Intent**: Group the skills dialog and its co-located validator spec under `dialogs/`.

**Contract**: Both under `features/skills/dialogs/`.

#### 3. Rewrite skills consumers

**Files**: `features/skills/skills.component.ts`, the moved `skill-form.dialog.ts`, and
`features/services/components/service-skills.component.ts` (its skills client/store import).

**Intent**: Point every skills consumer — including the cross-feature `service-skills` — at
`@app/features/skills/data/...` and `@app/features/skills/dialogs/...`.

**Contract**: No reference to `core/.*skills` remains anywhere.

### Success Criteria:

#### Automated Verification:

- Web lints: `npx nx lint web`
- Web unit tests pass: `npx nx test web`
- Web builds: `npx nx build web`
- No stale references: `grep -rn "core/.*skills" apps/web/src` returns nothing.

#### Manual Verification:

- `/skills` route loads, the skill form dialog opens and validates; `service-skills` view inside
  services still works.

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 7: Domain — `llm-providers`

### Overview

Move the llm-providers data layer and dialog into the slice.

### Changes Required:

#### 1. Move client+store into `data/`

**Files**: `core/clients/llm-providers.client.ts` (+spec), `core/stores/llm-providers.store.ts`
(+spec) → `features/llm-providers/data/` (`git mv`).

**Intent**: Co-locate the llm-providers data layer.

**Contract**: Pair under `features/llm-providers/data/`; store→client import rewritten to `@app/...`.

#### 2. Move dialog

**File**: `features/llm-providers/llm-provider-form.dialog.{ts,html}` →
`features/llm-providers/dialogs/` (`git mv`).

**Intent**: Group the domain's dialog under `dialogs/`.

**Contract**: Dialog under `features/llm-providers/dialogs/`.

#### 3. Rewrite consumers

**Files**: `features/llm-providers/llm-providers.component.ts`, the moved
`llm-provider-form.dialog.ts`.

**Intent**: Point both at `@app/features/llm-providers/...`.

**Contract**: No reference to `core/.*llm-providers` remains.

### Success Criteria:

#### Automated Verification:

- Web lints: `npx nx lint web`
- Web unit tests pass: `npx nx test web`
- Web builds: `npx nx build web`
- No stale references: `grep -rn "core/.*llm-providers" apps/web/src` returns nothing.

#### Manual Verification:

- `/llm-providers` route loads; the provider form dialog opens and saves.

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 8: Domain — `audit`

### Overview

Last domain slice: move the audit data layer into `data/` (audit has its route component in the
slice root, no dialogs).

### Changes Required:

#### 1. Move client+store into `data/`

**Files**: `core/clients/audit.client.ts` (+spec), `core/stores/audit.store.ts` (+spec) →
`features/audit/data/` (`git mv`).

**Intent**: Co-locate the audit data layer.

**Contract**: Pair under `features/audit/data/`; store→client import rewritten to `@app/...`. After
this phase, `core/clients/` and `core/stores/` are empty and removed.

#### 2. Rewrite consumer

**File**: `features/audit/audit.component.ts`.

**Intent**: Point the audit component at `@app/features/audit/data/...`.

**Contract**: No reference to `core/.*audit` remains; `core/clients/` and `core/stores/` directories
gone.

### Success Criteria:

#### Automated Verification:

- Web lints: `npx nx lint web`
- Web unit tests pass: `npx nx test web`
- Web builds: `npx nx build web`
- God-folders gone: `test ! -d apps/web/src/app/core/clients && test ! -d apps/web/src/app/core/stores`.

#### Manual Verification:

- `/audit` route loads and shows the history/timeline.

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 9: Route screens (`auth`, `home`) under `features/`

### Overview

Move the remaining top-level route components under `features/` and update lazy route imports.

### Changes Required:

#### 1. Move auth + home screens

**Files**: `auth/login/*`, `auth/register/*` → `features/auth/login/*`, `features/auth/register/*`;
`home/*` → `features/home/*` (`git mv`).

**Intent**: Bring every route component under `features/` for a uniform topology.

**Contract**: Screens under `features/auth/{login,register}/` and `features/home/`; their internal
imports (auth store, validators) already use `@app/...` from earlier phases — verify they still
resolve from the new location.

#### 2. Update route definitions

**File**: `apps/web/src/app/app.routes.ts`.

**Intent**: Repoint the `loadComponent` dynamic imports for `login`, `register`, and the `''` (home)
route at the new `features/...` paths.

**Contract**: All `loadComponent` imports resolve to `./features/auth/login/...`,
`./features/auth/register/...`, `./features/home/...` (the existing `./features/*` domain routes are
unchanged).

### Success Criteria:

#### Automated Verification:

- Web lints: `npx nx lint web`
- Web unit tests pass: `npx nx test web`
- Web builds: `npx nx build web`
- Old route dirs gone: `test ! -d apps/web/src/app/auth && test ! -d apps/web/src/app/home`.

#### Manual Verification:

- `/login`, `/register`, and `/` (home) all load via lazy `loadComponent`.

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 10: Final sweep

### Overview

Full-workspace verification, formatting, and a boundary graph check to close the migration.

### Changes Required:

#### 1. Full verification + format

**Intent**: Confirm the whole monorepo is green (not just `web`) and formatting is clean after the
mass move.

**Contract**: `npm run lint`, `npm run test`, `npm run build` green; `npm run format` applied.

#### 2. Boundary graph check

**Intent**: Visually confirm no new cross-project edges were introduced.

**Contract**: `npx nx graph` shows `web`/`api`/`shared` edges unchanged from baseline.

### Success Criteria:

#### Automated Verification:

- Full lint: `npm run lint`
- Full test: `npm run test`
- Full build: `npm run build`
- Format clean: `npm run format:check`
- No relative `core/clients`/`core/stores`/`core/validators` paths remain:
  `grep -rn "core/clients\|core/stores\|core/validators" apps/web/src` returns nothing.

#### Manual Verification:

- `npx nx graph` reviewed — no new `web ↔ api` or `web ↔ shared` edges.
- Smoke-test the running app: log in, visit each route, open a dialog, run a skill.

**Implementation Note**: Final phase — confirm the full smoke test passes before closing the change.

---

## Testing Strategy

### Unit Tests:

- The existing `*.spec.ts` files move with their subjects; no test logic changes. Each phase's
  `npx nx test web` proves the moved specs still resolve and pass.
- The alias-resolution sanity-check in P1 is the explicit guard that `@app/*` works in the vitest
  unit-test target before bulk moves rely on it.

### Integration Tests:

- No new integration tests; the per-phase `npx nx build web` is the integration signal that the
  Angular builder resolves every moved import and lazy route.

### Manual Testing Steps:

1. After each domain phase, load that domain's route and exercise its primary action + dialog.
2. After P5, specifically confirm the cross-feature `device-services` view renders inside `/devices`
   and a skill run still streams (SSE).
3. After P9, confirm all lazy routes (`/login`, `/register`, `/`) load.
4. After P10, full smoke test across every route.

## Performance Considerations

None. Lazy `loadComponent` boundaries are unchanged; tree-shaking is unaffected (no barrels added).

## Migration Notes

- Use `git mv` for every move to preserve file history.
- One commit per phase (`feat(web): ...` or `refactor(web): ...`), each independently green — a
  phase can be reverted without touching the others.
- On Windows, if a `git mv` of a folder fails with `Permission denied`, run `npx nx reset` to
  release the Nx daemon's file-watchers, then retry (per `lessons.md`).

## References

- Seed recommendation: `.ai/web-architecture-recommendation.md` (§2 target tree, §3 placement
  rules, §6 before→after map, §7 step plan, §8 open decisions — all resolved at recommended).
- Angular cohesion rule: `.claude/rules/angular.md` ("prefer feature/domain cohesion over
  layer-by-type").
- Contract flow (unchanged by this migration): `.claude/rules/contracts.md`.
- Existing cross-feature import precedent: `apps/web/src/app/features/devices/devices.component.ts:12`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Path alias `@app/*` + baseline

#### Automated

- [x] 1.1 Web lints: `npx nx lint web`
- [x] 1.2 Web unit tests pass: `npx nx test web`
- [x] 1.3 Web builds: `npx nx build web`

#### Manual

- [x] 1.4 Alias path string reads as a clear layer indicator

### Phase 2: `core/auth/` slice

#### Automated

- [ ] 2.1 Web lints: `npx nx lint web`
- [ ] 2.2 Web unit tests pass: `npx nx test web`
- [ ] 2.3 Web builds: `npx nx build web`
- [ ] 2.4 No stale auth references: `grep -rn "core/stores/auth\|core/clients/auth" apps/web/src` empty

#### Manual

- [ ] 2.5 Login, logout, and a guarded route still behave

### Phase 3: `shared/validators/`

#### Automated

- [ ] 3.1 Web lints: `npx nx lint web`
- [ ] 3.2 Web unit tests pass: `npx nx test web`
- [ ] 3.3 Web builds: `npx nx build web`
- [ ] 3.4 No stale references: `grep -rn "core/validators" apps/web/src` empty

#### Manual

- [ ] 3.5 A validated form still shows validation errors correctly

### Phase 4: Domain — `devices`

#### Automated

- [ ] 4.1 Web lints: `npx nx lint web`
- [ ] 4.2 Web unit tests pass: `npx nx test web`
- [ ] 4.3 Web builds: `npx nx build web`
- [ ] 4.4 No stale references: `grep -rn "core/.*devices" apps/web/src` empty

#### Manual

- [ ] 4.5 `/devices` loads, lists devices, device form dialog opens

### Phase 5: Domain — `services` (+ `skill-run`, + `diagnosis`)

#### Automated

- [ ] 5.1 Web lints: `npx nx lint web`
- [ ] 5.2 Web unit tests pass: `npx nx test web`
- [ ] 5.3 Web builds: `npx nx build web`
- [ ] 5.4 No stale references: `grep -rn "core/.*\(services\|skill-run\|diagnosis\)" apps/web/src` empty

#### Manual

- [ ] 5.5 device-services renders in `/devices`; scan/rename/run-skill dialogs open; skill run streams

### Phase 6: Domain — `skills`

#### Automated

- [ ] 6.1 Web lints: `npx nx lint web`
- [ ] 6.2 Web unit tests pass: `npx nx test web`
- [ ] 6.3 Web builds: `npx nx build web`
- [ ] 6.4 No stale references: `grep -rn "core/.*skills" apps/web/src` empty

#### Manual

- [ ] 6.5 `/skills` loads, dialog validates; `service-skills` view still works

### Phase 7: Domain — `llm-providers`

#### Automated

- [ ] 7.1 Web lints: `npx nx lint web`
- [ ] 7.2 Web unit tests pass: `npx nx test web`
- [ ] 7.3 Web builds: `npx nx build web`
- [ ] 7.4 No stale references: `grep -rn "core/.*llm-providers" apps/web/src` empty

#### Manual

- [ ] 7.5 `/llm-providers` loads; provider form dialog opens and saves

### Phase 8: Domain — `audit`

#### Automated

- [ ] 8.1 Web lints: `npx nx lint web`
- [ ] 8.2 Web unit tests pass: `npx nx test web`
- [ ] 8.3 Web builds: `npx nx build web`
- [ ] 8.4 God-folders gone: `core/clients` and `core/stores` removed

#### Manual

- [ ] 8.5 `/audit` loads and shows the history/timeline

### Phase 9: Route screens (`auth`, `home`) under `features/`

#### Automated

- [ ] 9.1 Web lints: `npx nx lint web`
- [ ] 9.2 Web unit tests pass: `npx nx test web`
- [ ] 9.3 Web builds: `npx nx build web`
- [ ] 9.4 Old route dirs gone: `app/auth` and `app/home` removed

#### Manual

- [ ] 9.5 `/login`, `/register`, and `/` load via lazy `loadComponent`

### Phase 10: Final sweep

#### Automated

- [ ] 10.1 Full lint: `npm run lint`
- [ ] 10.2 Full test: `npm run test`
- [ ] 10.3 Full build: `npm run build`
- [ ] 10.4 Format clean: `npm run format:check`
- [ ] 10.5 No relative god-folder paths remain in `apps/web/src`

#### Manual

- [ ] 10.6 `npx nx graph` reviewed — no new cross-project edges
- [ ] 10.7 Full smoke test across every route passes
