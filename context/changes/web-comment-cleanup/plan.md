# Clean up and trim comments in `apps/web` Implementation Plan

## Overview

A comments-only refactor of `apps/web/src/**` — remove redundant comments, normalize the ~8 recurring
comment families to one canonical line each, and compress the multi-line file-headers to a single sharp
line that still carries the load-bearing "why". Zero behavior change: the diff touches comment lines only.
This mirrors the just-completed, archived `2026-06-21-api-comment-cleanup`.

## Current State Analysis

From `research.md` (git_commit `9a6bfdd`):

- **~241 logical comments** across 38 non-spec `.ts` files + 17 spec files (+ 1 scss, 0 html). Counting
  physical `//` lines: ~397 outside specs.
- Net classification: **REMOVE ~17**, **KEEP-SHORTEN/normalize ~224**, **KEEP-VERBATIM 0**.
- This is a **normalize-and-tighten** job, not a delete job (~13:1 KEEP-SHORTEN:REMOVE). No scaffold junk,
  no dead code, no Angular-generator leftovers anywhere except `styles.scss:1`.
- **Zero untouchable directives exist** (confirmed by a dedicated sweep over all 74 files): no
  `eslint-disable` / `ts-expect-error` / `@ts-ignore` / `@ts-nocheck` / `prettier-ignore`, no `///` pragmas,
  no JSDoc `/** */`, no license/SPDX headers, zero HTML comments, zero in-comment URLs, zero `TODO`/`FIXME`.
  The cleanup cannot accidentally destroy a directive, because none exist.
- **No casing work needed** — every comment already complies with `comments.md` (lowercase-first). Remaining
  capitals are code tokens (`Date`, `EventSource`, `HttpClient`, schema/type names, `createdAt`) — exempt.
- The dominant work is collapsing **8 recurring families** that repeat the same fact across 2–14 files.
- The densest, highest-value load-bearing comments are in the **diagnosis/SSE sub-tree** and the
  **7 `*.store.ts` + 7 `*.client.ts`** data-layer files.

### Key Discoveries:

- [`core/auth/auth.client.ts:3-11`](apps/web/src/app/core/auth/auth.client.ts) — better-auth
  `basePath`-not-`baseURL` workaround (1.6.15 rejects a relative `baseURL`); a decision/risk record — keep
  the "why basePath" fact and the version.
- [`core/auth/auth.store.ts:40-41`](apps/web/src/app/core/auth/auth.store.ts) — better-auth deserializes
  timestamps to `Date`; `authUserSchema` preprocesses `Date → iso string`. **References `lessons.md`** — the
  Date↔ISO client-boundary lesson — and a shared schema. Keep the fact.
- [`shared/validators/schema.validator.ts:4-6`](apps/web/src/app/shared/validators/schema.validator.ts) —
  bridges a shared zod field schema into a `ValidatorFn` (**contracts.md**). The core FE-validation invariant.
- Diagnosis/SSE: [`diagnosis.client.ts:6-10`](apps/web/src/app/features/diagnosis/data/diagnosis.client.ts)
  (transportError bypasses HttpClient → no 401 interceptor), `:33-38` (teardown stops auto-reconnect —
  **sse.md**), `:46` (ignore non-json frame); [`diagnosis.store.ts:20-23`](apps/web/src/app/features/diagnosis/data/diagnosis.store.ts)
  (entries keyed by serviceId), `:42-44` (onDestroy closes streams — **sse.md** never leak), `:122-126`
  (transportError ignored after terminal frame, never a 401 redirect).
- [`devices.store.ts:59-62`](apps/web/src/app/features/devices/data/devices.store.ts) (device-then-credential
  ordering + rollback), `:79` (empty catch: intentional — surface the original credential failure), `:110-112`
  (no rotation endpoint → recreate+delete).
- [`styles.scss:1`](apps/web/src/styles.scss) — the only scss comment (generator scaffold — REMOVE).

## Desired End State

`apps/web/src/**` carries minimal, sharp, lowercase comments: every redundant restatement is gone, each of
the 8 recurring families reads as one identical canonical line, and every multi-line file-header is a single
line that still names the non-obvious "why" and any rule reference. Behavior, tests, types, and formatting are
unchanged.

**Verification of end state:**
- `npx nx lint web` passes the same as before.
- `npx nx test web` passes the same as before.
- `npm run format:check` is clean for `apps/web`.
- `git diff` shows comment lines only — no logic, template, signature, import, or formatting change on any
  non-comment line.

## What We're NOT Doing

- **No changes to executable code** — no renames, signature changes, import changes, template markup changes,
  or code formatting changes outside the comment line itself.
- **No `apps/api`, `libs/shared`, or config changes** outside `apps/web`.
- **No casing fixes** — everything already complies with `comments.md`; remaining capitals are code tokens.
- **No new prose** for the recurring families — we adopt the best existing instance verbatim, we do not invent
  fresh wording.
- **No deletion of load-bearing facts** when compressing headers — the header collapses to one line, the "why"
  and rule reference survive.
- **No touching of `*.html` / `*.scss`** beyond the single `styles.scss:1` scaffold line (html has 0 comments).

## Implementation Approach

Work in 5 batches ordered by independence and blast radius, smallest first (per the research batching plan).
Each batch is a reviewable work unit; all batches land as **one commit** (`docs(web): clean up and trim
comments`) at the end, mirroring the api precedent — the commit body notes the single-commit deviation from
change.md's per-batch batching.

**Decisions driving every batch (from planning):**
1. **Recurring families** — adopt the **best-phrased existing instance** of each family as canonical and apply
   it **verbatim** everywhere, keeping each reference intact (`angular.md`, `apiErrorSchema`, `sse.md`, the zod
   schema names). Pick the canonical line for each family **before** editing so the diff stays mechanical.
2. **File-headers** — compress each multi-line header to **one sharp lowercase line** that still carries the
   non-obvious "why" and the rule reference. Aggressive on length, never on meaning — the load-bearing gotcha
   (overlay-vs-DI, `canCompose` gating, provider lifecycle) survives in that one line.
3. **Soft notes** — **delete all four**: the 3 soft `patchEntry`/`teardown` restatements
   (`diagnosis.store.ts:136,141`, `skill-run.store.ts:85`) and the full 4× delete-target-signal note
   (`drives the alert-dialog copy`).
4. **Commit** — a single `docs(web): clean up and trim comments`.

## Critical Implementation Details

- **The only real risk is over-eager shortening of load-bearing prose.** Many comments encode
  `angular.md` / `contracts.md` / `sse.md` / `lessons.md` invariants and reference named `@opspilot/shared`
  zod schemas. Shorten the wording, never the meaning, and keep the rule/schema reference token intact.
- **Decide canonical wording first.** For each of the 8 families (and spec Family A), choose the canonical
  line before editing any file, then apply it identically. This keeps each batch's diff mechanical.
- **Header compression must preserve the gotcha.** "One line" means one line that still states the
  non-obvious fact — e.g. `service-skills` header must retain the `canCompose` gating + provider-lifecycle
  fact; the cdk-overlay note must retain "store rides context not DI". A one-liner that drops the gotcha is a
  failure, not a success.

## Phase 1: core + app-root

### Overview

Tighten the small, high-value `core/{auth,guards,interceptors}` + app-root comments. All KEEP-SHORTEN, zero
deletes. This batch establishes the canonical wording for families that recur later (the `not providedIn:
'root', per angular.md` header, the strict-parse boundary note).

### Changes Required:

#### 1. core/auth

**File**: `apps/web/src/app/core/auth/auth.client.ts`, `apps/web/src/app/core/auth/auth.store.ts`

**Intent**: Tighten the comments while preserving the two decision/risk records: the better-auth `basePath`
workaround (with the `1.6.15` version) in `auth.client.ts:3-11`, and the `lessons.md` Date→iso preprocessing
invariant in `auth.store.ts:40-41`. Normalize the `auth.store.ts:16-20` session/zoneless/`not providedIn:
'root'` header toward the canonical family-1 line.

**Contract**: Comment lines only. Keep the `basePath`/`baseURL`/`1.6.15` fact, the `authUserSchema`/`Date`/iso
fact + `lessons.md` reference, and the `angular.md` reference.

#### 2. core/guards + core/interceptors

**File**: `apps/web/src/app/core/guards/auth.guard.ts`, `apps/web/src/app/core/interceptors/auth.interceptor.ts`

**Intent**: Shorten the guard's read-shared-session-synchronously + hydrate-before-first-navigation ordering
note (`auth.guard.ts:5-6`) and the interceptor's "on any 401 clear+redirect, all other errors pass through"
note (`auth.interceptor.ts:7-8`) — keep the non-obvious half (the pass-through, the ordering rationale).

**Contract**: Comment lines only. Both rationales survive in tighter form.

#### 3. app-root

**File**: `apps/web/src/app/app.config.ts`, `apps/web/src/main.ts`

**Intent**: Compress the `app.config.ts:12-18` header (zoneless, session at app root, hydrate-before-first-
navigation initializer) toward the canonical family-1 wording, keeping the `angular.md` reference. Tighten any
`main.ts` comment.

**Contract**: Comment lines only. `angular.md` reference and the hydrate-before-navigation rationale survive.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npx nx lint web`
- Tests pass: `npx nx test web`
- Format clean: `npm run format:check`
- Diff is comment-only for these files: `git diff -- apps/web/src/app/core apps/web/src/app/app.config.ts apps/web/src/main.ts`

#### Manual Verification:

- The better-auth `basePath` workaround + `1.6.15` version still reads clearly in `auth.client.ts`.
- The `lessons.md` Date→iso fact + `authUserSchema` reference survive in `auth.store.ts`.
- The interceptor pass-through-on-non-401 and guard ordering rationale are still legible.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for
manual confirmation from the human before proceeding.

---

## Phase 2: shared

### Overview

The smallest batch — `shared/validators/schema.validator.ts` only (1 KEEP-SHORTEN).

### Changes Required:

#### 1. schema.validator.ts

**File**: `apps/web/src/app/shared/validators/schema.validator.ts`

**Intent**: Shorten the `:4-6` note that bridges a shared zod field schema into a `ValidatorFn` so forms
validate against the single source of truth — keep the `contracts.md` reference and the single-source-of-truth
point.

**Contract**: Comment lines only. `contracts.md` reference survives.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npx nx lint web`
- Tests pass: `npx nx test web`
- Format clean: `npm run format:check`
- Diff is comment-only: `git diff -- apps/web/src/app/shared`

#### Manual Verification:

- The `contracts.md` single-source-of-truth rationale is still clear.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for
manual confirmation from the human before proceeding.

---

## Phase 3: data layer (7 stores + 7 clients)

### Overview

The normalization core. Collapse families 1–5 to one canonical line each across the 7 `*.store.ts` and 7
`*.client.ts` files, tighten the dense SSE notes in `diagnosis.*`, and delete the 3 soft restatements. Nearly
zero other deletes.

### Changes Required:

#### 1. Recurring families across stores + clients

**File**: the 7 `*.store.ts` + 7 `*.client.ts` under `apps/web/src/app/**/data/` (audit, devices,
diagnosis, llm-providers, services, skill-run, skills)

**Intent**: Apply the canonical line (best existing instance, verbatim) for each family:
- Family 1 — `not providedIn: 'root', per angular.md` (store/component headers).
- Family 2 — `errorMessage → apiErrorSchema` (the 6× store `errorMessage` block — highest-redundancy block).
- Family 3 — `typed http i/o … relative '/api' urls ride the same-origin session cookie` (client headers).
- Family 4 — `parses through the shared contract / zod schema (secret leaks fail strict parse)` (~12×).
- Family 5 — `signalState container mutated through patchState` (store headers).

**Contract**: Comment lines only. Each family's rule/schema reference token (`angular.md`, `apiErrorSchema`,
the zod schema names) is preserved verbatim in the canonical line.

#### 2. diagnosis SSE notes

**File**: `apps/web/src/app/features/diagnosis/data/diagnosis.client.ts`,
`apps/web/src/app/features/diagnosis/data/diagnosis.store.ts`

**Intent**: Tighten the densest load-bearing notes without losing meaning: transportError bypasses HttpClient
→ no 401 interceptor (`client:6-10`), heartbeat + teardown stops auto-reconnect — **sse.md** (`client:33-38`),
ignore non-json frame (`client:46`), entries keyed by serviceId (`store:20-23`), onDestroy closes streams —
**sse.md** never leak (`store:42-44`), transportError ignored after terminal frame, never a 401 redirect
(`store:122-126`). Normalize family-7 (keyed-by-serviceId isolation) and family-8 (sse close/never-leak) to
their canonical lines.

**Contract**: Comment lines only. Every `sse.md` reference and the transportError-not-401 / keyed-isolation /
never-leak facts survive.

#### 3. Soft restatement deletes

**File**: `apps/web/src/app/features/diagnosis/data/diagnosis.store.ts`,
`apps/web/src/app/features/services/data/skill-run.store.ts`

**Intent**: Delete the 3 soft restatements that only re-state the symbol name: `diagnosis.store.ts:136`
(`patchEntry` "merges, preserving every other key"), `diagnosis.store.ts:141` (`teardown` "closes and forgets
one row's open stream"), `skill-run.store.ts:85` (`patchEntry` "preserves keys").

**Contract**: Comment lines only — the three comment lines are removed; the code they sat above is untouched.

#### 4. devices store why-swallow / invariant notes

**File**: `apps/web/src/app/features/devices/data/devices.store.ts`

**Intent**: Tighten (keep) the device-then-credential ordering + rollback (`:59-62`), the intentional empty
catch surfacing the original credential failure (`:79`), and the no-rotation-endpoint recreate+delete
invariant (`:110-112`).

**Contract**: Comment lines only. The why-swallow and ordering/invariant facts survive.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npx nx lint web`
- Tests pass: `npx nx test web`
- Format clean: `npm run format:check`
- Diff is comment-only for the data layer: `git diff -- apps/web/src/app/**/data` (non-spec files)

#### Manual Verification:

- Each of families 1–5 reads as one identical canonical line across all its files.
- The SSE invariants (transportError-not-401, keyed-by-serviceId, teardown-no-reconnect, never-leak) survive
  with their `sse.md` references.
- The 3 soft restatements are gone; the devices why-swallow notes remain.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for
manual confirmation from the human before proceeding.

---

## Phase 4: components / dialogs

### Overview

Delete the 7 REMOVE comments + the full 4× delete-target-signal note, remove the `styles.scss:1` scaffold,
normalize the cdk-overlay note (family 6), and compress the verbose file-headers to one sharp line each.

### Changes Required:

#### 1. REMOVE the 7 restatements + scss scaffold

**File**: `apps/web/src/styles.scss`; the human-label quartet in
`apps/web/src/app/features/devices/dialogs/device-form.dialog.ts:74`,
`apps/web/src/app/features/llm-providers/dialogs/llm-provider-form.dialog.ts:66`,
`apps/web/src/app/features/skills/dialogs/skill-form.dialog.ts:85,89`; the typedef restatement
`skill-form.dialog.ts:31`; the store-signal restatement
`apps/web/src/app/features/services/components/service-skills.component.ts:39-40`

**Intent**: Delete these pure restatements and the generator scaffold line in `styles.scss:1`.

**Contract**: Comment lines only — comments removed, the code/markup they sat above is untouched. Note
`styles.scss` is the one scss file with a comment; html templates have none.

#### 2. DELETE the 4× delete-target-signal note

**File**: `apps/web/src/app/features/devices/devices.component.ts:39`,
`apps/web/src/app/features/llm-providers/llm-providers.component.ts:36`,
`apps/web/src/app/features/services/components/device-services.component.ts:66`,
`apps/web/src/app/features/skills/skills.component.ts:37`

**Intent**: Delete all four occurrences of the `drives the alert-dialog copy` delete-target-signal note
entirely (per the planning decision to remove all four soft-note kinds).

**Contract**: Comment lines only — four comment lines removed.

#### 3. Normalize family 6 (cdk-overlay) + compress file-headers to one line

**File**: `apps/web/src/app/features/services/components/service-skills.component.ts` (9-line header),
`apps/web/src/app/features/services/dialogs/run-skill.dialog.ts` (6-line header),
`apps/web/src/app/features/services/components/device-services.component.ts` (two overlapping badge-class
notes `:24-26` + `:91`), plus the other component/dialog headers carrying the cdk-overlay note

**Intent**: Collapse each multi-line header to **one sharp lowercase line** that still carries the non-obvious
"why": `service-skills` keeps the `canCompose` gating + provider-lifecycle fact; `run-skill` keeps the
empty-optional→charset-schema guard + command-preview-as-destructive-confirm facts; `device-services` folds
the two badge-class notes (hlmBadge has no success/warning variant) into one. Normalize family 6 (`renders in
a cdk overlay outside the route injector → store rides context not DI`) to one canonical line wherever it
recurs.

**Contract**: Comment lines only. Each collapsed header is a single line; the load-bearing gotcha and any rule
reference survive. The cdk-overlay note reads identically everywhere.

#### 4. KEEP-SHORTEN remaining dialog/component notes

**File**: `device-form.dialog.ts:66-67,130-131`, `skill-form.dialog.ts:38-41,70-71,75,133-136`,
`run-skill.dialog.ts:29-31,37-42`, `audit.component.ts:12-13`

**Intent**: Tighten (keep) the load-bearing notes: reactive secret-control swap without zone CD; username+
secret-together rule; placeholder↔param parity vs the shared create schema; `'' = global` uuid scopes →
null on submit; blank number → null inherits config default; badge-class spartan-limitation workaround.

**Contract**: Comment lines only. The shared-schema references and the "why" survive in tighter form.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npx nx lint web`
- Tests pass: `npx nx test web`
- Format clean: `npm run format:check`
- Diff is comment-only for components/dialogs + styles: `git diff -- apps/web/src/app/features apps/web/src/styles.scss` (non-spec, non-data)

#### Manual Verification:

- The 7 REMOVE + `styles.scss:1` + the 4× delete-target note are gone.
- Each compressed header is one line yet still states its gotcha (`canCompose` gating, overlay-vs-DI, etc.).
- The cdk-overlay note reads identically across all components/dialogs.
- No html template was touched (they have 0 comments).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for
manual confirmation from the human before proceeding.

---

## Phase 5: specs

### Overview

Last batch. Normalize spec Family A (6× strict-parse boundary) to one identical line, delete Families B+C from
the store specs (restate the very next `expect()`), and keep the characterization/ordering notes.

### Changes Required:

#### 1. Normalize Family A — strict-parse boundary

**File**: `apps/web/src/app/features/audit/data/audit.client.spec.ts:59`,
`apps/web/src/app/features/diagnosis/data/diagnosis.client.spec.ts:70`,
`apps/web/src/app/features/llm-providers/data/llm-providers.client.spec.ts:52`,
`apps/web/src/app/features/services/data/services.client.spec.ts:60`,
`apps/web/src/app/features/services/data/skill-run.client.spec.ts:39`,
`apps/web/src/app/features/skills/data/skills.client.spec.ts:53`

**Intent**: Normalize all 6 occurrences to one identical canonical line, e.g.
`// a leaked key must fail the strict parse at the boundary`.

**Contract**: Comment lines only. The strictObject-contract meaning survives, identical across all 6 files.

#### 2. DELETE Family B + Family C

**File**: `apps/web/src/app/features/llm-providers/data/llm-providers.store.spec.ts:45,63`,
`apps/web/src/app/features/skills/data/skills.store.spec.ts:46,65`,
`apps/web/src/app/features/devices/data/devices.store.spec.ts:77`,
`apps/web/src/app/features/services/data/services.store.spec.ts:109,134`

**Intent**: Delete Family B (`mutate-then-refetch: a successful create reloads the list`, restates
`expect(list).toHaveBeenCalledOnce()`) and Family C (`a failed create never refetches`, restates
`expect(list).not.toHaveBeenCalled()`), plus `services.store.spec.ts:109` (restates the `listServices`
assertion).

**Contract**: Comment lines only — restatement comment lines removed, the `expect()` lines untouched.

#### 3. KEEP-SHORTEN genuine spec notes

**File**: `diagnosis.client.spec.ts:25-26`, `diagnosis.store.spec.ts:11-12,134`,
`devices.store.spec.ts:119,133`, `skill-run.store.spec.ts:43`, `skill-form.validators.spec.ts:5-8,30-31`,
`services.store.spec.ts:106`

**Intent**: Tighten (keep) the real boundary/characterization/ordering notes: minimal EventSource stand-in
(jsdom has none); per-service stream-handler capture; late-transport-error-doesn't-overwrite-done ordering;
create-then-delete ordering invariant; mid-flight pending holds skillId; validators derived from the shared
schema (**contracts.md**) + cross-field parity refine; partial-failure expectation.

**Contract**: Comment lines only. The "why the fake exists" / ordering-invariant / contract facts survive.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npx nx lint web`
- Tests pass: `npx nx test web`
- Format clean: `npm run format:check`
- Diff is comment-only across all specs: `git diff -- 'apps/web/src/**/*.spec.ts'`
- Full-tree comment-only check: `git diff -- apps/web` shows no change on any non-comment line.

#### Manual Verification:

- Family A reads as one identical line across all 6 client specs.
- Families B+C are gone; the next `expect()` in each spec is unchanged.
- The characterization/ordering notes (EventSource fake, create-then-delete, partial-failure) survive.

**Implementation Note**: After all five phases pass automated verification and manual confirmation, land the
whole change as a single commit `docs(web): clean up and trim comments` (body notes the single-commit
deviation from change.md's per-batch batching).

---

## Testing Strategy

### Unit Tests:

- No test logic changes. `npx nx test web` must pass identically before and after — the suite is the guardrail
  proving no executable code moved.
- Spec-file edits (Phase 5) are comment-only; run the suite after that batch to confirm the deletes/normalizes
  didn't disturb a test body.

### Integration Tests:

- N/A — comments-only change; no integration surface is touched.

### Manual Testing Steps:

1. After each phase, run `git diff -- <phase paths>` and confirm every changed line is a comment line.
2. Spot-check the load-bearing comments listed in each phase's Manual Verification survive with meaning + rule
   references intact.
3. Before committing, run `git diff -- apps/web | grep -vE '^[+-].*(//|/\*|\*/|<!--)'` style review (or read
   the diff) to confirm no non-comment line changed.

## Performance Considerations

None — comments are stripped at build time; no runtime impact.

## Migration Notes

None — no data, schema, or API surface changes.

## References

- Related research: `context/changes/web-comment-cleanup/research.md`
- Direct precedent: `context/archive/2026-06-21-api-comment-cleanup/plan.md` (same taxonomy, single-commit land)
- Rule: `.claude/rules/comments.md` (lowercase-first), `.claude/rules/angular.md`, `.claude/rules/contracts.md`,
  `.claude/rules/sse.md`, `context/foundation/lessons.md` (Date↔ISO at the better-auth client boundary)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: core + app-root

#### Automated

- [x] 1.1 Lint passes: `npx nx lint web`
- [x] 1.2 Tests pass: `npx nx test web`
- [x] 1.3 Format clean: `npm run format:check`
- [x] 1.4 Diff is comment-only for core + app.config.ts + main.ts

#### Manual

- [x] 1.5 better-auth `basePath` workaround + `1.6.15` version still clear
- [x] 1.6 `lessons.md` Date→iso fact + `authUserSchema` reference survive
- [x] 1.7 interceptor pass-through + guard ordering rationale legible

### Phase 2: shared

#### Automated

- [x] 2.1 Lint passes: `npx nx lint web`
- [x] 2.2 Tests pass: `npx nx test web`
- [x] 2.3 Format clean: `npm run format:check`
- [x] 2.4 Diff is comment-only: `git diff -- apps/web/src/app/shared`

#### Manual

- [x] 2.5 `contracts.md` single-source-of-truth rationale still clear

### Phase 3: data layer (7 stores + 7 clients)

#### Automated

- [x] 3.1 Lint passes: `npx nx lint web`
- [x] 3.2 Tests pass: `npx nx test web`
- [x] 3.3 Format clean: `npm run format:check`
- [x] 3.4 Diff is comment-only for the data layer (non-spec)

#### Manual

- [x] 3.5 Families 1–5 each read as one identical canonical line across their files
- [x] 3.6 SSE invariants survive with `sse.md` references
- [x] 3.7 The 3 soft restatements gone; devices why-swallow notes remain

### Phase 4: components / dialogs

#### Automated

- [x] 4.1 Lint passes: `npx nx lint web`
- [x] 4.2 Tests pass: `npx nx test web`
- [x] 4.3 Format clean: `npm run format:check`
- [x] 4.4 Diff is comment-only for components/dialogs + styles

#### Manual

- [x] 4.5 7 REMOVE + `styles.scss:1` + 4× delete-target note are gone
- [x] 4.6 Each compressed header is one line yet still states its gotcha
- [x] 4.7 cdk-overlay note reads identically across components/dialogs; no html touched

### Phase 5: specs

#### Automated

- [x] 5.1 Lint passes: `npx nx lint web`
- [x] 5.2 Tests pass: `npx nx test web`
- [x] 5.3 Format clean: `npm run format:check`
- [x] 5.4 Diff is comment-only across all specs
- [x] 5.5 Full-tree `git diff -- apps/web` shows no non-comment line changed

#### Manual

- [x] 5.6 Family A reads as one identical line across all 6 client specs
- [x] 5.7 Families B+C gone; next `expect()` unchanged
- [x] 5.8 Characterization/ordering notes survive
- [x] 5.9 Landed as single commit `docs(web): clean up and trim comments`
