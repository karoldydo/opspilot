# Diagnose a Service → Structured 4-Field Synthesis (S-04) — Plan Brief

> Full plan: `context/changes/diagnose-service-synthesis/plan.md`
> Frame brief: `context/changes/diagnose-service-synthesis/frame.md`
> Research: `context/changes/diagnose-service-synthesis/research.md`

## What & Why

Implement the M1 north-star slice S-04: a user diagnoses a managed service and the agent returns a
fixed 4-field synthesis (`status`, `problems`, `suggestions`, `summary`) from the container's logs.
The real problem to plan around (per frame's reframe) is making that synthesis **reliably
schema-conformant against an unknown openai-compatible endpoint** — by explicitly enforcing
structured output and pinning an AI-SDK/Zod-v4-compatible version — not by perfecting the field
definitions.

## Starting Point

The data-acquisition half is shipped: the SSH `IExecutor` (S-02) with a proven `docker`-over-SSH
path, and the encrypted provider key + `getDecryptedApiKey` accessor (S-03). The synthesis half is
entirely greenfield — no AI SDK installed, no active-provider read method, no schema, no endpoint, no
web surface.

## Desired End State

A signed-in user clicks **Diagnose** on a service row and within ~15 s sees a status badge, a problems
list, a suggestions list, and a summary — synthesized by the active LLM provider from recent logs. If
the provider's endpoint can't honor schema-enforced JSON, they get a clear 5xx error instead of silent
garbage. Nothing is persisted (run-records are deferred to S-09).

## Key Decisions Made

| Decision                       | Choice                                              | Why (1 sentence)                                                    | Source |
|--------------------------------|-----------------------------------------------------|---------------------------------------------------------------------|--------|
| Where the risk lives           | Structured-output reliability, not schema authoring | Default factory silently drops the schema on the wire               | Frame  |
| Run-record persistence         | Out of scope (ephemeral)                            | Deferred to S-09; S-04 is request/response                          | Frame  |
| AI SDK major version           | **v6** (`ai@^6`, `@ai-sdk/openai-compatible@^2`)    | Current maintained major; v4 incompatible with Zod v4               | Plan   |
| Synthesis idiom                | `generateText` + `Output.object`                    | `generateObject` is deprecated in v6                                | Plan   |
| Enforcement switch             | `supportsStructuredOutputs: true` on the factory    | Master switch forcing real `json_schema`; smoke-tested              | Plan   |
| `status` literals              | `healthy` \| `degraded` \| `down`                   | Roadmap-minimal, clean badge mapping                                | Plan   |
| `problems`/`suggestions` shape | flat `string[]`                                     | Matches ephemeral template; lower structured-output burden          | Plan   |
| Schema-not-enforced behavior   | Fail-fast 5xx domain error                          | Matches reframe + S-03 5xx taxonomy; clear signal endpoint is unfit | Plan   |
| Web entry point                | Service-row button + inline result panel            | Copies `openScan()` precedent; no routing/nav exists yet            | Plan   |
| Time budget (< 15 s)           | Two tunables, LLM-favored (~5 s fetch / ~12 s gen)  | LLM is the variable part; config-layer per `lessons.md`             | Plan   |

## Scope

**In scope:** shared 4-field schema; AI SDK v6 install + pin; config tunables (generate timeout, logs
timeout, tail); `getActiveProviderConfig()`; enforced client factory + smoke test; diagnose
service/controller/route; fail-fast 5xx error taxonomy; web client/store/button/result panel.

**Out of scope:** run-record table (S-09); streaming/SSE (S-05); user-defined schemas; `@ai-sdk/anthropic`
/ multi-`kind`; dedicated `/diagnose` route/nav; richer field object shapes; new encryption key.

## Architecture / Approach

`DiagnoseController` (`POST /api/devices/:deviceId/services/:serviceId/diagnose`) → `DiagnoseService`
resolves the service row (`ServiceService`), fetches `docker logs <containerName> --tail N` through the
`EXECUTOR` seam (PATH-prefix, **stderr merged**, tight timeout), then calls `generateText` +
`Output.object(diagnosisSynthesisSchema)` against the active provider's enforced openai-compatible model
(`getActiveProviderConfig()` → `createOpenAICompatible({ supportsStructuredOutputs: true })`).
`NoObjectGeneratedError` → 5xx domain error. Web: client (parse-at-boundary) → signal store → row button + `hlm-alert` panel.

## Phases at a Glance

| Phase                | What it delivers                                     | Key risk                                                             |
|----------------------|------------------------------------------------------|----------------------------------------------------------------------|
| 1. Shared contract   | `diagnosisSynthesisSchema` + type + spec             | Low — pure schema                                                    |
| 2. API foundation    | AI SDK v6 install, config tunables, enforced factory | Enforcement flag name on installed `@ai-sdk/openai-compatible@2.0.x` |
| 3. Diagnose endpoint | Logs-fetch + synthesis + fail-fast 5xx, route        | < 15 s budget; stderr merge; error taxonomy                          |
| 4. Web surface       | Client/store/button/result panel                     | State isolation per row; spartan/Tailwind rendering                  |

**Prerequisites:** an active LLM provider configured (S-03); at least one scanned service (S-02); a
reachable device over SSH.
**Estimated effort:** ~2-3 sessions across 4 phases.

## Open Risks & Assumptions

- The exact enforcement option on the **installed** `@ai-sdk/openai-compatible@2.0.x` must be confirmed
  source-level (web-verified as `supportsStructuredOutputs`); the Phase 2 smoke test is the guardrail.
- Worst-case `logsTimeoutMs + generateTimeoutMs` can exceed 15 s — defaults need margin and env tuning.
- Self-hosted engines vary in `json_schema` support; fail-fast 5xx is the intended (not degraded) outcome.

## Success Criteria (Summary)

- Diagnosing a running service returns a validated 4-field synthesis within ~15 s.
- An endpoint that ignores `json_schema` yields a readable 5xx error, never a logout or malformed 200.
- The web surface renders all four fields with a state-colored badge; per-row results stay independent.
