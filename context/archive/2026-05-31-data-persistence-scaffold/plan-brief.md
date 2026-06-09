# Data persistence + shared validation scaffold — Plan Brief

> Full plan: `context/changes/data-persistence-scaffold/plan.md`

## What & Why

Wire opspilot's first persistence layer: a single Drizzle/SQLite (WAL) connection, a boot-time
migration runner behind a backup gate, a `@Global()` config provider, and the first FE↔BE contract
scaffold in `@opspilot/shared`. This is foundation **F-01** — the root of every later chain
(F-02 auth, F-03 credential store, S-01…S-09). Everything that reads or writes state depends on
this connection + migration tooling existing.

## Starting Point

The data layer is entirely unwired: `drizzle-orm`, `better-sqlite3`, `drizzle-kit`, `zod` are in
`package.json` but there is no schema, migration, connection, or `drizzle.config`. `libs/shared` is
a dummy `shared()` stub. The infra is ahead of the code — `compose.yaml` already bind-mounts a
local-disk `/data` volume and the healthcheck probes `/api/`.

## Desired End State

`nx serve api` opens a WAL SQLite connection at the configured path, self-applies migrations on
boot (after backing up any existing DB file), and serves `GET /api/health`, which pings the DB and
returns a schema-valid `HealthResponse`. `@opspilot/shared` exports the first two contracts
(error envelope + health response) plus a reusable `ZodValidationPipe`, all consumed by `api` via
`z.infer`. No domain tables exist yet.

## Key Decisions Made

| Decision                  | Choice                                                  | Why (1 sentence)                                                                  | Source |
|---------------------------|---------------------------------------------------------|-----------------------------------------------------------------------------------|--------|
| Migration execution       | Auto-migrate at boot **+ backup gate**                  | Zero-touch self-host deploy, but snapshot the DB first (SQLite has no rollback).  | Plan   |
| Seed table                | **Zero tables** — tooling + `SELECT 1` only             | Stays true to "no domain tables yet"; first real migration arrives in F-02.       | Plan   |
| Validation scaffold scope | Barrel + error-envelope + `ZodValidationPipe`           | Makes the FE↔BE contract usable day one; no global filter (no error surface yet). | Plan   |
| Health endpoint           | New `/api/health` with DB ping + shared schema          | Real readiness + a vertical proof shared→api→db is wired end to end.              | Plan   |
| Config / env              | `@Global()` ConfigModule, env read once                 | Satisfies `nestjs.md`; `DATABASE_PATH` defaults `/data/opspilot.db` (prod).       | Plan   |
| Structure                 | Dedicated `database/` + `config/` cross-cutting modules | `nestjs.md`: db/config are their own `@Global()` modules, not feature modules.    | Plan   |
| Names registry            | Seed `docs/reference/contract-surfaces.md`              | Start the load-bearing registry the moment the first cross-boundary names exist.  | Plan   |
| Testing                   | api integration + shared unit                           | Prove connection + WAL + `migrate()` + `/api/health`; round-trip parse shared.    | Plan   |

## Scope

**In scope:** shared error-envelope + health-response schemas + barrel; `@Global()` config module;
`@Global()` database module (WAL connection, Drizzle provider, empty schema folder);
`drizzle.config.ts`; boot-time migration runner + backup gate + empty journal; migrations packaged
into the container image; `ZodValidationPipe`; `/api/health`; contract-surfaces registry; tests.

**Out of scope:** domain tables, auth/Better Auth, credential encryption, global exception filter,
SSE/agent/node-ssh, web feature work, compose healthcheck change, CI migration step.

## Architecture / Approach

Bottom-up in dependency order: framework-agnostic shared scaffold → config + connection providers →
boot-time migration runner consuming the connection → consuming surface (`ZodValidationPipe` +
`/api/health`). `config` and `database` are `@Global()` modules under `apps/api/src/`. All
cross-boundary shapes live once in `@opspilot/shared`, consumed via `z.infer`. The migration folder
is emitted as a webpack asset and copied into the runtime image; `migrate()` resolves it
bundle-relative.

## Phases at a Glance

| Phase              | What it delivers                            | Key risk                                                                                                                   |
|--------------------|---------------------------------------------|----------------------------------------------------------------------------------------------------------------------------|
| 1. Shared scaffold | Two schemas + barrel + registry + tests     | Zod v4 syntax drift (use top-level formats, `z.strictObject`).                                                             |
| 2. Config + DB     | `@Global()` config + WAL Drizzle provider   | WAL pragma must be set on a real file, not `:memory:`.                                                                     |
| 3. Migrations      | Boot runner + backup gate + image packaging | `migrate()` throws on a folder with no `meta/_journal.json` — seed an empty one. Migrations must be COPYed into the image. |
| 4. Surface         | `ZodValidationPipe` + `/api/health`         | Pipe has no consumer yet (staged for F-02).                                                                                |

**Prerequisites:** none — F-01 is the root item; all deps (`drizzle-orm`, `better-sqlite3`,
`drizzle-kit`, `zod`) are already in `package.json`.
**Estimated effort:** ~1–2 sessions across 4 phases.

## Open Risks & Assumptions

- **Zero tables + auto-migrate**: `migrate()` is wired but no-ops until F-02; the empty-journal
  seed is what keeps the no-op from throwing.
- **Packaging**: migrations must reach the runtime image via both a webpack asset and a Dockerfile
  COPY; the runner resolves the folder bundle-relative (`__dirname`), with a repo-path dev
  fallback.
- **Backup gate** mitigates the no-auto-rollback SQLite risk but does not auto-restore — recovery
  is restore-`.bak` + pin prior image digest.

## Success Criteria (Summary)

- `nx serve api` boots, creates the WAL DB, runs a clean migration no-op, and serves.
- `GET /api/health` returns `200` with a schema-valid `{ status: 'ok', db: 'up', timestamp }`.
- `nx run-many -t test lint` green, including the DB-integration and shared-schema tests.
