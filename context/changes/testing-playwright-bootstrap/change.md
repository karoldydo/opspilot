---
change_id: testing-playwright-bootstrap
title: Playwright E2E bootstrap (test-plan Phase 4 enabler)
status: implemented
created: 2026-06-24
updated: 2026-06-25
archived_at: null
---

## Notes

Infrastructure-only change: installs Playwright and stands up the `tests/e2e` Nx project so
`/10x-e2e` can author the diagnoseLogs/SSE tests (`test-plan.md` §3 Phase 4) afterwards. Scope
decided up front: location `tests/e2e` (flat, but still an Nx project tagged `scope:e2e`), no CI
yet (local-only), Chromium only.

- `research.md` — grounded workspace facts (Nx 22.7.2, ports, proxy, cookie auth, isolated SQLite, boundaries).
- `plan.md` — 2 phases (install/scaffold, then config/auth/smoke) with `## Progress`.
- Source plan: `~/.claude/plans/jestes-w-trybie-planowania-immutable-lark.md` (approved).
