---
starter_id: nx
package_manager: npm
project_name: opspilot
hints:
  language_family: js
  team_size: solo
  deployment_target: self-host
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: verified
  path_taken: custom
  quality_override: false
  self_check_answers:
    typed: true
    from_official_starter: true
    conventions: true
    docs_current: true
    can_judge_agent: true
  has_auth: true
  has_payments: false
  has_realtime: true
  has_ai: true
  has_background_jobs: true
---

## Why this stack

Solo developer building a self-hosted homelab tool over an 8-week
after-hours timeline. The user-specified stack from idea-notes.md is
Angular 21 + spartan/ng + Tailwind v4 on the frontend, NestJS exposing
REST + SSE on the backend, Drizzle ORM over SQLite (WAL), Zod shared
FE↔BE, Better Auth in-app (Drizzle adapter), Vercel AI SDK driving the
agent (`generateText` + tool-calling, `generateObject` + Zod for the
structured synthesis), node-ssh behind an `IExecutor`, async-mutex for
per-device concurrency, nmap/arp-scan for LAN discovery, and Vitest +
Playwright for tests — shipped as one multi-arch container through
GitHub Actions to GHCR. Two TypeScript apps plus a shared validation
library is the canonical monorepo case, so the hand-off anchors on
`nx` — the only registry starter with first-class Angular
(`@nx/angular`) and Nest (`@nx/nest`) generators. Self-host is the
deployment default; Cloudflare Tunnel/Access is a transparent edge
layer outside the app, not edge compute — long-running SSH, SSE
narration, and background agent runs need a persistent Node server,
ruling out edge-first starters. The stack clears all four
agent-friendly gates, so no quality override; feature flags
auth/AI/realtime/background-jobs set, payments out of scope. Known
friction: the nx card's `--preset react-monorepo` default is wrong;
init with the Angular + Nest plugins instead.
