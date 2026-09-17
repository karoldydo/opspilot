---
name: odp-archive
description: >
  Close a completed change by moving its folder into .context/archive/, stamping
  change.md with archived status, and closing the matching roadmap item. Fourth
  and final step of the odp loop (/odp-plan -> /odp-implement -> /odp-review ->
  manual tests -> /odp-archive). Makes no commit and never blocks on an
  uncommitted working tree, because the odp loop leaves the whole change
  uncommitted by construction. Use when the user asks for /odp-archive, wants a
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

The gate is **entirely warn-only**. Nothing hard-blocks on the state of the work: incomplete Progress, missing impl-review, and a status outside `{implemented, impl_reviewed}` are surfaced as warnings followed by a single confirmation prompt, and the user can still archive. The only hard stops are structural — a change that isn't there, one already archived, or a `change.md` that can't name a destination folder.

After archiving, the other odp skills refuse to write inside `.context/archive/<...>/`: `/odp-plan` refuses to reopen an archived id, `/odp-implement` refuses to implement under it, `/odp-review` refuses to append a review to it. Archived folders are read-only by convention.

## Portability

This skill is self-contained and language/stack agnostic. It depends on exactly two things:

- **`.context/`** — the toolkit's own state directory, holding `changes/<change-id>/` (the change being closed), `archive/` (created on demand) and optionally `foundation/roadmap.md`. Nothing outside `.context/` is required.
- **`git`** — **optional**, and used for exactly one thing: preferring `git mv` over `mv` when the change folder happens to be known to git. Without git the skill works unchanged.

`references/progress-format.md` travels with the skill: it is the `## Progress` contract this skill parses to count pending rows, shared verbatim with `/odp-plan`, `/odp-implement` and `/odp-review`. It is a copy, not a link — drop the `odp-archive/` folder into another project's skills directory and it works there unchanged.

## Language

**Every question put to the user is asked in Polish** — the `question` text, the `header`, and each option's `label` and `description`. This holds for every `AskUserQuestion` call in this skill, including the ones whose templates below are written in English; those templates fix the *shape* of a question, never the words. Everything else stays in English: narration lines, the files written under `.context/`, report bodies, and the commands printed for the user to copy.

## Positioning & invocation

This skill closes the odp loop: **`/odp-plan` → `/odp-implement` → `/odp-review` → manual tests by a human → `/odp-archive`**.

Run it **after** working through the manual checklist `/odp-review` printed in its hand-off block. That checklist is the `#### Manual` rows of `## Progress`, and nothing in the loop flips them — so at archive time they are still `- [ ]` and this skill will name them back to you one last time. That prompt is the point: it is the loop's only confirmation that the manual pass actually happened.

## Working on an uncommitted tree

`/odp-plan`, `/odp-implement` and `/odp-review` make **no commits**: the plan, the implementation and any review fixes all sit in the working tree. Three consequences shape this skill:

- **There is no hard refusal on uncommitted changes.** A sibling skill in a commit-based toolkit blocks when the change folder is dirty, to keep an archive commit clean. Under odp that folder is dirty on every single run by construction, so the same gate would fire every time and the skill would never do anything. It is removed, not relaxed.
- **This skill commits nothing either.** The move, the `change.md` stamp and the roadmap close all land in the working tree. The user commits afterwards, if at all.
- **`git mv` is conditional, not the default.** A folder git has never seen cannot be `git mv`'d. See "Move the folder" below.

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

## Soft warnings (non-blocking)

Collect the following warnings, then present them all at once with a single confirmation prompt.

1. **Status check**: read `change.md.status`. If it is NOT in `{implemented, impl_reviewed}`, queue: `Status is "<status>"; expected "implemented" or "impl_reviewed".` Those are the two statuses the odp loop ends on — `/odp-implement` stamps `implemented` when the last phase lands, `/odp-review` stamps `impl_reviewed` when the report is written.
2. **Pending Progress check**: parse the `## Progress` section of `.context/changes/<change-id>/plan.md` (if `plan.md` exists; see `references/progress-format.md` for the contract). For each `### Phase N:` block, identify its `#### Automated` and `#### Manual` subsections and count `- [ ]` rows under each separately. Let `<X>` = total automated pending across all phases, `<Y>` = total manual pending across all phases, `<N>` = `<X> + <Y>`.

   If `<N> > 0`, queue: `<N> Progress items still pending (<X> automated, <Y> manual): <comma-separated list of "N.M <title>" tokens, truncated to 5 with "…" if longer>.` Order the combined token list by automated items first (in document order), then manual items (in document order); the truncation cap of 5 applies to the combined list.

   If `plan.md` is missing, queue: `No plan.md found in change folder.` and skip the Progress count.

   **Read the two counts differently.** A pending **automated** row means implementation work the plan asked for and `/odp-implement` never marked done — a real gap. A pending **manual** row is the **expected** state: nothing in the odp loop ever flips those, and they are precisely the checklist `/odp-review` handed back to the human. Word the warning as a reminder of what you were asked to verify, not as an accusation that something is broken.
3. **Missing impl-review check**: glob `.context/changes/<change-id>/reviews/impl-review*.md`. If none match, queue: `No impl-review found at reviews/impl-review*.md.`

If at least one warning was queued, print:

```
⚠ /odp-archive warnings for <change-id>:

  - <warning 1>
  - <warning 2>
```

Then use `AskUserQuestion`. **Manual-only nudge**: if the Pending Progress check above queued a warning whose breakdown was exactly `0 automated, <Y> manual` with `<Y> ≥ 1`, append ` (Recommended)` to the `Continue archiving` label so the prompt visibly nudges toward archive. Under odp this is not the exception — it is how a clean run ends, every time: all automated work done, the manual checklist outstanding by design. In the remaining cases (any automated row pending, or no Progress warning at all), present the labels verbatim.

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

If no warnings were queued, skip the prompt and proceed directly.

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
   - Use the Edit tool to update each of the three frontmatter lines. Do NOT touch any other field; in particular, leave `created` and `change_id` alone.

4. **Move the folder.** Which command is correct depends on whether git knows the folder at all, and under odp it often does not:

   1. Run `git ls-files -- ".context/changes/<change-id>/"`. **Non-empty output** → the folder has tracked or index-staged content → `git mv ".context/changes/<change-id>" "$DEST"`, so history and the index follow.
   2. **Empty output**, or `git` unavailable, or not a git repository → `mv ".context/changes/<change-id>" "$DEST"`. Do **not** warn: under odp a never-committed change folder is the normal case, not a degradation. There is no history to preserve because nothing ever created any.
   3. If `git mv` fails anyway, fall back to `mv` and narrate one line saying so.
   4. Confirm post-move: `[ -d "$DEST" ] && [ ! -d ".context/changes/<change-id>" ]`. If either check fails, print a diagnostic and STOP.

5. **Close the matching roadmap item.** Run this on **every** archive — the roadmap lookup is mandatory. "Best effort" scopes only the *edits*: a missing roadmap or an edit target that isn't found is skipped silently and never blocks, rolls back, or prompts the archive. It does NOT mean "assume there's no roadmap and skip the check." Not looking is a defect — the confirmation (step 7) must report the outcome either way.

   1. `test -f .context/foundation/roadmap.md`. If absent, skip this step silently.
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
   6. The roadmap close stays in the working tree, like everything else this skill touches. Nothing is staged and nothing is committed.
   7. Remember `<ID>` and `<Outcome>` for the confirmation output.

6. **Count what is still loose.** The change record is now closed, but the code it describes is not. Derive the count exactly the way `/odp-review` derives its change set:

   ```bash
   git diff HEAD --name-only                 # tracked: staged + unstaged
   git ls-files --others --exclude-standard  # untracked files
   ```

   Take the union, drop anything under `.context/` (the change folder just moved, and its bookkeeping is not implementation), and report the remaining count as `<n>`. If `git` is unavailable, omit the line from the confirmation rather than guessing.

7. **Print confirmation**:

```
✓ Archived <change-id>
  .context/changes/<change-id>/  →  <DEST>/

change.md updated:
  status:       archived
  archived_at:  <ISO datetime>
  updated:      <today>

roadmap.md:     closed <ID> "<Outcome>"  →  Status: done, entry added to ## Done    ← if matched; else print: no item with Change ID "<change-id>" — checked, left untouched. Always print one of the two; it proves the lookup ran.

Nothing was committed — the move, the stamp and the roadmap close all sit in the working tree.
Implementation code: <n> file(s) still uncommitted.

The folder is now read-only by convention.
Next change: /odp-plan <describe the work>
```

The `Implementation code:` line answers the question every user has at this exact moment: *the change is closed, so what happened to the code?* Archiving closes the **record** of a change, never the code. Committing the work — or not — remains entirely the user's call.

## Error handling

- Any unexpected filesystem error during the move leaves the source folder in place — the `change.md` stamp lands before the move, so on partial failure the user sees `status: archived` in `.context/changes/<change-id>/change.md` while the folder is still under `.context/changes/`. Re-running `/odp-archive` is safe: the Resolution check at the top detects `status: archived` on a folder that hasn't moved and asks the user to inspect manually rather than doing anything further.
- Do NOT attempt rollback — the `change.md` edits are intent-marking, and partial state is recoverable by hand.
- The roadmap-close step ("Move and stamp" step 5) is isolated: any failure there is caught, noted in the confirmation output, and skipped. It never aborts the archive and never triggers rollback. A half-applied roadmap edit is recoverable by hand.

## What this skill does NOT do

- **Does not commit, stage, or push.** The move, the stamp and the roadmap close all land in the working tree, consistent with every other skill in the odp loop. There is no override and no "small exception".
- Does not write to `#### Manual` rows. `/odp-implement` is the sole writer of `## Progress`; this skill only counts pending rows for its warn gate. An archived plan keeps its final Progress state as a historical record, pending manual rows included.
- Does not delete the `phases/*.diff` snapshots. Without commits those cumulative dumps are the only surviving trace of what each phase produced, so they travel into the archive with everything else.
- Does not run tests, builds, or formatters as a gate — the gate is warn-only by design, and behavioral verification already happened in the human's manual pass.
- Does not rewrite the roadmap beyond closing the one matched item. When `.context/foundation/roadmap.md` has an item whose `Change ID` equals the archived `<change-id>`, this skill flips only that item's `Status` (table cell + `### <ID>:` body line), appends one `## Done` bullet, and bumps the `updated:` date. It never reorders slices, recomputes the dependency graph, edits other items, or creates a roadmap that doesn't exist. No match (or no roadmap file) → roadmap untouched.
- Does not write to `.context/archive/<...>/` after the move; archived folders are read-only by convention. The sibling skills enforce it on their own side: `/odp-plan` refuses an archived change-id, `/odp-implement` and `/odp-review` refuse any resolved path under `.context/archive/`.
- Does not unarchive. To revisit an archived change, open a new one with `/odp-plan` and reference the archived folder for context.
