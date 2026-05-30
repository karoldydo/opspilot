# Deploy Plan - First OpsPilot deployment (end-to-end pipeline, scaffold)

> Audit artifact of "what was supposed to happen" for the first deployment (Plan Mode deploy, Module 1 / Lesson 5).
> Inputs: `context/foundation/infrastructure.md` (platform decision) + `context/foundation/tech-stack.md` (stack).

## Context

OpsPilot has a settled infrastructure decision (`infrastructure.md`: self-host Docker on Linux + Cloudflare Tunnel + Cloudflare Access) and stack (`tech-stack.md`: Angular 21 web + NestJS 11 api, a single multi-arch container → GHCR). The **entire deployment layer is missing** - there is no `Dockerfile`, `.dockerignore`, `compose.yaml`, nor a GitHub Actions workflow; `infrastructure.md` deliberately leaves their authoring "out of scope".

The app is currently a **pure Nx scaffold**: `apps/api` exposes a single endpoint `GET /api/` → `{message:'Hello API'}` (port 3000, prefix `/api`), `apps/web` is the Angular welcome screen. Zero business logic (SSH, SSE, AI, SQLite not yet wired).

**Goal**: run this trivial scaffold through the **full production pipeline** (build → multi-arch image on GHCR → container on the homelab host → cloudflared → Cloudflare Access) to validate the end-to-end path **before** real features land.

## Decisions (confirmed with the user)

- **Single image**: Nginx (serves the SPA + proxies `/api`) + Node (NestJS) under a supervisor. Not two compose services, not `@nestjs/serve-static`.
- **Multi-arch** (`linux/amd64` + `linux/arm64`) built in GitHub Actions → `ghcr.io/karoldydo/opspilot`.
- **Target host: Synology (DSM 7.x)**, Docker run from the SSH console (`docker` / `docker compose`), not from the Container Manager UI. The agent connects to the NAS over SSH (the agent's operational channel, **not** part of the target application). **Fallback: GMKtec MiniPC (x86)** - only if Synology can't handle it (wrong CPU arch / no Docker compose v2).
- **Ingress**: Cloudflare Tunnel (`cloudflared` container in compose) + Cloudflare Access (OTP-email). Domain already on Cloudflare; the user will provide the subdomain (`opspilot.<domain>`) during execution.
- **SQLite (future)**: bind-mount on **local btrfs** (`/volume1/docker/opspilot/data`), never on a network share. Unused today, but we provision the mount now.
- **CI/CD = deploy + cleanup** (deliberately no linters/tests/security for now). Cleanup removes surplus image versions in GHCR to save space.
- **Updates via the existing Watchtower on the NAS - in `monitor-only` mode** (`ghcr.io/nicholas-fedor/watchtower`, a maintained fork; a shared instance on Synology with Pushover already configured, daily schedule, `WATCHTOWER_LABEL_ENABLE=true`). Watchtower **only notifies** about a new `latest` (Pushover) - the update (`pull && up -d`) is triggered by a human/agent. This reconciles with `infrastructure.md` (notify-only instead of auto-update; the risk-register row that assumed Diun + the archived containrrr is worth updating).

Key Synology distinction: the `--network host` / `NET_RAW` restrictions apply to the Container Manager **UI**; over SSH these flags work normally. For the scaffold, nmap/NET_RAW are not used anyway, so they don't block this step - we pre-wire `cap_add` for later.

> **✅ Verified on the target NAS (2026-05-30)**: DSM 7.3.2, x86_64, Docker 24.0.2, Compose v2.20.1. From the SSH console `--network host` and `--cap-add NET_RAW` are honored. Docker works without `sudo` (requires `/usr/local/bin` in PATH).

## Phase 0 - Local build verification (read-only sanity)

Confirm the build+prune chain produces the expected artifacts (resolves the risk of an empty `workspace_modules/`, which is absent in the current `dist`):

```
npx nx build api
npx nx prune api        # runs prune-lockfile + copy-workspace-modules
npx nx build web
```

Check for the existence of: `dist/apps/api/{main.js, package.json, package-lock.json, workspace_modules/}` and `dist/apps/web/browser/index.html`. If `workspace_modules/` is not produced (no compiled `@opspilot/*` libs in `main.ts`), the Dockerfile `COPY` must be guarded (copy conditionally) - note this.

## Phase 1 - Containerization files (new files in the repo)

### `Dockerfile` (root) - 3-stage, multi-arch-agnostic

- **builder** (`node:22-alpine`, `apk add python3 make g++ libc6-compat`): `npm ci` (against the committed lockfile), then `npx nx build api && npx nx prune api && npx nx build web`.
- **api-deps** (`node:22-alpine` + toolchain): copies `dist/apps/api/{package.json,package-lock.json,workspace_modules}`, `npm ci --omit=dev`. Isolates the production `node_modules` (and native-module compilation once `better-sqlite3` lands).
- **runtime** (`nginx:1.27-alpine`): pulls in the `node` binary from `node:22-alpine` (matching musl ABI), `apk add supervisor tini libstdc++ libc6-compat`. Copies `main.js` + `node_modules` to `/app`, web static files to `/usr/share/nginx/html`, the nginx+supervisor configs. `mkdir /data`. Nginx listens on **8080** (no clash with DSM 80/443/5000/5001), node on `127.0.0.1:3000`. PID 1 = `tini`, `CMD` = `supervisord -n`.

Node pinned to **22 LTS** (satisfies NestJS 11 and Angular 21). The native toolchain is already in builder/api-deps, so the first `better-sqlite3` import compiles without changing the Dockerfile.

### `docker/nginx.conf`

- `location /` → `try_files $uri $uri/ /index.html` (Angular routing), long cache on hashed assets.
- `location /api/` → `proxy_pass http://127.0.0.1:3000` (preserves the `/api` prefix).
- **SSE-safe from day one** (`infrastructure.md` requirement): `proxy_buffering off`, `proxy_cache off`, `proxy_read_timeout 3600s`, `proxy_send_timeout 3600s`, `chunked_transfer_encoding on`, `Upgrade`/`Connection` headers (WebSocket fallback). **Do not** override `X-Accel-Buffering` - let the app emit `X-Accel-Buffering: no`.
- `map $http_upgrade $connection_upgrade` in the `http` context (the included file is included inside `http{}`); if it doesn't parse on alpine - split it into `00-map.conf`.

### `docker/supervisord.conf`

- `[supervisord] nodaemon=true`; **one** `[program:api]` (`node /app/main.js`, `priority=10`, `stopsignal=TERM`, `stopwaitsecs=15`) and `[program:nginx]` (`nginx -g "daemon off;"`, `priority=20`, `stopsignal=QUIT`). Both log to `/dev/fd/1`,`/dev/fd/2` (visible in `docker logs`). Clean shutdown (tini→supervisor→TERM/QUIT) matters for future SQLite WAL.

### `.dockerignore` (root)

Exclude `node_modules`, `dist`, `.nx`, `.git`, `.github`, `.angular`, `context`, `*.md`, editor cruft - so `COPY . .` is clean and doesn't pull in a stale `dist`.

**Local smoke-test**: `docker buildx build --load --platform linux/amd64 -t opspilot:test .`, run it, `curl localhost:8080/` (welcome screen) and `curl localhost:8080/api/` (`{message:'Hello API'}`).

## Phase 2 - CI/CD: deploy + cleanup (`.github/workflows/pipeline.yml`)

Scope deliberately narrowed to **deploy + cleanup** (no linters/tests/security - those come later). The two-job pattern (`deploy` → `cleanup`) is taken from a proven pipeline in another homelab project, here with two differences: multi-arch instead of amd64-only, and a multi-arch-aware cleanup.

### Job `deploy` (`if: push && ref == refs/heads/main`, `permissions: packages: write`)

- `actions/checkout@v4`
- `docker/setup-qemu-action@v4` (arm64 emulation) + `docker/setup-buildx-action@v4`
- `docker/login-action@v4` (`ghcr.io`, `username: github.actor`, `password: GITHUB_TOKEN`)
- `docker/metadata-action@v5` → `images: ghcr.io/${{ github.repository }}`, tags: `type=raw,value=latest` + `type=sha,prefix=sha-,format=short` (sha for rollback)
- `docker/build-push-action@v7` → `context: .`, `push: true`, `platforms: linux/amd64,linux/arm64`, `cache-from/to: type=gha,mode=max`, `provenance: false`
- Also triggered by `workflow_dispatch`. *(Action versions verified as of May 2026.)*

### Job `cleanup` (`needs: deploy`, `if: push && ref == refs/heads/main`, `permissions: packages: write`)

Goal: remove surplus image versions in GHCR and save space. Simple variant (proven with single-arch): `actions/delete-package-versions@v5` with `min-versions-to-keep: 5`, `delete-only-untagged-versions: false`.

⚠️ **Multi-arch caveat**: that simple variant is safe only with single-arch (amd64). With multi-arch, each push creates **1 tagged index + N untagged child manifests (per-arch)**; deleting by version count may **orphan the child manifests of the live `latest`** and break the image. So for our multi-arch use a manifest-aware cleanup: **`dataaxiom/ghcr-cleanup-action`** (`package: opspilot`, `keep-n-tagged: 5`, `delete-untagged: true` - preserves the child manifests of kept tags and `latest`, deletes only genuine orphans). The simple `delete-package-versions` is an option **only** if we drop to amd64-only.

If the arm64 build under QEMU is too slow (especially once `better-sqlite3` lands) → a matrix of `ubuntu-24.04` + `ubuntu-24.04-arm` with `buildx imagetools create` (risk-register mitigation). Not needed for the scaffold.

## Phase 3 - Deploy on the host (Synology, GMK fallback)

Over SSH. Commands run **without `sudo`** (user is in the `docker` group); in a non-interactive shell prefix with `export PATH=$PATH:/usr/local/bin`.

1. ✅ **Already verified (2026-05-30)**: `x86_64`, Docker 24.0.2, Compose v2.20.1, DSM 7.3.2 (DS725+), CLI honors `--network host` + `--cap-add NET_RAW`. The host passes - **GMK fallback unnecessary**.
2. `mkdir -p /volume1/docker/opspilot/data` (local btrfs).
3. **[human-only]** `docker login ghcr.io -u karoldydo` with a `read:packages` PAT (the GHCR package is private by default).
4. Upload `compose.yaml` + `.env` (`TUNNEL_TOKEN`, chmod 600, not committed) to `/volume1/docker/opspilot/`.
5. **First run**: `docker compose pull && docker compose up -d`; `docker compose logs -f`.

### `compose.yaml` (on the host, not in the repo)

- **`opspilot`**: `image: ghcr.io/karoldydo/opspilot:latest`, `restart: unless-stopped`, `ports: ["127.0.0.1:8080:8080"]` (host loopback only), `volumes: /volume1/docker/opspilot/data:/data`, `cap_add: [NET_RAW, NET_ADMIN]` (pre-wire for nmap), `healthcheck` on `http://127.0.0.1:8080/api/`, **`labels: ["com.centurylinklabs.watchtower.enable=true"]`** (so the shared Watchtower watches it - the instance has `WATCHTOWER_LABEL_ENABLE=true`).
- **`cloudflared`**: `image: cloudflare/cloudflared:2026.5.2` (pinned), `command: tunnel --no-autoupdate run`, `TUNNEL_TOKEN=${TUNNEL_TOKEN}`, `depends_on: [opspilot]`. **No** Watchtower label → not watched (we control its version manually, per `infrastructure.md`).
- **Network**: both services join the **existing, external `internal` network** (created manually on the NAS — the same one Watchtower runs on). ✅ Verified: driver `bridge`, subnet `172.18.0.0/16`, with egress (cloudflared reaches the edge). In `compose.yaml`: `networks: { internal: { external: true } }` and attaching both services to `internal`; the bridge provides service-name DNS, so cloudflared reaches `http://opspilot:8080`. `network_mode: host` only once LAN-discovery features land (nmap/arp-scan need L2 visibility that NAT doesn't give) — then `opspilot` leaves `internal` (host mode is exclusive) and cloudflared targets `http://127.0.0.1:8080`. Document as a one-line change.

### Updates (Watchtower monitor-only + triggered pull)

- Update loop: CI pushes a new `latest` → the shared Watchtower on the NAS (daily check) detects a new `latest` digest on the watched `opspilot` → **Pushover notification** (already configured). Watchtower does **not** update by itself (`WATCHTOWER_MONITOR_ONLY=true`).
- After the notification a human/agent triggers: `docker compose pull && docker compose up -d` (with real features: **back up the SQLite file first**). This eliminates the mid-write restart risk that `infrastructure.md` warns about.
- Watchtower already mounts a `config.json` with GHCR credentials → it reads the private package with no extra config (the same creds as the host after `docker login`).
- **Host-side cleanup**: in `monitor-only` mode Watchtower does not prune old images on the NAS (CLEANUP only runs after an actual update). After a manual `up -d`, optionally `docker image prune -f`. Registry (GHCR) cleanup is handled by the `cleanup` job from Phase 2.
- **Rollback**: pin the previous immutable digest in `compose.yaml` (`image: ghcr.io/karoldydo/opspilot@sha256:...`, also available as the `sha-<short>` tag) and `up -d` (per `infrastructure.md`).

## Phase 4 - Cloudflare Tunnel + Access

1. **[human-only]** Domain/nameservers on Cloudflare - already set up (Tunnel requirement).
2. Create the tunnel (`cloudflared tunnel create opspilot` or the dashboard / Cloudflare API MCP) → the **token** into the host `.env` as `TUNNEL_TOKEN`. *(Token handling/rotation = human-only.)*
3. Tunnel Public Hostname: `opspilot.<domain>` → `http://opspilot:8080` (bridge).
4. **[human-only edit, the agent may prepare the command]** `cloudflared tunnel route dns opspilot opspilot.<domain>` (CNAME to the tunnel).
5. Cloudflare Access - self-hosted app on `opspilot.<domain>`, an Allow policy with the 1-few users' emails, method **One-Time PIN (email)**, no IdP. (Scriptable via the API MCP.)

### Access boundaries (from `infrastructure.md`)

**Human-only**: editing the DNS zone/nameservers, rotating `TUNNEL_TOKEN` / the encryption key, deleting the tunnel, destructive SQLite operations. **The agent may**: build/push the image, pull, `up -d`, tail logs, create/route the tunnel, create the Access app.

## Phase 5 - End-to-end verification

- `https://opspilot.<domain>` → Access gate (OTP-email) → the Angular welcome screen loads.
- `https://opspilot.<domain>/api/` → `{message:'Hello API'}` (through edge → cloudflared → nginx → node).
- `docker compose logs` shows both processes (api + nginx) and the connected tunnel.
- This proves the whole pipeline before real features land.

## Files created in this deployment

| File                             | Role                                                           |
|----------------------------------|----------------------------------------------------------------|
| `Dockerfile`                     | multi-stage build api+web → runtime nginx+node+supervisor      |
| `docker/nginx.conf`              | SPA + `/api` proxy, SSE-safe                                   |
| `docker/supervisord.conf`        | supervises nginx + node, clean signals                         |
| `.dockerignore`                  | clean build context                                            |
| `.github/workflows/pipeline.yml` | CI/CD: job `deploy` (multi-arch → GHCR) + job `cleanup` (GHCR) |
| `compose.yaml` *(on the host)*   | opspilot (Watchtower label) + cloudflared                      |

> Watchtower is **not** created - it's an existing, shared instance on the NAS (`watchtower/docker-compose.yml`); integration comes down to a label on `opspilot`.

## Open points to confirm during execution

- Subdomain (`opspilot.<domain>`) - the user will provide it.
- Whether the GHCR package should be private (PAT login on the host) or public.
- ✅ **Resolved**: the Synology host is verified (DS725+, x86_64, DSM 7.3.2, Docker 24.0.2, Compose v2.20.1, CLI honors `--network host`/`NET_RAW`) — we deploy on Synology, no GMK fallback.
- No dedicated `/api/health` - for now the healthcheck = `GET /api/`; add one with real features.
- Optional: update the risk-register row in `infrastructure.md` (Diun/containrrr → Watchtower monitor-only on the maintained fork).

## As-built — deviations from plan (2026-05-30)

> The body above is the original plan ("what was supposed to happen"). This section records the **actual** end state, so downstream milestone planning reads correct ground truth. Pipeline Phase 0–5 ran green; `https://opspilot.example.com` is live behind Cloudflare Access.

### Ingress — the biggest divergence

The plan assumed a **per-app `cloudflared`** service inside OpsPilot's `compose.yaml`, reachable over the external `internal` bridge via service-name DNS (`http://opspilot:8080`), fed by a `TUNNEL_TOKEN` in a host-side `.env`. **None of that is the case.** Reality:

- OpsPilot's `compose.yaml` contains **only the `opspilot` service** (+ the `internal` network membership). There is **no `cloudflared` service** in it.
- Ingress is provided by a **pre-existing, shared `cloudflare-tunnel` container** on the NAS (`/volume1/docker/cloudflare-tunnel`): **token-based** (`tunnel run` + its own `TUNNEL_TOKEN`), running in **`network_mode: host`**.
- Because it is host-mode, the tunnel reaches the app over the **host loopback `http://localhost:8080`** — *not* over the `internal` bridge. OpsPilot's published `127.0.0.1:8080:8080` is what makes that work. The `internal` membership is retained only for possible future container-to-container links; the tunnel does not use it.
- **No `.env` / `TUNNEL_TOKEN` exists in `/volume1/docker/opspilot/`** and none is needed. Phase 3 step 4 (upload `.env`) and Phase 4 step 2 (create tunnel + token) **did not happen** — there were no new secrets to wire on OpsPilot's side.
- Cloudflare Public Hostname `opspilot.example.com` → **`localhost:8080`** (HTTP). The DNS CNAME was **auto-created** by adding the Public Hostname in the Zero Trust dashboard, so the explicit `cloudflared tunnel route dns` step (Phase 4 step 4) was unnecessary.

### Build / runtime deviations

- **Node 24-alpine** everywhere (not 22) — user decision; bonus: the npm 11 lockfile stays untouched (no npm 10↔11 dedup conflict).
- **`npx nx prune api` is skipped** in the Dockerfile — the `prune` target is broken (expects a non-existent `apps/api/package.json`). webpack's `generatePackageJson: true` already emits `dist/apps/api/package.json` + lockfile. `workspace_modules/` is created with `mkdir -p` as a guard so the `COPY` never fails (nothing from `@opspilot/*` is imported yet).
- Runtime adds **`apk add --no-cache --upgrade expat … libgcc`** — without force-upgrading the pre-installed `expat`, `supervisord` in `nginx:1.27-alpine` crashes on a `pyexpat` ABI mismatch.

### CI / registry

- `pipeline.yml` matches the plan (multi-arch deploy + `dataaxiom/ghcr-cleanup-action`), with one nit: the `deploy` job has **no `if:` guard** (only `cleanup` does). Commit `58c95c9` was pushed to `main`; CI built and pushed the multi-arch image; the host pulled `ghcr.io/karoldydo/opspilot:latest`.
- GHCR package privacy (Open point, line ~147) still **private during development → public after repo work is done**, per the original decision. (If still private, the host's `docker login` with a `read:packages` PAT is what let it pull.)

### Deploy tooling not in the original plan

- `scripts/deploy.sh` (committed) — uploads `compose.yaml` to the NAS over an SSH alias. Uses **`scp -O`** (legacy SCP protocol) because DSM has the SFTP subsystem disabled while SSH exec works; default scp fails with "connection closed".

### Still pending (genuine Phase 5 / later)

- The target runtime stack (Drizzle + SQLite, Better Auth, node-ssh, AI SDK, SSE) is **not yet wired** — that's app implementation, not infra.
- **SSE through the tunnel is not yet truly verified** (no `text/event-stream` endpoint exists). nginx is prepared (`proxy_buffering off`, `chunked_transfer_encoding on`, 3600s timeouts); confirm on the first streaming route.
