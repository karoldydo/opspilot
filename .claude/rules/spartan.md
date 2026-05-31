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
