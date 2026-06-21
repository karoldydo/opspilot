# Clean up and trim comments in `apps/api` — Implementation Plan

## Overview

A comments-only refactor of `apps/api/src/**/*.ts` (including `*.spec.ts`): delete comments that
restate the code, shorten the ones that carry real meaning to a single sharp lowercase line, and
leave the handful of risk/decision records intact. **Zero behavior change** — the diff touches
comment lines only. The work is organized into 6 phases for reviewable progress, but lands as a
**single commit** (`docs(api): clean up and trim comments`) per the user's decision.

## Current State Analysis

The comment landscape is already mapped in `context/changes/api-comment-cleanup/research.md`
(complete, git_commit `19b99ea`). Key facts that drive this plan:

- **~301 comments** across ~91 non-spec files + 29 spec files. Net classification:
  **~70 REMOVE**, **~227 KEEP-SHORTEN**, **~4 keep-verbatim**.
- **No conventional untouchable categories exist.** A dedicated sweep found zero `eslint-disable` /
  `ts-expect-error` / `@ts-ignore` / `prettier-ignore`, zero `/// <reference` pragmas, zero
  license/SPDX headers, zero JSDoc `/** */` blocks, zero in-comment URLs, zero `TODO/FIXME/HACK/NOTE:`
  markers. The cleanup cannot destroy a directive because none exist.
- **The ratio is ~3:1 KEEP-SHORTEN to REMOVE** — this is a *trim-and-tighten* job, not a delete job.
  Most comments document a real `contracts.md` / `nestjs.md` / `node-ssh.md` / `lessons.md` invariant.
- **All comments are `//` or single-line `/* */`.** Capitals that remain after editing are code
  tokens / identifiers (`Date`, `ZodError`, `NoObjectGeneratedError`, `X-Accel-Buffering`,
  `SQLite`/`SSH`/`SSE`/`WAL`/`TOFU`, `createdAt`/`userId`) — exempt from the `comments.md` lowercase rule.

### Key Discoveries:

- **3 dominant REMOVE patterns:** (1) verbose method/class docstrings that restate the signature;
  (2) the repeated `toContract` "project safe fields … validate through the shared contract" sentence
  (~6 places); (3) `env.schema.ts` field descriptions that echo the Joi var name (~10).
- **3 recurring KEEP patterns to normalize to one identical line each:** the bodyParser-disabled
  module note (5×), the "unwired AuthAppGuard / fake guard" e2e preamble (7×), the FK-seed note (~20×).
- **4 keep-verbatim records:** the TOFU host-key risk disclosure at
  `apps/api/src/integrations/executor/ssh.executor.ts:44-47`, and the 3 `@Inject`-token / `lessons.md`
  references at `diagnose.service.ts:24-25`, `skill/skill-run.service.ts:36-37`, `skill/skill.seed.ts:50-51`.
- **Highest-density files:** `env.schema.ts`, `service.service.ts`, `diagnose.service.ts`,
  `run-record.service.ts`, `migration.service.spec.ts`.

## Desired End State

`apps/api/src` carries only comments that explain something not visible from the code, each a minimal
lowercase line; redundant restatements are gone; the 4 verbatim records are untouched. Verified by:
`npx nx lint api` and `npx nx test api` pass exactly as before; `npm run format:check` is clean for
`apps/api`; `git diff` shows comment-line changes only (no executable code, names, signatures, imports,
or non-comment formatting changed).

## What We're NOT Doing

- **No changes to executable code** — no renames, signature/import changes, no code-formatting changes
  outside the comment line itself.
- **No changes outside `apps/api/src`** — `apps/web`, `libs/shared`, and any config outside `apps/api`
  are out of scope.
- **No touching the 4 keep-verbatim records** beyond leaving them exactly as-is.
- **No multi-line `/* */` reflow** that could trigger a `format:check` change — edit comment text only.
- **No new comments** beyond the normalized canonical forms replacing existing ones.

## Implementation Approach

Work phase-by-phase in the research's batching order (smallest blast radius first), editing comment
lines in place. Within each phase: delete the REMOVE comments, tighten KEEP-SHORTEN to one lowercase
line, and apply the agreed canonical forms for the recurring patterns. After each phase run a quick
local diff check to confirm only comment lines moved. Defer the single commit to the final phase after
full verification.

**Agreed canonical forms (apply consistently):**
- **bodyParser module note** (5× in `*.module.ts`): one identical lowercase line, e.g.
  `// global body parser disabled in main.ts (better-auth raw body); re-apply json() here`.
- **fake-guard e2e preamble** (7× in `*.controller.spec.ts`): one identical lowercase line, e.g.
  `// guard faked here; real auth boundary is covered in auth.guard.spec.ts / auth.boundary.spec.ts`.
- **FK-seed note** (~20× in specs): fuller form with the table reference, lowercase, e.g.
  `// seed audit fk target — audit_log.userId → user.id` (vary the table/column to match the actual FK).
- **`toContract` docstring** (~6×): keep one canonical short form, e.g.
  `// project safe fields; iso-normalize timestamps; never spread`, delete the duplicates.

## Critical Implementation Details

- **Keep-verbatim guard.** Four locations must survive untouched: the TOFU disclosure at
  `ssh.executor.ts:44-47` and the 3 `@Inject`/`lessons.md` references (`diagnose.service.ts:24-25`,
  `skill-run.service.ts:36-37`, `skill.seed.ts:50-51`). Wording of the 3 `@Inject` notes *may* tighten
  but the fact (esbuild/vitest drops `design:paramtypes` → explicit token) must remain; the TOFU
  disclosure stays exactly as-is.
- **Lowercase rule nuance.** Remaining capitals are code tokens/identifiers and are exempt
  (`comments.md`). Do not lowercase `Date`, `ZodError`, `SQLite`, `createdAt`, etc.
- **Format risk.** The only way `format:check` breaks is careless editing of a multi-line `/* */` or
  an accidental edit to a non-comment line. Edit comment text only; re-check the diff per phase.

---

## Phase 1: `config/`

### Overview

Highest REMOVE density, self-contained, no cross-file meaning. Delete the ~10 field-restatement
comments in `env.schema.ts`; keep-shorten the ones carrying a non-obvious fact.

### Changes Required:

#### 1. Env schema

**File**: `apps/api/src/config/env.schema.ts`

**Intent**: Delete field-description comments that merely echo the Joi var name (`:28, :37, :39, :45,
:58, :60` are the clearest); tighten to one lowercase line the comments that carry a real fact.

**Contract**: KEEP-SHORTEN (fact must survive): `:26`/`:35` (no default — fail fast on missing secret),
`:32-33` (hard ceiling enforced separately by `credentialListQuerySchema`), `:41` (logs timeout
distinct from `SSH_COMMAND_TIMEOUT_MS`), `:43` (keeps run < 15s), `:49` (seconds, better-auth defaults),
`:52-54` (skill run overrides ssh timeout), `:56` (hand-rolled race; node-ssh has none). No executable
change to any Joi rule.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npx nx lint api`
- Tests pass: `npx nx test api`
- Format clean: `npm run format:check`
- Diff is comment-only for `apps/api/src/config/`: `git diff -- apps/api/src/config/` shows only comment lines

#### Manual Verification:

- Spot-check that every kept `env.schema.ts` comment states a fact not visible from the var name

---

## Phase 2: `core/` + `common/`

### Overview

`core/auth`, `core/crypto`, `core/database`, `core/credential`, and `common/` — mostly KEEP-SHORTEN
security/contract prose. `core/database` is pure tightening (12 comments, no deletes).

### Changes Required:

#### 1. core/database (tightening only)

**File**: `apps/api/src/core/database/database-connection.provider.ts`, `apps/api/src/core/database/migration.service.ts`

**Intent**: Shorten each invariant to one lowercase line; delete nothing.

**Contract**: KEEP-SHORTEN: synchronous driver (no await), better-sqlite3 doesn't create parent dir,
WAL+FK pragmas; backup only when migrations pending, flattened-iso filename (Windows-illegal colons +
pid suffix + sort), WAL-aware backup (`fs.copyFile` misses `-wal` sidecar), absent
`__drizzle_migrations` table = zero applied.

#### 2. core/auth, core/crypto, core/credential, common/

**File**: `apps/api/src/core/auth/auth.guard.ts`, `apps/api/src/core/auth/create-auth.ts`, `apps/api/src/core/crypto/crypto.service.ts`, `apps/api/src/core/credential/credential.service.ts`, `apps/api/src/common/**`

**Intent**: Delete the few REMOVE restatements (`auth.guard.ts:23` allowlist-checked-first); tighten the
security/contract invariants to one lowercase line each.

**Contract**: KEEP-SHORTEN: plaintext never crosses `/api` (`credential.service.ts:62-64`), GCM
`setAuthTag` before `final()` (`crypto.service.ts:29-30`), single-source better-auth config
(`create-auth.ts:14-17`). No executable change.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npx nx lint api`
- Tests pass: `npx nx test api`
- Format clean: `npm run format:check`
- Diff is comment-only for `core/` + `common/`: `git diff -- apps/api/src/core/ apps/api/src/common/` shows only comment lines

#### Manual Verification:

- Confirm every security invariant (plaintext boundary, GCM tag ordering, WAL backup) still reads clearly after shortening

---

## Phase 3: `integrations/executor/`

### Overview

20 KEEP / 2 REMOVE / **1 keep-verbatim**. The TOFU host-key disclosure must survive untouched.

### Changes Required:

#### 1. Executor files

**File**: `apps/api/src/integrations/executor/executor.errors.ts`, `apps/api/src/integrations/executor/ssh.executor.ts`, `apps/api/src/integrations/executor/executor.token.ts`

**Intent**: Remove the 2 restatements (`executor.errors.ts:30` and `:37` class-name restatements,
`ssh.executor.ts:36` findOne 404 restatement); tighten the lifecycle/mutex invariants. **Leave the
TOFU disclosure at `ssh.executor.ts:44-47` exactly as-is.**

**Contract**: KEEP-VERBATIM: `ssh.executor.ts:44-47` (TOFU `accepted risk: no hostVerifier/hostHash …
see node-ssh.md "host keys"`). KEEP-SHORTEN: `executor.token.ts:1-3` (interface DI resolves undefined
under esbuild → explicit token), `ssh.executor.ts:67-68` (finally clears timer + disposes — no run
hangs), `:72-73` (swallow dispose error so it doesn't mask connect error), `:115-118` (race-free
get-or-create mutex; no await between get/set).

### Success Criteria:

#### Automated Verification:

- Lint passes: `npx nx lint api`
- Tests pass: `npx nx test api`
- Format clean: `npm run format:check`
- TOFU disclosure unchanged: `git diff -- apps/api/src/integrations/executor/ssh.executor.ts` shows the `:44-47` block untouched
- Diff is comment-only: `git diff -- apps/api/src/integrations/executor/` shows only comment lines

#### Manual Verification:

- Visually confirm the TOFU risk disclosure is byte-identical to before

---

## Phase 4: `modules/*`

### Overview

Six modules (`audit`, `device`, `diagnose`, `llm-provider`, `service`, `skill`). Carries the most
REMOVE plus two of the three recurring-pattern normalizations (bodyParser note, `toContract`
docstring) and the 3 `@Inject` keep-verbatim references.

### Changes Required:

#### 1. Service files (heaviest REMOVE)

**File**: `apps/api/src/modules/service/service.service.ts`, `apps/api/src/modules/diagnose/diagnose.service.ts`, `apps/api/src/modules/diagnose/run-record.service.ts`, `apps/api/src/modules/llm-provider/llm-provider.service.ts`, `apps/api/src/modules/skill/skill.service.ts`, `apps/api/src/modules/audit/audit.service.ts`, `apps/api/src/modules/device/device.service.ts`

**Intent**: Delete the verbose docstrings that restate signatures and the findOne-404 restatements;
keep-shorten the dense load-bearing invariants. Apply the canonical `toContract` form once and delete
its duplicates.

**Contract**: REMOVE examples: `service.service.ts:140-141, :175-177, :209-210, :223-224`;
`diagnose.service.ts:60-61, :149-151, :157-158, :163-164, :208-209`; `run-record.service.ts:22-25, :50,
:67-69, :82-84`. KEEP-SHORTEN (fact survives): explicit-field ndjson / no layer-size walk
(`service.service.ts:24-30`), exit-127 locale-independent classification (`:159-164`), label split-on-
first-`=` (`:191-193`); SSE pre-flight 404/409 (`diagnose.service.ts:37-45`), named `ping` bypasses
`onmessage` (`:85-88`), persist before `done` frame (`:130-132`), executor has no per-call timeout →
race (`:174-178`); compute-then-write in one transaction (`run-record.service.ts:33-36`); single-active
invariant via transaction (`llm-provider.service.ts:31-35, :116-118`), service-only decrypted-key
accessors (`:154-156, :167-173`); uniqueness-per-scope check-then-write (`skill.service.ts:22-26`),
SQLite has no array type → JSON (`:36-37`), placeholder↔param parity re-validation (`:91-94`).
**`toContract` canonical form** (one place, delete the rest at `device.service.ts:92-93`,
`llm-provider.service.ts:196-198`, `service.service.ts:223-224`, `run-record.service.ts:82-84`,
`skill.service.ts:153-155`, `audit.service.ts:118-120`): `// project safe fields; iso-normalize
timestamps; never spread`.

#### 2. Module files — bodyParser note normalization

**File**: `apps/api/src/modules/device/device.module.ts`, `apps/api/src/modules/diagnose/diagnose.module.ts`, `apps/api/src/modules/llm-provider/llm-provider.module.ts`, `apps/api/src/modules/service/service.module.ts`, `apps/api/src/modules/skill/skill.module.ts`

**Intent**: Collapse the duplicated bodyParser gotcha to one identical tight lowercase line in each of
the 5 module files (same wording everywhere).

**Contract**: Canonical line: `// global body parser disabled in main.ts (better-auth raw body);
re-apply json() here`. The `main.ts:8-10` source-of-truth comment is tightened in Phase 5/this phase's
`main.ts` touch — see note below.

#### 3. Keep-verbatim `@Inject` references

**File**: `apps/api/src/modules/diagnose/diagnose.service.ts`, `apps/api/src/modules/skill/skill-run.service.ts`, `apps/api/src/modules/skill/skill.seed.ts`

**Intent**: Preserve the fact (esbuild/vitest drops `design:paramtypes` → explicit `@Inject` tokens,
`lessons.md`); wording may tighten but the lesson reference must remain.

**Contract**: `diagnose.service.ts:24-25`, `skill-run.service.ts:36-37`, `skill.seed.ts:50-51`.

#### 4. `main.ts`

**File**: `apps/api/src/main.ts`

**Intent**: Tighten the bodyParser source-of-truth comment (`:8-10`) to one lowercase line — it is the
canonical explanation the module notes point back to.

**Contract**: KEEP-SHORTEN: bodyParser disabled globally for better-auth's raw body.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npx nx lint api`
- Tests pass: `npx nx test api`
- Format clean: `npm run format:check`
- `toContract` appears once: `git grep -c "project safe fields" -- apps/api/src/modules/` returns 1
- bodyParser note identical across modules: `git grep -h "global body parser disabled" -- apps/api/src/modules/` shows one unique line
- 3 `@Inject` references survive: `git grep -l "design:paramtypes" -- apps/api/src/modules/` lists the 3 files
- Diff is comment-only: `git diff -- apps/api/src/modules/ apps/api/src/main.ts` shows only comment lines

#### Manual Verification:

- Confirm each module's bodyParser line is byte-identical
- Confirm the 3 `@Inject` lesson references still convey the esbuild/`design:paramtypes` fact

---

## Phase 5: `**/*.spec.ts`

### Overview

Largest volume (91 KEEP / 23 REMOVE). Normalize the fake-guard e2e preamble (7×) and the FK-seed note
(~20×); delete the fixture-builder / test-math restatements.

### Changes Required:

#### 1. Controller specs — fake-guard preamble normalization

**File**: `apps/api/src/modules/audit/audit.controller.spec.ts`, `apps/api/src/modules/device/device.controller.spec.ts`, `apps/api/src/modules/llm-provider/llm-provider.controller.spec.ts`, `apps/api/src/modules/service/service.controller.spec.ts`, `apps/api/src/modules/skill/skill.controller.spec.ts`, `apps/api/src/modules/skill/skill-run.controller.spec.ts`, `apps/api/src/modules/diagnose/diagnose.controller.spec.ts`

**Intent**: Collapse the repeated "unwired AuthAppGuard / fake guard" e2e preamble to one identical
lowercase line in each spec.

**Contract**: Canonical line: `// guard faked here; real auth boundary is covered in auth.guard.spec.ts
/ auth.boundary.spec.ts`. Locations: `audit:23-25`, `device:21-26`, `llm-provider:18-22`,
`service:21-25`, `skill:17-22`, `skill-run:23-26`, `diagnose:62-66`.

#### 2. FK-seed note normalization + restatement deletes

**File**: spec files across `apps/api/src/modules/**` and `apps/api/src/core/**`

**Intent**: Apply the fuller FK-seed canonical form (with table reference) everywhere the note is real;
delete the few that merely restate a variable name.

**Contract**: Canonical form (vary table/column to the actual FK), lowercase:
`// seed audit fk target — audit_log.userId → user.id`. REMOVE (variable-name restatements):
`skill-run.controller.spec.ts:94-95`, `diagnose.controller.spec.ts:128-129`.

#### 3. Highest-REMOVE specs

**File**: `apps/api/src/core/database/migration.service.spec.ts`, `apps/api/src/modules/diagnose/diagnose.controller.spec.ts`

**Intent**: Delete fixture-builder / test-math restatements; keep the gate/retention edge-case notes
and the characterization notes that lock `lessons.md` incidents.

**Contract**: REMOVE: `migration.service.spec.ts:20, :31, :47, :117-118`. KEEP: `:90, :100-101` ("f3
fix"), `:111-112` (sort-order seed); `diagnose.controller.spec.ts:29-34` (stub `streamObject`, keep real
`NoObjectGeneratedError` for `.isInstance` narrowing). KEEP (illustrative high-signal, shorten only):
`auth.boundary.spec.ts:16-23`, `service.service.spec.ts:186-190` and `:202-206`,
`diagnose.service.spec.ts:276-282`, `llm-provider.client-factory.spec.ts:11-17`.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npx nx lint api`
- Tests pass: `npx nx test api`
- Format clean: `npm run format:check`
- fake-guard preamble identical: `git grep -h "guard faked here" -- apps/api/src/**/*.spec.ts` shows one unique line
- Diff is comment-only: `git diff -- 'apps/api/src/**/*.spec.ts'` shows only comment lines

#### Manual Verification:

- Confirm characterization notes (`docker ps -s` incident, timeout-as-`NoObjectGeneratedError`) still read clearly
- Confirm no test assertion or fixture value changed

---

## Phase 6: Final verification + single commit

### Overview

Whole-tree verification, then land everything as one commit.

### Changes Required:

#### 1. No code changes — verification + commit only

**File**: n/a

**Intent**: Run the full Definition of Done across `apps/api`, confirm the diff is comment-only
tree-wide, then commit once.

**Contract**: Commit subject: `docs(api): clean up and trim comments`. Body notes the single-commit
deviation from change.md's per-batch batching (user decision). Update `change.md` status to reflect
completion as part of the close-out (not in this commit's code scope).

### Success Criteria:

#### Automated Verification:

- Lint passes tree-wide: `npx nx lint api`
- Tests pass tree-wide: `npx nx test api`
- Format clean: `npm run format:check`
- No executable-line changes anywhere: `git diff -- apps/api/src` reviewed; only comment lines changed
- Single commit landed: `git log -1 --pretty=format:'%s'` shows `docs(api): clean up and trim comments`

#### Manual Verification:

- Final read-through of `git diff` confirms zero behavior change and the 4 verbatim records intact

---

## Testing Strategy

### Unit Tests:

- No new tests. The existing `apps/api` suite is the regression guard — it must pass identically
  before and after.

### Integration Tests:

- Covered by the existing controller/service specs run via `npx nx test api`.

### Manual Testing Steps:

1. Run `npx nx test api` before starting; note pass/fail baseline.
2. After each phase, `git diff -- <phase paths>` and confirm only comment lines changed.
3. After Phase 6, run the full `npx nx lint api && npx nx test api && npm run format:check`.
4. Grep-verify the 3 normalized patterns are each a single canonical line, and the 4 verbatim records are intact.

## Performance Considerations

None — comments-only change, no runtime impact.

## Migration Notes

None — no data or schema changes.

## References

- Research: `context/changes/api-comment-cleanup/research.md`
- Change identity: `context/changes/api-comment-cleanup/change.md`
- Comment style rule: `.claude/rules/comments.md`
- Invariant sources: `.claude/rules/contracts.md`, `.claude/rules/nestjs.md`, `.claude/rules/node-ssh.md`, `context/foundation/lessons.md`
- TOFU verbatim: `apps/api/src/integrations/executor/ssh.executor.ts:44-47`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: config/

#### Automated

- [x] 1.1 Lint passes: `npx nx lint api`
- [x] 1.2 Tests pass: `npx nx test api`
- [x] 1.3 Format clean: `npm run format:check`
- [x] 1.4 Diff is comment-only for `apps/api/src/config/`

#### Manual

- [x] 1.5 Spot-check every kept `env.schema.ts` comment states a non-obvious fact

### Phase 2: core/ + common/

#### Automated

- [x] 2.1 Lint passes: `npx nx lint api`
- [x] 2.2 Tests pass: `npx nx test api`
- [x] 2.3 Format clean: `npm run format:check`
- [x] 2.4 Diff is comment-only for `core/` + `common/`

#### Manual

- [x] 2.5 Security invariants (plaintext boundary, GCM tag ordering, WAL backup) still read clearly

### Phase 3: integrations/executor/

#### Automated

- [x] 3.1 Lint passes: `npx nx lint api`
- [x] 3.2 Tests pass: `npx nx test api`
- [x] 3.3 Format clean: `npm run format:check`
- [x] 3.4 TOFU disclosure (`ssh.executor.ts:44-47`) unchanged
- [x] 3.5 Diff is comment-only for `integrations/executor/`

#### Manual

- [x] 3.6 TOFU risk disclosure visually confirmed byte-identical

### Phase 4: modules/*

#### Automated

- [x] 4.1 Lint passes: `npx nx lint api`
- [x] 4.2 Tests pass: `npx nx test api`
- [x] 4.3 Format clean: `npm run format:check`
- [x] 4.4 `toContract` canonical form appears once in `modules/`
- [x] 4.5 bodyParser note identical across the 5 module files
- [x] 4.6 3 `@Inject` / `design:paramtypes` references survive
- [x] 4.7 Diff is comment-only for `modules/` + `main.ts`

#### Manual

- [x] 4.8 bodyParser line byte-identical per module; `@Inject` lesson references intact

### Phase 5: **/*.spec.ts

#### Automated

- [x] 5.1 Lint passes: `npx nx lint api`
- [x] 5.2 Tests pass: `npx nx test api`
- [x] 5.3 Format clean: `npm run format:check`
- [x] 5.4 fake-guard preamble identical across specs
- [x] 5.5 Diff is comment-only for `**/*.spec.ts`

#### Manual

- [x] 5.6 Characterization notes still clear; no assertion/fixture value changed

### Phase 6: Final verification + single commit

#### Automated

- [x] 6.1 Lint passes tree-wide: `npx nx lint api`
- [x] 6.2 Tests pass tree-wide: `npx nx test api`
- [x] 6.3 Format clean: `npm run format:check`
- [x] 6.4 No executable-line changes anywhere in `apps/api/src`
- [x] 6.5 Single commit landed (`docs(api): clean up and trim comments`)

#### Manual

- [x] 6.6 Final `git diff` read-through confirms zero behavior change and 4 verbatim records intact
