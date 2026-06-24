# Spartan-ng Component Migration Implementation Plan

## Overview

Replace the remaining native / hand-rolled HTML in `apps/web` with shared spartan-ng (`hlm-*`) primitives wherever a matching component exists, and add the three missing primitives the work needs (`spinner`, `button-group`, `dropdown-menu`). The migration finishes a long-running effort: 11 of 16 installed primitives are already in active use; this plan closes the gap on buttons, auth inputs/labels, badges, loading states, and the action surfaces (action bars + per-row actions), and introduces a shared `app-sort-header` to kill the single largest source of repeated markup.

## Current State Analysis

`libs/ui/` *is* the helm layer (spartan source vendored into the repo and owned by it). Components are consumed through per-component sub-path aliases — `@spartan-ng/helm/button`, `/input`, `/badge`, … (`tsconfig.base.json:12-34`). There is **no `@opspilot/ui` alias**; the main barrel `libs/ui/src/index.ts` is intentionally empty (`export default null`). 16 of spartan's 57 primitives are installed; `badge`, `card`, `separator`, `tooltip`, `empty`, `sonner`, `icon` are installed but unused in `apps/web`.

What remains native, audited with file:line in `research.md`:

- **~47 native `<button>` across 9 files.** These files do **not** use `hlmBtn` today — they use a project affordance directive `appClickable` with `variant="primary|secondary|danger"` plus hand-written `op-*` token classes (border/bg/text). Examples confirmed by the action-bar audit below.
- **5 native `<input>` + 5 native `<label>`** — only the two auth screens (login, register). Every list-view search input already uses `hlmInput`.
- **4 hand-rolled badge `<span>` + 1 status-text candidate** → `hlmBadge` (installed, unused in `apps/web`).
- **3 plain-text loading states** → new `hlm-spinner`.
- **12 identical column-sort buttons** in 4 files sharing one class string → strong candidate for a shared `app-sort-header`.
- **Status-dot elements** (`rounded-full`) → leave as-is; spartan has no dot primitive.

Key constraints discovered:

- `@ng-icons/core` + `@ng-icons/lucide` are **already** in `package.json` (`>=32 <34`). `hlm-spinner` **self-registers** its icon (`providers: [provideIcons({ lucideLoader2 })]`), so wiring spinner needs **no** app-level icon provider — just importing `HlmSpinnerImports`.
- The established icon-wiring pattern is **component-local** `provideIcons({...})` (used across `libs/ui/pagination`, `dialog`, `select`, `checkbox`, `sonner`). `app.config.ts` has **no** icon providers and the rule `angular.md` says avoid `providedIn:'root'`. Any net-new icon (the kebab trigger's `lucideEllipsis`) is registered component-local.
- `dropdown-menu` + `button-group` pull `@angular/cdk` (+ `@angular/cdk/menu`) as peer deps; the Nx generator installs them and wires the Tailwind preset + path aliases automatically.
- `hlmBtn` variants are `default | secondary | destructive | ghost | outline | link`; sizes `default | sm | lg | xs | icon | icon-sm | icon-lg | icon-xs`. There is **no** `solid` variant (`default` is the solid one) and `outline` is a **variant**, not a size.

### Key Discoveries:

- Per-row action cells share `<div class="flex justify-end gap-1.5">` with `(click)="$event.stopPropagation(); …"` on each button (devices `:194-214`, llm-providers `:119-151`, skills `:116-137`) — the `stopPropagation` must survive the move into a dropdown, since the table rows are click-navigable.
- llm-providers per-row has a conditional `@if (!provider.active) { …activate… }` button — the dropdown must preserve that conditional item.
- Action-bar buttons use `appClickable variant="secondary|danger|primary"` + `op-*` classes (devices host bar `:56-98`, service-detail `:35-54`); the migration drops `appClickable` and the hand-written classes in favor of `hlmBtn` semantic variants.
- Canonical patterns to follow: `device-form.dialog.{ts,html}` (hlmInput/hlmLabel/hlmBtn + `schemaValidator`), `table-pagination.component.{ts,html}` (hlmBtn ghost/icon, bound variant; relies on each pagination sub-component's own `provideIcons`).
- `synthesis-card.component.ts:47-50` badge lives in an **inline** `template:` string, not an `.html` file.
- Spinner source: `inline-flex text-[length:--spacing(4)] motion-safe:animate-spin`, `role="status"`, `[aria-label]` default "Loading"; renders `<ng-icon [name]="icon()" />`.

## What We're NOT Doing

- **Not** touching anything already migrated: tables (`hlmTable*`), selects, checkboxes, pagination, dialogs/alert-dialogs, and all 6 form dialogs (already hlmInput/hlmLabel/hlmBtn). Textareas in dialogs stay on `hlmInput`.
- **Not** adding `textarea` primitive (optional, low priority — `hlmInput` already covers textareas).
- **Not** migrating status dots (`rounded-full`) — no spartan equivalent; the hand-rolled element is justified. The llm-providers status **dot stays**; only its adjacent **text** becomes a badge.
- **Not** adding any of the ~38 other registry primitives that have no hand-rolled counterpart in `apps/web`.
- **Not** changing API contracts, store logic, or component method signatures — this is a template/markup + new-component migration.

## Implementation Approach

Five incremental phases, each independently buildable and lint-clean. Phase 1 lays the foundation (scaffold the three new primitives) so later phases can consume them. Phases 2–3 are mechanical, low-risk swaps (auth, simple buttons, sort-header). Phase 4 is the only deliberate UX redesign (action bars → button-group, per-row actions → kebab dropdown). Phase 5 finishes the detail surfaces (badges + spinner).

Variant mapping (applied throughout): `appClickable variant="primary"` → `hlmBtn` (default); `variant="secondary"` → `hlmBtn variant="outline"`; `variant="danger"` → `hlmBtn variant="destructive"`. Compact contexts (per-row, sort headers) add `size="sm"`. Hand-written `op-*` border/bg/text classes are pruned in favor of the variant's semantic tokens; spacing/layout classes that aren't covered by the variant are kept and merged via the variant's own class handling (never hand-concatenated — `spartan.md`).

## Critical Implementation Details

- **Per-row `stopPropagation` must be preserved.** Table rows are click-navigable; today each per-row button carries `(click)="$event.stopPropagation(); …"`. When these collapse into a `hlm-dropdown-menu`, the **trigger** button must stop propagation so opening the menu doesn't navigate the row, and each `hlmDropdownMenuItem`'s action must still run its original handler.
- **Component-local icons only.** The kebab trigger needs `lucideEllipsis` registered via component-local `provideIcons({ lucideEllipsis })` (matching the repo pattern); do **not** add an app-root icon provider. Spinner needs nothing extra (self-registers `lucideLoader2`).
- **service-skills lesson (`lessons.md`).** Never read `input.required()` in the constructor — load from a named `effect()`. When editing `service-skills.component.*`, keep that pattern intact.
- **dropdown-menu trigger/content shape.** Trigger is `<button [hlmDropdownMenuTrigger]="menu">`; content is an `<ng-template #menu><hlm-dropdown-menu>…<button hlmDropdownMenuItem>…</button></hlm-dropdown-menu></ng-template>`. Destructive items use `variant="destructive"` on `hlmDropdownMenuItem`.

---

## Phase 1: Scaffold new primitives

### Overview

Generate `spinner`, `button-group`, and `dropdown-menu` into `libs/ui/` via the spartan Nx generator, install peer deps, and verify the workspace still builds. No `apps/web` consumption yet — this is the foundation the later phases import.

### Changes Required:

#### 1. Generate the three helm primitives

**File**: `libs/ui/spinner/`, `libs/ui/button-group/`, `libs/ui/dropdown-menu/` (new), `tsconfig.base.json`, `package.json`

**Intent**: Run the Nx generator to vendor helm source for the three primitives, which also wires the path aliases and Tailwind preset and pulls `@angular/cdk`.

**Contract**: `npx nx generate @spartan-ng/cli:ui --name=spinner,button-group,dropdown-menu`. After it runs, `tsconfig.base.json` must expose `@spartan-ng/helm/spinner`, `@spartan-ng/helm/button-group`, `@spartan-ng/helm/dropdown-menu`; `@angular/cdk` must be present in `package.json`. Exports: `HlmSpinnerImports`, `HlmButtonGroupImports`, `HlmDropdownMenuImports`.

#### 2. Verify deps & aliases

**File**: `package.json`, `tsconfig.base.json`

**Intent**: Confirm the generator added `@angular/cdk` and the three aliases; if the generator skipped any alias, add it by hand mirroring the existing 16 helm aliases.

**Contract**: three new alias entries in `compilerOptions.paths`; `@angular/cdk` in dependencies.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npx nx lint web` and `npx nx lint ui` (if a `ui` project lint target exists; otherwise `npm run lint`)
- Build passes: `npx nx build web`
- Type checking passes (covered by build; no separate tsc target)

#### Manual Verification:

- The three primitive folders exist under `libs/ui/` with `HlmSpinnerImports` / `HlmButtonGroupImports` / `HlmDropdownMenuImports` exported
- `@angular/cdk` resolves (no peer-dep warning on install)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Auth screens (Tier 1)

### Overview

Migrate the only remaining native inputs/labels (the two auth screens) to `hlmInput`/`hlmLabel`, and their submit buttons to `hlmBtn`. Smallest, lowest-risk surface; establishes confidence before the larger waves.

### Changes Required:

#### 1. Login screen

**File**: `apps/web/src/app/features/auth/login/login.component.{html,ts}`

**Intent**: Apply `hlmLabel` to the two `<label>` (`:15`, `:30`), `hlmInput` to the two `<input>` (`:16`, `:31`), and `hlmBtn` (default, full-width) to the submit button (`:47`); prune redundant `bg-op-surface-soft … rounded-[4px] border …` classes that overlap the directive styling. Add the imports to the component.

**Contract**: follows the `device-form.dialog.{ts,html}` pattern (label `for` → input `id` → `@if (touched && invalid)` error `<p>` reading `getError('zod')`). Full-width submit keeps its `w-full` layout class.

#### 2. Register screen

**File**: `apps/web/src/app/features/auth/register/register.component.{html,ts}`

**Intent**: Same migration for three labels (`:15/:30/:45`), three inputs (`:16/:31/:46`), and the submit button (`:63`).

**Contract**: identical to login.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npx nx lint web`
- Build passes: `npx nx build web`
- Unit tests pass: `npx nx test web`

#### Manual Verification:

- Login and register render with consistent input/label/button styling matching the dialogs
- Validation errors still appear on touched+invalid fields
- Submit buttons are full-width and trigger sign-in / create-account

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding.

---

## Phase 3: Button swaps + shared sort-header (Tier 2)

### Overview

Convert all "simple" native buttons (add, empty-state, re-run diagnose, per-run replay, run-skill, sign-out) to `hlmBtn`, and build a shared `app-sort-header` component wrapping `hlmBtn variant="ghost" size="sm"` + a sort icon, migrating all 12 column-sort buttons through it. Per-row table actions and action bars are deferred to Phase 4.

### Changes Required:

#### 1. Shared `app-sort-header` component

**File**: `apps/web/src/app/shared/components/sort-header.component.ts` (new)

**Intent**: Create an `OnPush`, standalone, signal-based component that renders a `hlmBtn variant="ghost" size="sm"` clickable column header with the shared uppercase/tracking typography and a sort-direction indicator, emitting a sort event. Replaces the 12 duplicated `<button class="text-op-mute flex … uppercase">` headers.

**Contract**: `selector: 'app-sort-header'`; inputs for the column key/label and current sort state (active column + direction), output for sort toggle. Direction indicator uses a lucide chevron icon registered component-local via `provideIcons({...})`. Templates only do property/signal access (logic in `computed()`); follows `angular.md` (no `standalone: true`, `host` object not `@HostBinding`).

#### 2. Migrate 12 sort headers through `app-sort-header`

**File**: `apps/web/src/app/features/devices/devices.component.{html,ts}` (`:133/:142/:151/:160`), `features/llm-providers/llm-providers.component.{html,ts}` (`:66/:75/:84`), `features/skills/skills.component.{html,ts}` (`:67/:76/:86`), `features/audit/audit.component.{html,ts}` (`:51/:60`)

**Intent**: Replace each native sort `<button>` with `<app-sort-header>`, wiring the existing sort signal/handler to its input/output. Preserve current sort behavior exactly.

**Contract**: each call site binds the column key + current sort state and handles the toggle output using the component's existing sort method. No change to sort logic in the `.ts`.

#### 3. Simple button swaps → `hlmBtn`

**File**: `apps/web/src/app/features/devices/devices.component.html` (`:4` add, `:29` empty-state add), `features/llm-providers/llm-providers.component.html` (`:4`, `:23`), `features/skills/skills.component.html` (`:4`, `:25`), `features/services/service-detail.component.html` (`:67` re-run diagnose, `:160` per-run replay), `features/services/components/service-skills.component.html` (`:4` run skill), `features/audit/audit.component.html` (any non-sort buttons), `shared/layout/layout.component.html` (`:48` sign-out)

**Intent**: Replace each native `<button>` (currently `appClickable` + `op-*` classes) with `hlmBtn` using the variant mapping (add→default, empty-state add→outline sm, re-run→default, replay→outline sm keeping its inner status dot span, run-skill→outline sm, sign-out→outline sm). Drop `appClickable` and pruned `op-*` classes; add `HlmButton` to each component's imports.

**Contract**: per-button `variant`/`size` per the mapping; `(click)` handlers and `type="button"` unchanged. The replay button keeps its `<span … {{ dotClass(...) }}>●</span>` child.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npx nx lint web`
- Build passes: `npx nx build web`
- Unit tests pass: `npx nx test web`
- New `app-sort-header` has a unit test covering render + sort-toggle output

#### Manual Verification:

- All 12 column headers sort identically to before (active column + direction indicator correct)
- Add / empty-state / re-run / replay / run-skill / sign-out buttons work and look consistent
- No visual regression in the list/detail toolbars

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding.

---

## Phase 4: Action redesign — button-group + dropdown kebab (Tier 3)

### Overview

The deliberate UX redesign: group the action-bar buttons with `hlm-button-group`, and collapse per-row table actions into a `hlm-dropdown-menu` kebab ("…") menu. This is the only non-1:1 phase — verify behavior carefully.

### Changes Required:

#### 1. Action bars → `hlm-button-group`

**File**: `apps/web/src/app/features/devices/devices.component.html` (host action bar `:56-98`: scan / edit host / delete host), `features/services/service-detail.component.html` (detail bar `:35-54`: edit / delete)

**Intent**: Wrap the existing action-bar buttons in `[hlmButtonGroup]`, converting each to `hlmBtn` with the variant mapping (scan/edit→outline, delete host/delete→destructive). Keep the surrounding `@if (selectedDevice())`/`@else` empty-state copy and the managing-host label intact.

**Contract**: `<div hlmButtonGroup>` replacing the `flex gap-[7px]` wrapper; `HlmButtonGroupImports` + `HlmButton` imported. Handlers (`openScan`/`openEdit`/`requestDeleteDevice`, `openRename`/`deleteDialog.open()`) unchanged.

#### 2. Per-row actions → `hlm-dropdown-menu` kebab

**File**: `apps/web/src/app/features/devices/devices.component.{html,ts}` (`:194-214` edit/del), `features/llm-providers/llm-providers.component.{html,ts}` (`:119-151` activate/edit/del), `features/skills/skills.component.{html,ts}` (`:116-137` edit/del)

**Intent**: Replace each per-row `<div class="flex justify-end gap-1.5">…buttons…</div>` with a kebab trigger button (`hlmBtn variant="ghost" size="icon-sm"` + `<ng-icon hlm name="lucideEllipsis" />`) opening a `hlm-dropdown-menu` whose items invoke the existing handlers. Destructive delete items use `hlmDropdownMenuItem variant="destructive"`. Preserve llm-providers' conditional `@if (!provider.active)` activate item.

**Contract**: trigger `<button hlmBtn [hlmDropdownMenuTrigger]="rowMenu" (click)="$event.stopPropagation()">`; content `<ng-template #rowMenu><hlm-dropdown-menu><button hlmDropdownMenuItem (click)="…">edit</button>…</hlm-dropdown-menu></ng-template>`. Register `provideIcons({ lucideEllipsis })` component-local. Import `HlmDropdownMenuImports`, `HlmButton`, `HlmIconImports`. Row-navigation must not fire when opening the menu (stopPropagation on trigger).

### Success Criteria:

#### Automated Verification:

- Lint passes: `npx nx lint web`
- Build passes: `npx nx build web`
- Unit tests pass: `npx nx test web`

#### Manual Verification:

- Opening a per-row kebab does **not** navigate the row; each menu item runs its action (edit, delete, activate)
- llm-providers activate item appears only for inactive providers
- Action bars (devices host bar, service-detail) group visually and all buttons work
- Delete actions still open their confirm dialogs
- Keyboard navigation works in the dropdown (CDK menu); no overlay z-index issues

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding.

---

## Phase 5: Badges + spinner (Tier 3 detail)

### Overview

Finish the detail surfaces: convert the hand-rolled status `<span>` pills to `hlmBadge`, and wire `hlm-spinner` into the three plain-text loading states.

### Changes Required:

#### 1. Badges → `hlmBadge`

**File**: `apps/web/src/app/features/skills/skills.component.html` (`:105` global → `variant="outline"`, `:109` scope → default), `features/services/service-detail.component.html` (`:19-24` header status → `[variant]` + `[class]` from `headerBadgeClass()`), `features/diagnosis/components/synthesis-card.component.ts` (`:47-50` inline-template badge → `[variant]` from `badgeClass(status)`), `features/llm-providers/llm-providers.component.html` (`:107-113` status **text** only → `hlmBadge`; keep the `:102-106` dot)

**Intent**: Apply `hlmBadge` with the appropriate variant (static or computed). For llm-providers, badge-ify only the text per the chosen approach — the status dot stays as a separate hand-rolled element.

**Contract**: `[hlmBadge]` / `<hlm-badge>` with `variant` input (`default | secondary | destructive | ghost | outline | link`); dynamic cases bind `[variant]` from the existing computed class method. Import `HlmBadge` (and for the inline-template card, add to its `imports`).

#### 2. Loading states → `hlm-spinner`

**File**: `apps/web/src/app/features/services/service-detail.component.{html,ts}` (`:12` "loading service…", `:75` "diagnosing…" inside button), `features/services/components/service-skills.component.{html,ts}` (`:10` "running…" inside button)

**Intent**: Replace the plain loading text with `<hlm-spinner />` (optionally beside a short label), driven by the existing loading signals (`entry().loading`, `entry().pending === skill.id`). No icon provider wiring needed (spinner self-registers).

**Contract**: import `HlmSpinnerImports`; `<hlm-spinner aria-label="…" />` rendered under the existing `@if (loading)` conditions. For service-skills, respect the `effect()`-based `input.required()` loading rule (`lessons.md`) — do not read required inputs in the constructor.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npx nx lint web`
- Build passes: `npx nx build web`
- Unit tests pass: `npx nx test web`

#### Manual Verification:

- Status badges render with correct variant/color across skills, service-detail header, synthesis card, llm-providers
- llm-providers still shows the status dot next to the new badge
- Spinners animate during loading (service load, diagnosing, running skill) and disappear when done
- Spinner has an accessible `role="status"` label

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human. This is the final phase.

---

## Testing Strategy

### Unit Tests:

- New `app-sort-header`: render with active/inactive state + sort-toggle output (the only net-new component warranting dedicated tests).
- Existing `apps/web` unit tests must continue to pass after each phase (regression guard for the markup swaps).

### Integration Tests:

- None added (no API/contract changes). e2e is not yet wired in the repo and is out of scope.

### Manual Testing Steps:

1. Auth: submit login/register with valid + invalid input; confirm validation errors and full-width buttons.
2. Sort: click each of the 12 column headers; confirm sort direction + active highlight match pre-migration behavior.
3. Per-row kebab: open a row menu; confirm the row does not navigate, and edit/delete/activate run correctly (including the inactive-only activate item).
4. Action bars: exercise devices host bar (scan/edit/delete) and service-detail (edit/delete); confirm grouped layout and dialogs.
5. Badges + spinners: verify badge variants and the three loading spinners animate and clear.

## Performance Considerations

Negligible. `@angular/cdk` (dropdown-menu/button-group) adds a small bundle increment; the app is zoneless + OnPush and the changes are markup-level. No new network or render hotspots.

## Migration Notes

Pure front-end template/component migration — no data, schema, or API contract changes, so no data migration or rollback concerns beyond reverting commits. Each phase is an independently revertible commit.

## References

- Related research: `context/changes/spartan-ng-component-migration/research.md`
- Driving spec: `context/changes/spartan-ng-component-migration/change.md`
- Canonical hlmInput/hlmLabel/hlmBtn pattern: `apps/web/src/app/features/devices/dialogs/device-form.dialog.{ts,html}`
- Canonical hlmBtn (ghost/icon, bound variant): `apps/web/src/app/shared/components/table-pagination.component.{ts,html}`
- New primitive sources (spartan MCP): `hlm-spinner` (self-provides `lucideLoader2`), `hlm-button-group` (`orientation` input), `hlm-dropdown-menu` (CDK menu; trigger/content/`hlmDropdownMenuItem variant`)
- Rules: `.claude/rules/spartan.md`, `tailwind.md`, `angular.md`, `lessons.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Scaffold new primitives

#### Automated

- [x] 1.1 Lint passes (web + ui) — a0ee144
- [x] 1.2 Build passes: `npx nx build web` — a0ee144

#### Manual

- [x] 1.3 Three primitive folders exist with `Hlm*Imports` exported — a0ee144
- [x] 1.4 `@angular/cdk` resolves with no peer-dep warning — a0ee144

### Phase 2: Auth screens

#### Automated

- [x] 2.1 Lint passes: `npx nx lint web` — 0e6f8b8
- [x] 2.2 Build passes: `npx nx build web` — 0e6f8b8
- [x] 2.3 Unit tests pass: `npx nx test web` — 0e6f8b8

#### Manual

- [x] 2.4 Login/register render with consistent input/label/button styling — 0e6f8b8
- [x] 2.5 Validation errors still appear on touched+invalid fields — 0e6f8b8
- [x] 2.6 Submit buttons full-width and trigger sign-in / create-account — 0e6f8b8

### Phase 3: Button swaps + shared sort-header

#### Automated

- [x] 3.1 Lint passes: `npx nx lint web` — 7b01031
- [x] 3.2 Build passes: `npx nx build web` — 7b01031
- [x] 3.3 Unit tests pass: `npx nx test web` — 7b01031
- [x] 3.4 `app-sort-header` unit test covers render + sort-toggle output — 7b01031

#### Manual

- [x] 3.5 All 12 column headers sort identically (active column + direction) — 7b01031
- [x] 3.6 Add / empty-state / re-run / replay / run-skill / sign-out buttons work and look consistent — 7b01031
- [x] 3.7 No visual regression in list/detail toolbars — 7b01031

### Phase 4: Action redesign — button-group + dropdown kebab

#### Automated

- [x] 4.1 Lint passes: `npx nx lint web` — 16434db
- [x] 4.2 Build passes: `npx nx build web` — 16434db
- [x] 4.3 Unit tests pass: `npx nx test web` — 16434db

#### Manual

- [x] 4.4 Opening a per-row kebab does not navigate the row; items run their actions — 16434db
- [x] 4.5 llm-providers activate item appears only for inactive providers — 16434db
- [x] 4.6 Action bars group visually and all buttons work — 16434db
- [x] 4.7 Delete actions still open confirm dialogs — 16434db
- [x] 4.8 Dropdown keyboard navigation works; no overlay z-index issues — 16434db

### Phase 5: Badges + spinner

#### Automated

- [x] 5.1 Lint passes: `npx nx lint web`
- [x] 5.2 Build passes: `npx nx build web`
- [x] 5.3 Unit tests pass: `npx nx test web`

#### Manual

- [x] 5.4 Status badges render with correct variant/color across all sites
- [x] 5.5 llm-providers shows the status dot next to the new badge
- [x] 5.6 Spinners animate during loading and clear when done
- [x] 5.7 Spinner has accessible `role="status"` label
