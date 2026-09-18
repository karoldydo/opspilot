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

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not
> rename step titles.

### Phase 1: <phase name>

#### Automated

- [ ] 1.1 <step title>
- [x] 1.2 <step title> — abc1234

#### Manual

- [ ] 1.3 <step title>

### Phase 2: <phase name>

#### Automated

- [ ] 2.1 <step title>
```

The headings are a machine contract and stay in English — `## Progress`, `### Phase N:`,
`#### Automated`, `#### Manual`. Step titles are prose and follow the plan's language.

## Rules

- **One `## Progress` heading**, at the bottom of the file (after `## References`).
- **One `### Phase N: <name>`** per phase, in order, matching the `## Phase N:` headers earlier in the
  plan.
- **Per-phase Automated/Manual subdivision**:
  - `#### Automated` lists steps verifiable without human action (commands, type checks, builds).
  - `#### Manual` lists steps that require a human to look at the result (UI, smoke tests, eyeball
    checks). Under the odp loop this is also where behavioral verification lives, because the
    implementer runs no test suite.
  - A phase may carry only `#### Automated`, or both subsections. Omit empty subsections. A phase
    that changes files must carry at least one `#### Automated` row: every consumer keys off
    Automated rows, so a Manual-only phase is never implemented, never committed and never reviewed,
    while the run still reports success. A Manual-only phase is therefore legal only when the phase
    changes no files at all.
- **Step format**: `- [ ] <phase>.<index> <title>` (pending) or `- [x] <phase>.<index> <title>` (done),
  with ` — <sha>` appended to the done form once the commit that closed the step exists. A `[x]` row
  **without** a suffix is valid in three situations and in no others: **before the phase's commit
  lands** — which covers both a phase in flight and a phase resumed after a STOP, where rows ticked in
  the earlier attempt are still waiting for the suffix the next commit gives them; **a phase whose
  staged diff came out empty**, so there is no commit to name; and **a `#### Manual` row**, which is
  ticked by a human and never by a commit.
- **Step indices** are 1-based and unique within their phase. They are assigned at planning time and
  **never renumbered**. New steps added later get the next available index; deleted steps leave gaps
  (acceptable).
- **Step titles are immutable** once the plan is reviewed. If a step's intent changes, leave the title
  and add a brief inline note in the relevant Phase block above — do not rewrite the Progress entry.
- **Commit SHA suffix** is appended to a step when the work lands (` — <sha>`). The SHA is the short
  form (7+ lowercase hex chars) of the commit that closed the step. Multiple commits per step → list
  the closing commit only. A phase whose diff was empty produces no commit; its rows stay SHA-less,
  which is legitimate and `/odp-archive` surfaces it as an informational warning, never an error.
  Under the odp loop the empty case is rare by construction: ticking a row edits `plan.md`, which is
  always in the phase's staged set, so the staged diff is normally non-empty even when the phase
  produced no code. A SHA-less Automated row in a finished change therefore usually means the run
  stopped before that phase committed, not that the phase was a no-op.
- **`#### Manual` rows never carry a SHA.** Nothing commits them into existence — a human ticks them
  off after testing by hand. Anything scanning for SHA-less done rows must look under `#### Automated`
  only, or it will report every manual row in the plan.

## Mutation surface

- **`/odp-implement` is the only writer of Automated rows.** It flips `[ ]` → `[x]` **per step**, as
  each step completes, and appends the SHA suffix **at phase end, in one shot, after the closing
  commit lands**. Mid-phase, completed rows sit `[x]` without a SHA — a valid intermediate state, not
  drift. The append covers **every SHA-less `#### Automated` row of that phase**, not only the rows
  flipped in the current session: a phase resumed after a STOP finds rows already ticked by the
  earlier attempt, and scoping the write to this session's flips would strand them without a SHA
  forever. Rows that already carry a suffix are skipped, never appended to twice. It confines itself
  to `#### Automated` rows and never flips `#### Manual` rows, leaving them as the post-run human
  checklist.
- **`/odp-review` reads Progress and never writes to it.** It does read the SHA suffixes: they are how
  it scopes a single-phase review to that phase's commit.
- **`/odp-archive` reads Progress** to count pending rows for its warn gate, and has **one narrow
  write**: when the user explicitly confirms that the manual pass is done, it flips that change's
  `#### Manual` rows to `[x]`. That confirmation is the only thing in the loop that may touch a Manual
  row, and it never touches an Automated one. Archived plans otherwise retain their final Progress
  state as a historical record.
- **`/odp-plan` writes the section once** at planning time, with every step as `[ ]` and no SHA
  suffixes.

## Parsing contract for tooling

Skills that need to derive state from Progress:

- **Next pending step** = first `- [ ]` line under a `#### Automated` subsection, in document order.
- **Completion** = `count([x]) / count([ ] + [x])`.
- **Current phase** = phase containing the first pending Automated `- [ ]`, or the last phase if all
  are done.
- **Phase commits** = the distinct SHA suffixes under a `### Phase N:` block, in document order.
- **Drift detection**:
  - `change.md.status = implementing` but Progress has 0 `[x]` → warn (no progress recorded).
  - `change.md.status = implementing` but all Automated items are `[x]` → warn (status should be
    `implemented`).
  - `change.md.status = planned` but Progress has any `[x]` → warn (status should be `implementing`).

## What is NOT in Progress

- **No state file sidecar**: Progress is the single source of execution state — no JSON cache anywhere.
- **No status-marker comments**: status lives in `change.md` frontmatter, completion is derived from
  Progress.
- **No nested checkboxes**: a step is one bullet. Sub-tasks belong in the Phase block as Success
  Criteria, not as Progress sub-items.
- **No estimates, owners, due dates**: scope creep. Not here.
- **No descriptive prose between phases or subsections**: the Progress section is parsed by tooling.
  Keep it strictly headings + bullets.
