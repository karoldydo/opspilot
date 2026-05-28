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

## 10xDevs AI Toolkit — Module 1, Lesson 4

Onboard the agent to the project you scaffolded in Lesson 3 with the **agent-context chain**:

```
(/10x-init  →  /10x-shape  →  /10x-prd  →  /10x-tech-stack-selector  →  /10x-bootstrapper)  →  /10x-agents-md  →  /10x-rule-review  →  /10x-lesson
```

The PRD → tech-stack → bootstrap chain ships from Lessons 1–3 (re-included so you can fix the project mid-flight). `/10x-agents-md`, `/10x-rule-review`, and `/10x-lesson` are the lesson's main topics. The chain extends in Lesson 5 to the infra/deploy step.

### Task Router — Where to start

| Skill                                                                                                                                  | Use it when                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
|----------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Agent context (lesson focus)**                                                                                                       |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `/10x-agents-md`                                                                                                                       | The repo is scaffolded but the agent has no project-specific onboarding. Inspects the repo (package manifest, README, scripts, lint/test config, layout, commit history) and writes a concise, ordered "Repository Guidelines" to `AGENTS.md` (or, when invoked from a subdirectory, a directory-level `AGENTS.md` reframed around local conventions and the dominant unit). Use as an alternative to the host's built-in `/init` or as a fallback for tools without one. Repo-level body targets ~200 lines; directory-level guides target 120–250 words. |
| `/10x-rule-review <path>`                                                                                                              | You have a rules-for-AI file (`AGENTS.md`, `CLAUDE.md`, `.cursor/rules/*.mdc`, `.github/copilot-instructions.md`, `.windsurfrules`, nested per-area files) and want a 5-axis scorecard: length, embedded code/config snippets, precision of language, redundancy with public knowledge, and rule ordering. Tool-agnostic — scores the artifact's condition, not the project. Default output is read-only; only Check 5 (reorder) may edit, and only with explicit approval.                                                                                |
| `/10x-lesson [seed]`                                                                                                                   | You spotted a recurring rule worth surfacing for future runs of `/10x-frame`, `/10x-research`, `/10x-plan`, `/10x-plan-review`, `/10x-implement`, and `/10x-impl-review`. Appends a single entry (Context / Problem / Rule / Applies to) to `context/foundation/lessons.md`. Self-bootstraps the file with the canonical `# Lessons Learned` header on first use. Append-only — never reorders or rewrites prior entries.                                                                                                                                  |
| **Re-run upstream if needed**                                                                                                          |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `/10x-init` / `/10x-shape` / `/10x-prd` / `/10x-tech-stack-selector` / `/10x-bootstrapper` / `/10x-stack-assess` / `/10x-health-check` | Bundled so you can fix the PRD, swap the stack, or re-scaffold mid-flight. If `/10x-rule-review` flags a `FAIL` you can't shrink your way out of, that often points back to ambiguous PRD or stack decisions — re-run the upstream skill rather than padding `AGENTS.md` with corrections.                                                                                                                                                                                                                                                                 |

### How the chain hands off

- `/10x-agents-md` writes (or surgically updates) `AGENTS.md` at the resolved scope. Repo-level scope = the file lives at the repo root and frames the project as a whole; directory-level scope = the file lives next to the code it governs and reframes around the local unit, dropping repo-wide framing entirely. The skill never silently overwrites — it switches to an update flow when the target exists.
- `/10x-rule-review` reads any rules-for-AI markdown file you point it at and prints a 5-check scorecard (`OK` / `WARN` / `FAIL`) with concrete fixes. It does not depend on `/10x-agents-md` having run; you can review `.cursor/rules/`, copilot instructions, or a hand-written `CLAUDE.md` the same way.
- `/10x-lesson` self-bootstraps `context/foundation/lessons.md` on first use, then appends one Context/Problem/Rule/Applies-to entry per invocation. The file is consumed as a prior by the planning- and review-phase skills introduced later in the workflow — `/10x-frame`, `/10x-research`, `/10x-plan`, `/10x-plan-review`, `/10x-implement`, `/10x-impl-review`.

### What the lesson's skills capture (and what they do NOT)

- **`/10x-agents-md` captures**: project structure, build/test/lint commands actually present in scripts, commit conventions inferred from history, repo-specific tripwires the agent would otherwise miss, references to canonical files via `@`-paths instead of pasting their content. Directory-level scope additionally captures: local naming/layout patterns inferred from siblings, allowed/forbidden imports, the test pattern used by neighbours, and tripwires visible in the immediate area.
- **`/10x-agents-md` does NOT** paste in the contents of `tsconfig.json` / `eslint.config` / framework docs the agent already knows; it does NOT generate generic "write clean code" intentions; it does NOT replace the host's built-in `/init` when one exists — it's positioned as an alternative or fallback, not a default.
- **`/10x-rule-review` captures**: a length verdict (OK ≤ 200 non-empty lines, WARN 201–500, FAIL 501+), code/config blocks that should be `@`-references instead, vague-intention language, redundancy with framework docs the agent already has from training, and a Check 5 reorder proposal that surfaces critical rules to the top.
- **`/10x-rule-review` does NOT** edit the file by default; it does NOT score project content (architecture, stack choices) — it scores the rule artifact's condition; it does NOT generate a "fixed version" of the file (Check 5 may move sections with explicit approval, never rewrite rule wording).
- **`/10x-lesson` captures**: one entry per invocation with a short imperative H2 title (the title IS the rule), Context (subsystem / phase / file pattern, specific enough to pattern-match), Problem (what concretely breaks without the rule, ideally with a past incident), Rule (1–2 imperative sentences pasteable verbatim into a future review finding), Applies to (subset of `frame`, `research`, `plan`, `plan-review`, `implement`, `impl-review`, or `all`).
- **`/10x-lesson` does NOT** edit or remove existing lessons — the file is append-only by design (rewriting recurring rules without thought is the failure mode this convention prevents); it does NOT batch multiple rules per invocation; it does NOT pre-fill fields proactively (the user does the writing — that's the price of capturing rules outside a structured review).

### The inclusion test (the filter for AGENTS.md / CLAUDE.md)

Before you add a rule to any rules-for-AI file, ask: *could the agent know this without this file? Could public training data — books, blogs, repos in this stack — have prepared it for this?* If yes, drop it. If no, keep it. The file is onboarding for an agent that already knows TypeScript / Python / your framework but does NOT know your local conventions.

Belongs:

- non-obvious project conventions (error-response shape, file naming, allowed import paths)
- project-specific traps and "embarrassing" workarounds tied to history or dependency bugs
- referenced canonical files via `@`-paths (e.g. `@src/features/users/user.service.ts` as a pattern reference, not pasted code)

Does NOT belong:

- mainstream framework documentation
- README content the agent will read anyway (link with `@README.md`)
- popular generic advice ("use TypeScript strict mode") that's already enforced by config
- intention statements ("write clean code", "follow good practices") — convert to a checkable behaviour or drop

### U-shaped attention and granular rules

LLMs attend most strongly to the start and end of context (Lost-in-the-Middle / U-shaped attention). A long monolithic `CLAUDE.md` puts its middle rules in the weakest attention zone. Two practical consequences:

1. **Most important rules go to the top** of any rule file.
2. **Per-area rules belong next to their code** — nested `AGENTS.md` / `CLAUDE.md` inside `src/api/`, `.cursor/rules/*.mdc` with file globs, etc. Granular files are loaded selectively and arrive whole near the start of their own section, instead of being buried at line 400 of one big file.

`/10x-rule-review` Check 5 (reorder) operationalizes consequence (1); the inclusion test plus directory-level `/10x-agents-md` operationalizes consequence (2).

### The five-pattern calibration drill

Before writing a rule, validate that the agent actually breaks the convention without it. Pick one pattern from your project (error-response shape, file naming, import style, module structure, date handling). Then:

1. Ask the agent to implement against the pattern 3–5 times from a clean state, no rule.
2. Note where it broke the convention; capture run time, files explored, and visible cost/tokens if the host surfaces them.
3. Add a 1–3-sentence rule to the appropriate scope (root or area-level).
4. Re-run the same task in a fresh session and compare convention adherence, time, files, and iterations.

If the agent already trends toward the convention without the rule, you don't need the rule. If it systematically picks the wrong pattern, you've found a high-leverage rule to add. This drill is what "earning a rule from a recurring failure" actually looks like.

### Hierarchy and tool interop

- **Claude Code** loads `CLAUDE.md` from the user dir (`~/.claude/CLAUDE.md`), the repo root, and any subdirectory the agent works under. Deeper files override or supplement higher ones.
- **Codex** and **GitHub Copilot** load `AGENTS.md` from the current directory upward — closest file wins.
- One canonical file is preferable to three duplicates. A common pattern: `AGENTS.md` as source of truth, `CLAUDE.md` as a thin Claude-Code shim with `@AGENTS.md` import, `.github/copilot-instructions.md` only if Copilot needs its own additions. Symlink (`ln -s AGENTS.md CLAUDE.md`) is the simplest deduplication when tools require both names.
- Auto-memory (e.g. Claude Code's `~/.claude/projects/<dir-with-slashes-as-dashes>/memory/MEMORY.md`) is local to the machine and not a substitute for `AGENTS.md`. Team-binding rules live in the repo; auto-memory is a personal cache, periodically reviewable.

### Inner-loop hooks (deterministic feedback without prompting)

Mechanical, non-pickable checks belong in hooks (e.g. Claude Code's `PostToolUse`), not in the rule file. The agent finishes an edit; a formatter or fast lint runs; the result feeds back without you reminding it. Settings template (`settings.json.template`) ships in the lesson pack as the wiring entry point. Keep procedural workflows (deeper review, release checklist, deploy on sandbox) in skills, and reserve hooks for deterministic tool signals.

### Foundation paths used by this lesson

- `AGENTS.md` / `CLAUDE.md` (and per-area variants) — `/10x-agents-md` output
- `context/foundation/lessons.md` — `/10x-lesson` output (append-only register, consumed by future planning/review skills)
- `context/foundation/prd.md`, `context/foundation/tech-stack.md` — inputs from earlier lessons, still present
- `docs/reference/contract-surfaces.md` — load-bearing names registry (scaffolded by `/10x-init`)

### Universal language

The shipped skills carry no 10xDevs / cohort / certification references. `/10x-agents-md` discovers from the repo it's invoked in; `/10x-rule-review` is tool-agnostic and treats every file as "a rules-for-AI artifact"; `/10x-lesson` writes one entry shape regardless of project domain. The 5-pattern calibration drill is illustrative — substitute patterns from your own stack.

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
