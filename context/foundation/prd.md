---
project: "opspilot"
version: 1
status: draft
created: 2026-05-25
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 8
  hard_deadline: null
  after_hours_only: true
---

# opspilot - Product Requirements Document

## Vision & Problem Statement

Homelabbers running several devices (Synology NAS, Raspberry Pi, mini-PC) with Docker containers in `docker-compose` stacks diagnose and operate their services manually: they SSH into each host separately and grep through logs by hand. When a service breaks down, the cost is jumping between terminals and reading logs line by line. Existing tools (Portainer, Dockge, Komodo) do container CRUD well, but lack a layer that summarizes a service's state from its logs and proposes concrete actions.

The insight: homelab diagnostics is in practice a repeatable loop - see logs → interpret → restart - ideal to hand off to an AI agent. Existing tools deliberately stay "dumb" (CRUD-only), so the gap is a missing capability (a diagnostic layer), compounded by workflow friction (SSH-per-host) and data trapped in logs scattered across devices. opspilot adds an agentic AI layer on top of basic operations: one-click diagnostics from the browser, without opening SSH.

## User & Persona

Homelabber - a person running several home devices (Synology NAS, Raspberry Pi, mini-PC) with Docker services in `docker-compose` stacks. They want to manage them from one place and have an AI agent supporting diagnostics. They reach for opspilot the moment one of the services misbehaves and would otherwise have to open a terminal and SSH into each host one by one. Deployment is self-hosted for a small group of trusted users (family / housemates); the model is multi-user without roles, with accountability provided through the audit log.

## Success Criteria

### Primary
- A user diagnoses a Docker service from the browser, without SSH, and receives a structured synthesis (status, problems, suggestions, summary) for ~200 log lines in < 15 s.
- A user performs an operation on a service (e.g. restart) from the browser, with confirmation in the UI in < 10 s.
- At least 95% of skill runs complete successfully.

### Secondary
- Setup without manually entering IP addresses, thanks to device auto-discovery (LAN scan) - reduces configuration friction, but the core works without it (consistent with FR-003 being nice-to-have).
- Cost of a single diagnosis < $0.01 (achievable with an economical cloud model class) - a welcome cost target, not a success condition (consciously not an NFR).

### Guardrails
- SSH credentials are never stored in plaintext - encryption at-rest; a leak is a critical regression even if everything else works.
- The agent executes exclusively predefined skills - no free-form prompts or destructive actions outside the defined set.

## User Stories

### US-01: Diagnose a service from the browser, without SSH

- **Given** a logged-in user with at least one managed service on an added device
- **When** they click "diagnoseLogs" on that service
- **Then** the agent connects to the device, fetches the logs, and the user sees a structured synthesis (status, problems, suggestions, summary) in < 15 s

#### Acceptance Criteria
- The synthesis contains all four fields: status, problems, suggestions, summary
- The run narration is visible live during execution
- The full transcript is saved and can be replayed
- The user does not manually open any SSH session

## Functional Requirements

### Accounts and access
- FR-001: A user can create an account and log in (registration, login, session). Priority: must-have
  > Socratic: Considered counterargument: "the instance sits behind a network-level access layer, so in-app login is redundant". Resolution: stays - the audit log requires an identity independent of the deployment layer, and any external access layer is an optional edge in front of the application.
- FR-013: The system stores SSH credentials in encrypted form at-rest. Priority: must-have
  > Socratic: Considered counterargument: "encryption at-rest is apparent security - the key lives on the same host as the data". Resolution: stays as a guardrail, but with an explicitly accepted limitation - it protects against a leak of a backup / database file, NOT against takeover of a running host. The question of key management moved to ## Open Questions.

### Devices
- FR-002: A user can manage devices - add manually (address + SSH credentials), edit, delete. Priority: must-have
  > Socratic: Considered counterargument: "central storage of SSH credentials is the main risk surface / the device abstraction is unnecessary". Resolution: stays - multiple physical hosts are the core of the problem, so the "device" entity is necessary.
- FR-003: A user can discover devices on the local network via a scan and add selected ones. Priority: nice-to-have
  > Socratic: Considered counterargument: "the LAN scan is the top risk (it needs elevated host-network privileges and must be validated against the NAS platform); manual addition already covers the need". Resolution: DEMOTED to nice-to-have. Fallback = manual addition (FR-002); full auto-discovery returns after validation on the NAS platform. Effect: removes the main risk from the critical MVP path.

### Services
- FR-004: A user can scan containers on a device and add selected services to the managed set (and edit/delete them). Priority: must-have
  > Socratic: Considered counterargument: "show all detected containers instead of curating a subset of managed ones". Resolution: stays - the explicit choice of managed services limits the agent's reach and the noise; this is deliberate.

### Agent context
- FR-005: A user can define a per-device system prompt as context for the agent (e.g. path conventions, privileged-access requirements, availability hours). Priority: must-have
  > Socratic: Considered counterargument: "a global prompt would be enough in the MVP". Resolution: stays - different hosts have different conventions (privileged access, paths), and per-device context affects the agent's accuracy.

### Skills
- FR-006: A user can define, edit and delete skills (parameterized commands) with a global scope or assigned to a device. Priority: must-have
  > Socratic: Considered counterargument: "a read-only set of skills in the MVP; CRUD of own skills for v2". Resolution: stays - parameterized per-device skills are the heart of the programmable operations layer, a foundation and not an add-on.
- FR-007: The application provides 6 default skills (start, stop, restart, up, down, diagnoseLogs) and a hidden built-in skill scanServices. Priority: must-have
  > Socratic: Considered counterargument: "diagnoseLogs + restart are enough to prove the value". Resolution: stays - 6 skills is a small deterministic set, all cheap to add, and together they show the full service lifecycle.

### Agent execution
- FR-008: A user can run a skill on a selected service; the agent executes it deterministically and sees only the skills proper to the given device. Priority: must-have
  > Socratic: Considered counterargument: "for deterministic commands, direct execution is simpler than an agent layer". Resolution: stays - agent-first from day 0 is a conscious decision (no refactor when chat is added), and per-device filtering protects against acting on the wrong host.
- FR-009: For diagnoseLogs the agent returns a structured synthesis: status, problems, suggestions, summary. Priority: must-have
  > Socratic: Considered counterargument: "plain text instead of an enforced 4-field schema". Resolution: stays - structured output gives a consistent UI and the ability to act on suggestions; this is the essence of the diagnostic layer.

### Narration and transcript
- FR-010: A user sees live narration of the agent's run and can replay a saved full transcript of an earlier run. Priority: must-have
  > Socratic: Considered counterargument: "replay is deferrable - live narration alone is enough in the MVP". Resolution: stays - the transcript is saved in the agent run log anyway, so replay is a small add-on over existing data.

### Audit
- FR-011: The system maintains an audit log covering user actions and agent runs (along with the run transcript), linked to each other. Priority: must-have
  > Socratic: Considered counterargument: "a single record structure is enough vs splitting into two linked ones". Resolution: COUNTERARGUMENT ACCEPTED - the FR was reworded to be neutral toward implementation (audit of actions + runs). Whether the audit is stored as one structure or two linked ones is an implementation decision pushed down the chain.

### Settings
- FR-012: A user can configure their own LLM provider (custom endpoint + credentials). Priority: must-have
  > Socratic: Considered counterargument: "configuration via environment variables / a single hardcoded provider in the MVP". Resolution: stays - swapping the provider (including a local one) without a redeploy matters to a homelabber controlling cost.

## Non-Functional Requirements

- Diagnosis of a service's logs (~200 lines) returns a result to the user in < 15 s.
- An operation on a service (e.g. restart) is confirmed in the UI in < 10 s.
- At least 95% of skill runs complete successfully.
- Every skill run ends with a result or an unambiguous error within a finite time - none stays hanging indefinitely.
- SSH credentials do not appear in plaintext in data at rest.

## Business Logic

opspilot transforms a service's raw logs into a structured state assessment (status, problems, suggestions, summary), on the basis of which it suggests concrete operational actions.

The rule's input is the logs of the selected service on the given device and the per-device context provided by the user (path conventions, privileged-access requirements, availability hours). The output is a structured assessment with four fields: status (the service's overall health), problems (what is wrong), suggestions (what to do), summary (a concise description of the situation). The user encounters the rule by running a diagnosis on a specific service: they see the run narration live, and at the end the assessment, from which they can trigger a concrete remedial action (e.g. restart) - without leaving the browser.

## Access Control

Multi-user with accounts: each user creates an account (registration), logs in, and has a session in the application. The model is flat - no roles and no RBAC; all logged-in users have the same permissions. Accountability ("who did what") is provided solely by the audit log, not by separation of permissions. An unauthenticated user has no access to any operational function. This is the smallest useful model for self-hosting a small trusted group: user identification for auditing, without the cost of managing roles.

## Non-Goals

Items marked **[load-bearing]** hard-shape the product; the rest are softer "not for now" (candidates for v2).

- **[load-bearing]** No chat / free-form prompts to the agent - exclusively predefined skills as guardrails; this shapes the entire agent layer.
- **[load-bearing]** No metrics monitoring (CPU/RAM/disk) - that is the role of dedicated observability tooling; opspilot does not compete with it.
- **[load-bearing]** No defining custom LLM output schemas via the UI - the diagnosis output format is fixed (a single built-in schema), not user-configurable.
- No roles / RBAC (admin/user/viewer) - flat multi-user, accountability through the audit log.
- No container updates with rollback (compose pull + healthcheck + auto-rollback) - v2.
- No skill scheduling (cron-like) - v2.
- No notifications (webhook / e-mail) about failures - v2.
- No bulk operations (restarting multiple services at once) - v2.
- No application backup / restore - v2.
- No mobile / desktop application - web only.
- No internationalization (PL/EN) - single-language UI.
- No dark mode / theming.
- No scaling beyond the homelab (hundreds of services, multi-tenant) - at 100x the rule would require prioritization/aggregation; that is a different product, consciously out of scope.

## Open Questions

1. **Management of the key encrypting SSH credentials** - where does the key live relative to the data, and against what threat exactly does encryption at-rest protect? It was assumed that it protects against a leak of a backup / database file, not against takeover of a running host. Owner: user. To be resolved during stack selection / implementation planning.
