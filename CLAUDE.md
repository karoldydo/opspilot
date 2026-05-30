# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

OpsPilot is a self-hosted homelab ops tool. The repo is an **Nx 22 monorepo (npm)** with two TypeScript apps and one shared library:

- `apps/web` — Angular 21 SPA (standalone components, `@angular/build` application builder, scss styles).
- `apps/api` — NestJS 11 service, built with webpack via `@nx/webpack`, global route prefix `/api`, default port `3000`.
- `libs/shared` — pure-TS library exposed as `@opspilot/shared` (path alias in `tsconfig.base.json`).

The PRD/tech-stack hand-off in `@context/foundation/prd.md` and `@context/foundation/tech-stack.md` describes the *target* stack (Drizzle + SQLite, spartan/ng + Tailwind v4, Vercel AI SDK, Better Auth, node-ssh, SSE, Playwright). Most of those are not yet wired up — the current source tree is the Nx scaffold output plus the shared lib. Treat the foundation docs as direction, not as already-implemented architecture.

## Commands

All commands are run from the repo root via npm scripts that wrap `nx`:

| Task                              | Command                                                      |
|-----------------------------------|--------------------------------------------------------------|
| Run everything in dev (web + api) | `npm start`                                                  |
| Serve a single app                | `npm run start:web` / `npm run start:api`                    |
| Build everything                  | `npm run build`                                              |
| Build single app                  | `npm run build:web` / `npm run build:api`                    |
| Lint / test all projects          | `npm run lint` / `npm run test`                              |
| Format (prettier via Nx)          | `npm run format` (write) / `npm run format:check`            |
| Affected-only variants            | `npm run affected:build` / `affected:test` / `affected:lint` |
| Project graph                     | `npm run graph`                                              |

Targeting a single project or test:

- One project, one target: `npx nx <target> <project>` — e.g. `npx nx test api`, `npx nx lint web`, `npx nx serve api`.
- One vitest file: `npx nx test api -- src/app/app.controller.spec.ts` (api uses standalone vitest; web uses `@angular/build:unit-test` and also accepts a file path after `--`).
- Inspect a project's resolved targets: `npx nx show project <name> --web`.

Nx caching is enabled for `build`, `lint`, `test`, and the esbuild/tsc/vitest targets (see `nx.json`). If you see stale output, `npx nx reset` clears the daemon and cache.

## Architecture notes that aren't obvious from the file tree

- **Module boundaries are enforced by ESLint, not just convention.** `eslint.config.mjs` configures `@nx/enforce-module-boundaries` with three scope tags declared in each project's `project.json`:
  - `scope:shared` → may depend on `scope:shared` only.
  - `scope:api` → may depend on `scope:api` + `scope:shared`.
  - `scope:web` → may depend on `scope:web` + `scope:shared`.
    Adding a new lib means picking a tag and editing the `depConstraints` block if it introduces a new scope. Crossing the api ↔ web line is a lint error by design.
- **Shared code goes through the `@opspilot/shared` path alias** (declared in `tsconfig.base.json`, re-exported from `libs/shared/src/index.ts`). Don't import shared via relative `../../../libs/shared` paths — the alias is what the Nx vite/webpack plugins and ts-paths resolve.
- **Two different test runners live side-by-side.** `apps/api` and `libs/shared` use plain Vitest with `@nx/vite` config (see `apps/api/vitest.config.mts`). `apps/web` uses `@angular/build:unit-test` (Vitest under the hood, but configured by the Angular builder, not a `vitest.config.*` file). The `vitest.workspace.ts` at the root only picks up files matching `vite.config.*` / `vitest.config.*`, so the web project's unit tests are driven through the Angular target, not the workspace glob.
- **The api build is webpack, not esbuild.** `apps/api/webpack.config.js` uses `NxAppWebpackPlugin` with `target: 'node'`, `generatePackageJson: true`, and emits to `dist/apps/api`. The `serve` target runs the built bundle via `@nx/js:node` and `dependsOn: ['build']`, so a serve will rebuild first.
- **The api has post-build "prune" targets** (`prune-lockfile`, `copy-workspace-modules`, `prune`) intended to produce a deployable `dist/apps/api/` with its own trimmed `package.json` and lockfile — relevant when packaging for the container build called out in the tech-stack doc.

## Conventions

- Prettier with `singleQuote: true` (see `.prettierrc`); `.editorconfig` sets 2-space indent, LF, final newline. Run `npm run format` before committing if you've touched many files.
- Angular components use the `app-` prefix (set in `apps/web/project.json`) and scss styles (`nx.json` `generators` defaults).
- Commit subjects follow conventional-commit style with a lower-case type prefix (`chore: …`, `feat: …`) — match the existing history.
- Windows is the primary dev environment (PowerShell). Use forward slashes in code and avoid hard-coding `\` path separators in TS; the Nx plugins handle path normalization.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 2, Lesson 1

Move from sprint-zero setup to project orchestration with the **roadmap chain**:

```
(Module 1 foundation docs) -> /10x-roadmap -> backlog-ready roadmap items
```

`/10x-roadmap` is the lesson focus. `/10x-new` is intentionally introduced in Module 2, Lesson 2, when a selected roadmap item becomes an implementation change folder.

### Task Router - Where to start

| Skill                                                                                                                   | Use it when                                                                                                                                                                                                                                                                                                                                                                                |
|-------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Roadmap (lesson focus)**                                                                                              |                                                                                                                                                                                                                                                                                                                                                                                            |
| `/10x-roadmap`                                                                                                          | You have `context/foundation/prd.md` and a scaffolded project baseline, and you need a vertical-first MVP roadmap. The skill reads the PRD, inspects the code baseline, uses available foundation docs such as `tech-stack.md`, `infrastructure.md`, and `deploy-plan.md`, then writes `context/foundation/roadmap.md`. Use it BEFORE creating per-change folders or implementation plans. |
| **Re-run upstream if needed**                                                                                           |                                                                                                                                                                                                                                                                                                                                                                                            |
| `/10x-shape` / `/10x-prd` / `/10x-tech-stack-selector` / `/10x-bootstrapper` / `/10x-agents-md` / `/10x-infra-research` | Bundled from Module 1 so foundation contracts can be fixed before roadmap sequencing. If roadmap generation exposes a PRD gap, repair the PRD before pretending the backlog is ready.                                                                                                                                                                                                      |

### How the chain hands off

- `/10x-roadmap` bridges product and implementation. It does not choose frameworks, design schemas, or write a per-change implementation plan.
- The output is `context/foundation/roadmap.md`: ordered milestones, vertical slices, bounded foundations, dependencies, unknowns, risk, and backlog handoff fields.
- Roadmap items should receive stable human-readable identifiers in backlog tools. The actual `context/changes/<change-id>/` folder is created in Lesson 2 with `/10x-new`.

### Roadmap boundaries

- Default to vertical slices: user-visible outcomes that cross UI, data, business logic, and integrations.
- Horizontal work is allowed only as a bounded enabler that names the downstream vertical milestone it unlocks.
- Avoid orphan horizontal work such as "build the whole database", "build all API endpoints", or "design the whole UI" before the first user-visible flow.
- Roadmap is not a calendar estimate. Do not invent dates, story points, or sprint velocity unless the user explicitly asks for a separate planning artifact.

### Foundation paths used by this lesson

- `context/foundation/prd.md` - input
- `context/foundation/tech-stack.md` - optional input
- `context/foundation/infrastructure.md` - optional input
- `context/deployment/deploy-plan.md` - optional input
- `context/foundation/roadmap.md` - output
- `context/foundation/lessons.md` - recurring rules and pitfalls
- `docs/reference/contract-surfaces.md` - load-bearing names registry

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
