---
date: 2026-06-22T11:54:41Z
researcher: Karol Dydo
git_commit: 1e342f9bb24cd460a7c0e0fc0c5d94818c41ee39
branch: main
repository: opspilot
topic: "Stream real-time agent run-step narration into the diagnose terminal"
tags: [research, codebase, diagnose, sse, run-narration-event, terminal, zod-contract]
status: complete
last_updated: 2026-06-22
last_updated_by: Karol Dydo
---

# Research: Stream real-time agent run-step narration into the diagnose terminal

**Date**: 2026-06-22T11:54:41Z
**Researcher**: Karol Dydo
**Git Commit**: 1e342f9bb24cd460a7c0e0fc0c5d94818c41ee39
**Branch**: main
**Repository**: opspilot

## Research Question

Add a real-time "agent run steps" narration stream to the diagnose flow so the terminal
panel ticks through the **actual execution steps** (SSH connect, container resolve, log
fetch, model analysis, done) — not just the synthesis content. The mockup
(`mockups/index.html` `buildNarration()`) depicts this step log, but the SSE contract
(`runNarrationEventSchema`) has no "execution step" frame today. Research the live code
to map: (1) where to add the contract, (2) which mockup steps have **real** backing signals
vs. which are fictional, (3) how the API stream and web store/terminal must change, and
(4) which tests assert the exact frame set.

## Summary

The change is feasible and contract-first, but its hardest constraint — *"steps must be
**real** signals derived from actual execution, not hardcoded placeholder strings"*
(`change.md:67-70`) — collides with the mockup, **about half of whose 11 narration lines
have no real backing signal in the current code**. The research's central output is a
milestone-by-milestone reality map (below) separating what can be emitted honestly from
what would be theatre.

Concretely:

- **Contract (shared)** — one edit point. Add a fourth member to the `z.discriminatedUnion('type', …)`
  in `run-narration-event.schema.ts:17-31`. The discriminator key (`'type'`) and barrel
  export need no change; `RunNarrationEvent` widens automatically. Two viable shapes (inline
  vs. a reusable nested `runStepSchema`) — see Open Questions.
- **API** — steps are emitted from inside the existing cold `Observable` (`diagnose.service.ts:68`,
  IIFE `run()` lines 76-142) interleaved **before** the `delta` frames. The real backing
  for each step ranges from *available* (container name, log tail count, model/provider,
  duration) to *needs new computation* (byte/line counts) to *not observable* (SSH connect
  timing, auth identity — opaque inside `SshExecutor`) to *wrong layer* (the mockup's
  "pattern detected" warn line is a **synthesis finding**, not an execution step).
- **Web** — additive. `DiagnosisStore` is a plain `signalState` + `patchState` class
  (`diagnosis.store.ts`), not a `signalStore()`. Add a `steps[]` slice, reset it in
  `stream()`, and add an append-and-return `step` arm at the top of `handleEvent`
  (`diagnosis.store.ts:99-118`). `diagnosis.client.ts` needs **no change** — it validates
  generically against `runNarrationEventSchema` and forwards `parsed.data`. The terminal
  panel (`diagnose-hero.component.html:29-55`) already has the dark surface, the `agent run`
  chrome, and the `animate-op-blink` caret; a `@for (step of entry().steps)` loop slots in
  between the summary line and the caret. A `kind → {prefix, colorClass}` map must be built
  from scratch — none exists.
- **Tests** — multiple specs hard-assert the **exact ordered** frame set
  (`['delta','delta','done']`, `['delta','error']`) and single-error `toHaveLength(1)`.
  These break the moment a `step` frame is interleaved and must be updated.

## Detailed Findings

### 1. Shared contract (`@opspilot/shared`) — the single edit point

`runNarrationEventSchema` is a `z.discriminatedUnion('type', …)` with exactly three
`z.strictObject` members (`libs/shared/src/lib/schemas/run-narration-event.schema.ts:17-31`):

| Variant | `type` literal | Fields                                        |
|---------|----------------|-----------------------------------------------|
| delta   | `'delta'`      | `partial: diagnosisSynthesisSchema.partial()` |
| done    | `'done'`       | `run: runRecordSchema`                        |
| error   | `'error'`      | `code: z.string()`, `message: z.string()`     |

- Type export: `export type RunNarrationEvent = z.infer<typeof runNarrationEventSchema>` (`:33`).
- Composed schemas: `diagnosisSynthesisSchema` is the strict 4-field synthesis
  (`{ problems: string[], status: 'healthy'|'degraded'|'down', suggestions: string[], summary }`,
  `diagnosis-synthesis.schema.ts:11-16`); `runRecordSchema` nests it under `synthesis`
  plus `{ id, deviceId, serviceId, durationMs?, createdAt }` (`run-record.schema.ts:15-24`).
- Barrel: each schema is re-exported via `export * from './lib/schemas/<name>.schema'`
  (`libs/shared/src/index.ts:17,23,24`). **Adding a `step` variant inside the existing
  file needs no `index.ts` change.**

**Where the `step` member slots in:** a fourth `z.strictObject({…})` between the error
member (`:30`) and the array close (`:31`). The doc comment (`:12-16`) names the error
taxonomy (`logs-timeout`, `synthesis-failed`, `timeout`, `upstream-unavailable`) and notes
the heartbeat is deliberately **not** a domain event in this union.

Conventions confirmed against `.claude/rules/zod.md` + `contracts.md`: one export per file,
`z.strictObject` for closed shapes, Zod v4 API (`z.iso.datetime()`, `z.enum`,
`z.discriminatedUnion`), shared stays framework-agnostic (pure Zod, no `@nestjs`/`@angular`).

### 2. API diagnose flow (`apps/api`) — where real milestones live

The stream is a **cold RxJS `Observable<MessageEvent>`** (`diagnose.service.ts:68`),
returned by `buildNarration()`, in a deliberate two-phase design (comment `:36-40`):

- **Pre-flight, BEFORE the observable** (`narrate()`, `:41-51`): `serviceService.findOne`
  (`:43`), `deviceService.findOne` (`:45`), `llmProviderService.getActiveProviderConfig`
  (`:48`), `clientFactory.create` (`:49`). Faults here are **HTTP** errors (404/409), not
  stream frames. These resolve `service.containerName`, `device`, and
  `providerConfig.{model,kind}` — all known by the time the stream opens.
- **Logs fetch + synthesis, INSIDE the observable** (`run()` IIFE, `:76-142`). Faults here
  are in-stream `error` frames (stream is already HTTP 200).

Frame emission via `subscriber.next({ data: … })`: `delta` at `:109` (inside
`for await (const partial of partialObjectStream)`, `:105-110`), `done` at `:128`, `error`
at `:136` (mapped via `diagnoseErrorToStreamEvent`, `:135`), heartbeat `ping` at `:74`
(named `ping` event with empty data — **not** a literal `: ping` comment, because Nest's
`MessageEvent` has no comment escape hatch; `EventSource.onmessage` ignores named events so
it behaves like one). `streamObject()` synthesis at `:97-103`; `startedAt = Date.now()`
at `:96`; `durationMs = Date.now() - startedAt` at `:115`.

#### Reality map — mockup step → real backing signal

This is the load-bearing finding. Each row says whether a mockup narration line can be
emitted **honestly** from a real signal, and from where.

| #  | Mockup line (`mkLine` kind)                     | Real backing?                         | Where / what's needed                                                                                                                                                                                                                                                                                                                    |
|----|-------------------------------------------------|---------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1  | `$ opspilot diagnose <ctr>@<dev>` (`cmd`)       | **Yes** (synthetic line, real values) | `service.containerName` + `device.name`, known pre-flight. Emit first inside `run()`.                                                                                                                                                                                                                                                    |
| 2  | `· connecting to <host>:22 via ssh` (`sys`)     | **Partial**                           | `device.host` is known; the SSH connect itself happens **inside** `SshExecutor.run` (`ssh.executor.ts:43`) via one opaque `executor.execute()` call (`diagnose.service.ts:164`). Emit *around* `fetchLogs()` (`:78`), not from the connect. Port "22" is not currently surfaced — verify device schema.                                  |
| 3  | `+ authenticated as ops (ed25519 key)` (`ok`)   | **No**                                | Auth identity + key type live inside the executor/ssh config; never surfaced to `diagnose.service`. **Drop or genericize** unless the executor is extended to report it.                                                                                                                                                                 |
| 4  | `· resolving container <ctr>` (`sys`)           | **Weak**                              | Container name resolved pre-flight in `findOne` — no distinct runtime resolve step exists. Cosmetic if emitted.                                                                                                                                                                                                                          |
| 5  | `· fetching last 200 log lines` (`sys`)         | **Yes**                               | Tail count = `this.config.logsTailLines` (`:163`, default 200). Emit before/at `fetchLogs`.                                                                                                                                                                                                                                              |
| 6  | `+ received 200 lines (18.4 KB)` (`ok`)         | **Yes, needs new compute**            | Byte/line counts are **not computed today**. Logs assembled at `:84-87`; add `logs.split('\n').length` + `Buffer.byteLength(logs)` at ~`:88`.                                                                                                                                                                                            |
| 7  | `· loading device context` (`sys`)              | **Weak**                              | Device context loaded pre-flight; no distinct step. Cosmetic.                                                                                                                                                                                                                                                                            |
| 8  | `· analyzing with <model> · <provider>` (`sys`) | **Yes, needs threading**              | `providerConfig.model` + `providerConfig.kind` (`llm-provider.service.ts:163-174`) are known pre-flight but **only the opaque constructed `model` object is passed into `buildNarration`** (`:50`). Thread `providerConfig.model`/`.kind` through. Emit before `streamObject` (`:96`).                                                   |
| 9  | `! pattern detected: ENOSPC …` (`warn`)         | **No (wrong layer)**                  | This is a **synthesis finding** (`synthesis.problems[]`), produced by the LLM *after* analysis — not a pre-synthesis execution step. The mockup fakes its mid-stream timing. **Do not emit as a step**; it already surfaces in the synthesis card. (Keep `warn` in the `kind` enum for future/real warnings, e.g. a degraded SSH retry.) |
| 10 | `· synthesizing assessment` (`sys`)             | **Yes**                               | Emit at `:96`, just before/after the analyze step.                                                                                                                                                                                                                                                                                       |
| 11 | `= done in 11.3s — status: DEGRADED` (`result`) | **Yes**                               | `durationMs` at `:115`; `status` = `synthesis.status` (`:111`). Emit before the `done` frame (`:128`).                                                                                                                                                                                                                                   |

**Net honest step set: ~6 of 11** (cmd, connecting, fetching, received N lines/KB, analyzing
with model·provider, synthesizing, done) — with #6 and #8 requiring small code additions
(count computation; threading provider fields), #2 emitted at the `fetchLogs` boundary rather
than the true connect, and #3/#9 dropped, #4/#7 optional cosmetic.

#### Config injection (`apps/api`)

All deps use **explicit `@Inject(...)` tokens** (esbuild/vitest drops `design:paramtypes`
— comment `:23-24`; matches lessons.md). `DiagnoseService` constructor `:25-34` injects
`@Inject(llmConfig.KEY) config: LlmConfig`. Namespaces (`registerAs`):

- **`llm`** (`config/llm.config.ts:4`): `generateTimeoutMs` (`LLM_GENERATE_TIMEOUT_MS`, 12000),
  `historyRetention` (20), `logsTailLines` (`LLM_DIAGNOSE_LOGS_TAIL`, 200), `logsTimeoutMs`
  (5000), `testTimeoutMs` (5000).
- **`ssh`** (`config/ssh.config.ts:4`): `commandTimeoutMs` (30000), `connectTimeoutMs` (10000),
  injected into `SshExecutor` (`ssh.executor.ts:21`).

**LLM model/provider are NOT config** — they are per-row DB values from the active
`llmProvider` row, resolved at runtime by `getActiveProviderConfig()` returning
`{ apiKey, baseURL, kind, model }`. No new config tunable is strictly required for steps
themselves (byte/line counts are computed, not configured); per lessons.md + change.md, **if**
step emission gets any toggle/threshold it must go through `@nestjs/config` + Joi, never an
in-file `const`.

#### SSE conventions

`X-Accel-Buffering: no` + `Cache-Control: no-cache` are set automatically by Nest's
`SseStream` (controller comment `diagnose.controller.ts:38-39`); no manual header writes
exist. Controller is pure pass-through (`:40-47`). Aligns with `.claude/rules/sse.md` intent.

### 3. Web feature (`apps/web/src/app/features/diagnosis/`)

Six files; no scss, no sub-components. Lazy-routed at
`devices/:deviceId/services/:serviceId/diagnose` (`app.routes.ts:27-32`).

**`DiagnosisStore`** — plain `@Injectable()` holding one `signalState<DiagnosisState>`
mutated via `patchState` (not `signalStore()`), provided per-component. State keyed by
`serviceId`; each `DiagnosisEntry` (`:11-17`) = `{ error, loading, partial, result, runs }`
— **no `steps[]` today**. Frame dispatch in `handleEvent` (`:99-118`): `delta` merges into
`partial` and returns early (non-terminal); `done` sets `result`/prepends `runs` then
`teardown`; `error` surfaces `message` then `teardown`.

Edit points:
1. Add `steps: RunStep[]` to `DiagnosisEntry` (`:11-17`) + `emptyEntry` (`:25`).
2. Reset `steps: []` in `stream()` (`:81`) alongside the other resets.
3. Add an append-and-return arm at the **top** of `handleEvent` (`:101`), mirroring `delta`:
   `if (event.type === 'step') { patchEntry(serviceId, { ...entry, steps: [...entry.steps, event.step] }); return; }`
   — before the terminal `done`/`error` handling so it never calls `teardown`.

**`DiagnosisClient`** — native `EventSource` GET (`:37`), deliberately bypassing `HttpClient`
(avoids the 401 session interceptor on a stream pre-flight). `onmessage` (`:38-50`):
`JSON.parse` in try/catch, then `runNarrationEventSchema.safeParse` (`:46`); only successful
frames dispatch. **No client change needed** — once the shared union gains a `step` member,
`safeParse` accepts it and `handlers.event` forwards it.

**`diagnose-hero.component`** — `OnPush` standalone, provides client+store locally. Key
computed: `view = result ?? partial` (`:59`) drives both terminal and synthesis card. The
terminal panel (`diagnose-hero.component.html:29-55`): dark `bg-op-ink` box, 3-dot title bar
showing `agent run · {{ loading ? 'live' : 'idle' }}`, currently one `$`-prefixed summary
line (`:38-42`), and the **already-present** `animate-op-blink` caret while loading (`:49-54`).
A `@for (step of entry().steps; track $index)` loop slots between `:42` and `:49`, one
terminal line per step. Synthesis card (`:57-98`) stays below, unchanged.

Styling: pure Tailwind v4 utilities + design tokens (`op-ink`, `op-cream`, `op-terminal-blue`,
…) and keyframe utilities (`animate-op-in`/`op-blink`/`op-fade`) defined globally in
`apps/web/src/styles.scss`. **No step-kind→prefix/color map exists** — `BADGE_CLASS`/`DOT_CLASS`
(`diagnose-hero.component.ts:9-21`) are keyed by synthesis `status`, and the terminal `$`
prefix is a hardcoded literal. A new `Record<RunStep['kind'], { prefix, colorClass }>` +
accessor must be added next to those, mapping to the mockup palette.

### 4. Mockup narration reference (the FE styling target)

`mockups/index.html` defines the kind maps (`:802-803`):

```js
this.PRE = { cmd:'$', sys:'·', ok:'+', warn:'!', result:'=' };
this.COL = { cmd:'#fdfcfc', sys:'#9a9898', ok:'#30d158', warn:'#ff9f0a', result:'#4ea1ff' };
```

| Kind     | Prefix       | Color            | Weight |
|----------|--------------|------------------|--------|
| `cmd`    | `$`          | `#fdfcfc` cream  | 700    |
| `sys`    | `·` (U+00B7) | `#9a9898` gray   | 400    |
| `ok`     | `+`          | `#30d158` green  | 400    |
| `warn`   | `!`          | `#ff9f0a` orange | 400    |
| `result` | `=`          | `#4ea1ff` blue   | 700    |

`mkLine()` (`:894`) maps `{k,t}` → `{t, pre, col, wt}` (wt 700 for cmd/result, else 400).
Terminal render (`:308-324`): flex rows `gap:10px`, prefix `width:12px` fixed, line entrance
`animation:opIn 0.25s`, caret `opBlink 1s step-end infinite` (`:322`, keyframe `:19`). These
map onto the existing web tokens — **the FE owns the prefix/color, the contract carries only
`kind`+`text`** (the leaning in change.md, confirmed feasible since no FE map exists yet).

## Code References

GitHub permalinks at commit `1e342f9`:

- Shared contract (add `step` member here):
  [run-narration-event.schema.ts:17-31](https://github.com/karoldydo/opspilot/blob/1e342f9bb24cd460a7c0e0fc0c5d94818c41ee39/libs/shared/src/lib/schemas/run-narration-event.schema.ts#L17-L31)
- [diagnosis-synthesis.schema.ts:11-16](https://github.com/karoldydo/opspilot/blob/1e342f9bb24cd460a7c0e0fc0c5d94818c41ee39/libs/shared/src/lib/schemas/diagnosis-synthesis.schema.ts#L11-L16)
- [run-record.schema.ts:15-24](https://github.com/karoldydo/opspilot/blob/1e342f9bb24cd460a7c0e0fc0c5d94818c41ee39/libs/shared/src/lib/schemas/run-record.schema.ts#L15-L24)
- API stream (cold Observable + `run()` IIFE, milestone insertion points):
  [diagnose.service.ts:68-149](https://github.com/karoldydo/opspilot/blob/1e342f9bb24cd460a7c0e0fc0c5d94818c41ee39/apps/api/src/modules/diagnose/diagnose.service.ts#L68-L149)
  — pre-flight `:41-51`, `streamObject` `:97-103`, `startedAt` `:96`, `durationMs` `:115`,
  logs assembly `:84-88`, tail count `:163`.
- [diagnose.controller.ts:38-47](https://github.com/karoldydo/opspilot/blob/1e342f9bb24cd460a7c0e0fc0c5d94818c41ee39/apps/api/src/modules/diagnose/diagnose.controller.ts#L38-L47) — pass-through `@Sse`, header note.
- `apps/api/src/integrations/executor/ssh.executor.ts:43` — opaque `ssh.connect`; connect/auth not observable from diagnose.service.
- `apps/api/src/config/llm.config.ts:4`, `config/ssh.config.ts:4` — tunables (no model/provider here).
- Web store (add `steps[]` slice + `step` arm):
  [diagnosis.store.ts:99-118](https://github.com/karoldydo/opspilot/blob/1e342f9bb24cd460a7c0e0fc0c5d94818c41ee39/apps/web/src/app/features/diagnosis/data/diagnosis.store.ts#L99-L118) — entry `:11-17`, reset `:81`.
- [diagnosis.client.ts:36-53](https://github.com/karoldydo/opspilot/blob/1e342f9bb24cd460a7c0e0fc0c5d94818c41ee39/apps/web/src/app/features/diagnosis/data/diagnosis.client.ts#L36-L53) — generic `safeParse`, no change needed.
- [diagnose-hero.component.html:29-55](https://github.com/karoldydo/opspilot/blob/1e342f9bb24cd460a7c0e0fc0c5d94818c41ee39/apps/web/src/app/features/diagnosis/diagnose-hero.component.html#L29-L55) — terminal panel + caret; step loop slots `:42`→`:49`.
- `diagnose-hero.component.ts:9-21` — `BADGE_CLASS`/`DOT_CLASS`; add step-kind map here.
- Mockup palette: `mockups/index.html:802-803` (maps), `:894` (`mkLine`), `:917-939` (`buildNarration`), `:308-324` (terminal render), `:19` (`opBlink`).

### Tests that hard-assert the frame set (must be updated)

- `apps/api/.../diagnose.service.spec.ts:176` — `expect(...type)).toEqual(['delta','delta','done'])`.
- `diagnose.service.spec.ts:226` — `toEqual(['delta','error'])`.
- `diagnose.service.spec.ts:245,263,301,316` — `toHaveLength(1)` single-error cases
  (logs-timeout, timeout, upstream). **These break** because step frames (cmd/connecting/
  fetching) emit *before* a logs-timeout error.
- `diagnose.service.spec.ts:377` — `toContainEqual({ data:'', type:'ping' })` (tolerant).
- `diagnose.controller.spec.ts:159` — `toEqual(['delta','delta','done'])`; `:204` — `toEqual(['delta','error'])`.
- `diagnose.service.real-model.spec.ts:163` — `toHaveLength(1)` (timeout); `:219` — `not.toContain('done')` (tolerant).

## Architecture Insights

- **The contract is a one-file edit; the honesty is the hard part.** The discriminated-union
  shape makes adding a frame trivial. The real engineering is resisting the mockup's fictional
  steps (auth identity, mid-stream "pattern detected" warn) and emitting only what the
  execution actually knows. The change.md anticipates this (*"the mockup's text is an example,
  not the contract"*); this research turns that warning into a concrete row-by-row verdict.
- **Pre-flight vs. in-stream split shapes step timing.** Container/device/provider are resolved
  *before* the observable opens, so steps narrating them are emitted at the *start* of the
  stream (narrating already-settled facts), while connecting/fetching/synthesizing/done are
  emitted at their true in-stream milestones. Honest, but worth stating: early steps describe
  completed pre-flight work, not live operations.
- **SSH executor opacity is a real boundary.** `executor.execute()` is one call; connect, auth,
  exec, and dispose are invisible to the caller. A faithful "connecting…/authenticated…" pair
  would require extending `IExecutor`/`SshExecutor` to emit progress — a larger change than the
  additive step frame. Recommend emitting a single `· connecting to <host> via ssh` before
  `fetchLogs` and `+ received N lines (X KB)` after, and dropping the auth line.
- **Steps are ephemeral by design.** Synthesis + `durationMs` persist to `run_record` and
  replay; steps do not. Replayed runs (`replay()`) show the settled synthesis only; the step
  log appears solely on a live re-run. This matches the parent change's "synthesis is the
  persisted truth" decision and the change.md open question — confirmed acceptable.
- **Additive, not a rewrite.** `delta`/`done`/`error` are untouched; the client is generic;
  the terminal panel and caret already exist. The blast radius is: +1 shared union member,
  ~6 `subscriber.next` step emissions + 2 small compute/threading additions in the service,
  +1 store slice/arm, +1 FE kind-map and `@for` loop, and the spec updates above.

## Historical Context (from prior changes)

- `context/archive/2026-06-11-live-narration-and-replay/plan.md` — introduced the SSE stream,
  `streamObject` progressive synthesis, the three-frame `runNarrationEventSchema`
  (`:166-176`), `run_record` persistence with `historyRetention` prune in one transaction
  (`:265-270`), and the pre-flight-errors-are-HTTP rule (`:315-337`). This change extends
  that union; it does **not** revisit those decisions.
- `context/archive/2026-06-21-web-terminal-design-system/plan.md:461-508` — Phase 6 (commit
  `869c095`) closed the diagnose-hero as **synthesis-only terminal** (status dot +
  problems/suggestions/summary, line prefixes per kind), explicitly deferring the run-step
  narration. This change is that deferred follow-up.
- `context/archive/2026-06-21-web-terminal-design-system/research.md:96-106,199-220` — the
  terminal prefix vocabulary (`$·+!=`), two color ramps (darkened status text on cream vs.
  pure Apple ramp for dark-surface terminal syntax), and binary-radius token strategy — the
  styling foundation the step lines inherit.
- `context/foundation/lessons.md` — three priors apply: operational tunables via config layer
  (any new threshold), explicit `@Inject(...)` tokens (the service already complies),
  compute-then-write in one transaction (relevant only if step emission ever touches persistence
  — it does not; steps are ephemeral).

## Related Research

- `context/archive/2026-06-21-web-terminal-design-system/research.md` — the re-skin/token
  research that established the terminal design language this change renders into.

## Open Questions

1. **Contract shape — inline vs. nested `runStepSchema`.** change.md sketches the inline
   `{ type: 'step', kind, text }`. The web `steps[]` slice wants a clean named `RunStep` type.
   Two options for `/10x-plan`:
   - **A (inline):** `z.strictObject({ kind: z.enum(['cmd','sys','ok','warn','result']), text: z.string(), type: z.literal('step') })` — matches change.md, no new file; FE derives the step type via `Extract<RunNarrationEvent,{type:'step'}>`.
   - **B (nested, recommended):** new `run-step.schema.ts` exporting `runStepSchema` + `RunStep`, referenced as `z.strictObject({ step: runStepSchema, type: z.literal('step') })` — mirrors how `done` references `runRecordSchema`, gives the store a first-class `RunStep[]` type, honors "one export per file". Slightly more surface for a cleaner FE contract.
2. **Which "weak/cosmetic" steps to emit** (rows #4 resolving, #7 loading device context).
   They have no distinct runtime operation. Decide: include for narrative texture (clearly
   labeled, derived from real values) or omit to keep every line a true milestone.
3. **The SSH `connecting`/`authenticated` pair.** Confirm the recommendation: emit a single
   generic `connecting to <host> via ssh` before `fetchLogs` and drop the auth-identity line,
   rather than extending `IExecutor` to report connect/auth progress (larger scope).
4. **Port and host fields.** Verify `device.schema.ts` exposes host (and whether port is
   stored or assumed `22`) so the connecting step uses real values, not a hardcoded `:22`.
5. **Error-path step ordering.** With steps emitted before `fetchLogs`, a `logs-timeout` now
   yields `['step', …, 'error']`, breaking `toHaveLength(1)`. Confirm the desired contract:
   steps that already happened stay in the stream before the error frame (recommended — it's
   honest), and update those specs to assert the new prefix + trailing `error`.
6. **`warn` kind with no current emitter.** Keep `warn` in the enum (FE map + future real
   warnings such as a degraded SSH retry) even though no honest `warn` step exists at launch?
   Recommended yes, for a stable contract.
