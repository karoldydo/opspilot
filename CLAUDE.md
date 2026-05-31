# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

OpsPilot is a self-hosted homelab ops tool. The repo is an **Nx 22 monorepo (npm)** with two TypeScript apps and one shared library:

- `apps/web` — Angular 21 SPA (standalone components, `@angular/build` application builder, scss styles).
- `apps/api` — NestJS 11 service, built with webpack via `@nx/webpack`, global route prefix `/api`, default port `3000`.
- `libs/shared` — framework-agnostic pure-TS library exposed as `@opspilot/shared` (path alias in `tsconfig.base.json`), consumed by both `api` and `web`.

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
- Angular components use the `app-` prefix (set in `apps/web/project.json`). Component styles default to scss (`nx.json` `generators`), but the target styling direction is Tailwind v4 utilities + spartan/ng primitives — see `.claude/rules/tailwind.md` and `.claude/rules/spartan.md`.
- Commit subjects follow conventional-commit style with a lower-case type prefix (`chore: …`, `feat: …`) — match the existing history.

## AI rule files

Per-area guidance lives in `.claude/rules/*.md`. Files with a `paths:` frontmatter auto-attach
when you touch a matching file; files without it (e.g. `commit.md`, `shell.md`) are always on.
**One file per technology** — keep a rule in its own file rather than duplicating it across areas.

- **`contracts.md`** — the load-bearing rule: every request/response shape and domain type is a
  Zod schema defined **once** in `@opspilot/shared`; `api` and `web` consume it via `z.infer` and
  never redefine shapes. Each app's folder structure follows its own framework conventions; the
  shared contract is the binding rule. Read this before adding any type that crosses the FE↔BE
  boundary.
- Framework: `angular.md`, `nestjs.md`, `shared-library.md`. Cross-cutting tech: `zod.md`,
  `drizzle.md`, `better-auth.md`, `tailwind.md`, `spartan.md`, `vercel-ai-sdk.md`, `sse.md`,
  `node-ssh.md`. Workflow: `comments.md`, `commit.md`, `shell.md`, `ssh.md`.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 2, Lesson 2

Turn one roadmap item into the first implementation cycle with the **change planning chain**:

```
/10x-roadmap -> /10x-new -> /10x-plan -> /10x-plan-review -> /10x-implement
```

`/10x-new`, `/10x-plan`, `/10x-plan-review`, and `/10x-implement` are the lesson focus. `/10x-frame` and `/10x-research` are not required rituals here; they are escalation paths introduced in the next lesson.

### Task Router - Where to start

| Skill                                  | Use it when                                                                                                                                                                                                                                                          |
|----------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Change setup (lesson focus)**        |                                                                                                                                                                                                                                                                      |
| `/10x-new <change-id>`                 | You selected a roadmap item and need a stable change folder. Creates `context/changes/<change-id>/change.md` so planning, implementation, progress, commits, and later review all share one identity. Use AFTER roadmap selection, BEFORE `/10x-plan`.               |
| **Planning (lesson focus)**            |                                                                                                                                                                                                                                                                      |
| `/10x-plan <change-id>`                | You have a change folder and need a reviewable implementation plan. Reads roadmap context, foundation docs, codebase evidence, and any existing change notes; writes `plan.md` and `plan-brief.md` with phases, file contracts, success criteria, and `## Progress`. |
| **Plan readiness (lesson focus)**      |                                                                                                                                                                                                                                                                      |
| `/10x-plan-review <change-id>`         | You have `plan.md` and need a light pre-code readiness check. Use it to catch missing end state, weak contracts, malformed progress, scope drift, or blind spots before code changes begin.                                                                          |
| **Implementation (lesson focus)**      |                                                                                                                                                                                                                                                                      |
| `/10x-implement <change-id> phase <n>` | You have an approved plan and want to execute one phase with verification, manual gate, commit ritual, and SHA write-back to `## Progress`.                                                                                                                          |
| **Lifecycle closure**                  |                                                                                                                                                                                                                                                                      |
| `/10x-archive <change-id>`             | A change is merged or intentionally closed. Move it out of active `context/changes/` into archive state.                                                                                                                                                             |

### How the chain hands off

- `/10x-new` creates the durable change identity.
- `/10x-plan` turns that identity into an implementation contract.
- `/10x-plan-review` checks the plan before the agent mutates code.
- `/10x-implement` executes one planned phase, verifies, asks for manual confirmation when needed, commits, and records progress.

### Lesson boundaries

- Plan is the default router after roadmap selection. Start with `/10x-plan` unless the problem is unclear or external evidence is blocking.
- Do not run `/10x-frame + /10x-research` as ceremony for every change.
- Do not turn this lesson into a full end-to-end product build. A checkpoint with a planned and partially or fully implemented stream is valid.
- Code review of the implemented diff belongs to Lesson 3 via `/10x-impl-review`.
- Lifecycle closure via `/10x-archive` after a change is merged or intentionally closed.

### Paths used by this lesson

- `context/foundation/roadmap.md` - upstream roadmap
- `context/changes/<change-id>/change.md` - change identity
- `context/changes/<change-id>/plan.md` - implementation contract
- `context/changes/<change-id>/plan-brief.md` - compressed handoff
- `context/foundation/lessons.md` - recurring rules and pitfalls
- `docs/reference/contract-surfaces.md` - load-bearing names registry

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
