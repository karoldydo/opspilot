## opspilot - MVP

### Core problem

Diagnosing and performing basic operations on Docker services distributed across multiple devices in a home network (
NAS, Raspberry Pi, mini-PC) requires manual SSH into each one and grepping through logs. Existing tools (Portainer,
Dockge, Komodo) handle container CRUD well but lack a diagnostic layer that summarizes service state from logs and
suggests concrete actions. opspilot adds an agentic AI layer over basic operations, so the user runs diagnostics with a
click from the browser, without opening SSH.

### Target user

A homelabber running several devices (Synology NAS, Raspberry Pi, mini-PC) with Docker containers in `docker-compose`
stacks, who wants to manage them from one place and have an AI agent assist with diagnostics. Self-hosted, for a small
group of trusted users (e.g. family, roommates).

### Minimum feature set

- Registration and login (Better Auth), multi-user without roles, accountability via audit log
- Devices CRUD: manual add by IP or via LAN network scan (`nmap`/`arp-scan` with "this host" detection)
- Services CRUD: container scanning on a device (`docker ps`, `docker compose ls`), adding selected ones to managed
- Per-device system prompt as context for the agent (e.g. path conventions, sudo requirements, availability hours)
- Skills CRUD (parameterized commands) with scope option: global or device-specific
- 6 default user-visible skills: `start`, `stop`, `restart`, `up`, `down`, `diagnoseLogs` (+ 1 hidden builtin:
  `scanServices`)
- Agent execution via Vercel AI SDK with forced `toolChoice` for deterministic skills
- LLM synthesis for `diagnoseLogs` with structured output (status, issues, suggestions, summary) via `generateObject` +
  Zod
- Live agent narration over SSE with full transcript persisted to DB (for replay)
- Audit log in two tables: `audit_log_user` (CRUD, triggers) and `audit_log_agent` (executions with transcript)
- Settings: LLM provider configuration (OpenAI-compatible: OpenAI / OpenRouter / LiteLLM / local LMStudio)
- Encryption-at-rest for SSH credentials (AES-256-GCM)
- Single container deployment, multi-arch image (amd64 + arm64)

### Out of scope for MVP

- Chat / free-form prompts to the agent - only predefined skills as guardrails
- Custom output schemas for LLM synthesis through UI - registry pattern with one hardcoded schema
- Roles / RBAC (admin/user/viewer)
- Real-time monitoring (CPU/RAM/disk metrics) - that's what Grafana is for
- Container updates with rollback (compose pull + healthcheck + auto-rollback)
- Skill scheduling (cron-like)
- Notifications (webhook / email) on failures
- Bulk operations (restart multiple services at once)
- Application backup / restore
- Mobile or desktop app (web only)
- i18n (PL / EN) - single-language UI
- Dark mode + theming

### Tech stack

- **Frontend:** Angular 21 + spartan/ng (shadcn port for Angular) + Tailwind CSS v4
- **Backend:** NestJS + TypeScript, REST + SSE
- **ORM / DB:** Drizzle ORM + SQLite (WAL mode)
- **Auth:** Better Auth (library, in-app users, Drizzle adapter)
- **AI:** Vercel AI SDK (`generateText` with tool calling + forced `toolChoice`, `generateObject` with Zod schemas)
- **SSH:** node-ssh with `IExecutor` abstraction (mockable in tests)
- **Network scan:** nmap / arp-scan in container (`network_mode: host` + `NET_ADMIN` capability)
- **Validation:** Zod (shared FE↔BE schemas)
- **Concurrency:** async-mutex (in-memory, per `deviceId+serviceId`)
- **Tests:** Vitest (unit + integration) + Playwright (1 E2E with `sshd` container)
- **Build:** Multi-stage Dockerfile, GitHub Actions, push to GHCR
- **Multi-arch:** amd64 + arm64 (`docker buildx`) - Synology Intel/ARM, Raspberry Pi
- **Deployment:** Single container + Cloudflare Tunnel + CF Access (edge layer outside the app spec)

### Key technical decisions

- **Single container + SQLite** instead of separate web/api/db - homelab idiom, easy deploy (`docker run`), single
  backup file
- **Agent-first from day 0** - all skills go through tool calling, `toolChoice` forced for deterministic skills, `auto`
  when LLM is needed. No refactor required when chat lands in post-MVP
- **LLM synthesis output**: registry pattern (map `stringId` → Zod schema) defined in code, MVP ships with only
  `logs-diagnosis`, extensible by `+1` entry in the object
- **Skill scope**: `deviceId` field on `skills` (`null` = global, `set` = device-specific). The agent physically does
  not see tools from other devices (filtering applied when building the tools list for `generateText`)
- **Audit log split**: two tables instead of one - `audit_log_user` (user actions) and `audit_log_agent` (executions
  with `transcript` JSON), linked via `triggeredByUserActionId` or `triggeredByAgentRunId` (postCheck)
- **FE↔BE communication**: REST for CRUD, SSE for agent narration streaming - sufficient for a unidirectional stream, no
  AG-UI overhead (AG-UI returns as a post-MVP candidate when chat lands)
- **Auth**: Better Auth only inside the app (registration + login + sessions), Cloudflare Access as a transparent edge
  layer in deployment - no JWT integration in app code

### Main risks

- **Synology DSM compatibility** - `network_mode: host` + `NET_ADMIN` should work in DSM 7.2+ Container Manager, but
  requires early validation. Fallback: bridge network without LAN scan (manual add only)
- **node-ssh hanging connections** - per-command timeout (default 30s, override via `skill.expectedRuntimeSeconds`),
  `finally { ssh.dispose() }`, connection health check before next `exec`

### Success criteria

- Time from clicking "restart" to confirmation in UI: **< 10s** (measured from `audit_log_agent.durationMs`)
- Time for full log diagnosis (200 lines) with LLM synthesis: **< 15s**
- % of skills completed successfully: **> 95%** (from `audit_log_agent.status` stats)
- LLM cost per diagnosis: **< $0.01** (GPT-4o-mini) or zero with local LMStudio
