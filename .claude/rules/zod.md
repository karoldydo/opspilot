---
paths:
  - libs/shared/**/*.ts
  - apps/web/**/*.ts
  - apps/api/**/*.ts
---
# Zod Conventions (v4)

The project runs **Zod v4** (version pinned in `@package.json`). Schemas are the `FE ↔ BE` contract source of truth and
live in `@opspilot/shared` - see `contracts.md` for the flow. This file is the version-pinned
syntax reference.

## Where schemas live

- Schema location and the single-source-of-truth / `z.infer` flow are owned by `contracts.md` -
  don't restate them here.
- One export per file; file names carry a role suffix (e.g. `scan-request.schema.ts`).

## v4 syntax (do not write v3 idioms)

- Top-level string formats, not method chains: `z.email()`, `z.url()`, `z.uuid()` -
  **not** `z.string().email()` (the chained form is deprecated in v4).
- Custom messages use `error`, not `message`: `z.string().min(1, { error: 'required' })`.
- `.refine()` no longer narrows types (no type-predicate inference) - add an explicit cast at
  the use site if you need narrowing.
- Use `z.looseObject({...})` instead of `.passthrough()` for objects that allow unknown keys;
  `z.strictObject({...})` for closed objects.
- Read validation issues from `error.issues` (the `.errors` alias is gone).

## Validation at the boundary

- Parse/validate untrusted input exactly **once**, at the boundary (`schema.parse(input)` or a
  `ZodValidationPipe`); afterwards work with the already-inferred type - do not re-parse the same
  payload repeatedly. Which side validates what is owned by `contracts.md`.

> Cross-app contract rules: see `contracts.md`. NestJS pipe wiring: see `nestjs.md`.
