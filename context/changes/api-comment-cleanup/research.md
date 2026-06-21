---
date: 2026-06-21T00:00:00Z
researcher: Karol Dydo
git_commit: 19b99ea16242bf5127cd667a16cf8705ec95832e
branch: main
repository: opspilot
topic: "Clean up and trim comments in apps/api (comments-only refactor)"
tags: [research, codebase, apps-api, comments, refactor, cleanup]
status: complete
last_updated: 2026-06-21
last_updated_by: Karol Dydo
---

# Research: Clean up and trim comments in `apps/api`

**Date**: 2026-06-21
**Researcher**: Karol Dydo
**Git Commit**: `19b99ea16242bf5127cd667a16cf8705ec95832e`
**Branch**: main
**Repository**: opspilot

> Permalink base for any reference below:
> `https://github.com/karoldydo/opspilot/blob/19b99ea16242bf5127cd667a16cf8705ec95832e/<file>#L<line>`

## Research Question

Map the comment landscape across `apps/api/src/**/*.ts` (including `*.spec.ts`) so a
comments-only cleanup can proceed: which comments **restate the code** (REMOVE), which
**explain something not visible from the code** and should be kept-and-shortened (KEEP-SHORTEN),
and which must **never be touched** (directives / risk-disclosures). Identify the per-module load,
the highest-redundancy files, and a reviewable batching plan — with zero behavior change.

## Summary

- **Total inventoried: ~301 comments** across 76 non-spec files + 29 spec files. Net classification:
  - **REMOVE: ~70** — pure restatements of obvious code; safe to delete without loss.
  - **KEEP-SHORTEN: ~227** — genuine load-bearing docs (contracts, invariants, workarounds, ordering, security boundaries); most can tighten to one sharp lowercase line.
  - **KEEP-VERBATIM / untouchable: ~4** — risk-disclosure + `lessons.md` DI-token references that read as policy, not chatter.

- **There are NO conventional "untouchable" categories present.** A dedicated sweep found **zero**
  `eslint-disable` / `ts-expect-error` / `@ts-ignore` / `prettier-ignore`, **zero** `/// <reference`
  pragmas, **zero** license/SPDX headers, **zero** JSDoc `/** */` blocks, **zero** in-comment URLs,
  and **zero** `TODO` / `FIXME` / `HACK` / `NOTE:` markers anywhere in `apps/api/src`. Every comment
  in the tree is plain explanatory prose (`//` or single-line `/* */`). → The cleanup cannot
  accidentally destroy a directive, because none exist.

- **The dominant REMOVE pattern is verbose method/class "docstrings" that restate the signature**
  (e.g. `// recent runs for a service row, newest-first and bounded` above a method literally named
  `findRecent`), plus the repeated `// project safe fields only ... validate through the shared
  contract` line that appears on nearly every `toContract` mapper.

- **The biggest cleanup wins are concentrated in a handful of service files**:
  `service.service.ts`, `diagnose.service.ts`, `run-record.service.ts`,
  `config/env.schema.ts`, and the spec `migration.service.spec.ts`.

- **The only real risk is over-eager shortening of load-bearing prose.** The KEEP-SHORTEN comments
  encode `contracts.md` / `nestjs.md` / `node-ssh.md` / `lessons.md` invariants (iso-string wire
  contract, single-active invariant, per-device mutex, tier-1/tier-2 audit, fail-fast on missing
  secret). Shorten the wording, never the meaning. Also: comments legitimately contain capitals
  where the capital is part of a code token (`Date`, `ZodError`, `NoObjectGeneratedError`,
  `X-Accel-Buffering`, `SQLite`/`SSH`/`SSE`/`WAL`/`TOFU`, identifiers like `createdAt`/`userId`) —
  those are not prose and stay under the `comments.md` lowercase rule.

## Rule Context (constraints on what stays)

From [.claude/rules/comments.md](.claude/rules/comments.md):
- All inline comments **must be entirely lowercase** — no capitalized first letter, ever, for any
  syntax (`//`, `#`, `/* */`, `<!-- -->`). Worked example: `// fetch data from api`, not `// Fetch data from API`.
- Implication: most existing comments are already lowercase-compliant; capitals that remain are
  code tokens/identifiers, which are exempt.

From [.claude/rules/nestjs.md](.claude/rules/nestjs.md) and [.claude/rules/contracts.md](.claude/rules/contracts.md):
- Neither file states a comment-style rule of its own (that lives only in `comments.md`). They
  establish **invariants that the KEEP-SHORTEN comments document** — the iso-string wire contract,
  the entity-naming 404 error rule, config-only-via-`ConfigService`, single-source-of-truth Zod
  contracts. No comment in `apps/api/src` literally cites a rule **filename**, so removing one cannot
  orphan a cross-reference; but the *content* those comments carry is the documentation of these rules.

## Detailed Findings

### Aggregate by area

| Area | Files | REMOVE | KEEP-SHORTEN | Untouchable/verbatim |
|------|------:|-------:|-------------:|---------------------:|
| `modules/*` (non-spec) | ~30 | 33 | 75 | 3 |
| `core/*` + `config/` + `common/` + `integrations/executor` + `main.ts` (non-spec) | ~32 | 14 | 61 | 1 |
| `**/*.spec.ts` | 29 | 23 | 91 | 0 |
| **Total** | **~91** | **~70** | **~227** | **~4** |

### Area 1 — `modules/*` (non-spec): REMOVE 33 / KEEP-SHORTEN 75 / verbatim 3

Per-module REMOVE counts: `service` 8, `diagnose` 8, `llm-provider` 5, `skill` 5, `audit` 4, `device` 3.

**Highest-redundancy files (most REMOVE):**
- [`modules/service/service.service.ts`](apps/api/src/modules/service/service.service.ts) — REMOVE at `:140-141` (delete-scoped restatement), `:175-177` (parseContainer docstring), `:209-210` (findOne 404 restatement), `:223-224` (toContract docstring). KEEP the dense ones: `:24-30` (explicit-field ndjson / no layer-size walk — `lessons.md` incident), `:159-164` (exit-127 locale-independent classification), `:191-193` (label split-on-first-`=`).
- [`modules/diagnose/diagnose.service.ts`](apps/api/src/modules/diagnose/diagnose.service.ts) — REMOVE at `:60-61`, `:149-151`, `:157-158`, `:163-164`, `:208-209`. KEEP the load-bearing: `:37-45` (pre-flight 404/409 before observable returned), `:85-88` (named `ping` bypasses `onmessage`), `:130-132` (persist before `done` frame), `:174-178` (executor has no per-call timeout → race).
- [`modules/diagnose/run-record.service.ts`](apps/api/src/modules/diagnose/run-record.service.ts) — REMOVE at `:22-25` (verbose class docstring), `:50`, `:67-69`, `:82-84`. KEEP `:33-36` (compute-then-write invariant in one transaction — `lessons.md`).
- [`modules/llm-provider/llm-provider.service.ts`](apps/api/src/modules/llm-provider/llm-provider.service.ts) — REMOVE at `:187` (404 restatement), `:196-198` (toContract docstring). KEEP `:31-35` and `:116-118` (single-active invariant via transaction), `:154-156`/`:167-173` (service-only decrypted-key accessors never crossing `/api`).
- [`modules/skill/skill.service.ts`](apps/api/src/modules/skill/skill.service.ts) — REMOVE at `:96-97`, `:98`, `:105` (duplicate of `:43`), `:153-155`. KEEP `:22-26` (uniqueness-per-scope check-then-write), `:36-37` (SQLite has no array type → JSON), `:91-94` (placeholder↔param parity re-validation).

**Recurring REMOVE pattern — the `toContract` docstring** (same sentence, ~6 places, keep at most a 3-word marker or drop entirely):
- [`modules/device/device.service.ts:92-93`](apps/api/src/modules/device/device.service.ts), [`modules/llm-provider/llm-provider.service.ts:196-198`](apps/api/src/modules/llm-provider/llm-provider.service.ts), [`modules/service/service.service.ts:223-224`](apps/api/src/modules/service/service.service.ts), [`modules/diagnose/run-record.service.ts:82-84`](apps/api/src/modules/diagnose/run-record.service.ts), [`modules/skill/skill.service.ts:153-155`](apps/api/src/modules/skill/skill.service.ts), [`modules/audit/audit.service.ts:118-120`](apps/api/src/modules/audit/audit.service.ts). **Note:** the *iso-string normalization* half of this sentence is a `contracts.md` invariant — if any single instance is kept, keep one and trim the rest.

**Repeated module boilerplate** — the `// global body parser disabled (main.ts: bodyParser false) ... re-apply json()` comment appears verbatim in 4 module files ([`device.module.ts:18-20`](apps/api/src/modules/device/device.module.ts), [`diagnose.module.ts:25-26`](apps/api/src/modules/diagnose/diagnose.module.ts), [`llm-provider.module.ts:19-20`](apps/api/src/modules/llm-provider/llm-provider.module.ts), [`service.module.ts:20-21`](apps/api/src/modules/service/service.module.ts), [`skill.module.ts:27-29`](apps/api/src/modules/skill/skill.module.ts)). It is a real gotcha (KEEP), but should collapse to one tight lowercase line each, identical wording.

**Verbatim/untouchable in modules (3):** the `// explicit @Inject tokens — esbuild/vitest drops design:paramtypes ... (lessons.md)` references at [`diagnose.service.ts:24-25`](apps/api/src/modules/diagnose/diagnose.service.ts), [`skill-run.service.ts:36-37`](apps/api/src/modules/skill/skill-run.service.ts), [`skill.seed.ts:50-51`](apps/api/src/modules/skill/skill.seed.ts). These document a `lessons.md` rule that the tests depend on — keep the fact, may tighten wording.

### Area 2 — `core/*` + `config/` + `common/` + `integrations/executor` + `main.ts`: REMOVE 14 / KEEP-SHORTEN 61 / verbatim 1

**Highest-redundancy file:** [`config/env.schema.ts`](apps/api/src/config/env.schema.ts) — 10 of its comments are REMOVE (field descriptions that restate the Joi var name): `:28`, `:37`, `:39`, `:45`, `:58`, `:60` are the clearest deletes. KEEP the ones that carry a non-obvious fact: `:26`/`:35` (no default — fail fast on missing secret), `:32-33` (hard ceiling enforced separately by `credentialListQuerySchema`), `:41` (logs timeout distinct from `SSH_COMMAND_TIMEOUT_MS`), `:43` (keeps run < 15s), `:49` (seconds, better-auth defaults), `:52-54` (skill run overrides ssh timeout), `:56` (hand-rolled race; node-ssh has none).

**`core/database/` — all 12 KEEP-SHORTEN, none REMOVE.** Dense with genuine invariants worth tightening:
[`database-connection.provider.ts:15-16`](apps/api/src/core/database/database-connection.provider.ts) (synchronous driver — no await), `:22` (better-sqlite3 doesn't create parent dir), `:28-29` (WAL + FK pragmas);
[`migration.service.ts:39-40`](apps/api/src/core/database/migration.service.ts) (backup only when migrations pending), `:45-47` (flattened-iso filename — Windows-illegal colons + pid suffix + sort), `:50` (WAL-aware backup; `fs.copyFile` misses the `-wal` sidecar), `:56-57` (absent `__drizzle_migrations` table = zero applied).

**`integrations/executor/` — 24 comments, 20 KEEP / 2 REMOVE / 1 verbatim:**
- REMOVE: [`executor.errors.ts:30`](apps/api/src/integrations/executor/executor.errors.ts) and `:37` (class-name restatements), [`ssh.executor.ts:36`](apps/api/src/integrations/executor/ssh.executor.ts) (findOne 404 restatement).
- **Verbatim/untouchable (1):** [`ssh.executor.ts:44-47`](apps/api/src/integrations/executor/ssh.executor.ts) — the **TOFU host-key risk-acceptance disclosure** (`accepted risk: no hostVerifier/hostHash ... see node-ssh.md "host keys"`). This is a deliberate security-policy statement; keep it intact.
- KEEP-SHORTEN highlights: [`executor.token.ts:1-3`](apps/api/src/integrations/executor/executor.token.ts) (interface DI resolves undefined under esbuild → explicit token), [`ssh.executor.ts:67-68`](apps/api/src/integrations/executor/ssh.executor.ts) (finally clears timer + disposes — the "no run hangs" NFR), `:72-73` (swallow dispose error so it doesn't mask the connect error), `:115-118` (race-free get-or-create mutex; no await between get/set).

**`main.ts` (1, KEEP-SHORTEN):** [`main.ts:8-10`](apps/api/src/main.ts) — bodyParser disabled globally for better-auth's raw body; the source-of-truth for the duplicated module comments above.

**`core/auth/`, `core/credential/`, `core/crypto/`, `common/` — almost all KEEP-SHORTEN:** security and contract invariants (plaintext never crosses `/api` at [`credential.service.ts:62-64`](apps/api/src/core/credential/credential.service.ts); GCM `setAuthTag` before `final()` at [`crypto.service.ts:29-30`](apps/api/src/core/crypto/crypto.service.ts); single-source better-auth config at [`create-auth.ts:14-17`](apps/api/src/core/auth/create-auth.ts)). Only REMOVE here: [`auth.guard.ts:23`](apps/api/src/core/auth/auth.guard.ts) (allowlist-checked-first restatement), [`env.schema.ts`] fields above.

### Area 3 — `**/*.spec.ts`: REMOVE 23 / KEEP-SHORTEN 91 / untouchable 0

**Highest REMOVE load:**
- [`core/database/migration.service.spec.ts`](apps/api/src/core/database/migration.service.spec.ts) — 4 REMOVE (`:20`, `:31`, `:47`, `:117-118` — fixture-builder and test-math restatements). KEEP the gate/retention edge cases (`:90`, `:100-101` "f3 fix", `:111-112` sort-order seed).
- [`modules/diagnose/diagnose.controller.spec.ts`](apps/api/src/modules/diagnose/diagnose.controller.spec.ts) — 2 REMOVE (`:128-129` audit-fk seed restatement). KEEP `:29-34` (stub `streamObject` but keep real `NoObjectGeneratedError` for `.isInstance` narrowing) and the SSE-frame parsing notes.

**Two big KEEP families in specs (shorten, don't delete):**
1. **The "fake guard" / "unwired AuthAppGuard" e2e preamble** — repeated near-verbatim across every controller spec ([`audit.controller.spec.ts:23-25`](apps/api/src/modules/audit/audit.controller.spec.ts), [`device.controller.spec.ts:21-26`](apps/api/src/modules/device/device.controller.spec.ts), [`llm-provider.controller.spec.ts:18-22`](apps/api/src/modules/llm-provider/llm-provider.controller.spec.ts), [`service.controller.spec.ts:21-25`](apps/api/src/modules/service/service.controller.spec.ts), [`skill.controller.spec.ts:17-22`](apps/api/src/modules/skill/skill.controller.spec.ts), [`skill-run.controller.spec.ts:23-26`](apps/api/src/modules/skill/skill-run.controller.spec.ts), [`diagnose.controller.spec.ts:62-66`](apps/api/src/modules/diagnose/diagnose.controller.spec.ts)). Explains *why* the guard is bypassed (covered separately in `auth.guard.spec.ts` / `auth.boundary.spec.ts`) and why a middleware fakes the session for `@CurrentUserId` audit writes. Collapse each to one identical tight line.
2. **The FK-seed comments** — `// seed the audit fk target — audit_log.userId references user.id` and siblings appear ~20+ times across specs. They document the not-null/cascade FK invariant. Keep a single canonical short form; the few that merely restate a variable name (e.g. [`skill-run.controller.spec.ts:94-95`](apps/api/src/modules/skill/skill-run.controller.spec.ts), [`diagnose.controller.spec.ts:128-129`](apps/api/src/modules/diagnose/diagnose.controller.spec.ts)) are REMOVE.

**Genuinely high-signal spec comments to KEEP (illustrative):**
- [`auth.boundary.spec.ts:16-23`](apps/api/src/core/auth/auth.boundary.spec.ts) — the only wire-level proof the global `APP_GUARD` is wired + `@Public` allowlist pinned to Auth+Health.
- [`modules/service/service.service.spec.ts:186-190`](apps/api/src/modules/service/service.service.spec.ts) and `:202-206` — locks the `lessons.md` `docker ps -s` incident and documents the deferred per-line-parse fix ("do not fix from this test").
- [`modules/diagnose/diagnose.service.spec.ts:276-282`](apps/api/src/modules/diagnose/diagnose.service.spec.ts) — timeout wrapped inside `NoObjectGeneratedError` must classify as timeout, not synthesis failure.
- [`llm-provider.client-factory.spec.ts:11-17`](apps/api/src/modules/llm-provider/llm-provider.client-factory.spec.ts) — the `supportsStructuredOutputs` reliability assertion.

### The untouchable / verbatim sweep (separate confirmation)

A dedicated grep over **all 105 files** (specs included) for the conventional protected categories returned **empty** in every category:
- tooling directives (`eslint-disable*`, `ts-expect-error`, `@ts-ignore`, `@ts-nocheck`, `prettier-ignore`): **none**
- triple-slash `/// <reference` pragmas: **none**
- license / copyright / SPDX headers: **none**
- JSDoc `/** */` blocks: **none** (every comment is `//` or single-line `/* */`)
- URLs inside comments: **none** (all `http(s)://` hits are string literals — config values, fixtures, the `main.ts` startup-log template — not comment text)
- `TODO` / `FIXME` / `HACK` / `NOTE:` markers: **none**

The only comments to treat as **keep-verbatim policy** are the 4 prose statements that read as risk/decision records, not chatter: the TOFU disclosure ([`ssh.executor.ts:44-47`](apps/api/src/integrations/executor/ssh.executor.ts)) and the 3 `lessons.md` `@Inject`-token references in `modules/*`.

## Code References

- [`apps/api/src/config/env.schema.ts`](apps/api/src/config/env.schema.ts) — heaviest REMOVE density (10 field-restatement comments); `:28,37,39,45,58,60` delete first.
- [`apps/api/src/modules/service/service.service.ts`](apps/api/src/modules/service/service.service.ts) — 6 REMOVE + dense KEEP (lessons.md ndjson incident at `:24-30`, exit-127 classification at `:159-164`).
- [`apps/api/src/modules/diagnose/diagnose.service.ts`](apps/api/src/modules/diagnose/diagnose.service.ts) — 6 REMOVE; SSE / pre-flight / persist-ordering invariants to keep-shorten.
- [`apps/api/src/modules/diagnose/run-record.service.ts`](apps/api/src/modules/diagnose/run-record.service.ts) — verbose class docstring (`:22-25`) REMOVE; compute-then-write invariant (`:33-36`) KEEP.
- [`apps/api/src/main.ts:8-10`](apps/api/src/main.ts) — bodyParser invariant (source for the duplicated module comments).
- [`apps/api/src/integrations/executor/ssh.executor.ts:44-47`](apps/api/src/integrations/executor/ssh.executor.ts) — TOFU host-key risk disclosure — KEEP VERBATIM.
- [`apps/api/src/core/database/migration.service.ts`](apps/api/src/core/database/migration.service.ts) — 12 KEEP-SHORTEN invariants (WAL backup, filename sort, table-absent semantics).
- [`apps/api/src/core/database/migration.service.spec.ts`](apps/api/src/core/database/migration.service.spec.ts) — heaviest spec REMOVE load (4).

## Architecture Insights

- **Comments here are unusually high-quality.** The ratio is ~3:1 KEEP-SHORTEN to REMOVE — most
  comments document a real `contracts.md` / `nestjs.md` / `node-ssh.md` / `lessons.md` invariant.
  This is a *trim-and-tighten* job far more than a *delete* job. The change.md framing ("remove
  redundant + shorten the rest") matches the data exactly.
- **Three deletable patterns dominate REMOVE:** (1) verbose method/class docstrings that restate the
  signature; (2) the repeated `toContract` "project safe fields ... validate through the shared
  contract" sentence; (3) `env.schema.ts` field descriptions that echo the Joi var name.
- **Three KEEP patterns recur and should be normalized to one identical tight line each:** the
  bodyParser-disabled module note (5×), the "unwired AuthAppGuard / fake guard" e2e preamble (7×),
  and the FK-seed note (~20×). Normalizing wording is itself part of the cleanup value.
- **No formatting/code risk:** since there are no directives, JSDoc, or pragmas, lint/test/format
  cannot break on a directive removal. The only failure mode is a `format:check` reflow if a
  multi-line `/* */` is edited carelessly, or an accidental edit to a non-comment line.

## Suggested batching plan (reviewable diffs, per change.md)

Order by independence and risk, smallest blast radius first:

1. **`config/`** — highest REMOVE density, self-contained, no cross-file meaning. (REMOVE ~10, KEEP ~11)
2. **`common/` + `core/auth` + `core/crypto`** — small, mostly KEEP-SHORTEN security prose. (REMOVE ~2)
3. **`core/database`** — all KEEP-SHORTEN; pure tightening, no deletes. (12 comments)
4. **`core/credential`** — KEEP-SHORTEN security boundaries. (REMOVE ~1)
5. **`integrations/executor`** — 20 KEEP / 2 REMOVE / **1 verbatim (TOFU — do not touch)**.
6. **`modules/*`** — one batch per module (`audit`, `device`, `diagnose`, `llm-provider`, `service`, `skill`); `service` and `diagnose` carry the most REMOVE. Normalize the 3 recurring KEEP patterns here.
7. **`**/*.spec.ts`** — last; biggest volume (91 KEEP / 23 REMOVE). Normalize the fake-guard preamble and FK-seed notes; delete the fixture-builder/test-math restatements.

**Definition of done (from change.md):** `npx nx lint api` + `npx nx test api` pass unchanged;
`git diff` shows comment lines only; `npm run format:check` clean for `apps/api`.

## Historical Context (from prior changes)

- [`context/foundation/lessons.md`](context/foundation/lessons.md) — five accepted rules that the
  KEEP-SHORTEN comments encode: config-tunables-not-`const`s; iso-string wire contract; explicit
  `@Inject` tokens (esbuild drops `design:paramtypes`); compute-then-write in one transaction;
  never `docker ps --format '{{json .}}'`/`-s`. Any comment referencing these documents a real,
  team-accepted lesson — preserve the fact when shortening.
- The repo's recent history is a run of test/characterization closes
  (`testing-security-guardrails`, `testing-ssh-executor-lifecycle-timeout`), which is why the spec
  files carry such dense, deliberate comments — many are characterization notes, not chatter.

## Related Research

- No prior `research.md` exists for a comment/style cleanup in `context/changes/**/` or
  `context/archive/**/`. This is the first.

## Open Questions

1. **How aggressively to normalize the 3 recurring KEEP patterns?** Options: (a) collapse each to an
   identical one-liner in place, or (b) keep the note on the first/canonical occurrence only and drop
   the rest. (b) reduces line count more but loses local context in specs that run standalone — lean (a).
2. **Should the verbose `toContract` docstring be fully removed or kept as a 3-word marker?** The
   iso-string-normalization fact is a `contracts.md` invariant; recommendation: keep one canonical
   short form (e.g. `// project safe fields; iso-normalize timestamps; never spread`) and delete the
   duplicates.
3. **Spec FK-seed notes — single canonical wording?** ~20 occurrences; agreeing one short form
   (`// seed fk target (user.id)`) before editing keeps the diff mechanical and the review trivial.
</content>
</invoke>
