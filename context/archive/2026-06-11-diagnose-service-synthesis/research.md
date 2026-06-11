---
date: 2026-06-11T16:30:00+02:00
researcher: Karol Dydo
git_commit: e8e91bb8ca3aec9e8477129c56c1a09abac37be8
branch: main
repository: karoldydo/opspilot
topic: "Diagnose a service → structured 4-field synthesis (roadmap slice S-04)"
tags: [ research, codebase, diagnose, llm-provider, ai-sdk, executor, ssh, managed-services, shared-contracts, web-ui ]
status: complete
last_updated: 2026-06-11
last_updated_by: Karol Dydo
---

# Research: Diagnose a service → structured 4-field synthesis (S-04)

**Date**: 2026-06-11T16:30:00+02:00
**Researcher**: Karol Dydo
**Git Commit**: e8e91bb8ca3aec9e8477129c56c1a09abac37be8
**Branch**: main
**Repository**: karoldydo/opspilot

## Research Question

Implementation-readiness research for the change `diagnose-service-synthesis` (roadmap slice **S-04**, the M1 north-star): a user runs `diagnoseLogs` on a managed service and the agent returns a structured **4-field synthesis** (`status`, `problems`, `suggestions`, `summary`) via Vercel AI SDK `generateObject` + a fixed Zod schema. NFR: diagnosis of ~200 log lines returns in **< 15 s**. Focus across four dimensions: (1) LLM provider + AI SDK, (2) SSH/executor + log retrieval, (3) managed services model (S-02), (4) shared contracts + web UI.

## Summary

**S-04 is a "join two halves" change, not a build-from-scratch one.** The entire **data-acquisition half is already shipped and battle-tested** by the prerequisite slices:

- **S-02 (`scan-and-add-services`, archived)** delivered the `service` table, the `IExecutor` SSH abstraction with per-device async-mutex + timeout/dispose, and a proven `docker ps`-over-SSH command path. `diagnoseLogs` is a near-clone of `scanServices`: run `docker logs <containerName>` through the same executor seam.
- **S-03 (`configure-llm-provider`, archived)** delivered encrypted provider storage, the single-active invariant, and — built ahead specifically for S-04 — the `getDecryptedApiKey(id)` service accessor plus an `active` index reserved for "the future find-active for S-04".

**The synthesis half is entirely greenfield** and is the whole of S-04's new work:

1. **No Vercel AI SDK anywhere** — `ai` and `@ai-sdk/*` are not installed; zero `generateObject`/`generateText` usage. S-03 deliberately deferred this.
2. **No `findActive()` / `getActiveProviderConfig()`** read method on `LlmProviderService` — the key accessor and index exist, but the "give me the active provider's `{ baseURL, model, apiKey }`" method does not.
3. **No 4-field synthesis schema** in `@opspilot/shared`.
4. **No `diagnose` endpoint, no diagnose service/module, no run-record table** (run records "originate in S-04" per roadmap, consumed later by S-09).
5. **No web diagnose surface** — client/store/component/button/result-panel.

The **principal risk is the < 15 s NFR**, which must cover *SSH log-fetch + LLM round-trip*. The default SSH command timeout (30 s) is wider than the entire budget, so the logs fetch needs a tighter bound and a separate generation timeout tunable.

## Detailed Findings

### Area 1 — LLM provider integration + Vercel AI SDK synthesis

**Storage & decryption (EXISTS).** The `llm_provider` Drizzle table ([`llm-provider.schema.ts:8-38`](https://github.com/karoldydo/opspilot/blob/e8e91bb8ca3aec9e8477129c56c1a09abac37be8/apps/api/src/database/schema/llm-provider.schema.ts#L8-L38)) is flat/fk-less with `active` (single-active flag), the AES-256-GCM secret triple (`authTag`/`ciphertext`/`iv`), `baseURL`, `kind` (`'openai-compatible'`), `model`, `keyVersion`, and an `llm_provider_active_idx` index whose comment explicitly names "the future find-active for s-04".

- **The S-04 entry point already exists:** `LlmProviderService.getDecryptedApiKey(id): Promise<string>` ([`llm-provider.service.ts:108-116`](https://github.com/karoldydo/opspilot/blob/e8e91bb8ca3aec9e8477129c56c1a09abac37be8/apps/api/src/llm-provider/llm-provider.service.ts#L108-L116)) reads the row, calls `crypto.decrypt(...)`, and wraps failure in `LlmProviderKeyDecryptError`. Its own comment: *"service-only accessor … for the future s-04 client factory. its return is NOT a contract type and must never be wired to a controller."*
- Crypto: `CryptoService.decrypt/encrypt` (AES-256-GCM, master key from `ENCRYPTION_KEY`) — `apps/api/src/crypto/crypto.service.ts:27-47`. **No new env var** for the LLM key; it reuses the generic master key.
- Single-active invariant is **app-enforced inside transactions** (`create` auto-actives the first row; `activate` unset-all-then-set-one) — `llm-provider.service.ts:34-51,87-97`. There is **no DB partial-unique index**.

**Vercel AI SDK — MISSING (greenfield).** `package.json` has no `ai` and no `@ai-sdk/*`; grep for `generateObject|generateText|streamText|@ai-sdk` returns zero source hits. The archived S-03 plan states it outright: *"Not installing `ai`/`@ai-sdk/*` … that is S-04"* (`context/archive/2026-06-10-configure-llm-provider/plan.md:80-81`).

**Client factory mapping.** `kind` has exactly one value, `'openai-compatible'`, across DB + contract + create-request. The intended factory (named in the archived plan/research) is **`createOpenAICompatible`** from `@ai-sdk/openai-compatible`:

```ts
// from @ai-sdk/openai-compatible
const provider = createOpenAICompatible({name: row.kind, baseURL: row.baseURL, apiKey: decryptedKey});
const model = provider(row.model);
// generateObject({ model, schema: diagnosisSynthesisSchema, prompt, abortSignal })
```

`kind` is an extensible discriminator (path to `@ai-sdk/anthropic` later), but **anthropic is not supported today**.

**Config layer.** Tunables flow through `registerAs` + Joi: `apps/api/src/config/llm.config.ts` currently exposes only `testTimeoutMs` (`LLM_TEST_TIMEOUT_MS`, Joi default 5000, `config/env.schema.ts:10,33`) — used by the reachability **probe**, not generation. The probe's `AbortSignal.timeout(this.config.testTimeoutMs)` (`llm-provider.probe.ts:23`) is the exact idiom to mirror for a **separate** generation-timeout tunable (e.g. `LLM_GENERATE_TIMEOUT_MS`). Do **not** reuse the 5 s probe budget for the 15 s generation budget. (This follows the lessons.md rule: operational tunables go in the config layer, never as in-file `const`s.)

### Area 2 — SSH execution layer + log retrieval (`diagnoseLogs` data source)

**Everything here EXISTS — S-04 reuses it as-is.**

- **`IExecutor`** ([`executor.interface.ts:14-16`](https://github.com/karoldydo/opspilot/blob/e8e91bb8ca3aec9e8477129c56c1a09abac37be8/apps/api/src/executor/executor.interface.ts#L14-L16)) is a single method: `execute(deviceId: string, command: string): Promise<ExecResult>`. Connect → run → dispose are encapsulated per call; callers never manage connections. (Note: this is *not* the `connect/disconnect/execute` triple the `node-ssh.md` rule describes — the implementation collapsed it.)
- **`ExecResult`** = `{ code: null | number; stdout: string; stderr: string }` (`executor.interface.ts:4-8`). `docker logs` writes to **stderr** — S-04 must read both streams.
- **`SshExecutor`** (`ssh.executor.ts:17-126`) does the whole credential resolve → decrypt → connect → run → timeout → dispose dance. Consumed via DI token `EXECUTOR = Symbol('EXECUTOR')`; S-04 wires `imports: [ExecutorModule]` + `@Inject(EXECUTOR) private readonly executor: IExecutor` — exactly as `ServiceService` does (`service.service.ts:17-18,37`).
- **async-mutex** (`async-mutex@^0.5.0`) is installed and used: per-device `Map<string, Mutex>` with `runExclusive` (`ssh.executor.ts:3,21,31,114-125`). Per-device serialization + cross-device parallelism is automatic; concurrent diagnose runs on the same device serialize for free.
- **Device + credential model.** `device` table carries `host` (the SSH target) and `name` only — **no port column** (defaults to 22). `credential` table is FK→device cascade, stores the AES-256-GCM secret triple + `authType` (`'password' | 'key'`) + `username`. `CredentialService.getDecryptedSecret(credentialId)` is the service-only plaintext accessor — already called inside the executor.

**Proven command path (template for `diagnoseLogs`).** `ServiceService.scan()` (`service.service.ts:43-54`) runs `docker ps` over SSH today:

```ts
const result = await this.executor.execute(deviceId, SCAN_COMMAND);
if (result.code !== 0) throw this.mapDockerError(deviceId, result.code, result.stderr);
// parse result.stdout
```

`diagnoseLogs` follows the identical shape with `docker logs <containerName> --tail 200`. **Critically, reuse the PATH-prefix** (`service.service.ts:27-29`) — Synology's non-interactive SSH session omits docker from PATH:

```
export PATH="/usr/local/bin:/usr/local/sbin:/volume1/@appstore/ContainerManager/usr/bin:$PATH"; docker logs ...
```

**Error taxonomy is mostly built:** `executor.errors.ts:16-42` (`CredentialDecryptError` 500, `SshAuthError` 502, `SshCommandTimeoutError` 504, `SshConnectError` 503) + `service.errors.ts` (`DockerDaemonDownError`, `DockerNotFoundError` via `mapDockerError`). S-04 may add a logs-specific not-found variant but largely reuses these.

### Area 3 — Managed services model (S-02)

**S-02 is fully implemented and archived** (`context/archive/2026-06-10-scan-and-add-services/`, roadmap status `done`).

**`service` table** ([`service.schema.ts:9-39`](https://github.com/karoldydo/opspilot/blob/e8e91bb8ca3aec9e8477129c56c1a09abac37be8/apps/api/src/database/schema/service.schema.ts#L9-L39)): `id` PK, `deviceId` (FK→device cascade, indexed), `containerName` (notNull, scan-derived identity), `name` (editable display name — the only mutable field), `composePath`/`composeProject` (nullable), timestamps. Unique guard `service_device_container_unq` on `(deviceId, containerName)`.

- **For S-04:** the row carries exactly what `diagnoseLogs` needs — **`containerName`** (→ `docker logs <containerName>`) and **`deviceId`** (→ host resolution via the executor). The S-02 research even annotates: *"`containerName` … S-04 diagnoseLogs → `docker logs <containerName>`."*
- **Deliberately NOT persisted:** image, ports, state, status, type ("never runtime facts", `service.schema.ts:6-8`). Runtime facts live only on the ephemeral `scannedContainerSchema` (`scan-result.schema.ts:8-15`), which is not stored. So `diagnoseLogs` **cannot** read live status from the DB — it must shell out via SSH.

**API surface** — `service.controller.ts` mounted at `@Controller('devices/:deviceId')`:

| Method | Route                                                    |
|--------|----------------------------------------------------------|
| POST   | `/api/devices/:deviceId/scan`                            |
| GET    | `/api/devices/:deviceId/services`                        |
| POST   | `/api/devices/:deviceId/services`                        |
| PATCH  | `/api/devices/:deviceId/services/:serviceId` (name only) |
| DELETE | `/api/devices/:deviceId/services/:serviceId`             |

**Natural attach point for S-04:** `POST /api/devices/:deviceId/services/:serviceId/diagnose` — a new method on this controller, or a new diagnose/run module injecting `ServiceService` (resolve the row) + `EXECUTOR` (fetch logs) + the new AI-SDK layer. **Watch-out:** `ServiceModule` does **not** currently export `ServiceService` (`service.module.ts:11-15`) — S-04 must add the export or re-implement the lookup.

**Run-record table (new).** DB machinery is ready: `@Global` database module, schema barrel `apps/api/src/database/schema/index.ts`, drizzle-kit generate, auto-applied migrations at boot (`migration.service.ts:24-38`, backup-gated). A new `run.schema.ts` / `diagnosis.schema.ts` (id, FK `serviceId`/`deviceId`, the 4 synthesis fields, captured logs, `createdAt`) would generate migration `0004_*.sql`. Roadmap: *"Run records originate in S-04"* — S-09 (audit) joins the graph here.

### Area 4 — Shared contracts + web UI surface

**Binding rule** (`.claude/rules/contracts.md`): every cross-boundary shape is **one** Zod schema in `libs/shared`, consumed via `z.infer` — never a parallel `interface`. Schemas live flat under `libs/shared/src/lib/schemas/` as `<name>.schema.ts` (+ co-located `.spec.ts`), barrel-exported alphabetically from `libs/shared/src/index.ts`. Zod **v4** syntax (`z.url()`, `z.enum()`, `z.strictObject()`, `error:` not `message:`).

**The new synthesis schema (MISSING — must create)** `libs/shared/src/lib/schemas/diagnosis-synthesis.schema.ts`:

```ts
export const diagnosisSynthesisSchema = z.strictObject({
  status: z.enum([/* e.g. 'healthy','degraded','down' — exact literals are a plan decision */]),
  problems: z.string().array(),
  suggestions: z.string().array(),
  summary: z.string(),
});
export type DiagnosisSynthesis = z.infer<typeof diagnosisSynthesisSchema>;
```

The closest existing template is **`scanResultSchema`** (`scan-result.schema.ts:8-25`) — also ephemeral, no `id`/timestamps, validated server-side. So the synthesis schema should **not** carry the `isoTimestamp` preprocess (that's for persisted entities like `llm-provider`/`service`/`auth-user`). The roadmap fixes only the four field *names*; array-vs-string shapes and the `status` enum values are plan-level decisions. Roadmap Non-Goal **[load-bearing]**: a single fixed schema, no user-defined output schemas.

**API consumption pattern** — `llm-provider.controller.ts:17-22` is the canonical thin controller: `@Body(new ZodValidationPipe(schema)) body: <z.infer alias>`, explicit `@Inject(...)`, response validated in the service's `toContract(row)`. S-04's diagnose endpoint returns `Promise<DiagnosisSynthesis>` produced by `generateObject({ schema: diagnosisSynthesisSchema })`.

**Web pattern (3-layer: client → store → component, all provided at component level, NOT root).**

- **Client** ([`llm-providers.client.ts:26-30`](https://github.com/karoldydo/opspilot/blob/e8e91bb8ca3aec9e8477129c56c1a09abac37be8/apps/web/src/app/core/clients/llm-providers.client.ts#L26-L30)): `@Injectable()`, `inject(HttpClient)`, relative `/api/...`, `firstValueFrom(...).then(row => schema.parse(row))` — **parse every response at the boundary**. (The codebase uses `HttpClient`+`firstValueFrom`, not `httpResource()`, despite `angular.md`'s default — follow the code.)
- **Store** (`llm-providers.store.ts`): `@ngrx/signals` `signalState`+`patchState` (zoneless, signals only), mutate-then-refetch, actions return `{ error: null | string }`, `errorMessage()` parses failures via `apiErrorSchema`. S-04 → a `DiagnosisStore` holding `{ result: DiagnosisSynthesis | null, loading, error }` + `diagnose(serviceId)`.
- **Component** (`llm-providers.component.ts`): `OnPush`, `providers: [Client, Store]`, **spartan/ng helm + Tailwind (NOT Angular Material)** — `HlmButton`, `HlmBadge`, `HlmAlert*`, etc.
- **Precedent for an action-button-on-a-row + result panel:** `DeviceServicesComponent` (`apps/web/src/app/features/services/device-services.component.ts`) with its `openScan()` flow. A "Diagnose" button would render the 4-field result in an `hlm-alert`/card (status → `hlmBadge`, problems/suggestions → lists, summary → text). **Placement (service-row vs new route) is an open plan decision** — `home.component.ts` is still a placeholder and there's no nav menu yet.

**Date↔ISO lesson** is encoded as the shared `isoTimestamp` preprocess on persisted schemas; the synthesis result has no timestamps, so it likely doesn't apply — but the broader rule (parse-at-boundary, `strictObject` rejects leaks) does.

## Code References

- `apps/api/src/llm-provider/llm-provider.service.ts:108-116` — `getDecryptedApiKey(id)`, the S-04 provider-key hook (no `findActive` yet)
- `apps/api/src/database/schema/llm-provider.schema.ts:8-38` — provider table, `active` index reserved for S-04 find-active
- `apps/api/src/llm-provider/llm-provider.probe.ts:23` — `AbortSignal.timeout(...)` idiom to mirror for generation timeout
- `apps/api/src/config/llm.config.ts` + `config/env.schema.ts:10,33` — `registerAs`+Joi tunable pattern (`LLM_TEST_TIMEOUT_MS` only today)
- `apps/api/src/executor/executor.interface.ts:4-16` — `IExecutor.execute(deviceId, command)` + `ExecResult`
- `apps/api/src/executor/ssh.executor.ts:3,21,31,58-79,114-125` — node-ssh, async-mutex, timeout/dispose
- `apps/api/src/executor/executor.errors.ts:16-42` — connect/auth/timeout/decrypt error taxonomy
- `apps/api/src/service/service.service.ts:27-54,106-114` — `docker ps`-over-SSH template, PATH prefix, `mapDockerError`
- `apps/api/src/database/schema/service.schema.ts:9-39` — `service` table (`containerName`, `deviceId`)
- `apps/api/src/service/service.controller.ts:29` — `devices/:deviceId` controller, diagnose-endpoint attach point
- `apps/api/src/service/service.module.ts:11-15` — does NOT export `ServiceService` (must fix for reuse)
- `apps/api/src/database/migration/migration.service.ts:24-38` — auto-apply migrations at boot (for the run-record table)
- `libs/shared/src/lib/schemas/scan-result.schema.ts:8-25` — ephemeral-result schema, the synthesis-schema template
- `libs/shared/src/lib/schemas/llm-provider.schema.ts:6,13-24` — `isoTimestamp` preprocess + `z.strictObject`/`z.enum` pattern
- `libs/shared/src/index.ts` — alphabetical `export *` barrel (add `diagnosis-synthesis.schema`)
- `apps/web/src/app/core/clients/llm-providers.client.ts:26-30` — parse-at-boundary HTTP client pattern
- `apps/web/src/app/core/stores/llm-providers.store.ts:25-38` — signalState store + `errorMessage`/`apiErrorSchema`
- `apps/web/src/app/features/services/device-services.component.ts` — action-button-on-a-row precedent
- `apps/web/src/app/app.routes.ts:5-35` — lazy `loadComponent` + `authGuard` routing

## Architecture Insights

- **S-04 is "wire the LLM half onto the existing SSH half."** Both prerequisite slices left explicit, commented hooks for it (`getDecryptedApiKey` "for the future s-04 client factory"; the `active` index "for the future find-active for s-04"; `containerName` "S-04 diagnoseLogs"). The change is well-scaffolded by design.
- **`diagnoseLogs` is a hidden built-in capability, not a skill-table row.** Mirror `scanServices`: a hardcoded backend method running a fixed command through the executor. The skill-as-data model is S-08, ~6 slices downstream — do not build it here.
- **Synthesis-only, no streaming.** S-04 is a normal request/response `generateObject` call. Live narration/SSE is split to S-05 — keep it out.
- **DI must use explicit `@Inject(Token)`** (lessons.md) — esbuild/Vitest drops `design:paramtypes`. Every new provider follows this.
- **The fixed 4-field schema is the load-bearing product decision** — it's what makes the AI output actionable. No user-defined output schemas (PRD Non-Goal).
- **Domain errors must never map to 401** — the web 401 interceptor clears the session. Provider/agent/SSH failures map to 5xx (502/503/504), as S-03 established; the `errorMessage` store helper already renders these.

## Risks & Open Questions

- **< 15 s NFR is the headline risk** — it must cover *SSH log-fetch + LLM round-trip*. The default `SSH_COMMAND_TIMEOUT_MS` is **30 s**, wider than the whole budget. Plan needs: (a) a tighter per-command bound for the logs fetch (config-only, no code change), and (b) a separate `LLM_GENERATE_TIMEOUT_MS` passed as `generateObject`'s `abortSignal`. How to split the 15 s between fetch and synthesis is an open decision.
- **`status` enum values** are undecided (roadmap fixes only the four field names). Likely `'healthy' | 'degraded' | 'down'` — a plan decision.
- **`problems`/`suggestions` shape** — `string[]` vs richer objects. Plan decision.
- **`ServiceService` is not exported** from `ServiceModule` — must export (or re-implement the service lookup) before cross-module reuse.
- **Run-record persistence: in-scope for S-04 or deferred?** Roadmap says run records "originate in S-04", but whether the *table* lands here or the response is ephemeral-only (persisted later by S-09) needs a scope call. S-05 (replay) and S-09 (audit) both depend on these records existing.
- **Web entry-point placement** — service-row "Diagnose" button vs a dedicated route. No nav menu exists yet; `home.component.ts` is a placeholder.
- **How many log lines to fetch** — roadmap NFR references "~200 log lines". `--tail 200` is the obvious default but should be a tunable, and large logs interact with both the SSH timeout and LLM token budget.

## Historical Context (from prior changes)

- `context/archive/2026-06-10-configure-llm-provider/plan.md:80-81,236-254` — S-03 explicitly deferred `ai`/`@ai-sdk/*` to S-04; built `getDecryptedApiKey` ahead "for the future consumer (S-04)"; `LlmProviderModule` already exports `LlmProviderService`.
- `context/archive/2026-06-10-scan-and-add-services/research.md:32,113,115,182` — the executor is "the load-bearing deliverable … reused by S-04/S-06/S-08"; the "no hang" timeout is an executor property inherited by every later skill; skill-as-data is S-08, AI-SDK tool-calling is S-04.
- `context/archive/2026-06-10-scan-and-add-services/plan.md:75-78,87-88` — "no persisted runtime facts" (S-04 must fetch fresh via SSH); `diagnoseLogs` expected as a hidden built-in like `scanServices`.
- `context/archive/2026-06-09-encrypted-credential-store/` — the crypto/credential contract the executor consumes; its decrypt-error-wrapping obligation is already discharged as `CredentialDecryptError`.
- `context/foundation/lessons.md` — four binding rules apply here: config-layer tunables (the timeout NFR), explicit `@Inject` DI, compute-then-write-in-one-transaction (if persisting a run record off a read), and Date↔ISO at the wire boundary.

## Related Research

- `context/archive/2026-06-10-configure-llm-provider/research.md` — provider abstraction, key encryption, AI-SDK choice (`createOpenAICompatible`)
- `context/archive/2026-06-10-scan-and-add-services/research.md` — executor design, the "no hang" NFR, skill-vs-built-in framing

## Open Questions

Captured above under **Risks & Open Questions** — the load-bearing ones for `/10x-plan` are: the 15 s budget split (fetch vs synthesis), the `status` enum + `problems`/`suggestions` shape, whether the run-record table lands in S-04, and the web entry-point placement.
