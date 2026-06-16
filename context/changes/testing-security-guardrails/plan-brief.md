# Phase 3 Security Guardrails — Plan Brief

> Full plan: `context/changes/testing-security-guardrails/plan.md`
> Research: `context/changes/testing-security-guardrails/research.md`

## What & Why

Test rollout Phase 3 clusters the three abuse/security risks — #4 secret leakage, #3 per-device
skill confinement, #5 auth boundary — at the integration/contract layer. Research plus a direct
audit of the existing specs found that **#3 and #4 are already fully covered**; the single genuine
gap is **#5: no spec asserts unauth → 401 over HTTP**, because every controller spec strips the
global guard. This phase closes that one gap and documents the rest.

## Starting Point

Both secret paths (credential, LLM key) already assert ciphertext-on-disk + secret-free transcript +
round-trip on a real temp DB. Skill confinement — including the custom-skill S-08 case and parameter
injection at both unit and wire level — is already covered in `skill-run.controller.spec.ts` /
`skill-run.service.spec.ts`. The auth guard is global (`APP_GUARD`), but is unit-tested in isolation
and stripped in every controller spec, so nothing proves 401 over the wire or pins the `@Public()`
allowlist.

## Desired End State

`npx nx test api` is green with one new spec that boots the real `AppModule` and proves, over HTTP,
that operational endpoints return 401 without a session (health returns 200; a valid session passes),
and that exactly `AuthController` + `HealthController` carry `isPublic` — so a future stray `@Public()`
fails the suite. The §6.4 cookbook, §7 exclusion, §6.6 note, and §3 status are all updated.

## Key Decisions Made

| Decision                       | Choice                                   | Why (1 sentence)                                                                 | Source   |
| ------------------------------ | ---------------------------------------- | -------------------------------------------------------------------------------- | -------- |
| Wire-level 401 harness         | Import full `AppModule` + supertest      | Only way to exercise the production `APP_GUARD` + real route list; new endpoints covered automatically. | Plan     |
| Accidental-`@Public` guard     | `DiscoveryService` sweep + both proofs   | Structural inverted regression catches a stray `@Public()` on any future route. | Plan     |
| Scope                          | Only the genuine gap + inverted tests    | Audit confirmed #3/#4 fully covered; duplicating them re-characterizes present behavior. | Research + Plan |
| Malicious skill-author         | Out of scope — documented in §7          | Injection is guarded on values, not the operator template; trusted under small-group model. | Plan     |
| Skill-run stdout echo          | Out of scope                             | Stdout is operator command output, not a secret channel; weak oracle.           | Plan     |
| Temp-DB harness                | Clone existing seam                      | Matches repo convention; no refactor risk to existing specs.                    | Plan     |

## Scope

**In scope:** one new `auth.boundary.spec.ts` (wire-level 401 sweep + `DiscoveryService` `@Public`
sweep); test-plan §6.4 cookbook, §7 exclusion, §6.6 note, §3 status.

**Out of scope:** any new #3/#4 test (already covered); LLM-provider parity replication;
malicious-author / template-injection test; stdout-echo test; shared temp-DB helper; signup/rate-limit changes.

## Architecture / Approach

Boot `AppModule` once (real `APP_GUARD` + real routes), override `AUTH_INSTANCE` with a fake
`getSession` (null → 401, session object → pass) and DB/crypto config with a temp file. Run two
describe blocks off that boot: a supertest 401 sweep (one route per operational module + a public
control + a positive control) and a `DiscoveryService`/`Reflector` metadata sweep over `IS_PUBLIC_KEY`.
Docs land in a separate phase after the test is green.

## Phases at a Glance

| Phase                                  | What it delivers                                            | Key risk                                                        |
| -------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------- |
| 1. Wire-level auth boundary (Risk #5)  | `auth.boundary.spec.ts` — 401 sweep + `@Public` sweep       | Full `AppModule` boot + `AUTH_INSTANCE` override wiring         |
| 2. Characterization & closure (docs)   | §6.4 cookbook, §7 exclusion, §6.6 note, §3 status           | Accurately citing existing coverage; no test changes           |

**Prerequisites:** none — additive test + docs on a codebase whose guardrails already exist.
**Estimated effort:** ~1 session, 2 phases (one spec + documentation).

## Open Risks & Assumptions

- Assumes the `AUTH_INSTANCE` fake faithfully drives the guard's `getSession` branch (null vs session);
  the guard reads only the return value, so this holds.
- Assumes booting `AppModule` under Vitest applies migrations cleanly to the temp DB (the established
  pattern in `*.controller.spec.ts` does this via `app.init()`).
- The `@Public` sweep depends on `DiscoveryService` enumerating all controllers in the booted context;
  confirm the mechanism resolves handlers (NestJS `DiscoveryService` + `MetadataScanner`).

## Success Criteria (Summary)

- An unauthenticated request to any operational endpoint returns 401 with the canonical envelope;
  the public health route returns 200; a valid session passes through.
- A stray `@Public()` on any operational controller fails the suite.
- The test-plan documents all three guardrail patterns and the author-trust exclusion; Phase 3 is `complete`.
