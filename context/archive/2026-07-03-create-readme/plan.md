# Create README (Best-README-Template) Implementation Plan

## Overview

Write a root `README.md` for OpsPilot modeled on the
[Best-README-Template](https://github.com/othneildrew/Best-README-Template), describing the
**currently implemented, runnable MVP state** (not the aspirational foundation-doc vision), and
align the supporting repo artifacts (LICENSE file, `package.json` metadata, a stale `CLAUDE.md`
claim, and the empty GitHub repo description) to what the README asserts.

## Current State Analysis

- **No `README.md`, no `LICENSE`** at the repo root (verified). `package.json` declares
  `"license": "MIT"` but `gh repo view` reports `licenseInfo: null` — GitHub does not recognize a
  license because the file is missing.
- `package.json` has **no `author`, `repository`, or `description`** fields (`name: opspilot`,
  `version: 0.0.0`, `private: true`, `license: MIT`). The **GitHub repo description is empty**.
- **`luxon` is dead** — confirmed zero runtime imports across `apps/` and `libs/` — so it must not
  appear in Built-With (resolves research open question #2).
- **No image assets** exist (`images/`, `assets/`, `docs/`, `.github/*.png` all absent) — the
  template's product-screenshot slot has nothing to point at yet.
- **`CLAUDE.md` is stale**: its project-overview paragraph claims the tree is "the Nx scaffold
  output plus the shared lib" and that most of the target stack "are not yet wired up." Research
  establishes this is wrong as of `4739ce1` — the MVP is complete (all 12 roadmap slices done).
- The comprehensive research doc (`context/changes/create-readme/research.md`) is the authoritative
  content source: About material, per-domain feature list (Usage), full Built-With version matrix,
  Getting Started commands + a 20+ row env-var table, deployment narrative, honest roadmap, and
  repo metadata are all already gathered and verified.
- The Best-README-Template skeleton (fetched): reference-style shields badge block → centered
  logo/tagline/action-links → collapsible `<details>` Table of Contents → About (with screenshot
  slot) → Built With (badges) → Getting Started (Prerequisites + Installation) → Usage → Roadmap
  (checkbox list) → Contributing → License → Contact → Acknowledgments; uses `#readme-top` anchor +
  scattered back-to-top links and reference-style link definitions at the bottom.

## Desired End State

A root `README.md` renders on GitHub as a polished Best-README-Template-style document that
**accurately** reflects the implemented product: a reader can understand what OpsPilot is, see the
real stack, follow Getting Started to run it locally, understand each feature area, read an honest
roadmap, and reach the deployment story — with working badges, a collapsible ToC, and back-to-top
links. Supporting artifacts are consistent: a real `LICENSE` file makes the MIT claim true (GitHub
detects it), `package.json` carries author/repository/description, `CLAUDE.md` no longer claims a
bare scaffold, and the GitHub repo description matches the README tagline.

Verification: `README.md` and `LICENSE` exist at root; `gh repo view --json licenseInfo` reports
MIT (not null); `gh repo view --json description` is non-empty; `npm run format:check` passes;
markdown renders without broken image links or dangling reference-style links.

### Key Discoveries:

- Authoritative content source: `context/changes/create-readme/research.md` (features, env table,
  stack, deployment, roadmap, metadata) — do not re-derive.
- Stale-docs trap: `CLAUDE.md` project-overview + the "target stack … not yet wired up" claim are
  wrong; README must describe the built MVP, and `CLAUDE.md` gets a one-line correction.
- `luxon` excluded from Built-With (dead dependency, verified).
- LICENSE is missing though MIT is declared — add the file so the claim is real
  (research open question #1).
- No screenshots exist — use a commented placeholder slot pointing at `docs/images/`, not a broken
  `<img>` (research open question #3).

## What We're NOT Doing

- **Not** capturing or committing actual product screenshots/GIFs (only a placeholder slot + TODO).
- **Not** advertising non-goals as features or roadmap items (no chat/free-form prompts, no
  metrics monitoring, no user-defined output schemas, no RBAC, no mobile/desktop, no i18n, no dark
  mode).
- **Not** editing `context/foundation/*` docs, the roadmap, or any application code.
- **Not** creating a `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, or issue/PR templates (the
  Contributing section lives inline in the README).
- **Not** changing `package.json` `version`, `name`, or `private` fields.
- **Not** bumping any dependency or removing the dead `luxon` from `package.json` (only excluding
  it from the README prose).

## Implementation Approach

Phase 1 produces the single deliverable — `README.md` — using the research doc as the content of
record and the Best-README-Template as the structural skeleton. Phase 2 makes the surrounding repo
consistent with the README's assertions (license, package metadata, corrected CLAUDE.md claim,
GitHub description). Phase 2 depends on Phase 1 only for the agreed tagline/description wording;
otherwise the two are independent.

## Critical Implementation Details

- **Screenshot slot must not render broken**: the template's `<img>` in About points at a real
  file. Since none exists, keep the slot as an HTML comment (or a placeholder linking to a
  not-yet-created `docs/images/screenshot.png`) so GitHub shows no broken-image icon. Leave a
  visible `<!-- todo: add overview / service-detail / live-diagnosis screenshots -->` marker.
- **Reference-style link hygiene**: every shields badge and every `[text][ref]` link must have a
  matching `[ref]: url` definition at the bottom. A dangling reference renders as literal
  `[text][ref]` — sweep the file before finishing.

## Phase 1: Write README.md

### Overview

Author the complete root `README.md` following the Best-README-Template section order, populated
entirely from verified research content (implemented state only).

### Changes Required:

#### 1. Root README

**File**: `README.md` (new, repo root)

**Intent**: Create the Best-README-Template-styled README describing the implemented OpsPilot MVP,
so a newcomer can understand, run, and evaluate the project from this one file.

**Contract**: Sections in this order, matching the template skeleton:

- **Badge block** (reference-style shields, `for-the-badge`): License (MIT), GitHub stars, GitHub
  issues, and CI status from `.github/workflows/pipeline.yml`. Define each as a bottom-of-file
  reference.
- **Header**: centered tagline "self-hosted homelab ops tool with an agentic AI diagnostic layer"
  (or equivalent from research About material), plus action links (repo, live app
  `opspilot.example.com`, report-bug/request-feature → GitHub issues). No logo image file exists;
  use a text/emoji title, not a broken `<img>`.
- **Table of Contents**: collapsible `<details><summary>` list linking every section.
- **About The Project**: what OpsPilot is + target user + core hypothesis (research "About-The-
  Project material"); the load-bearing guardrails (predefined-skills only, secrets encrypted at
  rest, flat multi-user + audit log). Screenshot placeholder per Critical Implementation Details.
- **Built With**: the headline stack from research "Built-With material" — Nx 22, TypeScript 5.9,
  Angular 21, NestJS 11, Node 24; Drizzle + better-sqlite3, Better Auth, Zod, Tailwind v4 +
  spartan/ng, Vercel AI SDK, node-ssh, Vitest + Playwright. Shields badges where sensible.
  **Exclude `luxon`.**
- **Getting Started → Prerequisites**: Node 24 (`.nvmrc`), npm, native build toolchain
  (`python3 make g++`) for `better-sqlite3`; note the in-app (not env) LLM provider + per-device
  SSH credentials.
- **Getting Started → Installation**: the commands block from research (`npm ci`, `npm start`,
  build/lint/test, `db:*`, `e2e`, `./scripts/deploy.sh`), ports (web 4200 → proxy `/api` :3000),
  the env-var setup (copy `.env.example`, generate `BETTER_AUTH_SECRET` / `ENCRYPTION_KEY`), the
  full env-var table (20+ rows from research), and the boot-time auto-migration note. Include the
  in-app LLM-provider setup gotcha (structured-output-reliable model, raise
  `LLM_GENERATE_TIMEOUT_MS` ~120s).
- **Usage**: implemented features by domain (Auth, Devices, Credentials, Services + Docker scan,
  AI Diagnosis over SSE, Skills, LLM Providers, Audit, Overview, Health) and the web screens
  (overview, devices, service detail, skills, llm-providers, audit) — from research "Usage
  material". Prose, not an exhaustive route dump.
- **Deployment**: single multi-arch container (nginx + node + supervisor) → `ghcr.io/karoldydo/
  opspilot`, Synology + Cloudflare Tunnel/Access, `compose.yaml` + `scripts/deploy.sh`, live at
  `opspilot.example.com` (from research "Deployment").
- **Roadmap**: honest checkbox list — done: MVP complete (12 slices); planned/parked: LAN
  auto-discovery, container updates+rollback, skill scheduling, failure notifications, bulk ops,
  backup/restore. Do **not** list non-goals as roadmap items.
- **Contributing**: standard template 5-step fork/branch/PR workflow.
- **License**: "Distributed under the MIT License. See `LICENSE`." (file created in Phase 2).
- **Contact**: Karol Dydo — contact@karoldydo.dev; project link
  `https://github.com/karoldydo/opspilot`.
- **Acknowledgments**: Best-README-Template (othneildrew) + notable stack credits (Nx, Angular,
  NestJS, spartan/ng, Tailwind, Drizzle, better-sqlite3, Zod, Better Auth, Vercel AI SDK,
  node-ssh, Vitest, Playwright).
- **`#readme-top` anchor** at the top + scattered "back to top" links; **reference-style link
  definitions** block at the bottom.

### Success Criteria:

#### Automated Verification:

- `README.md` exists at repo root: `ls README.md`
- Prettier formatting passes: `npm run format:check`
- No dangling reference-style links (every `][ref]` has a `[ref]:` definition):
  grep-sweep of the file

#### Manual Verification:

- README renders on GitHub with working badges, collapsible ToC, and back-to-top links; no
  broken-image icon in About
- Content matches the implemented state (features, stack, env table) and lists no non-goals as
  features or roadmap
- Getting Started steps are followable end-to-end by a newcomer

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before
proceeding to the next phase.

---

## Phase 2: Align supporting artifacts

### Overview

Make the surrounding repo consistent with the README: add the missing LICENSE, fill package
metadata, correct the stale `CLAUDE.md` claim, and set the GitHub repo description.

### Changes Required:

#### 1. LICENSE file

**File**: `LICENSE` (new, repo root)

**Intent**: Make the MIT claim real so GitHub detects the license and the README's License section
links to a file that exists.

**Contract**: Standard MIT License text, copyright `2026 Karol Dydo`. After adding,
`gh repo view --json licenseInfo` should report MIT rather than null.

#### 2. package.json metadata

**File**: `package.json`

**Intent**: Add the missing package metadata so the manifest is consistent with the README.

**Contract**: Add `description` (README tagline), `author` ("Karol Dydo <contact@karoldydo.dev>"),
and `repository` (`{ "type": "git", "url": "git+https://github.com/karoldydo/opspilot.git" }`).
Do not touch `name`, `version`, `private`, or `license`.

#### 3. CLAUDE.md correction

**File**: `CLAUDE.md`

**Intent**: Remove the stale claim that the repo is a bare Nx scaffold with the target stack not
yet wired, which research established is false.

**Contract**: Edit the project-overview paragraph (the "Most of those are not yet wired up — the
current source tree is the Nx scaffold output plus the shared lib" sentence and the "Treat the
foundation docs as direction, not as already-implemented architecture" framing) to reflect that
the MVP is implemented, pointing readers to the README for the current feature set. Keep the edit
minimal and factual; do not restructure the file.

#### 4. GitHub repo description

**Action**: `gh repo edit karoldydo/opspilot --description "<README tagline>"`

**Intent**: Set the empty GitHub repo description to match the README tagline.

**Contract**: Outward-facing change to the GitHub repo settings — confirm the exact tagline wording
with the user before running (matches the README header).

### Success Criteria:

#### Automated Verification:

- `LICENSE` exists at repo root: `ls LICENSE`
- GitHub recognizes the license: `gh repo view --json licenseInfo` is non-null (MIT)
- GitHub description is set: `gh repo view --json description` is non-empty
- `package.json` is valid JSON with the new fields: `node -e "require('./package.json')"`
- Prettier passes on touched files: `npm run format:check`

#### Manual Verification:

- `CLAUDE.md` no longer claims a bare scaffold and reads correctly
- README License section links to the now-present `LICENSE`

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human.

---

## Testing Strategy

### Unit Tests:

- None — this change touches documentation and repo metadata only; no application code or tests.

### Integration Tests:

- None applicable.

### Manual Testing Steps:

1. Open the rendered `README.md` on GitHub (or a markdown preview) — verify badges resolve, the
   collapsible ToC expands, back-to-top links jump to `#readme-top`, and the About screenshot slot
   shows no broken image.
2. Cross-check the Built With list against the research version matrix and confirm `luxon` is
   absent.
3. Walk the Getting Started steps mentally end-to-end; confirm the env-var table matches
   `.env.example` / `env.schema.ts` counts from research.
4. Confirm no non-goal (chat, metrics, RBAC, dark mode, etc.) is listed as a feature or roadmap
   item.
5. Run `gh repo view --json licenseInfo,description` and confirm MIT + non-empty description.

## Performance Considerations

None — documentation-only change.

## Migration Notes

None — no data or schema changes.

## References

- Related research: `context/changes/create-readme/research.md`
- Change identity: `context/changes/create-readme/change.md`
- Template: https://github.com/othneildrew/Best-README-Template
- Stack/deploy source of truth: `context/foundation/tech-stack.md`,
  `context/deployment/deploy-plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not
> rename step titles. See `references/progress-format.md`.

### Phase 1: Write README.md

#### Automated

- [x] 1.1 README.md exists at repo root (`ls README.md`) — da78159
- [x] 1.2 Prettier formatting passes (`npm run format:check`) — da78159
- [x] 1.3 No dangling reference-style links (grep-sweep) — da78159

#### Manual

- [x] 1.4 README renders on GitHub with working badges, ToC, back-to-top; no broken screenshot — da78159
- [x] 1.5 Content matches implemented state; no non-goals listed as features/roadmap — da78159
- [x] 1.6 Getting Started is followable end-to-end — da78159

### Phase 2: Align supporting artifacts

#### Automated

- [x] 2.1 LICENSE exists at repo root (`ls LICENSE`) — 6d965c3
- [ ] 2.2 GitHub recognizes the license (`gh repo view --json licenseInfo` non-null) — deferred: requires `git push origin main`
- [x] 2.3 GitHub description is set (`gh repo view --json description` non-empty) — 6d965c3
- [x] 2.4 package.json is valid JSON with new fields (`node -e "require('./package.json')"`) — 6d965c3
- [x] 2.5 Prettier passes on touched files (`npm run format:check`) — 6d965c3

#### Manual

- [x] 2.6 CLAUDE.md no longer claims a bare scaffold and reads correctly — 6d965c3
- [x] 2.7 README License section links to the present LICENSE — 6d965c3
