---
name: odp-review
description: >
  Review an implementation against its plan across the change's whole branch —
  drift, dangerous decisions, architecture violations, and pattern misuse —
  verify every candidate finding in its own clean-context sub-agent, then
  triage the survivors interactively. Third step of the odp loop
  (/odp-plan -> /odp-implement -> /odp-review -> manual tests -> /odp-archive).
  Diffs against the base_sha that /odp-plan recorded, so it sees every phase
  commit as one change. Saves a report under
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
- **`git`** — for the change-set detection (a range from `base_sha` to `HEAD`) and one commit closing the review out.
- **Whatever checks the repository already declares** — resolved on demand (see "Step 6"), never assumed.

Two files under `references/` travel with the skill, both shared verbatim with the other three odp skills: `progress-format.md`, the `## Progress` contract it reads and never writes, and `change-md.md`, the `change.md` contract it stamps. They are copies, not links — drop the `odp-review/` folder into another project's skills directory and it works there unchanged.

## Language

**Everything this skill writes for a human to read is in Polish** — every question put to the user (the `question` text, the `header`, and each option's `label` and `description`), every narration line, every report body, and **the prose of every document it writes under `.context/`**.

Four things stay in English, because they are contracts rather than prose:

- **Structural headings and keys.** In documents: `## Progress`, `### Phase N:`, `#### Automated`, `#### Manual`, `### Changes Required:`, `#### Automated Verification:`, `#### Manual Verification:`, and the other template headings reproduced below. In `change.md`: every YAML key, and every `status:` value (`new`, `planned`, `implementing`, `implemented`, `impl_reviewed`, `archived`). Other skills parse these by exact string; translating one breaks the loop silently.
- **Fixed narration tokens.** Any `ALL-CAPS:` label that opens a narration line is a token and stays as written — `BASE:`, `GATES RESOLVED:`, `GATE <name>:`, `REVIEW COMMIT:`, `STOPPED —`, `REVIEW DONE —`, and every other one this document spells out. The label is a token; the sentence after it is Polish. The same holds for the `✓` / `✗` / `⚠` / `→` prefixes.
- **Verbatim diagnostic blocks.** Where this document gives a multi-line block to print — a `Cannot start:` / `Cannot archive:` stop, an `Expected:` / `Current:` pair, a `STOPPED —` block's field names — the field labels are fixed and English; what you fill in beside them is Polish. These are read by whoever debugs the loop, and their shape is part of the contract.
- **Commit messages, file names, change-ids, and copy-paste commands.** Conventional Commits subjects and bodies are English, as is anything printed for the user to paste into a terminal.

Every template below is written in English. A template fixes the *shape* of the output — its headings, its field order, its structure — never the words that go in it.

## Reviewing a committed branch

By the time this skill runs, the change is a branch with a readable history: `/odp-plan` committed the change folder, `/odp-implement` committed each phase, wrote its SHA into the plan's `## Progress` rows, and closed with an epilogue commit carrying the final write-back. Three consequences shape this skill:

- **The change set is a range, not a dirty tree.** It runs from `base_sha` — recorded in `change.md` when the branch was opened — to `HEAD`, plus whatever is still uncommitted. See Step 1, step 6.
- **A single phase can be diffed exactly.** The SHA suffix on a Progress row names the commit that produced it, so `git show <sha>` is the phase's real delta rather than an approximation.
- **This skill commits once, on every path.** The report and the `change.md` stamp are its output, and both live inside the change folder that `/odp-archive` refuses to archive while it is dirty — so Step 6 commits them whether or not triage changed a line of code. Triage fixes, when there were any, ride in that same commit.

**Never rebase, squash, amend, or force-push.** A review that rewrites the history it just reviewed makes its own report unverifiable.

## Input resolution

1. Argument points to a saved review file (contains `<!-- IMPL-REVIEW-REPORT -->`) → **resume triage** (skip to Step 5, but run the two checks below first — "skip to Step 5" skips the *work* of Step 1, never its refusals)
2. Argument is a `<change-id>` and `.context/changes/<change-id>/plan.md` exists → fresh review on that plan
3. Plan path provided (e.g. `@.context/changes/<change-id>/plan.md`) → fresh review on that plan
4. Phase number provided (e.g. "phase 3") → review only that phase
5. No argument → enumerate `.context/changes/*/change.md`; pick the most recently `updated` change with `status` in `{planned, implementing, implemented, impl_reviewed}` and confirm via AskUserQuestion — `impl_reviewed` is included so a second pass over an already-reviewed change is reachable without naming it

If the resolved plan path starts with `.context/archive/`, refuse: print "This change is archived. Reviews are not appended to archived plans." and STOP.

**Check you are in the right working tree.** Read `worktree:` from `change.md`. If it is set and is not the current repository root (`git rev-parse --show-toplevel`), the change's branch and all of its commits live in another directory — reviewing from here would diff the wrong tree. Print the expected path and the current one, tell the user to open that directory and re-run, and STOP. When `worktree` is `null` or absent, continue.

**If the change folder is missing entirely**, do not assume the change-id is wrong — a worktree-hosted change is invisible from here. Look it up:

```bash
git worktree list --porcelain \
  | awk -v id="<change-id>" '/^worktree /{p=substr($0,10)} /^branch /{if ($2 ~ "/" id "$") print p}'
```

Empty output means no worktree holds this change. Non-empty output is the absolute path to open — print that path, not the branch name.

A hit means the change exists elsewhere: name that directory, say it must be opened there, and STOP, rather than reporting an unknown change.

## Step 1: Load plan and detect change scope

TaskCreate: "Implementation Review" / activeForm "Loading context"

1. **Read the plan file fully** — no limit/offset.
2. **Read `.context/foundation/lessons.md` if present** and use accepted rules as priors when scanning for findings — a deviation that violates a known recurring rule is a stronger signal than a generic style nit. A project without that file is fine; skip it silently.
3. **Read the canonical state from the plan's `## Progress` section** (see `references/progress-format.md`): completion = `count([x]) / count([ ] + [x])`; current phase = phase containing the first pending Automated `- [ ]` (or last phase if all done). Also read sibling `change.md` for `status` and `updated`.
4. **Scope**: specific phase requested → that phase only; else **all phases whose `#### Automated` rows are fully `[x]`**. Do not require the phase's `#### Manual` rows to be checked — under the odp loop `/odp-implement` never flips them, so a phase with pending Manual rows is a normal, reviewable, completed phase. Requiring a full `[x]` sweep here would scope every review to nothing.
5. **Extract** from phases under review: file paths from "Changes Required", architectural decisions, success criteria (Automated/Manual bullets in Phase blocks + their `[ ]`/`[x]` mirror in Progress), and the "What We're NOT Doing" list (scope guardrails).
6. **Change-set detection** — everything the change produced, committed and not:

   ```bash
   BASE=<base_sha from change.md>
   git diff --name-only "$BASE" HEAD         # the phase commits
   git diff HEAD --name-only                 # anything still uncommitted
   git ls-files --others --exclude-standard  # untracked files
   ```

   The union of those three lists is the change set. Narrate what you anchored on before going further — `BASE: <sha> (from change.md)` — because that one value decides the scope of everything below, and a review that never says what it diffed against cannot be checked. Use `git ls-files --others` rather than parsing `??` lines out of `git status --porcelain`: porcelain collapses a wholly-untracked directory into a single entry and hides the files inside it.

   **Resolving `BASE`**, in order:

   - `base_sha` from `change.md` — the normal case, written when `/odp-plan` opened the branch. Treat a **missing key, an empty value, or a literal `null`** as absent; `/odp-plan` writes `null` when it ran without git, and a present key is not the same as a usable value. Then verify it resolves (`git cat-file -e <sha>^{commit}`); a branch that was rebased or a sha from another clone will not.
   - It is absent or does not resolve → fall back to `git merge-base <default-branch> HEAD` and **say so**: `BASE: merge-base with <default> (change.md carries no usable base_sha)`. Resolve `<default-branch>` the way `/odp-plan` does: `git symbolic-ref --short refs/remotes/origin/HEAD`, stripped of its `origin/` prefix; fall back to `main`, then `master`, then whatever `HEAD` says. The fallback is honest but weaker — a rebase moves the merge-base forward, so the range can come out **narrower** than the change really is, and a merge from the default branch into this one pulls in commits the change never made.
   - **Not a git repository at all** → there is no degraded mode to fall back to: `git diff` and `git ls-files` are the same tool that just failed. Print `Cannot review: <change-id> has no usable base and this is not a git repository.` and STOP.
   - **A git repository, but no base is derivable** (a shallow clone, a detached HEAD with no merge-base) → review the working tree alone (`git diff HEAD` + untracked) and narrate `BASE: none — reviewing uncommitted work only; committed phases are out of scope.` Never silently review less than you claim to.

   Then **separate `.context/`**: changes to `plan.md`, `change.md`, `research.md` and friends are expected bookkeeping, not implementation. List them once as "change artifacts" and keep them out of the safety/quality scan and out of the "unplanned change" classification below.

   **Empty union** → print `Nothing to review: no commits since <BASE> and the working tree is clean for <change-id>. Did /odp-implement run?` and STOP. A silent empty review is worse than no review.

   For the hunks of any single file, `git diff "$BASE" -- <path>` for committed work and `git diff HEAD -- <path>` for the rest. The post-change state of a file is simply the file on disk.

Compare changed-file list against plan-file list:
- **In plan AND in diff** → expected change, verify content matches intent
- **In diff but NOT in plan** → unplanned change, investigate and flag
- **In plan but NOT in diff** → potentially missing implementation

**Reviewing a single phase**: collect the **distinct** SHA suffixes on that phase's `## Progress` rows — a phase that needed a self-fix or was resumed has more than one — and union `git show <sha>` over all of them. That is the phase's real delta rather than an approximation. Intersect with the files named in the phase's "Changes Required" to catch anything the phase touched that it was not asked to.

Then add `git diff HEAD` and `git ls-files --others --exclude-standard` on top, because the phase may be the one still in flight: `/odp-implement` writes a row's SHA *after* the commit, so the newest work is uncommitted by construction, and a phase interrupted by a STOP left its code in the tree. A phase review that looked only at commits would review nothing in exactly the case where it is worth the most.

A phase whose rows carry **no** SHA is one of the three cases in `references/progress-format.md`: still in flight, resumed and not yet re-committed, or an empty staged diff. Fall back to the "Changes Required" file list plus the uncommitted work, and say which it was rather than implying the phase is missing.

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

## Step 3.5: Verify every finding in its own clean context

TaskUpdate: activeForm "Verifying findings"

The two agents in Step 2 read broadly and under a brief that asks them to find problems. That brief is exactly what produces false positives: an agent told to look for injection risks will find something injection-shaped. This step is the counterweight — **every candidate finding is handed to a fresh sub-agent that does not know it is supposed to be a problem.**

**One `Task` sub-agent per finding** (`subagent_type: "general-purpose"`), in parallel batches of at most **8**. What each one gets is deliberately narrow:

- the file path, and the relevant hunk or the function around it;
- the claim, stated flatly and without severity — "this query is built by string concatenation and is reachable from a request parameter";
- the repository root, so it can read siblings and run a read-only command if that settles the question;
- **for a plan-drift claim only** (Agent 1's DRIFT / MISSING / EXTRA), the **single** "Changes Required" entry the claim is about, quoted verbatim. Nothing else from the plan.

What it must **not** get: the rest of the plan, the other findings, the severity, the proposed fix, or the fact that a review is happening. Each of those is a cue to agree. The point of a clean context is that the agent forms its own view.

**Why the one plan entry is not a leak.** A claim like "the plan asked for a parameterized query and the code interpolates" is not decidable from the code alone — a verifier without it will reject every drift finding it sees, and Plan Adherence and Scope Discipline, the two dimensions this skill exists for, would go quietly to zero on every run. One quoted requirement is the fact under test, not the reviewer's opinion about it; it carries no severity and no verdict.

**The instruction is neutral, not adversarial.** *"Is this description of the code accurate? Read the code around it, check how it is actually called, run something read-only if that settles it. Determine it independently and report what you find, whichever way it goes."* Telling the agent to disprove the claim would trade the Step 2 bias for its mirror image, and it also gives away that someone asserted the claim in the first place.

**Boundaries, stated in every prompt**: read only. Never edit a file, never run a mutating `git` command or anything that writes, never invoke an interactive question tool. Report back; change nothing.

Require this return shape:

```
VERDICT: CONFIRMED | REJECTED
SCOPE: <one line on how far the claim actually reaches — what can trigger it, what guards it, what it touches>
EVIDENCE: <what you read or ran, and what it showed — a quote or command output, not an opinion>
```

Handling the verdicts:

- **CONFIRMED** → the finding proceeds to Step 4 with the sub-agent's evidence folded into its `Detail`. That evidence is what makes the report worth reading: it is a second, independent look at the same code.
- **REJECTED** → the finding does **not** reach the report body. It is recorded in a short list instead (see below). Never drop it silently.
- **Re-classification is yours, not the verifier's.** The agent reports reach; you hold the severity scale, so you are the only one who can move a finding along it. An agent that reads the call site and reports "this query only ever receives values from an internal enum" has found something real about the *severity*, not about the existence — drop that finding to OBSERVATION and say why. Handing the verifier the `CRITICAL | WARNING | OBSERVATION` enum would both leak the taxonomy it is supposed to be blind to and ask it to move a finding along a scale whose starting point it was never told.

**The dimension verdicts in Step 4 are computed on what survives this step**, not on Step 2's raw output. A dimension whose only findings were rejected passes.

**Scale**: if Step 2 produced more than **24** candidates, consolidate related ones first — three complaints about the same function are one finding — and verify the consolidated set. The existing "cap at 10" applies to the finished report, not to what enters verification.

**Record the rejects.** After the batches return, keep a list of one line per rejected finding — the claim and the one-sentence reason it did not hold. It goes into the saved report under `## Rejected in verification` and is mentioned in the on-screen report as a count. A reader needs to know the review looked at nineteen things and reported six; silently reporting six looks like a shallower review than it was, and hides a verifier that is rejecting too much.

**When verification cannot run** (the `Task` tool is unavailable, or a batch fails): do not skip it silently and do not present unverified findings as verified. Carry the findings through to Step 4 marked `unverified` in their `Detail`, and say so in one line at the top of the report.

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

Plain text, box-drawing. PASS dimensions appear only in the verdicts table, never as findings. Omit severity groups with zero findings. The `Verified:` line reports Step 3.5's tallies; drop it entirely when verification could not run, and replace it with a one-line warning that the findings below are unverified.

```
═══════════════════════════════════════════════════════════
  IMPLEMENTATION REVIEW: [Plan Title]
  Scope: Phase [N] of [Total]  |  Date: YYYY-MM-DD
  Findings: [N critical] [N warnings] [N observations]
  Verified: [N] confirmed, [N] rejected
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
- **Verified**: [N] confirmed, [N] rejected — or `not run (<reason>)` when Step 3.5 could not run

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

## Rejected in verification

- **<claim, one line>** — <why it did not hold, one sentence>
- **<claim>** — <reason>
```

The `<!-- IMPL-REVIEW-REPORT -->` marker and `Decision: PENDING` fields enable resume mode.

`## Rejected in verification` carries the findings Step 3.5 threw out — claim and reason, one line each, no IDs and no `Decision:` field, because they are not up for triage. Omit the whole section when nothing was rejected.

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

- **Triage findings now** → proceed to Step 5; the saved report is the working copy. Step 5 ends by running Step 6.
- **Triage later** → print the saved report path and remind them to run `/odp-review <report-path>`, then **go straight to Step 6** (its re-check half is skipped, since no code changed), and print the hand-off block after it.
- **Done** → print the saved report path, then **go straight to Step 6**, then print the hand-off block.

**All three paths run Step 6.** The report file and the `impl_reviewed` stamp already exist on disk, uncommitted, and `/odp-archive` hard-refuses a change folder with uncommitted content — so an option that skipped the commit would hand the user a change they cannot archive. The choice decides whether triage happens now, later, or not at all; it never decides whether this skill's own output gets committed. The hand-off block is printed **after** the commit, not instead of it.

## Step 5: Interactive triage

TaskUpdate: activeForm "Triage"

### Resume mode

If entered via saved file: read it, parse `### F` headers, filter to `Decision: PENDING`. If none: print "All findings triaged.", then run Step 6 — which will find nothing staged and say so — and print the hand-off block.

**Recover the change context before triaging.** Skipping Step 1 also skipped everything Step 6 and the hand-off need — including the worktree check, which applies here exactly as it does on a fresh review: derive `<change-id>` first, read its `change.md`, and if `worktree:` names a directory that is not the current repository root, STOP with both paths rather than triaging against the wrong tree. Derive `<change-id>` from the report path — a saved report always lives at `.context/changes/<change-id>/reviews/<file>.md`, so it is the path segment directly above `reviews/` — then read `.context/changes/<change-id>/plan.md` and its `## Progress` section. Without this, the commit in Step 6 has no change-id for its subject and the hand-off has no Manual rows to copy. If the report sits somewhere that shape does not match, say so and ask for the change-id rather than guessing.

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

Update the saved report with the final decisions, then run Step 6. Mark the review task completed only once Step 6 has finished — it can still stop on a red gate, and a run that stopped is not a run that completed.

## Step 6: After triage — re-check and commit the fixes

**This step always runs.** It has two halves, and only the first is conditional:

- **Re-check** — runs only if triage applied at least one code fix (Apply Fix A/B, Fix now, Fix differently, or the "yes, fix now" branch of Record as lesson). Triage edits code *after* the last phase gate ran, so those edits have been checked by nothing. If every decision was Skipped / Accepted / Dismissed / lesson-only, narrate `No code changed during triage — repo checks skipped.` and go to the commit.
- **Commit** — runs on **every** path that reaches a saved report, including a clean `APPROVED` review with no findings at all.

**Why the commit is unconditional.** Step 4 writes `reviews/impl-review.md` and stamps `change.md` on every path. Both live inside `.context/changes/<change-id>/`, and `/odp-archive` **hard-refuses** to archive a change whose folder has uncommitted content. Leaving the review record loose would mean the most common outcome of this skill — a review that found nothing — is exactly the one that blocks the next step. The review record is this skill's output; committing it is not bookkeeping, it is delivery.

1. **Run the repo's own checks.** Resolve them with the same ladder `/odp-implement` uses, and narrate the resolved list as `GATES RESOLVED: <command>; <command>; …`. Stop at the first rung that yields commands:
   1. **The pre-commit hook** — `.husky/pre-commit`, `.git/hooks/pre-commit`, a `pre-commit` script in `package.json`, or `.pre-commit-config.yaml`. Read it and run exactly what it runs, following anything it delegates to (a `lint-staged` config, a `Makefile` target, a script).
   2. **Declared check scripts**, in this order, running whichever exist: **format → lint → typecheck → build**. Look in `package.json` scripts, `Makefile`, `Justfile`, `Taskfile.yml`, `composer.json`, `pyproject.toml`, or the language toolchain (`cargo clippy`, `go vet`, `mvn -q compile`).
   3. **Nothing declared** → narrate `GATES RESOLVED: none — repo declares no checks.` and skip ahead to sub-step 3 of this section (the commit).

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

3. **Commit the review.** One commit, covering the review record and whatever triage changed.

   1. **No git → skip**, narrate `REVIEW COMMIT: skipped — not a git repository.`, and go to the hand-off.
   2. Stage **by path**, always:
      - `.context/changes/<change-id>/reviews/<report file>` — this skill's output;
      - `.context/changes/<change-id>/change.md` — the `impl_reviewed` stamp;
      - `.context/changes/<change-id>/plan.md` — whenever triage chose "Document in the plan as an addendum". It lives inside the change folder, so leaving it out is the one omission that blocks `/odp-archive` outright;
      - `.context/foundation/lessons.md` — whenever triage chose "Record as lesson". Outside the change folder, so it blocks nothing, but leaving it loose silently drops the skill's own output;
      - every source file triage edited.

      Never `git add -A` — the human may already have unrelated edits in the tree, and this is the commit most likely to sweep them up.
   3. `git diff --cached --quiet` → nothing staged at all means a previous run already committed this exact report; narrate `REVIEW COMMIT: nothing to commit.` and skip.
   4. **The subject depends on what is in it**, so that `git log` does not claim a fix that never happened:
      - triage changed code → `fix(<change-id>): apply review fixes`, body listing the finding IDs, one line each;
      - nothing changed → `docs(<change-id>): impl review`, body giving the verdict and the finding counts.

      ```bash
      git commit -m "$(cat <<'EOF'
      fix(<change-id>): apply review fixes

      F1: <one line>
      F3: <one line>
      EOF
      )"
      ```

      Never pass `--no-verify` or `--amend`. If the hook rejects the commit despite sub-step 1 passing, treat it as the red gate in sub-step 2 — it gets the same 2 attempts, then the STOP block.
   5. Narrate `REVIEW COMMIT: <sha>` and carry the SHA into the hand-off block.

   The `Decision:` fields in the saved report are the record of *why* each fix exists; this commit is the record of *what* it changed. Both are on the branch.

## Hand-off to manual testing

Every path that reaches a saved report ends with this block — a completed review, a deferred triage, a finished triage, and a gate failure after triage fixes alike. It closes the loop `/odp-implement` opens with its `Suggested follow-up` line. The one exception is the empty-union refusal in Step 1, which never gets as far as a report:

```
REVIEW DONE — <change-id>
Report: <the report path written in Step 4 — impl-review.md, or impl-review-phase-N.md for a phase-scoped review>
Verdict: <APPROVED | NEEDS ATTENTION | REJECTED>
Findings: <n> reported, <m> rejected in verification
Review commit: <sha>           <- omit this line when there was nothing to commit, or no git

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
- **The only commit this skill makes is the one in Step 6**, and it runs on every path that reaches a saved report — including a review that found nothing. It always carries the report and the `change.md` stamp, and additionally whatever triage changed.
- **Never rebase, squash, amend, or force-push**, and never touch a commit `/odp-implement` made. The SHAs in the plan's `## Progress` rows point at them; rewriting one turns every reference into a dangling pointer.
- Be specific. "src/auth/handler.ts:42 — SQL query built with string concatenation, vulnerable to injection" — not "there might be a security issue somewhere".
- Don't flag style preferences unless they matter. If the code works and follows the plan, minor style differences from existing code are observations, not warnings.
- If the plan itself was flawed (e.g., planned an insecure approach), flag it — this review catches plan issues too.
- Impact is about *decision effort*, not *severity*. LOW impact on a CRITICAL finding means the fix is obvious; HIGH impact on a WARNING means the tradeoff is real.
- Two fix options only when there's a genuine tradeoff. Don't invent alternatives for trivial fixes.
- When reviewing a single phase, still check if changes from that phase broke assumptions of previous phases. Phases can interact.
- During triage, keep momentum. User already read the report.
- When fixing, minimal targeted edits. Don't refactor surrounding code or "improve" things that weren't flagged.
