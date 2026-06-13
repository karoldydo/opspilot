# Frame Brief: Audit log + linked history (S-09 / FR-011)

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

Implement roadmap slice S-09 / PRD FR-011: a reliable record of "who did what" —
user actions and agent runs (with the run transcript), linked to each other,
keyed off the in-app Better Auth session as the audit identity.

## Initial Framing (preserved)

- **User's stated cause or approach**: two linked tables — a new `audit_log` for
  user actions plus activating the pre-reserved `run_record.userId` for agent
  runs; "transcript" satisfied by the stored synthesis; emphasis on reliable
  linkage.
- **User's proposed direction**: take research.md's recommendation as-is and hand
  it to /10x-plan as one coherent feature.
- **Pre-dispatch narrowing**: leading concern = "both equally, as one feature"
  (accountability record + history/replay UI bundled); transcript = "final
  synthesis"; reliability posture = "guaranteed in transaction".

## Dimension Map

The observation could originate at any of these dimensions:

1. **"Transcript" semantics** — FR-011 says "transcript"; product persists final
   synthesis only, narration is ephemeral. Assumes synthesis is enough.
2. **Audit-record vs. history-UI** — slice bundles an accountability record
   (PRD: accountability is *solely* the audit log) with a user-facing replay UI.
   ← initial framing: one feature
3. **Reliability posture** — best-effort logging vs. write guaranteed in the
   action's transaction. Drives interceptor-vs-inline (Open Q4).
4. **Coverage breadth** — all ~18 mutating endpoints (+ auth flows) vs. a curated
   subset.
5. **Linkage model** — two linked tables vs. one polymorphic table.
6. **Retention** — prune (like `run_record`) vs. retain indefinitely.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| Dim 1: "transcript" requires narration capture (SSE hot-path expansion) | `run_record.synthesis` is the only persisted artifact; narration partials stream over SSE and are never persisted (research §Area 1, `diagnose.service.ts:117-129`). User confirmed synthesis suffices. | NONE — ruled out; slice stays narrow |
| Dim 2: audit-record and history-UI are separable concerns at different stakes | PRD: accountability is solely the audit log (`prd.md:121,130`). User chose "both, one feature". Write path carries the reliability bar; UI is a read-only consumer. | WEAK as a split driver — keep bundled |
| Dim 3: "guaranteed in transaction" posture is universally feasible | DB-CRUD methods are single statements or already in `db.transaction()` — audit insert joins cleanly (`skill.service.ts:18,65`, `llm-provider.service.ts:24,87`; device/service/credential need a wrapping txn). **`skill-run.service.ts:44-77` persists nothing (pure SSH); `diagnose.run` writes `run_record` inside the SSE stream, not the request; LLM probe / `crypto.encrypt` run *before* the DB write.** | STRONG for CRUD / PARTIAL for side-effect ops → **two-tier** |
| Dim 4: coverage breadth | Open — 18 endpoints inventoried (research §Area 3); curation + auth-flow capture undecided. | DEFER to /10x-plan |
| Dim 5: two linked tables vs. polymorphic | Runs already have a rich typed `synthesis` model, retention pruning, and shipped replay UI; folding them into a generic payload regresses S-04/S-05 (research §"One-vs-two"). | STRONG — Option B settled |
| Dim 6: retention | Open — prune vs. indefinite undecided; accountability records typically retained. | DEFER to /10x-plan |

## Narrowing Signals

- User: transcript = **final synthesis** → Dim 1 is *not* a scope expansion; the
  SSE hot path is untouched. (Resolves research Open Q1.)
- User: posture = **guaranteed in transaction** → rules out the interceptor
  (it runs outside the service transaction); audit writes go **inline**. (Resolves
  research Open Q4 — with the two-tier caveat below.)
- User: **one feature** → audit-write and history-read ship together; the
  reliability bar lands on the write path only.
- Cross-check: `skill.run` has zero DB footprint and `diagnose.run` writes its
  record inside the SSE stream → "atomic with the effect" is literally impossible
  for agent/SSH ops; they can only be recorded **on invocation**.

## Cross-System Convention

The codebase already separates a rich, typed agent-run record (`run_record` +
`synthesis`, with its own transaction and retention) from generic CRUD. The
leading hypothesis (two tables + inline-in-transaction audit) matches that grain.
Compute-then-write invariants already live in single `db.transaction()` blocks
(lessons: "Compute-then-write invariants belong in one transaction") — the audit
insert is the same pattern, so the convention directly supports it.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: activate the pre-positioned audit
> seam — add a new `audit_log` table for user actions (two-tables-linked,
> wiring `run_record.userId` + FK), write rows **inline in the action's
> transaction** where one exists, render a bundled history/replay view — with
> the audit guarantee modelled as **two tiers**, not one.

**The initial framing was correct — proceed with the originally proposed
direction.** Transcript = synthesis (Dim 1 ruled out), two linked tables (Dim 5
settled), one bundled feature (Dim 2). The single non-obvious refinement the
plan must encode: the "guaranteed in transaction" posture is **not universal**.
- **Tier 1 — DB-CRUD actions** (device/service/skill/llm-provider/credential):
  audit insert joins (or creates) the action's `db.transaction()` → atomic; a
  failed audit write rolls the action back. External calls (LLM probe,
  encryption) stay *outside* the transaction — they already run before the DB
  write and reject early, so only the DB write + audit insert are atomic.
- **Tier 2 — side-effect / agent ops** (`skill.run` SSH, `diagnose.run` SSE):
  no DB transaction wraps the effect, so audit is **record-on-invocation** with
  outcome, never atomic-with-effect. `diagnose.run`'s existing `run_record`
  already *is* that record; `skill.run` currently persists nothing and would
  need a record added if it's in scope.

## Confidence

- **HIGH** — strong evidence + matches convention + decisive narrowing signals.
  The framing held; the two-tier transaction model is the one essential nuance,
  and it is grounded in file:line evidence, not a hunch.

## What Changes for /10x-plan

The plan is *not* about choosing a table shape or transcript meaning — both are
settled. It is about: (a) the `audit_log` schema + `run_record.userId`/FK
activation, (b) a `@CurrentUser()`/`@CurrentUserId()` param decorator in
`common/`, (c) inline-in-transaction audit writes for Tier-1 CRUD, (d) an
explicit Tier-2 record-on-invocation decision for `skill.run`/`diagnose.run`,
and (e) the bundled history/replay UI. Still genuinely open for the plan to
decide: **Dim 4 coverage breadth** (which endpoints + whether to audit auth
flows) and **Dim 6 retention** (prune-with-`AUDIT_LOG_RETENTION`-tunable vs.
indefinite).

## References

- Source research: `context/changes/audit-log-and-history/research.md` (Areas 1–5,
  one-vs-two evaluation, Open Questions 1–6)
- `apps/api/src/diagnose/run-record.service.ts:35-62` — run_record write inside its own txn
- `apps/api/src/diagnose/diagnose.service.ts:117-129` — run persisted inside SSE stream
- `apps/api/src/skill/skill-run.service.ts:44-77` — SSH op, persists nothing ("nothing is persisted (s-09)")
- `apps/api/src/skill/skill.service.ts:18,65` / `llm-provider.service.ts:24,87` — existing `db.transaction()` blocks audit can join
- `apps/api/src/{device,service}/...service.ts`, `*credential*.service.ts` — single-statement writes needing a wrapping txn
- `apps/api/src/auth/auth.guard.ts:38-39` — guard attaches `request.session` (identity source)
- `context/foundation/prd.md:121,130` — accountability is solely the audit log
- Investigation task: TaskCreate #1 (in-transaction feasibility pressure-test)
