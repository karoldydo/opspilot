---
project: opspilot
version: 1
status: draft
created: 2026-05-30
updated: 2026-06-10
prd_version: 1
main_goal: market-feedback
top_blocker: capacity
---

# Roadmap: opspilot

> Derived from `context/foundation/prd.md` (v1) + `tech-stack.md` + `infrastructure.md` + an auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

opspilot adds an agentic AI layer on top of basic homelab container operations: one-click
diagnostics from the browser, without opening an SSH session per host. The core product
hypothesis - the single belief that, if wrong, sinks the product - is that an AI agent can
turn a service's raw logs into a useful, structured assessment (status, problems, suggestions,
summary) that a homelabber can act on. Existing tools (Portainer, Dockge, Komodo) deliberately
stay CRUD-only; the gap opspilot fills is that diagnostic layer, plus the workflow friction of
SSH-per-host. The agent runs **only predefined skills** - no free-form chat - which is a
load-bearing guardrail that shapes the entire agent layer.

## North star

**S-04: a user runs `diagnoseLogs` on a managed service and receives a structured 4-field
synthesis (status, problems, suggestions, summary).** This is the validation milestone because
it exercises the riskiest assumption - that AI-from-logs synthesis is actually useful - end to
end, and the sequencing goal (`market-feedback`) says prove that before anything else.

> "North star" here means the smallest end-to-end slice whose successful delivery would prove
> the core product hypothesis - placed as early as its Prerequisites allow, because everything
> else only matters if this works. Live narration and transcript replay (the rest of US-01) are
> split into S-05 so the north star stays the minimal AI-value proof: a normal request/response
> synthesis, no streaming UX yet.

## At a glance

| ID   | Change ID                        | Outcome (user can …)                                          | Prerequisites | PRD refs                          | Status   |
|------|----------------------------------|---------------------------------------------------------------|---------------|-----------------------------------|----------|
| F-01 | data-persistence-scaffold        | (foundation) DB + shared validation contract is wired         | -             | NFR: SSH not plaintext (supports) | done     |
| F-02 | account-auth-foundation          | (foundation) accounts/login/session + unauth is locked out    | F-01          | FR-001, Access Control            | done     |
| F-03 | encrypted-credential-store       | (foundation) SSH credentials are encrypted at-rest            | F-01          | FR-013, NFR: no plaintext         | done     |
| S-01 | manage-devices                   | add (address + SSH creds), edit, delete a device              | F-02, F-03    | FR-002                            | done     |
| S-02 | scan-and-add-services            | scan a device's containers and curate managed services        | S-01          | FR-004, FR-007                    | done     |
| S-03 | configure-llm-provider           | configure their own LLM provider (endpoint + credentials)     | F-02          | FR-012                            | proposed |
| S-04 | diagnose-service-synthesis       | diagnose a service and get a structured 4-field synthesis     | S-02, S-03    | US-01, FR-008, FR-009, FR-007     | proposed |
| S-05 | live-narration-and-replay        | watch an agent run live and replay a saved transcript         | S-04          | US-01, FR-010                     | proposed |
| S-06 | deterministic-service-operations | run start/stop/restart/up/down on a service with confirmation | S-02, S-04    | FR-007, FR-008, NFR: op <10s      | proposed |
| S-07 | per-device-agent-context         | define a per-device system prompt that shapes the agent       | S-01, S-04    | FR-005                            | proposed |
| S-08 | custom-skill-crud                | define, edit, delete custom skills (global or per-device)     | S-06          | FR-006, FR-008                    | proposed |
| S-09 | audit-log-and-history            | see an audit trail of user actions and agent runs, linked     | F-02, S-04    | FR-011, Access Control            | proposed |

## Streams

Navigation aid - groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks. With `capacity` as the top blocker, the parallel tracks (B/C/D/E after their heads land) are the main lever for throughput.

| Stream | Theme                           | Chain                               | Note                                                                                    |
|--------|---------------------------------|-------------------------------------|-----------------------------------------------------------------------------------------|
| A      | Foundation (persist + identity) | `F-01` → `F-02` / `F-03` (parallel) | Unlocks everything; `F-02` and `F-03` run in parallel once `F-01` lands.                |
| B      | Device & service onboarding     | `S-01` → `S-02`                     | Joins Stream A at `F-02`/`F-03`; `S-02` builds the SSH executor every later run reuses. |
| C      | Diagnosis loop (core)           | `S-03` → `S-04` → `S-05`            | The north-star chain; `S-04` also joins Stream B at `S-02`. `S-03` runs parallel to B.  |
| D      | Operations & programmability    | `S-06` → `S-08`, plus `S-07`        | All post-`S-04`, reusing its execution engine; `S-07` runs parallel with `S-06`.        |
| E      | Accountability                  | `S-09`                              | Standalone; joins the graph at `S-04` (needs run records) and `F-02` (identity).        |

## Baseline

What's already in place in the codebase as of `2026-05-30` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** partial - Angular 21 wired in `apps/web`, but routes are empty (`app.routes.ts:3`), no Tailwind/spartan installed, only the generated NxWelcome shell. No feature components yet.
- **Backend / API:** partial - NestJS 11 wired (`apps/api/src/main.ts`, global prefix `/api`, port 3000), but only the scaffold `AppController` hello-world. No SSH/agent/SSE/domain code.
- **Data:** absent - `drizzle-orm`, `better-sqlite3`, `zod` are in `package.json` but unwired: no schema, no migrations, no connection; `libs/shared/src/lib/shared.ts` is empty.
- **Auth:** absent - no Better Auth, no guards, no session/token paths, no encryption-at-rest code.
- **Deploy / infra:** present - `Dockerfile` (multi-arch), `.github/workflows/pipeline.yml` → GHCR, `context/deployment/compose.yaml`; **live** at `opspilot.example.com` behind Cloudflare Access (deploy-plan Phase 0–5 green, 2026-05-30).
- **Observability:** absent - only the built-in NestJS `Logger` / `console`; no sentry/otel/metrics/pino. (PRD Non-Goal: no metrics monitoring - not a foundation.)

## Foundations

### F-01: Data persistence + shared validation scaffold

- **Outcome:** (foundation) a working DB connection with migration tooling is wired, and the shared validation library is ready to carry FE↔BE contracts - no domain tables defined yet.
- **Change ID:** data-persistence-scaffold
- **PRD refs:** supports FR-011 (audit), FR-013 (encrypted store); NFR: SSH-not-plaintext store needs a DB to encrypt into.
- **Unlocks:** F-02 (auth needs a DB adapter), F-03 (cred store needs persistence), and every S-NN that reads/writes state.
- **Prerequisites:** -
- **Parallel with:** -
- **Blockers:** -
- **Unknowns:** -
- **Risk:** everything persists here; per `infrastructure.md` the SQLite volume must sit on a **local** disk (WAL needs same-kernel file locking) - getting that right now avoids "database is locked" corruption later. Kept minimal (connection + migration runner + shared schema setup), so each slice still adds its own tables.
- **Status:** done

### F-02: Account auth + route guard

- **Outcome:** (foundation) a user can register, log in, and hold a session; unauthenticated requests reach no operational function. Flat model - no roles.
- **Change ID:** account-auth-foundation
- **PRD refs:** FR-001, Access Control section.
- **Unlocks:** every operational slice (S-01…S-09) that requires a logged-in user, and the audit identity S-09 links actions to.
- **Prerequisites:** F-01
- **Parallel with:** F-03
- **Blockers:** -
- **Unknowns:** -
- **Risk:** "unauth has no access" is the whole access-control posture; building the guard before any operational slice avoids retrofitting auth across every endpoint later. Minimal scope - registration/login/session/guard only, no roles or recovery flows.
- **Status:** done

### F-03: Encrypted credential store

- **Outcome:** (foundation) a credential-encryption contract is in place so SSH credentials are never written in plaintext at rest.
- **Change ID:** encrypted-credential-store
- **PRD refs:** FR-013, NFR: SSH credentials not in plaintext at rest, Success Criteria guardrail.
- **Unlocks:** S-01 (the first slice that stores SSH credentials cannot ship safely without this).
- **Prerequisites:** F-01
- **Parallel with:** F-02
- **Blockers:** -
- **Unknowns:**
  - Where does the encryption key live relative to the data, and against what threat does at-rest encryption protect? - Owner: user. Block: no (`infrastructure.md` already proposes a default: the key in env vars / Docker secrets on the host; protects a leaked backup/DB file, not host takeover). See Open Roadmap Question 1.
- **Risk:** SSH creds in plaintext is a critical regression (guardrail), so the crypto contract must exist before S-01 ever writes a credential. Kept to a small crypto helper + key sourcing, not a key-management product.
- **Status:** done

## Slices

### S-01: Manage devices

- **Outcome:** a user can add a device manually (address + SSH credentials), edit it, and delete it.
- **Change ID:** manage-devices
- **PRD refs:** FR-002
- **Prerequisites:** F-02, F-03
- **Parallel with:** S-03
- **Blockers:** -
- **Unknowns:** -
- **Risk:** the first stored secret; depends on F-03 being a real contract, not a TODO - if F-03 slips, this slice must not ship a plaintext fallback. Connection-verification on add gives early signal that credentials work before any skill runs.
- **Status:** done

### S-02: Scan and add services

- **Outcome:** a user can scan the containers on a device and curate the managed set (add selected, edit, delete).
- **Change ID:** scan-and-add-services
- **PRD refs:** FR-004, FR-007 (the hidden built-in `scanServices` skill)
- **Prerequisites:** S-01
- **Parallel with:** S-03
- **Blockers:** -
- **Unknowns:** -
- **Risk:** the first SSH-out operation; the per-command timeout + connection disposal born here is what satisfies the "no skill run hangs indefinitely" NFR and protects every later skill. Curating a managed subset (not showing all containers) is a deliberate choice to limit the agent's reach.
- **Status:** done

### S-03: Configure LLM provider

- **Outcome:** a user can configure their own LLM provider (custom endpoint + credentials) without a redeploy.
- **Change ID:** configure-llm-provider
- **PRD refs:** FR-012
- **Prerequisites:** F-02
- **Parallel with:** S-01, S-02
- **Blockers:** -
- **Unknowns:** -
- **Risk:** small and independent; isolating provider config early lets the north star (S-04) consume a configured provider cleanly, and lets a homelabber swap to a local/cheaper model to control cost. Provider credentials are a secret - store them via the F-03 contract.
- **Status:** proposed

### S-04: Diagnose a service → structured synthesis  *(north star)*

- **Outcome:** a user runs `diagnoseLogs` on a managed service and the agent returns a structured 4-field synthesis (status, problems, suggestions, summary).
- **Change ID:** diagnose-service-synthesis
- **PRD refs:** US-01 (advances), FR-008 (run a skill, agent deterministic, per-device filtering), FR-009 (structured synthesis), FR-007 (`diagnoseLogs`); NFR: diagnosis of ~200 log lines returns in < 15 s.
- **Prerequisites:** S-02, S-03
- **Parallel with:** -
- **Blockers:** -
- **Unknowns:** -
- **Risk:** the north star and the riskiest assumption - kept to synthesis-only (a normal request/response; live narration split to S-05) so the AI-value proof ships before any streaming UX. The fixed 4-field schema (no user-defined output schemas - load-bearing Non-Goal) is what makes the result actionable. The < 15 s NFR lives here.
- **Status:** proposed

### S-05: Live narration + transcript replay

- **Outcome:** a user watches an agent run narrated live and can replay the full saved transcript of an earlier run.
- **Change ID:** live-narration-and-replay
- **PRD refs:** US-01 (completes), FR-010
- **Prerequisites:** S-04
- **Parallel with:** S-06, S-07, S-08, S-09
- **Blockers:** -
- **Unknowns:** -
- **Risk:** live narration is the headline UX **and** the known deploy trap - SSE through the Cloudflare edge needs heartbeats (`: ping`) + `X-Accel-Buffering: no` / `Cache-Control: no-cache` from day one, or runs > ~100 s silently cut (`infrastructure.md` risk register, H/H). Isolated here so the streaming risk is contained, not spread across the execution engine; WebSocket is the documented fallback.
- **Status:** proposed

### S-06: Deterministic service operations

- **Outcome:** a user runs a deterministic operation (start, stop, restart, up, down) on a service and sees confirmation in the UI.
- **Change ID:** deterministic-service-operations
- **PRD refs:** FR-007 (the 5 deterministic default skills), FR-008; NFR: an operation is confirmed in the UI in < 10 s.
- **Prerequisites:** S-02, S-04
- **Parallel with:** S-05, S-07, S-09
- **Blockers:** -
- **Unknowns:** -
- **Risk:** reuses the agent-execution engine born in S-04, so this is lighter than it looks. Sequenced after the north star because `market-feedback` biases proving AI value before rounding out the deterministic skill set - invert this only if you later decide to de-risk the SSH/execution plumbing ahead of the LLM synthesis.
- **Status:** proposed

### S-07: Per-device agent context

- **Outcome:** a user can define a per-device system prompt (path conventions, privileged-access requirements, availability hours) that shapes the agent's behaviour on that host.
- **Change ID:** per-device-agent-context
- **PRD refs:** FR-005
- **Prerequisites:** S-01, S-04
- **Parallel with:** S-05, S-06, S-08, S-09
- **Blockers:** -
- **Unknowns:** -
- **Risk:** safe to sequence after the engine exists because S-04 can run with empty context; this slice improves accuracy per host rather than enabling the flow. Different hosts having different conventions is exactly why a global prompt was rejected.
- **Status:** proposed

### S-08: Custom skill CRUD

- **Outcome:** a user can define, edit, and delete custom skills (parameterized commands) with a global scope or assigned to a specific device.
- **Change ID:** custom-skill-crud
- **PRD refs:** FR-006, FR-008 (the agent sees only the skills proper to a given device)
- **Prerequisites:** S-06
- **Parallel with:** S-05, S-07, S-09
- **Blockers:** -
- **Unknowns:** -
- **Risk:** the programmable-operations heart of the product; it generalizes S-06's "run a defined skill on a service" path to user-defined skills. Per-device skill filtering (FR-008) is the guard against running the wrong command on the wrong host - verify it holds for custom skills, not just the defaults.
- **Status:** proposed

### S-09: Audit log + history view

- **Outcome:** a user can see an audit trail of user actions and agent runs (with the run transcript), linked to each other.
- **Change ID:** audit-log-and-history
- **PRD refs:** FR-011, Access Control section.
- **Prerequisites:** F-02, S-04
- **Parallel with:** S-05, S-06, S-07, S-08
- **Blockers:** -
- **Unknowns:**
  - Which identity is the source of truth for the audit trail - the in-app Better Auth session or the Cloudflare Access identity? - Owner: user. Block: no (`infrastructure.md` recommends treating Access as a network gate and the app session as the audit identity). See Open Roadmap Question 2.
- **Risk:** accountability is the entire access-control model (flat, no roles), so the audit trail must reliably link "who did what" to the agent runs it triggered. Run records originate in S-04; this slice adds the user-action side, the linkage, and the view. Decide the identity source before linking, or the trail mismatches who actually got in.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID                        | Suggested issue title                             | Ready for `/10x-plan` | Notes                                                   |
|------------|----------------------------------|---------------------------------------------------|-----------------------|---------------------------------------------------------|
| F-01       | data-persistence-scaffold        | Wire DB persistence + shared validation scaffold  | yes                   | The single ready item; root of every chain              |
| F-02       | account-auth-foundation          | Account auth + route guard (flat, no roles)       | no                    | After F-01                                              |
| F-03       | encrypted-credential-store       | Encrypted-at-rest store for SSH credentials       | no                    | After F-01; resolve Open Q 1 (or accept default)        |
| S-01       | manage-devices                   | Manage devices (add/edit/delete, SSH creds)       | no                    | After F-02 + F-03                                       |
| S-02       | scan-and-add-services            | Scan containers and curate managed services       | no                    | After S-01; builds the SSH executor                     |
| S-03       | configure-llm-provider           | Configure custom LLM provider                     | no                    | After F-02; parallel with S-01/S-02                     |
| S-04       | diagnose-service-synthesis       | Diagnose a service → structured 4-field synthesis | no                    | After S-02 + S-03; the north star                       |
| S-05       | live-narration-and-replay        | Live agent narration + transcript replay (SSE)    | no                    | After S-04; carries the Cloudflare-SSE risk             |
| S-06       | deterministic-service-operations | Deterministic ops: start/stop/restart/up/down     | no                    | After S-02 + S-04                                       |
| S-07       | per-device-agent-context         | Per-device agent system prompt                    | no                    | After S-01 + S-04                                       |
| S-08       | custom-skill-crud                | Custom skill CRUD (global / per-device)           | no                    | After S-06                                              |
| S-09       | audit-log-and-history            | Audit log + linked history view                   | no                    | After F-02 + S-04; resolve Open Q 2 (or accept default) |

This table is the clean handoff to Jira/Linear or any MCP-backed backlog. One row per `F-NN` / `S-NN`.

## Open Roadmap Questions

1. **Management of the key encrypting SSH credentials** - where does the key live relative to the data, and against what threat exactly does encryption at-rest protect? The working assumption: it protects against a leak of a backup / DB file, not against takeover of a running host. Owner: user. Block: `F-03` (soft - `infrastructure.md` proposes a defensible default: key in env vars / Docker secrets; planning can proceed on that default).
2. **Source of truth for audit identity** - should FR-011's audit trail key off the in-app Better Auth session or the Cloudflare Access identity? Two auth layers sit in front of the app and "who got in" can mismatch "whose app session it is". Owner: user. Block: `S-09` (soft - `infrastructure.md` recommends Access-as-network-gate, app-session-as-audit-identity).

(Per-slice unknowns stay in their slice; these are cross-cutting.)

## Parked

- **LAN device auto-discovery (FR-003, nice-to-have)** - Why parked: deliberately demoted in the PRD to remove the top risk (host-network/`NET_RAW` privileges, NAS-platform validation) from the critical MVP path; manual add (S-01) is the fallback. Promote post-MVP after validating `network_mode: host` + `NET_ADMIN` on the target host.
- **Chat / free-form prompts to the agent** - Why parked: PRD Non-Goal **[load-bearing]**; predefined skills only is the guardrail that shapes the whole agent layer.
- **Metrics monitoring (CPU/RAM/disk)** - Why parked: PRD Non-Goal **[load-bearing]**; that is dedicated observability tooling's job, opspilot does not compete with it.
- **User-defined LLM output schemas via the UI** - Why parked: PRD Non-Goal **[load-bearing]**; the diagnosis output format is a single fixed schema.
- **Roles / RBAC** - Why parked: PRD Non-Goal; flat multi-user, accountability via the audit log (S-09).
- **Container updates with rollback, skill scheduling, failure notifications, bulk operations, backup/restore** - Why parked: PRD Non-Goals, all v2 candidates.
- **Mobile/desktop app, i18n (PL/EN), dark mode/theming, scaling beyond the homelab** - Why parked: PRD Non-Goals; web-only, single-language, single-theme, homelab-scale by design.

## Done

(Empty on first generation. `/10x-archive` appends an entry here - and flips that item's `Status` to `done` - when a change whose `Change ID` matches the item is archived. Do NOT pre-populate.)

- **F-01: (foundation) a working DB connection with migration tooling is wired, and the shared validation library is ready to carry FE↔BE contracts - no domain tables defined yet.** — Archived 2026-06-09 → `context/archive/2026-05-31-data-persistence-scaffold/`. Lesson: —.
- **F-02: (foundation) a user can register, log in, and hold a session; unauthenticated requests reach no operational function. Flat model - no roles.** — Archived 2026-06-09 → `context/archive/2026-06-07-account-auth-foundation/`. Lesson: —.
- **F-03: (foundation) a credential-encryption contract is in place so SSH credentials are never written in plaintext at rest.** — Archived 2026-06-09 → `context/archive/2026-06-09-encrypted-credential-store/`. Lesson: —.
- **S-01: a user can add a device manually (address + SSH credentials), edit it, and delete it.** — Archived 2026-06-10 → `context/archive/2026-06-09-manage-devices/`. Lesson: —.
- **S-02: a user can scan the containers on a device and curate the managed set (add selected, edit, delete).** — Archived 2026-06-10 → `context/archive/2026-06-10-scan-and-add-services/`. Lesson: —.
