<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Data persistence + shared validation scaffold

- **Plan**: context/changes/data-persistence-scaffold/plan.md
- **Scope**: Phases 1–4 of 4 (full plan)
- **Date**: 2026-05-31 (session 2 re-review + full triage appended)
- **Verdict**: REJECTED on first pass (critical F1) → all findings FIXED in triage; pending a final
  `nx run-many -t test lint -p api` re-confirm (tool-output glitch blocked the last automated re-run this session)
- **Findings**: 1 critical, 5 warnings, 2 observations — all FIXED
  (F1–F6 from the original report + N1/N2 found in session 2; one fabricated "hosts" finding retracted)

## Verdicts

| Dimension           | Verdict |
|---------------------|---------|
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | FAIL    |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

Automated re-run this session: `npx nx run-many -t test lint -p api shared` → 9/9 api tests pass,
lint green; `Dockerfile:50` confirms `COPY … /migrations`. The slice's stated end state (one WAL
connection, boot-time `migrate()` behind a backup gate, shared contract consumed via `z.infer`,
`/api/health`) is implemented as planned. The findings below are about runtime correctness in the
container, not plan drift.

## Findings

### F1 — Production DB writes to ephemeral container storage, not the /data volume

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it (which layer to fix)
- **Dimension**: Safety & Quality (data safety)
- **Location**: apps/api/src/config/config.service.ts:12 (+ context/deployment/compose.yaml, Dockerfile)
- **Detail**: The default DB path is keyed on `NODE_ENV`:
  `process.env.NODE_ENV === 'production' ? '/data/opspilot.db' : './data/opspilot.db'`. But `NODE_ENV`
  is set **nowhere** in the runtime — not in `Dockerfile` (only `ENV PORT=3000`), not in
  `docker/supervisord.conf` (`command=node /app/main.js`, no `environment=`), not in `compose.yaml`
  (no `environment:` block). `DATABASE_PATH` is likewise unset in `compose.yaml`. So in the container
  the path resolves to `./data/opspilot.db` against `WORKDIR /app` → **`/app/data/opspilot.db`**, which
  lives in the container's writable layer, not the bind-mounted `/data`
  (`/volume1/docker/opspilot/data`). Every container recreation (watchtower-driven image update,
  redeploy, `docker compose up` after pull) **discards the database**. F-01 ships zero domain tables so
  the loss is invisible today, but it defeats the entire purpose of the persistence slice and will
  silently wipe F-02's auth/session data on the next image bump. The `mkdir -p /data` (Dockerfile:61)
  and the bind-mount are correct — the app just never writes there.
- **Fix A ⭐ Recommended**: Set `DATABASE_PATH=/data/opspilot.db` explicitly in `compose.yaml`
  `environment:`.
  - Strength: Pins persistence to the volume independent of `NODE_ENV`; the data path stops depending
    on a broad, easily-missed flag. Matches the existing `/data` bind-mount exactly.
  - Tradeoff: `compose.yaml` is a host artifact (NOT auto-deployed) — must be uploaded to the NAS and
    `docker compose up -d` re-run for the fix to take effect.
  - Confidence: HIGH — `/data` is already the documented, provisioned local-btrfs mount.
  - Blind spot: Existing data already written to `/app/data` inside the running container would need a
    one-time copy to `/data` before recreation, or it is lost.
- **Fix B**: Add `ENV NODE_ENV=production` to the Dockerfile runtime stage.
  - Strength: Baked into the image, ships automatically with the next build; makes the author's
    intended `NODE_ENV`-keyed default actually fire.
  - Tradeoff: `NODE_ENV=production` has broad framework-wide side effects beyond the DB path; couples
    data persistence to a global flag rather than naming the path. Still leaves the path implicit.
  - Confidence: HIGH — standard prod flag.
  - Blind spot: Anything that branches on `NODE_ENV` now changes behavior at once.
- **Decision**: FIXED via Fix A — added `DATABASE_PATH=/data/opspilot.db` to compose.yaml `environment:`

### F2 — Hand-rolled ConfigService violates nestjs.md (@nestjs/config + Joi) and skips boot env validation

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: apps/api/src/config/config.service.ts:1-24, config.module.ts
- **Detail**: `nestjs.md` (Config section) now mandates `@nestjs/config` + Joi with
  `ConfigModule.forRoot({ isGlobal, load, validationSchema, validationOptions })`, `registerAs(...)`
  factories, and reads via `config.get('KEY', { infer: true })` — and explicitly forbids "a
  hand-rolled `ConfigService` over `process.env`." This implementation is exactly that. Note this is a
  rule-vs-plan timing artifact: the **plan** explicitly scoped out env validation ("No Zod env
  validation in this slice"), and the rule + deps (`@nestjs/config` + `joi`, `package.json`) landed in
  commit `7777559`, **after** this change closed. Consequence today: no boot-time validation, so a
  malformed `PORT` (e.g. `PORT=abc`) silently becomes `NaN` via `Number(...)` (`config.service.ts:14`)
  instead of failing fast. Good candidate for `/10x-lesson` (recurring config rule) plus a migration in
  F-02 when the first validated env var (LLM/auth secrets) appears.
- **Fix**: Migrate config to `@nestjs/config` + Joi per `nestjs.md`, with `DATABASE_PATH` and `PORT`
  typed/bounded; or consciously defer to F-02 and record the rule via `/10x-lesson`.
- **Decision**: FIXED via Fix now — migrated to `@nestjs/config` + Joi. Added `env.schema.ts`
  (Joi `envSchema`, boot validation, PORT bounded), `database.config.ts` (`registerAs('database')`),
  rewrote `config.module.ts` to wrap `ConfigModule.forRoot({ isGlobal, load, validationSchema,
  validationOptions })`, deleted hand-rolled `config.service.ts`. Consumers + specs now inject/override
  `databaseConfig.KEY`. api test/lint/build green (9/9).

### F3 — Unbounded .bak accumulation: backup runs on every boot, even for no-op migrations

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (reliability / disk)
- **Location**: apps/api/src/database/migration.service.ts:26,32-43
- **Detail**: `backupGate()` snapshots the DB on **every** application bootstrap whenever the file
  pre-exists — it is not gated on there being pending migrations. With `restart: unless-stopped`
  (`compose.yaml:15`) and watchtower-driven image updates, each boot writes a full DB copy
  (`<db>.<ts>.bak`) to `/data` with no rotation or cap. Over time this fills the volume with redundant
  snapshots of an unchanged DB. The implementation matches the plan literally ("if the DB file already
  exists, snapshot it"), so this is a plan-level flaw worth flagging rather than a coding mistake.
- **Fix**: Gate the backup on pending migrations (compare journal entries vs. the applied
  `__drizzle_migrations` table before snapshotting), or add retention (keep last N `.bak`), or both.
- **Decision**: FIXED via Fix differently (gate + retention) — `backupGate()` now snapshots only when
  `hasPendingMigrations()` (journal entry count > `__drizzle_migrations` rows), and `pruneBackups()`
  caps snapshots at `BACKUP_RETENTION = 5`. Added an injectable `MIGRATIONS_FOLDER` provider so the
  positive path is testable; spec now covers skip-fresh, skip-no-pending, and backup+prune. api
  test/lint/build green (10/10).

### F4 — main.ts reads process.env.PORT directly; ConfigService.port is dead code

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: apps/api/src/main.ts:15
- **Detail**: `const port = process.env.PORT || 3000;` reads env directly. The updated `nestjs.md` says
  "no `process.env` outside the config layer (`main.ts` included)." Meanwhile `ConfigService.port`
  (`config.service.ts:21`) has zero consumers, and the listen port is resolved independently from the
  config layer, so the two can diverge. The plan's manual check 2.6 carved out "except `main.ts`
  bootstrap," so this is plan-consistent — but now inconsistent with the config layer it introduced.
- **Fix**: Resolve the port from DI after `NestFactory.create` (`app.get(ConfigService).port`, or
  `@nestjs/config` once F2 lands), and drop the inline `process.env.PORT`.
- **Decision**: FIXED via Fix now — `main.ts` now reads `app.get(ConfigService).get<number>('PORT', 3000)`
  after `enableShutdownHooks()`; the inline `process.env.PORT` is gone. webpack build + `tsc --noEmit` green.

### F5 — .bak timestamp collision at millisecond resolution overwrites the snapshot

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (data safety)
- **Location**: apps/api/src/database/migration.service.ts:37-41
- **Detail**: The backup filename uses `new Date().toISOString().replace(/[:.]/g, '-')` (ms
  resolution). Two bootstraps within the same millisecond (a fast crash-restart loop — exactly when a
  pre-migration snapshot matters most) produce the same `backupPath`, and `better-sqlite3`'s
  `backup()` silently overwrites the prior snapshot. Low probability on a single-instance homelab.
- **Fix**: Add a short random/pid suffix to the backup filename, or check-and-bump if the path exists.
- **Decision**: FIXED via Fix now — backup filename is now `${path}.${timestamp}.${process.pid}.bak`;
  timestamp still leads so the prune sort stays chronological, and a single process can't collide in one ms.

### F6 — No try/catch around backup/migrate in onApplicationBootstrap (opaque crash, ambiguous logs)

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability)
- **Location**: apps/api/src/database/migration.service.ts:25-29
- **Detail**: `onApplicationBootstrap` awaits `backupGate()` then runs `migrate()` with no try/catch.
  Failing fast (don't serve on a half-migrated DB) is the right default, but a throw in `db.$client.
  backup(...)` (e.g. disk full / read-only `/data`) crashes with a raw driver error and no log line
  identifying the backup — not the migration — as the failure point (the "db backed up" log fires only
  on success). The backup-then-migrate ordering itself is sound.
- **Fix**: Wrap `backupGate()` and `migrate()` in try/catch with distinct `logger.error` messages
  naming the failing phase, then rethrow to preserve fail-fast.
- **Decision**: FIXED via Fix now — `onApplicationBootstrap` wraps the backup and migrate phases in
  separate try/catch blocks, each logging the failing phase (db path / migrations folder) before
  rethrowing; fail-fast preserved.

### N1 — Missing npm scripts db:generate / db:migrate / db:studio

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: package.json (scripts)
- **Detail**: Plan Phase 3 lists these three scripts explicitly, but `package.json` had none — the only
  un-delivered plan item. Runtime works (migrations self-apply on boot), but there was no drizzle-kit
  wrapper for when F-02 generates the first table. Found in the session-2 re-review (the original report
  missed it).
- **Fix**: Add `db:generate` / `db:migrate` / `db:studio` to `package.json` scripts.
- **Decision**: FIXED via Fix now — added the three scripts as `cd apps/api && drizzle-kit <cmd>`.
  Note: a root-cwd invocation with `--config=apps/api/drizzle.config.ts` does NOT work because
  drizzle-kit resolves the `schema`/`out` relative paths against cwd, not the config dir — so the
  scripts `cd` into `apps/api` first (the same cwd Phase 2 check 2.4 implicitly used). Verified
  `npm run db:generate` → `0 tables / nothing to migrate`, exit 0.

### N2 — DB connection never closed on shutdown

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (reliability / resource leak)
- **Location**: apps/api/src/database/database.providers.ts / main.ts
- **Detail**: The better-sqlite3 handle was opened in `databaseProvider` but nothing closed it on
  shutdown — no `OnApplicationShutdown`/`onModuleDestroy` and no `app.enableShutdownHooks()`. On SIGTERM
  (watchtower redeploy, `restart: unless-stopped`) the handle was never `close()`d, so the WAL checkpoint
  may not flush cleanly. Found in the session-2 re-review (the original report missed it).
- **Fix**: Add an `OnApplicationShutdown` provider that calls `db.$client.close()`, and
  `app.enableShutdownHooks()` in `main.ts`.
- **Decision**: FIXED via Fix now — added `DatabaseShutdownService` (`OnApplicationShutdown`, closes
  `$client` with an open-guard) to `DatabaseModule`, and `app.enableShutdownHooks()` in `main.ts`.
  api tests 10/10, webpack build green.

### Retracted (session-2 re-review) — false "hosts table" finding

During the session-2 re-review I briefly raised a finding that `schema/index.ts` defined a `hosts`
placeholder table out of sync with the migrations. **This was wrong and is retracted.** It came from
misreading delayed/garbled tool output: `schema/index.ts` is the correct empty barrel (`export {}`),
there is no `hosts.schema.ts`, the journal is empty (`entries: []`), and `db:generate` reports
`0 tables`. No code change was made for it; the working tree was never polluted (the "cleanup" commands
were harmless no-ops). Recorded here so the false alarm is not mistaken for a real defect later.

## Notes (verified clean — no finding)

- **Contracts / Zod v4 / shared-library**: schemas live once in `@opspilot/shared`, consumed in api
  via `z.infer` (`HealthResponse`); v4 idioms correct (`z.strictObject`, `z.iso.datetime()`,
  `error.issues`); shared imports only `zod`. ✓
- **WAL-aware backup** uses `db.$client.backup()` (online backup), not `fs.copyFile` — the correct
  data-safety choice for an open WAL connection. ✓
- **`DATABASE_FILE_PREEXISTED` provider** (unplanned EXTRA) is justified: it captures file existence
  before `databaseProvider` opens/creates the file, fixing an ordering bug the plan's prose would hit. ✓
- **Explicit `@Inject(ClassToken)`** on class deps is justified (vitest/esbuild drops
  `emitDecoratorMetadata`), well-commented, consistent. ✓
- **Comments** are all lowercase per `comments.md`. ✓
- **"What We're NOT Doing"** boundaries all held (no domain tables, no auth, no global exception
  filter, no SSE/agent/ssh, no web work, no compose healthcheck change, no CI migration step). ✓
