<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Devices Slim List + Service Detail Page

- **Plan**: context/changes/devices-service-detail/plan.md
- **Scope**: Phases 1–5 of 5 (full plan)
- **Date**: 2026-06-23
- **Verdict**: APPROVED
- **Findings**: 0 critical · 1 warning · 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated gate re-run live (not cached-blind): typecheck api ✅ · test web+api (215) ✅ · lint web+api ✅ · format:check ✅ · build web+api ✅ · `grep -ri "diagnose-hero\|DiagnoseHeroComponent" apps/web/src` → empty ✅.

All five hard Angular rules pass and are test-covered: NG0950 effect-loaded inputs, component-scoped providers, store-via-dialog-context, explicit `unknown`/grey fallback branch (never indexes BADGE/DOT maps with `'unknown'`), and `stopPropagation()` on the slim row's Edit/Delete. Per-device `DiagnosisStore` scoping was respected (not lifted to the parent). All 5 phases are MATCH — no MISSING or DRIFT.

## Findings

### F1 — Leaked SSE EventSource on service-id switch within the reused detail component

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: apps/web/src/app/features/services/service-detail.component.ts:144-150; apps/web/src/app/features/diagnosis/data/diagnosis.store.ts:50-54,177-181
- **Detail**: `DiagnosisStore` closes EventSources via `teardown(serviceId)` before each new stream/replay and via `closeAll()` from its own `destroyRef.onDestroy`. The store is provided per-component, so `closeAll` only fires on `ServiceDetailComponent` destroy. But Angular reuses one component instance across `:serviceId` param changes (loadComponent route). If a user hits Re-run on service A, then the URL switches to service B without unmounting, A's stream (keyed under "A") is never closed — a latent leaked-stream-on-id-switch. Low likelihood (no in-app A→B link; breadcrumb only goes to /devices which destroys the component), but real. The per-row `device-services` design can't hit this.
- **Fix**: In `serviceEffect`, track the previous serviceId and close its stream when the id changes; store exposes a public `closeStream(serviceId)` delegating to the private `teardown`. Mirrors the sse.md "always tear the stream down" rule at the id-switch boundary.
- **Decision**: FIXED — added `DiagnosisStore.closeStream(serviceId)` (public) and a `streamedServiceId` guard in `serviceEffect` that closes the prior service's stream on id change. Verified: build web ✅ · lint web ✅ · test web (96) ✅.

### F2 — service-detail resolves the owning device via a cross-feature DevicesClient

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: apps/web/src/app/features/services/service-detail.component.ts:6,60,90-94,153-158,231-238
- **Detail**: The component adds `DevicesClient` + a `deviceEffect`/`resolveDevice` path not enumerated in the Phase 2 "Contract" bullet. It is NOT scope creep: the plan's Phase 2 layout explicitly requires the breadcrumb `{deviceName}` and the meta line `@ {device} · {host}`, which a `Service` object can't supply (it carries only `deviceId`). Resolving the device is the necessary means to a planned end, done well — non-fatal, falling back to the raw id on a failed read. Only note: it imports across feature folders (services → devices/data). Both are `scope:web` so no enforced boundary violation (lint green), and it's strictly better than diagnose-hero's old query-param hack.
- **Fix**: None — flagged for awareness only.
- **Decision**: SKIPPED — justified by the plan layout; works correctly with a non-fatal fallback; lint green.
