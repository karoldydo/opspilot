<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Apply Consistent Clickable Affordance Across apps/web

- **Plan**: context/changes/web-clickable-hover-affordance/plan.md
- **Scope**: All 5 phases (complete)
- **Date**: 2026-06-22
- **Verdict**: NEEDS ATTENTION (warnings fixed during triage)
- **Findings**: 0 critical, 3 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING (benign) |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Notes

The abstraction is sound: `clickableClasses()` is built with `hlm()` (no hand-concatenation), and
the `appClickable` directive applies classes additively via spartan's `classes()` helper (internal
`effect()` + per-element class manager, confirmed by reading `libs/ui/utils/src/lib/hlm.ts`) — static
`op-*` color classes are provably preserved (explicit anti-clobber spec assertion). The audit
`<div>`→`<button>` promotion is correct (native button, intrinsic keyboard, conditional per row).
Dialog buttons correctly use the class-string + twMerge path, not the directive. No clobber, no
accidental form submits, no accessibility demotions. Automated gates green: `nx test web` (86 passed),
`nx lint web`, `nx build web` (bundle-budget warning pre-existing).

## Findings

### F1 — Header "+ add" create CTAs left without affordance

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence / Pattern Consistency
- **Location**: skills.component.html:4-10, llm-providers.component.html:4-11, devices.component.html:4-10
- **Detail**: The primary header CTA on each list page had no `appClickable` (only the empty-state twins did). Plan Phase 2 said "create…=primary"; the most prominent primary action per page was uncovered. Manual checkbox 2.4 was marked `[x]` despite the gap (likely rubber-stamped). Being dark ink-filled buttons, they needed `variant="solid"`, not the plan's literal `primary`.
- **Fix**: Added `appClickable variant="solid"` to the 3 header create buttons.
- **Decision**: FIXED

### F2 — device-services "scan" button left without affordance

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: services/components/device-services.component.html:7-13
- **Detail**: Every other control in the component got the affordance (diagnose, open, edit, delete, replay); the "scan" primary action did not. Bordered cream button → `secondary`.
- **Fix**: Added `appClickable variant="secondary"` to the scan button.
- **Decision**: FIXED

### F3 — overview "diagnose →" filled pill uses the `link` variant

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: overview.component.html:59-65
- **Detail**: A solid filled pill (`bg-op-ink text-op-cream`) was tagged `variant="link"`, so hover underlined cream text instead of the dark-range hover `solid` provides. Cursor-pointer + focus ring were fine; only the hover treatment was wrong.
- **Fix**: Changed `variant="link"` → `variant="solid"` on the anchor.
- **Decision**: FIXED

### F4 — Directive selector is [appClickable], plan said [opClickable]

- **Severity**: 🟡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: shared/directives/clickable.directive.ts:7
- **Detail**: Implemented as `[appClickable]` throughout (internally consistent), matching the repo's `app-` prefix convention (CLAUDE.md). Justified deviation from the plan name.
- **Fix**: None — accept as a convention-aligned rename.
- **Decision**: ACCEPTED

### F5 — Variant set expanded 4→6 (solid, danger-solid) vs plan

- **Severity**: 🟡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: shared/directives/clickable-classes.ts:6,16-17,35-38,50-52
- **Detail**: Implementation added `solid`/`danger-solid` (dark-fill hover via `op-charcoal`/`op-ink-deep`) so dark hlmBtn dialog buttons keep cream text legible — a coherent Phase-5 discovery reusing existing tokens (no new `op-*` tokens, respecting the guardrail).
- **Fix**: None — accept; optionally note the discovery as a plan addendum.
- **Decision**: ACCEPTED

### F6 — Directive never passes opts.disabled

- **Severity**: 🟡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: shared/directives/clickable.directive.ts:13
- **Detail**: Disabled styling comes only from CSS `disabled:` utilities baked into disable-aware variants (primary/solid/danger-solid). Cleaner than the plan's "read host disabled state," but a non-disable-aware variant (secondary/link/danger) can't opt into disabled styling via the directive.
- **Fix**: None now — optionally expose a `disabled` input later if a non-primary control needs it.
- **Decision**: ACCEPTED
