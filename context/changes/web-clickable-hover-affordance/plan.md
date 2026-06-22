# Apply Consistent Clickable Affordance Across apps/web — Implementation Plan

## Overview

Give every interactive element in `apps/web` a consistent clickable affordance (`cursor-pointer` +
hover / focus-visible / active states built on the `op-*` design tokens), generalizing the recipe
Phase 3 of `fix-skills-not-clickable-in-devices` applied to just 5 controls. Instead of
copy-pasting a ~20-utility class string per element, introduce a single source of truth — an
`opClickable` Angular attribute directive plus a shared `clickableClasses(variant)` function — and
apply it across the ~13 uncovered templates (~30+ elements), including a `<div>` → `<button>`
promotion in audit and a migration of the spartan-mediated dialog buttons.

## Current State Analysis

- The affordance recipe exists only as a copy-pasted class string on **5 controls in 2 files**
  (`service-skills.component.html:5`, `device-services.component.html:41,49,56,63`). There is **no
  reusable abstraction** — no directive, no SCSS mixin, no `.clickable` class.
- `apps/web/src/app/shared/` holds only `layout/` and `validators/` — there is no `directives/`
  folder yet and no app-level shared button component.
- `op-*` tokens are color/radius custom properties in a single Tailwind v4 `@theme` block
  (`apps/web/src/styles.scss:56-98`); there are **no dedicated hover/focus/ring tokens** —
  interactivity composes the base color tokens.
- `hlmBtn` (`libs/ui/button/src/lib/hlm-button.ts`) is used **only in dialog footers** and keys off
  helm semantic tokens (`--primary`/`--ring`), not `op-*`. Critically, it merges its variant classes
  with any additional classes through `classes()` (twMerge), so conflicting hover utilities are
  **deterministically deduplicated (last wins)** — this is the safe injection point for op-* hover.
- The audit pseudo-button (`audit.component.html:26-34`) is a `<div>` with conditional
  `[attr.role]="event.synthesis ? 'button' : null"`, `[attr.tabindex]`, `(keydown.enter)`,
  `(keydown.space)`, and `[class.cursor-pointer]` — it is **already keyboard-wired**, but only for
  rows where `event.synthesis` is truthy.
- Project rules already prescribe the abstraction: `spartan.md` bans hand-concatenated class strings
  (use `classes()`/`hlm()`), `angular.md` bans `@HostBinding` (use the `host` object), and
  `tailwind.md` is utilities-first.

## Desired End State

Every clickable element in `apps/web` — buttons, links, the audit row, and dialog footer buttons —
shows a consistent `cursor-pointer` + hover/focus-visible/active affordance driven by `op-*` tokens
through one shared source of truth. Verified by: the `opClickable` directive unit tests pass,
component regression tests assert the affordance is present on representative controls, `npm run lint`
/ `npm run test` / `npm run build` are green, and a manual visual pass confirms hover/focus/active on
each feature screen and dialog with no layout regressions.

### Key Discoveries:

- `libs/ui/button/src/lib/hlm-button.ts:64` — `classes(() => [buttonVariants(...),
  this._additionalClasses()])` merges via twMerge → appending op-* hover utilities to a dialog
  button's class wins over the CVA hover deterministically (no CSS-order gamble).
- `apps/web/src/app/features/audit/audit.component.html:26-34` — keyboard handlers already exist and
  are gated on `event.synthesis`; promotion to `<button>` must stay conditional per row.
- `apps/web/src/styles.scss:56-98` — the `op-*` token palette the variants compose; `:127,215-218` —
  helm `--ring` + global `outline-ring/50` binding.
- Canonical recipe + variants are recorded in `research.md` (shared fragment, bordered/disable-able/
  destructive add-ons) and `context/archive/2026-06-22-fix-skills-not-clickable-in-devices/plan.md:214-258`.

## What We're NOT Doing

- Not introducing new `op-*` hover/focus/ring tokens — variants compose existing base tokens.
- Not unifying the two token namespaces — dialog buttons keep their `hlmBtn` structure (size,
  padding, radius); only their hover/focus/active affordance is overridden with op-* utilities.
- Not re-styling the 5 already-covered controls (they stay as-is, or are migrated to the directive
  only if trivially equivalent — see Phase 2 note).
- Not adding a new app-level button component or migrating non-dialog controls onto `hlmBtn`.
- Not changing routing, business logic, or any `(click)` handler behavior — purely affordance + the
  one audit element-type swap.

## Implementation Approach

Build the abstraction first (Phase 1), then apply it outward in independently-verifiable slices:
CRUD list buttons (Phase 2), navigation/auth/diagnosis with the `link` variant (Phase 3), the audit
`<div>`→`<button>` promotion (Phase 4), and finally the spartan dialog-button migration (Phase 5).

The single source of truth is a pure function `clickableClasses(variant, opts?)` returning the
canonical utility string per variant (`primary` | `secondary` | `danger` | `link`), disabled-aware.
It is consumed two ways:

1. **Native op-* controls** — via the `opClickable` directive, which reads `variant` + `disabled`
   and applies the classes through the `host` object / `Renderer2` additively (the existing static
   color classes carry no hover, so there is no conflict to resolve).
2. **`hlmBtn` dialog controls** — by appending the same string to the element's `class`, which
   spartan merges through `classes()`/twMerge so op-* hover wins over the CVA hover deterministically.

## Critical Implementation Details

- **Don't clobber existing classes.** The directive must add affordance classes **additively**
  (`host` class bindings per token, or `Renderer2.addClass`), never via a `[class]="..."` binding —
  a whole-attribute binding would wipe each element's existing static `op-*` color classes.
- **Dialog buttons go through twMerge, not the directive.** On `hlmBtn` elements, apply the
  affordance as a class string the element/`hlmBtn` merges via `classes()`; do **not** stack the
  `opClickable` directive there, because `Renderer2.addClass` bypasses twMerge and reintroduces the
  CSS-order ambiguity between op-* hover and the CVA hover.
- **Audit promotion stays conditional per row.** Only `event.synthesis` rows are interactive.
  Promotion means conditionally rendering a `<button opClickable>` for synthesis rows and a plain
  non-interactive element for the rest (e.g. `@if (event.synthesis) { <button …> } @else { <div …> }`),
  preserving the current row layout/classes — not unconditionally turning every row into a button.

## Phase 1: Affordance Directive + Shared Class Function

### Overview

Create the single source of truth — `clickableClasses()` and the `opClickable` directive — with unit
tests. No template touched yet, so no visual change ships in this phase.

### Changes Required:

#### 1. Shared affordance class function

**File**: `apps/web/src/app/shared/directives/clickable-classes.ts` (new)

**Intent**: Encode the canonical affordance recipe once as a pure, typed function so both the
directive and the dialog-button migration draw from the same definition.

**Contract**: `export type ClickableVariant = 'primary' | 'secondary' | 'danger' | 'link';` and
`export function clickableClasses(variant: ClickableVariant, opts?: { disabled?: boolean }): string`.
Returns the merged utility string per variant, built with `hlm()`/`classes()` from
`@spartan-ng/helm` (no hand-concatenation). Variants map to the recorded recipe: shared base
(`cursor-pointer transition-colors hover:bg-op-surface-card focus-visible:ring-1
focus-visible:ring-op-ink focus-visible:outline-none active:bg-op-surface-soft`); `secondary` adds
`hover:border-op-hairline-strong`; `danger` swaps the ring to `focus-visible:ring-op-danger`;
`primary` is disable-able (`disabled:cursor-not-allowed disabled:opacity-60`); `link` uses a
link-appropriate treatment (underline-offset + `hover:underline` / subtle opacity, focus-visible
ring) instead of the card-fill hover.

#### 2. `opClickable` attribute directive

**File**: `apps/web/src/app/shared/directives/clickable.directive.ts` (new)

**Intent**: A standalone attribute directive that applies the affordance classes additively to its
host element, driven by a `variant` input and disabled state, following `angular.md` (host object,
no `@HostBinding`).

**Contract**: selector `[opClickable]`; `variant = input<ClickableVariant>('secondary')`; reads the
host's disabled state for disable-aware variants. Applies `clickableClasses(variant())` additively
without overwriting existing static classes (per Critical Implementation Details). Standalone,
`scope:web`.

#### 3. Directive unit tests

**File**: `apps/web/src/app/shared/directives/clickable.directive.spec.ts` (new)

**Intent**: Lock the directive's contract — correct classes per variant and disabled handling.

**Contract**: tests assert that a host element with `opClickable variant="…"` ends up with the
expected affordance utilities for each of the four variants, that existing static classes are
preserved (not clobbered), and that disable-aware variants include the disabled utilities.

### Success Criteria:

#### Automated Verification:

- [ ] Directive unit tests pass: `npx nx test web -- src/app/shared/directives/clickable.directive.spec.ts`
- [ ] Linting passes: `npm run lint`
- [ ] Type checking / build passes: `npm run build:web`

#### Manual Verification:

- [ ] `clickableClasses()` output for each variant matches the recorded recipe in `research.md`

**Implementation Note**: After completing this phase and all automated verification passes, pause
for manual confirmation before proceeding.

---

## Phase 2: CRUD List Buttons

### Overview

Apply the directive to the button-like controls in the CRUD list features that currently have no
affordance, plus the `device-services` replay button missed by Phase 3.

### Changes Required:

#### 1. Skills / LLM providers / devices list buttons

**Files**: `apps/web/src/app/features/skills/skills.component.html`,
`apps/web/src/app/features/llm-providers/llm-providers.component.html`,
`apps/web/src/app/features/devices/devices.component.html`

**Intent**: Add `opClickable` with the matching variant to create / activate / edit / delete (and
row) buttons enumerated in `research.md` — create/activate as `primary` (disable-able), edit as
`secondary`, delete as `danger`.

**Contract**: each `<button>` gains `opClickable variant="…"`; exact elements/lines listed in
`research.md` inventory (`skills` `:4-10,:23-29,:59-65,:66-72`; `llm-providers`
`:4-10,:21-27,:57-63,:65-71,:72-78`; `devices` `:4-10,:22-28,:43-49,:50-56`). Each component's `.ts`
imports the directive.

#### 2. `device-services` replay button

**File**: `apps/web/src/app/features/services/components/device-services.component.html`

**Intent**: Bring the replay button (`:139-147`) — sibling of four already-styled controls — to the
`secondary` variant via the directive, closing the Phase-3 omission.

**Contract**: replay `<button>` gains `opClickable variant="secondary"`. Optionally migrate the four
existing string-styled siblings to the directive only if the rendered classes are equivalent;
otherwise leave them untouched.

#### 3. Regression test

**File**: component spec under the skills feature (e.g.
`apps/web/src/app/features/skills/skills.component.spec.ts`, new or extended)

**Intent**: Mirror the Phase-2 regression pattern from `fix-skills-not-clickable-in-devices` —
assert a representative list button renders with the affordance applied.

**Contract**: test asserts the create/edit/delete button host carries the affordance utilities
(e.g. `cursor-pointer` + the variant's hover) once `opClickable` is applied.

### Success Criteria:

#### Automated Verification:

- [ ] Component tests pass: `npx nx test web`
- [ ] Linting passes: `npm run lint`
- [ ] Build passes: `npm run build:web`

#### Manual Verification:

- [ ] Hover/focus-visible/active visible on skills, llm-providers, devices, and replay buttons
- [ ] Disabled primary buttons show `not-allowed` cursor + reduced opacity, no hover
- [ ] No layout shift versus the previous static styling

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Navigation, Auth & Diagnosis (link + button variants)

### Overview

Apply the `link` variant to text/nav links and the appropriate button variants to the buttons that
sit in the same templates, so each of these files is touched exactly once.

### Changes Required:

#### 1. Sidebar navigation + sign-out

**File**: `apps/web/src/app/shared/layout/layout.component.html`

**Intent**: Give sidebar nav links (`:16-31`) and the sign-out control (`:46-52`) affordance — `link`
variant for nav links, button variant for sign-out.

**Contract**: nav anchors gain `opClickable variant="link"`; sign-out gains `opClickable` with the
fitting variant. Active-link state is preserved.

#### 2. Overview nav links / CTAs + fleet row

**File**: `apps/web/src/app/features/overview/overview.component.html`

**Intent**: Add `link` affordance to nav links/CTAs (`:12-14`, `:55-59`) and a button-style
affordance to the fleet row (`:68-71`, currently `cursor-pointer` only).

**Contract**: links gain `opClickable variant="link"`; fleet row gains the matching variant
(replacing its bare `cursor-pointer`).

#### 3. Diagnosis hero

**File**: `apps/web/src/app/features/diagnosis/diagnose-hero.component.html`

**Intent**: Affordance for the back link (`:2`, `link`), rerun (`:15-22`) and replay (`:136-144`)
buttons.

**Contract**: back link gains `variant="link"`; rerun/replay gain `primary`/`secondary` per their
role.

#### 4. Auth screens

**Files**: `apps/web/src/app/features/auth/login/login.component.html`,
`apps/web/src/app/features/auth/register/register.component.html`

**Intent**: Submit buttons (`login:47-53`, `register:63-69`) as `primary` (disable-able); register
/ login text links (`login:58`, `register:74`) as `link`.

**Contract**: submit `<button>` gains `opClickable variant="primary"`; text links gain
`variant="link"`. Each component `.ts` imports the directive.

### Success Criteria:

#### Automated Verification:

- [ ] Component tests pass: `npx nx test web`
- [ ] Linting passes: `npm run lint`
- [ ] Build passes: `npm run build:web`

#### Manual Verification:

- [ ] Sidebar nav, sign-out, overview links/CTAs/row, diagnosis controls, and auth submit/links all
      show consistent affordance
- [ ] `link` variant reads as a link (not a card-fill block) and active nav state is unaffected
- [ ] Auth submit disabled state behaves correctly

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: Audit Pseudo-Button → Real `<button>`

### Overview

Promote the conditional audit row from a `<div role="button">` to a real `<button>` for the
interactive (`event.synthesis`) rows, applying the directive and removing the ad-hoc role/tabindex/
cursor juggling — while keeping non-synthesis rows as plain, non-interactive elements.

### Changes Required:

#### 1. Audit row promotion

**File**: `apps/web/src/app/features/audit/audit.component.html`

**Intent**: For synthesis rows, render a native `<button opClickable>` (drops `[attr.role]`,
`[attr.tabindex]`, `[class.cursor-pointer]`, and the manual `keydown.enter/space` handlers — the
button handles keyboard natively); for non-synthesis rows, render the plain row unchanged.

**Contract**: `@if (event.synthesis) { <button … (click)="store.select(event.id)" opClickable> … </button> } @else { <div …> … </div> }`,
preserving the existing row classes/layout (`border-op-hairline flex items-center gap-4 …`). Reset
native button defaults as needed (text-align/appearance) so the row visually matches the div.

### Success Criteria:

#### Automated Verification:

- [ ] Component tests pass: `npx nx test web`
- [ ] Linting passes: `npm run lint`
- [ ] Build passes: `npm run build:web`

#### Manual Verification:

- [ ] Synthesis rows are clickable, keyboard-focusable, and activate via Enter/Space with visible
      focus-visible ring
- [ ] Non-synthesis rows are not focusable and show no affordance
- [ ] Row layout is visually identical to before the swap

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 5: Dialog Button Migration (hlmBtn + alert-dialog)

### Overview

Override the affordance of spartan-mediated dialog buttons with op-* utilities while keeping the
`hlmBtn` structure (size/padding/radius), using the shared `clickableClasses()` string merged
through spartan's twMerge so op-* hover wins deterministically.

### Changes Required:

#### 1. Dialog footer buttons

**Files**: dialog templates under `apps/web/src/app/features/*/dialogs/*.html`
(`skill-form`, `llm-provider-form`, `device-form`, `scan-services`, `rename-service`, `run-skill`)

**Intent**: Append the op-* affordance string to each `hlmBtn` footer button's `class` so its
hover/focus/active matches the op-* surface, retaining hlmBtn sizing.

**Contract**: each `button hlmBtn` gains the `clickableClasses(variant)` utilities via its `class`
attribute (merged by `classes()`/twMerge in `hlm-button.ts:64`) — **not** via the `opClickable`
directive (see Critical Implementation Details). Map submit→`primary`, cancel→`secondary`.

#### 2. Alert-dialog confirm/cancel buttons

**Files**: list components using `hlmAlertDialogCancel` / `hlmAlertDialogAction` (skills,
llm-providers, devices, services confirm dialogs)

**Intent**: Same op-* affordance override on the confirm/cancel actions, with destructive confirms
using the `danger` variant.

**Contract**: confirm/cancel controls gain the `clickableClasses(variant)` utilities via `class`;
destructive confirm → `danger`, cancel → `secondary`.

### Success Criteria:

#### Automated Verification:

- [ ] Component tests pass: `npx nx test web`
- [ ] Linting passes: `npm run lint`
- [ ] Build passes: `npm run build:web`

#### Manual Verification:

- [ ] Every dialog footer + alert-dialog button shows op-* hover/focus/active, with hlmBtn sizing
      and radius intact (no layout regression)
- [ ] op-* hover visibly wins over the previous CVA hover (twMerge dedup confirmed in the browser)
- [ ] Destructive confirm buttons use the danger affordance

**Implementation Note**: Pause for manual confirmation; this phase carries the highest regression
risk (it touches working spartan dialogs).

---

## Testing Strategy

### Unit Tests:

- `clickableClasses()` returns the recorded recipe per variant; disabled-aware variants include
  disabled utilities.
- `opClickable` directive applies the correct classes additively per variant without clobbering
  existing static classes.

### Integration Tests:

- Component regression test (Phase 2) asserting a representative list button renders with the
  affordance applied — mirrors the `fix-skills-not-clickable-in-devices` Phase-2 pattern.

### Manual Testing Steps:

1. Walk each feature screen (skills, llm-providers, devices, services, overview, diagnosis, audit,
   auth) and confirm hover/focus-visible/active on every control.
2. Tab through with the keyboard and confirm focus-visible rings appear and Enter/Space activate the
   audit row.
3. Open each dialog and confirm footer + confirm/cancel buttons show op-* affordance with hlmBtn
   sizing intact and no layout shift.
4. Verify disabled primary buttons show `not-allowed` + reduced opacity and no hover.

## Performance Considerations

Purely styling/structure; no runtime performance impact. The directive adds classes once on init.

## Migration Notes

No data or schema migration. The only structural change is the audit `<div>`→`<button>` swap, scoped
to interactive rows.

## References

- Related research: `context/changes/web-clickable-hover-affordance/research.md`
- Canonical recipe + Phase-3 history: `context/archive/2026-06-22-fix-skills-not-clickable-in-devices/plan.md:214-258`, commit `672c921`
- `libs/ui/button/src/lib/hlm-button.ts:64` — twMerge merge point for dialog-button override
- `apps/web/src/styles.scss:56-98` — `op-*` token palette
- Rules: `.claude/rules/spartan.md`, `.claude/rules/angular.md`, `.claude/rules/tailwind.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Affordance Directive + Shared Class Function

#### Automated

- [x] 1.1 Directive unit tests pass: `npx nx test web -- src/app/shared/directives/clickable.directive.spec.ts` — d08a75b
- [x] 1.2 Linting passes: `npm run lint` — d08a75b
- [x] 1.3 Type checking / build passes: `npm run build:web` — d08a75b

#### Manual

- [x] 1.4 `clickableClasses()` output for each variant matches the recorded recipe in `research.md` — d08a75b

### Phase 2: CRUD List Buttons

#### Automated

- [x] 2.1 Component tests pass: `npx nx test web`
- [x] 2.2 Linting passes: `npm run lint`
- [x] 2.3 Build passes: `npm run build:web`

#### Manual

- [x] 2.4 Hover/focus-visible/active visible on skills, llm-providers, devices, and replay buttons
- [x] 2.5 Disabled primary buttons show `not-allowed` cursor + reduced opacity, no hover
- [x] 2.6 No layout shift versus the previous static styling

### Phase 3: Navigation, Auth & Diagnosis (link + button variants)

#### Automated

- [ ] 3.1 Component tests pass: `npx nx test web`
- [ ] 3.2 Linting passes: `npm run lint`
- [ ] 3.3 Build passes: `npm run build:web`

#### Manual

- [ ] 3.4 Sidebar nav, sign-out, overview links/CTAs/row, diagnosis controls, and auth submit/links show consistent affordance
- [ ] 3.5 `link` variant reads as a link (not a card-fill block) and active nav state is unaffected
- [ ] 3.6 Auth submit disabled state behaves correctly

### Phase 4: Audit Pseudo-Button → Real `<button>`

#### Automated

- [ ] 4.1 Component tests pass: `npx nx test web`
- [ ] 4.2 Linting passes: `npm run lint`
- [ ] 4.3 Build passes: `npm run build:web`

#### Manual

- [ ] 4.4 Synthesis rows are clickable, keyboard-focusable, and activate via Enter/Space with visible focus-visible ring
- [ ] 4.5 Non-synthesis rows are not focusable and show no affordance
- [ ] 4.6 Row layout is visually identical to before the swap

### Phase 5: Dialog Button Migration (hlmBtn + alert-dialog)

#### Automated

- [ ] 5.1 Component tests pass: `npx nx test web`
- [ ] 5.2 Linting passes: `npm run lint`
- [ ] 5.3 Build passes: `npm run build:web`

#### Manual

- [ ] 5.4 Every dialog footer + alert-dialog button shows op-* hover/focus/active, with hlmBtn sizing and radius intact
- [ ] 5.5 op-* hover visibly wins over the previous CVA hover (twMerge dedup confirmed in the browser)
- [ ] 5.6 Destructive confirm buttons use the danger affordance
