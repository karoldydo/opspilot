---
name: odp-review
description: >
  Review an implementation against its plan on the uncommitted working tree —
  drift, dangerous decisions, architecture violations, and pattern misuse —
  then triage each finding interactively. Third step of the odp loop
  (/odp-plan -> /odp-implement -> /odp-review -> manual tests -> /odp-archive).
  Derives its change set from git diff HEAD plus untracked files rather than from commit
  history, because the odp loop makes no commits. Saves a report under
  .context/changes/<change-id>/reviews/ and hands the pending Manual rows to
  the human as a closing checklist. Use when the user asks for /odp-review,
  wants an implementation reviewed before manual testing, or runs the odp
  plan/implement/review flow.
argument-hint: <change-id> [phase N] | <saved-review-path>
allowed-tools:
  - Read
  - Glob
  - Grep
  - Write
  - Edit
  - Bash
  - Task
  - AskUserQuestion
  - TaskCreate
  - TaskUpdate
  - TaskList
  - TaskGet
---

# Implementation Review

Compare actual implementation work against the original plan to catch drift, dangerous decisions, architecture violations, and pattern misuse before they compound.

Two granularities:
- **Phase review**: after a single phase — fast, focused on that phase's changes
- **Full plan review**: after all phases — comprehensive sweep

Two modes:
- **Fresh review**: analyze → findings → interactive triage
- **Resume triage**: load a saved report and jump to per-issue triage

## Portability

This skill is self-contained and language/stack agnostic. It depends on exactly three things:

- **`.context/`** — the toolkit's own state directory, holding `changes/<change-id>/` (the plan under review, the report it writes) and optionally `foundation/` (`lessons.md`). Nothing outside `.context/` is required.
- **`git`** — for the change-set detection and, after triage fixes, one snapshot.
- **Whatever checks the repository already declares** — resolved on demand (see "Step 6"), never assumed.

Drop the `odp-review/` folder into another project's skills directory and it works there unchanged.

## Language

**Every question put to the user is asked in Polish** — the `question` text, the `header`, and each option's `label` and `description`. This holds for every `AskUserQuestion` call in this skill, including the ones whose templates below are written in English; those templates fix the *shape* of a question, never the words. Everything else stays in English: narration lines, the files written under `.context/`, report bodies, and the commands printed for the user to copy.

## Working on an uncommitted tree

`/odp-implement` makes **no commits**: the entire change sits in the working tree, staged and unstaged, and `git log` is untouched. Two consequences shape this skill:

- **The change set never comes from commit history.** There is no commit range to diff. Step 1 derives it from `git diff HEAD` plus untracked files.
- **This skill commits nothing either.** It writes a report, stamps `change.md`, and — only during triage, only when the user chooses a fix — edits code. All of it stays in the working tree for the human's manual testing.

## Input resolution

1. Argument points to a saved review file (contains `<!-- IMPL-REVIEW-REPORT -->`) → **resume triage** (skip to Step 5)
2. Argument is a `<change-id>` and `.context/changes/<change-id>/plan.md` exists → fresh review on that plan
3. Plan path provided (e.g. `@.context/changes/<change-id>/plan.md`) → fresh review on that plan
4. Phase number provided (e.g. "phase 3") → review only that phase
5. No argument → enumerate `.context/changes/*/change.md`; pick the most recently `updated` change with `status` in `{implementing, implemented, impl_reviewed}` and confirm via AskUserQuestion — `impl_reviewed` is included so a second pass over an already-reviewed change is reachable without naming it

If the resolved plan path starts with `.context/archive/`, refuse: print "This change is archived. Reviews are not appended to archived plans." and STOP.

## Step 1: Load plan and detect change scope

TaskCreate: "Implementation Review" / activeForm "Loading context"

1. **Read the plan file fully** — no limit/offset.
2. **Read `.context/foundation/lessons.md` if present** and use accepted rules as priors when scanning for findings — a deviation that violates a known recurring rule is a stronger signal than a generic style nit. A project without that file is fine; skip it silently.
3. **Read the canonical state from the plan's `## Progress` section** (see `references/progress-format.md`): completion = `count([x]) / count([ ] + [x])`; current phase = phase containing the first pending Automated `- [ ]` (or last phase if all done). Also read sibling `change.md` for `status` and `updated`.
4. **Scope**: specific phase requested → that phase only; else **all phases whose `#### Automated` rows are fully `[x]`**. Do not require the phase's `#### Manual` rows to be checked — under the odp loop `/odp-implement` never flips them, so a phase with pending Manual rows is a normal, reviewable, completed phase. Requiring a full `[x]` sweep here would scope every review to nothing.
5. **Extract** from phases under review: file paths from "Changes Required", architectural decisions, success criteria (Automated/Manual bullets in Phase blocks + their `[ ]`/`[x]` mirror in Progress), and the "What We're NOT Doing" list (scope guardrails).
6. **Change-set detection** — what actually changed, read from the working tree, never from commit history:

   ```bash
   git diff HEAD --name-only                 # tracked: staged + unstaged
   git ls-files --others --exclude-standard  # untracked files
   ```

   The union of those two lists is the change set. Use `git ls-files --others` rather than parsing `??` lines out of `git status --porcelain`: porcelain collapses a wholly-untracked directory into a single entry and hides the files inside it.

   Then apply two filters:

   - **Exclude `.context/changes/<change-id>/phases/`.** Those are `/odp-implement`'s per-phase diff snapshots — run artifacts, not code under review. They are cumulative dumps of the very diff you are reviewing; feeding them to a sub-agent doubles the reading for zero signal.
   - **Separate the rest of `.context/`.** Changes to `plan.md`, `change.md`, `research.md` and friends are expected bookkeeping, not implementation. List them once as "change artifacts" and keep them out of the safety/quality scan and out of the "unplanned change" classification below.

   **Empty union** → print `Nothing to review: working tree is clean for <change-id>. Did /odp-implement run?` and STOP. Do not fall back to `git log` — under the odp loop it returns nothing by construction, and a silent empty review is worse than no review.

   For the hunks of any single file, `git diff HEAD -- <path>`. The post-change state of a file is simply the file on disk.

Compare changed-file list against plan-file list:
- **In plan AND in diff** → expected change, verify content matches intent
- **In diff but NOT in plan** → unplanned change, investigate and flag
- **In plan but NOT in diff** → potentially missing implementation

**Reviewing a single phase**: scope the change set to the files named in that phase's "Changes Required", intersected with the union above. The `phases/p<N>.diff` snapshots are cumulative from `HEAD`, not per-phase deltas, so they do not give a clean single-phase diff — treat them as supporting evidence if you need to see what a phase produced, never as the source of scope.

Don't pre-read every changed file into the main context — let the sub-agents read what they need. Main context should carry the plan and the diff summary, not the full source of 20 files.

## Step 2: Parallel review via sub-agents

TaskUpdate: activeForm "Gathering evidence"

Launch **two** sub-agents simultaneously. Each gets targeted context — don't dump the full plan into both.

**Agent 1 — Plan Drift Detection** (`subagent_type: "general-purpose"`)

Give it: the "Changes Required" text for the reviewed phases, the list of file paths to read.

Instructions: for each planned change, read the actual file and verify implementation matches intent. Check for:
- Changes implemented differently than planned (intent mismatch, not formatting)
- Planned items skipped without documentation
- Additions not described in the plan (scope creep)

Report each: file path, what the plan said, what exists, verdict (MATCH / DRIFT / MISSING / EXTRA).

**Agent 2 — Safety, Quality & Pattern Compliance** (`subagent_type: "general-purpose"`)

Give it: the full list of changed files to read (the filtered union from Step 1, step 6 — no `.context/` paths), the project root path.

Instructions:

1. **Safety & quality scan** on each changed file. Flag:
   - **Security**: injection risks (SQL, command, XSS), hardcoded secrets, missing authn/authz at system boundaries, overly permissive CORS/permissions.
   - **Performance**: N+1 queries, unbounded iteration/recursion, missing pagination, unnecessary sync I/O.
   - **Reliability**: missing error handling at external boundaries (API calls, file I/O, DB), race conditions, resource leaks.
   - **Data safety**: destructive DB ops without rollback, schema changes without migration path, data loss potential.

2. **Pattern compliance** — for each changed file, find 1–2 similar existing files and compare naming, error handling approach, module structure, imports/exports, test structure, config patterns. **Only report substantive mismatches** (e.g., a new module uses camelCase where siblings use snake_case; a new endpoint skips the auth middleware pattern the rest of the API uses). Skip trivial style differences — if the code works and follows the plan, minor formatting is not a finding.

3. **Budget pattern work to scope** — if the diff changed ≤3 files, spend minimal time on patterns (not much to compare). Scale pattern depth with change scope.

Report each finding with: file, line number, category, severity (CRITICAL / WARNING / OBSERVATION), description, recommendation.

## Step 3: Verify success criteria

TaskUpdate: activeForm "Verifying success criteria"

For each reviewed phase:

**Automated**: run each command from the "Automated Verification" checkboxes with Bash. Record command, pass/fail, actual output (truncate if huge).

Run **only** what the plan lists. Never add a repo-wide test suite of your own — under the odp loop behavioral verification is manual and happens after this review. A test command the plan itself put under `#### Automated` does run here, because that is where the plan put it; the exclusion is on the blanket suite, not on the plan's own criteria.

**Manual**: pending `- [ ]` Manual rows are the **expected** state, never a finding — `/odp-implement` leaves them untouched by contract, and they are the checklist this review hands back to the human. List them; do not score them. The anomaly worth one OBSERVATION is the reverse case: a Manual row already marked `- [x]`, since nothing in the odp loop flips those automatically — note who or what checked it and whether the diff supports it.

## Step 4: Compile findings and present report

TaskUpdate: activeForm "Compiling findings"

Each finding has:
- **ID**: F1, F2, F3…
- **Severity**: CRITICAL / WARNING / OBSERVATION (how bad if ignored)
- **Impact**: LOW / MEDIUM / HIGH (how much focus the decision needs)
- **Dimension**: Plan Adherence / Scope Discipline / Safety & Quality / Architecture / Pattern Consistency / Success Criteria
- **Title**: one line
- **Location**: `file:line` (or "N/A" for missing items)
- **Detail**: what's wrong with evidence — plan vs. actual, or code vs. expected
- **Fix options**: 1 or 2 (see below)

### Impact

Orthogonal to severity. A CRITICAL with LOW impact (obvious one-line fix) is cheap; a WARNING with HIGH impact (architectural rework) deserves careful thought.

| Impact | Meaning |
|---|---|
| 🏃 **LOW** | Quick decision. Fix is obvious and narrowly scoped. Safe to batch. |
| 🔎 **MEDIUM** | Worth pausing. Real tradeoff or non-trivial edit — think before deciding. |
| 🔬 **HIGH** | Architectural stakes. Wide blast radius, strategic implications, or unclear best path. |

### Fix options

Default to **one** fix. Only offer two when there's a genuine tradeoff a smart reviewer would want to weigh (e.g. "patch the call site" vs. "fix it at the source"). If you find yourself inventing a weak second option, don't — present one and move on.

**LOW-impact findings**: just `Fix: [one line]`. Noise isn't helpful when the answer is obvious.

**MEDIUM/HIGH-impact findings**: each option gets:
```
[1-sentence approach] · Strength: [advantage, ideally grounded in code/plan evidence] · Tradeoff: [cost or risk] · Confidence: HIGH|MED|LOW — [1-line why] · Blind spot: [what we haven't verified, or "None significant"]
```

When offering two options, mark exactly one `⭐ Recommended`.

### Dimension verdicts

PASS / WARNING / FAIL per dimension:
- **Plan Adherence** — planned changes implemented as described? FAIL on MISSING or major DRIFT.
- **Scope Discipline** — "not doing" boundaries respected? WARNING if EXTRA changes exist but are benign.
- **Safety & Quality** — security, performance, reliability, data safety. FAIL on any CRITICAL finding.
- **Architecture** — module boundaries, dependency direction, abstraction justification. FAIL on violations.
- **Pattern Consistency** — follows existing conventions. WARNING on minor inconsistencies.
- **Success Criteria** — automated checks pass, manual checks surfaced. FAIL only on a failing Automated command. **Pending Manual rows never lower this verdict** — they are the hand-off, not a gap.

### Overall verdict

- **APPROVED** — all PASS, or PASS with ≤2 minor warnings
- **NEEDS ATTENTION** — multiple warnings or 1 non-critical FAIL
- **REJECTED** — any critical FAIL (security, major drift, data safety, a failing Automated success-criteria command)

Sort findings by severity: CRITICAL → WARNING → OBSERVATION. Cap at 10 — consolidate related findings if more.

### Report format

Plain text, box-drawing. PASS dimensions appear only in the verdicts table, never as findings. Omit severity groups with zero findings.

```
═══════════════════════════════════════════════════════════
  IMPLEMENTATION REVIEW: [Plan Title]
  Scope: Phase [N] of [Total]  |  Date: YYYY-MM-DD
  Findings: [N critical] [N warnings] [N observations]
═══════════════════════════════════════════════════════════

  Plan Adherence        PASS    ✅
  Scope Discipline      WARNING ⚠️   (1 finding)
  Safety & Quality      FAIL    ❌   (1 finding)
  Architecture          PASS    ✅
  Pattern Consistency   WARNING ⚠️   (1 finding)
  Success Criteria      PASS    ✅

  ► Overall: NEEDS ATTENTION

═══════════════════════════════════════════════════════════
  CRITICAL FINDINGS ❌
═══════════════════════════════════════════════════════════

  F1 — SQL injection in auth handler
  ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
    Severity:  ❌ CRITICAL
    Impact:    🔎 MEDIUM — real tradeoff; pause to reason through it
    Dimension: Safety & Quality
    Location:  src/auth/handler.ts:42

    Detail:
    SQL query built with string concatenation. Plan specified
    parameterized queries but implementation uses template literals.

    Fix: Replace the template literal with a parameterized query using
         db.query($1, [value]).
      Strength:   Matches the pattern in src/users/query.ts and removes
                  the injection class entirely.
      Tradeoff:   Minor — one call site, a few-line change.
      Confidence: HIGH — identical pattern used elsewhere in this repo.
      Blind spot: None significant.

═══════════════════════════════════════════════════════════
  WARNING FINDINGS ⚠️
═══════════════════════════════════════════════════════════

  F2 — Unplanned /api/status endpoint
  ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
    Severity:  ⚠️ WARNING
    Impact:    🔬 HIGH — architectural stakes; think carefully before deciding
    Dimension: Scope Discipline
    Location:  src/api/routes.ts:18

    Detail:
    New GET /api/status endpoint not in plan. Functionality is
    related to planned work but extends public API surface.

    Fix A ⭐ Recommended: Document in the plan as an addendum
      Strength:   Preserves the work already done; updates the source of
                  truth before future reviews use the plan as ground truth.
      Tradeoff:   Plan becomes a slightly moving target.
      Confidence: HIGH — this repo's plan updates regularly pick up
                  discovered scope through addenda.
      Blind spot: Stakeholders who reviewed the original scope aren't
                  notified.

    Fix B: Remove and add to follow-up work
      Strength:   Keeps scope discipline strict.
      Tradeoff:   Loses implemented work; a follow-up change needed later.
      Confidence: MEDIUM — depends whether anything already depends on it.
      Blind spot: Haven't checked for callers of /api/status.

  ···

  F3 — camelCase vs. snake_case
  ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
    Severity:  ⚠️ WARNING
    Impact:    🏃 LOW — quick decision; fix is obvious and narrowly scoped
    Dimension: Pattern Consistency
    Location:  src/utils/format.ts

    Detail:
    Uses camelCase (formatDate, parseInput) while existing utils use
    snake_case (format_date, parse_input).

    Fix: Rename exports to snake_case to match src/utils/.

═══════════════════════════════════════════════════════════
```

### Formatting rules for the report

- The **finding title line** holds only the ID and the short title — nothing else. Everything else goes below as labeled fields so each row is short and scannable.
- **Always pair icons with a word.** Never use a bare icon as the only signal — `❌ CRITICAL`, not just `❌`. This keeps the report readable when skimming and doesn't force the user to memorize what each icon means.
- **Impact always carries its one-line meaning** (copy from the Impact table — "architectural stakes; think carefully before deciding" / "real tradeoff; pause to reason through it" / "quick decision; fix is obvious and narrowly scoped"). This makes LOW/MEDIUM/HIGH self-explanatory at the point of use instead of relying on the user to remember the table.
- Severity, Impact, Dimension, Location are each on their own line with aligned labels. Detail starts on its own line under a `Detail:` label so it can wrap naturally.

### Saving the report (always)

**Every path through this skill persists the report and stamps the change** — Triage now, Triage later, and Done all write the file. This keeps `change.md.status` correct and leaves the findings on disk regardless of what the user does next. Do this *before* presenting the proceed options — never conditionally, and never only on the "save" branches.

1. **Write the report file** to `.context/changes/<change-id>/reviews/impl-review.md` (or `.context/changes/<change-id>/reviews/impl-review-phase-N.md` for a phase-scoped review), using the format below. Create the `reviews/` directory if absent.
2. **Stamp `change.md`**: set `status: impl_reviewed` and `updated: <today>`. Once, here — independent of which proceed option the user picks. (If a `change.md` field is already `impl_reviewed`, just refresh `updated`.)
3. If the user later triages, the on-disk report is the working copy: its `Decision:` fields are updated in place as each finding is decided (Step 5), and anything the user defers stays recorded in the report itself as `Decision: PENDING`, which is what `/odp-review <report-path>` resumes from.

```markdown
<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: [Plan Title]

- **Plan**: [plan file path]
- **Scope**: Phase [N] of [Total]
- **Date**: YYYY-MM-DD
- **Verdict**: [APPROVED/NEEDS ATTENTION/REJECTED]
- **Findings**: [N critical] [N warnings] [N observations]

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS/WARNING/FAIL |
| Scope Discipline | PASS/WARNING/FAIL |
| Safety & Quality | PASS/WARNING/FAIL |
| Architecture | PASS/WARNING/FAIL |
| Pattern Consistency | PASS/WARNING/FAIL |
| Success Criteria | PASS/WARNING/FAIL |

## Findings

### F1 — SQL injection in auth handler

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/auth/handler.ts:42
- **Detail**: SQL query built with string concatenation. Plan specified parameterized queries.
- **Fix**: Replace the template literal with a parameterized query using db.query($1, [value]).
  - Strength: Matches pattern in src/users/query.ts; removes injection class.
  - Tradeoff: Minor — one call site, a few-line change.
  - Confidence: HIGH — identical pattern used elsewhere.
  - Blind spot: None significant.
- **Decision**: PENDING

### F2 — Unplanned /api/status endpoint

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Scope Discipline
- **Location**: src/api/routes.ts:18
- **Detail**: New GET /api/status endpoint not in plan.
- **Fix A ⭐ Recommended**: Document in the plan as an addendum
  - Strength: Preserves the work; updates source of truth.
  - Tradeoff: Plan becomes a slightly moving target.
  - Confidence: HIGH — addendum pattern used regularly here.
  - Blind spot: Original-scope stakeholders not notified.
- **Fix B**: Remove and add to follow-up work
  - Strength: Keeps scope discipline strict.
  - Tradeoff: Loses implemented work; a follow-up change later.
  - Confidence: MEDIUM — depends on callers.
  - Blind spot: Haven't checked for callers.
- **Decision**: PENDING

### F3 — camelCase vs. snake_case

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/utils/format.ts
- **Detail**: Uses camelCase while existing utils use snake_case.
- **Fix**: Rename exports to snake_case to match src/utils/.
- **Decision**: PENDING
```

The `<!-- IMPL-REVIEW-REPORT -->` marker and `Decision: PENDING` fields enable resume mode.

### Proceed options

With the report already saved and `change.md` already stamped, ask how to proceed:

```
question: "Review saved to <report-path>. How would you like to proceed?"
header: "Implementation Review — [N] findings"
options:
  - label: "Triage findings now"
    description: "Walk through each finding and decide. Decisions are written back to the saved report."
  - label: "Triage later"
    description: "Resume with /odp-review <report-path>."
  - label: "Done"
    description: "Report saved — I'll handle the findings myself."
multiSelect: false
```

- **Triage findings now** → proceed to Step 5; the saved report is the working copy.
- **Triage later** → print the saved report path, remind them to run `/odp-review <report-path>`, then print the hand-off block.
- **Done** → print the saved report path, then the hand-off block, and STOP.

Whichever they pick, the report file and the `impl_reviewed` stamp already exist on disk — the choice only decides whether triage happens now, later, or is left to the user.

## Step 5: Interactive triage

TaskUpdate: activeForm "Triage"

### Resume mode

If entered via saved file: read it, parse `### F` headers, filter to `Decision: PENDING`. If none: print "All findings triaged.", then the hand-off block, and stop.

**Recover the change context before triaging.** Skipping Step 1 also skipped everything Step 6 and the hand-off need. Derive `<change-id>` from the report path — a saved report always lives at `.context/changes/<change-id>/reviews/<file>.md`, so it is the segment two levels above `reviews/` — then read `.context/changes/<change-id>/plan.md` and its `## Progress` section. Without this, the snapshot in Step 6 has no path to write to and the hand-off has no Manual rows to copy. If the report sits somewhere that shape does not match, say so and ask for the change-id rather than guessing.

### Triage loop

Walk findings in severity order (CRITICAL → WARNING → OBSERVATION). For each:

**With 2 fix options:**
```
question: "F[N] — [title]\n\nSeverity: [sev icon] [SEV]\nImpact: [impact icon] [LEVEL] — [meaning]\nDimension: [dim]\nLocation: [loc]\n\nDetail: [detail]\n\n[Fix A block]\n\n[Fix B block]"
header: "Finding [current] of [total remaining]"
options:
  - label: "Apply Fix A ⭐"
    description: "[Fix A one-liner]"
  - label: "Apply Fix B"
    description: "[Fix B one-liner]"
  - label: "Skip"
    description: "Not worth fixing now."
  - label: "Record as lesson"
    description: "Save as a recurring project rule in .context/foundation/lessons.md."
multiSelect: false
```

**With 1 fix option:**
```
question: "F[N] — [title]\n\nSeverity: [sev icon] [SEV]\nImpact: [impact icon] [LEVEL] — [meaning]\nDimension: [dim]\nLocation: [loc]\n\nDetail: [detail]\n\n[Fix block]"
header: "Finding [current] of [total remaining]"
options:
  - label: "Fix now"
    description: "[Fix one-liner]"
  - label: "Fix differently"
    description: "Different approach — let's discuss."
  - label: "Skip"
    description: "Not worth fixing now."
  - label: "Record as lesson"
    description: "Save as a recurring project rule in .context/foundation/lessons.md."
multiSelect: false
```

**Handling responses:**
- **Apply Fix A/B / Fix now**: show the exact before/after code change. Brief confirmation ("Apply this?"), then edit. Mark FIXED (record which option, e.g. "Fixed via Fix A").
- **Fix differently**: ask the preferred approach, apply, mark FIXED.
- **Record as lesson**: pre-fill four lessons-entry fields directly from the finding — `Context` from the finding's Location, `Problem` from the finding's Detail, `Rule` and `Applies to` left as empty placeholders for the user to fill. Show the proposed entry as a complete markdown block and ask the user to edit / confirm via AskUserQuestion ("Approve this entry?" / "Edit before saving" / "Cancel"). On confirm, append the entry as a new H2 section to `.context/foundation/lessons.md` — if the file does not exist, create it first with this canonical header (no separate template file; the header is embedded inline here):

  ```
  # Lessons Learned

  > Append-only register of recurring rules and patterns. Re-read at the start of every odp run.

  ```

  The pre-fill-then-confirm flow is the load-bearing UX detail; the user must see the full proposed entry with the pre-filled Context/Problem and have a chance to edit Rule and Applies-to before append. After the append succeeds, **always** ask a follow-up via AskUserQuestion: "Lesson saved. Also apply the fix to the current code?" with options "Yes — fix now" / "No — lesson only". **Never skip this question or decide on the user's behalf** — whether the fix is trivial, out of scope, or spans many files, the decision belongs to the user. If yes: show the before/after code change, apply, mark `FIXED + ACCEPTED-AS-RULE: <rule title>`. If no: mark `ACCEPTED-AS-RULE: <rule title>` (finding stays unfixed, rule is recorded for future work).
- **Skip** → SKIPPED. Move on, don't argue.
- **Other (free text)**: interpret the user's intent. Common intents: "fix differently" (especially in dual-fix context) → ask the preferred approach, apply, mark FIXED; "accept risk" → mark ACCEPTED with the user's justification; "dismiss"/"disagree" → mark DISMISSED.

After each decision, update the saved report's `Decision:` field for that finding (the report always exists on disk — see Step 4).

### Summary

```
═══════════════════════════════════════════════════════════
  TRIAGE COMPLETE
═══════════════════════════════════════════════════════════

  Fixed:     F1, F2 (Fix A)   (2)
  Rule:      F3 (+ fixed)     (1)
  Skipped:   F4               (1)
  Accepted:  F5               (1)

═══════════════════════════════════════════════════════════
```

Update the saved report with the final decisions. Mark the review task completed, then run Step 6.

## Step 6: After triage — re-check and snapshot

Runs **only if triage applied at least one code fix** (Apply Fix A/B, Fix now, Fix differently, or the "yes, fix now" branch of Record as lesson). If every decision was Skipped / Accepted / Dismissed / lesson-only, narrate `No code changed during triage — repo checks and snapshot skipped.` and go straight to the hand-off.

The reason this step exists: the odp loop makes no commits, so a repository whose quality bar lives in a `pre-commit` hook never runs it. A fix applied here would otherwise reach the human's manual testing completely unverified.

1. **Run the repo's own checks.** Resolve them with the same ladder `/odp-implement` uses, and narrate the resolved list as `GATES RESOLVED: <command>; <command>; …`. Stop at the first rung that yields commands:
   1. **The pre-commit hook** — `.husky/pre-commit`, `.git/hooks/pre-commit`, a `pre-commit` script in `package.json`, or `.pre-commit-config.yaml`. Read it and run exactly what it runs, following anything it delegates to (a `lint-staged` config, a `Makefile` target, a script).
   2. **Declared check scripts**, in this order, running whichever exist: **format → lint → typecheck → build**. Look in `package.json` scripts, `Makefile`, `Justfile`, `Taskfile.yml`, `composer.json`, `pyproject.toml`, or the language toolchain (`cargo clippy`, `go vet`, `mvn -q compile`).
   3. **Nothing declared** → narrate `GATES RESOLVED: none — repo declares no checks.` and skip ahead to sub-step 3 of this section (the snapshot).

   Scope each command to the files triage touched where the tool accepts a file list; run it repo-wide otherwise. One verdict line per command: `GATE <name>: PASS` / `GATE <name>: FAIL (<summary>)`. **Never run the repo-wide test suite** — behavioral verification is the human's manual pass, which comes next.

2. **A red gate is not left silent.** Fix it mechanically, at most **2** attempts, numbered in the verdict lines (`attempt 1/2`). Never weaken a lint rule, an assertion, or a type to make it pass. If it fails a third time, print:

   ```
   STOPPED — GATE FAILURE after triage fixes
   Expected: <what the check requires>
   Found:    <failing output summary>
   Why:      a triage fix left the tree failing the repo's own checks
   Resume:   fix the above, then re-run the check; the review report is already saved at <report-path>
   ```

   then print the hand-off block and end there. The report and the `impl_reviewed` stamp are already on disk, so nothing is lost — and the manual checklist is owed to the human either way: it verifies behavior, not the repo's own checks, so a red gate is no reason to withhold it.

3. **Snapshot the tree**: `mkdir -p .context/changes/<change-id>/phases && git diff HEAD > .context/changes/<change-id>/phases/review-fixes.diff`, narrated as `SNAPSHOT review-fixes: <path> (<n> lines)`. The name carries no phase number deliberately — it does not collide with `/odp-implement`'s `p<N>.diff` and it is visibly from a later stage. Like those, it is cumulative from `HEAD` and is a dump, not a point in history.

Triage fixes are **not staged**. Unlike `/odp-implement`, nothing here needs the index as a restore anchor, and `git diff HEAD` captures unstaged work either way.

## Hand-off to manual testing

Every path that reaches a saved report ends with this block — a completed review, a deferred triage, a finished triage, and a gate failure after triage fixes alike. It closes the loop `/odp-implement` opens with its `Suggested follow-up` line. The one exception is the empty-union refusal in Step 1, which never gets as far as a report:

```
REVIEW DONE — <change-id>
Report: <the report path written in Step 4 — impl-review.md, or impl-review-phase-N.md for a phase-scoped review>
Verdict: <APPROVED | NEEDS ATTENTION | REJECTED>

Nothing was committed. The whole change still sits in the working tree.

Pending manual verification (your checklist):
- <phase>.<index> <title>
- ...

When the checklist is clear: /odp-archive <change-id>        (✓ copied)
```

Copy the Manual rows verbatim from `## Progress`, in document order, across every phase in scope. If there are none, print `- none`.

**Put `/odp-archive <change-id>` on the clipboard** before printing the block — on every path that reaches it, since archiving is the next step from all of them:

```bash
printf '%s' "/odp-archive <change-id>" | pbcopy 2>/dev/null || printf '%s' "/odp-archive <change-id>" | clip.exe 2>/dev/null || printf '%s' "/odp-archive <change-id>" | xclip -selection clipboard 2>/dev/null || true
```

If no clipboard tool is available, drop the `(✓ copied)` annotation but still print the line.

## Notes

- This is a **review** skill. Default to analyzing and reporting — only make edits during triage when the user explicitly chooses "Apply Fix" or "Fix differently" for a specific finding.
- **Never run `git commit`.** The change arrived uncommitted and leaves uncommitted; the human commits after manual testing, if at all.
- The `phases/*.diff` files are run artifacts, not code under review — `/odp-implement`'s `p<N>.diff` snapshots, plus the `review-fixes.diff` this skill writes in Step 6. Never scan them, never flag them, never count them as unplanned changes.
- Be specific. "src/auth/handler.ts:42 — SQL query built with string concatenation, vulnerable to injection" — not "there might be a security issue somewhere".
- Don't flag style preferences unless they matter. If the code works and follows the plan, minor style differences from existing code are observations, not warnings.
- If the plan itself was flawed (e.g., planned an insecure approach), flag it — this review catches plan issues too.
- Impact is about *decision effort*, not *severity*. LOW impact on a CRITICAL finding means the fix is obvious; HIGH impact on a WARNING means the tradeoff is real.
- Two fix options only when there's a genuine tradeoff. Don't invent alternatives for trivial fixes.
- When reviewing a single phase, still check if changes from that phase broke assumptions of previous phases. Phases can interact.
- During triage, keep momentum. User already read the report.
- When fixing, minimal targeted edits. Don't refactor surrounding code or "improve" things that weren't flagged.
