---
paths:
  - apps/web/**/*.ts
  - apps/web/**/*.html
---
# spartan/ng (UI primitives)

UI primitives come from **spartan/ng**, which is compatible with Angular 21 and Tailwind v4
(see `tailwind.md`).

## Two-layer model

Each primitive is **brain** (`@spartan-ng/brain`, a headless behaviour/accessibility dependency
you don't edit) plus **helm** (the Tailwind-styled presentation layer generated via the spartan
CLI into this repo, which you own and may edit).

## Rules

- **Do not hand-roll** primitives that spartan provides (button, dialog, menu, popover, select,
  tabs, etc.) - generate the helm component instead of writing a bespoke one.
- Install/add components through the spartan CLI generators (init once, then add per component);
  don't copy snippets manually or pull in a second component library alongside it.
- Compose application components from helm primitives + Tailwind utilities; keep feature
  components thin (the ~150-line / single-responsibility threshold in `angular.md` still holds).

## Composition (required structure)

- **Dialog**: `hlmDialogTitle` is required for accessibility - if hidden visually, give it
  `class="sr-only"`, never omit it. Use `brnDialogTrigger` on the trigger, the
  `hlm-dialog-content` element component for the body, and `hlmDialogClose` for closures.
- **Tabs**: trigger buttons must live inside a `brn-tabs-list`, never directly under the tabs
  component.
- **Avatar**: always provide an `AvatarFallback` (initials/text shown when the image fails).
- **Prefer the primitive over raw markup**: `brn-separator` over `<hr>`, `hlm-skeleton` for
  loading, `hlmBadge` for status, `hlm-alert` for callouts, `hlm-empty` for empty states,
  `hlm-toaster` + `toast()` for notifications.

## Class composition

- Merge classes with the helpers from `@spartan-ng/helm/utils`: `classes()` for signal-aware host
  classes in components (preferred), `hlm()` for inline merging (`twMerge(clsx(...))`). Don't
  hand-concatenate class strings.
- Class priority: built-in CVA variants → semantic tokens → CSS variables → layout utilities via
  `hlm()`. Reach for a custom class only when no variant/token covers it.
- Never set `z-index` manually on overlays (dialog, sheet, alert-dialog, dropdown-menu, popover,
  tooltip, hover-card) - they manage stacking internally. Semantic tokens (see `tailwind.md`)
  handle theming, so no manual `dark:` overrides either.
