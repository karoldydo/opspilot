# Custom Skill CRUD (S-08) — Plan Brief

> Full plan: `context/changes/custom-skill-crud/plan.md`
> Frame brief: `context/changes/custom-skill-crud/frame.md`
> Research: `context/changes/custom-skill-crud/research.md`

## What & Why

Build the skill-as-data table + CRUD + **deterministic, per-device-scoped HTTP execution**
(mirroring the S-06 operation path), whose single genuinely-new load-bearing control is a
**safe parameterized-command renderer** (typed `{{placeholder}}` substitution + charset
re-parse at the shell boundary) — *not* an LLM tool-calling layer. This is the first time the
project stores skills as data instead of hardcoded TypeScript (FR-006 + FR-008).

## Starting Point

Today the 5 lifecycle ops are a compile-time `z.enum` + a hand-written `buildCommand` switch
(`operation.service.ts:66-82`), executed by a thin `operation/` module and a fixed-button web
surface; `diagnoseLogs`/`scanServices` are hidden built-ins. The CRUD vertical-slice blueprint
(`device`/`llm-provider`) and the `IExecutor` seam are copy-ready; the `or(isNull, eq)`
global+device scope filter and any parameterized-template capability are greenfield.

## Desired End State

A user creates/edits/deletes skills (global or per-device) in the web UI; on a service's row
they see only the skills in scope for that service's device, gated to those runnable for the
service, and run one — executed deterministically with an ephemeral success/failure result. The
five lifecycle ops behave exactly as before, now sourced from seeded global skill rows; the old
`operation/` module and web operations surface are gone.

## Key Decisions Made

| Decision                       | Choice                                                            | Why (1 sentence)                                                                 | Source   |
| ------------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------- |
| Execution path                 | Pure HTTP deterministic dispatch (no AI-SDK tool-calling)        | PRD load-bearing Non-Goals mandate deterministic, user-selected dispatch; agent-shell → v2 | Frame    |
| Defaults model                 | Seed 5 lifecycle ops as global rows; diagnoseLogs/scanServices stay built-in | Uniform shell-skill shape breaks on diagnoseLogs (streamObject+SSE+RunRecord)     | Frame    |
| Runs persistence               | Ephemeral (no RunRecord)                                         | Respects the S-09 persistence boundary that S-06 re-deferred                      | Frame    |
| Parameterization               | Typed placeholders + parameter list with a binding **source**    | Realizes FR-006 "parameterized commands"; renderer substitutes only validated values | Plan     |
| Injection safety               | Fixed structure + `{{placeholder}}` charset-whitelist + re-parse | "Constrain the alphabet, not escape the string" — 1:1 with current buildCommand defense | Plan     |
| Parameter value source         | `service`-bound (server-resolved) vs `input`-bound (caller-supplied) | Preserves the S-06 guarantee: BE never trusts the FE for service identity         | Plan     |
| Relation to S-06 path          | Migrate — operations run through skill rows, `operation/` removed | One canonical execution path, no dual surface                                    | Plan     |
| Run API                        | New unified `…/skills/:skillId/run`; old operation endpoint deleted | Matches the migration choice; no dead code                                       | Plan     |
| Timeout                        | Global config default + nullable per-skill override column        | Different skills have different time profiles; config-not-const (lessons.md)      | Plan     |
| Name uniqueness                | Unique per scope (global vs a given device), enforced in a transaction | Guards against confusing duplicates — the exact roadmap S-08 risk note            | Plan     |

## Scope

**In scope:** skill table (nullable `deviceId`), shared contract trio + parameter/template/
value security schemas + run request/result, CRUD module (scope filter + uniqueness), run
endpoint with safe renderer + per-skill timeout, seed 5 lifecycle ops, web CRUD feature, web
execution rewire, removal of `operation/` module + web operations surface.

**Out of scope:** AI-SDK tool-calling / agent-shell (v2), RunRecord/persistence/replay for
skill runs (S-09), folding diagnoseLogs/scanServices into rows, raw user-authored shell,
scheduling/bulk-ops/RBAC, executor changes.

## Architecture / Approach

Vertical slice on the CRUD blueprint (shared Zod → Drizzle table + boot migration → thin
controller + `ZodValidationPipe` → `signalState` store + schema-driven form), then migrate
execution. The run service resolves the service server-side, scope-checks the skill (the
runtime guardrail replacing the enum), fills `service` params from the resolved row and
validates `input` params from the request, re-parses every value at the shell boundary, renders
the fixed-structure template, and runs it through the existing `IExecutor`. Seeding the 5 ops as
global rows lets the migration delete the old `operation/` module entirely.

## Phases at a Glance

| Phase                          | What it delivers                                          | Key risk                                                |
| ------------------------------ | --------------------------------------------------------- | ------------------------------------------------------- |
| 1. Shared contracts            | Skill trio + template/parameter/value security schemas + run shapes | Getting the placeholder grammar / charset right (load-bearing) |
| 2. DB table + seed defaults    | `skill` table, migration `0006`, 5 idempotent global rows | Seed idempotency; nullable-deviceId divergence          |
| 3. API CRUD module             | Controller + service (scope filter + uniqueness txn)      | Uniqueness-per-scope transaction correctness            |
| 4. API run + operation migration | Run endpoint + safe renderer + timeout; `operation/` deleted | Lifecycle regression while deleting the old path         |
| 5. Web CRUD feature            | Client + store + list + create/edit form + route          | Form UX for declaring parameters + scope                |
| 6. Web execution rewire        | Skill-driven run scoped per device; old surface removed   | Preserving compose-gating UX without the enum           |

**Prerequisites:** S-06 (done). Leaf in Stream D — unlocks nothing; not a prerequisite of S-09.
**Estimated effort:** ~3-4 sessions across 6 phases (backend-heavy in 1-4, web in 5-6).

## Open Risks & Assumptions

- The placeholder grammar + value charset must be broad enough for container names, compose
  paths, and project names yet exclude every shell metacharacter — the security crux.
- Migration deletes a working path; the seed + run endpoint must land and be verified before the
  `operation/` removal so the lifecycle ops never regress.
- Compose-gating UX is reproduced by "required `service` params satisfiable for the service"
  rather than an explicit op enum — needs manual confirmation it matches today's behavior.

## Success Criteria (Summary)

- The 5 lifecycle ops run identically to before, now from seeded skill rows; old `operation/`
  module and web operations surface are gone.
- A user-created custom skill is creatable/editable/deletable and runs only on its scoped
  device(s); an out-of-scope or forged `skillId` returns 404.
- Any parameter value carrying a shell metacharacter is rejected at the boundary.
