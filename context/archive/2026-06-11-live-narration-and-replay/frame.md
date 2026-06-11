# Frame Brief: Live narration and replay (S-05)

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

US-01 / FR-010: the user must (a) **see a run narrated live during execution**,
and (b) **replay the full saved transcript of an earlier run**. Today the
diagnose feature is fully batch and ephemeral — zero streaming (`@Sse`,
`streamText`, `EventSource` absent across `apps/`), zero persistence
(`diagnose.service.ts:28` comments "ephemeral — no run-record persistence").

## Initial Framing (preserved)

- **User's stated cause or approach**: build live narration (SSE) + replay
  (persistence) as one S-05 slice, potentially on a *generic* ops-event
  narration mechanism reusable across future agent skills.
- **User's proposed direction**: extend the existing diagnose vertical slice
  with a stream (streamObject/streamText + `@Sse`) and a run-record/transcript
  table fed by the same LLM pass — a table that does not exist (deferred from S-04).
- **Pre-dispatch narrowing**: leading concern = **"nierozdzielne — jeden
  przebieg"** (live and replay are two sides of one LLM pass); persistence =
  **"S-05 creates the minimal table"**; generality = **"generyczny mechanizm
  ops-narracji"** (generic from day 1).

## Dimension Map

1. **Coupling live↔replay** — is "one LLM pass feeds both stream and persist"
   an architectural fact or an assumption?  ← initial framing (inseparable)
2. **Persistence as prerequisite** — is the "minimal table" actually minimal,
   or does generality inflate it? collision risk with S-09?  ← initial framing
3. **Contract generality** — do repo evidence/conventions support a generic
   mechanism NOW, or is single-skill the rule?  ← initial framing — **HIGHEST RISK**
4. **Narration semantics** — for a fixed 4-field synthesis, is "live narration"
   meaningful as streamObject (progressive fill) or does it need streamText
   (free-text play-by-play) + final object?

(Dimension 5 — replay re-stream vs static render — research already settles to
static render with strong rationale; not investigated to avoid hypothesis padding.)

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| D1 — coupling is a real architectural fact | `streamObject().partialObjectStream` (`ai@^6`) emits deltas AND accumulates a transcript in ONE `for await` loop; clean seam at `diagnose.service.ts:90-114`; S-04 batch path can coexist, not forced | STRONG (confirms framing) |
| D2 — S-05 creates the run-record table | `roadmap.md:233` "Run records originate in S-04; S-09 adds the user-action side, the linkage, and the view"; table absent today; convention in `*.schema.ts` clear; add nullable `userId`+index now → S-09 migration trivial, no collision | STRONG (confirms framing) |
| D3 — generic mechanism is the right scope NOW | **Only 1 skill exists** (`apps/api/src/diagnose`); `vercel-ai-sdk.md:19` "do NOT add free-form chat … the agent runs only predefined skills"; roadmap S-06/07/08 distant + sequential, no skill-wave; `contracts.md` "do NOT invent per-run output schemas"; **zero generic-union precedent** in `libs/shared`; research OQ7 itself recommends against | NONE (refutes framing) |
| D4 — streamObject suffices as "narration" | Argument for free-text streamText leaned mainly on the generality premise (D3); with D3 refuted, that arm collapses. What "narrated live" perceptually promises (play-by-play vs fields snapping in) is a genuine design choice — belongs to /10x-plan, not frame | WEAK / DEFERRED |

## Narrowing Signals

- User confirmed live+replay are **one inseparable pass** — matches D1 evidence
  exactly; the coupling framing is sound and need not be re-litigated.
- User confirmed **S-05 owns the minimal table** — the load-bearing scope
  decision research flagged (OQ1) is now settled in S-05's favor.
- User picked **generic mechanism**, but every independent evidence angle
  (skill count, explicit rule, roadmap shape, contract convention, precedent)
  points the other way. This is the one place stated direction ⊥ repo reality.

## Cross-System Convention

This class of contract is handled **concretely, one schema per concrete shape**
(`contracts.md`; 20 schemas in `libs/shared`, all domain-specific, no event
unions). The repo deliberately keeps the diagnose synthesis ephemeral and
single-purpose; generality is introduced only when a second consumer is real —
not in anticipation. The leading hypothesis (drop generic-from-day-1) matches
the convention; the initial framing (generic now) violates it.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: add **diagnose-specific** live
> narration + replay on the existing vertical slice — a streamed synthesis over
> `@Sse`, persisted to a minimal `run_record` table — using a **neutrally-named
> but NOT abstracted** contract, with a nullable `userId` reserved for S-09.

Two of the three framing axes held up: coupling (one LLM pass → stream + persist)
and persistence ownership (S-05 creates the table) are both evidence-backed —
proceed as proposed. The third axis is reframed: **do not build a generic
ops-narration mechanism now.** Name the contract neutrally (`run` / `narration`,
not `diagnosis-stream`) so a future generalization is cheap, but do not author an
abstraction over a single skill that the repo's own rule (`vercel-ai-sdk.md:19`),
contract convention, and your own research (OQ7) all warn against. Generalize in
S-08/S-09 when a second skill makes the shared shape real.

## Confidence

- **HIGH** — D1 and D2 confirmed by strong, direct code/roadmap evidence; D3
  reframe is convergent across five independent angles (skill count, explicit
  rule, roadmap, contract convention, zero precedent) and matches the documented
  convention. The only deferred item (D4 streamObject vs streamText) is a design
  choice for /10x-plan, not a framing gap.

## What Changes for /10x-plan

Plan **diagnose-specific** streaming + a minimal `run_record` table (id, FK
service/device, 4 synthesis fields, ordered transcript, createdAt, indexes,
nullable+indexed `userId` for S-09), with a neutrally-named contract — not a
generic event abstraction. Carry forward two open design choices for the plan to
settle: (1) **streamObject vs streamText + final object** (D4 — the generality
argument for free-text is gone; decide on what US-01 "narrated live" promises and
on streaming-aware error mapping), and (2) **transcript storage** (raw ordered
deltas for re-stream vs final object only — static render is recommended).

## References

- Source files: `apps/api/src/diagnose/diagnose.service.ts:28,90-114`;
  `apps/api/src/diagnose/diagnose.controller.ts:9-16`;
  `apps/api/src/database/schema/index.ts:5-8`;
  `libs/shared/src/lib/schemas/diagnosis-synthesis.schema.ts:11-18`;
  `libs/shared/src/index.ts` (barrel, no event union)
- Rules: `.claude/rules/vercel-ai-sdk.md:19`; `.claude/rules/contracts.md:14-22`;
  `.claude/rules/sse.md`; `.claude/rules/drizzle.md`
- Roadmap: `context/foundation/roadmap.md:175-185,223-234`;
  `context/foundation/prd.md:53-57,94`
- Related research: `context/changes/live-narration-and-replay/research.md`
  (Open Questions 1, 2, 7 directly addressed)
- Investigation: 3 parallel Explore agents — generality, coupling+persistence,
  narration-semantics
