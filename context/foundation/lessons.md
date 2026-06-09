# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Put operational tunables in the config layer, never as in-file `const`s

- **Context**: `apps/api` NestJS services — any operational tunable (retention count, limit, timeout, interval, threshold) about to be written as a module-level `const`.
- **Problem**: A baked-in literal needs a code edit + rebuild to change and sits outside the one place the project validates configuration (`nestjs.md`: "no `process.env` outside the config layer"); a later override can silently become `NaN` instead of failing at boot. Surfaced when `const BACKUP_RETENTION = 5` lived inside `migration/migration.service.ts`.
- **Rule**: Route operational tunables through `@nestjs/config` + Joi: add the var to `config/env.schema.ts` (typed in `EnvConfig`, bounded + defaulted in the Joi schema so a bad value fails fast at boot), surface it on the relevant `registerAs(...)` namespace in `config/*.config.ts` (coerce numerics with `Number(...)` — Joi writes defaults back to `process.env` as strings), then read it via the injected typed config (`this.config.<field>`) and add the field to any `.overrideProvider(<config>.KEY).useValue({ ... })` in specs.
- **Applies to**: plan, implement, impl-review

## Wire-level timestamps are ISO strings in shared Zod contracts — convert at the Better Auth client boundary

- **Context**: `libs/shared` Zod contracts that model entities Better Auth returns (e.g. `auth-user.schema.ts` `createdAt`/`updatedAt` as `z.iso.datetime()`) — and any `apps/web` code that validates the Better Auth client's session/user object against them.
- **Problem**: JSON has no date type, so a shared contract correctly types timestamps as ISO strings for the wire. But the Better Auth *client* (`authClient.getSession()`) deserializes those fields into `Date` objects. Validating the client's object directly with the ISO-string schema fails `strict`-parse on a `Date`, even though the contract and the server are both correct. A recurring Date↔ISO mismatch lurking at the client↔contract seam.
- **Rule**: Keep shared timestamp fields as `z.iso.datetime()` (wire truth). On the web side, validate the *raw HTTP response* against the schema, or serialize `Date → ISO` before `schema.parse(...)` — never feed the Better Auth client's already-deserialized object straight into an ISO-string schema. Mirror the same Date↔ISO conversion anywhere a client SDK hands back hydrated dates.
- **Applies to**: plan, implement, impl-review

## Inject NestJS dependencies with an explicit `@Inject(Class)` token — never rely on type-based DI

- **Context**: `apps/api` NestJS providers/services — any constructor dependency injected in a class that is exercised under Vitest (`@nx/vite`, esbuild transform).
- **Problem**: esbuild does not emit `design:paramtypes` decorator metadata, so type-only DI (`constructor(private readonly x: SomeService) {}`) resolves to `undefined` at runtime even though the module wiring is correct. Surfaced when `CredentialService` injected `CryptoService` by type and the spec threw `Cannot read properties of undefined (reading 'encrypt')`; every existing provider already uses explicit `@Inject(...)` tokens for this reason.
- **Rule**: Always inject dependencies with an explicit token — `@Inject(SomeService) private readonly x: SomeService` (or `@Inject(SOME_TOKEN)` for non-class providers); never depend on type-reflection-based DI in `apps/api`, because the test transform drops the metadata it needs.
- **Applies to**: implement, impl-review

## On Windows, `npx nx reset` before moving a folder if the Nx daemon locks it

- **Context**: Any skill that does `git mv`/`mv` on a directory inside the workspace on Windows — especially `/10x-archive` moving a change folder — when run shortly after `nx test`/`build`/`lint` (e.g. immediately after `/10x-impl-review`).
- **Problem**: The Nx daemon's file-watcher keeps an open handle on the workspace tree, so renaming/moving the folder fails with `Permission denied` — both `git mv` and the plain `mv` fallback. Hit while archiving `encrypted-credential-store` right after the test/build runs in `/10x-impl-review`; the move only succeeded after the daemon was stopped.
- **Rule**: On Windows, if a folder `git mv`/`mv` fails with `Permission denied`, run `npx nx reset` to stop the Nx daemon and release its watchers, then retry the move. When archiving immediately after `nx test`/`build`/`lint`, reset proactively before the move.
- **Applies to**: implement, impl-review
