---
date: 2026-06-25T12:29:18+0200
researcher: Karol Dydo
git_commit: 98044352a1fbebef25e6f434243e36d032c989b3
branch: main
repository: opspilot
topic: "Full diagnose E2E audit — classify risks #1–#6 by test level and recommend the remaining E2E backlog"
tags: [research, codebase, diagnose, e2e, playwright, sse, test-plan]
status: complete
last_updated: 2026-06-25
last_updated_by: Karol Dydo
---

# Research: Full diagnose E2E audit (#1–#6)

**Date**: 2026-06-25T12:29:18+0200
**Researcher**: Karol Dydo
**Git Commit**: 98044352a1fbebef25e6f434243e36d032c989b3
**Branch**: main
**Repository**: opspilot

## Research Question

For the `testing-diagnose-e2e` change: audit the entire diagnose feature against the
test-plan risk map (#1–#6), classify each risk by the test level that genuinely fits it,
and recommend the full remaining E2E (Playwright) spec backlog with priorities.
Depth: overview map.

## Summary

**The deterministic diagnose E2E backlog is essentially complete.** Phase 4 of the test
plan nominally assigns risks **#1** and **#6** to Playwright, but only **#1** is genuinely
a browser-layer risk — and both of its feasible facets already ship as of commit `9804435`:

- `tests/e2e/specs/diagnosis-synthesis-renders.spec.ts` — saved-run 4-field render (seed `run_record`).
- `tests/e2e/specs/diagnosis-clean-error.spec.ts` — clean error + button re-enable when no LLM provider.

Risks **#2–#5** are integration/contract-only by the test plan's own "cheapest layer"
guidance and are already covered in Phases 1–3. Risk **#6** (SSE cut through the Cloudflare
edge) is **explicitly de-scoped from E2E** by the cookbook (§6.5) — its protection is a
response-header + `:ping`-frame contract owned by integration tests; reaching for E2E there
is the §2 anti-pattern, and the real >100 s edge reap is not reproducible in a local
Playwright run.

**The one genuine gap** is the **live UI→synthesis happy path** (a real streamed run that
fills the synthesis card progressively). It is currently **blocked**: the SSE stream runs
SSH + LLM **server-side**, with no test seam in the running app. There is a technical path
to cover it (`page.route()` interception of the browser's EventSource request, emitting a
fake SSE body), but it is **in direct tension with the cookbook's "keep internal boundaries
real, mock only external" rule** — the diagnose stream endpoint is an internal boundary.
**This is the central decision the plan must make** (see Open Questions).

Net recommendation: there is **no straightforward next E2E spec to queue today** without
either an app-side test seam or an explicit decision to relax the "internal boundaries stay
real" rule for the SSE endpoint.

## Detailed Findings

### Risk-by-risk classification

Risk definitions: `context/foundation/test-plan.md:44-49` (§2 risk map). Response guidance:
`test-plan.md:66-73`. Phase 4 row: `test-plan.md:86`.

| # | Failure scenario (one line) | Best level | E2E status |
|---|------------------------------|------------|-----------|
| 1 | LLM output unparseable / run hangs >15 s NFR → useless or no synthesis | **Split**: schema/timeout = integration; render + clean-error = **E2E** | ✅ both facets shipped |
| 2 | SSH executor connection leak / command-timeout hang → run never terminates | **Integration** (fake `NodeSSH` at `SSH_CLIENT_FACTORY`) — not E2E | covered (Phase 2) |
| 3 | Agent runs skill outside set / on wrong device; param injects as shell | **Integration/contract** (`requireInScope` 404, charset 400) — not E2E | covered (Phase 3) |
| 4 | SSH/LLM secret reaches plaintext log/transcript/error/bundle | **Integration** vs real temp DB (inspect ciphertext column) — not E2E | covered (Phase 3) |
| 5 | Unauthenticated request reaches an operational function | **Contract/integration** (supertest 401 sweep + `@Public` allowlist) — not E2E | covered (Phase 3) |
| 6 | SSE narration cuts mid-run through Cloudflare edge (>~100 s, missing heartbeats) | **Integration** (assert headers + `:ping` frames) — **explicitly NOT E2E** | covered at integration |

Key nuance on **#1**: the *core* protection (schema conformance, timeout-within-bound, clean
sanitized error) is integration with an injected fake provider (`test-plan.md:68`). The
*UI-facing* facets (does the browser render the result; does the UI surface a clean error vs
an infinite spinner) are genuine E2E — both already exist.

Key nuance on **#6**: although Phase 4's *title* names #6, §6.5 categorically overrides:
"**Risk #6 … is NOT e2e**" (`test-plan.md:338-343`). The browser layer does not own it.

### Phase 4 scope (quoted)

`test-plan.md:86`:
> | 4 | diagnoseLogs e2e + SSE through the edge | Prove the full UI→synthesis path renders the 4-field result and SSE narration streams with heartbeats | #1, #6 | e2e (Playwright) | not started | — |

`test-plan.md:94-96`:
> "Phase 4 is the only browser layer — sequenced last, after the API contracts it exercises
> are trustworthy, and it bootstraps Playwright (none exists yet)."

The §6.5 cookbook then demotes #6 out of E2E, leaving **#1 as the only browser-owned risk**.

### Cookbook guidance (quoted, §6.5 `test-plan.md:299-349`)

> "**Hard rule — the live diagnose stream cannot be driven deterministically.** The SSE
> stream runs SSH + the LLM **server-side**; `page.route()` cannot intercept a server-side
> call, and `NODE_ENV=test` does **not** swap in fakes (no test seam in the running app)."
> (`test-plan.md:320-321`)

> "(a) **Clean-error / no-hang facet** … click **re-run** with **no active llm provider**:
> `narrate()` rejects 409 in pre-flight, the native `EventSource` fires `onerror`, and the
> store must surface a clean error (`could not diagnose service`) and re-enable the button …
> **Canonical example**: `tests/e2e/specs/diagnosis-clean-error.spec.ts`." (`test-plan.md:322-328`)

> "(b) **Saved-run 4-field render facet** — api-create device + service, then seed a
> completed `run_record` row directly (there is **no api endpoint** to create a run …) …
> assert all four synthesis fields reach the screen … **Canonical examples**:
> `tests/e2e/specs/diagnosis-synthesis-renders.spec.ts`, `tests/e2e/helpers/seed-run-record.ts`."
> (`test-plan.md:329-337`)

> "**Risk #6 … is NOT e2e.** Its protection is a response-header + `ping`-frame contract,
> caught deterministically at integration … Reaching for e2e here is the §2 anti-pattern."
> (`test-plan.md:338-343`)

### Diagnose feature seams (what E2E can observe)

**API endpoints** (`apps/api/src/modules/diagnose/diagnose.controller.ts`):
- `GET …/diagnose/runs` — replay list, `limit` capped 0–100, `offset` uncapped; returns
  `RunRecord[]` parsed via `runRecordSchema` (`controller.ts:22-33`).
- `@Sse …/diagnose/stream` — live narration; pre-flight checks run **before** the observable
  is returned and surface as HTTP status: 404 missing/wrong-device service, 404 missing
  device, **409 no active LLM provider** (`controller.ts:40-47`, `diagnose.service.ts` narrate).

**SSE event union** (`libs/shared/.../run-narration-event.schema.ts`): `step`, `progress`
(heartbeat dead-air filler, `LLM_NARRATION_TICK_MS`), `delta` (`diagnosisSynthesisSchema.partial()`),
`done` (`{ run: RunRecord }`, terminal), `error` (`{ code, message }`, terminal; codes
`logs-timeout` / `timeout` / `synthesis-failed` / `upstream-unavailable` from
`diagnose.errors.ts:30-42`). A `:ping` keep-alive fires every 30 s
(`HEARTBEAT_INTERVAL_MS = 30_000`, `diagnose.service.ts:19,103`) and is invisible to
`onmessage` — this is the #6 contract, asserted at integration.

**Web store transitions** (`apps/web/.../data/diagnosis.store.ts`): per-service entry with
`{ error, loading, partial, progress, result, runs, steps }`. idle → `loading:true` →
step/progress/delta frames → `done` (sets `result`, prepends to `runs`, re-enables button)
**or** `error` (sets `error`, clears spinner). Transport failure mid-stream sets
`error: 'could not diagnose service'`. The render `view()` falls back
`result ?? partial ?? latestRun()?.synthesis ?? null`, so the page shows the last saved run
on load with no auto-stream.

**DOM/ARIA seams a Playwright locator can target**:
- Error: `role="alert"` with text `could not diagnose service` (service-detail terminal panel).
- Re-run button: `getByRole('button', { name: 're-run' })`, `[disabled]` while loading.
- Synthesis card (`synthesis-card.component.ts:46-85`): status badge, summary, problems grid
  (`[x]` / "none detected."), suggestions grid (`[+]`).
- Run history: per-run replay buttons with status dot (renders when `runs.length > 0`).

**Real-infra-only (cannot run in CI)**: SSH `docker logs` exec, LLM `streamObject()` synthesis,
the logs-timeout and synthesis-timeout races. **Seedable / pure-render (E2E-able)**: 404/409
pre-flight gates, the saved-run replay path, store transitions + DOM rendering driven from a
seeded `run_record`.

### E2E infrastructure already in place

**Config** (`tests/e2e/playwright.config.ts`): two projects (`setup` → `chromium`); isolated
DB `./data/opspilot.e2e.db` with `DATABASE_PATH` **inlined into the webServer command**
(line 47, not via `env:`); api `reuseExistingServer: false` (line 51), web
`reuseExistingServer: !CI` (line 58); both `cwd: rootDir`, `timeout: 120_000`; `storageState`
at `.auth/user.json`; `baseURL http://localhost:4200`. (Matches the lesson
"Isolate the e2e DB in Nx+Playwright".)

**Existing specs**: `auth.setup.ts` (signup → storageState), `smoke.spec.ts`
(`getByRole('heading', { name: 'overview' })`), plus the two diagnose specs above.

**Seed helper** (`tests/e2e/helpers/seed-run-record.ts:1-37`): `seedRunRecord({ deviceId,
serviceId, synthesis, createdAtMs? }) → runId`. Opens a second `better-sqlite3` connection
to the e2e DB (`busy_timeout=5000` for the WAL write-lock), inserts one `run_record` row
(`id`, `device_id`, `service_id`, `synthesis` JSON, `created_at`, `duration_ms=1500`).
No route-mock — pure DB mutation read back by the real `GET /diagnose/runs`.

**Reusable scaffolding for any new spec**: storageState auth (inherited), device/service
creation via `page.request.post('/api/devices' …)`, `Date.now()` uniqueness suffix,
`afterEach` device delete (FK cascade), deep-link nav `/devices/{id}/services/{id}`,
role-based locators. A live-stream spec would additionally need a fake EventSource/SSE
source — which does not exist yet and is the contested piece.

### /10x-e2e workflow constraints (hard rules)

Five anti-patterns the skill re-prompts against: hallucinated assertion, brittle selector,
shared state between tests, `waitForTimeout` instead of waiting for state, no cleanup.
Hard invariants: start from a named `test-plan.md` risk (don't invent tests); browser-fit
only (cross-boundary or render-only — else route to `/10x-tdd` / `/10x-implement`); feature
must already be built; one test per risk; the test must go **red** if the risk materializes
(deliberate-break check after green); **internal boundaries (auth, routing, DB) stay real —
mock only expensive/non-deterministic external APIs**; commit only on green.

That last invariant is exactly what makes the live-stream happy path contentious: the SSE
endpoint is internal, so mocking it conflicts with the rule — yet the LLM behind it is the
non-deterministic external dependency the rule says to mock.

## Code References

- `apps/api/src/modules/diagnose/diagnose.controller.ts:22-47` — runs list + SSE stream boundary
- `apps/api/src/modules/diagnose/diagnose.service.ts:19,103` — 30 s `:ping` heartbeat (#6 contract)
- `apps/api/src/modules/diagnose/diagnose.errors.ts:30-42` — stream error-code taxonomy
- `apps/api/src/modules/diagnose/run-record.service.ts` — persistence (create/findRecent, retention prune)
- `apps/web/src/app/features/diagnosis/data/diagnosis.store.ts` — store transitions, `view()` fallback
- `apps/web/src/app/features/diagnosis/components/synthesis-card.component.ts:46-85` — 4-field render
- `libs/shared/src/lib/schemas/run-narration-event.schema.ts` — SSE event union (step/progress/delta/done/error)
- `tests/e2e/playwright.config.ts:47-58` — inline-env + reuseExistingServer isolation
- `tests/e2e/specs/diagnosis-synthesis-renders.spec.ts` — Risk #1 facet (b), shipped
- `tests/e2e/specs/diagnosis-clean-error.spec.ts` — Risk #1 facet (a), shipped
- `tests/e2e/helpers/seed-run-record.ts:1-37` — direct `run_record` seed
- `context/foundation/test-plan.md:44-49,66-73,86,299-349` — risk map, response guidance, Phase 4, §6.5 cookbook

## Architecture Insights

- **Test-level discipline is encoded, not ad-hoc.** The risk map carries a "cheapest layer"
  column, and §6.5 names the exact deterministic facets E2E may cover for diagnose. The
  feature's design (server-side SSH+LLM, no in-app test seam) is what *forces* most diagnose
  risks down to integration — E2E is deliberately the thin top layer.
- **Seed-the-DB, not mock-the-network** is the established diagnose E2E pattern. The replay
  path (`view()` falling back to `latestRun()?.synthesis`) is what makes a seeded `run_record`
  render without ever opening a stream — the reason facet (b) works deterministically.
- **The 409-no-provider gate doubles as a deterministic error trigger** — facet (a) gets a
  real, reproducible failure (no active LLM provider) without faking anything, exercising the
  full pre-flight → EventSource.onerror → store-clean-error → button-re-enable chain.

## Historical Context (from prior changes)

- `context/archive/2026-06-24-testing-playwright-bootstrap/plan.md` — bootstrapped Playwright:
  Phase 1 (install + scaffold e2e project) and Phase 2 (config + auth fixture + smoke test)
  complete. Phase 4 E2E authoring is the work this change continues.
- `context/foundation/lessons.md` — "Isolate the e2e DB in Nx+Playwright: inline env, no
  server reuse, repo-root cwd" was distilled from that bootstrap (3 leaked test users into the
  dev DB before the fix); the current config already obeys it.
- Commit `9804435` (2026-06-25) `test(web): e2e diagnose synthesis render + clean-error
  (risk #1)` — added both Risk #1 specs + the seed helper and filled test-plan §6.5.

## Related Research

- None prior under `context/changes/**/research.md`. The authoritative companion artifact is
  `context/foundation/test-plan.md` (§2 risk map, §3 phased rollout, §6.5 e2e cookbook).

## Open Questions

1. **Should the live UI→synthesis happy path be covered at all, and if so how?** Three
   options, in tension with the cookbook:
   - **(a) Leave it out** — accept that seeded replay (facet b) + clean-error (facet a) are
     the deterministic E2E ceiling. Matches §6.5 as written. **Recommended default.**
   - **(b) Add an app-side test seam** — e.g. a `NODE_ENV=test` fake-LLM / fake-SSH swap, or
     an injectable provider, so a real-looking stream runs deterministically. This is a
     *product/infra* change, not a test-authoring change; would need its own plan.
   - **(c) `page.route()`-intercept the EventSource request** and emit a canned SSE body.
     Technically feasible (EventSource is a browser-side GET; `page.route()` *can* intercept
     it — the cookbook's "server-side, can't intercept" claim is about the SSH+LLM call, not
     the HTTP connection). But it mocks an **internal** boundary, conflicting with the
     "internal stays real" invariant, and drifts toward a component test rather than E2E.
2. **Is a second clean-error cause worth a spec?** Facet (a) covers 409-no-provider; a
   device-unreachable / SSH-failure variant would broaden the "never hang" proof, but the
   store's error/spinner contract is already proven — low value.
3. **Is there value in an E2E over run-history replay + pagination** (seed N runs, click a
   replay button, assert no new stream opens, assert `limit`/`offset` slicing)? Currently
   untested at the browser level, though pagination is arguably an integration concern.

These three questions are the substance a `/10x-plan` (or `/10x-frame`, if the framing
"there must be more diagnose E2E to write" is itself suspect) needs to resolve before any
new spec is authored.
