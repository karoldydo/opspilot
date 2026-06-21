---
change_id: testing-security-guardrails
title: Test rollout Phase 3 — security guardrails (secrets, skill confinement, auth boundary)
status: implementing
created: 2026-06-16
updated: 2026-06-21
archived_at: null
---

## Notes

Open a change folder for rollout Phase 3 of context/foundation/test-plan.md: "Security guardrails".
Risks covered: #4 (secret leakage), #3 (agent guardrail / per-device skill confinement incl. custom skills), #5 (auth boundary).
Test types planned: integration / contract (api, real temp DB).
Risk response intent:
- #4: prove a stored credential is ciphertext in its column on disk and the encrypt→store→decrypt round-trip recovers the plaintext; the secret never appears in the audit transcript, a response body, or an error body.
- #3: prove the agent's tool-set on device D equals exactly the skills scoped to D (a skill not scoped to D is never callable, including user-defined custom skills); a skill parameter substitutes as an argument, not as injectable shell.
- #5: prove every operational endpoint returns 401 without a valid session.
After creating the folder, follow the downstream continuation rule.
