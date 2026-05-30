---
bootstrapped_at: 2026-05-26T00:53:00Z
starter_id: nx
starter_name: Nx
project_name: opspilot
language_family: js
package_manager: npm
cwd_strategy: subdir-then-move
bootstrapper_confidence: verified
phase_3_status: ok
audit_command: npm audit --json
---

## Hand-off

Verbatim copy of `context/foundation/tech-stack.md`.

### Frontmatter

```yaml
starter_id: nx
package_manager: npm
project_name: opspilot
hints:
  language_family: js
  team_size: solo
  deployment_target: self-host
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: verified
  path_taken: custom
  quality_override: false
  self_check_answers:
    typed: true
    from_official_starter: true
    conventions: true
    docs_current: true
    can_judge_agent: true
  has_auth: true
  has_payments: false
  has_realtime: true
  has_ai: true
  has_background_jobs: true
```

### Why this stack

> Solo developer building a self-hosted homelab tool over an 8-week after-hours
> timeline, with a user-specified stack from idea-notes.md: Angular 21 frontend +
> NestJS backend + Drizzle/SQLite + shared Zod schemas, shipped as one multi-arch
> container. Two TypeScript apps plus a shared validation library in one repo is
> the canonical monorepo case, so the hand-off anchors on `nx` - the only
> registry starter with first-class Angular (`@nx/angular`) and Nest (`@nx/nest`)
> generators. The stack clears all four agent-friendly gates (typed, convention-
> based, popular within the JS family, well-documented), so no quality override.
> Self-host is the deployment default (Cloudflare Tunnel/Access is a transparent
> edge layer outside the app, not edge compute - long-running SSH connections,
> SSE live narration, and background agent runs all need a persistent Node
> server, ruling out edge-first starters). Feature flags auth/AI/realtime/
> background-jobs are set; payments is out of scope per PRD non-goals. Known
> friction: the nx card's default `cmd_template` uses `--preset react-monorepo`;
> bootstrapper must instead init with the Angular + Nest plugins.

## Pre-scaffold verification

| Signal      | Value                                                        | Severity | Notes                                                            |
|-------------|--------------------------------------------------------------|----------|------------------------------------------------------------------|
| npm package | `create-nx-workspace` v22.7.4 published 2026-05-25T19:09:45Z | fresh    | resolved from cmd_template; published one day before this run    |
| GitHub repo | not run                                                      | -        | card `docs_url` is `https://nx.dev` (not a `github.com/...` URL) |

No stale signals. Proceeded with no heads-up.

## Scaffold log

**Hand-off correction (user-approved).** The registry card `nx` ships
`cmd_template: npx create-nx-workspace {name} --preset react-monorepo ...`, which
scaffolds a React monorepo. The hand-off body explicitly flagged this as friction
and required initialising with the Angular + Nest plugins instead. At the Step 0
confirm-or-correct gate the user chose to correct the command to an Angular + Nest
monorepo, and chose the "structure + stack dependencies" scope (also install
`zod` and the Drizzle/SQLite packages in the same run). Bootstrapper does not
parse the hand-off body programmatically in v1, so this correction was surfaced
and confirmed in conversation rather than read from the file.

**Strategy**: subdir-then-move. The bootstrapper convention substitutes
`{name}=.bootstrap-scaffold`, but `create-nx-workspace` rejects workspace names
that do not start with a letter (`INVALID_WORKSPACE_NAME`). The temp directory was
therefore named `opspilot/` (a valid name that doubles as the workspace name),
scaffolded into, then its contents moved up into cwd and the temp directory
deleted. Semantics of subdir-then-move preserved.

**Attempts before success** (Nx 22 is template-based; "legacy" presets map to
fixed GitHub template repos, so `--appName` / `--style` / `--no-workspaces` are
largely ignored):

1. `--preset apps` + name `.bootstrap-scaffold` → `INVALID_WORKSPACE_NAME`
   (dot-leading name rejected). Re-run with name `opspilot`.
2. `--preset apps` (empty-template) → `@nx/angular:init` HARD error: *"The Angular
   framework doesn't support a TypeScript setup with project references"*
   (angular/angular#37276). The empty template uses the TS-solution setup
   (project references), which Angular cannot consume.
3. `--preset apps --no-workspaces` → same project-references error; the template
   clone ignores the flag.
4. `--preset angular-monorepo` → maps to `nrwl/angular-template`, an Angular-
   compatible (path-aliases) workspace, but it is a **full demo "shop" app**
   (9 projects) and ignored `--appName web`. `nx add @nx/nest` succeeded; the
   subsequent `nx g @nx/nest:app apps/api` failed because the demo already had a
   project at `apps/api`.

**Resolution** (the workspace that shipped): kept the Angular-compatible
`angular-monorepo` workspace, stripped all 9 demo projects with
`nx g @nx/workspace:remove ... --forceRemove` (`shop`, `shop-e2e`, `api`,
`feature-product-detail`, `feature-products`, `shared-ui`, `data`, `products`,
`models`), then generated clean projects:

```
npx nx g @nx/angular:app apps/web --style=scss --ssr=false --e2eTestRunner=none --unitTestRunner=vitest-angular --no-interactive
npx nx g @nx/nest:app apps/api --e2eTestRunner=none --no-interactive
npx nx g @nx/js:lib libs/shared --bundler=none --unitTestRunner=vitest --no-interactive
npm add zod drizzle-orm better-sqlite3
npm add -D drizzle-kit @types/better-sqlite3
```

(The Angular generator rejects `--unitTestRunner=vitest`; the Angular variant is
`vitest-angular`, used here to match the workspace's vitest setup.)

**Final projects**: `web` (Angular 21, zoneless/standalone, SCSS, no SSR),
`api` (NestJS 11), `shared` (`@nx/js` library, `@org/shared` path alias - intended
home for shared Zod schemas).

**Template cruft removed before move-up** (outside v1 scope - agent context + CI):
`AGENTS.md`, `CLAUDE.md` (template copy; the project's own `CLAUDE.md` in cwd was
untouched), `.cursor/`, `.gemini/`, `.codex/`, `.opencode/`, `.agents/`,
`opencode.json`, `.github/` (Nx demo CI workflow + Nx helper skills), and the
10 KB demo `README.md`.

**Exit code**: 0 (final chain)
**Files moved up into cwd**: 14 top-level entries (`apps/`, `libs/`, `node_modules/`,
`.nx/`, `.vscode/`, `.editorconfig`, `.prettierrc`, `.prettierignore`,
`eslint.config.mjs`, `nx.json`, `package.json`, `package-lock.json`,
`tsconfig.base.json`, `vitest.workspace.ts`)
**Conflicts (.scaffold siblings)**: none
**.gitignore handling**: append-merged (cwd's single `.idea` line kept; Nx ignore
block appended under a `# --- from nx scaffold ---` separator)
**context/ preservation**: cwd `context/` untouched (the scaffold produced none)
**.bootstrap-scaffold cleanup**: deleted (temp dir `opspilot/` removed after move-up)

## Post-scaffold audit

**Tool**: `npm audit --json` (exit code 1 - npm exits non-zero when advisories
exist; not treated as a halt)
**Summary**: 0 CRITICAL, 1 HIGH, 37 MODERATE, 0 LOW (total 38)
**Direct vs transitive**: direct = 1 HIGH + 17 MODERATE; transitive = 0 HIGH +
20 MODERATE. (Dependency tree: 838 prod, 959 dev, 377 optional, 2047 total.)

#### CRITICAL findings

None.

#### HIGH findings

- **`@angular/platform-server`** - direct dependency, vulnerable range
  `21.0.0-next.0 - 21.2.12`. Pulled in by the `@nx/angular:app` generator. The app
  was generated with `--ssr=false`, so `@angular/platform-server` is likely
  unused and could be removed from `package.json`, or bumped once a patched
  release is published. Bootstrapper surfaces this; it does not auto-fix.

#### MODERATE findings

37 advisories (17 direct, 20 transitive) across the Angular/Nx/vite/esbuild
toolchain. Log-only per the severity-tiering policy. Run `npm audit` for the full
per-package breakdown and `npm audit fix` (non-breaking) or `npm audit fix --force`
(may include breaking changes) to address them at your discretion.

#### LOW / INFO findings

None.

## Hints recorded but not acted on

Every hint bootstrapper read from the hand-off but did not act on in v1.

| Hint                    | Value                                                                                                                                                                 |
|-------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| bootstrapper_confidence | verified - note: "verified" describes the card's default `react-monorepo` command, not the Angular + Nest correction taken here, which required manual demo-stripping |
| quality_override        | false                                                                                                                                                                 |
| path_taken              | custom                                                                                                                                                                |
| self_check_answers      | typed: true, from_official_starter: true, conventions: true, docs_current: true, can_judge_agent: true                                                                |
| team_size               | solo                                                                                                                                                                  |
| deployment_target       | self-host                                                                                                                                                             |
| ci_provider             | github-actions (no CI scaffolding in v1; the template's `.github/` was removed)                                                                                       |
| ci_default_flow         | auto-deploy-on-merge                                                                                                                                                  |
| has_auth                | true                                                                                                                                                                  |
| has_payments            | false                                                                                                                                                                 |
| has_realtime            | true                                                                                                                                                                  |
| has_ai                  | true                                                                                                                                                                  |
| has_background_jobs     | true                                                                                                                                                                  |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified - happy hacking.

Useful manual steps in the meantime:

- `git init` is not needed - this directory already has a `.git/` repo. Review and commit the scaffolded files when ready.
- The workspace `package.json` name is `@org/source` (Nx default) and path aliases use the `@org` scope (e.g. `@org/shared`). Rename to an `@opspilot` scope if you prefer.
- Wire the stack the hand-off named: define your shared **Zod** schemas in `libs/shared/src`, and configure **Drizzle/SQLite** (`drizzle-orm` + `better-sqlite3` + `drizzle-kit`, already installed) in `apps/api` with a `drizzle.config.ts`.
- Address audit findings per your risk tolerance - the full breakdown is above. The single HIGH (`@angular/platform-server`) is likely removable since SSR is off.
- CI was intentionally not scaffolded in v1. When you want it, `nx g @nx/workspace:ci-workflow --ci=github` generates a GitHub Actions pipeline.
- No `.scaffold` siblings were created this run, so there is nothing to diff/reconcile.
