---
date: 2026-06-23T17:54:36+0200
researcher: Karol Dydo
git_commit: a9f0647bbcc42342b3d490b39419b90206c0fad2
branch: main
repository: opspilot
topic: "Redesign /devices into a slim list plus a Service Detail page"
tags: [research, codebase, devices, services, diagnosis, signal-store, sse, spartan]
status: complete
last_updated: 2026-06-23
last_updated_by: Karol Dydo
---

# Research: Redesign /devices into a slim list plus a Service Detail page

**Date**: 2026-06-23T17:54:36+0200
**Researcher**: Karol Dydo
**Git Commit**: a9f0647bbcc42342b3d490b39419b90206c0fad2
**Branch**: main
**Repository**: opspilot

## Research Question

How is the current `/devices` feature implemented (routing, list components, signal
stores, SSE diagnosis streaming, dialogs, shared contracts, API endpoints), so we can
plan the refactor into (1) a slim `/devices` services list and (2) a new Service Detail
page at `/devices/:deviceId/services/:serviceId`?

## Summary

The redesign is **well-supported by what already exists** — almost no new plumbing is
needed beyond one component, one route, and one thin API route.

The single most important finding: **`DiagnoseHeroComponent` already does ~90% of the
target Service Detail page.** It is a standalone drill-in at
`/devices/:deviceId/services/:serviceId/diagnose` that owns the diagnosis stream
lifecycle (provides `DiagnosisClient`/`DiagnosisStore`, reads route ids as signals,
loads runs via a guarded effect, exposes `rerun()`/`replay()`, uses the same
`BADGE_CLASS`/`DOT_CLASS` maps). The new `ServiceDetailComponent` is essentially
**a generalization of `diagnose-hero`** that additionally: loads the `Service` identity,
seeds the result card from `runs[0]?.synthesis`, embeds `app-service-skills`, and hosts
Edit/Delete. The old `/diagnose` route and the in-row drill-in get retired in favor of it.

The data layer is ready: `DiagnosisStore.{entry, stream, replay, loadRuns}`,
`ServicesStore`, `SkillRunStore`, and `ServiceSkillsComponent` are all reusable verbatim.
`Service` has no `status` field (by contract) — status is derived from the latest run
(`runs[0]`, confirmed newest-first), and the **`unknown` state is a client-side notion
only** (the wire enum is strictly `healthy | degraded | down`).

**The only genuinely missing piece** is `GET /api/devices/:deviceId/services/:serviceId`
(single service). The API service method `ServiceService.findOne` already exists and 404s
correctly — only the controller route and a `ServicesClient.getService(...)` method need
adding. No new shared contract is required (it returns the existing `Service`).

## Detailed Findings

### Routing & navigation

- **Route tree**: `apps/web/src/app/app.routes.ts`. Lazy `loadComponent` everywhere; an
  authed shell (`authGuard` + `LayoutComponent`) wraps the children.
  - `apps/web/src/app/app.routes.ts:22` — `/devices` → `DevicesComponent` (the list).
  - `apps/web/src/app/app.routes.ts:28` — `/devices/:deviceId/services/:serviceId/diagnose`
    → `DiagnoseHeroComponent` (the current drill-in; to be retired/replaced).
  - The new detail route `devices/:deviceId/services/:serviceId` slots in as a sibling of
    (or nest as a child alongside) the diagnose route under the same authed children.
- **Nav active state**: `apps/web/src/app/shared/layout/layout.component.ts:42` declares
  `navItems`; the `devices` item has `options: { exact: false }`
  (`layout.component.ts:44`), so **any `/devices/**` route keeps the Devices nav item
  highlighted automatically** — the acceptance criterion is satisfied for free as long as
  the new route lives under `/devices`. Active styling is driven by
  `#rla="routerLinkActive"` in `layout.component.html:18-30`.

### Device list — `DevicesComponent`

- `apps/web/src/app/features/devices/devices.component.ts:18` — `providers: [DevicesClient, DevicesStore]` (feature-level, not root).
- Loads on init in the constructor: `void this.store.load()` (`devices.component.ts:34-36`).
  (Safe here — `load()` takes no input; contrast the `effect()` requirement for
  input-dependent loads, see Lessons.)
- Renders Name/Host/Created/Updated + device Edit/Delete; embeds the services list at
  `devices.component.html:68` — `<app-device-services [deviceId]="device.id" [deviceName]="device.name" />`.
- **No device status indicator today** → must be added (worst-of-services dot, §Plan hooks).

### The overloaded list — `DeviceServicesComponent` (the thing being slimmed)

`apps/web/src/app/features/services/components/device-services.component.{ts,html}`

- **Providers** (`device-services.component.ts:42`):
  `[ServicesClient, ServicesStore, DiagnosisClient, DiagnosisStore]`.
- **Inputs**: `deviceId`/`deviceName` are `input.required<string>()`
  (`device-services.component.ts:49-51`), consumed in **effects** (not the constructor).
- **`loadEffect`** (`device-services.component.ts:72-74`) → `store.load(deviceId())`.
- **`runsEffect`** (`device-services.component.ts:78-86`) — **KEEP for the status dot**:
  iterates `store.services()`, calls `diagnosis.loadRuns(deviceId, service.id)` once per
  service (guarded by a `loadedRuns` Set). This is what populates `entry(serviceId).runs`
  used to colour the status dot.
- **`BADGE_CLASS` / `DOT_CLASS`** maps (`device-services.component.ts:24-36`) keyed by
  `DiagnosisSynthesis['status']` — reuse verbatim on the detail page.
- **To REMOVE from the list** (all move to detail): the Diagnose button + `diagnose()`
  handler (`.ts:108-110`), the `open →` drill-in link, the inline `app-service-skills`
  usage, the entire diagnosis panel `@if` block (`device-services.component.html:82-164`:
  result card, problems/suggestions grid, recent-runs replay strip), and `replay()`
  (`.ts:132-135`). The `DiagnosisClient` import stays only because the dot still needs
  `loadRuns`/`entry`.
- **To KEEP/SLIM**: per-row status dot + name + container + status label; Actions cell =
  **Edit + Delete only**; both action buttons need `event.stopPropagation()` so they don't
  trigger the new row navigation; the row itself becomes a `routerLink` to the detail page
  (`cursor-pointer`, hover bg, keyboard-accessible).
- **Delete** uses the inline `<hlm-alert-dialog #deleteDialog>` pattern
  (`device-services.component.html:170-184`) with a `serviceToDelete` signal +
  `requestDelete()`/`confirmDelete()` (`.ts:92-99,137-140`) — replicate on detail.
- **Edit** opens `RenameServiceDialog` via `openRename()` (`.ts:112-115`).

### Signal stores & SSE (the data layer — all reusable)

All stores: `@Injectable()` (no `providedIn`), `signalState` + `patchState`, provided at
feature/component level, clients Zod-parse every response.

- **`DiagnosisStore`** (`apps/web/src/app/features/diagnosis/data/diagnosis.store.ts`) — the
  important one. `DiagnosisEntry` (`diagnosis.store.ts:13-21`):
  `{ error, loading, partial, progress, result, runs, steps }` (richer than the handoff's
  5-field summary — also `progress` and `steps`).
  - `entry(serviceId)` (`:59-61`) → returns `emptyEntry` (never undefined) for un-diagnosed.
  - `stream(deviceId, serviceId)` (`:93-109`) — opens a **native `EventSource`** (GET) to
    `/api/devices/${deviceId}/services/${serviceId}/diagnose/stream`
    (`diagnosis.client.ts:37`); resets partial/result/error, keeps `runs`, flips `loading`.
    Frame handling (`:124-152`): `step`→append, `progress`→`{elapsedMs}`,
    `delta`→merge partial, `done`→`result=run.synthesis` + **prepend** `runs`, `error`→message.
    Teardown closes the EventSource (no auto-reconnect); `destroyRef.onDestroy` closes all.
  - `replay(serviceId, run)` (`:77-88`) — static render of `run.synthesis` into `result`,
    no re-stream, leaves `runs` intact.
  - `loadRuns(deviceId, serviceId)` (`:65-72`) — fetches `client.recentRuns(...)` →
    `entry.runs`; non-fatal on error.
  - **Ordering confirmed: `runs[0]` is the latest** (API newest-first +
    prepend-on-`done`, `diagnosis.store.ts:146`). So seed the card from `runs[0]?.synthesis`.
- **`ServicesStore`** (`services.store.ts`): `load(deviceId)` (`:74`), `remove` (`:84`),
  `rename` (`:94`), `runScan` (`:107`), `addSelected` (`:52`); signals `services()`,
  `isEmpty()` (`:40`), `error()`, `scan()`. **Mutations self-refetch via `load()`**
  (`:64,90,100`) → caller need not subscribe to dialog results.
  - **`ServicesClient`** (`services.client.ts`): `createService`, `listServices`,
    `removeService`, `scan`, `updateService`. **No `getService` single-fetch** — gap to close.
- **`DevicesStore`** (`devices.store.ts`): `load()` (`:87`), `remove(id)` (`:97`), plus
  add/update/replaceCredential; signals `devices()`, `isEmpty()` (`:53`), `error()`.
- **`SkillRunStore`** (`skill-run.store.ts`): `entry(serviceId)` → `{ error, pending, result }`
  (`:17-21`); `run(deviceId, serviceId, skillId, body)` (`:65`). POSTs to
  `/api/devices/.../services/.../skills/:skillId/run` (no SSE).

### `DiagnoseHeroComponent` — the reference implementation to mirror/replace

`apps/web/src/app/features/diagnosis/diagnose-hero.component.ts`

- `providers: [DiagnosisClient, DiagnosisStore]` (`:44`).
- Route ids as signals via `paramMap` + `toSignal` (`:54-60`).
- `entry = computed(() => diagnosis.entry(serviceId()))` (`:69`);
  **`view = computed(() => entry().result ?? entry().partial)`** (`:72`) — the render-select.
- `loadRuns` once via a guarded effect (`:94-101`); `rerun()` → `stream(...)` (`:124-126`);
  `replay(run)` → `replay(...)` (`:118-120`).
- **What it does NOT do (the detail page must add)**:
  1. seed from latest run — extend the view computed to
     `result ?? partial ?? runs[0]?.synthesis` (or `replay(runs[0])` after `loadRuns`);
  2. load the `Service` itself — diagnose-hero takes name/container from **query params**
     (`:63-65`) precisely because no `getService` exists. The detail page should resolve the
     real `Service` (via the new `getService`, or `listServices` + filter);
  3. host Operations (`app-service-skills`), Edit, Delete.

### Dialogs & `ServiceSkillsComponent`

- **Dialog pattern** (`HlmDialogService.open(Component, { context })`): store rides the
  **context object** (CDK overlay is outside the injector). Each dialog reads it via
  `injectBrnDialogContext<T>()` and closes via `BrnDialogRef.close(value)`.
  - Contexts: `RenameServiceDialogContext` `{ deviceId, service, store }`
    (`rename-service.dialog.ts:17-21`); `RunSkillDialogContext`
    `{ deviceId, serviceId, serviceName, skill, store }` (`run-skill.dialog.ts:21-27`);
    `ScanServicesDialogContext` `{ deviceId, deviceName, store }`
    (`scan-services.dialog.ts:15-19`); `DeviceFormDialogContext` `{ device, mode, store }`.
  - **Callers do NOT subscribe to the result** — stores mutate-then-refetch, dialogs toast
    themselves. Just `open` with context.
- **`ServiceSkillsComponent`** (`service-skills.component.ts`): inputs `deviceId`
  (`:23`) + `service` (`:25`), both required; `providers: [SkillsClient, SkillRunClient,
  SkillRunStore]` (`:15`); host `{ class: 'contents' }` (sits inside a flex container).
  **Loads skills from a named `effect()` (`:45-48`), NOT the constructor** — the NG0950 fix
  is in place and guarded by `service-skills.component.spec.ts:72-86`. `visibleSkills`
  computed (`:35-43`) filters to in-scope + satisfiable-param skills. **Reuse verbatim**:
  `<app-service-skills [deviceId]="..." [service]="..." />` — fully self-contained.

### Shared contracts (`@opspilot/shared`) — all present & reusable

- `service.schema.ts:14-25` — `Service { composePath: string|null, composeProject: string|null,
  containerName, createdAt, deviceId, id, name, updatedAt }`. **No `status` field** (strict
  object; header comment: "stable identity only, no runtime facts").
- `diagnosis-synthesis.schema.ts:11-18` — `DiagnosisSynthesis { problems[], status:
  'healthy'|'degraded'|'down', suggestions[], summary }`. **`unknown` is NOT in the enum** →
  client-side only.
- `run-record.schema.ts:15-26` — `RunRecord { createdAt, deviceId, durationMs?, id,
  serviceId, synthesis }` (richer than the handoff's `{id, createdAt, synthesis}`).
- `run-narration-event.schema.ts:22-47` — SSE frames, discriminated on `type`:
  `delta` (partial synthesis), `done` (RunRecord), `error` ({code,message}),
  `step` (RunStep), `progress` ({elapsedMs, phase:'analyzing'}).
- `run-step.schema.ts:8-13` — `RunStep { kind: 'cmd'|'sys'|'ok'|'warn'|'result', text }`.
- `skill.schema.ts` / `skill-parameter.schema.ts`, `device.schema.ts`, `scan-result.schema.ts`
  — all present, all re-exported from `libs/shared/src/index.ts`.

### API endpoints (`apps/api`)

- `service.controller.ts` mounted at `@Controller('devices/:deviceId')`:
  `@Get('services')` (`:39`, list), `@Post('services')`, `@Patch('services/:serviceId')`,
  `@Delete('services/:serviceId')`, `@Post('scan')`. **No `@Get('services/:serviceId')`.**
  - **`ServiceService.findOne(deviceId, id)` already exists** (`service.service.ts:74`,
    404s on absent/cross-device) — adding the single-service GET is a controller-only wiring.
- `diagnose.controller.ts` mounted at `@Controller('devices/:deviceId/services/:serviceId')`:
  `@Sse('diagnose/stream')` (`:40`) and `@Get('diagnose/runs')` (`:22`, newest-first,
  `limit` capped 100). Both already consumed by the web layer.

## Code References

- `apps/web/src/app/app.routes.ts:22,28` — devices + diagnose drill-in routes.
- `apps/web/src/app/shared/layout/layout.component.ts:42-48` — nav items (`devices` exact:false).
- `apps/web/src/app/features/devices/devices.component.ts:18,34` — providers + constructor load.
- `apps/web/src/app/features/devices/devices.component.html:68` — embeds `app-device-services`.
- `apps/web/src/app/features/services/components/device-services.component.ts:42,49-51,72-86` — providers, inputs, effects.
- `apps/web/src/app/features/services/components/device-services.component.html:82-164` — diagnosis panel to remove.
- `apps/web/src/app/features/diagnosis/data/diagnosis.store.ts:13-21,59-109,146` — entry/stream/replay/loadRuns + prepend.
- `apps/web/src/app/features/diagnosis/data/diagnosis.client.ts:25,37` — recentRuns + EventSource URL.
- `apps/web/src/app/features/diagnosis/diagnose-hero.component.ts:44,54-101,118-126` — reference pattern.
- `apps/web/src/app/features/services/data/services.client.ts` — client methods (no getService).
- `apps/web/src/app/features/services/components/service-skills.component.ts:15,23-48` — reusable, effect-loaded.
- `apps/web/src/app/features/services/dialogs/rename-service.dialog.ts:17-21,42-43` — dialog context pattern.
- `libs/shared/src/lib/schemas/{service,diagnosis-synthesis,run-record,run-narration-event,run-step}.schema.ts` — contracts.
- `apps/api/src/modules/service/service.controller.ts:39` + `service.service.ts:74` — list route + existing findOne.
- `apps/api/src/modules/diagnose/diagnose.controller.ts:22,40` — runs + SSE stream.

## Architecture Insights

- **Component-level DI is the law here** (per `angular.md`): every store + client is provided
  on the feature/component, keyed per device/service so concurrent rows don't clobber state.
  The detail page must mirror this (`providers: [ServicesClient, ServicesStore,
  DiagnosisClient, DiagnosisStore]`).
- **Two distinct dialog patterns coexist**: (1) `HlmDialogService.open(Component,{context})`
  with store-via-context for create/edit/scan/run; (2) inline `<hlm-alert-dialog>` template
  ref + local signal for destructive confirm. Detail page uses both (Edit = #1, Delete = #2).
- **Status is derived, never stored.** `Service` is identity-only; the dot/badge come from
  `DiagnosisStore.entry(serviceId).runs[0]?.synthesis.status`, with `unknown` (grey) as a
  pure client fallback. Device-level status = worst across its services' latest-run statuses
  (`down > degraded > healthy > unknown`).
- **Stores self-refetch on mutation** → the UI is reactive without dialog-result wiring.
- **SSE is native `EventSource`** (GET), bypassing HttpClient (no 401 redirect on stream);
  frames are Zod-validated (`runNarrationEventSchema.safeParse`), malformed frames dropped.

## Historical Context (from prior changes)

- `context/foundation/lessons.md` — directly applicable rules:
  - **"Never read a required input in the constructor — load from a named `effect()`"**: the
    exact NG0950 bug that once hid the per-service skill buttons. `ServiceSkillsComponent`
    and `DeviceServicesComponent` already comply; the new detail page **must** load
    `Service`/runs from effects keyed off the route-id signals, never the constructor.
  - **Wire-level timestamps are ISO strings**: `RunRecord.createdAt` etc. stay ISO in
    contracts — render with the `date` pipe, don't expect `Date` objects.
- No prior `research.md`/`plan.md` exists for this change; `context/archive/` has no related
  devices-redesign entry. This is the first investigation for `devices-service-detail`.

## Related Research

- None yet — this is the first research artifact under
  `context/changes/devices-service-detail/`.

## Open Questions

1. **`getService` vs `listServices`+filter**: cleanest is to add `GET
   /api/devices/:deviceId/services/:serviceId` (wiring the existing `ServiceService.findOne`)
   + `ServicesClient.getService`. The handoff permits this as the one minimal API addition.
   Confirm during planning whether to add it or load the list and filter (the list is likely
   already warm if the user navigated from `/devices`, but a deep link / refresh has no list).
2. **Retire `diagnose-hero` or generalize it?** The new `ServiceDetailComponent` supersedes
   the `/diagnose` route. Decide whether to (a) delete `DiagnoseHeroComponent` + its route, or
   (b) refactor it into the detail component. Removing the route means removing the `open →`
   link and any inbound references.
2. **Status-dot hydration cost**: keeping `runsEffect` in the slimmed list issues one
   `loadRuns` per service to colour dots. Acceptable per the handoff; confirm there's no
   lighter "latest status per service" batch read worth adding server-side later.
4. **Run-history UI on detail**: reuse the recent-runs replay strip markup from
   `device-services.component.html` (chips → `replay`), restyled to spartan/Tailwind (drop the
   prototype monospace).
