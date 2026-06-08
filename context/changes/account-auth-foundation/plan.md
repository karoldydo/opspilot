# Account Auth Foundation (F-02) Implementation Plan

## Overview

Stand up **Better Auth** (email+password, flat model — no roles/RBAC) as the account/session
layer of OpsPilot, wired into the existing NestJS + Drizzle backend that F-01 left ready. Add a
**global guard** so every operational endpoint requires a valid session (401 otherwise), expose
the auth contracts our own forms validate through `@opspilot/shared`, wire the styling stack
(Tailwind v4 + spartan/ng), and build signal-driven login/register screens in Angular with a
functional route guard and a 401 interceptor. Open self-service signup is intentionally retained;
it is safe because Cloudflare Access (allowed-emails policy + WARP) fronts the entire app as the
registration gate.

## Current State Analysis

F-01 (`data-persistence-scaffold`) is implemented and leaves a single clean seam (verified at
commit `1f81c2f`, current HEAD):

- **Injectable DB connection** — `DATABASE_CONNECTION` string token, provided + exported by a
  `@Global()` `DatabaseModule` (`apps/api/src/database/database.module.ts:9`,
  `providers/database-connection.provider.ts:11`). One `better-sqlite3` handle, WAL, `foreign_keys = ON`.
  Inject idiom: `apps/api/src/health/health.service.ts:10`.
- **Boot-time migration runner** — `MigrationService implements OnApplicationBootstrap`
  (`apps/api/src/database/migration/migration.service.ts:24`) runs a WAL backup-gate then Drizzle
  `migrate(...)` before `app.listen()`, tracking applied migrations against
  `migrations/meta/_journal.json` vs `__drizzle_migrations`.
- **Empty schema barrel** — `apps/api/src/database/schema/index.ts` is `export {};` annotated
  *"the first table lands in f-02; drizzle.config.ts points here as its schema target."* Both
  `db:generate` (drizzle-kit) and the runtime `drizzle(sqlite, { schema })` typing read this module.
- **Config layer** — `@nestjs/config` + Joi. `config.module.ts:9` registers
  `forRoot({ isGlobal: true, load: [databaseConfig], validationOptions: { abortEarly: false, allowUnknown: true }, validationSchema: envSchema })`.
  `env.schema.ts` declares the typed `EnvConfig` interface + bounded/defaulted Joi schema;
  `database.config.ts` is the `registerAs('database', ...)` namespace pattern.
- **Global `/api` prefix** — `apps/api/src/main.ts:9` `app.setGlobalPrefix('api')`; no global
  pipes/filters and **no body-parser tweaks**, only `enableShutdownHooks()`.
- **`ZodValidationPipe` is per-use, not global** (`apps/api/src/common/zod-validation.pipe.ts`) —
  no conflict with a raw catch-all auth handler.
- **Zero access control** — a full scan of `apps/api/src` found no `CanActivate`/middleware/
  interceptor/`APP_GUARD`/`@UseGuards`. `/api` (`AppController`) and `/api/health` are public.
- **Shared contract pattern** — one Zod schema per file, `*.schema.ts`, `z.strictObject`,
  `z.infer` type, colocated `*.spec.ts`, barrel re-export (`libs/shared/src/index.ts`). Example:
  `health-response.schema.ts` + the way `health.controller.ts:2` consumes the `z.infer` type.
- **Web is greenfield** — `app.config.ts` providers are only `provideBrowserGlobalErrorListeners()`
  + `provideRouter(appRoutes)`; **no `provideHttpClient`, no interceptors**. `app.routes.ts` is
  `[]`. Styling stack absent: no `@import "tailwindcss"` in `styles.scss`, no `.postcssrc.json`,
  no `tailwindcss`/`@tailwindcss/postcss`/`@spartan-ng/*`/`better-auth` in `package.json`.
- **Angular conventions** (`angular.md`) — zoneless (signal-driven state, no Zone.js), functional
  guards/interceptors with `inject()`, avoid `providedIn: 'root'`, `OnPush`, `signal()`/`computed()`,
  `loadComponent` lazy routes, `DestroyRef`/`takeUntilDestroyed`, component prefix `app`.

## Desired End State

A user reaching the app (already past Cloudflare Access) can register and log in via styled
Angular screens; a valid session is required for every operational endpoint and feature route.
Concretely, when this plan is done:

- `POST /api/auth/sign-up` and `/api/auth/sign-in` work; sessions persist in SQLite via Better
  Auth's tables, applied through the existing boot-time migrator.
- Every backend endpoint except `/api/auth/*` and `/api/health` returns **401** without a valid
  session. A newly added endpoint is locked by default (global guard).
- The Angular app redirects unauthenticated navigation to `/login`; an expired session (any
  `401`) clears local session state and redirects to `/login`.
- Login/register screens are built on Tailwind v4 + spartan/ng helm primitives.
- The "Cloudflare Access fronts the whole app / open signup is safe because of it" dependency is
  recorded as an explicit deployment assumption, with `disableSignUp` noted as the one-line lever.

### Key Discoveries:

- **Better Auth tables must ride the existing migration path** — `@better-auth/cli generate` into
  `database/schema/`, re-export from the barrel, `npm run db:generate`, let `MigrationService`
  apply it. `@better-auth/cli migrate` is **Kysely-only** (not Drizzle), and `drizzle-kit migrate`
  at runtime would fork the history the backup-gate accounting tracks
  (`migration.service.ts:24`, `schema/index.ts:1`).
- **Prefix collision** — global `/api` + Better Auth default `basePath: /api/auth` →
  `/api/api/auth/*`. Resolved by setting Better Auth `basePath: '/auth'` so the effective path is
  `/api/auth`, exactly what `createAuthClient({ baseURL: '/api' })` expects (`main.ts:9`).
- **Raw body required** — Better Auth's node handler needs the unparsed request body →
  `NestFactory.create(AppModule, { bodyParser: false })`.
- **Adapter reuses the shared connection** — inject `DATABASE_CONNECTION`, hand the same instance
  to `drizzleAdapter(db, { provider: 'sqlite' })`. Never open a second `better-sqlite3` handle
  (`drizzle.md` single-connection rule).
- **Same-origin is the security simplifier** — `baseURL: '/api'` keeps cookies host-only,
  SameSite=Lax, no CORS-credentials dance. `trustedOrigins` must include
  `https://opspilot.example.com`; `baseURL` set to the explicit HTTPS public URL.
- **Express 4** in this repo (`express ^4.21.2`) — the Express-5 `/*splat` wildcard 404 bug does
  not apply; a manual `@All()` catch-all resolves normally.

## What We're NOT Doing

- **No roles / RBAC / permissions** — flat model, all logged-in users equal (PRD).
- **No password recovery / email verification / 2FA / social providers / magic links** — out of
  F-02 scope (roadmap F-02 is register/login/session/guard only).
- **No `disableSignUp`** — open signup stays enabled (frame, HIGH confidence). We document it as a
  one-line lever, we do not flip it.
- **No hand-rolled JWT/bcrypt/session store** — Better Auth owns credential + session handling
  (`better-auth.md`).
- **No duplication of Better Auth's internal endpoint contracts** in `@opspilot/shared` — only the
  shapes our own forms/controllers validate.
- **No CORS / cross-origin cookie setup** — web and api stay same-origin behind one host.
- **No e2e/integration test of the Better Auth flow** — the register→login→session round-trip is
  verified manually; automated tests cover our guard, interceptor, and shared schemas only.
- **No operational UI beyond login/register** — guarded feature shell is a placeholder; real
  operational slices come in later roadmap items.

## Implementation Approach

Build the backend identity + access posture first (Phases 1–2) so the "locked by default" guard
exists before any UI can depend on it, then the shared contracts (Phase 3) that both sides
consume, then the web styling stack (Phase 4) as a prerequisite for the screens, and finally the
Angular client/guard/interceptor + login/register UI (Phase 5). Each phase is independently
verifiable; Phases 1–2 deliver a backend that already enforces auth even before the UI exists.

## Critical Implementation Details

- **Migration ordering is load-bearing.** The auth tables must exist in `database/schema/` and be
  re-exported from the barrel **before** `npm run db:generate` is run, and the generated SQL must
  live under `apps/api/migrations/` so the boot-time `MigrationService` applies it on next start.
  Do not call Better Auth's own migrate, and do not run `drizzle-kit migrate` at runtime — either
  forks the `__drizzle_migrations` history the backup-gate tracks.
- **`bodyParser: false` is global.** Disabling the body parser in `main.ts` affects every
  controller. The only existing JSON consumer is the (currently absent) request bodies; verify
  `/api/health` (no body) is unaffected. If a future non-auth endpoint needs parsed JSON, it must
  opt back in locally — note this where the flag is set.
- **Guard reads the session via Better Auth, not a hand-rolled token check.** The global guard
  calls `auth.api.getSession({ headers })` against the same `AUTH_INSTANCE`; the `@Public()`
  allowlist is checked first via `Reflector` so `/api/auth/*` and `/api/health` never hit the
  session lookup.
- **Zoneless session state.** The web session must be a `signal` — Better Auth's async client
  callbacks do not trigger change detection on their own. Guard and interceptor coordinate through
  that single shared client/signal (provided explicitly, not `providedIn: 'root'`), so the
  interceptor flipping it on `401` is observed by the guard on the next navigation.

## Phase 1: Backend — Better Auth Integration

### Overview

Install Better Auth, add its config namespace (Joi-validated), generate its tables into the schema
barrel and migrate them via the existing runner, expose the auth instance as a provider on the
shared DB connection, and mount its handler as a catch-all auth slice with the prefix collision
and raw-body requirements resolved. End state: `/api/auth/*` works end-to-end (verified manually).

### Changes Required:

#### 1. Dependencies

**File**: `package.json` (root)

**Intent**: Add the Better Auth runtime and its CLI so tables can be generated and the handler
mounted.

**Contract**: Add `better-auth` to `dependencies`; `@better-auth/cli` available for the generate
step (dev). Pin exact versions. No other auth library is introduced.

#### 2. Auth config namespace + env validation

**File**: `apps/api/src/config/env.schema.ts`, `apps/api/src/config/auth.config.ts` (new),
`apps/api/src/config/config.module.ts`

**Intent**: Route every auth tunable through `@nestjs/config` + Joi (per `nestjs.md` "no
`process.env` outside the config layer" and `lessons.md`). Secrets/URL and session lifetimes are
config, never in-file constants.

**Contract**: Extend `EnvConfig` + `envSchema` with:
- `BETTER_AUTH_SECRET` — `Joi.string().min(32).required()`, **no default** (must be supplied).
- `BETTER_AUTH_URL` — `Joi.string().uri().required()` (explicit HTTPS public URL).
- `SESSION_EXPIRES_IN` — `Joi.number().integer().min(...).default(...)` (seconds).
- `SESSION_UPDATE_AGE` — `Joi.number().integer().min(...).default(...)` (seconds).

Create `auth.config.ts` mirroring `database.config.ts`: `registerAs('auth', () => ({ secret: process.env.BETTER_AUTH_SECRET, url: process.env.BETTER_AUTH_URL, sessionExpiresIn: Number(process.env.SESSION_EXPIRES_IN), sessionUpdateAge: Number(process.env.SESSION_UPDATE_AGE) }))`
(coerce numerics with `Number(...)` — Joi writes defaults back as strings, per `lessons.md`).
Export `AuthConfig = ConfigType<typeof authConfig>`. Add `authConfig` to the `load: []` array in
`config.module.ts:11`.

#### 3. Better Auth table definitions in the schema barrel

**File**: `apps/api/src/database/schema/` (new table files), `apps/api/src/database/schema/index.ts`

**Intent**: Generate Better Auth's default tables (`user`, `session`, `account`, `verification`)
as Drizzle definitions and centralize them so drizzle-kit and the runtime typing see them.

**Contract**: Run `@better-auth/cli generate` configured against the auth instance; place the
emitted `drizzle-orm/sqlite-core` table definitions under `database/schema/` and re-export them
from `index.ts` (replacing `export {};`). Default Better Auth table names need no `schema` mapping
in the adapter. Table defs live here (centralized for drizzle-kit), **not** in the auth slice.

#### 4. Generate + apply the migration

**File**: `apps/api/migrations/` (generated SQL), `apps/api/migrations/meta/_journal.json`

**Intent**: Emit the SQL for the new tables and let the boot-time runner apply it — one migration
history, one applier.

**Contract**: Run `npm run db:generate` (drizzle-kit reads `drizzle.config.ts` → `schema/index.ts`,
writes SQL into `apps/api/migrations/`). On next boot `MigrationService` applies it automatically.
Do **not** run `@better-auth/cli migrate` or `drizzle-kit migrate`.

#### 5. Auth instance provider

**File**: `apps/api/src/auth/providers/auth.provider.ts` (new)

**Intent**: Construct the singleton Better Auth instance on the shared DB connection and auth
config, exposed as an injectable provider for the controller and the global guard.

**Contract**: Provider token e.g. `AUTH_INSTANCE`; `useFactory` injects `DATABASE_CONNECTION` and
`authConfig.KEY`, returns
`betterAuth({ database: drizzleAdapter(db, { provider: 'sqlite' }), basePath: '/auth', baseURL: config.url, secret: config.secret, emailAndPassword: { enabled: true /* disableSignUp stays OFF — see deployment assumption */ }, session: { expiresIn: config.sessionExpiresIn, updateAge: config.sessionUpdateAge }, trustedOrigins: ['https://opspilot.example.com'] })`.
Export a type alias for the instance for typed injection. `basePath: '/auth'` + global `/api`
prefix ⇒ effective `/api/auth`.

#### 6. Auth slice (module + catch-all controller)

**File**: `apps/api/src/auth/auth.module.ts` (new), `apps/api/src/auth/auth.controller.ts` (new),
`apps/api/src/app/app.module.ts`

**Intent**: Mount the Better Auth node handler under the auth slice mirroring the `health/` slice
template; wire the module into `AppModule`.

**Contract**: `@Controller('auth')` with an `@All()` (or `@All('*')`) handler that forwards the raw
`req`/`res` to `toNodeHandler(auth)` from `better-auth/node` (inject `AUTH_INSTANCE`). `auth.module.ts`
provides + exports `AUTH_INSTANCE` and declares the controller. Add `AuthModule` to
`app.module.ts:11` imports. Controller stays thin (pass-through only).

#### 7. Raw body at bootstrap

**File**: `apps/api/src/main.ts`

**Intent**: Give Better Auth the unparsed request body.

**Contract**: Change `NestFactory.create(AppModule)` → `NestFactory.create(AppModule, { bodyParser: false })`.
Add a lowercase comment noting this is global and why. Leave `setGlobalPrefix('api')` unchanged.

#### 8. Deployment assumption documentation

**File**: `apps/api/src/auth/providers/auth.provider.ts` (comment) + `context/changes/account-auth-foundation/change.md` (Notes)

**Intent**: Make the load-bearing security dependency explicit so no future change silently turns
open signup into world-open registration (frame mandate).

**Contract**: Record, in a lowercase comment next to `emailAndPassword` and in `change.md` Notes:
"Cloudflare Access (allowed-emails policy + WARP) fronts the entire app and is the registration
gate; open in-app signup is safe only under that gate. `emailAndPassword.disableSignUp: true` is
the one-line lever if that assumption ever changes." No code behavior change.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx nx typecheck api` (or `npm run build:api`)
- Linting passes: `npx nx lint api`
- API builds: `npm run build:api`
- Migration files exist: generated SQL present under `apps/api/migrations/` and barrel re-exports the auth tables
- App boots without migration error: `npm run start:api` reaches "Application is running" (migrator applies auth tables)

#### Manual Verification:

- `POST /api/auth/sign-up` (email+password) creates a user and returns a session cookie — confirms no double `/api/api` prefix and raw body works
- `POST /api/auth/sign-in` with those credentials succeeds; `GET /api/auth/get-session` returns the session
- SQLite contains `user`/`session`/`account`/`verification` tables after boot
- Missing `BETTER_AUTH_SECRET` (or <32 chars) fails fast at boot with a Joi error

**Implementation Note**: After automated verification passes, pause for manual confirmation that
the auth handler round-trips before proceeding to Phase 2.

---

## Phase 2: Global Guard + Access Posture

### Overview

Add the `APP_GUARD` that validates the Better Auth session on every request and a `@Public()`
allowlist exempting `/api/auth/*` and `/api/health`. This implements the "unauthenticated reaches
no operational function" posture and is locked-by-default for any future endpoint.

### Changes Required:

#### 1. `@Public()` decorator

**File**: `apps/api/src/auth/public.decorator.ts` (new)

**Intent**: Mark routes/controllers that bypass the global session guard.

**Contract**: `SetMetadata`-based decorator exporting a metadata key (e.g. `IS_PUBLIC_KEY`) and a
`Public()` factory. One export concern per `nestjs.md` (decorator + key colocated is acceptable;
follow repo casing).

#### 2. Global auth guard

**File**: `apps/api/src/auth/auth.guard.ts` (new), `apps/api/src/app/app.module.ts`

**Intent**: Validate the session globally; allow `@Public()` routes through; return 401 otherwise.

**Contract**: `CanActivate` injecting `Reflector` + `AUTH_INSTANCE`. Reads the `IS_PUBLIC_KEY`
metadata (handler + class) first; if public, allow. Else call `auth.api.getSession({ headers })`
from the request; on a valid session attach it to the request and return `true`, otherwise throw
`UnauthorizedException` (401). Register as `{ provide: APP_GUARD, useClass: AuthAppGuard }` in
`app.module.ts` providers.

#### 3. Apply the allowlist

**File**: `apps/api/src/auth/auth.controller.ts`, `apps/api/src/health/health.controller.ts`

**Intent**: Exempt the public surfaces — the auth handler itself and the deploy healthcheck probe.

**Contract**: Add `@Public()` to the auth catch-all controller and to `HealthController` (the
Cloudflare/deploy healthcheck must stay anonymous — research Open Q5). Leave `AppController`
(`/api`) guarded (or `@Public()` only if intentionally kept open — default: guarded).

#### 4. Guard unit tests

**File**: `apps/api/src/auth/auth.guard.spec.ts` (new)

**Intent**: Lock the access posture with tests (the highest-risk behavior).

**Contract**: Vitest spec covering: public route allowed without session; non-public route with no
session → 401; non-public route with a valid session → allowed (mock `AUTH_INSTANCE.api.getSession`
and `Reflector`). Mirror the colocated `*.spec.ts` convention.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx nx typecheck api`
- Linting passes: `npx nx lint api`
- Guard unit tests pass: `npx nx test api`
- API builds: `npm run build:api`

#### Manual Verification:

- `GET /api/health` returns 200 without a session (allowlisted)
- `GET /api` (or any non-public endpoint) returns 401 without a session
- The same endpoint returns 200 with a valid session cookie
- `/api/auth/*` still works (not blocked by the guard)

**Implementation Note**: After automated verification passes, pause for manual confirmation that
the 401/200 boundary behaves correctly before proceeding.

---

## Phase 3: Shared Auth Contracts

### Overview

Define the Zod schemas our **own** forms and controllers validate — login/register request shapes
and a session/user response shape — in `@opspilot/shared`, following the established
schema→`z.infer`→barrel pattern. Do not duplicate Better Auth's internal endpoint contracts.

### Changes Required:

#### 1. Auth request/response schemas

**File**: `libs/shared/src/lib/schemas/auth-login-request.schema.ts`,
`auth-register-request.schema.ts`, `auth-user.schema.ts` (all new), `libs/shared/src/index.ts`

**Intent**: One source of truth for the shapes our login/register forms validate on the FE and our
boundary parses on the BE, plus the user/session shape the FE renders.

**Contract**: Each file exports one `z.strictObject` schema + its `z.infer` type, mirroring
`health-response.schema.ts`. Use Zod v4 syntax (`z.email()`, `error:` for messages — `zod.md`):
- `authLoginRequestSchema` — `{ email: z.email(...), password: z.string().min(...) }`
- `authRegisterRequestSchema` — login fields + `name` (and any field our register form adds)
- `authUserSchema` — the user shape the FE renders (`id`, `email`, `name`, timestamps as needed),
  derived from what Better Auth returns but owned by us as the render contract.

Re-export all from the barrel. Framework-agnostic (no `@nestjs/*`/`@angular/*`).

#### 2. Schema unit tests

**File**: colocated `*.spec.ts` for each schema

**Intent**: Validate the contract accepts valid payloads and rejects invalid ones.

**Contract**: `schema.parse(validInput)` succeeds; invalid email / short password / extra key
(strict) fail. Mirror existing schema specs.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx nx typecheck shared`
- Linting passes: `npx nx lint shared`
- Schema unit tests pass: `npx nx test shared`
- Barrel exports resolve: `import { authLoginRequestSchema } from '@opspilot/shared'` compiles in both apps

#### Manual Verification:

- The schemas describe exactly the fields our forms use (no missing/extra field vs the register UI planned in Phase 5)

---

## Phase 4: Web Styling Stack (Tailwind v4 + spartan/ng)

### Overview

Install and wire Tailwind v4 + spartan/ng so the login/register screens (Phase 5) are built on the
target styling stack rather than retrofitted later. This is the first consumer of the stack.

### Changes Required:

#### 1. Tailwind v4 install + PostCSS wiring

**File**: `package.json`, `apps/web/.postcssrc.json` (new), `apps/web/src/styles.scss`

**Intent**: Enable Tailwind v4 utilities across the web app via PostCSS (CSS-first config, no
`tailwind.config.js`).

**Contract**: Add `tailwindcss` + `@tailwindcss/postcss` to dependencies; create
`apps/web/.postcssrc.json` registering the `@tailwindcss/postcss` plugin; add `@import "tailwindcss";`
to `styles.scss` (per `tailwind.md`). Content detection is automatic — no `content: []` glob.

#### 2. spartan/ng init

**File**: `package.json`, spartan-generated helm files under `apps/web/src/app/`, design tokens in
`styles.scss` (or a theme CSS)

**Intent**: Make spartan helm primitives available so login/register use them instead of
hand-rolled inputs/buttons.

**Contract**: Add `@spartan-ng/brain` (+ helm CLI deps); run the spartan init generator once, then
add the primitives the auth screens need (`button`, `input`, `card`/`label` as applicable) via the
spartan CLI (`spartan.md` — do not copy snippets manually). Declare `@theme` tokens in CSS.

### Success Criteria:

#### Automated Verification:

- Web builds with Tailwind active: `npm run build:web`
- Linting passes: `npx nx lint web`
- `apps/web/.postcssrc.json` exists and references `@tailwindcss/postcss`
- `styles.scss` contains the Tailwind import; `package.json` lists `tailwindcss`, `@tailwindcss/postcss`, `@spartan-ng/*`

#### Manual Verification:

- A Tailwind utility class (e.g. `class="p-4 text-red-500"`) renders styled in the running app (`npm run start:web`)
- A generated spartan helm primitive renders correctly

---

## Phase 5: Web — Auth Client, Guard, Interceptor + Login/Register UI

### Overview

Wire `HttpClient` with the 401 interceptor, create the Better Auth client exposing session as a
signal (provided explicitly), add the functional route guard, and build OnPush login/register
screens on the Phase 4 stack with the Phase 3 contracts. Populate the route table with public
auth routes and a guarded feature placeholder.

### Changes Required:

#### 1. App config — HttpClient + interceptor

**File**: `apps/web/src/app/app.config.ts`

**Intent**: Provide `HttpClient` (fetch backend, same-origin) with the functional 401 interceptor.

**Contract**: Add `provideHttpClient(withInterceptors([authInterceptor]), withFetch())` to the
providers array (keep existing providers). No `provideZoneChangeDetection` (zoneless).

#### 2. Auth client (session signal)

**File**: `apps/web/src/app/auth/auth-client.ts` (new)

**Intent**: Single Better Auth client instance, same-origin, exposing session as a signal that
guard and interceptor share.

**Contract**: `createAuthClient({ baseURL: '/api' })`; expose the session as a `signal` (or a thin
service wrapping the client's session as a signal) **provided explicitly** (not `providedIn: 'root'`,
per `angular.md`) so login/register/guard/interceptor share one source of truth. Add `better-auth`
to `package.json` if not already present from Phase 1 (root dep covers both apps).

#### 3. Functional route guard

**File**: `apps/web/src/app/auth/auth.guard.ts` (new)

**Intent**: Redirect unauthenticated navigation to `/login`.

**Contract**: `CanActivateFn` using `inject()`; reads the session signal; returns `true` when
authenticated, otherwise a `UrlTree` redirect to `/login` (via `inject(Router).createUrlTree`).

#### 4. 401 interceptor

**File**: `apps/web/src/app/auth/auth.interceptor.ts` (new)

**Intent**: On any `401`, clear local session state and redirect to login so an expired session
never leaves the UI half-authenticated.

**Contract**: `HttpInterceptorFn`; on a `401` response, clear the session signal and navigate to
`/login`; rethrow/propagate the error otherwise.

#### 5. Login + register components

**File**: `apps/web/src/app/auth/login/` and `apps/web/src/app/auth/register/` (new)

**Intent**: Styled screens driving the auth client, validating with the shared schemas.

**Contract**: Standalone `OnPush` components (prefix `app`), reactive/signal forms whose validation
is driven by the Phase 3 shared schemas (no second FE-only validator — `contracts.md`). On submit,
call the auth client's `signIn`/`signUp`; on success update the session signal and navigate to the
guarded area; render errors. Built from spartan helm primitives + Tailwind utilities. Keep each
component within the ~150-line / single-responsibility threshold (`angular.md`).

#### 6. Route table

**File**: `apps/web/src/app/app.routes.ts`, `apps/web/src/app/app.html`

**Intent**: Public `/login` + `/register`, a guarded feature placeholder, lazy-loaded.

**Contract**: Populate `appRoutes`: `/login` + `/register` (public, `loadComponent`), a guarded
default/feature route with `canActivate: [authGuard]` (`loadComponent`), and a sensible default
redirect. Remove the scaffold `<app-nx-welcome>` from `app.html`, leaving `<router-outlet>`.

#### 7. Guard + interceptor unit tests

**File**: `apps/web/src/app/auth/auth.guard.spec.ts`, `auth.interceptor.spec.ts` (new)

**Intent**: Cover the two pieces of our own logic (not Better Auth internals).

**Contract**: Guard: authenticated → `true`; unauthenticated → `UrlTree` to `/login`. Interceptor:
`401` → session cleared + navigation to `/login`; non-401 passes through. Run via the Angular
builder test target.

### Success Criteria:

#### Automated Verification:

- Type checking / build passes: `npm run build:web`
- Linting passes: `npx nx lint web`
- Guard + interceptor unit tests pass: `npx nx test web`
- Module boundaries hold: no `apps/web` → `apps/api` import (eslint `@nx/enforce-module-boundaries`)
- Full build passes: `npm run build`

#### Manual Verification:

- Visiting a guarded route while logged out redirects to `/login`
- Registering a new account logs in and lands on the guarded area
- Logging in with valid credentials reaches the guarded area; invalid credentials show an error
- Forcing a `401` (e.g. clearing the session cookie then calling an API) redirects to `/login`
- Login/register screens are styled (Tailwind + spartan), responsive, and keyboard-accessible

**Implementation Note**: After automated verification passes, pause for manual confirmation of the
full register→login→guard→401 flow before considering F-02 complete.

---

## Testing Strategy

### Unit Tests:

- **Backend guard** (`apps/api`, vitest) — public bypass, no-session 401, valid-session allow.
- **Shared schemas** (`libs/shared`, vitest) — valid parse + invalid rejection (bad email, short
  password, strict extra key).
- **Web guard + interceptor** (`apps/web`, Angular builder) — redirect-when-unauthenticated;
  401 → clear + redirect.

### Integration Tests:

- None automated this slice (decision: unit-only). The register→login→session round-trip is
  covered by manual verification — see each phase's Manual Verification.

### Manual Testing Steps:

1. Boot api (`npm run start:api`); confirm migrator created the auth tables and the app listens.
2. `POST /api/auth/sign-up`, then `/api/auth/sign-in`, then `/api/auth/get-session` — confirm no
   double prefix and the session round-trips.
3. `GET /api` without a session → 401; `GET /api/health` → 200; with a session → 200.
4. `npm start` (web+api); register a new account → lands authenticated; reload → still in.
5. Log out / clear cookie → guarded route redirects to `/login`; a stale API call (401) redirects.
6. Confirm login/register screens render with Tailwind + spartan styling.

## Performance Considerations

Negligible for a homelab single-instance app. The guard adds one `getSession` lookup per request
against local SQLite (synchronous `better-sqlite3`) — well within budget. Keep web+api same-origin
to avoid any CORS preflight overhead.

## Migration Notes

The auth tables are applied by the existing boot-time `MigrationService` on next start — no manual
DB step. Because F-01's DB may already have a WAL backup-gate, the first boot after this change
will back up (per the runner's logic) then apply the new migration. No existing data to migrate
(no prior auth tables). Rollback = revert the migration file + schema barrel and restore from the
pre-migration backup the gate produced.

## References

- Frame brief: `context/changes/account-auth-foundation/frame.md`
- Research: `context/changes/account-auth-foundation/research.md`
- Rules: `.claude/rules/better-auth.md`, `drizzle.md`, `nestjs.md`, `angular.md`, `contracts.md`,
  `zod.md`, `tailwind.md`, `spartan.md`, `shared-library.md`
- Slice template: `apps/api/src/health/` (module/controller/service + colocated spec)
- Schema pattern: `libs/shared/src/lib/schemas/health-response.schema.ts`
- Migration runner: `apps/api/src/database/migration/migration.service.ts:24`
- DB connection token: `apps/api/src/database/providers/database-connection.provider.ts:11`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Backend — Better Auth Integration

#### Automated

- [x] 1.1 Type checking passes: `npx nx typecheck api` — 3291d7a
- [x] 1.2 Linting passes: `npx nx lint api` — 3291d7a
- [x] 1.3 API builds: `npm run build:api` — 3291d7a
- [x] 1.4 Migration files exist (generated SQL + barrel re-exports auth tables) — 3291d7a
- [x] 1.5 App boots without migration error (`npm run start:api`) — 3291d7a

#### Manual

- [x] 1.6 `POST /api/auth/sign-up` creates a user + returns a session cookie (no double prefix, raw body works) — 3291d7a
- [x] 1.7 `sign-in` + `get-session` round-trip succeeds — 3291d7a
- [x] 1.8 SQLite contains `user`/`session`/`account`/`verification` tables — 3291d7a
- [x] 1.9 Missing/short `BETTER_AUTH_SECRET` fails fast at boot (Joi) — 3291d7a

### Phase 2: Global Guard + Access Posture

#### Automated

- [x] 2.1 Type checking passes: `npx nx typecheck api` — 3bf70d1
- [x] 2.2 Linting passes: `npx nx lint api` — 3bf70d1
- [x] 2.3 Guard unit tests pass: `npx nx test api` — 3bf70d1
- [x] 2.4 API builds: `npm run build:api` — 3bf70d1

#### Manual

- [x] 2.5 `GET /api/health` returns 200 without a session — 3bf70d1
- [x] 2.6 Non-public endpoint returns 401 without a session — 3bf70d1
- [x] 2.7 Same endpoint returns 200 with a valid session — 3bf70d1
- [x] 2.8 `/api/auth/*` still works (not blocked by the guard) — 3bf70d1

### Phase 3: Shared Auth Contracts

#### Automated

- [x] 3.1 Type checking passes: `npx nx typecheck shared` — 6a3e747
- [x] 3.2 Linting passes: `npx nx lint shared` — 6a3e747
- [x] 3.3 Schema unit tests pass: `npx nx test shared` — 6a3e747
- [x] 3.4 Barrel exports resolve from `@opspilot/shared` in both apps — 6a3e747

#### Manual

- [x] 3.5 Schemas match exactly the fields the Phase 5 forms use — 6a3e747

### Phase 4: Web Styling Stack (Tailwind v4 + spartan/ng)

#### Automated

- [ ] 4.1 Web builds with Tailwind active: `npm run build:web`
- [ ] 4.2 Linting passes: `npx nx lint web`
- [ ] 4.3 `.postcssrc.json` exists referencing `@tailwindcss/postcss`
- [ ] 4.4 `styles.scss` imports Tailwind; deps listed in `package.json`

#### Manual

- [ ] 4.5 A Tailwind utility class renders styled in the running app
- [ ] 4.6 A generated spartan helm primitive renders correctly

### Phase 5: Web — Auth Client, Guard, Interceptor + Login/Register UI

#### Automated

- [ ] 5.1 Type checking / build passes: `npm run build:web`
- [ ] 5.2 Linting passes: `npx nx lint web`
- [ ] 5.3 Guard + interceptor unit tests pass: `npx nx test web`
- [ ] 5.4 Module boundaries hold (no web→api import)
- [ ] 5.5 Full build passes: `npm run build`

#### Manual

- [ ] 5.6 Guarded route while logged out redirects to `/login`
- [ ] 5.7 Registering logs in and lands on the guarded area
- [ ] 5.8 Valid login reaches guarded area; invalid shows an error
- [ ] 5.9 A forced `401` redirects to `/login`
- [ ] 5.10 Login/register screens are styled, responsive, keyboard-accessible
