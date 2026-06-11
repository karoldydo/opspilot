# Live Narration and Replay (S-05) — Plan Brief

> Full plan: `context/changes/live-narration-and-replay/plan.md`
> Frame brief: `context/changes/live-narration-and-replay/frame.md`
> Research: `context/changes/live-narration-and-replay/research.md`

## What & Why

Add **diagnose-specific** live narration + replay to the existing diagnose slice: a streamed
synthesis over `@Sse`, persisted to a minimal `run_record` table, using a **neutrally-named but
NOT abstracted** contract with a nullable `userId` reserved for S-09. US-01 / FR-010 require the
user to (a) watch a run narrated live during execution and (b) replay the full saved transcript of
an earlier run — today diagnose is fully batch and ephemeral (zero streaming, zero persistence).

## Starting Point

Diagnose is a clean three-layer vertical slice, all batch: `generateText` + `Output.object` returns
the whole 4-field `DiagnosisSynthesis` at once (`diagnose.service.ts:90-114`); a thin `@Post('diagnose')`
controller; a keyed-per-service web store + result card with binary loading→result. The DB machinery
(WAL connection, schema barrel, auto-migrate-on-boot) is ready, but no `run_record` table and no
stream/event contract exist.

## Desired End State

Clicking **Diagnose** opens an SSE stream and the result card fills **progressively live** (summary
streams, fields populate as produced). On completion the synthesis is **saved**, and a compact
**"Recent runs"** list under each service row lets the user click an earlier run to **replay** it
(static render of the saved synthesis). Fail-fast precondition checks still surface as HTTP errors
before the stream opens; mid-stream failures arrive as an in-stream `error` event.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Live↔replay coupling | One LLM pass feeds both stream + persist | `partialObjectStream` emits deltas AND accumulates the final object in one loop | Frame |
| Persistence ownership | S-05 creates the minimal `run_record` table | Replay needs it, it doesn't exist; nullable+indexed `userId` makes S-09 trivial | Frame |
| Generality | Neutral names, NOT abstracted | Only 1 skill exists; rule + convention + research OQ7 all warn against generic-now | Frame |
| Replay semantics | Static render of saved synthesis | Replay is review, not reproduction — re-stream has dubious value | Research (D5) |
| Narration semantics | `streamObject` (progressive partial fill) | Keeps one fixed schema; the free-text argument collapsed with the generality refute | Plan |
| Transcript storage | Final synthesis object only | Static render needs nothing more; no raw deltas, no dead column | Plan |
| Replay UX | Inline recent-runs list per service row | Minimal scope; the full history view is S-09 ("adds the view") | Plan |
| SSE event shape | One discriminated union `{ type: delta\|done\|error }` | One neutral contract on the api↔web boundary, easy `z.infer` + exhaustive switch | Plan |
| Error mapping | Fail-fast pre-flight (HTTP) + in-stream `error` event | Keeps 409/404 before the 200 stream opens; streaming-aware mid-stream errors; never 401 | Plan |
| Retention | Config-layer `LLM_DIAGNOSE_HISTORY_RETENTION` + pruning | Bounded list (drizzle pagination rule); not a module-level const | Plan |

## Scope

**In scope:** streamed synthesis (`streamObject` + `@Sse`), heartbeat + anti-buffer headers,
`run_record` table + migration + CRUD service + retention pruning, two new shared schemas,
`EventSource` consumption, progressive render, inline click-to-replay recent list.

**Out of scope:** generic ops-narration abstraction; re-stream replay / raw delta storage;
`streamText` free-text narration; global run-history view or dedicated route; surfacing `userId` in
the contract; WebSocket fallback; new auth/guard work.

## Architecture / Approach

Contract-first, four phases in dependency order: **shared → db → api → web**. Shared schemas land
first (one source of truth). The DB table + CRUD service give the API somewhere to persist. The API
converts the synthesis to a `streamObject` loop that maps partials → `delta` MessageEvents, merges a
30 s `: ping` heartbeat, persists the final object then emits `done`; a thin `@Sse` GET handler does
pre-flight fail-fast before the stream opens, plus a GET recent-runs endpoint. The web layer consumes
via `EventSource` → signal store (keyed per service), renders progressive fill, and replays saved runs
statically.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Shared contracts | `run-narration-event` union + `run-record` schema + barrel | Representing the partial synthesis on the wire |
| 2. Persistence | `run_record` table, migration 0004, CRUD service, retention | Prune-in-transaction correctness; FK/index shape |
| 3. API streaming | `streamObject` + `@Sse` GET + persist-on-done + replay endpoint | SSE pre-flight ordering (409 before 200); Cloudflare heartbeat day-1 |
| 4. Web | `EventSource` consumption, store partial + runs, progressive render + replay | Stream teardown via `DestroyRef`; keyed isolation; component size threshold |

**Prerequisites:** S-04 diagnose slice (done); DB machinery (done); active LLM provider for manual testing.
**Estimated effort:** ~3-4 sessions across 4 phases (one per phase, db + api are the heaviest).

## Open Risks & Assumptions

- **SSE pre-flight ordering** — Nest 11 must resolve the pre-flight before the `@Sse` 200 opens so
  404/409 stay HTTP; if `@Sse` won't await a `Promise<Observable>`, gate pre-flight in a guard.
- **Cloudflare edge reaping** — heartbeat + `X-Accel-Buffering: no` / `Cache-Control: no-cache` are a
  day-1 requirement, not polish; long runs are silently cut without them.
- **`streamObject` error semantics** — `supportsStructuredOutputs: true` changes timeout /
  `NoObjectGeneratedError` behavior under streaming; the existing classification needs a streaming-aware variant.
- **EventSource is GET-only** — the live endpoint replaces the current `@Post('diagnose')` with a GET stream.

## Success Criteria (Summary)

- A diagnose run fills the card incrementally live, then saves; an earlier run replays from the inline
  recent list (static render).
- No-active-provider still produces a clean 409 before any stream opens (never 401); mid-stream
  failures render as a legible in-stream error.
- Old runs are pruned to the configured retention bound; navigating away mid-stream closes the stream.
