---
paths:
  - apps/api/**/*.ts
---
# NestJS Development Guidelines

The backend stack is **NestJS 11 + Drizzle ORM over SQLite (WAL) + Better Auth + Zod**, with node-ssh behind an executor abstraction, async-mutex for per-device concurrency, and SSE for live agent narration. There is **no** MongoDB/Mongoose, Redis, class-validator, or custom JWT/bcrypt layer - do not introduce them.

This file is **NestJS framework rules only**. The individual technologies have their own rules:
data access → `drizzle.md`, auth → `better-auth.md`, validation/contracts → `zod.md` +
`contracts.md`, remote execution → `node-ssh.md`, agent layer → `vercel-ai-sdk.md`, live
streams → `sse.md`. Don't restate those here.

## General

- Prefer strict typing: always declare types, avoid `any` (prefer `unknown`). Strict compiler options are the target - do not lean on the current loose config.
- Naming: files in `kebab-case`, constants in `UPPER_SNAKE_CASE` - neither is lint-enforced, so verify casing in PR review (standard TS casing otherwise).
- Do not prefix methods with `on`; name them after the action they perform (e.g., `pageChange()` not `onPageChange()`).
- One export per file.

## Structure

- **Recommendation (not enforced):** prefer **feature modules** (Nest's idiomatic structure) - cohesion per domain over a layer-by-type topology (avoid `collections/`/`iam/`/`redis/` god-folders).
- Keep cross-cutting concerns (db, auth, config, ssh-executor) as their own shared modules, not feature modules.
- Contract sharing across apps (the `@opspilot/shared` alias, single source of truth) is owned by `contracts.md`; don't restate it here.
- Keep controllers thin - handle only HTTP/SSE concerns (`@Get`, `@Post`, `@Patch`, `@Delete`, `@Param`, `@Query`, `@Body`, `@Sse`); delegate all logic to services.
- Inject shared dependencies (the Drizzle connection, config, the SSH executor) as **providers** exported from a dedicated module - never construct them ad-hoc inside a service.

## Validation

- Validate all incoming data with **Zod** at the boundary - a `ZodValidationPipe` or explicit `schema.parse(...)` in the controller. The contract flow (shared `FE ↔ BE`, `z.infer` DTOs) is owned by `contracts.md`; v4 syntax by `zod.md`.
- Do not use `class-validator` or `@nestjs/mapped-types` - they are not part of this stack.

## Data access, auth, execution, agent

These are owned by their own rule files - follow them, don't duplicate them here:

- **Drizzle + SQLite** → `drizzle.md`
- **Better Auth** (flat model, no RBAC) → `better-auth.md`
- **node-ssh executor + async-mutex** → `node-ssh.md`
- **Vercel AI SDK agent layer** → `vercel-ai-sdk.md`
- **SSE narration** (server side) → `sse.md`

## Config

- Centralize configuration access: read environment through a single `@Global()` config module/provider rather than scattering `process.env` across services; inject the typed config where needed. Do not assume `@nestjs/config` unless it has been added to the stack.

## Errors & async

- Throw NestJS HTTP exceptions from services, not controllers. Messages must name the entity and its identifier - e.g. `throw new NotFoundException(\`device ${id} not found\`)`, never a bare `'not found'`.
- Shape cross-cutting errors in **one global exception filter** (`@Catch`, registered via `app.useGlobalFilters(...)` or an `APP_FILTER` provider) that returns a consistent error body (status, message, timestamp) - don't format error responses ad-hoc per controller.
- Use `Promise.all()` for independent async operations; for per-device SSH work, serialize commands with async-mutex (see `node-ssh.md`).
