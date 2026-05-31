---
paths:
  - apps/api/**/*.spec.ts
---
# NestJS Testing

Runner is **Vitest** with `globals: true` (`apps/api/vitest.config.mts`) - use `describe`/`it`/`expect`/`vi` without importing them, and `vi.fn()`/`vi.spyOn()` (never `jest.*`).

## Convention

- `<name>.spec.ts` co-located next to the source; one spec per service/controller.
- Arrange-Act-Assert; name variables `inputX` / `mockX` / `actualX` / `expectedX`.

## Structure & mocking

- Build the DI graph with `Test.createTestingModule(...).compile()` from `@nestjs/testing`; for a plain class with no DI just `new Controller(new Service())`.
- Swap dependencies via `.overrideProvider(TOKEN).useValue(...)` (or `.useClass`/`.useFactory`) - fake the things this stack actually injects: `ConfigService`, the Drizzle connection (its provider token, e.g. `DATABASE`), Better Auth, and the SSH executor (`IExecutor`). No Mongoose/`getModelToken`, Redis, or JWT here.
- Better Auth guards every endpoint (`better-auth.md`), so a controller spec must let the request through with `.overrideGuard(AuthGuard).useValue({ canActivate: () => true })`.

## Integration (real SQLite)

- Point the DB at a temp file (`join(tmpdir(), ...)`) - never let the default `./data/opspilot.db` open in CI.
- Teardown: close `db.$client`, `await moduleRef.close()`, and remove the file plus its `-wal`/`-shm` sidecars.

## E2E

- Boot with `createNestApplication()` + `await app.init()`, then drive `supertest` via `request(app.getHttpServer())`; assert HTTP method, status, and body. Set up/tear down the test DB per suite, and `await app.close()` after.

## Guidelines

- Test services and controllers separately; cover error cases (not found, validation, unauthorized).
- Test behavior, not implementation details; mock external deps to keep tests fast.
