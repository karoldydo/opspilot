---
date: 2026-06-16T18:09:06+0200
researcher: Karol Dydo
git_commit: 8eb29c1113958dd932659d3ba4e9ffe112b7b521
branch: main
repository: opspilot
topic: "Testing the diagnoseLogs agent path under failure (Risk #1, test-plan Phase 1)"
tags: [research, codebase, diagnose, llm-provider, streamObject, timeout, schema-conformance, sse]
status: complete
last_updated: 2026-06-16
last_updated_by: Karol Dydo
---

# Research: Testing the `diagnoseLogs` agent path under failure (Risk #1)

**Date**: 2026-06-16T18:09:06+0200
**Researcher**: Karol Dydo
**Git Commit**: 8eb29c1113958dd932659d3ba4e9ffe112b7b521
**Branch**: main
**Repository**: opspilot

## Research Question

Ground test-plan **Phase 1 / Risk #1**: prove the `diagnoseLogs` agent returns a
clean, surfaced error (no crash, no hang) on unparseable / schema-nonconforming
LLM output, and that the run times out within its bound (< 15 s NFR). Specifically
ground the four context items the test plan asks for:

1. the LLM call boundary (`generateObject`/timeout),
2. how a schema-validation failure is translated,
3. what timeout governs the run,
4. the synthesis schema.

## Summary

The diagnose flow is **not** `generateObject` and **not** a request/response
endpoint — it is an **SSE streaming agent** built on Vercel AI SDK's
`streamObject()`, emitting `delta → done` (success) or `delta* → error` frames
over a NestJS `@Sse` route. Risk #1's surface is therefore the streaming error
taxonomy, not an HTTP error body.

**Most important finding for planning: Risk #1 is already substantially tested.**
Two specs already exist — `diagnose.service.spec.ts` (12 cases) and
`diagnose.controller.spec.ts` (5 e2e cases over a real temp SQLite DB) — and they
already assert the synthesis-failed frame, the synthesis-timeout frame, the
upstream-unavailable frame, fail-fast-before-stream, no-secret-leak, and the
heartbeat. Phase 1 is therefore **gap-closing, not greenfield**. The genuine
residual gaps (detailed in §6) are: the **`logs-timeout` path** (never exercised),
the **real `AbortSignal.timeout` wiring** (today simulated by injecting a fake
`TimeoutError`, not by letting the signal fire within its bound), the
**`NoObjectGeneratedError`-with-`TimeoutError`-cause unwrap branch**, and the
**real schema-rejection path through the agent** (the agent specs mock
`streamObject` wholesale, so the real `diagnosisSynthesisSchema` is never run
against bad model output inside the flow).

This last gap is exactly the test plan's "must challenge" warning for Risk #1:
*"A happy-path test with a mocked LLM means the generation layer is safe."* The
current timeout/schema tests **mock the entire `ai` boundary**, so they verify the
error-mapper, not the SDK's real validation/abort behavior.

## Detailed Findings

### 1. The LLM call boundary (`streamObject`, not `generateObject`)

The flow is an SSE agent. Entry → invocation → collection:

- **Route** — `apps/api/src/modules/diagnose/diagnose.controller.ts:40-47`:
  `@Sse('diagnose/stream')` on
  `GET /devices/:deviceId/services/:serviceId/diagnose/stream`, guarded by
  `@CurrentUserId()`; delegates to `diagnoseService.narrate(...)`.
- **Service entry / fail-fast** — `diagnose.service.ts:46-58` `narrate(...)`:
  resolves the service, the device, **and the active provider config** before
  returning the cold observable. No active provider → throws **409 before any
  stream opens** (`llmProviderService.getActiveProviderConfig()` at line 55).
- **Model construction** — `diagnose.service.ts:56`
  `const model = this.clientFactory.create(providerConfig);`
- **LLM invocation** — `diagnose.service.ts:112-118`:

  ```ts
  const { object, partialObjectStream } = streamObject({
    abortSignal: AbortSignal.any([AbortSignal.timeout(this.config.generateTimeoutMs), controller.signal]),
    model,
    prompt: this.buildPrompt(containerName, logs),
    schema: diagnosisSynthesisSchema,
    ...(system ? { system } : {}),
  });
  ```

  `streamObject` is imported from the `ai` package (v6.0.201). The provider sets
  `supportsStructuredOutputs: true`, forcing a real `json_schema` response format
  on the wire (not a silent JSON downgrade).
- **Stream collection** — `diagnose.service.ts:120-146`: iterates
  `partialObjectStream` emitting `{ type: 'delta', partial }`; checks
  `controller.signal.aborted` each tick; `await object` for the final synthesis;
  persists via `runRecordService.create(...)`; emits `{ type: 'done', run }`.

**The injectable boundary a fake replaces** —
`LlmProviderClientFactory.create(config): LanguageModel`:

- Definition — `apps/api/src/modules/llm-provider/llm-provider.client-factory.ts:16-24`:

  ```ts
  create(config: { apiKey: string; baseURL: string; kind: string; model: string }): LanguageModel {
    const provider = createOpenAICompatible({
      apiKey: config.apiKey, baseURL: config.baseURL, name: config.kind, supportsStructuredOutputs: true,
    });
    return provider(config.model);
  }
  ```
  (`@ai-sdk/openai-compatible` v2.0.48)
- DI token — class token `LlmProviderClientFactory`, exported from
  `llm-provider.module.ts:13`, injected at `diagnose.service.ts:31`
  (`@Inject(LlmProviderClientFactory)`).
- **No `maxRetries` / `maxTokens` / `temperature`** are set on the `streamObject`
  call — a timeout or schema failure is **terminal** (no retry).

### 2. How a schema-validation failure is translated

The translation lives in **`apps/api/src/modules/diagnose/diagnose.errors.ts`**,
function `diagnoseErrorToStreamEvent(error): { code, message }` (lines 30-42),
called from the stream's `catch` at `diagnose.service.ts:148-155`:

```ts
if (error instanceof DiagnosisLogsTimeoutError) return { code: 'logs-timeout', message: error.message };
if (isSynthesisTimeout(error))               return { code: 'timeout', message: 'active llm provider did not return a diagnosis in time' };
if (NoObjectGeneratedError.isInstance(error))return { code: 'synthesis-failed', message: 'active provider did not return schema-conformant output' };
return { code: 'upstream-unavailable', message: 'the diagnosis upstream is unavailable' };
```

- **Schema-nonconformant output** → Vercel AI SDK throws `NoObjectGeneratedError`
  → mapped to **`{ code: 'synthesis-failed' }`** (errors.ts:37-38). The error frame
  carries a fixed, sanitized message — **no raw model text** is surfaced.
- The `catch` at `diagnose.service.ts:148-155` first checks
  `controller.signal.aborted` and suppresses the frame on teardown (a client
  disconnect is not a reportable failure), then emits `{ type: 'error', code,
  message }` and `complete()`s.
- Frame taxonomy (the contract): `logs-timeout`, `timeout`, `synthesis-failed`,
  `upstream-unavailable` — enumerated in
  `libs/shared/src/lib/schemas/run-narration-event.schema.ts:12-16`.

### 3. What timeout governs the run

**Two distinct timeouts** bound the run (plus a heartbeat that is *not* a timeout):

| Timeout | Config field | Default / bound | Mechanism | Error code |
|---|---|---|---|---|
| LLM synthesis | `llm.generateTimeoutMs` (`LLM_GENERATE_TIMEOUT_MS`) | **12000 ms**, min 1000 | `AbortSignal.timeout(...)` composed via `AbortSignal.any` (`diagnose.service.ts:113`) | `timeout` |
| SSH logs fetch | `llm.logsTimeoutMs` (`LLM_DIAGNOSE_LOGS_TIMEOUT_MS`) | **5000 ms** | `Promise.race([exec, timeout])` (`diagnose.service.ts:179-206`) | `logs-timeout` |

- Env schema (Joi, with the < 15 s comment) —
  `apps/api/src/config/env.schema.ts:44`:
  `LLM_GENERATE_TIMEOUT_MS: Joi.number().integer().min(1000).default(12000)`.
- Config namespace — `apps/api/src/config/llm.config.ts:6-17`
  (`registerAs('llm', ...)`, numerics coerced with `Number(...)`).
- Runtime read — `diagnose.service.ts:34` (`@Inject(llmConfig.KEY)`), used at
  `diagnose.service.ts:113` (synthesis) and `:182-200` (logs fetch).
- **Timeout unwrap** — `isSynthesisTimeout()` (`diagnose.errors.ts:48-58`) treats a
  bare `TimeoutError`/`AbortError` **and** a `NoObjectGeneratedError` whose
  `.cause.name` is `TimeoutError`/`AbortError` as a synthesis timeout. The SDK may
  wrap the abort inside `NoObjectGeneratedError`, so the unwrap branch matters.
- Heartbeat (NOT a timeout) — `HEARTBEAT_INTERVAL_MS = 30_000`
  (`diagnose.service.ts:20`); emits `{ type: 'ping', data: '' }` every 30 s
  (`:89`) to survive the Cloudflare ~100 s idle reap (relevant to Risk #6, Phase 4).
- Teardown — observable returns `() => { controller.abort(); clearInterval(heartbeat); }`
  (`diagnose.service.ts:167-170`).

> The probe/test-call path uses a **separate** timeout `LLM_TEST_TIMEOUT_MS`
> (default 5000) at `llm-provider.probe.ts:23` — **not** part of the diagnose run.

### 4. The synthesis schema (the "4-field result")

`libs/shared/src/lib/schemas/diagnosis-synthesis.schema.ts:11-18`:

```ts
export const diagnosisSynthesisSchema = z.strictObject({
  problems: z.string().array(),
  status: z.enum(['healthy', 'degraded', 'down']),
  suggestions: z.string().array(),
  summary: z.string(),
});
export type DiagnosisSynthesis = z.infer<typeof diagnosisSynthesisSchema>;
```

- Re-exported at `libs/shared/src/index.ts:17`.
- **Constraints an LLM output can violate** (the conformance surface):
  `.strictObject()` rejects unknown keys; `status` is a 3-value lowercase enum;
  `problems`/`suggestions` must be string arrays; `summary` a string (no `.min(1)`,
  so `''` parses). **No `.refine()`** — violations are purely structural.
- **Already unit-tested in isolation** —
  `libs/shared/src/lib/schemas/diagnosis-synthesis.schema.spec.ts` (5 cases: valid,
  empty lists, unknown-key reject, bad-status reject, non-string-element reject).
- Nested into the persisted record — `run-record.schema.ts:15-21`
  (`runRecordSchema.synthesis = diagnosisSynthesisSchema`); the `done` frame
  returns a `RunRecord`.
- Partial (streaming deltas) — `run-narration-event.schema.ts:10`
  `diagnosisSynthesisSchema.partial()`.
- **Web consumers** (render the 4 fields): `diagnosis.store.ts:14-15`
  (`partial`/`result` state), `device-services.component.ts:27-31,92` and
  `audit.component.ts:14-18,41` (status badge keyed on the enum).

### 5. Existing test coverage (Risk #1 is already largely defended)

**`apps/api/src/modules/diagnose/diagnose.service.spec.ts`** (hand-built service,
`streamObject` mocked via `vi.mock('ai', ...)` keeping the real
`NoObjectGeneratedError`):

- `:165` delta → delta → done, persists, audits, builds prompt, calls factory.
- `:208` `NoObjectGeneratedError` mid-stream → `synthesis-failed` frame, **never
  persists**, `JSON.stringify(frame).not.toContain('raw')` (no leak).
- `:236` fake `TimeoutError` → `timeout` frame.
- `:252` non-zero docker exit → `upstream-unavailable`, synthesis never reached.
- `:266` no active provider → throws before stream; executor/streamObject untouched.
- `:276` unknown service → throws before provider resolves.
- `:283` `recentRuns` delegation.
- `:292` heartbeat `ping` frame in-flight.
- `:326/:338/:359` agentContext injected / trimmed / omitted as `system`.

**`apps/api/src/modules/diagnose/diagnose.controller.spec.ts`** (e2e:
`Test.createTestingModule({ imports: [ConfigModule, DatabaseModule, DiagnoseModule] })`,
real temp SQLite, session middleware, `EXECUTOR` + config tokens overridden):

- `:156` delta+done, stderr merged, run persisted + listed via `runs`.
- `:192` in-stream `synthesis-failed` returns **200 (not 401, not malformed)**.
- `:223/:238` agentContext set→reflected / null→omitted.
- `:249` **409 before any stream** when no provider active.

### 6. Genuine residual gaps for Phase 1 (where new tests add signal)

1. **`logs-timeout` path is never exercised.** `DiagnosisLogsTimeoutError` /
   `Promise.race` in `fetchLogs` (`diagnose.service.ts:179-206`) and the
   `logs-timeout` code (`diagnose.errors.ts:33`) have **zero assertions** — the
   config value `logsTimeoutMs: 5000` appears only in spec setup
   (`diagnose.service.spec.ts:68`). A test where `executor.execute` never resolves
   within the bound should yield a single `{ code: 'logs-timeout' }` frame, with
   synthesis never reached.
2. **Real `AbortSignal.timeout` wiring is simulated, not exercised.** The timeout
   test (`:236`) injects a hand-made `TimeoutError`; `streamObject` is fully
   mocked, so `AbortSignal.timeout(generateTimeoutMs)` never actually fires. The
   test plan's "the timeout fires within its bound" is asserted by stand-in. A
   test that drives the **real** abort composition (e.g. a fake model that hangs
   past a tiny overridden `generateTimeoutMs`) would close this.
3. **The `NoObjectGeneratedError`-with-`TimeoutError`-`cause` unwrap branch**
   (`diagnose.errors.ts:54-56`) is untested — the existing timeout test sets
   `name` directly rather than wrapping in `NoObjectGeneratedError`.
4. **No real schema rejection through the agent path.** Schema rejection is tested
   only in `libs/shared` in isolation; inside the flow, `streamObject` is mocked,
   so the SDK's real validation against `diagnosisSynthesisSchema` (and the
   resulting `NoObjectGeneratedError`) is never produced from an actual malformed
   object. Closing this means letting the SDK validate (e.g. a fake `LanguageModel`
   that returns a non-conformant object) rather than throwing a pre-built error.

## Code References

- `apps/api/src/modules/diagnose/diagnose.controller.ts:40-47` — `@Sse` route entry
- `apps/api/src/modules/diagnose/diagnose.service.ts:46-58` — `narrate()` fail-fast (404/409 before stream)
- `apps/api/src/modules/diagnose/diagnose.service.ts:112-118` — `streamObject({ abortSignal, model, prompt, schema })`
- `apps/api/src/modules/diagnose/diagnose.service.ts:120-146` — delta/done collection + persist
- `apps/api/src/modules/diagnose/diagnose.service.ts:148-155` — error `catch` → frame, abort-suppressed
- `apps/api/src/modules/diagnose/diagnose.service.ts:179-206` — `fetchLogs()` `Promise.race` logs timeout
- `apps/api/src/modules/diagnose/diagnose.service.ts:210-223` — `buildPrompt()` (4-field instruction)
- `apps/api/src/modules/diagnose/diagnose.errors.ts:30-42` — `diagnoseErrorToStreamEvent()` taxonomy
- `apps/api/src/modules/diagnose/diagnose.errors.ts:48-58` — `isSynthesisTimeout()` (incl. `.cause` unwrap)
- `apps/api/src/modules/diagnose/diagnose.errors.ts:15-19` — `DiagnosisLogsTimeoutError`
- `apps/api/src/modules/llm-provider/llm-provider.client-factory.ts:16-24` — `create()` injectable LLM boundary
- `apps/api/src/modules/llm-provider/llm-provider.service.ts:174-184` — `getActiveProviderConfig()`
- `apps/api/src/config/env.schema.ts:44` — `LLM_GENERATE_TIMEOUT_MS` Joi (min 1000, default 12000)
- `apps/api/src/config/llm.config.ts:6-17` — `registerAs('llm', ...)`
- `libs/shared/src/lib/schemas/diagnosis-synthesis.schema.ts:11-18` — the 4-field synthesis schema
- `libs/shared/src/lib/schemas/diagnosis-synthesis.schema.spec.ts` — isolated schema tests
- `libs/shared/src/lib/schemas/run-narration-event.schema.ts:10-16` — partial + error-code taxonomy
- `apps/api/src/modules/diagnose/diagnose.service.spec.ts:165-359` — existing unit-style coverage
- `apps/api/src/modules/diagnose/diagnose.controller.spec.ts:156-249` — existing e2e coverage
- `apps/api/vitest.config.mts:1-21` — api vitest (`globals: true`, `environment: 'node'`)

## Architecture Insights

- **The boundary is `streamObject` over SSE, not a request/response `generateObject`.**
  Phase 1 must assert **stream frames** (`delta`/`done`/`error` with a `code`), not
  an HTTP error body. The error taxonomy is the contract (`run-narration-event.schema.ts`).
- **Two clean injection seams** for a fake LLM: (a) override
  `LlmProviderClientFactory` to return a fake `LanguageModel` (drives the *real*
  `streamObject`), or (b) `vi.mock('ai', ...)` to stub `streamObject` directly
  (drives the *mapper* only, keeping the real `NoObjectGeneratedError`). The
  existing specs use (b); the unaddressed gaps (§6.2, §6.4) call for (a) to
  exercise real abort/validation.
- **Config-as-DI-token** (`llmConfig.KEY`) is the timeout knob in tests — override
  `.useValue({ generateTimeoutMs: <small>, logsTimeoutMs: <small>, ... })`; the
  full shape must be supplied (lessons.md: config-layer tunables).
- **Explicit `@Inject(Token)` everywhere** (esbuild drops `design:paramtypes`) —
  see `diagnose.service.ts:26-35`; a Testing-module override keys on those tokens.
- **No retry on the generate call** — failure is terminal and single-shot, which is
  exactly why the clean-error mapping carries the load for Risk #1.

## Historical Context (from prior changes)

- `context/foundation/test-plan.md` §2 Risk #1 + Risk Response Guidance — the source
  of this phase; names the cheapest layer (integration with an injected fake
  provider), the oracle-problem boundary (do **not** assert synthesis *content*),
  and the anti-pattern (tautological assertion of model output).
- `context/foundation/lessons.md`:
  - "Inject NestJS dependencies with an explicit `@Inject(Class)` token" — governs
    how a Testing-module override must be keyed.
  - "Put operational tunables in the config layer" — the timeout overrides in §6.
  - "Never list containers with `docker ps --format '{{json .}}'` / `-s`" — the
    27 s scan that motivates the bounded `logs-timeout` path (§6.1).

## Related Research

- None prior for this change (first artifact under
  `context/changes/testing-agent-diagnosis-under-failure/`). Sibling phases (#2 SSH
  executor, #3 security, #4 e2e+SSE) are scoped in `test-plan.md` §3 but not yet
  opened.

## Open Questions

1. Does the Vercel AI SDK (`ai` v6) surface an `AbortSignal.timeout` abort during
   `streamObject` as a bare `TimeoutError`, or wrapped as `NoObjectGeneratedError`
   with `.cause`? Both branches exist in `isSynthesisTimeout`; a real-abort test
   (§6.2) would resolve which path actually fires and whether both are reachable.
2. For §6.4, what is the lightest fake `LanguageModel` that makes `streamObject`
   emit a *real* `NoObjectGeneratedError` from a non-conformant object, without a
   network call? (Determines whether seam (a) is viable at the integration layer or
   belongs in a thin contract test.)
3. Is the `logs-timeout` path best driven through `DiagnoseService` directly
   (faster, seam (b)) or through the controller e2e (proves the 200 + frame end to
   end)? §6.1 likely wants the service-level test; the controller already proves the
   200-not-401 invariant for `synthesis-failed`.
