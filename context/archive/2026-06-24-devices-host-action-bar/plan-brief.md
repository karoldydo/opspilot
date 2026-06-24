# Always-Render Host Action Bar on `/devices` — Plan Brief

> Full plan: `context/changes/devices-host-action-bar/plan.md`

## What & Why

The `/devices` fleet page hides the host action bar (`scan` / `edit host` / `delete host`) until a host chip is selected. In the default "all hosts" view there's no selection, so the bar — and crucially `scan`, which discovers new services on a host — is invisible and undiscoverable. This makes the bar always render: a muted hint when no host is selected, the full action bar when one is.

## Starting Point

The bar already exists (`devices.component.html:55-93`) with all handlers wired (`openScan`, `openEdit`, `requestDeleteDevice` → existing dialogs), and `selectedDevice()` already computes `Device | null` from the active host filter (`devices.component.ts:123-126`). The only problem is the wrapper `<div>` sits inside `@if (selectedDevice())`, so it vanishes for "all hosts".

## Desired End State

"All hosts" view shows a single muted hint under the chips — `select a host above to scan it for new services, or edit / remove the host` — with **scan** emphasized and no buttons. Selecting a host chip reveals `managing {name} · {host}` + `scan / edit host / delete host` exactly as today. `+ add device` stays in the page header. Bar, toolbar, and table stay one bordered unit.

## Key Decisions Made

| Decision            | Choice                                             | Why (1 sentence)                                                        |
| ------------------- | -------------------------------------------------- | ---------------------------------------------------------------------- |
| Complexity          | LOW — single template change + tests               | One `.html` file, an `@else` branch, no new logic or signals.          |
| Markup style        | Keep `appClickable` + `op-*` tokens                | Match existing component; the change-notes `hlmBtn` snippet is illustrative only. |
| Hint emphasis       | base `text-op-ash`, `scan` = `text-op-mute font-semibold` | Maps the mockup's `#9a9898` / `#646262`+600 to project tokens.   |
| Test coverage       | 2 unit tests (both bar states)                     | Locks in the discoverability fix against regression.                   |

## Scope

**In scope:**
- Move the action-bar wrapper outside `@if (selectedDevice())`; add `@else` hint branch.
- New `devices.component.spec.ts` with 2 tests (all-hosts hint + host-selected bar).

**Out of scope:**
- Any handler/store/dialog/signal change; the `+ add device` header button; chip strip; toolbar; table.
- E2E/Playwright coverage; `hlmBtn` migration.

## Architecture / Approach

Pure template restructure in `devices.component.html`: the bar wrapper `<div>` becomes unconditional; inside it, `@if (selectedDevice(); as device)` keeps the `managing …` text + three-button group, and a new `@else` renders one muted hint span. The existing `selectedDevice()` computed already drives the branch — no TS logic changes.

## Phases at a Glance

| Phase                                          | What it delivers                                  | Key risk                                              |
| ---------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------- |
| 1. Always-render bar + all-hosts hint + tests  | Discoverable scan/edit/delete; hint for all-hosts | New component spec needs correct TestBed provider mocks |

**Prerequisites:** None — all handlers, dialogs, and `selectedDevice()` already exist.
**Estimated effort:** ~1 short session.

## Open Risks & Assumptions

- New `devices.component.spec.ts` is the first component spec for this feature; TestBed must satisfy the component's self-provided clients (mock `DevicesClient.listDevices` / `FleetServicesClient`) — pattern lifted from `service-detail.component.spec.ts`.
- Assumes the toolbar already continues the bar's border (`border-b-0`); verified in the current template.

## Success Criteria (Summary)

- All-hosts view: muted hint naming **scan** visible; no host-action buttons.
- Host-selected view: `managing …` + `scan / edit host / delete host` wired to existing dialogs.
- `lint`, `test`, `build` for `web` pass; `+ add device` unchanged; no regressions.
