# Testing Agent Diagnosis Under Failure — Plan Brief

> Full plan: `context/changes/testing-agent-diagnosis-under-failure/plan.md`
> Research: `context/changes/testing-agent-diagnosis-under-failure/research.md`

## What & Why

Close the four residual test gaps for **Risk #1** — the `diagnoseLogs` agent path:
the LLM returns output that doesn't match the synthesis schema, or the run hangs past
the < 15 s NFR, and the user gets a confident-but-useless synthesis or nothing at all.
Risk #1 is already substantially defended, but the existing specs **mock the entire `ai`
boundary**, so they verify the error-mapper — not the SDK's real abort and validation.
That is exactly the test plan's "must challenge" for this risk.

## Starting Point

The diagnose flow is an SSE streaming agent over Vercel AI SDK `streamObject()`. Two specs
exist — `diagnose.service.spec.ts` (12 cases) and `diagnose.controller.spec.ts` (5 e2e cases
over real temp SQLite) — covering the `synthesis-failed`, `timeout`, `upstream-unavailable`,
fail-fast-409, no-leak, and heartbeat frames. But the timeout/schema cases inject pre-built
errors against a mocked `streamObject`, so the real `AbortSignal.timeout` never fires and the
real schema is never run.

## Desired End State

Risk #1 is retired: `npx nx test api` exercises — through the **real** SDK where it matters —
that bad LLM output yields a clean `error` frame (no crash, hang, or leak) and that the
synthesis timeout actually fires within its configured bound. The test-plan cookbook (§6.2)
documents the reusable fake-provider pattern, §6.6 records what the real-abort test revealed,
and the §3 rollout status is current.

## Key Decisions Made

| Decision                          | Choice                                              | Why (1 sentence)                                                                                  | Source   |
| --------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------- |
| Scope                             | Close all 4 gaps                                    | Cheap mapper gaps + high-signal real-SDK gaps together remove the "mocked LLM is safe" blind spot | Plan     |
| Seam for high-signal gaps         | Fake `MockLanguageModelV3` (seam a)                 | Only way to fire the SDK's real abort + run its real validation — what the test plan demands      | Plan     |
| Abort-test determinism            | Tiny real timeout + abort-honoring hanging model    | Exercises the genuine `AbortSignal.any` on ~50 ms wall-clock; fake timers don't advance the SDK   | Plan     |
| logs-timeout test layer           | Service-level (seam b)                              | Cheapest layer with real signal; controller already proves the 200-not-401 envelope               | Plan     |
| File organization                 | New `diagnose.service.real-model.spec.ts`           | `vi.mock('ai')` is file-scoped — the real-SDK tests need the genuine `streamObject`               | Plan     |
| Extra deliverables                | §6.2 cookbook + §6.6 note + §3 status               | §6.2 is a Phase 1 deliverable; §6.6 captures the abort finding; status keeps the ledger accurate  | Plan     |

## Scope

**In scope:**
- logs-timeout frame test (gap #1, service-level, seam b)
- `NoObjectGeneratedError`-with-`cause` unwrap test (gap #3, seam b)
- Real `AbortSignal.timeout` fires within bound (gap #2, seam a)
- Real schema rejection through `streamObject` (gap #4, seam a)
- test-plan §6.2 cookbook, §6.6 per-phase note, §3 Phase 1 status

**Out of scope:**
- Asserting synthesis *content* correctness (oracle problem)
- Controller-e2e for the logs-timeout frame (cheapest-layer principle)
- CI gate wiring (no CI config exists to edit yet)
- Any production-code refactor; Playwright/e2e (Phase 4)

## Architecture / Approach

Two seams at the LLM boundary: **(b)** `vi.mock('ai')` + injected errors for the cheap
mapper-level gaps (extends the existing spec), and **(a)** a `MockLanguageModelV3` from
`ai/test` returned by an overridden `LlmProviderClientFactory.create`, driving the real
`streamObject` against the real `diagnosisSynthesisSchema` (new spec file, no `vi.mock('ai')`).
The two timing-sensitive tests use tiny real timeout bounds from the `llmConfig.KEY` override.

## Phases at a Glance

| Phase                         | What it delivers                                          | Key risk                                                       |
| ----------------------------- | -------------------------------------------------------- | -------------------------------------------------------------- |
| 1. Cheap mapper gaps (seam b) | logs-timeout + cause-unwrap tests in the existing spec   | logs-timeout test must stay fast (tiny bound) and not hang     |
| 2. Real-SDK gaps (seam a)     | real-abort + real-schema-rejection tests + §6.2 cookbook | abort-honoring fake stream must not leak a timer; flake risk   |
| 3. Ledger updates             | §6.6 note + §3 Phase 1 status                            | note must reflect the actual abort-surface finding             |

**Prerequisites:** none — `ai@6.0.201` already ships `MockLanguageModelV3` via `ai/test`.
**Estimated effort:** ~1 session across 3 phases (mostly Phase 2's fake-model wiring).

## Open Risks & Assumptions

- The real-abort test depends on `MockLanguageModelV3.doStream` honoring `options.abortSignal`;
  if it doesn't propagate cleanly, the fake stream must wire its own teardown to the signal.
- Shaping `doStream` chunks into a *finished* non-conformant object may be fiddly; fallback is
  a thin schema-contract test plus a flow mapping test (noted in the plan).
- Whether v6 surfaces the abort bare or wrapped is unknown until Phase 2 runs — that finding
  is the content of the §6.6 note (research open-question #1).

## Success Criteria (Summary)

- `npx nx test api` green with all four new cases; the real-model spec has no `vi.mock('ai')`.
- The real `AbortSignal.timeout` fires within its bound; a real `NoObjectGeneratedError` maps
  to `synthesis-failed` with no raw-text leak.
- test-plan §6.2 / §6.6 / §3 reflect the pattern, the finding, and the status.
