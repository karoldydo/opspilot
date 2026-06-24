---
change_id: devices-host-action-bar
title: Make scan / edit / delete host discoverable via an always-rendered host action bar on /devices
status: archived
created: 2026-06-24
updated: 2026-06-24
archived_at: 2026-06-24T13:13:18Z
---

## Notes

# Claude Code task — Make `scan` (and host edit/delete) discoverable on the fleet `/devices` table

## Context
This is a **small follow-up** to the fleet-table redesign in `CLAUDE_CODE_PROMPT.md`
(same folder). That change replaced the per-device cards with **one fleet-wide services
table** and moved device-level actions (`scan`, `edit host`, `delete host`) into a per-host
**action bar** that only appeared *after* the user selected a host chip.

**Problem:** in the default **"all hosts"** view there is no host selected, so the action
bar is hidden — and `scan` (the action that discovers new services on a host) is
**undiscoverable**. Users can't find it.

## The change
Make the **host action bar always render**, directly under the host-filter chips and above
the table toolbar. It has two states:

1. **A specific host is selected** (device filter ≠ `all`) — unchanged from today:
   - Left: `managing {deviceName} · {host}`
   - Right: `scan` (`ScanServicesDialog`) · `edit host` (`DeviceFormDialog`) · `delete host`
     (alert-dialog confirm → `DevicesStore.remove`).
2. **"all hosts" is selected** — **new**: show a single muted hint and **no buttons**
   (scan/edit/delete each need a target host):
   > select a host above to **scan** it for new services, or edit / remove the host

   Emphasize the word **scan** (slightly stronger weight/colour) so the affordance reads at
   a glance.

`+ add device` stays in the **page header** (unchanged).

## Implementation notes (Angular standalone, spartan-ng helm, Tailwind)
- In the devices/fleet component template, render the bar unconditionally and branch on the
  selected device signal:
  ```html
  <!-- between the chip strip and the table toolbar -->
  <div class="flex items-center justify-between gap-3 rounded-t-md border border-b-0 border-border bg-muted/40 px-3.5 py-2 text-xs">
    @if (selectedDevice(); as d) {
      <span class="text-muted-foreground">managing <span class="font-semibold text-foreground">{{ d.name }}</span> · {{ d.host }}</span>
      <span class="flex gap-1.5">
        <button hlmBtn variant="outline" size="sm" (click)="scan(d)">scan</button>
        <button hlmBtn variant="outline" size="sm" (click)="editHost(d)">edit host</button>
        <button hlmBtn variant="outline" size="sm" class="text-destructive" (click)="deleteHost(d)">delete host</button>
      </span>
    } @else {
      <span class="text-muted-foreground/80">select a host above to <span class="font-medium text-muted-foreground">scan</span> it for new services, or edit / remove the host</span>
    }
  </div>
  ```
  (`selectedDevice()` = the device whose id equals the active host filter, or `null` for
  "all hosts". Reuse the existing `scan` / `editHost` / `deleteHost` handlers and dialogs —
  this is purely a template/visibility change, no new logic.)
- Keep it inside the same bordered table container so the bar, toolbar, and table read as one
  unit (the bar has `border-b-0`; the toolbar continues it).

## Acceptance criteria
- On `/devices` with **all hosts** selected, a muted hint is visible under the chips that
  explicitly names **scan**; no host-action buttons show.
- Selecting any host chip reveals `managing … · …` plus `scan / edit host / delete host`,
  wired to the existing dialogs (`ScanServicesDialog`, `DeviceFormDialog`, delete confirm).
- `+ add device` remains in the page header. No other behaviour changes.
- `lint`, `typecheck`, `test`, `build` pass.

## Reference
`reference/OpsPilot.list-redesign.dc.html` → open in a browser, go to **devices**, and
toggle the host chips ("all hosts" ↔ a specific host) to see both bar states.

Zaktualizowane makiety: mockups
