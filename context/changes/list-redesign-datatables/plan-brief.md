# Fleet services datatable + skills/providers/audit datatables — Plan Brief

> Full plan: `context/changes/list-redesign-datatables/plan.md`
> Research: `context/changes/list-redesign-datatables/research.md`
> Visual reference: `mockups/design_handoff_list_redesign/reference/OpsPilot.list-redesign.dc.html` (= `mockups/index.html`) — layout/behavior only

## What & Why

Four list-heavy screens (`/devices`, `/skills`, `/providers`, `/audit`) don't scale — no search, sort, filter, or pagination anywhere, and finding one service across the fleet means scanning host by host. Bring **one** client-side datatable pattern (search · sort · per-column filter · client pagination) to all four, and turn `/devices` into a single fleet-wide "all services" table.

## Starting Point

Uniform codebase: each feature is a component-provided `@ngrx/signals` store over a zod-parsing HttpClient client; dialogs get their store via context. Today `/devices` is per-device cards each embedding a `device-services` sub-list (with a parent/child status-emit dance), and skills/providers/audit are plain stacks. There is no fleet read, no `clientTable` helper, no pagination helm, and no extracted synthesis card — status helpers are duplicated inline 3×.

## Desired End State

`/devices` is one fleet table (status · service · device · container · compose · actions) with a host filter strip, per-host action bar, header `+ add device`, status-first sort, and rows that link to service-detail. `/skills`/`/providers`/`/audit` are datatables with search + one filter + sortable headers + pagination; audit rows expand to a shared synthesis card. All four share `clientTable<T>`, a `status` util, and the spartan pagination helm. Density is compact throughout.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Fleet data strategy | New aggregate `GET /api/services` | One read with server-joined latest status beats an N+M client fan-out and keeps the fleet table thin | Plan |
| Aggregate contract shape | `ServiceWithStatus` = Service + `status` nullable | Minimal addition; `null` ⇒ FE `'unknown'`, preserving "unknown is a client concept" | Plan |
| Pagination chrome | Generate spartan pagination helm via CLI | Official primitive, consistent with the rest of helm | Plan |
| Synthesis card scope | Extract component, adopt in audit **and** service-detail | Removes duplication at the canonical source, not just the new consumer | Plan |
| Status filter `unknown` | Add `unknown` option to the status Select | Lets users isolate undiagnosed services | Plan |
| Status rank | One canonical rank in shared util, re-point the rollup | Single source of truth; ends the contradictory inline maps | Plan |
| Status helpers home | New `shared/status.ts` (pure, no-DI) | Matches the `clickable-classes.ts` precedent; kills triple duplication | Plan |
| Testing scope | Unit: helper + util + endpoint | Covers the load-bearing logic (paging/rank) and the new backend; UI verified manually | Plan |

## Scope

**In scope:** `clientTable<T>` helper; `status` util; `ServiceWithStatus` contract + aggregate `GET /api/services`; FE fleet client; `app-synthesis-card` extraction (audit + service-detail); spartan pagination helm; redesign of all four screens; compact density.

**Out of scope:** overview & service-detail behavior (service-detail only adopts the card); server-side paging/sorting; dialog/form redesign; any new styling system.

## Architecture / Approach

Build the shared substrate first (contract, `clientTable<T>`, `status` util, pagination helm), then the backend aggregate the fleet table depends on, then the synthesis-card extraction, then the four screens, then a density/cleanup/verify pass. Each table is a thin wrapper: feed the store's collection signal into `clientTable`, render a helm table + toolbar + pagination footer. The aggregate endpoint (left-join service → latest `run_record` per `serviceId`, user-scoped) means even the fleet table does one read, no fan-out.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Shared foundation | contract, `clientTable<T>`, `status` util, pagination helm | spartan CLI pagination generation friction |
| 2. Backend aggregate | `GET /api/services` + FE fleet client | SQLite latest-run-per-service query correctness |
| 3. Synthesis card | `app-synthesis-card`, adopted in service-detail | visual regression on the canonical surface |
| 4. /devices fleet table | one fleet table, host strip, per-host actions | most markup/behavior; row a11y + dead-code removal |
| 5. /skills datatable | search + scope filter + sort + pagination | low |
| 6. /providers datatable | search + status filter + Activate | single-active invariant preserved |
| 7. /audit datatable | filter + Result column + expandable synthesis | new Result column from `metadata.outcome` |
| 8. Density, cleanup, verify | consistent compact density + full gate | leftover dead refs |

**Prerequisites:** none beyond the current `main`; commit `6e184c6` touched only mockups, so `clientTable` is greenfield.
**Estimated effort:** ~4–6 sessions across 8 phases (Phase 4 is the largest).

## Open Risks & Assumptions

- SQLite has no `DISTINCT ON`; the latest-run-per-service query uses a correlated subquery / `row_number()` window backed by `run_record_service_created_idx` — must verify newest-wins and no-runs ⇒ `null`.
- Re-pointing the host rollup at the canonical rank inverts the comparison direction — verify the rollup still selects the *worst* status.
- Generating pagination via the spartan CLI may be high-friction; fall back to a hand-rolled `HlmButton` footer with the same component API.

## Success Criteria (Summary)

- `/devices` is a single fleet table with host filtering, per-host actions, status-first sort, and rows linking to service-detail; no per-device cards/sub-lists remain.
- `/skills`/`/providers`/`/audit` are datatables with search + one filter + sortable headers + pagination; audit still expands synthesis; page resets to 1 on change; `showing X–Y of N` accurate.
- Status is server-derived (`null` ⇒ grey `unknown`, never green); `lint`/`typecheck`/`test`/`build` all pass.
