<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Scan and Add Services (S-02)

- **Plan**: context/changes/scan-and-add-services/plan.md
- **Scope**: All 4 phases (full plan)
- **Date**: 2026-06-10
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 4 observations

## Verdicts

| Dimension           | Verdict |
|---------------------|---------|
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Automated verification: `typecheck`, `lint`, `test` (62 api / 21 web), `format:check` — all PASS.

Plan drift: 3 intentional improvements over the plan text, none flagged —
(1) `ssh-client.factory.ts` test seam for fakeable transport;
(2) locale-robust docker detection via exit-code 127 in addition to stderr match;
(3) PATH-prefixed scan command for Synology non-interactive sessions.
No missing items, no scope creep.

## Findings

### F1 — SSH host-key verification disabled (MITM exposure)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: apps/api/src/executor/ssh.executor.ts:45-50
- **Detail**: `ssh.connect(...)` passes no `hostVerifier`/`hostHash`, so node-ssh trusts any host key on first contact. Decrypted credentials traverse that connection; a LAN MITM is undetected. Plausibly an accepted homelab tradeoff, but undocumented as a decision.
- **Fix A ⭐ Recommended**: Document as accepted risk (comment + node-ssh.md note).
  - Strength: Matches homelab scale (trusted LAN); turns a default into a deliberate choice.
  - Tradeoff: Risk remains, only named.
  - Confidence: HIGH — rest of slice is clean on secret handling.
  - Blind spot: If a device ever sits outside the LAN, decision needs revisiting.
- **Fix B**: Add a `hostVerifier` with key pinning (TOFU).
  - Strength: Closes the MITM class.
  - Tradeoff: New state to maintain (known_hosts); out of this slice's scope.
  - Confidence: MEDIUM — needs key storage.
  - Blind spot: Unverified how it fits the device/credential model.
- **Decision**: FIXED via Fix A — comment at the connect call in ssh.executor.ts + "Host keys (accepted risk)" section in .claude/rules/node-ssh.md.

### F2 — ssh.dispose() in finally may throw before connect

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: apps/api/src/executor/ssh.executor.ts:63-72
- **Detail**: When `connect()` rejects, `finally` still calls `dispose()` on an unconnected client. node-ssh usually no-ops, but a throw would mask the original mapped connect error.
- **Fix**: Wrap `ssh.dispose()` in a try/catch (swallow) inside `finally`.
- **Decision**: FIXED — dispose wrapped in try/catch with swallowed error.

### F3 — Mutex map grows unbounded

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: apps/api/src/executor/ssh.executor.ts:114-121
- **Detail**: Entries are never evicted (one Mutex per device id ever seen). Get-or-create is race-free (synchronous, no await between get and set) but the comment didn't state why.
- **Fix**: Add the synchronous-creation invariant to the comment; eviction only if device churn becomes real.
- **Decision**: FIXED — comment added documenting the race-free invariant and unbounded-but-tiny growth.

### F4 — DeviceActionResult imported across features

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: apps/web/src/app/core/stores/services.store.ts:7
- **Detail**: `services.store` imports `DeviceActionResult` from `devices.store`, coupling the services feature to devices. Works (re-exported), but the shared `{ error: null | string }` shape arguably belongs in a neutral location.
- **Fix**: Move `DeviceActionResult` to a neutral file under core/ and update both imports.
- **Decision**: SKIPPED.

### F5 — findAll without pagination

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: apps/api/src/service/service.service.ts:56-59
- **Detail**: `findAll` has no `.limit()/.offset()`; drizzle.md says "paginate every list query". Per-device services are inherently small, but it is an unbounded scan the credential list does not have.
- **Fix**: Add `.limit()/.offset()`, or accept (per-device list is bounded by nature).
- **Decision**: SKIPPED — per-device list is small by design.
