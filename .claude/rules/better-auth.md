---
paths:
  - apps/api/**/*.ts
  - apps/web/**/*.ts
---
# Better Auth (accounts & sessions)

Authentication is **Better Auth** with the Drizzle adapter; the access model is **flat - no
roles/RBAC**. Do NOT hand-roll JWT guards or `bcrypt` hashing - Better Auth owns credential
handling and stores sessions in SQLite.

## Server (`apps/api`)

- Mount the Better Auth handler on a catch-all route (its own auth slice); back it with the
  Drizzle adapter pointed at the shared DB connection (see `drizzle.md`).
- Sessions live in SQLite via Better Auth's tables - do not add a parallel session/token store.
- Guard every endpoint except the public Better Auth handler itself; an unauthenticated request
  must reach no operational function.

## Client (`apps/web`)

- Use the Better Auth client (`createAuthClient({ baseURL: '/api' })`) - do not hand-roll
  fetch-based login/session handling.
- Guard feature routes with a **functional `CanActivateFn`** that injects the auth state and
  redirects unauthenticated users to login.
- Add an HTTP interceptor that catches `401`, clears local session state, and redirects to
  login - so an expired session never leaves the UI in a half-authenticated state.
