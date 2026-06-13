# Audit Log + Linked History (S-09 / FR-011) — Plan Brief

> Full plan: `context/changes/audit-log-and-history/plan.md`
> Frame brief: `context/changes/audit-log-and-history/frame.md`
> Research: `context/changes/audit-log-and-history/research.md`

## What & Why

Activate the pre-positioned audit seam — add an `audit_log` table for user actions, wire the
reserved `run_record.userId` + FK, write audit rows **inline in the action's transaction** where one
exists, and render a bundled history/replay view — with the audit guarantee modelled as **two tiers**,
not one. This gives OpsPilot a reliable "who did what" record, which the PRD makes the *sole* source
of accountability.

## Starting Point

The agent-run half already exists and was built S-09-ready: `run_record` carries a nullable, indexed
`userId` explicitly *"reserved for s-09"* (never written/read), and the global guard already attaches
`request.session.user.id`. But there's no `@CurrentUser()` accessor, no controller reads the session,
and none of the ~18 mutating endpoints record anything.

## Desired End State

Every authenticated mutating action writes one `audit_log` row keyed off the session user. CRUD writes
are atomic with the action; side-effect ops record on invocation. A new `/audit` route shows one
merged chronological timeline; clicking a diagnose-run row expands the saved synthesis card.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Table shape | Two linked tables (`audit_log` + `run_record`) | Preserves the shipped run model/contract/replay; avoids a polymorphic regression | Frame / Research |
| "Transcript" meaning | Stored final synthesis | Narration is ephemeral; synthesis matches the current product | Frame |
| Write posture | Inline, two-tier (atomic CRUD / record-on-invocation ops) | "Guaranteed in transaction" is feasible for CRUD, impossible for SSH/SSE ops | Frame |
| Coverage | All ~18 mutating endpoints | PRD makes audit the sole accountability source — no blind spots | Plan |
| Auth flows | Out of scope | Login/logout need a different hook (better-auth catch-all) | Plan |
| Granularity | Action + target + lightweight metadata | Simple uniform contract; keeps secrets out of the payload | Plan |
| Linkage | Single `audit_log.runRecordId → run_record` FK | One direction suffices; doesn't touch the shipped run contract | Plan |
| `skill.run` | `audit_log` row, record-on-invocation | Accountability without a new run-record model | Plan |
| Retention | Indefinite | Accountability records are retained; pruning undercuts the purpose | Plan |
| Timeline view | One merged chronological list | `audit_log` is the spine; run-linked rows expand via LEFT JOIN — one query, no union | Plan |

## Scope

**In scope:** `audit_log` table + `run_record.userId` FK/relation; `@CurrentUserId()` decorator;
`AuditService` (txn-aware insert + paginated list); inline Tier-1 CRUD audit writes; Tier-2
record-on-invocation for `skill.run`/`service.scan`/`diagnose.run`; `/audit` web timeline view.

**Out of scope:** narration/transcript capture; auth-flow auditing; a dedicated skill-run table;
old→new field diffs; bidirectional FK linkage; audit pruning; backfill of historical runs.

## Architecture / Approach

Two linked tables. `AuditService.record(input, tx?)` accepts an optional transaction handle: Tier-1
CRUD callers pass their own `tx` (atomic with the write — single-statement services get a wrapping
`db.transaction()`); Tier-2 ops pass the base connection. Controllers read the user via
`@CurrentUserId()` and thread it into services. The web timeline is one `audit_log`-driven list with a
LEFT JOIN to `run_record`, so run-linked rows carry their synthesis inline — reusing the S-05 replay
renderer, no client-side union.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Foundation | `audit_log` schema + `run_record` FK + contract + `@CurrentUserId()` + `AuditService` | Migration on an existing nullable FK column |
| 2. Tier-1 CRUD | Atomic inline audit writes across ~13 CRUD methods | Wrapping single-statement writes without breaking unique-constraint handling |
| 3. Tier-2 ops | `skill.run`/`service.scan`/`diagnose.run` records + `run_record.userId` | Threading userId through the SSE stream without regressing narration |
| 4. Web view | `/audit` merged timeline with expandable synthesis detail | Reusing the synthesis card cleanly in a new list |

**Prerequisites:** F-02 (auth guard/session) and S-04/S-05 (run_record + replay UI) — both shipped.
**Estimated effort:** ~3–4 sessions across 4 phases.

## Open Risks & Assumptions

- Tier-2 ops have no atomic-with-effect guarantee — a run that errors before its persist point leaves
  no audit row (accepted; identical to today's `run_record` behavior).
- `audit_log.runRecordId` uses `onDelete: 'set null'` so run pruning never deletes a retained audit
  row — verify the generated migration reflects this.
- Secrets must never reach audit `metadata` (credential/llm-provider rows store ids/labels only) —
  enforced by test.
- Indefinite retention grows the table unbounded; acceptable at homelab volume.

## Success Criteria (Summary)

- Every mutating action produces a correct, user-attributed audit row; CRUD writes are atomic.
- `diagnose.run` persists `run_record.userId` and a linked audit row; the SSE stream is unchanged.
- `/audit` renders one chronological timeline; diagnose-run rows expand to the saved synthesis.
