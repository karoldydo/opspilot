---
date: 2026-06-07T00:00:00+02:00
researcher: Karol Dydo
git_commit: 1f81c2f1852ef74545f87615d0cba92cd182b312
branch: main
repository: karoldydo/opspilot
topic: "F-02 account-auth-foundation: how Better Auth (email+password, flat model) wires into the existing NestJS+Drizzle backend and the Angular client (guard + 401 interceptor)"
tags: [research, codebase, auth, better-auth, drizzle, nestjs, angular, guard, interceptor, contracts]
status: complete
last_updated: 2026-06-07
last_updated_by: Karol Dydo
---

# Research: F-02 account-auth-foundation

**Date**: 2026-06-07T00:00:00+02:00
**Researcher**: Karol Dydo
**Git Commit**: 1f81c2f1852ef74545f87615d0cba92cd182b312
**Branch**: main
**Repository**: karoldydo/opspilot

## Research Question

For roadmap foundation slice **F-02 (`account-auth-foundation`)** — register / login / session + "unauthenticated reaches no operational function", flat model, no roles — map exactly **where Better Auth plugs into the existing backend** (Drizzle adapter, catch-all handler, migrations, config, global guard) and **how the Angular client wires in** (Better Auth client, functional `CanActivateFn`, 401 interceptor), comprehensively, grounded in the current codebase.

Scope agreed with user: deep on **Better Auth↔BE integration** + **Angular client/guard**; the Cloudflare-Access-vs-app-session two-layer identity and the registration-policy/threat-model questions are surfaced as **Open Questions** for `/10x-frame`, not deep-dived here.

## Summary

F-01 (`data-persistence-scaffold`) is **already implemented** and gives F-02 a clean seam — the roadmap baseline (2026-05-30, "Auth: absent / Data: absent") is stale. The backend now has a `@Global` `DatabaseModule` exposing the single Drizzle connection under the token `DATABASE_CONNECTION`, a **boot-time custom migration runner** (`MigrationService implements OnApplicationBootstrap`), a `@nestjs/config` + Joi config layer, a **deliberately empty schema barrel** annotated *"the first table lands in f-02"*, a per-use `ZodValidationPipe`, and `health/` as a copyable slice template. The shared library has an established **one-Zod-schema-per-file → `z.infer` → barrel re-export** contract pattern.

What F-02 must add, and the load-bearing facts that shape it:

1. **`better-auth` is not installed** (nor `tailwindcss`/`@tailwindcss/postcss`/`@spartan-ng/*` on the web side). F-02 is greenfield wiring on top of F-01.
2. **The Drizzle adapter must reuse the existing `DATABASE_CONNECTION`** — inject it, hand the same instance to `drizzleAdapter(db, { provider: 'sqlite' })`. Do not open a second `better-sqlite3` handle (`drizzle.md` single-connection rule).
3. **Better Auth's own tables go through the existing migration path, not Better Auth's migrate.** Generate the table definitions (`@better-auth/cli generate`), export them from the empty `schema/index.ts` barrel, run `db:generate` (drizzle-kit) to emit SQL, and let the boot-time `MigrationService` apply it. `@better-auth/cli migrate` only supports Kysely, not Drizzle — so this is also the only correct path.
4. **The global `/api` prefix collides with Better Auth's default `basePath: /api/auth`.** A naively-routed Nest auth controller lands at `/api/api/auth/*`. Must be reconciled (set Better Auth `basePath: '/auth'`, or `setGlobalPrefix('api', { exclude })`, or mount as raw middleware). Also Better Auth needs the **raw request body** → `NestFactory.create(AppModule, { bodyParser: false })`.
5. **No guard/middleware/interceptor exists today** — both current endpoints (`/api`, `/api/health`) are fully public. The "unauth reaches nothing" posture is **entirely unbuilt**; it needs a global guard (`APP_GUARD`) + a `@Public()`/`@AllowAnonymous()` allowlist for the auth handler (and probably `/api/health`).
6. **Web side has no `HttpClient` provided and an empty route table.** `app.config.ts` providers are only `provideBrowserGlobalErrorListeners()` + `provideRouter(appRoutes)`; `app.routes.ts` is `[]`. F-02 adds `provideHttpClient(withInterceptors([authInterceptor]))`, the route table (`/login`, `/register`, guarded features), and the auth client/guard/interceptor.
7. **Same-origin web+api is the easy security path** — `createAuthClient({ baseURL: '/api' })` keeps cookies host-only, SameSite=Lax, no CORS-credentials dance. `trustedOrigins` must include `https://opspilot.example.com` and `baseURL` should be set explicitly (HTTPS) because the app runs behind Cloudflare.

## Detailed Findings

### Area 1 — Backend integration seam (Drizzle adapter + connection + config)

**The injectable DB connection.** The Drizzle instance is a single app-scoped provider under the **string token `DATABASE_CONNECTION`**, provided + exported by a `@Global()` module, so any slice can inject it without importing `DatabaseModule`.

- Token + type: `apps/api/src/database/providers/database-connection.provider.ts:11,13` — `DATABASE_CONNECTION = 'DATABASE_CONNECTION'`; type `BetterSQLite3Database<typeof schema> & { $client: ... }` (raw handle reachable via `.$client`).
- Factory: same file `:17-33` — one `better-sqlite3` connection, `journal_mode = WAL`, `foreign_keys = ON`, returns `drizzle(sqlite, { schema })`.
- Global export: `apps/api/src/database/database.module.ts:9-20` (`exports: [DATABASE_CONNECTION]`).
- Injection idiom to mirror: `apps/api/src/health/health.service.ts:10` — `constructor(@Inject(DATABASE_CONNECTION) private readonly databaseConnection: DatabaseConnection) {}`.

→ **Better Auth adapter** = a provider whose `useFactory` injects `DATABASE_CONNECTION` (+ auth config) and returns `betterAuth({ database: drizzleAdapter(db, { provider: 'sqlite' }), ... })`. Default Better Auth table names (`user`/`session`/`account`/`verification`) need no `schema` mapping.

**Config / env layer.** Operational values flow through `@nestjs/config` + Joi (per `nestjs.md`: *no `process.env` outside the config layer* — and `lessons.md`: tunables go through Joi-validated config, never in-file `const`s).

- Bootstrapping: `apps/api/src/config/config.module.ts:7-17` — `NestConfigModule.forRoot({ isGlobal: true, load: [databaseConfig], validationSchema: envSchema, ... })`.
- `registerAs` namespace: `apps/api/src/config/database.config.ts:3-8`; injected by `databaseConfig.KEY`.
- Joi schema + typed interface: `apps/api/src/config/env.schema.ts:3-15` (each var typed in `EnvConfig`, bounded/defaulted in Joi).

→ **Auth env additions:** add `BETTER_AUTH_SECRET` (Joi `.min(32).required()`, **no default** — must be supplied) and `BETTER_AUTH_URL` (`.uri()`, explicit HTTPS public URL) to `EnvConfig` + `envSchema`; create `apps/api/src/config/auth.config.ts` with `registerAs('auth', ...)`; add `authConfig` to the `load: []` array in `config.module.ts:11`; inject via `@Inject(authConfig.KEY)`.

### Area 2 — Schema & migrations (the load-bearing integration risk)

**Custom boot-time runner — Better Auth must not bring its own.**

- `apps/api/src/database/migration/migration.service.ts:12,24,32` — `implements OnApplicationBootstrap`; on boot runs a WAL-aware `backupGate()` then `migrate(this.databaseConnection, { migrationsFolder })` (Drizzle `better-sqlite3/migrator`), **before `app.listen()`**, fail-fast.
- Pending detection: same file `:42-79` — compares `migrations/meta/_journal.json` entry count vs rows in `__drizzle_migrations`.
- Generate config: `apps/api/drizzle.config.ts:13-15` — `dialect: 'sqlite'`, `schema: './src/database/schema/index.ts'`, `out: './migrations'`. Scripts: `package.json:13-15` (`db:generate` / `db:migrate` / `db:studio`).
- The schema target: `apps/api/src/database/schema/index.ts:1-3` — **empty barrel** `export {};` with the comment *"the first table lands in f-02; drizzle.config.ts points here as its schema target."* Both the generate step and the runtime `drizzle(sqlite, { schema })` typing read this exact module.

→ **Workflow:** `@better-auth/cli generate` → place table defs under `apps/api/src/database/schema/` and re-export from `index.ts` → `npm run db:generate` (drizzle-kit emits SQL into `apps/api/migrations/`) → boot-time `MigrationService` applies it automatically. **Never** `@better-auth/cli migrate` (Kysely-only) and **never** `drizzle-kit migrate` at runtime — both would fork the migration history the backup-gate + `__drizzle_migrations` accounting tracks.

### Area 3 — Mounting the handler under the global `/api` prefix

- Prefix: `apps/api/src/main.ts:9-11` — `app.setGlobalPrefix('api')`; **no global pipes/filters/body-parser tweaks**, only `enableShutdownHooks()`.
- `ZodValidationPipe` is **per-use, not global** (`apps/api/src/common/zod-validation.pipe.ts:4-13`) → **no conflict** with a raw catch-all auth handler.

**Two mounting options (web research, cited below):**
- **(a) `@thallesp/nestjs-better-auth`** — the de-facto Nest integration; registers a **global `AuthGuard`** (matches "guard everything"), opt out per-route with `@AllowAnonymous()`/`@OptionalAuth()`, inject session via `@Session()`. Requires `NestFactory.create(AppModule, { bodyParser: false })`.
- **(b) Manual catch-all** — `@All(...)` controller forwarding raw `req`/`res` to `toNodeHandler(auth)` (`better-auth/node`).

**The prefix collision (must reconcile):** Better Auth default `basePath` is `/api/auth`; with Nest `setGlobalPrefix('api')` a Nest-routed auth controller becomes `/api/api/auth/*`. Fixes: set Better Auth `basePath: '/auth'` (effective `/api/auth`, which the client's `baseURL: '/api'` expects), or `setGlobalPrefix('api', { exclude: [...] })`, or mount as raw middleware outside Nest routing. Express version matters: repo is on **Express 4** (`express ^4.21.2`), so the Express-5 `/*splat` wildcard 404 bug (`nestjs-better-auth` #85) likely won't bite — but pin the module version and verify the route resolves without a double prefix.

### Area 4 — The missing access-control posture (guard)

**Nothing guards anything today.** A full scan of `apps/api/src` found **zero** `CanActivate` / `NestMiddleware` / `NestInterceptor` / `APP_GUARD` / `APP_FILTER` / `@UseGuards`, and no global pipe. Both `/api` (`AppController`) and `/api/health` are public.

→ The `better-auth.md` rule (*"guard every endpoint except the public Better Auth handler; an unauthenticated request must reach no operational function"*) is **unmet and unbuilt**. Implement a **global guard** (`APP_GUARD` in `app.module.ts` providers) validating the Better Auth session (`auth.api.getSession({ headers })`), returning `401`, with a `@Public()`/`@AllowAnonymous()` allowlist (`Reflector`) for the `/api/auth/*` handler and almost certainly `/api/health` (the deploy healthcheck must stay anonymous). That `401` is exactly what the web interceptor catches.

### Area 5 — Slice/module convention (mirror `health/`)

`health/` is the copyable template — a flat feature folder `apps/api/src/<slice>/` with `*.module.ts` + `*.controller.ts` + `*.service.ts` + colocated `*.spec.ts`, wired into `app.module.ts:11` imports.

→ **`apps/api/src/auth/`**: `auth.module.ts` (imported into `app.module.ts`), `auth.controller.ts` (`@Controller('auth')` catch-all), `providers/auth.provider.ts` (token e.g. `AUTH_INSTANCE`, `useFactory` injecting `DATABASE_CONNECTION` + `authConfig.KEY`). Better Auth **table definitions live under `database/schema/`** (re-exported from the barrel), *not* in the auth slice — schema stays centralized for drizzle-kit. `nestjs.md` framing: the auth *handler* is a slice; the *global guard* is the cross-cutting piece.

### Area 6 — Shared Zod contracts for auth DTOs

Established pattern (per `contracts.md` / `zod.md` / `shared-library.md`): **one Zod schema per file**, `kebab-case` + `.schema.ts` suffix, colocated `.spec.ts`, type via `z.infer`, both re-exported through the barrel; consumed via `@opspilot/shared` alias (never relative). Auth DTOs are framework-agnostic — no `@nestjs/*`/`@angular/*` imports.

- Examples: `libs/shared/src/lib/schemas/api-error.schema.ts:5-11` and `health-response.schema.ts:6-12` — `export const xSchema = z.strictObject({...})` then `export type X = z.infer<typeof xSchema>`.
- Barrel: `libs/shared/src/index.ts:1-2` (`export * from './lib/schemas/...'`). Alias: `tsconfig.base.json:13` (`@opspilot/shared`).
- BE consumes the **type** as a return annotation (`apps/api/src/health/health.controller.ts:2,12`; `health.service.ts:2,12`) and the **schema** at the boundary in tests (`health.controller.spec.ts:3,68` — `healthResponseSchema.parse(result)`). `ZodValidationPipe` is built to validate inbound `@Body()` against a shared schema.

→ **Proposed auth contracts** (e.g. `auth-login-request.schema.ts`, `auth-register-request.schema.ts`, `auth-session.schema.ts`/`auth-user.schema.ts`), each barrel-re-exported. *Caveat:* Better Auth owns its own request/response shapes and its client; introduce shared Zod DTOs only where **our** controllers/forms validate input (e.g. registration form), not to redefine Better Auth's internal endpoints — confirm the seam during `/10x-plan` so we don't duplicate Better Auth's contract.

### Area 7 — Angular client + guard + 401 interceptor

**Bootstrap state (all greenfield seams):**
- `apps/web/src/app/app.config.ts:6-8` — providers are **only** `provideBrowserGlobalErrorListeners()` + `provideRouter(appRoutes)`. **No `provideHttpClient`, no interceptors.** Router is wired.
- `apps/web/src/app/app.routes.ts:3` — `export const appRoutes: Route[] = [];` (empty).
- Mount point: `apps/web/src/app/app.html:2` `<router-outlet>` (the `<app-nx-welcome>` above it is scaffold noise to replace).

**Conventions that constrain the implementation (`angular.md`):** functional guards/interceptors + `inject()`; `:25` zoneless (no Zone.js / no `provideZoneChangeDetection` — so session state must be **signal-driven**); `:29` avoid `providedIn: 'root'` (provide the auth client explicitly); `:40` lazy `loadComponent`; `:49` `OnPush` + `signal()`/`computed()` + `input()`/`output()`, no `any`; `:34` new control flow `@if/@for`; `:30` `takeUntilDestroyed()` not `ngOnDestroy`. Component prefix `app` (`apps/web/project.json:4`).

**Styling not wired yet:** `apps/web/src/styles.scss:1` has no `@import "tailwindcss"`; `apps/web/.postcssrc.json` is absent; `package.json` has no `tailwindcss`/`@tailwindcss/postcss`/`@spartan-ng/*`/`better-auth`. The login/register UI target is Tailwind v4 utilities + spartan/ng primitives (`tailwind.md`, `spartan.md`) — installing/wiring that stack is part of F-02 (or a precursor).

→ **Proposed web layout** (`apps/web/src/app/auth/`): `auth-client.ts` (`createAuthClient({ baseURL: '/api' })`, exposes session as a signal, provided explicitly), `auth.guard.ts` (functional `CanActivateFn` → `UrlTree` redirect to `/login` when unauthenticated), `auth.interceptor.ts` (functional `HttpInterceptorFn` → on `401` clear session signal + redirect `/login`), `login/` + `register/` (OnPush standalone components). Wiring edits: add `provideHttpClient(withInterceptors([authInterceptor]), withFetch())` to `app.config.ts`; populate `app.routes.ts` with public `/login`+`/register` and guarded feature routes (`canActivate: [authGuard]`).

**Coordination:** guard and interceptor read/write the **same** Better Auth client session signal — interceptor flips it on `401`, guard observes it on next navigation. Single shared client instance (not `providedIn: 'root'`) so login/register/guard/interceptor share one source of truth.

## Code References

GitHub permalinks at commit `1f81c2f`:

- [`apps/api/src/database/providers/database-connection.provider.ts:11`](https://github.com/karoldydo/opspilot/blob/1f81c2f1852ef74545f87615d0cba92cd182b312/apps/api/src/database/providers/database-connection.provider.ts#L11) — `DATABASE_CONNECTION` token (the adapter's injection point).
- [`apps/api/src/database/database.module.ts:9`](https://github.com/karoldydo/opspilot/blob/1f81c2f1852ef74545f87615d0cba92cd182b312/apps/api/src/database/database.module.ts#L9) — `@Global` module exporting the connection.
- [`apps/api/src/database/migration/migration.service.ts:24`](https://github.com/karoldydo/opspilot/blob/1f81c2f1852ef74545f87615d0cba92cd182b312/apps/api/src/database/migration/migration.service.ts#L24) — boot-time migrate (auth tables ride this path).
- [`apps/api/src/database/schema/index.ts:1`](https://github.com/karoldydo/opspilot/blob/1f81c2f1852ef74545f87615d0cba92cd182b312/apps/api/src/database/schema/index.ts#L1) — empty barrel, F-02 first-table target.
- [`apps/api/drizzle.config.ts:13`](https://github.com/karoldydo/opspilot/blob/1f81c2f1852ef74545f87615d0cba92cd182b312/apps/api/drizzle.config.ts#L13) — drizzle-kit generate config.
- [`apps/api/src/config/config.module.ts:7`](https://github.com/karoldydo/opspilot/blob/1f81c2f1852ef74545f87615d0cba92cd182b312/apps/api/src/config/config.module.ts#L7) / [`env.schema.ts:3`](https://github.com/karoldydo/opspilot/blob/1f81c2f1852ef74545f87615d0cba92cd182b312/apps/api/src/config/env.schema.ts#L3) — config+Joi pattern for the new secret/baseURL vars.
- [`apps/api/src/main.ts:9`](https://github.com/karoldydo/opspilot/blob/1f81c2f1852ef74545f87615d0cba92cd182b312/apps/api/src/main.ts#L9) — global `/api` prefix (the basePath collision).
- [`apps/api/src/health/health.service.ts:10`](https://github.com/karoldydo/opspilot/blob/1f81c2f1852ef74545f87615d0cba92cd182b312/apps/api/src/health/health.service.ts#L10) — `@Inject(DATABASE_CONNECTION)` idiom + slice template.
- [`apps/api/src/common/zod-validation.pipe.ts:4`](https://github.com/karoldydo/opspilot/blob/1f81c2f1852ef74545f87615d0cba92cd182b312/apps/api/src/common/zod-validation.pipe.ts#L4) — per-use Zod pipe (no global conflict).
- [`libs/shared/src/lib/schemas/health-response.schema.ts:6`](https://github.com/karoldydo/opspilot/blob/1f81c2f1852ef74545f87615d0cba92cd182b312/libs/shared/src/lib/schemas/health-response.schema.ts#L6) — schema→`z.infer`→export idiom. Barrel: [`libs/shared/src/index.ts:1`](https://github.com/karoldydo/opspilot/blob/1f81c2f1852ef74545f87615d0cba92cd182b312/libs/shared/src/index.ts#L1).
- [`apps/web/src/app/app.config.ts:6`](https://github.com/karoldydo/opspilot/blob/1f81c2f1852ef74545f87615d0cba92cd182b312/apps/web/src/app/app.config.ts#L6) — no HttpClient/interceptors yet. Routes: [`app.routes.ts:3`](https://github.com/karoldydo/opspilot/blob/1f81c2f1852ef74545f87615d0cba92cd182b312/apps/web/src/app/app.routes.ts#L3) (empty).

## Architecture Insights

- **F-01 deliberately left F-02 a single seam.** The empty schema barrel, the global injectable connection, the boot-time migrator, and the config layer were all built so the *first domain table* (Better Auth's `user`) drops in without re-plumbing. The roadmap's "Auth absent / Data absent" baseline is pre-F-01 and should not be trusted.
- **One migration history, one applier.** The single hardest integration decision is keeping Better Auth's tables inside the existing drizzle-kit-generate → boot-time-migrate pipeline. Better Auth's Drizzle path *forces* this (its own `migrate` is Kysely-only), which happily aligns with the repo's WAL backup-gate accounting.
- **"Guard everything" is an `APP_GUARD` + allowlist, not per-controller decorators.** With zero existing guards, a single global guard is both the cleanest and the only way to guarantee a *new* endpoint added later is locked-by-default — matching the access-control posture's intent.
- **Same-origin is a security simplifier.** `baseURL: '/api'` + same origin means host-only SameSite=Lax cookies, no CORS credentials, no cross-subdomain cookie config. Keep web+api same-origin to avoid the CSRF/cookie complexity.
- **Zoneless ⇒ signal-based session.** The Angular session state must be a signal so async Better Auth callbacks trigger change detection; guard and interceptor coordinate through that one signal.

## Historical Context (from prior changes)

- `context/foundation/roadmap.md:98-109` — F-02 definition: scope is **registration/login/session/guard only, no roles or recovery flows**; risk note: building the guard before any operational slice avoids retrofitting auth across every endpoint. Prerequisite F-01, parallel with F-03.
- `context/foundation/roadmap.md:71-81` (Baseline, 2026-05-30) — states Auth/Data absent; **superseded** by the current tree (F-01 landed). Use the live codebase, not this baseline.
- `context/foundation/prd.md:62-63` (FR-001) + `:119-121` (Access Control) — flat multi-user, in-app login kept *because the audit log needs an identity independent of the deployment/network layer* — directly informs Open Question 1 below.
- `context/foundation/lessons.md` — operational tunables go through `@nestjs/config` + Joi, never in-file `const`s. Applies to the new `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL`.
- `.claude/rules/better-auth.md` — the binding rule: Drizzle adapter on the shared connection, catch-all handler, flat model, no hand-rolled JWT/bcrypt; client `createAuthClient({ baseURL: '/api' })`, functional `CanActivateFn`, 401 interceptor.

## Related Research

None yet — this is the first research artifact under `context/changes/account-auth-foundation/`. F-01's implementation (`context/changes/data-persistence-scaffold/`, if archived) is the direct upstream.

## Open Questions

1. **Audit identity source of truth (Cloudflare Access vs app session)** — *Roadmap Open Q2 / blocks S-09, soft.* The app sits behind Cloudflare Access (`CF_Authorization`) and also holds a Better Auth session. PRD FR-001 already argues the **app session** is the audit identity (Access is a network gate). Confirm in `/10x-frame`; verify Cloudflare forwards the `Origin` header so Better Auth `trustedOrigins` validation passes through the tunnel. *(Out of deep scope per user, flagged for framing.)*
2. **Registration policy / threat model** — open self-registration sits on a publicly-reachable endpoint (behind Access, but still). Options: open signup, `disableSignUp` + seed/first-user-admin, or invite. The PRD says "flat, all logged-in users equal" but is silent on *who can create an account*. Decide before exposing `/api/auth/sign-up`. *(Out of deep scope per user, flagged for framing.)*
3. **`@thallesp/nestjs-better-auth` vs manual catch-all** — the community module gives the global guard for free but its `setGlobalPrefix('api')` interaction is undocumented; needs a spike to confirm `basePath`/`exclude`/middleware wiring and `@nestjs/common ^11` + Express 4 support. Resolve in `/10x-plan`.
4. **Shared-contract boundary with Better Auth** — Better Auth owns its endpoint shapes and client. Decide which auth DTOs genuinely belong in `@opspilot/shared` (our forms/validation) vs which would wrongly duplicate Better Auth's internal contract. Resolve in `/10x-plan`.
5. **Healthcheck must stay anonymous** — the global guard's allowlist has to exempt `/api/health` (deploy/Cloudflare healthcheck) alongside `/api/auth/*`. Confirm the deploy probe path during planning.

## Verification Notes (web research, cited)

Sources for Better Auth specifics (PART B agent): [Better Auth NestJS](https://better-auth.com/docs/integrations/nestjs), [ThallesP/nestjs-better-auth](https://github.com/ThallesP/nestjs-better-auth) ([#85](https://github.com/ThallesP/nestjs-better-auth/issues/85)), [Drizzle adapter](https://better-auth.com/docs/adapters/drizzle), [CLI](https://better-auth.com/docs/concepts/cli), [Options](https://better-auth.com/docs/reference/options), [Security](https://better-auth.com/docs/reference/security), [Express integration](https://better-auth.com/docs/integrations/express). Flagged uncertainties: exact `setGlobalPrefix` reconciliation, Cloudflare Access `Origin`/proxy-header handling, and community-module version compatibility — all require an end-to-end spike through the tunnel.
