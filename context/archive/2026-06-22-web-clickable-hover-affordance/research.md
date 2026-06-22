---
date: 2026-06-22T00:00:00+02:00
researcher: Karol Dydo
git_commit: 339bb2b32cea53588892dee96cf0418782ab1452
branch: main
repository: opspilot
topic: "Apply consistent clickable affordance across all interactive elements in apps/web"
tags: [research, codebase, apps-web, affordance, tailwind, spartan, op-tokens]
status: complete
last_updated: 2026-06-22
last_updated_by: Karol Dydo
---

# Research: Apply consistent clickable affordance across all interactive elements in apps/web

**Date**: 2026-06-22T00:00:00+02:00
**Researcher**: Karol Dydo
**Git Commit**: 339bb2b32cea53588892dee96cf0418782ab1452
**Branch**: main
**Repository**: opspilot

## Research Question

Sweep the entire `apps/web` directory, find every clickable element (`button`, `a`, `[routerLink]`,
elements with a `(click)` handler, `role="button"`, etc.), and give them a consistent clickable
affordance (`cursor-pointer` + hover/focus-visible/active using the `op-*` tokens), analogous to the
pattern applied in Phase 3 of the `fix-skills-not-clickable-in-devices` change (service-skills /
device-services action buttons).

## Summary

The change is **entirely unimplemented**. The only commit whose subject implies the work —
`9e4ff5b feat(apps/web): apply consistent clickable affordance across all interactive elements` —
is mislabeled: it touches **no `apps/web` source at all**; its whole diff is the scaffold file
`context/changes/web-clickable-hover-affordance/change.md`. The real affordance recipe lives in
`672c921` (Phase 3 of the archived `fix-skills-not-clickable-in-devices`), which styled exactly
**5 controls in 2 files** under the services feature. Everything else is uncovered.

Across `apps/web`, **~87 interactive elements in ~17 templates** were found. Only **5 native
controls** carry the full canonical affordance; another handful have ad-hoc `cursor-pointer` only;
dialog buttons get affordance indirectly through spartan's `hlmBtn`. The remaining ~13–14 templates
have interactive elements with **no hover/focus-visible/active state**.

Key architectural finding: **there is no reusable affordance abstraction** — no directive, no SCSS
mixin, no global `.clickable` class. The canonical affordance is a ~20-utility class string
**copy-pasted verbatim** onto each element. Applying it consistently today means duplicating that
string everywhere — which directly violates the project's own spartan rule
("Don't hand-concatenate class strings… use `classes()`/`hlm()`"). This is the central design
decision the plan must resolve: **duplicate the string, or introduce a single source of truth**
(an Angular attribute directive that sets the `host` classes is the idiomatic fit).

## Detailed Findings

### The canonical affordance recipe (Phase 3 / commit 672c921)

The pattern keeps each element's existing static color trio (`border-op-*` / `text-op-*` /
`bg-op-cream`) and **appends** an affordance fragment. No `hlmBtn` is reintroduced (a deliberate
Phase-3 decision recorded in the archived plan).

Shared affordance fragment:

```
cursor-pointer transition-colors
hover:bg-op-surface-card
focus-visible:ring-1 focus-visible:ring-op-ink focus-visible:outline-none
active:bg-op-surface-soft
```

Variant add-ons:
- **Bordered (secondary)** elements also darken the border on hover: `hover:border-op-hairline-strong`
- **Disable-able** controls add: `disabled:cursor-not-allowed disabled:opacity-60`
- **Destructive** controls swap the focus ring to danger: `focus-visible:ring-op-danger`
  (and keep `border-op-danger text-op-danger-text`; no hover-border change)

Canonical examples in current source:
- `apps/web/src/app/features/services/components/service-skills.component.html:5` — the namesake skill chip
- `apps/web/src/app/features/services/components/device-services.component.html:41` — diagnose (primary, disable-able)
- `apps/web/src/app/features/services/components/device-services.component.html:49` — `open →` anchor (secondary bordered)
- `apps/web/src/app/features/services/components/device-services.component.html:56` — edit (secondary bordered)
- `apps/web/src/app/features/services/components/device-services.component.html:63` — delete (destructive)

### The `op-*` token system

All `op-*` tokens are color/radius/animation custom properties declared in a single Tailwind v4
`@theme` block in `apps/web/src/styles.scss:56-98` (no `tailwind.config.js` — CSS-first). They are
the DESIGN.md palette, intentionally separate from helm's semantic namespace. **There are no
dedicated hover/focus/ring tokens** — interactivity composes the base color tokens:

| Token | Value | Role in affordance |
|---|---|---|
| `--color-op-ink` (`styles.scss:64`) | `#201d1d` | `focus-visible:ring-op-ink` |
| `--color-op-cream` (`:66`) | `#fdfcfc` | default interactive bg |
| `--color-op-body` (`:68`) | `#424245` | default interactive text |
| `--color-op-surface-card` (`:76`) | `#f1eeee` | `hover:bg-op-surface-card` |
| `--color-op-surface-soft` (`:75`) | `#f8f7f7` | `active:bg-op-surface-soft` |
| `--color-op-hairline` (`:79`) | `rgba(15,0,0,.12)` | idle border |
| `--color-op-hairline-strong` (`:80`) | `#646262` | `hover:border-op-hairline-strong` |
| `--color-op-danger` (`:85`) | `#ff3b30` | destructive focus ring |
| `--color-op-danger-text` (`:91`) | `#c01a12` | destructive text |

The ink ring is also wired into helm's `--ring: #201d1d` (`styles.scss:127`) and applied globally
via `* { @apply ... outline-ring/50 }` (`styles.scss:215-218`).

### Tailwind v4 + spartan wiring

- Global stylesheet `apps/web/src/styles.scss` imports Tailwind v4 layers + the spartan brain
  preset (`@spartan-ng/brain/hlm-tailwind-preset.css`); PostCSS via `apps/web/.postcssrc.json`
  (`@tailwindcss/postcss`).
- Helm primitives are generated in-repo as an Nx lib at `libs/ui/` (alias `@spartan-ng/helm`).
  `hlmBtn` is used **only in dialog footers** (cancel/submit). Its CVA already encodes affordance
  (`libs/ui/button/src/lib/hlm-button.ts:10`) but keys off helm semantic tokens (`--primary`,
  `--muted`, `--ring`) — **not** the `op-*` palette — so it is not a drop-in for the non-dialog,
  op-token-styled controls.
- There is **no app-level shared button component**; `apps/web/src/app/shared/` holds only
  `layout/` and `validators/`.

### Inventory: coverage vs. gaps (~87 elements / ~17 templates)

**Fully covered (canonical affordance, 5 controls):**
- `features/services/components/service-skills.component.html:5`
- `features/services/components/device-services.component.html:41,49,56,63`

**Partial / ad-hoc `cursor-pointer` only (no hover/focus states):**
- `features/overview/overview.component.html:68-71` (fleet row) — `cursor-pointer` only; CTAs at
  `:12-14`, `:55-59` have no affordance
- `features/audit/audit.component.html:26-34` — conditional `[class.cursor-pointer]` only (pseudo-button `<div>` with `(click)`)

**No affordance (representative gaps):**
- `features/skills/skills.component.html` — create/edit/delete buttons (`:4-10`, `:23-29`, `:59-65`, `:66-72`)
- `features/llm-providers/llm-providers.component.html` — create/activate/edit/delete (`:4-10`, `:21-27`, `:57-63`, `:65-71`, `:72-78`)
- `features/devices/devices.component.html` — create/edit/delete (`:4-10`, `:22-28`, `:43-49`, `:50-56`)
- `features/services/components/device-services.component.html:139-147` — replay button (sibling of covered controls, **missed by Phase 3**)
- `features/services/components/service-skills.component.html` — covered button is `:5`; verify no others lack it
- `shared/layout/layout.component.html` — sidebar nav links (`:16-31`, active-only bg, no hover) and sign-out (`:46-52`)
- `features/overview/overview.component.html:12-14,55-59` — nav links / CTA
- `features/diagnosis/diagnose-hero.component.html` — back link (`:2`), rerun (`:15-22`), replay (`:136-144`)
- `features/auth/login/login.component.html` — submit (`:47-53`), register link (`:58`)
- `features/auth/register/register.component.html` — submit (`:63-69`), login link (`:74`)

**Spartan-mediated (decide whether in scope):** dialog footer buttons using `hlmBtn` across
`features/*/dialogs/*.html` (skill-form, llm-provider-form, device-form, scan-services,
rename-service, run-skill) plus `hlmAlertDialogCancel/Action` confirm buttons in the list
components. These get affordance from spartan, not from the op-token recipe — likely **out of
scope** for the op-* sweep, but should be confirmed visually rather than blanket-edited.

## Code References

- `apps/web/src/styles.scss:56-98` — `@theme` block defining every `op-*` token
- `apps/web/src/styles.scss:127,215-218` — helm `--ring` + global outline binding
- `apps/web/.postcssrc.json` — Tailwind v4 PostCSS wiring
- `apps/web/src/app/features/services/components/device-services.component.html:41,49,56,63` — canonical affordance, three variants
- `apps/web/src/app/features/services/components/service-skills.component.html:5` — canonical secondary-bordered variant
- `libs/ui/button/src/lib/hlm-button.ts:10` — `hlmBtn` CVA (semantic-token affordance, not op-*)
- `tsconfig.base.json:16-32` — `@spartan-ng/helm` → `libs/ui/src/index.ts` alias
- `.claude/rules/tailwind.md` — utilities-first; don't hand-roll primitives
- `.claude/rules/spartan.md` — merge classes via `classes()`/`hlm()`; don't hand-concatenate strings
- `.claude/rules/angular.md` — no `@HostBinding`; use the `host` object

## Architecture Insights

1. **Affordance is data, not abstraction.** A ~20-utility string is the unit of reuse, copied per
   element. The naive "apply to everything" reading of the task would multiply that duplication
   across ~13 templates and ~30+ elements — the worst outcome for maintainability.
2. **The project's own rules already prescribe the fix.** `spartan.md` bans hand-concatenated
   class strings and points at `classes()`/`hlm()` from `@spartan-ng/helm/utils`; `angular.md`
   bans `@HostBinding` in favor of the `host` object. Together they describe an **attribute
   directive** (e.g. `opClickable` / `opAffordance`, with `variant` for primary/secondary/danger
   and a disable-aware host) that sets the affordance classes once. That is the single-source-of-
   truth the codebase is missing.
3. **Two token namespaces coexist deliberately.** `op-*` (DESIGN.md palette, used by non-dialog
   controls) vs. helm semantic tokens (`--primary`/`--ring`, used by `hlmBtn` in dialogs). The
   sweep is about the **op-* surface**; it should not try to unify dialog buttons onto op-* tokens.
4. **Phase 3 missed siblings even within its own file** — `device-services.component.html:139-147`
   (replay) sits next to four styled controls but has no affordance. A directive would have
   prevented the omission; a string-copy approach reproduces this class of miss.

## Historical Context (from prior changes)

- `context/archive/2026-06-22-fix-skills-not-clickable-in-devices/plan.md:214-258` — Phase 3
  defined the affordance recipe: `cursor-pointer` + restrained hover/focus-visible/active using
  existing `op-*` tokens + `transition-colors`, explicitly **without** reintroducing `hlmBtn`.
- Commit `672c921` ("feat(...): clickable affordance on action buttons (p3)") — the only commit
  that applied affordance to web code: 2 files, 5 controls (service-skills + device-services).
- Commit `9e4ff5b` ("feat(apps/web): apply consistent clickable affordance across all interactive
  elements") — **mislabeled scaffold**: created `change.md` only, no `apps/web` diff.
- The root cause behind the original `fix-skills-not-clickable-in-devices` work is captured in
  `context/foundation/lessons.md` ("Never read a required input in the constructor — load from a
  named `effect()`") — relevant background but orthogonal to this styling sweep.

## Related Research

- `context/archive/2026-06-22-fix-skills-not-clickable-in-devices/` — the originating change
  (plan + research) that produced the canonical affordance pattern this sweep generalizes.

## Open Questions

1. **Abstraction vs. duplication** — introduce an `opClickable` attribute directive (variant +
   disabled-aware, `host`-class based, built with `hlm()`), or accept copy-pasting the string?
   The rules strongly favor the directive; confirm with the user before planning.
2. **Dialog buttons in scope?** `hlmBtn` footer buttons and `hlmAlertDialog*` confirm buttons
   already have spartan affordance — include them in the sweep for visual consistency, or leave
   them to spartan? (Recommendation: leave them, audit visually only.)
3. **Nav links** (sidebar, overview, auth links) — should links get the same surface-card hover,
   or a link-specific affordance (underline/opacity)? They are not bordered chips, so the chip
   recipe may not fit; a link variant may be needed.
4. **Pseudo-button `<div>` in audit** (`audit.component.html:26-34`) — promote to a real
   `<button>`/`role="button"` with keyboard handling as part of the affordance work, or just add
   visual cues? (Accessibility implication.)
5. **`device-services` replay button** (`:139-147`) — confirm it should adopt the secondary variant
   to match its styled siblings.
