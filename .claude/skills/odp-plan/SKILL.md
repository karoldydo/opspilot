---
name: odp-plan
description: >
  Open a change under .context/changes/<change-id>/ and plan it end to end,
  deriving the change-id from a plain description of the work when none is given.
  First step of the odp loop (/odp-plan → /odp-implement → /odp-review →
  manual tests → /odp-archive). Opens a <type>/<change-id> branch and creates the change
  folder and change.md itself — no separate "new change" skill is required — then dispatches two parallel sub-agents
  that write frame.md (what the problem actually is) and research.md (what the
  codebase actually does), runs one consolidated round of questions, and
  writes plan.md with a canonical ## Progress section carrying no commit-SHA
  suffix, because the loop makes no commits, plus a two-page plan-brief.md.
  Use when the user asks for /odp-plan, wants a new change opened and planned
  before implementation, or runs the odp plan/implement/review flow.
argument-hint: <what you want built> | <change-id> [freeform intent]
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

# Implementation Plan

You are tasked with creating detailed implementation plans through an interactive process. You should be skeptical, thorough, and work collaboratively with the user to produce high-quality technical specifications.

The plan you write is the input to an autonomous implementer (`/odp-implement`) and an automated reviewer (`/odp-review`), neither of which makes a commit. Two consequences shape everything below: the `## Progress` section is a mechanical contract with no commit references in it, and the plan's Success Criteria are the literal gates the implementer will run. Write them so they can be run.

## Portability

This skill is self-contained and language/stack agnostic. It depends on exactly three things:

- **`.context/`** — the toolkit's own state directory. This skill *creates* what it needs there (`changes/<change-id>/`), and reads `foundation/` (`lessons.md`, `roadmap.md`) if the project happens to keep one. Nothing outside `.context/` is required.
- **`git`** — to understand the repository, and for exactly one mutating command: opening the change's branch in Step 1 (see "Open the change's branch"). This skill commits nothing, stages nothing, and pushes nothing. Without git it degrades silently and the rest of the loop is unaffected.
- **Whatever the repository already declares as its checks** — used only to verify that a command you put in a Success Criterion actually exists. Nothing is assumed about the toolchain.

The three files under `references/` travel with the skill: `progress-format.md` (the `## Progress` contract, shared verbatim with `/odp-implement` and `/odp-review`), `frame-brief.md` and `research-doc.md` (the two dispatched agents' contracts). They are copies, not links — drop the `odp-plan/` folder into another project's skills directory and it works there unchanged.

## Language

**Every question put to the user is asked in Polish** — the `question` text, the `header`, and each option's `label` and `description`. This holds for every `AskUserQuestion` call in this skill, including the ones whose templates below are written in English; those templates fix the *shape* of a question, never the words. Everything else stays in English: narration lines, the files written under `.context/`, report bodies, and the commands printed for the user to copy.

## Positioning & invocation

This skill is the first step of the odp loop: **`/odp-plan` → `/odp-implement` → `/odp-review` → manual tests by a human → `/odp-archive`**. It runs standalone and needs no wrapper.

- **Standalone, from a description**: `/odp-plan add Google sign-in so users skip the email-password step` — the change-id is derived from what you wrote. This is the usual way in.
- **Standalone, with an explicit id**: `/odp-plan <change-id> [freeform intent]`.
- **On an existing change**: `/odp-plan <change-id>` where the folder already holds `frame.md`, `research.md`, or a plan draft.

It is also the toolkit's entry point: **the change's branch, the change folder and `change.md` are all created on entry**, before any research runs, so everything the run produces has somewhere to land and a branch of its own to sit on.

Unlike `/odp-implement`, this skill is **interactive by design** — a human is here and their decisions are the point. Two stops are unconditional: **one round of questions**, and **the phase-outline confirmation**. Three more are conditional, all of them in Step 1 — a change-id that collides with an open change, a change folder that already holds a `plan.md`, and a branch that has to be opened while you are standing somewhere other than the default branch. None of the three is optional: without commits an overwritten `plan.md` has no `HEAD` version to recover from, and a branch silently rooted on somebody else's work in progress is just as hard to untangle.

## Initial Response

When this command is invoked:

1. **Check if parameters were provided**:
   - If a change-id, file path, or ticket reference was provided as a parameter, skip the default message
   - Immediately read any provided files FULLY
   - Begin the research process

2. **If no parameters provided**, respond with:

```
I'll help you create a detailed implementation plan. Let me start by understanding what we're building.

Please provide:
1. The task/ticket description (or reference to a ticket file)
2. Any relevant context, constraints, or specific requirements
3. Links to related research or previous implementations

The more upstream context you pass in, the fewer questions I'll ask:
- Just a task description → the full round of questions
- Task + research doc (`.context/changes/<change-id>/research.md`) → fewer questions; I won't redo what research covered
- Task + frame brief (`.context/changes/<change-id>/frame.md`) → far fewer questions; the problem framing is already settled
- Task + frame + research → minimum questions; I focus only on solution-design decisions that need your input

Tip: just describe the work — `/odp-plan add Google sign-in so users skip the email-password step` — and I'll derive the change-id from it.
Or name the change yourself: `/odp-plan oauth-login`, `/odp-plan @.context/changes/oauth-login/frame.md`, or `/odp-plan oauth-login revisit the token-refresh edge case`
For deeper analysis, try: `/odp-plan think deeply about @.context/changes/oauth-login/research.md`
```

Then wait for the user's input.

## Process Steps

### Step 1: Open the change

Nothing else runs until the change exists on disk — the research agents in Step 2 write their artifacts into this folder. This skill owns the change's identity file; there is no separate bootstrap skill in this toolkit.

**Parse the argument.** The argument is either a change-id or a description of the work — usually the latter. Decide which by walking these rules in order; never guess.

1. **Path-style reference** — the first token contains `/` or starts with `@` (`@.context/changes/oauth-login/`). Strip the leading `@`, strip a trailing `/`, take the last non-empty path segment. That is the change-id; anything after the first token is intent.
2. **A single token, nothing after it** — `/odp-plan oauth-login`. That token is the change-id, and there is no intent.
3. **First token names an existing change folder** — `.context/changes/<first-token>/` exists. Then it is the change-id and the rest is added intent. This is how you re-enter a change that is already open: `/odp-plan oauth-login revisit the token-refresh edge case`.
4. **Everything else — the whole argument is the intent, and you derive the change-id from it.** This is the common case: `/odp-plan add Google sign-in so users skip the email-password step`. **Never take the first word as an id here** — "add", "implement", "fix" and their equivalents in any language are valid kebab-case, so a first-token rule would silently open a change called `add`.

The intent, whatever its source, is *guidance* for the title and the seed for `## Notes` — never inserted verbatim as the title.

**Deriving the change-id** (rule 4, or no argument at all):

- 2–4 words, kebab-case, matching `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`.
- Name the **outcome**, not the action: `google-sign-in`, not `add-google-sign-in`; `device-scan-retry`, not `fix-the-bug`. Drop filler verbs, politeness, articles, and anything about *how*.
- Copy the naming convention already visible in `.context/changes/` and `.context/archive/` — in the archive, ignore the leading `<created>-` date prefix and copy only the slug after it, or you will derive ids like `2026-04-29-oauth-login`. When there is none to copy, use English even if the request is in another language — the id becomes a directory name, appears in every narration line, and is typed back as `/odp-implement <change-id>`.
- **Collides with an existing change folder** → the two may or may not be the same work, and that is not yours to decide. Use AskUserQuestion: continue the existing change, or open a separate one under a more specific slug.
- **Collides with `.context/archive/`** → derive a more specific slug. Never reuse an archived id. Archive folders are named `<created>-<change-id>`, so the comparison is against the segment *after* the date prefix, not the whole directory name.
- Narrate it before creating anything: `CHANGE ID: <derived-id> (derived from your request)`. Nothing is committed at any point, so a slug you dislike costs one `rm -rf` and a re-run.

**Validate, in this order:**

1. **kebab-case** — applies to an id the user gave explicitly (rules 1–3); a derived one is valid by construction. On failure print `error: change-id "<id>" is not kebab-case. Use lowercase letters, digits, and single hyphens only (e.g., "oauth-login", not "OAuth Login").` and STOP.
2. **Archived** — for an explicit id, if any directory matches `.context/archive/*-<change-id>/` (archive folders carry a `<created>-` date prefix), print `This change is archived. Open a new change with a different change-id.` and STOP. (A derived id never reaches here; it was re-derived above.)
3. **Existing change folder**: if `.context/changes/<change-id>/` exists, it is **not** a collision — it is the normal continuation path. Use the folder as-is and inventory what it already holds; Step 2 reuses existing artifacts rather than regenerating them. Two sub-cases:
   - **It holds a `change.md`** → keep it and apply the "On an existing `change.md`" rule below. If it also holds a `plan.md`, ask whether to refine it or overwrite it before going further.
   - **It holds no `change.md`** (an interrupted earlier run, a hand-made directory) → write one now, exactly as for a new folder. Narrate `REPAIR: folder existed without change.md — created it.` Never leave this state alone: without `change.md` the change is invisible to `/odp-review`'s discovery, gets no status stamp from `/odp-implement`, and can never be archived — `/odp-archive` hard-stops on a missing `change.md` because it cannot derive the destination folder name.

**Open the change's branch.** Do this before anything is written, so the change folder and every artifact under it are born on their own branch. This is the only mutating `git` command in the skill, and it is not a commit.

1. **No git → skip silently.** If `git rev-parse --is-inside-work-tree` fails or `git` is unavailable, narrate `BRANCH: none — not a git repository.` and move on to "Create the folder". Everything below is optional infrastructure; the loop works without it.
2. **Derive the type** from the same intent the change-id came from, using Conventional Commit vocabulary: `feat` (a new capability), `fix` (behavior that is broken), `perf`, `refactor`, `docs`, `test`, `chore` (tooling, config, dependencies), `ci`, `build`. If the repository declares its own list — `.claude/rules/commit.md`, `commitlint.config.*`, `.commitlintrc*`, a `CONTRIBUTING.md` section — take the vocabulary from there instead. **Default to `feat` when the intent does not clearly say otherwise**: nothing is committed at this point, so a branch named wrongly costs one `git branch -m`.
3. The branch name is `<type>/<change-id>` — e.g. `feat/google-sign-in`, `fix/device-scan-retry`.
4. **Already on that branch** → narrate `BRANCH: <name> (already checked out)` and move on.
5. **The branch exists but you are somewhere else** → `git checkout "<name>"`, narrate `BRANCH: <name> (existing, checked out)`. This is the normal re-entry path for a change that is already open.
6. **The branch does not exist** → read where you are standing (`git rev-parse --abbrev-ref HEAD`) and what the default branch is (`git symbolic-ref --short refs/remotes/origin/HEAD`, stripped of its `origin/` prefix; fall back to `main`, then `master`, then whatever HEAD says).
   - **On the default branch** → `git checkout -b "<name>"` and narrate `BRANCH: <name> (from <default>)`.
   - **Anywhere else** → **ask once**, via AskUserQuestion: branching off somebody's work in progress is a decision, not a default. Offer exactly two options — take the current branch as the base (it keeps whatever that branch already carries), or switch to the default branch first (a clean base). On the second, run `git checkout <default>` before creating the branch; if that fails because the worktree is dirty, say so plainly and ask again. **Never stash, reset, or discard anything to make the switch possible.** Narrate the result as `BRANCH: <name> (from <base>)`.
7. **Never commit, never push, never stash, never `git checkout -- .`.** The branch is opened empty and everything the loop produces stays uncommitted on it until the human decides otherwise.

**Create the folder.** Run `mkdir -p .context/changes/<change-id>` unconditionally, before anything writes into it — Step 2.1 hands two parallel agents absolute paths inside this folder, so it has to exist before that fan-out, not as a side effect of the first `Write`. If `.context/` itself did not exist beforehand, also narrate `BOOTSTRAP: created .context/`. `.context/` is this toolkit's own directory — creating it is expected in a fresh repository, not a sign the repo is unprepared.

**Write `change.md`** (when the folder is new, and when an existing folder has none) with this exact shape:

```markdown
---
change_id: <change-id>
title: <title>
status: new
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
archived_at: null
---

## Notes

<notes-body>
```

- `<title>`: if the intent string is empty, humanize the change-id (`multi-course-access` → `Multi course access`). Otherwise write a concise human-readable title (≤ 80 chars, sentence case, no trailing period) capturing what the change is about.
- `<notes-body>`: the intent string verbatim when non-empty; otherwise the hint comment `<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->`.
- `<YYYY-MM-DD>` is today's date (`date +%Y-%m-%d`).
- **`status: new` here is deliberate.** No plan exists yet. Step 5 stamps `planned` when `plan.md` actually lands, so a run that stops after the research agents leaves an honest record instead of a change claiming a plan it never got.

**Statuses used by the odp loop**, in order: `new` (this skill, on entry) → `planned` (this skill, once `plan.md` is written) → `implementing` / `implemented` (`/odp-implement`) → `impl_reviewed` (`/odp-review`) → `archived` (`/odp-archive`). That is the complete set — six values, each written by exactly one skill. The file is record-only; nothing enforces transitions.

**On an existing `change.md`**: set `updated: <today>` and leave `status` alone unless it is `new` or absent. Never regress a status that is already `planned` or later — narrate `change.md: status <status> left untouched (forward-only).`

**Sync the roadmap** (best effort): if `.context/foundation/roadmap.md` carries an item whose `Change ID` equals `<change-id>`, flip that item to `Status: planning`. See "## Roadmap status sync" below. Never blocks; most changes won't trace to a roadmap.

Narrate one line before moving on: `CHANGE: .context/changes/<change-id>/ (status: <status>)`.

### Step 2: Context Gathering & Research

Everything in this step happens **before** the question round. There is exactly one round, so the research that would inform a second round has to happen up front.

#### Step 2.0: Identify upstream artifacts and scale questioning depth

Before any reading, identify what kinds of upstream artifacts the user passed in. Each one represents decisions already made — don't re-ask them.

- **Frame brief** — path matches `.context/changes/<change-id>/frame.md`, or content begins with `# Frame Brief:` / contains a `## Reframed` section.
- **Research doc** — path matches `.context/changes/<change-id>/research.md`, or YAML frontmatter contains `topic:` and `researcher:` fields.
- **Existing plan** — path matches `.context/changes/<change-id>/plan.md` (resume/refine mode — out of scope for this scaling logic).
- **Task description only** — none of the above.

**Only material the user brought in scales the round down.** The `frame.md` and `research.md` that Step 2.1's agents write are your own work, not the user's decisions — they never reduce the question count. The table below applies to artifacts that arrived with the request: a brief the user wrote, a research doc from another tool, notes they pasted in. On the normal path — a fresh change, both artifacts generated here — the round stays at its full size.

**Question count and focus scale with what's provided. The round holds at most 4 questions:**

| Upstream artifacts      | Questions | What changes vs. baseline                                                                                                   |
| ----------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------- |
| Task only (baseline)    | 4         | Full coverage across the relevant categories — pick the 4 decisions with the largest blast radius.                          |
| Task + research         | 3         | Skip questions whose answer is already in the research doc. Don't re-spawn sub-agents to find what research already mapped.  |
| Task + frame            | 2–3       | Skip [D]iagnostic categories — frame settled problem framing. Treat the Reframed (or Confirmed) Problem Statement as authoritative. |
| Task + frame + research | 1–2       | Skip both. Ask only [S]olution-design questions that genuinely need user input.                                             |

With a single round, selection matters more than count. A question earns its slot by being one where **a different answer produces a different plan** — different phases, different files, different success criteria. Anything that only produces a different sentence in the plan is not worth a slot; decide it yourself from the research.

**Principle**: every artifact passed in is a source of decisions already made. Reading them counts as listening to the user. Don't ask the user what they already wrote down.

**When a frame is present**, read it FULLY and treat as authoritative:
- Copy the **Reported Observation** + **Reframed (or Confirmed) Problem Statement** as the task definition. Do not re-question the framing.
- Lift the **Hypothesis Investigation** table and **Narrowing Signals** into your "Current State Analysis" — this work is already done.
- If the frame **Confidence: LOW** is flagged, surface that in the plan's `### Key Discoveries:` (and, in `plan-brief.md`, under `## Open Risks & Assumptions`) and spend one of the round's slots on how to proceed (verify first, or plan with risk acknowledged).
- Do NOT re-investigate the framing. Frame owns problem framing; you own solution design.

**When research is present**, read it FULLY and use as the codebase baseline:
- "Code References" section IS your codebase grounding — don't re-spawn Explore agents to find the same files.
- "Architecture Insights" feed directly into "Current State Analysis."
- Spawn sub-agents only to fill specific gaps research didn't cover (e.g., the exact files this plan will modify if research was broader).

#### Step 2.1: Read, then dispatch the two research agents

1. **Read all mentioned files immediately and FULLY**:
   - Reference files (e.g., `.context/changes/<change-id>/research.md`, `.context/changes/<change-id>/frame.md`)
   - Research documents
   - Frame briefs
   - Related implementation plans
   - Any JSON/data files mentioned
   - `.context/foundation/lessons.md` if present — treat its rules as priors when probing scope, edge cases, and architecture choices; rules already accepted by the team narrow which design pitfalls still need fresh questioning.
   - **IMPORTANT**: Use the Read tool WITHOUT limit/offset parameters to read entire files
   - **CRITICAL**: DO NOT spawn sub-tasks before reading these files yourself in the main context
   - **NEVER** read files partially - if a file is mentioned, read it completely

2. **Dispatch the two research agents — in parallel, in one message**:

   This is the **only** research moment in the skill. There is no second wave after the questions, so between them the two agents must cover everything the plan will need. Send both `Task` calls (`subagent_type: "general-purpose"`) in a single message. Each writes its own artifact into the change folder and returns a compact structured summary.

   The division of labour is the point: **FRAME owns the problem, RESEARCH owns the codebase.** Neither designs the solution — that is yours, after the question round.

   Both prompts must carry: the user's request verbatim, the intent recorded in `change.md`, the change-id, the **absolute path** of the artifact to write, and the **absolute path** of the reference the agent must Read before starting. Resolve both reference paths yourself — a spawned `Task` agent has no notion of this skill's directory, so a relative path or "read this skill's reference" will not resolve. Paste in every entry from `.context/foundation/lessons.md` if it exists; the agents cannot read what you do not carry.

   **Agent 1 — FRAME** — owns the problem. Establishes what is *actually* at issue, separated from what the request assumed: maps the dimensions the observation could originate at, investigates each for evidence, pressure-tests the leader, and lands on a **Reframed (or Confirmed)** problem statement. Confirming the original framing is a first-class outcome. Writes `.context/changes/<change-id>/frame.md`. Method, artifact template, and guardrails: **`references/frame-brief.md`** — instruct the agent to Read it fully before starting. Returns:

   ```
   FRAMING: reframed | confirmed
   PROBLEM: <one sentence>
   CONFIDENCE: HIGH | MEDIUM | LOW
   OPEN DIMENSIONS: <one line each, or none>
   FOR THE PLAN: <what the plan should now be about>
   ```

   **Agent 2 — RESEARCH** — owns the codebase. Finds the real files and call sites, traces data flow, and extracts the conventions a change here has to honour. Writes `.context/changes/<change-id>/research.md`. Method, artifact template, and discipline: **`references/research-doc.md`** — same instruction. Returns:

   ```
   SUMMARY: <2–4 sentences>
   KEY REFERENCES: <the file:line entries the plan will build on>
   CONVENTIONS: <one line each>
   OPEN QUESTIONS: <one line each, or none>
   ```

   **`OPEN DIMENSIONS` is what links the two halves of this skill.** An interactive framing pass would stop mid-investigation and put a narrowing question to the user; a dispatched agent has nobody to ask. It records the ambiguity instead — phrased as an observation, never as a cause or a fix — and those entries are the strongest candidates for the question round in Step 3. `OPEN QUESTIONS` from RESEARCH works the same way, one level lower.

   Neither agent spawns further sub-agents: they are sub-agents already, and nesting makes the run unbounded. When one reports that an area needs its own sweep, add an `Explore` agent to your own next batch rather than letting it fan out.

   **Hard boundaries for both agents** (the references state them too — repeat them in the prompt anyway): write only your own artifact; never touch `plan.md`, `change.md`, or any source file; never run a mutating `git` command, and never `git commit`; never invoke interactive question tools.

   **If an artifact already exists** — brought in with the request, or left by an earlier run — do not overwrite it. Skip that agent, read the file, and narrate `FRAME: reusing existing frame.md` / `RESEARCH: reusing existing research.md`. Forcing a refresh is the user's call: they delete the file first.

   **Add extra `Explore` agents to the same batch** when the task has a dimension neither agent covers — a second codebase sweep on an unrelated subsystem, or a dedicated pass over prior art in `.context/changes/**/` and `.context/archive/**/`. Keep the whole fan-out in one message.

   Track the dispatch with TaskCreate (these appear in the user's status bar) and close each entry with TaskUpdate as it returns. **Wait for ALL of them to complete** before proceeding.

   **Then read both artifacts FULLY from disk.** The returned summaries are for narration; the files are what you plan from. Reading them back guarantees you are working from what actually landed, not from a summary of it.

   Narrate: `FRAME: <reframed|confirmed|reused> — .context/changes/<change-id>/frame.md` and `RESEARCH: <written|reused> — .context/changes/<change-id>/research.md`.

   **What you answer yourself, from this research — never by asking the user:**
   - What patterns does the codebase use for similar features?
   - What's the established error handling / logging / testing approach?
   - Which existing components or utilities can be reused?
   - What constraints does the current architecture impose?

   For non-software tasks the same rule holds against context files and prior work: what formats or templates were used before, what constraints prior decisions impose, what already exists that this should align with, what worked or didn't last time. **This is NOT for users to decide.**

3. **Read all files identified by research tasks**:
   - After research tasks complete, read ALL files they identified as relevant
   - Read them FULLY into the main context
   - This ensures you have complete understanding before proceeding

4. **Analyze and verify understanding**:
   - Cross-reference the ticket requirements with actual code
   - Identify any discrepancies or misunderstandings
   - Note assumptions that need verification
   - Determine true scope based on codebase reality
   - **Run a smallest-counterexample pass before choosing interview questions, and keep the result as a working note.** It fires on the ranking, selection and state words the request uses without defining — "top N", "winner", "best", "latest", "first", "duplicate", "active", "until the end". For ordered selections, place equal comparison values across the cutoff; for counted sets, vary the identity/equivalence rule; for state thresholds, vary inclusivity and governing clock. For each case jot one line for yourself — the term, the counterexample, what the user would see differently — *before* looking up what the code does there; then read the implementation and add its answer as one more line. A tiebreak the code performs by id, insertion order or array position is not a decision anyone made, so it never closes the note. Every note whose outcomes differ on screen is a candidate for the round; existing behaviour supplies one option, not the answer. The note is scaffolding for the interview, not a plan section.
   - With only one round available, rank the surviving notes by blast radius and let the top ones compete for slots against the category list in Step 3.

5. **Present informed understanding**:

   Present a brief summary of what you found, then go straight to the question round — there is no complexity negotiation:

   ```
   Based on [the ticket and my research of the codebase / your description and my analysis], I understand we need to [accurate summary].

   I've found that:
   - [Key discovery — code reference, existing asset, prior work, or domain constraint]
   - [Relevant pattern, convention, or constraint discovered]
   - [Potential complexity or edge case identified]
   - [Optional: a word in the request I'm reading two ways — the counterexample and what the code does there today — that the round will settle]

   [N] questions, one round, then I'll propose the phase breakdown.
   ```

### Step 3: The Question Round

One `AskUserQuestion` call, at most 4 questions, asked together. This is the only round — everything the user needs to decide has to be in it.

**Rules for structuring questions:**
- Each question should have 2-4 concrete options
- Use `multiSelect: true` only when choices aren't mutually exclusive
- Keep `header` short (max 12 chars): "Scope", "Edge cases", "Priority"
- The user can always choose "Other" for free-form input

**Every option MUST include a recommendation signal and tradeoff analysis:**
- Mark exactly one option as `⭐ Recommended` in its label
- Each option's `description` must follow this format:
  `[1-sentence what this does] · Strength: [key advantage] · Tradeoff: [key cost or risk]`
- The recommendation should be grounded in research (codebase patterns for software, domain knowledge and context for non-software) — not guessing

**Example AskUserQuestion call with recommendations (software):** `Conflicts` is `[S]` — solution architecture; always asked even when a frame defined the problem.

AskUserQuestion with questions:
- question: "How should the system handle conflicts when two users edit simultaneously?"
  header: "Conflicts"
  options:
  - label: "Last write wins"
    description: "Later save silently overwrites earlier one. · Strength: Zero added complexity, no UI changes needed. · Tradeoff: Users can lose work without warning — acceptable only if edits are rare or low-stakes."
  - label: "⭐ Recommended: Notify and merge"
    description: "Show conflict to user, let them choose which version to keep. · Strength: Prevents data loss while keeping UX simple — matches the pattern in existing EditPanel component. · Tradeoff: Adds a conflict resolution modal and WebSocket subscription for real-time detection."
  - label: "Lock-based"
    description: "First editor locks the resource; others see read-only until released. · Strength: Prevents conflicts entirely — simplest mental model for users. · Tradeoff: Stale locks require TTL + cleanup logic; blocks legitimate concurrent work."
    multiSelect: false

**Example AskUserQuestion call with recommendations (non-software — content/strategy):** `Depth` is `[D]` — diagnostic about audience/scope; skip if a frame brief that arrived with the request already settled who this is for.

AskUserQuestion with questions:
- question: "What depth of technical detail should the course module target?"
  header: "Depth"
  options:
  - label: "Conceptual overview"
    description: "High-level principles, no code. · Strength: Accessible to all skill levels, faster to produce. · Tradeoff: Advanced learners may find it too shallow — risks losing engagement."
  - label: "⭐ Recommended: Hands-on with guided examples"
    description: "Concepts paired with step-by-step exercises. · Strength: Balances understanding and practice — matches the format that got highest completion rates in prior modules. · Tradeoff: 2-3x more prep time per lesson; requires working example repos."
  - label: "Deep dive with open challenges"
    description: "Minimal scaffolding, real-world problems. · Strength: Forces genuine problem-solving, highest learning retention. · Tradeoff: High dropout risk for less experienced learners; harder to support at scale."
    multiSelect: false

**What to ask about** — adapt categories to the domain of the task:

First, identify the task domain: **software**, **content/education**, **strategy/process**, or **hybrid**. Then pick question categories that fit. The categories below are organized by domain — select what's relevant, don't force software categories onto non-software tasks.

**Each category is tagged `[D]` (diagnostic — about the problem) or `[S]` (solution — about how to build it).** When a frame brief arrived with the request (Step 2.0), **skip all `[D]` categories** — frame settled them. Always ask `[S]` categories the user input still needs to drive.

The list below is a menu, not a checklist. Four slots means most categories go unasked; pick the ones where you genuinely cannot decide well alone.

**Universal categories (all domains):**
- **Scope boundaries** `[D]`: What's in vs out
- **Edge cases / failure modes** `[S]`: What happens when things go wrong or get weird (implementation handling, even if a frame named the observation class). Start from the counterexample notes of Step 2.1 item 4: put the concrete data in the question, and when the code already implements one reading, list it as an option labelled `(current behaviour)` — star it only if its outcome is one the user would defend without mentioning the implementation
- **Success criteria** `[D]`: How do we know this worked — from the end user's or stakeholder's perspective
- **Priority** `[D]`: Must-have vs nice-to-have — what gets cut if time is tight
- **Approach** `[S]`: When research surfaced two genuinely viable architectures and the codebase does not settle it, the choice belongs in the round. When one approach clearly wins on the evidence, take it and say why in the plan's "Implementation Approach" — don't burn a slot on a decision you already made

**Software-specific categories:**
- **Data model decisions** `[S]`: Schema, relationships, constraints, migrations
- **Error handling strategy** `[S]`: Failure modes, retry logic, user-facing messages
- **Performance boundaries** `[S]`: Expected load, acceptable latency, caching
- **State management** `[S]`: Where state lives, consistency guarantees, conflict resolution
- **Security model** `[S]`: Auth boundaries, data access, input validation
- **Migration & rollback** `[S]`: Incremental deployment, revert strategy
- **Observability** `[S]`: Key metrics, alerting, debugging surface
- **Manual verification** `[S]`: Which behaviors the human should check by hand after the run — this is what the `#### Manual` rows will say

**Content / education categories:**
- **Audience & prerequisites** `[D]`: Who is this for, what do they already know
- **Format & medium** `[S]`: Written, video, interactive, live — and why
- **Narrative arc** `[S]`: What journey does the reader/learner go on
- **Examples & exercises** `[S]`: What makes concepts stick
- **Curriculum dependencies** `[D]`: What must be learned before what
- **Assessment strategy** `[S]`: How to verify learning happened
- **Reuse & modularity** `[S]`: Can parts be used standalone or in other contexts
- **Distribution & access** `[D]`: Where does this live, how do people find it

**Strategy / process categories:**
- **Stakeholders & roles** `[D]`: Who's involved, who decides, who executes
- **Timeline & milestones** `[S]`: Key dates, dependencies, critical path
- **Risk identification** `[S]`: What could go wrong, what's the fallback
- **Resource constraints** `[D]`: Budget, time, people, tools
- **Change management** `[S]`: How do affected people learn about and adopt this
- **Dependencies & sequencing** `[S]`: What blocks what, what can run in parallel
- **Measurement framework** `[D]`: Leading vs lagging indicators, how to course-correct
- **Communication plan** `[S]`: Who needs to know what, when, through which channel

**What NOT to ask about:**
- Anything already settled in upstream artifacts (frame brief, research doc) — re-asking is the failure mode this scaling is designed to prevent
- Low-level implementation details you can determine yourself (from codebase research for software, from context files and prior work for non-software)
- Questions with obvious answers given the context already provided
- Preferences that don't affect the plan's structure or success

**CRITICAL**: The round is mandatory and it is the user's only structured input into the plan. Do not skip it, and do not shrink it to one courtesy question when four real decisions are open — a skipped decision becomes an assumption baked into the plan, and the cost lands in implementation. Equally, do not pad: when a frame and a research doc **arrived with the request** — written by the user or produced by another tool, not by Step 2.1's agents — one sharp question is the correct round.

**If the user's answers correct a misunderstanding**:
- DO NOT just accept the correction at face value
- Spawn a focused follow-up research task to verify the corrected information
- Read the specific files/directories they mention
- Only proceed once you've verified the facts yourself

### Step 4: Plan Structure Development

Once aligned on approach:

1. **Present plan outline and get structured feedback**:

   First, print the proposed phases as text (informational):

   ```
   Here's my proposed plan structure:

   ## Overview
   [1-2 sentence summary]

   ## Implementation Phases:
   1. [Phase name] - [what it accomplishes]
   2. [Phase name] - [what it accomplishes]
   3. [Phase name] - [what it accomplishes]
   ```

   Then use AskUserQuestion:
   - question: "Does this phase breakdown look right?"
     header: "Phases"
     options:
     - label: "Looks good, proceed"
       description: "Write the detailed plan with these phases."
     - label: "Needs adjustment"
       description: "I'll explain what to change before you write the detailed plan."
     - label: "Too granular"
       description: "Combine some phases — this is simpler than it looks."
     - label: "Too coarse"
       description: "Split some phases — there are hidden complexities."
       multiSelect: false

   This is the last stop before the plan is written.

### Step 5: Detailed Plan Writing

After structure approval:

1. **Write the plan** to `.context/changes/<change-id>/plan.md` using this template structure (Phase blocks contain plain bullets — `- ` not `- [ ]` — and a single canonical `## Progress` section at the bottom owns the checkbox state, see `references/progress-format.md` for the contract):

````markdown
# [Feature/Task Name] Implementation Plan

## Overview

[Brief description of what we're implementing and why]

## Current State Analysis

[What exists now, what's missing, key constraints discovered]

## Desired End State

[A Specification of the desired end state after this plan is complete, and how to verify it]

### Key Discoveries:

- [Important finding with file:line reference]
- [Pattern to follow]
- [Constraint to work within]

## What We're NOT Doing

[Explicitly list out-of-scope items to prevent scope creep]

## Implementation Approach

[High-level strategy and reasoning]

## Critical Implementation Details

This section captures **constraints, gotchas, and ordering requirements that the implementer needs to know before they touch the code** — facts the LLM determines during research (Step 2.1) that aren't visible from the file paths alone.

This is NOT a place to pre-decide implementation. Default: **omit** the entire section. Include a heading below ONLY when something genuinely surprising or load-bearing applies — and write 1-3 sentences, not bullet templates.

- **Timing & lifecycle** — include only if there's a non-obvious ordering, race, or lifecycle hook the implementer would otherwise miss.
- **User experience spec** — include only when user-visible behavior has constraints not derivable from the user requirements (e.g. specific focus management, scroll preservation).
- **Performance constraints** — include only when there's a real performance budget or known hotspot; skip generic "use memoization" advice.
- **State sequencing** — include only when the order of state changes matters and the obvious order is wrong.
- **Debug & observability** — include only when there's a specific verification method or instrumentation need beyond standard logging.

If none apply, omit the section entirely. A plan without it is not incomplete; a plan that fills it with templated bullets is bloated.

## Phase 1: [Descriptive Name]

### Overview

[What this phase accomplishes]

### Changes Required:

#### 1. [Component/File Group]

**File**: `path/to/file.ext`

**Intent**: [1-2 sentences naming what this change does and why. The implementer will write the actual code.]

**Contract**: [The interface, signature, schema field, route, file-structure delta, or invariant the change touches. For pure-prose edits, name the section or heading affected.

A code snippet appears here ONLY when the change is non-obvious — a tricky regex, an unusual API call, a counterintuitive ordering, a workaround for a known bug, or a signature contract that other parts of the plan depend on. For routine edits (add a field, wire a handler, follow an existing pattern), describe the contract and stop. Default: no snippet.]

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `make lint`
- Migration applies cleanly: `make migrate`
- Build succeeds: `npm run build`

#### Manual Verification:

- Feature works as expected when tested via UI
- Performance is acceptable under load
- Edge case handling verified manually
- No regressions in related features

**Implementation Note**: `/odp-implement` closes this phase as soon as its `#### Automated` gates are green — it does not pause for a human and is not blocked by the Manual rows, which stay pending as the post-run checklist. Phase blocks use plain bullets; the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: [Descriptive Name]

[Similar structure with both automated and manual success criteria...]

---

## Testing Strategy

[One paragraph: how this change gets verified overall, and why that is enough.
Do NOT list verification steps here. Every individual check — automated or
manual — belongs in a phase's `#### Automated Verification:` /
`#### Manual Verification:` bullets, because those are the only bullets that
become `## Progress` rows, and `## Progress` is the only place `/odp-review`
reads the human's closing checklist from. A step written here reaches nobody.]

## Performance Considerations

[Any performance implications or optimizations needed]

## Migration Notes

[If applicable, how to handle existing data/systems]

## References

- Frame brief: `.context/changes/<change-id>/frame.md`
- Related research: `.context/changes/<change-id>/research.md`
- Similar implementation: `[file:line]`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Do not rename step titles.

### Phase 1: <Phase 1 name>

#### Automated

- [ ] 1.1 <Automated Verification item 1 from Phase 1>
- [ ] 1.2 <Automated Verification item 2 from Phase 1>

#### Manual

- [ ] 1.3 <Manual Verification item 1 from Phase 1>

### Phase 2: <Phase 2 name>

#### Automated

- [ ] 2.1 <…>
````

The Progress section is mechanical — emit one `### Phase N: <name>` per phase, with `#### Automated` / `#### Manual` subsections enumerating every Success Criteria bullet from that phase as `- [ ] <phase>.<index> <title>`. Omit empty subsections. The Phase blocks themselves carry plain `- ` bullets (no checkboxes); the `## Progress` section is the only place `[ ]` / `[x]` appear. **No commit-SHA suffix ever goes on a row** — the odp loop makes no commits, and nothing goes in that position as a placeholder.

2. **Stamp the plan into `change.md`** — after `plan.md` is on disk, never before. Set `status: planned` (only if the current status is behind it — `new` or absent; never regress `implementing` or later) and `updated: <today>`. Narrate `change.md: status → planned.`

   The order is load-bearing. `status: planned` is a claim that a plan exists; stamping first means any failure between the two steps — context exhaustion, an interrupt, a long template write — leaves a change asserting a plan it never got, and `/odp-implement` then refuses to start on it. Writing first means the worst case is an honest `new` on a change that does have a plan, which the next run of this skill repairs.

### Step 5.5: Plan Brief (Two-Pager)

After writing the full plan, generate a concise brief that gives the reader the high-level picture before they dive into 500-1000 lines of detail. The brief is the first thing the user reads — it should take under 2 minutes and leave them with a clear mental model of what the plan does, why, and what the key decisions were.

1. **Write the brief** to `.context/changes/<change-id>/plan-brief.md` (sibling of `plan.md` in the same change folder).

2. **Use this template**:

```markdown
# [Feature/Task Name] — Plan Brief

> Full plan: `.context/changes/<change-id>/plan.md`
> Frame brief: `.context/changes/<change-id>/frame.md` (if present — omit line otherwise)
> Research: `.context/changes/<change-id>/research.md` (if present — omit line otherwise)

## What & Why

[2-3 sentences: what we're building/doing and the motivation behind it. If a frame brief was the input, lift the Reframed (or Confirmed) Problem Statement here verbatim — that is the "why" in its sharpest form.]

## Starting Point

[1-2 sentences: what exists today that this plan builds on or changes. Ground the reader in the current state so they understand the delta. If a frame investigated this, summarize from its Hypothesis Investigation rather than re-stating.]

## Desired End State

[2-3 sentences: what the world looks like when this plan is done. Describe the concrete, user-visible outcome — not metrics, but the experience or capability that now exists.]

## Key Decisions Made

When a frame brief or research doc was the input, mark the **Source** column to show where the decision came from. This lets readers see the lineage: what was settled upstream vs decided in this planning session.

| Decision                       | Choice            | Why (1 sentence)  | Source           |
| ------------------------------ | ----------------- | ----------------- | ---------------- |
| [Decision area]                | [What was chosen] | [Core rationale]  | Frame / Research / Plan |
| [Decision area]                | [Choice]          | [Rationale]       | Frame / Research / Plan |
| ...                            | ...               | ...               | ...              |

(Omit the `Source` column if no upstream artifacts were provided — every row would be `Plan`.)

## Scope

**In scope:** [Bullet list of what's included]

**Out of scope:** [Bullet list of what's explicitly excluded]

## Architecture / Approach

[1 short paragraph or a simple diagram describing the high-level approach.
For software: key components, data flow, integration points.
For non-software: structure, workflow, key dependencies.]

## Phases at a Glance

| Phase     | What it delivers       | Key risk                  |
| --------- | ---------------------- | ------------------------- |
| 1. [Name] | [One-line deliverable] | [Primary risk or concern] |
| 2. [Name] | [One-line deliverable] | [Primary risk]            |
| ...       | ...                    | ...                       |

**Prerequisites:** [What must be true before starting — dependencies, access, prior work]
**Estimated effort:** [Rough size: e.g., "~2-3 sessions across 3 phases" or "8 weeks, 2-person team"]

## Open Risks & Assumptions

- [Risk or assumption that could change the plan]
- [Another one]

## Success Criteria (Summary)

[2-3 bullet points: how we know the plan succeeded, from the user's perspective]
```

3. **Key principles for the brief**:
   - It must fit on roughly 2 printed pages (~60-80 lines of markdown). If you're going longer, cut.
   - The "Key Decisions" table is the heart — it surfaces what the question round settled so anyone reading the plan later understands the choices without re-reading the transcript.
   - "Starting Point" grounds the reader in what exists today — without it, someone unfamiliar with the project can't understand the delta.
   - "Prerequisites & Estimated effort" at the bottom of the Phases table gives the reader a quick feasibility check before committing to read the full plan.
   - Write for someone who wasn't part of the planning conversation — they should understand the plan's shape and rationale from the brief alone.
   - Link to the full plan at the top so the reader can dive deeper on any section.

### Step 6: Sync and Hand-off

1. **Confirm the artifacts landed in the change folder**:
   - `ls .context/changes/<change-id>/` should show `change.md`, `frame.md`, `research.md`, `plan.md`, and `plan-brief.md`.

2. **Copy the quick start command to clipboard**:

   ```bash
   echo -n "/odp-implement <change-id>" | pbcopy 2>/dev/null || echo -n "/odp-implement <change-id>" | clip.exe 2>/dev/null || echo -n "/odp-implement <change-id>" | xclip -selection clipboard 2>/dev/null || true
   ```

   ```powershell
   # PowerShell (Windows)
   Set-Clipboard "/odp-implement <change-id>"
   ```

   If no clipboard tool is available, drop the `(✓ copied)` annotation but still print the suggestion.

3. **Print the hand-off block** (see "## Hand-off to /odp-implement" below), then invite review:

   ```
   Review the brief first, then check the full plan for anything that needs adjustment:
   - Are the phases properly scoped?
   - Are the success criteria specific enough?
   - Any technical details that need adjustment?
   - Missing edge cases or considerations?
   ```

4. **Iterate based on feedback** - be ready to:
   - Add missing phases
   - Adjust technical approach
   - Clarify success criteria (both automated and manual)
   - Add/remove scope items

5. **Continue refining** until the user is satisfied. Every refinement that touches a Success Criterion must also touch the matching `## Progress` row — the two never drift apart.

## Hand-off to /odp-implement

Every successful run ends with this block:

```
PLAN READY — <change-id>

Branch:   <type>/<change-id>   (created from <base> — nothing committed to it)
Brief:    .context/changes/<change-id>/plan-brief.md   (start here)
Plan:     .context/changes/<change-id>/plan.md
Frame:    .context/changes/<change-id>/frame.md      (<reframed|confirmed|reused>)
Research: .context/changes/<change-id>/research.md
Phases: <n>   Automated rows: <a>   Manual rows: <m>

Nothing was committed — plan and change.md sit in the working tree.

Next: /odp-implement <change-id>        (✓ copied)
Then: /odp-review <change-id>, then work the Manual checklist.
```

The counts come from the `## Progress` section you just wrote. If they don't match the phases' Success Criteria, the Progress section is wrong — fix it before printing the block.

## Roadmap status sync

If the project keeps `.context/foundation/roadmap.md`, it indexes each work item by a stable **Change ID**. As planning turns a roadmap item into a concrete change folder + plan, mark that item **`planning`** so the roadmap reflects that the item has left the backlog and entered active work. `/odp-implement` later advances the same item to `in-progress`, and archiving closes it to `done`.

Do this in Step 1 (right after `change.md` is created, while the status is still `new`) — planning has started, which is exactly what `planning` records. The lookup is **mandatory**; "best effort" scopes only the *edits* — a missing roadmap or a not-found target is skipped silently and never blocks, prompts, or aborts the run. Do not skip the check on the assumption there's no roadmap.

1. `test -f .context/foundation/roadmap.md`. If absent, skip this step silently.
2. Read the file. Look for `<change-id>` used as a `Change ID`:
   - in the `## At a glance` table, if present — the row whose **Change ID** column cell equals `<change-id>` exactly;
   - and in the item bodies — the `### <ID>: …` block that contains a `- **Change ID:** <change-id>` line.

   Match is exact-string only. **No match** → print `ℹ .context/foundation/roadmap.md has no item with Change ID "<change-id>" — roadmap left untouched.` and stop here.
3. **Match found** → if the item's `- **Status:**` is already `planning`, `in-progress`, or `done`, leave it untouched (**forward-only**: never regress a more-advanced status) and stop. Otherwise apply both edits with the Edit tool — each independent and best effort; skip a sub-edit whose target isn't where the roadmap template puts it, and note the skip. Touch only the `Status` field:
   1. **`## At a glance`** — set the matched row's **Status** cell to `planning`.
   2. **Item body** — rewrite the item's `- **Status:**` line to `- **Status:** planning`.

   Then bump the roadmap frontmatter `updated:` to `<today>` (skip if there is no frontmatter).
4. This skill does not commit its own artifacts; leave the flip in the working tree alongside the plan.

## Important Guidelines

1. **Be Skeptical**:
   - Question vague requirements
   - A ranking or selection word the request uses without defining stays undecided until its counterexample has been put to the user (Step 2.1 item 4)
   - Identify potential issues early
   - Ask "why" and "what about"
   - Don't assume - verify with code, files, or context

2. **Be Interactive**:
   - Don't write the full plan in one shot
   - Get buy-in at the two unconditional stops: the question round (Step 3) and the phase outline (Step 4). The conditional stops in Step 1 (folder collision, `plan.md` overwrite, branch base) are on top of those, not instead of them
   - Allow course corrections
   - Work collaboratively

3. **Be Thorough**:
   - Read all context files COMPLETELY before planning
   - Research patterns using parallel sub-tasks (codebase for software, context files and prior work for non-software)
   - Include specific references (file:line for code, document paths for content)
   - Write measurable success criteria with clear automated vs manual distinction

4. **Be Practical**:
   - Focus on incremental, testable changes
   - Consider migration and rollback
   - Think about edge cases
   - Include "what we're NOT doing"

5. **Track Progress**:
   - Use TaskCreate to create planning tasks and TaskUpdate to mark them completed as you progress
   - Tasks appear in the user's status bar for visibility
   - Mark tasks completed as you finish research areas

6. **MANDATORY: One question round, and make it real**:
   - **BEFORE** writing any plan, you MUST run the question round via AskUserQuestion
   - One round, at most 4 questions, scaled down only by artifacts the user brought in (Step 2.0)
   - Every option must include a `⭐ Recommended` pick with strength/tradeoff analysis
   - Each question must force a real decision — one where a different answer changes the phases, the files, or the success criteria. Never a courtesy question, never a confirmation of something obvious
   - Wait for the user's answers before proposing the phase outline
   - Decisions that did not make the round are yours to make from research, and the reasoning belongs in "Implementation Approach" — not in an open question

7. **No Open Questions in Final Plan**:
   - If you encounter open questions while writing, STOP
   - Research or ask for clarification immediately
   - Do NOT write the plan with unresolved questions
   - The implementation plan must be complete and actionable
   - Every decision must be made before finalizing the plan
   - A counterexample the user decided lands in sections that already exist — a named success criterion when accepted, "What We're NOT Doing" when declined. No new section for it
   - "Critical Implementation Details" subsections are opt-in: include them only when a real constraint, gotcha, or ordering requirement applies. Default to omission. A plan without that section is not incomplete.

8. **Describe intent, not implementation**:
   - The plan tells the implementer **what to change and why**, not how to write the code
   - Each change entry under `### Changes Required:` separates `**Intent**` (what and why) from `**Contract**` (the interface, signature, schema field, route, structure, or invariant the change touches). Code snippets, when needed, live at the tail of `**Contract**`
   - Default to no code snippets. Include a snippet ONLY when the change is non-obvious (tricky regex, unusual API call, counterintuitive ordering, workaround, signature contract that other phases depend on)
   - For routine edits — adding a field, wiring a handler, following an existing pattern — describe the `**Intent**` in 1-2 sentences, name the `**Contract**` in one, and stop. The implementer (human or agent) figures out the code from the file path, the surrounding pattern, and the intent
   - File paths and short Intent/Contract descriptions are usually enough. Resist the urge to pre-write the code

## Success Criteria Guidelines

**Always separate success criteria into two categories:**

1. **Automated Verification** — commands agents can run: `make lint`, type checks, builds, specific file existence
2. **Manual Verification** — human testing: UI/UX, real-world performance, edge cases, user acceptance

Each phase's success criteria go under `#### Automated Verification:` and `#### Manual Verification:` headings as plain `- ` bullets — **never** `- [ ]`. Checkbox state lives in `## Progress` and nowhere else; a stray `[ ]` inside a phase block is a false pending row that `/odp-implement`'s "first pending Automated row" scan can latch onto.

### The contract with /odp-implement

These bullets are not documentation — they are the gates the implementer runs and the checklist the human works through. Four rules follow:

- **Every `#### Automated Verification` item must be a command that is actually runnable in this repository.** `/odp-implement` preflights all of them on entry and prints a STOP block for any phase whose command cannot run. Before writing a command, verify it exists — a script in `package.json`, a target in `Makefile`/`Justfile`/`Taskfile.yml`, `command -v <binary>`. Never write a command from memory of what projects usually have.
- **Behavioral verification defaults to `#### Manual`.** Under the odp loop a human exercises the behavior by hand, after `/odp-review`. A specific, scoped test command in `#### Automated` is allowed when the plan deliberately wants it — `/odp-implement` will run it as gate (a). What does **not** belong there is the repo-wide test suite: neither `/odp-implement` nor `/odp-review` runs it, and putting it in a phase gate makes that phase the one place where the entire suite blocks progress.
- **Write `#### Manual` rows as steps to perform, not as judgements.** "Open /devices, add a device with an empty host, confirm the inline error names the field" — not "error handling works correctly". This is verbatim the checklist `/odp-review` hands back to the human at the end of the loop, so it has to be executable by someone who wasn't here.
- **Every bullet from both sections gets exactly one row in `## Progress`**, under the matching `#### Automated` / `#### Manual` subsection. That split is the parsing contract: `/odp-implement` flips only Automated rows, and `/odp-review` derives its phase scope from them.
- **Verification steps have exactly one home: the phase blocks.** `## Testing Strategy` is a paragraph of reasoning, never a list of steps. Nothing in the odp loop parses it — `/odp-review` builds the human's closing checklist by copying Manual rows out of `## Progress`, and only bullets under a phase's `#### Automated Verification:` / `#### Manual Verification:` ever become Progress rows. A verification step written anywhere else silently reaches nobody, and under odp manual verification is the loop's only real gate.

## Common Patterns

- **Database changes**: schema/migration → store methods → business logic → API → clients
- **New features**: research patterns → data model → backend → API → UI
- **Refactoring**: document behavior → incremental changes → backwards compatibility → migration

## Sub-task Spawning Best Practices

- **Spawn multiple tasks in parallel** in a single message for concurrent execution
- **Each task should be focused** on a specific area with detailed instructions (directories, what to extract, expected format)
- **Request specific file:line references** in responses
- **Wait for all tasks to complete** before synthesizing findings
- **Verify sub-task results** — if unexpected, spawn follow-ups and cross-check against actual code

## Context Management

Planning can be context-heavy due to research + iteration. Keep context efficient:

- **Delegate research to sub-agents** — they return summaries, keeping the main context lean. Don't re-read files that sub-agents already analyzed unless you need to verify specific details.
- **Synthesize, don't accumulate** — after sub-agents return, synthesize findings into your understanding rather than quoting large blocks verbatim.
- **If context feels degraded during planning** — if responses become sluggish or repetitive, save the current plan draft to file and offer the user to continue in a fresh context:
  ```
  The plan draft is saved at: .context/changes/<change-id>/plan.md
  Would you like to continue refining in a fresh window?
  → /odp-plan <change-id> (✓ copied)
  ```
  This lets `/odp-plan` reload the draft and continue iterating with full context available.

## Notes

- **Never run `git commit`.** This skill writes files into the working tree and leaves them there; the whole odp loop stays uncommitted until the human has finished manual testing.
- **`git checkout -b` in Step 1 is the one exception to "read-only git"**, and it is deliberate: the branch is what keeps an uncommitted multi-phase run from mixing into whatever else the repository is doing. Nothing else in the loop pushes, stages beyond `/odp-implement`'s restore anchor, or rewrites history.
- **This skill runs no tests, no builds, and no formatters.** Its only contact with the repo's tooling is verifying that a command named in a Success Criterion exists.
- **Five artifacts land in the change folder**: `change.md` (Step 1), `frame.md` and `research.md` (Step 2.1's agents), `plan.md` (Step 5) and `plan-brief.md` (Step 5.5). Only `plan.md` is read back by the rest of the loop; the rest are the durable trace of how it was reached.
- **The agents' method lives in `references/`, not here.** `frame-brief.md` and `research-doc.md` are written for the sub-agent that reads them, so keep this file's agent briefs short and let the references carry the craft.
- The `plan.md` you write is read by two other skills. Treat `## Progress` and the Success Criteria as an interface, not as prose.

## Example AskUserQuestion Probing by Feature Type

### Example 1: Software / UI Feature (e.g., Pagination)

Mixed: `Loading UX` is `[S]` (UI behavior — solution detail); `Scale` is `[D]` (problem boundary — how big is the dataset). With a frame brief that arrived with the request, ask only `Loading UX`; the scale should already be in the Reframed (or Confirmed) Problem Statement.

AskUserQuestion with questions:

- question: "What should the user see while new items load?"
  header: "Loading UX"
  options:
  - label: "Inline spinner"
    description: "Small spinner below existing content. · Strength: User keeps seeing current items, minimal UI work. · Tradeoff: Feels slower than skeleton — users see a generic spinner instead of content shape."
  - label: "⭐ Recommended: Skeleton screens"
    description: "Placeholder shapes matching item layout. · Strength: Perceived performance is 30-40% better — matches existing LoadingSkeleton component pattern. · Tradeoff: Requires a skeleton variant per item type; breaks if layout changes."
  - label: "Full-page spinner"
    description: "Replace content with spinner. · Strength: Simplest to implement — one component, no layout concerns. · Tradeoff: Blocks all interaction; feels broken on slow connections."
    multiSelect: false
- question: "How many items should this handle gracefully?"
  header: "Scale"
  options:
  - label: "⭐ Recommended: Hundreds"
    description: "Standard offset pagination. · Strength: Simple, well-understood, works with existing SQL queries. · Tradeoff: Breaks down past ~5k items — acceptable given current data volumes."
  - label: "Thousands"
    description: "Cursor-based pagination + virtual scrolling. · Strength: Handles growth without performance cliff. · Tradeoff: 2-3x more implementation work; changes API contract."
  - label: "Tens of thousands"
    description: "Server-side filtering + virtual list + search. · Strength: Scales indefinitely. · Tradeoff: Significant complexity; requires search index and new API design."
    multiSelect: false

### Example 2: Content / Education (e.g., Course Module Design)

Mixed: `Outcome` is `[D]` (defines what success looks like — pure problem framing); `Levels` is `[S]` (audience-handling strategy — how to structure delivery). With a frame brief that arrived with the request, ask only `Levels`; the outcome should be settled.

AskUserQuestion with questions:

- question: "What should the learner be able to DO after this module — not just know?"
  header: "Outcome"
  options:
  - label: "⭐ Recommended: Build a working prototype"
    description: "Learner produces a functional artifact using the techniques taught. · Strength: Forces genuine skill transfer — the artifact proves competence. · Tradeoff: Requires well-designed starter templates and clear acceptance criteria; takes 2-3x longer to prep."
  - label: "Complete a guided exercise"
    description: "Step-by-step walkthrough with expected output. · Strength: Low barrier — everyone finishes, builds confidence. · Tradeoff: May produce 'tutorial zombies' who can follow but not apply independently."
  - label: "Pass a knowledge check"
    description: "Quiz or code review proving conceptual understanding. · Strength: Fast to create, easy to grade at scale. · Tradeoff: Tests recognition not production — learner may understand but not be able to execute."
    multiSelect: false
- question: "How should this module handle different skill levels in the audience?"
  header: "Levels"
  options:
  - label: "Single track, advanced"
    description: "One path targeting experienced devs. · Strength: Deep content, no hand-holding, respects expert time. · Tradeoff: Alienates beginners — they'll drop off or flood support channels."
  - label: "⭐ Recommended: Layered depth"
    description: "Core path everyone follows + optional deep-dive sections. · Strength: Everyone gets value; advanced learners self-select into harder material. · Tradeoff: More content to maintain; risk of 'optional' sections being ignored."
  - label: "Separate beginner/advanced tracks"
    description: "Two parallel paths diverging early. · Strength: Each audience gets perfectly targeted content. · Tradeoff: 2x production cost; splitting a small cohort may hurt community dynamics."
    multiSelect: false

### Example 3: Strategy / Process (e.g., Newsletter Workflow)

`Bottleneck` is `[D]` — pure problem framing (which problem to solve). This is exactly the kind of question a frame exists to settle. With a frame brief that arrived with the request, skip this entirely; the leading hypothesis is the bottleneck.

AskUserQuestion with questions:

- question: "What's the primary bottleneck in the current newsletter pipeline?"
  header: "Bottleneck"
  options:
  - label: "⭐ Recommended: Curation takes too long"
    description: "Finding and evaluating links is the slow step. · Strength: Directly targets time-to-publish — automating curation yields the biggest time savings based on current pipeline timings. · Tradeoff: Automated curation risks losing the personal editorial voice that subscribers value."
  - label: "Writing the commentary"
    description: "Links are ready but writing around them is slow. · Strength: AI-assisted drafting can cut this in half. · Tradeoff: Heavy AI drafting can make the newsletter feel generic — needs careful voice calibration."
  - label: "Distribution and scheduling"
    description: "Content is ready but publishing is manual. · Strength: Easiest to automate — clear inputs and outputs. · Tradeoff: Lowest impact if curation or writing is still the bottleneck."
    multiSelect: false

**Note**: Questions focus on **WHAT should happen** (requirements, behavior, outcomes) — NOT **HOW to implement it** (code patterns, specific tools). The `⭐ Recommended` pick is grounded in research and context — the user always has the final say.
