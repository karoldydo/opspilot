---
date: 2026-06-21T00:00:00Z
researcher: Karol Dydo
git_commit: 9a6bfdd89e85c8f63a217c9c7240f9dcc526d20b
branch: main
repository: opspilot
topic: "Clean up and trim comments in apps/web (comments-only refactor)"
tags: [research, codebase, apps-web, comments, refactor, cleanup]
status: complete
last_updated: 2026-06-21
last_updated_by: Karol Dydo
---

# Research: Clean up and trim comments in `apps/web`

**Date**: 2026-06-21
**Researcher**: Karol Dydo
**Git Commit**: `9a6bfdd89e85c8f63a217c9c7240f9dcc526d20b`
**Branch**: main
**Repository**: opspilot

> Permalink base for any reference below:
> `https://github.com/karoldydo/opspilot/blob/9a6bfdd89e85c8f63a217c9c7240f9dcc526d20b/<file>#L<line>`

## Research Question

Map the comment landscape across `apps/web/src/**` (including `*.spec.ts`, `*.html`, `*.scss`) so a
comments-only cleanup can proceed: which comments **restate the code** (REMOVE), which **explain
something not visible from the code** and should be kept-and-shortened (KEEP-SHORTEN), and which must
**never be touched** (directives / risk-disclosures). Identify the per-area load, the highest-redundancy
files, the recurring comment families worth normalizing, and a reviewable batching plan — with zero
behavior change. This mirrors the just-completed `apps/api` cleanup (archived `2026-06-21-api-comment-cleanup`).

## Summary

- **Total inventoried: ~241 logical comments** across 38 non-spec `.ts` files + 17 spec files (+ 1 scss,
  0 html). Counting physical `//` lines instead of logical blocks, that is ~397 comment lines outside
  specs (the gap is the ~8 multi-line file-header blocks of 5–9 lines each). Net classification:
  - **REMOVE: ~17** — pure restatements / one generator scaffold line; safe to delete without loss.
  - **KEEP-SHORTEN / normalize: ~224** — genuine load-bearing docs (contracts, invariants, workarounds,
    SSE lifecycle, ordering, security boundaries); most are already tight one-liners, the rest tighten to
    one sharp lowercase line. The bulk of the *value* here is **normalizing ~8 recurring families** that
    repeat the same invariant verbatim across files.
  - **KEEP-VERBATIM / untouchable: 0** — there is nothing to protect from accidental deletion.

- **This is even more a *tighten-and-normalize* job than the api cleanup was, and barely a *delete* job.**
  The api side was ~3:1 KEEP-SHORTEN:REMOVE; the web side is closer to **~13:1**. There is essentially
  no scaffold junk: no `// inject the service`, no `// navigate to login`, no commented-out dead code,
  no Angular-generator leftovers anywhere in the component/store/client tree. The single generator
  scaffold comment is `styles.scss:1`.

- **There are NO conventional "untouchable" categories present (confirmed by a dedicated sweep over all
  74 files).** Zero `eslint-disable` / `ts-expect-error` / `@ts-ignore` / `@ts-nocheck` / `prettier-ignore`,
  zero `/// <reference` pragmas, zero JSDoc `/** */` blocks, zero license/SPDX headers, **zero HTML
  comments** (all 17 templates), **zero real in-comment URLs** (the "http" grep hits are the words
  `http i/o` / `http failure` in prose, not links), zero `TODO` / `FIXME` / `HACK` / `NOTE:` markers.
  → The cleanup cannot accidentally destroy a directive, because none exist.

- **The dominant work is collapsing ~8 recurring comment families**, each repeating the same fact across
  2–14 files: the `not providedIn: 'root', per angular.md` store/component header (13–14×), the
  `pulls the user-facing message out of an http failure → apiErrorSchema` block (6×), the
  `typed http i/o … relative '/api' urls ride the same-origin cookie` client header (6×), the
  `parses through the shared contract/zod schema` boundary note (~12×), the `signalState … patchState`
  state-model note (6–7×), the `renders in a cdk overlay outside the route injector → store rides
  context not DI` dialog note (~9–10×), plus spec-side families.

- **The biggest cleanup wins are concentrated in the seven `*.store.ts` + seven `*.client.ts` data-layer
  files** (shared header + errorMessage/strict-parse blocks) and a few component file-headers
  (`service-skills.component.ts` 9-line header, `run-skill.dialog.ts`, `device-services.component.ts`).

- **The only real risk is over-eager shortening of load-bearing prose.** Many comments encode
  `angular.md` / `contracts.md` / `sse.md` / `lessons.md` invariants and reference named `@opspilot/shared`
  zod schemas. Shorten the wording, never the meaning. Capitals that remain are code tokens (`Date`,
  `EventSource`, `HttpClient`, schema names like `authUserSchema`/`apiErrorSchema`, `createdAt`,
  type names like `DeviceActionResult`) — those are exempt from the `comments.md` lowercase rule.

## Rule Context (constraints on what stays)

From [.claude/rules/comments.md](.claude/rules/comments.md):
- All inline comments **must be entirely lowercase** — no capitalized first letter, ever, for any
  syntax (`//`, `#`, `/* */`, `<!-- -->`). Worked example: `// fetch data from api`, not `// Fetch data from API`.
- Implication: **every comment in `apps/web/src` already complies** (lowercase-first). No casing fixes
  are needed. Capitals that remain are code tokens/identifiers, which are exempt.

From [.claude/rules/angular.md](.claude/rules/angular.md), [.claude/rules/contracts.md](.claude/rules/contracts.md),
[.claude/rules/sse.md](.claude/rules/sse.md):
- None of these state a comment-style rule of their own (that lives only in `comments.md`). They
  establish **invariants that the KEEP-SHORTEN comments document** — the per-feature provider lifecycle
  (`not providedIn: 'root'`), the single-source-of-truth Zod contract validated at the boundary, and the
  EventSource never-leak / auto-reconnect-on-teardown rules. Many web comments cite these rule **filenames
  by name** (unlike the api side, where none did) — so when shortening, keep the rule reference intact.

## Detailed Findings

### Aggregate by area

| Area | Files | Comments (logical) | REMOVE | KEEP-SHORTEN/normalize | Verbatim |
|------|------:|-------------------:|-------:|-----------------------:|---------:|
| `core/*` + `shared/` + app-root + feature `data/*` (non-spec) | ~24 | ~86 | 0 firm (3 soft) | ~86 | 0 |
| feature components/dialogs (non-spec) + `*.html` + `*.scss` | ~14 | ~133 (132 ts + 1 scss; 0 html) | 7 | ~125 | 0 |
| `**/*.spec.ts` | 17 | ~22 | 7 | ~15 | 0 |
| **Total** | **~55** | **~241** | **~17** | **~224** | **0** |

### Area 1 — `core/*` + `shared/` + app-root + feature `data/*` (non-spec): REMOVE 0 firm / KEEP-SHORTEN ~86 / verbatim 0

**Almost nothing to delete — this is pure tightening + normalization.** The seven `*.store.ts` and seven
`*.client.ts` files are the highest-redundancy files in the whole change.

**Highest-value / load-bearing (KEEP, shorten only):**
- [`core/auth/auth.client.ts:3-11`](apps/web/src/app/core/auth/auth.client.ts) — the better-auth
  `basePath`-not-`baseURL` workaround (1.6.15 rejects a relative `baseURL`). A decision/risk record — keep
  the "why basePath" fact and the version.
- [`core/auth/auth.store.ts:40-41`](apps/web/src/app/core/auth/auth.store.ts) — better-auth deserializes
  timestamps to `Date`; `authUserSchema` preprocesses `Date → iso string` (**references `lessons.md`** —
  the Date↔ISO client-boundary lesson — and a shared schema). Keep the fact.
- [`core/auth/auth.store.ts:16-20`](apps/web/src/app/core/auth/auth.store.ts) — session source-of-truth,
  zoneless, `not providedIn: 'root'` (**angular.md**).
- [`core/guards/auth.guard.ts:5-6`](apps/web/src/app/core/guards/auth.guard.ts) — reads shared session
  synchronously; app initializer hydrates before first navigation (ordering rationale).
- [`core/interceptors/auth.interceptor.ts:7-8`](apps/web/src/app/core/interceptors/auth.interceptor.ts) —
  on any 401 clear session + redirect, **all other errors pass through** (the non-obvious half).
- [`app.config.ts:12-18`](apps/web/src/app/app.config.ts) — zoneless (no `provideZoneChangeDetection`),
  session provided at app root (**angular.md**), hydrate-before-first-navigation initializer rationale.
- [`shared/validators/schema.validator.ts:4-6`](apps/web/src/app/shared/validators/schema.validator.ts) —
  bridges a shared zod field schema into a `ValidatorFn` so forms validate against the single source of
  truth (**contracts.md**). The core FE-validation invariant.
- **Diagnosis (SSE) is the densest, highest-value sub-area** — keep all, tighten only:
  [`diagnosis.client.ts:6-10`](apps/web/src/app/features/diagnosis/data/diagnosis.client.ts) (transportError
  bypasses HttpClient → no 401 interceptor), `:33-38` (heartbeat is an sse comment; teardown stops
  auto-reconnect so diagnosis doesn't re-run — **sse.md**), `:46` (ignore non-json frame, don't throw in
  callback); [`diagnosis.store.ts:20-23`](apps/web/src/app/features/diagnosis/data/diagnosis.store.ts)
  (entries keyed by serviceId so rows don't clobber), `:42-44` (onDestroy closes streams — **sse.md**:
  never leak), `:122-126` (transportError ignored after terminal frame, never a 401 redirect).
- [`devices.store.ts:59-62`](apps/web/src/app/features/devices/data/devices.store.ts) (device-then-credential
  ordering + rollback so no device is left without credentials), `:79` (empty catch: intentionally ignored
  — surface the original credential failure), `:110-112` (no rotation endpoint → recreate+delete so a
  failed create never leaves zero credentials). These why-swallow / invariant notes are exactly what to keep.

**Soft REMOVE candidates (the only ones in this area)** — restate the symbol name; a strict reviewer could
tighten to a half-line instead of deleting:
- [`diagnosis.store.ts:136`](apps/web/src/app/features/diagnosis/data/diagnosis.store.ts) — `patchEntry`
  "merges, preserving every other key" (the spread is visible).
- [`diagnosis.store.ts:141`](apps/web/src/app/features/diagnosis/data/diagnosis.store.ts) — `teardown`
  "closes and forgets one row's open stream" (restates the name).
- [`skill-run.store.ts:85`](apps/web/src/app/features/services/data/skill-run.store.ts) — `patchEntry`
  "preserves keys" (same as the diagnosis one).

### Area 2 — feature components/dialogs (non-spec) + `*.html` + `*.scss`: REMOVE 7 / KEEP-SHORTEN ~125 / verbatim 0

**HTML: 0 comments across all 17 templates. SCSS: exactly 1 comment** ([`styles.scss:1`](apps/web/src/styles.scss),
the Angular-generator "you can add global styles here" scaffold — a clean REMOVE; `app.scss` has 0).
`login.component.ts`, `register.component.ts`, `app.html`, `index.html` have **zero** comments.

**REMOVE (7):**
- [`styles.scss:1`](apps/web/src/styles.scss) — generator scaffold line.
- The **"human label for the … select trigger" quartet** — pure restatements, the single clearest
  removable cross-file cluster: [`devices/dialogs/device-form.dialog.ts:74`](apps/web/src/app/features/devices/dialogs/device-form.dialog.ts),
  [`llm-providers/dialogs/llm-provider-form.dialog.ts:66`](apps/web/src/app/features/llm-providers/dialogs/llm-provider-form.dialog.ts),
  [`skills/dialogs/skill-form.dialog.ts:85`](apps/web/src/app/features/skills/dialogs/skill-form.dialog.ts),
  [`skills/dialogs/skill-form.dialog.ts:89`](apps/web/src/app/features/skills/dialogs/skill-form.dialog.ts).
- [`skills/dialogs/skill-form.dialog.ts:31`](apps/web/src/app/features/skills/dialogs/skill-form.dialog.ts) —
  restates a typedef ("one typed parameter row in the parameters FormArray").
- [`services/components/service-skills.component.ts:39-40`](apps/web/src/app/features/services/components/service-skills.component.ts) —
  restates the store-signal read.

**Recurring component pattern — the delete-target signal note** (`drives the alert-dialog copy`) repeats
near-verbatim across [`devices.component.ts:39`](apps/web/src/app/features/devices/devices.component.ts),
[`llm-providers.component.ts:36`](apps/web/src/app/features/llm-providers/llm-providers.component.ts),
[`services/components/device-services.component.ts:66`](apps/web/src/app/features/services/components/device-services.component.ts),
[`skills.component.ts:37`](apps/web/src/app/features/skills/skills.component.ts). Normalize to one short
line or drop (borderline REMOVE).

**KEEP-SHORTEN highlights (compress the verbose file-headers especially):**
- [`services/components/service-skills.component.ts:10-18`](apps/web/src/app/features/services/components/service-skills.component.ts) —
  9-line header: skill-gating reproduces old `canCompose()`, per-feature provider lifecycle (**angular.md**).
  Heaviest single block to compress (9 → ~3). Also `:21-22` (`display: contents` rationale — real CSS why),
  `:47-50` (visibleSkills gating mirrors `canCompose`), `:86-87` (required `service` param gating).
- [`services/dialogs/run-skill.dialog.ts:29-31`](apps/web/src/app/features/services/dialogs/run-skill.dialog.ts)
  (empty optional → charset schema = same guard server re-applies — **@opspilot/shared charset schema**),
  `:37-42` (command preview doubles as destructive-confirm; no destructive flag in the data model).
- [`devices/dialogs/device-form.dialog.ts:66-67`](apps/web/src/app/features/devices/dialogs/device-form.dialog.ts)
  (reactive mirror to swap secret control without zone CD), `:130-131` (require username+secret together).
- [`skills/dialogs/skill-form.dialog.ts:38-41`](apps/web/src/app/features/skills/dialogs/skill-form.dialog.ts)
  + `:133-136` (placeholder↔param parity re-checked against the shared create schema), `:70-71`
  (`'' = global`, uuid scopes, converted to null on submit), `:75` (blank number → null inherits config default).
- The badge-class workaround note (hlmBadge has no success/warning variant) at
  [`audit.component.ts:12-13`](apps/web/src/app/features/audit/audit.component.ts) and
  [`device-services.component.ts:24-26`](apps/web/src/app/features/services/components/device-services.component.ts) —
  describes a spartan limitation (does not cite `spartan.md` by name). Keep the why; can fold the duplicate helper note.

### Area 3 — `**/*.spec.ts`: REMOVE 7 / KEEP-SHORTEN ~15 / verbatim 0

Specs are lightly commented (~22 logical comments total). Three fully comment-free files:
`app.spec.ts`, `core/guards/auth.guard.spec.ts`, `core/interceptors/auth.interceptor.spec.ts`.

**REMOVE (7) — all cluster in the store specs, each restating the very next `expect()`:**
- "mutate-then-refetch: a successful create reloads the list" (restates `expect(list).toHaveBeenCalledOnce()`):
  [`llm-providers.store.spec.ts:45`](apps/web/src/app/features/llm-providers/data/llm-providers.store.spec.ts),
  [`skills.store.spec.ts:46`](apps/web/src/app/features/skills/data/skills.store.spec.ts).
- "a failed create/mutation never refetches — the list stays as it was" (restates `expect(list).not.toHaveBeenCalled()`):
  [`devices.store.spec.ts:77`](apps/web/src/app/features/devices/data/devices.store.spec.ts),
  [`llm-providers.store.spec.ts:63`](apps/web/src/app/features/llm-providers/data/llm-providers.store.spec.ts),
  [`skills.store.spec.ts:65`](apps/web/src/app/features/skills/data/skills.store.spec.ts),
  [`services.store.spec.ts:134`](apps/web/src/app/features/services/data/services.store.spec.ts).
- [`services.store.spec.ts:109`](apps/web/src/app/features/services/data/services.store.spec.ts) —
  "the list is refetched regardless…" restates the `listServices` assertion.

**KEEP-SHORTEN highlights (genuine boundary/characterization notes):**
- The **"strict parse at the boundary"** family (6×, KEEP — pins the strictObject contract): see Family A below.
- [`diagnosis.client.spec.ts:25-26`](apps/web/src/app/features/diagnosis/data/diagnosis.client.spec.ts) —
  minimal EventSource stand-in (jsdom has none); explains WHY the fake exists.
- [`diagnosis.store.spec.ts:11-12`](apps/web/src/app/features/diagnosis/data/diagnosis.store.spec.ts) (fake
  captures per-service stream handlers), `:134` (the done result stands; a late transport error does not
  overwrite it — async ordering edge case).
- [`devices.store.spec.ts:119`](apps/web/src/app/features/devices/data/devices.store.spec.ts) + `:133` —
  create-then-delete ordering invariant (new created before old removed).
- [`skill-run.store.spec.ts:43`](apps/web/src/app/features/services/data/skill-run.store.spec.ts) — mid-flight
  pending holds the skillId, no result yet (deferred-resolve harness).
- [`skill-form.validators.spec.ts:5-8`](apps/web/src/app/shared/validators/skill-form.validators.spec.ts) —
  validators derived from the shared schema (**contracts.md**); `:30-31` (undeclared `{{placeholder}}` fails
  the cross-field parity refine).
- [`services.store.spec.ts:106`](apps/web/src/app/features/services/data/services.store.spec.ts) — partial-failure
  expectation (the second create rejects, its name is reported, the first still lands).

## Recurring comment families (normalization candidates)

These are the heart of the cleanup. Each repeats the same fact across files; normalize to one identical
tight lowercase line (keep the rule/schema reference where present).

**Non-spec families:**
1. **`not providedIn: 'root', per angular.md`** — **13–14×** across all stores + several components
   (`app.config.ts:15`, `auth.store.ts:17`, and the 6 feature store headers + 4 component headers). KEEP;
   keep the angular.md reference.
2. **`pulls the user-facing message out of an http failure → apiErrorSchema`** — **6×** store `errorMessage`
   blocks (`audit/devices/llm-providers/services/skill-run/skills .store.ts`). Highest-redundancy block;
   keep the `apiErrorSchema` reference.
3. **`typed http i/o … relative '/api' urls ride the same-origin session cookie`** — **6×** client headers
   (the 5 crud clients + `diagnosis.client.ts` as `http/sse`). KEEP, compress prose.
4. **`parses through the shared contract / zod schema (… secret leaks fail strict parse)`** — **~12×** across
   clients + stores. KEEP; security/contract invariant.
5. **`signalState container mutated through patchState`** — **6–7×** store headers. KEEP, compress.
6. **`renders in a cdk overlay outside the route injector → store rides context not DI`** — **~9–10×** across
   components + dialogs. KEEP (real DI gotcha), normalize wording.
7. **keyed-by-serviceId isolation** (`so rows don't clobber`) — `diagnosis.store.ts:20-22`,
   `skill-run.store.ts:65`. KEEP.
8. **SSE close / never-leak** (`sse.md: never leak one`) — `diagnosis.store.ts:43`, `diagnosis.client.ts:35-38`. KEEP.

**Spec families:**
- **Family A — "a leaked key must fail the strict parse at the boundary"** — **6×** client specs
  (`audit.client.spec.ts:59`, `diagnosis.client.spec.ts:70`, `llm-providers.client.spec.ts:52`,
  `services.client.spec.ts:60`, `skill-run.client.spec.ts:39`, `skills.client.spec.ts:53`). KEEP, normalize
  to one identical line, e.g. `// a leaked key must fail the strict parse at the boundary`.
- **Family B — "mutate-then-refetch: a successful create reloads the list"** — 2× → **REMOVE** (restates assertion).
- **Family C — "a failed create never refetches — the list stays as it was"** — 4× → **REMOVE** (restates assertion).
- **Family D — create-then-delete ordering** — 2× (`devices.store.spec.ts:119,133`) → KEEP (ordering invariant).

## Code References

- [`apps/web/src/app/features/services/components/service-skills.component.ts`](apps/web/src/app/features/services/components/service-skills.component.ts) — densest file (14 comments); 9-line header to compress.
- [`apps/web/src/app/features/services/dialogs/run-skill.dialog.ts`](apps/web/src/app/features/services/dialogs/run-skill.dialog.ts) — 12 comments; 6-line header.
- [`apps/web/src/app/features/services/components/device-services.component.ts`](apps/web/src/app/features/services/components/device-services.component.ts) — 12 comments; two overlapping badge-class notes (`:24-26` + `:91`).
- [`apps/web/src/app/features/diagnosis/data/diagnosis.store.ts`](apps/web/src/app/features/diagnosis/data/diagnosis.store.ts) — highest-value SSE invariants (keyed isolation, teardown/no-reconnect, transportError-not-401).
- [`apps/web/src/app/core/auth/auth.client.ts:3-11`](apps/web/src/app/core/auth/auth.client.ts) — better-auth `basePath` workaround (decision record).
- [`apps/web/src/app/core/auth/auth.store.ts:40-41`](apps/web/src/app/core/auth/auth.store.ts) — `lessons.md` Date→iso preprocessing invariant.
- [`apps/web/src/styles.scss:1`](apps/web/src/styles.scss) — the only scss comment (generator scaffold — REMOVE).
- The 7 `*.store.ts` + 7 `*.client.ts` data-layer files — bulk of the normalizable header/errorMessage/strict-parse boilerplate.

## Architecture Insights

- **Web comments are higher-quality and lower-redundancy-of-junk than the api side.** The KEEP-SHORTEN:REMOVE
  ratio is ~13:1 (vs ~3:1 for api). There is no scaffold junk and no dead code. The change.md framing
  ("remove redundant + shorten the rest") is correct, but the real lever is **normalizing recurring families**,
  not deleting.
- **Eight recurring families dominate.** The single most repeated is `not providedIn: 'root', per angular.md`
  (13–14×); the highest-redundancy *block* is the 6× `errorMessage → apiErrorSchema` store note. Normalizing
  each family to one identical line is itself the bulk of the cleanup value.
- **The diagnosis/SSE sub-tree carries the densest load-bearing comments** (transportError bypasses the 401
  interceptor; teardown stops EventSource auto-reconnect; entries keyed by serviceId). Shorten wording, never
  the meaning — these document `sse.md` behavior the tests rely on.
- **No formatting/code risk:** no directives, JSDoc, or pragmas exist. The only failure mode is a
  `format:check` reflow if a multi-line `/* */` is edited carelessly (note: every comment here is `//`, so
  even that risk is near-zero), or an accidental edit to a non-comment line.
- **No casing work needed:** every comment already complies with `comments.md` (lowercase-first). Remaining
  capitals are code tokens (`Date`, `EventSource`, `HttpClient`, schema/type names, `createdAt`) — exempt.

## Suggested batching plan (reviewable diffs, per change.md)

Order by independence and risk, smallest blast radius first. Decide the canonical wording for each recurring
family **before** editing so the diff stays mechanical (see Open Questions):

1. **`core/{auth,guards,interceptors}` + app-root (`app.config.ts`, `main.ts`)** — small, all KEEP-SHORTEN;
   preserve the better-auth `basePath` workaround and the `lessons.md` Date→iso note.
2. **`shared/`** — `schema.validator.ts` only (1 KEEP-SHORTEN, contracts.md reference).
3. **feature `data/*` (the 7 stores + 7 clients)** — the normalization core: collapse families 1–5 to one
   canonical line each; tighten the SSE notes in `diagnosis.*`. Nearly zero deletes.
4. **feature components/dialogs** — delete the 7 REMOVE (human-label quartet, typedef, signal-restatement,
   scss scaffold), normalize the delete-target-signal note and the cdk-overlay note (family 6), compress the
   verbose file-headers (`service-skills`, `run-skill`, `device-services`).
5. **`**/*.spec.ts`** — last; normalize Family A (6× strict-parse boundary) to one line, delete Families B+C
   from the store specs, keep the characterization/ordering notes.

**Definition of done (from change.md):** `npx nx lint web` + `npx nx test web` pass unchanged;
`git diff` shows comment lines only; `npm run format:check` clean for `apps/web`.

## Historical Context (from prior changes)

- [`context/archive/2026-06-21-api-comment-cleanup/research.md`](context/archive/2026-06-21-api-comment-cleanup/research.md)
  and [`plan.md`](context/archive/2026-06-21-api-comment-cleanup/plan.md) — the **direct precedent**. Same
  taxonomy (REMOVE / KEEP-SHORTEN / KEEP-VERBATIM), same recurring-pattern-normalization approach, same
  verbatim sweep, and the user's decision to land it as a **single commit** (`docs(api): clean up and trim
  comments`) rather than per-batch. Key difference for web: the api side had 4 keep-verbatim records (TOFU
  disclosure + 3 `@Inject` lessons.md refs) and a ~3:1 ratio; the web side has **0 keep-verbatim** and a
  ~13:1 ratio, so it is even safer and more normalization-driven.
- [`context/foundation/lessons.md`](context/foundation/lessons.md) — the **Date↔ISO at the Better Auth client
  boundary** lesson is directly cited by `auth.store.ts:40-41`; preserve that comment's fact. The other four
  lessons are api-side and don't surface in web comments.
- The recent history is a run of test/characterization closes (`testing-security-guardrails`,
  `testing-ssh-executor-lifecycle-timeout`) plus the api comment cleanup — which is why both apps now carry
  dense, deliberate "why" comments rather than chatter.

## Related Research

- [`context/archive/2026-06-21-api-comment-cleanup/research.md`](context/archive/2026-06-21-api-comment-cleanup/research.md) —
  the sibling api cleanup research; this web research mirrors its structure and method.

## Open Questions

1. **Canonical wording for each recurring family.** Agreeing one short lowercase line per family (families 1–8
   non-spec + Family A spec) *before* editing keeps the diff mechanical and the review trivial. Recommendation:
   adopt the existing best-phrased instance as canonical and apply it verbatim everywhere (keeping each
   reference: `angular.md`, `apiErrorSchema`, `sse.md`, etc.).
2. **How hard to compress the multi-line file-headers?** The 8 headers (5–9 lines) carry real architecture
   (overlay-vs-DI, provider lifecycle). Recommendation: compress to ~2–3 lines retaining the rule reference and
   the non-obvious "why", not down to one line that loses the gotcha.
3. **Delete vs tighten the 3 soft `patchEntry`/`teardown` notes and the 4× delete-target-signal note.**
   Recommendation: drop the 3 soft restatements; normalize the delete-target note to one short line (it has a
   sliver of "why" — it drives the alert-dialog copy).
4. **Single commit or per-batch?** The api precedent landed as one commit (`docs(api): …`). Recommend mirroring
   with `docs(web): clean up and trim comments`, body noting the single-commit deviation from change.md's
   per-batch batching.
</content>
</invoke>
