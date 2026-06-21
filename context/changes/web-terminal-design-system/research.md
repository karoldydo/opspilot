---
date: 2026-06-21T19:32:42+02:00
researcher: Karol Dydo
git_commit: 8859b1996a1c686f53e811c1a71376faa2cb3ace
branch: main
repository: opspilot
topic: 'Re-skin apps/web to the terminal/monospace design system (DESIGN.md + mockups)'
tags: [research, codebase, web, design-system, tailwind, spartan-helm, theming]
status: complete
last_updated: 2026-06-21
last_updated_by: Karol Dydo
---

# Research: Re-skin apps/web to the terminal design system

**Date**: 2026-06-21T19:32:42+02:00
**Researcher**: Karol Dydo
**Git Commit**: 8859b1996a1c686f53e811c1a71376faa2cb3ace
**Branch**: main
**Repository**: opspilot

## Research Question

How should `apps/web` be re-skinned to faithfully (1:1) reproduce the terminal/monospace
aesthetic from `DESIGN.md` + `mockups/index.html` — as a UI/visual-layer change only — given
the current Angular 21 + Tailwind v4 + spartan/helm setup? What are the exact target tokens, the
current structure, the theming seam, the missing primitives, and which mockup screens actually
have backing code?

## Summary

The re-skin is **achievable almost entirely through a single token-edit surface** —
`apps/web/src/styles.scss:7-72` — because every spartan/helm component themes itself through
semantic Tailwind utilities (`bg-primary`, `text-foreground`, `rounded-md`, …) that the brain
preset (`@theme inline`) binds to the raw `--*` CSS variables defined in that file. No `libs/ui`
source needs to change. Five things, however, are **not** pure token edits and must be planned:

1. **There is no app-shell / sidebar today.** The mockup's persistent left sidebar
   ("opspilot · homelab control") does not exist — `app.html` is a bare `<router-outlet>` and
   `HomeComponent` is the only nav surface. The shell must be **built from scratch** in
   `apps/web` (shared/layout), as the change note anticipates.
2. **JetBrains Mono is absent.** Current font is system-sans; `--font-mono` is referenced by the
   preset but undefined. The font must be added (Google Fonts link or self-hosted) and the token
   layer repointed.
3. **The binary radius requirement (0px containers / 4px interactive) cannot be met by setting a
   single `--radius`** — the brain preset derives the whole `--radius-*` scale linearly from one
   token. The individual scale steps must be overridden (see Architecture Insights).
4. **Four primitives are missing** — tabs, sonner (toast), separator, tooltip — and must be
   **added additively** via the spartan CLI (`npx nx g @spartan-ng/cli:ui <name>`), never by
   editing existing components.
5. **Three mockup areas have no backing code** and are out of scope: the **overview dashboard**
   (tiles / fleet / recent / needs-attention), the **standalone diagnose hero screen** (re-run +
   3 variant tabs + "restart postgres →" apply), and **toast notifications** (no toaster wired).
   The inline per-service diagnose panel inside devices **does** exist and is in scope.

The token color values themselves need **two semantic ramps**: the pure Apple ramp (for status
dots / dark-surface terminal syntax) and a darkened "on-cream" ramp (for status text that must be
legible on the cream canvas).

## Detailed Findings

### 1. Target visual spec (DESIGN.md + mockups)

**Color tokens** (DESIGN.md:7-35):

- Ink/primary `#201d1d`, cream/canvas `#fdfcfc`, CTA-pressed ink-deep `#0f0000`.
- Gray ladder: charcoal `#302c2c`, body `#424245`, mute `#646262`, stone `#6e6e73`, ash `#9a9898`.
- Surfaces: surface-soft `#f8f7f7`, surface-card `#f1eeee`, surface-dark `#201d1d`,
  surface-dark-elevated `#302c2c`; hairline `rgba(15,0,0,0.12)`, hairline-strong `#646262`.
- Semantic ramp (Apple HIG): accent `#007aff`, warning `#ff9f0a`, danger `#ff3b30`,
  success `#30d158` (DESIGN.md:26-35).
- **Darkened "on-cream" text ramp** (from the mockup, for legibility on cream — not in DESIGN.md
  but used pervasively): success-text `#1f8a4e`, warning-text `#a8700a`, danger-text `#c01a12`,
  terminal-result-blue `#4ea1ff`; disabled fill `#c9c6c6`
  (`mockups/index.html:262,256,193`; `mockups/support.js:803,892-893,1281`).

**Typography** (DESIGN.md:285-318): single monospace font everywhere. Spec font is Berkeley Mono
(commercial); **the mockup loads JetBrains Mono 400;500;600;700;800 via Google Fonts**
(`mockups/index.html:13`), stack `'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo,
monospace` (`mockups/index.html:17`). The app is **denser than DESIGN.md's 16px/96px marketing
scale**: real sizes are ~10.5-15px body, 24px page H1 (`-0.4px` tracking), 28-30px stat numbers.
Uppercase micro-labels use `+0.5px`/`+1px` tracking; big numbers use negative tracking.

**Radius** (DESIGN.md:87-90, 360-368) — **binary**: `0px` on every container (sections, cards,
tables, **dialogs** — `mockups/index.html:543`), `4px` on every interactive element + inset
surface (buttons, inputs, badges, terminal panels, toast), `9999px` on dots/avatar.

**Spacing** (DESIGN.md:92-100): 8px grid; `section: 96px` is the marketing rhythm but the app
uses tighter paddings (page container `40px 44px 64px`, nav item `8px 10px`, etc.).

**Other**: 1px borders everywhere, two weights (hairline / hairline-strong). **No shadows except
overlays** — modals `0 16px 48px rgba(15,0,0,0.22)`, toast `0 10px 30px rgba(15,0,0,0.28)`, scrim
`rgba(15,0,0,0.34)`. Left-accent-bar callout motif `border-left:3px solid <color>`. Three
keyframes: `opBlink` (caret), `opIn` (entrance), `opFade` (reveal); custom 8px scrollbar.

**ASCII markers** (DESIGN.md:237,509; the brackets ARE the icons, never SVG): `[+]` success,
`[x]` error/destructive, `[-]` generic bullet, `[!]` warning, `[~]` context/info,
`▸`/`›` disclosure & prompt, `●` status dot, `↻` re-run, `→` CTA, `×` close, `✓` checkbox,
`+ add …` create prefix. Terminal line prefixes (`support.js:802-803`): `$`/`·`/`+`/`!`/`=` with
per-kind colors.

**Sidebar shell** (`mockups/index.html:31-60`): 236px fixed, sticky, cream, right hairline.
Header = `opspilot` wordmark (800/16px) + blinking block caret + `homelab control` subtitle. Nav
order (`support.js:1121-1128`): overview, devices (count tag), diagnose, skills (tag), providers
(tag), audit. Active marker `▸`, active bg surface-card `#f1eeee`, weight 700. Footer = 26px ink
avatar + email + `self-hosted` + sign-out button.

### 2. Current apps/web structure

**Routing** — `apps/web/src/app/app.routes.ts` (only route file, all `loadComponent` lazy):
`login` (:6), `register` (:10), `audit` (:16, authGuard), `devices` (:21, authGuard),
`llm-providers` (:27, authGuard), `skills` (:35, authGuard), `''`→Home (:40, authGuard),
`**`→`''` (:43). **No app-shell wrapper** — `apps/web/src/app/app.html` is just
`<router-outlet>`; `app.scss` empty.

**17 components, all standalone + OnPush + `templateUrl`, zero component `.scss`**:

- `features/home/home.component.ts:11` — placeholder nav hub (only nav surface today).
- `features/auth/login/login.component.ts:15`, `features/auth/register/register.component.ts:15`.
- `features/audit/audit.component.ts:24` — log table + status badges.
- `features/devices/devices.component.ts:26` — CRUD table; rows embed `<app-device-services>`.
  - `features/devices/dialogs/device-form.dialog.ts:35`.
- `features/llm-providers/llm-providers.component.ts:22` (+ `dialogs/llm-provider-form.dialog.ts:37`).
- `features/skills/skills.component.ts:20` (+ `dialogs/skill-form.dialog.ts:49`).
- `features/services/components/device-services.component.ts:44` — service list + **inline
  diagnosis panel** (consumes `DiagnosisStore`, :56); embeds `<app-service-skills>`.
- `features/services/components/service-skills.component.ts:17`.
- `features/services/dialogs/{rename-service,run-skill,scan-services}.dialog.ts`.
- `features/diagnosis/` — **data only**, no component.

**Core/shared**: `core/auth/{auth.client,auth.store}.ts`, `core/guards/auth.guard.ts`,
`core/interceptors/auth.interceptor.ts`; `shared/validators/schema.validator.ts`. **No layout /
sidebar / nav / header / toast anywhere.**

**Global styles** — `apps/web/src/styles.scss` (sole entry, `apps/web/project.json:44`):
Tailwind v4 CSS-first (`:1-4` layers + imports), brain preset import (`:5`), **no
`tailwind.config.*`**, **no `@theme` block** — tokens are plain `:root` CSS vars (`:7-41`) +
`:root.dark` (`:43-72`). Current: `--font-sans` = system sans (`:10-12`), `--radius: 0.625rem`
(:14), neutral OKLCH grayscale palette. **JetBrains Mono / `--font-mono` absent.**

### 3. libs/ui spartan/helm + theming seam

`libs/ui` **does exist** — one Nx project `ui-helm` (`libs/ui/project.json:5`, prefix `hlm`, tag
`scope:web`), components aliased under **`@spartan-ng/helm/*`** (not `@opspilot/ui`) in
`tsconfig.base.json:16-30`. (This resolves the apparent contradiction: feature code imports
`@spartan-ng/helm/button` etc., which map to local `libs/ui/button/src`.)

**Present**: alert-dialog, badge, button, card, checkbox, dialog, empty, icon, input, label,
select, table, utils. Config `components.json` (`componentsPath: libs/ui`,
`generateAs: entrypoint`, `importAlias: @spartan-ng/helm`).

**Theming chain** (the key seam):
`apps/web/src/styles.scss` raw `--*` → brain `@theme inline`
(`node_modules/@spartan-ng/brain/hlm-tailwind-preset.css:66-101`) maps `--color-*`/`--radius-*`/
`--font-*` → component `cva()` utilities (`bg-primary`, `rounded-md`) applied via
`classes()`→`hlm()`=`twMerge(clsx())` (`libs/ui/utils/src/lib/hlm.ts:14-16`). **Editing the raw
tokens re-skins all components with zero `libs/ui` edits.** Two direct `var()` uses exist in
`libs/ui/button/src/lib/hlm-button.ts:23-40` (`rounded-[min(var(--radius-md),10px)]`, a
`color-mix` hover) but still resolve through the same tokens.

**Missing** (confirmed, all in the installed CLI registry): **tabs, sonner (= toast), separator,
tooltip**. Add via `npx nx g @spartan-ng/cli:ui <name>`, then mirror the alias pattern in
`tsconfig.base.json` (`@spartan-ng/helm/<name>`). New components emit the same semantic utilities,
so they inherit the re-skin automatically. CLI + brain installed at `0.0.1-alpha.707`.

### 4. Feature-existence audit (what to actually re-skin)

| Mockup screen / element | Verdict | Evidence |
|---|---|---|
| login, register | **EXISTS** | routes `app.routes.ts:6,10`; auth store/client; shared `auth-*` schemas |
| **overview / dashboard** | **OUT OF SCOPE** | `''`→`home.component.ts` is a placeholder (self-comment "real operational slices come in later"); no tiles/fleet/recent store/client/contract |
| devices (+ inline services) | **EXISTS** | `app.routes.ts:21`; `devices/data/*`; `device.schema` etc. |
| **standalone diagnose screen** | **OUT OF SCOPE as a screen** | **no route, no component** (`features/diagnosis/` is data-only). Backing store/client EXIST and power the **inline** panel in `device-services.component.ts:43,56,98`. The hero/3-variant-tabs/"restart postgres →" apply has no route/component/action. |
| skills | **EXISTS** | `app.routes.ts:35`; `skills/data/*`; `skill*` schemas |
| llm providers | **EXISTS** | `app.routes.ts:27`; activate `llm-providers.client.ts:19` |
| audit log | **EXISTS** | `app.routes.ts:16`; `audit/data/*`; `audit-*` schemas |
| dialogs: scan-services, run-skill, rename-service, device/provider/skill form | **EXIST** (action-backed) | see services/devices/skills/providers `data/*` clients |
| confirm dialog | **EXISTS** (spartan `HlmAlertDialog` inline) | `device-services.component.ts:17,88-94` |
| **toast** | **OUT OF SCOPE today** | no `toast()`/`HlmToaster`/sonner anywhere; sonner must be added if the design needs it |
| sidebar "diagnose" nav item | **N/A** | no diagnose route → no nav entry |

## Code References

- `apps/web/src/styles.scss:7-72` — **the single token-edit surface** for the entire re-skin.
- `apps/web/src/app/app.html` / `app.ts:1-10` — bare router-outlet; where a shell layout slots in.
- `apps/web/src/app/app.routes.ts:6-43` — full route table (the authoritative "what exists" list).
- `apps/web/src/app/features/home/home.component.ts:11` — placeholder; only current nav surface.
- `apps/web/src/app/features/services/components/device-services.component.ts:43,56,98` — inline
  diagnosis panel (the in-scope diagnose experience).
- `node_modules/@spartan-ng/brain/hlm-tailwind-preset.css:66-101` — `@theme inline` token mapping,
  incl. radius scale `:95-101` and `--font-mono:69`.
- `tsconfig.base.json:16-30` — `@spartan-ng/helm/*` aliases (pattern for new primitives).
- `libs/ui/utils/src/lib/hlm.ts:14-16` — `hlm()`/`twMerge` class merge.
- `components.json` — spartan CLI config for additive primitive generation.
- `mockups/index.html` — visual TARGET (sidebar :31-60, dialogs :541-776, screens per section).
- `mockups/support.js:802-803,1121-1142` — terminal line prefixes/colors, nav defs, tile data.
- `DESIGN.md:7-100,285-513` — tokens + component specs.

## Architecture Insights

- **Single-surface theming.** Because helm components never hardcode colors, the re-skin is a
  token remap in `apps/web/src/styles.scss` + the brain `@theme inline` indirection. Plan to
  convert the current `:root` OKLCH neutrals to the terminal hex palette, add `--font-mono`, and
  repoint `--font-sans` at the monospace stack. This honours the change note's "design system as a
  configuration layer" and "do not modify libs/ui sources" constraints exactly.

- **The binary-radius problem is the central token subtlety.** The brain preset derives the whole
  scale from one token: `--radius-sm = radius-4px`, `md = radius-2px`, `lg = radius`,
  `xl = radius+4px`, `2xl = radius+8px` … (`hlm-tailwind-preset.css:95-101`). The design wants
  containers (cards/dialogs, typically `rounded-xl`/`rounded-lg`) at **0px** and interactive
  elements (buttons/inputs/badges, `rounded-md`/`rounded-sm`) at **4px** — **no single `--radius`
  value yields both**. The plan must override the individual `--radius-*` steps in `apps/web`
  (e.g. an `@theme`/`:root` block forcing `--radius-sm`/`--radius-md` → 4px and
  `--radius-lg`/`--radius-xl`/`--radius-2xl` → 0px) **after auditing which `rounded-*` step each
  helm component actually emits**. The change note's "`--radius -> 4px`" is necessary but not
  sufficient on its own.

- **Two color ramps, not one.** Status text on the cream canvas needs the darkened ramp
  (`#1f8a4e`/`#a8700a`/`#c01a12`/`#4ea1ff`) while dots and dark-surface terminal syntax use the
  pure Apple ramp. The token layer should expose both (semantic + on-cream text variants).

- **Shell is greenfield.** A `shared/layout` app-shell (sidebar nav + user footer + sign-out,
  wrapping the authed routes) must be authored in `apps/web` — this is the largest non-token piece
  of work and the only routing change the note permits (adding a layout wrapper).

- **Additive-only primitive growth.** tabs/sonner/separator/tooltip go in via the spartan CLI as
  new `libs/ui/<name>` entrypoints; they theme for free. Note "toast" = **sonner** in spartan.

- **Density mismatch.** DESIGN.md is the marketing-scale palette/spec source of truth, but the
  mockup px values are the real component sizing — use the mockup numbers for paddings/font-sizes.

## Historical Context (from prior changes)

- `context/foundation/lessons.md` — the operative lesson here is **"Put operational tunables in the
  config layer, never as in-file consts"** (lines 5-10). The design-system equivalent: tokens live
  in the `styles.scss` config layer + brain preset, never as per-component hardcoded values — which
  the re-skin's "configuration layer" approach already follows.
- `.claude/rules/tailwind.md` / `.claude/rules/spartan.md` — Tailwind v4 CSS-first + spartan/helm
  are the documented styling direction; this change is the first to actually exercise them at scale.
- `context/foundation/prd.md` / `tech-stack.md` — name spartan/ng + Tailwind v4 as the target UI
  stack; the scaffold already wired the brain preset, so the re-skin is the first real consumer.

## Related Research

- None yet under `context/changes/**/research.md`. This is the first research artifact for the
  `web-terminal-design-system` change.

## Open Questions

1. **Radius mapping precision** — which exact `rounded-*` utility does each helm component in use
   (card, dialog, alert-dialog, input, button, badge, select, table, checkbox) emit? Needs a quick
   per-component grep before settling the `--radius-*` overrides (Architecture Insights).
2. **Sidebar in scope?** The shell is required to match the mockup, but its "overview" and
   "diagnose" nav targets are out-of-scope screens. Confirm the shell ships with only the
   real-route nav items (devices, skills, providers, audit) or includes disabled/hidden entries.
3. **Toast** — does the terminal design require wiring sonner now (mockup fires toasts on every
   mutation), or is restyling the existing flows without toasts acceptable for this UI-only pass?
4. **Font delivery** — Google Fonts `<link>` in `apps/web/src/index.html` vs self-hosted asset in
   `apps/web/public/` (offline/self-hosted homelab context may favour self-hosting).
5. **Dark mode** — `styles.scss` defines a `:root.dark` set; the terminal design is cream-only.
   Decide whether to drop/neutralise the dark block or leave it inert.
