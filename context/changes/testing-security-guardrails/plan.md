# Phase 3 Security Guardrails — Implementation Plan

## Overview

Phase 3 of the test rollout (`context/foundation/test-plan.md` §3) clusters the three
abuse/security risks — #4 secret leakage, #3 per-device skill confinement, #5 auth boundary — at
the integration/contract layer (api, real temp DB). Research (`research.md`) plus a direct audit of
the existing specs established that **#3 and #4 are already fully covered**; the single genuine gap
is **#5: no spec asserts unauth → 401 over HTTP**, because every controller spec deliberately strips
the global guard. This plan closes that one gap with two net-new tests and then characterizes #3/#4
as already-protected, filling the §6.4 cookbook and recording the author-trust exclusion.

This mirrors Phase 2 exactly: research found the guardrail structurally sound, so the phase closes a
residual hole rather than building net-new coverage.

## Current State Analysis

**Risk #4 — secret leakage: fully covered.** Both secret paths assert ciphertext-on-disk, a
secret-free audit transcript, and an encrypt→store→decrypt round-trip against a real temp DB:

- credential — `apps/api/src/core/credential/credential.service.spec.ts:71-133` (ciphertext + transcript + round-trip); response-body safety at `apps/api/src/modules/device/device.controller.spec.ts:118-144`.
- llm API key — `apps/api/src/modules/llm-provider/llm-provider.service.spec.ts:76-127` (secret-free contract `:76-91`, secret-free transcript `:93-108`, ciphertext-on-disk `:110-120`, round-trip `:122-127`).
- skill.run audit row is secret-free `{outcome, skillName}` — `apps/api/src/modules/skill/skill-run.service.spec.ts:227-239`.

**Risk #3 — skill confinement: fully covered**, including the custom-skill path and parameter
injection, at both unit and wire level:

- custom skill scoped to another device → 404 over HTTP, real DB — `apps/api/src/modules/skill/skill-run.controller.spec.ts:185-205` (this is the S-08 proof the change intent demands).
- input-source shell-metacharacter value → 400, no command — `skill-run.controller.spec.ts:207-227`.
- service-source tainted value → ZodError, no command — `skill-run.service.spec.ts:184-191`.
- out-of-scope / forged skillId → 404, no command — `skill-run.service.spec.ts:145-152`.
- cross-device serviceId → 404 — `skill-run.controller.spec.ts:173-183`.
- scope filter (`findForDevice` = global + that device only) — `apps/api/src/modules/skill/skill.service.spec.ts:134-144`.

**Risk #5 — auth boundary: the one genuine gap.** The guard is global (`APP_GUARD` →
`AuthAppGuard`, `apps/api/src/app.module.ts:32`); there are zero `@UseGuards` in production code, so
a dropped guard is structurally impossible and the only failure mode is an accidental `@Public()`.
But every controller spec stands in a fake-session middleware and never registers the real
`APP_GUARD` (e.g. `device.controller.spec.ts:60-67`, `skill-run.controller.spec.ts:84-89`), and
`auth.guard.spec.ts` tests `canActivate` in isolation. **No test asserts unauth → 401 over the wire,
and nothing enumerates `@Public()` to catch a stray one.**

### Key Discoveries:

- The guard short-circuits on `IS_PUBLIC_KEY` metadata before any session lookup (`apps/api/src/core/auth/auth.guard.ts:24-30`); on a null session it throws `UnauthorizedException('valid session required')` (`:34-36`), normalized by `AllExceptionsFilter` to `{ message: 'valid session required', status: 401, timestamp: <ISO> }` (`apps/api/src/common/filters/all-exceptions.filter.ts:21-26`).
- Public exemptions are exactly two, both class-level `@Public()`: `AuthController` (`apps/api/src/core/auth/auth.controller.ts:8`) and `HealthController` (`apps/api/src/core/health/health.controller.ts:8`).
- The session lookup is `authInstance.api.getSession(...)` against the `AUTH_INSTANCE` token (`apps/api/src/core/auth/providers/auth.provider`) — the seam to override with a fake that returns null (401 path) or a session object (positive control).
- `main.ts:12-13` sets the global `/api` prefix; the wire test must replicate it so paths match production.
- The real-temp-DB seam (`tmpdir()` path + `databaseConfig.KEY`/`cryptoConfig.KEY` overrides + `-wal`/`-shm` teardown, fixed key `AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=`) is cloned per spec, not shared (decision: clone).
- `@Inject(Class)` tokens are mandatory — esbuild/Vitest drops `design:paramtypes` (lessons.md).

## Desired End State

`npx nx test api` is green with one new spec that, over real HTTP against a booted `AppModule`,
(a) proves an unauthenticated request to a representative operational endpoint in every module
returns 401 with the canonical envelope, that the public health route returns 200, and that a valid
session passes through; and (b) proves via route-metadata enumeration that exactly `AuthController`
and `HealthController` carry `isPublic` — so a future stray `@Public()` fails the suite.
`test-plan.md` §6.4 documents the three guardrail patterns with canonical references, §7 records the
malicious-skill-author exclusion, §6.6 carries the Phase 3 note, and §3 Status reads `complete`.

## What We're NOT Doing

- **No net-new #3 or #4 tests.** Confinement (incl. custom skills), parameter injection (service- and
  input-source, unit + wire), and both secret round-trips/transcripts are already covered; duplicating
  them would re-characterize behavior research and this audit confirmed present.
- **No LLM-provider secret-parity replication** — already covered at `llm-provider.service.spec.ts:76-127`.
- **No malicious-skill-author test.** Injection is guarded on parameter *values*, not on the
  operator-authored `commandTemplate`; blocking shell in a template would be a behavior change, not a
  test. Documented as out-of-scope (small-trusted-group model, like host-key TOFU).
- **No skill-run stdout-echo test** — stdout is the operator's command output, not a secret channel;
  the param is a charset-bounded argument. Out of scope (weak oracle).
- **No shared temp-DB helper extraction** — clone the existing seam (decision).
- **No signup-disable or login rate-limit change** — out of scope under the threat model (§7).

## Implementation Approach

Boot the real `AppModule` once (the only way to get the production `APP_GUARD` + the real route list),
override `AUTH_INSTANCE` with a fake `getSession` and the DB/crypto config with a temp file, then run
two describe blocks off that single boot: a supertest 401 sweep and a `DiscoveryService` metadata
sweep. Documentation updates follow in a separate phase so the test code lands and goes green first.

## Phase 1: Wire-level auth boundary (Risk #5)

### Overview

Add the one net-new spec that asserts the global guard over real HTTP and pins the `@Public()`
allowlist structurally.

### Changes Required:

#### 1. Auth boundary spec

**File**: `apps/api/src/core/auth/auth.boundary.spec.ts` (new)

**Intent**: Prove unauth → 401 across operational endpoints and lock the `@Public()` allowlist to
exactly Auth + Health, so a dropped/added guard surfaces here. Two describe blocks share one
`AppModule` boot.

**Contract**:
- Boot: `Test.createTestingModule({ imports: [AppModule] })` → `.overrideProvider(databaseConfig.KEY).useValue({ backupRetention: 5, path: <temp> })` → `.overrideProvider(cryptoConfig.KEY).useValue({ encryptionKey: <fixed key> })` → `.overrideProvider(AUTH_INSTANCE).useValue(fakeAuth)`, then `createNestApplication()`, `app.setGlobalPrefix('api')`, `await app.init()` (runs migrations). Clone the `-wal`/`-shm` teardown.
- `fakeAuth` exposes `{ api: { getSession: vi.fn() } }`; a mutable return lets the test drive null (401) vs a session object (pass).
- **401 sweep (block A)**: with `getSession` → `null`, supertest one representative route per operational module — `GET /api/devices`, `GET /api/skills`, `POST /api/devices/:d/services/:s/skills/:k/run`, `GET /api/llm-providers`, `GET /api/audit`, `GET /api/diagnose/runs`, `GET /api/services` (or the canonical scan route) — each `.expect(401)` and `expect(res.body).toEqual({ message: 'valid session required', status: 401, timestamp: expect.any(String) })`. Assert `GET /api/health` → 200 (public control). Then flip `getSession` to return a session object and assert one previously-401 route no longer returns 401 (positive control, so the suite is not a blanket-401 tautology).
- **`@Public` sweep (block B)**: resolve `DiscoveryService` + `MetadataScanner` + `Reflector` from the booted context; enumerate every controller and its method handlers; collect handlers where `reflector.getAllAndOverride(IS_PUBLIC_KEY, [handler, controllerClass])` is truthy; assert the *set of controller classes* owning a public route equals exactly `{ AuthController, HealthController }`.

### Success Criteria:

#### Automated Verification:

- New spec passes: `npx nx test api -- src/core/auth/auth.boundary.spec.ts`
- Full api suite green: `npx nx test api`
- Lint + typecheck pass: `npx nx lint api`

#### Manual Verification:

- The 401 sweep hits at least one route from every operational module (device, service, skill, skill-run, llm-provider, audit, diagnose) — reviewed against the controller list in `research.md`.
- Reasoning check: adding a stray `@Public()` to any operational controller would fail block B (confirm by mentally — or via a throwaway local edit — toggling one).

**Implementation Note**: After Phase 1 automated verification passes, pause for manual confirmation
before Phase 2. Phase blocks use plain bullets; the `## Progress` checkboxes are the source of truth.

---

## Phase 2: Characterization & plan closure (docs)

### Overview

Record that #3/#4 are already protected, write the §6.4 cookbook, and close the phase. No new tests.

### Changes Required:

#### 1. §6.4 cookbook — security / guardrail tests

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the §6.4 "TBD" with the canonical recipe for each guardrail, pointing at the
existing specs (the patterns to clone) and the new auth-boundary spec.

**Contract**: §6.4 documents three patterns: (a) secret-at-rest round-trip on a real temp DB —
ciphertext-on-disk + secret-free transcript + `getDecrypted*` round-trip + secret-free read contract,
ref `credential.service.spec.ts` / `llm-provider.service.spec.ts`; (b) per-device skill confinement +
parameter injection — `requireInScope` → 404 incl. custom skills, charset-whitelist rejection (not
shell-quoting), ref `skill-run.controller.spec.ts` / `skill-run.service.spec.ts`; (c) wire-level auth
boundary — boot `AppModule`, override `AUTH_INSTANCE`, 401 sweep + `DiscoveryService` `@Public` sweep,
ref the new `auth.boundary.spec.ts`. Include the `npx nx test api -- <path>` run lines.

#### 2. §7 — author-trust exclusion

**File**: `context/foundation/test-plan.md`

**Intent**: Add the malicious-skill-author boundary to "What We Deliberately Don't Test."

**Contract**: One bullet: injection is guarded on substituted parameter *values* (charset whitelist),
not on the operator-authored `commandTemplate`; an operator who can author a skill is trusted under
the small-trusted-group model (consistent with host-key TOFU and the login rate-limit exclusion).
Re-evaluate if skill authoring is ever exposed to untrusted users. Source: Phase 3 planning.

#### 3. §6.6 per-phase note + §3 status

**File**: `context/foundation/test-plan.md`

**Intent**: Append the Phase 3 note and bump Phase 3 Status to `complete`.

**Contract**: §6.6 — 2-3 lines: research + spec audit found #3/#4 already covered (cite the specs), so
the phase closed only the Risk #5 wire-level gap with `auth.boundary.spec.ts` (supertest 401 sweep +
`DiscoveryService` `@Public` sweep); author-trust exclusion recorded in §7. §3 — Phase 3 row Status
`change opened` → `complete`. Also update the header "Last updated" line.

#### 4. change.md closeout

**File**: `context/changes/testing-security-guardrails/change.md`

**Intent**: Reflect the completed phase.

**Contract**: `status: planned` → set by this plan now; `/10x-implement` advances it to reflect
completion at phase end. Updated date stamped.

### Success Criteria:

#### Automated Verification:

- Formatting clean: `npm run format:check`
- Full api suite still green: `npx nx test api`

#### Manual Verification:

- §6.4 reads as a complete recipe with correct file references (no remaining "TBD").
- §7 carries the author-trust exclusion; §6.6 carries the Phase 3 note; §3 Phase 3 Status is `complete`.

**Implementation Note**: Documentation phase — confirm the test-plan reads coherently end-to-end
after the edits.

---

## Testing Strategy

### Unit Tests:

- None net-new. The guard's `canActivate` branches are already unit-covered (`auth.guard.spec.ts`).

### Integration Tests:

- One new integration spec (`auth.boundary.spec.ts`): wire-level 401 across operational modules +
  public-route control + positive session control, and a `DiscoveryService` `@Public` metadata sweep.

### Manual Testing Steps:

1. Run `npx nx test api -- src/core/auth/auth.boundary.spec.ts` — both blocks green.
2. Temporarily add `@Public()` to one operational controller, re-run — block B must fail. Revert.
3. Read `test-plan.md` §6.4/§7/§6.6/§3 top-to-bottom for coherence.

## Performance Considerations

Booting the full `AppModule` per suite is heavier than a single-module `TestingModule`, but it is the
only way to exercise the real `APP_GUARD` and the production route list; one boot serves both blocks.
Cost is acceptable for a single spec.

## Migration Notes

None — additive test + documentation only; no schema, API, or runtime behavior changes.

## References

- Research: `context/changes/testing-security-guardrails/research.md`
- Change identity: `context/changes/testing-security-guardrails/change.md`
- Test plan: `context/foundation/test-plan.md` §2 (Risk Map), §3 (Phase 3), §6.4 (cookbook to fill), §7
- Clone templates: `apps/api/src/core/credential/credential.service.spec.ts`, `apps/api/src/modules/device/device.controller.spec.ts`
- Guard wiring: `apps/api/src/app.module.ts:32`, `apps/api/src/core/auth/auth.guard.ts:22-39`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Wire-level auth boundary (Risk #5)

#### Automated

- [x] 1.1 New spec passes: `npx nx test api -- src/core/auth/auth.boundary.spec.ts` — cd89a1f
- [x] 1.2 Full api suite green: `npx nx test api` — cd89a1f
- [x] 1.3 Lint + typecheck pass: `npx nx lint api` — cd89a1f

#### Manual

- [x] 1.4 401 sweep hits at least one route per operational module (reviewed against research route list) — cd89a1f
- [x] 1.5 A stray `@Public()` would fail block B (reasoning or throwaway local edit) — cd89a1f

### Phase 2: Characterization & plan closure (docs)

#### Automated

- [x] 2.1 Formatting clean: `npm run format:check` — 44faf50
- [x] 2.2 Full api suite still green: `npx nx test api` — 44faf50

#### Manual

- [x] 2.3 §6.4 reads as a complete recipe with correct file references (no "TBD") — 44faf50
- [x] 2.4 §7 author-trust exclusion present; §6.6 Phase 3 note present; §3 Phase 3 Status `complete` — 44faf50
