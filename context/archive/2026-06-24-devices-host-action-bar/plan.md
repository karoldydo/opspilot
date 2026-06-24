# Always-Render Host Action Bar on `/devices` Implementation Plan

## Overview

On the redesigned `/devices` fleet page, the host action bar (`scan` / `edit host` / `delete host`) is wrapped entirely in `@if (selectedDevice(); as device)`, so in the default "all hosts" view it disappears. `scan` — the action that discovers new services on a host — becomes undiscoverable. This change makes the bar **always render**: when a host is selected it behaves exactly as today; when "all hosts" is selected it shows a single muted hint that explicitly names **scan**, with no buttons.

## Current State Analysis

- The devices/fleet page is `apps/web/src/app/features/devices/devices.component.{ts,html}` (`DevicesComponent`, `app-devices`, `OnPush`).
- `selectedDevice()` already exists (`devices.component.ts:123-126`): a `computed<Device | null>` returning the device whose id equals `activeHostId()`, or `null` when the filter is `'all'`. **No new signal is needed.**
- The action bar already exists (`devices.component.html:55-93`) but its wrapper `<div>` is **inside** `@if (selectedDevice(); as device)` (line 56) — that's the entire bug. Wrapper classes: `border-op-hairline bg-op-surface-soft flex items-center justify-between gap-3 border border-b-0 px-[14px] py-2.5 text-xs`.
- Handlers already wired to dialogs: `openScan(device)` → `ScanServicesDialog` (`devices.component.ts:217`), `openEdit(device)` → `DeviceFormDialog` via `openDeviceForm('edit', device)` (`:199`), `requestDeleteDevice(device, deviceDeleteDialog)` → sets `deviceToDelete` + opens the `#deviceDeleteDialog` alert-dialog whose confirm calls `confirmDeleteDevice` → `DevicesStore.remove` (`:231`,`:146`).
- Buttons use the project affordance pattern (`appClickable` directive + `op-*` tokens / `clickableClasses()`), **not** `hlmBtn` and **not** the generic Tailwind classes shown in the change-notes snippet. The snippet is illustrative only — match the existing markup.
- Color tokens (`apps/web/src/styles.scss`): `--color-op-ink: #201d1d`, `--color-op-mute: #646262`, `--color-op-ash: #9a9898`, `--color-op-surface-soft: #f8f7f7`. The mockup's hint is base `#9a9898` (→ `text-op-ash`) with the word `scan` at `#646262` + weight 600 (→ `text-op-mute font-semibold`).
- The toolbar (search + status filter) directly follows the bar (`devices.component.html:95-96`) and continues the border (`border border-b-0`), so the bar/toolbar/table read as one unit. This is already correct and unchanged.
- No `devices.component.spec.ts` exists yet (only `data/devices.store.spec.ts`). Web component tests run through `@angular/build:unit-test`; the setup pattern to mirror is `apps/web/src/app/features/services/service-detail.component.spec.ts` (TestBed + mocked clients via `vi.fn().mockResolvedValue(...)`).

## Desired End State

On `/devices`:
- **All hosts selected** (default): under the chip strip, a muted hint reads `select a host above to scan it for new services, or edit / remove the host` with **scan** visually emphasized; no host-action buttons. The hint sits in the same bordered container as the toolbar/table.
- **A host chip selected**: the bar shows `managing {name} · {host}` plus `scan / edit host / delete host`, wired to the existing dialogs — identical to today.
- `+ add device` remains in the page header. No other behavior changes.

### Key Discoveries:

- `selectedDevice()` computed already encodes the exact branch condition (`devices.component.ts:123-126`) — the change is purely moving the `@if` boundary in the template.
- The bar wrapper already matches the mockup's container styling — it just needs to render unconditionally with an `@else` branch inside.
- Chip selection in tests is driven by `selectHost(id)` (the chip click handler) which sets the table `host` filter that `activeHostId()` / `selectedDevice()` read from.

## What We're NOT Doing

- Not changing any handler, store, dialog, or signal logic — template + a new spec file only.
- Not touching the `+ add device` header button, the chip strip, the toolbar, or the table.
- Not using `hlmBtn` or the generic Tailwind classes from the change-notes snippet — keeping the existing `appClickable` + `op-*` affordance markup.
- Not adding E2E/Playwright coverage for this (conditional render is fully covered by unit tests).

## Implementation Approach

Lift the action-bar wrapper `<div>` out of `@if (selectedDevice(); as device)` so it always renders. Inside the wrapper, keep `@if (selectedDevice(); as device)` for the `managing …` text + the three-button group, and add an `@else` branch containing one muted hint span. Then add a component spec asserting both rendered states.

## Phase 1: Always-render the host action bar with an all-hosts hint

### Overview

Make the bar unconditional, add the muted "all hosts" hint, and cover both states with unit tests.

### Changes Required:

#### 1. Devices fleet template — unconditional bar + `@else` hint

**File**: `apps/web/src/app/features/devices/devices.component.html`

**Intent**: Move the action-bar wrapper `<div>` (currently `:57-92`) outside the `@if (selectedDevice(); as device)` at line 56 so the bar always renders. Inside the wrapper keep the existing `managing … · …` span and the `scan / edit host / delete host` button group under `@if (selectedDevice(); as device)`, and add an `@else` branch with a single muted hint that names **scan**. Leave the chip strip (`:40-53`) and toolbar (`:95+`) untouched.

**Contract**: After the edit, the structure between the chip strip and the toolbar is:

```html
<!-- host action bar: always rendered so scan/edit/delete are discoverable -->
<div
  class="border-op-hairline bg-op-surface-soft flex items-center justify-between gap-3 border border-b-0 px-[14px] py-2.5 text-xs"
>
  @if (selectedDevice(); as device) {
    <span class="text-op-mute"
      >managing <span class="text-op-ink font-bold">{{ device.name }}</span> · {{ device.host }}</span
    >
    <span class="flex gap-[7px]">
      <!-- existing scan / edit host / delete host buttons, unchanged -->
    </span>
  } @else {
    <span class="text-op-ash"
      >select a host above to <span class="text-op-mute font-semibold">scan</span> it for new services, or edit /
      remove the host</span
    >
  }
</div>
```

The three buttons inside the `@if` keep their current markup verbatim (`appClickable`, `variant`, `op-*` classes, `(click)="openScan(device)" / "openEdit(device)" / "requestDeleteDevice(device, deviceDeleteDialog)"`). The wrapper classes are unchanged from the current line 58 (so `border-b-0` still continues into the toolbar).

#### 2. Devices component spec — cover both bar states

**File**: `apps/web/src/app/features/devices/devices.component.spec.ts` (new)

**Intent**: Add a unit test file asserting the bar's two states, so the discoverability fix can't silently regress. Mirror the TestBed + mocked-client setup from `service-detail.component.spec.ts`.

**Contract**: Two tests against a rendered `DevicesComponent`:
- **all hosts (default)**: the muted hint containing the text `scan` is present, and none of the `scan` / `edit host` / `delete host` action buttons are rendered.
- **host selected**: after driving selection to a device (call the `selectHost(deviceId)` handler, then `fixture.detectChanges()`), the `managing … · …` text and the three action buttons are rendered.

Provide the component's `providers` dependencies via TestBed — the component self-provides `DevicesClient, DevicesStore, FleetServicesClient, ServicesClient, ServicesStore` (`devices.component.ts:54`); override the HTTP-touching clients (`DevicesClient.listDevices`, `FleetServicesClient`) with `vi.fn()` mocks returning at least one device so a chip exists to select, following the `makeMocks` pattern in `service-detail.component.spec.ts`. Locate elements by accessible text/role (button text `scan`/`edit host`/`delete host`, hint substring) rather than CSS structure where practical.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npx nx lint web`
- Unit tests pass (incl. the new spec): `npx nx test web`
- Build passes: `npx nx build web`
- Type checking passes (covered by lint/build; `npx nx typecheck web` if available)

#### Manual Verification:

- `/devices` with **all hosts** selected shows the muted hint naming **scan**, no host-action buttons.
- Selecting any host chip shows `managing … · …` + `scan / edit host / delete host`; each button opens its dialog (`ScanServicesDialog`, `DeviceFormDialog`, delete confirm) and delete removes the host.
- Bar, toolbar, and table still read as one bordered unit (no double border / seam).
- `+ add device` is still in the page header; no other regressions.

**Implementation Note**: After this phase and all automated verification passes, pause for manual confirmation before considering the change complete.

---

## Testing Strategy

### Unit Tests:

- `devices.component.spec.ts`: all-hosts state renders the `scan` hint and no action buttons; host-selected state renders `managing …` + the three action buttons.

### Manual Testing Steps:

1. Open `/devices` (with ≥1 device) — confirm the muted hint under the chips names **scan** and shows no buttons.
2. Click a host chip — confirm `managing … · …` + `scan / edit host / delete host` appear.
3. Click each button — confirm the correct dialog opens; confirm delete removes the host via the alert-dialog.
4. Click `all hosts` again — confirm it returns to the hint state.
5. Cross-check against the mockup: `mockups/index.html` (devices view) and `reference/OpsPilot.list-redesign.dc.html`.

## References

- Change notes: `context/changes/devices-host-action-bar/change.md`
- Component template (action bar): `apps/web/src/app/features/devices/devices.component.html:55-93`
- `selectedDevice` computed: `apps/web/src/app/features/devices/devices.component.ts:123-126`
- Handlers: `openScan` `:217`, `openEdit` `:199`, `requestDeleteDevice` `:231`, `confirmDeleteDevice` `:146`
- Store `remove`: `apps/web/src/app/features/devices/data/devices.store.ts:97-105`
- Test setup pattern: `apps/web/src/app/features/services/service-detail.component.spec.ts`
- Color tokens: `apps/web/src/styles.scss:64-80`
- Mockup hint markup: `mockups/index.html:208-222`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Always-render the host action bar with an all-hosts hint

#### Automated

- [x] 1.1 Lint passes: `npx nx lint web`
- [x] 1.2 Unit tests pass (incl. new spec): `npx nx test web`
- [x] 1.3 Build passes: `npx nx build web`

#### Manual

- [x] 1.4 All-hosts view shows the muted hint naming scan, no host-action buttons
- [x] 1.5 Host-selected view shows `managing …` + scan/edit host/delete host wired to their dialogs
- [x] 1.6 Bar/toolbar/table read as one bordered unit; `+ add device` still in header; no regressions
