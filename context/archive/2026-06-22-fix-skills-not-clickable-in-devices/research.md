---
date: 2026-06-22T00:00:00Z
researcher: Karol Dydo
git_commit: 3e6e6c414e0833281ff3d117395f4ce74bfecb63
branch: main
repository: opspilot
topic: "Fix custom skills not clickable per service on /devices (regression)"
tags: [research, codebase, web, skills, devices, service-skills, spartan, regression]
status: complete
last_updated: 2026-06-22
last_updated_by: Karol Dydo
---

# Research: Fix custom skills not clickable per service on /devices (regression)

**Date**: 2026-06-22T00:00:00Z
**Researcher**: Karol Dydo
**Git Commit**: 3e6e6c414e0833281ff3d117395f4ce74bfecb63
**Branch**: main
**Repository**: opspilot

## Research Question

Regression: per the mockups, custom skills are run from `/devices` at the level of each managed
service row — each in-scope skill renders as a clickable button that opens the run-skill dialog.
In the current web UI these per-service skill buttons are not clickable / not surfaced, so although
skills exist in the system there is no working way to run them from the UI. Goal: restore the
mockup-faithful behavior. Scope: web only.

## Summary

The skill-run **plumbing is intact and correct end-to-end** — data client, store, dialog, API
routing, and the device-scope + parameter-satisfiability filter all work and match the
contract/mockup. **No functional wiring is broken.**

The regression is an **affordance / visual regression** introduced by commit `10ff9b6`
("feat(web): terminal re-skin of existing screens (p4)", 2026-06-21). That commit replaced the
spartan `hlmBtn` directive (`size="sm" variant="outline"`) on the per-service skill button with a
flat inline Tailwind class string. The element is still a native `<button>` with a working
`(click)="openRun(skill)"`, but it now renders as a static-looking "chip" (cream fill, hairline
border, **no `cursor-pointer`, no hover / focus-visible / active states**). Per the mockups each
in-scope skill must read as a *clickable button*; after the re-skin it reads as a non-interactive
label — hence the "not clickable" report.

**Important correction to one sub-finding:** removing `HlmButton` from the component's `imports`
array does **not** disable the `(click)` handler. Angular binds native DOM events on a `<button>`
regardless of any directive; only the *directive-provided styling/behavior* (`hlmBtn`) was lost.
The functional click path is intact — this is confirmed below by reading the live template
(`(click)="openRun(skill)"` is present and bound).

Recommended fix direction (for `/10x-plan`): restore a genuine button affordance on the per-service
skill control — either re-apply `hlmBtn` with a variant that fits the terminal design system, or
add the missing interactive affordances (`cursor-pointer`, hover/focus-visible/active) to the
inline-styled button — so the control looks and behaves like a clickable button while staying
faithful to the terminal re-skin. Secondary "not surfaced" hypotheses (empty `visibleSkills()`)
should be ruled out during verification (see Open Questions).

## Detailed Findings

### The per-service skill button (root cause site)

`apps/web/src/app/features/services/components/service-skills.component.html:3-12` — current markup:

```html
@for (skill of visibleSkills(); track skill.id) {
  <button
    class="border-op-hairline text-op-body bg-op-cream rounded-[4px] border px-[10px] py-1 text-xs whitespace-nowrap"
    type="button"
    [disabled]="entry().pending !== null"
    (click)="openRun(skill)"
  >
    {{ entry().pending === skill.id ? 'running…' : skill.name }}
  </button>
}
```

- The `(click)="openRun(skill)"` binding is present and functional (`service-skills.component.html:8`).
- `[disabled]="entry().pending !== null"` disables the button only while a run is in flight on that
  service (`service-skills.component.html:7`) — correct behavior, not the regression.
- The `class` string is the regression: a flat chip look with **no** `hover:` / `focus-visible:` /
  `active:` / `cursor-pointer` utilities. Compare the pre-regression form which used
  `hlmBtn size="sm" variant="outline"`.

`apps/web/src/app/features/services/components/service-skills.component.ts`:
- `imports: []` (`:14`) — `HlmButton` removed (was `imports: [HlmButton]` before `10ff9b6`).
- `host: { class: 'contents' }` (`:13`) — `display: contents` so the inner block joins the actions
  cell's flex row. Intentional; not a click blocker by itself (see Open Questions for the overlap
  hypothesis to rule out).
- `openRun(skill)` (`:51-60`) builds `RunSkillDialogContext` and opens `RunSkillDialog` via
  `HlmDialogService` — intact.
- `visibleSkills` computed (`:35-43`) and `satisfiable()` (`:72-84`) — the display filter, intact
  (see scoping below).
- `load()` (`:62-68`) fetches skills via `skillsClient.listForDevice(deviceId)` and **silently
  swallows fetch errors** (empty `catch` → row shows no controls). This is the only place a
  "no buttons at all" symptom could originate on the web side.

### Component mount chain (/devices → skill buttons)

- Route `devices` → `DevicesComponent` (lazy): `apps/web/src/app/app.routes.ts:24`.
- `DevicesComponent` loads devices in its constructor and renders one
  `<app-device-services [deviceId]="device.id" [deviceName]="device.name" />` per device
  (`apps/web/src/app/features/devices/devices.component.html:60`).
- `DeviceServicesComponent` loads services for the device and renders one
  `<app-service-skills [deviceId]="deviceId()" [service]="service" />` per service row in the
  actions cell (`apps/web/src/app/features/services/components/device-services.component.html:54`).
- `ServiceSkillsComponent` renders the skill buttons.

Component tree:
```
DevicesComponent (page)
 └─ DeviceServicesComponent (one per device)
     └─ ServiceSkillsComponent (one per service row → skill buttons)
         └─ SkillRunStore (per-row pending/result state, keyed by serviceId)
```

### Run-skill dialog and data layer (all intact)

- Dialog: `apps/web/src/app/features/services/dialogs/run-skill.dialog.ts` —
  `RunSkillDialogContext` (`:20-26`) carries `deviceId`, `serviceId`, `serviceName`, `skill`, and a
  `store` reference; `submit()` (`:82-108`) collects only `input`-source params and calls
  `context.store.run(...)`; stays open on error, closes on success. Template:
  `run-skill.dialog.html`.
- Skills client: `apps/web/src/app/features/skills/data/skills.client.ts` —
  `listForDevice(deviceId)` → `GET /api/skills?deviceId={deviceId}` (`:23-27`), parsed through
  `skillSchema`.
- Skill-run client: `apps/web/src/app/features/services/data/skill-run.client.ts` —
  `run(...)` → `POST /api/devices/{deviceId}/services/{serviceId}/skills/{skillId}/run` (`:15-18`),
  body `{ inputs }`, response parsed through `skillRunResultSchema`.
- Skill-run store: `apps/web/src/app/features/services/data/skill-run.store.ts` — per-service
  `entries` keyed by `serviceId` (`:23-29`); `run(...)` sets `pending`, calls the client, stores
  `result`/`error` (`:65-81`); `entry(serviceId)` getter (`:56`).
- Skills management store (separate, for the skills CRUD page, not /devices):
  `apps/web/src/app/features/skills/data/skills.store.ts`.

### Skill → service/device scoping rule (intact, consistent across layers)

The in-scope rule is **device-level only** (`skill.deviceId`), plus a web-only per-service
parameter-satisfiability display gate. **No matching against docker image, labels, name, or tags.**

- Shared contract: `libs/shared/src/lib/schemas/skill.schema.ts:21` — `deviceId: z.uuid().nullable()`
  (`null` = global / every device; uuid = that one device). Header comment `:11-12`.
- Parameter contract: `libs/shared/src/lib/schemas/skill-parameter.schema.ts` —
  `source: 'input' | 'service'` (`:21`); a `service`-source param binds to one of
  `['composePath','composeProject','containerName']` (`SERVICE_PARAMETER_NAMES`, `:7`).
- API list scope (canonical SQL predicate): `apps/api/src/modules/skill/skill.service.ts:63-70` —
  `findForDevice`: `where(or(isNull(skill.deviceId), eq(skill.deviceId, deviceId)))`.
- API list route: `apps/api/src/modules/skill/skill.controller.ts:29-32` —
  `GET /api/skills?deviceId=` → `findForDevice`; without query → `findAll` (CRUD list).
- API run scope re-check: `apps/api/src/modules/skill/skill-run.service.ts:82-89` (`requireInScope`)
  reuses `findForDevice`; service-param resolution at `:119-128` throws 400 if a required compose
  field is null.
- Web device-scope predicate (defensive mirror of the API):
  `service-skills.component.ts:40` — `skill.deviceId === null || skill.deviceId === deviceId`.
- Web per-service satisfiability gate (UX mirror of the server's run-time 400):
  `service-skills.component.ts:35-43` + `satisfiable()` `:72-84` — a required `service` param named
  `composePath`/`composeProject` hides the skill on standalone containers (those fields null);
  `containerName` always present; `input`/optional params never gate. Reproduces the old
  `canCompose()` gating for `up`/`down`.

The web relies on the API for the device-scope cut at fetch time, re-applies the same predicate
defensively, and the server re-checks everything on run — so the web filters are advisory and the
server is authoritative. This logic is **not** the regression.

## Code References

- `apps/web/src/app/features/services/components/service-skills.component.html:4-11` — the
  regressed button markup (flat chip class, no interactive affordances) — **root cause site**.
- `apps/web/src/app/features/services/components/service-skills.component.ts:14` — `imports: []`
  (`HlmButton` removed).
- `apps/web/src/app/features/services/components/service-skills.component.ts:13` —
  `host: { class: 'contents' }`.
- `apps/web/src/app/features/services/components/service-skills.component.ts:51-60` — `openRun()`
  (opens dialog; intact).
- `apps/web/src/app/features/services/components/service-skills.component.ts:35-43`,`:72-84` —
  `visibleSkills` + `satisfiable()` (display filter; intact).
- `apps/web/src/app/features/services/components/service-skills.component.ts:62-68` — `load()` with
  silent error catch (the only "no buttons at all" origin on web).
- `apps/web/src/app/features/services/components/device-services.component.html:54` — mount point.
- `apps/web/src/app/features/devices/devices.component.html:60` — device → device-services mount.
- `apps/web/src/app/app.routes.ts:24` — `/devices` route.
- `apps/web/src/app/features/services/dialogs/run-skill.dialog.ts:20-26`,`:82-108` — run dialog.
- `apps/web/src/app/features/skills/data/skills.client.ts:23-27` — `listForDevice`.
- `apps/web/src/app/features/services/data/skill-run.client.ts:15-18` — run POST.
- `apps/web/src/app/features/services/data/skill-run.store.ts:65-81` — run state.
- `libs/shared/src/lib/schemas/skill.schema.ts:21` — `deviceId` scope field.
- `apps/api/src/modules/skill/skill.service.ts:63-70` — canonical scope SQL.
- `apps/api/src/modules/skill/skill-run.service.ts:82-89`,`:119-128` — run-time scope + param checks.

## Architecture Insights

- **Contract single-source-of-truth holds** (`contracts.md`): all skill shapes come from
  `@opspilot/shared` Zod schemas; the web infers from them and re-validates HTTP responses with
  `skillSchema` / `skillRunResultSchema`. No parallel interfaces.
- **Per-row isolation**: `ServiceSkillsComponent` provides its own `SkillsClient` / `SkillRunClient`
  / `SkillRunStore` (`providers: [...]`, not `providedIn: 'root'`) keyed by `serviceId`, so one
  row's pending/result never bleeds into another — consistent with `angular.md` (avoid
  `providedIn: 'root'`).
- **spartan/ng is the styling primitive** (`spartan.md`): buttons should be `hlmBtn`, not
  hand-rolled markup. The terminal re-skin moved this control off `hlmBtn` to a bespoke class
  string — this is exactly the "don't hand-roll primitives" deviation that produced the missing
  affordance. The fix should restore a primitive-backed or affordance-complete button.
- **Affordance vs. function**: the symptom ("not clickable") is perceptual — the control works but
  doesn't signal interactivity. The mockup criterion is explicitly *clickable button*, so matching
  the visual affordance is part of the contract, not optional polish.

## Historical Context (from prior changes)

- `context/archive/2026-06-13-custom-skill-crud/plan.md:475-524` (Phase 6, "Web execution rewire")
  — defines the intended behavior:
  > "Replace the fixed-enum operations surface with a skill-driven run scoped to the service's
  > device… fetches `findForDevice(deviceId)` (global + that device) and filters to skills whose
  > required `service` params are satisfiable for the service (this reproduces `canCompose()`
  > gating for up/down)."
  Success criteria (`:519-523`):
  > "On a container service, start/stop/restart appear and run; up/down do not appear. On a compose
  > service, up/down also appear and run; down prompts for confirmation. A per-device custom skill
  > appears only on services of its device; a global custom skill appears on all. Result/error line
  > renders per service exactly as before."
  This is the behavior the fix must restore — and it confirms the current scoping/filter logic
  matches the intended design (so the filter is correct, not the regression).
- `context/archive/2026-06-09-manage-devices/` — established the `/devices` page and device CRUD.
- `context/archive/2026-06-13-custom-skill-crud/` — introduced the skill-as-data table, per-device
  scope, run execution, and the `service-skills` component (commits e0dd9ce…c11d30e).
- `context/archive/2026-06-11-deterministic-service-operations/` (S-06) — established the execution
  flow; the skill table was deferred to custom-skill-crud.

### Regression provenance (git history of the component)

| Commit | Date | Subject | Impact |
|--------|------|---------|--------|
| `869c095` | 2026-06-21 23:17 | feat(web-terminal-design-system): diagnose-hero drill-in screen (p6) | styling only |
| `10ff9b6` | 2026-06-21 22:10 | feat(web): terminal re-skin of existing screens (p4) | **REGRESSION** — removed `HlmButton`, swapped `hlmBtn size=sm variant=outline` → inline chip class |
| `e4ac498` | 2026-06-20 10:39 | docs(web): clean up and trim comments | comments only |
| `0b5bd16` | 2026-06-19 11:10 | refactor(web): skills slice (p6) | reorg, no regression |
| `3d362ba` | 2026-06-18 21:42 | refactor(web): services slice (+skill-run, +diagnosis) (p5) | **last good** — had `imports: [HlmButton]` and `hlmBtn` |

## Related Research

- `context/archive/2026-06-13-custom-skill-crud/research.md` — original exploration of the skill
  table and execution surface.

## Open Questions

1. **Primary fix scope**: re-apply `hlmBtn` (which variant fits the terminal design tokens?) vs.
   add affordances (`cursor-pointer`, `hover:`, `focus-visible:`, `active:`) to the inline class.
   `spartan.md` favors the primitive; the terminal re-skin may have intentionally moved away from
   default helm variants — confirm with the design system before choosing (a `/10x-plan` decision).
2. **Rule out "no buttons at all"** during verification: confirm `visibleSkills()` is non-empty in
   the real app. Two web-side causes to check —
   (a) `load()`'s silent `catch` (`service-skills.component.ts:65-67`) swallowing a failing
   `GET /api/skills?deviceId=` (would show zero controls with no error), and
   (b) the satisfiability gate hiding all skills on a service (e.g. only compose-required skills
   exist but the service is a standalone container).
3. **Click-interception hypothesis (low likelihood, verify)**: confirm the `host: display:contents`
   + surrounding `flex` wrappers in the actions cell do not place an overlay over the buttons that
   eats clicks. Evidence points to affordance, not interception, but a quick manual click test in
   the running app settles it.
4. Are there existing component/E2E tests asserting the skill button renders and opens the dialog?
   If not, the fix should add a regression guard (the click path is the thing to protect).
