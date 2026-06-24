---
date: 2026-06-24T00:00:00+02:00
researcher: Karol Dydo
git_commit: 6c8f16b48114c54d7c66624d66723a5864d25298
branch: main
repository: opspilot
topic: "Migrate apps/web native HTML to @opspilot/ui (spartan-ng hlm-*) components everywhere possible"
tags: [research, codebase, spartan-ng, libs-ui, apps-web, migration, hlm]
status: complete
last_updated: 2026-06-24
last_updated_by: Karol Dydo
---

# Research: Migrate apps/web native HTML to spartan-ng (hlm-*) components

**Date**: 2026-06-24T00:00:00+02:00
**Researcher**: Karol Dydo
**Git Commit**: 6c8f16b48114c54d7c66624d66723a5864d25298
**Branch**: main
**Repository**: opspilot

## Research Question

Replace native/hand-rolled HTML elements in `apps/web` with components from the shared
spartan-ng (hlm-*) UI library everywhere possible; add a spartan-ng primitive to the UI
library when a hand-rolled element exists in web and spartan offers a matching component
that is not yet installed. Full audit + spartan docs for the new primitives.

## Summary

Migration is **well advanced** — 11 of 16 installed primitives are already in active use
(button, input, label, checkbox, select, table, dialog, alert-dialog, pagination, + utils,
+ icon barrel available). The remaining native HTML is concentrated in **list/detail
feature components + the two auth screens**, and falls into a clean, bounded set:

- **~47 native `<button>`** across 9 files → `hlmBtn` (already imported in dialogs/pagination, never in feature list/detail HTML yet).
- **5 native `<input>` + 5 native `<label>`** — only the two auth screens (login, register). Every list-view search input already uses `hlmInput`.
- **4 hand-rolled badge `<span>` + 1 status-text candidate** → `hlmBadge` (installed, unused in apps/web today).
- **3 plain-text loading states** → candidate for a new `hlm-spinner` (NOT installed).
- **6 status-dot / chrome-dot elements** → **leave as-is** (no spartan dot primitive; the hand-rolled element is justified).

**Two corrections to the change.md framing that the implementer must internalize:**

1. **The import alias is `@spartan-ng/helm/*`, NOT `@opspilot/ui`.** The `libs/ui/` folder *is*
   the helm layer; `tsconfig.base.json` maps each component to a sub-path alias
   (`@spartan-ng/helm/button`, `/input`, `/badge`, …). There is no `@opspilot/ui` alias.
   The main barrel `libs/ui/src/index.ts` is intentionally empty (`export default null`).
2. **`solid` is not a real variant — it is the `default` variant; `outline` is a variant, not a
   size.** `HlmButton` variants are `default | secondary | destructive | ghost | outline | link`;
   sizes are `default | sm | lg | xs | icon | icon-sm | icon-lg | icon-xs`. Every "solid" target in
   change.md → omit `variant` (default) or use `[class]` affordance helper; every "outline" → `variant="outline"`.

**Count discrepancies vs change.md** (use the audited numbers below): `devices` ≈ 13–14 distinct
native buttons (change.md said 17 — extras are `@for`-rendered chip filters, not distinct source
elements); `service-detail` = 4 native buttons (change.md said 6).

## Detailed Findings

### A. libs/ui inventory — 16 of 57 primitives installed (CONFIRMED)

Source of truth for what exists: per-component folders under `libs/ui/` + the path aliases in
`tsconfig.base.json:16-33`. The spartan registry (via MCP) lists **57** components total; the
project installs **16** helm components + `@spartan-ng/brain` (headless layer) + `@spartan-ng/utils`.

Installed (alias → key export / selector):

| Primitive | Alias | Key exports / selectors | Used in apps/web? |
|-----------|-------|-------------------------|-------------------|
| button | `@spartan-ng/helm/button` | `HlmButton` / `button[hlmBtn], a[hlmBtn]` | ✅ dialogs, pagination |
| badge | `@spartan-ng/helm/badge` | `HlmBadge`, `HlmBadgeImports` / `[hlmBadge], hlm-badge` | ❌ **not yet** |
| card | `@spartan-ng/helm/card` | `HlmCard*` (header/title/content/footer/action) | ❌ |
| input | `@spartan-ng/helm/input` | `HlmInput` / `[hlmInput]` | ✅ |
| label | `@spartan-ng/helm/label` | `HlmLabel` / `[hlmLabel]` | ✅ |
| checkbox | `@spartan-ng/helm/checkbox` | `HlmCheckbox` / `hlm-checkbox` | ✅ |
| select | `@spartan-ng/helm/select` | `HlmSelectImports` (trigger/content/item/…) | ✅ |
| table | `@spartan-ng/helm/table` | `HlmTableImports` (hlmTable/hlmTHead/hlmTr/hlmTh/hlmTd) | ✅ |
| dialog | `@spartan-ng/helm/dialog` | `HlmDialog*` (header/title/description/footer/…) | ✅ |
| alert-dialog | `@spartan-ng/helm/alert-dialog` | `HlmAlertDialog*` (action/cancel/…) | ✅ |
| separator | `@spartan-ng/helm/separator` | `HlmSeparator` / `hlmSeparator, hlm-separator` | ❌ |
| tooltip | `@spartan-ng/helm/tooltip` | `HlmTooltip` / `hlmTooltip` | ❌ |
| pagination | `@spartan-ng/helm/pagination` | `HlmPaginationImports` | ✅ |
| empty | `@spartan-ng/helm/empty` | `HlmEmpty*` | ❌ |
| sonner | `@spartan-ng/helm/sonner` | `HlmToaster` / `hlm-toaster` | ❌ |
| icon | `@spartan-ng/helm/icon` | `HlmIconImports = [HlmIcon, NgIcon]` / `ng-icon[hlm]` | ❌ (not wired) |
| utils | `@spartan-ng/helm/utils` | `classes()`, `hlm()` merge helpers | ✅ |

Package versions (`package.json`): `@spartan-ng/brain@0.0.1-alpha.707` (dep),
`@spartan-ng/cli@0.0.1-alpha.707` (devDep). No `@spartan-ng/helm*` npm package — helm source is
vendored into `libs/ui/` and owned by the repo. No competing UI lib (no Material/PrimeNG/etc.).

**Notable gap for this change**: `badge`, `card`, `separator`, `tooltip`, `empty`, `sonner`, `icon`
are installed but **never used in apps/web**. Badge in particular is ready to use for section C
with zero install work. `icon` is installed but **no `provideIcons(...)` exists anywhere in
apps/web** — icons are not wired in yet (relevant if a spinner that depends on `ng-icon` is added).

### B. Native `<button>` audit — ~47 across 9 files (target: `hlmBtn`)

None of these feature list/detail HTML files import `hlmBtn` yet. Variant mapping below uses the
**real** spartan variant names (`default` replaces change.md's "solid"; `outline`/`ghost` as-is).

- `features/devices/devices.component.html` — **~13–14 distinct buttons** (change.md said 17; the
  extra count is `@for`-rendered per-device chip filters, not distinct source elements):
  - `:4` add device (→ default), `:29` empty-state add (→ outline sm), `:42` "all hosts" chip +
    `:47` per-device chip (dynamic `chipClass()` → variant-driven), `:64` scan / `:73` edit host /
    `:82` delete host action bar (→ outline sm; delete = danger), `:133/:142/:151/:160` 4× column-sort
    (→ ghost sm ⭐), `:196` edit / `:205` del per-row (→ outline sm; del = danger).
- `features/llm-providers/llm-providers.component.html` — **10**: `:4` add (default), `:23`
  empty-state add (outline sm), `:66/:75/:84` 3× sort (ghost sm ⭐), `:122` activate / `:132` edit /
  `:141` del (outline sm; del = danger).
- `features/skills/skills.component.html` — **9**: `:4` add (default), `:25` empty-state add
  (outline sm), `:67/:76/:86` 3× sort (ghost sm ⭐), `:118` edit / `:127` del (outline sm; del = danger).
- `features/services/service-detail.component.html` — **4** (change.md said 6): `:36` edit /
  `:45` delete (outline sm; delete = danger), `:67` re-run diagnose (default), `:160` per-run replay (outline sm).
- `features/audit/audit.component.html` — **2**: `:51/:60` 2× sort (ghost sm ⭐).
- `features/auth/login/login.component.html` — **1**: `:47` "sign in" submit (default, full-width).
- `features/auth/register/register.component.html` — **1**: `:63` "create account" submit (default, full-width).
- `features/services/components/service-skills.component.html` — **1**: `:4` "run skill" (outline sm).
- `shared/layout/layout.component.html` — **1**: `:48` "sign out" (outline sm).

**⭐ Column-sort pattern — 12 occurrences confirmed**, all sharing
`text-op-mute flex w-full cursor-pointer items-center [gap-1] text-[10px] font-bold tracking-[0.5px] uppercase`:
devices `:133/:142/:151/:160`, llm-providers `:66/:75/:84`, skills `:67/:76/:86`, audit `:51/:60`.
**Strong candidate for a shared `app-sort-header` component wrapping `hlmBtn variant="ghost" size="sm"`** —
removes the largest single source of repetition in this migration.

### C. Native `<input>` / `<label>` audit — auth screens only (target: `hlmInput` / `hlmLabel`)

All list-view search inputs already use `hlmInput`; the **only** remaining native inputs/labels are
the auth screens:

- `features/auth/login/login.component.html` — labels `:15`, `:30`; inputs `:16`, `:31`.
- `features/auth/register/register.component.html` — labels `:15`, `:30`, `:45`; inputs `:16`, `:31`, `:46`.

All carry `bg-op-surface-soft … rounded-[4px] border …` classes that overlap `hlmInput`'s own
styling — apply the directive and prune redundant classes, mirroring `device-form.dialog.html:11-16`.

### D. Hand-rolled badge `<span>` audit — 4 + 1 candidate (target: `hlmBadge`)

- `features/skills/skills.component.html:105` — "global" badge → `hlmBadge variant="outline"`.
- `features/skills/skills.component.html:109` — device-scope badge (`{{ skill.scope }}`) → `hlmBadge` (default).
- `features/services/service-detail.component.html:19-24` — header status badge, dynamic
  `headerBadgeClass()` → `hlmBadge` with computed `[variant]` + `[class]`.
- `features/diagnosis/components/synthesis-card.component.ts:47-50` (inline template) — synthesis
  status badge, dynamic `badgeClass(status)` → `hlmBadge` with computed `[variant]`.
- **(candidate)** `features/llm-providers/llm-providers.component.html:107-113` — provider
  active/inactive status **text** (text at `:112`). change.md flagged `:108`; the real span block is
  `107-113`. Converting unifies the dot (`:102-106`) + text into one badge — a small UX decision.

**Leave as-is (typography, not badges)**: `<th>` headers with `tracking-[0.5px] uppercase` in
devices `:168-170`, llm-providers `:64/:92`, skills `:84/:94`, audit `:68-70`.

### E. Loading states — 3 (candidate for new `hlm-spinner`)

- `features/services/service-detail.component.html:12` — "loading service…" text.
- `features/services/service-detail.component.html:75` — "diagnosing…" inside a button (`entry().loading`).
- `features/services/components/service-skills.component.html:10` — "running…" inside a button (`entry().pending === skill.id`).

These are currently plain text. A `hlm-spinner` standardizes loading feedback — see section G.

### F. Leave-as-is — status dots (no spartan equivalent)

`rounded-full` dot indicators are justified hand-rolled elements; spartan has no dot primitive:
devices `:48` (chip dot) + `:188` (row dot), llm-providers `:102-106` (active dot),
service-detail `:86-88` (3× terminal-chrome dots — decorative). Do not migrate.

### G. New primitives to ADD to libs/ui (spartan docs)

The spartan CLI uses an Nx generator that installs the brain primitive from npm and **copies the
helm source into `libs/ui/`** (you then own/edit it), wires the path alias, and configures the
Tailwind preset. Recommended workflow: `ui-theme` is already done; just run `ui` per component.

**Install command (Nx generator, both layers):**
```
npx nx generate @spartan-ng/cli:ui --name=spinner,textarea,dropdown-menu,button-group
```
Peer deps pulled for dropdown-menu/button-group: `@angular/cdk` (+ `@angular/cdk/menu`).

1. **`spinner` — RECOMMENDED.** helm-only (no brain). `hlm-spinner` is a standalone `OnPush`
   component, `role="status"`, `[aria-label]` (default "Loading"), animates via
   `motion-safe:animate-spin`, and renders an `<ng-icon [name]="icon()">` defaulting to
   `lucideLoader2`. Export: `HlmSpinner`, `HlmSpinnerImports`. **Caveat:** it depends on
   `@ng-icons/core` + a registered icon (`provideIcons({ lucideLoader2 })`). apps/web does not wire
   ng-icons yet, so adding spinner means also wiring the icon provider (component- or route-level,
   per `angular.md`'s "avoid `providedIn:'root'`").
2. **`textarea` — OPTIONAL, low priority.** brain + helm. `hlmTextarea` is an **attribute
   directive** (`[hlmTextarea]`) on a native `<textarea>`, with `field-sizing-content` auto-resize and
   `BrnFieldControlDescribedBy` wiring. Today textareas already work via `hlmInput`
   (`device-form.dialog.html:95`); a dedicated `hlmTextarea` gives proper auto-resize/variants but is
   not required for a 1:1 migration.
3. **`dropdown-menu` / `button-group` — OPTIONAL (UX change, not 1:1).** helm-only; both pull
   `@angular/cdk`. Action bars / per-row actions are loose `hlmBtn` today; `button-group` (action bar)
   or `dropdown-menu` (per-row "…" menu) would improve ergonomics but is a deliberate redesign, not a
   mechanical swap. Defer unless the change explicitly wants the UX upgrade.

The other ~38 missing registry primitives (tabs, switch, accordion, progress, radio, sidebar,
avatar, skeleton, etc.) have **no hand-rolled counterpart** in apps/web — do not add speculatively.

## Architecture Insights — canonical usage patterns

**Button** (`libs/ui/button/src/lib/hlm-button.ts:48-70`): variant/size are directive inputs passed
as plain attributes — `hlmBtn variant="outline" size="sm"` (NOT `[variant]` unless binding, NOT a
`hlmBtn="…"` value). Extra classes merge via `[class]="…"`; the project has a `clickableClasses('solid'|'secondary')`
affordance helper (e.g. `device-form.dialog.ts:61-63`). Real examples: `skill-form.dialog.html:70`
(`size="sm" variant="outline"`), `table-pagination.component.html:4-57` (ghost/icon, `[variant]` bound),
`device-form.dialog.html:117-118` (default submit + outline cancel).

**Input + Label** (`device-form.dialog.{ts,html}`): `flex flex-col gap-2` wrapper → `<label hlmLabel
for="id">` → `<input hlmInput id="id" formControlName="…">` → `@if (touched && invalid)` error `<p>`
reading `getError('zod')`. Errors come from a shared-Zod `schemaValidator(schema.shape.field)` on each
control (`device-form.dialog.ts:48-55`). Textareas currently reuse `hlmInput` (`device-form.dialog.html:95`).

**Badge** (`libs/ui/badge/src/lib/hlm-badge.ts:13-41`): `[hlmBadge]` / `hlm-badge`, `variant` input
(`default | secondary | destructive | ghost | outline | link`), sets `[attr.data-variant]`. Import
`HlmBadge` from `@spartan-ng/helm/badge` (barrel also exposes `HlmBadgeImports`).

**Icon** (`libs/ui/icon/src/lib/hlm-icon.ts`): render `<ng-icon hlm name="lucideX" size="sm" />`;
import `HlmIconImports` (`= [HlmIcon, NgIcon]`) + `provideIcons({ lucideX })` from `@ng-icons/core`.
`size`: `xs|sm|base|lg|xl|none` or raw CSS length.

**Hard rules that constrain the implementation** (`.claude/rules/`):
- *spartan.md*: never hand-roll a primitive spartan provides — generate helm via the CLI, don't copy
  snippets or add a second UI lib; `hlmDialogTitle` is required (use `sr-only` if hidden); merge classes
  with `classes()`/`hlm()` from `@spartan-ng/helm/utils`, never hand-concatenate; never set `z-index`
  on overlays; no manual `dark:` overrides (semantic tokens theme automatically).
- *tailwind.md*: Tailwind v4 CSS-first (`@theme`, no `tailwind.config.js`), utilities-first in
  templates, keep class order via `prettier-plugin-tailwindcss` (`npm run format`).
- *angular.md*: standalone is default (don't write `standalone: true`); `OnPush`; signals
  (`signal`/`computed`/`input`/`output`); zoneless (Angular 21); `@if`/`@for`/`@switch`; `host` object
  (no `@HostBinding`/`@HostListener`); `DestroyRef`/`takeUntilDestroyed` (no `ngOnDestroy`); `effect()`
  only as named class fields; avoid `providedIn:'root'`; type API shapes via shared-Zod `z.infer`;
  templates only do property/signal access — push logic into `computed()`/methods.
- *lessons.md* relevant prior: never read `input.required()` in the constructor — load from a named
  `effect()` (the `ServiceSkillsComponent` bug). Touch carefully when editing service-skills.

## Code References

- `libs/ui/` (16 component folders) + `tsconfig.base.json:16-33` — installed primitives + aliases.
- `libs/ui/src/index.ts` — intentionally empty (`export default null`); imports go through sub-path aliases.
- `libs/ui/button/src/lib/hlm-button.ts:18-70` — variant/size enums + directive selector/inputs.
- `libs/ui/badge/src/lib/hlm-badge.ts:13-41` — badge variants + `data-variant`.
- `libs/ui/icon/src/lib/hlm-icon.ts` — icon directive; `HlmIconImports = [HlmIcon, NgIcon]`.
- `apps/web/src/app/features/devices/devices.component.html:4,29,42,47,64,73,82,133,142,151,160,196,205` — native buttons + 4 sort headers + 2 dots (`:48,:188`).
- `apps/web/src/app/features/llm-providers/llm-providers.component.html:4,23,66,75,84,122,132,141` — buttons; `:102-106` dot + `:107-113` status text candidate.
- `apps/web/src/app/features/skills/skills.component.html:4,25,67,76,86,118,127` — buttons; `:105,:109` badges.
- `apps/web/src/app/features/services/service-detail.component.html:36,45,67,160` — buttons; `:19-24` badge; `:12,:75` loading; `:86-88` chrome dots.
- `apps/web/src/app/features/audit/audit.component.html:51,60` — 2 sort buttons.
- `apps/web/src/app/features/auth/login/login.component.html:15,16,30,31,47` — labels/inputs/submit.
- `apps/web/src/app/features/auth/register/register.component.html:15,16,30,31,45,46,63` — labels/inputs/submit.
- `apps/web/src/app/features/services/components/service-skills.component.html:4,10` — run-skill button + loading.
- `apps/web/src/app/shared/layout/layout.component.html:48` — sign-out button.
- `apps/web/src/app/features/diagnosis/components/synthesis-card.component.ts:47-50` — inline-template badge.
- `apps/web/src/app/features/devices/dialogs/device-form.dialog.{ts,html}` — canonical hlmInput/hlmLabel/hlmBtn pattern + schemaValidator.
- `apps/web/src/app/shared/components/table-pagination.component.{ts,html}` — canonical hlmBtn (ghost/icon, bound variant) usage.
- `package.json:44,92` — `@spartan-ng/brain` + `@spartan-ng/cli` `0.0.1-alpha.707`.

## Historical Context (from prior changes)

- `context/changes/spartan-ng-component-migration/change.md` — the driving spec (GOAL / CONTEXT /
  SCOPE A–E / rollout order). This research verifies it and corrects: the `@opspilot/ui` alias name
  (actually `@spartan-ng/helm/*`), the "solid" variant (actually `default`), devices button count
  (~13–14 distinct, not 17), and service-detail button count (4, not 6).
- Recent git history shows the migration's most recent waves: `ba534b7`/`aba433a` (devices host
  action bar), `list-redesign-datatables` (tables → hlmTable, now archived) — consistent with the
  "already migrated, do not touch" inventory confirmed in section A.

## Related Research

- None prior under `context/changes/**/research.md`. The `list-redesign-datatables` archived change
  is the closest predecessor (table/datagrid migration) but predates this audit.

## Open Questions

1. **Spinner vs ng-icons wiring** — adding `hlm-spinner` requires wiring `@ng-icons/core` +
   `provideIcons({ lucideLoader2 })`, which apps/web does not have yet. Worth it for 3 loading states,
   or defer and keep plain text? (Recommend: add it, wire icons at the two consuming components.)
2. **Sort-header component** — build the shared `app-sort-header` (wrapping `hlmBtn ghost sm` + sort
   icon) before or alongside the 12 sort-button swaps? It removes the biggest repetition but is net-new
   surface. (Recommend: build it in Tier 2, migrate all 12 through it.)
3. **llm-providers status (dot + text)** — unify into a single `hlmBadge`, or keep the dot and only
   badge-ify the text? This is a small UX decision the spec left open (`:108` flagged as "verify").
4. **dropdown-menu / button-group** — explicitly in or out of scope? They are UX redesigns, not 1:1
   swaps, and pull `@angular/cdk`. (Recommend: out of scope for this change.)
</content>
</invoke>
