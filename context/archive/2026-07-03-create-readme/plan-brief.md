# Create README (Best-README-Template) — Plan Brief

> Full plan: `context/changes/create-readme/plan.md`
> Research: `context/changes/create-readme/research.md`

## What & Why

Write a root `README.md` for OpsPilot modeled on the Best-README-Template, describing the
**currently implemented, runnable MVP** (not the aspirational foundation-doc vision). The repo has
no README, so a newcomer has no single entry point to understand, run, or evaluate the project.

## Starting Point

OpsPilot is a complete MVP (all 12 roadmap slices done) but has **no `README.md` and no `LICENSE`**
despite `package.json` declaring MIT (GitHub reports `licenseInfo: null`). `package.json` lacks
author/repository/description, the GitHub repo description is empty, and `CLAUDE.md` still stale-ly
claims the tree is a bare Nx scaffold. A comprehensive `research.md` already gathered all README
content (features, stack, env table, deployment, roadmap, metadata).

## Desired End State

A polished Best-README-Template-style `README.md` that accurately reflects the built product —
working badges, collapsible ToC, About + screenshot placeholder, real Built With, followable
Getting Started, per-domain Usage, honest Roadmap, Deployment, License/Contact/Acknowledgments —
backed by a real `LICENSE`, filled `package.json` metadata, a corrected `CLAUDE.md`, and a set
GitHub repo description.

## Key Decisions Made

| Decision              | Choice                              | Why                                                 | Source   |
| --------------------- | ----------------------------------- | --------------------------------------------------- | -------- |
| Content baseline      | Implemented MVP state only          | README describes what's real, not the vision        | Research |
| `luxon` in Built-With | Excluded                            | Verified zero runtime imports — dead dependency     | Research |
| LICENSE               | Add MIT `LICENSE` file              | Makes the MIT claim real; GitHub then detects it    | Plan     |
| Screenshots           | Commented placeholder + TODO        | No assets exist; avoid a broken-image icon          | Plan     |
| Badges                | Repo + CI + Built-With shields      | Full template look, links to real resources         | Plan     |
| Side artifacts        | LICENSE, package.json, CLAUDE.md, gh description | Keep repo consistent with README claims | Plan     |

## Scope

**In scope:**
- Root `README.md` (Best-README-Template skeleton, implemented-state content)
- `LICENSE` (MIT), `package.json` metadata (author/repository/description)
- One-line correction of the stale scaffold claim in `CLAUDE.md`
- Setting the empty GitHub repo description

**Out of scope:**
- Capturing/committing real screenshots (placeholder only)
- Editing `context/foundation/*`, the roadmap, or any app code
- Separate `CONTRIBUTING.md` / templates; changing package `name`/`version`/`private`
- Removing `luxon` from `package.json` (only excluded from README prose)

## Architecture / Approach

Single documentation deliverable driven off the research doc as content-of-record and the
Best-README-Template as the structural skeleton (badges → header → ToC → About → Built With →
Getting Started → Usage → Deployment → Roadmap → Contributing → License → Contact →
Acknowledgments, with `#readme-top` back-to-top links and reference-style link definitions).
Phase 2 aligns surrounding artifacts to what the README asserts.

## Phases at a Glance

| Phase                        | What it delivers                                  | Key risk                                            |
| ---------------------------- | ------------------------------------------------- | --------------------------------------------------- |
| 1. Write README.md           | Complete template-styled README (implemented state) | Broken screenshot slot / dangling reference links |
| 2. Align supporting artifacts| LICENSE, package metadata, CLAUDE.md fix, gh desc | `gh repo edit` is an outward-facing change          |

**Prerequisites:** `research.md` (present); `gh` authenticated for Phase 2 checks/description.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- Screenshots are deferred — the README ships with a placeholder until real captures are added.
- Tagline wording for the README header doubles as the GitHub description; confirm before running
  `gh repo edit`.
- `CLAUDE.md` edit stays minimal/factual — no restructuring of the guidance file.

## Success Criteria (Summary)

- A newcomer can understand, run, and evaluate OpsPilot from `README.md` alone; badges/ToC/back-to-
  top all work and no image is broken.
- `LICENSE` exists and GitHub reports MIT (not null); repo description is set; `package.json`
  carries the new metadata.
- No non-goal is advertised as a feature or roadmap item; `luxon` is absent from Built-With.
