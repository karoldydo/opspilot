# Frame Brief: Deterministic service operations (S-06)

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

Roadmap slice **S-06**: a user runs one of 5 fixed, non-LLM operations
(`start`, `stop`, `restart`, `up`, `down`) on a managed service over SSH and
sees confirmation in the UI in < 10 s (FR-007/FR-008; success criterion
`prd.md:34`; NFR `prd.md:108-110`).

## Initial Framing (preserved)

- **User's stated cause or approach** (from research.md): "S-06 is lighter than
  it looks" — mostly reuse of the S-04/S-05 engine. The *single load-bearing
  architectural decision* is how the operation run relates to the diagnose-locked
  `run_record` table — **"the pivot of this slice"** (`research.md:37,150`).
- **User's proposed direction**: build the slice now (3 Zod contracts, 5 command
  templates, op method+endpoint, docker error mapper, web client/store/buttons)
  **and** generalize `run_record` into a discriminated union now (Open Question 1,
  recommended Option A — `research.md:154-157`), anticipating S-09 audit.
- **Pre-dispatch narrowing** (Step 1.5): leading concern = *"haven't separated
  them yet"* (framing was fused); persistence = **"confirmation is enough"**
  (audit is S-09, not this slice); compose/standalone split = **"yes, a visible
  axis"**.

## Dimension Map

Where could the *real* load-bearing concern of S-06 live?

1. **Persistence / run_record generalization** — research's claimed pivot.
2. **Confirmation semantics across a wide op-duration range** — fast ops vs slow
   `up -d` pulling images.  ← surfaced independently, not in initial framing
3. **Compose vs standalone command-form branch + injection-guarded interpolation**
   of compose fields.  ← user confirmed this is a visible axis
4. **Destructive `down` UX + web component-size budget.**
5. **Per-device mutex head-of-line blocking** (concurrency).  ← ruled out

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| **(1) run_record generalization is the load-bearing decision** | No S-06 requirement mentions persistence/history/audit (`prd.md:34,108-110`; `roadmap.md:187-197`); audit is FR-011 → S-09 (`roadmap.md:224-234`). Ephemeral `@Post` confirmation (the pre-S-05 shape, `diagnose.controller.ts:13-14`) satisfies the criterion with **zero** changes to `run_record`. Research itself files it as an Open Question with 3 options, not a requirement. User: "confirmation is enough." | **NONE** (for this slice) — it is an optional S-09 pull-forward |
| **(2) Confirmation semantics span sub-second → minutes** | `start/stop/restart` finish in ~1s; `up -d` pulling an image "can exceed 30s" (`research.md:78`), command timeout default 30000ms → 504 (`env.schema.ts:52`, `executor.errors.ts:30-35`). User wants *continuous* "still running / succeeded / failed" feedback for the 40s case, not one blocking wait. Research's "no progressive output → request/response" (`research.md:39,61`) holds for fast ops, breaks for slow ones. | **STRONG** — the single-shape confirmation assumption is the framing that breaks |
| **(3) Compose/standalone branch + injection** | `composePath`/`composeProject` = `z.string().nullable()`, **no charset constraint** (`service.schema.ts:15-16`), populated raw from docker labels (`service.service.ts:128-134`), unvalidated anywhere. Interpolating into `docker compose -f <path>` is a **new unguarded injection surface** — vs `containerNameSchema` which exists precisely to close this class (`container-name.schema.ts:9-12`, re-parsed at boundary `diagnose.service.ts:157`). up/down availability gate + command branch = new logic (zero matches today). | **STRONG** — genuinely new work with real security risk |
| **(4) Destructive `down` UX + component budget** | Confirm dialog is a single hardcoded `#deleteDialog` bound to a delete-specific signal (`device-services.component.{html:122-136,ts:53,82-88}`) — not a reusable primitive. Hosting `down` confirm + 5 op buttons in an actions cell already holding 3 (`html:30-51`) pushes the 119-line component past the ~150-line angular.md budget → extract a sub-component/store. | **WEAK-MEDIUM** — real refactor, but mechanical |
| **(5) Per-device mutex head-of-line blocking** | `execute()` holds the device mutex for the full command (`ssh.executor.ts:30-32`); a slow `up -d` would block other ops on that device. **But** user: "one action at a time" — single operator, sequential. | **NONE** — ruled out by single-user usage |

## Narrowing Signals

- **Decisive:** "confirmation is enough; audit is S-09" → kills hypothesis (1) as
  this slice's pivot. The user does not want persistence here.
- **Decisive:** "one action at a time" → kills hypothesis (5); the mutex blocking
  is theoretical at single-operator homelab scale.
- **Reframing:** "give a bigger timeout (2-5 min) but poll every 5-10s whether it
  succeeded… I didn't anticipate this" → elevates hypothesis (2): the user wants
  *finite, continuously-reported* execution for slow ops, distinct from the
  instant blocking confirmation that fits fast ops.
- "compose/standalone split is a visible axis" → confirms hypothesis (3) belongs
  in the contract/UI surface, not buried as an implementation detail.

## Cross-System Convention

The codebase already funnels every remote op through one seam
(`IExecutor.execute(deviceId, command)`) with per-device serialization, timeouts,
and a no-hang `finally`. New ops add *commands*, not infrastructure — the research
is correct there. The established injection mitigation (a charset schema +
parse-at-command-boundary) already exists for `containerName` and simply has not
been applied to the compose fields. The independent no-preconception sweep landed
on (2) and (3) and down-ranked (1) — agreeing with the reframe rather than the
initial framing.

## Reframed Problem Statement

> **The actual problem to plan around is**: safely execute 5 fixed lifecycle ops
> with the correct compose-vs-standalone command form and injection-guarded
> interpolation, giving the user *finite, continuously-reported* feedback across
> ops whose duration ranges from sub-second (`start/stop/restart`) to minutes
> (`up -d` pulling images) — **not** "generalize `run_record`."

The initial framing mis-ranked difficulty: it elevated the most *consequential-
for-future-slices* design choice (the `run_record` discriminated union, which is
low-risk mechanical work whenever it is actually needed) to "the pivot," while the
*actually-load-bearing-now* concerns are the confirmation-semantics range and the
compose/injection surface. The `run_record` generalization is explicitly **out of
scope** for S-06 (ephemeral confirmation suffices; persistence/audit is S-09/FR-011)
— so the seam stays untouched and gets generalized in S-09 when a real audit
requirement makes the shape concrete.

## Confidence

**HIGH** — strong file:line evidence on all three live dimensions, two decisive
user narrowing signals, an independent cross-check that converged, and a clean
match to existing convention. One caveat carried forward, not blocking: the exact
*mechanism* for slow-op feedback (long timeout + periodic poll, an SSE op-status
stream, or dispatch-and-confirm) is a /10x-plan solution decision, not a framing
decision — the frame only fixes that a single < 10s blocking confirmation is the
wrong model for `up -d`.

## What Changes for /10x-plan

Plan the slice around three things — (a) a confirmation model that distinguishes
fast ops (instant blocking confirm, < 10s) from slow `up -d` (finite long timeout
with periodic "still running / succeeded / failed" status); (b) the compose vs
standalone command-form branch with an availability gate for up/down **and** a
charset constraint + boundary-parse for `composePath`/`composeProject` before any
interpolation; (c) destructive-`down` confirm + extracting the op surface out of
`DeviceServicesComponent`. **Drop** `run_record` generalization from this slice —
ephemeral confirmation only; revisit in S-09. Op timeout is a config-layer var
(lessons.md), not a const.

## References

- Source: `apps/api/src/executor/ssh.executor.ts:30-32,58-64`,
  `apps/api/src/config/env.schema.ts:52`,
  `apps/api/src/service/service.service.ts:27-29,128-134,158-168`,
  `apps/api/src/diagnose/diagnose.service.ts:112-119,152-161`,
  `apps/api/src/diagnose/diagnose.controller.ts:13-14`,
  `apps/api/src/database/schema/run-record.schema.ts:26`,
  `apps/api/src/diagnose/run-record.service.ts:15,43,88`,
  `libs/shared/src/lib/schemas/service.schema.ts:15-16`,
  `libs/shared/src/lib/schemas/container-name.schema.ts:9-12`,
  `apps/web/src/app/features/services/device-services.component.{html:30-51,122-136,ts:53,82-88,115-118}`
- PRD/roadmap: `context/foundation/prd.md:34,98,108-110`,
  `context/foundation/roadmap.md:187-197,224-234`
- Related research: `context/changes/deterministic-service-operations/research.md`
  (esp. Open Questions 1, 5, 6 — reframed here)
- Investigation: 3 parallel read-only sub-agents (run_record coupling,
  compose/injection surface, independent no-preconception sweep)
