---
name: odp-implement
description: >
  Autonomously implement technical plans from
  .context/changes/<change-id>/plan.md with no human interaction, closing
  each phase with its own Conventional Commits commit on the change's branch.
  Second step of the odp loop (/odp-plan → /odp-implement →
  /odp-review → manual tests → /odp-archive). Delegates each phase's code changes to a
  subagent, flips the plan's Automated Progress rows, verifies each phase
  through an automatic quality-gate stack (plan success criteria,
  deliberate-break check, the repo's own lint/format/typecheck/build checks),
  writes each phase's commit SHA back into the plan, and surfaces pending
  Manual rows as a closing human checklist. Use when the user asks for
  /odp-implement, wants autonomous plan execution, or runs the odp
  plan/implement/review flow.
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

# Implement Plan Autonomously, One Commit per Phase

You are tasked with implementing an approved technical plan from `.context/changes/<change-id>/plan.md` without human interaction. Plans contain phases with specific changes and a canonical `## Progress` section at the bottom that drives execution state (see `references/progress-format.md`). Every decision a human would normally make is replaced by an explicit automatic policy in this document. **Each phase closes with its own Conventional Commits commit on the change's branch, and that commit's short SHA is written back into the plan's Progress rows** — so the reviewer, and anyone reading the branch later, can see exactly which phase produced which change.

## Portability

This skill is self-contained and language/stack agnostic. It depends on exactly three things:

- **`.context/`** — the toolkit's own state directory, holding `changes/<change-id>/` (the plan being executed) and optionally `foundation/` (`lessons.md`, `roadmap.md`). Nothing outside `.context/` is required, and everything inside it is optional except the plan itself.
- **`git`** — for staging, the break-check restore, one commit per phase, and a final epilogue commit closing the plan out. The commits land on the change's own branch — the one `/odp-plan` opened and recorded in `change.md`. Setup refuses to start anywhere else, and this skill never switches branches itself.
- **Whatever checks the repository already declares** — gate (c) discovers them rather than assuming a toolchain (see "Resolving the repo checks").

Three files under `references/` travel with the skill: `progress-format.md` and `change-md.md`, the two contracts shared verbatim with the other three odp skills, and `implementation-discipline.md`, the craft layer handed to every implementation subagent. They are copies, not links — drop the `odp-implement/` folder into another project's skills directory and it works there unchanged.

## Language

**Every user-facing sentence this skill produces is written in Polish** — narration lines, gate summaries, the STOP block's prose fields, and the run report's prose. The same holds for anything it writes into a document under `.context/`.

Four things stay in English, because they are contracts rather than prose:

- **Structural headings and keys** — `## Progress`, `### Phase N:`, `#### Automated`, `#### Manual`, `### Changes Required:`, `#### Automated Verification:`, `#### Manual Verification:`, every YAML key in `change.md` frontmatter, and every `status:` value (`new`, `planned`, `implementing`, `implemented`, `impl_reviewed`, `archived`). Other skills parse these.
- **Fixed narration tokens.** Any `ALL-CAPS:` label that opens a narration line is a token and stays as written — `GATE <name>:`, `GATES RESOLVED:`, `PREFLIGHT:`, `COMMIT p<N>:`, `DIRTY (not staged):`, `ADAPT:`, `ROADMAP:`, `STOPPED —`, `RUN REPORT —`, and every other one this document spells out. The label is a token; the sentence after it is Polish. The same holds for the `✓` / `✗` / `⚠` / `→` prefixes.
- **Verbatim diagnostic blocks.** Where this document gives a multi-line block to print — a `Cannot start:` stop, an `Expected:` / `Current:` pair, a `STOPPED —` block's `Expected:` / `Found:` / `Why:` / `Resume:` field names — the field labels are fixed and English; what you fill in beside them is Polish. These are read by whoever debugs the loop, and their shape is part of the contract. The same holds for the single-line diagnostics this document spells out: the `error:` / `warning:` / `Cannot …:` prefix is a fixed English token, and the sentence after it is Polish.
- **Commit messages and copy-paste commands.** Conventional Commits subjects and bodies are English, as is anything printed for the user to paste into a terminal.

When a template below is written in English, it fixes the *shape* of the output, never the words.

## Positioning & invocation

This skill is the middle step of the odp loop: **`/odp-plan` → `/odp-implement` → `/odp-review` → manual tests by a human → `/odp-archive`**. It runs standalone and needs no wrapper.

- **Standalone**: `/odp-implement <change-id> [phase N]`.
- **Under `/goal`** (optional): set the goal first, then invoke the skill — `/goal <condition>` followed by `/odp-implement <change-id> [phase N]`. The goal condition becomes the session-level stop test; this skill is the execution policy that satisfies it.
- **Headless**: `claude -p "/odp-implement <change-id>" --allowedTools "Read,Glob,Grep,Write,Edit,Bash,Task,TaskCreate,TaskUpdate,TaskList,TaskGet" --permission-mode acceptEdits`.

Copy-paste `/goal` condition template (fill in `<change-id>` and a turn bound `<N>`, typically 20):

```
Use the odp-implement skill to implement all phases of
.context/changes/<change-id>/plan.md. Done when: every row under
#### Automated in the plan's ## Progress section is checked, each
phase that produced a diff has its own Conventional-Commits commit
whose short SHA is written back into those rows, and the final output
lists any pending #### Manual rows. Constraints: do not modify or
weaken existing tests unless the plan says so; do not touch files
outside the plan's scope. Stop after <N> turns if not complete.
```

Whether or not a `/goal` wrapper is present, narrate everything in your response text: gate verdicts, commit SHAs, pending Manual rows. A goal evaluator reads **only the conversation transcript** — it cannot run commands or read files — and a returning human reads the same transcript. A gate that passed silently is indistinguishable from a gate that never ran. Narrate.

## Non-interaction policy

Nobody is watching the run. Never invoke interactive question tools — there is nobody to answer, and under headless invocation the call fails the run. Every decision is made by the policies in this document. When something is genuinely ambiguous and no policy below resolves it, pick the conservative interpretation, narrate the choice in your response text, and record it in the run report. Conservative means: the reading that touches fewer files, changes less behavior, and stays closest to the plan's literal text.

## Commit policy

Every phase that produces a diff ends in exactly one commit. The rules around it are absolute:

- **Commit only on green.** Never start the commit ritual while any gate is red. There is no override.
- **Never pass `--no-verify`, `--amend`, or signing-bypass flags.** If a pre-commit hook fails, the commit did **not** happen — treat the hook failure as a gate failure, spend it against the same 2-attempt budget, fix the underlying issue, and create a **new** commit. Never amend your way past a hook.
- **One commit per phase, never one per step.** Steps flip their Progress checkbox as they complete; the commit is the phase boundary. There is exactly one commit beyond that — the epilogue at the end of the run (see "After all phases"), which carries the final phase's SHA write-back and the `implemented` stamp, because a commit cannot contain its own SHA.
- **Never commit anything outside the touched-file set.** Staging is by path (see "Tracking files touched during a phase"); `git add -A` and `git add .` are forbidden, because an unrelated dirty file in the user's tree would silently ride along.
- **Never push, never rebase, never rewrite history, never switch branches.** Setup has already confirmed that the checked-out branch is the change's own; commits land there and nowhere else.

Two mechanics follow that are easy to get wrong:

- **Staging happens mid-gate-stack, not at commit time.** The deliberate-break check restores files with `git checkout -- <file>`, which resets the worktree to the **index**. Staging before the break-check is what makes that restore exact — with an empty index the same command would reset to `HEAD` and destroy the phase's work.
- **The repo's pre-commit hook fires on every phase.** Gate (c) runs the repo's checks explicitly *before* the commit anyway: catching a failure there is cheaper than a rejected commit, and it keeps the failure attributable to a gate rather than to git. Expect the hook to run the same checks a second time — in most repositories that second run is a cache hit. Expect too that a hook may **modify** staged files (a formatter, `eslint --fix`); that is normal, the hook's own tooling re-stages them, and the resulting commit is the source of truth.

## Setup

When this command is invoked:

1. **Resolve the plan**:
   - If invoked as `/odp-implement <change-id> [phase N]`, resolve to `.context/changes/<change-id>/plan.md`.
   - If invoked with `@.context/changes/<change-id>/plan.md` or a full path, accept it.
   - **Refuse if the resolved path is under `.context/archive/`** — print "This change is archived. Open a new change with `/odp-plan` instead." and STOP.
   - If no plan was provided, print one line — `Cannot start: no plan resolved from "<input>". Provide a change-id or plan path.` — and STOP. Do not guess a change-id.
   - If the resolved file does not exist, **do not STOP yet** — run the worktree lookup immediately below first, and only print that same line if it comes back empty. A missing folder is not proof the change does not exist.

   **Check for a worktree before concluding the plan does not exist.** A change opened with `/odp-plan`'s worktree option keeps its whole folder in that other directory, so from here the path is simply absent — which looks identical to a change-id that was never opened. Run:

   ```bash
   git worktree list --porcelain \
     | awk -v id="<change-id>" '/^worktree /{p=substr($0,10)} /^branch /{if ($2 ~ "/" id "$") print p}'
   ```

   Empty output means no worktree holds this change. Non-empty output is the absolute path to open — print that path, not the branch name.

   A hit means the change is real and lives elsewhere. Tell the user to open that directory and re-run there, and STOP — do not `cd` into it and do not check the branch out here, because a branch cannot be checked out in two worktrees at once.

2. **Check you are in the right working tree and on the right branch.** Read `worktree:` and `branch:` from `.context/changes/<change-id>/change.md`.

   **The worktree.** If `worktree:` is `null` or absent, continue. Otherwise compare it against the current repository root, **both sides normalized** — `cd "<path>" && pwd -P` on the recorded value, `cd "$(git rev-parse --show-toplevel)" && pwd -P` on this one. A literal string compare gives a false STOP on macOS (`/tmp` versus `/private/tmp`), through a symlinked checkout, or on a trailing slash, and this STOP has no override. If the recorded path does not exist any more, `cd` fails and there is nothing to compare — say that instead of printing an empty `Expected:`. If the normalized paths match, continue. Otherwise `/odp-plan` opened this change in a **separate git worktree** and you are standing somewhere else — the branch with the change's commits is checked out there, not here. Print and STOP:

   ```
   Cannot start: <change-id> lives in a separate worktree.
   Expected: <worktree path from change.md>
   Current:  <git rev-parse --show-toplevel>
   Open that directory and re-run /odp-implement <change-id>.
   ```

   Never `cd` into it, and never `git checkout` the branch here — a branch cannot be checked out in two worktrees at once, and forcing it is how a half-implemented change ends up split across two directories.

   **The branch.** If `branch:` is `null` or absent (a change planned without git), continue. Otherwise compare it against `git rev-parse --abbrev-ref HEAD`. A mismatch means the change folder is visible from a branch that is not the change's own — the branch was merged, or `/odp-plan`'s planning commit was rejected by a hook and the user moved on. Every phase commit would land on the wrong branch, and nothing later in the loop would notice: `/odp-review` would diff `base_sha..HEAD` across whatever else that branch carries. Print and STOP:

   ```
   Cannot start: <change-id> belongs to a different branch.
   Expected: <branch from change.md>
   Current:  <git rev-parse --abbrev-ref HEAD>
   Check out that branch and re-run /odp-implement <change-id>.
   ```

   Never switch branches yourself — the current branch may carry work the user has not finished.

3. **Load context**:
   - Read the plan completely. The `## Progress` section at the bottom is authoritative for execution state — checkmarks (`- [x]`) live ONLY there. Phase blocks contain plain `- ` bullets (no checkboxes).
   - Read `.context/foundation/lessons.md` if present and internalize each entry before starting any phase — these are the team's accepted recurring rules and must shape every implementation choice in this run. Because implementation is delegated (see "Per-phase execution model"), pass every lessons entry into each phase's dispatch — the subagent cannot see the file unless you carry it. A project without that file is fine; skip it silently.
   - Read all files mentioned in the plan (referenced research, framing notes, source files in the same change folder).
   - **Read files fully** — never use limit/offset parameters; you need complete context.

4. **Preflight the gates**:
   - Collect the commands from every phase's Automated success criteria and verify each is runnable in this environment (the binary or package script exists — e.g. check `package.json` scripts, `command -v`, `Makefile` targets). A criterion whose command cannot run is a structural mismatch for the phase that needs it: narrate the missing command now (`PREFLIGHT: <command> not runnable — Phase <N> will stop unless fixed`), and when execution reaches that phase, print the STOP block and halt. Do not silently skip an unverifiable criterion.
   - **Resolve the repo checks** for gate (c) once, here, and narrate the resolved list (see "Resolving the repo checks" below).

5. **Refuse to start on a dirty index.** Run `git diff --cached --name-only`. Anything already staged is the user's, staged before this run started, and `git commit` commits the whole index — so it would ride into phase 1's commit no matter how carefully the phase stages its own files. There is no safe way around it: committing a subset with `git commit -- <paths>` is a *partial* commit that reads the working tree and ignores the index, which would break the deliberate-break restore in gate (b) (`git checkout -- <file>` resets to the index, and that is the whole reason staging happens mid-gate-stack). Print and STOP:

   ```
   Cannot start: <paths> are already staged.
   The phase commit would sweep them in.
   Either commit them first or `git reset` to unstage, then re-run /odp-implement <change-id>.
   ```

   `/odp-archive` refuses on the same condition for the same reason. Skip this check when `git` is unavailable.

6. **Update `change.md`**: set `status: implementing` (only if currently `planned`, `new`, or absent — never regress `implemented` or later) and `updated: <today>`. Then **sync the roadmap** (best effort) — if `.context/foundation/roadmap.md` exists and carries an item whose `Change ID` equals `<change-id>`, flip it to `Status: in-progress`. See "## Roadmap status sync" below; narrate the outcome, never halt on it.

7. **Create phase tasks**: count total phases (from `## Phase N:` headers) and create one TaskCreate entry per phase (`subject: "Phase N: [Phase Name]"`, `activeForm: "Implementing Phase N"`). Set the current phase `in_progress` via TaskUpdate before starting work; mark it `completed` when its gates pass and its commit lands.

8. **Find the next pending step**: scan the `## Progress` section for the first `- [ ]` row **under a `#### Automated` subsection** in document order — that is where you start. Rows under `#### Manual` are outside your jurisdiction (see "Manual rows" below); skip over them when locating the resume point. If a `phase N` argument was passed, jump to the first Automated `- [ ]` inside `### Phase N:` instead.

## Mismatch taxonomy

Plans are carefully designed, but reality can be messy. When the codebase does not match what the plan describes, classify the mismatch and act — never edit Phase blocks to make the plan fit. During a phase the implementation subagent hits these mismatches first-hand: it adapts **Minor** ones and reports them, and on a **Structural** one it stops and hands the detail back to main, which prints the STOP block.

**Minor** — a moved file, a renamed symbol, import drift, a trivial API or config delta. The plan's intent is intact; only a coordinate changed. Adapt the implementation to reality, narrate the adaptation in one or two lines (`ADAPT: plan says src/auth.ts, file is now src/auth/index.ts`), and include it in the run report.

**Structural** — a missing dependency, an architecture that differs from what the plan assumes, a referenced file or API that does not exist, a phase that depends on output a prior phase never produced. The plan cannot be followed as written and adapting would mean redesigning it. Print the STOP block and halt.

When in doubt between the two, treat it as structural. A wrong guess that halts costs one resume; a wrong guess that adapts can ship a redesign nobody approved.

## Per-phase execution model

Each phase runs in two parts with a hard division of labor:

- **Implementation is delegated.** Dispatch a single `Task` subagent to write the phase's code changes. The bulky work — reading source files, reasoning through the changes, applying edits — happens in the subagent's own context, so the main transcript stays lean across a long multi-phase run.
- **Everything a reader must see stays in main.** Gate execution, verdict lines, staging, commits, SHAs, Progress flips, STOP blocks, and the run report all run in the main context and are narrated in your response text. A subagent's internal work is invisible to the transcript, so nothing the run is judged on may live inside a subagent.

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

Gate (c) runs whatever the repository already defines as its own quality bar. Resolve it **once**, during Setup step 4, and narrate the result as `GATES RESOLVED: <command>; <command>; …` so the transcript records what gate (c) actually is here. Walk this ladder and stop at the first rung that yields commands:

1. **The pre-commit hook.** Look for `.husky/pre-commit`, `.git/hooks/pre-commit`, a `pre-commit` script in `package.json`, or a `.pre-commit-config.yaml`. Read it and run exactly what it runs, following anything it delegates to (a `lint-staged` config, a `Makefile` target, a script). That hook is the repo's own definition of "ready to commit", so running it as gate (c) means a phase fails on your terms — with a gate verdict and a self-fix budget — instead of on git's, with a rejected commit.
2. **Declared check scripts.** Otherwise take the repo's own scripts, in this order, running whichever exist: **format → lint → typecheck → build**. Look in `package.json` scripts, `Makefile` targets, `Justfile`, `Taskfile.yml`, `composer.json`, `pyproject.toml`, or the language's standard toolchain (`cargo clippy`/`cargo build`, `go vet`/`go build`, `mvn -q compile`).
3. **Nothing declared.** Narrate `GATES RESOLVED: none — repo declares no checks; gate (c) is a no-op.` and rely on gate (a) alone. Do not invent checks the project does not have.

Scope each command to the touched-file set where the tool accepts a file list; run it repo-wide otherwise. Commands that rewrite files in place (a formatter, `--fix` linting) require re-staging afterwards — see gate (c).

**Never run the test suite here.** One consequence is worth stating rather than leaving implicit: **phase commits are not regression-gated.** A change that breaks an existing test lands on the branch anyway, and the only things between it and `/odp-archive` are `/odp-review`, which reads code rather than running it, and the human's manual pass. That is the trade the odp loop makes — the loop moves without waiting on a suite, and the human's pass is the real gate.

Under the odp loop, verification of behavior is manual and happens after `/odp-review`; the `#### Manual` rows are that checklist. Existing tests are neither run nor modified by this gate. If a plan phase explicitly lists a test command in its `#### Automated` success criteria, that command runs as part of gate (a), where the plan put it — this exclusion applies only to the blanket repo-wide suite.

Worked example, a repo whose `.husky/pre-commit` is `lint-staged --relative && nx run-many -t typecheck` with `lint-staged` mapping `*.{ts,js,mjs}` to `eslint --fix` + `nx format:write --files`:

```bash
npx eslint --fix <touched *.ts, *.js, *.mjs>
npx nx format:write --files <touched *.json, *.html, *.scss, *.ts, *.js, *.mjs>
npx nx run-many -t typecheck
npx nx run-many -t build
```

## Per-phase gate stack

With the implementation subagent returned `completed` and the touched-file set seeded from its `TOUCHED` list, run this fixed sequence in the main context — the single canonical order for everything between "code written" and "commit landed." Gates run cheap-first; staging sits where the break-check needs it; the commit ritual is the tail. After each gate, print a one-line verdict in your response text — `GATE <name>: PASS` or `GATE <name>: FAIL (<summary>, attempt <k>/2)`.

1. **(a) Plan criteria** — run the phase's `#### Automated` success-criteria commands from the plan, in order. Each command is one gate with its own verdict line.

2. **Stage the touched-file set** — `git add` each file by path (set definition and dirty-path handling: see "Tracking files touched during a phase"). Staging _here_, before the break-check, is what makes the break-check's restore exact. This same index is what the phase's commit is built from.

3. **(b) Deliberate-break check** — only for phases that add or change tests. With the phase's files staged, verify the new or changed test actually protects something:
   1. Invert or weaken the protected behavior in production code — a worktree-only edit, never staged.
   2. Run the relevant test (scoped run, e.g. the single test file).
   3. Confirm it fails. Red here is the pass condition: `GATE break-check: PASS (test went red on broken code)`.
   4. Restore unconditionally via `git checkout -- <file>` — this resets the worktree to the staged version exactly, so the break can never leak into the commit.
   5. Narrate the sequence (what was broken, that the test went red, that the file was restored).

   If the test **stays green** on broken code, the assertion protects nothing — that is a gate failure. Fix it by strengthening the assertion, never by weakening the production code or skipping the check. **The break edit must never be committed**; the restore in step 4 is unconditional, including on the failure path.

4. **(c) Repo checks** — run the command list resolved in Setup step 4 (see "Resolving the repo checks"), one verdict line each. These are the checks the repo's pre-commit hook will run again at commit time; running them here first turns a hook rejection into an ordinary gate failure with a self-fix budget. Any command that rewrote files in place (formatter, `--fix` lint) means the index is now stale — re-stage the touched-file set (step 2) before moving on.

5. **(d) Commit** — the commit-only-on-green invariant: never start the commit ritual while any gate above is red. There is no override. If a self-fix to gate (b)/(c) changed files, re-run step 2 to capture them, then run the Autonomous commit ritual.

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

Before halting, leave the repository honest: phases that already landed keep their commits and their SHA suffixes, the current phase's incomplete work stays in the worktree uncommitted, and any deliberate-break edit is restored. Never commit a red phase to "save progress". Resume needs no extra state — the first pending Automated row is the re-entry point.

## Tracking files touched during a phase

The commit ritual stages files from a **touched-file set** maintained in working memory throughout each phase. This set is the canonical input to `git add` — never fall back to `git status` heuristics for staging decisions.

- **Seed the set from the implementation subagent's `TOUCHED` list** when it returns `completed`, and union in any path returned by a self-fix subagent. When you edit a file directly in the main context — the `## Progress` checkboxes in `plan.md`, a `change.md` status flip — add its path too.
- The set always contains `.context/changes/<change-id>/plan.md` — add it on entry to a phase, before any checkboxes flip.
- **Phase 1 bootstrap**: on the first phase of a change, also seed the set with any untracked or modified file inside `.context/changes/<change-id>/` (typically `change.md`, `frame.md`, `research.md`, `plan.md`, `plan-brief.md`) so the change's context files land in the first commit. Under the odp loop `/odp-plan` normally committed them already, in which case this seed finds nothing — that is the expected case, not a problem. Phase 1's set also takes `.context/foundation/roadmap.md` when the entry sync flipped it and found it clean (see "## Roadmap status sync", step 5) — that flip happens before any phase exists, so phase 1 is the only set it can ride in.
- The set **resets at each phase boundary**, after the phase commit completes.
- The set overrides `git status`. A file that is dirty but not in the set is unrelated — it is never staged.

**The index is empty when a phase starts.** Setup step 5 refuses to run otherwise, so the staging set below is the whole of what a phase commit contains and the plain `git commit` in the ritual needs no pathspec. That refusal is what makes this section's central claim — the touched-file set is the canonical input to the commit — true rather than aspirational.

**Staging the set (gate-stack step 2):** stage the touched-file set ∪ `{.context/changes/<change-id>/plan.md}` (Phase 1: bootstrap-seeded set). Run `git status --porcelain`; any dirty path outside the staging set is **never staged** — list it as `DIRTY (not staged): <paths>` in your response text (so it appears in the transcript and run report) and continue with the planned set only. This reconciliation is also the safety net against a delegated subagent that touched a file but left it off `TOUCHED` — the omission surfaces as DIRTY rather than slipping silently past the commit boundary. Stage by name with `git add` each file; never `git add -A` or `git add .`.

The phase commit is what keeps this list short: each phase's commit empties the index, so on the next phase `git status --porcelain` shows only what that phase actually dirtied. A path that keeps reappearing as DIRTY across phases is a real signal — something is editing a file nobody declared.

## Tracking issue/task references for commits

Before composing any phase or epilogue commit message, scan the conversation context for tracking-system references tied to this work: Jira keys (`ABC-123`), Linear IDs (`ENG-123`), GitHub issues/PRs (`#123`, `GH-123`, full URLs), or explicit task links. If present, add a `Refs:` line to the commit body, preserving the exact identifiers; multiple references go comma-separated on one line. Never invent or infer references from the change-id, branch name, or filenames — only use what is visible in context. Apply the same `Refs:` line to every phase commit and the epilogue.

## Roadmap status sync

If the project keeps `.context/foundation/roadmap.md`, it indexes work items by a stable **Change ID**. This step marks the matching item **`in-progress`** when implementation starts, so the roadmap shows live work.

Run it **once, on entry** (right after the `change.md` → `implementing` stamp), not per phase. The lookup is **mandatory**; "best effort" scopes only the *edits* — a missing roadmap or a not-found target is skipped silently and never halts the run, triggers the STOP block, or counts against the self-fix budget. Do not skip the check assuming there's no roadmap; narrate the outcome (matched + flipped, already-advanced, or no-match) in your response text either way.

1. `test -f .context/foundation/roadmap.md`. If absent, narrate `ROADMAP: none — skipped.` and skip this step.
2. Capture its dirty state with a command that *prints* the answer — `git status --porcelain .context/foundation/roadmap.md 2>/dev/null || echo "NO GIT"`. Empty output means the file was clean before you touched it. **Remember which it was**: step 5 reads that answer out of your working memory, never out of a shell variable. A bare `PREDIRTY=$(…)` assignment prints nothing, so the value never reaches you, and it would not survive into the next Bash call even if it did.
3. Read the file. Find `<change-id>` used as a `Change ID`:
   - in an `## At a glance` table, if present — the row whose **Change ID** cell equals `<change-id>` exactly;
   - and in the item bodies — the `### <ID>: …` block containing a `- **Change ID:** <change-id>` line.

   `<ID>` is the item's roadmap-local id. Match is exact-string only. **No match** → narrate `ROADMAP: no item with Change ID "<change-id>" — left untouched.` and skip the rest.
4. **Match found** → if the item's `- **Status:**` is already `in-progress` or `done`, leave it (**forward-only** — never regress) and narrate `ROADMAP: <ID> already <status> — left untouched.`; skip to step 5. Otherwise set the **Status** cell in the table and the `- **Status:**` line in the item body to `in-progress` (each edit independent and best effort — skip a sub-edit that isn't where the file puts it, and narrate the skip), bump the frontmatter `updated:` to `<today>`, and narrate `ROADMAP: flipped <ID> → in-progress.` Touch only the `Status` field.
5. If `git` is available **and** step 2 found the file clean, add `.context/foundation/roadmap.md` to **phase 1's** touched-file set so the flip commits with the first phase. This sync runs once, on entry, before any phase has started — so "the current phase" does not exist yet, and the set is reset at every phase boundary. Naming phase 1 explicitly is what keeps the flip from falling through every set and surfacing as `DIRTY (not staged)` for the rest of the run. If step 2 found the file dirty, keep it OUT of the touched-file set, leave the flip in the working tree, and narrate `DIRTY (not staged): .context/foundation/roadmap.md had pre-existing edits — roadmap flip left in worktree.`

## Autonomous commit ritual

Runs only as gate-stack step (d), after every gate is green and the touched-file set is staged (gate-stack step 2). Author one Conventional-Commits commit and write the closing short SHA back into every Progress row flipped during the phase. No step pauses for approval.

1. **Check empty diff**: `git diff --cached --quiet`. This is a guard, not a routine branch — ticking a Progress row edits `plan.md`, which is always in the staged set, so a phase that reached this point normally has something to commit even when it produced no code. Exit code 0 means nothing to commit — print `Phase <N> had no diff to commit; rows remain SHA-less; /odp-archive surfaces them as a warning.`, set `SHA=""`, and skip to step 5.

2. **Compose the message**: subject `<type>(<change-id>): <phase title> (p<N>)`, where `<type>` is chosen from the phase's nature using Conventional Commit vocabulary — `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `chore`, `ci`, `build`. The scope is the **change-id**, always, on every phase of every change: it is what makes a branch's history readable when several changes are in flight at once, and it is stable in a way a guessed package name is not. Body: short list of touched files, plus the `Refs:` line when applicable. Print the full message in your response text before committing — that is the transcript's record of what was committed and why.

3. **Commit via heredoc**:

   ```bash
   git commit -m "$(cat <<'EOF'
   <type>(<change-id>): <phase title> (p<N>)

   <short body listing touched files>
   <Refs: issue/task references, if applicable>
   EOF
   )"
   ```

   Never pass `--no-verify`, `--amend`, or signing-bypass flags. If a pre-commit hook fails, the commit did NOT happen — treat the hook failure as a gate failure (it gets the same 2-attempt budget), fix the underlying issue, and create a NEW commit. If the hook *succeeded* but rewrote files on its way through (a formatter, `eslint --fix`), the commit already contains the rewritten version and nothing more is owed — do not re-commit to "capture" it.

4. **Capture the short SHA**: `git rev-parse --short HEAD` (skip if `SHA=""`). Narrate it: `COMMIT p<N>: <sha>`.

5. **Write the SHA back into Progress**: for **every `#### Automated` row of this phase that is `[x]` and carries no SHA suffix**, Edit `- [x] N.M <title>` → `- [x] N.M <title> — <SHA>`. Scope it to the rows, not to your memory of which ones you flipped: a phase resumed after a STOP finds rows already ticked by the earlier attempt, and they would otherwise never get a SHA at all — `/odp-archive` would report them as missing for the rest of the change's life. Rows that already carry a suffix are skipped, never appended to twice. Never touch a `#### Manual` row. If `SHA=""`, leave the rows SHA-less; `/odp-archive` surfaces them as an informational warning, not an error.

   This write lands *after* the commit, so it is itself uncommitted — that is expected and correct. It rides into the next phase's commit as part of the touched-file set, and the final phase's write is picked up by the epilogue commit (see "After all phases").

6. **Update `change.md`**: set `updated: <today>`; keep `status: implementing` until the final phase (see "After all phases").

7. **Reset the touched-file set** and proceed directly to the next phase — no pause, no decision point. Read the next phase's plan section, set its task `in_progress`, and continue.

## Rolling a phase back

**This section is for the human, never for you.** You never undo a landed phase — the STOP block is how you hand a broken run back. Rewriting history is forbidden to this skill (see "## Commit policy"); what follows is what to tell a user who asks how to back a phase out.

A phase is a commit, so undoing one needs no special machinery and no saved diff:

```bash
git revert --no-edit <sha>   # keeps history, safe on a shared branch
```

Surface `git revert` first, and usually only. A hard reset to the phase before also throws away the Progress rows and the `change.md` stamp that rode along, which is rarely what someone wants, and it is only defensible on a branch nobody else has.

One thing a revert does not clean up, and it is not the obvious one. Phase N's commit carries its own `[ ]`→`[x]` flips, but the ` — <sha>` suffix is appended afterwards and rides into phase N+1's commit — **on the same lines**. So `git revert` of phase N does not quietly un-tick those rows; it conflicts on them. Say so up front: the plan's `## Progress` needs resolving by hand, dropping the tick and the suffix together, and `/odp-review` would otherwise `git show` a commit that no longer applies.

## Manual rows

Rows under `#### Manual` are a human's jurisdiction, never yours. The policy:

- **Never flip them.** They stay `- [ ]` no matter how confident you are that the behavior works.
- **Never block on them.** A phase closes when its Automated gates are green; its Manual rows do not gate the close or the next phase.
- **Always surface them.** Each phase's gate summary lists the phase's pending Manual rows verbatim, and the run report ends with the full list across all phases — that list is the checklist the human works through after `/odp-review`.

## Progress & state

**The `## Progress` section in `plan.md` is the single source of truth.** No state file, no comment markers, no sidecars. Mutate ONLY the `## Progress` section — Phase blocks (Overview, Changes Required, Success Criteria) are read-only.

- **After each step**: Edit exactly one line, `- [ ] N.M <title>` → `- [x] N.M <title>`. No SHA suffix mid-phase — the SHA lands at phase end via the commit ritual. Completed rows sitting `[x]` without a SHA mid-phase is a valid intermediate state, not drift.
- **Where am I** is derived, not stored: the first pending Automated `- [ ]` is the next step; the phase heading above it is the current phase; completion is `count([x]) / count([ ] + [x])`.
- **Resume after a STOP** needs no extra state: re-invoking `/odp-implement <change-id> [phase N]` finds the first pending Automated row and continues. Trust existing `[x]` marks; verify previous work only if something seems off.

### After all phases

When every Automated row in the entire `## Progress` section is `- [x]`:

1. Update `change.md`: set `status: implemented` and `updated: <today>` — **forward-only, like the entry stamp**: write `implemented` only when the current status is `implementing`, `planned`, `new` or absent. A change reviewed mid-implementation already reads `impl_reviewed`, which is ahead of `implemented`; leave it and narrate `change.md: status impl_reviewed left untouched (forward-only).` Refresh `updated` either way. (Do NOT set `archived_at` — it stays `null` until `/odp-archive` writes it; that skill is its only writer.) Pending Manual rows do not block this flip; they are surfaced in the run report instead.
2. **Run the epilogue commit.** The final phase's commit cannot contain its own SHA, so the SHA write-back plus the `change.md` status flip sit uncommitted after the final phase's ritual:
   1. Stage exactly `.context/changes/<change-id>/plan.md` and `.context/changes/<change-id>/change.md`.
   2. `git diff --cached --quiet` — if empty, skip the epilogue.
   3. Commit via heredoc with subject `chore(<change-id>): close out plan (epilogue)`, body noting the final SHA write-back + `change.md` → `implemented`, plus the `Refs:` line when applicable.
   4. Do NOT write the epilogue's own SHA back into the plan. It closes the plan; it does not implement a step, and a row pointing at it would be a lie.
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

Branch: <current branch>
Phases: <completed>/<total>
- Phase 1: <title> — <sha> (gates: <names>: PASS)
- Phase 2: <title> — STOPPED (<reason>)

Epilogue: <sha>   (plan close-out — not a step)     ← omit on a stopped run; there is no epilogue
Roll back a phase: git revert --no-edit <sha>      ← omit when no phase committed

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

Per-edit hooks make this loop tighter: a PostToolUse hook running lint or typecheck on every Edit/Write catches drift seconds after it happens instead of at phase end, and a failing hook injects the error back into context automatically. Hook configuration is owned by the user's `.claude/settings.json` — this skill works without any hooks; it simply runs its phase-level gates either way. If you notice such hooks firing during the run, treat their failures like any other gate failure (same 2-attempt budget). Note that the repo's `pre-commit` hook fires on every phase commit, after gate (c) has already run the same checks — a second, usually cached, pass.
