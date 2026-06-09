<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Manage Devices (FR-002 + FR-013)

- **Plan**: context/changes/manage-devices/plan.md
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-06-10
- **Verdict**: NEEDS ATTENTION (all findings triaged + fixed)
- **Findings**: 0 critical, 3 warnings, 4 observations

## Verdicts

| Dimension           | Verdict |
|---------------------|---------|
| Plan Adherence      | WARNING |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Findings

### F1 — replaceCredential: signature drift + reliability gap

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence / Safety & Quality
- **Location**: apps/web/src/app/core/stores/devices.store.ts:115-125
- **Detail**: delete-all-then-create deleted every credential then created the new one. A failed create after the deletes left the device with zero credentials and no rollback; the "no rollback needed" comment was misleading.
- **Fix A ⭐ Recommended**: create-then-delete — store the new credential first, drop the old ones only on success.
- **Decision**: FIXED via Fix A — reordered to create-then-delete with a defensive id filter; added a spec proving a failed create keeps the existing credential.

### F2 — Credential delete not scoped to path deviceId (IDOR-lite)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: apps/api/src/device/credential/device-credential.controller.ts:56-60, apps/api/src/credential/credential.service.ts:65-68
- **Detail**: remove(credentialId) deleted by id alone — never verified the credential belonged to the path :deviceId, so DELETE /devices/A/credentials/<cred-of-B> succeeded. (list was already scoped.)
- **Fix A ⭐ Recommended**: remove takes deviceId and scopes the where clause; 404 on a mismatched pair.
- **Decision**: FIXED via Fix A — CredentialService.remove(deviceId, id) with `and(eq id, eq deviceId)`, controller passes the path deviceId.

### F3 — device.service.update uses .set(input) spread

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: apps/api/src/device/device.service.ts:35
- **Detail**: `.set(input)` spread the DTO into Drizzle, diverging from the projection-not-spread discipline used in toContract; a future schema field would become a silent mass-assignment vector.
- **Fix**: project explicit columns — `.set({ host: input.host, name: input.name })`.
- **Decision**: FIXED — explicit column projection.

### F4 — Exception filter doesn't log swallowed 500s

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: apps/api/src/common/all-exceptions.filter.ts:10-18
- **Detail**: unknown (non-HttpException) errors returned a generic 500 (good) but were never logged server-side, leaving no trace for diagnosis.
- **Fix**: add Logger.error(exception) on the non-HttpException branch (server-side only).
- **Decision**: FIXED — Logger added, client still gets the generic message.

### F5 — DeviceModule applies express.json() middleware (undocumented)

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: apps/api/src/device/device.module.ts:14-17
- **Detail**: module re-applies json() to its controllers; not in the plan. Confirmed necessary — main.ts disables the global body parser (`bodyParser: false`) so Better Auth's catch-all node handler gets the raw body.
- **Fix**: add an explanatory comment documenting the why.
- **Decision**: FIXED — comment added.

### F6 — Missing unit specs for create/update request schemas

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: libs/shared/src/lib/schemas/device-update-request.schema.ts
- **Detail**: the update schema's `.refine(at least one field)` was untested at the unit level (only via controller e2e).
- **Fix**: add device-update-request.schema.spec.ts (empty-patch rejection + partial accept).
- **Decision**: FIXED — added specs for both device-update-request and device-create-request.

### F7 — Manual verification 3.7 unchecked

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/manage-devices/plan.md:542
- **Detail**: the only unchecked plan step; rollback code was present and correct but lacked recorded end-to-end evidence.
- **Fix**: rely on the existing devices.store.spec.ts rollback test as proof and check 3.7.
- **Decision**: FIXED — 3.7 checked, referencing the automated rollback test.

## Post-fix verification

`npx nx run-many -t test lint build --projects=shared,api,web --skip-nx-cache` — all green (api 41 tests, web 9+ tests, all lint/build pass).
