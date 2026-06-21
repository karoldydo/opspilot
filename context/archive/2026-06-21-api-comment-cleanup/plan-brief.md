# Clean up and trim comments in `apps/api` — Plan Brief

> Full plan: `context/changes/api-comment-cleanup/plan.md`
> Research: `context/changes/api-comment-cleanup/research.md`

## What & Why

A comments-only refactor of `apps/api/src/**/*.ts` (including `*.spec.ts`): delete comments that
restate the code, shorten the load-bearing ones to a single sharp lowercase line, and leave the few
risk/decision records intact. The motivation is signal-to-noise — the tree carries ~301 comments and
~70 are pure restatements that add nothing, while many genuine invariants are wordier than they need
to be. Zero behavior change.

## Starting Point

`apps/api/src` has ~301 comments across ~91 non-spec files + 29 spec files (research-mapped at commit
`19b99ea`): ~70 REMOVE, ~227 KEEP-SHORTEN, ~4 keep-verbatim. There are **no** directives, JSDoc,
pragmas, license headers, in-comment URLs, or TODO/FIXME markers anywhere — every comment is plain
`//` or single-line `/* */` prose, so the cleanup can't accidentally destroy a directive.

## Desired End State

Each remaining comment explains something not visible from the code, in one minimal lowercase line;
redundant restatements are gone; the 4 verbatim records survive untouched. `npx nx lint api`,
`npx nx test api`, and `npm run format:check` all pass exactly as before, and `git diff` shows
comment-line changes only.

## Key Decisions Made

| Decision                          | Choice                                            | Why (1 sentence)                                                  | Source   |
| --------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------- | -------- |
| Normalize recurring KEEP patterns | Identical one-liner at every occurrence           | Keeps specs/modules readable standalone; mechanical, easy review | Plan     |
| `toContract` docstring            | One canonical short form, delete duplicates       | Preserves the iso-string `contracts.md` invariant, cuts noise    | Plan     |
| FK-seed note wording              | Fuller form with table reference (e.g. `→ user.id`)| Makes the not-null/cascade FK relation explicit                  | Plan     |
| Commit granularity                | Single commit for the whole change                | User's explicit choice (deviates from change.md per-batch note)  | Plan     |
| Keep-verbatim records             | 4 untouched (TOFU + 3 `@Inject`/lessons refs)     | Risk/decision records, not chatter                               | Research |

## Scope

**In scope:** all `apps/api/src/**/*.ts` including `*.spec.ts`; delete REMOVE comments, shorten
KEEP-SHORTEN, normalize the 3 recurring patterns.

**Out of scope:** `apps/web`, `libs/shared`, any config outside `apps/api`; any executable code, names,
signatures, imports, or non-comment formatting; the 4 keep-verbatim records.

## Architecture / Approach

Work phase-by-phase in the research's batching order (smallest blast radius first: `config/` → `core/`
+ `common/` → `integrations/executor` → `modules/*` → specs → final verify). Edit comment text in
place; after each phase run a scoped `git diff` to confirm only comment lines moved. Everything lands
as one commit after full-tree verification.

## Phases at a Glance

| Phase                          | What it delivers                                   | Key risk                                          |
| ------------------------------ | ------------------------------------------------- | ------------------------------------------------- |
| 1. config/                     | ~10 env-schema restatements removed, rest tightened | Over-trimming a fail-fast/ceiling fact            |
| 2. core/ + common/             | security/db invariants tightened (db: no deletes) | Losing meaning in security prose                  |
| 3. integrations/executor       | 2 removed, lifecycle/mutex tightened              | Accidentally editing the TOFU verbatim block      |
| 4. modules/*                   | heaviest REMOVE; `toContract` + bodyParser normalized | Dropping a `@Inject`/lessons.md fact              |
| 5. **/*.spec.ts                | fake-guard preamble + FK-seed normalized          | Touching an assertion/fixture instead of a comment |
| 6. Final verify + commit       | full DoD + single commit                          | A stray non-comment line slipping into the diff   |

**Prerequisites:** clean working tree on a branch; baseline `npx nx test api` recorded as green.
**Estimated effort:** ~1-2 sessions, mechanical throughout.

## Open Risks & Assumptions

- The only real failure mode is over-eager shortening of load-bearing prose or an accidental
  non-comment edit — mitigated by per-phase scoped `git diff` and grep checks for the verbatim records.
- Multi-line `/* */` edits could trigger a `format:check` reflow; edit comment text only.
- Single-commit landing deviates from change.md's batching constraint — accepted by user decision.

## Success Criteria (Summary)

- `npx nx lint api` and `npx nx test api` pass identically to the pre-change baseline.
- `npm run format:check` is clean for `apps/api`; `git diff` shows comment lines only.
- The 4 keep-verbatim records (TOFU disclosure + 3 `@Inject`/lessons.md refs) are intact.
