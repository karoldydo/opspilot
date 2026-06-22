# Diagnose Run-Step Narration — Plan Brief

> Full plan: `context/changes/diagnose-run-step-narration/plan.md`
> Frame brief: `context/changes/diagnose-run-step-narration/frame.md`
> Research: `context/changes/diagnose-run-step-narration/research.md`

## What & Why

The diagnose terminal feels dead during the long (~120 s) model-inference window, and discrete
real-execution steps cannot fill it — so the change is **(a)** an honest `step` frame for the
opening milestones **plus (b)** an ambient, continuously-updating liveness element for the
inference gap. The operator's lived observation was "nic do samego końca" (idle until the very
end): the terminal sits empty during a run and only paints the result when it's done.

## Starting Point

The diagnose SSE stream (`diagnose.service.ts:68`) emits a 3-member union — `delta` (progressive
synthesis), `done`, `error`. The first `delta` only arrives after model TTFT, so there is a real
dead-air window between HTTP 200 and the first painted content. The `ping` keep-alive is a named
event the renderer deliberately ignores; the blinking caret is the only animation during inference,
and it too starts only after TTFT. The terminal panel, `agent run` chrome, and caret already exist.

## Desired End State

A live run shows a fast opening burst of true terminal lines ($/·/+ prefixed), then a single
in-place "analyzing… Xs" line whose counter visibly advances through the inference window (caret
animating), then the synthesis content fills in, then a `= done in Xs — status: …` line. The
terminal is never visibly dead. Replayed historical runs still show the settled synthesis only —
steps and progress are ephemeral.

## Key Decisions Made

| Decision                          | Choice                                              | Why (1 sentence)                                                                                  | Source   |
| --------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------- |
| Problem to solve                  | Honest steps **+** ambient inference-gap filler     | Steps alone fire in the first <1 s; the felt dead-air is the inference window.                     | Frame    |
| Ambient liveness mechanism        | Server-emitted `progress` heartbeat frames          | User chose server-pushed frames over a client-side timer; `ping` can't reach the renderer.        | Plan     |
| Heartbeat frame shape             | Dedicated `progress` frame, single in-place line    | Keeps `steps[]` clean (true milestones only); one continuously-updating element, not a growing log.| Plan     |
| Contract shape for `step`         | Nested `runStepSchema` (own file)                   | Gives the store a first-class `RunStep[]` type; mirrors how `done` references `runRecordSchema`.   | Plan     |
| Step set                          | Only true milestones (drop cosmetic #4/#7)          | Every line is a real signal; honors the change.md honesty rule.                                    | Plan     |
| SSH connect/auth                  | One generic `connecting to <host> via ssh`, drop auth | connect/auth are opaque inside `SshExecutor`; extending `IExecutor` is out of scope.             | Plan     |

## Scope

**In scope:**
- `step` frame (nested `runStepSchema`) + `progress` heartbeat frame added to the shared union
- ~7 honest step emissions in `diagnose.service.ts` (cmd, connecting, fetching, received N lines/KB,
  analyzing model·provider, synthesizing, done in Xs)
- Server-driven `progress` timer carrying elapsed inference time, config-tunable cadence
- Web store `steps[]` + `progress` slices; terminal renders kind→prefix/color map + "analyzing… Xs"
- Updating the API specs that assert the exact frame set

**Out of scope:**
- Mockup-style 300 ms paced reveal; any fabricated/cosmetic step text (auth-identity, mid-stream
  "pattern detected" warn, resolving-container / loading-device-context echoes)
- Extending `IExecutor`/`SshExecutor` for connect/auth progress
- Persisting steps/progress; remediation / "apply" actions
- Any change to `delta`/`done`/`error`, synthesis persistence, or `durationMs`

## Architecture / Approach

Contract-first across three vertical phases. The shared union grows by two members. The API emits
honest `step` frames inline in the existing cold-Observable `run()` IIFE, and drives a second
`setInterval` (mirroring the existing `ping` keep-alive pattern) that emits `progress` frames during
inference, cleared at the first `delta` (TTFT) and in teardown. The web store accumulates a `steps[]`
slice and a single `progress` value; the terminal panel renders them with a FE-owned palette map. The
client (`diagnosis.client.ts`) is untouched — its generic `safeParse` accepts the widened union.

## Phases at a Glance

| Phase                                       | What it delivers                                              | Key risk                                                              |
| ------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------- |
| 1. Shared contract                          | `runStepSchema` + `step`/`progress` union members            | Getting the two frame shapes right so both apps infer cleanly        |
| 2. API — steps + progress heartbeat         | Honest step emission, progress timer, config tunable, spec fixes | Timer lifecycle (clear at TTFT/teardown); deterministic progress tests |
| 3. Web — render steps + progress            | Store slices + terminal kind-map, step loop, "analyzing… Xs" | Rendering progress in-place vs the appended step log; no layout regression |

**Prerequisites:** none beyond the current codebase; a real slow LLM provider is needed for the
manual liveness verification (frame notes `LLM_GENERATE_TIMEOUT_MS=120000` deployed).
**Estimated effort:** ~2-3 sessions across 3 phases (shared is small; API carries the timer + test
churn; web is additive rendering).

## Open Risks & Assumptions

- Progress frames are timer-driven, so the existing exact-frame-set specs must filter them out to
  stay deterministic; one dedicated fake-timer test covers the heartbeat behavior.
- Error-path ordering changes: a `logs-timeout` now emits leading step frames before the `error`
  frame (intended and honest), breaking the old `toHaveLength(1)` assertions.
- Assumes the SSH port is always 22 (device schema has no `port` field) — connecting line carries
  `<host>` only.

## Success Criteria (Summary)

- During a live run the terminal never sits visibly dead: opening step burst, then an advancing
  "analyzing… Xs" line through the inference window, then synthesis, then `= done in Xs`.
- The run still persists synthesis + `durationMs` and prepends to the recent list exactly as before;
  `delta`/`done`/`error` are unchanged.
- Replayed runs show the settled synthesis only — steps and progress are ephemeral.
