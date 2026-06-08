---
change_id: account-auth-foundation
title: Account auth foundation
status: implemented
created: 2026-06-07
updated: 2026-06-09
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### Deployment assumption (load-bearing — frame mandate)

Cloudflare Access (allowed-emails policy + WARP) fronts the entire app and is the **registration
gate**. Open in-app signup (`emailAndPassword.disableSignUp` stays OFF) is safe **only** under that
gate — only allowlisted emails / WARP-onboarded devices ever reach `/api/auth/sign-up`. The in-app
session is the audit identity and a second security layer, not the world-facing signup barrier.
If the app is ever exposed without Access, flip `emailAndPassword.disableSignUp: true` (the one-line
lever) before deploying, or open signup becomes world-open registration.
