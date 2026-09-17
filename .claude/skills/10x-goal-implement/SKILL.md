---
name: 10x-goal-implement
description: >
  Autonomously implement technical plans from
  context/changes/<change-id>/plan.md under Claude Code's
  /goal — no human interaction at any point. Sibling of /10x-implement for
  unattended runs, in an interactive /goal session or headless via claude -p.
  Delegates each phase's code changes to a subagent, flips the
  plan's Automated Progress rows, verifies each phase through an automatic
  quality-gate stack (plan success criteria, deliberate-break check, full suite),
  commits each phase on green with Conventional Commits, and
  surfaces pending Manual rows as a closing human checklist. Use when the user
  wants autonomous or unattended plan execution, pairs /goal with a plan, asks to
  "run the plan under /goal", or needs headless implementation.
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

# Implement Plan Autonomously (under /goal)

You are tasked with implementing an approved technical plan from `context/changes/<change-id>/plan.md` without human interaction. Plans contain phases with specific changes and a canonical `## Progress` section at the bottom that drives execution state (see `references/progress-format.md`). This skill is the autonomous sibling of `/10x-implement`: it shares the same plan contracts — plan resolution, `## Progress` as single source of truth, touched-file tracking, Conventional-Commits protocol, `change.md` lifecycle — but every decision a human would make is replaced by an explicit automatic policy.

## Positioning & invocation

Run this skill inside a `/goal` session. The goal condition is the session-level stop test; this skill is the execution policy that satisfies it.

- **Interactive**: set the goal first, then invoke the skill — `/goal <condition>` followed by `/10x-goal-implement <change-id> [phase N]`.
- **Headless**: `claude -p "/goal <condition> /10x-goal-implement <change-id>" --allowedTools "Read,Glob,Grep,Write,Edit,Bash,Task,TaskCreate,TaskUpdate,TaskList,TaskGet" --permission-mode acceptEdits`.

Copy-paste `/goal` condition template (fill in `<change-id>` and a turn bound `<N>`, typically 20):

```
Use the 10x-goal-implement skill to implement all phases of
context/changes/<change-id>/plan.md. Done when: every row under
#### Automated in the plan's ## Progress section is checked, each
phase has its own Conventional-Commits commit, and the final output
lists any pending #### Manual rows. Constraints: do not modify or
weaken existing tests unless the plan says so; do not touch files
outside the plan's scope. Stop after <N> turns if not complete.
```

The goal evaluator reads **only the conversation transcript** — it cannot run commands or read files. Everything the condition tests for must therefore be narrated in your response text: gate verdicts, commit SHAs, pending Manual rows. A gate that passed silently is indistinguishable from a gate that never ran. Narrate.

## Non-interaction policy

Nobody is watching the run. Never invoke interactive question tools — there is nobody to answer, and under headless invocation the call fails the run. Every decision is made by the policies in this document. When something is genuinely ambiguous and no policy below resolves it, pick the conservative interpretation, narrate the choice in your response text, and record it in the run report. Conservative means: the reading that touches fewer files, changes less behavior, and stays closest to the plan's literal text.

## Setup

When this command is invoked:

1. **Resolve the plan**:
   - If invoked as `/10x-goal-implement <change-id> [phase N]`, resolve to `context/changes/<change-id>/plan.md`.
   - If invoked with `@context/changes/<change-id>/plan.md` or a full path, accept it.
   - **Refuse if the resolved path starts with `context/archive/`** — print "This change is archived. Open a new change with `/10x-new` instead." and STOP.
   - If no plan was provided or the resolved file does not exist, print one line — `Cannot start: no plan resolved from "<input>". Provide a change-id or plan path.` — and STOP. Do not guess a change-id.

2. **Load context**:
   - Read the plan completely. The `## Progress` section at the bottom is authoritative for execution state — checkmarks (`- [x]`) live ONLY there. Phase blocks contain plain `- ` bullets (no checkboxes).
   - Read `context/foundation/lessons.md` if present and internalize each entry before starting any phase — these are the team's accepted recurring rules and must shape every implementation choice in this run. Because implementation is delegated (see "Per-phase execution model"), pass every lessons entry into each phase's dispatch — the subagent cannot see the file unless you carry it.
   - Read all files mentioned in the plan (referenced research, frame, source files in the same change folder).
   - **Read files fully** — never use limit/offset parameters; you need complete context.

3. **Preflight the gates**: collect the commands from every phase's Automated success criteria and verify each is runnable in this environment (the binary or package script exists — e.g. check `package.json` scripts, `command -v`, `Makefile` targets). A criterion whose command cannot run is a structural mismatch for the phase that needs it: narrate the missing command now (`PREFLIGHT: <command> not runnable — Phase <N> will stop unless fixed`), and when execution reaches that phase, print the STOP block and halt. Do not silently skip an unverifiable criterion.

4. **Update `change.md`**: set `status: implementing` (only if currently in `{planned, plan_reviewed}`) and `updated: <today>`. Then **sync the roadmap** (best effort) — if `context/foundation/roadmap.md` carries an item whose `Change ID` equals `<change-id>`, flip it to `Status: in-progress`, the open-work counterpart to `/10x-archive`'s `done` flip. See "## Roadmap status sync" below; narrate the outcome, never halt on it.

5. **Create phase tasks**: count total phases (from `## Phase N:` headers) and create one TaskCreate entry per phase (`subject: "Phase N: [Phase Name]"`, `activeForm: "Implementing Phase N"`). Set the current phase `in_progress` via TaskUpdate before starting work; mark it `completed` when its gates pass and its commit lands.

6. **Find the next pending step**: scan the `## Progress` section for the first `- [ ]` row **under a `#### Automated` subsection** in document order — that is where you start. Rows under `#### Manual` are outside your jurisdiction (see "Manual rows" below); skip over them when locating the resume point. If a `phase N` argument was passed, jump to the first Automated `- [ ]` inside `### Phase N:` instead.

## Mismatch taxonomy

Plans are carefully designed, but reality can be messy. When the codebase does not match what the plan describes, classify the mismatch and act — never edit Phase blocks to make the plan fit. During a phase the implementation subagent hits these mismatches first-hand: it adapts **Minor** ones and reports them, and on a **Structural** one it stops and hands the detail back to main, which prints the STOP block.

**Minor** — a moved file, a renamed symbol, import drift, a trivial API or config delta. The plan's intent is intact; only a coordinate changed. Adapt the implementation to reality, narrate the adaptation in one or two lines (`ADAPT: plan says src/auth.ts, file is now src/auth/index.ts`), and include it in the run report.

**Structural** — a missing dependency, an architecture that differs from what the plan assumes, a referenced file or API that does not exist, a phase that depends on output a prior phase never produced. The plan cannot be followed as written and adapting would mean redesigning it. Print the STOP block and halt.

When in doubt between the two, treat it as structural. A wrong guess that halts costs one resume; a wrong guess that adapts can ship a redesign nobody approved.

## Per-phase execution model

Each phase runs in two parts with a hard division of labor:

- **Implementation is delegated.** Dispatch a single `Task` subagent to write the phase's code changes. The bulky work — reading source files, reasoning through the changes, applying edits — happens in the subagent's own context, so the main transcript stays lean across a long multi-phase run.
- **Everything the goal evaluator must see stays in main.** Gate execution, verdict lines, staging, commits, SHAs, Progress flips, STOP blocks, and the run report all run in the main context and are narrated in your response text. The goal evaluator reads only the main transcript — a subagent's internal work is invisible to it, so nothing the goal condition tests for may live inside a subagent.

### Dispatching the implementation subagent

For each phase, before the gate stack, dispatch one `Task` call (`subagent_type: general-purpose`) whose prompt carries:

- The change-id and the phase number + title.
- The phase's full plan section verbatim — Overview, Changes Required, Success Criteria. (Success Criteria is context so the subagent knows the target; it does NOT run the gates — main does.)
- **The implementation discipline to follow.** Resolve `references/implementation-discipline.md` (sits next to this `SKILL.md`) to an **absolute path** and instruct the subagent to Read and apply it — a spawned `Task` agent has no notion of this skill's directory, so a relative path or "read this skill's reference" will not resolve. That file is the shared craft layer: read referenced code fully, adapt to reality without redesigning, verify the change fits the surrounding codebase, apply lessons, and `Explore`-search before editing unfamiliar territory. Keep it as the single source — point at it, do not restate it inline.
- Every entry from `context/foundation/lessons.md`, if present (the subagent cannot read the file unless you paste the entries).
- The mismatch taxonomy in force: adapt **Minor** mismatches directly and report them; on a **Structural** mismatch, STOP and report it rather than adapting or redesigning.
- Hard boundaries: implement code changes ONLY. Do not run the gate stack, do not stage, do not commit, do not touch the `## Progress` section or any checkbox, do not edit Phase blocks, do not go outside the plan's scope, never invoke interactive tools.

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

## Per-phase gate stack

With the implementation subagent returned `completed` and the touched-file set seeded from its `TOUCHED` list, run this fixed sequence in the main context — the single canonical order for everything between "code written" and "commit landed." Gates run cheap-first; staging sits where the break-check needs it; the commit ritual is the tail. After each gate, print a one-line verdict in your response text — `GATE <name>: PASS` or `GATE <name>: FAIL (<summary>, attempt <k>/2)` — so the goal evaluator sees it.

1. **(a) Plan criteria** — run the phase's `#### Automated` success-criteria commands from the plan, in order. Each command is one gate with its own verdict line.

2. **Stage the touched-file set** — `git add` each file by path (set definition and dirty-path handling: see "Tracking files touched during a phase"). Staging _here_, before the break-check, is what makes the break-check's restore exact.

3. **(b) Deliberate-break check** — only for phases that add or change tests. With the phase's files staged, verify the new or changed test actually protects something:
   1. Invert or weaken the protected behavior in production code — a worktree-only edit, never staged.
   2. Run the relevant test (scoped run, e.g. the single test file).
   3. Confirm it fails. Red here is the pass condition: `GATE break-check: PASS (test went red on broken code)`.
   4. Restore unconditionally via `git checkout -- <file>` — this resets the worktree to the staged version exactly, so the break can never leak into the commit.
   5. Narrate the sequence (what was broken, that the test went red, that the file was restored).

   If the test **stays green** on broken code, the assertion protects nothing — that is a gate failure. Fix it by strengthening the assertion, never by weakening the production code or skipping the check. The break edit must never be committed; the restore in step 4 is unconditional, including on the failure path.

4. **(c) Repo-wide checks** — full test suite, lint, typecheck, wherever the plan or the repository defines them (e.g. a `ci:local` script, `make check test`). One verdict line each.

5. **(d) Commit** — the commit-only-on-green invariant: never start the commit ritual while any gate above is red. There is no override. If a self-fix to gate (b)/(c) changed files, re-run step 2 to capture them, then run the Autonomous commit ritual.

## Self-fix escalation

A failing gate gets at most **2** self-fix attempts. Number them in the verdict lines (`attempt 1/2`, `attempt 2/2`). If the same gate fails a third time, the problem is deeper than mechanical drift — print the STOP block and halt rather than burning turns.

Apply a code fix the same way you apply the initial implementation: dispatch a focused `Task` subagent carrying the failing gate's output and the offending files, and union its returned `TOUCHED` paths into the phase's touched-file set before re-staging and re-running the gate. Trivial, mechanical fixes (a stray import, a rename) may be applied directly in main. Either way the 2-attempt budget is unchanged, and the break-check's worktree-only edit + unconditional restore always stays in main — never delegate it.

Boundaries on what a fix may do:

- Never weaken an assertion, delete a test, or relax a lint/typecheck rule to make a gate pass, unless the plan explicitly says so. Fix the code to meet the check, not the check to meet the code.
- When a test's expected value is ambiguous — the plan and the implementation disagree and there is no independent source for the right answer — do not guess. Mark the step uncertain in the run report, leave the gate's verdict honest, and let the STOP path or the report surface it for a human.

## STOP block format

The STOP block is the human-facing failure surface and the signal the goal evaluator reads as "not done". Print it exactly in this shape, then halt — no further edits, no commit:

```
STOPPED — <STRUCTURAL MISMATCH | GATE FAILURE> in Phase <N>
Expected: <what the plan says / what the gate requires>
Found:    <actual situation / failing output summary>
Why:      <why this blocks autonomous continuation>
Resume:   fix the above, then /10x-goal-implement <change-id> phase <N>
```

Before halting, leave the working tree honest: completed Progress rows stay flipped, in-progress work stays in the worktree uncommitted, and any deliberate-break edit is restored. Resume needs no extra state — the first pending Automated row is the re-entry point.

## Tracking files touched during a phase

The commit ritual stages files from a **touched-file set** maintained in working memory throughout each phase. This set is the canonical input to `git add` — never fall back to `git status` heuristics for staging decisions.

- **Seed the set from the implementation subagent's `TOUCHED` list** when it returns `completed`, and union in any path returned by a self-fix subagent. When you edit a file directly in the main context — the `## Progress` checkboxes in `plan.md`, a `change.md` status flip — add its path too.
- The set always contains `context/changes/<change-id>/plan.md` — add it on entry to a phase, before any checkboxes flip.
- **Phase 1 bootstrap**: on the first phase of a change, also seed the set with all untracked or modified files inside `context/changes/<change-id>/` (typically `change.md`, `research.md`, `plan.md`) so the change's context files land in the first commit.
- The set **resets at each phase boundary**, after the phase commit completes.
- The set overrides `git status`. A file that is dirty but not in the set is unrelated — it is never staged.

**Staging the set (gate-stack step 2):** stage the touched-file set ∪ `{context/changes/<change-id>/plan.md}` (Phase 1: bootstrap-seeded set). Run `git status --porcelain`; any dirty path outside the staging set is **never staged** — list it as `DIRTY (not staged): <paths>` in your response text (so it appears in the transcript and run report) and continue with the planned set only. This reconciliation is also the safety net against a delegated subagent that touched a file but left it off `TOUCHED` — the omission surfaces as DIRTY rather than slipping silently past the commit boundary. Stage by name with `git add` each file; never `git add -A` or `git add .`.

## Tracking issue/task references for commits

Before composing any phase or epilogue commit message, scan the conversation context for tracking-system references tied to this work: Jira keys (`ABC-123`), Linear IDs (`ENG-123`), GitHub issues/PRs (`#123`, `GH-123`, full URLs), or explicit task links. If present, add a `Refs:` line to the commit body, preserving the exact identifiers; multiple references go comma-separated on one line. Never invent or infer references from the change-id, branch name, or filenames — only use what is visible in context. Apply the same `Refs:` line to every phase commit and the epilogue.

## Roadmap status sync

`context/foundation/roadmap.md` (produced by `/10x-roadmap`) indexes each Foundation/Slice by a stable **Change ID**. `/10x-archive` flips the matching item to `Status: done` when a change archives; this step wires the near end — when autonomous implementation *starts*, mark the matching item **`in-progress`** so the roadmap shows live work.

Run it **once, on entry** (right after the `change.md` → `implementing` stamp), not per phase. The lookup is **mandatory**; "best effort" scopes only the *edits* — a missing roadmap or a not-found target is skipped silently and never halts the run, triggers the STOP block, or counts against the self-fix budget. Do not skip the check assuming there's no roadmap; narrate the outcome (matched + flipped, already-advanced, or no-match) in your response text either way so the goal evaluator sees it.

1. `test -f context/foundation/roadmap.md`. If absent, narrate `ROADMAP: none — skipped.` and skip this step.
2. Capture dirty state: `ROADMAP_PREDIRTY=$(git status --porcelain context/foundation/roadmap.md 2>/dev/null)` (used in step 5).
3. Read the file. Find `<change-id>` used as a `Change ID`:
   - in the `## At a glance` table — the row whose **Change ID** cell equals `<change-id>` exactly;
   - and in the `## Foundations` / `## Slices` bodies — the `### <ID>: …` block containing a `- **Change ID:** <change-id>` line.

   `<ID>` is the item's roadmap-local id (`F-NN` / `S-NN`). Match is exact-string only. **No match** → narrate `ROADMAP: no item with Change ID "<change-id>" — left untouched.` and skip the rest.
4. **Match found** → if the item's `- **Status:**` is already `in-progress` or `done`, leave it (**forward-only** — never regress) and narrate `ROADMAP: <ID> already <status> — left untouched.`; skip to step 5. Otherwise set the **Status** cell in `## At a glance` and the `- **Status:**` line in the item body to `in-progress` (each edit independent and best effort — skip a sub-edit that isn't where the template puts it, and narrate the skip), bump the frontmatter `updated:` to `<today>`, and narrate `ROADMAP: flipped <ID> → in-progress.` Touch only the `Status` field.
5. If `git` is available **and** `ROADMAP_PREDIRTY` was empty, add `context/foundation/roadmap.md` to the current phase's touched-file set so the flip commits with the phase. If `ROADMAP_PREDIRTY` was non-empty, keep it OUT of the touched-file set, leave the flip in the working tree, and narrate `DIRTY (not staged): context/foundation/roadmap.md had pre-existing edits — roadmap flip left in worktree.`

## Autonomous commit ritual

Runs only as gate-stack step (d), after every gate is green and the touched-file set is staged (gate-stack step 2). Author one Conventional-Commits commit and write the closing short SHA back into every Progress row flipped during the phase. No step pauses for approval.

1. **Check empty diff**: `git diff --cached --quiet`. Exit code 0 means nothing to commit — print `Phase <N> had no diff to commit; rows remain SHA-less; archive warn-only will surface them.`, set `SHA=""`, and skip to step 5.

2. **Compose the message**: subject `<type>(<change-id>): <phase title> (p<N>)`, where `<type>` ∈ `feat / fix / chore / refactor / docs` chosen from the phase's nature. Body: short list of touched files, plus the `Refs:` line when applicable. Print the full message in your response text before committing — that is the transcript's record of what was committed and why.

3. **Commit via heredoc**:

   ```bash
   git commit -m "$(cat <<'EOF'
   <type>(<change-id>): <phase title> (p<N>)

   <short body listing touched files>
   <Refs: issue/task references, if applicable>
   EOF
   )"
   ```

   Never pass `--no-verify`, `--amend`, or signing-bypass flags. If a pre-commit hook fails, the commit did NOT happen — treat the hook failure as a gate failure (it gets the same 2-attempt budget), fix the underlying issue, and create a NEW commit.

4. **Capture the short SHA**: `git rev-parse --short HEAD` (skip if `SHA=""`). Narrate it: `COMMIT p<N>: <sha>`.

5. **Write the SHA back into Progress**: for every row flipped during this phase, Edit `- [x] N.M <title>` → `- [x] N.M <title> — <SHA>`. Skip rows that already carry a SHA suffix (resume safety — never double-append). If `SHA=""`, leave the rows SHA-less; `/10x-archive` surfaces them as informational warnings.

6. **Update `change.md`**: set `updated: <today>`; keep `status: implementing` until the final phase (see "After all phases").

7. **Reset the touched-file set** and proceed directly to the next phase — no pause, no decision point. Read the next phase's plan section, set its task `in_progress`, and continue.

## Manual rows

Rows under `#### Manual` are a human's jurisdiction, never yours. The policy:

- **Never flip them.** They stay `- [ ]` no matter how confident you are that the behavior works.
- **Never block on them.** A phase is committed when its Automated gates are green; its Manual rows do not gate the commit or the next phase.
- **Always surface them.** Each phase's gate summary lists the phase's pending Manual rows verbatim, and the run report ends with the full list across all phases — that list is the post-run human checklist.

## Progress & state

**The `## Progress` section in `plan.md` is the single source of truth.** No state file, no comment markers, no sidecars. Mutate ONLY the `## Progress` section — Phase blocks (Overview, Changes Required, Success Criteria) are read-only.

- **After each step**: Edit exactly one line, `- [ ] N.M <title>` → `- [x] N.M <title>`. No SHA suffix mid-phase — the SHA lands at phase end via the ritual. Completed rows sitting `[x]` without a SHA mid-phase is a valid intermediate state.
- **Where am I** is derived, not stored: the first pending Automated `- [ ]` is the next step; the phase heading above it is the current phase; completion is `count([x]) / count([ ] + [x])`.
- **Resume after a STOP** needs no extra state: re-invoking `/10x-goal-implement <change-id> [phase N]` finds the first pending Automated row and continues. Trust existing `[x]` marks; verify previous work only if something seems off.

### After all phases

When every Automated row in the entire `## Progress` section is `- [x]`:

1. Update `change.md`: set `status: implemented`, `updated: <today>`. (Do NOT set `archived_at` — that belongs to `/10x-archive`.) Pending Manual rows do not block this flip; they are surfaced in the run report instead.
2. **Run the epilogue commit** — the final phase's commit cannot contain its own SHA, so the SHA write-back plus the `change.md` status flip sit dirty after the final phase ritual:
   1. Stage exactly `context/changes/<change-id>/plan.md` and `context/changes/<change-id>/change.md`.
   2. `git diff --cached --quiet` — if empty, skip the epilogue.
   3. Commit via heredoc with subject `chore(<change-id>): close out plan (epilogue)`, body noting the final SHA write-back + change.md → implemented, plus the `Refs:` line when applicable.
   4. Do NOT write the epilogue's own SHA back into the plan.
3. Print the run report.

## Run report

End every run — successful or stopped — with a run report in your response text. This is what the goal evaluator and the returning human read:

```
RUN REPORT — <change-id>

Phases: <completed>/<total>
- Phase 1: <title> — <sha> (gates: <names>: PASS)
- Phase 2: <title> — STOPPED (<reason>)

Adaptations:
- <minor mismatches adapted, one line each — or "none">

Uncertainties:
- <steps marked uncertain and why — or "none">

Pending manual verification (human checklist):
- <phase>.<index> <title>
- ...

Suggested follow-up: /10x-impl-review <change-id>
```

List pending Manual rows verbatim from Progress. If the run stopped early, the STOP block precedes the report and the report reflects the truncated state honestly.

## Recommended environment

Per-edit hooks make this loop tighter: a PostToolUse hook running lint, typecheck, or scoped tests (`vitest related "$FILE" --run`) on every Edit/Write catches drift seconds after it happens instead of at phase end, and a failing hook injects the error back into context automatically. Hook configuration is owned by the user's `.claude/settings.json` — this skill works without any hooks; it simply runs its phase-level gates either way. If you notice such hooks firing during the run, treat their failures like any other gate failure (same 2-attempt budget).
