---
change_id: testing-ssh-executor-lifecycle-timeout
title: Test SSH executor lifecycle + bounded timeout (test-plan Phase 2)
status: implementing
created: 2026-06-16
updated: 2026-06-16
archived_at: null
---

## Notes

Open a change folder for rollout Phase 2 of context/foundation/test-plan.md: "SSH executor lifecycle + timeout".
Risks covered: #2 (SSH executor: a connection is not disposed after a run, or a command/scan exceeds its bounded timeout and the run never terminates).
Test types planned: integration (api, fake SSH boundary).
Risk response intent: prove that after a run the SSH connection is disposed (no leak); a command exceeding the timeout is aborted with a clean error; the container scan stays within its bounded timeout. Challenge "HTTP 200 means the connection was cleaned up" and "the scan works today so it can never exceed the timeout". Avoid over-mocking the executor so dispose/timeout never actually fire, and avoid a happy-path-only test with no timeout path.
After creating the folder, follow the downstream continuation rule (suggest /10x-research next).
