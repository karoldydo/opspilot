# Fix Custom Skills Not Appearing Per Service on /devices Implementation Plan

## Overview

On `/devices`, every managed service row should render its in-scope skills as clickable buttons
(`start`, `stop`, `restart`, `up`, `down`, plus any custom skills) that open the run-skill dialog.
Today **no skill buttons render at all** on any service row. This plan fixes the functional root
cause (a required-input read in the constructor that throws and is silently swallowed), adds a
component regression test to guard the click path, and — only if needed after the fix — sharpens
the button's clickable affordance to match the mockup.

## Current State Analysis

The skill-run data layer, dialog, API routing, device-scope cut, and parameter-satisfiability
filter are all intact and correct (verified in `research.md`). The failure is upstream of all of
that: the skills are never fetched, so `visibleSkills()` is permanently empty.

**Root cause (confirmed empirically against the running app, not inferred):**

`ServiceSkillsComponent` triggers its data load from the **constructor**:

- `apps/web/src/app/features/services/components/service-skills.component.ts:45-47` —
  `constructor() { void this.load(); }`
- `service-skills.component.ts:62-68` — `load()` calls
  `this.skillsClient.listForDevice(this.deviceId())`.
- `deviceId` is `input.required<string>()` (`:23`). **Required signal inputs are not bound yet
  when the constructor runs**, so `this.deviceId()` throws `NG0950` synchronously — *before* the
  HTTP request is constructed.
- That throw happens inside `load()`'s `try`, so the **empty `catch` (`:65-67`) swallows it**.
  Result: no fetch, no skills, no buttons, and a clean browser console.

**Evidence gathered from the live dev app (`localhost:4200/devices`, real local DB):**

- DOM: every one of the 24 service rows shows only `diagnose` / `open →` / `edit` / `delete` —
  **zero skill buttons**.
- Network: `GET /api/devices/{id}/services` and per-row `…/diagnose/runs` fire and return 200;
  **`GET /api/skills?deviceId=` never fires once**. Critically, there is also no
  `?deviceId=undefined` request — so `deviceId()` is *throwing*, not returning `undefined`
  (which confirms the required-input-in-constructor mechanism rather than a missing binding).
- Console: 0 errors / 0 warnings (the throw is caught).
- DB: 1 device, 24 services (all with non-null `container_name`/`compose_path`/`compose_project`),
  5 **global** skills — so device-scope and the satisfiability gate both pass; `visibleSkills()`
  *should* be non-empty. The only reason it is empty is the swallowed load failure.

**Contrast that works:** `DeviceServicesComponent` loads via a named `effect()`
(`device-services.component.ts:65-67`, `:71-79`) that reads `this.deviceId()` *after* inputs bind —
which is exactly why its `services` and `diagnose/runs` fetches fire correctly.

**Provenance correction:** `research.md` and `change.md` attribute this to the terminal re-skin
commit `10ff9b6` (a styling change) and frame it as an *affordance* regression. That is a red
herring. The constructor→`load()`→required-input pattern has existed since the component was
created in `3d362ba` (verified via `git show 3d362ba:…service-skills.component.ts`). This is a
**latent functional bug present from inception**, masked by the silent `catch`, and never caught
because there is **no component spec** for `ServiceSkillsComponent` (only store/client specs exist).
The button's current flat-chip styling is byte-for-byte identical to the working `open →`/`edit`
sibling controls in the same actions cell — so styling is not the cause.

## Desired End State

On `/devices`, each managed service row renders one clickable button per in-scope, satisfiable
skill. Clicking a button opens the run-skill dialog for that `(service, skill)`. `GET
/api/skills?deviceId=` fires once per service row. A component test asserts the fetch-after-binding
+ render + click-opens-dialog path and fails against the pre-fix code. The buttons read as
clickable per the mockup.

### Key Discoveries:

- Root cause: `service-skills.component.ts:45-47` reads a required input in the constructor →
  `NG0950` → swallowed by the empty `catch` at `:65-67`.
- Working reference pattern to mirror: `device-services.component.ts:65-67` (`effect()` reading the
  bound input).
- `angular.md`: "Define `effect()` as named class fields … never inside methods or unnamed in the
  constructor"; "Use `DestroyRef` … do NOT implement `ngOnDestroy`." The fix must use a named
  effect field.
- No component spec exists for this component — the regression had no guard.
- Real data confirms scope + satisfiability are not the gate; the fetch simply never runs.

## What We're NOT Doing

- Not changing the skill data client, skill-run client/store, run-skill dialog, API routes, the
  device-scope SQL, or the satisfiability gate — all verified correct.
- Not redesigning the terminal look; any Phase 3 affordance change stays within the existing
  `op-*` token design and the mockup.
- Not touching `apps/api` or `libs/shared` — this is web-only.
- Not adding broad error-toast UX for skill-fetch failures beyond making the failure non-silent.
- Not migrating other terminal buttons unless Phase 3 explicitly chooses to apply a shared
  affordance utility (decided in that phase, scoped there).

## Implementation Approach

Move the data load off the constructor and onto a named `effect()` that reads `deviceId()` after
inputs bind (mirroring `DeviceServicesComponent`). Pass `deviceId` into `load()` so the effect's
reactive dependency is explicit and the method no longer reaches for an unbound input. Narrow the
`catch` so it isolates genuine HTTP/fetch failures (keep the row rendering) but no longer silently
swallows programming errors — log/surface those so a future regression of this class is visible.
Then add the missing component spec as a regression guard. Finally, evaluate the rendered buttons
against the mockup and add a clickable affordance only if the flat sibling styling is insufficient.

## Phase 1: Fix load timing + narrow the silent catch

### Overview

Make the skills fetch actually run by reading the bound `deviceId` from an effect instead of the
constructor, and stop the `catch` from masking non-fetch errors. After this phase, skill buttons
render on every service row.

### Changes Required:

#### 1. Trigger the load from a named effect, not the constructor

**File**: `apps/web/src/app/features/services/components/service-skills.component.ts`

**Intent**: Replace the constructor-driven load with a named `effect()` class field that reads the
now-bound `deviceId()` and drives `load(deviceId)`. This is the precise fix for the `NG0950`: the
effect runs after input binding, so the required input resolves. Mirror the existing working
pattern in `DeviceServicesComponent`.

**Contract**: Remove `constructor() { void this.load(); }`. Add a named effect field and make
`load` accept the id (no longer reading the unbound input itself):

```ts
// load runs after inputs bind (constructor is too early for a required input — it throws ng0950).
private readonly loadEffect = effect(() => {
  void this.load(this.deviceId());
});

private async load(deviceId: string): Promise<void> { /* fetch + narrowed catch */ }
```

Per `angular.md`: the effect must be a named field, not an unnamed constructor effect.

#### 2. Narrow the catch so it isolates fetch failures without masking programming errors

**File**: `apps/web/src/app/features/services/components/service-skills.component.ts`

**Intent**: Keep the row resilient to a real skills-fetch failure (the row still renders without
controls), but no longer swallow everything in silence — the empty `catch` is exactly what hid this
bug for months. Make a failure observable (log it) rather than invisible.

**Contract**: The `catch` in `load()` logs the error (e.g. `console.error` with a clear message)
before leaving `skills()` empty; it does not rethrow (row isolation per `research.md` Architecture
Insights). No HTTP/contract behavior changes.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npx nx lint web`
- Type checking / build passes: `npx nx build web`
- Web unit tests pass: `npx nx test web`

#### Manual Verification:

- On `/devices`, every managed service row renders skill buttons (`start`, `stop`, `restart`,
  `up`, `down`).
- The browser Network panel shows `GET /api/skills?deviceId={id}` firing once per service row and
  returning 200.
- Clicking a skill button opens the run-skill dialog for that service + skill.
- Browser console is free of `NG0950` / uncaught errors.

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before
proceeding to the next phase.

---

## Phase 2: Component regression test

### Overview

Add the missing `ServiceSkillsComponent` spec so the fetch-after-binding + render + click-opens-
dialog path is guarded. The test must fail against the Phase 1 pre-fix code (constructor load).

### Changes Required:

#### 1. New component spec

**File**: `apps/web/src/app/features/services/components/service-skills.component.spec.ts` (new)

**Intent**: Render the component via TestBed with required inputs bound, a mocked `SkillsClient`,
and a spied `HlmDialogService`, then assert the load runs after binding and the run dialog opens on
click. This is the regression guard for the exact failure class fixed in Phase 1.

**Contract**: Follow the existing TestBed + `vi.fn()` mocking style used in
`apps/web/src/app/features/services/data/skill-run.store.spec.ts`. Use
`TestBed.createComponent(...)` and `fixture.componentRef.setInput('deviceId', …)` /
`setInput('service', …)` to bind the required inputs, then `fixture.detectChanges()`. Provide the
component's injected services via TestBed overrides (`SkillsClient`, `SkillRunClient`,
`SkillRunStore`, `HlmDialogService`). Assertions:
- after binding + change detection, `SkillsClient.listForDevice` was called with the bound
  `deviceId` (this is the assertion that fails on the pre-fix constructor code);
- a button renders per visible skill (locate by the skill name text);
- clicking a skill button calls `HlmDialogService.open` with a context carrying the right
  `deviceId` / `serviceId` / `skill`.

### Success Criteria:

#### Automated Verification:

- New spec passes: `npx nx test web`
- Linting passes: `npx nx lint web`

#### Manual Verification:

- Confirm the spec fails when reverted against the pre-fix code (constructor load) — i.e. it is a
  genuine guard for this regression class, not a tautology.
- Test asserts the fetch happens *after* input binding (not merely that the component constructs).

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 3: Button affordance (conditional on mockup review)

### Overview

With buttons now rendering, evaluate them against the mockup's "clickable button" criterion. The
current class string is identical to the working `open →`/`edit` siblings, so the terminal design
may already be acceptable. Only if it reads as a static label, add a clickable affordance
(`cursor-pointer` + subtle hover/focus-visible/active) — applied consistently with the shared
terminal button pattern per the Q2 decision.

### Changes Required:

#### 1. Add clickable affordance to the skill button (and consistent siblings)

**File**: `apps/web/src/app/features/services/components/service-skills.component.html` (and, for
consistency, the shared button class used by the sibling controls in
`device-services.component.html` if the affordance is applied there too)

**Intent**: Make in-scope skills read as clickable buttons per the mockup without breaking the flat
terminal aesthetic — add `cursor-pointer` and a restrained hover/focus-visible/active treatment
using existing `op-*` tokens. Apply to the shared terminal button pattern so the skill button does
not become visually inconsistent with `edit`/`open →`.

**Contract**: Add only `cursor-pointer` + hover/focus-visible/active utilities (existing `op-*`
tokens / Tailwind v4); no `hlmBtn` reintroduction (it now lives only in dialogs — reintroducing it
here would make the skill button the lone non-dialog `hlmBtn`, inconsistent with its siblings). Run
`npm run format` after editing the template (prettier-plugin-tailwindcss ordering).

### Success Criteria:

#### Automated Verification:

- Linting passes: `npx nx lint web`
- Build passes: `npx nx build web`
- Formatting clean: `npm run format:check`

#### Manual Verification:

- Skill buttons visibly signal interactivity (pointer cursor + hover/focus states) and match the
  mockup's clickable-button intent.
- The skill button remains visually consistent with the `edit` / `open →` controls in the same
  actions cell.

**Implementation Note**: This phase is conditional — if the manual review at the end of Phase 1
finds the flat styling already acceptable against the mockup, skip Phase 3 and note that decision.

---

## Testing Strategy

### Unit Tests:

- New `service-skills.component.spec.ts`: load-after-binding fires `listForDevice(deviceId)`;
  one button per visible skill renders; click opens the run dialog with correct context.
- Edge case: a skills-fetch rejection leaves the row rendered with no skill buttons and logs (does
  not throw / does not break the row).

### Integration Tests:

- Manual end-to-end on the running dev app: `/devices` → buttons render → network shows
  `/api/skills?deviceId=` → click → dialog opens → run executes.

### Manual Testing Steps:

1. `npm start`, log in, open `/devices`.
2. Confirm each service row shows skill buttons; confirm `GET /api/skills?deviceId=` in Network.
3. Click a skill button (e.g. `restart`) — the run dialog opens; submit and confirm the result
   line renders on that row.
4. Confirm no `NG0950` or other errors in the console.

## Performance Considerations

`listForDevice` now fires once per service row (one `GET /api/skills?deviceId=` per row), matching
the existing per-row `diagnose/runs` pattern. This is the intended design and unchanged by the fix
(the request simply now actually fires). No new N+1 introduced beyond what the component already
intended.

## Migration Notes

None — web-only behavior fix, no schema or contract changes.

## References

- Research: `context/changes/fix-skills-not-clickable-in-devices/research.md` (note: its
  affordance-regression framing is corrected by this plan's Current State Analysis — the root cause
  is the constructor required-input read, confirmed against the running app).
- Working pattern to mirror: `apps/web/src/app/features/services/components/device-services.component.ts:65-67`
- Root-cause site: `apps/web/src/app/features/services/components/service-skills.component.ts:45-47`, `:62-68`
- Test style to follow: `apps/web/src/app/features/services/data/skill-run.store.spec.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Fix load timing + narrow the silent catch

#### Automated

- [x] 1.1 Linting passes: `npx nx lint web` — d6db51e
- [x] 1.2 Type checking / build passes: `npx nx build web` — d6db51e
- [x] 1.3 Web unit tests pass: `npx nx test web` — d6db51e

#### Manual

- [x] 1.4 Every service row renders skill buttons (start/stop/restart/up/down) — d6db51e
- [x] 1.5 `GET /api/skills?deviceId=` fires once per row and returns 200 — d6db51e
- [x] 1.6 Clicking a skill button opens the run-skill dialog — d6db51e
- [x] 1.7 Console free of NG0950 / uncaught errors — d6db51e

### Phase 2: Component regression test

#### Automated

- [x] 2.1 New spec passes: `npx nx test web` — 6fb2a75
- [x] 2.2 Linting passes: `npx nx lint web` — 6fb2a75

#### Manual

- [x] 2.3 Spec fails against the pre-fix (constructor) code — genuine guard — 6fb2a75
- [x] 2.4 Test asserts fetch happens after input binding — 6fb2a75

### Phase 3: Button affordance (conditional on mockup review)

#### Automated

- [x] 3.1 Linting passes: `npx nx lint web`
- [x] 3.2 Build passes: `npx nx build web`
- [x] 3.3 Formatting clean: `npm run format:check`

#### Manual

- [x] 3.4 Skill buttons visibly signal interactivity per the mockup
- [x] 3.5 Skill button stays visually consistent with edit / open → siblings
