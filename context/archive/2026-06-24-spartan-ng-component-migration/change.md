---
change_id: spartan-ng-component-migration
title: Migrate apps/web native HTML to @opspilot/ui spartan-ng components everywhere possible
status: archived
created: 2026-06-24
updated: 2026-06-24
archived_at: 2026-06-24T18:02:35Z
---

## Notes

Migrate apps/web native/hand-rolled HTML to @opspilot/ui (spartan-ng hlm-*) components everywhere possible.

## GOAL
Wherever possible, replace native/hand-rolled HTML elements in apps/web with components from @opspilot/ui (spartan-ng hlm-* primitives). Add a spartan-ng primitive to libs/ui when a hand-rolled element exists in web and spartan offers a matching component that is not yet installed.

## CONTEXT / CURRENT STATE
- libs/ui exposes 16 of spartan-ng's 57 primitives: button, badge, card, input, label, checkbox, select, table, dialog, alert-dialog, separator, tooltip, pagination, empty, sonner, icon.
- Migration is already well advanced. Already correct (do NOT touch): tables (hlmTable/hlmTh/hlmTd), selects (hlm-select), checkboxes (hlm-checkbox), pagination (table-pagination -> hlmBtn + hlm-pagination), dialogs and alert-dialogs, AND all 6 form dialogs (device-form, skill-form, llm-provider-form, rename-service, run-skill, scan-services) which already use hlmInput, hlmLabel, hlmBtn -- textareas in those dialogs already use hlmInput too.
- The remaining work is concentrated in list/detail components, plus the auth screens and a few badges.

## SCOPE OF CHANGES

### A. Native <button> -> hlmBtn (largest area, ~47 buttons; none of these files use hlmBtn yet)
- features/devices/devices.component.html — 17 buttons: add device, host chip-filters, action bar (scan / edit host / delete host), 4x column-sort in <th>, per-row actions. Targets: solid / ghost size="sm" / outline.
- features/llm-providers/llm-providers.component.html — 10 buttons: add provider, empty-state, 3x sort, activate / edit / delete. Targets: solid / outline / ghost size="sm".
- features/skills/skills.component.html — 9 buttons: add skill, empty-state, 3x sort, edit / delete. Targets: solid / outline / ghost size="sm".
- features/services/service-detail.component.html — 6 buttons: edit, delete, re-run diagnose, run-history. Targets: outline / solid.
- features/audit/audit.component.html — 2 buttons: 2x sort in table header. Target: ghost size="sm".
- features/auth/login/login.component.html — 1 button (line 47): submit. Target: solid, full width.
- features/auth/register/register.component.html — 1 button (line 63): submit. Target: solid, full width.
- features/services/components/service-skills.component.html — 1 button (line 4): run skill. Target: outline.
- shared/layout/layout.component.html — 1 button (line 48): verify context (logout/nav) then map accordingly.
- Note: the column-sort buttons inside <th> are a repeated pattern (cursor-pointer ... uppercase + icon). Good candidate for a shared `sort-header` component wrapping hlmBtn ghost.

### B. Auth — native <input> and <label> -> hlmInput / hlmLabel (the only remaining native inputs/labels; dialogs are already migrated)
- features/auth/login/login.component.html — <label> lines 15, 30; <input> lines 16, 31.
- features/auth/register/register.component.html — <label> lines 15, 30, 45; <input> lines 16, 31, 46.

### C. Native span "pills"/badges -> hlmBadge (already installed, just unused in these spots)
- features/skills/skills.component.html:105 — "global" badge -> hlmBadge variant="outline".
- features/skills/skills.component.html:109 — device scope badge -> hlmBadge.
- features/services/service-detail.component.html:20 — header status -> hlmBadge [variant] + [class].
- features/diagnosis/components/synthesis-card.component.ts:48 (inline template) — status -> hlmBadge.
- (verify) features/llm-providers/llm-providers.component.html:108 — provider status span, possible badge candidate.
- Do NOT convert the `tracking-[0.5px] uppercase` <th> headers and section labels — those are typography, not badges; leave them.

### D. spartan-ng components to ADD to libs/ui (libs/ui has 16 of 57 primitives)
1. spinner (helm) — RECOMMENDED. Loading states are currently plain text: service-detail.component.html:12 "loading service...", :75 "diagnosing...", service-skills:10 "running...", scan-services.dialog:9 store.loading(). Adding hlmSpinner standardizes loading feedback. Install via spartan CLI / MCP.
2. textarea (helm) — OPTIONAL, low priority. Textareas already work via hlmInput; a dedicated hlm-textarea gives proper auto-resize/variant but is not required.
3. dropdown-menu / button-group — OPTIONAL. Action bars and per-row actions (devices/services/skills) are loose buttons today; button-group (action bar) or dropdown-menu (per-row "..." menu) would improve ergonomics, but that's a UX change, not a 1:1 mapping.
- The other ~38 missing primitives (tabs, switch, accordion, progress, radio, sidebar, avatar, etc.) have NO hand-rolled counterpart in web — nothing to migrate; do not add speculatively.

### E. Leave as-is
- Status dots (rounded-full h-2 w-2 in llm-providers, devices, overview) — spartan has no "dot indicator"; the hand-rolled element is justified here.

## SUGGESTED ROLLOUT ORDER
1. Tier 1 (consistency, small files): auth login/register — inputs, labels, buttons (sections B + 2 buttons from A).
2. Tier 2 (list core): buttons in devices / llm-providers / skills / service-detail / audit -> hlmBtn; introduce shared sort-header along the way.
3. Tier 3 (details): badges (section C) + add hlmSpinner to libs/ui and wire it into the loading states.
