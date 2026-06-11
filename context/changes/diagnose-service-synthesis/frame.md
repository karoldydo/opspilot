# Frame Brief: Diagnose a service → structured 4-field synthesis (S-04)

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

Implement roadmap slice S-04 (M1 north-star): a user runs a diagnosis on a
managed service; the agent returns a fixed **4-field synthesis**
(`status`, `problems`, `suggestions`, `summary`) via Vercel AI SDK
`generateObject` + a fixed Zod schema, fetching container logs over SSH.
NFR: diagnosis of ~200 log lines returns in **< 15 s**.

## Initial Framing (preserved)

- **User's stated cause or approach**: "Join two halves" — the data-acquisition
  half (SSH/executor from S-02, encrypted provider key from S-03) is already
  shipped; the synthesis half (AI SDK, schema, endpoint) is greenfield. Wire the
  LLM half onto the existing SSH half.
- **User's proposed direction**: new `diagnose` endpoint, synthesis schema in
  `@opspilot/shared`, install `ai`/`@ai-sdk/*` + `createOpenAICompatible`,
  `findActive()` on `LlmProviderService`, (maybe) a run-record table, web surface.
- **Pre-dispatch narrowing**: run-record table is **out of scope** (ephemeral
  response only; persistence deferred to S-09); leading concern is **synthesis
  correctness / shape (the LLM path)**, not the < 15 s NFR; treated as **one
  coherent slice**. Post-dispatch, the user further reported the target LLM
  endpoint is **not yet fixed** — both local engines and commercial
  openai-compatible APIs are in play.

## Dimension Map

The observation ("the structured 4-field synthesis is incorrect / unreliable")
could originate at any of these dimensions:

1. **Provider/model structured-output capability** — `generateObject` +
   `createOpenAICompatible` requires the endpoint to honor schema-enforced JSON.
2. **Schema design (the 4 fields)** — `status` enum literals; `problems`/
   `suggestions` as `string[]` vs richer objects. ← user's stated leading concern
3. **Prompt + input construction** — which logs (tail N, stream merge), how the
   prompt frames the task. Garbage-in → garbage-synthesis.
4. **AI SDK version + Zod v4 compatibility** — project is on Zod v4;
   `generateObject` maps Zod → JSON schema; wrong SDK major breaks the contract.

## Hypothesis Investigation

| Hypothesis                         | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Verdict                     |
|------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------|
| 1. Provider capability gap         | `@ai-sdk/openai-compatible` `openai-compatible-chat-language-model.ts:144` → `supportsStructuredOutputs ?? false`; default path sends only `response_format: { type: 'json_object' }` and **silently drops the schema** (warning, no error, lines 237-291). Zod `safeParse` then throws `NoObjectGeneratedError` after the fact. No tool-calling fallback in object mode. Self-hosted engines (Ollama/LM Studio/vLLM/LocalAI) honor `json_schema` partially or not at all (vercel/ai #5197). | **STRONG**                  |
| 2. Schema design (initial framing) | House conventions fully constrain it: `z.strictObject` (`scan-result.schema.ts:8,21`), enums lowercase/kebab (`health-response.schema.ts:7-8`, `credential.schema.ts:13`, `llm-provider.schema.ts:19`), no `isoTimestamp` for ephemeral results. `status` values + `problems`/`suggestions` shape are open *product* decisions, not a correctness failure point.                                                                                                                             | **WEAK** (as a break point) |
| 3. Input + prompt construction     | Path well-templated by `service.service.ts:27-54` (`scan()` over SSH, PATH-prefix, `mapDockerError`). One gotcha: `docker logs` writes to **stderr** → must merge `stdout+stderr` (`executor.interface.ts:4-8`). Tunables follow the config-layer pattern (`llm.config.ts`, `env.schema.ts`). Mechanical.                                                                                                                                                                                    | **WEAK→MEDIUM**             |
| 4. AI SDK version + Zod v4         | `zod ^4.4.3` (`package.json:59`). **AI SDK v4 is incompatible with Zod v4** (documented hard error, vercel/ai #7291). Must install v5 (stable `generateObject`) or v6 (current — `generateObject` deprecated → `Output.object`, `structuredOutputs` removed → `strictJsonSchema`). Zod-4 patch regressions exist (#10014).                                                                                                                                                                   | **STRONG**                  |

## Narrowing Signals

- **Leading concern is the LLM path, not the < 15 s NFR** (user, Step 1.5) — this
  overrode the research's stated "headline risk" and refocused the whole map.
- **Run-record table out of scope** (user, Step 1.5) — removes the persistence
  dimension entirely; S-04 is ephemeral request/response.
- **Target endpoint not fixed — local + commercial both in play** (user, Step 4) —
  forces "schema-not-enforced" to be a first-class failure mode regardless of
  engine; rules out leaning on any single provider's native `json_schema`.
- **Independent source-level confirmation** (Step 5) — a sub-agent reached the
  `supportsStructuredOutputs ?? false` default unprompted, by reading the SDK
  source, not by being told it was the leading hypothesis.

## Cross-System Convention

This class of observation (unreliable LLM structured output) is normally handled
by explicitly opting into schema-enforced mode and validating endpoint capability
— not by trusting the default. The S-03 archive deliberately deferred the entire
AI SDK layer, so there is **no prior structured-output handling** in this repo to
inherit; the convention to mirror is the existing 5xx domain-error taxonomy
(`executor.errors.ts:16-42`, 502/503/504) for provider/SSH failures.

## Reframed Problem Statement

> **The actual problem to plan around is**: making the 4-field synthesis
> *reliably schema-conformant* against an unknown openai-compatible endpoint —
> by explicitly negotiating/verifying structured-output capability and pinning an
> AI-SDK/Zod-v4-compatible version — not by perfecting the four field
> definitions.

The user's instinct (the LLM path, not the NFR) was correct, but the failure
point sits **above** the schema: with the default factory call the schema is
silently dropped at the wire, so even a perfectly designed 4-field schema yields
unreliable output. If S-04 only nails the field shapes, it ships a feature that
works against OpenAI proper and intermittently produces malformed/unvalidated
output against homelab engines — the exact M1 north-star failing in the field.
Addressing capability negotiation + version pinning is what makes the output
trustworthy; the field definitions are a constrained, second-order decision.

## Confidence

- **HIGH** — strong, source-level evidence for both load-bearing hypotheses (1
  and 4), matched by convention (explicit opt-in + the existing 5xx taxonomy),
  and a decisive narrowing signal (endpoint not fixed → schema-not-enforced must
  be a first-class failure mode). The initial framing ("join two halves") holds
  as the *structure*; the reframe sharpens *where on the LLM half the risk lives*.

## What Changes for /10x-plan

The plan's center of gravity is **structured-output reliability**, not schema
authorship. It must: (a) set/verify `supportsStructuredOutputs` (v5) or
`strictJsonSchema` (v6) and treat schema-not-enforced / `NoObjectGeneratedError`
as a first-class 5xx domain error; (b) pin AI SDK **v5 or v6 — never v4** for
Zod-v4 compat, with a schema smoke test; (c) only then settle the second-order
shape decisions (`status` enum literals, `problems`/`suggestions` shape) within
house conventions. Run-record persistence and the < 15 s NFR are *not* the
headline — the NFR is config-layer tunables (separate generate-timeout + tighter
logs-fetch bound + tail count), and run-records are deferred to S-09.

## References

- Source files: `apps/api/src/llm-provider/llm-provider.service.ts:108-116`,
  `apps/api/src/executor/executor.interface.ts:4-16`,
  `apps/api/src/service/service.service.ts:27-54`,
  `apps/api/src/config/env.schema.ts:40`, `package.json:59`,
  `libs/shared/src/lib/schemas/scan-result.schema.ts:8-25`,
  `libs/shared/src/lib/schemas/health-response.schema.ts:7-8`
- External: `@ai-sdk/openai-compatible` `openai-compatible-chat-language-model.ts:144,237-291`;
  vercel/ai issues #5197, #7291, #10014; AI SDK v4 Zod-v4 troubleshooting; AI SDK 5/6 migration guide
- Related research: `context/changes/diagnose-service-synthesis/research.md`
- Investigation: 3 parallel hypothesis agents (provider+version, schema shape, input/prompt path) + 1 cross-check
