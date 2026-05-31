---
paths:
  - apps/web/**/*.ts
  - apps/web/**/*.html
  - apps/web/**/*.scss
  - apps/web/**/*.css
---
# Tailwind CSS v4

Styling is **Tailwind v4** utilities first, paired with spartan/ng primitives (see `spartan.md`).

## v4 specifics (do not write v3 setup)

- **CSS-first config**: design tokens are declared with the `@theme` directive in CSS - there is
  **no `tailwind.config.js`** unless you need to override content detection.
- Content detection is automatic (respects `.gitignore`); don't hand-maintain a `content: [...]`
  glob list.
- Wire it through PostCSS with the `@tailwindcss/postcss` plugin (expected at `apps/web/.postcssrc.json`).

## Usage

- Prefer Tailwind utility classes in templates over bespoke component `.scss`; reserve a
  component stylesheet for what utilities genuinely cannot express (e.g. complex `@keyframes`,
  `::-webkit-*` pseudo-elements, or dynamic values outside the Tailwind scale).
- Don't hand-roll styled primitives (button, dialog, menu, etc.) - reach for spartan/ng helm
  components, which are themselves Tailwind-based. See `spartan.md`.
- Keep class lists ordered by `prettier-plugin-tailwindcss` (already installed) - run
  `npm run format` after touching templates.
