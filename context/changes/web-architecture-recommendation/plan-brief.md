# Restructure `apps/web` to a Feature-Sliced Architecture — Plan Brief

> Full plan: `context/changes/web-architecture-recommendation/plan.md`
> Seed recommendation: `.ai/web-architecture-recommendation.md`

## What & Why

`apps/web` groups files by *technical role* — `core/clients/` and `core/stores/` are two flat
"god-folders" holding all 8 domains at once, growing linearly and becoming unnavigable. This change
restructures the app to **feature-sliced**: one vertical slice per domain under
`features/<domain>/{data,dialogs,components}`, with `core/` reduced to cross-cutting concerns only.
This aligns the code with the repo's own `angular.md` rule ("prefer feature/domain cohesion over a
layer-by-type topology").

## Starting Point

Angular 21 SPA (standalone, signals, NgRx SignalStore, spartan/ng, Tailwind v4). All roadmap slices
done. Today: 8 domains' client+store pairs sit in two flat `core/` folders; dialogs sit loose in
each feature root; `auth/` and `home/` route components live outside `features/`; imports are
relative (`../../../`), no barrels exist.

## Desired End State

Each domain is a self-contained slice under `features/<domain>/` (`data/` for client+store+specs,
`dialogs/`, `components/`). `core/` holds only `auth/`, `guards/`, `interceptors/`; `shared/` holds
the pure Zod→Angular validator bridge. All route components live under `features/`. Internal imports
use a new `@app/*` alias. No logic, contract, or build-config changes — files relocated only.

## Key Decisions Made

| Decision                    | Choice                                   | Why (1 sentence)                                                                      | Source |
|-----------------------------|------------------------------------------|---------------------------------------------------------------------------------------|--------|
| Topology                    | Feature-sliced vertical slices           | Matches `angular.md`; fixes the unnavigable flat god-folders                          | Seed   |
| Path alias                  | Single `@app/*` in `tsconfig.base.json`  | One move-resistant alias, inherited by build + vitest; simplest to maintain           | Seed   |
| Barrels                     | None                                     | Avoids cycles, keeps explicit dep graph; alias removes the reason for them            | Seed   |
| `diagnosis` slice           | Own data-only `features/diagnosis/data/` | Promotes the product north-star as a distinct domain, room for a future replay screen | Plan   |
| `device-services` component | Stays in `features/services/components/` | Component lives with its data (`services`); cross-feature import already exists       | Plan   |
| `auth` + `home` screens     | All under `features/`                    | Uniform topology — every route component under `features/`                            | Plan   |
| Migration mechanism         | `git mv`, one green commit per phase     | Preserves history; reversible per-domain                                              | Seed   |

## Scope

**In scope:** add `@app/*` alias; move 8 domains' client+store into `features/<domain>/data/`; move
dialogs into `dialogs/`, sub-components into `components/`; relocate `core/auth`, `shared/validators`,
and `auth`/`home` route screens; rewrite affected imports to `@app/*`; update `app.routes.ts`.

**Out of scope:** any logic/contract/DI-scope change; build/test/lint config beyond the one `paths`
entry; `apps/api` or `libs/shared`; barrels; opportunistic rewrites of unrelated imports.

## Architecture / Approach

Strangle the god-folders domain by domain. Alias first (P1), then the two cross-cutting slices
(`core/auth` P2, `shared/validators` P3 — the most-depended-on files), then the 8 domains in
dependency-safe order (devices → services(+skill-run,+diagnosis) → skills → llm-providers → audit),
then route screens (P9), then a full-workspace sweep (P10). Every phase = `git mv` + import rewrites

+ `npx nx lint/test/build web` + commit. All moves are within `scope:web`, so Nx boundaries are
  untouched and configs need no change.

## Phases at a Glance

| Phase                                 | What it delivers                    | Key risk                                                       |
|---------------------------------------|-------------------------------------|----------------------------------------------------------------|
| 1. Alias + baseline                   | `@app/*` resolves in build + test   | Alias not picked up by vitest target → sanity-checked in-phase |
| 2. `core/auth/`                       | Auth client+store relocated         | Session flow regression (10 importers)                         |
| 3. `shared/validators/`               | Validator bridge moved              | Form validation regression (8 importers)                       |
| 4. `devices`                          | First domain slice                  | Establishes the pattern                                        |
| 5. `services` (+skill-run,+diagnosis) | Largest slice + diagnosis extracted | Cross-feature `devices→services` import must be rewritten here |
| 6. `skills`                           | Skills slice                        | `service-skills`→skills import finished here                   |
| 7. `llm-providers`                    | Providers slice                     | Routine                                                        |
| 8. `audit`                            | Last slice; god-folders deleted     | Confirms `core/clients`+`core/stores` empty                    |
| 9. Route screens                      | `auth`/`home` under `features/`     | Lazy `loadComponent` path updates in `app.routes.ts`           |
| 10. Final sweep                       | Full green + format + graph         | Catches any missed reference monorepo-wide                     |

**Prerequisites:** clean `git status` and green `npx nx lint/test/build web` baseline.
**Estimated effort:** ~1 focused session; 10 small commits, each independently green.

## Open Risks & Assumptions

- A moved `*.store.ts` breaks its relative import of its sibling `*.client.ts` — must be rewritten
  in the same step, not just external consumers.
- Phase ordering: `devices` (P4) precedes `services` (P5), so P5 must rewrite the
  `devices.component → device-services` cross-feature import when that component moves.
- Assumes the seed's grep-verified consumer mapping is still current (re-grep `skill-run`/`diagnosis`
  before P5, per the seed).

## Success Criteria (Summary)

- Every route (`/login`, `/register`, `/`, `/devices`, `/services` views, `/skills`,
  `/llm-providers`, `/audit`) loads and its primary action + dialogs work.
- `npm run lint && npm run test && npm run build` green; `npm run format:check` clean.
- `core/clients/` and `core/stores/` no longer exist; `npx nx graph` shows no new cross-project edges.
