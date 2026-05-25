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

Solo developer building a self-hosted homelab tool over an 8-week after-hours
timeline, with a user-specified stack from idea-notes.md: Angular 21 frontend +
NestJS backend + Drizzle/SQLite + shared Zod schemas, shipped as one multi-arch
container. Two TypeScript apps plus a shared validation library in one repo is
the canonical monorepo case, so the hand-off anchors on `nx` — the only
registry starter with first-class Angular (`@nx/angular`) and Nest (`@nx/nest`)
generators. The stack clears all four agent-friendly gates (typed, convention-
based, popular within the JS family, well-documented), so no quality override.
Self-host is the deployment default (Cloudflare Tunnel/Access is a transparent
edge layer outside the app, not edge compute — long-running SSH connections,
SSE live narration, and background agent runs all need a persistent Node
server, ruling out edge-first starters). Feature flags auth/AI/realtime/
background-jobs are set; payments is out of scope per PRD non-goals. Known
friction: the nx card's default `cmd_template` uses `--preset react-monorepo`;
bootstrapper must instead init with the Angular + Nest plugins.
