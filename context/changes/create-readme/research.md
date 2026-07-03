---
date: 2026-07-04T00:11:13+02:00
researcher: Karol Dydo
git_commit: 4739ce155224169537830e8e3c4683d14b2f4c90
branch: main
repository: karoldydo/opspilot
topic: "Material for a Best-README-Template-based README (current implemented state)"
tags: [research, codebase, readme, features, tech-stack, deployment, roadmap]
status: complete
last_updated: 2026-07-04
last_updated_by: Karol Dydo
---

# Research: README material for OpsPilot (current implemented state)

**Date**: 2026-07-04T00:11:13+02:00
**Researcher**: Karol Dydo
**Git Commit**: 4739ce155224169537830e8e3c4683d14b2f4c90 (`4739ce1`)
**Branch**: main
**Repository**: karoldydo/opspilot (https://github.com/karoldydo/opspilot)

## Research Question

Gather everything needed to write a README for OpsPilot modeled on the
[Best-README-Template](https://github.com/othneildrew/Best-README-Template) — describing the
**currently implemented, runnable state** (comprehensive depth), not the aspirational vision.

## Summary

**OpsPilot is a fully-built (MVP-complete) self-hosted homelab ops tool**, not the bare Nx
scaffold that `CLAUDE.md` still claims. All 12 planned MVP slices are archived/done. It is a
single-tenant web control panel for a small fleet of remote Linux/NAS devices running Docker:
you register **devices** (host + encrypted SSH credential), **scan** each over SSH to discover
running Docker containers, promote containers into managed **services**, then against a service
you can (1) run an **AI diagnosis** — it SSHes in, pulls recent `docker logs`, and streams a
structured LLM synthesis (`status / problems / suggestions / summary`) back to the browser live
over **SSE** — and (2) run parametrized **skills** (reusable `docker compose`/shell command
templates: start/stop/restart/up/down). Everything is behind **Better Auth** (email+password),
secrets are **AES-256-GCM encrypted at rest**, every mutation is written to an **audit log**, and
an **overview** dashboard aggregates fleet metrics. LLM access is via pluggable
**OpenAI-compatible** providers configured in-app.

The target stack from the foundation docs is **substantially wired**: SSH (node-ssh), Docker
scanning, Better Auth, Drizzle + SQLite (WAL), Vercel AI SDK (`streamObject`), SSE, and Tailwind
v4 + spartan/ng are all real. It ships as **one multi-arch container** (nginx + node + supervisor)
to `ghcr.io/karoldydo/opspilot`, deployed to a Synology NAS behind a Cloudflare Tunnel/Access at
`opspilot.example.com`.

> **Stale-docs warning for the README author:** `CLAUDE.md` says the tree is "just the Nx scaffold
> output plus the shared lib." That is wrong as of this commit — treat the code below (not
> `CLAUDE.md`'s architecture claim) as ground truth. The commands table in `CLAUDE.md` is accurate.

## Detailed Findings

### What OpsPilot is (About-The-Project material)

Self-hosted homelab control panel that adds an **agentic AI diagnostic layer** on top of basic
Docker container operations. Target user: a homelabber running several devices (Synology NAS,
Raspberry Pi, mini-PC) with `docker-compose` stacks who currently SSHes into each host and greps
logs by hand. Core hypothesis: an AI agent can turn a service's raw logs into a useful,
structured 4-field assessment actionable from the browser — no SSH.

Load-bearing guardrails (from `context/foundation/prd.md`):
- The agent runs **only predefined skills** — no free-form chat.
- SSH credentials and LLM API keys are **encrypted at rest**.
- **Flat multi-user model** — no roles/RBAC; accountability via the audit log.
- Default skills: `start`, `stop`, `restart`, `up`, `down`, `diagnoseLogs`, plus a built-in
  `scanServices`.

Explicit non-goals (do **not** advertise these in the README): chat/free-form prompts, metrics
monitoring (CPU/RAM/disk), user-defined LLM output schemas, RBAC, scheduling/notifications/bulk
ops/backup, mobile/desktop apps, i18n, dark mode.

### Implemented features by domain (Usage material)

All paths under `apps/api/src/` unless noted. Every route is under the global `/api` prefix.

- **Auth (Better Auth)** — `core/auth/`. Catch-all `ALL /api/auth/*` → Better Auth node handler
  (`core/auth/auth.controller.ts:13`); configured with the Drizzle SQLite adapter, email+password
  signup (`core/auth/create-auth.ts:17`). Global `AuthAppGuard` protects everything except
  `@Public()` routes (`app.module.ts:32`, `core/auth/auth.guard.ts`).
- **Devices** — `modules/device/`. `POST/GET /api/devices`, `GET/PATCH/DELETE /api/devices/:id`
  (`device.controller.ts:18-45`). A device carries host + name + optional `agentContext` persona
  used as the LLM `system` prompt.
- **Credentials (encrypted SSH secrets)** — `core/credential/` + `modules/device/credential/`.
  `POST/GET /api/devices/:deviceId/credentials`, `DELETE …/:credentialId`
  (`device-credential.controller.ts:33,46,57`). AES-256-GCM encrypt/decrypt; secret stored as
  ciphertext+iv+authTag, never returned in plaintext (`core/crypto/crypto.service.ts:35`,
  `credential.service.ts:24`).
- **Services + Docker scan** — `modules/service/`. `POST /api/devices/:deviceId/scan` runs
  `docker ps --no-trunc --format …` NDJSON over SSH and parses containers incl. compose
  project/path labels (`service.service.ts:29` = SCAN_COMMAND, `service.service.ts:47`).
  `GET/POST …/services`, `GET/PATCH/DELETE …/services/:serviceId`
  (`service.controller.ts:34-74`). Fleet aggregate `GET /api/services` joins each service to its
  latest diagnosis status (`service-aggregate.controller.ts:11`).
- **AI Diagnosis (SSE streaming)** — `modules/diagnose/`. `GET …/diagnose/stream` (`@Sse`) emits
  `step/progress/delta/done/error/ping` frames (`diagnose.controller.ts:40`);
  `GET …/diagnose/runs` paginated replay (cap 100) (`diagnose.controller.ts:22`). Engine: SSH
  `docker logs --tail N` → `streamObject()` with `diagnosisSynthesisSchema`, heartbeats to survive
  Cloudflare's ~100s idle reap, persists a run record, writes a `diagnose.run` audit entry
  (`diagnose.service.ts:98`).
- **Skills (command templates) + runs** — `modules/skill/`. CRUD `POST/GET /api/skills`,
  `GET/PATCH/DELETE /api/skills/:id` (`skill.controller.ts:18-48`). Run:
  `POST /api/devices/:deviceId/services/:serviceId/skills/:skillId/run` (`skill-run.controller.ts:17`).
  Runner renders `{{param}}` placeholders (input- or service-sourced), re-validates each value at
  the shell boundary, executes under a per-skill timeout, classifies exit, audits `skill.run`
  (`skill-run.service.ts:44`). Seeded defaults start/stop/restart/up/down (`skill.seed.ts:17-37`).
- **LLM Providers** — `modules/llm-provider/`. `POST/GET /api/llm-providers`,
  `GET/PATCH/DELETE /:id`, `PATCH /:id/activate` (`llm-provider.controller.ts:18-50`).
  `kind: 'openai-compatible'`, API key stored encrypted (`hasApiKey` flag only in responses).
  Client factory builds an `@ai-sdk/openai-compatible` model with `supportsStructuredOutputs: true`
  (`llm-provider.client-factory.ts:19`).
- **Audit** — `modules/audit/`. `GET /api/audit` paginated timeline (`audit.controller.ts:15`);
  18 `AuditAction` enum values.
- **Overview metrics** — `modules/overview/`. `GET /api/overview/metrics` = avg diagnose duration
  + 24h skill-run count & success rate (`overview.controller.ts:14`, `overview.service.ts:27`).
- **Health** — `core/health/`. `@Public() GET /api/health` pings SQLite `SELECT 1`, returns
  `{status, db, timestamp}` (`health.controller.ts:13`).

**Web app (Angular SPA)** — routes in `apps/web/src/app/app.routes.ts`:
- Public: `/login`, `/register`. Everything else behind `authGuard` inside a persistent sidebar
  `LayoutComponent`.
- Screens (`layout.component.ts:42`): `/` overview dashboard, `/devices` (list + add/edit dialog +
  scan-services dialog), `/devices/:deviceId/services/:serviceId` service detail (the full
  operational surface — live diagnosis via `SynthesisCard`, run-skill & rename dialogs), `/skills`
  (skill CRUD), `/llm-providers` (provider CRUD + activate), `/audit` (audit timeline).
- SSE consumed via native `EventSource` in `features/diagnosis/data/diagnosis.store.ts:41`
  (zoneless signalState). Better Auth browser client at `core/auth/auth.client.ts:6`
  (`createAuthClient({ basePath: '/api/auth' })`).

### Domain model (libs/shared Zod contracts)

38 schema files, all re-exported from `libs/shared/src/index.ts` and consumed by both apps via
`z.infer` (single FE↔BE source of truth per `.claude/rules/contracts.md`). Main entities:

- **Device** `{ id, name, host, agentContext: string|null }` (`device.schema.ts:11`)
- **Credential** `{ id, deviceId, username, authType: 'password'|'key' }` — secret never in the
  contract (`credential.schema.ts:12`)
- **Service** `{ id, deviceId, name, containerName, composePath|null, composeProject|null }`
  (`service.schema.ts:14`); **ServiceWithStatus** adds latest diagnosis status;
  **ScannedContainer / ScanResult** for scan output
- **Skill** `{ id, deviceId: uuid|null (null = global), name, parameters[], timeoutMs|null,
  commandTemplate }`; **SkillParameter** `{ name, required, source: 'input'|'service' }`;
  **SkillRunRequest/Result** (`status: 'succeeded'|'failed'`)
- **LlmProvider** `{ id, kind: 'openai-compatible', baseURL, model, active, hasApiKey }`
- **DiagnosisSynthesis** `{ status: 'healthy'|'degraded'|'down', problems[], suggestions[],
  summary }` — the LLM structured-output schema (`diagnosis-synthesis.schema.ts:11`)
- **RunRecord** `{ id, deviceId, serviceId, userId, synthesis, durationMs?, createdAt }`; plus
  **RunStep / RunNarrationEvent** for SSE frames
- **AuditLog / AuditEvent** (18 actions), **OverviewMetrics**, **AuthUser / AuthLoginRequest /
  AuthRegisterRequest**, **HealthResponse**, **ApiError**, and shell-safe value objects
  (**ContainerName**, **ComposePath**, **ComposeProject**, **SkillCommandTemplate**).

### Tech stack (Built-With material)

Single root `package.json` (`private: true`, version `0.0.0`, `license: MIT`). No per-app
manifests. Node pinned via `.nvmrc` → **24** (no `engines` field). npm workspaces, Nx-managed.

Headline versions:
- **Nx** 22.7.2 · **TypeScript** ~5.9.2 · **Angular** 21.2 · **NestJS** 11 · **Node** 24

Frontend: Angular 21.2 (+ `@angular/cdk` 21.2.14), `@ngrx/signals` 21.1.1 (signal stores),
`@spartan-ng/brain` 0.0.1-alpha.707, `@ng-icons/lucide`, Tailwind CSS 4.3.0
(`@tailwindcss/postcss`, `tailwind-merge`, `class-variance-authority`, `clsx`, `tw-animate-css`),
`zone.js` 0.16.0, RxJS ~7.8.

Backend: NestJS 11 (`@nestjs/config` 4), Express 5.2.1, Drizzle ORM 0.45.2 over `better-sqlite3`
12.10.0, Better Auth 1.6.15, `node-ssh` 13.2.1 + `async-mutex` 0.5.0 (per-device serialization),
Vercel AI SDK `ai` 6.0.201 + `@ai-sdk/openai-compatible` 2.0.48, Zod 4.4.3 (contracts), Joi 18.2.1
(env validation).

Tooling: Nx 22.7.2 (angular/nest/node/webpack/vite/vitest/eslint/playwright plugins), `@angular/build`,
Vite 7 + esbuild 0.27, webpack (api build), Vitest 4.1.9, Playwright 1.36, ESLint 9 (flat) +
typescript-eslint 8, Prettier 3.8, Husky + lint-staged.

Monorepo: `apps/api` (NestJS), `apps/web` (Angular), `libs/shared` (`@opspilot/shared` contract
barrel), `libs/ui` (`@spartan-ng/helm` component wrappers). Cross-boundary imports enforced by
`@nx/enforce-module-boundaries` scope tags.

> **README caveat:** `luxon` is in the manifest but no runtime import was found — verify before
> listing it as actively used.

### Getting Started material

**Prerequisites:** Node **24** (`.nvmrc`); npm; a native build toolchain (`python3 make g++`) for
`better-sqlite3`. No external DB server (embedded SQLite). To actually diagnose, you need an
OpenAI-compatible LLM endpoint (configured **in-app**, not via env) and SSH access to the target
devices (credentials stored encrypted per-device, not in env).

**Commands** (root; wrap `nx`):
```bash
npm ci                 # reproducible install
npm start              # dev: api :3000 + web :4200
npm run start:web      # web only → http://localhost:4200
npm run start:api      # api only → http://localhost:3000 (prefix /api)
npm run build          # build all (build:api → dist/apps/api, build:web → dist/apps/web/browser)
npm run lint / test    # nx run-many
npm run format         # prettier write
npm run db:generate    # drizzle-kit generate migration
npm run db:migrate     # apply migrations
npm run db:studio      # drizzle studio
npm run e2e            # Playwright (e2e:ui, e2e:report)
./scripts/deploy.sh    # upload compose.yaml to the Synology NAS over ssh
```
Ports: web dev 4200 (proxies `/api` → :3000 via `apps/web/proxy.conf.json`); api 3000 prefix
`/api`; in-container nginx 8080 → node 127.0.0.1:3000. Health: `GET /api/health`.

**Environment variables** — validated at boot by Joi (`apps/api/src/config/env.schema.ts`), missing
required vars fail fast. Template: `.env.example`. Nx auto-loads root `.env` for serve/tests.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `BETTER_AUTH_SECRET` | **Yes** | — (min 32 chars) | Better Auth signing secret |
| `BETTER_AUTH_URL` | **Yes** | — (URI) | Public URL app is served from |
| `ENCRYPTION_KEY` | **Yes** | — (base64, 44 chars = 32 bytes) | Master AES-256 key for at-rest secrets |
| `TRUSTED_ORIGINS` | **Yes** | — (comma-sep) | Origins Better Auth trusts (CORS) |
| `DATABASE_PATH` | No | `./data/opspilot.db` | SQLite file (`/data/opspilot.db` in prod) |
| `DATABASE_BACKUP_RETENTION` | No | `5` | Pre-migration `.bak` snapshots kept |
| `DEVICE_CREDENTIAL_LIST_LIMIT` | No | `50` | Device-credential page size (ceiling 100) |
| `NODE_ENV` | No | `development` | development \| production \| test |
| `PORT` | No | `3000` | NestJS listen port |
| `SESSION_EXPIRES_IN` | No | `604800` | Session lifetime (s) |
| `SESSION_UPDATE_AGE` | No | `86400` | Session refresh interval (s) |
| `LLM_GENERATE_TIMEOUT_MS` | No | `12000` | Synthesis timeout — raise to ~120000 for slow models |
| `LLM_DIAGNOSE_HISTORY_RETENTION` | No | `20` | Diagnose runs kept per device |
| `LLM_DIAGNOSE_LOGS_TAIL` | No | `200` | Log lines fed into the diagnose prompt |
| `LLM_DIAGNOSE_LOGS_TIMEOUT_MS` | No | `5000` | Bound on the logs fetch |
| `LLM_NARRATION_TICK_MS` | No | `2000` (min 500) | Progress-heartbeat cadence |
| `LLM_TEST_TIMEOUT_MS` | No | `5000` | Provider test-call timeout |
| `SKILL_TIMEOUT_MS` | No | `300000` | Fallback per-skill-run timeout |
| `SSH_COMMAND_TIMEOUT_MS` | No | `30000` | Per-command SSH timeout |
| `SSH_CONNECT_TIMEOUT_MS` | No | `10000` | SSH connect timeout |
| `OVERVIEW_AVG_DIAGNOSE_WINDOW_MS` | No | `604800000` | Avg-diagnose averaging window |
| `OVERVIEW_SKILL_RUNS_WINDOW_MS` | No | `86400000` | Skill-runs trailing window |

Secret generators: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
(auth secret) and `…toString('base64')` (encryption key).

> **Setup gotcha for the README:** the LLM provider is **not** an env var — after first login,
> configure the OpenAI-compatible provider (`baseURL`, `model`, encrypted `apiKey`) in-app on
> `/llm-providers`. Use a structured-output-reliable model (e.g. gpt-oss-120b, **not**
> ministral-3:14b) and raise `LLM_GENERATE_TIMEOUT_MS` to ~120s (memory:
> `diagnose-llm-timeout-and-model`).

**Database:** SQLite (WAL) via `better-sqlite3` + Drizzle — must live on **local disk** (WAL
corrupts on network shares). Migrations apply **automatically at boot** — `MigrationService`
(`OnApplicationBootstrap`) runs `migrate()` before `app.listen()` with a WAL-aware pre-migration
`.bak` backup (`core/database/migration/migration.service.ts`). 10 committed migrations
(`0000_*`→`0009_*`) in `apps/api/migrations/`. No manual create/seed step; DB + schema created on
first boot. Default skills are seeded (`skill.seed.ts`).

### Deployment

Ships as **one multi-arch container** (nginx + node + supervisor + tini):
- `Dockerfile` — 3-stage `node:24-alpine` build (webpack api + angular web → `npm install --omit=dev`
  from webpack's generated pruned `package.json` → nginx:1.27-alpine runtime). nginx 8080, node
  127.0.0.1:3000, SQLite bind-mount `/data`. Nx `prune` target intentionally skipped (`Dockerfile:19-24`).
- `docker/nginx.conf` — SPA + `/api` reverse proxy, SSE-safe (`proxy_buffering off`, 3600s timeouts,
  upgrade headers). `docker/supervisord.conf` supervises node + nginx.
- `.github/workflows/pipeline.yml` — CI on push to `main`: lint/test gates → multi-arch
  (`linux/amd64,linux/arm64`) build & push to `ghcr.io/karoldydo/opspilot:latest` → GHCR cleanup.
  Deploy job runs only when both gates are green.

Synology/homelab (target `/volume1/docker/opspilot`):
- `context/deployment/compose.yaml` — host-side compose: pulls `ghcr.io/karoldydo/opspilot:latest`,
  binds `127.0.0.1:8080:8080` (loopback only), `env_file: .env`, forces `DATABASE_PATH=/data/opspilot.db`,
  mounts `/volume1/docker/opspilot/data:/data`, `cap_add: NET_RAW/NET_ADMIN` (pre-wired for future
  LAN discovery), `/api/health` healthcheck, Watchtower monitor-only label.
- `scripts/deploy.sh` — interactive: prompts for an `~/.ssh/config` alias (default `synology`),
  `scp -O` uploads **only** `compose.yaml`, never touching remote `.env` or `data/`. Image update is
  a manual `docker compose pull && docker compose up -d` on the host.
- `context/deployment/deploy-plan.md` — full narrative (single-image rationale, DSM 7.x specifics,
  Cloudflare Tunnel + Access OTP ingress, Watchtower, rollback via pinned `sha-<short>`/digest tags).
- Live at `opspilot.example.com` behind Cloudflare Access.

## Code References

- `apps/api/src/app.module.ts:32` — global `AuthAppGuard`
- `apps/api/src/core/auth/create-auth.ts:17` — Better Auth + Drizzle SQLite adapter
- `apps/api/src/modules/service/service.service.ts:29,47` — Docker scan over SSH
- `apps/api/src/modules/diagnose/diagnose.controller.ts:40` — `@Sse` diagnosis stream
- `apps/api/src/modules/diagnose/diagnose.service.ts:98` — `streamObject()` synthesis engine
- `apps/api/src/modules/skill/skill-run.service.ts:44` — templated skill runner
- `apps/api/src/modules/llm-provider/llm-provider.client-factory.ts:19` — OpenAI-compatible model
- `apps/api/src/integrations/executor/ssh.executor.ts` — node-ssh executor (per-device mutex)
- `apps/api/src/core/crypto/crypto.service.ts:35` — AES-256-GCM
- `apps/api/src/core/database/migration/migration.service.ts` — boot-time migrate + backup
- `apps/api/src/config/env.schema.ts` — Joi env validation
- `apps/web/src/app/app.routes.ts` — SPA routes
- `apps/web/src/app/features/diagnosis/data/diagnosis.store.ts:41` — `EventSource` SSE consumer
- `libs/shared/src/index.ts` — 38 Zod contract barrel
- `Dockerfile`, `docker/nginx.conf`, `context/deployment/compose.yaml`, `scripts/deploy.sh`,
  `.github/workflows/pipeline.yml` — deployment

## Architecture Insights

- **Zod-first contracts** — every FE↔BE shape lives once in `@opspilot/shared`; both apps `z.infer`.
- **Config discipline** — all env goes through Joi + `registerAs(...)` namespaces; no `process.env`
  outside the config layer (see `lessons.md`).
- **SSH is serialized per device** via `async-mutex`; commands are bounded by timeouts; the executor
  hides behind an `IExecutor` interface.
- **SSE is Cloudflare-hardened** — heartbeats survive the ~100s idle reap; nginx disables buffering.
- **Single-image deploy** — nginx + node co-supervised so one container fronts SPA + API + SQLite.
- **Migrations auto-apply at boot** with a WAL-aware backup gate — no manual DB step.

## Historical Context (from prior changes)

MVP is complete — all 12 roadmap slices archived (`context/foundation/roadmap.md`, "Done"):

- F-01 data-persistence-scaffold · F-02 account-auth-foundation · F-03 encrypted-credential-store
- S-01 manage-devices · S-02 scan-and-add-services · S-03 configure-llm-provider ·
  S-04 diagnose-service-synthesis (north star) · S-05 live-narration-and-replay ·
  S-06 deterministic-service-operations · S-07 per-device-agent-context · S-08 custom-skill-crud ·
  S-09 audit-log-and-history

Post-MVP work also shipped (in `context/archive/`): API/web architecture refactors, terminal
design system re-skin, spartan-ng component migration, datatable redesigns, a full testing push
(SSH executor lifecycle, security guardrails, agent-diagnosis-under-failure, Playwright bootstrap,
diagnose E2E), and CI/CD gate improvements. 31 archived changes total; `create-readme` is the only
active change.

**Planned / parked (post-MVP, not built)** — for an honest Roadmap section:
- [ ] LAN device auto-discovery (parked; host-network privilege risk — `NET_RAW` pre-wired)
- [ ] Container updates with rollback, skill scheduling, failure notifications, bulk operations,
  backup/restore (v2)
- Deliberately excluded (non-goals; do not list as roadmap): chat, metrics monitoring, user-defined
  output schemas, RBAC, mobile/desktop, i18n, dark mode.

## Repo metadata (Contact / License / Acknowledgments)

- **Owner/repo:** karoldydo/opspilot · **URL:** https://github.com/karoldydo/opspilot
- **Clone:** `git@github.com:karoldydo/opspilot.git`
- **Commit:** `4739ce1` · **Branch:** main
- **Author/contact:** Karol Dydo — contact@karoldydo.dev (from git config; **no `author` field in
  package.json**)
- **License:** `package.json` declares MIT, but there is **NO `LICENSE` file** in the repo root and
  `gh` reports `licenseInfo: null`. **Add a `LICENSE` file** before the README claims MIT.
- **Live deployment:** `opspilot.example.com` (Cloudflare Access); image on GHCR.

**Acknowledgments:**
- [Best-README-Template](https://github.com/othneildrew/Best-README-Template) by othneildrew — the
  README is based on this template.
- Notable stack to credit: Nx, Angular + CDK, NestJS, spartan/ng + Tailwind CSS, Drizzle ORM +
  better-sqlite3, Zod, Better Auth, Vercel AI SDK, node-ssh, Vitest + Playwright.

## Open Questions

1. **LICENSE file missing** — `package.json` says MIT but there's no `LICENSE`. Add one (README's
   License section should link to it) before advertising the license.
2. **`luxon`** is declared but no runtime import found — confirm before listing it in Built-With.
3. **Screenshots/demo GIF** — the Best-README-Template has a product-screenshot slot. None exist in
   the repo; the README author will need to capture the overview / service-detail / live-diagnosis
   screens (or leave a placeholder).
4. **GitHub repo description is empty** — worth setting to match the README tagline.

## Related Research

- `context/foundation/prd.md`, `context/foundation/roadmap.md`, `context/foundation/tech-stack.md`,
  `context/deployment/deploy-plan.md` — foundation + deployment narrative.
- No prior `research.md` under `context/changes/**/` or `context/archive/**/` overlaps this topic.
