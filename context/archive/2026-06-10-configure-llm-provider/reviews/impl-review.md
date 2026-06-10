<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Configure LLM Provider (S-03 / FR-012)

- **Plan**: context/changes/configure-llm-provider/plan.md
- **Scope**: Full plan — Phases 1–4 of 4
- **Date**: 2026-06-11
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations

## Verdicts

| Dimension           | Verdict |
|---------------------|---------|
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Success Criteria — automated (re-run live)

- `npx nx test shared,api,web` — 87 api tests pass, all green
- `npx nx lint shared,api,web` — clean
- `npx nx typecheck shared` — clean
- `npm run format:check` — exit 0
- `npx nx build api` / `npx nx build web` — webpack + app builder OK
- migration `0003_ancient_professor_monster.sql` present

Manual criteria (plan `## Progress`): all `[x]`; corroborated by code evidence
(single-active transaction, secret-omission via `strictObject`, probe
reject-on-fail) — no rubber-stamping detected.

Note: two previously-known issues (single-active race in `create`, key-decrypt
error wrapping) were already fixed post-implementation in commit `747c42b` and
are present.

## Findings

### F1 — SSRF by design on user-controlled baseURL

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: apps/api/src/llm-provider/llm-provider.probe.ts:15-21
- **Detail**: The probe fetches `${baseURL}/models` with a `Bearer ${apiKey}` header, where `baseURL` is validated only by `z.url()` — no host allowlist, no scheme / private-IP restriction. An operator could point a provider at `169.254.169.254` or an internal host and observe reachability/auth status via the returned domain error. For a single-admin homelab behind Cloudflare Access the only caller is the same person who could SSH the box — accepted-risk class, and the plan treats baseURL as trusted operator input.
- **Fix**: Add a one-line "baseURL is trusted operator input by design" note in the probe so the threat model is explicit if this ever goes multi-tenant.
- **Decision**: FIXED — added trusted-by-design comment at probe.ts URL construction (Fix now).

### F2 — Probe response body never drained

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability)
- **Location**: apps/api/src/llm-provider/llm-provider.probe.ts:16-33
- **Detail**: On the success path only `res.ok`/`res.status` are read; the body stream is left un-consumed. With undici the connection is GC-reclaimed, not a hard leak, but the keep-alive socket lingers until GC. Low-frequency endpoint → negligible.
- **Fix**: `await res.body?.cancel()` after the fetch resolves to release the socket eagerly.
- **Decision**: FIXED — added `await res.body?.cancel()` before the status checks (covers success + error paths) (Fix now).

### F3 — findAll unbounded (no .limit())

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: apps/api/src/llm-provider/llm-provider.service.ts:55-58
- **Detail**: `findAll` does a full `.select().all()` with no `.limit()/.offset()`, while the sibling `credential.service.ts` paginates (`LIST_LIMIT`) and `drizzle.md` says "paginate every list query". The plan explicitly accepts this for a single-user homelab ("an unbounded findAll is fine for this scale"). Documented decision; divergence from one sibling only.
- **Fix**: None required; add `.limit()` only if provider count grows.
- **Decision**: SKIPPED — consistent with the documented plan decision.
