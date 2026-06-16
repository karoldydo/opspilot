---
date: 2026-06-16T20:21:18+02:00
researcher: Karol Dydo
git_commit: 8305aa1be79b43e1ae9fc0a8756803e78ec6535c
branch: main
repository: opspilot
topic: "SSH executor lifecycle + bounded timeout (test-plan Phase 2, Risk #2)"
tags: [research, codebase, executor, ssh, timeout, connection-lifecycle, testing]
status: complete
last_updated: 2026-06-16
last_updated_by: Karol Dydo
---

# Research: SSH executor lifecycle + bounded timeout (test-plan Phase 2, Risk #2)

**Date**: 2026-06-16T20:21:18+02:00
**Researcher**: Karol Dydo
**Git Commit**: 8305aa1be79b43e1ae9fc0a8756803e78ec6535c
**Branch**: main
**Repository**: opspilot

## Research Question

Ground rollout Phase 2 of `context/foundation/test-plan.md` — "SSH executor lifecycle +
timeout" (Risk #2). Specifically, the Risk Response Guidance requires research to ground three
things in live code:

1. **the connection lifecycle in the executor** — is a connection disposed after every run (no
   leak), including on the error/timeout path?
2. **where the bounded command timeout lives** — how a command exceeding the timeout is aborted
   with a clean error and the run terminates;
3. **how the scan command is built** — does the container scan stay within its bounded timeout?

Must challenge: *"HTTP 200 means the connection was cleaned up"* and *"the scan works today so it
can never exceed the timeout"*. Anti-pattern to avoid: over-mocking the executor so dispose/timeout
never actually fire, and a happy-path-only test with no timeout path.

## Summary

**The executor's design already defends Risk #2, and an existing spec already exercises both the
disposal and the bounded-command-timeout paths.** The SSH executor disposes its connection in an
unconditional `finally` (success, mapped-connect-error, command-timeout, and `execCommand`-reject
all flow through it), the bounded command timeout is a live `setTimeout` + `Promise.race` that
rejects with a clean `SshCommandTimeoutError` (HTTP 504), and the container scan uses the **safe
explicit-field `docker ps` form** (no `{{json .}}`, no `-s`) under the generic 30 s
`SSH_COMMAND_TIMEOUT_MS`.

This means Phase 2 is **not** a "build the seam + write the first timeout test" phase. The
injection seam (`SSH_CLIENT_FACTORY` DI token) already exists *specifically* so a fake transport
can be substituted, and `apps/api/src/integrations/executor/ssh.executor.spec.ts` already asserts
dispose-on-success, dispose-on-connect-failure, command-timeout-then-dispose, and per-call timeout
override. The genuine **residual gaps** worth a Phase 2 plan are narrow and specific:

- **(a) Connect timeout (`readyTimeout`) never fires under test** — `connect` is mocked to
  resolve/reject; the `SSH_CONNECT_TIMEOUT_MS` bound is config-only, never wall-clock exercised.
- **(b) No scan-/consumer-level test where the executor hangs/never resolves** —
  `service.service.spec.ts` only feeds resolved executor results; the "run never terminates" failure
  is asserted *inside* the executor, never at the scan boundary that the user actually hits.
- **(c) No end-to-end integration wiring of a fake SSH through a Nest `TestingModule`** — current
  executor coverage is hand-built unit style; the precedent for graph-level wiring exists
  (`.overrideProvider(EXECUTOR)` / `.overrideProvider(SSH_CLIENT_FACTORY)`) but is unused for the
  lifecycle/timeout assertions.
- **(d) Parsing fragility under a timeout-truncated scan** — scan output parsing is strict
  (`JSON.parse` + `z.strictObject`, no per-line try/catch), so a command killed mid-write produces a
  partial line that fails the *whole* scan. Not strictly Risk #2, but adjacent and currently untested.

Both challenges the plan named are answerable with evidence: a 200/clean result does **not** imply
cleanup unless `dispose()` ran — and the structural proof that it always does is the `finally`
block, which a test pins by asserting `dispose` was called on the timeout/error path (already done
at the unit level). The "scan can never exceed timeout" claim is contradicted by lessons.md (the
`docker ps -s` ~27 s walk that brushed the 30 s ceiling); the current command is the *fixed* safe
form, and nothing today re-asserts that it stays safe.

## Detailed Findings

### Area 1 — Connection lifecycle (dispose on all paths)

**Files**: `apps/api/src/integrations/executor/ssh.executor.ts`,
`ssh-client.factory.ts`, `executor.interface.ts`, `executor.token.ts`, `executor.module.ts`.

The executor creates **one fresh `NodeSSH` per call** via the injected factory
(`ssh.executor.ts:41` — `const ssh = this.createClient()`). There is **no pooling, reuse, or
caching** of connections; the only cached state is a per-device `Mutex` map (`mutexes`,
`ssh.executor.ts:21`, `mutexFor` at `:114-125`) used to serialize concurrent runs against the same
device — explicitly *not* a connection cache.

The core control flow (`ssh.executor.ts:42-79`) wraps connect + exec in a `try`, with dispose in an
unconditional `finally`:

```ts
const ssh = this.createClient();
let timer: NodeJS.Timeout | undefined;
try {
  try {
    await ssh.connect({ host: device.host, readyTimeout: this.config.connectTimeoutMs, ... });
  } catch (error) {
    throw this.mapConnectError(device.host, error);
  }
  const commandTimeoutMs = timeoutMs ?? this.config.commandTimeoutMs;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SshCommandTimeoutError(commandTimeoutMs)), commandTimeoutMs);
  });
  const result = await Promise.race([ssh.execCommand(command), timeout]);
  return { code: result.code, stderr: result.stderr, stdout: result.stdout };
} finally {
  if (timer !== undefined) { clearTimeout(timer); }
  try { ssh.dispose(); } catch { /* intentionally ignored */ }
}
```

Dispose-on-all-paths, verified branch by branch:

- **Success** → `return` triggers `finally` → dispose. ✓
- **Connect rejects** → inner `catch` re-throws a *mapped* error; it propagates through `finally` →
  dispose still runs. ✓
- **Command timeout fires** → the timeout promise rejects, `Promise.race` rejects → `finally` runs
  `clearTimeout(timer)` + dispose. ✓
- **`execCommand` itself rejects** → propagates → `finally` → dispose. ✓
- **`dispose()` throws** → wrapped in its own `try/catch`, so a dispose error on an unconnected
  client never masks the original mapped connect error. ✓

**Leak-scope nuance the test must respect**: `const ssh = this.createClient()` is at `:41`,
*before* the `try` opens at `:43`. But the three steps before it — `deviceService.findOne` (`:37`),
`resolveCredential` (`:38`), `decryptSecret` (`:39`) — run before any client exists. If those throw
(404 device, missing credential → `SshConnectError`, decrypt failure → `CredentialDecryptError`),
**no client was created, so there is nothing to dispose**. The dispose guarantee only needs to hold
*after* `createClient()`, and it does. (The existing spec already pins both pre-client cases as
"never opens a connection".)

**Public surface** (what consumers call): a single method on `IExecutor` /`SshExecutor` —
`execute(deviceId: string, command: string, timeoutMs?: number): Promise<ExecResult>`
(`executor.interface.ts:19`, `ssh.executor.ts:30`). `execute` wraps the work in the per-device
mutex (`this.mutexFor(deviceId).runExclusive(() => this.run(...))`); the lifecycle lives in the
private `run(...)` (`ssh.executor.ts:35`). `ExecResult = { code: null | number; stderr: string;
stdout: string }`.

**DI (for instantiating in tests)** — explicit `@Inject` tokens (`ssh.executor.ts:23-28`), four deps:
1. `@Inject(sshConfig.KEY)` → `SshConfig` (`{ connectTimeoutMs, commandTimeoutMs }`),
2. `@Inject(CredentialService)`,
3. `@Inject(DeviceService)`,
4. `@Inject(SSH_CLIENT_FACTORY)` → `SshClientFactory = () => NodeSSH` — **the seam**.

### Area 2 — Bounded command timeout

**Files**: `apps/api/src/config/env.schema.ts`, `config/ssh.config.ts`, `config/skill.config.ts`,
`integrations/executor/ssh.executor.ts`, `executor.errors.ts`, `executor.interface.ts`.

**Where the value lives** (config layer, per lessons.md "tunables go through `@nestjs/config` +
Joi"):

| Env var | Default | Joi bound | Source |
|---|---|---|---|
| `SSH_COMMAND_TIMEOUT_MS` | `30000` | `Joi.number().integer().min(1000)` | `env.schema.ts:57` |
| `SSH_CONNECT_TIMEOUT_MS` | `10000` | `Joi.number().integer().min(1000)` | `env.schema.ts:59` |
| `SKILL_TIMEOUT_MS` | `300000` | `Joi.number().integer().min(1000)` | `env.schema.ts:55` |
| `LLM_DIAGNOSE_LOGS_TIMEOUT_MS` | `5000` | `Joi.number().integer().min(1000)` | `env.schema.ts:42` |

`ssh.config.ts:6-9` (`registerAs('ssh', ...)`) exposes `commandTimeoutMs` / `connectTimeoutMs`,
coercing with `Number(...)` (Joi writes defaults back to `process.env` as strings).

**How it's enforced** (`ssh.executor.ts:60-64`): a **hand-rolled `setTimeout` + `Promise.race`** —
**not** an `AbortSignal`/`AbortController`, **not** node-ssh `execOptions`. node-ssh's `execCommand`
has no native command timeout (noted at `env.schema.ts:56`), so the race is the mechanism. The
per-call `timeoutMs` param overrides the configured default; omitted, it falls back to
`this.config.commandTimeoutMs` (30 s). (The separate **connect** timeout *is* node-ssh's own option:
`readyTimeout: this.config.connectTimeoutMs` at `ssh.executor.ts:50`.)

**What fires on timeout** — a clean, surfaced error: `SshCommandTimeoutError(commandTimeoutMs)`
(`executor.errors.ts:31-35`), which extends NestJS `GatewayTimeoutException` → **HTTP 504**, message
`ssh command timed out after <N>ms`. The rejection propagates out of the race; `finally` clears the
timer and disposes (Area 1).

**Critical caveat for the test author**: `Promise.race` only makes the *executor's* promise reject.
The underlying `ssh.execCommand(command)` is **not signal-cancelled** — the orphaned exec keeps
running on the SSH channel server-side until it finishes or `dispose()` tears the connection down.
"Abort" here means "the executor stops waiting and disposes", not remote-process cancellation. A
test should assert the *executor's* behavior (rejects with `SshCommandTimeoutError` + dispose ran),
not that the remote command stopped.

**Is it live or dead config?** Live and armed on every `run()`. Real call sites:
- `service.service.ts:50` — `execute(deviceId, SCAN_COMMAND)` (no override → 30 s default).
- `skill-run.service.ts:68` — `execute(deviceId, command, skill.timeoutMs ?? this.config.timeoutMs)`
  (override → skill row's own timeout or `SKILL_TIMEOUT_MS` default 300 s).
- `diagnose.service.ts:188` — `execute(deviceId, command)` (no override → 30 s internally), but
  `fetchLogs` *also* wraps an **outer** race against `logsTimeoutMs` (`LLM_DIAGNOSE_LOGS_TIMEOUT_MS`,
  5 s) — so the tightest effective bound on a diagnose logs fetch is ~5 s, not 30 s
  (`diagnose.service.ts:179-204`). It attaches `exec.catch(() => undefined)` so the orphaned
  executor promise's late rejection is not an unhandled rejection.

**Scan vs. command timeout**: there is **no dedicated scan timeout** — the scan rides the generic
30 s `SSH_COMMAND_TIMEOUT_MS`. Only skill runs get a distinct, longer bound (300 s), and only
diagnose adds a tighter outer bound (5 s).

**Stale-comment flag**: `diagnose.service.ts:175-176` says *"IExecutor.execute carries no per-call
timeout"* — inaccurate; `execute(deviceId, command, timeoutMs?)` does accept one
(`executor.interface.ts:16-19`). `fetchLogs` just chooses not to pass it and bounds the wait itself.
Don't trust the comment over the signature when planning.

### Area 3 — Container scan command construction

**File**: `apps/api/src/modules/service/service.service.ts`.

The `SCAN_COMMAND` constant (`service.service.ts:31-34`) is the **safe explicit-field form**:

```ts
const SCAN_COMMAND =
  'export PATH="/usr/local/bin:/usr/local/sbin:/volume1/@appstore/ContainerManager/usr/bin:$PATH"; ' +
  'docker ps --no-trunc --format ' +
  `'{"Names":{{json .Names}},"Image":{{json .Image}},"State":{{json .State}},"Status":{{json .Status}},"Labels":{{json .Labels}}}'`;
```

It enumerates exactly five fields and applies `{{json .Field}}` to each individually — it does
**not** use `{{json .}}` (whole-struct marshal) or `-s`/`--size`, both of which force the
per-container layer-size walk (~27 s on the Synology NAS) flagged in lessons.md. The comment at
`:24-30` documents this is deliberate. Output is **NDJSON** (one object per line); `--no-trunc`
keeps full names/labels; the `export PATH=...` prefix handles the Synology non-interactive-shell
docker-PATH gotcha (also documented in `.claude/rules/ssh.md`).

**Call site** (`service.service.ts:49-50`): `ServiceService.scan(deviceId, userId)` →
`await this.executor.execute(deviceId, SCAN_COMMAND)` — **no third `timeoutMs` argument**, so it
rides the 30 s default.

**Parsing tolerance is mixed** (`service.service.ts:54-59`, `parseContainer` at `:178-189`):
- **Empty output tolerated** — zero containers (empty/all-blank stdout) → empty array →
  `scanResultSchema.parse({ containers: [] })` succeeds (`scan-result.schema.ts:24-26`).
- **Malformed content NOT tolerated** — each non-blank line goes through `JSON.parse(line)`
  (`:179`) then `scannedContainerSchema.parse(...)`, a `z.strictObject` (`scan-result.schema.ts:11-18`).
  A truncated/partial line (e.g. a JSON object cut mid-write by a timeout-killed command, or stderr
  bleeding onto stdout) throws `SyntaxError`/`ZodError` and **fails the whole scan** — there is no
  per-line try/catch.

**Const vs. config**: the timeout governing the scan is correctly config-routed
(`SSH_COMMAND_TIMEOUT_MS`), but the `SCAN_COMMAND` string itself (format template + embedded PATH)
is a **hardcoded module-level `const`**, not config-driven. (lessons.md's tunable rule is about
*operational tunables* like timeouts, which are externalized; the command template is arguably a
code artifact, but worth noting if the format ever needs per-host variation.)

### Area 4 — Test seams, existing coverage, and the Phase 1 pattern to mirror

**Headline**: the injection seam Phase 2 needs **already exists and is already used**. There is
**no `new NodeSSH()` inline problem** — the real client is isolated behind a DI token + factory
(`ssh-client.factory.ts:12-15` — `{ provide: SSH_CLIENT_FACTORY, useValue: (): NodeSSH => new
NodeSSH() }`), and `ssh.executor.ts:41` calls the injected `this.createClient()`.

**Two clean seams**:
- **Inner (fake transport)**: override `SSH_CLIENT_FACTORY` to return a fake `{ connect, dispose,
  execCommand }` client. This is what `ssh.executor.spec.ts` does, passing the factory positionally
  (`vi.fn(() => opts.client as unknown as NodeSSH)`).
- **Outer (fake whole executor)**: the executor is provided behind `EXECUTOR = Symbol('EXECUTOR')`
  (`executor.token.ts:4`), `{ provide: EXECUTOR, useClass: SshExecutor }` in `executor.module.ts`.
  Consumers (`service.service.ts:42`, etc.) inject the `IExecutor` token, so scan/diagnose specs
  fake at `EXECUTOR`; executor-internal specs fake at `SSH_CLIENT_FACTORY`.

**Existing spec coverage**:

| File | Covers | Gap |
|---|---|---|
| `ssh.executor.spec.ts` | Hand-built `new SshExecutor(config, credentialService, deviceService, factory)` with a fake node-ssh client. Mutex serialization; **command timeout via the timer + dispose** (`:81`); per-call timeout override (`:94`); **dispose on success** (`:108`); **dispose on connect-failure** (`:122`); auth-error mapping; decrypt-failure short-circuit (no connect); no-credential connect error; privateKey path. | Does **not** exercise a real `readyTimeout`/connect-timeout firing — connect is mocked to resolve/reject; the connect-timeout bound is config-only, never wall-clock. |
| `service.service.spec.ts` | `ServiceService.scan` via a Nest `TestingModule` + `.overrideProvider(EXECUTOR).useValue(mockExecutor)` (real temp SQLite). Happy-path NDJSON parse, audit row, executor-result error mapping (`DockerNotFoundError` exit 127, `DockerDaemonDownError`). | **No test where `executor.execute` hangs / never resolves** — all cases (`:83-172`) feed resolved promises. The "run never terminates" NFR is asserted inside the executor, not at the scan boundary. Also no truncated-line parse-failure test. |
| `diagnose.service.spec.ts` / `.real-model.spec.ts` / `diagnose.controller.spec.ts` | Use `mockExecutor.execute` positionally; the logs-timeout path is the executor-hang analog, tested via the service's own `Promise.race`. `diagnose.controller.spec.ts` is the e2e style: `imports: [ConfigModule, DatabaseModule, DiagnoseModule]`, overrides `EXECUTOR` + config keys, `app.init()` + supertest, temp DB at `tmpdir()`. | n/a for the SSH executor itself. |

**Two api integration-test structures coexist** (pick by need):
- **Hand-built `new Service(...mocks)`** — no DB / no DI graph: `ssh.executor.spec.ts:42`,
  `diagnose.service.spec.ts:72`, `diagnose.service.real-model.spec.ts:75`.
- **Nest `TestingModule` + `.overrideProvider(TOKEN).useValue(...)`** — when real SQLite or the
  module graph matters: `service.service.spec.ts:52-60`, `diagnose.controller.spec.ts:107-117`.

## Code References

(GitHub permalinks pinned to commit `8305aa1`.)

- [`apps/api/src/integrations/executor/ssh.executor.ts:35-79`](https://github.com/karoldydo/opspilot/blob/8305aa1be79b43e1ae9fc0a8756803e78ec6535c/apps/api/src/integrations/executor/ssh.executor.ts#L35-L79)
  — the heart of Risk #2: `run()`, the `setTimeout`+`Promise.race` command timeout, the `finally`
  dispose.
- [`apps/api/src/integrations/executor/ssh.executor.ts:23-28`](https://github.com/karoldydo/opspilot/blob/8305aa1be79b43e1ae9fc0a8756803e78ec6535c/apps/api/src/integrations/executor/ssh.executor.ts#L23-L28)
  — constructor / DI tokens (how to instantiate in a test).
- [`apps/api/src/integrations/executor/ssh-client.factory.ts:8-15`](https://github.com/karoldydo/opspilot/blob/8305aa1be79b43e1ae9fc0a8756803e78ec6535c/apps/api/src/integrations/executor/ssh-client.factory.ts#L8-L15)
  — `SSH_CLIENT_FACTORY` token + `() => new NodeSSH()` (the inner seam).
- [`apps/api/src/integrations/executor/executor.token.ts:4`](https://github.com/karoldydo/opspilot/blob/8305aa1be79b43e1ae9fc0a8756803e78ec6535c/apps/api/src/integrations/executor/executor.token.ts#L4)
  — `EXECUTOR` token (the outer seam).
- [`apps/api/src/integrations/executor/executor.interface.ts:16-19`](https://github.com/karoldydo/opspilot/blob/8305aa1be79b43e1ae9fc0a8756803e78ec6535c/apps/api/src/integrations/executor/executor.interface.ts#L16-L19)
  — `execute(deviceId, command, timeoutMs?)` contract + `ExecResult`.
- [`apps/api/src/integrations/executor/executor.errors.ts:31-35`](https://github.com/karoldydo/opspilot/blob/8305aa1be79b43e1ae9fc0a8756803e78ec6535c/apps/api/src/integrations/executor/executor.errors.ts#L31-L35)
  — `SshCommandTimeoutError` → 504.
- [`apps/api/src/integrations/executor/ssh.executor.spec.ts`](https://github.com/karoldydo/opspilot/blob/8305aa1be79b43e1ae9fc0a8756803e78ec6535c/apps/api/src/integrations/executor/ssh.executor.spec.ts)
  — existing dispose/timeout coverage (the pattern to extend, not rebuild).
- [`apps/api/src/config/env.schema.ts:55-59`](https://github.com/karoldydo/opspilot/blob/8305aa1be79b43e1ae9fc0a8756803e78ec6535c/apps/api/src/config/env.schema.ts#L55-L59)
  — `SSH_COMMAND_TIMEOUT_MS` / `SSH_CONNECT_TIMEOUT_MS` / `SKILL_TIMEOUT_MS` Joi bounds.
- [`apps/api/src/config/ssh.config.ts:6-9`](https://github.com/karoldydo/opspilot/blob/8305aa1be79b43e1ae9fc0a8756803e78ec6535c/apps/api/src/config/ssh.config.ts#L6-L9)
  — `registerAs('ssh', ...)` → `commandTimeoutMs`/`connectTimeoutMs`.
- [`apps/api/src/modules/service/service.service.ts:31-59`](https://github.com/karoldydo/opspilot/blob/8305aa1be79b43e1ae9fc0a8756803e78ec6535c/apps/api/src/modules/service/service.service.ts#L31-L59)
  — `SCAN_COMMAND` (safe explicit-field form) + `scan()` call site + parse.
- [`apps/api/src/modules/service/service.service.ts:178-189`](https://github.com/karoldydo/opspilot/blob/8305aa1be79b43e1ae9fc0a8756803e78ec6535c/apps/api/src/modules/service/service.service.ts#L178-L189)
  — `parseContainer` (strict `JSON.parse` + `z.strictObject`, no per-line try/catch).
- [`apps/api/src/modules/diagnose/diagnose.service.ts:179-204`](https://github.com/karoldydo/opspilot/blob/8305aa1be79b43e1ae9fc0a8756803e78ec6535c/apps/api/src/modules/diagnose/diagnose.service.ts#L179-L204)
  — diagnose's outer 5 s race over the executor (the existing "executor-hang at the consumer" analog).
- [`apps/api/src/modules/skill/skill-run.service.ts:66-68`](https://github.com/karoldydo/opspilot/blob/8305aa1be79b43e1ae9fc0a8756803e78ec6535c/apps/api/src/modules/skill/skill-run.service.ts#L66-L68)
  — skill run passes the 300 s override.
- [`apps/api/src/modules/service/service.service.spec.ts:52-60`](https://github.com/karoldydo/opspilot/blob/8305aa1be79b43e1ae9fc0a8756803e78ec6535c/apps/api/src/modules/service/service.service.spec.ts#L52-L60)
  — `.overrideProvider(EXECUTOR)` graph-wiring precedent.

## Architecture Insights

- **The seam was designed for testability up front.** `SSH_CLIENT_FACTORY` exists precisely so a
  fake transport can be injected without touching `node-ssh`; there is nothing to refactor before
  writing tests. This is the opposite of the usual Phase-N "the boundary is `new`'d inline, extract
  it first" situation.
- **"No run hangs" is born in one `finally`.** Disposal and timer-clearing are unconditional and
  centralized in `ssh.executor.ts:66-79`. The NFR is structural, not scattered across call sites —
  which is exactly why a single executor-level test pins it, and why consumer-level happy-path tests
  (HTTP 200) say nothing about cleanup. This directly answers the plan's challenge: **200 ≠
  cleaned-up**; only `dispose()` having run proves cleanup, and that proof lives at the executor.
- **The timeout is cooperative-wait, not cancellation.** `Promise.race` abandons the wait and
  disposes; the remote process is not signalled. Test oracles must assert the executor's
  observable behavior (reject type + dispose called), never that the remote command stopped.
- **Three timeout tiers, deliberately layered**: generic command (30 s, scan), skill (300 s, slow
  image pulls), diagnose-logs (5 s outer race). A test author must know which tier a path uses —
  the scan uses the generic tier with no override.
- **The scan command is the *fixed* form of a real past incident.** lessons.md records the
  `docker ps -s`/`{{json .}}` ~27 s layer-size walk that brushed the 30 s ceiling. The current
  `SCAN_COMMAND` is the explicit-field remedy. Nothing today guards against a regression back to the
  dangerous form — a cheap assertion that `SCAN_COMMAND` contains no `-s`/`{{json .}}` would lock
  the lesson in (low-cost, high-signal, directly tied to the "scan exceeds timeout" risk).
- **DI must use explicit `@Inject` tokens** (lessons.md) — the executor already does; any hand-built
  test instantiation passes the four deps positionally, mirroring `ssh.executor.spec.ts`.

## Historical Context (from prior changes)

From `context/archive/2026-06-16-testing-agent-diagnosis-under-failure/` (Phase 1, Risk #1) — the
directly transferable doctrine:

- **The "two seams" doctrine** (`research.md:280-285`, `plan.md:15-26`): seam (b) = mock the library
  boundary + inject pre-built errors → tests the *mapper* only (cheap); seam (a) = inject a *real*
  fake at the factory boundary → drives the real library/abort/validation (high-signal). Phase 1 put
  cheap mapper gaps in the existing file and real-wiring gaps in a **new** file. **Phase-2 transfer**:
  the SSH analog of seam (a) is overriding `SSH_CLIENT_FACTORY` with a fake `{ connect, dispose,
  execCommand }` and letting the real `SshExecutor` run its real `Promise.race`/`finally` — which
  `ssh.executor.spec.ts` already does.
- **Over-mocking is the named risk** (`research.md:56-60`): mocking the entire boundary verifies the
  mapper, not real behavior — the test-plan's "happy-path with a mock means it's safe" anti-pattern.
  Resolution was to *add* a real-boundary seam, not delete cheap ones. The SSH executor already
  avoids this by faking the transport, not the executor logic.
- **File-scoping is load-bearing** (`plan.md:130-132`): a module-level `vi.mock(...)` silently stubs
  the function under test. Not a hazard for SSH today — `ssh.executor.spec.ts` never mocks the
  `node-ssh` module; it fakes via the injected factory, sidestepping this entirely. A Phase-2
  author should keep it that way (fake the factory, don't `vi.mock('node-ssh')`).
- **No real fake-timers around real async** (`plan.md:139-140`): use a tiny *real* bound + a
  hanging fake. The SSH analog is already in place — `ssh.executor.spec.ts:81-106` uses a small real
  `commandTimeoutMs` and a never-resolving `execCommand`, asserting both `SshCommandTimeoutError` and
  that `dispose` ran.
- **Config-as-DI-token tunables with the full shape** (`research.md:286-288`): timeouts overridden
  via the config token's `useValue` supplying the whole shape. SSH equivalent: `sshConfig`
  (`{ commandTimeoutMs, connectTimeoutMs }`), already overridden positionally in the executor spec.
- **Phase 1 abort surface note** (`test-plan.md` §6.6, 2026-06-16): with `ai@6` a fired
  `AbortSignal.timeout` surfaces *bare* (`DOMException`/`TimeoutError`). Not directly applicable —
  the SSH executor uses a `setTimeout` race that rejects with its *own* `SshCommandTimeoutError`, so
  there is no SDK-wrapping ambiguity to resolve here. The error type is fully under our control.

## Related Research

- `context/archive/2026-06-16-testing-agent-diagnosis-under-failure/research.md` — Phase 1 (Risk #1),
  the fake-boundary / two-seams reference this phase mirrors.
- `context/foundation/test-plan.md` §2 (Risk #2 row + Risk Response Guidance), §6.3 (the
  "Adding an integration test (SSH executor boundary)" cookbook stub this phase will fill).
- `context/foundation/lessons.md` — "Never list containers with `docker ps --format '{{json .}}'` /
  `-s`" (the incident behind the scan command) and "Inject NestJS dependencies with an explicit
  `@Inject(Class)` token".

## Open Questions

1. **Scope decision — is Phase 2 already "done" at the unit level?** The executor's disposal +
   command-timeout are already asserted in `ssh.executor.spec.ts`. Does Phase 2 close on the
   residual gaps (a)–(d), or does the team want an *integration-level* re-assertion through a Nest
   `TestingModule` even though the unit spec already proves the structural guarantee? (Cost × signal
   question for `/10x-plan`.)
2. **Connect-timeout (gap a)** — is wall-clock-testing `readyTimeout` worth it? It's node-ssh's own
   option (we don't implement it), so a test mostly asserts node-ssh honors its own config. Likely
   low signal; flag for an explicit skip in §7 if so.
3. **Scan-/consumer-hang (gap b)** — should there be a `service.service.spec.ts` case where the
   executor never resolves, proving `scan()` surfaces a clean 504 (not a hang) end-to-end? This is
   the consumer-facing analog of the executor unit test and arguably the highest-signal new test,
   since it exercises the path the user actually hits.
4. **Scan-command regression guard (from Architecture Insights)** — add a cheap assertion that
   `SCAN_COMMAND` never reverts to `-s`/`{{json .}}`? Directly defends the "scan exceeds timeout"
   risk at near-zero cost; confirm it belongs in this phase.
5. **Truncated-line parse fragility (gap d)** — a timeout-killed scan can emit a partial NDJSON line
   that fails the *entire* scan (strict parse, no per-line try/catch). Is hardening this in scope for
   a *testing* phase, or is it a separate implementation change to be noted and deferred?
</content>
</invoke>
