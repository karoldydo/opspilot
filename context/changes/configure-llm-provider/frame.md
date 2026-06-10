# Frame Brief: Configure LLM provider (S-03 / FR-012)

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

Build the `configure-llm-provider` feature (slice S-03, FR-012): the user
configures their own LLM provider endpoint + credentials **without a redeploy**.
Agreed scope: the feature itself (persistence + contract + CRUD + UI), focused on
four areas — (1) reuse of F-03 secrets, (2) the devices/services feature pattern
as a template, (3) the config/env layer, (4) the shape of the provider contract.

## Initial Framing (preserved)

- **User's stated cause or approach**: Four coordinate areas treated as
  equivalent — in particular (a) the "config/env layer" as the likely home of
  provider configuration, and (b) "secret reuse" suggesting reuse of the existing
  `credential` table/service for the API key. The slice was implicitly conceived
  as a CRUD clone of `devices`.
- **User's proposed direction**: Build the feature by reusing existing patterns
  (the devices/services template, the encrypted-credential-store for the key, the
  config/env layer for provider settings).
- **Pre-dispatch narrowing** (Step 1.5, user's answers):
  - **Cardinality** → "Many providers, one active" (list + active toggle; NOT a
    single-row).
  - **"Configure" semantics** → "Save + test-call" (on save, a lightweight request
    to the endpoint to detect a bad key/URL — requires an HTTP client already in S-03).
  - **Config/env (#3)** → "It was one of the angles" (accepting the research finding:
    provider configuration itself does NOT belong there; no declared tunables).

## Dimension Map

The observation "configure a provider without a redeploy" could have originated in
any of these dimensions:

1. **Storage substrate** — env/config vs a DB entity. The framing allowed config/env
   as the home of configuration.
2. **Secret handling** — reuse the `credential` table vs reuse only the crypto channel
   + a new table. ← part of the initial framing ("secret reuse")
3. **Cardinality / active invariant** — single-row upsert vs a list of many with exactly
   one `active`, maintained atomically.
4. **"Configure" semantics** — blind save vs verifying the endpoint/key with a live
   test-call (decides whether S-03 introduces outbound HTTP).
5. **Contract shape** — secret-omission (`z.strictObject`) + a derived `hasApiKey` flag;
   the key is never returned.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| Dim 1 — the provider belongs to the env/config layer | FR-012 "without a redeploy" (`prd.md:102-103`) rules out `.env` (edit + restart = redeploy). Config is only appropriate for non-secret defaults. User: config/env "one of the angles", no tunables. | NONE (framing rejected — it must be a DB entity) |
| Dim 2 — the API key drops into the `credential` table | `CryptoService` is generic, reusable 1:1 (`crypto.service.ts:36-47`). But `credential` is SSH-coupled: required `deviceId` FK, `username`, `authType` enum (`device.schema.ts:19-46`); list/remove keyed by `deviceId`. | NONE (reuse only the crypto channel; a new `llm_provider` table) |
| **Dim 3 — "one active among many" has an existing template** | **ABSENT**: no active/default/enabled column in the schemas (only `emailVerified`, a different purpose); zero `.transaction(` in `apps/api/src`; no partial-unique-index; devices/services/credential are flat lists. The transaction primitive (better-sqlite3 v12 + drizzle v0.45) is **available, unused** (`database-connection.provider.ts`). | STRONG (the mechanism is NEW to the project — no template) |
| **Dim 4 — the test-call has an existing HTTP primitive** | **ABSENT**: no axios/undici/@nestjs/axios/ai/@ai-sdk in `package.json`; zero `fetch(`/HTTP in `apps/api/src` (the only outbound = SSH via node-ssh). BUT Node 24 → global `fetch` (no new dependency); the error-wrapping pattern (`executor.errors.ts`, `ssh.executor.ts:105-112`) and timeout pattern (`AbortSignal.timeout` / Promise.race `ssh.executor.ts:58-64`) are ready to mirror. | STRONG (the first outbound HTTP — real, but a small extension) |
| Dim 5 — secret-omission + `hasApiKey` | The `z.strictObject` convention throwing on a leak (`credential.schema.ts:11-19`, tests `:47-73`); plaintext only inbound (`credential-create-request.schema.ts:4-12`). | STRONG (settled — copy the pattern) |

## Narrowing Signals

The decisive observations that narrowed the hypothesis space:

- The user chose **"many, one active"** → Dim 3 stops being theoretical; it becomes
  the central, template-less mechanism of the slice (a set-active-unset-others
  transaction + an `active` flag).
- The user chose **"save + test-call"** → Dim 4 enters S-03 scope; it introduces the
  first outbound HTTP in the api (and with it new domain errors "provider unreachable /
  bad key" and a timeout).
- The user confirmed **config/env as an "angle"** → Dim 1 is closed, the config layer
  is untouched (unless a non-secret tunable appears, e.g. a test-call timeout — then
  `registerAs('llm', ...)` per the tunables lesson).

## Cross-System Convention

The class "configurable external integration with a secret" is handled in OpsPilot by
the `shared → api → web` pattern with Zod as the single contract, the secret through the
`CryptoService` channel (AES-256-GCM, `iv`/`ciphertext`/`authTag`/`keyVersion` columns),
secret-omission in the response. The leading hypothesis (a DB-backed entity in the
`devices` style + a new table + the crypto channel) **matches the convention 100%**.
However, two new mechanisms — the "one active" invariant (a transaction) and the
outbound test-call HTTP — **have no precedent** in any archive or existing module; the
plan must design them from scratch on the available primitives (drizzle `.transaction()`,
global `fetch`, the `executor.errors.ts` pattern).

## Reframed Problem Statement

> **The actual problem to plan around is**: S-03 is not another flat CRUD clone of
> `devices` — it is the **project's first feature with stateful selection**: a list of
> LLM providers with exactly one active, whose write path must (a) atomically maintain
> the single-active invariant via a transaction (no template in the repo), (b) verify
> the provider with a live test-call — the first outbound HTTP in the api — before
> treating it as usable, and (c) store the key through the existing crypto channel into
> a **dedicated** `llm_provider` table (not `credential`, never env/config).

The center of gravity of the problem has shifted from dimensions 1–2 (substrate /
secret — settled by research, well-templated) to dimensions 3–4 (cardinality with an
invariant + validation semantics), which are **net-new and template-less**. If the plan
were organized around "clone devices", the hard parts (the active transaction + the
test-call) would be treated as footnotes — yet they carry the entire risk of this slice.
The plan should be built around these two mechanisms, not around the CRUD scaffolding.

## Confidence

**HIGH** — strong file:line evidence both ways (the Dim 1–2 reframe confirmed; Dim 3–4
verified by two independent agents), decisive user answers, the convention checked (no
existing active/HTTP pattern → the mechanisms are genuinely new). No open verification
step before the plan.

## What Changes for /10x-plan

The plan is about **two new mechanisms**, not CRUD scaffolding:
(1) the "one active among many" invariant — a schema with `active`, an activation
endpoint, a set-active-unset-others transaction (+ a decision: DB-enforced partial-index
invariant vs app-enforced); (2) the provider test-call on create/update — global `fetch`
+ `AbortSignal.timeout`, new domain errors à la `executor.errors.ts`, an optional
`registerAs('llm', ...)` for the test-call timeout. CRUD/contract/secret/UI take the
ready `devices` template + secret-omission from research (file checklist there).
Resource model: a list (not single-row) with `name` + `active`; the response contract
adds `active: z.boolean()` alongside `hasApiKey`.

## References

- Source files: `apps/api/src/crypto/crypto.service.ts:36-47`,
  `apps/api/src/credential/credential.service.ts:22-100`,
  `apps/api/src/database/schema/device.schema.ts:19-46`,
  `apps/api/src/database/providers/database-connection.provider.ts`,
  `apps/api/src/executor/ssh.executor.ts:58-64,105-112`,
  `apps/api/src/executor/executor.errors.ts`,
  `libs/shared/src/lib/schemas/credential.schema.ts:11-19`,
  `context/foundation/prd.md:102-103`, `context/foundation/roadmap.md:151-161`
- Related research: `context/changes/configure-llm-provider/research.md` (full file
  checklist + proposed contract — still current for CRUD/secret/UI)
- Investigation: 2 parallel Explore agents — "active-among-many pattern"
  (verdict ABSENT) and "outbound HTTP test-call capability" (verdict ABSENT,
  trivial via global fetch)
