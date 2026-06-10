# Configure LLM Provider (S-03 / FR-012) — Plan Brief

> Full plan: `context/changes/configure-llm-provider/plan.md`
> Frame brief: `context/changes/configure-llm-provider/frame.md`
> Research: `context/changes/configure-llm-provider/research.md`

## What & Why

S-03 is the **project's first feature with stateful selection**: a list of LLM providers with
exactly one active, whose write path (a) atomically maintains the single-active invariant via a
transaction, (b) verifies the provider with a live test-call — the first outbound HTTP in the api —
before treating it as usable, and (c) stores the key through the existing crypto channel into a
**dedicated** `llm_provider` table. FR-012 requires configuring the provider (endpoint + key)
**without a redeploy** — this matters to a homelabber controlling cost.

## Starting Point

The repo has a mature flat-CRUD pattern (`devices`) and secret-safe storage (`credential` +
`CryptoService` AES-256-GCM). It lacks **two primitives**: the "one active among many" invariant
(zero `.transaction(`, no active column in the repo) and outbound HTTP (no axios/fetch in the api —
the only outbound is SSH). Both are available (drizzle `.transaction()`, Node 24 global `fetch`) but
unused — the plan designs them from scratch on the existing primitives.

## Desired End State

A logged-in user opens `/llm-providers`, adds an OpenAI-compatible provider (endpoint + key +
model); the system tests it with GET `{baseURL}/models` and only persists if it responds — a bad
key/URL/timeout is rejected with a legible error, without creating an entry. The list shows many
providers with an active badge; switching the active one is atomic (always exactly one). The key
never comes back in a response. Configuration changes at runtime — without a redeploy.

## Key Decisions Made

| Decision                          | Choice                                              | Why (1 sentence)                                                            | Source   |
| --------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------- | -------- |
| Storage substrate                 | Dedicated `llm_provider` table (not env, not `credential`) | env = redeploy (breaks FR-012); `credential` is SSH-coupled.       | Research |
| Secret handling                   | Reuse the crypto channel + `strictObject` secret-omission | `CryptoService` is generic; `hasApiKey` derived, key never returned. | Research |
| Cardinality                       | List of many, exactly one `active`                  | User's choice in pre-dispatch narrowing (not single-row).                 | Frame    |
| Single-active invariant           | App-level transaction (unset-all → set-one)         | Full control, simple model; partial-index = over-engineering for single-user. | Plan |
| "Configure" semantics             | Save **+ test-call**, reject-on-fail                | Guarantees the stored provider is usable (user's choice).                 | Frame    |
| Test-call endpoint                | GET `{baseURL}/models` (Bearer)                     | OpenAI-compatible standard, cheap, detects a bad key (401) and a bad URL.  | Plan     |
| Activation edge cases             | Auto-active the first; no active after delete       | Zero-config for the typical single-provider; explicit and predictable.    | Plan     |
| Test-call timeout                 | `registerAs('llm')` + Joi `LLM_TEST_TIMEOUT_MS`     | Repo convention (like `sshConfig`); not a magic-number (tunables lesson).  | Plan     |

## Scope

**In scope:** the `llm_provider` table + migration `0003`; the Zod contract (3 schemas); the CRUD
service + activation transaction + auto-active-first; the test-call probe (GET `/models`) + domain
errors; the `llmConfig` namespace; the web feature (client/store/component/dialog/route).

**Out of scope:** installing `ai`/`@ai-sdk/*` and building the client/agent (S-04); generalizing
`credential`; a partial-unique-index; auto-promotion after deleting the active one; testing real
inference (chat/completion); configuration through `.env`; free-form chat.

## Architecture / Approach

Vertical slice `shared → api → web` with Zod as the single contract. API: a feature module
(`controller` + `service` + `probe` + `errors`), the service holds Drizzle directly (no repository),
the key is encrypted with `CryptoService` into `iv`/`ciphertext`/`authTag` columns. The single-active
invariant = `db.transaction()` unset-all-then-set-one. The test-call = global `fetch` GET `/models` +
`AbortSignal.timeout`, mapped to 502/503/504 (never 401). Web: a `signalState` store +
mutate-then-refetch, an OnPush component + spartan, a dialog with `schemaValidator`.

## Phases at a Glance

| Phase                                  | What it delivers                                              | Key risk                                                    |
| -------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------- |
| 1. Shared contract                     | 3 Zod schemas + secret-omission + barrel                     | secret leak if the response is not `strictObject`           |
| 2. API persistence + single-active     | Table, migration, CRUD service + activation transaction      | the transaction = first use of `.transaction()` in the repo |
| 3. API test-call                       | Probe GET `/models`, domain errors, reject-on-fail           | first outbound HTTP; error mapping (not 401)                |
| 4. Web feature                         | client/store/component/dialog/route                          | active-toggle UX; apiKey blank-keep in edit mode            |

**Prerequisites:** F-02 (auth/authGuard) and F-03 (encrypted-credential-store) — both done (archive).
**Estimated effort:** ~3-4 sessions (one per phase; Phase 2 is the heaviest).

## Open Risks & Assumptions

- Some local OpenAI-compatible servers may not expose `/models` → a test-call false-negative (rare;
  accepted for the MVP — the alternative would be a fallback to completion).
- The app-enforced invariant assumes the service (the transaction) is the only `active` mutation path —
  without a DB constraint, a bug outside that path could break it (mitigation: there is no other write path).
- After deleting the active one the system has no active provider — S-04 must handle this
  ("configure/activate a provider").

## Success Criteria (Summary)

- The user adds/edits/deletes providers and switches the active one without a redeploy; always exactly
  one active (or zero after deleting the active one).
- A bad key/URL/timeout is rejected on save with a legible error — no unvalidated provider lands in the DB.
- The API key never appears in any `/api` response; the UI only sees `hasApiKey: boolean`.
