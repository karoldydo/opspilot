# `change.md` Reference

Each `.context/changes/<change-id>/change.md` is the change's lifecycle identity file. Tiny —
frontmatter plus an optional `## Notes` body. This document defines its shape so every skill in the
odp toolkit (`/odp-plan`, `/odp-implement`, `/odp-review`, `/odp-archive`) treats it as a mechanical
contract.

## File shape

```markdown
---
change_id: <kebab-case-id>   # required, must match the folder name
title: <human-readable title> # required
status: <status>              # required, see allowed values below
created: YYYY-MM-DD           # required, set by /odp-plan on entry
updated: YYYY-MM-DD           # required, last lifecycle write
branch: <type>/<change-id>    # the change's own branch, or null when git is unavailable
base_sha: <full sha>          # the commit the branch was rooted on, or null
worktree: <absolute path>     # the change's worktree, or null when it lives in the main checkout
manual_tests_confirmed: null  # a date once the user confirms the manual pass
archived_at: null             # a datetime once /odp-archive runs
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in
research/frame/plan. -->
```

The keys are a machine contract and stay in English, as do `status` values. `title` and the `## Notes`
body are prose and follow the change's language.

## Allowed `status` values

`new`, `planned`, `implementing`, `implemented`, `impl_reviewed`, `archived`

That is the complete set — six values, each written by exactly one skill. The odp loop deliberately
has no `preparing`, `plan_reviewed` or `blocked`: research and framing happen inside `/odp-plan`
rather than as separate stages, there is no plan-review skill, and a blocked change is a note in
`## Notes`, not a status a skill has to reason about.

### Transitions

| From                             | To              | Written by                                  |
| -------------------------------- | --------------- | ------------------------------------------- |
| (none)                           | `new`           | `/odp-plan`, on entry                       |
| `new`                            | `planned`       | `/odp-plan`, once `plan.md` lands           |
| `planned`                        | `implementing`  | `/odp-implement`, first phase               |
| `implementing`                   | `implemented`   | `/odp-implement`, last phase complete       |
| `implemented`                    | `impl_reviewed` | `/odp-review`                               |
| `implementing`                   | `impl_reviewed` | `/odp-review`, run mid-implementation       |
| `planned`                        | `impl_reviewed` | `/odp-review`, on work implemented by hand  |
| `implemented` or `impl_reviewed` | `archived`      | `/odp-archive`                              |

**Forward-only.** No skill regresses a status. `/odp-plan` re-entered on an open change leaves
anything at `planned` or later untouched; `/odp-implement` never writes a status behind the one it
finds, so a change already at `implemented` or `impl_reviewed` keeps it. Re-running a skill on a
change it has already finished is safe rather than forbidden: `/odp-implement` finds no pending
`#### Automated` row, stops at its run report, and commits nothing. The file is record-only —
nothing enforces the table, and skipping `/odp-review` is allowed.

The `planned` → `impl_reviewed` row is the one transition that skips a stage: a change `/odp-plan`
opened and a human implemented by hand never passes through `/odp-implement`, so nothing ever writes
`implementing`. `/odp-review` accepts it, but only when real implementation work exists — a change
carrying nothing but its own planning commit is refused rather than stamped.

## The four workspace keys

These four are what make the loop work across several changes in flight at once. All four are written
by `/odp-plan` and read by the skills that follow.

- **`branch`** — the change's own branch, `<type>/<change-id>` where `<type>` is a Conventional Commit
  type. Written when the branch is opened. `/odp-implement`, `/odp-review` and `/odp-archive` all
  compare it against `git rev-parse --abbrev-ref HEAD` on entry and refuse to run from anywhere else:
  phase commits would land on the wrong branch, `base_sha..HEAD` would span someone else's work, and
  the close-out commit would go to the wrong history. `/odp-archive` also reports what the branch
  carries at the end.
- **`base_sha`** — the **full** sha of the commit the branch was rooted on, captured before anything
  was committed to it. This is the anchor of the whole review: `/odp-review` diffs `base_sha..HEAD` to
  see the change as one piece, and `/odp-archive` counts commits from it. **Never overwrite a
  `base_sha` that is already there** — a fresher one silently shrinks the reviewed range, and nothing
  downstream can detect that.
- **`worktree`** — the absolute path of the change's git worktree, or `null` when the change lives on
  a branch in the main checkout. `/odp-implement`, `/odp-review` and `/odp-archive` all compare it
  against the current repository root on entry and refuse to run from the wrong directory.
- **`manual_tests_confirmed`** — `null` for the whole loop until `/odp-archive` sets a date, and only
  after the user confirms in that session that the manual pass happened. It is a record of a human's
  answer, never an inference.

**When git is unavailable**, `/odp-plan` writes `branch: null`, `base_sha: null`, `worktree: null`, so
the fields exist and later skills can test them instead of guessing. A present key is not the same as
a usable value: anything reading `base_sha` must treat a literal `null` as absent.

## Update semantics

Skills write `change.md` on every lifecycle-changing run, always setting `updated`. Writes are narrow:
a skill touches `status`, `updated`, and the one field it owns, and leaves everything else alone. In
particular `/odp-archive` stamps `status`, `updated`, `archived_at` and `manual_tests_confirmed`, and
leaves `change_id`, `branch`, `base_sha` and `worktree` exactly as it found them — they are the
historical record of where the work happened.

`/odp-plan` re-entered on an existing `change.md` backfills missing workspace keys (an older change,
or a repaired folder) but never overwrites an existing `base_sha`.

## What is NOT in change.md

By design:

- **No `artifacts.*` block** — derive it from `ls` of the change folder.
- **No phase counters** (`total_phases`, `completed_phases`, `current_phase`) — derive them from the
  `## Progress` section in `plan.md`, which is the single source of execution state. See
  `progress-format.md`.
- **No `requires` / `blocked_by`** — out of scope.
- **No review verdict or finding counts** — those live in `reviews/impl-review.md`.
