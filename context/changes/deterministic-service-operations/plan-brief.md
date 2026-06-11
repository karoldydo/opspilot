# Deterministic Service Operations (S-06) — Plan Brief

> Full plan: `context/changes/deterministic-service-operations/plan.md`
> Frame brief: `context/changes/deterministic-service-operations/frame.md`
> Research: `context/changes/deterministic-service-operations/research.md`

## What & Why

Add 5 fixed, non-LLM lifecycle operations (`start`, `stop`, `restart`, `up`, `down`) a user runs on
a managed service over SSH, confirmed in the UI. Per the frame: **safely execute the 5 ops with the
correct compose-vs-standalone command form and injection-guarded interpolation, giving finite,
continuously-bounded feedback across durations from sub-second (`start/stop/restart`) to minutes
(`up -d` pulling images) — not "generalize `run_record`."**

## Starting Point

The execution seam (`IExecutor.execute` → per-device mutex, timeouts, no-hang `finally`) and the
device → services web surface already exist and are verified (S-04/S-05). Diagnose is the exact
template minus the LLM and SSE halves. The gap: no operation contracts, no command templates, no op
endpoint/UI, and two unconstrained free-text compose fields that would be a new injection surface.

## Desired End State

Each service row exposes lifecycle buttons — `Start`/`Stop`/`Restart` everywhere, `Up`/`Down` only on
compose-managed services. A non-destructive op fires immediately with a `Running…` label and shows a
short success/failure line; `Down` confirms in a modal first. A slow `up -d` finishes inside a
dedicated op timeout (default 5 min) instead of failing at the 30 s SSH ceiling. Compose fields are
charset-validated at the command boundary. Nothing is persisted.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Slow-op feedback model | Synchronous POST + dedicated long op-timeout | Zero new infra (the pre-S-05 `@Post` shape); finite bound satisfies the no-hang NFR | Plan |
| Executor timeout | Per-call `timeoutMs?` override on `execute` | The internal 30 s race would kill `up -d` first; default-arg keeps scan/diagnose unchanged | Plan |
| up/down availability | BE rejects (400) + FE computes from nullability | BE is the hard boundary; FE reads existing contract fields — no new contract | Plan |
| `down` confirmation | Only `down` gets a modal | Only `down` is destructive/irreversible (removes containers+network); rest idempotent | Plan |
| Result contract | `{ operation, status, message }` | Minimal envelope for < 10 s confirm; no raw stdout in the UI | Plan |
| `run_record` | Out of scope — ephemeral confirmation only | Audit is S-09/FR-011; the neutral seam stays untouched | Frame |
| Injection guard | New charset schemas, boundary re-parse only | Mirrors `containerNameSchema`; avoids retightening `serviceSchema` and breaking scan | Frame |
| Op timeout location | Config-layer `OP_TIMEOUT_MS` | `lessons.md` config-tunable rule; precedent `LLM_DIAGNOSE_LOGS_TIMEOUT_MS` | Frame |

## Scope

**In scope:** operation enum + request + result contracts; compose-field charset schemas;
`OP_TIMEOUT_MS`; executor per-call timeout override; `operation/` module (service, command builder,
docker mapper, controller); web client + serviceId-keyed store + extracted `app-service-operations`
component with `down` confirm.

**Out of scope:** `run_record` generalization / persistence; SSE/streaming/polling; skill-as-data
table (S-08); bulk operations; per-device concurrency change; retightening `serviceSchema`; a new auth
guard.

## Architecture / Approach

New `operation/` feature module sibling to `diagnose/`. The op service resolves the row
(`ServiceService.findOne`), gates up/down to compose services, re-parses the interpolated fields at the
boundary, builds the PATH-prefixed command (container-scoped `docker start|stop|restart` vs
compose-scoped `docker compose -f <path> -p <project> up -d|down`), runs it through the executor with
`OP_TIMEOUT_MS`, and maps the exit to `{ operation, status, message }`. The web side extracts a thin
component (own client + store) into the existing actions cell.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Foundation | Contracts, charset schemas, `OP_TIMEOUT_MS`, executor `timeoutMs?` override | Executor signature change must not regress scan/diagnose (default-arg) |
| 2. Backend | `operation/` module: command builder, gating, mapper, endpoint | Injection guard + result-vs-error split correct |
| 3. Web | Client, keyed store, extracted op component, `down` confirm, wire-in | Host component budget; per-row state isolation |

**Prerequisites:** S-02 (devices/services), S-04/S-05 (executor + diagnose engine) — all shipped.
**Estimated effort:** ~2–3 sessions across the 3 phases.

## Open Risks & Assumptions

- A slow `up -d` holds the device mutex for its duration (accepted: single-operator homelab).
- Docker labels yield clean compose values; a label failing the charset re-parse is rejected (treated
  as suspicious) rather than run.
- The `'failed'` result status (op ran, exited non-zero) is distinct from a thrown 503 (infra down).

## Success Criteria (Summary)

- A user runs any of the 5 ops from the browser and sees confirmation in < 10 s for fast ops.
- A slow `up -d` completes inside the op timeout instead of failing at 30 s.
- `up`/`down` are unavailable (UI + API) on standalone services; a malformed compose field can never
  inject a shell command.
