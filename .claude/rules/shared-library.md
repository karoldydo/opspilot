---
paths:
  - libs/shared/**/*.ts
---
# Shared Library Conventions

`@opspilot/shared` (`libs/shared`, tag `scope:shared`) is consumed by BOTH apps - the Angular
`web` SPA and the NestJS `api` - through one `index.ts` barrel. Per Nx module boundaries,
`scope:shared` may depend only on `scope:shared`; it must never reach into `apps/`. Because the
single barrel feeds both apps, shared code must stay framework-agnostic - the canonical rule is
in [Framework Agnosticism](#framework-agnosticism-hard-rule) below.

## Import Path

- Always import via `@opspilot/shared` (never relative paths like `../../../libs/shared`).
- All public API must be exported through the `libs/shared/src/index.ts` barrel.

## What Belongs in Shared

- **Zod schemas & contracts** -- the `FE ↔ BE` contract; the flow is owned by `contracts.md`, v4
  syntax by `zod.md`.
- **Interfaces** -- API request/response shapes, domain models.
- **Types** -- utility types (e.g. `Nullable<T>`).
- **Enums** -- shared enumerations.
- **Constants** -- shared constant values.
- **Functions** -- deterministic utility functions (same input → same output, no I/O, no `@Injectable()`/constructor DI).

## What Does NOT Belong in Shared

- App-specific business logic (lives in the api vertical slices or web features).
- I/O of any kind -- `HttpClient`/`fetch`, SSH, filesystem, database access.
- **Drizzle runtime-inferred types** (e.g. `typeof table.$inferSelect`) -- Node/SQLite `db`-bound
  I/O artifacts; the boundary rule (api maps rows to a shared Zod contract before returning) is
  owned by `contracts.md`. See also `drizzle.md`.
- App-specific routing, navigation, or state management (stores).
- Anything importing `@angular/*` or `@nestjs/*` (see below).

## Framework Agnosticism (hard rule)

- Every file in `libs/shared` must be usable by both the Angular app and the NestJS server.
- **Never import from `@angular/*` or `@nestjs/*`** -- the single `index.ts` barrel feeds both
  apps, so a framework import leaks that framework into the other app's bundle.
- Keep code portable: never touch `document`/`window` or `node:` built-ins (`fs`, `path`, `crypto`)
  in shared code -- the `@angular/*`/`@nestjs/*` import ban above enforces the framework half of this.

## Naming

- Interfaces / Types / Enums: `PascalCase` (e.g. `Device`, `Nullable<T>`, `DeviceStatus`).
- Files: `kebab-case` with a role suffix (e.g. `device.interface.ts`, `scan-request.schema.ts`).
