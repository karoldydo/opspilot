# SSH Executor Lifecycle + Bounded Timeout — Plan Brief

> Full plan: `context/changes/testing-ssh-executor-lifecycle-timeout/plan.md`
> Research: `context/changes/testing-ssh-executor-lifecycle-timeout/research.md`

## What & Why

Rollout Phase 2 of the test plan defends Risk #2: an SSH connection leaks after a run, or a
command/scan exceeds its bounded timeout and the run never terminates. Research found the
executor **already defends this structurally** (dispose in a `finally`, a `Promise.race`
command timeout → clean 504, the safe explicit-field scan command). So this phase does not
build a seam or a first test — it closes the narrow residual gaps by extending existing specs.

## Starting Point

`ssh.executor.spec.ts` already pins dispose-on-success, dispose-on-connect-failure,
command-timeout→dispose, and the per-call override (faking at `SSH_CLIENT_FACTORY`).
`service.service.spec.ts` exercises `scan()` over real temp SQLite with a mocked `EXECUTOR`,
but every case feeds a **resolved** executor — there is no consumer-level hang/timeout test,
no scan-command regression guard, and no characterization of the strict-parse fragility.

## Desired End State

The executor proves dispose runs on **every** branch (incl. `execCommand`-reject) and that a
dispose error never masks the original. `scan()` proves a hung/timed-out executor surfaces as a
clean 504 with no audit row. `SCAN_COMMAND` is guarded against reverting to the slow form. The
truncated-line behavior is pinned. The cookbook (§6.3), the deliberately-untested list (§7),
and a deferred-fix follow-up are all recorded.

## Key Decisions Made

| Decision                          | Choice                                                  | Why (1 sentence)                                                                  | Source   |
| --------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------- | -------- |
| Where new tests live              | Extend existing spec files (no new Nest module)         | Structural guarantee already proven at unit level; graph-level re-wiring is marginal signal at higher cost. | Plan     |
| Consumer-hang (gap b)             | Add `service.service.spec.ts` 504-propagation test      | Highest-signal new test — the boundary the user actually hits.                    | Plan     |
| Connect-timeout (gap a)           | Skip; document in §7                                    | `readyTimeout` is node-ssh's own option — a test mostly asserts third-party config and risks flakiness. | Plan     |
| Scan-command regression guard     | Add a negative content assertion                        | Locks in the `lessons.md` ~27 s incident at near-zero cost.                       | Plan     |
| Truncated-line fragility (gap d)  | Pin current behavior + defer the fix                    | A testing phase must not smuggle a behavior change; flag a separate follow-up.    | Plan     |
| Executor dispose matrix (Phase 1) | Close the two uncovered lifecycle branches              | Cheap, on-theme completeness for "lifecycle"; completes dispose-on-all-paths.     | Plan     |

## Scope

**In scope:** executor dispose-matrix completion (`execCommand`-reject, dispose-error-no-mask);
consumer-level timeout→504-no-audit; scan-command regression guard; truncated-line
characterization; cookbook §6.3 / §7 / §6.6 docs; deferred gap-d follow-up flag.

**Out of scope:** new Nest `TestingModule` SSH integration file (gap c); wall-clock connect-timeout
test (gap a); hardening the parse path (gap d); any production code change.

## Architecture / Approach

Mirror Phase 1's two-seams doctrine. Fake at `SSH_CLIENT_FACTORY` for executor-internal
lifecycle/timeout tests (never `vi.mock('node-ssh')`); fake at the `EXECUTOR` token for
consumer-level scan tests. Use a tiny real bound + a hanging fake (no fake timers). All tests
extend existing files.

## Phases at a Glance

| Phase                                         | What it delivers                                                   | Key risk                                              |
| --------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------- |
| 1. Executor dispose matrix                    | `execCommand`-reject dispose + dispose-error-no-mask tests         | Marginal — could be seen as redundant with timeout test |
| 2. Consumer timeout + scan guard              | 504-no-audit propagation, scan-command guard, truncated-line pin   | Service mocks executor — asserts propagation, not real race |
| 3. Docs + deferred-fix flag                   | §6.3 cookbook, §7 exclusions, §6.6 note, gap-d follow-up           | Deferred fix is forgotten if not flagged where found  |

**Prerequisites:** none — seam and harnesses already exist.
**Estimated effort:** ~1 session across 3 small phases.

## Open Risks & Assumptions

- Consumer-level test mocks the executor, so it proves clean **propagation**, not a real wall-clock
  race — the real race stays proven in `ssh.executor.spec.ts` (accepted by design).
- Gap c (graph-level fake-SSH wiring) stays open by decision — lowest-signal gap.
- Deferred gap-d hardening must be captured as a real follow-up or it is lost.

## Success Criteria (Summary)

- Dispose is proven on every lifecycle branch and a dispose error never masks the real failure.
- `scan()` surfaces a hung/timed-out executor as a clean 504 with no audit row (no hang).
- `SCAN_COMMAND` cannot silently regress to the slow `-s`/`{{json .}}` form.
