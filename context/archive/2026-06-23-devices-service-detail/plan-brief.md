# Devices Slim List + Service Detail Page — Plan Brief

> Full plan: `context/changes/devices-service-detail/plan.md`
> Research: `context/changes/devices-service-detail/research.md`

## What & Why

The `/devices` screen is overloaded — every service row carries a Diagnose button, an Open link, N
skill buttons, Edit/Delete, **and** an inline diagnosis panel with results + recent runs. It's
unreadable. We split it into a **slim inventory list** and a **new Service Detail page** where
everything operational lives.

## Starting Point

`DevicesComponent` embeds `DeviceServicesComponent`, which renders the bloated rows. A separate
`DiagnoseHeroComponent` (`/devices/.../diagnose`) already implements ~90% of the target detail page
(stream lifecycle, runs, rerun/replay, status maps) but takes service identity from query params
because no single-service read exists. The data layer (`DiagnosisStore`, `ServicesStore`,
`SkillRunStore`, `ServiceSkillsComponent`) is fully reusable.

## Desired End State

`/devices` lists devices with a device status dot and slim service rows (`dot · name · container ·
status · Edit/Delete`); the row navigates into a Service Detail page that owns breadcrumb, identity
header, Operations (skills), Diagnose (live SSE + problems/suggestions), and Run history. Detail
seeds from the latest run without auto-streaming; no-runs shows neutral `unknown`. `diagnose-hero` is
retired.

## Key Decisions Made

| Decision                       | Choice                                  | Why (1 sentence)                                                      | Source   |
| ------------------------------ | --------------------------------------- | -------------------------------------------------------------------- | -------- |
| Single-service identity fetch  | Add `GET .../services/:serviceId`       | Deep-link/refresh works without a warm list; existing `findOne` reused | Plan     |
| Fate of `diagnose-hero`        | Retire (delete component + route)       | Detail page supersedes it; one source of truth, no dead route        | Plan     |
| Service status source          | Derived from `runs[0]?.synthesis.status`| `Service` is identity-only by contract; `unknown` is client-side grey | Research |
| Device-level status            | Worst-of-services, child → parent emit  | `DiagnosisStore` is per-child-scoped; parent can't read it directly  | Plan     |
| Status-dot hydration           | Per-service `loadRuns` (no batch read)  | Accepted cost; keeps the existing `runsEffect` wiring                | Research |

## Scope

**In scope:** single-service GET + `ServicesClient.getService`; new `ServiceDetailComponent` + route;
slimmed `device-services` list with row navigation; device status dot; retiring `diagnose-hero`.

**Out of scope:** any other contract change or `Service.status` field; a device-detail page; restyling
other features; a batch latest-status server read; auto-streaming on detail entry.

## Architecture / Approach

Bottom-up, dependency-ordered. Land the read (API+client) → build the detail page (generalize
`diagnose-hero`, add identity + seed + Operations + Edit/Delete) and its route → slim the list and
point rows at the detail route (removing the last `/diagnose` link) → add the device dot (child emits
worst-status, parent renders) → delete `diagnose-hero` and run the full gate. UI is spartan-ng helm +
Tailwind only; status styling reuses the existing `BADGE_CLASS`/`DOT_CLASS`/`op-*` maps; all data
through `@opspilot/shared`.

## Phases at a Glance

| Phase                              | What it delivers                          | Key risk                                          |
| ---------------------------------- | ----------------------------------------- | ------------------------------------------------- |
| 1. Single-service read             | `GET .../services/:serviceId` + client    | Low — wires existing `findOne`                    |
| 2. ServiceDetailComponent + route  | New detail page, route added              | Effect-load (NG0950); seed-from-runs; not-found UX|
| 3. Slim the services list          | Slim rows + row navigation                | stopPropagation on actions; keyboard a11y         |
| 4. Device-level status dot         | Worst-of-services dot per device          | Cross-store wiring (child output → parent signal) |
| 5. Retire diagnose-hero + gate     | Component + route removed; full gate green| Dangling references to old route/component        |

**Prerequisites:** none — all stores, contracts, and the reference component already exist.
**Estimated effort:** ~1–2 sessions across 5 phases (Phase 2 is the bulk).

## Open Risks & Assumptions

- Device dot needs the child to emit its computed worst-status to the parent; lifting `DiagnosisStore`
  to the parent is explicitly rejected (per-device scoping is deliberate).
- `unknown` is not in the wire enum — every status map index needs an explicit grey fallback branch.
- Route ids/Service/runs must load from named effects, never the constructor (NG0950 lesson).

## Success Criteria (Summary)

- Slim list with row navigation; detail page diagnoses, runs skills, replays, renames, deletes (delete
  returns to list); "Devices" nav stays active.
- No-runs services show neutral `unknown` everywhere (never green); device dot = worst-of-services.
- `diagnose-hero` gone; `lint`/`typecheck`/`test`/`build`/`format:check` all pass.
