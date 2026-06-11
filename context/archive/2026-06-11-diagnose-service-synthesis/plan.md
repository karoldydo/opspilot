# Diagnose a Service → Structured 4-Field Synthesis (S-04) Implementation Plan

## Overview

Implement roadmap slice **S-04** (the M1 north-star): a user runs a diagnosis on a
managed service and the agent returns a fixed **4-field synthesis**
(`status`, `problems`, `suggestions`, `summary`). The endpoint fetches the
container's logs over the existing SSH executor and synthesizes them with the
**Vercel AI SDK v6** `generateText` + `Output.object` path against an
openai-compatible endpoint, with structured-output enforcement turned on
explicitly. The response is **ephemeral** (no run-record persistence — that is
S-09). NFR: diagnosis of ~200 log lines returns in **< 15 s**.

This is a **"join two halves"** change: the data-acquisition half (SSH executor
from S-02, encrypted provider key from S-03) is shipped and battle-tested; the
synthesis half (AI SDK, schema, endpoint, web surface) is the entirety of the
new work.

## Current State Analysis

Lifted from the frame's Hypothesis Investigation and the research's detailed findings:

- **SSH/log half EXISTS.** `IExecutor.execute(deviceId, command)` (`executor.interface.ts:14-16`)
  encapsulates connect→run→dispose with per-device async-mutex + timeout. `ServiceService.scan()`
  (`service.service.ts:43-54`) is the proven `docker ps`-over-SSH template, including the
  Synology **PATH-prefix** (`service.service.ts:27-29`). `docker logs` writes to **stderr**, so
  S-04 must read both `stdout` and `stderr` from `ExecResult` (`executor.interface.ts:4-8`).
- **Provider-key half EXISTS.** `LlmProviderService.getDecryptedApiKey(id)` (`llm-provider.service.ts:108-116`)
  returns the plaintext key (service-only, never a contract type). The `llm_provider` table has an
  `active` single-active flag + `llm_provider_active_idx` index reserved "for the future find-active for s-04".
- **Synthesis half is GREENFIELD.** No `ai`/`@ai-sdk/*` installed; no `generateObject`/`generateText`
  usage anywhere. No `getActiveProviderConfig()` read method. No 4-field schema. No diagnose
  endpoint/module. No web diagnose surface.
- **The load-bearing risk sits ABOVE the schema** (frame's reframe): the default
  `createOpenAICompatible` call has `supportsStructuredOutputs` effectively false, silently drops the
  Zod schema on the wire (sends only `response_format: { type: 'json_object' }`), and `generateText`
  then throws `NoObjectGeneratedError` after the fact. Against an **unfixed target endpoint** (local
  engines + commercial APIs both in play), schema-not-enforced must be a **first-class failure mode**.
- **AI SDK v4 is incompatible with Zod v4** (`zod ^4.4.3`, `package.json:59`). We pin **v6**.
- **Config-layer convention** (`lessons.md`): operational tunables go through `registerAs` + Joi
  (`llm.config.ts`, `env.schema.ts`), never as in-file `const`s. The probe's
  `AbortSignal.timeout(this.config.testTimeoutMs)` (`llm-provider.probe.ts:23`) is the idiom to mirror.
- **`ServiceModule` does NOT export `ServiceService`** (`service.module.ts:11-15`) — must export it
  before cross-module reuse.

### Key Discoveries (verified facts for the implementer)

- **AI SDK v6 idiom** (web-verified mid-2026): `generateObject` is **deprecated**. Use
  `generateText({ model, output: Output.object({ schema }), prompt, abortSignal })`, which returns
  `{ output }` (validated, typed to the schema). Imports `generateText`, `Output`, `NoObjectGeneratedError` from `'ai'`.
- **Structured-output enforcement**: set **`supportsStructuredOutputs: true`** on the
  `createOpenAICompatible({ name, baseURL, apiKey })` **factory** — this is the master switch that
  forces a real `response_format: { type: 'json_schema' }`. `strictJsonSchema` (per-call
  `providerOptions`, default `true`) is a secondary tuning flag, NOT the switch.
- **Packages**: `ai@^6.0.0`, `@ai-sdk/openai-compatible@^2.0.0` (the **2.x** line pairs with `ai` v6 —
  not `^3`, not `^1`). `zod ^4.4.3` satisfies the provider peer range `>=4.1.8` directly — no zod-v3 shim.
- **Error on schema violation / non-enforcement**: `NoObjectGeneratedError` from `'ai'`; narrow with
  `NoObjectGeneratedError.isInstance(error)`; diagnostic fields `.text`, `.cause`, `.response`, `.usage`, `.finishReason`.
- **Timeout**: `abortSignal: AbortSignal.timeout(ms)` on the generate call.
- **Domain errors map to 5xx, never 401** (the web 401 interceptor clears the session). Mirror the
  existing executor 5xx taxonomy (`executor.errors.ts:16-42`).

## Desired End State

A signed-in user, looking at a device's scanned services, clicks **Diagnose** on a service row. Within
~15 s a result panel appears below the row showing a status badge (healthy/degraded/down), a list of
detected problems, a list of suggestions, and a one-line summary — produced by the active LLM provider
from the container's recent logs. If the active provider's endpoint cannot honor schema-enforced JSON,
the user gets a clear 5xx error ("structured output not supported by the active provider") rather than
silently malformed output. No data is persisted; re-running re-diagnoses fresh.

Verification: `POST /api/devices/:deviceId/services/:serviceId/diagnose` returns a
`DiagnosisSynthesis` validated against `diagnosisSynthesisSchema`; against an endpoint that ignores
`json_schema`, it returns a 5xx domain error; the web surface renders all four fields.

## What We're NOT Doing

- **No run-record / diagnosis table.** Response is ephemeral; persistence is deferred to S-09.
- **No streaming / live narration** (SSE). That is S-05. This is a single request/response `generateText`.
- **No user-defined output schemas.** A single fixed 4-field schema (PRD/roadmap Non-Goal, load-bearing).
- **No skill-as-data model.** `diagnoseLogs` is a hidden built-in like `scanServices` (skill table is S-08).
- **No `@ai-sdk/anthropic` / multi-`kind` support.** `kind` stays `'openai-compatible'` only today.
- **No new encryption key / env secret for the LLM key.** Reuses the generic master key via existing crypto.
- **No dedicated `/diagnose` route or nav menu.** Entry point is the service-row button.
- **No richer `problems`/`suggestions` object shapes.** Flat `string[]` only.

## Implementation Approach

Build bottom-up across the FE↔BE contract boundary: (1) the shared Zod schema first so both sides
share one source of truth; (2) the API foundation — install + pin AI SDK v6, add config tunables, add
the active-provider read method, and a client factory that turns enforcement on and is smoke-tested;
(3) the diagnose endpoint that wires logs-over-SSH into the synthesis call with fail-fast 5xx error
handling; (4) the web client→store→component surface mirroring the existing llm-provider / services
patterns. The center of gravity is **structured-output reliability** (factory enforcement +
NoObjectGeneratedError → 5xx), not schema authorship.

## Critical Implementation Details

- **Enforcement-flag verification.** The exact enforcement option on the installed
  `@ai-sdk/openai-compatible@2.0.x` should be confirmed against the package's own types/source before
  finalizing the factory — the web-verified answer is `supportsStructuredOutputs: true` on the factory,
  but this provider has a history of structured-output regressions. A schema smoke test (Phase 2) is the
  guardrail: if the flag name/behavior drifted, the smoke test fails loudly at build/test time, not in production.
- **`docker logs` stderr merge.** `docker logs` writes the log stream to **stderr**. The synthesis
  input must be `stdout + stderr` merged (not `stdout` alone, unlike `scan()` which parses `stdout`).
- **Timeout budget split (< 15 s).** Two separate tunables, LLM-favored: a tighter per-command bound
  for the logs fetch (~5 s, distinct from the default 30 s `SSH_COMMAND_TIMEOUT_MS`) and
  `LLM_GENERATE_TIMEOUT_MS` (~12 s) passed as `generateText`'s `abortSignal`. The logs-fetch bound must
  not reuse the 5 s probe budget (`testTimeoutMs`) — separate concern.
- **DI must use explicit `@Inject(Token)`** (`lessons.md`) — esbuild/Vitest drops `design:paramtypes`.
  Every new provider and the `EXECUTOR` symbol injection follows this.

## Phase 1: Shared Synthesis Contract

### Overview

Create the single source-of-truth Zod schema for the 4-field synthesis in `@opspilot/shared`, consumed
by both the API (validation + `Output.object` schema) and the web client (parse-at-boundary).

### Changes Required:

#### 1. Synthesis schema

**File**: `libs/shared/src/lib/schemas/diagnosis-synthesis.schema.ts` (new)

**Intent**: Define the fixed ephemeral 4-field result the LLM must produce. No `id`/timestamps (mirror
the ephemeral `scanResultSchema`, not a persisted entity). Export the `z.infer` type alias.

**Contract**: `diagnosisSynthesisSchema = z.strictObject({ status: z.enum(['healthy','degraded','down']),
problems: z.string().array(), suggestions: z.string().array(), summary: z.string() })` and
`export type DiagnosisSynthesis = z.infer<typeof diagnosisSynthesisSchema>`. Zod **v4** syntax
(`z.strictObject`, `z.enum`, `error:` not `message:`), lowercase enum literals per house convention
(`health-response.schema.ts:7-8`). Template: `scan-result.schema.ts:8-25`.

#### 2. Barrel export

**File**: `libs/shared/src/index.ts`

**Intent**: Re-export the new schema alphabetically so `api` and `web` resolve it via `@opspilot/shared`.

**Contract**: add `export * from './lib/schemas/diagnosis-synthesis.schema';` in alphabetical position.

#### 3. Schema spec

**File**: `libs/shared/src/lib/schemas/diagnosis-synthesis.schema.spec.ts` (new)

**Intent**: Lock the contract — valid object parses; unknown key rejected (strictObject); invalid
`status` literal rejected; non-string array elements rejected.

**Contract**: co-located Vitest spec following existing schema-spec conventions.

### Success Criteria:

#### Automated Verification:

- Shared lib builds: `npx nx build shared`
- Shared tests pass: `npx nx test shared`
- Lint passes: `npx nx lint shared`
- Type check passes across consumers: `npm run build`

#### Manual Verification:

- The schema is importable as `import { diagnosisSynthesisSchema, DiagnosisSynthesis } from '@opspilot/shared'` with no relative-path import.

**Implementation Note**: After completing this phase and all automated verification passes, pause for
manual confirmation before proceeding.

---

## Phase 2: API Foundation — AI SDK Install, Config Tunables, Provider Client Factory

### Overview

Install and pin AI SDK v6, add the diagnosis-specific config tunables, expose the active provider's
runtime config from `LlmProviderService`, and build the openai-compatible client factory with
structured-output enforcement turned on and smoke-tested.

### Changes Required:

#### 1. Dependencies

**File**: `package.json`

**Intent**: Add the AI SDK v6 runtime packages. Pin the majors that form a coherent peer-satisfying set.

**Contract**: add `"ai": "^6.0.0"` and `"@ai-sdk/openai-compatible": "^2.0.0"` to `dependencies`
(the 2.x provider line pairs with `ai` v6 — **not** `^3`). `zod ^4.4.3` already satisfies the provider
peer `>=4.1.8`. Run install; commit the lockfile delta.

#### 2. Config tunables

**File**: `apps/api/src/config/llm.config.ts`, `apps/api/src/config/env.schema.ts`

**Intent**: Add the generation-timeout, logs-fetch-timeout, and log-tail tunables through the existing
`registerAs` + Joi pattern (never in-file consts). Keep them distinct from the 5 s probe `testTimeoutMs`.

**Contract**: new keys on the `llm` config namespace — `generateTimeoutMs` (`LLM_GENERATE_TIMEOUT_MS`,
Joi default ~12000), `logsTimeoutMs` (`LLM_DIAGNOSE_LOGS_TIMEOUT_MS`, Joi default ~5000), `logsTailLines`
(`LLM_DIAGNOSE_LOGS_TAIL`, Joi default 200). Mirror `LLM_TEST_TIMEOUT_MS` wiring (`env.schema.ts:10,33`).

#### 3. Active-provider read method

**File**: `apps/api/src/llm-provider/llm-provider.service.ts`

**Intent**: Add the missing "give me the active provider's runtime config" accessor S-04 needs. Reads the
single active row (via the reserved `active` index), decrypts the key (reuse `getDecryptedApiKey`),
returns `{ baseURL, kind, model, apiKey }`. Service-only — NOT a contract type, never wired to a controller.

**Contract**: `getActiveProviderConfig(): Promise<{ apiKey: string; baseURL: string; kind: string; model: string }>`.
Throws a domain error when no active provider exists (a 5xx/409-class precondition failure — see Phase 3
error taxonomy). Comment it like the existing `getDecryptedApiKey` accessor.

#### 4. Provider client factory

**File**: `apps/api/src/llm-provider/llm-provider.client-factory.ts` (new) — or a method co-located with the diagnose service in Phase 3 (implementer's call; factory kept here for reuse)

**Intent**: Build a configured openai-compatible model from the active provider config, with
structured-output enforcement explicitly enabled. This is the load-bearing reliability seam.

**Contract**: a function/provider that, given `{ baseURL, apiKey, model, kind }`, returns the AI SDK
language model via `createOpenAICompatible({ name: kind, baseURL, apiKey, supportsStructuredOutputs: true })`
then `provider(model)`. **Verify the exact enforcement-flag name against the installed
`@ai-sdk/openai-compatible@2.0.x` types before finalizing** (web-verified as `supportsStructuredOutputs`,
but this provider has structured-output regression history).

#### 5. Enforcement smoke test

**File**: `apps/api/src/llm-provider/llm-provider.client-factory.spec.ts` (new)

**Intent**: Guard against the flag name/behavior drifting in the installed package. Assert that the
factory produces a model configured for `json_schema` enforcement (not the silent `json_object`
degrade) — e.g. by inspecting the constructed provider options / a mocked request, without a live LLM call.

**Contract**: Vitest spec that fails loudly if `supportsStructuredOutputs` enforcement is not active on
the constructed provider. No network. Document what real signal it checks.

### Success Criteria:

#### Automated Verification:

- Install succeeds and lockfile is consistent: `npm install` (no peer-dep errors)
- API builds: `npx nx build api`
- API tests pass (incl. smoke test): `npx nx test api`
- Lint passes: `npx nx lint api`
- Boot with new env defaults validates: app starts without Joi env errors

#### Manual Verification:

- Smoke test demonstrably fails if `supportsStructuredOutputs` is removed from the factory (confirm it has teeth).
- `getActiveProviderConfig()` returns the decrypted config for the active provider against a seeded DB row.

**Implementation Note**: Pause for manual confirmation after automated verification passes.

---

## Phase 3: API Diagnose Endpoint — Logs Fetch + Synthesis + Fail-Fast 5xx

### Overview

Wire the logs-over-SSH half into the synthesis half: a new diagnose module/controller resolves the
service row, fetches container logs through the executor, synthesizes them via `generateText` +
`Output.object`, and returns a validated `DiagnosisSynthesis` — with schema-not-enforced /
`NoObjectGeneratedError` mapped to a first-class 5xx domain error.

### Changes Required:

#### 1. Export `ServiceService`

**File**: `apps/api/src/service/service.module.ts`

**Intent**: Make the service-row lookup reusable cross-module (currently not exported).

**Contract**: add `ServiceService` to `ServiceModule`'s `exports`. (Alternatively re-implement the
lookup — exporting is preferred.)

#### 2. Diagnose module

**File**: `apps/api/src/diagnose/diagnose.module.ts` (new)

**Intent**: Host the diagnose service + controller. Imports the seams it composes.

**Contract**: `@Module({ imports: [ServiceModule, ExecutorModule, LlmProviderModule, ConfigModule(llm)],
controllers: [DiagnoseController], providers: [DiagnoseService] })`. Registered in `app.module.ts`.

#### 3. Diagnose service (logs fetch + synthesis)

**File**: `apps/api/src/diagnose/diagnose.service.ts` (new)

**Intent**: The orchestration. Resolve the service row (containerName + deviceId) via `ServiceService`;
fetch logs via the executor running `docker logs <containerName> --tail <N>` with the **PATH-prefix**
and a **tight per-command timeout** (`logsTimeoutMs`); **merge `stdout + stderr`** (docker logs →
stderr); build the prompt from the merged logs; call `generateText({ model, output: Output.object({
schema: diagnosisSynthesisSchema }), prompt, abortSignal: AbortSignal.timeout(generateTimeoutMs) })`
using the Phase 2 factory; return the validated `output`.

**Contract**: `diagnose(deviceId: string, serviceId: string): Promise<DiagnosisSynthesis>`. Explicit
`@Inject(EXECUTOR)`, `@Inject` ServiceService, LlmProviderService. Reuse the `service.service.ts:27-29`
PATH-prefix and `mapDockerError` shape for non-zero exit codes. Wrap the synthesis failure modes per #5.

#### 4. Diagnose controller + route

**File**: `apps/api/src/diagnose/diagnose.controller.ts` (new)

**Intent**: Expose the endpoint at the natural attach point under the device/service path.

**Contract**: `@Controller('devices/:deviceId/services/:serviceId')`, `@Post('diagnose')` →
`diagnose(@Param('deviceId') ..., @Param('serviceId') ...): Promise<DiagnosisSynthesis>`. Thin controller
(mirror `llm-provider.controller.ts:17-22`); no body, params only. Response is the service's return value.

#### 5. Synthesis error taxonomy

**File**: `apps/api/src/diagnose/diagnose.errors.ts` (new), reusing `executor.errors.ts` / `service.errors.ts`

**Intent**: Make schema-not-enforced and related synthesis failures first-class 5xx domain errors, never
401, never silent. Catch `NoObjectGeneratedError` and the generation `TimeoutError`/abort.

**Contract**: a new domain error (e.g. `DiagnosisSynthesisError`, 502-class) thrown when
`NoObjectGeneratedError.isInstance(error)` (provider didn't honor `json_schema`); a no-active-provider
precondition error (from Phase 2 #3); generation timeout maps to a 504-class error. Carry a safe message
("active provider did not return schema-conformant output"); do **not** leak `.text`/keys. SSH/docker
failures continue to flow through the existing executor 5xx taxonomy.

### Success Criteria:

#### Automated Verification:

- API builds: `npx nx build api`
- API unit tests pass: `npx nx test api`
- Lint passes: `npx nx lint api`
- Type check passes: `npm run build`

#### Manual Verification:

- `POST /api/devices/:deviceId/services/:serviceId/diagnose` against a real service returns a valid 4-field synthesis within ~15 s.
- Pointing the active provider at an endpoint that ignores `json_schema` yields a 5xx domain error (not a 401, not malformed 200).
- A stopped/missing container surfaces the existing docker/SSH 5xx error, not a synthesis error.
- Logs fetch merges stderr (verify diagnosis reflects actual `docker logs` content).

**Implementation Note**: Pause for manual confirmation after automated verification passes.

---

## Phase 4: Web Surface — Client, Store, Diagnose Button + Result Panel

### Overview

Add the 3-layer web surface (client → store → component) mirroring the llm-provider / services patterns,
with a "Diagnose" button on each service row and an inline result panel rendering the four fields.

### Changes Required:

#### 1. Diagnosis client

**File**: `apps/web/src/app/core/clients/diagnosis.client.ts` (new)

**Intent**: Call the diagnose endpoint and **parse the response at the boundary** with the shared schema.

**Contract**: `@Injectable()`, `inject(HttpClient)`, `diagnose(deviceId, serviceId): Promise<DiagnosisSynthesis>`
via `firstValueFrom(http.post('/api/devices/.../diagnose', {})).then(r => diagnosisSynthesisSchema.parse(r))`.
Mirror `llm-providers.client.ts:26-30` (HttpClient + firstValueFrom + parse, not `httpResource()`).

#### 2. Diagnosis store

**File**: `apps/web/src/app/core/stores/diagnosis.store.ts` (new)

**Intent**: Hold per-run diagnosis state and the action. Render API failures via the existing helper.

**Contract**: `@ngrx/signals` `signalState({ result: DiagnosisSynthesis | null, loading: boolean,
error: null | string })` + `patchState`; `diagnose(deviceId, serviceId)` returns `{ error: null | string }`;
failures parsed via `apiErrorSchema` / `errorMessage()`. Mirror `llm-providers.store.ts:25-38`. Keyed so
diagnosing one row doesn't clobber another (or scoped per row — implementer's call).

#### 3. Diagnose button + result panel

**File**: `apps/web/src/app/features/services/device-services.component.ts` (+ template/styles)

**Intent**: Add a "Diagnose" action on each service row (precedent: `openScan()`) and render the result
inline in an `hlm-alert`/card: `status` → `hlmBadge` (color by state), `problems`/`suggestions` → lists,
`summary` → text. Loading + error states handled.

**Contract**: provide `[DiagnosisClient, DiagnosisStore]` at component level (NOT root); `OnPush`;
spartan/ng helm + Tailwind (`HlmButton`, `HlmBadge`, `HlmAlert*`) — not Angular Material. Badge color
map: healthy→success, degraded→warning, down→destructive.

### Success Criteria:

#### Automated Verification:

- Web builds: `npx nx build web`
- Web unit tests pass: `npx nx test web`
- Lint passes: `npx nx lint web`
- Whole workspace builds: `npm run build`

#### Manual Verification:

- Clicking "Diagnose" on a service row shows a spinner, then the 4-field result within ~15 s.
- Status badge color matches the state; problems/suggestions render as lists; summary renders.
- A 5xx domain error (e.g. provider can't enforce schema) shows a readable error, does not log the user out.
- Diagnosing one row does not overwrite another row's result.

**Implementation Note**: Pause for manual confirmation after automated verification passes.

---

## Testing Strategy

### Unit Tests:

- `diagnosisSynthesisSchema`: valid parse; unknown-key rejection (strictObject); invalid `status` literal; non-string array element.
- Client factory smoke test: enforcement (`supportsStructuredOutputs`) is active on the constructed provider; fails if removed.
- `DiagnoseService`: logs-command shape (PATH-prefix, `--tail N`, stderr merge); `NoObjectGeneratedError` → 5xx domain error; generation timeout → 504-class; non-zero docker exit → existing docker error.
- `getActiveProviderConfig()`: returns decrypted config for active row; throws when no active provider.

### Integration Tests:

- End-to-end `POST .../diagnose` (mocked LLM + mocked executor): happy path returns validated synthesis; schema-not-enforced path returns 5xx.

### Manual Testing Steps:

1. Configure an active openai-compatible provider that honors `json_schema`; diagnose a running service → 4-field result < 15 s.
2. Point the active provider at an endpoint that ignores `json_schema` → 5xx domain error, no logout.
3. Diagnose a stopped/missing container → docker/SSH 5xx error.
4. Diagnose two different rows → independent results.

## Performance Considerations

The < 15 s NFR is met via config-layer budgets, LLM-favored: logs fetch bounded at `logsTimeoutMs`
(~5 s, separate from the 30 s default SSH command timeout) and generation bounded at
`generateTimeoutMs` (~12 s) via `AbortSignal.timeout`. `logsTailLines` (~200) bounds both the SSH
payload and the LLM token budget. Worst-case sum can exceed 15 s — pick defaults with margin and tune
in env. Per-device async-mutex serializes concurrent same-device diagnoses for free.

## Migration Notes

No DB schema change (run-records deferred to S-09). Only new env vars with Joi defaults — existing
deployments boot unchanged. AI SDK v6 + zod v4 is a coherent peer set; no zod downgrade/shim.

## References

- Frame brief: `context/changes/diagnose-service-synthesis/frame.md`
- Research: `context/changes/diagnose-service-synthesis/research.md`
- Synthesis-schema template: `libs/shared/src/lib/schemas/scan-result.schema.ts:8-25`
- Logs-over-SSH template: `apps/api/src/service/service.service.ts:27-54`
- Provider-key hook: `apps/api/src/llm-provider/llm-provider.service.ts:108-116`
- Config tunable pattern: `apps/api/src/config/llm.config.ts`, `apps/api/src/config/env.schema.ts:10,33`
- Web patterns: `apps/web/src/app/core/clients/llm-providers.client.ts:26-30`, `apps/web/src/app/core/stores/llm-providers.store.ts:25-38`, `apps/web/src/app/features/services/device-services.component.ts`
- AI SDK v6: `generateText` + `Output.object`, `createOpenAICompatible({ supportsStructuredOutputs: true })`, `NoObjectGeneratedError` (ai-sdk.dev docs, verified mid-2026)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared Synthesis Contract

#### Automated

- [x] 1.1 Shared lib builds: `npx nx build shared` — bdde9ab
- [x] 1.2 Shared tests pass: `npx nx test shared` — bdde9ab
- [x] 1.3 Lint passes: `npx nx lint shared` — bdde9ab
- [x] 1.4 Type check passes across consumers: `npm run build` — bdde9ab

#### Manual

- [x] 1.5 Schema importable from `@opspilot/shared` with no relative-path import — bdde9ab

### Phase 2: API Foundation

#### Automated

- [x] 2.1 Install succeeds and lockfile consistent: `npm install` (no peer-dep errors) — 343830f
- [x] 2.2 API builds: `npx nx build api` — 343830f
- [x] 2.3 API tests pass (incl. smoke test): `npx nx test api` — 343830f
- [x] 2.4 Lint passes: `npx nx lint api` — 343830f
- [x] 2.5 Boot validates new env defaults (no Joi errors) — 343830f

#### Manual

- [x] 2.6 Smoke test fails if `supportsStructuredOutputs` removed (has teeth) — 343830f
- [x] 2.7 `getActiveProviderConfig()` returns decrypted config for active row — 343830f

### Phase 3: API Diagnose Endpoint

#### Automated

- [x] 3.1 API builds: `npx nx build api` — 3b3b366
- [x] 3.2 API unit tests pass: `npx nx test api` — 3b3b366
- [x] 3.3 Lint passes: `npx nx lint api` — 3b3b366
- [x] 3.4 Type check passes: `npm run build` — 3b3b366

#### Manual

- [x] 3.5 `POST .../diagnose` returns valid 4-field synthesis < 15 s — 3b3b366
- [x] 3.6 Endpoint ignoring `json_schema` yields 5xx (not 401, not malformed 200) — 3b3b366
- [x] 3.7 Stopped/missing container surfaces docker/SSH 5xx — 3b3b366
- [x] 3.8 Logs fetch merges stderr (diagnosis reflects `docker logs` content) — 3b3b366

### Phase 4: Web Surface

#### Automated

- [x] 4.1 Web builds: `npx nx build web` — 7045fee
- [x] 4.2 Web unit tests pass: `npx nx test web` — 7045fee
- [x] 4.3 Lint passes: `npx nx lint web` — 7045fee
- [x] 4.4 Whole workspace builds: `npm run build` — 7045fee

#### Manual

- [x] 4.5 "Diagnose" shows spinner then 4-field result < 15 s — 7045fee
- [x] 4.6 Status badge color matches state; problems/suggestions/summary render — 7045fee
- [x] 4.7 5xx domain error shows readable message, no logout — 7045fee
- [x] 4.8 Diagnosing one row does not overwrite another's result — 7045fee
