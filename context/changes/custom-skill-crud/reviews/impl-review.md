<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Custom Skill CRUD (S-08)

- **Plan**: context/changes/custom-skill-crud/plan.md
- **Scope**: All 6 phases (full plan)
- **Date**: 2026-06-13
- **Verdict**: APPROVED (F1 fixed during triage)
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Success criteria verified: `nx run-many -t lint test build` green across shared, api, web
(154 api tests + 62 web tests pass; builds clean).

Load-bearing security control confirmed correct: every substituted value (service-derived
AND caller input) is re-parsed through the charset whitelist (`skillParameterValueSchema`,
excludes all shell metacharacters) at the shell boundary before interpolation; unresolved
placeholders throw before the command string is assembled; the compile-time enum guardrail
is faithfully replaced by a server-side row scope check (404 for forged/out-of-scope
`skillId`) in `requireInScope`. The `operation/` module and `service-operation*` schemas are
fully removed with no dangling references.

## Findings

### F1 — service-skills over-fetches all skills, filters client-side

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: apps/web/src/app/features/services/service-skills.component.ts:55-81
- **Detail**: Plan §Phase 6 said the component "fetches findForDevice(deviceId) (global +
  that device)". The server-side `findForDevice()` existed in skill.service.ts and backed
  the run-path 404 guardrail, but no HTTP route exposed it — the controller had only
  `@Get() findAll()` returning ALL rows. So the component called `skillsClient.list()` and
  filtered client-side (`skill.deviceId === null || skill.deviceId === deviceId`).
  Execution stayed safe (run endpoint enforces scope server-side), so not an authz hole —
  the cost was an information-scope drift: every device's custom skills (incl. their
  commandTemplate text) shipped to the browser when viewing any one device's services.
- **Fix**: Expose `findForDevice` over HTTP via a `?deviceId=` query param on `@Get()`; add
  a scoped `listForDevice(deviceId)` client method; switch service-skills to it. The CRUD
  management list (skills.component) stays on `findAll()`.
  - Strength: Aligns with plan intent; no skill data leaves its scope. findForDevice already
    existed and was unit-tested, so it was an endpoint + client method, not new logic.
  - Tradeoff: Three files touched for a benefit marginal on a single-user homelab tool.
  - Confidence: HIGH — only the HTTP exposure + client call were missing.
  - Blind spot: skills.component legitimately wants all rows — kept on findAll().
- **Decision**: FIXED — applied during triage. Changed:
  - apps/api/src/skill/skill.controller.ts (`@Get()` accepts optional `?deviceId=` → findForDevice)
  - apps/web/src/app/core/clients/skills.client.ts (new `listForDevice(deviceId)`)
  - apps/web/src/app/features/services/service-skills.component.ts:81 (calls listForDevice)
  - Verified: lint + test (154 api / 62 web) + build all pass.

### F2 — Run UX: uniform run dialog vs inline button + per-skill confirm

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: apps/web/src/app/features/services/run-skill.dialog.ts
- **Detail**: Plan §Phase 6 described "each skill renders a run control; destructive skills
  (e.g. down) keep the hlm-alert-dialog confirm." Implementation routes every run through one
  uniform run-skill.dialog (command preview as confirm + a field per input param). Justified:
  the data model carries no "destructive" flag, and input params needed a collection UI the
  plan didn't place. Same intent, cleaner mechanism.
- **Fix**: None — justified design deviation, recorded for the record.
- **Decision**: SKIPPED (no action — justified observation).

### F3 — Two schema deviations are corrections, not regressions

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: libs/shared/src/lib/schemas/skill-parameter-value.schema.ts:15;
  libs/shared/src/lib/schemas/skill-update-request.schema.ts
- **Detail**: (a) Charset whitelist is `^[a-zA-Z0-9/][a-zA-Z0-9_.:/=-]*$` — adds a leading
  `/` vs the plan's sketch so absolute compose paths pass; still excludes every shell
  metacharacter. (b) Update schema uses `z.strictObject(create.shape).partial()` instead of
  the plan's `createRequest.partial()`, because Zod v4 forbids `.partial()` on a refined
  schema — the literal plan would not compile. Both are correct fixes.
- **Fix**: None — corrections required to make the literal plan compile/work.
- **Decision**: SKIPPED (no action — justified observation).
