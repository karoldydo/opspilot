---
paths:
  - libs/shared/**/*.ts
  - apps/web/**/*.ts
  - apps/api/**/*.ts
---

# `FE ↔ BE` Contracts (single source of truth)

This is the anchor rule for how data shapes flow across the monorepo. The other rule files
(`angular.md`, `nestjs.md`, `shared-library.md`, `zod.md`, `drizzle.md`, `better-auth.md`)
point here; do not restate the contract flow in them.

## Single source of truth

- Every request/response shape and every domain type is defined **once** as a Zod schema in
  `libs/shared` (`@opspilot/shared`). Both apps **consume** that schema - they never declare a
  parallel `interface`/`type` that mirrors a shape already living in shared.
- Before adding a type to `apps/web` or `apps/api`, check shared first. If a shape crosses the
  `FE ↔ BE` boundary (sent or received over `/api`), it belongs in shared, not in an app.
- Derive types from the schema with `z.infer<typeof schema>` - do not hand-maintain a separate
  type that can drift from the runtime validator.

## Direction of flow

- **`api`** - validate every inbound payload at the boundary (`schema.parse(...)` or a
  `ZodValidationPipe`); infer the DTO type with `z.infer`. See `zod.md` and `nestjs.md`.
- **`web`** - type API responses with `z.infer` of the same shared schema; drive Reactive /
  Signal Forms validation from that same schema (no second, FE-only validator). See `angular.md`.
- **`shared`** - holds schemas + pure types/functions only; **no I/O**, and **no `@angular/*` or
  `@nestjs/*` imports** (the single barrel feeds both apps). See `shared-library.md`.

## What does NOT cross the boundary into shared

- Drizzle runtime-inferred types (tied to the `db` instance) - they are Node/SQLite-bound I/O
  artifacts; the API maps them to a shared Zod contract before returning. See `drizzle.md`.
- App-specific business logic, routing/navigation, and state stores - these live in the api
  vertical slices or the web features, never in shared.

## Domain alignment (recommendation)

- The binding rule is the **contract**, not the folder layout: the api code and the web code for
  one domain consume the **same** schema from `@opspilot/shared`.
- Where both apps implement the same domain, keeping their feature names parallel makes that
  shared contract easy to trace. Structure *within* each app follows that framework's own
  conventions (see `angular.md` / `nestjs.md`); `context/foundation/roadmap.md` is a domain map
  for orientation, not a folder-naming scheme.

## Enforcement

- Imports go through the `@opspilot/shared` path alias (never `../../../libs/shared`).
- `@nx/enforce-module-boundaries` (scope tags `scope:shared` / `scope:api` / `scope:web` in
`eslint.config.mjs`) makes crossing the `api ↔ web` line a lint error. See `CLAUDE.md`.
