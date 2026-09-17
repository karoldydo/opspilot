# `## Progress` Section Reference

The `## Progress` section in `plan.md` is the **single source of truth** for the execution state of a
change. This document defines its shape so every skill in the odp toolkit (`/odp-plan`,
`/odp-implement`, `/odp-review`, `/odp-archive`) treats it as a mechanical contract.

## Where it lives

At the bottom of `.context/changes/<change-id>/plan.md`, after `## References`. Exactly one
`## Progress` heading per plan.

## Structure

```markdown
## Progress

> Convention: `- [ ]` pending, `- [x]` done. Do not rename step titles.

### Phase 1: <phase name>

#### Automated

- [ ] 1.1 <step title>
- [x] 1.2 <step title>

#### Manual

- [ ] 1.3 <step title>

### Phase 2: <phase name>

#### Automated

- [ ] 2.1 <step title>
```

## Rules

- **One `## Progress` heading**, at the bottom of the file (after `## References`).
- **One `### Phase N: <name>`** per phase, in order, matching the `## Phase N:` headers earlier in the
  plan.
- **Per-phase Automated/Manual subdivision**:
  - `#### Automated` lists steps verifiable without human action (commands, type checks, builds).
  - `#### Manual` lists steps that require a human to look at the result (UI, smoke tests, eyeball
    checks). Under the odp loop this is also where behavioral verification lives, because the
    implementer runs no test suite.
  - A phase may have only `#### Automated`, only `#### Manual`, or both. Omit empty subsections.
- **Step format**: `- [ ] <phase>.<index> <title>` (pending) or `- [x] <phase>.<index> <title>` (done).
- **Step indices** are 1-based and unique within their phase. They are assigned at planning time and
  **never renumbered**. New steps added later get the next available index; deleted steps leave gaps
  (acceptable).
- **Step titles are immutable** once the plan is reviewed. If a step's intent changes, leave the title
  and add a brief inline note in the relevant Phase block above — do not rewrite the Progress entry.
- **No commit-SHA suffix.** The odp loop makes no commits, so a completed row is plain `- [x]` with
  nothing appended. Do not invent a placeholder in that position.

## Mutation surface

- **`/odp-implement` is the only writer.** It flips `[ ]` → `[x]` per step, as each step completes, and
  confines itself to `#### Automated` rows — it never flips `#### Manual` rows, leaving them as the
  post-run human checklist.
- **`/odp-review` reads Progress and never writes to it.**
- **`/odp-archive` reads Progress and never writes to it** — it counts pending rows for its warn gate.
  Archived plans retain their final Progress state as a historical record, pending Manual rows
  included.
- **`/odp-plan` writes the section once** at planning time, with every step as `[ ]`.

## Parsing contract for tooling

Skills that need to derive state from Progress:

- **Next pending step** = first `- [ ]` line under a `#### Automated` subsection, in document order.
- **Completion** = `count([x]) / count([ ] + [x])`.
- **Current phase** = phase containing the first pending Automated `- [ ]`, or the last phase if all
  are done.
- **Drift detection**:
  - `change.md.status = implementing` but Progress has 0 `[x]` → warn (no progress recorded).
  - `change.md.status = implementing` but all Automated items are `[x]` → warn (status should be
    `implemented`).
  - `change.md.status = planned` but Progress has any `[x]` → warn (status should be `implementing`).

## What is NOT in Progress

- **No state file sidecar**: Progress is the single source of execution state — no JSON cache anywhere.
  The per-phase diff snapshots under `.context/changes/<change-id>/phases/` are run artifacts, never
  state; nothing is derived from them.
- **No status-marker comments**: status lives in `change.md` frontmatter, completion is derived from
  Progress.
- **No nested checkboxes**: a step is one bullet. Sub-tasks belong in the Phase block as Success
  Criteria, not as Progress sub-items.
- **No estimates, owners, due dates**: scope creep. Not here.
- **No descriptive prose between phases or subsections**: the Progress section is parsed by tooling.
  Keep it strictly headings + bullets.
