# Spartan-ng Component Migration — Plan Brief

> Full plan: `context/changes/spartan-ng-component-migration/plan.md`
> Research: `context/changes/spartan-ng-component-migration/research.md`

## What & Why

Finish the long-running migration of `apps/web` off native / hand-rolled HTML onto shared spartan-ng (`hlm-*`) primitives, and add the three primitives the remaining work needs (`spinner`, `button-group`, `dropdown-menu`). Consistent, themeable, accessible UI built from one owned component layer — removing the last hand-written `op-*` button/badge markup and the biggest source of repeated template code.

## Starting Point

11 of 16 installed primitives are already in active use (tables, selects, checkboxes, pagination, dialogs, all 6 form dialogs). The remaining native HTML is concentrated in list/detail components and the two auth screens: ~47 `<button>` (currently using a project `appClickable` directive + `op-*` classes), 5 inputs/5 labels in auth, 4+1 status badges, 3 plain-text loading states, and 12 identical column-sort buttons.

## Desired End State

Auth, list, and detail screens render entirely from `hlm-*` primitives: buttons are `hlmBtn`, auth fields `hlmInput`/`hlmLabel`, statuses `hlmBadge`, loading shows an animated `hlm-spinner`. A shared `app-sort-header` powers all sortable columns. Action bars are grouped with `button-group`; per-row table actions live in a kebab `dropdown-menu`. Status dots remain hand-rolled (no spartan equivalent).

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Add `hlm-spinner` | Yes — wire into 3 loading states | Standardizes loading feedback; spinner self-registers its icon so no app-level wiring needed | Plan |
| Sort buttons | Shared `app-sort-header` for all 12 | Removes the single largest repetition with one point of change | Plan |
| llm-providers status | Badge the text, keep the dot | Minimal, consistent with "leave dots as-is"; avoids visual redundancy debate | Plan |
| dropdown-menu / button-group | In scope — redesign actions | User opted into the UX upgrade (per-row kebab + grouped action bars) | Plan |
| Per-row vs bars split | Per-row → dropdown kebab; bars → button-group | Standard data-table pattern; keeps frequent top-level actions one click away | Plan |
| Variant mapping | primary→default, secondary→outline, danger→destructive | Semantic spartan tokens replace hand-written `op-*` classes | Plan |
| Testing | Lint + build + existing unit tests; new test only for `app-sort-header` | Matches a mechanical migration; full per-view tests not worth the cost | Plan |

## Scope

**In scope:** auth inputs/labels/submits; ~47 buttons → `hlmBtn`; `app-sort-header` (12 headers); action bars → `button-group`; per-row actions → `dropdown-menu` kebab; 4+1 badges → `hlmBadge`; 3 loading states → `hlm-spinner`; scaffold the 3 new primitives.

**Out of scope:** anything already migrated (tables/selects/checkboxes/pagination/dialogs/form dialogs); `textarea` primitive; status dots; the ~38 other registry primitives with no counterpart; any API/store/contract change.

## Architecture / Approach

Five incremental, independently-buildable phases. Phase 1 scaffolds the new primitives (Nx generator pulls `@angular/cdk` + wires aliases/Tailwind). Phases 2–3 are mechanical swaps (auth, simple buttons, shared sort-header). Phase 4 is the only deliberate redesign (button-group + kebab dropdown), where per-row `$event.stopPropagation()` and the conditional activate item must be preserved. Phase 5 finishes badges + spinner. Icons stay component-local (`provideIcons`), never app-root, per `angular.md`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Scaffold primitives | `spinner` + `button-group` + `dropdown-menu` in `libs/ui/` | Generator not wiring alias/CDK preset cleanly |
| 2. Auth screens | login/register on hlmInput/hlmLabel/hlmBtn | Pruning classes breaks validation-error layout |
| 3. Buttons + sort-header | all simple buttons → hlmBtn; `app-sort-header` ×12 | Sort behavior regression across 4 list views |
| 4. Action redesign | button-group bars + kebab dropdowns | Row-navigation firing on menu open; CDK overlay quirks |
| 5. Badges + spinner | hlmBadge ×5 + hlm-spinner ×3 | service-skills `input.required()` effect rule |

**Prerequisites:** Phase 1 must land before Phases 4–5 (they consume the new primitives). `@ng-icons/*` already present.
**Estimated effort:** ~3–5 sessions across 5 phases; Phase 4 is the heaviest.

## Open Risks & Assumptions

- The Nx generator wires `@angular/cdk` + aliases + Tailwind preset automatically; if it misses any, manual fix-up is needed (Phase 1 verification covers this).
- The action redesign (Phase 4) changes UX, not just markup — manual verification of row-navigation vs menu-open is the critical check.
- `appClickable` is assumed to be a pure affordance directive (cursor/hover) fully replaced by `hlmBtn`; if it carries other behavior, that surfaces during Phase 3.

## Success Criteria (Summary)

- No native `<button>`/`<input>`/`<label>` or hand-rolled status pills remain in the migrated files; all use `hlm-*`.
- Sorting, per-row actions, action bars, validation, and loading all behave as before (or better) with no regressions.
- Workspace lints and builds clean after every phase; `app-sort-header` has unit coverage.
