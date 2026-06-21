---
change_id: web-terminal-design-system
title: Re-skin apps/web to the terminal design system from mockups and DESIGN.md
status: implemented
created: 2026-06-21
updated: 2026-06-21
archived_at: null
---

## Notes

Re-skin apps/web to the terminal design system per the mockups and DESIGN.md

## Goal
Faithfully (1:1) reproduce the terminal/monospace aesthetic from the OpsPilot mockups in apps/web:
cream canvas #fdfcfc, ink #201d1d, JetBrains Mono across every text role,
4px radius on interactive elements only (0px on containers), ASCII markers ([+]/[-]/[x])
instead of icons, a persistent left sidebar "opspilot · homelab control".
This is a FULL 1:1 build, not a UI-only re-skin: the token layer is the smallest piece (~5%);
the work also includes a greenfield app-shell, per-component template rewrites, additive primitives,
and net-new features (overview, diagnose-hero, toasts) — some of which require NEW @opspilot/shared
contracts and NEW apps/api endpoints (see frame.md). Functional parity is the bar, not placeholder literals.

## Sources of truth (in order of priority)
1. mockups/index.html + mockups/support.js — visual prototype of the whole dashboard (the visual TARGET).
2. DESIGN.md — tokens: colors, typography, spacing (section=96px), radius (sm=4px), component specs.
3. mockups/apps/web/** — this is only a SNAPSHOT of the current Angular code (baseline), NOT the visual target.
   Many files there are identical to apps/web — do not treat them as the target style.

## Approach — token layer is ONE part of a full-stack build (not the whole change)
- Theming is done via a TOKEN CONFIGURATION FILE in apps/web (apps/web/src/styles.scss + @theme Tailwind v4),
  mapping the DESIGN.md tokens onto the CSS variables the spartan/helm components already read:
  --font-sans -> JetBrains Mono, --radius -> 4px, --background/--foreground -> cream/ink,
  the gray ladder (charcoal/body/mute/stone/ash) -> muted/border/ring, plus the semantic ramp
  (accent #007aff, danger #ff3b30, warning #ff9f0a, success #30d158) + spacing.section=96px.
- This way the existing hlm components adopt the new look WITHOUT modifying any sources in libs/ui.
- libs/ui: do NOT change the sources of existing components. Missing primitives should be ADDED
  (additively) — e.g. tabs, toast/sonner, separator, tooltip — preferably via the spartan CLI into libs/ui.
  The bespoke app-shell/sidebar (navigation, user footer, sign out) is built in apps/web (shared/layout).

## Screen scope (per mockups/index.html) — full 1:1, building what is missing
Shell + sidebar nav, overview, devices (+ nested services), skills, providers (llm-providers),
audit, login, plus the dialogs: scan-services, run-skill, rename-service, device/provider/skill form,
confirm (alert-dialog), toast. Screens with no backing code are now IN scope and must be built:
- overview dashboard (fleet + recent runs from existing stores; skill-runs/avg-diagnose tiles need new data),
- standalone diagnose-hero (re-run + 3 variant tabs + synthesis exist as data; apply/remediation needs new data),
- toasts (sonner) fired on mutations.

## Backing-data gaps (from frame.md) — these need backend work
Most of the new UI is buildable from existing stores/contracts, but three elements have NO backing data
and require NEW @opspilot/shared contracts + NEW apps/api endpoints for functional parity:
- overview tile "skill runs · 24h" (count + success-rate) — no run aggregate / timestamps recorded,
- overview tile "avg diagnose" (duration) — no duration captured on any run/audit record,
- diagnose-hero "restart postgres →" apply action — diagnose is GET-only; no remediation contract/endpoint.

## Constraints
- Respect @nx/enforce-module-boundaries (scope:web -> scope:web + scope:shared; scope:api -> scope:api + scope:shared).
- @opspilot/shared remains the single source of FE↔BE types: any new shape is a Zod schema there first.
- Theming via the token layer; do NOT modify existing libs/ui component sources — missing primitives are ADDED.
- Tailwind v4 utilities + spartan/helm; prettier singleQuote; lowercase inline comments.

## Out of scope
Changes to existing libs/ui component sources (missing primitives are added, not edited);
mockup elements that are purely decorative with no real data behind them stay as such only if explicitly agreed.

## Acceptance criteria
- Every screen (existing + newly built) visually reproduces the mockup (font, colors, radius, sidebar, ASCII markers).
- Theming via the token layer + ADDED (not modified) primitives; sources of existing hlm components untouched.
- New overview/diagnose/toast features are functional, backed by real contracts + endpoints where data is required.
- npm run lint / test / build pass; no functional regressions in existing flows.
