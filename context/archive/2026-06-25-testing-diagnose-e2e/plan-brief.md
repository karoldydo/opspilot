# Diagnose run-history replay E2E — Plan Brief

> Full plan: `context/changes/testing-diagnose-e2e/plan.md`
> Research: `context/changes/testing-diagnose-e2e/research.md`

## What & Why

The deterministic diagnose E2E backlog is essentially complete — Risk #1's clean-error and
single-run render facets ship, and Risk #6 is integration-only. The one facet that genuinely
extends browser coverage is **run-history replay**: prove that clicking an older run's chip
swaps the result card to that run's synthesis **without** opening a new live stream. This
closes Phase 4 of the test plan at its true deterministic ceiling.

## Starting Point

Two diagnose specs ship (`diagnosis-clean-error`, `diagnosis-synthesis-renders`) plus the
`seedRunRecord` helper and an isolated-db Playwright config. The run-history list and the
`replay()` state swap are built in `service-detail.component` + `diagnosis.store` but have no
browser-level test. No application code changes are needed.

## Desired End State

A reviewed, deliberate-break-verified spec `diagnosis-run-history-replay.spec.ts` seeds two
saved runs, asserts the newest renders on entry with both replay chips present, clicks the
older chip, and proves the card swaps while the panel stays `idle` and no `/diagnose/stream`
request fires. The test-plan `§6.5` documents the facet, and the Phase 4 row reads `complete`.

## Key Decisions Made

| Decision                       | Choice                                  | Why (1 sentence)                                                          | Source   |
| ------------------------------ | --------------------------------------- | ------------------------------------------------------------------------- | -------- |
| Live UI→synthesis happy path   | Out of scope                            | Blocked on a missing test seam; mocking it breaks "internal stays real".  | Plan     |
| Run-history replay E2E         | Build it — the deliverable              | Multi-run replay is the only untested browser-fit facet of Risk #1.       | Plan     |
| Second clean-error cause       | Skip                                    | Store error/spinner contract already proven by facet (a) — low value.     | Plan     |
| Pagination (`limit`/`offset`)  | Not E2E                                 | `recentRuns()` sends no params — slicing is an API/integration concern.   | Research |
| Phase 4 rollout status         | Mark `complete` after the spec lands    | All three deterministic E2E facets ship; #6 covered at integration.       | Plan     |
| Authoring path                 | Drive via `/10x-e2e`                    | Its risk→generate→review→deliberate-break workflow is the source of truth.| Plan     |

## Scope

**In scope:** one new E2E spec (multi-run replay, Risk #1); `test-plan.md §6.5` facet (c) +
pagination note; Phase 4 row → `complete`; `change.md` status.

**Out of scope:** live happy-path stream, second clean-error cause, pagination E2E, Risk #6,
any `apps/`/`libs/` code change.

## Architecture / Approach

Seed-the-DB, never mock-the-network. Create device + service over the real `/api`, seed two
`run_record` rows with distinct statuses/summaries/timestamps via `seedRunRecord`, deep-link
to service-detail, and assert with `getByRole`/`getByText` + web-first waits. The
"no new stream" proof is belt-and-suspenders: a negative `**/diagnose/stream` network
assertion plus the DOM `agent run · idle` / enabled-button checks. Auth, routing, the `/api`
read, the db, and the rendered Angular components all stay real.

## Phases at a Glance

| Phase                          | What it delivers                                    | Key risk                                              |
| ------------------------------ | --------------------------------------------------- | ----------------------------------------------------- |
| 1. Run-history replay E2E spec | The reviewed, green, deliberate-break-verified spec | Locating the right chip; proving "no stream" reliably |
| 2. Documentation sync          | §6.5 facet (c) + pagination note; Phase 4 complete  | Doc drifting from the shipped spec                    |

**Prerequisites:** existing Playwright e2e project + `seedRunRecord` helper (both present);
port `:3000` free for the isolated e2e api.
**Estimated effort:** ~1 session — one spec via `/10x-e2e` + a small docs edit.

## Open Risks & Assumptions

- Assumes `GET /diagnose/runs` returns newest-first (documented in `diagnosis.client.ts`); the
  spec seeds distinct `createdAtMs` so ordering is deterministic regardless.
- Distinct seeded statuses (`healthy` / `down`) make each replay chip uniquely locatable by
  role-name, avoiding the locale-dependent `date:'short'` string.
- The negative network assertion must settle after the card swap to avoid a flaky pass.

## Success Criteria (Summary)

- A user replaying an older run sees that run's synthesis in the card, and the app opens no
  live stream to do it — proven green and red (deliberate-break).
- The full e2e suite stays green and independent across consecutive runs.
- `test-plan.md` records facet (c) and marks diagnose's browser layer (Phase 4) complete.
