# Account Auth Foundation (F-02) — Plan Brief

> Full plan: `context/changes/account-auth-foundation/plan.md`
> Frame brief: `context/changes/account-auth-foundation/frame.md`
> Research: `context/changes/account-auth-foundation/research.md`

## What & Why

Stand up Better Auth email+password register/login/session with a global app-layer guard so that
**every operational endpoint requires a valid session (401 otherwise)** — while open self-service
signup is intentionally retained, **safe by virtue of Cloudflare Access (allowed-emails policy +
WARP) fronting the entire app as the registration gate**. The in-app session is the audit identity
and a second security layer, not the world-facing signup barrier.

## Starting Point

F-01 left a single clean seam: a `@Global` injectable Drizzle connection (`DATABASE_CONNECTION`),
a boot-time migration runner, an empty schema barrel annotated "first table lands in f-02", and a
`@nestjs/config` + Joi layer. Nothing guards anything today — both `/api` and `/api/health` are
public — and the web app has no `HttpClient`, an empty route table, and no styling stack installed.

## Desired End State

A user (already past Cloudflare Access) registers/logs in via styled Angular screens and holds a
session; every backend endpoint except `/api/auth/*` and `/api/health` returns 401 without one,
and a newly added endpoint is locked by default. The Angular app redirects unauthenticated
navigation to `/login` and clears state + redirects on any 401.

## Key Decisions Made

| Decision                     | Choice                                              | Why (1 sentence)                                                              | Source |
| ---------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------- | ------ |
| Registration policy          | Open signup stays enabled                          | Cloudflare Access + WARP fronts the whole app and is the real registration gate. | Frame  |
| Audit identity               | App session (not Cloudflare Access)                | Audit log needs an identity independent of the deployment/network layer.       | Frame  |
| Handler mount + guard        | Manual `@All()` catch-all + own `APP_GUARD`        | Full control over prefix/raw-body, zero version-compat risk, ~30-line guard.   | Plan   |
| Prefix collision             | Better Auth `basePath: '/auth'`                    | Effective `/api/auth` matches `createAuthClient({ baseURL: '/api' })` cleanly. | Plan   |
| Shared contracts             | Only our forms + a user/session shape              | Single source of truth where *we* validate, without duplicating Better Auth.   | Plan   |
| UI / styling scope           | Wire Tailwind v4 + spartan now, simple screens     | Styling stack is a prerequisite for all web; do it once at the first screen.    | Plan   |
| Testing depth                | Unit only (guard, schemas, interceptor)            | Cover our own logic; the Better Auth round-trip is verified manually.          | Plan   |
| Session config               | Secret/URL + `expiresIn`/`updateAge` via Joi       | Secrets never in code; TTLs tunable without a rebuild (`lessons.md`).           | Plan   |

## Scope

**In scope:** Better Auth integration (adapter on shared connection, tables via existing migrator,
catch-all handler, raw body); auth config namespace (Joi); global guard + `@Public()` allowlist
(`/api/auth/*`, `/api/health`); shared Zod auth contracts; Tailwind v4 + spartan/ng stack; Angular
auth client (signal session) + functional guard + 401 interceptor + login/register screens +
routes; documented Cloudflare-Access deployment assumption.

**Out of scope:** roles/RBAC; password recovery / email verification / 2FA / social / magic links;
flipping `disableSignUp`; hand-rolled JWT/bcrypt; duplicating Better Auth's internal contracts;
CORS/cross-origin cookies; e2e/integration tests of the auth flow; operational UI beyond
login/register.

## Architecture / Approach

Backend identity + access posture first (Phases 1–2) so "locked by default" exists before any UI
depends on it, then shared contracts (Phase 3), then the web styling stack (Phase 4) as a
prerequisite, then the Angular client/guard/interceptor + UI (Phase 5). Better Auth's Drizzle
adapter reuses the single `DATABASE_CONNECTION`; its tables ride the existing drizzle-kit-generate
→ boot-time-migrate pipeline (its own migrate is Kysely-only). Same-origin web+api keeps cookies
host-only/SameSite=Lax with no CORS. The global guard calls `auth.api.getSession`; the web guard
and 401 interceptor coordinate through one explicitly-provided session signal (zoneless).

## Phases at a Glance

| Phase                                  | What it delivers                                            | Key risk                                              |
| -------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------- |
| 1. Backend Better Auth integration     | Working `/api/auth/*` on the shared DB + migrated tables    | Prefix collision / raw-body / migration-path forking |
| 2. Global guard + access posture        | 401-by-default everywhere except the allowlist             | A missed allowlist entry locks the healthcheck/auth   |
| 3. Shared auth contracts                | Zod login/register/user schemas in `@opspilot/shared`      | Over-modeling Better Auth's internal contract         |
| 4. Web styling stack                    | Tailwind v4 + spartan/ng wired and building                | v4 CSS-first / PostCSS + spartan CLI setup friction   |
| 5. Web client/guard/interceptor + UI    | Login/register screens, route guard, 401 interceptor       | Zoneless signal coordination across guard/interceptor |

**Prerequisites:** F-01 implemented (done); Cloudflare Access (allowed-emails + WARP) fronts the
app (live); `BETTER_AUTH_SECRET` (≥32 chars) + `BETTER_AUTH_URL` supplied in the environment.
**Estimated effort:** ~3–5 sessions across 5 phases (backend-heavy in 1–2, web-heavy in 4–5).

## Open Risks & Assumptions

- **Load-bearing:** open signup is safe **only** while Cloudflare Access fronts the whole app —
  recorded as an explicit deployment assumption; `disableSignUp: true` is the one-line lever if it
  ever changes.
- Cloudflare must forward the `Origin` header through the tunnel for Better Auth `trustedOrigins`
  to validate — verify during Phase 1 manual testing.
- `bodyParser: false` is global — confirm no current non-auth endpoint needs parsed JSON.
- spartan/ng + Tailwind v4 + Angular 21 setup is new to this repo — Phase 4 may need a CLI spike.

## Success Criteria (Summary)

- A user can register and log in; the session persists and survives reload.
- Every operational endpoint is unreachable (401) without a valid session; `/api/auth/*` and
  `/api/health` stay anonymous.
- An expired/invalid session redirects the UI to `/login` instead of leaving it half-authenticated.
