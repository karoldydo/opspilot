<a id="readme-top"></a>

<!--
*** README for OpsPilot — modeled on the Best-README-Template
*** (https://github.com/othneildrew/Best-README-Template).
*** reference-style links are used throughout; definitions live at the bottom.
-->

<!-- PROJECT SHIELDS -->

[![CI status][ci-shield]][ci-url]
[![Stars][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![MIT License][license-shield]][license-url]

<!-- PROJECT HEADER -->
<br />
<div align="center">
  <h1 align="center">🛰️ OpsPilot</h1>

  <p align="center">
    Self-hosted homelab ops tool with an agentic AI diagnostic layer.
    <br />
    Register your Docker devices, scan their containers, and turn raw logs into a
    structured AI assessment — all from the browser, no SSH.
    <br />
    <br />
    <a href="https://github.com/karoldydo/opspilot"><strong>Explore the repo »</strong></a>
    &middot;
    <a href="https://opspilot.example.com">Live app</a>
    &middot;
    <a href="https://github.com/karoldydo/opspilot/issues/new?labels=bug">Report Bug</a>
    &middot;
    <a href="https://github.com/karoldydo/opspilot/issues/new?labels=enhancement">Request Feature</a>
  </p>
</div>

<!-- TABLE OF CONTENTS -->
<details>
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#about-the-project">About The Project</a>
      <ul>
        <li><a href="#built-with">Built With</a></li>
      </ul>
    </li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation">Installation</a></li>
        <li><a href="#environment-variables">Environment Variables</a></li>
      </ul>
    </li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#deployment">Deployment</a></li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
  </ol>
</details>

<!-- ABOUT THE PROJECT -->

## About The Project

<!-- todo: add overview / service-detail / live-diagnosis screenshots under docs/images/ -->
<!-- [![OpsPilot Screenshot][product-screenshot]](https://opspilot.example.com) -->

OpsPilot is a self-hosted homelab control panel that adds an **agentic AI diagnostic layer** on top
of everyday Docker container operations. It is built for a homelabber running a small fleet of
devices — a Synology NAS, a Raspberry Pi, a mini-PC — with `docker compose` stacks, who today SSHes
into each host and greps logs by hand.

The core idea: instead of tailing logs yourself, register a device, scan it over SSH to discover its
running containers, promote the interesting ones into managed **services**, then ask OpsPilot to
**diagnose** a service. It SSHes in, pulls the recent `docker logs`, and streams a structured LLM
synthesis back to your browser live — `status / problems / suggestions / summary` — so a raw log
tail becomes an actionable, four-field assessment. You can also run parametrized **skills** (reusable
`start` / `stop` / `restart` / `up` / `down` command templates) against a service without opening a
terminal.

It is a single-tenant tool with a few load-bearing guardrails:

- **Predefined skills only** — the agent runs curated command templates, never free-form chat or
  arbitrary shell.
- **Secrets encrypted at rest** — SSH credentials and LLM API keys are stored AES-256-GCM encrypted
  and never returned in plaintext.
- **Flat multi-user model** — no roles or RBAC; every mutation is written to an **audit log** for
  accountability, and an **overview** dashboard aggregates fleet metrics.

LLM access is via pluggable **OpenAI-compatible** providers, configured in-app.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Built With

OpsPilot is an **Nx 22** monorepo (npm workspaces) with a NestJS API, an Angular SPA, and a shared
Zod-contract library that is the single source of truth for every FE↔BE shape.

- [![Nx][nx-shield]][nx-url] 22 — monorepo tooling & task graph
- [![TypeScript][ts-shield]][ts-url] ~5.9
- [![Node.js][node-shield]][node-url] 24
- [![Angular][angular-shield]][angular-url] 21 SPA — standalone components, `@ngrx/signals` signal stores, zoneless
- [![NestJS][nest-shield]][nest-url] 11 API — Express 5, global `/api` prefix
- [![Tailwind CSS][tailwind-shield]][tailwind-url] v4 + [spartan/ng][spartan-url] primitives
- [![SQLite][sqlite-shield]][sqlite-url] via Drizzle ORM + `better-sqlite3` (WAL)
- [![Better Auth][betterauth-shield]][betterauth-url] — email + password
- [![Zod][zod-shield]][zod-url] — shared contracts (`@opspilot/shared`)
- [Vercel AI SDK][aisdk-url] (`ai` + `@ai-sdk/openai-compatible`) — `streamObject()` synthesis
- [node-ssh][nodessh-url] — remote command execution (per-device mutex)
- [![Vitest][vitest-shield]][vitest-url] + [![Playwright][playwright-shield]][playwright-url] — unit & E2E tests

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- GETTING STARTED -->

## Getting Started

Run OpsPilot locally in dev mode (Angular on `:4200`, NestJS on `:3000`).

### Prerequisites

- **Node 24** — pinned via `.nvmrc`:
  ```sh
  nvm use
  ```
- **npm** (bundled with Node).
- A **native build toolchain** for `better-sqlite3` — on Debian/Ubuntu:
  ```sh
  sudo apt-get install -y python3 make g++
  ```
- No external database server is needed — SQLite is embedded.

Two things are configured **in-app, not via env**:

- The **LLM provider** — after first login, add an OpenAI-compatible provider on `/llm-providers`.
- **SSH credentials** — added per-device and stored encrypted; never placed in `.env`.

### Installation

```sh
# 1. clone
git clone https://github.com/karoldydo/opspilot.git
cd opspilot

# 2. install (reproducible)
npm ci

# 3. configure environment (see the table below)
cp .env.example .env
# generate the two secrets:
node -e "console.log('BETTER_AUTH_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('base64'))"

# 4. run everything in dev (web :4200 + api :3000)
npm start
```

The web dev server proxies `/api` → `:3000` (`apps/web/proxy.conf.json`). Health check:
`GET /api/health`.

**Database migrations apply automatically at boot** — `MigrationService` runs `migrate()` (with a
WAL-aware pre-migration `.bak` backup) before the server starts listening. There is no manual create
or seed step; the DB, schema, and default skills (`start` / `stop` / `restart` / `up` / `down`) are
created on first boot.

Other useful scripts (all wrap `nx` from the repo root):

```sh
npm run start:web   # web only  → http://localhost:4200
npm run start:api   # api only  → http://localhost:3000 (prefix /api)
npm run build       # build all apps
npm run lint        # lint all projects
npm run test        # unit tests (Vitest)
npm run format      # prettier write
npm run db:generate # drizzle-kit: generate a migration
npm run db:migrate  # drizzle-kit: apply migrations
npm run db:studio   # drizzle studio
npm run e2e         # Playwright E2E (e2e:ui, e2e:report)
./scripts/deploy.sh # upload compose.yaml to the Synology NAS over ssh
```

### Environment Variables

Validated at boot by Joi (`apps/api/src/config/env.schema.ts`) — missing required vars fail fast.
Nx auto-loads the root `.env` for serve and tests. Start from `.env.example`.

| Variable                          | Required | Default              | Purpose                                              |
| --------------------------------- | :------: | -------------------- | ---------------------------------------------------- |
| `BETTER_AUTH_SECRET`              | **Yes**  | — (min 32 chars)     | Better Auth signing secret                           |
| `BETTER_AUTH_URL`                 | **Yes**  | — (URI)              | Public URL the app is served from                    |
| `ENCRYPTION_KEY`                  | **Yes**  | — (base64, 44 chars) | Master AES-256 key for at-rest secrets               |
| `TRUSTED_ORIGINS`                 | **Yes**  | — (comma-sep)        | Origins Better Auth trusts (CORS)                    |
| `DATABASE_PATH`                   |    No    | `./data/opspilot.db` | SQLite file (`/data/opspilot.db` in prod)            |
| `DATABASE_BACKUP_RETENTION`       |    No    | `5`                  | Pre-migration `.bak` snapshots kept                  |
| `DEVICE_CREDENTIAL_LIST_LIMIT`    |    No    | `50`                 | Device-credential page size (ceiling 100)            |
| `NODE_ENV`                        |    No    | `development`        | development \| production \| test                    |
| `PORT`                            |    No    | `3000`               | NestJS listen port                                   |
| `SESSION_EXPIRES_IN`              |    No    | `604800`             | Session lifetime (s)                                 |
| `SESSION_UPDATE_AGE`              |    No    | `86400`              | Session refresh interval (s)                         |
| `LLM_GENERATE_TIMEOUT_MS`         |    No    | `12000`              | Synthesis timeout — raise to ~120000 for slow models |
| `LLM_DIAGNOSE_HISTORY_RETENTION`  |    No    | `20`                 | Diagnose runs kept per device                        |
| `LLM_DIAGNOSE_LOGS_TAIL`          |    No    | `200`                | Log lines fed into the diagnose prompt               |
| `LLM_DIAGNOSE_LOGS_TIMEOUT_MS`    |    No    | `5000`               | Bound on the logs fetch                              |
| `LLM_NARRATION_TICK_MS`           |    No    | `2000` (min 500)     | Progress-heartbeat cadence                           |
| `LLM_TEST_TIMEOUT_MS`             |    No    | `5000`               | Provider test-call timeout                           |
| `SKILL_TIMEOUT_MS`                |    No    | `300000`             | Fallback per-skill-run timeout                       |
| `SSH_COMMAND_TIMEOUT_MS`          |    No    | `30000`              | Per-command SSH timeout                              |
| `SSH_CONNECT_TIMEOUT_MS`          |    No    | `10000`              | SSH connect timeout                                  |
| `OVERVIEW_AVG_DIAGNOSE_WINDOW_MS` |    No    | `604800000`          | Avg-diagnose averaging window                        |
| `OVERVIEW_SKILL_RUNS_WINDOW_MS`   |    No    | `86400000`           | Skill-runs trailing window                           |

> [!TIP]
> The LLM provider is configured **in-app**, not via env. After first login, add an
> OpenAI-compatible provider (`baseURL`, `model`, encrypted `apiKey`) on `/llm-providers`. Use a
> model that reliably produces structured output (e.g. `gpt-oss-120b`, **not** `ministral-3:14b`) and
> raise `LLM_GENERATE_TIMEOUT_MS` to ~120s for slower models — otherwise diagnosis synthesis can time
> out or return malformed output.

> [!IMPORTANT]
> SQLite runs in WAL mode and must live on **local disk** — WAL corrupts on network shares. In
> production `DATABASE_PATH` points at a local bind-mount (`/data/opspilot.db`).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- USAGE -->

## Usage

Everything below the login screen sits behind Better Auth and a persistent sidebar layout. A typical
first run is: **register → add an LLM provider → add a device + SSH credential → scan → diagnose**.

**Backend domains** (NestJS, all routes under the `/api` prefix):

- **Auth** — email + password signup/login via Better Auth (Drizzle SQLite adapter). A global guard
  protects every route except the explicitly public ones (health, auth handler).
- **Devices** — CRUD for the fleet. A device carries a host, a name, and an optional `agentContext`
  persona that is fed to the LLM as its `system` prompt.
- **Credentials** — encrypted SSH secrets per device (`password` or `key`). Stored as
  ciphertext + iv + authTag (AES-256-GCM); the secret is never returned in a response.
- **Services + Docker scan** — `POST …/scan` runs `docker ps` over SSH and parses the running
  containers (including compose project/path labels); you then promote containers into managed
  services. A fleet aggregate joins each service to its latest diagnosis status.
- **AI Diagnosis (SSE)** — the north-star feature. SSHes in, pulls `docker logs --tail N`, and feeds
  them to `streamObject()` against a strict `DiagnosisSynthesis` schema. Frames
  (`step / progress / delta / done / error / ping`) stream to the browser live over Server-Sent
  Events, heartbeated to survive Cloudflare's ~100s idle reap; each run is persisted and replayable.
- **Skills** — reusable command templates with `{{param}}` placeholders (input- or service-sourced).
  Values are re-validated at the shell boundary, executed under a per-skill timeout, and the exit is
  classified and audited. Ships with seeded `start` / `stop` / `restart` / `up` / `down` defaults.
- **LLM Providers** — CRUD + activate for `openai-compatible` providers; API keys stored encrypted,
  responses expose only a `hasApiKey` flag.
- **Audit** — a paginated timeline of every mutation across the app.
- **Overview** — fleet metrics: average diagnose duration and 24h skill-run count / success rate.
- **Health** — a public `GET /api/health` that pings SQLite.

**Web screens** (Angular SPA):

- `/` — overview dashboard (fleet metrics).
- `/devices` — device list with add/edit and scan-services dialogs.
- `/devices/:deviceId/services/:serviceId` — the full operational surface for a service: run a live
  diagnosis, run a skill, rename.
- `/skills` — skill CRUD.
- `/llm-providers` — provider CRUD + activate.
- `/audit` — the audit timeline.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- DEPLOYMENT -->

## Deployment

OpsPilot ships as **one multi-arch container** (nginx + node + supervisor + tini):

- A 3-stage `node:24-alpine` `Dockerfile` builds the webpack API and the Angular web bundle, then
  serves both from an `nginx:1.27-alpine` runtime — nginx on `8080`, node on `127.0.0.1:3000`, SQLite
  on a `/data` bind-mount. `docker/nginx.conf` fronts the SPA and reverse-proxies `/api`, SSE-safe
  (`proxy_buffering off`, long timeouts, upgrade headers).
- `.github/workflows/pipeline.yml` — CI on push to `main`: lint/test gates → a multi-arch
  (`linux/amd64,linux/arm64`) build & push to `ghcr.io/karoldydo/opspilot:latest`. The deploy job
  runs only when both gates are green.
- On the homelab (a Synology NAS at `/volume1/docker/opspilot`),
  `context/deployment/compose.yaml` pulls the GHCR image, binds to loopback only
  (`127.0.0.1:8080:8080`), reads an `env_file: .env`, and mounts a local `data/` volume.
  `scripts/deploy.sh` uploads **only** `compose.yaml` over SSH — it never touches the remote `.env`
  or `data/`. Image updates are a manual `docker compose pull && docker compose up -d` on the host.
- The live instance runs at [opspilot.example.com](https://opspilot.example.com) behind a
  Cloudflare Tunnel + Access. See `context/deployment/deploy-plan.md` for the full narrative
  (single-image rationale, DSM 7.x specifics, rollback via pinned `sha-<short>` / digest tags).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- ROADMAP -->

## Roadmap

- [x] **MVP complete** — all 12 planned slices shipped: data persistence, auth, encrypted
      credentials, device management, scan-and-add services, LLM provider config, AI diagnosis
      synthesis (north star), live narration + replay, deterministic service operations, per-device
      agent context, custom skill CRUD, and audit log + history.
- [ ] LAN device auto-discovery (parked — host-network privilege risk; `NET_RAW` is pre-wired)
- [ ] Container updates with rollback
- [ ] Skill scheduling
- [ ] Failure notifications
- [ ] Bulk operations
- [ ] Backup / restore

See the [open issues](https://github.com/karoldydo/opspilot/issues) for a full list of proposed
features and known issues.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- CONTRIBUTING -->

## Contributing

Contributions are what make the open-source community such an amazing place to learn, inspire, and
create. Any contributions you make are **greatly appreciated**.

If you have a suggestion that would make this better, please fork the repo and create a pull request.
You can also simply open an issue with the tag "enhancement". Don't forget to give the project a
star! Thanks again!

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/amazing-feature`)
3. Commit your Changes (`git commit -m 'feat: add some amazing feature'`)
4. Push to the Branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- LICENSE -->

## License

Distributed under the MIT License. See [`LICENSE`](LICENSE) for more information.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- CONTACT -->

## Contact

Karol Dydo — contact@karoldydo.dev

Project Link: [https://github.com/karoldydo/opspilot](https://github.com/karoldydo/opspilot)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- ACKNOWLEDGMENTS -->

## Acknowledgments

- [Best-README-Template](https://github.com/othneildrew/Best-README-Template) by othneildrew — this
  README is based on it.
- [Nx](https://nx.dev) · [Angular](https://angular.dev) + [CDK](https://material.angular.dev/cdk) ·
  [NestJS](https://nestjs.com)
- [spartan/ng](https://spartan.ng) + [Tailwind CSS](https://tailwindcss.com)
- [Drizzle ORM](https://orm.drizzle.team) + [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- [Zod](https://zod.dev) · [Better Auth](https://www.better-auth.com) ·
  [Vercel AI SDK](https://ai-sdk.dev) · [node-ssh](https://github.com/steelbrain/node-ssh)
- [Vitest](https://vitest.dev) + [Playwright](https://playwright.dev)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- MARKDOWN LINKS & IMAGES -->

[ci-shield]: https://img.shields.io/github/actions/workflow/status/karoldydo/opspilot/pipeline.yml?branch=main&style=for-the-badge
[ci-url]: https://github.com/karoldydo/opspilot/actions/workflows/pipeline.yml
[stars-shield]: https://img.shields.io/github/stars/karoldydo/opspilot.svg?style=for-the-badge
[stars-url]: https://github.com/karoldydo/opspilot/stargazers
[issues-shield]: https://img.shields.io/github/issues/karoldydo/opspilot.svg?style=for-the-badge
[issues-url]: https://github.com/karoldydo/opspilot/issues
[license-shield]: https://img.shields.io/badge/license-MIT-blue.svg?style=for-the-badge
[license-url]: https://github.com/karoldydo/opspilot/blob/main/LICENSE
[product-screenshot]: docs/images/screenshot.png
[nx-shield]: https://img.shields.io/badge/Nx-143055?style=for-the-badge&logo=nx&logoColor=white
[nx-url]: https://nx.dev
[ts-shield]: https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white
[ts-url]: https://www.typescriptlang.org
[node-shield]: https://img.shields.io/badge/Node.js-5FA04E?style=for-the-badge&logo=nodedotjs&logoColor=white
[node-url]: https://nodejs.org
[angular-shield]: https://img.shields.io/badge/Angular-DD0031?style=for-the-badge&logo=angular&logoColor=white
[angular-url]: https://angular.dev
[nest-shield]: https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white
[nest-url]: https://nestjs.com
[tailwind-shield]: https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white
[tailwind-url]: https://tailwindcss.com
[spartan-url]: https://spartan.ng
[sqlite-shield]: https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white
[sqlite-url]: https://www.sqlite.org
[betterauth-shield]: https://img.shields.io/badge/Better_Auth-000000?style=for-the-badge&logo=betterauth&logoColor=white
[betterauth-url]: https://www.better-auth.com
[zod-shield]: https://img.shields.io/badge/Zod-3E67B1?style=for-the-badge&logo=zod&logoColor=white
[zod-url]: https://zod.dev
[aisdk-url]: https://ai-sdk.dev
[nodessh-url]: https://github.com/steelbrain/node-ssh
[vitest-shield]: https://img.shields.io/badge/Vitest-6E9F18?style=for-the-badge&logo=vitest&logoColor=white
[vitest-url]: https://vitest.dev
[playwright-shield]: https://img.shields.io/badge/Playwright-2EAD33?style=for-the-badge&logo=playwright&logoColor=white
[playwright-url]: https://playwright.dev
