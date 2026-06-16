---
change_id: testing-ssh-executor-lifecycle-timeout
title: Test SSH executor lifecycle + bounded timeout (test-plan Phase 2)
status: archived
created: 2026-06-16
updated: 2026-06-16
archived_at: 2026-06-16T21:21:02Z
---

## Notes

Open a change folder for rollout Phase 2 of context/foundation/test-plan.md: "SSH executor lifecycle + timeout".
Risks covered: #2 (SSH executor: a connection is not disposed after a run, or a command/scan exceeds its bounded timeout and the run never terminates).
Test types planned: integration (api, fake SSH boundary).
Risk response intent: prove that after a run the SSH connection is disposed (no leak); a command exceeding the timeout is aborted with a clean error; the container scan stays within its bounded timeout. Challenge "HTTP 200 means the connection was cleaned up" and "the scan works today so it can never exceed the timeout". Avoid over-mocking the executor so dispose/timeout never actually fire, and avoid a happy-path-only test with no timeout path.
After creating the folder, follow the downstream continuation rule (suggest /10x-research next).

## Follow-up (deferred from Phase 3)

**Harden truncated-line NDJSON parsing in the service scan (gap d).** Today
`parseContainer` (`apps/api/src/modules/service/service.service.ts`) uses strict
`JSON.parse` + `z.strictObject` with no per-line try/catch, so a single partial
line — as a timeout-killed `docker ps` can emit — fails the **whole** scan. This
phase only *pinned* that behavior with a characterization test
(`service.service.spec.ts`, "fails the whole scan on a truncated NDJSON line")
and a §7 note; it deliberately did **not** change behavior (a testing phase must
not smuggle a behavior change).

- **Acceptance idea**: wrap per-line parse in a try/catch so a malformed/partial
  line is skipped (optionally counted/logged), valid containers are still
  returned, and the scan does not reject wholesale on one bad line.
- **Open with**: `/10x-new` as its own implementation change; update the §7
  truncated-line entry and the characterization test when it lands.
