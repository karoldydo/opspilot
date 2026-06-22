# Consistent Clickable Affordance Across apps/web — Plan Brief

> Full plan: `context/changes/web-clickable-hover-affordance/plan.md`
> Research: `context/changes/web-clickable-hover-affordance/research.md`

## What & Why

Every interactive element in `apps/web` should signal that it's clickable — `cursor-pointer` +
hover / focus-visible / active states on the `op-*` design tokens. Today only 5 controls (in 2
files) carry this; ~30+ elements across ~13 templates have no affordance at all. The recipe was
previously copy-pasted, which violates the project's own spartan rule against hand-concatenated
class strings. We fix the inconsistency *and* the duplication by introducing a single source of
truth.

## Starting Point

Phase 3 of `fix-skills-not-clickable-in-devices` applied a ~20-utility affordance string to 5
controls in `service-skills` / `device-services`. There's no directive, mixin, or shared class — and
no `shared/directives/` folder. `op-*` tokens are color custom properties in `styles.scss`; dialog
buttons use spartan's `hlmBtn` on helm semantic tokens, merged via twMerge.

## Desired End State

Buttons, links, the audit row, and dialog footer buttons all show a consistent op-* affordance
driven by one shared `opClickable` directive + `clickableClasses()` function. The audit pseudo-button
is a real keyboard-native `<button>`, and dialog buttons get op-* hover while keeping hlmBtn sizing.

## Key Decisions Made

| Decision                    | Choice                                              | Why (1 sentence)                                                                 | Source   |
| --------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------- | -------- |
| Abstraction                 | `opClickable` attribute directive + shared fn       | One source of truth; satisfies spartan.md / angular.md; catches sibling misses   | Plan     |
| Link affordance             | Dedicated `link` variant                            | Links should read as links, not card-fill chips; one directive still owns all    | Plan     |
| Dialog buttons              | Migrate to op-* affordance, keep hlmBtn structure   | User wants uniform affordance; override colors only, retain hlmBtn sizing/radius  | Plan     |
| Dialog injection mechanism  | Class string via hlmBtn twMerge (not the directive) | twMerge dedups conflicting hover deterministically; directive would gamble on CSS order | Plan |
| Audit pseudo-button         | Promote to real `<button>` (conditional per row)    | Fixes the keyboard/a11y gap while adding affordance; only synthesis rows are interactive | Plan |
| Testing                     | Directive unit tests + component regression test    | Protects the single source of truth and catches missed elements                  | Plan     |

## Scope

**In scope:** `opClickable` directive + `clickableClasses()`; affordance on CRUD list buttons,
nav/auth/diagnosis links & buttons, the audit row (promoted to `<button>`), and dialog/alert-dialog
buttons (op-* override).

**Out of scope:** new op-* hover/focus/ring tokens; new shared button component; migrating non-dialog
controls onto hlmBtn; any routing/business-logic/click-handler behavior change.

## Architecture / Approach

A pure `clickableClasses(variant, opts?)` function encodes the recipe once for four variants
(`primary`/`secondary`/`danger`/`link`). Native op-* controls consume it via the `opClickable`
directive (additive class application, no clobbering). Dialog `hlmBtn` controls consume the same
string through the element's `class`, which spartan merges via twMerge so op-* hover wins
deterministically over the CVA hover.

## Phases at a Glance

| Phase                              | What it delivers                                          | Key risk                                            |
| ---------------------------------- | --------------------------------------------------------- | --------------------------------------------------- |
| 1. Directive + shared fn           | `opClickable` + `clickableClasses()` + unit tests         | Getting the additive (non-clobbering) class apply right |
| 2. CRUD list buttons               | Affordance on skills/llm-providers/devices/replay         | Disabled-state + no layout shift                    |
| 3. Nav / auth / diagnosis          | `link` variant + buttons on layout/overview/diagnosis/auth | Link variant must not look like a card-fill block   |
| 4. Audit → `<button>`              | Keyboard-native interactive audit row                     | Conditional per-row render; preserve row layout     |
| 5. Dialog button migration         | op-* affordance on hlmBtn + alert-dialog buttons          | Highest regression risk — touches working dialogs   |

**Prerequisites:** none beyond the existing apps/web setup.
**Estimated effort:** ~2-3 sessions across 5 phases (Phase 1 is the only non-mechanical one).

## Open Risks & Assumptions

- Dialog-button migration (Phase 5) overrides spartan's working affordance — requires careful visual
  verification that twMerge resolves op-* hover over the CVA hover as expected.
- The `link` variant's exact hover treatment (underline vs subtle opacity) is settled at
  implementation time against the recorded recipe and a visual check.
- Audit promotion assumes only `event.synthesis` rows are interactive (confirmed in current source).

## Success Criteria (Summary)

- Every clickable element in apps/web shows consistent hover/focus-visible/active affordance.
- The affordance comes from one shared source (directive + function), not copy-pasted strings.
- Lint, build, and unit/regression tests pass; no layout regressions in feature screens or dialogs.
