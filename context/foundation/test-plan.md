# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-25 (Phase 1–4 complete)

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
| 2 | SSH executor lifecycle + timeout        | Prove connections are disposed after a run and a command/scan aborts within its bounded timeout                                | #2            | integration (api, fake SSH)                | complete      | context/changes/testing-ssh-executor-lifecycle-timeout/ |
| 3 | Security guardrails                     | Prove secrets never reach plaintext/transcript, the agent stays confined to per-device skills (incl. custom), and unauth → 401 | #4, #3, #5    | integration / contract (api, real temp DB) | complete      | context/changes/testing-security-guardrails/           |
| 4 | diagnoseLogs e2e + SSE through the edge | Prove the full UI→synthesis path renders the 4-field result and SSE narration streams with heartbeats                          | #1, #6        | e2e (Playwright)                           | complete      | context/changes/testing-diagnose-e2e/                  |

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

Defends Risk #2: the SSH connection is disposed after **every** run (no leak)
and a command/scan that exceeds its bounded timeout aborts with a clean
504-mapped error — never a hang. There are **two seams**; pick by which layer
you are pinning.

- **Executor-internal seam (lifecycle + timeout)**: fake the node-ssh client at
  the `SSH_CLIENT_FACTORY` token — the factory just hands the fake `NodeSSH`
  back. This drives the **real** executor (`connect` → `execCommand` →
  `finally` dispose, plus the hand-rolled `setTimeout` + `Promise.race` timer).
  - **Hard rule — never `vi.mock('node-ssh')`.** That stub is file-scoped and
    would replace the very transport whose disposal/timeout wiring is under
    test, silently degrading the integration test to a unit test against a stub.
  - **Canonical example**: `apps/api/src/integrations/executor/ssh.executor.spec.ts`.
    Hand-build via `buildExecutor({ client, commandTimeoutMs })` (positional
    `new SshExecutor(...)`, no DI graph) and pass a minimal `FakeClient`
    (`connect`/`dispose`/`execCommand` as `vi.fn()`).
  - **Timeout knob — no fake timers.** Use a **tiny real** `commandTimeoutMs`
    (~20 ms) against a never-resolving `execCommand`
    (`vi.fn().mockImplementation(() => new Promise(() => undefined))`); the race
    rejects via the real timer with `SshCommandTimeoutError`. A per-call third
    arg to `execute(...)` overrides the configured default.
  - **Dispose matrix to pin**: success, connect-reject, command-timeout, and
    `execCommand`-reject all flow through `finally` → `dispose` (assert
    `client.dispose` called once); and a `dispose` that itself throws must
    **not** mask the original mapped connect error.
- **Consumer seam (scan boundary the user hits)**: fake the executor at the
  `EXECUTOR` token via `.overrideProvider(EXECUTOR).useValue(mockExecutor)` on
  the real temp-SQLite `TestingModule`. Here the executor is a mock, so the test
  asserts **clean propagation**, not the timer: a rejected
  `SshCommandTimeoutError` surfaces as the same 504 and writes **no** audit row
  (matching the docker-error failure path).
  - **Canonical example**: `apps/api/src/modules/service/service.service.spec.ts`
    (`surfaces a timed-out executor as a clean 504 and writes no audit row`).
  - Also lock `SCAN_COMMAND` against the `lessons.md` slow-form regression with a
    **negative** content assertion (no `-s` / `--size` / `{{json .}}`, does
    contain `{{json .Names}}`) — distinct from the full-string
    `toHaveBeenCalledWith`, which would move in lockstep with any regression.
- **Run locally**:
  - `npx nx test api -- src/integrations/executor/ssh.executor.spec.ts`
  - `npx nx test api -- src/modules/service/service.service.spec.ts`

### 6.4 Adding a security / guardrail test

Defends Risks #4 (secret leakage), #3 (per-device skill confinement +
parameter injection), and #5 (auth boundary). Three distinct patterns —
pick by which guardrail you are pinning. All three run on a **real temp
SQLite DB** (no mock persistence), so secrets and scope filters are
exercised against actual storage.

- **(a) Secret-at-rest round-trip (Risk #4)** — prove a stored secret is
  ciphertext in its column on disk, the audit transcript / read contract is
  secret-free, and the `encrypt → store → decrypt` round-trip recovers the
  plaintext. Boot a `TestingModule` against a temp-file DB
  (`tmpdir()` path + `databaseConfig.KEY`/`cryptoConfig.KEY` overrides, fixed
  key `AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=`, `-wal`/`-shm` teardown).
  Four assertions per secret: (1) the read/response contract carries no
  secret field, (2) the audit transcript row is secret-free, (3) the
  on-disk column is ciphertext (not the plaintext), (4) `getDecrypted*`
  round-trips back to the plaintext.
  - **Canonical examples**: `apps/api/src/core/credential/credential.service.spec.ts`
    (credential; response-body safety at `apps/api/src/modules/device/device.controller.spec.ts`),
    `apps/api/src/modules/llm-provider/llm-provider.service.spec.ts` (LLM API key).
  - Run: `npx nx test api -- src/core/credential/credential.service.spec.ts`
    and `npx nx test api -- src/modules/llm-provider/llm-provider.service.spec.ts`.
- **(b) Per-device skill confinement + parameter injection (Risk #3)** —
  prove a skill not scoped to device D is never callable on D (incl.
  user-defined custom skills), and a skill parameter substitutes as an
  *argument*, not as injectable shell.
  - **Confinement**: `requireInScope` → **404** for an out-of-scope /
    forged / cross-device id, over real HTTP and at the service layer. The
    custom-skill-scoped-to-another-device → 404 case is the S-08 proof
    (`skill-run.controller.spec.ts`).
  - **Injection**: assert the **charset whitelist rejects** a tainted value
    (shell metacharacters → **400** at the wire / `ZodError` at the service),
    and **no command runs** — *not* that the value is shell-quoted. The guard
    is on the substituted parameter *value*, not the operator-authored
    `commandTemplate` (see §7 author-trust exclusion).
  - **Canonical examples**: `apps/api/src/modules/skill/skill-run.controller.spec.ts`
    (custom-skill 404, shell-metacharacter 400), `apps/api/src/modules/skill/skill-run.service.spec.ts`
    (tainted value → ZodError, out-of-scope/forged → 404), `apps/api/src/modules/skill/skill.service.spec.ts`
    (`findForDevice` scope filter = global + that device only).
  - Run: `npx nx test api -- src/modules/skill/skill-run.controller.spec.ts`
    and `npx nx test api -- src/modules/skill/skill-run.service.spec.ts`.
- **(c) Wire-level auth boundary (Risk #5)** — prove every operational
  endpoint returns **401** without a valid session, the public health route
  returns 200, and the `@Public()` allowlist is exactly
  `{ AuthController, HealthController }` so a stray `@Public()` fails the
  suite. Boot the **real** `AppModule` (the only way to get the production
  `APP_GUARD` + the real route list), override `AUTH_INSTANCE` with a fake
  `getSession` and `databaseConfig.KEY`/`cryptoConfig.KEY` with a temp DB,
  then `app.setGlobalPrefix('api')` + `app.init()`. Two describe blocks off
  one boot:
  - **401 sweep**: `getSession` → `null`, supertest one representative route
    per operational module; each `.expect(401)` and asserts the canonical
    envelope `{ message: 'valid session required', status: 401, timestamp: expect.any(String) }`.
    `GET /api/health` → 200 (public control). Then flip `getSession` to a
    session object and assert one previously-401 route no longer 401s
    (positive control — guards against a blanket-401 tautology).
  - **`@Public` sweep**: resolve `DiscoveryService` + `MetadataScanner` +
    `Reflector` from the booted context, enumerate every controller +
    handler, collect those where `IS_PUBLIC_KEY` is truthy, and assert the
    set of owning controller classes equals exactly
    `{ AuthController, HealthController }`.
  - **Hard rule — do NOT stand in a fake-session middleware** as the
    `*.controller.spec.ts` files do; that strips the real guard and the test
    silently degrades to asserting nothing. Boot the real `AppModule`.
  - **Canonical example**: `apps/api/src/core/auth/auth.boundary.spec.ts`.
  - Run: `npx nx test api -- src/core/auth/auth.boundary.spec.ts`.

### 6.5 Adding an e2e test

Browser-level coverage with Playwright. Authored via `/10x-e2e` — one reviewed,
deliberate-break-verified test per risk, never a per-page sweep.

- **Location**: one test per file in `tests/e2e/specs/<feature>.spec.ts`; shared
  fixtures (db seeds) in `tests/e2e/helpers/` (outside the `./specs` testDir so they
  are never collected as tests). Each spec carries a provenance header naming the
  `test-plan.md` risk it protects.
- **Auth**: never log in through the UI. `specs/auth.setup.ts` signs up a unique
  user (`e2e+${Date.now()}@…`) and persists `storageState`; the `chromium` project
  starts already authenticated. Hit the api with the authenticated `page.request` /
  `request` fixtures.
- **Locators + waits**: `getByRole` / `getByText` only (no CSS/XPath); web-first
  assertions (`toBeVisible`, `toBeEnabled`, `toHaveText`) — never `waitForTimeout`.
  Unique timestamp-suffixed data; clean up in `afterEach` (delete the device → FK
  cascade removes its services + runs).
- **Hard rule — the live diagnose stream cannot be driven deterministically.** The
  SSE stream runs SSH + the LLM **server-side**; `page.route()` cannot intercept a
  server-side call, and `NODE_ENV=test` does **not** swap in fakes (no test seam in
  the running app). So a live UI→synthesis run needs real SSH + a reachable LLM —
  neither deterministic. Two feasible patterns cover Risk #1 instead (both keep auth,
  routing, the real `/api`, and the real db unmocked):
  - **(a) Clean-error / no-hang facet** — create a device + service over the api
    (neither tests SSH/docker on create), open service-detail, click **re-run** with
    **no active llm provider**: `narrate()` rejects 409 in pre-flight, the native
    `EventSource` fires `onerror`, and the store must surface a clean error
    (`could not diagnose service`) and re-enable the button (no infinite spinner).
    Proves the "no result → clean error, never hang" half of Risk #1.
    **Canonical example**: `tests/e2e/specs/diagnosis-clean-error.spec.ts`.
  - **(b) Saved-run 4-field render facet** — api-create device + service, then seed a
    completed `run_record` row directly (there is **no api endpoint** to create a run
    — runs are only persisted by the live stream). On entry `loadRuns()` seeds the
    result card; assert all four synthesis fields reach the screen. `problems` /
    `suggestions` render only in the card (so they pin it); `status` / `summary` also
    appear elsewhere on the page, so `.first()` is enough.
    **Canonical examples**: `tests/e2e/specs/diagnosis-synthesis-renders.spec.ts`,
    `tests/e2e/helpers/seed-run-record.ts` (a `better-sqlite3` insert against the e2e
    db; opens a second wal connection with `busy_timeout`).
  - **(c) Run-history replay facet** — api-create device + service, then seed **≥2** completed
    `run_record` rows with distinct `created_at` + `status`. on entry the newest run owns the
    card and each run renders one `getByRole('button')` replay chip whose accessible name
    carries the run's `status`, so seeding distinct statuses makes each chip uniquely locatable
    without leaning on the brittle `date:'short'` string. clicking an older chip swaps the
    synthesis card **statically** and opens **no** live stream — proven belt-and-suspenders by
    the `agent run · idle` header + enabled re-run button (dom) and a negative
    `**/diagnose/stream` network assertion. the multi-run extension of facet (b): replay is a
    static history view, not a re-run.
    **Canonical example**: `tests/e2e/specs/diagnosis-run-history-replay.spec.ts`.
  - **UI pagination is NOT e2e.** `diagnosis.client.ts` `recentRuns()` calls
    `GET /diagnose/runs` with **no** `limit`/`offset` params — the UI never paginates — so the
    0–100 slicing is an api/integration concern (`diagnose.controller.spec.ts`), never a
    browser interaction.
- **Risk #6 (SSE heartbeat / `X-Accel-Buffering: no` through the edge) is NOT e2e.**
  Its protection is a response-header + `ping`-frame contract, caught deterministically
  at integration (`diagnose.controller.spec.ts` parses `event: ping`;
  `diagnose.service.spec.ts` "emits a keep-alive ping frame on the ~30s heartbeat").
  Reaching for e2e here is the §2 anti-pattern — and the real edge reap (>100 s through
  Cloudflare) is not reproducible in a local Playwright run.
- **Run locally** (the `webServer` block boots both apps; the api binds an isolated
  `./data/opspilot.e2e.db` and **does not reuse** a dev api on `:3000` — free that
  port first):
  - all e2e: `npm run e2e` (`nx e2e e2e`)
  - one spec: `npx nx e2e e2e -- specs/diagnosis-clean-error.spec.ts`
  - report: `npm run e2e:report`

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
- **2026-06-16 — Phase 2 (Risk #2), executor already defended structurally:**
  research found the executor disposes in an unconditional `finally` and bounds
  the command timeout with a `setTimeout` + `Promise.race` rejecting a clean
  `SshCommandTimeoutError` (504), so this phase built **no** new seam — it
  extended the existing specs to close residual gaps: completed the dispose
  matrix (`execCommand`-reject + dispose-doesn't-mask-original) in
  `ssh.executor.spec.ts`, added the consumer-boundary 504-propagation +
  `SCAN_COMMAND` regression guard in `service.service.spec.ts`. The
  truncated-line parse fragility is pinned as current behavior, not fixed —
  hardening deferred (see §7 and `change.md`).
- **2026-06-21 — Phase 3 (Risks #4/#3/#5), guardrails already protected
  structurally:** research + a direct spec audit found #4 (secret leakage)
  and #3 (per-device skill confinement incl. custom skills + parameter
  injection) **already fully covered** — secrets prove ciphertext-on-disk +
  secret-free transcript + round-trip (`credential.service.spec.ts`,
  `llm-provider.service.spec.ts`), and confinement proves `requireInScope`
  → 404 incl. the custom-skill S-08 case + charset-whitelist rejection
  (`skill-run.controller.spec.ts`, `skill-run.service.spec.ts`). The single
  genuine gap was #5: every controller spec strips the global guard, so
  **no test asserted unauth → 401 over the wire**. The phase closed only
  that gap with `auth.boundary.spec.ts` — booting the real `AppModule` for a
  supertest 401 sweep across operational modules (+ public-route control +
  positive-session control) plus a `DiscoveryService` `@Public` metadata
  sweep that pins the allowlist to `{ AuthController, HealthController }`.
  The author-trust / `commandTemplate` exclusion is recorded in §7.
- **2026-06-25 — Phase 4 (Risks #1/#6), deterministic e2e ceiling reached:** Playwright was
  bootstrapped earlier; this phase added the final deterministic browser facet for Risk #1 —
  run-history **replay** (`diagnosis-run-history-replay.spec.ts`), proving a saved-run chip
  click swaps the synthesis card with **no** new `/diagnose/stream` (dom `idle`/enabled +
  negative network assertion). with facets (a) clean-error and (b) saved-run render already
  shipped (`9804435`), the deterministic e2e backlog is complete. The live UI→synthesis happy
  path stays **out of scope** pending an app-side test seam (no fake-LLM/fake-SSH swap;
  `page.route()` cannot intercept the server-side SSE), and Risk #6 stays integration-only per
  §6.5.

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
- **SSH connect-timeout (`readyTimeout`) wall-clock behavior** — this is
  node-ssh's own option, passed straight through on `connect`; a test would
  mostly assert node-ssh honors its own config and would lean on real
  wall-clock delays (flaky). The executor's *command* timeout (our hand-rolled
  `setTimeout` + `Promise.race`) is the part we own and it **is** pinned.
  Re-evaluate if we ever wrap or override `readyTimeout` ourselves rather than
  passing it through. (Source: Phase 2 research gap a.)
- **Truncated-line NDJSON parse hardening** — `parseContainer` uses strict
  `JSON.parse` + `z.strictObject` with no per-line try/catch, so one partial
  line (as a timeout-killed `docker ps` can emit) fails the **whole** scan.
  Current behavior is *pinned* by a characterization test
  (`service.service.spec.ts`, "fails the whole scan on a truncated NDJSON
  line"); the fix (per-line skip, keep valid containers) is deferred to a
  separate implementation change so a testing phase does not smuggle a behavior
  change. Re-evaluate when that follow-up change is opened (flagged in
  `change.md`). (Source: Phase 2 research gap d.)
- **Malicious skill-author / `commandTemplate` injection** — parameter
  injection is guarded on the substituted parameter *values* (charset
  whitelist), not on the operator-authored `commandTemplate`. An operator
  who can author a skill is trusted under the small-trusted-group,
  self-hosted threat model — blocking shell in a template would be a
  behavior change, not a test. Consistent with host-key TOFU and the login
  rate-limit exclusion. Re-evaluate if skill authoring is ever exposed to
  untrusted users. (Source: Phase 3 planning.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-16
- Stack versions last verified: 2026-06-16
- AI-native tool references last verified: 2026-06-16

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
