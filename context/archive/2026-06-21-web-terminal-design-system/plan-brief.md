# Web Terminal Design System — Plan Brief

> Full plan: `context/changes/web-terminal-design-system/plan.md`
> Frame brief: `context/changes/web-terminal-design-system/frame.md`
> Research: `context/changes/web-terminal-design-system/research.md`

## What & Why

Re-skin `apps/web` to faithfully (1:1) reproduce the terminal/monospace aesthetic from
`DESIGN.md` + `mockups/index.html`. This is a **full-stack 1:1 implementation** — a thin token
re-skin PLUS a greenfield app-shell, per-component template rewrites, additive primitives, AND
two net-new screens (overview, diagnose-hero), one of which needs a small new contract +
endpoint. It is not a UI-only re-skin.

## Starting Point

`apps/web` is a system-sans Angular SPA with a bare `<router-outlet>` (no shell/sidebar) themed
through a single token surface (`styles.scss` → spartan/helm brain preset). The backend is fully
operational (Drizzle + SQLite, 8 tables): diagnoses already persist to `run_record` (no duration),
skill runs are audit-logged only, diagnose is GET-only, SSH execution is robust.

## Desired End State

Every screen — existing and net-new — visually matches the mockup: cream canvas, ink text,
JetBrains Mono everywhere, binary radius (0px containers / 4px interactive), ASCII markers
instead of icons, a persistent 236px sidebar, toasts on mutations. The overview tiles and
diagnose-hero are functional against real data. `npm run lint / test / build` pass, no regressions.

## Key Decisions Made

| Decision                     | Choice                                              | Why (1 sentence)                                                              | Source   |
| ---------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------- | -------- |
| Overall scope                | Full-stack build, not UI-only re-skin               | Full 1:1 ⊄ build-nothing-new; user retired the "zero api/shared" constraint  | Frame    |
| Theming approach             | Token layer in `apps/web`, no `libs/ui` edits       | Single-surface seam re-skins all helm components via the brain preset        | Research |
| Binary radius                | Override individual `--radius-*` steps + call-site  | `rounded-md`/`rounded-lg` straddle container & interactive; one `--radius` can't | Research |
| Diagnose-hero presentation   | Single real synthesis in "terminal" style, no tabs  | Mockup's 3 tabs are presentation examples of one diagnosis, not 3 data sets  | Plan     |
| Remediation "apply"          | Dropped                                             | "restart postgres →" is a mockup example only                                | Plan     |
| Overview tile data           | Derive from existing tables                         | skill-runs-24h from `audit_log`; avg-diagnose from a new `run_record.durationMs` | Plan     |
| Font delivery                | Self-hosted woff2 in `apps/web/public`              | Works offline; fits the self-hosted homelab ethos                            | Plan     |
| Sidebar nav                  | 5 items; diagnose via drill-in                      | Diagnose is inherently per-service; avoids a "no service selected" state     | Plan     |
| Dark mode                    | Neutralised (cream-only)                            | Terminal design is cream-only                                                | Plan     |

## Scope

**In scope:** token layer + self-hosted font + binary radius; greenfield app-shell/sidebar
(5-item nav); terminal re-skin of all existing screens + dialogs; additive primitives (sonner,
separator, tooltip); toasts on mutations; overview dashboard (with new `durationMs` migration +
metrics endpoint); standalone diagnose-hero (drill-in, terminal presentation, re-run).

**Out of scope:** editing existing `libs/ui` sources; diagnose remediation/apply; multi-variant
diagnose data; a dedicated `skill_run` table; a top-level diagnose nav item; Berkeley Mono; dark
mode.

## Architecture / Approach

Six phases, front-end first. The token layer (`styles.scss` + brain preset) re-skins every helm
component with zero `libs/ui` edits. A greenfield `shared/layout` shell wraps authed routes via a
layout route. Missing primitives are added via the spartan CLI. The only new backend surface is a
nullable `run_record.durationMs` column (+ capture in `diagnose.service`) and a
`GET /api/overview/metrics` aggregate (audit_log + run_record), with its shape defined Zod-first in
`@opspilot/shared`. The diagnose-hero reuses the existing diagnose SSE stream + replay endpoint.

## Phases at a Glance

| Phase                              | What it delivers                                              | Key risk                                            |
| ---------------------------------- | ------------------------------------------------------------ | --------------------------------------------------- |
| 1. Token layer & self-hosted font  | Terminal palette, JetBrains Mono, binary radius, no-dark      | Radius collision (`rounded-md`/`-lg`) mis-mapped    |
| 2. App-shell & sidebar             | Greenfield shell, 5-item nav, layout route                   | Routing wrapper regressions on authed routes        |
| 3. Additive primitives             | sonner/separator/tooltip + toaster mounted                   | spartan CLI alias wiring / module boundaries        |
| 4. Terminal re-skin (existing)     | All screens + dialogs re-skinned, toasts on mutations        | Visual fidelity drift across ~15 templates          |
| 5. Overview dashboard (full-stack) | durationMs migration + metrics endpoint + overview screen    | Aggregate correctness (24h window, success rate)    |
| 6. Diagnose-hero (drill-in)        | Terminal-style diagnose screen + re-run + history            | SSE re-run lifecycle / drill-in entry state         |

**Prerequisites:** running app (`npm start`); an active LLM provider + a reachable device for
diagnose/skill manual checks; JetBrains Mono woff2 weights vendored.
**Estimated effort:** ~5-7 sessions across 6 phases (Phase 4 is the largest; Phases 1, 3, 6 small).

## Open Risks & Assumptions

- Binary radius depends on the two straddling steps (`select-content`, `empty-media`) degrading
  acceptably; verify visually in Phase 1.
- `skillRuns24h` reads success/failure from `audit_log.metadata.outcome` (opaque JSON) — assumes
  that field is reliably populated by `skill-run.service`.
- Toast copy/voice for each mutation is authored during Phase 4 (not pre-specified).

## Success Criteria (Summary)

- Every route visually reproduces its mockup section (font, colors, binary radius, ASCII markers,
  sidebar) and renders fully offline.
- Overview tiles show real `skill runs · 24h` + `avg diagnose`; diagnose-hero re-runs and renders
  the live synthesis in terminal style.
- `npm run lint / test / build` pass with no functional regressions in existing flows.
