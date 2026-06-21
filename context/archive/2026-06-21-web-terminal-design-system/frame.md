# Frame Brief: Re-skin apps/web to the terminal design system

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

`apps/web` does not look like the terminal/monospace prototype in
`DESIGN.md` + `mockups/index.html`. It must reproduce that aesthetic — and,
per the user's clarified intent, do so at **full 1:1 parity** with the mockup
(cream canvas, JetBrains Mono, binary radius, ASCII markers, persistent left
sidebar), including the screens the mockup shows.

## Initial Framing (preserved)

- **User's stated cause or approach**: a UI/visual-layer change ONLY, achieved
  through a token configuration layer (`apps/web/src/styles.scss` + `@theme`):
  `--font` → JetBrains Mono, `--radius` → 4px, colors → cream/ink + semantic
  ramp. Existing `libs/ui` sources untouched; missing primitives added
  additively; bespoke shell built in `apps/web`.
- **User's proposed direction**: re-map tokens, build the shell from scratch,
  add tabs/sonner/separator/tooltip via the spartan CLI, and flag mockup
  screens with no backing code as out-of-scope. `change.md` constraints:
  *"UI-only: zero changes to apps/api and to @opspilot/shared contracts"* and
  *"do NOT build features that do not exist yet."*
- **Pre-dispatch narrowing**: done-bar = **full 1:1 parity** (incl. building
  missing screens); nature of work = **tokens + substantial structural
  rebuild**; biggest worry = **scope arbitration** (re-skin vs. build).

## Dimension Map

The observation ("make apps/web look 1:1 like the mockup") could originate at:

1. **Token layer** — can a `styles.scss` token remap alone reproduce the look?
2. **Structural rebuild** — greenfield shell + per-component template rewrites
   (ASCII markers, terminal panels, binary radius). ← *initial framing partly
   concedes this*
3. **Feature-existence gap** — what does building overview / diagnose-hero /
   toasts to 1:1 actually require, and does it breach the UI-only / zero-api /
   zero-contracts constraint? ← *where the framing breaks*
4. **Primitive/radius config** — missing tabs/sonner/separator/tooltip +
   `--radius-*` scale override.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| **Token-only re-skin is sufficient** (initial framing) | Font + colors yes; but ASCII markers are `ng-icon`/SVG slots needing template edits, and terminal line-prefixes need a custom display component (`libs/ui/icon`, hlm-button/badge/etc.). `mockups/index.html` markers are inline text, not icon slots. | **WEAK** (false as stated) |
| **Substantial structural rebuild beyond tokens** | Token work ~60–80 lines; net-new + rewritten markup ~1,000–1,300 lines (greenfield shell ~700–900, per-component rewrites ~300–400 across ~15 templates / 1,037 lines). Structural ≈ **12–16× the token work**. `app.html` is a bare `<router-outlet>`; no layout/sidebar exists. | **STRONG** |
| **Full 1:1 needs net-new features + new api/shared** | Overview tiles `skill runs · 24h` & `avg diagnose` = no duration/aggregate exists in any contract → needs new `@opspilot/shared` contract + new `apps/api` aggregate. Diagnose-hero `restart postgres →` apply = no contract/endpoint (diagnose is GET-only) → needs new contract + endpoint. Toasts = pure UI (buildable). `libs/shared/src/index.ts` has 36 schemas, none cover these. | **STRONG** |
| **Original constraints (UI-only, zero api/shared, build-nothing-new) are compatible with the goal** | Directly contradicted: full 1:1 requires building features whose data does not exist; can only stay inside constraints by faking placeholder literals / no-op buttons — not real parity. | **NONE** (mutually exclusive with the goal) |

## Narrowing Signals

- User done-bar = **full 1:1 parity, incl. building missing screens** — this
  alone breaks `change.md`'s "build nothing new / UI-only" framing.
- Faced with the explicit conflict, user chose **Pełny 1:1 full-stack**:
  consciously **drop the "zero api/shared" constraint** and let the plan
  include new contracts + endpoints.
- Toasts (sonner) are the only one of the three new areas buildable UI-only;
  overview metric tiles and the diagnose apply-action are not.

## Cross-System Convention

This class of "make the app match a high-fidelity prototype" almost always
splits into (a) a thin theming/config layer and (b) a much larger
structure-and-feature build. The lesson `Put operational tunables in the config
layer` applies cleanly to the token layer (tokens belong in `styles.scss` +
brain preset, not per-component) — but it does **not** shrink the structural or
feature work, which the initial framing conflated into "just configuration."
One nuance to verify in planning: the binary radius (0px containers / 4px
interactive) is achievable by overriding individual `--radius-*` steps **in
`apps/web`'s token layer** (no `libs/ui` edit), provided no single `rounded-*`
step is shared between a container and an interactive element — a per-component
audit (research Open Question #1) settles this. One sub-agent overclaimed that
`libs/ui` `.ts` edits are mandatory; the more careful reading is that the token
layer suffices for radius.

## Reframed Problem Statement

> **The actual problem to plan around is**: a **full-stack 1:1 implementation**
> of the terminal design — a thin token re-skin PLUS a greenfield app-shell,
> per-component template rewrites (ASCII markers / terminal panels), additive
> primitives, AND net-new features (overview, diagnose-hero, toasts) — some of
> which require **new `@opspilot/shared` contracts and new `apps/api`
> endpoints**. It is not a UI-only re-skin.

The initial framing ("UI-only re-skin via a token configuration layer") is
false against the user's own done-bar. The token layer is the smallest piece
(~5%); the load-bearing work is structural (shell + templates) and net-new
features with backend data that does not exist today. The `change.md`
constraints "UI-only" and "zero changes to apps/api / @opspilot/shared" are now
**explicitly retired** by the user in favour of real functional parity.

## Confidence

**HIGH** — the conflict is definitional (full 1:1 ⊄ build-nothing-new),
confirmed by code evidence across three independent investigations + prior
research, and the user has explicitly chosen the full-stack resolution. The
only MEDIUM-confidence sub-point is the exact radius mapping (token-override vs.
component edit), which is a planning detail, not a framing question.

## What Changes for /10x-plan

The plan must be scoped as a **full-stack feature build**, not a re-skin:
(1) token layer + font + `--radius-*` override; (2) greenfield `shared/layout`
shell; (3) per-component terminal-aesthetic template rewrites; (4) additive
spartan primitives (tabs/sonner/separator/tooltip); (5) **new UI features**
overview / diagnose-hero / toasts; (6) **new `@opspilot/shared` contracts + new
`apps/api` endpoints** for the skill-run/avg-diagnose aggregates and the
diagnose remediation action. Update `change.md` to remove the now-retired
UI-only / zero-api / build-nothing constraints before planning.

## References

- Source files: `apps/web/src/styles.scss:7-72`, `apps/web/src/app/app.html`,
  `apps/web/src/app/app.routes.ts:6-43`,
  `apps/web/src/app/features/home/home.component.{ts,html}`,
  `apps/web/src/app/features/diagnosis/data/{diagnosis.client,diagnosis.store}.ts`,
  `apps/web/src/app/features/services/components/device-services.component.ts:43,56,98`,
  `libs/shared/src/index.ts`, `node_modules/@spartan-ng/brain/hlm-tailwind-preset.css:66-101`,
  `mockups/index.html` (overview `:112-172`/`:1138-1149`; diagnose `:288-400`/`:1262-1265`; toast `:770-775`).
- Related research: `context/changes/web-terminal-design-system/research.md`.
- Investigation agents: feature-build gap `a100aeaeab2067c77`, token fidelity
  `a4c453c4def3e35a2`, structural scale `afeef60190559d192`.
</content>
</invoke>
