# Web Terminal Design System Implementation Plan

## Overview

Re-skin `apps/web` to faithfully (1:1) reproduce the terminal/monospace aesthetic from
`DESIGN.md` + `mockups/index.html`, as a **full-stack feature build** (not a UI-only re-skin):
a thin token layer + self-hosted font, a greenfield app-shell/sidebar, per-component
terminal-aesthetic template rewrites, additive spartan primitives, and two net-new screens
(overview dashboard, standalone diagnose-hero) — the first of which needs a small new
`@opspilot/shared` contract + `apps/api` aggregate endpoint and a `run_record.durationMs`
migration.

## Current State Analysis

The codebase is materially more mature than the change-note/frame originally assumed
(those docs predate this research):

- **Theming seam is single-surface.** Every spartan/helm component themes through semantic
  Tailwind utilities bound by the brain preset's `@theme inline`
  (`node_modules/@spartan-ng/brain/hlm-tailwind-preset.css:66-101`) to raw `--*` CSS vars in
  `apps/web/src/styles.scss:7-72`. Editing those tokens re-skins all components with **zero
  `libs/ui` edits**.
- **No app-shell exists.** `apps/web/src/app/app.html` is a bare `<router-outlet>`;
  `app.routes.ts:6-43` is the authoritative route table; `home.component.ts:11` is the only
  nav surface today.
- **Persistence is fully operational** — Drizzle ORM + better-sqlite3 (WAL), 8 schemas, 8
  migrations (`apps/api/src/core/database/`). This is **not** an unwired scaffold.
- **`run_record` already persists diagnoses** (`run-record.schema.ts`: `id, deviceId,
  serviceId, synthesis, createdAt, userId`) with a `(serviceId, createdAt desc)` index and
  retention pruning (`run-record.service.ts:30-69`) — but **no `durationMs` column**.
- **Skill runs are not a table** — they are audit-logged (`audit_log` row, `action='skill.run'`,
  `metadata.outcome`, `createdAt`), ephemeral result `{status, message}`
  (`skill-run.service.ts:46-78`, `skill-run-result.schema.ts`). The audit log is indexed on
  `createdAt`.
- **Diagnose is GET-only** — SSE stream + replay list (`diagnose.controller.ts:22-47`),
  returns a single 4-field `diagnosisSynthesisSchema` (`{problems[], status, suggestions[],
  summary}`), persisted per run. There is **no** multi-variant data and **no** remediation
  endpoint. The inline diagnose panel lives in `device-services.component.ts:43,56,98`.
- **SSH execution is robust** — `ssh.executor.ts` (per-device mutex, decrypt, timeout race);
  skill-run renders templated commands with charset guards + defense-in-depth re-parse.
- **`libs/ui` (ui-helm)** has alert-dialog, badge, button, card, checkbox, dialog, empty,
  icon, input, label, select, table, utils; aliased `@spartan-ng/helm/*`
  (`tsconfig.base.json:16-30`). **Missing**: tabs, sonner, separator, tooltip.
- **`libs/shared`** exports 35 schemas (`libs/shared/src/index.ts`); none cover overview
  metrics.

### Key Discoveries:

- Mockup "01 · terminal / 02 · split / 03 · report" tabs are **presentation-style examples**
  of one diagnosis, not three data variants — user chose the **terminal** presentation; the
  hero renders the single real synthesis, no tabs (frame/change-note implied otherwise).
- "restart postgres →" apply is a **mockup example only** — dropped from scope; no
  remediation contract/endpoint/SSH surface is added.
- **Binary radius collision**: `rounded-md` and `rounded-lg` are each emitted by BOTH a
  container and an interactive helm component — so a single `--radius` cannot satisfy both.
  Resolvable from the `apps/web` token layer + per-call-site classes (see Critical
  Implementation Details). Settles research Open Question #1.
- Skill-runs-24h is **derivable from `audit_log`** (no new table); avg-diagnose needs a new
  `run_record.durationMs` column + capture.

## Desired End State

Every screen — existing (login, register, devices+services+inline diagnosis, skills,
llm-providers, audit, all dialogs) and net-new (overview, diagnose-hero) — visually
reproduces the mockup: cream `#fdfcfc` canvas, ink `#201d1d`, JetBrains Mono everywhere,
binary radius (0px containers / 4px interactive), ASCII markers (`[+]`/`[-]`/`[x]`/`[!]`/`[~]`)
instead of icons, persistent 236px left sidebar ("opspilot · homelab control") with a
5-item nav, toasts on mutations. The overview tiles and diagnose-hero are functional against
real contracts. `npm run lint / test / build` pass with no regressions.

Verify by: running `npm start`, visually diffing each route against `mockups/index.html`;
overview tiles show real `skill runs · 24h` and `avg diagnose` numbers; diagnose-hero
re-runs against a service and renders the live synthesis in terminal style.

## What We're NOT Doing

- **No edits to existing `libs/ui` component sources** — missing primitives are ADDED via the
  spartan CLI; the re-skin is token-driven.
- **No diagnose remediation / "apply" action** — dropped as a mockup-only example. Diagnose
  stays GET-only (stream + replay).
- **No multi-variant ("3 tabs") diagnose data** — the hero renders the single real synthesis
  in the terminal presentation.
- **No dedicated `skill_run` table** — the 24h tile is computed from `audit_log`.
- **No top-level "diagnose" nav item** — diagnose-hero is reached by drilling into a service
  (5-item sidebar).
- **No Berkeley Mono** (commercial) — JetBrains Mono only.
- **No dark mode** — the design is cream-only; the `:root.dark` block is neutralised.

## Implementation Approach

Six phases, front-end first so visible value lands without backend dependencies, net-new
features last. Phase 1 (tokens+font) is foundational for everything visual; Phases 2-4
rebuild structure and re-skin existing screens; Phase 5 adds the only new backend surface
(durationMs migration + overview-metrics aggregate) plus the overview screen; Phase 6 builds
the diagnose-hero on the existing diagnose stream. The token layer honours the "config
layer, not per-component consts" lesson; all FE↔BE types remain Zod-first in
`@opspilot/shared`.

## Critical Implementation Details

- **Binary radius mapping (the central token subtlety).** The brain preset derives the whole
  `--radius-*` scale from one `--radius`; the design needs containers at 0px and interactive
  at 4px, but `rounded-md` (button/input/select-trigger = interactive **and** select-content =
  container) and `rounded-lg` (dialog/alert-dialog/empty = container **and** empty-media =
  interactive) each straddle both. Resolve in the `apps/web` token layer by overriding
  individual steps: `--radius-sm`/`--radius-md` → 4px, `--radius-lg`/`--radius-xl`/`--radius-2xl`
  → 0px. The two straddlers degrade acceptably (select-content popover at 4px; empty-media at
  0px). The two genuine exceptions are call-site only and live in `apps/web` templates we are
  rewriting anyway: `badge` emits `rounded-4xl` (not `--radius`-derived) — add a `rounded-[4px]`
  utility at each badge usage; `checkbox` already hardcodes `rounded-[4px]`. No `libs/ui` edit.
- **Layout route wrapper is the only routing change permitted.** The shell wraps authed routes
  via a parent route with the layout component + `<router-outlet>`; `login`/`register` stay
  outside it. Do not restructure feature routes otherwise.
- **durationMs capture timing.** Measure around the `streamObject()` synthesis in
  `diagnose.service.ts:94-114` (start before the stream, stop at completion, before
  `RunRecordService.create()`), and persist `durationMs` on the run row in the same insert.
- **Toast = sonner.** In spartan, "toast" is the `sonner` primitive; `toast()` + a single
  `HlmToaster` mounted in the shell.

## Phase 1: Token Layer & Self-Hosted Font

### Overview

Replace the neutral OKLCH token set in `styles.scss` with the terminal palette, self-host
JetBrains Mono, repoint the font tokens, apply the binary radius overrides, neutralise dark
mode, and add the scrollbar + keyframes. This is the ~5% foundation every later phase builds on.

### Changes Required:

#### 1. Self-hosted font asset

**File**: `apps/web/public/fonts/` (new), `apps/web/src/styles.scss`

**Intent**: Vendor JetBrains Mono `woff2` weights (400;500;600;700;800) locally and declare
`@font-face` so the app renders the design font fully offline (self-hosted homelab ethos).

**Contract**: `@font-face` family `'JetBrains Mono'` with `font-display: swap`, served from
`apps/web/public/fonts/`. No external `<link>`.

#### 2. Terminal token palette

**File**: `apps/web/src/styles.scss:7-72`

**Intent**: Convert the `:root` tokens to the terminal hex palette and repoint font tokens to
the monospace stack.

**Contract**: `--font-sans` and `--font-mono` → `'JetBrains Mono', ui-monospace, SFMono-Regular,
Menlo, monospace`; `--background`/`--foreground` → cream `#fdfcfc` / ink `#201d1d`; gray ladder
(charcoal/body/mute/stone/ash) → `--muted`/`--border`/`--ring`; surfaces (soft/card/dark/
dark-elevated), hairlines; semantic ramp (`accent #007aff`, `warning #ff9f0a`, `danger #ff3b30`,
`success #30d158`) **plus** the darkened on-cream text ramp (`success-text #1f8a4e`,
`warning-text #a8700a`, `danger-text #c01a12`, `terminal-blue #4ea1ff`), disabled fill `#c9c6c6`.
Both ramps exposed as tokens (DESIGN.md:7-35; mockup `:256,262,193`).

#### 3. Binary radius overrides

**File**: `apps/web/src/styles.scss`

**Intent**: Override the individual `--radius-*` steps so containers render 0px and interactive
elements 4px (see Critical Implementation Details).

**Contract**: `--radius-sm`/`--radius-md` → `4px`; `--radius-lg`/`--radius-xl`/`--radius-2xl` →
`0px`.

#### 4. Dark-mode neutralise + scrollbar + keyframes

**File**: `apps/web/src/styles.scss:43-72`

**Intent**: Make the cream design the only theme; add the custom 8px scrollbar and the three
keyframes the design uses.

**Contract**: `:root.dark` block dropped or set equal to `:root` (inert); custom scrollbar
(8px); keyframes `opBlink`, `opIn`, `opFade` (DESIGN.md:94, mockup).

### Success Criteria:

#### Automated Verification:

- Build succeeds: `npm run build:web`
- Lint passes: `npx nx lint web`
- Format check passes: `npm run format:check`

#### Manual Verification:

- Every screen renders in JetBrains Mono with no network font request (offline check)
- Canvas is cream, text is ink; existing helm buttons/inputs/badges show 4px radius, cards/
  dialogs show 0px radius
- No dark-mode flash or inversion

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human before proceeding.

---

## Phase 2: App-Shell & Sidebar

### Overview

Build the greenfield `shared/layout` shell — a persistent 236px sidebar with wordmark, blinking
caret, 5-item nav, and a user footer with sign-out — and wrap the authed routes in it via a
layout route.

### Changes Required:

#### 1. Shell layout component

**File**: `apps/web/src/app/shared/layout/` (new — layout component + nav)

**Intent**: Author the sidebar shell that wraps authed content; standalone, OnPush, terminal
aesthetic.

**Contract**: 236px fixed sticky cream sidebar, right hairline; header = `opspilot` wordmark
(800/16px) + blinking block caret (`opBlink`) + `homelab control` subtitle; nav (5 items, see
below) with `▸` active marker, active bg surface-card `#f1eeee`, weight 700; footer = 26px ink
avatar + user email + `self-hosted` label + sign-out button calling the existing auth store
sign-out. Layout = sidebar + `<router-outlet>` for content (mockup `:31-60`).

#### 2. Nav items (5, drill-in diagnose)

**File**: `apps/web/src/app/shared/layout/` nav definition

**Intent**: Sidebar nav lists only real top-level routes; diagnose is reached by drilling into
a service, not a nav item.

**Contract**: nav = overview, devices, skills, providers, audit. Device-count / skills / providers
count tags sourced from existing stores where available.

#### 3. Layout route wrapper

**File**: `apps/web/src/app/app.routes.ts`, `apps/web/src/app/app.html`

**Intent**: Introduce a parent authed route rendering the shell with child routes; keep
login/register outside the shell.

**Contract**: parent route (authGuard) → layout component containing `<router-outlet>`; existing
authed routes (`''`→overview, devices, skills, llm-providers, audit) become its children.
`app.html` stays a bare `<router-outlet>` at the top level.

### Success Criteria:

#### Automated Verification:

- Build succeeds: `npm run build:web`
- Lint passes: `npx nx lint web`
- Unit tests pass: `npx nx test web`

#### Manual Verification:

- Sidebar persists across all authed routes; login/register render without it
- Active nav item shows `▸` + surface-card background; caret blinks
- Sign-out from the footer logs out and routes to login

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Additive Primitives

### Overview

Add the missing spartan primitives (sonner, separator, tooltip) additively and mount the toaster
in the shell.

### Changes Required:

#### 1. Generate primitives

**File**: `libs/ui/<name>/` (new entrypoints), `tsconfig.base.json:16-30`

**Intent**: Add sonner (toast), separator, tooltip via the spartan CLI; never edit existing
components.

**Contract**: `npx nx g @spartan-ng/cli:ui <name>` for each; mirror the `@spartan-ng/helm/<name>`
alias pattern in `tsconfig.base.json`. New components emit semantic utilities and inherit the
re-skin automatically.

#### 2. Mount toaster

**File**: `apps/web/src/app/shared/layout/` shell

**Intent**: Mount a single `HlmToaster` so `toast()` works app-wide.

**Contract**: one `<hlm-toaster>` in the shell; toast styled per design (4px radius, overlay
shadow `0 10px 30px rgba(15,0,0,0.28)`).

### Success Criteria:

#### Automated Verification:

- Build succeeds: `npm run build` (web + libs)
- Lint passes: `npm run lint`
- Module boundaries hold (no `@nx/enforce-module-boundaries` errors)

#### Manual Verification:

- A manual `toast()` call renders a terminal-styled toast in the correct position
- Separator and tooltip render with terminal tokens

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: Terminal Re-Skin of Existing Screens

### Overview

Rewrite the templates of every existing screen and dialog to the terminal aesthetic (ASCII
markers, terminal panels, status ramps, binary radius at call sites) and fire toasts on
mutations. No backend changes.

### Changes Required:

#### 1. Auth screens

**File**: `apps/web/src/app/features/auth/login/login.component.html`,
`.../register/register.component.html`

**Intent**: Re-skin login/register to terminal panels on the cream canvas.

**Contract**: terminal-panel form layout, JetBrains Mono, 4px inputs/buttons, ASCII markers; no
logic change.

#### 2. Devices + inline services + inline diagnosis

**File**: `apps/web/src/app/features/devices/devices.component.html`,
`.../services/components/device-services.component.html`,
`.../services/components/service-skills.component.html`

**Intent**: Re-skin the device CRUD table, the embedded service list, and the inline diagnosis
panel (`device-services.component.ts:43,56,98`) to terminal styling.

**Contract**: table with 0px container radius + 1px hairlines; ASCII status markers
(`[+]`/`[x]`/`[!]`), status text via on-cream ramp; inline diagnosis panel as a terminal block
(line-prefix `$`/`·`/`+`/`!`/`=` per kind). Badges get `rounded-[4px]` at call site.

#### 3. Skills, LLM providers, audit

**File**: `apps/web/src/app/features/skills/skills.component.html`,
`.../llm-providers/llm-providers.component.html`, `.../audit/audit.component.html`

**Intent**: Re-skin the three remaining list/table screens.

**Contract**: terminal tables/panels; audit status badges via ASCII markers + on-cream ramp;
provider active-state marker; skills list with create prefix `+ add …`.

#### 4. Dialogs

**File**: `apps/web/src/app/features/**/dialogs/*.dialog.{ts,html}` (scan-services, run-skill,
rename-service, device-form, llm-provider-form, skill-form) + the inline confirm
(`HlmAlertDialog`, `device-services.component.ts:17,88-94`)

**Intent**: Re-skin all dialogs/alert-dialog to terminal styling (0px dialog container, overlay
shadow `0 16px 48px rgba(15,0,0,0.22)`, scrim `rgba(15,0,0,0.34)`).

**Contract**: dialog header/body/footer terminal layout; primary/destructive buttons with ASCII
markers; 4px on interactive, 0px on the dialog surface.

#### 5. Toasts on mutations

**File**: the feature components' mutation handlers (devices/services/skills/providers + auth)

**Intent**: Fire `toast()` on successful/failed mutations, matching the mockup's behavior.

**Contract**: success/error `toast()` after each create/update/delete/scan/run/activate; copy
matches the terminal voice; no change to the underlying client/store calls.

### Success Criteria:

#### Automated Verification:

- Build succeeds: `npm run build:web`
- Lint passes: `npx nx lint web`
- Unit tests pass: `npx nx test web`
- Format check passes: `npm run format:check`

#### Manual Verification:

- Each existing route visually matches its mockup section (font, colors, radius, ASCII markers)
- All dialogs open/close and submit correctly with terminal styling
- Mutations fire correctly-styled toasts; no functional regressions in existing flows

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 5: Overview Dashboard (Full-Stack)

### Overview

Add the only new backend surface — a `run_record.durationMs` migration + capture, and an
overview-metrics aggregate endpoint with its `@opspilot/shared` contract — then build the
overview screen (tiles, fleet, recent, needs-attention) from existing stores + the new endpoint.

### Changes Required:

#### 1. Shared contracts

**File**: `libs/shared/src/lib/schemas/overview-metrics.schema.ts` (new),
`libs/shared/src/index.ts`

**Intent**: Define the overview-metrics response shape once, Zod-first, exported from
`@opspilot/shared`. Add `durationMs` to the run-record contract.

**Contract**: `overviewMetricsSchema` → `{ skillRuns24h: { count: number, successRate: number },
avgDiagnoseMs: number | null }`. `runRecordSchema` gains optional `durationMs: number`. Both
exported from the barrel.

#### 2. run_record.durationMs migration + capture

**File**: `apps/api/src/core/database/schema/run-record.schema.ts`, new migration under
`apps/api/migrations/`, `apps/api/src/modules/diagnose/diagnose.service.ts:94-114`

**Intent**: Persist diagnose synthesis duration so the avg-diagnose tile has real data.

**Contract**: add nullable `durationMs` integer column (+ migration); measure elapsed around the
`streamObject()` synthesis and write it in the same `RunRecordService.create()` insert (see
Critical Implementation Details).

#### 3. Overview-metrics endpoint

**File**: `apps/api/src/modules/overview/` (new module: controller + service) or an existing
aggregate-friendly module; wired into the app module

**Intent**: Serve the two tile metrics, scoped to the authed user, from existing tables.

**Contract**: `GET /api/overview/metrics` → `overviewMetricsSchema`. `skillRuns24h` aggregates
`audit_log` where `action='skill.run'` and `createdAt >= now-24h` (count + success rate from
`metadata.outcome`); `avgDiagnoseMs` averages `run_record.durationMs` over a recent window.
Respects `scope:api` boundaries.

#### 4. Overview screen (front-end)

**File**: `apps/web/src/app/features/overview/` (new; replaces the `home` placeholder as the `''`
route), `apps/web/src/app/app.routes.ts`

**Intent**: Build the dashboard from existing device/skill/audit stores + a new metrics client.

**Contract**: tiles `skill runs · 24h` and `avg diagnose` from `/api/overview/metrics`; fleet
summary + recent runs + needs-attention from existing stores; empty states via `HlmEmpty`;
terminal styling. The `''` route points here; the old `home.component` is removed/replaced.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly on a fresh DB (api boot / migration step)
- API builds and tests pass: `npx nx build api`, `npx nx test api`
- Shared lib builds/tests pass: `npx nx test shared`
- Web builds: `npm run build:web`; lint passes: `npm run lint`

#### Manual Verification:

- Overview tiles show real numbers after running a skill and a diagnose; success rate is correct
- Fleet / recent / needs-attention render from real data; empty states show on a fresh install
- avg-diagnose updates after a new diagnose run records a duration

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 6: Diagnose-Hero (Drill-In Screen)

### Overview

Build the standalone terminal-style diagnose screen, reached by drilling into a service, that
re-runs the existing diagnose stream and renders the single real synthesis in the terminal
presentation, with run history from the existing replay endpoint. No apply action.

### Changes Required:

#### 1. Diagnose-hero route + component

**File**: `apps/web/src/app/features/diagnosis/` (add component; currently data-only),
`apps/web/src/app/app.routes.ts`

**Intent**: Add a service-scoped diagnose-hero route reached from a service (drill-in), reusing
the existing `DiagnosisStore`/client (SSE stream + replay).

**Contract**: route nested/parameterised by device+service; re-run button re-opens the existing
SSE stream (`diagnose.controller.ts:40-47`); renders the single `diagnosisSynthesisSchema` in the
terminal presentation (status dot + `problems`/`suggestions`/`summary`, line prefixes per kind);
history list from the existing replay (`findRecent`). No new api endpoint.

#### 2. Drill-in entry point

**File**: `apps/web/src/app/features/services/components/device-services.component.html` (and/or
overview recent-runs)

**Intent**: Provide the navigation entry from a service into the diagnose-hero.

**Contract**: a `→`/`▸` action on a service row routes to the diagnose-hero for that service.

### Success Criteria:

#### Automated Verification:

- Web builds: `npm run build:web`; lint passes: `npx nx lint web`
- Unit tests pass: `npx nx test web`

#### Manual Verification:

- Drilling into a service opens the diagnose-hero in terminal style
- Re-run streams a live synthesis; the result persists and appears in history
- Visual match to the mockup's "terminal" diagnose presentation; no apply button present

**Implementation Note**: After completing this phase and all automated verification passes,
pause for final manual confirmation.

---

## Testing Strategy

### Unit Tests:

- `overviewMetricsSchema` parse/validation (shared)
- Overview-metrics service aggregation: 24h window boundary, success-rate from
  `metadata.outcome`, avg over `durationMs` with null handling (api)
- durationMs capture writes a value on a diagnose run (api)

### Integration Tests:

- `GET /api/overview/metrics` returns correct counts after seeding a `skill.run` audit row and a
  `run_record` with `durationMs`
- Diagnose stream still persists synthesis + now `durationMs`

### Manual Testing Steps:

1. Run app offline; confirm JetBrains Mono renders with no font network request.
2. Walk every route; visually diff against `mockups/index.html` (font, colors, binary radius,
   ASCII markers, sidebar).
3. Perform a mutation on each feature; confirm a terminal-styled toast fires.
4. Run a skill and a diagnose; confirm overview tiles update with real numbers.
5. Drill into a service → diagnose-hero → re-run; confirm live synthesis + history.

## Performance Considerations

- `skillRuns24h` scans `audit_log` filtered by `action` + `createdAt`; `createdAt` is already
  indexed. If volume grows, add a composite index on `(action, createdAt)`. Fine at homelab scale.
- Self-hosted font: ship only the needed weights as `woff2` to keep payload small; `font-display:
  swap` avoids blocking first paint.

## Migration Notes

- One additive migration: nullable `run_record.durationMs`. Backfill is unnecessary — existing
  rows read as `null` and are excluded from the avg; new runs populate it. The migration runner
  backs up the SQLite file automatically.

## References

- Frame brief: `context/changes/web-terminal-design-system/frame.md`
- Related research: `context/changes/web-terminal-design-system/research.md`
- Token surface: `apps/web/src/styles.scss:7-72`; brain preset
  `node_modules/@spartan-ng/brain/hlm-tailwind-preset.css:66-101`
- Diagnose flow: `apps/api/src/modules/diagnose/{diagnose.controller,diagnose.service,
  run-record.service}.ts`; schema `apps/api/src/core/database/schema/run-record.schema.ts`
- Skill run + audit: `apps/api/src/modules/skill/skill-run.service.ts`,
  `apps/api/src/modules/audit/audit.service.ts`,
  `apps/api/src/core/database/schema/audit-log.schema.ts`
- Shared barrel: `libs/shared/src/index.ts`; helm aliases `tsconfig.base.json:16-30`
- Mockup: `mockups/index.html` (sidebar `:31-60`, overview `:112-172`, diagnose `:288-400`,
  toast `:770-775`); `DESIGN.md:7-100,237-513`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not
> rename step titles. See `references/progress-format.md`.

### Phase 1: Token Layer & Self-Hosted Font

#### Automated

- [x] 1.1 Build succeeds: `npm run build:web` — 3a95018
- [x] 1.2 Lint passes: `npx nx lint web` — 3a95018
- [x] 1.3 Format check passes: `npm run format:check` — 3a95018

#### Manual

- [x] 1.4 Every screen renders in JetBrains Mono with no network font request (offline check) — 3a95018
- [x] 1.5 Canvas cream / text ink; interactive 4px, containers 0px radius — 3a95018
- [x] 1.6 No dark-mode flash or inversion — 3a95018

### Phase 2: App-Shell & Sidebar

#### Automated

- [x] 2.1 Build succeeds: `npm run build:web` — c8656a1
- [x] 2.2 Lint passes: `npx nx lint web` — c8656a1
- [x] 2.3 Unit tests pass: `npx nx test web` — c8656a1

#### Manual

- [x] 2.4 Sidebar persists across authed routes; login/register render without it — c8656a1
- [x] 2.5 Active nav shows `▸` + surface-card bg; caret blinks — c8656a1
- [x] 2.6 Footer sign-out logs out and routes to login — c8656a1

### Phase 3: Additive Primitives

#### Automated

- [x] 3.1 Build succeeds: `npm run build` — 02783cd
- [x] 3.2 Lint passes: `npm run lint` — 02783cd
- [x] 3.3 Module boundaries hold (no enforce-module-boundaries errors) — 02783cd

#### Manual

- [x] 3.4 A manual `toast()` renders a terminal-styled toast in the correct position — 02783cd
- [x] 3.5 Separator and tooltip render with terminal tokens — 02783cd

### Phase 4: Terminal Re-Skin of Existing Screens

#### Automated

- [x] 4.1 Build succeeds: `npm run build:web` — 10ff9b6
- [x] 4.2 Lint passes: `npx nx lint web` — 10ff9b6
- [x] 4.3 Unit tests pass: `npx nx test web` — 10ff9b6
- [x] 4.4 Format check passes: `npm run format:check` — 10ff9b6

#### Manual

- [x] 4.5 Each existing route visually matches its mockup section — 10ff9b6
- [x] 4.6 All dialogs open/close/submit with terminal styling — 10ff9b6
- [x] 4.7 Mutations fire correctly-styled toasts; no functional regressions — 10ff9b6

### Phase 5: Overview Dashboard (Full-Stack)

#### Automated

- [x] 5.1 Migration applies cleanly on a fresh DB
- [x] 5.2 API builds and tests pass: `npx nx build api`, `npx nx test api`
- [x] 5.3 Shared lib builds/tests pass: `npx nx test shared`
- [x] 5.4 Web builds: `npm run build:web`; lint passes: `npm run lint`

#### Manual

- [x] 5.5 Tiles show real numbers after a skill run and a diagnose; success rate correct
- [x] 5.6 Fleet / recent / needs-attention render; empty states on fresh install
- [x] 5.7 avg-diagnose updates after a new diagnose run records a duration

### Phase 6: Diagnose-Hero (Drill-In Screen)

#### Automated

- [ ] 6.1 Web builds: `npm run build:web`; lint passes: `npx nx lint web`
- [ ] 6.2 Unit tests pass: `npx nx test web`

#### Manual

- [ ] 6.3 Drilling into a service opens the diagnose-hero in terminal style
- [ ] 6.4 Re-run streams a live synthesis; result persists and appears in history
- [ ] 6.5 Visual match to the mockup's terminal diagnose presentation; no apply button
