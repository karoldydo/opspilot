---
name: odp-archive
description: >
  Close a completed change by moving its folder into .context/archive/, stamping
  change.md with archived status, and closing the matching roadmap item. Fourth
  and final step of the odp loop (/odp-plan -> /odp-implement -> /odp-review ->
  manual tests -> /odp-archive). Asks the user to confirm the manual pass when
  #### Manual rows are still unchecked, ticking them off on confirmation, then
  commits the close-out. Use when the user asks for /odp-archive, wants a
  finished change closed out, or has worked through the manual checklist
  /odp-review handed them.
argument-hint: "<change-id-or-path>"
allowed-tools:
  - Read
  - Glob
  - Edit
  - Bash
  - AskUserQuestion
---

# /odp-archive — Close a Change

Move a completed change folder from `.context/changes/<change-id>/` to `.context/archive/<created-date>-<change-id>/`, stamp `change.md` with `status: archived` + `archived_at`, and — if `.context/foundation/roadmap.md` carries a roadmap item whose `Change ID` equals `<change-id>` — close that item too: flip its `Status` to `done` and append an entry to the roadmap's `## Done` section.

The gate on the **state of the work** is warn-only: incomplete Progress, missing impl-review, rows without a commit SHA, and a status outside `{implemented, impl_reviewed}` are surfaced as warnings followed by a confirmation prompt, and the user can still archive. The hard stops are structural — a change that isn't there, one already archived, a `change.md` that can't name a destination folder — plus one git stop: uncommitted work inside the change folder, which would otherwise be swept into the archive commit half-finished.

The one thing this skill asks about rather than merely warning is the **manual pass**. Unchecked `#### Manual` rows get their own question, because they are the loop's only real gate and nothing else in it can tell whether a human actually ran them.

After archiving, the other odp skills refuse to write inside `.context/archive/<...>/`: `/odp-plan` refuses to reopen an archived id, `/odp-implement` refuses to implement under it, `/odp-review` refuses to append a review to it. Archived folders are read-only by convention.

## Portability

This skill is self-contained and language/stack agnostic. It depends on exactly two things:

- **`.context/`** — the toolkit's own state directory, holding `changes/<change-id>/` (the change being closed), `archive/` (created on demand) and optionally `foundation/roadmap.md`. Nothing outside `.context/` is required.
- **`git`** — used for three things: the pre-flight check that nothing in the change folder is uncommitted, `git mv` for the move itself, and one commit closing the change out. All three degrade: without git the skill falls back to a plain `mv`, skips the check and the commit, and works unchanged.

Two files under `references/` travel with the skill, both shared verbatim with `/odp-plan`, `/odp-implement` and `/odp-review`: `progress-format.md`, the `## Progress` contract this skill parses to count pending rows and to tick the Manual ones, and `change-md.md`, the `change.md` contract it stamps. They are copies, not links — drop the `odp-archive/` folder into another project's skills directory and it works there unchanged.

## Language

**Everything this skill writes for a human to read is in Polish** — every question put to the user (the `question` text, the `header`, and each option's `label` and `description`), every narration line, every report body, and **the prose of every document it writes under `.context/`**.

Four things stay in English, because they are contracts rather than prose:

- **Structural headings and keys.** In documents: `## Progress`, `### Phase N:`, `#### Automated`, `#### Manual`, `### Changes Required:`, `#### Automated Verification:`, `#### Manual Verification:`, and the other template headings reproduced below. In `change.md`: every YAML key, and every `status:` value (`new`, `planned`, `implementing`, `implemented`, `impl_reviewed`, `archived`). Other skills parse these by exact string; translating one breaks the loop silently.
- **Fixed narration tokens.** Any `ALL-CAPS:` label that opens a narration line is a token and stays as written — `BOOTSTRAP:`, `MANUAL:`, `Committed as:`, and every other one this document spells out. The label is a token; the sentence after it is Polish. The same holds for the `✓` / `✗` / `⚠` / `→` prefixes.
- **Verbatim diagnostic blocks.** Where this document gives a multi-line block to print — a `Cannot start:` / `Cannot archive:` stop, an `Expected:` / `Current:` pair, a `STOPPED —` block's field names — the field labels are fixed and English; what you fill in beside them is Polish. These are read by whoever debugs the loop, and their shape is part of the contract.
- **Commit messages, file names, change-ids, and copy-paste commands.** Conventional Commits subjects and bodies are English, as is anything printed for the user to paste into a terminal.

Every template below is written in English. A template fixes the *shape* of the output — its headings, its field order, its structure — never the words that go in it.

## Positioning & invocation

This skill closes the odp loop: **`/odp-plan` → `/odp-implement` → `/odp-review` → manual tests by a human → `/odp-archive`**.

Run it **after** working through the manual checklist `/odp-review` printed in its hand-off block. That checklist is the `#### Manual` rows of `## Progress`, and nothing earlier in the loop flips them — so at archive time they are still `- [ ]` and this skill names them back to you one last time and asks. That question is the point: it is the loop's only confirmation that the manual pass actually happened, and the only place a `#### Manual` row is ever allowed to be ticked.

## Working on a committed branch

By the time this skill runs the change is a branch with a full history: `/odp-plan` committed the change folder, `/odp-implement` committed each phase plus a closing epilogue, `/odp-review` committed its report and any fixes it made. Three consequences shape this skill:

- **Uncommitted work inside the change folder is a hard refusal.** The archive commit renames the folder and stamps `change.md`; an uncommitted edit sitting in there would either be swept in unreviewed or left behind pointing at a path that no longer exists. Both are worse than stopping.
- **This skill makes the loop's last commit.** The move, the `change.md` stamp and the roadmap close go in together as `chore(archive): close <change-id>`, so the branch ends clean.
- **`git mv` is the normal path, not a special case.** `/odp-plan` committed the change folder, so git knows it and the rename is recorded as a rename. The plain-`mv` fallback survives for folders git has never seen — a change planned before this skill existed, or one made by hand. See "Move the folder" below.

## Initial Response

When this command is invoked:

1. **Check if any argument was provided**:
   - If an argument was provided, parse it (see "Argument Parsing" below) and proceed to "Resolution".
   - If NO argument was provided, respond with the following message and **STOP**:

```
I'll archive a completed change. Please provide a change-id (kebab-case slug) or path:

Examples:
  /odp-archive device-scan-retry
  /odp-archive @.context/changes/oauth-login/

You can list active changes with: `ls .context/changes/`
```

   Then **wait** for the user to provide an argument.

## Argument Parsing

Take the first whitespace-delimited token. Normalize:

1. Strip a leading `@` if present.
2. Strip a trailing `/` if present.
3. If the result contains `/`, take the last non-empty path segment.

The result is `<change-id>`.

## Resolution

1. Resolve `<change-id>` to `.context/changes/<change-id>/`. If that path does not exist:
   - Check `.context/archive/` for a directory matching `*-<change-id>` (archive folders carry a `<created>-` date prefix) — if found, print: `error: change "<change-id>" is already archived at <path>.` and STOP.
   - Otherwise print: ``error: no change folder at .context/changes/<change-id>/. Run `ls .context/changes/` to list active changes.`` and STOP.
2. Read `.context/changes/<change-id>/change.md` frontmatter (`status`, `created`).
   - If `change.md` is missing, print: `error: no change.md in .context/changes/<change-id>/; cannot derive archive folder name.` and STOP.
   - If `status: archived`, print: `error: change "<change-id>" is already archived in change.md but its folder is still under .context/changes/. Inspect manually before re-running.` and STOP.
   - If `created` is missing or not `YYYY-MM-DD`, print: `error: change.md.created is missing or malformed; cannot derive archive folder name.` and STOP.

`created` is load-bearing here — it is the date prefix of the destination folder, and the thing that keeps `.context/archive/` sorted chronologically by `ls`. There is no fallback to today's date: a change whose creation date was lost should be inspected, not silently filed under the wrong day.

## Hard refusal: uncommitted changes

Two pre-flight checks. Either failing blocks the archive. Skip both, with the note below, when `git` is unavailable or this is not a git repository.

**1. Uncommitted edits inside the change folder.** Run:

```bash
git status --porcelain ".context/changes/<change-id>/"
```

Non-empty output → **block** and print:

```
✗ Cannot archive: .context/changes/<change-id>/ has uncommitted changes.

  <one line per offending path from git status --porcelain>

Commit them first, then re-run /odp-archive.
```

This is normally the tail end of the loop leaving something behind — a review report written but never committed, a `change.md` stamp from a run that stopped early. Committing it is the right fix; stashing it hides the record the archive is supposed to preserve.

**2. Pre-existing staged changes anywhere.** The archive commit bundles whatever is staged at commit time, so unrelated staged work from earlier would silently land in `chore(archive): close …`. Run:

```bash
git diff --cached --quiet
```

Non-zero exit → **block** and print:

```
✗ Cannot archive: pre-existing staged changes would be bundled into the archive commit.

  <output of git diff --cached --name-only>

Either commit them first or `git reset` to unstage, then re-run /odp-archive.
```

Either failure → STOP. Do not proceed to the warn prompt; these are hard blocks.

If `git` is unavailable or the repo is not a git repo, print `warning: not a git repository — skipping the uncommitted-changes checks.` and continue. Archiving still works; the move just loses its rename history and there is no archive commit.

**Wrong worktree.** If `change.md` records a `worktree:` that is not the current repository root, the change's folder and branch are in another directory. Print both paths, tell the user to open that one and re-run, and STOP.

The same applies one step earlier, in "Resolution": before reporting `no change folder at .context/changes/<change-id>/`, look for a worktree holding it:

```bash
git worktree list --porcelain \
  | awk -v id="<change-id>" '/^worktree /{p=substr($0,10)} /^branch /{if ($2 ~ "/" id "$") print p}'
```

Empty output means no worktree holds this change. Non-empty output is the absolute path to open — print that path, not the branch name.

A hit means the change exists in another worktree — name that directory instead of claiming the change is not there.

## Soft warnings (non-blocking)

Collect the following warnings, then present them all at once with a single confirmation prompt.

1. **Status check**: read `change.md.status`. If it is NOT in `{implemented, impl_reviewed}`, queue: `Status is "<status>"; expected "implemented" or "impl_reviewed".` Those are the two statuses the odp loop ends on — `/odp-implement` stamps `implemented` when the last phase lands, `/odp-review` stamps `impl_reviewed` when the report is written.
2. **Pending Progress check**: parse the `## Progress` section of `.context/changes/<change-id>/plan.md` (if `plan.md` exists; see `references/progress-format.md` for the contract). For each `### Phase N:` block, identify its `#### Automated` and `#### Manual` subsections and count `- [ ]` rows under each separately. Let `<X>` = total automated pending across all phases, `<Y>` = total manual pending across all phases, `<N>` = `<X> + <Y>`.

   If `<N> > 0`, queue: `<N> Progress items still pending (<X> automated, <Y> manual): <comma-separated list of "N.M <title>" tokens, truncated to 5 with "…" if longer>.` Order the combined token list by automated items first (in document order), then manual items (in document order); the truncation cap of 5 applies to the combined list.

   If `plan.md` is missing, queue: `No plan.md found in change folder.` and skip the Progress count.

   **Legacy fallback**: if no `### Phase N:` block contains either a `#### Automated` or a `#### Manual` heading, the plan predates the subsection contract or was written by hand. Count `- [ ]` rows under `### Phase` headers instead and queue `<N> Progress items still pending: …` with no parenthetical breakdown. Without this, a plan with no subsections counts zero pending rows and the warn gate waves through an unfinished change — and this skill is meant to work dropped into another project, where a foreign plan is exactly what it will meet.

   **Read the two counts differently.** A pending **automated** row means implementation work the plan asked for and `/odp-implement` never marked done — a real gap. A pending **manual** row is the **expected** state: nothing in the odp loop ever flips those, and they are precisely the checklist `/odp-review` handed back to the human. Word the warning as a reminder of what you were asked to verify, not as an accusation that something is broken.
3. **Missing impl-review check**: glob `.context/changes/<change-id>/reviews/impl-review*.md`. If none match, queue: `No impl-review found at reviews/impl-review*.md.`
4. **Missing-SHA check**: parse the `## Progress` section of `plan.md` (if it exists). Count `- [x]` rows under `#### Automated` whose line does **not** end with ` — <sha>`, where `<sha>` is 7+ hexadecimal characters (the regex ` — [0-9a-f]{7,}$` does not match). If the count is non-zero, queue: `<N> Progress rows missing SHA suffix: <comma-separated "N.M <title>" tokens, truncated to 5 with "…" if longer>.` SHA-less rows are legitimate in the cases `references/progress-format.md` lists — most often a run that stopped before that phase committed, occasionally a phase whose staged diff was empty, and plans that completed before the SHA contract existed. This is a soft signal, not a defect. Rows under `#### Manual` never carry a SHA and are not counted here. Skip silently if `plan.md` is missing; check 2 already covered that.

5. **Review-outcome check**: if a report matched in check 3, read it. It is this skill's only window into whether the review actually passed. Queue a warning when either holds:
   - its `- **Verdict**:` line reads `REJECTED` → `Review verdict is "REJECTED"; the findings were never resolved.`
   - it carries any `- **Decision**: PENDING` finding → `<N> review finding(s) still PENDING.`

   Both are soft. A user may knowingly archive a change whose review objected — that is their call — but archiving one *without being told* is not. Skip silently when no report matched; check 3 already covered that.

### The manual-pass question

**Ask this whenever `<Y> ≥ 1`** — there is at least one unchecked `#### Manual` row. It runs here, after the warnings are collected but **before** any of them is printed: it can answer one of the queued warnings outright, and a warning the user is about to resolve should never be shown to them as a problem. When `<Y>` is 0, skip straight to the print block below. This is the loop's only confirmation that a human actually exercised the behavior, and the only place a Manual row may be ticked.

Print the pending rows verbatim first, in document order, so the question is answerable without scrolling back:

```
Manual checks for <change-id>:

  - <phase>.<index> <title>
  - <phase>.<index> <title>
```

Then `AskUserQuestion` — like every template here, written in English to fix the shape; the words the user sees are Polish (see "## Language"):

- label: `Manual pass done — tick them and archive`
  description: `I ran these checks and they passed. Mark them done and archive the change.`
- label: `Not done — archive anyway`
  description: `Leave them unchecked. The change is archived with a visible gap in the checklist.`
- label: `Cancel`
  description: `Don't archive. I'm going back to testing.`

Handling:

- **Manual pass done** → **remember the answer; do not edit anything yet.** The flip happens in "Move and stamp" step 5, once the folder has actually moved. Rewrite the manual part of the Pending Progress warning to `<Y> manual check(s) confirmed by the user in this session.` — keep it in the queue rather than dropping it, so the archive prompt can still see that the remaining warnings are manual-only and that they are settled.
- **Not done** → change nothing, replace the manual part of the Pending Progress warning with `<Y> manual check(s) not confirmed.`, and continue.
- **Cancel** → print `Cancelled. Folder unchanged.` and STOP.

**Why the flip waits.** The archive prompt that follows still offers *Resume implementation* and *Cancel*, both of which stop the run. Ticking the rows here would leave `plan.md` and `change.md` edited but uncommitted on a path that archives nothing — and the next `/odp-archive` would then hard-refuse on the dirt this one created. Deferring costs nothing: the answer is a variable until step 5 uses it.

`references/progress-format.md` documents this write as archive's one narrow claim on `## Progress`: `#### Manual` rows only, only after the user says so in this session, never inferred and never defaulted.


Then print whatever warnings remain in the queue:

```
⚠ /odp-archive warnings for <change-id>:

  - <warning 1>
  - <warning 2>
```

If the queue is empty at this point, print nothing.

### The archive prompt

Then use `AskUserQuestion`. If every warning in the queue is manual-related **and** the user confirmed the manual pass above, append ` (Recommended)` to the `Continue archiving` label — a clean run ends exactly here, every time. That is why the confirmed warning stays in the queue instead of being dropped: dropping it would make this condition unreachable, because the queue would then be either empty or non-manual.

- question: `Archive "<change-id>" anyway?`
  header: `Archive`
  options:
  - label: `Continue archiving`
    description: `Move the folder to .context/archive/ despite the warnings.`
  - label: `Resume implementation`
    description: `Don't archive. Suggest /odp-implement <change-id> next.`
  - label: `Cancel`
    description: `Don't archive. Exit cleanly without further action.`
  multiSelect: false

- **Continue archiving** → proceed to "Move and stamp" below.
- **Resume implementation** → print `→ /odp-implement <change-id>` and copy that to clipboard via `pbcopy 2>/dev/null || clip.exe 2>/dev/null || xclip -selection clipboard 2>/dev/null || true` (best effort, cross-platform). STOP.
- **Cancel** → print `Cancelled. Folder unchanged.` and STOP.

If the queue is empty at this point, skip the prompt and proceed directly.

## Move and stamp

1. **Compute archive destination**:
   - `CREATED=$(awk '/^created:/ {print $2; exit}' .context/changes/<change-id>/change.md)` (date prefix, e.g., `2026-04-29`).
   - `DEST=".context/archive/${CREATED}-<change-id>"`.
   - If `$DEST` already exists, print: `error: archive destination "<DEST>" already exists. Inspect manually.` and STOP.

2. **Bootstrap the archive directory**: if `.context/archive/` does not exist, create it (`mkdir -p .context/archive`) and narrate `BOOTSTRAP: created .context/archive/`. Nothing else in this toolkit creates that directory — this skill is the only writer to it, so on the first archive in a repository it will always be missing. That is expected, not a sign the repo is unprepared.

3. **Stamp `change.md`** (in place, before the move):
   - Set `status: archived`.
   - Set `archived_at: <ISO-8601 datetime, today, UTC>` — produced by `date -u +"%Y-%m-%dT%H:%M:%SZ"`.
   - Set `updated: <today as YYYY-MM-DD>`.
   - Use the Edit tool to update each of the three frontmatter lines. Do NOT touch any other field; in particular, leave `created`, `change_id`, `branch`, `base_sha` and `worktree` alone — they are the record of where this change was built, and an archived change is exactly when someone needs that.

4. **Move the folder.** `git mv` is the expected path — `/odp-plan` committed this folder, so git knows it and records the move as a rename:

   1. Run `git ls-files -- ".context/changes/<change-id>/"`. **Non-empty output** → `git mv ".context/changes/<change-id>" "$DEST"`, so history and the index follow.
   2. **Empty output**, or `git` unavailable, or not a git repository → `mv ".context/changes/<change-id>" "$DEST"`. Narrate one line saying the folder was untracked, so the missing rename history is on the record. A folder git has never seen means planning ran without a commit — possible, just not the normal path.
   3. If `git mv` fails anyway, fall back to `mv` and narrate one line saying so.
   4. Confirm post-move: `[ -d "$DEST" ] && [ ! -d ".context/changes/<change-id>" ]`. If either check fails, print a diagnostic and STOP.

5. **Apply the manual-pass answer**, now that the folder has actually moved and `$DEST` is where the change lives:

   - **If the manual-pass question was answered "Manual pass done"**: flip that change's `#### Manual` rows in `$DEST/plan.md` from `- [ ]` to `- [x]`, and set `manual_tests_confirmed: <today as YYYY-MM-DD>` in `$DEST/change.md`. Never touch an `#### Automated` row, and never append a SHA to a manual row — no commit produced it, and a fabricated SHA is worse than none. Narrate `MANUAL: <Y> row(s) confirmed by the user and ticked.`
   - On any other answer, leave `manual_tests_confirmed` as `null` and leave every Manual row alone.

   **Why this waits until after the move.** Every step from here on either succeeds or leaves a partial close-out that the error handling already documents. Ticking before the move would put the same edits at risk from a failed `git mv`, and a re-run would then hard-refuse on dirt this run created — the exact outcome deferring the flip exists to prevent.

6. **Close the matching roadmap item.** Run this on **every** archive — the roadmap lookup is mandatory. "Best effort" scopes only the *edits*: a missing roadmap or an edit target that isn't found is skipped silently and never blocks, rolls back, or prompts the archive. It does NOT mean "assume there's no roadmap and skip the check." Not looking is a defect — the confirmation block (step 9) must report the outcome either way.

   1. `test -f .context/foundation/roadmap.md`. If absent, skip this step silently. Otherwise **capture its dirty state before touching it**: `ROADMAP_PREDIRTY=$(git status --porcelain .context/foundation/roadmap.md 2>/dev/null)`. Step 7 needs it, and once this step has edited the file the question can no longer be answered.
   2. Read `.context/foundation/roadmap.md`. Look for `<change-id>` used as a `Change ID`:
      - in the `## At a glance` table — the row whose **Change ID** column cell equals `<change-id>` exactly;
      - and in the `## Foundations` / `## Slices` bodies — the `### <ID>: …` block that contains a `- **Change ID:** <change-id>` line.

      `<ID>` is that item's roadmap-local id (`F-NN` or `S-NN`); `<Outcome>` is the text of its `- **Outcome:**` line (keep a leading `(foundation) ` if present).
   3. **No match** → print `ℹ .context/foundation/roadmap.md has no item with Change ID "<change-id>" — roadmap left untouched.` and skip the rest of this step. Match is exact-string only; a roadmap slice can spawn several changes, so a near-miss is intentionally *not* closed.
   4. **Match found** → apply the three edits below with the Edit tool. Each is independent and best effort: if a target isn't where the roadmap template puts it (hand-edited roadmap, older format), skip that sub-edit, keep going, and note what was skipped — never abort the archive over roadmap shape. Touch only the fields named here; leave `Outcome`, `Prerequisites`, `Parallel with`, `Risk`, etc. alone.
      1. **`## At a glance`** — in the matched table row, set the **Status** column cell to `done`.
      2. **Item body** — in the `### <ID>: …` block, rewrite the `- **Status:**` line to `- **Status:** done`.
      3. **`## Done` section** — append one bullet under the `## Done` heading, in that section's documented format:

         ```
         - **<ID>: <Outcome>** — Archived <today> → `.context/archive/<CREATED>-<change-id>/`. Lesson: —.
         ```

         `<today>` is `date -u +%F` (`YYYY-MM-DD`); `<CREATED>` is the value computed in step 1. If the roadmap has no `## Done` heading, append the heading and this bullet at the end of the file.
   5. Bump the roadmap frontmatter: set `updated: <today as YYYY-MM-DD>`. Leave every other key (`created`, `version`, `status`, `prd_version`, `main_goal`, `top_blocker`, …) untouched. If the file has no YAML frontmatter, skip this sub-step.
   6. The roadmap close goes into the archive commit together with the move and the stamp — one commit for the whole close-out, **unless `ROADMAP_PREDIRTY` was non-empty**. In that case the file already carried the user's own uncommitted edits; step 7 leaves it out of the commit and says so, rather than committing work nobody asked it to commit.
   7. Remember `<ID>` and `<Outcome>` for the confirmation output.

7. **Commit the close-out.** One commit covering the rename, the `change.md` stamp, the ticked Manual rows if there were any, and the roadmap close:

   ```bash
   git add "$DEST" ".context/changes/<change-id>"
   git add .context/foundation/roadmap.md     # only when step 6 edited it AND $ROADMAP_PREDIRTY was empty
   git commit -m "$(cat <<'EOF'
   chore(<change-id>): archive change
   EOF
   )"
   ```

   The scope is the change-id, the same as every other commit the loop makes on this branch — `/odp-plan`'s `docs(<change-id>)`, `/odp-implement`'s per-phase commits, `/odp-review`'s. A scope of `archive` would be the one commit in the whole loop that breaks the pattern, and the one a repository with a scope allow-list is most likely to reject.

   No body — the subject is mechanical and the diff (a rename, a frontmatter stamp, and the roadmap close when one matched) explains itself.

   **Stage by path, never by directory.** `$DEST` covers the renamed folder with its stamp and its ticked Manual rows; `.context/changes/<change-id>` covers the deleted side of the rename. Staging `.context/changes/` as a whole would sweep in **every other active change** in the repository — the pre-flight only checked this change's folder (`git status --porcelain ".context/changes/<change-id>/"`) and the index, so a dirty `plan.md` under a sibling change passes both checks and rides into a commit that claims to archive something else. Every other skill in the loop stages by explicit path; this one is no exception.

   **The roadmap is conditional on both halves**: step 6 must have edited it, **and** `ROADMAP_PREDIRTY` must have been empty. If it was non-empty, leave the file out and print `⚠ .context/foundation/roadmap.md already had uncommitted edits; the roadmap close was applied but NOT staged. Commit it yourself.`

   Never pass `--no-verify` or signing-bypass flags; if a pre-commit hook fails, fix the underlying issue and create a new commit.

   Skip this step entirely if `git` is unavailable or the repo is not a git repo; the pre-flight already said so. Capture the short SHA for the confirmation.

8. **Report where the branch stands.** The change record is closed; the branch it was built on is still there, unmerged. Read `branch` from the `change.md` you just stamped (it moved with the folder) and count what is ahead of the base:

   ```bash
   git rev-list --count <base_sha>..HEAD
   ```

   Report it as `<c>` commits on `<branch>`. Omit the line rather than guessing when `git` is unavailable, or when `base_sha` is missing, literally `null`, or does not resolve (`git cat-file -e <sha>^{commit}`) — `/odp-plan` writes `null` into these fields when it ran without git, so a present key is not the same as a usable value.

9. **Print confirmation**:

```
✓ Archived <change-id>
  .context/changes/<change-id>/  →  <DEST>/

change.md updated:
  status:       archived
  archived_at:  <ISO datetime>
  updated:      <today>

manual checks:  <Y> confirmed by you on <date>    ← or: left unchecked; omit the line when the plan had no Manual rows

roadmap.md:     closed <ID> "<Outcome>"  →  Status: done, entry added to ## Done    ← if matched; else print: no item with Change ID "<change-id>" — checked, left untouched. Always print one of the two; it proves the lookup ran.

Committed as: <short SHA> chore(<change-id>): archive change    ← omit the line when step 7 was skipped or its commit did not land

Branch <branch> now carries <c> commit(s) and is not merged anywhere.
Merging it — or not — is yours to decide.

The folder is now read-only by convention.
Next change: /odp-plan <describe the work>
```

The `Branch …` lines answer the question every user has at this exact moment: *the change is closed, so what happened to the code?* Archiving closes the **record** of a change, never the code. The commits are on the branch; merging, opening a pull request, or leaving it parked remains entirely the user's call, and this skill never does any of the three.

## Error handling

- Any unexpected filesystem error during the move leaves the source folder in place — the `change.md` stamp lands before the move, so on partial failure the user sees `status: archived` in `.context/changes/<change-id>/change.md` while the folder is still under `.context/changes/`. Re-running `/odp-archive` is safe: the Resolution check at the top detects `status: archived` on a folder that hasn't moved and asks the user to inspect manually rather than doing anything further.
- **A close-out that moved but did not commit** — the pre-commit hook rejected step 7, or the commit failed — leaves `<DEST>` in place with its stamp and, when the user confirmed the manual pass, its ticked `#### Manual` rows, all uncommitted. That is a complete archive missing only its commit. Say so plainly, name the paths, and tell the user that fixing the underlying issue and committing `<DEST>` plus the deleted `.context/changes/<change-id>` finishes the job. Do not move the folder back and do not un-tick anything.
- Do NOT attempt rollback — the `change.md` edits are intent-marking, and partial state is recoverable by hand.
- The roadmap-close step ("Move and stamp" step 6) is isolated: any failure there is caught, noted in the confirmation output, and skipped. It never aborts the archive and never triggers rollback. A half-applied roadmap edit is recoverable by hand.

## What this skill does NOT do

- **Does not push, merge, open a pull request, or delete the branch.** It makes exactly one commit — the close-out — on the branch that is already checked out. What happens to that branch afterwards is the user's decision, and this skill never makes it for them.
- **Does not write to `#### Automated` rows, and never appends a SHA to anything.** Its one write into `## Progress` is ticking `#### Manual` rows after the user has confirmed the manual pass in this session, in answer to a question it asked. Nothing else in the section is touched, ever.
- Does not run tests, builds, or formatters as a gate — the state-of-work gate is warn-only by design, and behavioral verification already happened in the human's manual pass.
- Does not rewrite the roadmap beyond closing the one matched item. When `.context/foundation/roadmap.md` has an item whose `Change ID` equals the archived `<change-id>`, this skill flips only that item's `Status` (table cell + `### <ID>:` body line), appends one `## Done` bullet, and bumps the `updated:` date. It never reorders slices, recomputes the dependency graph, edits other items, or creates a roadmap that doesn't exist. No match (or no roadmap file) → roadmap untouched.
- Does not write to `.context/archive/<...>/` after the move; archived folders are read-only by convention. The sibling skills enforce it on their own side: `/odp-plan` refuses an archived change-id, `/odp-implement` and `/odp-review` refuse any resolved path under `.context/archive/`.
- Does not unarchive. To revisit an archived change, open a new one with `/odp-plan` and reference the archived folder for context.
