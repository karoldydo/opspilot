---
date: 2026-06-16T23:33:00+02:00
researcher: Karol Dydo
git_commit: bb3ff99e2f82a256ef0c2d8210bdbf7614ef964e
branch: main
repository: karoldydo/opspilot
topic: "Phase 3 security guardrails — secret leakage (#4), per-device skill confinement (#3), auth boundary (#5)"
tags: [research, codebase, security, crypto, credential, skill, auth, audit]
status: complete
last_updated: 2026-06-16
last_updated_by: Karol Dydo
---

# Research: Phase 3 Security Guardrails

**Date**: 2026-06-16T23:33:00+02:00
**Researcher**: Karol Dydo
**Git Commit**: bb3ff99e2f82a256ef0c2d8210bdbf7614ef964e
**Branch**: main
**Repository**: karoldydo/opspilot

## Research Question

Ground the three security-guardrail risks from `context/foundation/test-plan.md` §2 in the live
codebase so Phase 3 (integration / contract tests on a real temp DB) can be planned:

- **#4 — secret leakage**: prove a stored credential is ciphertext on disk, the encrypt→store→decrypt
  round-trip recovers the plaintext, and the secret never appears in the audit transcript, a response
  body, or an error body.
- **#3 — agent guardrail / per-device skill confinement**: prove the agent's tool-set on device D is
  exactly the skills scoped to D (a skill not scoped to D is never callable, **including custom
  skills**), and a skill parameter substitutes as an argument, not as injectable shell.
- **#5 — auth boundary**: prove every operational endpoint returns 401 without a valid session.

## Summary

All three guardrails are **already implemented and structurally sound** — Phase 3 is largely
*characterization + regression-pinning* of existing behavior, plus closing two specific holes, not
net-new feature coverage. The key findings that reshape the plan:

1. **Risk #5 — the guard is GLOBAL (`APP_GUARD` + `AuthAppGuard`), not per-route.** There are **zero**
   `@UseGuards` in production code. New endpoints are locked by default; the real failure mode is the
   *inverse* — an accidental `@Public()`. The test must invert: sweep route metadata and fail if any
   controller other than `AuthController`/`HealthController` carries `isPublic`. **Gap:** the existing
   `*.controller.spec.ts` deliberately strip the global guard, so **no spec asserts unauth→401 over
   the wire** today — Phase 3 must wire the real `AuthAppGuard` back in.

2. **Risk #3 — there is NO LLM "tool-set assembly" layer.** Free-form agent chat is a roadmap
   non-goal; the guardrail is a **runtime scope filter on the skill-run HTTP path**
   (`SkillRunService.requireInScope` → `SkillService.findForDevice`). Default and custom skills flow
   through the **identical** `deviceId` predicate (`isNull(deviceId) OR deviceId = D`), so the S-08
   "do custom skills get filtered too?" question resolves to **yes, the filter is source-agnostic**.
   Parameter injection is defended by a **charset whitelist** (`skillParameterValueSchema`), *not*
   shell-quoting — "constrain the alphabet, not escape the string."

3. **Risk #4 — a real temp-file SQLite harness already exists and already asserts persisted
   ciphertext + secret-free transcript** (`credential.service.spec.ts`). Crypto is AES-256-GCM with
   three separate columns (`ciphertext`/`iv`/`auth_tag`). Read/response contracts are
   `z.strictObject` that omit secrets, so a leaked secret-bearing key is a *parse failure*. The one
   open response surface is the skill-run result message returning raw remote stdout/stderr.

## Detailed Findings

### Risk #5 — Auth boundary (GLOBAL guard)

**Guard attachment — global, not per-route.** `AuthAppGuard` is registered once as an `APP_GUARD`
provider in `app.module.ts:32`; the class lives at `core/auth/auth.guard.ts:16` (`canActivate` at
`:22`). `grep` for `@UseGuards` across `apps/api/src` (outside specs) is **empty** — a dropped guard
on a new endpoint is structurally impossible. The only failure mode is an accidental `@Public()`.

**Public exemptions — exactly two, both class-level `@Public()`:**

| Public surface | File:line | Routes |
|---|---|---|
| `AuthController` (Better Auth handler) | `core/auth/auth.controller.ts:8` `@Public()`, `:13` `@All('*splat')` | every `/api/auth/*` |
| `HealthController` | `core/health/health.controller.ts:8` `@Public()`, `:13` `@Get()` | `GET /api/health` |

The `@Public()` decorator + `IS_PUBLIC_KEY = 'isPublic'` is at `common/decorators/public.decorator.ts:3,5`;
the guard checks it first via `reflector.getAllAndOverride` and short-circuits before any session
lookup (`auth.guard.ts:24-30`).

**Operational endpoints (the 401 sweep list)** — all under global prefix `/api` (`main.ts:12-13`),
all guarded:

- `DeviceController` `modules/device/device.controller.ts:14` — `POST/GET /devices`, `GET/PATCH/DELETE /devices/:id` (`:18,26,31,36,45`)
- `DeviceCredentialController` `modules/device/credential/device-credential.controller.ts:26` — `POST/GET/DELETE` (`:33,46,57`)
- `ServiceController` `modules/service/service.controller.ts:30` — `POST scan`, `GET/POST services`, `PATCH/DELETE services/:serviceId` (`:34,39,44,57,67`)
- `DiagnoseController` `modules/diagnose/diagnose.controller.ts:16` — `GET diagnose/runs` (`:22`), `@Sse('diagnose/stream')` (`:40`)
- `SkillRunController` `modules/skill/skill-run.controller.ts:13` — `POST run` (`:17`)
- `SkillController` `modules/skill/skill.controller.ts:14` — `POST/GET`, `GET/PATCH/DELETE :id` (`:18,29,34,39,48`)
- `LlmProviderController` `modules/llm-provider/llm-provider.controller.ts:14` — `POST/GET`, `GET/PATCH/DELETE :id`, `PATCH :id/activate` (`:18,26,31,36,45,50`)
- `AuditController` `modules/audit/audit.controller.ts:11` — `GET /audit` (`:15`)

**Session validation + 401 throw site.** `auth.guard.ts:33` calls
`authInstance.api.getSession({ headers: fromNodeHeaders(request.headers) })`; on null it throws
`UnauthorizedException('valid session required')` (`:34-36`). On success it attaches
`request.session` (`:39`), consumed by `CurrentUserId` (`common/decorators/current-user-id.decorator.ts:8-11`).
The global `AllExceptionsFilter` (`app.module.ts:33`, `common/filters/all-exceptions.filter.ts:5`)
normalizes the body to `{ message: 'valid session required', status: 401, timestamp: <ISO> }`
(`:21-26`) — a test can assert this exact shape.

**Better Auth handler mount.** `@Controller('auth')` + `@All('*splat')` delegating to
`toNodeHandler(authInstance)` (`auth.controller.ts:9,13-15`); `basePath: '/auth'`
(`create-auth.ts:21`) + global prefix `/api` ⇒ effective `/api/auth/*`, matching
`createAuthClient({ baseURL: '/api' })`. Class-level `@Public()` keeps login/signup reachable;
signup is enabled (`create-auth.ts:25-31`) — lever to close is `emailAndPassword.disableSignUp: true`.

> `audit.service.ts:87-89` carries a comment confirming the design assumption that `userId` is only
> ever undefined "on a misconfigured `@Public` route" — reinforcing that the accidental-public path
> is the single thing the test must lock down.

### Risk #3 — Per-device skill confinement (runtime scope filter)

**No LLM tool-assembly layer exists.** `grep` for `generateText`/`tools:` finds only comments and the
`generateObject` diagnose path. The roadmap parks free-form agent chat as a non-goal
(`context/foundation/roadmap.md:265`, "predefined skills only is the guardrail"). The real guardrail
is the skill-run HTTP path.

**The per-device callable set** is the DB query `SkillService.findForDevice(deviceId)`
(`modules/skill/skill.service.ts:67-74`), whose predicate is
`or(isNull(skill.deviceId), eq(skill.deviceId, deviceId))` (`:71`) — every global skill plus that
device's own skills.

**Filtering enforcement** is `SkillRunService.requireInScope` (`modules/skill/skill-run.service.ts:97-104`):
it calls `findForDevice(deviceId)` and `inScope.find(c => c.id === skillId)`; a miss throws
`NotFoundException` (`:100-102`). Called on every run at `:64`.

**Default vs custom skills use the identical path.** There is **no `isDefault`/`isCustom` column**.
Defaults are global rows (`deviceId = null`) written by the seed (`skill.seed.ts:71`); custom skills
are written by `SkillService.create` with `deviceId = input.deviceId ?? null` (`skill.service.ts:23`).
Both are plain rows in the `skill` table (`core/database/schema/skill.schema.ts:11-37`, nullable
`deviceId` FK with `onDelete: cascade` at `:22`), filtered by the same `deviceId` predicate.

> **S-08 question resolved (answers the change.md intent):** a custom skill scoped to device E
> satisfies neither `isNull(deviceId)` nor `eq(deviceId, D)`, so it is excluded from
> `findForDevice(D)` and `requireInScope` returns 404 — **the filter is source-agnostic; it holds
> equally for custom skills.** Caveat to encode as an *expected* (not a leak): a custom skill with
> `deviceId = null` is a global custom skill and is intentionally callable on every device.

**Parameter interpolation — charset whitelist, NOT shell-quoting.** `SkillRunService.renderCommand`
(`skill-run.service.ts:112-134`) does `commandTemplate.replace(PLACEHOLDER, ...)` where
`PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g` (`:28`); the replacement returns the raw
value (`:131`) — it is **raw-concatenated**, not quoted. The defense is that every value is re-parsed
through `skillParameterValueSchema.parse(raw)` at the shell boundary (`:124`), whose regex
`/^[a-zA-Z0-9/][a-zA-Z0-9_.:/=-]*$/`
(`libs/shared/src/lib/schemas/skill-parameter-value.schema.ts:12-15`) excludes every shell
metacharacter (space, `; | & $`, backtick, parens, quotes, redirects, globs). The same schema is
applied at the controller via `skillRunRequestSchema`
(`libs/shared/src/lib/schemas/skill-run-request.schema.ts:13`) — two layers of the same guard.
`service`-source params are read server-side via `resolveServiceValue` (`skill-run.service.ts:139-148`),
never accepted from the client, and the `renderCommand` re-parse is the **only** guard on that path.

**Execution boundary.** `SkillRunController.run` (`skill-run.controller.ts:17-26`) →
`SkillRunService.run` (`skill-run.service.ts:54-91`) → `requireInScope` (`:64`) → `renderCommand`
prepends `PATH_PREFIX` (`:24,133`) → `executor.execute(deviceId, command, timeoutMs)` (`:68`) →
`SshExecutor.execute` → `ssh.execCommand(command)` (`integrations/executor/ssh.executor.ts:64`),
passed verbatim to a single shell.

> **Unguarded seam to flag, not necessarily test:** an operator who can *author* a skill can put
> arbitrary shell in `commandTemplate` (only brace-shape is validated,
> `skill-command-template.schema.ts:12-19`). Injection is guarded on substituted *values*, not on the
> template. Whether the malicious-author case is in the threat model is a planning decision.

### Risk #4 — Secret leakage (AES-256-GCM, strict contracts)

**Crypto.** `core/crypto/crypto.service.ts` — AES-256-GCM, 12-byte IV, 32-byte key (`:8-10`); key
from `ENCRYPTION_KEY` (base64) via `cryptoConfig` (`config/crypto.config.ts:5-7`), decoded and
length-asserted at construction so a wrong-size key throws at boot (`:20-24`). `encrypt()` returns
**three separate base64 fields** `{ authTag, ciphertext, iv }` (`encrypted-payload.type.ts:1-5`,
`crypto.service.ts:36-47`), with a random per-record IV (`:39`). `decrypt()` does `setAuthTag` before
`final()`, so a tampered ciphertext/tag throws (GCM integrity, `:27-34`).

**Storage — ciphertext, three columns.**
- SSH credential: table `credential` (`core/database/schema/device.schema.ts:22-49`), columns
  `ciphertext` (`:30`), `iv` (`:39`), `auth_tag` (`:26`), `key_version` (`:41`).
  `CredentialService.create` calls `crypto.encrypt(input.secret)` *before* insert
  (`core/credential/credential.service.ts:26-39`); plaintext never persists. Service-only
  `getDecryptedSecret(id)` (`:65-68`) is commented "must never be wired to a controller" (`:62-64`).
- LLM API key: table `llm_provider` (`core/database/schema/llm-provider.schema.ts:8-38`), same column
  shape. `crypto.encrypt(input.apiKey)` at `modules/llm-provider/llm-provider.service.ts:30` (create)
  and `:91` (rotation only when a new key is supplied); service-only decrypt accessors at `:157-165`,
  `:174-185`, both marked "never wired to a controller."

**Audit transcript — secret-free by construction.** Table `audit_log`
(`core/database/schema/audit-log.schema.ts:13-43`) has **no command/credential column**; `metadata`
(`:23`, "secret-free json metadata") is `JSON.stringify(input.metadata)` (`audit.service.ts:97`).
Every caller passes ids/labels only: credential → `{authType, deviceId, username}`
(`credential.service.ts:46`); llmProvider → `{kind, model}`
(`llm-provider.service.ts:57,100,125,144`); **skill.run → `{outcome, skillName}`**
(`skill-run.service.ts:85`) — **the executed command string is NOT written to the audit row.** The
`run_record` table stores only `synthesis` (the LLM's 4-field output), no command/stdout/secret.

**Error / response paths.**
- `AllExceptionsFilter` logs the raw error server-side only and returns a generic
  `'internal server error'` body (`common/filters/all-exceptions.filter.ts:13,18,21-26`) — the raw
  node:crypto message never reaches the client.
- Executor errors carry only host/deviceId/timeoutMs, never the command or secret
  (`integrations/executor/executor.errors.ts:16-42`); the decrypt failure is wrapped
  (`ssh.executor.ts:95-101`) so "unable to authenticate data" never surfaces.
- **The one open response surface:** the skill-run result returns `cleanOutput(stdout, stderr)`
  to the client (`skill-run.service.ts:75-79`). The command is not echoed, but if a skill template
  prints its own substituted argument the stdout could contain it.
- LLM probe sends the apiKey in an outbound `Authorization: Bearer` header (expected) and throws
  domain errors carrying only baseURL on failure (`modules/llm-provider/llm-provider.probe.ts:21-39`).

**Front-end exposure — none.** Read contracts strip secrets via `z.strictObject`: `credentialSchema`
omits ciphertext/iv/authTag (`libs/shared/src/lib/schemas/credential.schema.ts:12-19`);
`llmProviderSchema` exposes only a derived `hasApiKey: boolean`, never the key (`:13-22`). Web clients
re-parse responses through the same strict schema, so any leaked secret-bearing key is a **parse
failure** (e.g. `apps/web/.../llm-providers/data/llm-providers.client.ts:14`). Secrets are write-only
in the FE (password inputs; blank-on-edit keeps the stored value).

## Code References

- [`apps/api/src/app.module.ts:32`](https://github.com/karoldydo/opspilot/blob/bb3ff99e2f82a256ef0c2d8210bdbf7614ef964e/apps/api/src/app.module.ts#L32) — global `APP_GUARD` registration (the entire auth boundary)
- [`apps/api/src/core/auth/auth.guard.ts:22-39`](https://github.com/karoldydo/opspilot/blob/bb3ff99e2f82a256ef0c2d8210bdbf7614ef964e/apps/api/src/core/auth/auth.guard.ts#L22-L39) — `@Public()` short-circuit + session lookup + 401 throw
- [`apps/api/src/common/decorators/public.decorator.ts:3-5`](https://github.com/karoldydo/opspilot/blob/bb3ff99e2f82a256ef0c2d8210bdbf7614ef964e/apps/api/src/common/decorators/public.decorator.ts#L3-L5) — `IS_PUBLIC_KEY` / `@Public()`
- [`apps/api/src/common/filters/all-exceptions.filter.ts:13-26`](https://github.com/karoldydo/opspilot/blob/bb3ff99e2f82a256ef0c2d8210bdbf7614ef964e/apps/api/src/common/filters/all-exceptions.filter.ts#L13-L26) — normalized error body + generic 500
- [`apps/api/src/modules/skill/skill.service.ts:67-74`](https://github.com/karoldydo/opspilot/blob/bb3ff99e2f82a256ef0c2d8210bdbf7614ef964e/apps/api/src/modules/skill/skill.service.ts#L67-L74) — `findForDevice` scope predicate
- [`apps/api/src/modules/skill/skill-run.service.ts:97-104`](https://github.com/karoldydo/opspilot/blob/bb3ff99e2f82a256ef0c2d8210bdbf7614ef964e/apps/api/src/modules/skill/skill-run.service.ts#L97-L104) — `requireInScope` (the 404 confinement gate)
- [`apps/api/src/modules/skill/skill-run.service.ts:112-134`](https://github.com/karoldydo/opspilot/blob/bb3ff99e2f82a256ef0c2d8210bdbf7614ef964e/apps/api/src/modules/skill/skill-run.service.ts#L112-L134) — `renderCommand` substitution + value re-parse
- [`libs/shared/src/lib/schemas/skill-parameter-value.schema.ts:12-15`](https://github.com/karoldydo/opspilot/blob/bb3ff99e2f82a256ef0c2d8210bdbf7614ef964e/libs/shared/src/lib/schemas/skill-parameter-value.schema.ts#L12-L15) — the injection-defense charset whitelist
- [`apps/api/src/core/crypto/crypto.service.ts:27-47`](https://github.com/karoldydo/opspilot/blob/bb3ff99e2f82a256ef0c2d8210bdbf7614ef964e/apps/api/src/core/crypto/crypto.service.ts#L27-L47) — AES-256-GCM encrypt/decrypt
- [`apps/api/src/core/credential/credential.service.ts:23-68`](https://github.com/karoldydo/opspilot/blob/bb3ff99e2f82a256ef0c2d8210bdbf7614ef964e/apps/api/src/core/credential/credential.service.ts#L23-L68) — encrypt-on-write + service-only `getDecryptedSecret`
- [`apps/api/src/modules/audit/audit.service.ts:97`](https://github.com/karoldydo/opspilot/blob/bb3ff99e2f82a256ef0c2d8210bdbf7614ef964e/apps/api/src/modules/audit/audit.service.ts#L97) — `JSON.stringify(metadata)` (secret-free by caller convention)
- [`apps/api/src/modules/skill/skill-run.service.ts:75-79`](https://github.com/karoldydo/opspilot/blob/bb3ff99e2f82a256ef0c2d8210bdbf7614ef964e/apps/api/src/modules/skill/skill-run.service.ts#L75-L79) — the one response surface returning raw remote stdout/stderr
- [`libs/shared/src/lib/schemas/credential.schema.ts:12-19`](https://github.com/karoldydo/opspilot/blob/bb3ff99e2f82a256ef0c2d8210bdbf7614ef964e/libs/shared/src/lib/schemas/credential.schema.ts#L12-L19) — strict read contract omitting secret columns

### Existing test seams to clone

- [`apps/api/src/core/credential/credential.service.spec.ts:44-132`](https://github.com/karoldydo/opspilot/blob/bb3ff99e2f82a256ef0c2d8210bdbf7614ef964e/apps/api/src/core/credential/credential.service.spec.ts#L44-L132) — **the Phase 3 template, already built**: real temp-file SQLite, real migrations, persisted-ciphertext assertion (`:94-97`), secret-free transcript (`:100-118`), round-trip via `getDecryptedSecret` (`:120-132`)
- [`apps/api/src/core/database/database.module.spec.ts:18-40`](https://github.com/karoldydo/opspilot/blob/bb3ff99e2f82a256ef0c2d8210bdbf7614ef964e/apps/api/src/core/database/database.module.spec.ts#L18-L40) — canonical temp-DB seam (`tmpdir()` path, `databaseConfig.KEY` override, `-wal`/`-shm` teardown)
- [`apps/api/src/modules/service/service.service.spec.ts:53-72`](https://github.com/karoldydo/opspilot/blob/bb3ff99e2f82a256ef0c2d8210bdbf7614ef964e/apps/api/src/modules/service/service.service.spec.ts#L53-L72) — `.overrideProvider(EXECUTOR)` on a real-migration module; per-device isolation asserted at `:268-278`
- [`apps/api/src/core/auth/auth.guard.spec.ts:40-45`](https://github.com/karoldydo/opspilot/blob/bb3ff99e2f82a256ef0c2d8210bdbf7614ef964e/apps/api/src/core/auth/auth.guard.spec.ts#L40-L45) — the only existing 401 assertion (guard unit, isolated)
- [`apps/api/src/modules/device/device.controller.spec.ts:60-67`](https://github.com/karoldydo/opspilot/blob/bb3ff99e2f82a256ef0c2d8210bdbf7614ef964e/apps/api/src/modules/device/device.controller.spec.ts#L60-L67) — controller specs **strip the global guard** and fake the session; this is why no wire-level 401 test exists yet

## Architecture Insights

- **Guardrails are enforced at single choke points, which makes them testable by contract.** Auth =
  one global guard; skill confinement = one `findForDevice` predicate behind one `requireInScope`
  gate; secret-at-rest = one `crypto.encrypt` call on the write path + `z.strictObject` on every read
  contract. Each risk has exactly one place to pin, and a regression anywhere else surfaces there.
- **Defense by construction over defense by escaping.** Injection is stopped by constraining the
  *alphabet* of a value (`skillParameterValueSchema`), and secret exposure by `z.strictObject` read
  contracts that turn a leaked field into a *parse failure*. Both are "make the bad state
  unrepresentable," which is why the cheapest test is a contract/schema assertion, not an e2e.
- **Two of the three guards are convention-enforced at the edges, not schema-enforced.** Audit
  metadata is secret-free only because every caller passes ids (nothing structurally blocks a future
  secret); the auth boundary is airtight only as long as nobody adds a stray `@Public()`. Both call
  for *inverted regression tests* (assert the absence of the bad thing), not just happy-path coverage.
- **The real-temp-file DB pattern is copy-pasted, not shared.** Every DB-touching spec inlines the
  same ~20-line `tmpdir()` + dual-config-override + `-wal`/`-shm` teardown. Phase 3 can either extract
  a helper or clone `credential.service.spec.ts`; the fixed test key
  `AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=` (0x01×32) is already the shared convention.
- **`@Inject(Class)` tokens are mandatory** (esbuild drops `design:paramtypes` under Vitest) — see
  `lessons.md:19-23`, which names the exact `CredentialService → CryptoService` incident. New Phase 3
  specs that hand-build services must pass explicit tokens.

## Historical Context (from prior changes)

- `context/archive/2026-06-09-encrypted-credential-store/` — established the crypto design: master key
  from `ENCRYPTION_KEY` (AES-256-GCM, no per-record KDF; random IV gives semantic security), threat
  model = **leak of a backup/DB file, NOT host takeover**; secret safety via `z.strictObject` +
  projection-not-spread + the ban on `$inferSelect` from `@opspilot/shared`; `keyVersion` column for
  forward-compat rotation; separate `ciphertext`/`iv`/`authTag` columns. **Shipped service + tests
  only, no HTTP/guard** — the credential controller/401 surface came later.
- `context/archive/2026-06-07-account-auth-foundation/` — Better Auth + `AuthAppGuard` foundation
  (the global guard now under test).
- `context/archive/2026-06-12-per-device-agent-context/` and
  `context/archive/2026-06-13-custom-skill-crud/` — per-device scoping and the custom-skill CRUD that
  Risk #3 confinement now has to prove holds for custom skills.

## Related Research

- `context/changes/testing-ssh-executor-lifecycle-timeout/` (Phase 2) — the executor seam Risk #3's
  execution boundary flows into; `service.service.spec.ts` is shared between that phase and this one.
- `context/foundation/test-plan.md` §2 (Risk Map) and §6.4 (the TBD cookbook entry this phase fills).

## Open Questions

1. **Wire-level 401 harness (decision needed).** No spec asserts unauth→401 over HTTP because the
   controller specs strip the global guard. Phase 3 must either (a) import `AppModule` to get the real
   `APP_GUARD`, or (b) register `AuthAppGuard` + override `AUTH_INSTANCE` with a session-returning/null
   fake. Which is cleaner is a plan-time call.
2. **Route-metadata sweep mechanism.** The inverted "no accidental `@Public()`" test needs a way to
   enumerate routes and read `isPublic` metadata (NestJS `DiscoveryService`/`Reflector` over the
   container). Confirm the chosen mechanism in planning.
3. **Malicious skill-author threat model.** Injection is guarded on parameter *values*, not on the
   operator-authored `commandTemplate`. Decide whether the author-trust boundary is in scope (likely
   out, under the small-trusted-group model — but should be stated, not assumed).
4. **Skill-run stdout echo.** The skill-run result returns raw remote stdout. Decide whether a test
   asserting a substituted parameter is not echoed back is worth it, or whether that is out of scope
   given operator-authored templates.
5. **Coverage already present vs net-new.** Persisted-ciphertext (`credential.service.spec.ts`) and
   per-device service isolation (`service.service.spec.ts:268-278`, `skill.service.spec.ts:134-143`)
   already exist. Planning should confirm exactly which confinement/leak assertions are genuinely
   missing before writing, to avoid duplicating characterization.
