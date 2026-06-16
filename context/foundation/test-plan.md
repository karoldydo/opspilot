# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-16 (Phase 1 complete; Phase 2 next)

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in <area>"
   carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* — drawn from documents,
   interview, and codebase *signal* (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `apps/api/src`,
`apps/web/src`, `libs/shared/src` (docs, fixtures, archive, dist,
node_modules excluded).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the *evidence that surfaced
this risk* — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| # | Risk (failure scenario)                                                                                                                                                                                                               | Impact | Likelihood | Source (evidence — not anchor)                                                                                                                                          |
|---|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------|------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1 | `diagnoseLogs` agent path: the LLM returns output that does not parse / does not match the synthesis schema, or the run hangs past the < 15 s NFR — the user gets a confident-but-useless synthesis or no result at all               | High   | High       | interview Q1 (top worry), Q4; PRD FR-009 + NFR (< 15 s); hot-spot dirs `diagnose/` (9 commits/30d), `llm-provider/` (7 commits/30d)                                     |
| 2 | SSH executor: a connection is not disposed after a run (leak), or a command exceeds the bounded timeout and the skill run never terminates                                                                                            | High   | High       | interview Q2 (burned before); PRD NFR (no run hangs indefinitely); hot-spot dir `executor/` (6 commits/30d); lessons.md (`docker ps -s` 27 s scan, SSH command timeout) |
| 3 | Agent guardrail: the agent runs a command outside the predefined skill set, or runs a skill on the wrong device because per-device filtering breaks — especially for user-defined custom skills                                       | High   | Medium     | PRD Non-Goal [load-bearing] + FR-008; roadmap S-08 risk; hot-spot dirs `skill/` (6 commits/30d), `service/` (10 commits/30d)                                            |
| 4 | Secret leakage: SSH credentials or the LLM API key reach plaintext — in a log, the audit-log transcript, an error body, or the front-end bundle; the encrypt→store→decrypt round-trip has never been verified against a real database | High   | Medium     | PRD FR-013 + Success Criteria guardrail; interview Q4 (crypto round-trip untested); hot-spot dirs `database/`, `config/`, `auth/`                                       |
| 5 | Auth boundary: an unauthenticated request reaches an operational function because a guard was dropped while wiring a new endpoint or module                                                                                           | High   | Medium     | PRD Access Control + FR-001; hot-spot dir `auth/` (17 commits/30d), file-level wiring churn in `app.module.ts` (19 commits/30d)                                         |
| 6 | SSE live narration silently cuts mid-run through the Cloudflare edge on runs longer than ~100 s (missing heartbeats / `X-Accel-Buffering: no`)                                                                                        | Medium | Medium     | roadmap S-05 risk; infrastructure.md risk register (H/H); PRD FR-010                                                                                                    |

**Impact × Likelihood rubric.** Both axes scored High / Medium / Low for
ordering, not precision. High impact = user loses access/data/security
posture or a load-bearing guardrail fails; High likelihood = already burned
here, or churn-heavy area. Order protects High × High first (#1, #2).

**Abuse / security lens.** opspilot has auth, accepts user input (device
addresses, skill parameters, custom-skill command templates), and stores
SSH/LLM secrets; no payments. The abuse scenarios are #3 (authorization +
command confinement / parameter injection into a shell command),
#4 (secret/PII leakage), and #5 (authentication boundary). Resource-abuse
(login rate-limit bypass) is noted in §7 as out-of-scope under the
small-trusted-group threat model, not padded into the map.

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                                                                          | Must challenge                                                                                                                                                                                           | Context `/10x-research` must ground                                                                                           | Likely cheapest layer                                       | Anti-pattern to avoid                                                                                                                                           |
|------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------|
| #1   | On unparseable / schema-nonconforming LLM output the agent returns a clean, surfaced error (no crash, no hang); on a slow model the timeout fires within its bound and the failure is unambiguous    | "A happy-path test with a mocked LLM means the generation layer is safe"; **oracle problem** — synthesis *content* correctness cannot be asserted deterministically (that is eval territory, not a test) | the LLM call boundary (`generateObject`/timeout), how a schema-validation failure is translated, what timeout governs the run | integration (api) with an injected fake provider            | asserting an expected synthesis copied from the model's own output (tautology); testing "is the AI right" instead of schema-conformance + timeout + clean error |
| #2   | After a run the SSH connection is disposed (no leak); a command exceeding the timeout is aborted with a clean error; the container scan stays within its bounded timeout                             | "HTTP 200 means the connection was cleaned up"; "scan works today so it can never exceed the timeout"                                                                                                    | the connection lifecycle in the executor, where the bounded command timeout lives, how the scan command is built              | integration (api) with a fake/stub SSH boundary             | over-mocking the executor so dispose/timeout never actually fire; a happy-path-only test with no timeout path                                                   |
| #3   | The agent's tool-set on device D equals exactly the skills scoped to D; a skill not scoped to D is never callable; a parameter substitutes as an argument, not as injectable shell                   | "Defaults are filtered, so custom skills must be too" (roadmap S-08 explicitly questions this)                                                                                                           | how the per-device tool-set is assembled, where filtering is enforced, how parameters are interpolated into the command       | integration / contract (api)                                | testing only default skills; skipping the custom-skill path and parameter-injection case                                                                        |
| #4   | A stored credential is ciphertext in its column on disk; the encrypt→store→decrypt round-trip recovers the plaintext; the secret never appears in the audit transcript, a response body, or an error | "A passing unit crypto test means at-rest is safe" — the actually-persisted column and the transcript must be inspected                                                                                  | how/where values are encrypted, what lands in the audit transcript, whether error paths echo the secret                       | integration (api, real / temp DB)                           | testing `encrypt()`/`decrypt()` in isolation only; never inspecting real storage or the transcript                                                              |
| #5   | Every operational endpoint returns 401 without a valid session                                                                                                                                       | "The guard is global, so everything is covered" — a newly added endpoint can miss it                                                                                                                     | where the guard is attached (global vs per-route), which routes are operational                                               | contract / integration (api)                                | testing one endpoint and assuming the rest are covered                                                                                                          |
| #6   | The SSE endpoint emits periodic heartbeats and sets no-buffering headers; a long run's stream stays open                                                                                             | "Works locally so it survives the edge"; "a cut stream means the server also stopped" (it completes server-side)                                                                                         | where SSE/heartbeat headers are set, the heartbeat interval                                                                   | integration (api, assert headers + heartbeat frames) or e2e | a meaningless snapshot; reaching for e2e where an integration test catches the missing header                                                                   |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name                              | Goal (one line)                                                                                                                | Risks covered | Test types                                 | Status        | Change folder                                          |
|---|-----------------------------------------|--------------------------------------------------------------------------------------------------------------------------------|---------------|--------------------------------------------|---------------|--------------------------------------------------------|
| 1 | Agent diagnosis under failure           | Prove `diagnoseLogs` returns a clean error (never crash/hang) on bad LLM output and times out within bound                     | #1            | integration (api, fake LLM)                | complete      | context/archive/2026-06-16-testing-agent-diagnosis-under-failure/ |
| 2 | SSH executor lifecycle + timeout        | Prove connections are disposed after a run and a command/scan aborts within its bounded timeout                                | #2            | integration (api, fake SSH)                | change opened | context/changes/testing-ssh-executor-lifecycle-timeout/ |
| 3 | Security guardrails                     | Prove secrets never reach plaintext/transcript, the agent stays confined to per-device skills (incl. custom), and unauth → 401 | #4, #3, #5    | integration / contract (api, real temp DB) | not started   | —                                                      |
| 4 | diagnoseLogs e2e + SSE through the edge | Prove the full UI→synthesis path renders the 4-field result and SSE narration streams with heartbeats                          | #1, #6        | e2e (Playwright)                           | not started   | —                                                      |

**Status vocabulary** (fixed — parser literals): `not started` →
`change opened` → `researched` → `planned` → `implementing` → `complete`.

Phase order is cost × signal first: the two High × High risks (#1, #2) get
the cheapest integration layer first, each bootstrapping a reusable fake
boundary (fake-LLM, then fake-SSH). Phase 3 clusters the abuse/security
risks at integration level. Phase 4 is the only browser layer — sequenced
last, after the API contracts it exercises are trustworthy, and it
bootstraps Playwright (none exists yet).

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.

| Layer                            | Tool                                               | Version    | Notes                                                                                                                                                        |
|----------------------------------|----------------------------------------------------|------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------|
| unit + integration (api, shared) | Vitest via `@nx/vite`                              | 3.x        | `apps/api/vitest.config.mts`, `libs/shared/vitest.config.mts`; esbuild transform drops DI metadata — inject with explicit `@Inject(...)` tokens (lessons.md) |
| unit (web)                       | `@angular/build:unit-test` (Vitest under the hood) | Angular 21 | driven by the Angular builder, not a `vitest.config.*` file; not picked up by the root `vitest.workspace.ts` glob                                            |
| integration (api boundaries)     | Vitest + in-process Nest test module               | 3.x        | fake LLM / fake SSH injected at the provider boundary; real (temp/in-memory) SQLite for crypto round-trip — none yet, see §3 Phase 1–3                       |
| e2e                              | Playwright                                         | n/a        | none yet — see §3 Phase 4 (`/10x-e2e` is the authoring workflow once bootstrapped)                                                                           |
| accessibility                    | none                                               | n/a        | not in scope for this rollout                                                                                                                                |
| (optional) AI-native             | Playwright MCP — checked: 2026-06-16               | n/a        | available; use only for visual-only SSE/narration risks that a deterministic header/heartbeat assertion cannot catch — not as the default e2e layer          |

**Stack grounding tools (current session):**

- Docs: Context7 + angular-cli MCP + spartan-ng MCP — available; use for current Vitest/Angular/Nest test-setup and Playwright config APIs; checked: 2026-06-16
- Search: Exa.ai — available; use for discovery / current-status checks only, then prefer official docs; checked: 2026-06-16
- Runtime/browser: Playwright MCP — available; possible e2e/verification layer for §3 Phase 4; checked: 2026-06-16
- Provider/platform: Cloudflare MCP + SSH MCP (synology/vps/ha/gmk) — available; relevant for verifying SSE-through-edge behavior (#6) and remote state, not for code anchors; checked: 2026-06-16

Use docs MCPs for current framework/library APIs and setup details. Use
search MCPs for discovery or current status only, then prefer official docs
as the evidence. Do not use MCP docs/search to infer code failure anchors;
those belong in per-phase `/10x-research`.

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required for §3 Phase <N>" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate                                                          | Where                | Required?                 | Catches                                             |
|---------------------------------------------------------------|----------------------|---------------------------|-----------------------------------------------------|
| lint + typecheck (`nx lint`, tsc)                             | local + CI           | required                  | syntactic / type drift, module-boundary violations  |
| module-boundary enforcement (`@nx/enforce-module-boundaries`) | local + CI           | required                  | api ↔ web cross-imports, scope-tag violations       |
| unit + integration (`nx test`)                                | local + CI           | required after §3 Phase 1 | LLM-output, executor, crypto, guardrail regressions |
| e2e on critical flows                                         | CI on PR             | required after §3 Phase 4 | broken UI→synthesis path, SSE narration cut         |
| pre-prod smoke (diagnoseLogs through the live edge)           | between merge + prod | optional                  | edge-specific SSE / timeout failures (#6)           |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase <N>."

### 6.1 Adding a unit test

- **Location**: next to the unit under test (`*.spec.ts`), following the
  existing convention (e.g. `libs/shared/src/lib/schemas/*.schema.spec.ts`,
  `apps/api/src/modules/<domain>/*.service.spec.ts`).
- **Naming**: `<unit>.spec.ts`.
- **Reference test**: `apps/api/src/core/crypto/crypto.service.spec.ts` (api),
  `apps/web/src/app/features/services/data/services.store.spec.ts` (web).
- **Run locally**: `npx nx test api` / `npx nx test shared` / `npx nx test web`
  (single file: `npx nx test api -- <path>`).

### 6.2 Adding an integration test (LLM boundary)

Drives the **real** Vercel AI SDK (`streamObject`) against a fake model, so
the genuine timeout/abort wiring and the SDK's own schema validation are
exercised — not a hand-mocked `streamObject`.

- **Seam**: inject a `MockLanguageModelV3` (from `ai/test`) at the
  `LlmProviderClientFactory.create` boundary (the factory's `create()` just
  hands the fake model back). This drives the **real** `streamObject` against
  the real `diagnosisSynthesisSchema` from `@opspilot/shared`.
- **Hard rule — do NOT `vi.mock('ai')` in this file.** That stub is
  file-scoped; mocking `'ai'` would replace the very `streamObject` under test,
  and the integration test silently degrades to a unit test against a stub.
  Mapper-level cases that *do* want the stub live in the sibling
  `*.service.spec.ts` instead.
- **Canonical example**: `apps/api/src/modules/diagnose/diagnose.service.real-model.spec.ts`.
  Hand-build the service (`new DiagnoseService(...positional mocks...)`, no DI
  graph) and wire the fake model through `mockClientFactory.create`.
- **Timeout knob**: drive the real `AbortSignal.timeout` with a tiny
  `generateTimeoutMs` (~50 ms) on the positional `LlmConfig` (the Joi
  `min(1000)` guards env at boot, not a spec's config object). The fake
  `doStream` must wire its teardown to `options.abortSignal`
  (`abortSignal.addEventListener('abort', () => controller.error(abortSignal.reason))`)
  so the timer doesn't leak past suite end.
- **Schema rejection**: have `doStream` emit `text-delta` parts that finish a
  *non-conformant* object (e.g. `status: "exploded"`, outside the enum); the
  SDK's real validation throws a genuine `NoObjectGeneratedError`, mapped to a
  `synthesis-failed` frame.
- **Oracle boundary**: assert schema-conformance, timeout-within-bound, and a
  clean sanitized error frame (no raw model `.text` leak) — **never** that the
  AI's content is "correct" (§7).
- **Run locally**: `npx nx test api -- src/modules/diagnose/diagnose.service.real-model.spec.ts`.

### 6.3 Adding an integration test (SSH executor boundary)

- TBD — see §3 Phase 2 (defends Risk #2: connection disposal + bounded
  command/scan timeout, via a fake/stub SSH boundary).

### 6.4 Adding a security / guardrail test

- TBD — see §3 Phase 3 (defends Risks #4/#3/#5: secret-at-rest round-trip
  on a real temp DB, per-device skill confinement incl. custom skills,
  unauth → 401).

### 6.5 Adding an e2e test

- TBD — see §3 Phase 4 (Playwright bootstrap; full diagnoseLogs UI→synthesis
  path + SSE narration with heartbeats; authored via `/10x-e2e`).

### 6.6 Per-rollout-phase notes

(Optional. After each phase lands, `/10x-implement` appends a 2–3 line note
here capturing anything surprising the rollout phase taught.)

- **2026-06-16 — Phase 1 (Risk #1), abort surface (resolves research
  open-question #1):** with `ai@6.0.201` + `@ai-sdk/provider@3.0.10`, a fired
  `AbortSignal.timeout` driving the real `streamObject` surfaces **bare** — a
  `DOMException` with `name: 'TimeoutError'`, `NoObjectGeneratedError.isInstance`
  = false, no `.cause`. So the real-abort path hits the bare-name branch of
  `isSynthesisTimeout` (`diagnose.errors.ts`); the `NoObjectGeneratedError`-with-
  `cause` branch is a **defensive guard** against future SDK wrapping, covered by
  the injected cause-unwrap unit test, not by what v6 emits today. Captured via a
  real `MockLanguageModelV3` whose `doStream` errors its stream off
  `options.abortSignal` (`diagnose.service.real-model.spec.ts`).

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **UI snapshot tests for static / marketing pages** — they break constantly
  and catch nothing of value. Re-evaluate only if a static page acquires
  real interactive logic. (Source: Phase 2 interview Q5.)
- **LLM synthesis *content* correctness** — whether the model's assessment is
  factually right is an eval concern, not a deterministic test (oracle
  problem). The rollout asserts schema-conformance, timeout, and clean
  errors instead. Re-evaluate if an eval harness is introduced. (Source:
  Challenger pass on Risk #1.)
- **Login rate-limit / brute-force abuse** — out of scope under the
  small-trusted-group, self-hosted threat model. Re-evaluate if opspilot is
  ever exposed to untrusted users. (Source: abuse-lens review, §2.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-16
- Stack versions last verified: 2026-06-16
- AI-native tool references last verified: 2026-06-16

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
