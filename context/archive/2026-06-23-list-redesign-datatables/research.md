---
date: 2026-06-23T21:53:12+0200
researcher: Karol Dydo
git_commit: 6e184c6190fb0ff54e0bc73f0a4c7cb4dea4548e
branch: main
repository: opspilot
topic: "Fleet services datatable + skills/providers/audit datatables for scannable lists"
tags: [research, codebase, web, datatable, spartan-ng, signals, devices, skills, providers, audit, diagnosis]
status: complete
last_updated: 2026-06-23
last_updated_by: Karol Dydo
---

# Research: Fleet services datatable + skills/providers/audit datatables

**Date**: 2026-06-23T21:53:12+0200
**Researcher**: Karol Dydo
**Git Commit**: 6e184c6190fb0ff54e0bc73f0a4c7cb4dea4548e
**Branch**: main
**Repository**: opspilot

## Research Question

Map the existing `apps/web` code that the `list-redesign-datatables` change must reuse to turn `/devices` into a single fleet-wide "all services" datatable and `/skills`, `/providers`, `/audit` into client-side datatables (search · sort · per-column filter · client pagination), built from one shared `clientTable<T>` helper, spartan-ng helm primitives, and Tailwind. The spec is explicit: *"find the real names in the repo; don't rebuild."* This document is that map.

## Summary

The codebase is uniform and reuse-friendly. Every feature follows the same shape: a component-provided `@ngrx/signals` `signalState` store (`load`/mutate-then-refetch, `loading`/`isEmpty`/`error` signals) backed by an HttpClient client that zod-parses through `@opspilot/shared`. Dialogs render in a CDK overlay and receive their store **via the dialog context object**, not DI. All four target stores already exist and expose what the tables need.

Five findings drive the plan:

1. **No fleet read, no latest-status read. The `/devices` table needs a two-level client-side fan-out.** There is no `GET /api/services` and no per-service latest-status endpoint. Services are reachable only per-device (`GET /api/devices/:deviceId/services`), and a service's status lives only on its newest `RunRecord.synthesis.status` via the paginated `GET /api/devices/:deviceId/services/:serviceId/diagnose/runs`. So the fleet table must: `GET /api/devices` → fan out services per device → fan out runs per service. This is the single biggest architectural decision for the plan (accept the fan-out vs. add an aggregate endpoint — the latter is explicitly *optional* in the spec).
2. **`@tanstack/angular-table` is NOT a dependency.** The spec's fallback applies: hand-roll the signal-based `clientTable<T>` helper at `apps/web/src/app/shared/client-table.ts`.
3. **No spartan pagination helm exists.** `libs/ui/pagination/` is absent. Either generate it via the spartan CLI or (lower friction, per spec) build a minimal `‹ prev · 1 2 3 · next ›` footer from `HlmButton`.
4. **No extracted "synthesis card" component exists.** The status-badge + summary + problems/suggestions grid is duplicated inline in three templates. The audit expandable row's "reuse the synthesis treatment" means **extracting** a component, not pointing at one.
5. **Status helpers are duplicated inline, not shared.** `STATUS_RANK`, `BADGE_CLASS`/`DOT_CLASS`, `badgeClass()`/`dotClass()`, and the client-only `'unknown'` fallback live inside `device-services.component.ts` / `devices.component.ts` / `audit.component.ts`. The wire enum is `'healthy' | 'degraded' | 'down'` only — `'unknown'` is a client-side concept for "no runs".

## Detailed Findings

### A. Data contracts (`@opspilot/shared`)

All schemas are `z.strictObject` (closed — reject leaked columns), re-exported via wildcard from the single barrel `libs/shared/src/index.ts`.

- **`Service`** — `libs/shared/src/lib/schemas/service.schema.ts:14-25`: `{ composePath: string|null, composeProject: string|null, containerName, createdAt(iso), deviceId(uuid), id(uuid), name, updatedAt(iso) }`. **Confirmed: NO `status`/`outcome` field** (comment at `:10-13`: stable identity only). Each row carries `deviceId`, so it is self-identifying as to device.
- **`Device`** — `libs/shared/src/lib/schemas/device.schema.ts:11-21`: `{ agentContext: string(≤4000)|null, createdAt, host, id(uuid), name, updatedAt }`.
- **`Skill`** — `libs/shared/src/lib/schemas/skill.schema.ts:18-27`: `{ commandTemplate, createdAt, deviceId: uuid|null (null = global), id(uuid), name(min 1), parameters: SkillParameter[], timeoutMs: int+|null, updatedAt }`. `SkillParameter` — `skill-parameter.schema.ts:15`: `{ name, required: boolean, source: 'input'|'service' }`.
- **`LlmProvider`** — `libs/shared/src/lib/schemas/llm-provider.schema.ts:13-22`: `{ active: boolean, baseURL: url, createdAt, hasApiKey: boolean, id, kind: z.enum(['openai-compatible']), model, updatedAt }`. **No `name`** — `baseURL` is the title; secrets omitted. `kind` enum value is `'openai-compatible'`.
- **`AuditEvent`** — `libs/shared/src/lib/schemas/audit-event.schema.ts:14-24`: `{ action, createdAt(iso), id, metadata: Record<string,unknown>|null, runRecordId: string|null, synthesis?: DiagnosisSynthesis (optional — run-linked rows only), targetId: string|null, targetType: string|null, userId }`.
- **`auditAction` enum** — `libs/shared/src/lib/schemas/audit-log.schema.ts:7-26` (closed, 18 values): `credential.create/delete, device.create/delete/update, diagnose.run, llmProvider.activate/create/delete/update, service.create/delete/scan/update, skill.create/delete/run/update`.
- **`auditListQuery`** — `libs/shared/src/lib/schemas/audit-list-query.schema.ts:9-15`: `{ action?, from?, limit?(1-100), offset(default 0), to? }`.
- **`DiagnosisSynthesis`** — `libs/shared/src/lib/schemas/diagnosis-synthesis.schema.ts:11-16`: `{ problems: string[], status: z.enum(['healthy','degraded','down']), suggestions: string[], summary }`. **The status enum has NO `unknown` literal** — absence of a run = absence of status.
- **`RunRecord`** — `libs/shared/src/lib/schemas/run-record.schema.ts:15-24`: `{ createdAt(iso), deviceId, durationMs?, id, serviceId, synthesis }`. `synthesis.status` here is the de-facto per-service status.

### B. API endpoints (`apps/api`) — fleet-read verdict

- **Services** — `apps/api/src/modules/service/service.controller.ts:30-82`, controller prefix `@Controller('devices/:deviceId')`. Routes (with global `/api`): `POST /api/devices/:deviceId/scan`, `GET /api/devices/:deviceId/services`, `GET …/services/:serviceId`, `POST …/services`, `PATCH …/services/:serviceId`, `DELETE …/services/:serviceId`. **No fleet `GET /services`.** Data layer confirms: `service.service.ts:67-68` `findAll(deviceId)` does `.where(eq(service.deviceId, deviceId))` — no cross-device method.
- **Devices** — `apps/api/src/modules/device/device.controller.ts:14-50`, `@Controller('devices')`: `GET /api/devices` (list all, `:27`), `GET /api/devices/:id` (`:31`), plus POST/PATCH/DELETE.
- **Diagnose / runs** — `apps/api/src/modules/diagnose/diagnose.controller.ts:16-47`, prefix `@Controller('devices/:deviceId/services/:serviceId')`: `GET …/diagnose/runs` (newest-first, `?limit`≤100/`?offset`, returns `RunRecord[]`, `:22`); `@Sse GET …/diagnose/stream` (`:40`). **No per-service "latest status" endpoint** — the only status read is the paginated runs list, per `(deviceId, serviceId)`.
- **Overview** — `apps/api/src/modules/overview/overview.controller.ts:14-17`: `GET /api/overview/metrics` returns aggregate tile counts only, **not** a per-service status list — does not solve the fleet need.

**Verdict:** the `/devices` fleet table cannot do a single read. It must `GET /api/devices`, fan out `GET …/services` per device (N calls), and — for status — fan out `diagnose/runs` per service (M calls), taking the newest record. Services with zero runs render grey `unknown`. The clean-but-optional backend fix is a new aggregate `GET /api/services` joining the latest `run_record.synthesis.status`; no such route/contract exists today.

### C. Devices / Services / Diagnosis stores (the `/devices` table reuses these)

- **`DevicesStore`** (fleet-level) — `apps/web/src/app/features/devices/data/devices.store.ts`. `@Injectable()` (no root), provided in `DevicesComponent` `providers: [DevicesClient, DevicesStore]` (`devices.component.ts:30`). State `{ devices: Device[], error, loading }` (`:23-27`). Signals: `devices()`, `error()`, `isEmpty = computed(!loading && devices.length===0)` (`:51`), `loading()`. Methods: `add` (`:60`), `load` (`:87`), `remove(id)` (`:97`), `replaceCredential` (`:109`), `update(id,input)` (`:125`). Loaded in **constructor**: `void this.store.load()` (`devices.component.ts:52`). Result type `DeviceActionResult = { error: null|string }` (`:19-21`, shared with ServicesStore).
- **`ServicesStore`** (per-device today) — `apps/web/src/app/features/services/data/services.store.ts`. `@Injectable()` (`:33`), provided **per-row** in `DeviceServicesComponent` `providers: [ServicesClient, ServicesStore, DiagnosisClient, DiagnosisStore]` (`device-services.component.ts:62`). State `{ error, loading, scan: ScannedContainer[]|null, services: Service[] }` (`:8-15`). Methods all take `deviceId`: `load(deviceId)` (`:74`), `remove(deviceId,id)` (`:84`), `rename(deviceId,id,name)` (`:94`), `runScan(deviceId)` (`:107`), `addSelected(deviceId,selected)` (`:52`). Loaded via **`effect()`**, not constructor: `loadEffect = effect(() => void this.store.load(this.deviceId()))` (`device-services.component.ts:98-100`) — matches the `lessons.md` rule.
- **`DiagnosisStore`** — `apps/web/src/app/features/diagnosis/data/diagnosis.store.ts`. `@Injectable()` (`:43`), provided per-row alongside ServicesStore. State keyed by serviceId: `{ entries: Record<string, DiagnosisEntry> }` (`:23-27`). `entry(serviceId)` returns `emptyEntry` (never undefined) for unknown ids (`:59-61`). `loadRuns(deviceId, serviceId)` calls `client.recentRuns` and patches that entry's `runs` (non-fatal, `:65-72`). Client `recentRuns` → `GET …/diagnose/runs` parsed via `runRecordSchema.array()` (`diagnosis.client.ts:25-29`). The `diagnosis/` feature has **no component** — only `data/` files.

**Latest-status expression used today** (copy this exactly): `diagnosis.entry(service.id).runs[0]?.synthesis?.status ?? 'unknown'` — list template `device-services.component.html:34`; rollup `device-services.component.ts:119`.

**Status helpers (all inline, duplicated — candidates to lift into `client-table.ts` or a status util):**
- `DeviceStatus = 'unknown' | DiagnosisSynthesis['status']` — `device-services.component.ts:46`.
- `STATUS_RANK: Record<DeviceStatus, number> = { degraded:2, down:3, healthy:1, unknown:0 }` — `:50`. **Note the spec wants the opposite sort order** (`down(0) < degraded(1) < healthy(2) < unknown(3)` so worst surfaces first on ascending sort); the existing map ranks for a worst-of rollup (`down` highest). The plan must pick one rank convention for the table's status sorter.
- `BADGE_CLASS`/`UNKNOWN_BADGE` (`:23-32`), `DOT_CLASS`/`UNKNOWN_DOT` (`:35-42`); methods `badgeClass()` (`:132`), `dotClass()` (`:146`). Device-level dot map `DEVICE_DOT_CLASS` + `deviceDotClass(deviceId)` — `devices.component.ts:19-24,56`.

**Current `/devices` UI to replace:** `DevicesComponent` renders one bordered card per device (`devices.component.html:35`), each embedding `<app-device-services [deviceId] [deviceName] (statusChange)>` (`:71-75`); the parent keeps `deviceStatuses = signal<Record<string,DeviceStatus>>` (`:49`) because each child's row-scoped DiagnosisStore is unreadable from the parent. `DeviceServicesComponent` renders a flex "table" of services with `runsEffect` loading runs once per service (guarded by a `loadedRuns` Set, `:104-112`) and `worstStatus = computed` rollup (`:116-125`). **The redesign collapses both into one fleet table** — and notably removes the parent/child status-emit dance, since a single component can own one `DiagnosisStore`.

**Service-detail route (keep — rows link here):** `app.routes.ts:26-34` `path: 'devices/:deviceId/services/:serviceId'`, nested under `/devices` so the Devices nav stays active. Navigate via `this.router.navigate(['/devices', deviceId, 'services', serviceId])` (`device-services.component.ts:152-154`). Row is `role="link"` + `tabindex="0"` with click + `keydown.enter`/`keydown.space` (`device-services.component.html:39-41`); edit/delete buttons `$event.stopPropagation()`.

### D. Skills / Providers / Audit stores + components

- **Skills** — store `apps/web/src/app/features/skills/data/skills.store.ts` (`@Injectable()`, provided `skills.component.ts:17`). State `{ error, loading, skills: Skill[] }` (`:13-17`). Methods `create` (`:49`), `load` (`:61`), `remove(id)` (`:71`), `update(id,input)` (`:81`). Loaded in **constructor** (`:40-43`) alongside `DevicesClient.listDevices()` → `devices = signal<Device[]>` for scope labels; `deviceNames = computed(Map)` (`:38`); `scopeLabel(skill)` → `'Global'` when `deviceId===null` else device name (`:69-74`). Client `skills.client.ts`: `list` → `GET /api/skills` array-parse (`:17`), `listForDevice` (`:23`), create/remove/update. Current template: a hand-rolled bordered table (header `name|scope|command|params|actions`); params shown as **count** `{{ skill.parameters.length }}`; command is mono-ish truncated. Delete via `hlm-alert-dialog` + `skillToDelete` signal.
- **Providers** — store `apps/web/src/app/features/llm-providers/data/llm-providers.store.ts` (provided `llm-providers.component.ts:20`). State `{ error, loading, providers: LlmProvider[] }` (`:18-22`). **`activate(id)` (`:57`)** → `client.activate(id)` then `load()`. **No "active id" on the FE** — the active provider is the row with `active === true` (server single-active invariant; see *Historical Context*). Also create/load/remove/update. Client `activate(id)` → `PATCH /api/llm-providers/:id/activate` (`:19`). Current template is a **stack of cards** (`llm-providers.component.html:34`), title `{{ provider.baseURL }}` (`:47`), status dot `bg-op-success`/`bg-op-ash`, `active`/`inactive` label, activate button when `!active`.
- **Audit** — store `apps/web/src/app/features/audit/data/audit.store.ts` (provided `audit.component.ts:18`). State `{ error, events: AuditEvent[], loading, selectedId: string|null }` (`:7-14`). **`select(id)` toggles the single expanded row** (`:60`) — the only store with built-in row-selection state (skills/providers have none); reuse it for the audit table's expansion. `load(query?: AuditListQuery)` accepts filter/paging args but is called with none today (`:48`). Client `list(query?)` builds params only for defined keys → `GET /api/audit` array-parse (`:16`). Current template is already table-ish (header `time|action|target|detail`); rows **with `synthesis`** render as `<button (click)="store.select(event.id)">`, others as plain `<div>`; expandable card at `audit.component.html:64-107` (status badge + summary + `grid sm:grid-cols-2` problems/suggestions). **`skill.run` `metadata.outcome` is NOT rendered today** — the spec's "Result" column (skill.run outcome OR synthesis status) is new work; `metadata` is on the schema but unused in the view.

### E. The "synthesis card" treatment — must be EXTRACTED, does not exist

There is **no** `app-synthesis-card` component. The badge + summary + problems/suggestions grid is duplicated inline three times:
1. **Canonical (full-size diagnose surface):** `apps/web/src/app/features/services/service-detail.component.html:141-187` — `badgeClass(status)`, `{{ v.summary || 'diagnosing…' }}`, `grid gap-7 sm:grid-cols-2` problems `[x]` / suggestions `[+]` with `@empty` fallbacks.
2. **Audit expandable row:** `audit.component.html:64-107` (smaller text, `bg-op-surface-soft`).
3. **Partial (dot + badge only):** `device-services.component.html:47-57`.

Each owns its own `badgeClass()`/`BADGE_CLASS`. All key off `DiagnosisSynthesis`. To "reuse the synthesis treatment" in the audit table, extract a small `input<DiagnosisSynthesis>()` component (and fold the duplicated `badgeClass` logic into it) — this is a net-positive refactor the plan should call out, scoped so service-detail can adopt it too (or at least not regress).

### F. Spartan-ng helm + Tailwind foundation

- **Helm is owned source under `libs/ui/`, not an npm package.** `@spartan-ng/brain` + `@spartan-ng/cli` are installed; helm is generated by the CLI into `libs/ui/<x>/` and resolved via TS path aliases (`tsconfig.base.json:16-32`). `components.json`: `{ componentsPath: "libs/ui", importAlias: "@spartan-ng/helm", generateAs: "entrypoint" }`. Installed: `alert-dialog, badge, button, card, checkbox, dialog, empty, icon, input, label, select, separator, sonner, table, tooltip, utils`.
- **Available primitives & real import lines:**
  - table — `import { HlmTableImports } from '@spartan-ng/helm/table';` (`scan-services.dialog.ts:10`); selectors `table[hlmTable]`, `thead[hlmTHead]`, `tbody[hlmTBody]`, `tr[hlmTr]`, `th[hlmTh]`, `td[hlmTd]`, `div[hlmTableContainer]` (`libs/ui/table/src/lib/hlm-table.ts:7-125`).
  - input — `import { HlmInput } from '@spartan-ng/helm/input';` (`device-form.dialog.ts:12`), selector `[hlmInput]`.
  - select — `import { HlmSelectImports } from '@spartan-ng/helm/select';` (`device-form.dialog.ts:14`); `hlm-select`/`-trigger`/`-value`/`-content`/`-group`/`-item`, `*hlmSelectPortal`; wraps `BrnSelect`. For filters bind `(valueChange)`/`[(ngModel)]` to a signal setter (existing usage uses `formControlName`).
  - badge — `import { HlmBadge } from '@spartan-ng/helm/badge';` — **installed, zero app usage yet**; skills "Scope" / providers "Status" will be first consumers. CVA: `[hlmBadge]` or `<hlm-badge>`.
  - button — `hlmBtn` (`HlmButtonImports`), widely used.
  - alert-dialog — `import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';` (`devices.component.ts:14`); the verbatim delete-confirm pattern is `devices.component.html:82-95` + TS `:29,44,65-72,82-85`.
  - **pagination — DOES NOT EXIST** (`libs/ui/pagination/` absent, no alias). Verdict: build the minimal `‹ prev · 1 2 3 · next ›` footer from `HlmButton` (the helper owns `page`/`pageCount`/`rangeLabel`), or generate the helm via the CLI. Hand-rolled `HlmButton` footer is lower friction and matches the spec fallback.
- **`clientTable<T>` home:** `apps/web/src/app/shared/client-table.ts` (alias `@app/shared/client-table`, `tsconfig.base.json:14`). `apps/web/src/app/shared/` already holds flat utilities (`directives/`, `layout/`, `validators/`); no existing search/sort/paginate helper — greenfield. Follow the pure-function/no-DI precedent of `shared/directives/clickable-classes.ts` (uses `hlm()` from `@spartan-ng/helm/utils`).
- **Density / tokens:** no hand-rolled CSS system. Tailwind v4 + custom `op-*` palette via `@theme` in `apps/web/src/styles.scss:56-92` (`--color-op-mute`, `--color-op-ash`, `--color-op-hairline`, `--color-op-surface-soft`, …). Existing density examples in `devices.component.html`: muted text `text-op-mute text-[11.5px]`, compact buttons `rounded-[4px] border px-[13px] py-[5px] text-xs font-medium`, hairline rows `border-op-hairline border … py-[15px]`, inputs `bg-op-surface-soft`. Helm internals already use spartan semantic tokens (`text-muted-foreground`, `text-foreground`, `h-10`) so both token families resolve — but **match the surrounding `op-*` voice** for consistency. Merge classes via `hlm()`/`classes()` from `@spartan-ng/helm/utils`, not string concat. Run `npm run format` after templates (prettier-plugin-tailwindcss orders classes).

## Code References

- `libs/shared/src/lib/schemas/service.schema.ts:14-25` — `Service` (no status field)
- `libs/shared/src/lib/schemas/diagnosis-synthesis.schema.ts:11-16` — status enum `healthy|degraded|down` (no `unknown`)
- `libs/shared/src/lib/schemas/run-record.schema.ts:15-24` — per-service status source
- `libs/shared/src/lib/schemas/audit-event.schema.ts:14-24` + `audit-log.schema.ts:7-26` — audit shape + action enum
- `libs/shared/src/lib/schemas/llm-provider.schema.ts:13-22` — provider (no `name`, `baseURL` is title)
- `apps/api/src/modules/service/service.controller.ts:30-82` + `service.service.ts:67-68` — per-device-only services
- `apps/api/src/modules/diagnose/diagnose.controller.ts:22` — paginated `diagnose/runs`, the only status read
- `apps/web/src/app/features/devices/data/devices.store.ts:51,60,87,97` — fleet-level DevicesStore
- `apps/web/src/app/features/services/data/services.store.ts:74,84,94,107` — per-device ServicesStore
- `apps/web/src/app/features/diagnosis/data/diagnosis.store.ts:59-72` — `entry()` / `loadRuns()`
- `apps/web/src/app/features/services/components/device-services.component.ts:46-50,116-154` — status helpers, rollup, row navigation (to be subsumed)
- `apps/web/src/app/app.routes.ts:26-34` — service-detail route (keep)
- `apps/web/src/app/features/skills/dialogs/skill-form.dialog.ts:23-28,55` — skill dialog context shape
- `apps/web/src/app/features/devices/dialogs/device-form.dialog.ts:17-21,41` — device dialog context shape
- `apps/web/src/app/features/services/dialogs/rename-service.dialog.ts:17-21,42` — rename dialog context shape
- `apps/web/src/app/features/services/dialogs/scan-services.dialog.ts:15-19,63,78` — scan dialog context + custom `contentClass`
- `apps/web/src/app/features/llm-providers/data/llm-providers.store.ts:57` — `activate(id)`
- `apps/web/src/app/features/audit/data/audit.store.ts:48,60` — `load(query?)`, `select(id)`
- `apps/web/src/app/features/services/service-detail.component.html:141-187` — canonical synthesis card to extract
- `apps/web/src/app/features/devices/devices.component.html:82-95` — alert-dialog delete-confirm pattern
- `apps/web/src/app/features/services/dialogs/scan-services.dialog.html:18-52` — the only existing helm `<table hlmTable>` usage
- `apps/web/src/app/features/devices/dialogs/device-form.dialog.html:52-62` — spartan `<hlm-select>` usage
- `apps/web/src/app/shared/directives/clickable-classes.ts` — pure-utility precedent for `client-table.ts`
- `apps/web/src/styles.scss:56-92` — `op-*` design tokens
- `tsconfig.base.json:14-32` — `@app/*` and `@spartan-ng/helm/*` aliases
- `components.json` — spartan CLI config (to add pagination)

## Architecture Insights

- **One pattern, four screens.** Component-provided `signalState` store + zod-parsing client + dialog-store-via-context is uniform. The `clientTable<T>` helper sits *above* the stores: `source: Signal<T[]>` fed from `store.devices()` / `store.skills()` / etc. It must stay pure/no-DI so all four tables share it.
- **The fleet table is the only screen that needs new data plumbing.** Skills/providers/audit already load full collections in one call; their redesign is purely presentational (wrap existing signals in `clientTable`, swap markup to helm table). The `/devices` table is the hard one: two-level fan-out (devices → services → runs) with per-service status resolution and a `loadedRuns`-style guard to avoid refetch storms. Owning **one** `DiagnosisStore` at the page level (instead of per-row) removes the current parent/child `statusChange` emit dance.
- **`'unknown'` is a presentation concept, not a wire value.** Keep the `?? 'unknown'` fallback and grey treatment; never invent `Service.status`. The status *sorter* needs a chosen rank — and the spec's desired order (worst-first on ascending: `down < degraded < healthy < unknown`) is the **inverse** of the existing rollup `STATUS_RANK`; don't blindly reuse the inline map.
- **Two refactors fall out naturally and should be planned, not improvised:** (1) extract the inline synthesis card into a reusable `input<DiagnosisSynthesis>()` component for the audit expandable row; (2) lift the duplicated status `badgeClass`/`dotClass`/rank helpers into a shared util so all four tables agree. Both reduce the duplication the agents found.
- **Lessons that bind this change** (`context/foundation/lessons.md`): load input-dependent data from a named `effect()`, never the constructor (the fleet table's per-device/per-service fan-out is input/signal-driven — mirror `DeviceServicesComponent.loadEffect`, not the constructor-load that skills/providers/audit use). If the optional aggregate `GET /api/services` is added on the API side, route any tunable (e.g. a status-join limit) through the config layer, not an in-file `const`, and inject deps with explicit `@Inject` tokens.

## Historical Context (from prior changes)

- The single-active-provider invariant the providers table relies on (`active === true` is server-truth, no FE "active id") is enforced server-side and was hardened in a prior lesson: *"Compute-then-write invariants belong in one transaction"* — `llm-provider.service.ts` create/activate wrap unset-all + set-one in one `db.transaction` (`context/foundation/lessons.md`). The FE correctly just reads `provider.active` and calls `activate(id)`.
- The diagnose/runs status pipeline this redesign reads from was the subject of the just-closed `devices-service-detail` change (recent commits `9b1917f`, `0573995`, `6c2e4b8`, and `866cc41` "tear down prior service diagnose stream on detail id switch"). The service-detail route and its synthesis card (the extraction source in §E) come from that work.
- The immediately preceding commit on `main` (`6e184c6` "refactor(services): enhance table functionality with search, filter, and pagination") suggests some search/filter/pagination groundwork may already be in flight on the services surface — **verify against the working tree before planning** whether any partial `clientTable`-like code already landed.

## Related Research

- None prior for this change (`context/changes/list-redesign-datatables/` contains only `change.md` + this `research.md`). `context/archive/` holds the closed `devices-service-detail` change referenced above for diagnose/runs and the synthesis card lineage.

## Open Questions

1. **Fleet data strategy — the decisive plan question.** Accept the client-side two-level fan-out (`GET /devices` → per-device services → per-service runs), or add the optional aggregate `GET /api/services` (with a `latestStatus` joined from `run_record`) + a shared contract? The fan-out is N+M requests on `/devices` load; the aggregate is one request but new backend + contract surface. The spec lists the aggregate as *optional* — needs an explicit decision.
2. **Status sort rank.** The spec wants `down(0) < degraded(1) < healthy(2) < unknown(3)` (worst first). The existing inline `STATUS_RANK` is the inverse (built for worst-of rollup). Define one canonical rank for the table sorter and decide whether to also re-point the rollup at it.
3. **Pagination chrome.** Generate the spartan pagination helm via CLI (adds `libs/ui/pagination/` + alias, more "official") vs. hand-roll the `HlmButton` footer (lower friction, spec-sanctioned). Recommend hand-roll for now.
4. **Synthesis card extraction scope.** Extract one shared component and adopt it in audit only, or also refactor `service-detail.component.html` to consume it in the same change (more churn, less duplication)? Scope it deliberately.
5. **Working-tree check.** Confirm whether commit `6e184c6`'s "search, filter, and pagination" work already introduced any reusable table primitive that `clientTable<T>` should build on or replace, before writing new code.

> **Resolved during planning (2026-06-23):** commit `6e184c6` touched **only** `mockups/index.html` + `compose.yaml` — no app code, so `clientTable<T>` is greenfield. Correction to this research's framing: that mockup was **not** noise — it is the visual prototype of this redesign. The authoritative design reference is `mockups/design_handoff_list_redesign/reference/OpsPilot.list-redesign.dc.html` (identical to `mockups/index.html`), with `mockups/design_handoff_list_redesign/CLAUDE_CODE_PROMPT.md` as the source of `change.md`. The plan's column sets / host strip / action bar / pagination chrome match that prototype 1:1. See `plan.md` → References.
