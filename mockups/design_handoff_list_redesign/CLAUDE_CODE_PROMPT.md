# Claude Code task — Make the list-heavy screens scannable: a fleet **services datatable** + datatables for skills / providers / audit

## Role & goal
You are working in the OpsPilot web app (`apps/web`, Angular standalone, zoneless,
`@ngrx/signals`, spartan-ng **helm** UI). After the previous refactor, `/devices` is a
per-device list where each device renders its services as a slim sub-list, and `/skills`,
`/providers`, `/audit` are plain stacks of `<div>`/cards. **None of these scale.** A host
with 25+ services is unusable, there is no search / sort / pagination anywhere, and
finding one service across the fleet means scanning host by host.

**Bring one client-side datatable pattern — search · sort · per-column filter · client
pagination — to four screens, and turn `/devices` into a single fleet-wide services
table.**

1. **`/devices`** → one **"all services" fleet table** across every device, with a **host
   filter strip** and per-host actions. Replaces the per-device cards and the per-device
   services sub-lists.
2. **`/skills`**, **`/providers`**, **`/audit`** → **datatables** with the same toolbar
   (search + a column filter) + sortable headers + client pagination. Audit keeps its
   expandable synthesis row.

Density is **compact** throughout.

A visual reference prototype is in `reference/OpsPilot.list-redesign.dc.html` (open it in a
browser; navigate via the sidebar to devices / skills / providers / audit). **It is an
HTML design reference only — do not copy its markup or its monospace styling.** Recreate
the *layout and behavior* using the app's existing Angular components, spartan-ng helm
primitives, and Tailwind utility classes.

---

## Hard constraints (follow the repo's conventions)
- Angular **standalone** components, `ChangeDetectionStrategy.OnPush`, **zoneless**.
- State in `@ngrx/signals` `signalState` stores, mutated via `patchState`; **stores and
  HTTP clients are provided at the feature/component level (NOT `providedIn: 'root'`).**
- Dialogs render in a CDK overlay outside the component injector, so the **store instance
  is passed via dialog context** (keep this pattern — `DeviceFormDialog`,
  `RenameServiceDialog`, `ScanServicesDialog`, and the skill/provider form dialogs).
- UI strictly from **spartan-ng helm** + Tailwind. No new styling system, no hand-rolled
  CSS. Tables use the helm table primitives (`HlmTable*`); search uses `HlmInput`; the
  filter dropdowns use the spartan **Select** (`brn-select` + `hlm-select`); pagination
  uses the spartan **Pagination** helm (`hlm-pagination*`) — or, if the team hasn't added
  it yet, a minimal `‹ prev · 1 2 3 · next ›` footer built from `HlmButton`.
- All data flows through `@opspilot/shared` contracts (zod-parsed in the clients).
- Keep the existing comment style/voice. Respect `angular.md` and `sse.md` if present.
- Run `lint`, `typecheck`, `test`, and `build` before finishing; fix what you add.

### Search / sort / filter / pagination are **client-side**
These lists are small-to-medium (tens, low hundreds). Do **not** add server-side paging or
sorting. Everything filters/sorts/pages in the browser from the already-loaded collection.

---

## Reusable client-table helper (build once, use 4×)
Create one small signal-based utility so all four tables share identical behavior and you
don't reimplement paging/sorting per screen.

```ts
// e.g. apps/web/src/app/shared/client-table.ts  (feature-level util; NOT providedIn root)
export function clientTable<T>(opts: {
  source: Signal<T[]>;                              // the loaded rows
  searchText: (row: T) => string;                  // concatenated haystack for free-text search
  sorters: Record<string, (row: T) => string | number>;  // key -> comparable
  filters?: Record<string, (row: T, value: string) => boolean>; // key -> predicate ('all' = off)
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  pageSize?: number;                               // default 10
}) {
  // returns: query (signal), setQuery; filterValues (signal), setFilter(key, value);
  //          sort (signal {key,dir}), toggleSort(key);
  //          page (signal), setPage; pageCount(), total(), rangeLabel();  // "showing X–Y of N"
  //          pageRows()  // computed: filtered -> sorted -> sliced
}
```

- Toggling a header sets `dir` asc→desc (then asc again); **reset `page` to 1** whenever
  query, any filter, or sort changes.
- **Status sort rank:** `down(0) < degraded(1) < healthy(2) < unknown(3)` so the default
  status sort surfaces what's broken first.
- If `@tanstack/angular-table` is **already** a dependency (spartan's own table examples
  use it), prefer wiring its row model instead of hand-rolling — but keep the same
  toolbar + pagination chrome described here.

---

## Data model facts you must respect (recap — unchanged)
- `Service { id, name, containerName, composePath: string|null, composeProject: string|null, deviceId }`
  — **still NO `status`/`outcome` field.** Derive status from the **latest run**
  (`DiagnosisStore.entry(serviceId).runs[0]?.synthesis.status`); **no runs → `unknown`**
  (neutral/grey, never green). A device/host status = **worst** across its services
  (`down > degraded > healthy > unknown`).
- `Device { id, name, host, createdAt, updatedAt, agentContext }`.
- `Skill { id, name, commandTemplate, deviceId: string|null, timeoutMs: number|null, parameters: {name, source:'input'|'service', required}[] }`
  — `deviceId === null` ⇒ **global**; otherwise **host-scoped** to that device.
- `LlmProvider { id, baseURL, model, kind:'openai-compatible', updatedAt }` — **no name;
  `baseURL` is the title**; exactly one is **active** (the active id lives in the providers
  store).
- `AuditEvent { id, action, targetType: string|null, targetId: string|null, createdAt, synthesis?, metadata? }`
  — `action` is a **closed enum** (`diagnose.run`, `skill.run`, `service.scan`,
  `device.create`, `llmProvider.activate`, …); `skill.run` carries `metadata.outcome`
  (`succeeded`/failed); `diagnose.run` carries a `synthesis`
  (`{ status, summary, problems[], suggestions[] }`).

---

## Existing APIs to reuse (find the real names in the repo; don't rebuild)
- From the previous task: `DevicesStore` (`load`, `remove`, `devices()`, `isEmpty()`),
  `ServicesStore` per device (`load(deviceId)`, `services()`, `remove`, `rename`,
  `runScan`), `DiagnosisStore` (`loadRuns(deviceId, serviceId)`, latest status =
  `entry(serviceId).runs[0]?.synthesis.status`). Dialogs: `DeviceFormDialog`,
  `RenameServiceDialog` (service "Edit"), `ScanServicesDialog`.
- The **service-detail route** `['/devices', deviceId, 'services', serviceId]` already
  exists — **keep it; the fleet table's rows link to it.**
- Skills / providers / audit each already have a feature store + (for skills/providers) a
  form dialog and create/edit/delete + `activate(id)` (providers). Locate the actual
  `*Store` / `*Client` / `*FormDialog` and reuse them.

---

## Work breakdown (do in this order)

### 1. `/devices` → fleet "all services" table
Replace the per-device cards (`devices.component.*`) and fold the per-device
`device-services` list into **one** table.

- **Aggregate services across the fleet.** Prefer a fleet read (`GET /services` returning
  every service incl. `deviceId`) parsed via `@opspilot/shared`; if none exists, fan-out
  `ServicesStore.load(deviceId)` for each device and flatten in a `computed`. Resolve each
  service's latest-run status (a lightweight per-service "latest status" read, or
  `DiagnosisStore.loadRuns`); unknown → grey.
- **Host filter strip** (chips, above the table): `all hosts · {N} services`, then one chip
  per device showing a worst-status dot + service count. Selecting a chip filters the table
  to that device; "all hosts" clears the host filter.
- **Host action bar** (always rendered, directly under the chips): when a specific host is
  selected it shows `managing {device} · {host}` + `scan` (`ScanServicesDialog`), `edit
  host` (`DeviceFormDialog`), `delete host` (alert-dialog confirm → `DevicesStore.remove`);
  when **all hosts** is selected it shows a muted hint — *"select a host above to scan it
  for new services, or edit / remove the host"* — so the per-host **scan** action stays
  discoverable. `+ add device` lives in the **page header** (always visible).
- **Toolbar:** `HlmInput` search (matches service / container / host) + a status `Select`
  (all / healthy / degraded / down).
- **Columns:** status dot (sortable) · **Service** (sortable) · **Device** (sortable) ·
  **Container** (sortable) · Compose (`compose · {project}` or `standalone`) · Actions.
  **Default sort = status, worst first.**
- **Actions cell:** `Edit` (`RenameServiceDialog`) + `Delete` (confirm → `ServicesStore.remove`),
  both `event.stopPropagation()`. The **row** (anywhere else) navigates to the service-detail
  route; keep it keyboard-accessible (link semantics) and the Devices nav item active.
- **Pagination** footer (page size 10) + `showing X–Y of N`.
- Empty states: no devices at all → the existing empty card; filters match nothing →
  muted "no services match these filters."

> This removes the per-device card chrome and the per-device sub-list entirely. Device CRUD
> + scan now live in the page header (`+ add device`) and the active-host action bar.

### 2. `/skills` → datatable
- **Toolbar:** search (name / command) + scope `Select` (all / global / host-scoped).
- **Columns:** **Name** (sort) · **Scope** (sort; `HlmBadge` — "global" vs the device name,
  outlined differently for global vs host) · Command (mono, truncated) · **Params** (sort;
  parameter count) · Actions (Edit/Delete via the existing skill dialog + confirm).
- **Pagination** (10) + range label.

### 3. `/providers` → datatable
- **Toolbar:** search (endpoint / model) + status `Select` (all / active / inactive).
- **Columns:** Status (dot + active/inactive) · **Endpoint** (`baseURL`, sort) · **Model**
  (sort) · **Updated** (sort, **default desc**) · Actions (`Activate` when inactive → store
  `activate(id)`; Edit; Delete). Exactly one provider is active.
- **Pagination** (10).

### 4. `/audit` → datatable (keep the expandable synthesis)
- **Toolbar:** search (action / target) + action `Select` built from the distinct `action`
  values present.
- **Columns:** **Time** (sort, **default desc**) · **Action** (sort) · Target
  (`{targetType} · {targetId}`) · Result (colored — `skill.run` outcome, or the synthesis
  status) · Detail (`view`/`hide`, only when a `synthesis` exists).
- **Expandable row** for events with a `synthesis`: status badge + summary + a two-column
  **Problems** / **Suggestions** grid — reuse the existing synthesis card treatment from the
  diagnose surface. (One open at a time is fine.)
- **Pagination** (10). Expansion is scoped to the visible page.

### 5. Compact density (all four tables)
Tighten consistently: header `text-xs uppercase tracking-wide text-muted-foreground`, body
rows ~`py-1.5 text-sm`, inputs/selects `h-9`, action buttons small. Use spartan tokens —
no custom CSS.

---

## Acceptance criteria
- `/devices` is a **single fleet table** of every service (status · service · device ·
  container · compose · Edit/Delete) with: a host filter strip, per-host `scan / edit host /
  delete host` on the selected host, `+ add device` in the header, **status-first** default
  sort, client search/sort/filter/pagination, and rows that navigate to the existing
  service-detail route (Devices nav stays active). No per-device cards or sub-lists remain.
- `/skills`, `/providers`, `/audit` are **datatables** with search + one column filter +
  sortable headers + client pagination; audit rows that have a `synthesis` still expand to
  problems/suggestions.
- All four use the **one** `clientTable` helper; **page resets to 1** on query/filter/sort
  change; `showing X–Y of N` is accurate.
- Service status is still **derived from the latest run** — no `Service.status` invented on
  the client; no-runs renders grey `unknown` everywhere (never green).
- Density is **compact**. UI is **spartan-ng helm + Tailwind only**. `lint`, `typecheck`,
  `test`, `build` all pass.

## Out of scope
- **Overview** and **service-detail** are unchanged (other than the devices list no longer
  rendering per-device sub-lists).
- **No** server-side paging/sorting — client-side only.
- No backend/contract changes beyond (optionally) a fleet `GET /services` and/or a
  lightweight per-service "latest status" read, parsed through `@opspilot/shared`.
- Don't redesign the dialogs/forms — reuse the existing create/edit/scan/rename dialogs.
