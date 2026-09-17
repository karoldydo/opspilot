---
name: odp-implement
description: >
  Autonomously implement technical plans from
  .context/changes/<change-id>/plan.md with no human interaction and
  no commits — the whole run stays in the working tree for review and manual
  testing. Second step of the odp loop (/odp-plan → /odp-implement →
  /odp-review → manual tests → /odp-archive). Delegates each phase's code changes to a
  subagent, flips the plan's Automated Progress rows, verifies each phase
  through an automatic quality-gate stack (plan success criteria,
  deliberate-break check, the repo's own lint/format/typecheck/build checks),
  writes a per-phase diff snapshot instead of a commit, and surfaces pending
  Manual rows as a closing human checklist. Use when the user asks for
  /odp-implement, wants autonomous plan execution without commits, or runs the
  odp plan/implement/review flow.
argument-hint: <change-id> [phase N]
allowed-tools:
  - Read
  - Glob
  - Grep
  - Write
  - Edit
  - Bash
  - Task
  - TaskCreate
  - TaskUpdate
  - TaskList
  - TaskGet
---

# Implement Plan Autonomously, Without Commits

You are tasked with implementing an approved technical plan from `.context/changes/<change-id>/plan.md` without human interaction and **without creating a single commit**. Plans contain phases with specific changes and a canonical `## Progress` section at the bottom that drives execution state (see `references/progress-format.md`). Every decision a human would normally make is replaced by an explicit automatic policy in this document. Each phase closes with a diff snapshot instead of a commit, and the reviewer reads the dirty working tree.

## Portability

This skill is self-contained and language/stack agnostic. It depends on exactly three things:

- **`.context/`** — the toolkit's own state directory, holding `changes/<change-id>/` (the plan being executed) and optionally `foundation/` (`lessons.md`, `roadmap.md`). Nothing outside `.context/` is required, and everything inside it is optional except the plan itself.
- **`git`** — for staging, the break-check restore, and the phase snapshots.
- **Whatever checks the repository already declares** — gate (c) discovers them rather than assuming a toolchain (see "Resolving the repo checks").

Drop the `odp-implement/` folder into another project's skills directory and it works there unchanged.

## Language

**Every question put to the user is asked in Polish** — the `question` text, the `header`, and each option's `label` and `description`. This holds for every `AskUserQuestion` call in this skill, including the ones whose templates below are written in English; those templates fix the *shape* of a question, never the words. Everything else stays in English: narration lines, the files written under `.context/`, report bodies, and the commands printed for the user to copy.

## Positioning & invocation

This skill is the middle step of the odp loop: **`/odp-plan` → `/odp-implement` → `/odp-review` → manual tests by a human → `/odp-archive`**. It runs standalone and needs no wrapper.

- **Standalone**: `/odp-implement <change-id> [phase N]`.
- **Under `/goal`** (optional): set the goal first, then invoke the skill — `/goal <condition>` followed by `/odp-implement <change-id> [phase N]`. The goal condition becomes the session-level stop test; this skill is the execution policy that satisfies it.
- **Headless**: `claude -p "/odp-implement <change-id>" --allowedTools "Read,Glob,Grep,Write,Edit,Bash,Task,TaskCreate,TaskUpdate,TaskList,TaskGet" --permission-mode acceptEdits`.

Copy-paste `/goal` condition template (fill in `<change-id>` and a turn bound `<N>`, typically 20):

```
Use the odp-implement skill to implement all phases of
.context/changes/<change-id>/plan.md. Done when: every row under
#### Automated in the plan's ## Progress section is checked, every
phase that produced a diff has a snapshot under
.context/changes/<change-id>/phases/, and the final output lists any
pending #### Manual rows. Constraints:
do not commit anything; do not modify or weaken existing tests unless
the plan says so; do not touch files outside the plan's scope. Stop
after <N> turns if not complete.
```

Whether or not a `/goal` wrapper is present, narrate everything in your response text: gate verdicts, snapshot paths, pending Manual rows. A goal evaluator reads **only the conversation transcript** — it cannot run commands or read files — and a returning human reads the same transcript. A gate that passed silently is indistinguishable from a gate that never ran. Narrate.

## Non-interaction policy

Nobody is watching the run. Never invoke interactive question tools — there is nobody to answer, and under headless invocation the call fails the run. Every decision is made by the policies in this document. When something is genuinely ambiguous and no policy below resolves it, pick the conservative interpretation, narrate the choice in your response text, and record it in the run report. Conservative means: the reading that touches fewer files, changes less behavior, and stays closest to the plan's literal text.

## No-commit policy

**Never run `git commit`, in any phase, for any reason** — not for the plan, not for `change.md`, not for the roadmap flip, not as an epilogue. There is no override and no "small exception". The reviewer and the human both work on the working tree.

Two things follow that this skill handles explicitly:

- **Staging still happens.** `git add` is not a commit. The touched-file set is staged mid-gate-stack, because the deliberate-break check restores files with `git checkout -- <file>`, which resets the worktree to the **index**. With an empty index that command would reset to `HEAD` and destroy the phase's work. Staging is what makes the restore exact.
- **The repo's pre-commit hook never fires.** In a repository whose quality gates live in a `pre-commit` hook, not committing means those checks never run. Gate (c) re-runs them explicitly. Do not assume any check runs on its own.

**The whole run sits uncommitted** until the human finishes manual testing. Say so once in the run report. A stray `git checkout .`, `git reset --hard`, or `git stash` wipes it; the per-phase snapshots are the only fallback.

## Setup

When this command is invoked:

1. **Resolve the plan**:
   - If invoked as `/odp-implement <change-id> [phase N]`, resolve to `.context/changes/<change-id>/plan.md`.
   - If invoked with `@.context/changes/<change-id>/plan.md` or a full path, accept it.
   - **Refuse if the resolved path is under `.context/archive/`** — print "This change is archived. Open a new change with `/odp-plan` instead." and STOP.
   - If no plan was provided or the resolved file does not exist, print one line — `Cannot start: no plan resolved from "<input>". Provide a change-id or plan path.` — and STOP. Do not guess a change-id.

2. **Load context**:
   - Read the plan completely. The `## Progress` section at the bottom is authoritative for execution state — checkmarks (`- [x]`) live ONLY there. Phase blocks contain plain `- ` bullets (no checkboxes).
   - Read `.context/foundation/lessons.md` if present and internalize each entry before starting any phase — these are the team's accepted recurring rules and must shape every implementation choice in this run. Because implementation is delegated (see "Per-phase execution model"), pass every lessons entry into each phase's dispatch — the subagent cannot see the file unless you carry it. A project without that file is fine; skip it silently.
   - Read all files mentioned in the plan (referenced research, framing notes, source files in the same change folder).
   - **Read files fully** — never use limit/offset parameters; you need complete context.

3. **Preflight the gates**:
   - Collect the commands from every phase's Automated success criteria and verify each is runnable in this environment (the binary or package script exists — e.g. check `package.json` scripts, `command -v`, `Makefile` targets). A criterion whose command cannot run is a structural mismatch for the phase that needs it: narrate the missing command now (`PREFLIGHT: <command> not runnable — Phase <N> will stop unless fixed`), and when execution reaches that phase, print the STOP block and halt. Do not silently skip an unverifiable criterion.
   - **Resolve the repo checks** for gate (c) once, here, and narrate the resolved list (see "Resolving the repo checks" below).

4. **Update `change.md`**: set `status: implementing` (only if currently `planned`, `new`, or absent — never regress `implemented` or later) and `updated: <today>`. Then **sync the roadmap** (best effort) — if `.context/foundation/roadmap.md` exists and carries an item whose `Change ID` equals `<change-id>`, flip it to `Status: in-progress`. See "## Roadmap status sync" below; narrate the outcome, never halt on it.

5. **Create phase tasks**: count total phases (from `## Phase N:` headers) and create one TaskCreate entry per phase (`subject: "Phase N: [Phase Name]"`, `activeForm: "Implementing Phase N"`). Set the current phase `in_progress` via TaskUpdate before starting work; mark it `completed` when its gates pass and its phase close completes.

6. **Find the next pending step**: scan the `## Progress` section for the first `- [ ]` row **under a `#### Automated` subsection** in document order — that is where you start. Rows under `#### Manual` are outside your jurisdiction (see "Manual rows" below); skip over them when locating the resume point. If a `phase N` argument was passed, jump to the first Automated `- [ ]` inside `### Phase N:` instead.

## Mismatch taxonomy

Plans are carefully designed, but reality can be messy. When the codebase does not match what the plan describes, classify the mismatch and act — never edit Phase blocks to make the plan fit. During a phase the implementation subagent hits these mismatches first-hand: it adapts **Minor** ones and reports them, and on a **Structural** one it stops and hands the detail back to main, which prints the STOP block.

**Minor** — a moved file, a renamed symbol, import drift, a trivial API or config delta. The plan's intent is intact; only a coordinate changed. Adapt the implementation to reality, narrate the adaptation in one or two lines (`ADAPT: plan says src/auth.ts, file is now src/auth/index.ts`), and include it in the run report.

**Structural** — a missing dependency, an architecture that differs from what the plan assumes, a referenced file or API that does not exist, a phase that depends on output a prior phase never produced. The plan cannot be followed as written and adapting would mean redesigning it. Print the STOP block and halt.

When in doubt between the two, treat it as structural. A wrong guess that halts costs one resume; a wrong guess that adapts can ship a redesign nobody approved.

## Per-phase execution model

Each phase runs in two parts with a hard division of labor:

- **Implementation is delegated.** Dispatch a single `Task` subagent to write the phase's code changes. The bulky work — reading source files, reasoning through the changes, applying edits — happens in the subagent's own context, so the main transcript stays lean across a long multi-phase run.
- **Everything a reader must see stays in main.** Gate execution, verdict lines, staging, snapshots, Progress flips, STOP blocks, and the run report all run in the main context and are narrated in your response text. A subagent's internal work is invisible to the transcript, so nothing the run is judged on may live inside a subagent.

### Dispatching the implementation subagent

For each phase, before the gate stack, dispatch one `Task` call (`subagent_type: general-purpose`) whose prompt carries:

- The change-id and the phase number + title.
- The phase's full plan section verbatim — Overview, Changes Required, Success Criteria. (Success Criteria is context so the subagent knows the target; it does NOT run the gates — main does.)
- **The implementation discipline to follow.** Resolve `references/implementation-discipline.md` (sits next to this `SKILL.md`) to an **absolute path** and instruct the subagent to Read and apply it — a spawned `Task` agent has no notion of this skill's directory, so a relative path or "read this skill's reference" will not resolve. That file is the shared craft layer: read referenced code fully, adapt to reality without redesigning, verify the change fits the surrounding codebase, apply lessons, and `Explore`-search before editing unfamiliar territory. Keep it as the single source — point at it, do not restate it inline.
- Every entry from `.context/foundation/lessons.md`, if present (the subagent cannot read the file unless you paste the entries).
- The mismatch taxonomy in force: adapt **Minor** mismatches directly and report them; on a **Structural** mismatch, STOP and report it rather than adapting or redesigning.
- Hard boundaries: implement code changes ONLY. Do not run the gate stack, do not run any `git` command, do not stage, do not commit, do not touch the `## Progress` section or any checkbox, do not edit Phase blocks, do not go outside the plan's scope, never invoke interactive tools.

Require a structured final message as the return value (not a human-facing note):

```
STATUS: completed | structural-mismatch
TOUCHED: <repo-relative path>, <path>, ...      # every file created or edited
ADAPTATIONS: <one line each, or none>
STRUCTURAL: <plan assumption vs. what exists — only when STATUS is structural-mismatch>
UNCERTAINTIES: <ambiguous decisions, or none>
```

On return:

- **`structural-mismatch`** → do not run gates. Print the STOP block using the subagent's `STRUCTURAL` detail and halt.
- **`completed`** → seed the phase's touched-file set from `TOUCHED` (see "Tracking files touched during a phase"), carry `ADAPTATIONS` and `UNCERTAINTIES` into the run report, and proceed to the gate stack. Never trust `TOUCHED` blindly — the `git status --porcelain` reconciliation at staging is the cross-check for a file the subagent touched but omitted.

## Resolving the repo checks

Gate (c) runs whatever the repository already defines as its own quality bar. Resolve it **once**, during Setup step 3, and narrate the result as `GATES RESOLVED: <command>; <command>; …` so the transcript records what gate (c) actually is here. Walk this ladder and stop at the first rung that yields commands:

1. **The pre-commit hook.** Look for `.husky/pre-commit`, `.git/hooks/pre-commit`, a `pre-commit` script in `package.json`, or a `.pre-commit-config.yaml`. Read it and run exactly what it runs, following anything it delegates to (a `lint-staged` config, a `Makefile` target, a script). That hook is the repo's own definition of "ready to commit" — and because this skill never commits, it is the check most likely to be silently skipped.
2. **Declared check scripts.** Otherwise take the repo's own scripts, in this order, running whichever exist: **format → lint → typecheck → build**. Look in `package.json` scripts, `Makefile` targets, `Justfile`, `Taskfile.yml`, `composer.json`, `pyproject.toml`, or the language's standard toolchain (`cargo clippy`/`cargo build`, `go vet`/`go build`, `mvn -q compile`).
3. **Nothing declared.** Narrate `GATES RESOLVED: none — repo declares no checks; gate (c) is a no-op.` and rely on gate (a) alone. Do not invent checks the project does not have.

Scope each command to the touched-file set where the tool accepts a file list; run it repo-wide otherwise. Commands that rewrite files in place (a formatter, `--fix` linting) require re-staging afterwards — see gate (c).

**Never run the test suite here.** Under the odp loop, verification of behavior is manual and happens after `/odp-review`; the `#### Manual` rows are that checklist. Existing tests are neither run nor modified by this gate. If a plan phase explicitly lists a test command in its `#### Automated` success criteria, that command runs as part of gate (a), where the plan put it — this exclusion applies only to the blanket repo-wide suite.

Worked example, a repo whose `.husky/pre-commit` is `lint-staged --relative && nx run-many -t typecheck` with `lint-staged` mapping `*.{ts,js,mjs}` to `eslint --fix` + `nx format:write --files`:

```bash
npx eslint --fix <touched *.ts, *.js, *.mjs>
npx nx format:write --files <touched *.json, *.html, *.scss, *.ts, *.js, *.mjs>
npx nx run-many -t typecheck
npx nx run-many -t build
```

## Per-phase gate stack

With the implementation subagent returned `completed` and the touched-file set seeded from its `TOUCHED` list, run this fixed sequence in the main context — the single canonical order for everything between "code written" and "phase closed." Gates run cheap-first; staging sits where the break-check needs it; the phase close is the tail. After each gate, print a one-line verdict in your response text — `GATE <name>: PASS` or `GATE <name>: FAIL (<summary>, attempt <k>/2)`.

1. **(a) Plan criteria** — run the phase's `#### Automated` success-criteria commands from the plan, in order. Each command is one gate with its own verdict line.

2. **Stage the touched-file set** — `git add` each file by path (set definition and dirty-path handling: see "Tracking files touched during a phase"). Staging _here_, before the break-check, is what makes the break-check's restore exact. Nothing is ever committed from this index; it exists as the phase's restore anchor and as the input to the snapshot.

3. **(b) Deliberate-break check** — only for phases that add or change tests. With the phase's files staged, verify the new or changed test actually protects something:
   1. Invert or weaken the protected behavior in production code — a worktree-only edit, never staged.
   2. Run the relevant test (scoped run, e.g. the single test file).
   3. Confirm it fails. Red here is the pass condition: `GATE break-check: PASS (test went red on broken code)`.
   4. Restore unconditionally via `git checkout -- <file>` — this resets the worktree to the staged version exactly, so the break can never leak into the snapshot or survive into review.
   5. Narrate the sequence (what was broken, that the test went red, that the file was restored).

   If the test **stays green** on broken code, the assertion protects nothing — that is a gate failure. Fix it by strengthening the assertion, never by weakening the production code or skipping the check. The restore in step 4 is unconditional, including on the failure path.

4. **(c) Repo checks** — run the command list resolved in Setup step 3 (see "Resolving the repo checks"), one verdict line each. These are the checks the repo's pre-commit hook would have run, executed explicitly because no commit happens. Any command that rewrote files in place (formatter, `--fix` lint) means the index is now stale — re-stage the touched-file set (step 2) before moving on.

5. **(d) Phase close** — never start the phase close while any gate above is red. There is no override. If a self-fix to gate (b)/(c) changed files, re-run step 2 to capture them, then run the Autonomous phase close.

## Self-fix escalation

A failing gate gets at most **2** self-fix attempts. Number them in the verdict lines (`attempt 1/2`, `attempt 2/2`). If the same gate fails a third time, the problem is deeper than mechanical drift — print the STOP block and halt rather than burning turns.

Apply a code fix the same way you apply the initial implementation: dispatch a focused `Task` subagent carrying the failing gate's output and the offending files, and union its returned `TOUCHED` paths into the phase's touched-file set before re-staging and re-running the gate. Trivial, mechanical fixes (a stray import, a rename) may be applied directly in main. Either way the 2-attempt budget is unchanged, and the break-check's worktree-only edit + unconditional restore always stays in main — never delegate it.

Boundaries on what a fix may do:

- Never weaken an assertion, delete a test, or relax a lint/typecheck rule to make a gate pass, unless the plan explicitly says so. Fix the code to meet the check, not the check to meet the code.
- When a test's expected value is ambiguous — the plan and the implementation disagree and there is no independent source for the right answer — do not guess. Mark the step uncertain in the run report, leave the gate's verdict honest, and let the STOP path or the report surface it for a human.

## STOP block format

The STOP block is the human-facing failure surface and the signal that the run is not done. Print it exactly in this shape, then halt — no further edits:

```
STOPPED — <STRUCTURAL MISMATCH | GATE FAILURE> in Phase <N>
Expected: <what the plan says / what the gate requires>
Found:    <actual situation / failing output summary>
Why:      <why this blocks autonomous continuation>
Resume:   fix the above, then /odp-implement <change-id> phase <N>
```

Before halting, leave the working tree honest: completed Progress rows stay flipped, in-progress work stays in the worktree, and any deliberate-break edit is restored. Resume needs no extra state — the first pending Automated row is the re-entry point.

## Tracking files touched during a phase

Staging and the phase snapshot both work from a **touched-file set** maintained in working memory throughout each phase. This set is the canonical input to `git add` — never fall back to `git status` heuristics for staging decisions.

- **Seed the set from the implementation subagent's `TOUCHED` list** when it returns `completed`, and union in any path returned by a self-fix subagent. When you edit a file directly in the main context — the `## Progress` checkboxes in `plan.md`, a `change.md` status flip — add its path too.
- The set always contains `.context/changes/<change-id>/plan.md` — add it on entry to a phase, before any checkboxes flip.
- **Phase 1 bootstrap**: on the first phase of a change, also seed the set with all untracked or modified files inside `.context/changes/<change-id>/` (typically `change.md`, `research.md`, `plan.md`) so the change's context files are captured from the start.
- **Snapshots are excluded.** Paths under `.context/changes/<change-id>/phases/` are never added to the touched-file set, never staged, and never reported as DIRTY. They are run artifacts; staging them would nest each snapshot inside the next one.
- The set **resets at each phase boundary**, after the phase close completes.
- The set overrides `git status`. A file that is dirty but not in the set is unrelated — it is never staged.

**Staging the set (gate-stack step 2):** stage the touched-file set ∪ `{.context/changes/<change-id>/plan.md}` (Phase 1: bootstrap-seeded set). Run `git status --porcelain` and read **only the second column** — the worktree column. Any path whose worktree column is non-blank (` M`, ` D`, `??`) and that is outside the staging set and outside `.context/changes/<change-id>/phases/` is **never staged** — list it as `DIRTY (not staged): <paths>` in your response text (so it appears in the transcript and run report) and continue with the planned set only. This reconciliation is also the safety net against a delegated subagent that touched a file but left it off `TOUCHED` — the omission surfaces as DIRTY rather than slipping silently past the phase boundary. Stage by name with `git add` each file; never `git add -A` or `git add .`.

**Why the worktree column and not "any dirty path".** The index is never reset, because nothing here commits. A file staged in phase 1 stays staged for the rest of the run and keeps showing up in `git status --porcelain` as `M ` — index-modified, worktree-clean. The touched-file set resets at each phase boundary; the index does not. Keying DIRTY off both columns would therefore re-report the entire phase-1 set (plus the bootstrap seeds `change.md`, `research.md`, `frame.md`) on every later phase, under a label that is flatly untrue — those paths *are* staged — and would bury the one genuinely omitted file in a list that grows with every phase. The worktree column isolates exactly the signal wanted: a file changed on disk that nobody staged.

## Roadmap status sync

If the project keeps `.context/foundation/roadmap.md`, it indexes work items by a stable **Change ID**. This step marks the matching item **`in-progress`** when implementation starts, so the roadmap shows live work.

Run it **once, on entry** (right after the `change.md` → `implementing` stamp), not per phase. The lookup is **mandatory**; "best effort" scopes only the *edits* — a missing roadmap or a not-found target is skipped silently and never halts the run, triggers the STOP block, or counts against the self-fix budget. Do not skip the check assuming there's no roadmap; narrate the outcome (matched + flipped, already-advanced, or no-match) in your response text either way.

1. `test -f .context/foundation/roadmap.md`. If absent, narrate `ROADMAP: none — skipped.` and skip this step.
2. Capture dirty state: `ROADMAP_PREDIRTY=$(git status --porcelain .context/foundation/roadmap.md 2>/dev/null)` (used in step 5).
3. Read the file. Find `<change-id>` used as a `Change ID`:
   - in an `## At a glance` table, if present — the row whose **Change ID** cell equals `<change-id>` exactly;
   - and in the item bodies — the `### <ID>: …` block containing a `- **Change ID:** <change-id>` line.

   `<ID>` is the item's roadmap-local id. Match is exact-string only. **No match** → narrate `ROADMAP: no item with Change ID "<change-id>" — left untouched.` and skip the rest.
4. **Match found** → if the item's `- **Status:**` is already `in-progress` or `done`, leave it (**forward-only** — never regress) and narrate `ROADMAP: <ID> already <status> — left untouched.`; skip to step 5. Otherwise set the **Status** cell in the table and the `- **Status:**` line in the item body to `in-progress` (each edit independent and best effort — skip a sub-edit that isn't where the file puts it, and narrate the skip), bump the frontmatter `updated:` to `<today>`, and narrate `ROADMAP: flipped <ID> → in-progress.` Touch only the `Status` field.
5. If `git` is available **and** `ROADMAP_PREDIRTY` was empty, add `.context/foundation/roadmap.md` to the current phase's touched-file set so the flip is staged and captured in the phase snapshot. If `ROADMAP_PREDIRTY` was non-empty, keep it OUT of the touched-file set, leave the flip in the working tree, and narrate `DIRTY (not staged): .context/foundation/roadmap.md had pre-existing edits — roadmap flip left in worktree.`

## Autonomous phase close

Runs only as gate-stack step (d), after every gate is green and the touched-file set is staged (gate-stack step 2). This is where a commit-based workflow would commit; here the phase closes with a snapshot instead. No step pauses for approval, and no step runs `git commit`.

1. **Check empty diff.** Do **not** use `git diff --cached --quiet` here. Without commits the index never returns to `HEAD` — it diverges at gate-stack step 2 of phase 1 and stays diverged — so that check reports "changed" on every phase from the second one onward regardless of what the phase did. Compare against the most recent snapshot on disk instead, which is the only per-phase baseline this loop has:

   ```bash
   TMP=$(mktemp)
   git diff HEAD > "$TMP"
   PREV=$(ls -1 .context/changes/<change-id>/phases/p*.diff 2>/dev/null | sort -V | tail -1)
   cmp -s "$TMP" "${PREV:-/dev/null}"   # no snapshot yet → compare against an empty file
   ```

   The baseline is the **latest snapshot that exists**, not `p<N-1>` by name. A phase that produced nothing writes no snapshot, so after one empty phase `p<N-1>.diff` is simply absent — keying on the number would make `cmp` fail on a missing file and mark every later phase "changed" regardless of what it did.

   Equal → the phase produced no change. Print `Phase <N> had no diff; no snapshot written.`, narrate `PHASE p<N>: closed (no commit, no diff)`, and skip to step 4.

2. **Write the phase snapshot**:

   ```bash
   mkdir -p .context/changes/<change-id>/phases
   git diff HEAD > .context/changes/<change-id>/phases/p<N>.diff
   ```

   The snapshot is **cumulative from `HEAD`**, not a per-phase delta — `git diff HEAD` covers staged and unstaged changes, and files that were untracked are included because step 2 staged them. Narrate `SNAPSHOT p<N>: .context/changes/<change-id>/phases/p<N>.diff (<line count> lines)`.

   The snapshot is a dump, not a point in history — it is not a `git revert` equivalent. To roll the tree back to the end of phase K:

   ```bash
   git reset && git checkout -- . && git clean -fd -e .context
   git apply .context/changes/<change-id>/phases/pK.diff
   ```

   Both halves matter. `git clean` is what actually discards untracked files created after phase K — `git checkout -- .` does not touch them, and leaving them in place makes the next command fail with `error: <path>: already exists in working directory`, because a snapshot taken over staged new files carries `new file mode` hunks. `-e .context` is what keeps `pK.diff` itself alive: snapshots are never staged (see "Tracking files touched during a phase"), so an unguarded `git clean` deletes the very file the next line applies. State the whole recipe when you surface the snapshots in the run report.

3. **Progress rows**: the rows flipped during this phase stay `- [x] N.M <title>` with **no suffix** — there is no commit to name and no placeholder goes in its place (see `references/progress-format.md`). Narrate `PHASE p<N>: closed (no commit)`.

4. **Update `change.md`**: set `updated: <today>`; keep `status: implementing` until the final phase (see "After all phases").

5. **Reset the touched-file set** and proceed directly to the next phase — no pause, no decision point. Read the next phase's plan section, set its task `in_progress`, and continue.

## Manual rows

Rows under `#### Manual` are a human's jurisdiction, never yours. The policy:

- **Never flip them.** They stay `- [ ]` no matter how confident you are that the behavior works.
- **Never block on them.** A phase closes when its Automated gates are green; its Manual rows do not gate the close or the next phase.
- **Always surface them.** Each phase's gate summary lists the phase's pending Manual rows verbatim, and the run report ends with the full list across all phases — that list is the checklist the human works through after `/odp-review`.

## Progress & state

**The `## Progress` section in `plan.md` is the single source of truth.** No state file, no comment markers, no sidecars. Mutate ONLY the `## Progress` section — Phase blocks (Overview, Changes Required, Success Criteria) are read-only. The `phases/*.diff` snapshots are artifacts, never state: they are written, never read back by this skill, and nothing is derived from them.

- **After each step**: Edit exactly one line, `- [ ] N.M <title>` → `- [x] N.M <title>`. Never append a suffix — this skill makes no commits, so rows carry no commit reference at any point.
- **Where am I** is derived, not stored: the first pending Automated `- [ ]` is the next step; the phase heading above it is the current phase; completion is `count([x]) / count([ ] + [x])`.
- **Resume after a STOP** needs no extra state: re-invoking `/odp-implement <change-id> [phase N]` finds the first pending Automated row and continues. Trust existing `[x]` marks; verify previous work only if something seems off.

### After all phases

When every Automated row in the entire `## Progress` section is `- [x]`:

1. Update `change.md`: set `status: implemented`, `updated: <today>`. (Do NOT set `archived_at` — it stays `null` until `/odp-archive` writes it; that skill is its only writer.) Pending Manual rows do not block this flip; they are surfaced in the run report instead.
2. **Write the final snapshot.** The last phase's `change.md` flip and Progress edits land after that phase's snapshot was taken, so stage `.context/changes/<change-id>/plan.md` and `.context/changes/<change-id>/change.md` and refresh the final snapshot: `git diff HEAD > .context/changes/<change-id>/phases/p<final>.diff`.
3. **Copy the next command to the clipboard** — `/odp-review <change-id>`, best effort and cross-platform:

   ```bash
   printf '%s' "/odp-review <change-id>" | pbcopy 2>/dev/null || printf '%s' "/odp-review <change-id>" | clip.exe 2>/dev/null || printf '%s' "/odp-review <change-id>" | xclip -selection clipboard 2>/dev/null || true
   ```

   If no clipboard tool is available, drop the `(✓ copied)` annotation from the report but still print the line.
4. Print the run report.

## Run report

End every run — successful or stopped — with a run report in your response text. This is what a returning human reads:

```
RUN REPORT — <change-id>

Phases: <completed>/<total>
- Phase 1: <title> — snapshot phases/p1.diff (gates: <names>: PASS)
- Phase 2: <title> — STOPPED (<reason>)

Nothing was committed. The full run sits in the working tree
(staged + unstaged); git log is unchanged.
Rollback to end of phase K:
  git reset && git checkout -- . && git clean -fd -e .context
  git apply .context/changes/<change-id>/phases/pK.diff

Adaptations:
- <minor mismatches adapted, one line each — or "none">

Uncertainties:
- <steps marked uncertain and why — or "none">

Pending manual verification (human checklist):
- <phase>.<index> <title>
- ...

Suggested follow-up: /odp-review <change-id>        (✓ copied)
Then work the manual checklist above, then /odp-archive <change-id> to close the change.
```

List pending Manual rows verbatim from Progress. If the run stopped early, the STOP block precedes the report and the report reflects the truncated state honestly — and nothing is copied to the clipboard, because the next command is then the STOP block's `Resume:` line, not `/odp-review`. Drop the `(✓ copied)` annotation on that path.

## Recommended environment

Per-edit hooks make this loop tighter: a PostToolUse hook running lint or typecheck on every Edit/Write catches drift seconds after it happens instead of at phase end, and a failing hook injects the error back into context automatically. Hook configuration is owned by the user's `.claude/settings.json` — this skill works without any hooks; it simply runs its phase-level gates either way. If you notice such hooks firing during the run, treat their failures like any other gate failure (same 2-attempt budget). Note that a `pre-commit` hook will never fire under this skill — gate (c) is its stand-in.
