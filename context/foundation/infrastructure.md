---
project: opspilot
researched_at: 2026-05-29
recommended_platform: Self-host (Docker on Linux) + Cloudflare Tunnel + Cloudflare Access
runner_up: Self-host (Docker on Linux) + Tailscale Serve
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Angular 21 (web) + NestJS 11 (api)
  runtime: Node.js (persistent server)
---

## Recommendation

**Deploy opspilot as a self-hosted Docker container on a Linux host inside the homelab LAN, exposed to 1–few trusted users through Cloudflare Tunnel + Cloudflare Access.**

The compute location is not a free choice: the core feature set — SSH out to LAN devices (Synology, Pi, mini-PC) and LAN discovery via nmap/arp-scan — requires the app to run *inside* the local network. No cloud PaaS (Vercel, Netlify, Cloudflare Workers, Fly.io, Railway, Render) can reach `192.168.x.x` devices, so all six were dropped by a hard filter before scoring. The remaining real decision is the secure ingress layer, and Cloudflare Tunnel + Access wins it 5/5 on the agent-friendly criteria: full `cloudflared` CLI lifecycle (token-based, non-interactive), a fully managed edge with **zero open inbound ports** (outbound-only connection that also sidesteps CGNAT), `llms.txt` + markdown-for-agents docs, a stable token/API surface, and an official GA Cloudflare API MCP server covering Zero Trust/tunnels. It is **$0** at 1–few users (Tunnel free; Access free up to 50 seats), gives clientless browser access with one-time-PIN email — the lowest-friction path for housemate/family users —
and aligns exactly with the `tech-stack.md` intent ("one multi-arch container → GHCR; Cloudflare Tunnel/Access as a transparent edge layer outside the app, not edge compute").

Host hardware is interchangeable (Synology / VPS / Pi / mini-PC all run Linux+Docker), but **plain Docker on a Linux mini-PC / VPS / Pi is preferred over Synology Container Manager** for this app — see the risk register for why (raw-socket / host-networking constraints).

## Platform Comparison

The six cloud PaaS candidates from the default research lens were **dropped by hard filter**, not scored: opspilot's agent SSHes into LAN devices and runs nmap/arp-scan, so it must execute inside the homelab LAN. A cloud deploy cannot reach those devices without a fragile reverse tunnel back home — which adds the very brittleness this decision is trying to remove. SQLite-on-local-volume (WAL needs same-kernel file locking) and the "self-host, one container" stack intent point the same way.

The scored decision is therefore the **secure ingress / access layer** in front of the self-hosted container, judged against the five agent-friendly criteria:

| Platform                              | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy/config API | MCP / Integration | Total       |
|---------------------------------------|-----------|--------------------|---------------------|--------------------------|-------------------|-------------|
| **Cloudflare Tunnel + Access**        | Pass      | Pass               | Pass                | Pass                     | Pass              | **5 / 5**   |
| **Tailscale (Serve)**                 | Pass      | Pass               | Pass                | Pass                     | Partial           | **4.5 / 5** |
| **Reverse proxy + WireGuard** (Caddy) | Pass¹     | Fail               | Pass                | Partial                  | Fail              | **~2 / 5**  |

¹ Caddy/Traefik are config-file-scriptable and agent-friendly; **Nginx Proxy Manager fails** this criterion outright (GUI-only, undocumented REST API).

Hard filter applied: Q1 = "Yes, persistent connections required" (SSE narration, long-running SSH, background agent runs). All three ingress candidates sit in front of a persistent Node server, so none is dropped — but this is what eliminated the serverless cloud tier. Interview weights: Q2 "minimize cost" — all three are **$0** at this scale, so cost does not differentiate; Q4 "single region, 1–few users" — global edge gives no advantage and no penalty.

### Shortlisted Platforms

#### 1. Cloudflare Tunnel + Cloudflare Access (Recommended)

- **CLI-first**: full `cloudflared tunnel create / route dns / run / delete` lifecycle; token-based auth bypasses browser login so an agent runs it unattended. (GA)
- **Managed**: outbound-only connector, no inbound ports on the router, no exposed home IP, **omits CGNAT entirely**. Cloudflare auto-issues edge TLS; origin can stay plain HTTP on the LAN.
- **Docs**: Cloudflare publishes `llms.txt` + `llms-full.txt` and serves docs as markdown via `Accept: text/markdown` (Markdown for Agents, Feb 2026).
- **MCP**: official Cloudflare API MCP server (GA) exposes 2,500+ endpoints incl. Zero Trust/Access/tunnels via `search()`/`execute()`. (MCP Server Portals are Open Beta as of 2026-05-29 — soft signal only.)
- **Access**: self-hosted Access app bound to the tunnel hostname; one-time-PIN email (no IdP needed), or Google/GitHub OIDC, or service tokens. Free up to 50 seats, no device limit.
- **Cost**: $0 at 1–few users (Tunnel free; Access free ≤50 seats; free Cloudflare DNS zone required).
- **The gap it must close**: SSE through the edge needs heartbeats + no-buffering headers (see cross-check). This is a code-side fix, applied from day one.

#### 2. Tailscale (Serve)

- WireGuard-based private mesh. **Tailscale Serve** (GA) exposes the app over private HTTPS inside the tailnet and forwards identity headers (`Tailscale-User-Login`). Simpler and more private than a public tunnel — nothing is exposed to the open internet, and there is no edge proxy with a 100 s idle timeout.
- Fully scriptable: `TS_AUTHKEY` / OAuth client, `tailscale up/serve/status`, ACLs-as-code. Docs are markdown (`.md` suffix) + `llms.txt`.
- **The gap vs the recommendation**: no clientless path — *every* consumer device must install and authenticate the Tailscale client. For 1–few technical homelab users this is acceptable, but it is real friction vs Cloudflare Access's browser+OTP. MCP is Partial (no canonical first-party server; Aperture MCP proxying + community wrappers). A known long-lived-connection drop report through `tailscale serve` (#18827) means SSE keepalive must be validated. Free Personal plan (Pricing v4, 2026-04-08): 6 users, unlimited devices — fits comfortably.
- **When to swap to this**: if the SSE-through-Cloudflare-edge gotchas prove too costly to manage, or if you want zero public exposure and all users are willing to run a VPN client.

#### 3. Reverse proxy + WireGuard (Caddy + WireGuard)

- Maximum control, zero vendor lock-in, all OSS/free. Caddy gives 2–3-line auto-HTTPS config (most agent-friendly proxy); WireGuard keeps access private with no public service exposure.
- **The gap vs the recommendation**: fails "managed" — you own proxy patching, cert renewal, port management, and the host's exposure. **CGNAT** (common on 2026 consumer ISPs) makes both port-forwarding and inbound WireGuard UDP impossible on many connections. Public reverse-proxy variant exposes the home IP (geolocatable, scanned within minutes) and **fail2ban is broken behind a proxy by default**. No MCP for any proxy.
- **When to swap to this**: only if you must avoid all third-party dependence AND your ISP gives a real public IP — a niche case here.

## Anti-Bias Cross-Check: Cloudflare Tunnel + Access

### Devil's Advocate — Weaknesses

1. **The 100 s edge idle-timeout + `text/event-stream` buffering hits the flagship feature.** Live SSE agent narration works on localhost and silently stutters/cuts after ~100 s in production on the longer diagnoses users care about. `proxy_read_timeout` is raisable only on Enterprise. This is a deploy-only failure mode invisible during local dev.
2. **Hard dependency on Cloudflare owning the DNS zone.** Using Tunnel requires moving the domain's nameservers to Cloudflare — DNS + edge + access policy all centralize at one vendor. An account suspension, a bad DNS edit, or a Cloudflare outage can take *all* homelab access offline at once.
3. **Two auth layers** (Cloudflare Access + in-app Better Auth, FR-001). Double login for 1–few users, and the in-app audit identity (FR-011) is independent of the Access identity — "who got in" can mismatch "whose app session it is," muddying the audit trail.
4. **`cloudflared` in-container auto-update** silently changes connector behavior; without `--no-autoupdate` + a pinned image tag, an agent-managed deploy stops being reproducible.
5. **All ingress traffic is TLS-terminated at Cloudflare's edge** — including device-log content surfaced in agent narration. For a tool that reads homelab logs, that is operational data transiting a third party; the "it's just a tunnel" framing hides it.

### Pre-Mortem — How This Could Fail

Six months in, the Cloudflare Tunnel + Access choice became a slow-motion mess. Everything worked on localhost, so SSE narration shipped without heartbeats; in production the 524 idle timeout and `text/event-stream` buffering meant the "live narration" feature — the product's headline — stuttered and cut out after ~100 s on longer diagnoses, exactly the runs users cared about. Debugging took weeks because it was invisible locally. Meanwhile, moving the domain's nameservers to Cloudflare entangled the homelab's other services; a botched DNS edit during an unrelated change took everything offline at once. Cloudflare Access's OTP-email login annoyed the two housemate users enough that they asked to "just turn off the password," eroding the security posture the tunnel was supposed to provide. The double-auth (Access + Better Auth) produced audit entries that didn't line up, undermining FR-011's accountability promise. None of these were Cloudflare bugs — they were predictable interactions
between a streaming app, an edge proxy with an opinionated timeout, and centralized DNS that nobody stress-tested before committing.

### Unknown Unknowns

- The 524 is an **idle** timeout, not absolute — counterintuitive, and the fix (heartbeat `: ping\n\n` comments every ~30–60 s) is a **code change in the SSE producer, not a dashboard setting**. You cannot fix it from the panel.
- `text/event-stream` may be buffered by Cloudflare to ~100 KB unless you set `X-Accel-Buffering: no` + `Cache-Control: no-cache` — undocumented on marketing pages, surfaced only in `cloudflared` issues #199 / #1449.
- Cloudflare Tunnel requires the apex domain's **nameservers on Cloudflare** (free zone) — a bigger commitment than "add a tunnel to existing DNS."
- Access free tier (50 seats) is GA, but **MCP Server Portals are Open Beta** (2026-05-29) — do not build ops automation assuming the portal is stable.
- **WebSocket is Cloudflare's officially-blessed streaming path**; if SSE-through-edge keeps biting, the fix may be re-architecting narration to WebSocket — a non-trivial change to a feature you thought was finished.

## Operational Story

- **Preview deploys**: no managed preview-URL concept for self-host. Branch/PR validation happens via GitHub Actions building the multi-arch image; a "preview" is running that image locally with `docker compose up` (the NestJS/Angular dev servers already give local fidelity). Production = the same image pulled onto the homelab host. No per-PR public preview unless you stand up a second tunnel hostname by hand.
- **Secrets**: SSH credentials encrypted at-rest in SQLite (FR-013, app-level). Infra secrets live in env vars / Docker secrets on the host (never committed): `TUNNEL_TOKEN` for `cloudflared`, the app's encryption key, the LLM provider credentials (FR-012). GitHub Actions uses the built-in `GITHUB_TOKEN` for GHCR push. Rotation = regenerate token in Cloudflare Zero Trust dashboard, update the host env var, `docker compose up -d`.
- **Rollback**: pin the previous **immutable digest** — capture with `docker inspect --format='{{index .RepoDigests 0}}'`, set `image: ghcr.io/<owner>/opspilot@sha256:...` in `compose.yaml`, then `docker compose up -d`. Time-to-revert ≈ a pull + recreate (seconds–minutes). **Caveat**: Drizzle schema migrations do not auto-roll-back — a forward migration on a stateful SQLite DB is not reversed by pinning an old image. Back up the SQLite file before applying migrations.
- **Approval**: an agent may build/push images, pull, `up -d`, tail logs, and create/route a tunnel unattended. **Human-only**: rotating the primary encryption key or `TUNNEL_TOKEN`, editing the Cloudflare DNS zone / nameservers, deleting the tunnel, and any destructive SQLite operation (drop/restore). Manual click costs 30 s; cleanup after an automated mistake costs hours.
- **Logs**: read-only via `docker compose logs -f [service]` / `docker logs <container>` (app + `cloudflared`). Pipeline logs via `gh run view` / the GitHub MCP server. Cloudflare tunnel/edge state via `cloudflared tunnel info` or the Cloudflare API MCP server.

## Risk Register

| Risk                                                                                                          | Source                              | Likelihood | Impact | Mitigation                                                                                                                                                                                         |
|---------------------------------------------------------------------------------------------------------------|-------------------------------------|------------|--------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| SSE narration cut/buffered through CF edge (100 s idle timeout + `text/event-stream` buffering)               | Devil's advocate / Unknown unknowns | H          | H      | Emit SSE heartbeat (`: ping`) every 30–60 s; set `X-Accel-Buffering: no`, `Cache-Control: no-cache`, `Content-Type: text/event-stream` from day one. Keep WebSocket as documented fallback.        |
| DNS/edge centralization — whole homelab access offline on bad DNS edit, CF outage, or account suspension      | Devil's advocate / Pre-mortem       | M          | H      | Treat DNS zone edits as human-only; keep a non-CF break-glass path (e.g. Tailscale Serve ready as runner-up); document the nameserver move.                                                        |
| Double-auth identity mismatch (CF Access vs in-app Better Auth) undermines audit (FR-011)                     | Devil's advocate                    | M          | M      | Decide one source of truth for audit identity; if relying on app session, treat Access purely as a network gate, not the audit identity. Reconcile during implementation.                          |
| `cloudflared` in-container auto-update makes deploys non-reproducible                                         | Devil's advocate                    | M          | M      | Run with `--no-autoupdate` and pin the `cloudflared` image tag; the agent controls upgrades.                                                                                                       |
| SQLite WAL corruption / "database is locked" on network share                                                 | Research finding                    | M          | H      | Keep the SQLite volume on the host's **local** ext4/btrfs disk via bind mount — never an NFS/SMB/iSCSI mount.                                                                                      |
| Synology Container Manager blocks raw-socket / host-networking for nmap/arp-scan; GHCR GUI auth gap; x86-only | Research finding                    | M          | M      | Prefer plain Docker on a Linux mini-PC/VPS/Pi. If Synology is mandatory, configure host/macvlan + `NET_RAW`/`NET_ADMIN` via CLI (`sudo docker`), accept GUI friction, and verify the model is x86. |
| Unattended auto-update restarts the app mid-write (stateful SQLite)                                           | Research finding                    | M          | M      | No Watchtower auto-update (containrrr repo archived 2025-12-17 anyway). Use Diun (notify-only) + agent/human-triggered `docker compose pull && up -d`; back up the DB first.                       |
| arm64 build slow/flaky under QEMU emulation; image too large for Pi                                           | Research finding                    | L          | M      | Use native ARM runner (`runs-on: ubuntu-24.04-arm`) in a matrix + `buildx imagetools` merge; multi-stage build, prune the Nx `dist`.                                                               |
| MCP Server Portals (Open Beta 2026-05-29) change before GA                                                    | Unknown unknowns                    | L          | L      | Build ops on the CLI + GA Cloudflare API MCP; treat Portals as bonus, not load-bearing.                                                                                                            |

## Getting Started

Validated against the project's pinned stack (Node persistent server, Nx 22 monorepo, single multi-arch container → GHCR). Hostnames/owners are placeholders.

1. **Build & push the multi-arch image (GitHub Actions).** Add a workflow using `docker/setup-qemu-action@v4`, `docker/setup-buildx-action@v4`, `docker/login-action@v3` (auth via built-in `GITHUB_TOKEN`), and `docker/build-push-action@v7` with `platforms: linux/amd64,linux/arm64`, pushing to `ghcr.io/<owner>/opspilot`. Prefer a native-ARM runner matrix over QEMU if build time hurts. (Image build / Dockerfile authoring is out of scope for this doc — see Non-Goals.)
2. **On the homelab Linux host**, write a `compose.yaml` with two services: `opspilot` (the GHCR image; SQLite volume **bind-mounted to a local SSD path**; `network_mode: host` or `cap_add: [NET_RAW, NET_ADMIN]` for nmap/arp-scan) and `cloudflared` (`cloudflare/cloudflared:<pinned-tag>`, command `tunnel --no-autoupdate run`, `TUNNEL_TOKEN` from env/secret).
3. **Create the tunnel** (one-time, agent-scriptable): in Cloudflare Zero Trust create a tunnel, copy its token into the host env, then `cloudflared tunnel route dns <tunnel> opspilot.<your-domain>`. Requires the domain's nameservers already on Cloudflare (free zone).
4. **Put Cloudflare Access in front**: create a self-hosted Access application bound to `opspilot.<your-domain>`, add a policy allowing the 1–few user emails via one-time-PIN (no IdP needed).
5. **Wire SSE correctly from day one**: heartbeat every 30–60 s + `X-Accel-Buffering: no` / `Cache-Control: no-cache` headers on the narration endpoint, so live narration survives the edge. Verify a >100 s diagnosis streams end-to-end through the tunnel before calling it done.
6. **Deploy / update loop**: `docker compose pull && docker compose up -d`. **Rollback**: pin the previous image digest in `compose.yaml` and `up -d`. Use Diun for update notifications, not auto-update.

## Out of Scope

The following were not evaluated in this research:

- Docker image configuration / Dockerfile authoring
- CI/CD pipeline setup (the GitHub Actions sketch above is a pointer, not a configured pipeline)
- Production-scale architecture (multi-region, HA, DR)
