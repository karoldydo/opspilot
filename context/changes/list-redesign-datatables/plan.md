# Fleet services datatable + skills/providers/audit datatables — Implementation Plan

## Overview

Turn four list-heavy screens into scannable, client-side datatables that share **one** signal-based helper:

- `/devices` becomes a **single fleet "all services" table** (status · service · device · container · compose · actions) with a host filter strip, a per-host action bar, and rows that navigate to the existing service-detail route.
- `/skills`, `/providers`, `/audit` become **datatables** with the same toolbar shape (free-text search + one column filter), sortable headers, and client pagination. Audit keeps its expandable synthesis row.

All four use `clientTable<T>` (search · sort · per-column filter · client pagination), a shared `status` util (canonical rank + badge/dot classes), and the spartan **pagination** helm. The fleet table is fed by a **new aggregate `GET /api/services`** endpoint that joins each service's latest run status — so the FE no longer fans out per-device/per-service to compute status.

**Visual source of truth:** `mockups/design_handoff_list_redesign/reference/OpsPilot.list-redesign.dc.html` (identical copy: `mockups/index.html`) — open in a browser and navigate via the sidebar to devices / skills / providers / audit. It is an HTML design reference for **layout and behavior only** — do not copy its markup or monospace styling; recreate with helm primitives + Tailwind. The accompanying `mockups/design_handoff_list_redesign/CLAUDE_CODE_PROMPT.md` is the source the task brief (`change.md`) was derived from. The column sets, host filter strip, per-host action bar, and pagination chrome in this plan match that prototype 1:1.

## Current State Analysis

The codebase is uniform: every feature is a component-provided `@ngrx/signals` `signalState` store (`load`/mutate-then-refetch, `loading`/`isEmpty`/`error` signals) over an HttpClient client that zod-parses through `@opspilot/shared`; dialogs render in a CDK overlay and receive their store **via the dialog context object**, not DI.

Key facts established by research (`context/changes/list-redesign-datatables/research.md`) and a backend deep-dive:

- **No fleet read, no latest-status read today.** Services are per-device only (`GET /api/devices/:deviceId/services`, `service.service.ts:67-70` `findAll(deviceId)`); status lives only on the newest `run_record.synthesis.status` (`GET …/diagnose/runs`). `ServiceController` is prefixed `@Controller('devices/:deviceId')` (`service.controller.ts:30`) so it cannot host a top-level route — a new fleet controller is required (mirroring `OverviewController` `@Controller('overview')`).
- **`run_record.synthesis` is a text/JSON blob** (`run-record.schema.ts`), read via `JSON.parse` + `diagnosisSynthesisSchema.parse` (`run-record.service.ts:81`). Index `run_record_service_created_idx` on `(serviceId, createdAt DESC)` supports a "latest run per service" query.
- **`@tanstack/angular-table` is NOT a dependency** → hand-roll `clientTable<T>`.
- **No spartan pagination helm** (`libs/ui/pagination/` absent) → generate it via the spartan CLI.
- **No `app-synthesis-card` component** — the badge + summary + problems/suggestions grid is duplicated inline 3× (canonical: `service-detail.component.html:141-187`; audit: `audit.component.html:64-107`; partial: `device-services.component.html:47-57`).
- **Status helpers are duplicated inline** (`STATUS_RANK`, `BADGE_CLASS`/`DOT_CLASS`, `badgeClass()`/`dotClass()`, the `?? 'unknown'` fallback) across `device-services.component.ts` / `devices.component.ts` / `audit.component.ts`. The wire enum is `'healthy' | 'degraded' | 'down'`; **`'unknown'` is a client-only concept for "no runs"** (grey, never green).
- The current `/devices` renders one bordered card per device, each embedding `<app-device-services>` and a parent/child `statusChange` emit dance (because each child owns a row-scoped `DiagnosisStore`). The redesign collapses both into one table; with the aggregate endpoint the status emit dance disappears entirely.
- Commit `6e184c6` ("…search, filter, and pagination") touched **only** `mockups/index.html` + `compose.yaml` — **no app code**, so `clientTable<T>` is greenfield. But that mockup is not noise: it (and the `design_handoff_list_redesign/` handoff the user later supplied) **is the visual prototype of this very redesign** — the authoritative reference, not leftover scaffolding. Research originally dismissed it; this plan treats it as the design source of truth.

## Desired End State

- `/devices` is a single fleet table of every service (status · service · device · container · compose · Edit/Delete) with a host filter strip, per-host `scan / edit host / delete host` on the selected host, `+ add device` in the header, status-first default sort, client search/sort/filter/pagination, and rows that navigate to the service-detail route (Devices nav stays active). No per-device cards or sub-lists remain.
- `/skills`, `/providers`, `/audit` are datatables with search + one column filter + sortable headers + client pagination; audit rows with a `synthesis` expand to problems/suggestions via the shared `app-synthesis-card`.
- All four use the **one** `clientTable` helper; page resets to 1 on query/filter/sort change; `showing X–Y of N` is accurate.
- Service status is derived from the latest run server-side and surfaced as `ServiceWithStatus.status` (`null` ⇒ grey `unknown` on the FE, never green). No `Service.status` is invented on the client.
- Density is compact; UI is spartan-ng helm + Tailwind only; `lint`, `typecheck`, `test`, `build` all pass.

### Key Discoveries:

- New fleet controller pattern: `OverviewController` `@Controller('overview')` (`overview.controller.ts:10`), registered in its module — mirror this in the service module (`service.module.ts:10-14` exports `[ServiceController]`; add a second controller).
- DB injection: `@Inject(DATABASE_CONNECTION) db: DatabaseConnection` (`service.service.ts:37`); `toContract(row)` projects safe fields + normalizes timestamps via `serviceSchema.parse` (`service.service.ts:203-214`).
- Latest-status FE expression today (semantics to preserve): `diagnosis.entry(service.id).runs[0]?.synthesis?.status ?? 'unknown'`.
- Helm table import: `import { HlmTableImports } from '@spartan-ng/helm/table';` (`scan-services.dialog.ts:10`); the only existing `<table hlmTable>` usage is `scan-services.dialog.html:18-52`. Select usage: `device-form.dialog.html:52-62`. Alert-dialog delete-confirm: `devices.component.html:82-95`.
- `clientTable<T>` home: `apps/web/src/app/shared/client-table.ts` (alias `@app/*`, `tsconfig.base.json:14`); follow the pure-function/no-DI precedent of `shared/directives/clickable-classes.ts`.
- spartan CLI config: `components.json` (`componentsPath: libs/ui`, `importAlias: @spartan-ng/helm`, `generateAs: entrypoint`).

## What We're NOT Doing

- **Overview** and **service-detail** behavior are unchanged (service-detail only adopts the extracted synthesis-card; no behavior change). The devices list no longer renders per-device sub-lists.
- **No** server-side paging/sorting — everything filters/sorts/pages client-side from the loaded collection. (The new endpoint returns the full fleet list; it is not paginated.)
- No redesign of dialogs/forms — reuse the existing create/edit/scan/rename/skill/provider dialogs and their store-via-context pattern.
- No new styling system or hand-rolled CSS — spartan-ng helm + Tailwind utilities only.

## Implementation Approach

Build the shared substrate first (contract, `clientTable<T>`, `status` util, pagination helm), then the backend aggregate that the fleet table depends on, then the synthesis-card extraction, then the four screens, then a density/cleanup/verify pass. Each table screen is a thin presentational wrapper: feed the store's existing collection signal into `clientTable`, render a helm table + toolbar + pagination footer. The fleet table is the only screen with new data plumbing, and the aggregate endpoint keeps even that thin (one read, no fan-out).

## Critical Implementation Details

- **Latest-run-per-service query (SQLite).** There is no `DISTINCT ON` in SQLite. Use a correlated subquery (or a `row_number()` window) over `run_record` ordered by `createdAt DESC` per `serviceId`, left-joined to `service` so services with zero runs yield `status = null`. The `run_record_service_created_idx` `(serviceId, createdAt DESC)` index backs this.
- **User-scoping.** The aggregate must return only services belonging to the authenticated user's devices (the controller tests fake the session guard and seed a `user`; `run_record` carries `userId`). Scope by the authed user, consistent with the device-scoped routes.
- **Status rank inversion.** The canonical sorter rank is `down < degraded < healthy < unknown` (worst first on ascending). The existing inline `STATUS_RANK` was built for a worst-of rollup (`down` highest) — when re-pointing the host rollup at the canonical rank, the rollup must still select the **worst** status (lowest canonical rank), so verify the comparison direction flips correctly.
- **Effect-driven loads, not constructor.** Per `lessons.md`, any input/signal-dependent load goes in a named `effect()`. The fleet table loads once on init (no inputs) so a constructor/`onInit` load is acceptable there, but keep the pattern consistent and guarded.

---

## Phase 1: Shared foundation (contract · clientTable · status util · pagination helm)

### Overview

Create the reusable substrate all four tables consume, plus the new shared contract type. No screen changes yet.

### Changes Required:

#### 1. `ServiceWithStatus` contract

**File**: `libs/shared/src/lib/schemas/service-with-status.schema.ts` (new) + `libs/shared/src/index.ts`

**Intent**: A fleet-read row = a `Service` plus the derived latest-run status, nullable for "no runs".

**Contract**: `serviceWithStatusSchema = z.strictObject({ …all serviceSchema fields…, status: z.enum(['healthy','degraded','down']).nullable() })`; export `type ServiceWithStatus = z.infer<…>`. Re-export from the barrel after `service.schema` (`index.ts:29`). Reuse `serviceSchema.shape` to avoid drift rather than re-typing fields.

#### 2. `clientTable<T>` helper

**File**: `apps/web/src/app/shared/client-table.ts` (new)

**Intent**: One pure, no-DI signal helper that owns search/filter/sort/pagination so all four tables behave identically.

**Contract**: `clientTable<T>(opts: { source: Signal<T[]>; searchText: (row:T)=>string; sorters: Record<string,(row:T)=>string|number>; filters?: Record<string,(row:T,value:string)=>boolean>; initialSort?: {key:string; dir:'asc'|'desc'}; pageSize?: number })`. Returns: `query`/`setQuery`; `filterValues`/`setFilter(key,value)`; `sort`/`toggleSort(key)`; `page`/`setPage`; `pageCount()`, `total()`, `rangeLabel()` ("showing X–Y of N"); `pageRows()` (computed: filtered → sorted → sliced). Default `pageSize` 10. `toggleSort` cycles asc→desc→asc. **Reset `page` to 1 whenever query, any filter, or sort changes** (the load-bearing invariant). `'all'` filter value = predicate off. Empty source → `rangeLabel()` reads "showing 0–0 of 0", `pageCount()` ≥ 1.

#### 3. `status` util

**File**: `apps/web/src/app/shared/status.ts` (new); re-point `device-services.component.ts` / `devices.component.ts` rollup to it.

**Intent**: Single source of truth for the client status concept (`'unknown' | 'healthy' | 'degraded' | 'down'`), its canonical rank, and badge/dot Tailwind classes — removing the triple-duplicated inline maps.

**Contract**: export `type ServiceStatus`; `STATUS_RANK` with canonical order `down < degraded < healthy < unknown`; `statusFromSynthesis(status: DiagnosisSynthesis['status'] | null | undefined): ServiceStatus` (maps null/undefined → `'unknown'`); `badgeClass(s)`, `dotClass(s)`; `worstStatus(statuses: ServiceStatus[]): ServiceStatus` (host rollup = lowest canonical rank). Pure functions, merge classes via `hlm()` from `@spartan-ng/helm/utils`. Re-point the existing host-rollup callers to `worstStatus`/`STATUS_RANK` and delete their inline copies.

#### 4. Pagination helm + shared footer

**File**: generate `libs/ui/pagination/**` via spartan CLI; new `apps/web/src/app/shared/components/table-pagination.component.ts` (new, optional thin wrapper).

**Intent**: Provide the official pagination primitive and a small presentational footer bound to a `clientTable` instance so the chrome isn't re-written 4×.

**Contract**: run the spartan CLI add-pagination command (per `components.json`); confirm the `@spartan-ng/helm/pagination` alias resolves. The footer component takes the `clientTable` page/`pageCount`/`rangeLabel`/`setPage` surface as inputs and renders `‹ prev · 1 2 3 · next ›` + the range label. (If the CLI generation proves high-friction, fall back to a hand-rolled `HlmButton` footer — same component API.)

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx nx typecheck shared && npx nx typecheck web`
- Lint passes: `npx nx lint shared && npx nx lint web`
- `clientTable<T>` unit tests pass: `npx nx test web -- src/app/shared/client-table.spec.ts`
- `status` util unit tests pass: `npx nx test web -- src/app/shared/status.spec.ts`
- Shared lib builds: `npx nx build shared`

#### Manual Verification:

- `@spartan-ng/helm/pagination` import resolves and renders a basic pager in isolation.
- Status colors match the existing app voice (grey `unknown`, never green for no-runs).

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Backend aggregate `GET /api/services` + FE fleet client

### Overview

Add the fleet read that returns every service (for the authed user) with its latest-run status, and the FE client that consumes it.

### Changes Required:

#### 1. Fleet service controller

**File**: `apps/api/src/modules/service/service-aggregate.controller.ts` (new) + `service.module.ts`

**Intent**: Host the top-level `GET /api/services` route that the device-scoped `ServiceController` cannot.

**Contract**: `@Controller('services')` with one `@Get()` returning `ServiceWithStatus[]`, guarded like the other routes, resolving the authed user. Register in `service.module.ts` controllers array alongside `ServiceController`. Mirror `OverviewController` structure.

#### 2. Aggregate data method

**File**: `apps/api/src/modules/service/service.service.ts`

**Intent**: Fetch all of a user's services joined to each one's latest run status.

**Contract**: `findAllWithStatus(userId: string): Promise<ServiceWithStatus[]>` — left-join `service` to the latest `run_record` per `serviceId` (correlated subquery / `row_number()` window ordered by `createdAt DESC`), scoped to the user's devices; project via a `serviceWithStatusSchema.parse`-based mapper (extend the existing `toContract` projection with `status` = parsed `synthesis.status` or `null`). No-runs ⇒ `status: null`.

#### 3. FE fleet-services client

**File**: `apps/web/src/app/features/devices/data/` (new `fleet-services.client.ts`, co-located with the devices feature)

**Intent**: Typed read of the aggregate, zod-parsed.

**Contract**: `listAll(): Observable<ServiceWithStatus[]>` → `GET /api/services` parsed via `serviceWithStatusSchema.array()`. Provided at the component level (not root), consistent with the repo.

### Success Criteria:

#### Automated Verification:

- Service data-layer tests pass: `npx nx test api -- src/modules/service/service.service.spec.ts`
- Aggregate controller tests pass: `npx nx test api -- src/modules/service/service-aggregate.controller.spec.ts`
- Type checking passes: `npx nx typecheck api`
- Lint passes: `npx nx lint api`
- API builds: `npx nx build api`

#### Manual Verification:

- `GET /api/services` returns every service for the user with correct latest-run `status`; services with zero runs return `status: null`.
- Cross-user isolation: a second user's services are not returned.

**Implementation Note**: Pause for manual confirmation after automated verification.

---

## Phase 3: Extract `app-synthesis-card` (adopt in service-detail)

### Overview

Extract the duplicated synthesis treatment into one component and adopt it in service-detail so audit (Phase 7) can reuse it without a fourth copy.

### Changes Required:

#### 1. Synthesis card component

**File**: `apps/web/src/app/features/diagnosis/components/synthesis-card.component.ts` (new)

**Intent**: One reusable card rendering status badge + summary + problems/suggestions grid from a `DiagnosisSynthesis`.

**Contract**: standalone, `OnPush`, `input.required<DiagnosisSynthesis>()`; renders the badge via the Phase 1 `status` util, `summary` (with the existing "diagnosing…" fallback where applicable), and a `grid sm:grid-cols-2` problems `[x]` / suggestions `[+]` with `@empty` fallbacks. A `size`/`density` input may switch between the full (service-detail) and compact (audit) treatments if needed.

#### 2. Adopt in service-detail

**File**: `apps/web/src/app/features/services/service-detail.component.{ts,html}`

**Intent**: Replace the inline canonical markup (`service-detail.component.html:141-187`) with `<app-synthesis-card>`, removing its local `badgeClass`/`BADGE_CLASS`.

**Contract**: same rendered output; no behavior change to the diagnose surface.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx nx typecheck web`
- Lint passes: `npx nx lint web`
- Web unit tests pass: `npx nx test web`

#### Manual Verification:

- Service-detail diagnose surface renders identically (badge color, summary, problems/suggestions, empty states) — no visual regression.

**Implementation Note**: Pause for manual confirmation after automated verification.

---

## Phase 4: `/devices` → fleet "all services" table

### Overview

Replace the per-device cards and the `device-services` sub-list with one fleet table fed by the aggregate endpoint.

### Changes Required:

#### 1. Devices page → fleet table

**File**: `apps/web/src/app/features/devices/devices.component.{ts,html}`

**Intent**: Render one helm table of every service across the fleet, with host filtering and per-host actions; drop the per-device card chrome and the parent/child `statusChange` dance.

**Contract**:
- **Data**: provide + load `FleetServicesClient.listAll()` into a `signal<ServiceWithStatus[]>`; keep `DevicesStore` for the host strip + device CRUD. Feed services into `clientTable`.
- **Host filter strip** (chips above the table): `all hosts · {N} services`, then one chip per device with a worst-status dot (`worstStatus` over that device's service statuses) + service count. Selecting a chip sets a host filter; "all hosts" clears it.
- **Active-host action bar** (only when a host is selected): `managing {device} · {host}` with `scan` (`ScanServicesDialog`), `edit host` (`DeviceFormDialog`), `delete host` (alert-dialog → `DevicesStore.remove`). `+ add device` lives in the page header (always visible).
- **Toolbar**: `HlmInput` search (service / container / host) + status `Select` (all / healthy / degraded / down / **unknown**).
- **Columns**: status dot (sortable, canonical rank) · Service (sort) · Device (sort) · Container (sort) · Compose (`compose · {project}` or `standalone`) · Actions. Default sort = status, worst first.
- **Actions cell**: `Edit` (`RenameServiceDialog`) + `Delete` (confirm → `ServicesStore.remove(deviceId,id)`), both `event.stopPropagation()`. Row (`role="link"`, `tabindex="0"`, click + `keydown.enter`/`space`) navigates to `['/devices', deviceId, 'services', serviceId]`.
- **Pagination** footer (size 10) + `showing X–Y of N`.
- **Empty states**: no devices → existing empty card; filters match nothing → muted "no services match these filters."

#### 2. Remove dead sub-list

**File**: `apps/web/src/app/features/services/components/device-services.component.*` (delete) and its wiring in `devices.component`.

**Intent**: The fleet table subsumes the per-device list; remove the component and the now-dead status-emit plumbing.

**Contract**: no remaining references; `ServicesStore` (still used for row Edit/Delete) and `DiagnosisStore` providers relocated/removed as appropriate. Service-detail route and its own diagnose stream are untouched.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx nx typecheck web`
- Lint passes: `npx nx lint web`
- Web unit tests pass: `npx nx test web`
- No dangling references to `device-services`: `! grep -rn "device-services" apps/web/src`

#### Manual Verification:

- `/devices` shows one fleet table; host strip filters; selecting a host reveals scan/edit/delete; `+ add device` in header works.
- Status-first default sort surfaces broken services first; `unknown` rows are grey.
- Row click + keyboard navigate to service-detail; Devices nav stays active; Edit/Delete don't navigate.
- Search/filter/sort reset to page 1; range label accurate. No per-device cards/sub-lists remain.

**Implementation Note**: Pause for manual confirmation after automated verification.

---

## Phase 5: `/skills` → datatable

### Overview

Wrap the existing `SkillsStore.skills()` in `clientTable` and render a helm table.

### Changes Required:

#### 1. Skills datatable

**File**: `apps/web/src/app/features/skills/skills.component.{ts,html}`

**Intent**: Replace the hand-rolled bordered table with the shared datatable chrome.

**Contract**:
- **Toolbar**: search (name / command) + scope `Select` (all / global / host-scoped).
- **Columns**: Name (sort) · Scope (sort; `HlmBadge` — "global" vs device name, outlined differently for global vs host; reuse `scopeLabel(skill)`) · Command (mono, truncated) · Params (sort; `skill.parameters.length`) · Actions (Edit/Delete via existing `SkillFormDialog` + alert-dialog confirm).
- **Pagination** (10) + range label. Reuse the existing delete-confirm pattern.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx nx typecheck web`
- Lint passes: `npx nx lint web`
- Web unit tests pass: `npx nx test web`

#### Manual Verification:

- Search + scope filter + sortable headers + pagination work; page resets to 1 on change; Edit/Delete dialogs still function.

**Implementation Note**: Pause for manual confirmation after automated verification.

---

## Phase 6: `/providers` → datatable

### Overview

Replace the card stack with a datatable; preserve the single-active-provider invariant (read `provider.active`, call `activate(id)`).

### Changes Required:

#### 1. Providers datatable

**File**: `apps/web/src/app/features/llm-providers/llm-providers.component.{ts,html}`

**Intent**: Datatable over `LlmProvidersStore.providers()`.

**Contract**:
- **Toolbar**: search (endpoint / model) + status `Select` (all / active / inactive).
- **Columns**: Status (dot + active/inactive) · Endpoint (`baseURL`, sort) · Model (sort) · Updated (sort, **default desc**) · Actions (`Activate` when inactive → `store.activate(id)`; Edit; Delete via existing provider dialog + confirm).
- **Pagination** (10).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx nx typecheck web`
- Lint passes: `npx nx lint web`
- Web unit tests pass: `npx nx test web`

#### Manual Verification:

- Search + status filter + sort (default Updated desc) + pagination work; Activate flips the active row; exactly one provider stays active; Edit/Delete function.

**Implementation Note**: Pause for manual confirmation after automated verification.

---

## Phase 7: `/audit` → datatable (expandable synthesis)

### Overview

Datatable over `AuditStore.events()` with a new Result column and the extracted synthesis-card in the expandable row; reuse the store's existing `select(id)` single-row toggle.

### Changes Required:

#### 1. Audit datatable

**File**: `apps/web/src/app/features/audit/audit.component.{ts,html}`

**Intent**: Replace the table-ish stack with the shared datatable + expansion.

**Contract**:
- **Toolbar**: search (action / target) + action `Select` built from the distinct `action` values present in the loaded events.
- **Columns**: Time (sort, **default desc**) · Action (sort) · Target (`{targetType} · {targetId}`) · Result (colored — `skill.run` → `metadata.outcome` succeeded/failed; run-linked → `synthesis.status`; this Result column is **new** — `metadata.outcome` is unrendered today) · Detail (`view`/`hide`, only when a `synthesis` exists).
- **Expandable row** (events with a `synthesis`): `<app-synthesis-card>` (compact variant) — status badge + summary + problems/suggestions. One open at a time via `store.select(id)`. Expansion scoped to the visible page.
- **Pagination** (10).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx nx typecheck web`
- Lint passes: `npx nx lint web`
- Web unit tests pass: `npx nx test web`

#### Manual Verification:

- Search + action filter + sort (default Time desc) + pagination work; rows with `synthesis` expand to the synthesis-card; one open at a time; Result column shows outcome/status colored correctly.

**Implementation Note**: Pause for manual confirmation after automated verification.

---

## Phase 8: Compact density, cleanup & full verification

### Overview

Make density consistent across all four tables, remove any remaining dead code, and run the full gate.

### Changes Required:

#### 1. Density pass

**File**: the four table templates + shared footer/toolbar.

**Intent**: Apply compact density consistently — header `text-xs uppercase tracking-wide text-muted-foreground`, body rows ~`py-1.5 text-sm`, inputs/selects `h-9`, small action buttons — using spartan tokens / `op-*` voice only, classes merged via `hlm()`.

**Contract**: visual-only; no behavior change.

#### 2. Cleanup

**File**: repo-wide.

**Intent**: Remove dead status-helper duplicates, unused imports, and any leftover per-device card code; run `npm run format` (prettier-plugin-tailwindcss orders classes).

**Contract**: no dead references; consistent formatting.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type checking passes (all projects): `npx nx run-many -t typecheck`
- All tests pass: `npm run test`
- Build passes: `npm run build`
- Formatting clean: `npm run format:check`

#### Manual Verification:

- All four tables are visually compact and consistent.
- No regressions on overview / service-detail.

**Implementation Note**: Final phase — confirm the full suite is green and the four screens behave per acceptance criteria.

---

## Testing Strategy

### Unit Tests:

- `clientTable<T>` (`client-table.spec.ts`): filter narrows rows; sort toggles asc→desc→asc; status sorter respects canonical rank; **page resets to 1** on query/filter/sort change; `rangeLabel`/`pageCount`/`total` accurate incl. empty source; `'all'` filter = off.
- `status` util (`status.spec.ts`): `statusFromSynthesis(null) === 'unknown'`; `STATUS_RANK` ordering; `worstStatus` picks the worst (down) and handles all-unknown.
- Aggregate endpoint (`service.service.spec.ts` + `service-aggregate.controller.spec.ts`): latest-run status per service; no-runs ⇒ `null`; multiple runs ⇒ newest wins; cross-user isolation.

### Integration / Manual Testing Steps:

1. `/devices`: filter by host, select a host → scan/edit/delete; `+ add device`; status-first sort; row → service-detail; search/sort/filter reset to page 1.
2. `/skills`, `/providers`, `/audit`: search + the column filter + sortable headers + pagination; audit expands synthesis; provider Activate keeps one active.
3. Confirm no per-device cards/sub-lists remain and overview/service-detail are unaffected.

## Performance Considerations

The aggregate `GET /api/services` is a single query backed by the `(serviceId, createdAt DESC)` index; it replaces the previous N+M fan-out concern entirely. Client tables operate on tens–low-hundreds of rows — client-side filter/sort/slice is comfortably within budget.

## Migration Notes

No data migration. The new endpoint is additive; the device-scoped service routes remain. Deleting `device-services.component.*` is the only removal — verify no other feature imports it.

## References

- **Visual design reference (open in browser):** `mockups/design_handoff_list_redesign/reference/OpsPilot.list-redesign.dc.html` (= `mockups/index.html`) — layout/behavior only, do not copy markup
- Design handoff prompt (source of `change.md`): `mockups/design_handoff_list_redesign/CLAUDE_CODE_PROMPT.md`
- Current-app snapshot for orientation: `mockups/apps/web/src/app/features/**` (pre-redesign component copies)
- Research: `context/changes/list-redesign-datatables/research.md`
- Task brief: `context/changes/list-redesign-datatables/change.md`
- Canonical synthesis card to extract: `apps/web/src/app/features/services/service-detail.component.html:141-187`
- Fleet controller precedent: `apps/api/src/modules/overview/overview.controller.ts:10`
- Aggregate data layer anchor: `apps/api/src/modules/service/service.service.ts:37,67-70,203-214`
- Helm table usage: `apps/web/src/app/features/services/dialogs/scan-services.dialog.html:18-52`
- Delete-confirm pattern: `apps/web/src/app/features/devices/devices.component.html:82-95`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared foundation (contract · clientTable · status util · pagination helm)

#### Automated

- [x] 1.1 Type checking passes: `npx nx typecheck shared && npx nx typecheck web` — f48f935
- [x] 1.2 Lint passes: `npx nx lint shared && npx nx lint web` — f48f935
- [x] 1.3 `clientTable<T>` unit tests pass — f48f935
- [x] 1.4 `status` util unit tests pass — f48f935
- [x] 1.5 Shared lib builds: `npx nx build shared` — f48f935

#### Manual

- [x] 1.6 `@spartan-ng/helm/pagination` resolves and renders in isolation — f48f935
- [x] 1.7 Status colors match app voice (grey unknown, never green) — f48f935

### Phase 2: Backend aggregate GET /api/services + FE fleet client

#### Automated

- [x] 2.1 Service data-layer tests pass — 198dc91
- [x] 2.2 Aggregate controller tests pass — 198dc91
- [x] 2.3 Type checking passes: `npx nx typecheck api` — 198dc91
- [x] 2.4 Lint passes: `npx nx lint api` — 198dc91
- [x] 2.5 API builds: `npx nx build api` — 198dc91

#### Manual

- [x] 2.6 `GET /api/services` returns correct latest status; no-runs ⇒ null — 198dc91
- [x] 2.7 Cross-user isolation verified — 198dc91

### Phase 3: Extract app-synthesis-card (adopt in service-detail)

#### Automated

- [x] 3.1 Type checking passes: `npx nx typecheck web` — 73a46a9
- [x] 3.2 Lint passes: `npx nx lint web` — 73a46a9
- [x] 3.3 Web unit tests pass — 73a46a9

#### Manual

- [x] 3.4 Service-detail diagnose surface renders identically (no regression) — 73a46a9

### Phase 4: /devices fleet "all services" table

#### Automated

- [x] 4.1 Type checking passes: `npx nx typecheck web`
- [x] 4.2 Lint passes: `npx nx lint web`
- [x] 4.3 Web unit tests pass
- [x] 4.4 No dangling `device-services` references

#### Manual

- [x] 4.5 Fleet table + host strip + per-host actions + header add-device work
- [x] 4.6 Status-first sort; unknown rows grey
- [x] 4.7 Row click/keyboard → service-detail; Edit/Delete don't navigate; Devices nav active
- [x] 4.8 Search/filter/sort reset to page 1; range label accurate; no cards/sub-lists remain

### Phase 5: /skills datatable

#### Automated

- [ ] 5.1 Type checking passes: `npx nx typecheck web`
- [ ] 5.2 Lint passes: `npx nx lint web`
- [ ] 5.3 Web unit tests pass

#### Manual

- [ ] 5.4 Search + scope filter + sort + pagination work; dialogs function

### Phase 6: /providers datatable

#### Automated

- [ ] 6.1 Type checking passes: `npx nx typecheck web`
- [ ] 6.2 Lint passes: `npx nx lint web`
- [ ] 6.3 Web unit tests pass

#### Manual

- [ ] 6.4 Search + status filter + sort (Updated desc) + pagination; Activate keeps one active

### Phase 7: /audit datatable (expandable synthesis)

#### Automated

- [ ] 7.1 Type checking passes: `npx nx typecheck web`
- [ ] 7.2 Lint passes: `npx nx lint web`
- [ ] 7.3 Web unit tests pass

#### Manual

- [ ] 7.4 Search + action filter + sort (Time desc) + pagination; synthesis expands; Result column correct

### Phase 8: Compact density, cleanup & full verification

#### Automated

- [ ] 8.1 Lint passes: `npm run lint`
- [ ] 8.2 Type checking passes (all projects): `npx nx run-many -t typecheck`
- [ ] 8.3 All tests pass: `npm run test`
- [ ] 8.4 Build passes: `npm run build`
- [ ] 8.5 Formatting clean: `npm run format:check`

#### Manual

- [ ] 8.6 All four tables visually compact + consistent
- [ ] 8.7 No regressions on overview / service-detail
