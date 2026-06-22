# Diagnose Run-Step Narration Implementation Plan

## Overview

The diagnose terminal currently sits idle/empty during a live run and only paints the result
at the end ("nic do samego końca"). We add two cooperating, additive pieces to the SSE stream:

1. An honest **`step`** frame — emitted at the real execution milestones (cmd, connecting,
   fetching, received N lines/KB, analyzing with model·provider, synthesizing, done in Xs) — so
   the terminal ticks through the opening burst of true milestones.
2. A **`progress`** heartbeat frame — a server-emitted, periodically-updating signal that carries
   the elapsed inference time during the long (~120 s) model-inference window, rendered FE-side as
   a single in-place "analyzing… Xs" line. This fills the dead-air gap that discrete steps cannot,
   because the honest steps all fire in the first <1 s.

`delta` / `done` / `error` frames, synthesis persistence, and `durationMs` are untouched — the two
new frames are purely additive.

## Current State Analysis

The diagnose stream is a cold RxJS `Observable<MessageEvent>` returned from `DiagnoseService`
(`apps/api/src/modules/diagnose/diagnose.service.ts:68`), with a two-phase design: pre-flight
checks resolve service/device/provider **before** the observable opens (`narrate()`, `:41-51`,
faults are HTTP 404/409), then a `run()` IIFE (`:76-142`) fetches logs and streams synthesis
(faults are in-stream `error` frames). The frame set today is a 3-member discriminated union
(`libs/shared/src/lib/schemas/run-narration-event.schema.ts:17-31`): `delta`, `done`, `error`.

The frame brief established (Confidence: HIGH, two STRONG verification agents) that the felt problem
is the **dead-air inference window**, not the absence of an opening step log:

- A real dead-air window exists: zero `delta`/`done` frames between HTTP 200 and the first `delta`
  at `:109`, which only starts after model TTFT (`for await` at `:105` blocks on inference).
- The long pole is model inference (`LLM_GENERATE_TIMEOUT_MS=120000` deployed); SSH+logs are
  sub-second to ~2 s.
- The existing `ping` keep-alive (`:74`) is a **named** `ping` event that `EventSource.onmessage`
  deliberately ignores (`diagnosis.client.ts:38`) — it cannot carry an ambient UI signal.
- The `animate-op-blink` caret (`diagnose-hero.component.html:49-54`) is the *only* thing animating
  during inference, and it only starts after TTFT — "caret yes, content no".

Research mapped the honest backing of each mockup line (the reality map,
`research.md` §2): ~6 of 11 lines have real signals; auth-identity (#3) and the mid-stream
"pattern detected" warn (#9, a synthesis finding) are fictional and dropped; resolving-container
(#4) and loading-device-context (#7) are cosmetic pre-flight echoes and omitted by decision.

The web layer is additive: `DiagnosisStore` is a plain `signalState` + `patchState` class
(`diagnosis.store.ts`), `DiagnosisClient` validates generically against `runNarrationEventSchema`
(`diagnosis.client.ts:46`) and needs **no change**, and the terminal panel already has the dark
surface, `agent run` chrome, and caret — a `@for` loop and a progress line slot in.

## Desired End State

Watching a live diagnose run, the operator sees: a fast opening burst of true terminal lines
($/·/+ prefixed), then a single continuously-updating "analyzing… Xs" line (with the caret) that
ticks every couple of seconds through the inference window, then the synthesis `delta` content
fills in, then a `= done in Xs — status: …` line. The terminal never sits visibly dead. Replayed
(historical) runs still show the settled synthesis only — steps and progress are ephemeral.

Verify: open the diagnose route against a real slow provider; confirm the opening steps render,
the "analyzing… Xs" counter visibly advances during inference, and the run still persists +
prepends to the recent list exactly as before.

### Key Discoveries:

- `buildNarration` receives only the opaque constructed `model` (`diagnose.service.ts:60-67`);
  `providerConfig.model` (string) and `providerConfig.kind` must be threaded from `narrate()`
  (`:48`) for the honest "analyzing with <model> · <provider>" line.
- The `setInterval`/`clearInterval` keep-alive pattern already exists (`:74`, `:140`, `:148`) —
  the progress timer mirrors it: start before `streamObject` (`:97`), clear on the first `delta`
  iteration and in `finally`/teardown.
- `HEARTBEAT_INTERVAL_MS` is an in-file const (`:19`) — pre-existing; the **new** tick interval
  must go through the config layer (lessons.md), `llm.config.ts:4` + Joi in `env.schema.ts`.
- Line/byte counts are not computed today; assemble after logs join (`:84-88`):
  `logs.split('\n').length` and `Buffer.byteLength(logs)`.
- Device schema exposes `host: z.string()` but **no `port`** (verified) — node-ssh defaults to 22;
  the connecting line is `connecting to <host> via ssh`, no `:22` suffix.
- Multiple specs hard-assert the exact ordered frame set and `toHaveLength(1)` single-error cases
  (`research.md` §"Tests that hard-assert the frame set") — they break the moment steps interleave.

## What We're NOT Doing

- No artificial mockup-style 300 ms paced reveal, and no fabricated/cosmetic step text — the
  honesty rule in `change.md:67-70` holds. The mockup's text is an example, not the contract.
- Not emitting the fictional lines: auth-identity (`+ authenticated as ops`), the mid-stream
  `! pattern detected` warn (it is a synthesis finding, already in the synthesis card), and the
  cosmetic `resolving container` / `loading device context` pre-flight echoes.
- Not extending `IExecutor`/`SshExecutor` to report connect/auth progress — a single generic
  `connecting to <host> via ssh` line is emitted at the `fetchLogs` boundary instead.
- Not persisting steps or progress — they are ephemeral; replayed runs show synthesis only
  (confirmed acceptable, `change.md:100-102`).
- No remediation / "apply" action (out of scope, same as the parent change).
- Not touching `delta` / `done` / `error` shapes, synthesis persistence, or `durationMs`.

## Implementation Approach

Contract-first, then API emission, then web rendering — three vertical phases, each with its test
updates woven into its success criteria. The shared union grows by two members (`step` carries a
nested `runStepSchema`; `progress` is a small inline shape carrying `elapsedMs` + `phase`). The API
emits the honest steps inline in the existing `run()` IIFE and drives the progress heartbeat with a
second `setInterval` cleared on first `delta`. The web store gains a `steps[]` slice and a single
`progress` value; the terminal renders them with a FE-owned kind→prefix/color map. The client is
untouched (generic `safeParse` accepts the widened union automatically).

## Critical Implementation Details

- **Progress timer lifecycle** — start the progress `setInterval` immediately before `streamObject`
  (after the `synthesizing` step is emitted), clear it on the **first** `partialObjectStream`
  iteration (TTFT — once `delta` content flows the line is no longer needed) AND in the existing
  `finally` (so error/abort paths stop it). It must also be torn down by the observable's teardown
  return, alongside the existing `clearInterval(heartbeat)`. A tick after the stream is torn down
  must not call `subscriber.next` — gate it the same way the existing flow guards on
  `controller.signal.aborted`.
- **Error-path step ordering** — a `logs-timeout` now emits the cmd/connecting/fetching steps
  *before* the `error` frame (they genuinely happened). This is honest and intended; the affected
  `toHaveLength(1)` specs must assert the leading step frames + trailing `error`, not length 1.
- **Test determinism for progress** — the mocked model in unit specs resolves the partial stream
  fast enough that, with a non-trivial tick interval, zero progress frames fire before the first
  `delta`; assert the step+delta+done sequence with `progress` frames filtered out, and add one
  dedicated fake-timer test that delays the first partial and asserts progress frames appear during
  the gap and stop after the first `delta`.

## Phase 1: Shared contract

### Overview

Widen `runNarrationEventSchema` with the two new frame members and introduce the nested
`runStepSchema` as its own file, keeping `delta`/`done`/`error` unchanged.

### Changes Required:

#### 1. New nested run-step schema

**File**: `libs/shared/src/lib/schemas/run-step.schema.ts` (new)

**Intent**: Give the `step` frame a first-class, reusable shape so the web store gets a clean
`RunStep[]` type, mirroring how `done` references `runRecordSchema`. Honors "one export per file".

**Contract**: Export `runStepSchema = z.strictObject({ kind: z.enum(['cmd','sys','ok','warn','result']), text: z.string() })` and `export type RunStep = z.infer<typeof runStepSchema>`. Keep `warn` in the enum even though no honest `warn` step ships at launch (stable contract for future real warnings, e.g. a degraded SSH retry).

#### 2. Widen the narration union

**File**: `libs/shared/src/lib/schemas/run-narration-event.schema.ts`

**Intent**: Add the `step` member (nesting `runStepSchema`) and the `progress` heartbeat member to
the discriminated union. Update the doc comment (`:12-16`) to name the two new frames and note that
`step`/`progress` are ephemeral (never persisted, absent on replay).

**Contract**: Two new `z.strictObject` members alongside the existing three:
`{ step: runStepSchema, type: z.literal('step') }` and
`{ elapsedMs: z.number().int().nonnegative(), phase: z.enum(['analyzing']), type: z.literal('progress') }`.
`phase` is an enum (single value now) so it extends cleanly. Import `runStepSchema` from the new file.

#### 3. Barrel export

**File**: `libs/shared/src/index.ts`

**Intent**: Re-export the new schema file so both apps can import `runStepSchema` / `RunStep`.

**Contract**: Add `export * from './lib/schemas/run-step.schema'` next to the existing schema
re-exports (`:17,23,24`). The union file already re-exports `RunNarrationEvent`, which widens
automatically — no change needed there beyond #2.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx nx run-many -t typecheck` (or `npm run build`)
- Lint passes: `npx nx lint shared`
- Shared unit tests pass: `npx nx test shared`
- A parse test accepts a valid `step` frame and a valid `progress` frame, and rejects a `step`
  frame with an unknown `kind` and a `progress` frame with a negative `elapsedMs`

#### Manual Verification:

- `RunNarrationEvent` (via `z.infer`) now includes the `step` and `progress` members when inspected
  in an editor; `RunStep` is importable from `@opspilot/shared`

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation before proceeding.

---

## Phase 2: API — honest step emission + progress heartbeat

### Overview

Thread the provider model/kind into `buildNarration`, emit the ~7 honest `step` frames at their
real milestones inside `run()`, compute the line/byte counts, and drive the `progress` heartbeat
with a config-tunable interval. Update the specs that assert the exact frame set.

### Changes Required:

#### 1. Thread provider model + kind into the narration

**File**: `apps/api/src/modules/diagnose/diagnose.service.ts`

**Intent**: The "analyzing with <model> · <provider>" line needs the human-readable model id and
provider kind, which are known pre-flight (`providerConfig`, `:48`) but not currently passed past
the constructed `model`.

**Contract**: Extend `buildNarration` (`:60-67`) signature to also accept `providerModel: string`
and `providerKind: string` (from `providerConfig.model` / `providerConfig.kind`); pass them from
`narrate()` (`:50`).

#### 2. Emit honest step frames in `run()`

**File**: `apps/api/src/modules/diagnose/diagnose.service.ts`

**Intent**: Interleave `step` frames at the real milestones, before the existing `delta`/`done`
emissions, using only real signals. Emit nothing fictional or cosmetic.

**Contract**: `subscriber.next({ data: { step: { kind, text }, type: 'step' } })` at these points,
in order inside `run()`:
- `cmd` — `$ opspilot diagnose <containerName>@<deviceName>` at the top of `run()` (device name
  is available pre-flight; thread it through like model/kind if not already in scope).
- `sys` — `connecting to <host> via ssh` before `fetchLogs` (no port; thread `device.host`).
- `sys` — `fetching last <logsTailLines> log lines` before `fetchLogs` (`this.config.logsTailLines`).
- `ok` — `received <lineCount> lines (<kb> KB)` after logs assembly (`:88`), from
  `logs.split('\n').length` and `Buffer.byteLength(logs)` (format KB to one decimal).
- `sys` — `analyzing with <providerModel> · <providerKind>` before `streamObject` (`:97`).
- `sys` — `synthesizing assessment` just after the analyzing line.
- `result` — `done in <durationMs/1000>s — status: <synthesis.status>` after `durationMs` (`:115`),
  before the `done` frame (`:128`).

#### 3. Progress heartbeat timer (config-tunable)

**File**: `apps/api/src/modules/diagnose/diagnose.service.ts`

**Intent**: Fill the inference dead-air with a server-emitted, periodically-updating `progress`
frame carrying elapsed time, so the FE can render a live "analyzing… Xs" line. Distinct from the
`ping` keep-alive (which the renderer ignores).

**Contract**: A second `setInterval` started right before `streamObject` (after the `synthesizing`
step), firing every `this.config.narrationTickMs`, emitting
`{ data: { elapsedMs: Date.now() - startedAt, phase: 'analyzing', type: 'progress' } }`. Cleared on
the first `partialObjectStream` iteration (TTFT), in the existing `finally` (`:138-141`), and in the
observable teardown (`:146-149`) next to `clearInterval(heartbeat)`. Gate each tick on
`controller.signal.aborted` so a late tick never emits on a torn-down stream.

#### 4. Config tunable for the tick interval

**Files**: `apps/api/src/config/llm.config.ts`, `apps/api/src/config/env.schema.ts`,
`.env` / `.env.example` (+ deployed `.env`)

**Intent**: Operational tunables go through `@nestjs/config` + Joi, never an in-file const
(lessons.md). Add the narration tick interval.

**Contract**: Add `narrationTickMs: Number(process.env.LLM_NARRATION_TICK_MS)` to the `llm`
`registerAs` factory (`llm.config.ts:4`); add a bounded, defaulted Joi entry for
`LLM_NARRATION_TICK_MS` in `env.schema.ts` (e.g. default 2000, min ~500); add the var to the
`.env` example files. Read it via `this.config.narrationTickMs` in the service.

#### 5. Update frame-set assertions

**Files**: `apps/api/src/modules/diagnose/diagnose.service.spec.ts`,
`apps/api/src/modules/diagnose/diagnose.controller.spec.ts`,
`apps/api/src/modules/diagnose/diagnose.service.real-model.spec.ts`

**Intent**: The specs that assert the exact ordered frame set and single-error length break once
steps interleave; update them to the new honest sequence and add progress coverage.

**Contract**: Update `toEqual(['delta','delta','done'])` / `toEqual(['delta','error'])` /
`toHaveLength(1)` cases to assert the leading `step` frames + the prior tail (filtering out
`progress` frames, which are timer-driven). Add one fake-timer test (`vi.useFakeTimers`) that delays
the first partial, advances time, and asserts `progress` frames fire during the gap and stop after
the first `delta`. Keep the tolerant `ping` assertions as-is. Mock `providerConfig` to supply
`model`/`kind` for the analyzing line.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx nx typecheck api` (or `npm run build:api`)
- Lint passes: `npx nx lint api`
- API unit tests pass: `npx nx test api`
- Boot-time env validation accepts a missing `LLM_NARRATION_TICK_MS` (default applies) and rejects
  an out-of-range value
- The fake-timer progress test asserts progress frames appear during a delayed inference and stop
  after the first `delta`

#### Manual Verification:

- Against a real slow provider, the stream emits the opening step burst, then `progress` frames at
  the configured cadence during inference, then `delta` content, then the `done in Xs` step + `done`
  frame; the persisted run + recent-list prepend are unchanged
- A forced `logs-timeout` yields the cmd/connecting/fetching steps followed by a single `error`
  frame (no orphaned progress frames)

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation before proceeding.

---

## Phase 3: Web — render steps + progress

### Overview

Accumulate the `step` and `progress` frames in `DiagnosisStore` and render them in the diagnose-hero
terminal panel with a FE-owned kind→prefix/color map, a `@for` step loop, and a single in-place
"analyzing… Xs" line above the caret.

### Changes Required:

#### 1. Store slices for steps + progress

**File**: `apps/web/src/app/features/diagnosis/data/diagnosis.store.ts`

**Intent**: Hold the ephemeral steps list and the latest progress value per entry, reset on each
new stream, dispatched from the two new non-terminal frames.

**Contract**: Add `steps: RunStep[]` and `progress: { elapsedMs: number } | null` to
`DiagnosisEntry` (`:11-17`) and `emptyEntry` (`:25`). Reset both in `stream()` (`:81`). At the top of
`handleEvent` (`:101`), before the terminal `done`/`error` handling, add an append-and-return arm for
`step` (push `event.step` onto `steps`) and a set-and-return arm for `progress` (replace the single
`progress` value). In the existing `delta` arm, clear `progress` to `null` (content is now alive).

#### 2. Terminal rendering: kind map, step loop, progress line

**Files**: `apps/web/src/app/features/diagnosis/diagnose-hero.component.ts`,
`apps/web/src/app/features/diagnosis/diagnose-hero.component.html`

**Intent**: Render the steps as terminal lines with the mockup palette and the inference-gap progress
line, reusing the existing dark surface + caret.

**Contract**: In the component (`.ts:9-21`, next to `BADGE_CLASS`/`DOT_CLASS`), add a
`Record<RunStep['kind'], { prefix: string; colorClass: string }>` mapping
`cmd→$`, `sys→·`, `ok→+`, `warn→!`, `result→=` to the existing Tailwind/design tokens
(`op-cream`, `op-terminal-blue`, green/orange/gray ramps per the mockup `:802-803`). In the template
(`.html`, between the summary line `:42` and the caret `:49`), add `@for (step of entry().steps;
track $index)` emitting one prefixed line per step, and a progress line rendered when
`entry().progress` is set (e.g. `· analyzing… {{ (entry().progress.elapsedMs / 1000) | number:'1.0-0' }}s`)
above the caret. The synthesis card (`:57-98`) is unchanged.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx nx typecheck web` (or `npm run build:web`)
- Lint passes: `npx nx lint web`
- Web unit tests pass: `npx nx test web`
- Store unit test: a `step` frame appends to `steps` without tearing down; a `progress` frame sets
  `progress`; a `delta` frame clears `progress`; `stream()` resets both

#### Manual Verification:

- A live run shows the opening step burst with correct prefixes/colors, then a single
  "analyzing… Xs" line whose counter visibly advances during inference, then the synthesis content,
  then the `= done in Xs` line; the caret animates throughout
- A replayed (historical) run from the recent list shows the settled synthesis only — no step log,
  no progress line
- No layout regression in the diagnose-hero terminal panel or the synthesis card below it

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation.

---

## Testing Strategy

### Unit Tests:

- Shared: `runNarrationEventSchema` accepts valid `step`/`progress` frames and rejects malformed
  ones (unknown `kind`, negative `elapsedMs`).
- API: the honest step sequence is emitted in order for a successful run; the error path emits the
  steps that already happened + a single trailing `error`; a fake-timer test asserts progress frames
  appear during a delayed inference and stop after the first `delta`.
- Web store: `step` appends without teardown, `progress` sets/replaces, `delta` clears progress,
  `stream()` resets both slices.

### Integration Tests:

- `diagnose.controller.spec.ts` end-to-end frame ordering through the `@Sse` pass-through reflects
  the new step-augmented sequence (progress filtered).

### Manual Testing Steps:

1. Run a diagnose against a real slow provider; confirm the opening step burst renders fast.
2. Watch the inference window; confirm the "analyzing… Xs" counter advances at the configured cadence
   and the caret animates — the terminal is never visibly dead.
3. Confirm the run persists and prepends to the recent list as before.
4. Open a replayed run; confirm only the settled synthesis shows (no steps/progress).
5. Force a `logs-timeout` (e.g. unreachable container); confirm cmd/connecting/fetching steps then a
   single error frame.

## Performance Considerations

The progress timer adds one `setInterval` per active run at `LLM_NARRATION_TICK_MS` cadence
(default ~2 s); each tick is a tiny frame and is cleared at TTFT, so steady-state overhead is one
extra frame every couple of seconds for at most the inference window. Line/byte counting is a single
`split` + `Buffer.byteLength` over the already-in-memory logs — negligible.

## Migration Notes

No data migration. The two new frames are ephemeral and additive; existing persisted `run_record`
rows and the replay path are unaffected. The only env addition is `LLM_NARRATION_TICK_MS` (defaulted
in Joi, so existing `.env` files keep working without it).

## References

- Frame brief: `context/changes/diagnose-run-step-narration/frame.md`
- Related research: `context/changes/diagnose-run-step-narration/research.md`
- Stream service: `apps/api/src/modules/diagnose/diagnose.service.ts:60-150`
- Contract: `libs/shared/src/lib/schemas/run-narration-event.schema.ts:17-31`
- Web store: `apps/web/src/app/features/diagnosis/data/diagnosis.store.ts:11-118`
- Terminal panel: `apps/web/src/app/features/diagnosis/diagnose-hero.component.html:29-55`
- Mockup palette: `mockups/index.html:802-803`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared contract

#### Automated

- [x] 1.1 Type checking passes across projects
- [x] 1.2 Lint passes: `npx nx lint shared`
- [x] 1.3 Shared unit tests pass: `npx nx test shared`
- [x] 1.4 Parse test accepts valid `step`/`progress` frames and rejects unknown `kind` / negative `elapsedMs`

#### Manual

- [x] 1.5 `RunNarrationEvent` widens with `step`/`progress`; `RunStep` importable from `@opspilot/shared`

### Phase 2: API — honest step emission + progress heartbeat

#### Automated

- [ ] 2.1 Type checking passes: `npx nx typecheck api`
- [ ] 2.2 Lint passes: `npx nx lint api`
- [ ] 2.3 API unit tests pass: `npx nx test api`
- [ ] 2.4 Env validation accepts missing `LLM_NARRATION_TICK_MS` (default) and rejects out-of-range
- [ ] 2.5 Fake-timer progress test: progress frames during delayed inference, stop after first `delta`

#### Manual

- [ ] 2.6 Real slow provider: step burst → progress cadence → delta → done step + done frame; persistence unchanged
- [ ] 2.7 Forced `logs-timeout` yields cmd/connecting/fetching steps + single `error` (no orphan progress)

### Phase 3: Web — render steps + progress

#### Automated

- [ ] 3.1 Type checking passes: `npx nx typecheck web`
- [ ] 3.2 Lint passes: `npx nx lint web`
- [ ] 3.3 Web unit tests pass: `npx nx test web`
- [ ] 3.4 Store test: `step` appends (no teardown), `progress` sets, `delta` clears progress, `stream()` resets both

#### Manual

- [ ] 3.5 Live run: step burst with prefixes/colors → advancing "analyzing… Xs" → synthesis → done line; caret animates
- [ ] 3.6 Replayed run shows settled synthesis only (no steps/progress)
- [ ] 3.7 No layout regression in terminal panel or synthesis card
