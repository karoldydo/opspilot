# Devices Slim List + Service Detail Page — Implementation Plan

## Overview

Split the overloaded `/devices` screen into two levels: a **slim inventory list** (devices with
their services as `status · name · container · Edit/Delete` rows, the row navigating into the
service) and a **new Service Detail page** at `/devices/:deviceId/services/:serviceId` that owns
everything operational — identity header, Operations (skills), Diagnose (the SSE agent run +
problems/suggestions), and Run history. The existing `diagnose-hero` drill-in is retired in favor
of the detail page.

## Current State Analysis

- **`/devices` list** (`DevicesComponent` → embeds `DeviceServicesComponent`) carries everything:
  per-row Diagnose button, "open →" drill-in, N skill buttons, an inline diagnosis result panel,
  problems/suggestions grid, and a recent-runs replay strip. It is unreadable.
- **`DiagnoseHeroComponent`** (`/devices/:deviceId/services/:serviceId/diagnose`) already implements
  ~90% of the target detail page: provides `DiagnosisClient`/`DiagnosisStore`, reads route ids as
  signals, loads runs via a guarded effect, exposes `rerun()`/`replay()`, owns the `BADGE_CLASS` /
  `DOT_CLASS` / `STEP_CLASS` maps and the terminal render. It takes service name/container from
  **query params** only because no single-service read exists.
- **Data layer is complete and reusable**: `DiagnosisStore.{entry, stream, replay, loadRuns}`
  (`runs[0]` is newest, confirmed), `ServicesStore`, `SkillRunStore`, and `ServiceSkillsComponent`
  (`app-service-skills`, self-contained, effect-loaded). Stores self-refetch on mutation.
- **`Service` has no `status`** by contract (`service.schema.ts` — "stable identity only"). Status
  is derived from the latest run; `unknown` (grey) is a **client-side-only** notion (the wire enum
  is strictly `healthy | degraded | down`).
- **API gap**: `apps/api` has no `@Get('services/:serviceId')` — but `ServiceService.findOne`
  already exists and 404s on absent/cross-device. `ServicesClient` has no `getService`.
- **Nav active state is free**: the `devices` nav item is `exact: false`
  (`layout.component.ts:44`), so any `/devices/**` route keeps "Devices" highlighted.

## Desired End State

- `/devices` shows devices with a **slim** services list: `status dot · Name · Container · status
  label · Edit/Delete only`. No diagnose/skills/inline panels in the list.
- Clicking a service row navigates to `/devices/:deviceId/services/:serviceId`; "Devices" nav stays
  active. The detail page can run a live diagnosis, show problems/suggestions, run every in-scope
  skill, replay a past run, and rename/delete the service (delete returns to `/devices`).
- On entry the detail seeds from the **latest run** (if any) without auto-streaming, plus a
  **Re-run** button; a service with no runs shows neutral `unknown` everywhere (never green).
- A small **device status dot** sits next to each device name (worst of its services' latest-run
  statuses, grey when unknown/empty).
- `diagnose-hero` (component + `/diagnose` route) is gone; no dangling references.
- `lint`, `typecheck`, `test`, `build` all pass. No `Service.status` invented on the client.

### Key Discoveries:

- `apps/web/src/app/features/diagnosis/diagnose-hero.component.ts:44,69-126` — the reference
  implementation to mirror (providers, route-id signals, `view`/`leadSteps`/`doneStep` computeds,
  `runsEffect`, `rerun`/`replay`, `badgeClass`/`dotClass`/`stepClass`).
- `apps/web/src/app/features/services/components/device-services.component.{ts,html}` — the slim
  target; **keep** `loadEffect`, `runsEffect`, `BADGE_CLASS`/`DOT_CLASS`, Edit (`openRename`),
  Delete (`#deleteDialog` + `requestDelete`/`confirmDelete`); **remove** the diagnose panel
  (`.html:82-164`), `diagnose()`/`replay()` handlers, the `app-service-skills` usage, and "open →".
- `apps/api/src/modules/service/service.controller.ts:30,57-75` — `@Controller('devices/:deviceId')`
  with `@Patch`/`@Delete('services/:serviceId')`; add a sibling `@Get('services/:serviceId')`.
  `ServiceService.findOne(deviceId, id)` already exists (service.service.ts:74).
- `apps/web/src/app/features/services/data/services.client.ts:27-31` — add `getService` mirroring
  `listServices` (parse through `serviceSchema`).
- `apps/web/src/app/app.routes.ts:26-33` — the `/diagnose` route to replace with the detail route
  (nested under a `devices` children array).

## What We're NOT Doing

- No backend/contract changes beyond the single-service GET (returns the existing `Service`; no new
  shared schema). No `Service.status` field on client or server.
- No device-**detail** page (only **service** detail). Scan stays a device-level action on the list.
- No restyle of other features (overview/skills/providers/audit) beyond wiring navigation.
- No batch "latest status per service" server read — per-service `loadRuns` is accepted for the dot.
- No auto-streaming on detail entry; diagnosis starts only on explicit Re-run.

## Implementation Approach

Build bottom-up and in dependency order so each phase is independently verifiable and the retired
component is only deleted once its last inbound reference is gone:

1. Land the single-service read (API + client) so the detail page can resolve a deep-linked service.
2. Build the new `ServiceDetailComponent` (a generalization of `diagnose-hero`) and add its route;
   leave `diagnose-hero` alive so nothing breaks mid-flight.
3. Slim `device-services` and point the row at the new detail route (this removes the last `/diagnose`
   "open →" link).
4. Add the device-level status dot (cross-component wiring from the slimmed child to the parent).
5. Retire `diagnose-hero` (component + route), clean up dead references, run the full gate.

All UI strictly from spartan-ng helm + Tailwind utilities; status styling reuses the existing
`BADGE_CLASS`/`DOT_CLASS`/`op-*` token maps. All data flows through `@opspilot/shared` contracts.

## Critical Implementation Details

- **Device status dot crosses a store boundary.** `DiagnosisStore` is provided **per
  `DeviceServicesComponent`** (keyed to that device's services), so the parent `DevicesComponent`
  cannot read it. The slimmed child must compute its worst-of-services status (`down > degraded >
  healthy > unknown`) as a `computed()` and surface it to the parent via an `output()`; the parent
  keeps a `Record<deviceId, status>` signal updated on emit and renders the dot next to the name.
  Do **not** lift `DiagnosisStore` to the parent — per-device scoping is deliberate so concurrent
  rows don't clobber state.
- **Never read a required input in the constructor.** Route ids (`deviceId`/`serviceId`) and
  `Service`/runs loading must run from named `effect()`s keyed off the route-id signals (the NG0950
  lesson — `ServiceSkillsComponent` and `DeviceServicesComponent` already comply).
- **`unknown` is client-only.** It is not in the wire enum; the `BADGE_CLASS`/`DOT_CLASS` maps are
  keyed on `healthy|degraded|down`, so the `unknown` (grey) case needs an explicit fallback branch
  in the template/computed — never index the maps with `unknown`.
- **Seed without re-streaming.** On entry, after `loadRuns`, render `runs[0]?.synthesis` as a
  passive "last run · {date}" result (extend the `view` computed to `result ?? partial ??
  runs[0]?.synthesis`, or `replay(runs[0])`). A fresh `stream(...)` only on explicit Re-run.
- **ISO timestamps.** `RunRecord.createdAt` is an ISO string on the wire — render with the `date`
  pipe, don't expect a `Date`.

## Phase 1: Single-service read (API + client)

### Overview

Expose `GET /api/devices/:deviceId/services/:serviceId` and a `ServicesClient.getService` so the
detail page can resolve a deep-linked/refreshed service without loading the whole list.

### Changes Required:

#### 1. Service controller route

**File**: `apps/api/src/modules/service/service.controller.ts`

**Intent**: Add a single-service GET that delegates to the existing `ServiceService.findOne`
(already 404s on absent/cross-device). Controller stays thin.

**Contract**: New handler `@Get('services/:serviceId')` taking `@Param('deviceId')` +
`@Param('serviceId')`, returning `Promise<Service>` via `serviceService.findOne(deviceId, serviceId)`.
Sibling of the existing `@Patch`/`@Delete('services/:serviceId')`.

#### 2. ServicesClient single-fetch

**File**: `apps/web/src/app/features/services/data/services.client.ts`

**Intent**: Add `getService(deviceId, serviceId)` that GETs the new route and parses through the
shared contract.

**Contract**: `getService(deviceId: string, serviceId: string): Promise<Service>` →
`GET /api/devices/${deviceId}/services/${serviceId}` then `serviceSchema.parse(row)` — mirrors
`listServices` exactly (single object, not array).

#### 3. Tests

**File**: `apps/api/src/modules/service/service.controller.spec.ts` (and client/store specs if a
matching pattern exists)

**Intent**: Cover the new route delegating to `findOne` and the 404 path; cover the client parse.

**Contract**: One spec asserting `findOne` is called with `(deviceId, serviceId)` and its result is
returned; one asserting a 404 from the service propagates.

### Success Criteria:

#### Automated Verification:

- [ ] Typecheck passes: `npx nx typecheck api` (and `web`)
- [ ] API tests pass: `npx nx test api`
- [ ] Lint passes: `npx nx lint api web`

#### Manual Verification:

- [ ] `GET /api/devices/:deviceId/services/:serviceId` returns the service for a valid pair and
      404s for an absent/cross-device id.

---

## Phase 2: ServiceDetailComponent + route

### Overview

Create the new standalone OnPush `ServiceDetailComponent` (a generalization of `diagnose-hero`) and
register its route as a child of `devices`. `diagnose-hero` stays alive this phase.

### Changes Required:

#### 1. ServiceDetailComponent

**File**: `apps/web/src/app/features/services/service-detail.component.{ts,html}`

**Intent**: Own the full service operational surface, mirroring `diagnose-hero`'s store/stream
lifecycle and adding: `Service` identity resolution, seed-from-latest-run, Operations, Edit/Delete.

**Contract**: Standalone, `ChangeDetectionStrategy.OnPush`,
`providers: [ServicesClient, ServicesStore, DiagnosisClient, DiagnosisStore]`. Route ids as signals
(`paramMap` + `toSignal`). Named effects (never constructor): one resolves the `Service` via
`ServicesClient.getService(deviceId, serviceId)` into a local signal (handle loading/not-found/error);
one calls `DiagnosisStore.loadRuns(deviceId, serviceId)` (guarded). `view = computed(result ??
partial ?? runs[0]?.synthesis)`; `rerun()` → `stream(...)`; `replay(run)` → `replay(...)`. Reuse the
`BADGE_CLASS`/`DOT_CLASS`/`STEP_CLASS` maps and `badgeClass`/`dotClass`/`stepClass` helpers from
`diagnose-hero` (with an explicit `unknown`/grey fallback branch).

Layout (top → bottom), helm + Tailwind only:
  1. **Breadcrumb** — `Devices / {deviceName} / {serviceName}` (Devices links to `/devices`).
  2. **Identity header** — name + status `HlmBadge` (latest run / live result), meta line
     (`container`, `@ {device} · {host}`, compose info or "standalone container"), right-aligned
     **Edit** (`RenameServiceDialog` via `HlmDialogService`, store-via-context) + **Delete** (inline
     `<hlm-alert-dialog>` confirm → on success navigate to `/devices`).
  3. **Operations** — `<app-service-skills [deviceId] [service] />` verbatim; muted "no operations
     in scope" empty state when none visible.
  4. **Diagnose** — live stream (`entry.loading`/`partial`) + result card (status badge + summary +
     two-column Problems/Suggestions grid); **Re-run** button in the section header (label
     `Diagnosing…` while loading); passive latest-run labeled `last run · {date}`.
  5. **Run history** — `entry.runs` as clickable chips → `replay(run)` (static render, no re-stream).

#### 2. Detail route

**File**: `apps/web/src/app/app.routes.ts`

**Intent**: Add the detail route under `/devices` so the nav item stays active. Keep the existing
`/diagnose` route for now (removed in Phase 5).

**Contract**: New entry `path: 'devices/:deviceId/services/:serviceId'` with `loadComponent`
importing `ServiceDetailComponent`. Either as a sibling under the authed children (current shape) or
by refactoring `devices` into a `children` array — pick whichever keeps the diff minimal; nav active
state works either way (`exact: false`).

### Success Criteria:

#### Automated Verification:

- [ ] Typecheck passes: `npx nx typecheck web`
- [ ] Web tests pass: `npx nx test web`
- [ ] Lint passes: `npx nx lint web`
- [ ] Build passes: `npx nx build web`

#### Manual Verification:

- [ ] Deep-linking `/devices/:deviceId/services/:serviceId` (hard refresh) resolves the service,
      shows the latest run passively without auto-streaming, and shows neutral `unknown` for a
      service with no runs.
- [ ] Re-run starts a live SSE stream → result; problems/suggestions render; each in-scope skill
      runs via the existing dialog; replaying a past run renders statically.
- [ ] Edit renames; Delete confirms and navigates back to `/devices`.
- [ ] Not-found / loading / error states render sensibly (no blank screen).

---

## Phase 3: Slim the services list

### Overview

Reduce `DeviceServicesComponent` to `status dot · Name · Container · status label · Edit/Delete`,
make the row navigate to the detail route, and strip all operational UI from it.

### Changes Required:

#### 1. Slim the table + row navigation

**File**: `apps/web/src/app/features/services/components/device-services.component.{ts,html}`

**Intent**: Keep the list informative and clickable; move everything operational to the detail page.

**Contract**:
  - Columns become `status dot · Name · Container · status label · Actions`. Dot/label source =
    `DiagnosisStore.entry(service.id).runs[0]?.synthesis.status` with grey `unknown` fallback.
  - **Actions cell = Edit + Delete only.** Edit → `openRename` (`RenameServiceDialog`); Delete →
    existing `#deleteDialog` confirm (`requestDelete`/`confirmDelete`). Both buttons call
    `event.stopPropagation()` so they don't trigger row navigation.
  - The **row** navigates to `['/devices', deviceId(), 'services', service.id]` (routerLink or
    `Router.navigate`); `cursor-pointer` + hover bg + keyboard-accessible (link/role semantics —
    reuse `ClickableDirective` if it fits).
  - **Remove**: the diagnosis panel block (`device-services.component.html:82-164`), the Diagnose
    button + `diagnose()` handler, the inline `app-service-skills` usage, `replay()`, and the
    "open →" affordance. **Keep** `loadEffect`, `runsEffect`/`loadRuns` (status dot), `BADGE_CLASS`/
    `DOT_CLASS`, and the `DiagnosisClient`/`DiagnosisStore` providers (still needed for the dot).
  - Keep the device's Scan action and per-device header untouched here.

### Success Criteria:

#### Automated Verification:

- [ ] Typecheck passes: `npx nx typecheck web`
- [ ] Web tests pass: `npx nx test web`
- [ ] Lint passes: `npx nx lint web`

#### Manual Verification:

- [ ] List rows show only `dot · name · container · status · Edit/Delete`; no diagnose/skills/inline
      panels remain.
- [ ] Clicking a row navigates to the detail page; clicking Edit/Delete does **not** navigate.
- [ ] Status dot reflects the latest run (grey for no-runs); keyboard navigation reaches the row.

---

## Phase 4: Device-level status dot

### Overview

Add a small status dot next to each device name in the list = worst of its services' latest-run
statuses, surfaced from the slimmed child to the parent.

### Changes Required:

#### 1. Surface worst-of-services from the child

**File**: `apps/web/src/app/features/services/components/device-services.component.ts`

**Intent**: Compute the device's aggregate status and emit it so the parent can render the dot.

**Contract**: `worstStatus = computed(...)` folding `entry(s.id).runs[0]?.synthesis.status` across
`services()` with ordering `down > degraded > healthy > unknown` (empty/no-runs → `unknown`).
Expose via `output()` (e.g. `statusChange = output<DeviceStatus>()`), emitted reactively when the
computed changes.

#### 2. Render the dot in the device header

**File**: `apps/web/src/app/features/devices/devices.component.{ts,html}`

**Intent**: Keep Name/Host/Created/Updated + device Edit/Delete; add a grey-capable status dot next
to the name fed by the child's emitted status.

**Contract**: Parent keeps a `Record<deviceId, status>` signal updated from
`<app-device-services (statusChange)="...">`; the dot next to the device name reads it (grey
`unknown` when absent). Reuse the dot styling/token map; no new styling system.

### Success Criteria:

#### Automated Verification:

- [ ] Typecheck passes: `npx nx typecheck web`
- [ ] Web tests pass: `npx nx test web`
- [ ] Lint passes: `npx nx lint web`

#### Manual Verification:

- [ ] Each device shows a status dot = worst of its services' latest-run statuses; grey when a
      device has no services or no runs; updates as runs load.

---

## Phase 5: Retire diagnose-hero + cleanup + full gate

### Overview

Delete `DiagnoseHeroComponent` and its `/diagnose` route now that the detail page supersedes it,
remove any dangling references, and run the full verification gate.

### Changes Required:

#### 1. Remove the component + route

**File**: `apps/web/src/app/features/diagnosis/diagnose-hero.component.{ts,html}` (delete);
`apps/web/src/app/app.routes.ts` (remove the `/diagnose` route + import)

**Intent**: Eliminate the duplicated diagnosis surface and the now-unreferenced route.

**Contract**: Remove the `devices/:deviceId/services/:serviceId/diagnose` route entry and its lazy
import; delete the component files and any spec; grep for and remove inbound references (router
links, imports, query-param "device"/"service" wiring that fed the hero).

#### 2. Cleanup pass

**File**: across `apps/web` (and `apps/api` if anything is now unused)

**Intent**: No dead code, no orphan imports, formatting consistent.

**Contract**: `grep` for `diagnose-hero`/`DiagnoseHeroComponent` yields nothing; run
`npm run format`.

### Success Criteria:

#### Automated Verification:

- [ ] No references remain: `grep -ri "diagnose-hero\|DiagnoseHeroComponent" apps/web/src` is empty
- [ ] Lint passes: `npm run lint`
- [ ] Typecheck passes: `npx nx typecheck web api`
- [ ] Tests pass: `npm run test`
- [ ] Build passes: `npm run build`
- [ ] Format clean: `npm run format:check`

#### Manual Verification:

- [ ] No route navigates to the old `/diagnose` page; all diagnosis flows happen on the detail page.
- [ ] Full smoke: list → row → detail → diagnose → skill run → replay → rename → delete (returns to
      list); "Devices" nav stays active throughout.

---

## Testing Strategy

### Unit Tests:

- API: single-service GET delegates to `findOne` and propagates 404 (cross-device + absent).
- Web client: `getService` parses through `serviceSchema` (rejects a leaked/invalid shape).
- `ServiceDetailComponent`: route-id signals drive `getService`/`loadRuns` from effects (not the
  constructor); `view` falls back to `runs[0]?.synthesis`; `unknown` renders grey, never green.
- `DeviceServicesComponent`: action buttons `stopPropagation`; row navigates; `worstStatus`
  ordering (`down > degraded > healthy > unknown`).

### Integration / Manual Testing Steps:

1. From `/devices`, confirm slim rows; click a row → detail; click Edit/Delete → no navigation.
2. On detail: Re-run streams to a result; problems/suggestions show; run a skill; replay a past run.
3. Rename, then Delete → returns to `/devices`.
4. Deep-link + hard-refresh a service URL → resolves via `getService`; no-runs shows `unknown`.
5. Device dot reflects worst-of-services and is grey when empty.

## Performance Considerations

- The slimmed list still issues one `loadRuns` per service to colour dots (accepted per handoff);
  no batch read added. Per-device `DiagnosisStore` scoping keeps concurrent rows isolated.

## Migration Notes

- No data migration. The only API addition is read-only and returns the existing `Service` shape.

## References

- Research: `context/changes/devices-service-detail/research.md`
- Reference implementation: `apps/web/src/app/features/diagnosis/diagnose-hero.component.ts:44,69-126`
- Slim target: `apps/web/src/app/features/services/components/device-services.component.{ts,html}`
- API: `apps/api/src/modules/service/service.controller.ts:30,57-75` (+ `service.service.ts:74`)
- Routes: `apps/web/src/app/app.routes.ts:26-33`
- Visual reference (do not copy markup): `mockups/index.html`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Single-service read (API + client)

#### Automated

- [x] 1.1 Typecheck passes (api + web) — a3ceb3c
- [x] 1.2 API tests pass — a3ceb3c
- [x] 1.3 Lint passes (api + web) — a3ceb3c

#### Manual

- [x] 1.4 Single-service GET returns service for valid pair, 404s for absent/cross-device id — a3ceb3c

### Phase 2: ServiceDetailComponent + route

#### Automated

- [x] 2.1 Typecheck passes (web) — 02485fb
- [x] 2.2 Web tests pass — 02485fb
- [x] 2.3 Lint passes (web) — 02485fb
- [x] 2.4 Build passes (web) — 02485fb

#### Manual

- [x] 2.5 Deep-link resolves service, seeds latest run without auto-stream, shows unknown for no-runs — 02485fb
- [x] 2.6 Re-run streams to result; problems/suggestions render; skills run; replay renders statically — 02485fb
- [x] 2.7 Edit renames; Delete confirms and returns to /devices — 02485fb
- [x] 2.8 Not-found / loading / error states render sensibly — 02485fb

### Phase 3: Slim the services list

#### Automated

- [x] 3.1 Typecheck passes (web) — adc901e
- [x] 3.2 Web tests pass — adc901e
- [x] 3.3 Lint passes (web) — adc901e

#### Manual

- [x] 3.4 Rows show only dot · name · container · status · Edit/Delete; no operational UI remains — adc901e
- [x] 3.5 Row click navigates; Edit/Delete do not navigate — adc901e
- [x] 3.6 Status dot reflects latest run (grey for no-runs); row is keyboard-accessible — adc901e

### Phase 4: Device-level status dot

#### Automated

- [x] 4.1 Typecheck passes (web) — 87b64a0
- [x] 4.2 Web tests pass — 87b64a0
- [x] 4.3 Lint passes (web) — 87b64a0

#### Manual

- [x] 4.4 Device dot = worst of services' latest-run statuses; grey when empty; updates as runs load — 87b64a0

### Phase 5: Retire diagnose-hero + cleanup + full gate

#### Automated

- [x] 5.1 No references to diagnose-hero / DiagnoseHeroComponent remain — 6c2e4b8
- [x] 5.2 Lint passes (all) — 6c2e4b8
- [x] 5.3 Typecheck passes (web + api) — 6c2e4b8
- [x] 5.4 Tests pass (all) — 6c2e4b8
- [x] 5.5 Build passes (all) — 6c2e4b8
- [x] 5.6 Format check clean — 6c2e4b8

#### Manual

- [x] 5.7 No navigation to old /diagnose; all diagnosis on the detail page — 6c2e4b8
- [x] 5.8 Full smoke: list → row → detail → diagnose → skill → replay → rename → delete; nav stays active — 6c2e4b8
