---
change_id: devices-service-detail
title: Redesign /devices into a slim list plus a Service Detail page
status: archived
created: 2026-06-23
updated: 2026-06-23
archived_at: 2026-06-23T18:10:10Z
---

## Notes

# Claude Code task — Redesign the `/devices` feature into a slim list + a Service Detail page

## Role & goal
You are working in the OpsPilot web app (`apps/web`, Angular standalone, zoneless,
`@ngrx/signals`, spartan-ng **helm** UI). The current `/devices` screen is overloaded:
every service row carries a Diagnose button, an Open button, N skill buttons, Edit and
Delete, **and** an inline expanding panel with the diagnosis result + recent runs. It is
unreadable.

**Refactor `/devices` into two levels:**

1. **`/devices` (list)** — a clean inventory: devices, each with its services as a *slim*
   list. A service row shows only **status · name · container** plus **Edit** and
   **Delete**. Clicking anywhere else on the row **navigates into that service's detail
   page**. Remove from the list: the Diagnose button, the Open button, the skill buttons,
   the inline diagnosis panel, and the recent-runs strip.
2. **Service Detail (new route)** — everything operational lives here: identity header,
   **Operations** (skills), **Diagnose** (the agent-run stream + problems/suggestions),
   and **Run history** (click to replay). Diagnosis happens here, so there is no separate
   "Open" action anymore.

A visual reference prototype is in `reference/OpsPilot.devices-redesign.dc.html` (open it
in a browser). **It is an HTML design reference only — do not copy its markup.** Recreate
the same structure and behavior using the app's existing Angular components, spartan-ng
helm primitives, and Tailwind utility classes. Match the *layout and behavior*, not the
prototype's monospace styling.

---

## Hard constraints (follow the repo's conventions)
- Angular **standalone** components, `ChangeDetectionStrategy.OnPush`, **zoneless**.
- State in `@ngrx/signals` `signalState` stores, mutated via `patchState`; **stores and
  HTTP clients are provided at the feature/component level (NOT `providedIn: 'root'`)** —
  see the existing `DevicesStore`, `ServicesStore`, `DiagnosisStore`, `SkillRunStore`.
- Dialogs render in a CDK overlay outside the component injector, so the **store instance
  is passed via dialog context** (keep this pattern — see `DeviceFormDialog`,
  `RenameServiceDialog`, `ScanServicesDialog`, `RunSkillDialog`).
- UI strictly from **spartan-ng helm** (`HlmButton`, `HlmTable*`, `HlmCard*`, `HlmBadge`,
  `HlmAlertDialog*`, `HlmEmpty*`, `HlmInput`, `HlmLabel`). Do **not** add a new styling
  system or hand-rolled CSS.
- Keep the existing comment style/voice. Respect `angular.md` and `sse.md` if present.
- All data flows through `@opspilot/shared` contracts (zod-parsed in the clients).
- Run `lint`, `typecheck`, `test`, and `build` before finishing; fix what you add.

---

## Data model facts you must respect
- `Device`: `{ id, name, host, createdAt, updatedAt, agentContext }`.
- `Service`: `{ id, name, containerName, composePath: string|null, composeProject: string|null, deviceId }`.
  **There is NO `status`/`outcome` field on `Service`.**
- `Skill`: `{ id, name, commandTemplate, deviceId: string|null, timeoutMs: number|null, parameters: SkillParameter[] }`.
- `SkillParameter`: `{ name, source: 'input' | 'service', required }`.
- `DiagnosisSynthesis`: `{ status: 'healthy' | 'degraded' | 'down', summary, problems: string[], suggestions: string[] }`.
- `RunRecord`: `{ id, createdAt, synthesis: DiagnosisSynthesis }`.

### Where a service's status comes from (important)
Because `Service` has no status, the **status shown in the list and the detail header is
derived from the most recent run**: `DiagnosisStore.entry(serviceId).runs[0]?.synthesis.status`.
The runs are already loaded by `DiagnosisStore.loadRuns(deviceId, serviceId)` (the current
`device-services` component does this in a `runsEffect`). If a service has **no runs**,
treat its status as **`unknown`** and render a neutral/grey indicator — never assume
healthy. A **device-level** status indicator is the worst status across its services'
latest-run statuses (`down` > `degraded` > `healthy` > `unknown`).

> If the team would rather not hydrate the whole diagnosis store just to colour a dot,
> a lightweight "latest run status per service" read is acceptable — but do **not**
> invent a `Service.status` field on the client without a matching server contract.

---

## Existing APIs to reuse (do not rebuild)
- `DevicesStore`: `load()`, `remove(id)`, signals `devices()`, `isEmpty()`, `error()`.
- `ServicesStore` (per device): `load(deviceId)`, `services()`, `isEmpty()`,
  `remove(deviceId, id)`, `rename(deviceId, id, name)`, `runScan(deviceId)`, `addSelected(...)`.
- `DiagnosisStore` (per device/service scope): `entry(serviceId)` →
  `{ loading, partial, result, runs, error }`; `stream(deviceId, serviceId)` (SSE);
  `replay(serviceId, run)`; `loadRuns(deviceId, serviceId)`.
- `SkillRunStore`: `entry(serviceId)` → `{ pending, result, error }`;
  `run(deviceId, serviceId, skillId, { inputs })`.
- `ServiceSkillsComponent` (`app-service-skills`, inputs `deviceId`, `service`): already
  renders the in-scope skills for a service and runs each through `RunSkillDialog`.
  **Reuse it verbatim** in the detail page's Operations section.
- Dialogs (open via `HlmDialogService`, pass store via context): `RenameServiceDialog`
  (this is the service "Edit"), `ScanServicesDialog` (device-level), `DeviceFormDialog`.

---

## Work breakdown (do in this order)

### 1. Routing — add the detail route
Make the detail a **child of `devices`** so the "Devices" nav item stays active:
```
{ path: 'devices', children: [
  { path: '', component: DevicesComponent },
  { path: ':deviceId/services/:serviceId', loadComponent: () => ServiceDetailComponent },
]}
```
(Adapt to the actual routes file — likely `apps/web/src/app/app.routes.ts` or a
`devices.routes.ts`. Find it; it isn't in this handoff bundle.)

### 2. Slim the services list (`device-services.component.*`)
- Table columns become: **status (dot) · Name · Container · status label · Actions**.
- **Actions cell: only `Edit` and `Delete`.** `Edit` opens `RenameServiceDialog`;
  `Delete` opens the existing alert-dialog confirm. These buttons must
  `event.stopPropagation()` so they don't trigger row navigation.
- The **row** (anywhere but the action buttons) navigates to the detail route:
  `routerLink="['/devices', deviceId(), 'services', service.id]"` (or `Router.navigate`).
  Give the row `cursor-pointer` + a hover background; ensure it's keyboard-accessible
  (role/link semantics).
- **Remove** the second `<tr>` that held the diagnosis panel + recent runs, the Diagnose
  button, the `app-service-skills` usage, and any "Open" affordance.
- Keep the device's **Scan** action and the per-device header.
- Status dot/label source = latest run per service (see "Where status comes from"). Keep
  the `runsEffect` that calls `loadRuns` so the dot is populated; drop the rest of the
  diagnosis wiring from this component.

### 3. Device header in the list (`devices.component.html`)
- Keep `Name`, `Host`, `Created`, `Updated`, and the device `Edit`/`Delete` actions.
- Add a small **device status dot** next to the device name = worst of its services'
  latest-run statuses (grey when unknown/empty).

### 4. New `ServiceDetailComponent`
Create `apps/web/src/app/features/services/service-detail.component.{ts,html}`
(standalone, OnPush). It provides its own `ServicesClient`/`ServicesStore`,
`DiagnosisClient`/`DiagnosisStore`, and the skill-run pieces (mirror how
`device-services` provides them).

- **Resolve params**: read `deviceId` + `serviceId` from the route. Resolve the `Service`
  via `ServicesStore.load(deviceId)` then find by id (or add a `ServicesClient.getService(deviceId, serviceId)` if the API supports it). Handle not-found and loading/error states.
- **On enter**: call `DiagnosisStore.loadRuns(deviceId, serviceId)`. **Seed the result
  card from the latest run** (`runs[0]?.synthesis`) so the page is informative immediately;
  show a **Re-run / Diagnose** button that starts a fresh `stream(...)`. Do **not**
  auto-stream on entry.
- **Layout (top → bottom):**
  1. **Breadcrumb**: `Devices / {deviceName} / {serviceName}` (Devices links to `/devices`).
  2. **Identity header**: service name + a status `HlmBadge` (from latest run / live result),
     a meta line with `container`, `@ {device} · {host}`, and compose info
     (`compose · {composeProject} · {composePath}` or `standalone container`),
     and right-aligned **Edit** + **Delete** buttons.
     `Delete` confirms via alert-dialog and on success navigates back to `/devices`.
  3. **Operations** section: reuse `<app-service-skills [deviceId] [service] />`. Show a
     muted "no operations in scope for this service" when none are visible. The skill run
     result line stays under it (it already does).
  4. **Diagnose** section: the agent-run surface. Render the live stream
     (`entry.loading` / `entry.partial`) and, when present, the result card with the
     status badge + summary + a two-column **Problems** / **Suggestions** grid (reuse the
     exact `badgeClass`/`HlmCard` treatment currently in `device-services`). Put the
     **Re-run** button in this section's header (label `Diagnosing…` while loading).
     When showing a passive latest-run result (not a fresh stream), label it
     `last run · {date}`.
  5. **Run history**: `entry.runs` as clickable chips → `DiagnosisStore.replay(serviceId, run)`
     (renders that run's synthesis statically in the result card — no re-stream).

### 5. Clean up
- Remove now-dead code paths from `device-services` (inline diagnosis panel, replay in the
  row, the Diagnose handler) — but keep `loadRuns` for the status dot.
- The old all-in-the-row "diagnose drill-in" is replaced by the detail route; remove any
  leftover references.

---

## Acceptance criteria
- `/devices` shows devices with a **slim** services list: status dot · name · container ·
  status · **Edit/Delete only**. No diagnose/skills/inline panels in the list.
- Clicking a service row navigates to `/devices/:deviceId/services/:serviceId`; the
  **Devices** nav item stays active.
- The detail page can: run a diagnosis (live SSE stream → result), show problems &
  suggestions, run every in-scope skill (existing run dialog), replay a past run, and
  rename/delete the service. Delete returns to `/devices`.
- On entry the detail shows the **latest run** (if any) without auto-streaming, plus a
  **Re-run** button.
- A service with no runs shows a **neutral "unknown"** status everywhere (never green).
- Edit & Delete exist on **both** the list row and the detail header.
- `lint`, `typecheck`, `test`, `build` all pass. No `Service.status` field invented on the
  client without a server contract.

## Out of scope
- No backend/contract changes unless a `getService`/"latest status" read is genuinely
  missing — if so, add it minimally and parse through `@opspilot/shared`.
- No device-detail page (only **service** detail). Scan stays a device-level action on the list.
- Don't restyle other features (overview/skills/providers/audit) beyond what's needed to
  wire navigation.

Zaktualizowane makiety są w katalogu: `mockups`
