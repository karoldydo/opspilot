# Contract surfaces registry

The load-bearing names registry referenced by `CLAUDE.md`. Every cross-boundary
(`FE ↔ BE`) contract is a Zod schema defined **once** in `@opspilot/shared` and consumed via
`z.infer` — see `.claude/rules/contracts.md`. This table records each contract name, where it
lives, and which side(s) consume it.

| Schema                 | Inferred type    | File                                                    | Consumed by            |
|------------------------|------------------|---------------------------------------------------------|------------------------|
| `apiErrorSchema`       | `ApiError`       | `libs/shared/src/lib/schemas/api-error.schema.ts`       | `api`, `web` (planned) |
| `healthResponseSchema` | `HealthResponse` | `libs/shared/src/lib/schemas/health-response.schema.ts` | `api` (`/api/health`)  |
