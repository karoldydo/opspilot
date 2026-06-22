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

## Compute-then-write invariants belong in one transaction, not two statements

- **Context**: `apps/api` Drizzle/better-sqlite3 services that derive a column value from a count/read of the table and then insert/update based on it — e.g. the auto-active-first ("the first row is active") in `llm-provider.service.ts:create`.
- **Problem**: A `select(...).length === 0` read followed by a separate `insert(...)` is two statements with a gap between them. Two concurrent creates can both observe an empty table and both write `active: true`, breaking an app-enforced single-active invariant that has no DB-level partial-unique-index to catch the double-write. Synchronous better-sqlite3 hides it within one request, but an `await` before the read (e.g. the test-call probe) reopens the window.
- **Rule**: When a write's value is computed from a read of the same table to maintain an invariant, wrap the read and the write in one `this.db.transaction((tx) => { ... })` and run both through `tx`. The activation path already does this (unset-all + set-one); the create path must too.
- **Applies to**: implement, impl-review

## Never list containers with `docker ps --format '{{json .}}'` / `-s` unless you need size

- **Context**: `apps/api` skills that list containers over SSH (e.g. `SCAN_COMMAND` in `service.service.ts`), and any future `docker ps` listing run through the executor's bounded command timeout.
- **Problem**: `{{json .}}` marshals the whole container struct, which makes the docker CLI enable layer-size computation (`SizeRw`/`SizeRootFs`) — identical to passing `-s`. On slow storage (Synology NAS) the daemon walks every container's layers for ~27 s, brushing the 30 s SSH command timeout, so scan times out intermittently. Isolated empirically: `docker ps -s` with a trivial format = 27 s; every single field (`{{.Names}}`, `{{.Status}}`, `{{.Labels}}`, …) = 0.02 s; an explicit-field JSON without `.Size` = 0.02 s.
- **Rule**: Never use `docker ps --format '{{json .}}'` or `-s` for listing unless size is actually needed — build the result from explicit fields (`{{.Names}}`, `{{.Image}}`, `{{.State}}`, `{{.Status}}`, `{{.Labels}}`), because whole-struct json (and `-s`) forces the expensive per-container layer-size walk.
- **Applies to**: plan, implement, impl-review

## Never read a required input in the constructor — load from a named `effect()`

- **Context**: Angular components (`apps/web`) that load data depending on an `input.required()` value — an init-time fetch that needs the required input (e.g. `deviceId`).
- **Problem**: Reading a required input in the constructor throws `NG0950` (inputs aren't bound yet), and an empty `catch` around `load()` swallows it silently — no fetch, no data, clean console. In `ServiceSkillsComponent` this hid the missing per-service skill buttons on `/devices` for months with no trace; contrast `DeviceServicesComponent`, which loads from an `effect()` and works.
- **Rule**: Never read `input.required()` (or trigger an input-dependent load) from the constructor — do it from a named `effect()` field that reads the input after binding (mirror `DeviceServicesComponent`). A `catch` around a fetch must not silently swallow programming errors — log/surface them.
- **Applies to**: all
