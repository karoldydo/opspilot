---
paths:
  - apps/api/**/*.ts
---
# Drizzle ORM + SQLite

Data access is **Drizzle ORM over SQLite (WAL) via `better-sqlite3`** - synchronous, no
Mongoose/Prisma rituals.

## Schema & migrations

- Define tables and relations in `*.schema.ts` files using `drizzle-orm/sqlite-core`.
- Manage schema changes with **drizzle-kit** migrations - never mutate the live DB by hand.
- Index every column used in a `where`/`order by` of a list endpoint; paginate every list query
  with `.limit()`/`.offset()` (no unbounded scans).

## Connection & DI

- Expose the `drizzle(...)` instance as a single injectable provider (one connection,
  app-scoped) and inject it into services; do not construct ad-hoc connections per call.
- `better-sqlite3` is **synchronous** - there is no `.exec()`/`.lean()`/`await` ceremony on the
  driver; queries return directly.

## Storage constraints

- Keep the SQLite file on a **local** disk - WAL file locking corrupts over network mounts.

## Type boundary

- Drizzle runtime-inferred types (e.g. `typeof table.$inferSelect`) are **Node/DB-bound** - they
  must **not** leak into `@opspilot/shared`. Map rows to a shared Zod contract before returning
  them over `/api`. See `contracts.md` and `shared-library.md`.
