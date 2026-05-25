---
project: "opspilot"
context_type: greenfield
created: 2026-05-25
updated: 2026-05-25
timeline_budget:
  mvp_weeks: 8
  hard_deadline: null
  after_hours_only: true
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "insight"
      decision: "homelab diagnostics is in practice a repeatable loop see-logs → interpret → restart; an ideal task to hand off to an agent, while existing tools deliberately remain CRUD-only"
    - topic: "pain category"
      decision: "missing capability (diagnostic layer) + workflow friction (SSH-per-host) + data trapped (logs scattered across hosts)"
    - topic: "persona scope"
      decision: "self-host for a small trusted group (family/housemates); multi-user without roles"
    - topic: "access shape"
      decision: "account: registration + login + sessions in the application"
    - topic: "role model"
      decision: "flat multi-user, no roles; accountability solely through the audit log"
    - topic: "mvp scope vs timeline"
      decision: "the user consciously chose the full scope on a longer timeline (est. 7-10 weeks, 8 for planning); the cost of sustained effort accepted"
    - topic: "guardrails"
      decision: "SSH credentials never in plaintext (encryption at-rest); the agent executes exclusively predefined skills (no free-form/destructive actions)"
    - topic: "socrates FR-003"
      decision: "LAN scan demoted to nice-to-have; removes the main risk (Synology network_mode host) from the critical MVP path, fallback = manual addition"
    - topic: "socrates FR-011"
      decision: "audit reworded to be neutral toward implementation; the number of tables (one vs two) pushed down the chain"
    - topic: "socrates FR-013"
      decision: "encryption at-rest stays, but a threat-model limitation was accepted (protects a backup/DB file, not a live host); question about the key → Open Questions"
    - topic: "business logic rule"
      decision: "synthesis of raw logs into a structured state assessment (status/problems/suggestions/summary) → action prompt; a real rule, not empty CRUD"
    - topic: "nfr boundaries"
      decision: "diagnosis <15s, operation <10s, ≥95% skill success, no hangs (result/error within finite time), no plaintext credentials at rest; cost consciously non-NFR"
    - topic: "product framing"
      decision: "web-app; small scale (self-host a handful); no deadline; after hours; 100x scale is a different product (non-goal)"
    - topic: "non-goals load-bearing"
      decision: "load-bearing: no chat/free-form, no metrics monitoring, no custom output schemas via the UI"
  frs_drafted: 13
  quality_check_status: accepted
---

# opspilot - Shape Notes

> Source seed: `idea-notes.md` (read verbatim 2026-05-25).
> Discovery in progress. Sections below anticipate the 10 greenfield PRD sections in schema order.

## Vision & Problem Statement

Homelabbers running several devices (Synology NAS, Raspberry Pi, mini-PC) with Docker containers in `docker-compose` stacks diagnose and operate their services manually: SSH into each host separately and grep through logs. When a service breaks down, the cost is jumping between terminals and reading logs by hand. Existing tools (Portainer, Dockge, Komodo) do container CRUD well, but lack a layer that summarizes a service's state from the logs and proposes concrete actions.

Insight: homelab diagnostics is in practice a repeatable loop - see logs → interpret → restart - ideal to hand off to an AI agent. Existing tools deliberately stay "dumb" (CRUD-only), so the gap is a missing capability (diagnostic layer), compounded by workflow friction (SSH-per-host) and data trapped in logs scattered across devices. opspilot adds an agentic AI layer on top of basic operations: one-click diagnostics from the browser, without opening SSH.

## User & Persona

Homelabber - a person running several home devices (Synology NAS, Raspberry Pi, mini-PC) with Docker services in `docker-compose` stacks. They want to manage them from one place and have an AI agent supporting diagnostics. They reach for opspilot the moment one of the services misbehaves and normally they would have to open a terminal and SSH into each host one by one. Self-hosted deployment for a small group of trusted users (family / housemates); multi-user model without roles, with accountability through the audit log.

## Access Control

Multi-user with accounts: each user creates an account (registration), logs in and has a session in the application. The model is flat - no roles and no RBAC; all logged-in users have the same permissions. Accountability ("who did what") is provided solely by the audit log, not by separation of permissions. An unauthenticated user has no access to any operational function. The smallest useful model for self-hosting a small trusted group: user identification for auditing, without the cost of managing roles.

> Forward (deployment, NOT for the PRD): in the notes the edge layer is Cloudflare Access in front of the application and Better Auth as the auth library inside the application. These are deployment/stack choices - see `## Forward: tech-stack`.

## Success Criteria

### Primary
- A user diagnoses a Docker service from the browser, without SSH, and receives a structured synthesis (status, problems, suggestions, summary) for ~200 log lines in < 15 s.
- A user performs an operation on a service (e.g. restart) from the browser, with confirmation in the UI in < 10 s.
- At least 95% of skill runs complete successfully.

### Secondary
- Setup without manually entering IPs thanks to device auto-discovery (LAN scan) - reduces configuration friction, but the core works without it (consistent with FR-003 nice-to-have).
- Cost of a single diagnosis < $0.01 (a GPT-4o-mini-class cloud model) - a welcome cost target, not a success condition (consciously non-NFR).

### Guardrails
- SSH credentials are never stored in plaintext - encryption at-rest; a leak is a critical regression even if everything else works.
- The agent executes exclusively predefined skills - no free-form prompts or destructive actions outside the defined set.

## Timeline acknowledgment

Acknowledged on 2026-05-25: 8-week (estimated 7-10) MVP requires sustained dedication; user accepted. The full scope from the notes is being built consciously on a longer timeline.

## Functional Requirements

### Accounts and access
- FR-001: A user can create an account and log in (registration, login, session). Priority: must-have
  > Socrates: Considered counterargument: "the instance sits behind Cloudflare Access, so in-app login is redundant". Resolution: stays - the audit log requires an identity independent of the deployment layer, and CF Access is an optional edge layer.
- FR-013: The system stores SSH credentials in encrypted form at-rest. Priority: must-have
  > Socrates: Considered counterargument: "encryption at-rest is apparent security - the key lives on the same host as the data". Resolution: stays as a guardrail, but with an explicitly accepted limitation - it protects against a leak of a backup / DB file, NOT against takeover of a running host. The question of key management moved to `## Open Questions`.

### Devices
- FR-002: A user can manage devices - add manually (address + SSH credentials), edit, delete. Priority: must-have
  > Socrates: Considered counterargument: "central storage of SSH credentials is the main risk surface / the device abstraction is unnecessary". Resolution: stays - multiple physical hosts are the core of the problem, the "device" entity is necessary.
- FR-003: A user can discover devices on the local network via a scan and add selected ones. Priority: nice-to-have
  > Socrates: Considered counterargument: "the LAN scan is the top risk (network_mode: host + NET_ADMIN, Synology DSM compatibility); manual addition already covers the need". Resolution: DEMOTED to nice-to-have. Fallback = manual addition (FR-002); full auto-discovery returns after validation on Synology. Effect: removes the main risk from the critical MVP path.

### Services
- FR-004: A user can scan containers on a device and add selected services to the managed ones (and edit/delete them). Priority: must-have
  > Socrates: Considered counterargument: "show all detected containers instead of curating a subset of managed ones". Resolution: stays - the explicit choice of managed services limits the agent's reach and the noise; this is deliberate.

### Agent context
- FR-005: A user can define a per-device system prompt as context for the agent (e.g. path conventions, sudo requirements, availability hours). Priority: must-have
  > Socrates: Considered counterargument: "a global prompt would be enough in the MVP". Resolution: stays - different hosts have different conventions (sudo, paths), per-device context affects the agent's accuracy.

### Skills
- FR-006: A user can define, edit and delete skills (parameterized commands) with a global scope or assigned to a device. Priority: must-have
  > Socrates: Considered counterargument: "a read-only set of skills in the MVP; CRUD of own skills for v2". Resolution: stays - parameterized per-device skills are the heart of the programmable operations layer, a foundation and not an add-on.
- FR-007: The application provides 6 default skills (start, stop, restart, up, down, diagnoseLogs) and a hidden built-in skill scanServices. Priority: must-have
  > Socrates: Considered counterargument: "diagnoseLogs + restart are enough to prove the value". Resolution: stays - 6 skills is a small deterministic set, all cheap to add and together they show the full service lifecycle.

### Agent execution
- FR-008: A user can run a skill on a selected service; the agent executes it deterministically and sees only the skills proper to the given device. Priority: must-have
  > Socrates: Considered counterargument: "for deterministic commands, direct execution is simpler than an agent layer". Resolution: stays - agent-first from day 0 is a conscious decision (no refactor when chat is added), and per-device filtering protects against acting on the wrong host.
- FR-009: For diagnoseLogs the agent returns a structured synthesis: status, problems, suggestions, summary. Priority: must-have
  > Socrates: Considered counterargument: "plain text instead of an enforced 4-field schema". Resolution: stays - structured output gives a consistent UI and the ability to act on suggestions, this is the essence of the diagnostic layer.

### Narration and transcript
- FR-010: A user sees live narration of the agent's run and can replay a saved full transcript of an earlier run. Priority: must-have
  > Socrates: Considered counterargument: "replay is deferrable - live narration alone is enough in the MVP". Resolution: stays - the transcript is saved in the agent run log anyway, so replay is a small add-on over existing data.

### Audit
- FR-011: The system maintains an audit log covering user actions and agent runs (along with the run transcript), linked to each other. Priority: must-have
  > Socrates: Considered counterargument: "one table is enough vs splitting into two linked tables". Resolution: COUNTERARGUMENT ACCEPTED - the FR reworded to be neutral toward implementation (audit of actions + runs). The number of tables is an implementation decision pushed down the chain (see `## Forward: technical-roadmap`).

### Settings
- FR-012: A user can configure an OpenAI-compatible LLM provider. Priority: must-have
  > Socrates: Considered counterargument: "configuration via environment variables / a single hardcoded provider in the MVP". Resolution: stays - swapping the provider (OpenAI/OpenRouter/LiteLLM/local) without a redeploy matters to a homelabber controlling cost.

## User Stories

### US-01: Diagnose a service from the browser, without SSH

- **Given** a logged-in user with at least one managed service on an added device
- **When** they click "diagnoseLogs" on that service
- **Then** the agent connects to the device, fetches the logs and the user sees a structured synthesis (status, problems, suggestions, summary) in < 15 s

#### Acceptance Criteria
- The synthesis contains all four fields: status, problems, suggestions, summary
- The run narration is visible live during execution
- The full transcript is saved and can be replayed
- The user does not manually open any SSH session

## Non-Functional Requirements

- Diagnosis of a service's logs (~200 lines) returns a result to the user in < 15 s.
- An operation on a service (e.g. restart) is confirmed in the UI in < 10 s.
- At least 95% of skill runs complete successfully.
- Every skill run ends with a result or an unambiguous error within a finite time - none stays hanging indefinitely.
- SSH credentials do not appear in plaintext in data at rest.

## Business Logic

opspilot transforms a service's raw logs into a structured state assessment (status, problems, suggestions, summary), on the basis of which it suggests concrete operational actions.

The rule's input is the logs of the selected service on the given device and the per-device context provided by the user (path conventions, privileged requirements, availability hours). The output is a structured assessment with four fields: status (the service's overall health), problems (what is wrong), suggestions (what to do), summary (a concise description of the situation). The user encounters the rule by running a diagnosis on a specific service: they see the run narration live, and at the end the assessment, from which they can trigger a concrete remedial action (e.g. restart) - without leaving the browser.

## Non-Goals

Items marked **[load-bearing]** hard-shape the product; the rest are softer "not for now" (candidates for v2).

- **[load-bearing]** No chat / free-form prompts to the agent - exclusively predefined skills as guardrails; shapes the entire agent layer.
- **[load-bearing]** No metrics monitoring (CPU/RAM/disk) - that's Grafana's role; opspilot does not compete with observability.
- **[load-bearing]** No defining custom LLM output schemas via the UI - a registry with a single hardcoded schema (logs-diagnosis), extensible only in code.
- No roles / RBAC (admin/user/viewer) - flat multi-user, accountability through the audit log.
- No container updates with rollback (compose pull + healthcheck + auto-rollback) - v2.
- No skill scheduling (cron-like) - v2.
- No notifications (webhook / e-mail) about failures - v2.
- No bulk operations (restarting multiple services at once) - v2.
- No application backup / restore - v2.
- No mobile / desktop application - web only.
- No i18n (PL/EN) - single-language UI.
- No dark mode / theming.
- No scaling beyond the homelab (hundreds of services, multi-tenant) - at 100x the rule would require prioritization/aggregation; that's a different product, consciously out of scope.

## Open Questions

> Running block - `/10x-prd` will move these items verbatim into the PRD's `## Open Questions` section.

1. **Management of the key encrypting SSH credentials** - where does the key live relative to the data and against what threat exactly does encryption at-rest protect? It was assumed that it protects against a leak of a backup / DB file, not against takeover of a running host. Owner: user. To be resolved during stack selection / implementation planning.

## Quality cross-check

Status: **accepted** (2026-05-25). All elements of the greenfield gate present, no gaps:

- Access Control - present
- Business Logic (one sentence) - present
- Project artifacts - present
- Timeline-cost acknowledged - present (8 weeks, cost accepted)
- Non-Goals - present (13 items)

The Secondary criteria confirmed by the user during the cross-check.

---

> The blocks below are NOT part of the PRD schema. `/10x-prd` skips them in the PRD and only summarizes them in the hand-off message. The next link in the chain (`10x-tech-stack-selector`, implementation planning) picks them up.

## Forward: tech-stack

Stack and deployment preferences from the notes (for evaluation by the stack selector - NOT binding as a PRD):

- **Frontend:** Angular 21 + spartan/ng (a shadcn port) + Tailwind CSS v4
- **Backend:** NestJS + TypeScript; REST (CRUD) + SSE (agent narration) - without AG-UI in the MVP (a post-MVP candidate, once chat is added)
- **ORM / DB:** Drizzle ORM + SQLite (WAL); one file = one backup
- **Auth:** Better Auth (an in-app library, Drizzle adapter); Cloudflare Access as a transparent edge layer in the deployment - without JWT integration in the application code
- **AI:** Vercel AI SDK (`generateText` + tool calling with enforced `toolChoice` for deterministic skills, `auto` when an LLM is needed; `generateObject` + Zod for the synthesis)
- **SSH:** node-ssh behind an `IExecutor` abstraction (mockable in tests)
- **Network scan:** nmap / arp-scan in a container (`network_mode: host` + the `NET_ADMIN` capability)
- **Validation:** Zod (schemas shared FE↔BE)
- **Concurrency:** async-mutex (in-memory, per `deviceId+serviceId`)
- **Tests:** Vitest (unit + integ) + Playwright (1 E2E with an `sshd` container)
- **Build / distribution:** a multi-stage Dockerfile, GitHub Actions → push to GHCR
- **Multi-arch:** amd64 + arm64 (`docker buildx`) - Synology Intel/ARM, Raspberry Pi
- **Deployment:** a single container + Cloudflare Tunnel + CF Access (an edge layer outside the application specification)

Architectural decisions from the notes (conscious priors, to be confirmed during stack selection):

- A single container + SQLite instead of separate web/api/db - a homelab idiom, easy deploy, one backup file.
- Agent-first from day 0 - all skills via tool calling; no refactor when chat is added post-MVP.
- Registry pattern for the LLM output - a map `stringId → Zod schema`, MVP with a single entry (`logs-diagnosis`), extensible by `+1` entry.
- Skill scope via the `deviceId` field (`null` = global, set = per-device); the agent physically does not see tools from other devices (filtering of the tool list).

## Forward: technical-roadmap

- **Audit log structure** (one vs two tables) - deferred after the Socratic resolution of FR-011; an implementation decision. The notes proposed a split into `audit_log_user` / `audit_log_agent` (with a `transcript` JSON) linked via `triggeredByUserActionId` / `triggeredByAgentRunId`.
- **Risk: hanging node-ssh connections** - mitigation from the notes: a per-command timeout (default 30 s, override via `skill.expectedRuntimeSeconds`), `finally { ssh.dispose() }`, a connection health check before the next `exec`.
- **Risk: Synology DSM compatibility** - requires early validation of `network_mode: host` + `NET_ADMIN` in DSM 7.2+ Container Manager; fallback: bridge network without the LAN scan (manual addition only) - consistent with the demotion of FR-003 to nice-to-have.
- **Post-MVP candidates:** chat / free-form (return of AG-UI), container updates with rollback, skill scheduling, notifications, bulk operations, backup/restore, i18n, dark mode.
