# Data persistence + shared validation scaffold — Implementation Plan

## Overview

Wire the first real persistence layer for opspilot: a single app-scoped Drizzle/SQLite (WAL)
connection, a migration runner that self-applies on boot behind a backup gate, a `@Global()`
config provider that reads the environment once, and the first FE↔BE contract scaffold in
`@opspilot/shared` (an error envelope + a health-response schema + a reusable `ZodValidationPipe`).
A thin `/api/health` endpoint pings the DB and returns the shared `HealthResponse`, proving the
whole stack — shared schema → api → db — is wired end to end.

This is foundation **F-01** from `context/foundation/roadmap.md`. It deliberately defines **no
domain tables**: every later slice (F-02 auth, F-03 credential store, S-01…S-09) adds its own
tables on top of the connection + migration tooling laid down here.

## Current State Analysis

- **Data layer is entirely unwired.** `drizzle-orm@^0.45`, `better-sqlite3@^12`,
  `drizzle-kit@^0.31`, `zod@^4.4`, and `@types/better-sqlite3` are already in `package.json`
  (`package.json:35-41,74,82`), but there is no schema, no migration, no connection, and no
  `drizzle.config.*` anywhere (`Glob` confirmed). `libs/shared/src/lib/shared.ts:1` is a dummy
  `shared()` stub; `libs/shared/src/index.ts:1` re-exports only that.
- **No config/env layer.** `apps/api/src/main.ts:15` reads `process.env.PORT` inline. There is no
  `@Global()` config module — `nestjs.md` mandates one.
- **The api is a webpack bundle.** `apps/api/webpack.config.js` uses `NxAppWebpackPlugin`
  (`target: 'node'`, `generatePackageJson: true`, `assets: ['./src/assets']`) and emits
  `dist/apps/api/main.js`. `better-sqlite3` / `drizzle-orm` get externalized into the generated
  `package.json` once imported. The runtime image copies **only** `main.js` + prod `node_modules`
  + `workspace_modules` (`Dockerfile:47-49`) — it does **not** copy the rest of `dist/apps/api/`,
    so any migration files must be copied in explicitly.
- **The data path is already provisioned in infra.** `context/deployment/compose.yaml:21-23`
  bind-mounts `/volume1/docker/opspilot/data:/data` (local btrfs, never a network share);
  `Dockerfile:59` creates `/data`; node runs on `PORT=3000` (`Dockerfile:63`). This satisfies the
  hard WAL constraint from `drizzle.md` / `infrastructure.md` (SQLite file on a **local** disk).
- **The healthcheck already hits `/api/`.** `compose.yaml:30` probes
  `http://127.0.0.1:8080/api/`, which nginx (`docker/nginx.conf:40`) proxies to `127.0.0.1:3000`
  and which the scaffold `AppController` (`apps/api/src/app/app.controller.ts:9-12`) answers with
  hello-world. nginx is already SSE-safe (`proxy_buffering off`, long timeouts).
- **Two test runners coexist.** `apps/api/vitest.config.mts` + `libs/shared/vitest.config.mts`
  are plain Vitest; web uses the Angular builder. F-01 touches only the first two.
- **Registry/lessons docs are absent.** `docs/reference/contract-surfaces.md` and
  `context/foundation/lessons.md` do not exist yet, though `CLAUDE.md` references the former as the
  "load-bearing names registry."

## Desired End State

After this plan:

1. `npx nx serve api` opens a single WAL-mode SQLite connection at the configured path, runs the
   (currently empty) migration set on boot behind a backup gate, and serves.
2. `GET /api/health` returns `200` with a body matching the shared `HealthResponse` schema, with a
   live DB ping (`SELECT 1`) confirming the connection.
3. `@opspilot/shared` exports `apiErrorSchema` / `ApiError` and `healthResponseSchema` /
   `HealthResponse`, consumed by `api` via `z.infer` — no parallel interface in either app.
4. A reusable `ZodValidationPipe` exists in `api`, ready for the first inbound payload in F-02.
5. The migration pipeline (config → `drizzle.config.ts` → `migrations/` → runtime `migrate()`) is
   wired and packaged into the container image; the first real migration arrives with F-02's first
   table.
6. `npx nx test api` and `npx nx test shared` pass, including a DB-integration test (connection +
   WAL pragma + `migrate()` + `/api/health`).

**Verification:** `npx nx build api && npx nx build web` succeed; `npx nx run-many -t test lint`
green; serving the api and curling `/api/health` returns the schema-valid body.

### Key Discoveries:

- The runtime image copies only `dist/apps/api/main.js` (`Dockerfile:47-49`) — migrations must be
  emitted as a webpack asset AND added to the Dockerfile COPY, then resolved at runtime relative
  to the bundle.
- `drizzle.md`: `better-sqlite3` is **synchronous** — no `await` on the driver; expose the
  `drizzle(...)` instance as a single injectable provider, never per-call connections.
- `contracts.md` / `drizzle.md`: Drizzle `$inferSelect` types are Node/DB-bound and must **not**
  leak into `@opspilot/shared`; the api maps rows to a shared Zod contract before returning.
- `zod.md`: this is **Zod v4** — use top-level formats (`z.iso.datetime()`, not
  `z.string().datetime()`), `error` not `message`, `z.strictObject(...)`.
- `infrastructure.md` risk register: SQLite migrations have **no auto-rollback** — "back up the DB
  before applying migrations" is the reason for the backup gate.

## What We're NOT Doing

- **No domain tables** — no auth, device, service, skill, run, or audit tables. Schema folder is
  established empty; the first table lands in F-02.
- **No auth / Better Auth / guards** (F-02), **no credential encryption** (F-03).
- **No global exception filter** — only the error-envelope *schema* + the `ZodValidationPipe`.
  The filter that emits that shape lands when there's an error surface to shape (F-02+).
- **No SSE, no agent, no node-ssh** — later slices.
- **No web/Angular feature work** — the contract is proven consumable by being framework-agnostic
  and consumed by `api`; no FE screen is added.
- **No compose.yaml healthcheck change** — the host artifact keeps probing `/api/`; pointing it at
  `/api/health` is an optional later host-side edit.
- **No CI migration step** — migrations self-apply at container boot; no pipeline change.

## Implementation Approach

Build bottom-up in dependency order: the framework-agnostic shared scaffold first (no
dependencies), then the config + connection providers, then the migration runner that consumes the
connection, then the consuming surface (`ZodValidationPipe` + `/api/health`) that needs both DB and
shared. Each phase is independently testable and leaves the tree green.

Cross-cutting concerns (`config`, `database`) are their own `@Global()` modules under
`apps/api/src/`, not feature modules — per `nestjs.md`. All cross-boundary shapes live once in
`@opspilot/shared` and are consumed via `z.infer` — per `contracts.md`.

## Critical Implementation Details

- **Empty migrations journal.** With zero tables, `drizzle-kit generate` produces no migration
  files, but `drizzle-orm`'s `migrate()` throws if the migrations folder has no
  `meta/_journal.json`. Seed a valid empty journal
  (`{"version":"7","dialect":"sqlite","entries":[]}` plus an empty `meta/` dir) so the boot-time
  `migrate()` is a clean no-op until F-02 adds the first real migration.
- **Migration timing & packaging.** Run `migrate()` once on application bootstrap
  (`onApplicationBootstrap` in the database module) — after the connection provider is constructed,
  before the server accepts traffic — preceded by the backup gate. Resolve `migrationsFolder` from
  a path relative to the compiled bundle (`__dirname`), because in the container the migrations
  live next to `main.js`, not at the repo path. The folder reaches the image via a webpack asset
  entry **and** an explicit Dockerfile COPY (`dist/apps/api/migrations` → `/app/migrations`).
- **Backup gate.** Before `migrate()`, if the DB file already exists, snapshot it to a timestamped
  sibling (e.g. `<db>.<timestamp>.bak`) and log the path; skip silently on first run when no file
  exists. Because the connection is already open in **WAL** mode at this point, a plain
  `fs.copyFile` of the main `.db` can miss data still in the `-wal` sidecar — use better-sqlite3's
  WAL-aware online backup (`db.backup('<db>.<timestamp>.bak')`, which returns a Promise the runner
  must await) to get a consistent single-file snapshot. This is the at-rest safety net for the
  no-auto-rollback constraint.
- **WAL on a real file only.** WAL/backup behaviour can't be exercised against `:memory:`;
  integration tests must point at a temp-file DB (OS temp dir) to assert the `journal_mode=wal`
  pragma and the backup copy.

## Phase 1: Shared validation scaffold

### Overview

Establish the FE↔BE contract pattern in `@opspilot/shared`: a `schemas/` folder, the first two
schemas (error envelope + health response), the barrel wiring, and the contract-surfaces registry.
No api/web dependency — this phase stands alone.

### Changes Required:

#### 1. Error-envelope schema

**File**: `libs/shared/src/lib/schemas/api-error.schema.ts`

**Intent**: Define the canonical error-response shape every later slice's error filter will emit,
so the FE has one schema to type error bodies against. One export per file (`shared-library.md`).

**Contract**: `apiErrorSchema = z.strictObject({ status: z.number().int(), message: z.string(),
timestamp: z.iso.datetime() })`; export `type ApiError = z.infer<typeof apiErrorSchema>`. Zod v4
syntax (`zod.md`): `z.strictObject`, `z.iso.datetime()`.

#### 2. Health-response schema

**File**: `libs/shared/src/lib/schemas/health-response.schema.ts`

**Intent**: Type the `/api/health` readiness body — overall status plus the DB-connection signal —
as the shared contract the endpoint returns and tests assert against.

**Contract**: `healthResponseSchema = z.strictObject({ status: z.enum(['ok', 'error']), db:
z.enum(['up', 'down']), timestamp: z.iso.datetime() })`; export `type HealthResponse = z.infer<typeof
healthResponseSchema>`. `status` reflects readiness (`'ok'` when `db: 'up'`, `'error'` when
`db: 'down'`) so a probe can act on it — see Phase 4.

#### 3. Barrel exports + remove stub

**File**: `libs/shared/src/index.ts`, `libs/shared/src/lib/shared.ts`

**Intent**: Export the two new schemas + inferred types through the single barrel and drop the
dummy `shared()` stub so the public surface is the real contract.

**Contract**: `index.ts` re-exports `./lib/schemas/api-error.schema` and
`./lib/schemas/health-response.schema`; delete `shared.ts` (or replace its content) and remove its
re-export. Imports elsewhere use the `@opspilot/shared` alias only.

#### 4. Contract-surfaces registry

**File**: `docs/reference/contract-surfaces.md` (new)

**Intent**: Seed the load-bearing names registry `CLAUDE.md` references, recording the first two
cross-boundary contract names and where they live.

**Contract**: A markdown table with rows for `apiErrorSchema` / `ApiError` and
`healthResponseSchema` / `HealthResponse`, each naming the file path and the consuming side(s).

#### 5. Shared unit tests

**File**: `libs/shared/src/lib/schemas/api-error.schema.spec.ts`,
`libs/shared/src/lib/schemas/health-response.schema.spec.ts`

**Intent**: Prove each schema parses a valid object and rejects an invalid one (round-trip), so the
contract has test coverage from the start.

**Contract**: Vitest specs asserting `.parse(valid)` succeeds and `.safeParse(invalid).success`
is `false`, reading issues via `error.issues` (`zod.md`).

### Success Criteria:

#### Automated Verification:

- Shared unit tests pass: `npx nx test shared`
- Lint passes: `npx nx lint shared`
- Type checking / build passes: `npx nx build shared`
- Module-boundary lint clean (no `@angular/*` / `@nestjs/*` in shared)

#### Manual Verification:

- `docs/reference/contract-surfaces.md` lists both contract names with correct paths
- Both schemas are importable via `@opspilot/shared` (no relative-path imports)

**Implementation Note**: After completing this phase and all automated verification passes, pause
for manual confirmation before proceeding.

---

## Phase 2: Config + Database module

### Overview

Add the `@Global()` config provider (env read once) and the `@Global()` database module exposing a
single Drizzle/better-sqlite3 connection with the WAL pragma. Wire both into `AppModule`. Add the
`drizzle.config.ts` and gitignore the local data dir.

### Changes Required:

#### 1. Config module

**File**: `apps/api/src/config/config.module.ts`, `apps/api/src/config/config.service.ts`
(or a config provider token)

**Intent**: Centralize env access in one `@Global()` module so no service reads `process.env`
directly (`nestjs.md`). Exposes the resolved DB path and port.

**Contract**: Reads `DATABASE_PATH` (default `/data/opspilot.db`; dev fallback
`./data/opspilot.db`) and `PORT` once at construction; exposes typed getters. `@Global()` so any
module injects it without re-importing. No Zod env validation in this slice.

#### 2. Database module + Drizzle provider

**File**: `apps/api/src/database/database.module.ts`,
`apps/api/src/database/database.providers.ts` (provider + injection token),
`apps/api/src/database/schema/index.ts` (empty schema barrel)

**Intent**: Construct one app-scoped `better-sqlite3` connection with WAL enabled and expose the
`drizzle(...)` instance as a single injectable provider (`drizzle.md`). `@Global()` so every later
feature module injects the same connection.

**Contract**: A `DATABASE` injection token resolving to `drizzle(new Database(configPath), {
schema })`. On the raw `better-sqlite3` handle set `pragma('journal_mode = WAL')` and
`pragma('foreign_keys = ON')` before handing it to `drizzle`. `schema/index.ts` starts empty (no
tables) and is the import target for `drizzle.config.ts`. Connection is synchronous — no `await`
on the driver.

#### 3. Wire into AppModule

**File**: `apps/api/src/app/app.module.ts`

**Intent**: Import `ConfigModule` and `DatabaseModule` so the connection is available app-wide.

**Contract**: Add both to `AppModule.imports`. Existing `AppController`/`AppService` stay.

#### 4. drizzle-kit config

**File**: `apps/api/drizzle.config.ts`

**Intent**: Configure `drizzle-kit` for SQLite so `generate`/`migrate` target the right schema and
output folder — the tooling later slices use to add tables.

**Contract**: `dialect: 'sqlite'`, `schema: './src/database/schema/index.ts'`,
`out: './migrations'`, `dbCredentials.url` from the same env/default the runtime uses.

#### 5. Gitignore local data

**File**: `.gitignore`

**Intent**: Keep the dev SQLite file, WAL/SHM sidecars, and `.bak` backups out of git.

**Contract**: Add `data/`, `*.db`, `*.db-wal`, `*.db-shm`, `*.bak`.

#### 6. DB integration test

**File**: `apps/api/src/database/database.module.spec.ts`

**Intent**: Prove the connection opens against a temp-file DB, the WAL pragma is set, and a trivial
query runs — the connection contract every later slice depends on.

**Contract**: Boot the provider against a temp-dir DB path; assert
`pragma('journal_mode', { simple: true }) === 'wal'` and that `SELECT 1` returns `1`. **Temp-DB
seam**: build the testing module with `Test.createTestingModule(...).overrideProvider(ConfigService)`
returning an `os.tmpdir()`-based path (do not let the default `./data/opspilot.db` be opened in CI);
clean up the temp file + `-wal`/`-shm` sidecars in `afterEach`.

### Success Criteria:

#### Automated Verification:

- api tests pass: `npx nx test api`
- Lint passes: `npx nx lint api`
- api builds: `npx nx build api`
- `drizzle.config.ts` is valid: `npx drizzle-kit generate` runs without error (produces no
  migration, since there are no tables)

#### Manual Verification:

- `npx nx serve api` boots and creates `./data/opspilot.db` (+ `-wal` sidecar) in dev
- No `process.env` reads remain outside the config module (except `main.ts` bootstrap if needed)

**Implementation Note**: Pause for manual confirmation after automated verification passes.

---

## Phase 3: Migration runner + backup gate + packaging

### Overview

Run `migrate()` on application bootstrap behind a backup gate, seed the empty migrations journal so
the no-op is clean, and package the migrations folder into the runtime container image.

### Changes Required:

#### 1. Seed empty migrations journal

**File**: `apps/api/migrations/meta/_journal.json` (new)

**Intent**: Give `migrate()` a valid empty journal to read so it no-ops instead of throwing when
there are zero migrations (see Critical Implementation Details).

**Contract**: `{ "version": "7", "dialect": "sqlite", "entries": [] }` plus the `meta/` directory.
Matches the format `drizzle-kit` will append to once F-02 generates the first migration.

#### 2. Migration runner + backup gate

**File**: `apps/api/src/database/migration.service.ts` (or a runner invoked from
`DatabaseModule`)

**Intent**: On bootstrap, back up an existing DB file then apply migrations, so a forward-only
SQLite DB always has a pre-migration snapshot (`infrastructure.md` no-rollback risk).

**Contract**: Implement `onApplicationBootstrap`: if the DB file exists, snapshot it via
`await db.backup('<db>.<timestamp>.bak')` (WAL-aware online backup on the raw better-sqlite3 handle,
not `fs.copyFile` — the connection is already open in WAL) and log the path; then call
`migrate(db, { migrationsFolder })` from `drizzle-orm/better-sqlite3/migrator`, with
`migrationsFolder` resolved relative to `__dirname` (bundle-relative), falling back to the repo
`migrations/` path in dev. Runs after the connection provider, before `app.listen()`.

#### 3. Emit migrations as a webpack asset

**File**: `apps/api/webpack.config.js`

**Intent**: Make the build copy `migrations/` into `dist/apps/api/` so the runtime bundle can find
it.

**Contract**: Add the migrations folder to the `NxAppWebpackPlugin` `assets` array using the
explicit object form — `{ input: 'migrations', output: 'migrations', glob: '**/*' }` — so it lands
deterministically at `dist/apps/api/migrations` (a bare `'./migrations'` string sits in the project
root, not under `src/`, and may not map as expected). Step 3.2 (`test -d dist/apps/api/migrations`)
verifies the output path.

#### 4. Copy migrations into the runtime image

**File**: `Dockerfile`

**Intent**: The runtime stage copies only `main.js` today; add the migrations folder so boot-time
`migrate()` finds it in the container.

**Contract**: Add `COPY --from=builder /workspace/dist/apps/api/migrations ./migrations` in the
runtime stage (next to the existing `main.js` COPY at `Dockerfile:48`), landing at
`/app/migrations` — the bundle-relative path the runner resolves.

#### 5. Migration runner test

**File**: `apps/api/src/database/migration.service.spec.ts`

**Intent**: Prove `migrate()` runs clean against the empty journal and that the backup copy is
created when a DB file pre-exists.

**Contract**: Against a temp-dir DB: (a) `migrate()` with the empty-journal folder completes
without throwing; (b) when a DB file already exists, after bootstrap a `*.bak` sibling exists.

### Success Criteria:

#### Automated Verification:

- api tests pass incl. migration test: `npx nx test api`
- api builds and emits migrations asset: `npx nx build api` then
  `test -d dist/apps/api/migrations`
- Lint passes: `npx nx lint api`

#### Manual Verification:

- `npx nx serve api` logs a clean migration run (no-op) on first boot
- On a second boot with an existing dev DB, a `*.bak` file is created and logged
- `docker build .` succeeds and the runtime image contains `/app/migrations`

**Implementation Note**: Pause for manual confirmation after automated verification passes.

---

## Phase 4: ZodValidationPipe + /api/health

### Overview

Add the reusable `ZodValidationPipe` (the boundary mechanism F-02+ will use) and a thin
`/api/health` endpoint that pings the DB and returns the shared `HealthResponse` — the end-to-end
proof that shared → api → db are wired.

### Changes Required:

#### 1. Reusable ZodValidationPipe

**File**: `apps/api/src/common/zod-validation.pipe.ts`

**Intent**: Provide one pipe that validates inbound payloads against a shared Zod schema at the
boundary, so every later slice parses untrusted input exactly once (`zod.md`, `contracts.md`). No
consumer in F-01 — staged for F-02.

**Contract**: A `PipeTransform` constructed with a `ZodType`; `transform()` calls
`schema.parse(value)` and throws a `BadRequestException` shaped from `error.issues` on failure.
Infers the DTO type via `z.infer` at the use site.

#### 2. Health service (DB ping)

**File**: `apps/api/src/health/health.service.ts`

**Intent**: Keep the DB-readiness logic in a service (thin controller rule, `nestjs.md`): run
`SELECT 1` against the injected connection and build the `HealthResponse`.

**Contract**: Injects the `DATABASE` token; runs `SELECT 1`; returns a `HealthResponse`
(`@opspilot/shared`) — `{ status: 'ok', db: 'up' }` on success, `{ status: 'error', db: 'down' }`
on a caught driver error. The controller maps that to the HTTP status (see below).

#### 3. Health controller + module

**File**: `apps/api/src/health/health.controller.ts`, `apps/api/src/health/health.module.ts`

**Intent**: Expose `GET /api/health` as a pass-through controller delegating to the service, and
register the module in `AppModule`.

**Contract**: `@Get('health')` returning the service result typed as `HealthResponse`. When the
service reports `db: 'down'`, the controller responds `503` (e.g. set the code via `@Res({
passthrough: true })` / `HttpException`) while still returning the schema-valid body; `200` when
`db: 'up'`. Global prefix `api` makes the route `/api/health`. Add `HealthModule` to
`AppModule.imports`.

#### 4. Health integration test

**File**: `apps/api/src/health/health.controller.spec.ts`

**Intent**: Prove `/api/health` returns a schema-valid body with `db: 'up'` against a live temp
DB — the end-to-end wiring assertion.

**Contract**: Via the Nest testing module with the real `DatabaseModule`, using the same temp-DB
seam as the database spec (`overrideProvider(ConfigService)` → `os.tmpdir()` path, sidecar cleanup
in `afterEach`), call the handler and assert `healthResponseSchema.parse(result)` succeeds and
`result.status === 'ok'` / `result.db === 'up'`.

#### 5. ZodValidationPipe unit test

**File**: `apps/api/src/common/zod-validation.pipe.spec.ts`

**Intent**: Prove the pipe passes a valid payload through and throws `BadRequestException` (shaped
from `error.issues`) on an invalid one — coverage from day one even though no F-01 route consumes
it yet.

**Contract**: Construct the pipe with a trivial `ZodType`; assert `transform(valid)` returns the
parsed value and `transform(invalid)` throws `BadRequestException`.

### Success Criteria:

#### Automated Verification:

- api tests pass incl. health + ZodValidationPipe tests: `npx nx test api`
- Lint passes: `npx nx lint api`
- api builds: `npx nx build api`
- Full workspace green: `npx nx run-many -t test lint`

#### Manual Verification:

- `npx nx serve api` then `GET http://localhost:3000/api/health` returns `200` with
  `{ status: 'ok', db: 'up', timestamp: ... }`
- The `db: 'down'` branch is exercised by simulating a failed `SELECT 1` on a live connection
  (close the handle / mock the driver to throw in a test) — not by an unwritable path at boot,
  since the connection opens during bootstrap and an unwritable path crashes startup before
  `/api/health` is reachable. The handler returns `503` + `{ status: 'error', db: 'down' }`.
- The compose healthcheck (`/api/`) still returns `200` (unchanged)

**Implementation Note**: Pause for manual confirmation after automated verification passes.

---

## Testing Strategy

### Unit Tests:

- `apiErrorSchema` / `healthResponseSchema`: valid parse + invalid reject (round-trip), reading
  `error.issues` (Phase 1).
- `ZodValidationPipe`: passes a valid payload, throws `BadRequestException` on an invalid one
  (Phase 4).

### Integration Tests:

- DB connection opens against a temp-file DB, `journal_mode=wal` pragma set, `SELECT 1` returns
  `1` (Phase 2).
- `migrate()` runs clean against the empty journal; backup `*.bak` created when a DB file
  pre-exists (Phase 3).
- `/api/health` returns a schema-valid `HealthResponse` with `db: 'up'` against a live temp DB
  (Phase 4).

### Manual Testing Steps:

1. `npx nx serve api`; confirm `./data/opspilot.db` (+ `-wal`) is created and a clean migration
   no-op is logged.
2. `curl http://localhost:3000/api/health` → `200`, body matches `HealthResponse`.
3. Re-serve with an existing dev DB; confirm a timestamped `*.bak` is written and logged.
4. `docker build .`; confirm `/app/migrations` is present in the runtime image.

## Performance Considerations

Negligible at this scale. `better-sqlite3` is synchronous and in-process; the only per-request cost
is the `SELECT 1` on `/api/health`. WAL is enabled for read/write concurrency under later load.

## Migration Notes

Migrations are forward-only on a stateful SQLite file and self-apply at container boot. The backup
gate writes a pre-migration snapshot so a bad forward migration is recoverable by restoring the
`*.bak` and pinning the prior image digest (`infrastructure.md` rollback story). Rotating the DB
path or destructive SQLite operations stay human-only.

## References

- Roadmap item: `context/foundation/roadmap.md` (F-01)
- Infra constraints (local-disk WAL, no-rollback backup): `context/foundation/infrastructure.md`
- Rules: `.claude/rules/drizzle.md`, `zod.md`, `contracts.md`, `shared-library.md`, `nestjs.md`
- Data path already provisioned: `context/deployment/compose.yaml:21-30`, `Dockerfile:47-63`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not
> rename step titles. See `references/progress-format.md`.

### Phase 1: Shared validation scaffold

#### Automated

- [x] 1.1 Shared unit tests pass: `npx nx test shared` — b9841b5
- [x] 1.2 Lint passes: `npx nx lint shared` — b9841b5
- [x] 1.3 Type checking / build passes: `npx nx build shared` — b9841b5
- [x] 1.4 Module-boundary lint clean (no `@angular/*` / `@nestjs/*` in shared) — b9841b5

#### Manual

- [x] 1.5 `docs/reference/contract-surfaces.md` lists both contract names with correct paths — b9841b5
- [x] 1.6 Both schemas importable via `@opspilot/shared` (no relative-path imports) — b9841b5

### Phase 2: Config + Database module

#### Automated

- [x] 2.1 api tests pass: `npx nx test api` — 26f46d4
- [x] 2.2 Lint passes: `npx nx lint api` — 26f46d4
- [x] 2.3 api builds: `npx nx build api` — 26f46d4
- [x] 2.4 `npx drizzle-kit generate` runs without error (no migration produced) — 26f46d4

#### Manual

- [x] 2.5 `npx nx serve api` boots and creates `./data/opspilot.db` (+ `-wal`) in dev — 26f46d4
- [x] 2.6 No `process.env` reads remain outside the config module (except `main.ts` bootstrap) — 26f46d4

### Phase 3: Migration runner + backup gate + packaging

#### Automated

- [x] 3.1 api tests pass incl. migration test: `npx nx test api` — 31cb80f
- [x] 3.2 api builds and emits migrations asset: `npx nx build api` then `test -d dist/apps/api/migrations` — 31cb80f
- [x] 3.3 Lint passes: `npx nx lint api` — 31cb80f

#### Manual

- [x] 3.4 `npx nx serve api` logs a clean migration no-op on first boot — 31cb80f
- [x] 3.5 Second boot with an existing dev DB creates and logs a `*.bak` file — 31cb80f
- [x] 3.6 `docker build .` succeeds and the runtime image contains `/app/migrations` — 31cb80f

### Phase 4: ZodValidationPipe + /api/health

#### Automated

- [x] 4.1 api tests pass incl. health + ZodValidationPipe tests: `npx nx test api` — 0b8b63c
- [x] 4.2 Lint passes: `npx nx lint api` — 0b8b63c
- [x] 4.3 api builds: `npx nx build api` — 0b8b63c
- [x] 4.4 Full workspace green: `npx nx run-many -t test lint` — 0b8b63c

#### Manual

- [x] 4.5 `GET /api/health` returns `200` with `{ status: 'ok', db: 'up', timestamp }` — 0b8b63c
- [x] 4.6 `db: 'down'` branch exercised by a simulated failed `SELECT 1` (closed handle / mocked driver), returning `503` + `{ status: 'error', db: 'down' }` — 0b8b63c
- [x] 4.7 The compose healthcheck (`/api/`) still returns `200` (unchanged) — 0b8b63c
