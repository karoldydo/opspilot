# Clean up and trim comments in `apps/web` — Plan Brief

> Full plan: `context/changes/web-comment-cleanup/plan.md`
> Research: `context/changes/web-comment-cleanup/research.md`

## What & Why

A comments-only refactor of `apps/web/src/**` — remove redundant comments, normalize the ~8 recurring comment
families to one canonical line each, and compress the multi-line file-headers to a single sharp line. Zero
behavior change; the diff touches comment lines only. Mirrors the just-completed, archived
`2026-06-21-api-comment-cleanup`.

## Starting Point

`apps/web` carries ~241 logical comments (38 non-spec `.ts` + 17 spec files; 1 scss, 0 html). The comments are
high-quality and low-junk: ~13:1 KEEP-SHORTEN:REMOVE, no scaffold leftovers (except `styles.scss:1`), no dead
code, and — confirmed by a dedicated sweep — zero untouchable directives (no `eslint-disable`, JSDoc, pragmas,
license headers, TODO/FIXME, or in-comment URLs). Everything already complies with `comments.md` lowercase rule.

## Desired End State

Comments are minimal and sharp: every restatement is gone, each recurring family reads as one identical
canonical line, and every file-header is a single line that still names its non-obvious "why" and rule
reference. Tests, types, lint, and formatting are unchanged; `git diff` shows comment lines only.

## Key Decisions Made

| Decision                  | Choice                                                        | Why (1 sentence)                                              | Source  |
| ------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ | ------- |
| Recurring-family wording  | Best existing instance as canonical, applied verbatim         | Keeps the diff mechanical and review trivial                  | Plan    |
| File-header compression   | Aggressively to one line, preserving the load-bearing "why"   | Maximum brevity; the gotcha + rule reference still survive    | Plan    |
| Soft restatement notes    | Delete all four kinds (3 patchEntry/teardown + 4× delete-target) | They restate symbol names — change.md classifies as REMOVE | Plan    |
| Commit strategy           | Single `docs(web): clean up and trim comments`                | Mirrors the api precedent; body notes the per-batch deviation | Plan    |

## Scope

**In scope:** all `apps/web/src/**/*.ts` (incl. `*.spec.ts`), `styles.scss:1` scaffold; normalizing the 8
families; compressing 8 multi-line headers; deleting ~17 REMOVE + the 4× delete-target note.

**Out of scope:** `apps/api`, `libs/shared`, any config outside `apps/web`; casing fixes (already compliant);
html templates (0 comments); any executable code, names, signatures, imports, markup, or formatting.

## Architecture / Approach

5 batches by blast radius, smallest first: (1) core + app-root, (2) shared, (3) data layer (7 stores + 7
clients — the normalization core), (4) components/dialogs, (5) specs. Canonical wording for each family is
chosen before editing so each batch's diff is mechanical. All batches land as one commit at the end.

## Phases at a Glance

| Phase                   | What it delivers                                              | Key risk                                          |
| ----------------------- | ------------------------------------------------------------ | ------------------------------------------------- |
| 1. core + app-root      | Tighten core comments; set canonical family wording          | Losing better-auth `basePath` / `lessons.md` facts |
| 2. shared               | Tighten `schema.validator.ts` (contracts.md)                  | Trivial — single file                             |
| 3. data layer           | Normalize families 1–5; tighten SSE; delete 3 soft notes      | Over-shortening load-bearing SSE/contract prose   |
| 4. components / dialogs  | Delete 7 REMOVE + 4× delete-target; collapse headers to 1 line | A one-liner header dropping its gotcha            |
| 5. specs                | Normalize Family A; delete Families B+C; keep characterization | Editing a non-comment line in a spec body         |

**Prerequisites:** none — research is complete, no code dependencies.
**Estimated effort:** ~1 session across 5 batches, single commit.

## Open Risks & Assumptions

- The only real risk is over-eager shortening of load-bearing prose (SSE/`sse.md`, contracts, `lessons.md`
  Date→iso, overlay-vs-DI). Mitigation: shorten wording, never meaning; keep every rule/schema reference token.
- Assumes html stays comment-free and no stray comment appears in scss beyond `styles.scss:1`.
- The test suite (`npx nx test web`) is the guardrail proving no executable code moved.

## Success Criteria (Summary)

- `npx nx lint web` and `npx nx test web` pass the same as before.
- `npm run format:check` is clean for `apps/web`.
- `git diff -- apps/web` shows comment lines only — no non-comment line changed.
