<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Encrypted Credential Store

- **Plan**: context/changes/encrypted-credential-store/plan.md
- **Scope**: Phases 1–4 of 4
- **Date**: 2026-06-09
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension           | Verdict |
|---------------------|---------|
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Success criteria (verified live)

- `npx nx test api` — PASS (27/27; credential.service.spec 5/5)
- `npx nx test shared` — PASS (23/23; credential.schema leak-rejection)
- `npx nx lint api` — PASS
- `npx nx lint shared` — PASS
- `npx nx build api` — PASS (webpack compiled successfully)

Manual items 1.4–4.8 all `[x]`; the security-sensitive ones (db:studio
ciphertext-only, getDecryptedSecret round-trip, secret-free Credential) are
backed by assertions in credential.service.spec.ts — no rubber-stamping.

High-risk concerns confirmed correct by both review agents:

- AES-256-GCM: random 12-byte IV per encrypt, authTag set before final(),
  32-byte key asserted at construction, no IV reuse, no secret logging.
- Secret fully walled off from /api: z.strictObject read contract omits all
  secret material; toContract() projects 6 safe fields (no row spread).
- Typed Drizzle query API used (not raw $client); $inferSelect stays api-local.
- list() paginated and hits credential_deviceId_idx.

## Findings

### F1 — Decrypt failure propagates a raw node:crypto error

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Reliability
- **Location**: apps/api/src/credential/credential.service.ts:54-57
- **Detail**: getDecryptedSecret() lets a raw "unable to authenticate data" node:crypto error bubble up on tamper/wrong-key. Defensible now — service-only method, no controller, decrypt fault on stored data is a genuine integrity error (500 is correct). Domain-error wrap matters only once a real caller (future node-ssh IExecutor) consumes it. Out of this change's scope.
- **Fix**: Defer to the node-ssh integration change; wrap in a domain error when the first real caller is wired.
- **Decision**: SKIPPED

### F2 — list() has no upper bound on a caller-supplied limit

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Performance
- **Location**: apps/api/src/credential/credential.service.ts:59-68
- **Detail**: list(deviceId, offset, limit=50) is correctly paginated and hits credential_deviceId_idx, but a service caller could pass an arbitrarily large limit. No controller binds this yet, so it is unreachable from the wire. The cap belongs at the endpoint when the HTTP surface is added. Out of this change's scope.
- **Fix**: Bound limit (e.g. clamp to ≤100) in the request DTO when the credential controller is introduced.
- **Decision**: SKIPPED
